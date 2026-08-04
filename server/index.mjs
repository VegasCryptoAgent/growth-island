/**
 * Growth Island API + realtime multiplayer + admin + analytics
 * Production-hardened: JWT enforcement, backups, security headers, moderation
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const IS_PROD = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT || 8787);
const DATA = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, 'data');
const BACKUP_DIR = path.join(DATA, 'backups');
const JWT_SECRET = process.env.JWT_SECRET || '';
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const TOKEN_DAYS = 30;
const APP_VERSION = process.env.APP_VERSION || '1.0.0';

// Force production JWT
if (IS_PROD) {
  if (!JWT_SECRET || JWT_SECRET.length < 24 || JWT_SECRET.includes('change-me')) {
    console.error(
      '[growth-island] FATAL: set JWT_SECRET (>=24 chars, not the default) in production'
    );
    process.exit(1);
  }
}
const SECRET = JWT_SECRET || 'growth-island-dev-secret-change-me-local-only';

fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

/* ---------- durable JSON DB + rotating backups ---------- */
function load(name, fallback) {
  const p = path.join(DATA, name);
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.warn('[db] corrupt', name, e.message);
  }
  return fallback;
}

function atomicWrite(filePath, data) {
  const tmp = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 0));
  fs.renameSync(tmp, filePath);
}

function backupSnapshot() {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(BACKUP_DIR, stamp);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of [
      'users.json',
      'hooks.json',
      'progress.json',
      'connections.json',
      'sellers.json',
      'analytics.json',
      'meta.json',
    ]) {
      const src = path.join(DATA, f);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, f));
    }
    // keep last 20 backups
    const dirs = fs
      .readdirSync(BACKUP_DIR)
      .filter((d) => fs.statSync(path.join(BACKUP_DIR, d)).isDirectory())
      .sort();
    while (dirs.length > 20) {
      const old = dirs.shift();
      fs.rmSync(path.join(BACKUP_DIR, old), { recursive: true, force: true });
    }
  } catch (e) {
    console.warn('[backup]', e.message);
  }
}

let lastBackup = 0;
function save(name, data) {
  atomicWrite(path.join(DATA, name), data);
  const now = Date.now();
  if (now - lastBackup > 5 * 60 * 1000) {
    lastBackup = now;
    backupSnapshot();
  }
}

const db = {
  users: load('users.json', []),
  hooks: load('hooks.json', []),
  progress: load('progress.json', {}),
  connections: load('connections.json', []),
  sellers: load('sellers.json', []),
  analytics: load('analytics.json', []),
  meta: load('meta.json', { invites: {}, resets: {}, banned: [], chatLog: [] }),
};

function persistAll() {
  save('users.json', db.users);
  save('hooks.json', db.hooks);
  save('progress.json', db.progress);
  save('connections.json', db.connections);
  save('sellers.json', db.sellers);
  save('analytics.json', db.analytics.slice(-5000));
  save('meta.json', db.meta);
}

// hourly backup
setInterval(backupSnapshot, 60 * 60 * 1000);
backupSnapshot();

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}
function uid(prefix = 'u') {
  return prefix + '_' + crypto.randomBytes(8).toString('hex');
}

/* ---------- moderation ---------- */
const BAD_WORDS = [
  'nigger',
  'faggot',
  'kike',
  'retard',
  'fuck you',
  'kill yourself',
  'kys',
];
function moderateText(text) {
  const t = String(text || '');
  const lower = t.toLowerCase();
  for (const w of BAD_WORDS) {
    if (lower.includes(w)) return { ok: false, reason: 'Message blocked by filter' };
  }
  if (/(https?:\/\/|www\.)/i.test(t) && t.split(/\s+/).length < 3) {
    return { ok: false, reason: 'Links alone are not allowed in chat' };
  }
  return { ok: true, text: t.slice(0, 280) };
}

/* ---------- auth ---------- */
function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name },
    SECRET,
    { expiresIn: `${TOKEN_DAYS}d` }
  );
}

