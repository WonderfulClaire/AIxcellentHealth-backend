-- AIxcellent 私享管家 · 数据库结构（Postgres 兼容参考版）
-- SQLite 由 src/db.js 自动建表；若上生产换托管 Postgres，可据此翻译。
-- 字段命名与类型尽量贴近标准 SQL，便于迁移。

-- 用户账户
CREATE TABLE users (
  id           SERIAL PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name         TEXT,
  role         TEXT NOT NULL DEFAULT 'user',   -- 'user' | 'admin'
  status       TEXT NOT NULL DEFAULT 'active', -- 'active' | 'disabled'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 健康档案（建档：身体、作息、目标与限制）
CREATE TABLE profiles (
  user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  height       NUMERIC,
  weight       NUMERIC,
  birth_year   INTEGER,
  sex          TEXT,
  goals        JSONB,        -- 目标数组，如 ["减脂","改善体态"]
  restrictions JSONB,        -- 限制/禁忌，如 ["膝盖不适","麸质过敏"]
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 每日记录（陪伴：每日调整、预警）
CREATE TABLE daily_records (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  sleep_hours   NUMERIC,
  stress_level  TEXT,        -- 'low' | 'mid' | 'high'
  training_load NUMERIC,
  posture_score NUMERIC,
  diet_note     TEXT,
  energy_level  INTEGER,     -- 1-5
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

CREATE INDEX idx_records_user_date ON daily_records (user_id, date DESC);
CREATE INDEX idx_users_email ON users (email);
