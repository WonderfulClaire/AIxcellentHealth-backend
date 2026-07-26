// 本地 / 传统主机启动入口（Vercel 走 api/index.js，不经过这里）
import app from './app.js';
import { initDb } from './db.js';

const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`AIxcellent 后端已启动: http://localhost:${PORT}`);
      console.log(`管理后台: http://localhost:${PORT}/admin.html`);
    });
  })
  .catch((err) => {
    console.error('[启动失败] 数据库初始化异常:', err);
    process.exit(1);
  });
