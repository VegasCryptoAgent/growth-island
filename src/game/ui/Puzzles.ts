import { THREAD_SETS } from '../data/thread_sets';
import { LADDERS } from '../data/ladders';
import { dayKey } from '../systems/Save';
import { sfx } from '../systems/Audio';

function dseed(salt: number) {
  const d = dayKey().replace(/-/g, '');
  let x = parseInt(d, 10) ^ salt;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}
function dshuffle<T>(arr: T[], rnd: () => number) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export type PuzzleId = 'thread' | 'grid' | 'ladder';

export function openPuzzleHub(
  host: HTMLElement,
  doneToday: Record<string, { score: number }>,
  onPick: (id: PuzzleId) => void,
  onClose: () => void
) {
  const items: { id: PuzzleId; n: string; sub: string; icon: string }[] = [
    {
      id: 'thread',
      n: 'The Thread',
      sub: 'Five clues. Name what connects them.',
      icon: '🧵',
    },
    {
      id: 'grid',
      n: 'The Grid',
      sub: 'One signal per day, per pillar, none touching.',
      icon: '👑',
    },
    {
      id: 'ladder',
      n: 'The Ladder',
      sub: 'Put a real workflow back in order.',
      icon: '🪜',
    },
  ];
  host.innerHTML = `
    <div class="overlay-dim">
      <div class="card pop scroll" style="max-width:480px;width:100%;max-height:90vh;padding:20px">
        <p style="font-size:11px;letter-spacing:.3em;font-weight:900;color:#0A66C2">DAILY PUZZLES</p>
        <h2 style="margin:4px 0 8px">Same three for everyone today</h2>
        <p class="muted" style="font-weight:600;font-size:13px;margin-bottom:14px">
          Seeded off the date — fair board, one attempt each.
        </p>
        ${items
          .map((p) => {
            const d = doneToday[p.id];
            return `<button class="choice" data-p="${p.id}" ${d ? 'style="background:#E9FBEE"' : ''}>
              <span style="font-size:20px;margin-right:8px">${p.icon}</span>
              <b>${p.n}</b> ${d ? '✅' : ''}<br>
              <span class="muted" style="font-size:12px">${p.sub}</span>
              ${d ? `<div style="font-size:11px;font-weight:900;color:#0A66C2;margin-top:4px">today ${d.score}</div>` : ''}
            </button>`;
          })
          .join('')}
        <button class="btn2" id="pzClose" style="width:100%;margin-top:8px">Back to island</button>
      </div>
    </div>`;
  host.querySelectorAll('[data-p]').forEach((b) =>
    b.addEventListener('click', () => onPick((b as HTMLElement).dataset.p as PuzzleId))
  );
  host.querySelector('#pzClose')!.addEventListener('click', onClose);
}

export function openPuzzle(
  host: HTMLElement,
  id: PuzzleId,
  onDone: (score: number, detail: string) => void,
  onClose: () => void
) {
  if (id === 'thread') return playThread(host, onDone, onClose);
  if (id === 'ladder') return playLadder(host, onDone, onClose);
  return playGrid(host, onDone, onClose);
}

function shell(
  host: HTMLElement,
  title: string,
  body: string,
  onClose: () => void
) {
  host.innerHTML = `
    <div class="overlay-dim">
      <div class="card pop scroll" style="max-width:520px;width:100%;max-height:92vh;padding:18px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px">
          <h2 style="margin:0;font-size:20px">${title}</h2>
          <button class="btn2" id="pzX" style="padding:8px 12px">Close</button>
        </div>
        <div id="pzBody">${body}</div>
      </div>
    </div>`;
  host.querySelector('#pzX')!.addEventListener('click', onClose);
  return host.querySelector('#pzBody') as HTMLElement;
}