function authMiddleware(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, SECRET);
    const user = db.users.find((u) => u.id === payload.sub);
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (db.meta.banned?.includes(user.id))
      return res.status(403).json({ error: 'Account banned' });
    req.user = { id: user.id, email: user.email, name: user.name };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function optionalAuth(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, SECRET);
      const user = db.users.find((u) => u.id === payload.sub);
      if (user && !db.meta.banned?.includes(user.id))
        req.user = { id: user.id, email: user.email, name: user.name };
    } catch {
      /* */
    }
  }
  next();
}

function adminMiddleware(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (!ADMIN_KEY || key !== ADMIN_KEY)
    return res.status(401).json({ error: 'Admin key required' });
  next();
}

/* ---------- rate limit ---------- */
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.t > windowMs) {
    b = { t: now, n: 0 };
    buckets.set(key, b);
  }
  b.n++;
  return b.n <= max;
}
function clientIp(req) {
  return (
    req.headers['x-forwarded-for']?.toString().split(',')[0].trim() ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

/* ---------- Express ---------- */
const app = express();
app.disable('x-powered-by');

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()'
  );
  if (IS_PROD) {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains'
    );
  }
  next();
});

// CORS
const corsOpts = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // same-origin / curl
    if (!IS_PROD) return cb(null, true);
    if (CORS_ORIGINS.length === 0) return cb(null, true); // same host reverse-proxy
    if (CORS_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('CORS blocked'));
  },
  credentials: true,
};
app.use(cors(corsOpts));
app.use(express.json({ limit: '512kb' }));

function track(event, props = {}, userId = null) {
  db.analytics.push({
    id: uid('a'),
    event,
    props,
    userId,
    t: Date.now(),
    day: dayKey(),
  });
  if (db.analytics.length > 8000) db.analytics = db.analytics.slice(-5000);
  // debounce persist analytics
  if (!track._t) {
    track._t = setTimeout(() => {
      track._t = null;
      save('analytics.json', db.analytics.slice(-5000));
    }, 2000);
  }
}

app.get('/api/health', (_req, res) => {
  let dataWritable = false;
  try {
    const probe = path.join(DATA, '.write-probe');
    fs.writeFileSync(probe, String(Date.now()));
    fs.unlinkSync(probe);
    dataWritable = true;
  } catch {
    dataWritable = false;
  }
  res.json({
    ok: true && dataWritable,
    service: 'growth-island',
    version: APP_VERSION,
    time: new Date().toISOString(),
    users: db.users.length,
    hooksToday: db.hooks.filter((h) => h.day === dayKey()).length,
    online: peers.size,
    dataDir: DATA,
    dataWritable,
    jwtConfigured: SECRET.length >= 24 && !SECRET.includes('local-only'),
    backups: fs.existsSync(BACKUP_DIR)
      ? fs.readdirSync(BACKUP_DIR).length
      : 0,
  });
});

app.post('/api/auth/register', async (req, res) => {
  if (!rateLimit('reg:' + clientIp(req), 10, 600000))
    return res.status(429).json({ error: 'Too many attempts' });
  const email = String(req.body?.email || '')
    .trim()
    .toLowerCase();
  const password = String(req.body?.password || '');
  const name = String(req.body?.name || 'Traveller').trim().slice(0, 32);
  if (!email || !email.includes('@'))
    return res.status(400).json({ error: 'Valid email required' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password min 6 characters' });
  if (db.users.some((u) => u.email === email))
    return res.status(409).json({ error: 'Email already registered' });

  const user = {
    id: uid('u'),
    email,
    name: name || 'Traveller',
    passHash: await bcrypt.hash(password, 10),
    createdAt: Date.now(),
    inviteCode: crypto.randomBytes(4).toString('hex'),
  };
  db.users.push(user);
  persistAll();
  track('register', { email: email.slice(0, 3) + '…' }, user.id);
  res.json({
    token: signToken(user),
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      inviteCode: user.inviteCode,
    },
  });
});

app.post('/api/auth/login', async (req, res) => {
  if (!rateLimit('login:' + clientIp(req), 20, 600000))
    return res.status(429).json({ error: 'Too many attempts' });
  const email = String(req.body?.email || '')
    .trim()
    .toLowerCase();
  const password = String(req.body?.password || '');
  const user = db.users.find((u) => u.email === email);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  if (db.meta.banned?.includes(user.id))
    return res.status(403).json({ error: 'Account banned' });
  const ok = await bcrypt.compare(password, user.passHash);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
  if (!user.inviteCode) {
    user.inviteCode = crypto.randomBytes(4).toString('hex');
    persistAll();
  }
  track('login', {}, user.id);
  res.json({
    token: signToken(user),
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      inviteCode: user.inviteCode,
    },
  });
});

