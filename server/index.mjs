/**
 * Growth Island API + realtime multiplayer
 * - Auth (register / login / JWT)
 * - Cross-device hook leaderboard
 * - WebSocket presence + connect
 * - Cloud save sync
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
const DATA = path.join(ROOT, 'data');
const PORT = Number(process.env.PORT || 8787);
const JWT_SECRET =
  process.env.JWT_SECRET || 'growth-island-dev-secret-change-me';
const TOKEN_DAYS = 30;

fs.mkdirSync(DATA, { recursive: true });

/* ---------- tiny JSON DB ---------- */
function load(name, fallback) {
  const p = path.join(DATA, name);
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    /* corrupt → reset */
  }
  return fallback;
}
function save(name, data) {
  const p = path.join(DATA, name);
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 0));
  fs.renameSync(tmp, p);
}

const db = {
  users: load('users.json', []), // { id, email, name, passHash, createdAt }
  hooks: load('hooks.json', []), // { id, userId, name, text, score, shareWorthy, day, createdAt }
  progress: load('progress.json', {}), // userId -> save blob
  connections: load('connections.json', []), // { a, b, at }
};

function persistAll() {
  save('users.json', db.users);
  save('hooks.json', db.hooks);
  save('progress.json', db.progress);
  save('connections.json', db.connections);
}

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}
function uid(prefix = 'u') {
  return prefix + '_' + crypto.randomBytes(8).toString('hex');
}

/* ---------- auth helpers ---------- */
function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: `${TOKEN_DAYS}d` }
  );
}

function authMiddleware(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.users.find((u) => u.id === payload.sub);
    if (!user) return res.status(401).json({ error: 'User not found' });
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
      const payload = jwt.verify(token, JWT_SECRET);
      const user = db.users.find((u) => u.id === payload.sub);
      if (user) req.user = { id: user.id, email: user.email, name: user.name };
    } catch {
      /* ignore */
    }
  }
  next();
}


/* ---------- rate limit (simple in-memory) ---------- */
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
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'growth-island',
    time: new Date().toISOString(),
    users: db.users.length,
    hooksToday: db.hooks.filter((h) => h.day === dayKey()).length,
    online: peers.size,
  });
});

app.post('/api/auth/register', async (req, res) => {
  if (!rateLimit('reg:' + clientIp(req), 10, 600000)) return res.status(429).json({ error: 'Too many attempts' });
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
  };
  db.users.push(user);
  persistAll();
  const token = signToken(user);
  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name },
  });
});

app.post('/api/auth/login', async (req, res) => {
  if (!rateLimit('login:' + clientIp(req), 20, 600000)) return res.status(429).json({ error: 'Too many attempts' });
  const email = String(req.body?.email || '')
    .trim()
    .toLowerCase();
  const password = String(req.body?.password || '');
  const user = db.users.find((u) => u.email === email);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  const ok = await bcrypt.compare(password, user.passHash);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
  res.json({
    token: signToken(user),
    user: { id: user.id, email: user.email, name: user.name },
  });
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

app.patch('/api/me', authMiddleware, (req, res) => {
  const user = db.users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (req.body?.name) user.name = String(req.body.name).trim().slice(0, 32);
  persistAll();
  res.json({ user: { id: user.id, email: user.email, name: user.name } });
});

/** Submit a scored hook → cross-device leaderboard */
app.post('/api/hooks', authMiddleware, (req, res) => {
  if (!rateLimit('hook:' + req.user.id, 30, 60000)) return res.status(429).json({ error: 'Slow down' });
  const text = String(req.body?.text || '').trim().slice(0, 2000);
  const score = Math.max(0, Math.min(100, Number(req.body?.score) || 0));
  const shareWorthy = !!req.body?.shareWorthy;
  if (!text) return res.status(400).json({ error: 'Hook text required' });

  const day = dayKey();
  // one best entry per user per day — upgrade if higher
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
  // prune old days (keep 14)
  const cutoff = Date.now() - 14 * 864e5;
  db.hooks = db.hooks.filter((h) => h.createdAt > cutoff);
  persistAll();

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
      // don't expose full email; text preview only for owner via separate call
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

/** Cloud save — full progress across devices */
app.put('/api/progress', authMiddleware, (req, res) => {
  const blob = req.body?.save;
  if (!blob || typeof blob !== 'object')
    return res.status(400).json({ error: 'save object required' });
  // attach identity
  blob.pid = req.user.id;
  blob.name = req.user.name;
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

/** Record mutual connection */
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

/* ---------- HTTP + WS ---------- */
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

/** @type {Map<string, { ws: import('ws').WebSocket, userId: string, name: string, x: number, y: number, dir: string, house: string, zone: string, last: number }>} */
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
        const payload = jwt.verify(String(msg.token || ''), JWT_SECRET);
        const user = db.users.find((u) => u.id === payload.sub);
        if (!user) return send(ws, { type: 'error', error: 'auth failed' });
        // drop old socket for same user
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
          user: { id: user.id, name: user.name, email: user.email },
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
      // lightweight: broadcast full list every move is fine for small N
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
        name: other?.name || db.users.find((u) => u.id === to)?.name || 'Traveller',
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
      const text = String(msg.text || '').trim().slice(0, 200);
      if (!text) return;
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

// stale peer cleanup
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

/* ---------- production: serve Vite client from dist/ ---------- */
const DIST = path.join(ROOT, 'dist');
if (fs.existsSync(DIST)) {
  app.use(
    express.static(DIST, {
      maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
      index: 'index.html',
    })
  );
  // SPA fallback — any non-API GET that didn't match a static file
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
    res.sendFile(path.join(DIST, 'index.html'), (err) => {
      if (err) next(err);
    });
  });
  console.log(`[growth-island] serving client from ${DIST}`);
}

if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'growth-island-dev-secret-change-me') {
  console.warn('[growth-island] WARNING: set JWT_SECRET in production');
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[growth-island] API + WS + client on http://0.0.0.0:${PORT}`);
  console.log(`[growth-island] WS path /ws`);
  console.log(`[growth-island] data dir ${DATA}`);
});
