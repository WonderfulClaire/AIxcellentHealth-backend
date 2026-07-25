// src/dailyPush.js
// 把推送引擎接入数据库与邮件：站内卡片（按需生成、幂等去重）+ 邮件批量推送（可选 SMTP）。
import db from './db.js';
import {
  TIPS,
  toArr,
  segmentFromAge,
  ageFromBirthYear,
  pickTipForUser,
} from './dailyPushEngine.js';

const todayStr = () => new Date().toISOString().slice(0, 10);

function tipById(id) {
  return TIPS.find((t) => t.id === id) || null;
}

/** 构建用户上下文（画像 + 近 7 天记录用于习惯触发） */
export function buildUserContext(userId, profile, recentRecords = []) {
  const age = ageFromBirthYear(profile?.birth_year ?? null);
  const segment = segmentFromAge(age);
  const goals = toArr(profile?.goals);
  const restrictions = toArr(profile?.restrictions);
  const recent = recentRecords && recentRecords.length ? recentRecords[0] : null;
  return { userId, date: todayStr(), segment, goals, restrictions, recent, age };
}

/** 取近 7 天已推过的 tip id（用于去重，避免短期内重复） */
function recentTipIds(userId, channel = 'inapp', days = 7) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const rows = db
    .prepare('SELECT tip_id FROM daily_pushes WHERE user_id = ? AND channel = ? AND date >= ?')
    .all(userId, channel, since);
  return new Set(rows.map((r) => r.tip_id));
}

/** 把 daily_pushes 行解析成前端可用的 tip 对象（合并内容库元数据） */
function resolvePushRow(row) {
  const meta = tipById(row.tip_id) || {};
  return {
    id: row.tip_id,
    title: row.title || meta.title || '',
    body: row.body || meta.body || '',
    emoji: meta.emoji || '🌿',
    source: meta.source || '',
    segment: meta.segment || 'all',
    channel: row.channel,
    date: row.date,
    pushId: row.id,
  };
}

/**
 * 获取当前用户的"今日健康小推送"（站内卡片）。
 * 已生成过则直接返回，否则计算并落库（幂等）。无画像时退化为通用段。
 */
export function getTodayTip(userId) {
  const today = todayStr();
  const existing = db
    .prepare('SELECT * FROM daily_pushes WHERE user_id = ? AND date = ? AND channel = ?')
    .get(userId, today, 'inapp');
  if (existing) return resolvePushRow(existing);

  const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId);
  const records = db
    .prepare('SELECT * FROM daily_records WHERE user_id = ? ORDER BY date DESC LIMIT 7')
    .all(userId);
  const ctx = buildUserContext(userId, profile, records);
  const exclude = recentTipIds(userId, 'inapp', 7);
  const tip = pickTipForUser(ctx, exclude) || TIPS.find((t) => t.segment === 'all') || TIPS[0];

  db.prepare(
    `INSERT OR IGNORE INTO daily_pushes (user_id, date, tip_id, channel, title, body)
     VALUES (?, ?, ?, 'inapp', ?, ?)`
  ).run(userId, today, tip.id, tip.title, tip.body);

  return { ...tip, channel: 'inapp', date: today, pushId: null };
}

/* ───────────── 邮件推送（可选）───────────── */

// 动态加载 nodemailer：未安装 / 未配置 SMTP 时优雅跳过，不影响站内卡片。
let _transporter = null;
let _smtpChecked = false;
async function getTransporter() {
  if (_smtpChecked) return _transporter;
  _smtpChecked = true;
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  try {
    const nodemailer = (await import('nodemailer')).default;
    _transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 465),
      secure: String(process.env.SMTP_SECURE ?? 'true') !== 'false',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  } catch {
    _transporter = null;
  }
  return _transporter;
}

function buildEmailHtml(user, tip) {
  const name = user.name ? `${user.name}，` : '';
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;color:#1f2937">
    <div style="font-size:34px">${tip.emoji}</div>
    <h2 style="margin:8px 0 4px">${name}今日健康小推送</h2>
    <p style="color:#6b7280;margin:0 0 16px;font-size:13px">AIxcellent 私享管家 · ${tip.date}</p>
    <h3 style="margin:0 0 8px">${tip.title}</h3>
    <p style="line-height:1.7;font-size:15px">${tip.body}</p>
    ${tip.source ? `<p style="color:#9ca3af;font-size:12px;border-top:1px solid #eee;padding-top:10px;margin-top:16px">来源：${tip.source}</p>` : ''}
    <p style="color:#9ca3af;font-size:12px;margin-top:8px">你在 AIxcellent 的推送偏好可随时在账户设置中调整。</p>
  </div>`;
}

async function sendEmailTip(user, tip) {
  const t = await getTransporter();
  if (!t) return false;
  const fromName = process.env.PUSH_FROM_NAME || 'AIxcellent 私享管家';
  try {
    await t.sendMail({
      from: `"${fromName}" <${process.env.SMTP_USER || user.email}>`,
      to: user.email,
      subject: `${tip.emoji} 今日健康小推送：${tip.title}`,
      html: buildEmailHtml(user, tip),
    });
    return true;
  } catch (err) {
    console.warn('[dailyPush] 邮件发送失败:', err?.message || err);
    return false;
  }
}

/**
 * 管理员触发：给所有活跃用户计算并（在配置 SMTP 时）邮件推送今日 tip。
 * 幂等：同一用户同一天同一渠道只推一次。返回统计。
 */
export async function runDailyPush() {
  const today = todayStr();
  const users = db
    .prepare("SELECT id, email, name FROM users WHERE status = 'active' AND email IS NOT NULL AND email != ''")
    .all();
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const smtpEnabled = !!(await getTransporter());

  for (const u of users) {
    const existing = db
      .prepare('SELECT id FROM daily_pushes WHERE user_id = ? AND date = ? AND channel = ?')
      .get(u.id, today, 'email');
    if (existing) {
      skipped++;
      continue;
    }
    const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(u.id);
    const records = db
      .prepare('SELECT * FROM daily_records WHERE user_id = ? ORDER BY date DESC LIMIT 7')
      .all(u.id);
    const ctx = buildUserContext(u.id, profile, records);
    const exclude = new Set([
      ...recentTipIds(u.id, 'inapp', 7),
      ...recentTipIds(u.id, 'email', 7),
    ]);
    const tip =
      pickTipForUser(ctx, exclude) || TIPS.find((t) => t.segment === 'all') || TIPS[0];

    // 先落库（幂等），再尝试发送
    db.prepare(
      `INSERT OR IGNORE INTO daily_pushes (user_id, date, tip_id, channel, title, body)
       VALUES (?, ?, ?, 'email', ?, ?)`
    ).run(u.id, today, tip.id, tip.title, tip.body);

    if (!smtpEnabled) {
      skipped++; // 未配置 SMTP：记录意图但不发送
      continue;
    }
    const ok = await sendEmailTip(u, tip);
    if (ok) sent++;
    else failed++;
  }

  return { total: users.length, sent, skipped, failed, smtpEnabled, date: today };
}
