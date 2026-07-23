import { Router } from 'express';
import db from '../db.js';

const router = Router();

// 全站聚合统计（统一管理视角）
router.get('/stats', (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const totalRecords = db.prepare('SELECT COUNT(*) c FROM daily_records').get().c;
  const admins = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'admin'").get().c;
  const today = new Date().toISOString().slice(0, 10);
  const activeToday = db
    .prepare('SELECT COUNT(DISTINCT user_id) c FROM daily_records WHERE date = ?')
    .get(today).c;
  const newToday = db.prepare("SELECT COUNT(*) c FROM users WHERE date(created_at) = ?").get(today).c;
  res.json({ totalUsers, totalRecords, admins, activeToday, newToday, date: today });
});

// 用户列表（分页 + 搜索）
router.get('/users', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const q = String(req.query.q || '').trim();
  const limit = 20;
  const offset = (page - 1) * limit;
  const like = `%${q}%`;
  const rows = db
    .prepare(
      "SELECT id, email, name, role, status, created_at FROM users WHERE email LIKE ? OR name LIKE ? ORDER BY id DESC LIMIT ? OFFSET ?"
    )
    .all(like, like, limit, offset);
  const total = db
    .prepare('SELECT COUNT(*) c FROM users WHERE email LIKE ? OR name LIKE ?')
    .get(like, like).c;
  res.json({ users: rows, total, page, limit });
});

// 单用户详情 + 其档案与记录
router.get('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const user = db
    .prepare('SELECT id, email, name, role, status, created_at FROM users WHERE id = ?')
    .get(id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(id);
  const records = db
    .prepare('SELECT * FROM daily_records WHERE user_id = ? ORDER BY date DESC LIMIT 60')
    .all(id);
  res.json({ user, profile, records });
});

// 启用 / 停用账号
router.put('/users/:id/status', (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  if (!['active', 'disabled'].includes(status)) {
    return res.status(400).json({ error: 'status 只能为 active 或 disabled' });
  }
  db.prepare("UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
  res.json({ ok: true });
});

// 删除用户（级联删除其档案与记录）
router.delete('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true, deleted: id });
});

export default router;
