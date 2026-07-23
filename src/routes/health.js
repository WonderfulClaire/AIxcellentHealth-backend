import { Router } from 'express';
import db from '../db.js';

const router = Router();

// 数字字段统一转换：空/undefined → null，否则转 Number
function num(v) {
  return v === undefined || v === null || v === '' ? null : Number(v);
}
function int(v) {
  return v === undefined || v === null || v === '' ? null : Math.round(Number(v));
}

// 读取自己的健康档案
router.get('/profile', (req, res) => {
  const p = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(req.user.sub);
  res.json({ profile: p || null });
});

// 写入/更新自己的健康档案（建档：身体、作息、目标与限制）
router.put('/profile', (req, res) => {
  const { height, weight, birth_year, sex, goals, restrictions } = req.body || {};
  const u = req.user.sub;
  const exists = db.prepare('SELECT user_id FROM profiles WHERE user_id = ?').get(u);
  const goalsJson = goals ? JSON.stringify(goals) : null;
  const restJson = restrictions ? JSON.stringify(restrictions) : null;
  if (exists) {
    db.prepare(
      `UPDATE profiles SET height=?, weight=?, birth_year=?, sex=?, goals=?, restrictions=?, updated_at=datetime('now') WHERE user_id=?`
    ).run(num(height), num(weight), int(birth_year), sex ?? null, goalsJson, restJson, u);
  } else {
    db.prepare(
      `INSERT INTO profiles (user_id, height, weight, birth_year, sex, goals, restrictions) VALUES (?,?,?,?,?,?,?)`
    ).run(u, num(height), num(weight), int(birth_year), sex ?? null, goalsJson, restJson);
  }
  res.json({ profile: db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(u) });
});

// 读取每日记录（可按日期范围）
router.get('/records', (req, res) => {
  const { from, to } = req.query;
  let rows;
  if (from && to) {
    rows = db
      .prepare('SELECT * FROM daily_records WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date DESC')
      .all(req.user.sub, from, to);
  } else {
    rows = db
      .prepare('SELECT * FROM daily_records WHERE user_id = ? ORDER BY date DESC LIMIT 90')
      .all(req.user.sub);
  }
  res.json({ records: rows });
});

// 写入/更新某日记录（陪伴：每日调整）
router.post('/records', (req, res) => {
  const { date, sleep_hours, stress_level, training_load, posture_score, diet_note, energy_level, note } =
    req.body || {};
  if (!date) return res.status(400).json({ error: '日期(date)为必填项' });
  const u = req.user.sub;
  const exists = db.prepare('SELECT id FROM daily_records WHERE user_id = ? AND date = ?').get(u, date);
  if (exists) {
    db.prepare(
      `UPDATE daily_records SET sleep_hours=?, stress_level=?, training_load=?, posture_score=?, diet_note=?, energy_level=?, note=? WHERE user_id=? AND date=?`
    ).run(num(sleep_hours), stress_level ?? null, num(training_load), num(posture_score), diet_note ?? null, int(energy_level), note ?? null, u, date);
  } else {
    db.prepare(
      `INSERT INTO daily_records (user_id, date, sleep_hours, stress_level, training_load, posture_score, diet_note, energy_level, note) VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(u, date, num(sleep_hours), stress_level ?? null, num(training_load), num(posture_score), diet_note ?? null, int(energy_level), note ?? null);
  }
  res.json({ record: db.prepare('SELECT * FROM daily_records WHERE user_id = ? AND date = ?').get(u, date) });
});

// 聚合概览：最新记录 + 平均值
router.get('/summary', (req, res) => {
  const u = req.user.sub;
  const latest = db.prepare('SELECT * FROM daily_records WHERE user_id = ? ORDER BY date DESC LIMIT 1').get(u);
  const avg = db
    .prepare(
      'SELECT AVG(sleep_hours) avg_sleep, AVG(training_load) avg_load, AVG(posture_score) avg_posture, COUNT(*) cnt FROM daily_records WHERE user_id = ?'
    )
    .get(u);
  res.json({ latest, avg });
});

// 自助导出：返回本人全部健康数据（个保法「可携带权」）
router.get('/export', (req, res) => {
  const u = req.user.sub;
  const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(u);
  const records = db
    .prepare('SELECT * FROM daily_records WHERE user_id = ? ORDER BY date DESC')
    .all(u);
  res.json({
    exported_at: new Date().toISOString(),
    schema_version: 1,
    profile: profile || null,
    records,
  });
});

// 自助删除：清除本人全部健康数据（保留账号；个保法「删除权」）
router.delete('/data', (req, res) => {
  const u = req.user.sub;
  db.prepare('DELETE FROM daily_records WHERE user_id = ?').run(u);
  db.prepare('DELETE FROM profiles WHERE user_id = ?').run(u);
  res.json({ ok: true, deleted_records: true, deleted_profile: true });
});

export default router;
