import { Router } from 'express';
import { q, one } from '../db.js';
import { runDailyPush } from '../dailyPush.js';

const router = Router();

// 全站聚合统计（统一管理视角）
router.get('/stats', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const totalUsers = (await one('SELECT COUNT(*)::int c FROM users')).c;
  const totalRecords = (await one('SELECT COUNT(*)::int c FROM daily_records')).c;
  const admins = (await one("SELECT COUNT(*)::int c FROM users WHERE role = 'admin'")).c;
  const activeToday = (
    await one('SELECT COUNT(DISTINCT user_id)::int c FROM daily_records WHERE date = $1', [today])
  ).c;
  const newToday = (
    await one('SELECT COUNT(*)::int c FROM users WHERE created_at::date = $1::date', [today])
  ).c;
  res.json({ totalUsers, totalRecords, admins, activeToday, newToday, date: today });
});

// 用户列表（分页 + 搜索）
router.get('/users', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const qs = String(req.query.q || '').trim();
  const limit = 20;
  const offset = (page - 1) * limit;
  const like = `%${qs}%`;
  const rows = await q(
    `SELECT id, email, name, role, status, created_at FROM users
     WHERE email ILIKE $1 OR name ILIKE $1 ORDER BY id DESC LIMIT $2 OFFSET $3`,
    [like, limit, offset]
  );
  const total = (
    await one('SELECT COUNT(*)::int c FROM users WHERE email ILIKE $1 OR name ILIKE $1', [like])
  ).c;
  res.json({ users: rows, total, page, limit });
});

// 单用户详情 + 其档案与记录
router.get('/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  const user = await one(
    'SELECT id, email, name, role, status, created_at FROM users WHERE id = $1',
    [id]
  );
  if (!user) return res.status(404).json({ error: '用户不存在' });
  const profile = await one('SELECT * FROM profiles WHERE user_id = $1', [id]);
  const records = await q(
    'SELECT * FROM daily_records WHERE user_id = $1 ORDER BY date DESC LIMIT 60',
    [id]
  );
  res.json({ user, profile, records });
});

// 启用 / 停用账号
router.put('/users/:id/status', async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  if (!['active', 'disabled'].includes(status)) {
    return res.status(400).json({ error: 'status 只能为 active 或 disabled' });
  }
  await q('UPDATE users SET status = $1, updated_at = now() WHERE id = $2', [status, id]);
  res.json({ ok: true });
});

// 删除用户（级联删除其档案与记录）
router.delete('/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  await q('DELETE FROM users WHERE id = $1', [id]);
  res.json({ ok: true, deleted: id });
});

// 手动触发「每日健康小推送」邮件任务（通常由定时调度调用）
// 需配置 SMTP_* 才会真正发信；未配置则仅记录推送意图并返回 smtpEnabled:false
router.post('/daily-push', async (req, res) => {
  try {
    const result = await runDailyPush();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[admin/daily-push]', err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

export default router;
