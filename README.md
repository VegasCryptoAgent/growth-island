# Growth Island

**A networking game** — walk a bright island, learn Signals from coaches, play **The Feed**, solve daily puzzles, score hooks at the Signal Tower, and trade on The Exchange.

Production stack:

| Layer | Choice |
|--------|--------|
| Engine | **Phaser 3** (retained-mode sprites, cameras, arcade physics) |
| Build | **Vite 6** + TypeScript |
| Art | Extracted Champion-style sprite atlases + generated interiors / UI / backdrops |
| Save | `localStorage` + hash-chained event ledger (blockchain seam) |
| Commerce | Stripe Payment Links (env) |

## Live

- **Play:** https://growth-island-production.up.railway.app  
- **API health:** https://growth-island-production.up.railway.app/api/health  
- **GitHub:** https://github.com/VegasCryptoAgent/growth-island  

Deployed on **Railway** (Node + WebSockets + static client in one service).

## Quick start (full stack)

```bash
cd growth-island
npm install
npm run dev          # API :8787 + Vite :5173 together
```

Open **http://localhost:5173**.

| Process | Port | Role |
|---------|------|------|
| `npm run server` | **8787** | Auth, leaderboard, cloud save, WebSockets |
| Vite | **5173** | Game client (proxies `/api` + `/ws` → 8787) |

```bash
npm run build        # production client → dist/
npm run server       # API only
npm start            # API + preview dist
```

## Auth · leaderboard · multiplayer

1. **Sign in** — Pause menu → Sign in / Register (email + password, JWT).
2. **Cloud save** — progress syncs to the server; load on any device after login.
3. **Capture hooks** — Signal Tower scores locally, then **POST /api/hooks** ranks you on the **daily global board**.
4. **Realtime multiplayer** — WebSocket `/ws`; other signed-in players appear as tinted avatars with name tags. **Connect** button (or walk near + roster) records mutual connections.
5. **Island chat** — Connect panel → send a line; everyone online sees it.

### API surface

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/register` | — | Create account |
| POST | `/api/auth/login` | — | Login → JWT |
| GET | `/api/me` | ✓ | Current user |
| POST | `/api/hooks` | ✓ | Capture scored hook |
| GET | `/api/leaderboard` | optional | Daily board |
| PUT/GET | `/api/progress` | ✓ | Cloud save |
| POST/GET | `/api/connections` | ✓ | Social graph |
| WS | `/ws` | JWT on `auth` msg | Presence + chat |

Data files (gitignored): `data/users.json`, `hooks.json`, `progress.json`, `connections.json`.

## Deploy

**Client:** static host `dist/` (Vercel/Netlify/etc).

**API:** run `node server/index.mjs` on a Node host (Railway, Fly, Render, VPS). Set:

```
PORT=8787
JWT_SECRET=long-random-string
```

Point the client at the API:

```
VITE_API_BASE=https://api.yourdomain.com
VITE_WS_URL=wss://api.yourdomain.com/ws
```

Or reverse-proxy `/api` and `/ws` to the Node process and leave those empty.

### Environment (optional)

Copy `.env.example` → `.env`:

```
VITE_STRIPE_MASTERCLASS=https://buy.stripe.com/...
VITE_APP_VERSION=1.0.0
JWT_SECRET=change-me
PORT=8787
```

Never put Stripe **secret** keys in the client.

## What’s in the game

- **Overworld** — 7 zones, landmarks, field notes, Signals, coaches with branching dialogue
- **The Feed** — deck-builder teaching reader archetypes + close-while-warm
- **Daily puzzles** — Thread / Grid / Ladder (same seed for all players that day)
- **Workshops** — Profile Audit, Hook Forge, Comment Lab, Voice, CTA, Cadence, DM
- **Signal Tower** — hook scorer + daily leaderboard (local / shared storage)
- **The Exchange** — product offers + seller submission queue (20% take narrative)

## Art pipeline

Sprites live in `public/assets/`:

- Character & creature 4×4 sheets (`player`, coaches, Signals, blockers)
- `tiles`, `water`, `build`, `nature`, `items`, `props`, `readers`, …
- Generated: `generated/feed-backdrop.jpg`, `battle-backdrop.jpg`, `ui-icons.png`, `interior-props.png`

Boot scene slices atlases into frames and builds walk animations.

To add art: drop a PNG into `public/assets/`, register it in `src/game/config.ts` → `ATLASES`, load in `BootScene`.

## Project layout

```
src/
  main.ts                 # Phaser bootstrap + GameApp
  game/
    config.ts
    GameApp.ts            # dialogue, tools, feed, puzzles, market
    scenes/               # Boot, Title, Overworld
    systems/              # Save, MapGen, HookScore, Audio
    data/                 # content (zones, ents, cards, puzzles…)
    ui/                   # HUD, Feed, Puzzles
public/assets/            # sprite sheets + generated art
```

## From the single-file prototype

`growth-island-v35.html` on the Desktop was the prototype. This repo is the production path:

1. Assets extracted from base64 → real files  
2. Phaser retained-mode rendering (not canvas-math scenery)  
3. Modular TS, Vite build, deployable `dist/`  
4. Gaps closed: backdrops, UI sheet, interior props, engine structure  

## License / brand

Game content and method are proprietary to the product owner. Engine: Phaser (MIT). Do not use third-party trademarks (e.g. competitor network names) in marketing copy.
