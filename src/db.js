import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

dotenv.config();

const DB_PATH = process.env.DB_PATH || './data/aixcellent.db';
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name          TEXT,
    role          TEXT NOT NULL DEFAULT 'user',
    status        TEXT NOT NULL DEFAULT 'active',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS profiles (
    user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    height       REAL,
    weight       REAL,
    birth_year   INTEGER,
    sex          TEXT,
    goals        TEXT,
    restrictions TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS daily_records (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date          TEXT NOT NULL,
    sleep_hours   REAL,
    stress_level  TEXT,
    training_load REAL,
    posture_score REAL,
    diet_note     TEXT,
    energy_level  INTEGER,
    note          TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, date)
  );

  CREATE INDEX IF NOT EXISTS idx_records_user_date ON daily_records (user_id, date DESC);
`);

// 启动时确保默认管理员存在
function ensureAdmin() {
  const email = (process.env.ADMIN_EMAIL || 'admin@aixcellent.health').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'change-me';
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!existing) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(
      "INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, 'admin')"
    ).run(email, hash, '系统管理员');
    console.log(`[init] 已创建默认管理员账号: ${email}`);
  }
}
ensureAdmin();

export default db;