function playThread(
  host: HTMLElement,
  onDone: (s: number, d: string) => void,
  onClose: () => void
) {
  const rnd = dseed(11);
  const sets = THREAD_SETS as any[];
  const set = sets[Math.floor(rnd() * sets.length)];
  const wrong = dshuffle(
    sets.filter((s) => s.a !== set.a),
    rnd
  )
    .slice(0, 3)
    .map((s) => s.a);
  const clues = dshuffle(set.c as string[], rnd);
  const opts = dshuffle([set.a, ...wrong], rnd);
  let shown = 1;
  const worth = [100, 80, 62, 46, 32];

  const paint = () => {
    const body = shell(host, 'The Thread', '', onClose);
    body.innerHTML = `
      <div class="card2" style="padding:10px;margin-bottom:10px;font-weight:900;font-size:12px">
        Clue ${shown} of 5 · worth ${worth[shown - 1]} if you get it now
      </div>
      ${clues
        .slice(0, shown)
        .map(
          (c, i) =>
            `<div class="card" style="padding:12px;margin-bottom:8px">
              <div class="muted" style="font-size:10px;font-weight:900">CLUE ${i + 1}</div>
              <div style="font-weight:900">${c}</div>
            </div>`
        )
        .join('')}
      <p style="font-weight:900;margin:12px 0 8px">What connects them?</p>
      ${opts.map((o, i) => `<button class="choice" data-o="${i}">${o}</button>`).join('')}
      ${
        shown < 5
          ? `<button class="btn2" id="pzMore" style="width:100%;margin-top:8px">Show another clue (costs points)</button>`
          : ''
      }`;
    body.querySelectorAll('[data-o]').forEach((b) =>
      b.addEventListener('click', () => {
        const pick = opts[+(b as HTMLElement).dataset.o!];
        if (pick === set.a) {
          sfx.win();
          onDone(worth[shown - 1], shown + ' clues');
        } else {
          sfx.hurt();
          (b as HTMLElement).style.background = '#FFE3E7';
          if (shown < 5) {
            shown++;
            paint();
          } else onDone(20, 'missed');
        }
      })
    );
    body.querySelector('#pzMore')?.addEventListener('click', () => {
      shown++;
      paint();
    });
  };
  paint();
}

function playLadder(
  host: HTMLElement,
  onDone: (s: number, d: string) => void,
  onClose: () => void
) {
  const rnd = dseed(47);
  const L = (LADDERS as any[])[Math.floor(rnd() * (LADDERS as any[]).length)];
  let order = dshuffle([0, 1, 2, 3, 4], rnd);
  if (order.every((v, i) => v === i)) order = [1, 0, 2, 3, 4];
  let sel = -1;
  let swaps = 0;

  const paint = () => {
    const body = shell(host, 'The Ladder', '', onClose);
    const done = order.every((v, i) => v === i);
    body.innerHTML = `
      <p style="font-weight:800;margin:0 0 10px">${L.t}</p>
      <p class="muted" style="font-size:12px;font-weight:700;margin-bottom:10px">Tap two steps to swap. Fewer swaps = higher score.</p>
      ${order
        .map((oi, i) => {
          const step = L.steps[oi];
          const on = sel === i;
          return `<button class="choice" data-i="${i}" style="${on ? 'background:#FFF6DC' : ''}">
            <b>${i + 1}.</b> ${step}
          </button>`;
        })
        .join('')}
      <p style="font-weight:900;font-size:12px;color:#0A66C2">Swaps: ${swaps}</p>
      ${
        done
          ? `<button class="btn" id="pzSubmit" style="width:100%">Lock in</button>`
          : ''
      }`;
    body.querySelectorAll('[data-i]').forEach((b) =>
      b.addEventListener('click', () => {
        const i = +(b as HTMLElement).dataset.i!;
        if (sel < 0) sel = i;
        else if (sel === i) sel = -1;
        else {
          [order[sel], order[i]] = [order[i], order[sel]];
          swaps++;
          sel = -1;
          sfx.ui();
        }
        paint();
      })
    );
    body.querySelector('#pzSubmit')?.addEventListener('click', () => {
      const score = Math.max(20, 100 - swaps * 12);
      sfx.win();
      onDone(score, swaps + ' swaps');
    });
  };
  paint();
}