/** Request password reset — returns token in response for now (wire email later) */
app.post('/api/auth/forgot', async (req, res) => {
  if (!rateLimit('forgot:' + clientIp(req), 5, 600000))
    return res.status(429).json({ error: 'Too many attempts' });
  const email = String(req.body?.email || '')
    .trim()
    .toLowerCase();
  const user = db.users.find((u) => u.email === email);
  // always same message
  if (!user) {
    return res.json({
      ok: true,
      message: 'If that email exists, a reset code was created.',
    });
  }
  const token = crypto.randomBytes(16).toString('hex');
  db.meta.resets = db.meta.resets || {};
  db.meta.resets[token] = {
    userId: user.id,
    exp: Date.now() + 3600e3,
  };
  persistAll();
  // Without email provider we return the token once so the product is usable.
  // In production with email, send token and omit it from the body.
  res.json({
    ok: true,
    message: 'Reset code created. Use it within 1 hour.',
    resetToken: token,
    note: 'Connect an email provider later to hide resetToken from the API response.',
  });
});

app.post('/api/auth/reset', async (req, res) => {
  if (!rateLimit('reset:' + clientIp(req), 10, 600000))
    return res.status(429).json({ error: 'Too many attempts' });
  const token = String(req.body?.token || '');
  const password = String(req.body?.password || '');
  if (password.length < 6)
    return res.status(400).json({ error: 'Password min 6 characters' });
  const row = db.meta.resets?.[token];
  if (!row || row.exp < Date.now())
    return res.status(400).json({ error: 'Invalid or expired reset code' });
  const user = db.users.find((u) => u.id === row.userId);
  if (!user) return res.status(400).json({ error: 'User missing' });
  user.passHash = await bcrypt.hash(password, 10);
  delete db.meta.resets[token];
  persistAll();
  track('password_reset', {}, user.id);
  res.json({ ok: true, token: signToken(user), user: { id: user.id, email: user.email, name: user.name } });
});

app.get('/api/me', authMiddleware, (req, res) => {
  const user = db.users.find((u) => u.id === req.user.id);
  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      inviteCode: user.inviteCode,
    },
  });
});

app.patch('/api/me', authMiddleware, (req, res) => {
  const user = db.users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (req.body?.name) user.name = String(req.body.name).trim().slice(0, 32);
  persistAll();
  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      inviteCode: user.inviteCode,
    },
  });
});

app.delete('/api/me', authMiddleware, async (req, res) => {
  const id = req.user.id;
  db.users = db.users.filter((u) => u.id !== id);
  delete db.progress[id];
  db.hooks = db.hooks.filter((h) => h.userId !== id);
  db.connections = db.connections.filter((c) => c.a !== id && c.b !== id);
  db.sellers = db.sellers.filter((s) => s.userId !== id);
  persistAll();
  track('account_delete', {}, id);
  res.json({ ok: true });
});

