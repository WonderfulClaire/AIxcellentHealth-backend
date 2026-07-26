# 部署指南（AIxcellent 后端）

后端已通过本地端到端测试（注册→登录→建档→打卡→汇总→导出→删数据→注销→管理员统计全部正常）。
本仓库已配好 `render.yaml` 与 `railway.json`，选一个平台即可一键上线。

---

## 方式 A：Render（推荐，免费）

1. 打开 https://render.com → 用 GitHub 登录 → **New → Web Service** → 选择本仓库 `AIxcellentHealth-backend`。
2. Render 会自动读取 `render.yaml`。在环境变量里 **务必填写 `ADMIN_PASSWORD`**（强密码）和 `CORS_ORIGIN`（填你的前端地址，如 `https://wonderfulclaire.github.io`）。
3. 点击 **Create Web Service**，等待构建完成，得到形如 `https://aixcellent-backend.onrender.com` 的地址。
4. **验证**：浏览器打开 `<你的地址>/api/health`，应返回 `{"ok":true,...}`。
5. 管理后台：打开 `<你的地址>/admin.html`，用 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 登录。

> 注意：Render 免费版文件系统是**临时**的，重新部署会清空 SQLite 数据。比赛演示足够；
> 若要持久化，请在 Render 挂载一个 **Disk**（挂载路径 `/data`）或在 `db.js` 改用 Postgres（`schema.sql` 已按 Postgres 兼容编写）。

## 方式 B：Railway

1. 打开 https://railway.app → New Project → Deploy from GitHub repo → 选本仓库。
2. 在 Variables 中设置：`JWT_SECRET`（随机串）、`ADMIN_PASSWORD`（强密码）、`CORS_ORIGIN`、`ADMIN_EMAIL`。
3. 部署完成后，Railway 提供 `https://<项目>.up.railway.app` 地址。

---

## 必填环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `JWT_SECRET` | 登录 token 签名密钥，请设随机长串 | dev-secret-change-me |
| `ADMIN_EMAIL` | 管理员邮箱 | admin@aixcellent.health |
| `ADMIN_PASSWORD` | **管理员密码，部署时必须改强密码** | change-me（弱，启动会告警） |
| `CORS_ORIGIN` | 允许跨域的前端地址，生产请填具体域名 | * |
| `PORT` | 服务端口 | 3000 |

---

## 让前端连上真后端（关键一步）

前端默认是「本地演示模式」（数据存浏览器）。要切到真实云端账号体系：

1. 部署后端拿到地址（如 `https://aixcellent-backend.onrender.com`）。
2. 在前端项目根目录创建 `.env`，写入：
   ```
   VITE_API_BASE=https://aixcellent-backend.onrender.com
   ```
3. 重新构建并部署前端（`npm run build` + 上传 `spa-dist/` 到 GitHub Pages）。
4. 此后用户注册/登录/建档/打卡的数据都会进入后端数据库，管理员后台可统一管理。

---

## 本地运行（开发 / 自检）

```bash
npm install
JWT_SECRET=本地测试密钥 ADMIN_PASSWORD=改个密码 npm start
# 访问 http://localhost:3000/api/health 与管理后台 /admin.html
```

数据文件位于 `data/`（已在 .gitignore 中，不会进仓库）。
