// 数据层：Neon Postgres（HTTP serverless 驱动，适配 Vercel 等无服务器环境）。
// 由 better-sqlite3 迁移而来：所有查询改为异步；表结构见 schema.sql。
import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error('缺少环境变量 DATABASE_URL（Neon Postgres 连接串）');
}

const sql = neon(process.env.DATABASE_URL);

/** 参数化查询（$1..$n），返回行数组 */
export async function q(text, params = []) {
  return sql.query(text, params);
}

/** 参数化查询，返回第一行或 null */
export async function one(text, params = []) {
  const rows = await sql.query(text, params);
  return rows[0] ?? null;
}

// ── 建表 + 默认管理员（幂等；serverless 冷启动时执行一次）──
const DDL = [
  `CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name          TEXT,
    role          TEXT NOT NULL DEFAULT 'user',
    status        TEXT NOT NULL DEFAULT 'active',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS profiles (
    user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    height       NUMERIC,
    weight       NUMERIC,
    birth_year   INTEGER,
    sex          TEXT,
    goals        TEXT,
    restrictions TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  // date 沿用 SQLite 时代的 'YYYY-MM-DD' 文本语义，避免时区/序列化差异影响前端
  `CREATE TABLE IF NOT EXISTS daily_records (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date          TEXT NOT NULL,
    sleep_hours   NUMERIC,
    stress_level  TEXT,
    training_load NUMERIC,
    posture_score NUMERIC,
    diet_note     TEXT,
    energy_level  INTEGER,
    note          TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, date)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_records_user_date ON daily_records (user_id, date DESC)`,
  `CREATE TABLE IF NOT EXISTS wearable (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date          TEXT NOT NULL,
    source        TEXT NOT NULL DEFAULT 'manual',
    device        TEXT,
    resting_hr    NUMERIC,
    avg_hr        NUMERIC,
    max_hr        NUMERIC,
    steps         INTEGER,
    sleep_hours   NUMERIC,
    spo2          NUMERIC,
    hrv           NUMERIC,
    active_energy NUMERIC,
    note          TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, date, source)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_wearable_user_date ON wearable (user_id, date DESC)`,
  `CREATE TABLE IF NOT EXISTS daily_pushes (
    id        SERIAL PRIMARY KEY,
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date      TEXT NOT NULL,
    tip_id    TEXT NOT NULL,
    channel   TEXT NOT NULL DEFAULT 'inapp',
    title     TEXT,
    body      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, date, channel)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_pushes_user_date ON daily_pushes (user_id, date DESC)`,
  `CREATE TABLE IF NOT EXISTS meals (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date        TEXT NOT NULL,
    meals       JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, date)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_meals_user_date ON meals (user_id, date DESC)`,
];

async function ensureAdmin() {
  const email = (process.env.ADMIN_EMAIL || 'admin@aixcellent.health').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'change-me';
  const existing = await one('SELECT id FROM users WHERE email = $1', [email]);
  if (!existing) {
    const hash = bcrypt.hashSync(password, 10);
    await q(
      "INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, 'admin')",
      [email, hash, '系统管理员']
    );
    console.log(`[init] 已创建默认管理员账号: ${email}`);
  }
  // 安全提示：默认/弱管理员密码必须在部署时通过环境变量覆盖
  if (password === 'change-me' || password.length < 8) {
    console.warn(
      '\n⚠️  [安全警告] 管理员密码为默认值或弱密码，请务必通过环境变量 ADMIN_PASSWORD 设置一个强密码后再对外提供服务！\n'
    );
  }
}

let _initPromise = null;

/** 初始化数据库（建表 + 默认管理员）；进程内只执行一次，可安全并发调用 */
export function initDb() {
  if (!_initPromise) {
    _initPromise = (async () => {
      for (const stmt of DDL) await q(stmt);
      await ensureAdmin();
    })().catch((err) => {
      _initPromise = null; // 失败允许下次重试
      throw err;
    });
  }
  return _initPromise;
}
