import { Router } from 'express';
import { q, one } from '../db.js';
import { getTodayTip } from '../dailyPush.js';

const router = Router();

// 数字字段统一转换：空/undefined → null，否则转 Number
function num(v) {
  return v === undefined || v === null || v === '' ? null : Number(v);
}
function int(v) {
  return v === undefined || v === null || v === '' ? null : Math.round(Number(v));
}

// 读取自己的健康档案
router.get('/profile', async (req, res) => {
  const p = await one('SELECT * FROM profiles WHERE user_id = $1', [req.user.sub]);
  res.json({ profile: p || null });
});

// 今日健康小推送（按用户画像 + 近期习惯筛选，幂等；前端用于站内卡片）
router.get('/daily-tip', async (req, res) => {
  try {
    const tip = await getTodayTip(req.user.sub);
    res.json({ tip });
  } catch (err) {
    console.error('[daily-tip]', err);
    res.status(500).json({ error: '生成今日推送失败' });
  }
});

// 写入/更新自己的健康档案（建档：身体、作息、目标与限制）
router.put('/profile', async (req, res) => {
  const { height, weight, birth_year, sex, goals, restrictions } = req.body || {};
  const u = req.user.sub;
  const goalsJson = goals ? JSON.stringify(goals) : null;
  const restJson = restrictions ? JSON.stringify(restrictions) : null;
  await q(
    `INSERT INTO profiles (user_id, height, weight, birth_year, sex, goals, restrictions)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (user_id) DO UPDATE SET
       height=excluded.height, weight=excluded.weight, birth_year=excluded.birth_year,
       sex=excluded.sex, goals=excluded.goals, restrictions=excluded.restrictions, updated_at=now()`,
    [u, num(height), num(weight), int(birth_year), sex ?? null, goalsJson, restJson]
  );
  res.json({ profile: await one('SELECT * FROM profiles WHERE user_id = $1', [u]) });
});

// 读取每日记录（可按日期范围）
router.get('/records', async (req, res) => {
  const { from, to } = req.query;
  let rows;
  if (from && to) {
    rows = await q(
      'SELECT * FROM daily_records WHERE user_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date DESC',
      [req.user.sub, from, to]
    );
  } else {
    rows = await q(
      'SELECT * FROM daily_records WHERE user_id = $1 ORDER BY date DESC LIMIT 90',
      [req.user.sub]
    );
  }
  res.json({ records: rows });
});

// 写入/更新某日记录（陪伴：每日调整）
router.post('/records', async (req, res) => {
  const { date, sleep_hours, stress_level, training_load, posture_score, diet_note, energy_level, note } =
    req.body || {};
  if (!date) return res.status(400).json({ error: '日期(date)为必填项' });
  const u = req.user.sub;
  await q(
    `INSERT INTO daily_records (user_id, date, sleep_hours, stress_level, training_load, posture_score, diet_note, energy_level, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (user_id, date) DO UPDATE SET
       sleep_hours=excluded.sleep_hours, stress_level=excluded.stress_level, training_load=excluded.training_load,
       posture_score=excluded.posture_score, diet_note=excluded.diet_note, energy_level=excluded.energy_level, note=excluded.note`,
    [u, date, num(sleep_hours), stress_level ?? null, num(training_load), num(posture_score), diet_note ?? null, int(energy_level), note ?? null]
  );
  res.json({ record: await one('SELECT * FROM daily_records WHERE user_id = $1 AND date = $2', [u, date]) });
});

// 聚合概览：最新记录 + 平均值
router.get('/summary', async (req, res) => {
  const u = req.user.sub;
  const latest = await one('SELECT * FROM daily_records WHERE user_id = $1 ORDER BY date DESC LIMIT 1', [u]);
  const avg = await one(
    'SELECT AVG(sleep_hours)::float avg_sleep, AVG(training_load)::float avg_load, AVG(posture_score)::float avg_posture, COUNT(*)::int cnt FROM daily_records WHERE user_id = $1',
    [u]
  );
  res.json({ latest, avg });
});