function playGrid(
  host: HTMLElement,
  onDone: (s: number, d: string) => void,
  onClose: () => void
) {
  // 5x5 queens-style: one per row/col/zone, none adjacent
  const rnd = dseed(29);
  let sol: number[] | null = null;
  let guard = 0;
  while (!sol && guard++ < 400) {
    const perm = dshuffle([0, 1, 2, 3, 4], rnd);
    let ok = true;
    for (let i = 1; i < 5; i++)
      if (Math.abs(perm[i] - perm[i - 1]) <= 1) ok = false;
    if (ok) sol = perm;
  }
  if (!sol) sol = [1, 3, 0, 2, 4];
  const zone = Array.from({ length: 5 }, () => Array(5).fill(-1));
  sol.forEach((c, r) => {
    zone[r][c] = r;
  });
  let empty = 20,
    g2 = 0;
  while (empty > 0 && g2++ < 2000) {
    const r = (rnd() * 5) | 0,
      c = (rnd() * 5) | 0;
    if (zone[r][c] >= 0) continue;
    const nb = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]
      .map(([dr, dc]) => [r + dr, c + dc] as const)
      .filter(
        ([a, b]) => a >= 0 && b >= 0 && a < 5 && b < 5 && zone[a][b] >= 0
      );
    if (!nb.length) continue;
    const pick = nb[(rnd() * nb.length) | 0];
    zone[r][c] = zone[pick[0]][pick[1]];
    empty--;
  }
  for (let r = 0; r < 5; r++)
    for (let c = 0; c < 5; c++) if (zone[r][c] < 0) zone[r][c] = r;

  const marks = Array.from({ length: 5 }, () => Array(5).fill(0));
  const colors = ['#E8F5E9', '#E3F2FD', '#FFF3E0', '#F3E5F5', '#FFEBEE'];

  const valid = () => {
    const rows = Array(5).fill(0);
    const cols = Array(5).fill(0);
    const zs = Array(5).fill(0);
    const cells: [number, number][] = [];
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 5; c++)
        if (marks[r][c]) {
          rows[r]++;
          cols[c]++;
          zs[zone[r][c]]++;
          cells.push([r, c]);
        }
    if (rows.some((n) => n !== 1) || cols.some((n) => n !== 1) || zs.some((n) => n !== 1))
      return false;
    for (let i = 0; i < cells.length; i++)
      for (let j = i + 1; j < cells.length; j++) {
        const [r1, c1] = cells[i],
          [r2, c2] = cells[j];
        if (Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1) return false;
      }
    return true;
  };

  const paint = () => {
    const body = shell(host, 'The Grid', '', onClose);
    body.innerHTML = `
      <p class="muted" style="font-size:12px;font-weight:700;margin:0 0 10px">
        One signal per row, column, and colour. None may touch — even diagonally.
      </p>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;max-width:320px;margin:0 auto">
        ${Array.from({ length: 25 }, (_, i) => {
          const r = (i / 5) | 0,
            c = i % 5;
          const on = marks[r][c];
          return `<button data-r="${r}" data-c="${c}" style="
            aspect-ratio:1;border:2px solid #123253;border-radius:10px;font-size:18px;font-weight:900;
            background:${colors[zone[r][c]]};cursor:pointer">${on ? '✦' : ''}</button>`;
        }).join('')}
      </div>
      <button class="btn" id="pzCheck" style="width:100%;margin-top:14px">Check placement</button>
      <p id="pzMsg" class="muted" style="font-size:12px;font-weight:700;margin-top:8px"></p>`;
    body.querySelectorAll('[data-r]').forEach((b) =>
      b.addEventListener('click', () => {
        const r = +(b as HTMLElement).dataset.r!;
        const c = +(b as HTMLElement).dataset.c!;
        // toggle; enforce one per row visually by clearing row first if placing
        if (marks[r][c]) marks[r][c] = 0;
        else {
          for (let cc = 0; cc < 5; cc++) marks[r][cc] = 0;
          marks[r][c] = 1;
        }
        sfx.ui();
        paint();
      })
    );
    body.querySelector('#pzCheck')!.addEventListener('click', () => {
      if (valid()) {
        sfx.win();
        onDone(100, 'perfect grid');
      } else {
        sfx.hurt();
        (body.querySelector('#pzMsg') as HTMLElement).textContent =
          'Not yet — check rows, columns, colours, and neighbours.';
      }
    });
  };
  paint();
}
