// Express 应用组装（无监听）：本地由 src/server.js 启动，Vercel 由 api/index.js 引入。
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initDb } from './db.js';
import { authenticate, requireAdmin } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import healthRoutes from './routes/health.js';
import adminRoutes from './routes/admin.js';

dotenv.config();

const app = express();
const allowed = (process.env.CORS_ORIGIN || '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowed.includes('*') ? true : allowed,
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));

// 冷启动时确保建表 + 默认管理员（幂等，仅首次真正执行）
app.use(async (req, res, next) => {
  try {
    await initDb();
    next();
  } catch (err) {
    console.error('[initDb]', err);
    res.status(500).json({ error: '数据库初始化失败' });
  }
});

// 健康检查（供部署平台探活）
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// 公开路由：注册 / 登录 / 当前用户
app.use('/api/auth', authRoutes);

// 需登录：健康档案与记录（按 user_id 隔离）
app.use('/api/health', authenticate, healthRoutes);

// 仅管理员：统一管理
app.use('/api/admin', authenticate, requireAdmin, adminRoutes);

// 管理后台前端（黑金风，纯静态；Vercel 上由平台直接托管 public/）
app.use(express.static('public'));

// 兜底 404
app.use((req, res) => res.status(404).json({ error: '未找到该接口' }));

// 异步路由抛错兜底
app.use((err, req, res, next) => {
  console.error('[unhandled]', err);
  res.status(500).json({ error: '服务器内部错误' });
});

export default app;
