// tests/smoke.mjs
// 端到端冒烟测试：真实 SQLite + 三种画像，验证 getTodayTip / runDailyPush。
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// 用临时库，避免污染
process.env.DB_PATH = path.join(os.tmpdir(), `aixcellent-smoke-${Date.now()}.db`);
process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ADMIN_PASSWORD = 'test-password-123';

const db = (await import('../src/db.js')).default;
const { getTodayTip, runDailyPush } = await import('../src/dailyPush.js');

function addUser(email, name, profile, record) {
  const { lastInsertRowid: uid } = db
    .prepare("INSERT INTO users (email, password_hash, name) VALUES (?, 'x', ?)")
    .run(email, name);
  if (profile) {
    db.prepare(
      `INSERT INTO profiles (user_id, birth_year, sex, goals, restrictions)
       VALUES (?,?,?,?,?)`
    ).run(
      uid,
      profile.birth_year ?? null,
      profile.sex ?? null,
      profile.goals ? JSON.stringify(profile.goals) : null,
      profile.restrictions ? JSON.stringify(profile.restrictions) : null
    );
  }
  if (record) {
    db.prepare(
      `INSERT INTO daily_records (user_id, date, sleep_hours, stress_level, energy_level)
       VALUES (?, date('now'), ?, ?, ?)`
    ).run(uid, record.sleep_hours ?? null, record.stress_level ?? null, record.energy_level ?? null);
  }
  return uid;
}

let passed = 0;
const ok = (n, c) => {
  assert.ok(c, n);
  console.log('  ✓', n);
  passed++;
};

console.log('— 三种画像端到端 —');
const elder = addUser('elder@t.local', '王阿姨', { birth_year: 1958, goals: ['增肌', '长寿'] });
const young = addUser('young@t.local', '小李', { birth_year: 2001, goals: ['提升精力'] }, { energy_level: 2, sleep_hours: 5 });
const mid = addUser('mid@t.local', '老张', { birth_year: 1985, restrictions: ['高血压'] }, { stress_level: 'high' });

const tElder = getTodayTip(elder);
ok('老年画像 → 老年段推送', tElder.segment === 'elderly');
ok('老年推送含肌肉/抗阻研究主题', /肌肉|抗阻|力量|蛋白/.test(tElder.title + tElder.body));

const tYoung = getTodayTip(young);
ok('青年画像 → 青年段推送', tYoung.segment === 'young');
ok('青年低精力 → 推送与休息/精力相关', /精力|休息|睡眠|咖啡|久坐|屏幕/.test(tYoung.title + tYoung.body));

const tMid = getTodayTip(mid);
ok('中年高血压 → 不推 HIIT', tMid.id !== 'mid-hiit');

console.log('— 幂等：同一天二次调用返回同一 tip —');
const again = getTodayTip(elder);
ok('两次结果一致', again.id === tElder.id && again.pushId !== null);

console.log('— runDailyPush（无 SMTP 应为记录意图、不发信）—');
const r = await runDailyPush();
ok('smtpEnabled=false', r.smtpEnabled === false);
ok('覆盖全部活跃用户', r.total >= 4); // 3 测试用户 + 1 管理员
ok('无真正发送(sent=0)', r.sent === 0);
ok('邮件渠道已记录意图(skipped>0)', r.skipped >= 4);

console.log('— 去重：邮件渠道今日已记录，二次运行应跳过 —');
const r2 = await runDailyPush();
ok('二次运行 skipped 不减', r2.skipped >= r.skipped);

// 清理
try {
  fs.rmSync(process.env.DB_PATH);
  fs.rmSync(process.env.DB_PATH + '-wal');
  fs.rmSync(process.env.DB_PATH + '-shm');
} catch {}

console.log(`\n冒烟测试通过：${passed} 项 ✅`);
