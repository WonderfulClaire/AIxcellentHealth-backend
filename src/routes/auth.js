import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db.js';
import { JWT_SECRET } from '../middleware/auth.js';

const router = Router();
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '7d';

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, status: u.status };
}

router.post('/register', (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: '邮箱和密码为必填项' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: '密码至少 6 位' });
  }
  const normalized = String(email).toLowerCase().trim();
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(normalized)) {
    return res.status(409).json({ error: '该邮箱已注册' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare("INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, 'user')")
    .run(normalized, hash, name ? String(name).trim() : null);
  const token = jwt.sign({ sub: info.lastInsertRowid, role: 'user' }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES,
  });
  res.status(201).json({ token, user: { id: info.lastInsertRowid, email: normalized, name: name || null, role: 'user' } });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: '邮箱和密码为必填项' });
  }
  const normalized = String(email).toLowerCase().trim();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalized);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '邮箱或密码错误' });
  }
  if (user.status === 'disabled') {
    return res.status(403).json({ error: '该账号已被停用，请联系管理员' });
  }
  const token = jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES,
  });
  res.json({ token, user: publicUser(user) });
});

router.get('/me', (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: '未提供访问令牌' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    res.json({ user: publicUser(user) });
  } catch {
    return res.status(401).json({ error: '令牌无效或已过期' });
  }
});

export default router;
