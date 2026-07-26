# AIxcellent 私享管家 · 后端交接（给 Qoder / AI 编码助手）

> 你打开的是**后端**仓库。完整的项目全景、前后端 API 契约、设计规范与「铁律」在**前端仓库**的
> `AIxcellentSport-Agent/QODER-HANDOFF.md`（本目录的同级兄弟目录）。请优先读那份，本文件只讲后端。

## 这是什么
AIxcellent 私享管家的后端：用户账号、云端健康档案、可穿戴数据同步、管理后台。
前后端通过 REST API 解耦，前端没有后端时会降级为 localStorage 演示模式。

## 技术栈
- Node ≥18，ESM（`"type":"module"`）
- Express 4 + SQLite（`better-sqlite3`，文件 `data/aixcellent.db`）
- JWT 鉴权（`jsonwebtoken`）+ 密码哈希（`bcryptjs`）+ CORS

## 怎么跑
```bash
npm install
cp .env.example .env        # 配 JWT_SECRET / PORT / CORS_ORIGIN
PORT=8787 npm run start     # 或 npm run dev（--watch）
# 健康检查：GET http://localhost:8787/api/health
```

## 目录
- `src/server.js` 启动 + 路由挂载 + 静态 admin
- `src/db.js` 建表：users / profiles / daily_records / wearable
- `src/routes/auth.js` 注册/登录/me/注销
- `src/routes/health.js` profile / records / summary / export / wearable / **sync** / data
- `src/routes/admin.js` 统计与用户管理；页面 `public/admin.html`

## API（需鉴权的带 Bearer token）
详见前端交接文档 §6。核心：
- `POST /api/auth/register|login`、`GET/DELETE /api/auth/me`
- `GET/PUT /api/health/profile`、`GET/POST /api/health/records`、`GET /api/health/summary|export`
- `GET/POST /api/health/wearable`（`UNIQUE(user_id,date,source)`）
- `POST /api/health/sync`：快捷指令同步入口 `{schema:"aix-apple-health/v1",records:[],workouts:[]}`，按天聚合、workouts 自动算平均/峰值心率
- `DELETE /api/health/data`

## 部署（尚未部署）
推荐 **Koyeb 免绑卡免费档**，步骤见 `KOYEB-DEPLOY.md`（Dockerfile 已备好）。
部署后把地址填到前端构建期变量 `VITE_API_BASE` 重新 build，即可切到云端联动。
⚠️ SQLite 在无持久盘平台会丢数据；需持久化请挂卷或换 Postgres（参考 `render.yaml`）。

## 后端优先级任务
1. 部署到 Koyeb，跑通线上 register → sync → wearable。
2. 安全加固：rate limit、JWT 过期/刷新、输入校验、CORS 收紧。
3. 数据持久化方案（挂卷 / Postgres）。

## ⛔ 铁律
- 不要动 Claire 现有的其它 GitHub 仓库；要发布新东西一律新建独立仓库。
- 改完确保服务能起、端到端接口通再算完成。
- 完整铁律见前端交接文档 §10。
