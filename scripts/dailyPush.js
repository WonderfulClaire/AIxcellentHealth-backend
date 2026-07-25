// scripts/dailyPush.js
// 独立运行器：直接在部署服务器上跑「每日健康小推送」邮件任务。
// 用法： node scripts/dailyPush.js
// 建议用 crontab / systemd timer 每天固定时间触发（如北京 07:00）：
//   0 23 * * * cd /path/to/AIxcellentHealth-backend && /usr/bin/node scripts/dailyPush.js >> logs/daily-push.log 2>&1
//
// 注意：邮件发送依赖 .env 中的 SMTP_HOST 等；未配置时只会记录推送意图、不真正发信。
import 'dotenv/config';
import { runDailyPush } from '../src/dailyPush.js';

runDailyPush()
  .then((r) => {
    console.log('[dailyPush] 完成:', JSON.stringify(r));
    process.exit(0);
  })
  .catch((err) => {
    console.error('[dailyPush] 失败:', err);
    process.exit(1);
  });