app.post('/api/hooks', authMiddleware, (req, res) => {
  if (!rateLimit('hook:' + req.user.id, 30, 60000))
    return res.status(429).json({ error: 'Slow down' });
  const text = String(req.body?.text || '').trim().slice(0, 2000);
  const score = Math.max(0, Math.min(100, Number(req.body?.score) || 0));
  const shareWorthy = !!req.body?.shareWorthy;
  const mod = moderateText(text);
  if (!mod.ok) return res.status(400).json({ error: mod.reason });
  if (!text) return res.status(400).json({ error: 'Hook text required' });

  const day = dayKey();
  const existing = db.hooks.find(
    (h) => h.userId === req.user.id && h.day === day
  );
  if (existing) {
    if (score >= existing.score) {
      existing.text = text;
      existing.score = score;
      existing.shareWorthy = shareWorthy;
      existing.createdAt = Date.now();
      existing.name = req.user.name;
    }
  } else {
    db.hooks.push({
      id: uid('h'),
      userId: req.user.id,
      name: req.user.name,
      text,
      score,
      shareWorthy,
      day,
      createdAt: Date.now(),
    });
  }
  const cutoff = Date.now() - 14 * 864e5;
  db.hooks = db.hooks.filter((h) => h.createdAt > cutoff);
  persistAll();
  track('hook_capture', { score }, req.user.id);

  const board = boardForDay(day);
  const rank = board.findIndex((r) => r.userId === req.user.id) + 1;
  const top5 =
    rank > 0 && rank <= Math.max(1, Math.ceil(board.length * 0.05));

  res.json({
    ok: true,
    score,
    rank,
    total: board.length,
    top5,
    board: board.slice(0, 25),
  });
});

function boardForDay(day) {
  return db.hooks
    .filter((h) => h.day === day)
    .sort((a, b) => b.score - a.score || a.createdAt - b.createdAt)
    .map((h, i) => ({
      rank: i + 1,
      userId: h.userId,
      name: h.name,
      score: h.score,
      shareWorthy: h.shareWorthy,
      preview: h.text.slice(0, 80) + (h.text.length > 80 ? '…' : ''),
    }));
}

app.get('/api/leaderboard', optionalAuth, (req, res) => {
  const day = String(req.query.day || dayKey());
  const board = boardForDay(day);
  let me = null;
  if (req.user) {
    const idx = board.findIndex((r) => r.userId === req.user.id);
    if (idx >= 0) me = { ...board[idx], rank: idx + 1 };
  }
  res.json({
    day,
    total: board.length,
    board: board.slice(0, 50),
    me,
    top5Cutoff: Math.max(1, Math.ceil(board.length * 0.05)),
  });
});

app.put('/api/progress', authMiddleware, (req, res) => {
  const blob = req.body?.save;
  if (!blob || typeof blob !== 'object')
    return res.status(400).json({ error: 'save object required' });
  blob.pid = req.user.id;
  blob.name = req.user.name;
  const prev = db.progress[req.user.id];
  // conflict: reject if client is older than server by >2s and client forces no override
  if (
    prev &&
    req.body?.clientUpdatedAt &&
    prev.updatedAt > Number(req.body.clientUpdatedAt) + 2000 &&
    !req.body?.force
  ) {
    return res.status(409).json({
      error: 'Cloud save is newer',
      serverUpdatedAt: prev.updatedAt,
      save: prev.save,
    });
  }
  db.progress[req.user.id] = {
    save: blob,
    updatedAt: Date.now(),
  };
  persistAll();
  res.json({ ok: true, updatedAt: db.progress[req.user.id].updatedAt });
});

app.get('/api/progress', authMiddleware, (req, res) => {
  const row = db.progress[req.user.id];
  if (!row) return res.json({ save: null });
  res.json({ save: row.save, updatedAt: row.updatedAt });
});

app.post('/api/connections', authMiddleware, (req, res) => {
  const to = String(req.body?.to || '');
  if (!to || to === req.user.id)
    return res.status(400).json({ error: 'Invalid target' });
  const a = [req.user.id, to].sort();
  const exists = db.connections.some((c) => c.a === a[0] && c.b === a[1]);
  if (!exists) {
    db.connections.push({ a: a[0], b: a[1], at: Date.now() });
    persistAll();
  }
  track('connect', { to }, req.user.id);
  res.json({ ok: true, mutual: true });
});