// 自助导出：返回本人全部健康数据（个保法「可携带权」）
router.get('/export', async (req, res) => {
  const u = req.user.sub;
  const profile = await one('SELECT * FROM profiles WHERE user_id = $1', [u]);
  const records = await q('SELECT * FROM daily_records WHERE user_id = $1 ORDER BY date DESC', [u]);
  const wearable = await q('SELECT * FROM wearable WHERE user_id = $1 ORDER BY date DESC', [u]);
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

const WEARABLE_UPSERT = `
  INSERT INTO wearable (user_id, date, source, device, resting_hr, avg_hr, max_hr, steps, sleep_hours, spo2, hrv, active_energy, note)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
  ON CONFLICT (user_id, date, source) DO UPDATE SET
    device=excluded.device, resting_hr=excluded.resting_hr, avg_hr=excluded.avg_hr,
    max_hr=excluded.max_hr, steps=excluded.steps, sleep_hours=excluded.sleep_hours,
    spo2=excluded.spo2, hrv=excluded.hrv, active_energy=excluded.active_energy, note=excluded.note`;

// 读取本人的可穿戴数据
router.get('/wearable', async (req, res) => {
  const rows = await q(
    'SELECT * FROM wearable WHERE user_id = $1 ORDER BY date DESC LIMIT 200',
    [req.user.sub]
  );
  res.json({ wearable: rows });
});

// 写入/更新一条或多条（upsert：同一 user+date+source 覆盖）
router.post('/wearable', async (req, res) => {
  const body = Array.isArray(req.body) ? req.body : [req.body];
  const u = req.user.sub;
  let saved = 0;
  for (const it of body) {
    if (!it || !it.date) continue;
    await q(WEARABLE_UPSERT, [
      u,
      it.date,
      it.source || 'import',
      it.device || null,
      num(it.resting_hr),
      num(it.avg_hr),
      num(it.max_hr),
      int(it.steps),
      num(it.sleep_hours),
      num(it.spo2),
      num(it.hrv),
      num(it.active_energy ?? it.active_energy_kcal),
      it.note || null,
    ]);
    saved++;
  }
  res.json({ ok: true, saved });
});

// 快捷指令同步入口：接收 { records:[{date,resting_hr,avg_hr,max_hr,steps,sleep_hours,spo2,hrv,active_energy_kcal}], workouts:[...] }
// workouts 可含 hr_samples 数组，自动推导 avg/max 心率。同一天会被合并为一条 apple_health 记录（避免覆盖）。
router.post('/sync', async (req, res) => {
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
  for (const it of items) {
    await q(WEARABLE_UPSERT, [
      u,
      it.date,
      it.source,
      it.device,
      num(it.resting_hr),
      num(it.avg_hr),
      num(it.max_hr),
      int(it.steps),
      num(it.sleep_hours),
      num(it.spo2),
      num(it.hrv),
      num(it.active_energy),
      it.note,
    ]);
  }
  res.json({ ok: true, saved: items.length });
});

// 自助删除：清除本人全部健康数据（保留账号；个保法「删除权」）
router.delete('/data', async (req, res) => {
  const u = req.user.sub;
  await q('DELETE FROM daily_records WHERE user_id = $1', [u]);
  await q('DELETE FROM profiles WHERE user_id = $1', [u]);
  res.json({ ok: true, deleted_records: true, deleted_profile: true });
});

// ── 饮食记录（当日 meals）──
// 前端 healthStore.getMeals/saveMeals 调用；云端按 user+date 存储每日饮食数组。
router.get('/meals', async (req, res) => {
  const date = (req.query.date || new Date().toISOString().slice(0, 10)).toString();
  const row = await one('SELECT meals FROM meals WHERE user_id = $1 AND date = $2', [req.user.sub, date]);
  res.json({ meals: Array.isArray(row?.meals) ? row.meals : [] });
});

router.post('/meals', async (req, res) => {
  const { date, meals } = req.body || {};
  if (!date) return res.status(400).json({ error: '日期(date)为必填项' });
  const arr = Array.isArray(meals) ? meals : [];
  await q(
    `INSERT INTO meals (user_id, date, meals) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, date) DO UPDATE SET meals = excluded.meals`,
    [req.user.sub, date, JSON.stringify(arr)]
  );
  res.json({ meals: arr });
});

/* ───────────────────────── AI 周报点评（insight）─────────────────────────
 * 聚合本人近 30 天数据，优先调用 LLM 生成结构化点评；
 * 未配置 API key 时降级为规则引擎，保证离线/本地也能给出可执行建议。 */
async function gatherForInsight(u) {
  const profile = await one('SELECT * FROM profiles WHERE user_id = $1', [u]);
  const records = await q(
    'SELECT * FROM daily_records WHERE user_id = $1 ORDER BY date DESC LIMIT 30',
    [u]
  );
  const wearable = await q(
    'SELECT * FROM wearable WHERE user_id = $1 ORDER BY date DESC LIMIT 60',
    [u]
  );
  const mealsRows = await q(
    'SELECT date, meals FROM meals WHERE user_id = $1 ORDER BY date DESC LIMIT 30',
    [u]
  );
  return { profile, records, wearable, mealsRows };
}

function ruleInsight({ records, wearable, mealsRows }) {
  const sleeps = records.map((r) => r.sleep_hours).filter(Boolean);
  const avgSleep = sleeps.length ? sleeps.reduce((a, b) => a + b, 0) / sleeps.length : null;
  const steps = wearable.map((w) => w.steps).filter(Boolean);
  const avgSteps = steps.length ? steps.reduce((a, b) => a + b, 0) / steps.length : null;
  const trainDays = records.filter((r) => r.training_load && r.training_load > 0).length;
  const energies = records.map((r) => r.energy_level).filter(Boolean);
  const avgEnergy = energies.length ? energies.reduce((a, b) => a + b, 0) / energies.length : null;

  let totalKcal = 0;
  let mealDays = 0;
  for (const m of mealsRows) {
    const arr = Array.isArray(m.meals) ? m.meals : [];
    if (arr.length) {
      mealDays++;
      totalKcal += arr.reduce((s, x) => s + (x.calories || 0), 0);
    }
  }
  const avgKcal = mealDays ? Math.round(totalKcal / mealDays) : null;

  const findings = [];
  const suggestions = [];

  if (avgSleep != null) {
    if (avgSleep < 7) {
      findings.push(`近 ${sleeps.length} 天平均睡眠仅 ${avgSleep.toFixed(1)} 小时，低于 7 小时推荐线`);
      suggestions.push('尽量 23 点前入睡，睡前 1 小时减少屏幕蓝光，目标 7–8 小时。');
    } else {
      findings.push(`睡眠达标：平均 ${avgSleep.toFixed(1)} 小时/天。`);
    }
  }
  if (avgSteps != null) {
    if (avgSteps < 8000) {
      findings.push(`平均日行 ${Math.round(avgSteps)} 步，未达 8000 步健康线`);
      suggestions.push('每天多走 2000–3000 步：地铁提前一站下车、饭后散步即可补足。');
    } else {
      findings.push(`活动量良好：平均 ${Math.round(avgSteps)} 步/天。`);
    }
  }
  if (trainDays > 0) {
    findings.push(`近 30 天有 ${trainDays} 天记录了训练。`);
    if (trainDays < 3) suggestions.push('训练频率偏低，建议每周至少 3 次、每次 30 分钟以上有氧或抗阻。');
  } else {
    suggestions.push('本周未见训练记录，建议从快走或自重训练起步，循序渐进。');
  }
  if (avgKcal != null) findings.push(`记录饮食日均约 ${avgKcal} kcal。`);
  if (avgEnergy != null && avgEnergy < 3)
    suggestions.push('整体精力偏低，关注睡眠质量与蛋白质摄入（每餐约 0.4 g/kg）。');
  if (!findings.length) findings.push('近 30 天数据较少，多记录几天后点评会更精准。');

  const summary = `基于近 30 天（睡眠 ${sleeps.length} 天、可穿戴 ${wearable.length} 天、饮食 ${mealDays} 天）的记录生成。`;
  return { summary, findings, suggestions, generated_by: 'rule-engine' };
}

async function llmInsight(data) {
  const key = process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY;
  if (!key) return null;
  const isGroq = !!process.env.GROQ_API_KEY;
  const url = isGroq
    ? 'https://api.groq.com/openai/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
  const model = isGroq
    ? process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
    : process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const payload = {
    model,
    messages: [
      {
        role: 'system',
        content:
          '你是专业运动健康教练。基于用户近 30 天健康数据，输出严格 JSON：{summary:string, findings:[string], suggestions:[string]}，全部中文，每条简洁可执行（不超过 40 字）。',
      },
      {
        role: 'user',
        content: '数据：' + JSON.stringify(data).slice(0, 4000),
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.5,
  };
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) return null;
    const j = await resp.json();
    const txt = j.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(txt);
    return {
      summary: parsed.summary || '',
      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      generated_by: isGroq ? 'groq' : 'openai',
    };
  } catch {
    return null;
  }
}

router.get('/insight', async (req, res) => {
  try {
    const data = await gatherForInsight(req.user.sub);
    const llm = await llmInsight(data);
    const result = llm || ruleInsight(data);
    res.json({ insight: result });
  } catch (err) {
    console.error('[insight]', err);
    res.status(500).json({ error: '生成点评失败' });
  }
});

export default router;
