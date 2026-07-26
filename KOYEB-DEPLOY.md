# Koyeb 免费部署指南（无需信用卡）

Koyeb 免费档（Starter）：**不需要绑任何银行卡**，包含 1 个 Web 服务（512MB 内存），足够本项目使用。

## 一步步操作

### 1. 注册 Koyeb
- 打开 https://app.koyeb.com/auth/signup
- 选择 **Sign up with GitHub**（用 GitHub 账号登录，最省事）
- 授权后进入控制台

### 2. 创建 Web Service
1. 点 **Create Web Service**（或 Create Service → Web Service）
2. 部署方式选 **GitHub**
3. 仓库选择 **WonderfulClaire/AIxcellentHealth-backend**，分支 `main`
4. Builder（构建方式）选 **Dockerfile**（仓库里已提供）

### 3. 配置环境变量（Environment variables）
点 Add Variable，逐个添加：

| Key | Value |
|-----|-------|
| `JWT_SECRET` | 一串随机长字符（30 位以上，随便乱敲也行） |
| `ADMIN_PASSWORD` | 管理后台强密码（例如 `Aix@2026!Secure`） |
| `CORS_ORIGIN` | `https://wonderfulclaire.github.io` |

### 4. 实例与端口
- Instance 选 **Free**（0.1 vCPU / 512MB，$0）
- Port 保持 **8000**（Dockerfile 已内置），Koyeb 通常会自动识别
- Health check 路径可填 `/api/health`

### 5. 点 Deploy
等待 2~3 分钟构建，成功后会得到一个公网地址，形如：

```
https://xxx-yyy.koyeb.app
```

### 6. 验证
- 打开 `https://你的地址/api/health` → 应显示 `{"ok":true,...}`
- 打开 `https://你的地址/admin.html` → 用 `admin@aixcellent.health` + 你设置的 `ADMIN_PASSWORD` 登录管理后台

### 7. 前端接入
把地址告诉开发助手（或自己操作）：

```bash
cd AIxcellentSport-Agent
echo 'VITE_API_BASE=https://你的地址' > .env
npm run build   # 重新构建并部署 spa-dist
```

前端即从「本地演示模式」切换为「真云端账号」。

## 注意事项

- **免费档闲置约 1 小时会缩容到零**：下次访问需数秒冷启动，属正常现象，不收费。
- **SQLite 数据在实例重建后会丢失**（免费档磁盘为临时盘）。两种应对：
  1. 比赛演示场景可接受（现场注册演示即可）；
  2. 想永久保存 → 用 Koyeb 免费送的 **PostgreSQL 数据库**（控制台 → Databases → Create，同样免费无卡），然后把后端切换为 Postgres 存储（`schema.sql` 已按 Postgres 兼容编写）。
- 免费档只能建 1 个 Web 服务，够用。