app.get('/api/connections', authMiddleware, (req, res) => {
  const mine = db.connections
    .filter((c) => c.a === req.user.id || c.b === req.user.id)
    .map((c) => (c.a === req.user.id ? c.b : c.a));
  const people = mine.map((id) => {
    const u = db.users.find((x) => x.id === id);
    const peer = peers.get(id);
    return {
      id,
      name: u?.name || peer?.name || 'Traveller',
      online: !!peer,
    };
  });
  res.json({ connections: people });
});

/** Seller submissions */
app.post('/api/sellers', authMiddleware, (req, res) => {
  if (!rateLimit('sell:' + req.user.id, 5, 3600000))
    return res.status(429).json({ error: 'Too many submissions' });
  const title = String(req.body?.title || '').trim().slice(0, 80);
  const price = String(req.body?.price || '').trim().slice(0, 20);
  const email = String(req.body?.email || '').trim().slice(0, 120);
  if (!title || !price || !email.includes('@'))
    return res.status(400).json({ error: 'Title, price, and email required' });
  const mod = moderateText(title);
  if (!mod.ok) return res.status(400).json({ error: mod.reason });
  const row = {
    id: uid('s'),
    userId: req.user.id,
    userName: req.user.name,
    title,
    price,
    email,
    status: 'pending',
    createdAt: Date.now(),
  };
  db.sellers.push(row);
  persistAll();
  track('seller_submit', { title }, req.user.id);
  res.json({ ok: true, id: row.id, status: 'pending' });
});

app.get('/api/sellers/mine', authMiddleware, (req, res) => {
  res.json({
    items: db.sellers
      .filter((s) => s.userId === req.user.id)
      .slice(-20)
      .reverse(),
  });
});

/** Analytics events from client */
app.post('/api/analytics', optionalAuth, (req, res) => {
  if (!rateLimit('an:' + clientIp(req), 120, 60000))
    return res.status(429).json({ error: 'Slow down' });
  const event = String(req.body?.event || '').slice(0, 64);
  if (!event) return res.status(400).json({ error: 'event required' });
  track(event, req.body?.props || {}, req.user?.id || null);
  res.json({ ok: true });
});

/** Invite — claim invite code for retention/friends */
app.post('/api/invite/claim', authMiddleware, (req, res) => {
  const code = String(req.body?.code || '')
    .trim()
    .toLowerCase();
  const inviter = db.users.find(
    (u) => (u.inviteCode || '').toLowerCase() === code
  );
  if (!inviter || inviter.id === req.user.id)
    return res.status(400).json({ error: 'Invalid invite code' });
  db.meta.invites = db.meta.invites || {};
  const key = req.user.id;
  if (db.meta.invites[key])
    return res.json({ ok: true, already: true, inviter: inviter.name });
  db.meta.invites[key] = { by: inviter.id, at: Date.now() };
  // mutual connection
  const a = [req.user.id, inviter.id].sort();
  if (!db.connections.some((c) => c.a === a[0] && c.b === a[1])) {
    db.connections.push({ a: a[0], b: a[1], at: Date.now() });
  }
  persistAll();
  track('invite_claim', { inviter: inviter.id }, req.user.id);
  res.json({ ok: true, inviter: inviter.name, reward: 'connection' });
});

/* ---------- Admin ---------- */
app.get('/api/admin/overview', adminMiddleware, (_req, res) => {
  const day = dayKey();
  res.json({
    users: db.users.length,
    online: peers.size,
    hooksToday: db.hooks.filter((h) => h.day === day).length,
    sellersPending: db.sellers.filter((s) => s.status === 'pending').length,
    analyticsToday: db.analytics.filter((a) => a.day === day).length,
    banned: db.meta.banned?.length || 0,
    backups: fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).length : 0,
  });
});

