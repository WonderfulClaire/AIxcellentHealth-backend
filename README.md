# AIxcellent 私享管家 · 后端服务

统一用户账户、健康档案与每日记录的管理后端，配套一个黑金风的管理后台。
前端为纯静态站点（GitHub Pages / CDN），本服务为**无状态 REST API**，可独立水平扩展。

> 与前端「本地优先」版本不同，本仓库对应的是**云端账号体系**：用户注册登录后，健康档案与每日记录存储于服务端数据库，由管理员在后台统一管理。前端站点的隐私文案需相应更新为「数据加密存储于云端，你可随时导出 / 删除」。

---

## 技术栈

- **Node.js + Express**（ESM）
- **better-sqlite3**（开发 / 演示；schema 已按 Postgres 兼容编写，生产可平滑切换）
- **bcryptjs**：密码加盐哈希
- **jsonwebtoken**：登录态（Bearer Token）
- 零前端框架依赖，管理后台为单文件 `public/admin.html`

---

## 功能

| 模块 | 说明 |
|------|------|
| 账户鉴权 | 注册 / 登录 / 当前用户；密码 bcrypt 加盐哈希；JWT 7 天有效 |
| 健康档案 | 建档：身高体重、出生年、性别、目标、限制（按用户隔离） |
| 每日记录 | 睡眠 / 压力 / 训练负荷 / 体态评分 / 精力 / 备注（按日期 upsert） |
| 数据聚合 | 最新记录 + 平均值概览 |
| 管理后台 | 注册用户数、今日活跃、今日新增、记录总数；用户列表（搜索 / 分页）、详情、启用 / 停用、删除（级联清理其档案与记录） |
| 角色隔离 | `user` 仅能读写自己的数据；`admin` 才能访问 `/api/admin/*`（中间件 `requireAdmin` 强制） |

---

## 目录结构

```
.
├── src/
│   ├── server.js            # 入口：挂载路由、CORS、静态后台
│   ├── db.js                # SQLite 连接 + 自动建表 + 初始化管理员
│   ├── middleware/auth.js   # authenticate / requireAdmin / JWT_SECRET
│   └── routes/
│       ├── auth.js          # /api/auth/* 注册登录
│       ├── health.js        # /api/health/* 档案与记录（需登录）
│       └── admin.js         # /api/admin/* 统一管理（需管理员）
├── public/admin.html        # 黑金风管理后台（纯前端，调用上述 API）
├── schema.sql              # Postgres 兼容结构参考
├── .env.example            # 环境变量模板
└── package.json
```

---

## 本地运行

```bash
npm install
cp .env.example .env          # 按需修改，尤其 JWT_SECRET / 管理员账号
npm start                     # 默认 http://localhost:3000
# 管理后台：http://localhost:3000/admin.html
# 探活：    GET /api/health
```

默认管理员账号由 `.env` 中的 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 在首次启动时自动创建。

---

## 部署（免费、可扩展）

### Railway / Render（推荐，免费层）

1. 新建 Web Service，关联本仓库。
2. Build：`npm install`；Start：`npm start`。
3. 在平台环境变量中添加：
   - `PORT`（平台自动注入，无需手填）
   - `JWT_SECRET`：≥32 位随机串
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD`：初始管理员
   - `DB_PATH`：指向持久卷，例如 `/data/aixcellent.db`（**务必使用平台持久存储，否则重启丢数据**）
   - `CORS_ORIGIN`：你的前端域名，如 `https://wonderfulclaire.github.io`（生产请收敛，不要用 `*`）
4. 部署完成后访问 `https://<你的域名>/admin.html` 即管理后台。

### 扩展性说明（为什么"很多人用不崩"）

- 前端是 CDN 静态资源，天然抗高并发；后端是无状态 API，可多实例横向扩容。
- SQLite 适合中小规模；用户量上来后切换到托管 Postgres（见下），由数据库承担并发，API 层继续无状态扩容。
- 所有写操作按 `user_id` 隔离，管理接口强制 `requireAdmin`，不存在越权读取他人数据。

---

## 切换到托管 Postgres（生产）

1. 将 `src/db.js` 中的 better-sqlite3 换成 `pg`（`Pool`），SQL 基本兼容（见 `schema.sql`）。
2. 用环境变量 `DATABASE_URL` 注入连接串。
3. 建表语句已在 `schema.sql` 给出（SERIAL / TIMESTAMPTZ / JSONB）。

> 为降低改动，建议封装一个 `db.query(sql, params)` 适配层，业务代码保持不变。

---

## 安全与合规建议

- **密码**：bcrypt 加盐哈希，明文密码不落库。
- **传输**：生产务必启用 HTTPS（部署平台默认提供）。
- **令牌**：JWT 无状态，泄露即等效于账号登录；如需更强控制可改造成短期 access token + 刷新 token。
- **敏感数据**：健康数据属敏感个人信息，建议生产对 `profiles` / `daily_records` 做字段级加密（应用层 AES-256-GCM，密钥存于环境变量或 KMS）。
- **用户权利**：已提供管理员删除（级联清理）；建议补充「用户自助导出 / 注销并删除全部数据」接口，以满足《个人信息保护法》的查询、更正、删除权。
- **留存与审计**：建议记录关键操作日志，便于合规审计。

---

## API 速览

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | `/api/auth/register` | 公开 | 注册，返回 token |
| POST | `/api/auth/login` | 公开 | 登录，返回 token |
| GET  | `/api/auth/me` | 登录 | 当前用户 |
| GET/PUT | `/api/health/profile` | 登录(本人) | 健康档案 |
| GET/POST | `/api/health/records` | 登录(本人) | 每日记录 |
| GET  | `/api/health/summary` | 登录(本人) | 聚合概览 |
| GET  | `/api/admin/stats` | 管理员 | 全站统计 |
| GET  | `/api/admin/users` | 管理员 | 用户列表(分页/搜索) |
| GET  | `/api/admin/users/:id` | 管理员 | 用户详情+记录 |
| PUT  | `/api/admin/users/:id/status` | 管理员 | 启用/停用 |
| DELETE | `/api/admin/users/:id` | 管理员 | 删除(级联) |

所有受保护接口需在 Header 携带 `Authorization: Bearer <token>`。
