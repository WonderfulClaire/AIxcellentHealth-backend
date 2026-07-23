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
  const wearable = db
    .prepare('SELECT * FROM wearable WHERE user_id = ? ORDER BY date DESC')
    .all(u);
  res.json({
    exported_at: new Date().toISOString(),
    schema_version: 1,
    profile: profile || null,
    records,
    wearable,
  });
});

/* ── 可穿戴设备数据（手表 / 手环 / Apple Watch 经快捷指令同步）──
 * 每条 = 一天的可穿戴汇总。来源 source: ble | manual | import | apple_health。
 * 前端 healthStore 已调用本接口；后端部署后即从 localStorage 无缝切换为云端。 */

// 读取本人的可穿戴数据
router.get('/wearable', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM wearable WHERE user_id = ? ORDER BY date DESC LIMIT 200')
    .all(req.user.sub);
  res.json({ wearable: rows });
});

// 写入/更新一条或多条（upsert：同一 user+date+source 覆盖）
router.post('/wearable', (req, res) => {
  const body = Array.isArray(req.body) ? req.body : [req.body];
  const u = req.user.sub;
  const stmt = db.prepare(`
    INSERT INTO wearable (user_id, date, source, device, resting_hr, avg_hr, max_hr, steps, sleep_hours, spo2, hrv, active_energy, note)
    VALUES (@user_id, @date, @source, @device, @resting_hr, @avg_hr, @max_hr, @steps, @sleep_hours, @spo2, @hrv, @active_energy, @note)
    ON CONFLICT(user_id, date, source) DO UPDATE SET
      device=excluded.device, resting_hr=excluded.resting_hr, avg_hr=excluded.avg_hr,
      max_hr=excluded.max_hr, steps=excluded.steps, sleep_hours=excluded.sleep_hours,
      spo2=excluded.spo2, hrv=excluded.hrv, active_energy=excluded.active_energy, note=excluded.note
  `);
  const out = [];
  const tx = db.transaction((items) => {
    for (const it of items) {
      if (!it || !it.date) continue;
      out.push(
        stmt.run({
          user_id: u,
          date: it.date,
          source: it.source || 'import',
          device: it.device || null,
          resting_hr: num(it.resting_hr),
          avg_hr: num(it.avg_hr),
          max_hr: num(it.max_hr),
          steps: int(it.steps),
          sleep_hours: num(it.sleep_hours),
          spo2: num(it.spo2),
          hrv: num(it.hrv),
          active_energy: num(it.active_energy ?? it.active_energy_kcal),
          note: it.note || null,
        }).lastInsertRowid
      );
    }
  });
  tx(body);
  res.json({ ok: true, saved: out.length });
});

// 快捷指令同步入口：接收 { records:[{date,resting_hr,avg_hr,max_hr,steps,sleep_hours,spo2,hrv,active_energy_kcal}], workouts:[...] }
// workouts 可含 hr_samples 数组，自动推导 avg/max 心率。同一天会被合并为一条 apple_health 记录（避免覆盖）。
router.post('/sync', (req, res) => {
  const u = req.user.sub;
  const payload = req.body || {};
  const records = Array.isArray(payload) ? payload : payload.records || [];
  const workouts = payload.workouts || [];
  const byDate = new Map();

  const get = (date) => {
    if (!byDate.has(date)) {
      byDate.set(date, {
        date, source: 'apple_health', device: 'Apple Watch',
        resting_hr: null, avg_hr: null, max_hr: null,
        steps: null, sleep_hours: null, spo2: null, hrv: null,
        active_energy: null, note: null,
      });
    }
    return byDate.get(date);
  };
  const maxOf = (a, b) => (a == null ? b : b == null ? a : Math.max(a, b));

  for (const r of records) {
    if (!r || !r.date) continue;
    const e = get(r.date);
    e.resting_hr = num(r.resting_hr) ?? e.resting_hr;
    e.avg_hr = num(r.avg_hr) ?? e.avg_hr;
    e.max_hr = num(r.max_hr) ?? e.max_hr;
    e.steps = num(r.steps) ?? e.steps;
    e.sleep_hours = num(r.sleep_hours) ?? e.sleep_hours;
    e.spo2 = num(r.spo2) ?? e.spo2;
    e.hrv = num(r.hrv) ?? e.hrv;
    e.active_energy = maxOf(e.active_energy, num(r.active_energy ?? r.active_energy_kcal));
    e.note = r.note || e.note;
  }

  for (const w of workouts) {
    if (!w || !w.date) continue;
    const e = get(w.date);
    let avg = num(w.avg_hr);
    let max = num(w.max_hr);
    if (Array.isArray(w.hr_samples) && w.hr_samples.length) {
      const vals = w.hr_samples.filter((x) => typeof x === 'number' && x > 0);
      if (vals.length) {
        avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
        max = Math.max(...vals);
      }
    }
    e.avg_hr = e.avg_hr ?? avg;
    e.max_hr = e.max_hr ?? max;
    e.active_energy = maxOf(e.active_energy, num(w.active_energy ?? w.active_energy_kcal));
    const wnote = `${w.type || '训练'} ${w.duration_min ? w.duration_min + 'min' : ''}`.trim();
    e.note = e.note ? `${e.note} · ${wnote}` : wnote;
  }

  const items = [...byDate.values()];
  const stmt = db.prepare(`
    INSERT INTO wearable (user_id, date, source, device, resting_hr, avg_hr, max_hr, steps, sleep_hours, spo2, hrv, active_energy, note)
    VALUES (@user_id, @date, @source, @device, @resting_hr, @avg_hr, @max_hr, @steps, @sleep_hours, @spo2, @hrv, @active_energy, @note)
    ON CONFLICT(user_id, date, source) DO UPDATE SET
      device=excluded.device, resting_hr=excluded.resting_hr, avg_hr=excluded.avg_hr,
      max_hr=excluded.max_hr, steps=excluded.steps, sleep_hours=excluded.sleep_hours,
      spo2=excluded.spo2, hrv=excluded.hrv, active_energy=excluded.active_energy, note=excluded.note
  `);
  const tx = db.transaction((list) => {
    for (const it of list) {
      stmt.run({
        user_id: u,
        date: it.date,
        source: it.source,
        device: it.device,
        resting_hr: num(it.resting_hr),
        avg_hr: num(it.avg_hr),
        max_hr: num(it.max_hr),
        steps: int(it.steps),
        sleep_hours: num(it.sleep_hours),
        spo2: num(it.spo2),
        hrv: num(it.hrv),
        active_energy: num(it.active_energy),
        note: it.note,
      });
    }
  });
  tx(items);
  res.json({ ok: true, saved: items.length });
});

// 自助删除：清除本人全部健康数据（保留账号；个保法「删除权」）
router.delete('/data', (req, res) => {
  const u = req.user.sub;
  db.prepare('DELETE FROM daily_records WHERE user_id = ?').run(u);
  db.prepare('DELETE FROM profiles WHERE user_id = ?').run(u);
  res.json({ ok: true, deleted_records: true, deleted_profile: true });
});

export default router;