app.get('/api/admin/users', adminMiddleware, (_req, res) => {
  res.json({
    users: db.users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      createdAt: u.createdAt,
      banned: db.meta.banned?.includes(u.id),
      inviteCode: u.inviteCode,
    })),
  });
});

app.get('/api/admin/sellers', adminMiddleware, (_req, res) => {
  res.json({ sellers: db.sellers.slice().reverse().slice(0, 100) });
});

app.post('/api/admin/sellers/:id', adminMiddleware, (req, res) => {
  const s = db.sellers.find((x) => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const status = String(req.body?.status || '');
  if (!['pending', 'approved', 'rejected'].includes(status))
    return res.status(400).json({ error: 'bad status' });
  s.status = status;
  s.reviewedAt = Date.now();
  persistAll();
  res.json({ ok: true, seller: s });
});

app.post('/api/admin/ban', adminMiddleware, (req, res) => {
  const id = String(req.body?.userId || '');
  if (!id) return res.status(400).json({ error: 'userId required' });
  db.meta.banned = db.meta.banned || [];
  if (!db.meta.banned.includes(id)) db.meta.banned.push(id);
  const peer = peers.get(id);
  if (peer) {
    try {
      peer.ws.close();
    } catch {
      /* */
    }
    peers.delete(id);
  }
  persistAll();
  res.json({ ok: true });
});

app.post('/api/admin/unban', adminMiddleware, (req, res) => {
  const id = String(req.body?.userId || '');
  db.meta.banned = (db.meta.banned || []).filter((x) => x !== id);
  persistAll();
  res.json({ ok: true });
});

app.get('/api/admin/analytics', adminMiddleware, (req, res) => {
  const day = String(req.query.day || dayKey());
  const rows = db.analytics.filter((a) => a.day === day);
  const counts = {};
  for (const r of rows) counts[r.event] = (counts[r.event] || 0) + 1;
  res.json({ day, total: rows.length, counts, recent: rows.slice(-50).reverse() });
});

app.post('/api/admin/backup', adminMiddleware, (_req, res) => {
  backupSnapshot();
  res.json({ ok: true, backups: fs.readdirSync(BACKUP_DIR).length });
});

app.get('/api/admin/chat', adminMiddleware, (_req, res) => {
  res.json({ chat: (db.meta.chatLog || []).slice(-200).reverse() });
});

/* ---------- HTTP + WS ---------- */
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

/** @type {Map<string, any>} */
const peers = new Map();

function publicPeer(p) {
  return {
    id: p.userId,
    name: p.name,
    x: p.x,
    y: p.y,
    dir: p.dir,
    house: p.house,
    zone: p.zone,
  };
}

function broadcastPeers() {
  const list = [...peers.values()].map(publicPeer);
  const msg = JSON.stringify({ type: 'peers', peers: list, t: Date.now() });
  for (const p of peers.values()) {
    if (p.ws.readyState === 1) p.ws.send(msg);
  }
}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

wss.on('connection', (ws) => {
  let userId = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return send(ws, { type: 'error', error: 'bad json' });
    }

    if (msg.type === 'auth') {
      try {
        const payload = jwt.verify(String(msg.token || ''), SECRET);
        const user = db.users.find((u) => u.id === payload.sub);
        if (!user) return send(ws, { type: 'error', error: 'auth failed' });
        if (db.meta.banned?.includes(user.id))
          return send(ws, { type: 'error', error: 'banned' });
        const old = peers.get(user.id);
        if (old && old.ws !== ws) {
          try {
            old.ws.close();
          } catch {
            /* */
          }
        }
        userId = user.id;
        peers.set(userId, {
          ws,
          userId,
          name: user.name,
          x: Number(msg.x) || 52 * 32,
          y: Number(msg.y) || 38 * 32,
          dir: msg.dir || 'down',
          house: msg.house || '',
          zone: msg.zone || 'plaza',
          last: Date.now(),
        });
        send(ws, {
          type: 'authed',
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            inviteCode: user.inviteCode,
          },
        });
        broadcastPeers();
      } catch {
        send(ws, { type: 'error', error: 'auth failed' });
      }
      return;
    }

    if (!userId || !peers.has(userId)) {
      return send(ws, { type: 'error', error: 'authenticate first' });
    }
    const me = peers.get(userId);

    if (msg.type === 'move') {
      me.x = Number(msg.x) || me.x;
      me.y = Number(msg.y) || me.y;
      me.dir = msg.dir || me.dir;
      me.zone = msg.zone || me.zone;
      me.last = Date.now();
      broadcastPeers();
      return;
    }

    if (msg.type === 'hello') {
      if (msg.name) me.name = String(msg.name).slice(0, 32);
      if (msg.house) me.house = String(msg.house);
      me.last = Date.now();
      broadcastPeers();
      return;
    }

    if (msg.type === 'connect') {
      const to = String(msg.to || '');
      if (!to || to === userId)
        return send(ws, { type: 'error', error: 'bad target' });
      const other = peers.get(to);
      const a = [userId, to].sort();
      const exists = db.connections.some((c) => c.a === a[0] && c.b === a[1]);
      if (!exists) {
        db.connections.push({ a: a[0], b: a[1], at: Date.now() });
        persistAll();
      }
      send(ws, {
        type: 'connected',
        with: to,
        name:
          other?.name ||
          db.users.find((u) => u.id === to)?.name ||
          'Traveller',
      });
      if (other?.ws?.readyState === 1) {
        send(other.ws, {
          type: 'connected',
          with: userId,
          name: me.name,
        });
      }
      return;
    }

    if (msg.type === 'chat') {
      if (!rateLimit('chat:' + userId, 20, 60000))
        return send(ws, { type: 'error', error: 'Chat rate limited' });
      const mod = moderateText(msg.text);
      if (!mod.ok) return send(ws, { type: 'error', error: mod.reason });
      const text = mod.text;
      if (!text) return;
      db.meta.chatLog = db.meta.chatLog || [];
      db.meta.chatLog.push({
        from: userId,
        name: me.name,
        text,
        t: Date.now(),
      });
      if (db.meta.chatLog.length > 500)
        db.meta.chatLog = db.meta.chatLog.slice(-400);
      const payload = JSON.stringify({
        type: 'chat',
        from: userId,
        name: me.name,
        text,
        t: Date.now(),
      });
      for (const p of peers.values()) {
        if (p.ws.readyState === 1) p.ws.send(payload);
      }
      return;
    }

    if (msg.type === 'ping') {
      me.last = Date.now();
      return send(ws, { type: 'pong', t: Date.now() });
    }
  });

  ws.on('close', () => {
    if (userId && peers.get(userId)?.ws === ws) {
      peers.delete(userId);
      broadcastPeers();
    }
  });
});

setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [id, p] of peers) {
    if (now - p.last > 60000) {
      try {
        p.ws.close();
      } catch {
        /* */
      }
      peers.delete(id);
      changed = true;
    }
  }
  if (changed) broadcastPeers();
}, 15000);

/* ---------- static client ---------- */
const DIST = path.join(ROOT, 'dist');
if (fs.existsSync(DIST)) {
  app.use(
    express.static(DIST, {
      index: false,
      setHeaders(res, filePath) {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
        } else if (/\.(js|css|png|jpg|jpeg|webp|svg|woff2?|webmanifest)$/i.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=300');
        }
      },
    })
  );
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.sendFile(path.join(DIST, 'index.html'), (err) => {
      if (err) next(err);
    });
  });
  console.log(`[growth-island] serving client from ${DIST}`);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[growth-island] API + WS + client on http://0.0.0.0:${PORT}`);
  console.log(`[growth-island] data dir ${DATA}`);
  console.log(`[growth-island] prod=${IS_PROD} jwtOk=${SECRET.length >= 24}`);
});
