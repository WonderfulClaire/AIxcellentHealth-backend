import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import db from './db.js';
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

// 健康检查（供部署平台探活）
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// 公开路由：注册 / 登录 / 当前用户
app.use('/api/auth', authRoutes);

// 需登录：健康档案与记录（按 user_id 隔离）
app.use('/api/health', authenticate, healthRoutes);

// 仅管理员：统一管理
app.use('/api/admin', authenticate, requireAdmin, adminRoutes);

// 管理后台前端（黑金风，纯静态）
app.use(express.static('public'));

// 兜底 404
app.use((req, res) => res.status(404).json({ error: '未找到该接口' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AIxcellent 后端已启动: http://localhost:${PORT}`);
  console.log(`管理后台: http://localhost:${PORT}/admin.html`);
});

// 优雅关闭
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    db.close();
    process.exit(0);
  });
}
