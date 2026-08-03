import { CARDS } from '../data/cards';
import { READERS } from '../data/readers';
import { ROUNDS } from '../data/rounds';
import { sfx } from '../systems/Audio';

type Card = (typeof CARDS)[number];
type ReaderKey = keyof typeof READERS;

type RState = {
  k: ReaderKey;
  att: number;
  pat: number;
  state: 'in' | 'won' | 'lost';
};

export type FeedResult = {
  score: number;
  won: number;
  lost: number;
};

const cardById = (id: string) =>
  (CARDS as Card[]).find((c) => c.id === id)!;

export function openFeedGame(
  host: HTMLElement,
  onDone: (r: FeedResult) => void,
  onClose: () => void
) {
  let round = 0;
  let phase: 'play' | 'draft' | 'done' = 'play';
  let energy = 0;
  let maxE = 0;
  let deck = [
    'we',
    'we',
    'story',
    'story',
    'proof',
    'q',
    'lesson',
    'soft',
    'soft',
    'reply',
    'reply',
    'spec',
    'celebrate',
  ];
  let hand: string[] = [];
  let discard: string[] = [];
  let readers: RState[] = [];
  let won = 0;
  let lost = 0;
  let score = 0;
  let sel = 0;
  let drafts: string[] = [];
  let msg = '';
  let last: string | null = null;

  const shuffle = (a: string[]) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
  };
  const draw = (n: number) => {
    for (let i = 0; i < n; i++) {
      if (!deck.length) {
        deck = discard.splice(0);
        shuffle(deck);
      }
      if (!deck.length) break;
      if (hand.length >= 6) {
        discard.push(deck.pop()!);
        continue;
      }
      hand.push(deck.pop()!);
    }
  };

  const startRound = () => {
    const R = (ROUNDS as any[])[round];
    maxE = R.energy;
    energy = R.energy;
    phase = 'play';
    sel = 0;
    readers = R.mix.map((k: ReaderKey) => ({
      k,
      att: 0,
      pat: (READERS as any)[k].pat,
      state: 'in' as const,
    }));
    discard.push(...hand);
    hand = [];
    shuffle(deck);
    draw(5);
    msg = `${R.n} — ${R.note}`;
  };

  const active = () => readers.filter((r) => r.state === 'in');

  const apply = (c: Card) => {
    const f = c.fx as any;
    const act = active();
    if (f.replay) {
      if (!last || last === 'repost') {
        msg = 'Nothing to reissue yet.';
        sfx.hurt();
        return;
      }
      apply(cardById(last));
      msg = 'Reissued: ' + cardById(last).n;
      return;
    }
    if (f.energy) energy += f.energy;
    if (f.draw) draw(f.draw);
    if (f.focus) {
      let best = act[0];
      act.forEach((r) => {
        if (!best || r.att > best.att) best = r;
      });
      if (best) best.att += f.focus;
      msg = `Replied to the ${(READERS as any)[best.k].n}.`;
    }
    if (f.convert) {
      let n = 0;
      act.forEach((r) => {
        const need = (READERS as any)[r.k].need;
        const pct = (r.att / need) * 100;
        if (pct >= f.convert - (r.k === 'buyer' ? 0 : 10)) {
          r.state = 'won';
          won++;
          n++;
        } else if (f.penalty) r.att = Math.max(0, r.att + f.penalty);
      });
      msg = n
        ? `${n} reader${n > 1 ? 's' : ''} started a conversation.`
        : f.penalty
          ? 'Nobody was ready. You cost yourself the room.'
          : 'Nobody was warm enough yet.';
      sfx[n ? 'win' : 'hurt']();
      return;
    }
    const targeted = !f.all;
    act.forEach((r) => {
      let d = 0;
      if (f.all) d += f.all;
      if (f[r.k] !== undefined) d += f[r.k];
      if (targeted && f[r.k] === undefined && !f.focus && !f.draw) d -= 7;
      if (d) r.att = Math.max(0, r.att + d);
    });
    msg = c.n + (c.why ? ' · ' + c.why : '');
    sfx.pick();
  };

  const play = (idx: number) => {
    if (phase !== 'play') return;
    const id = hand[idx];
    if (!id) return;
    const c = cardById(id);
    if (c.cost > energy) {
      msg = 'Not enough attention left this post.';
      sfx.hurt();
      paint();
      return;
    }
    energy -= c.cost;
    hand.splice(idx, 1);
    discard.push(id);
    apply(c);
    last = id;
    sel = Math.min(sel, Math.max(0, hand.length - 1));
    if (energy <= 0) endPost();
    paint();
  };

  const endPost = () => {
    active().forEach((r) => {
      const need = (READERS as any)[r.k].need;
      if (r.att >= need * 1.35) {
        r.state = 'won';
        won++;
      } else {
        r.pat -= 1;
        if (
          readers.some((x) => x.k === 'troll' && x.state === 'in' && x !== r) &&
          r.att < need * 0.5
        )
          r.pat -= 1;
        if (r.pat <= 0) {
          r.state = 'lost';
          lost++;
        }
      }
    });
    if (!active().length) return roundEnd();
    energy = maxE;
    draw(2);
    msg = `New post. ${active().length} still reading — warm them, then close them.`;
  };

  const roundEnd = () => {
    const conv = readers.filter((r) => r.state === 'won').length;
    const spare = readers
      .filter((r) => r.state === 'won')
      .reduce((s, r) => s + Math.max(0, r.pat), 0);
    const lostN = readers.filter((r) => r.state === 'lost').length;
    score = Math.max(
      0,
      score + conv * 800 + spare * 300 + (round + 1) * 300 - lostN * 650
    );
    if (conv === readers.length) score += 2200;
    round++;
    if (round >= (ROUNDS as any[]).length) {
      phase = 'done';
      paint();
      setTimeout(() => onDone({ score, won, lost }), 600);
      return;
    }
    phase = 'draft';
    const pool = (CARDS as Card[]).filter((c) => c.rare).map((c) => c.id);
    shuffle(pool);
    drafts = pool.slice(0, 3);
    msg = 'Pick one card to add to your deck.';
  };

  const draftPick = (i: number) => {
    const id = drafts[i];
    if (!id) return;
    deck.push(id);
    discard.push(id);
    sfx.win();
    startRound();
    paint();
  };

  const paint = () => {
    const R = READERS as any;
    if (phase === 'draft') {
      host.innerHTML = `
        <div class="overlay-dim">
          <div class="card pop scroll" style="max-width:720px;width:100%;max-height:90vh;padding:20px;
            background:url(./assets/generated/feed-backdrop.jpg) center/cover #123253;color:#fff">
            <p style="font-size:11px;letter-spacing:.25em;font-weight:900;opacity:.85">THE FEED · DRAFT</p>
            <h2 style="margin:6px 0 4px;font-size:22px">Pick a card for your deck</h2>
            <p style="opacity:.85;font-weight:600;margin-bottom:14px">${msg}</p>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
              ${drafts
                .map((id, i) => {
                  const c = cardById(id);
                  return `<button class="choice" data-d="${i}" style="background:rgba(255,255,255,.95)">
                    <b>${c.n}</b><br><span class="muted" style="font-size:12px">${c.txt}</span>
                    <div style="font-size:11px;margin-top:6px;color:#0A66C2;font-weight:800">${c.why}</div>
                  </button>`;
                })
                .join('')}
            </div>
            <button class="btn2" id="feedQuit" style="margin-top:14px;width:100%">Quit</button>
          </div>
        </div>`;
      host.querySelectorAll('[data-d]').forEach((b) =>
        b.addEventListener('click', () => draftPick(+(b as HTMLElement).dataset.d!))
      );
      host.querySelector('#feedQuit')!.addEventListener('click', onClose);
      return;
    }

    host.innerHTML = `
      <div class="overlay-dim" style="align-items:stretch;padding:0">
        <div style="flex:1;display:flex;flex-direction:column;max-width:900px;margin:0 auto;width:100%;
          background:linear-gradient(180deg,rgba(18,50,83,.55),rgba(18,50,83,.75)),
          url(./assets/generated/feed-backdrop.jpg) center/cover;padding:12px">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <div class="card" style="padding:8px 12px;font-weight:900">The Feed</div>
            <div class="tag">⭐ ${score.toLocaleString()}</div>
            <div class="tag">⚡ ${energy}/${maxE}</div>
            <div class="tag">Round ${round + 1}/3</div>
            <div style="flex:1"></div>
            <button class="btn2" id="feedQuit">Quit</button>
          </div>
          <p style="color:#fff;font-weight:800;margin:10px 4px;min-height:40px;text-shadow:0 2px 0 #123253">${msg}</p>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin:8px 0 16px">
            ${readers
              .map((r) => {
                const meta = R[r.k];
                const need = meta.need;
                const pct = Math.min(100, (r.att / need) * 100);
                const op = r.state === 'lost' ? .4 : 1;
                return `<div class="card" style="width:120px;padding:10px;opacity:${op};text-align:center">
                  <div style="font-size:28px;margin-bottom:4px">${r.state === 'won' ? '✅' : r.state === 'lost' ? '💨' : '👤'}</div>
                  <div style="font-weight:900;font-size:12px;color:${meta.c}">${meta.n}</div>
                  <div class="bar" style="margin:6px 0"><i style="width:${pct}%;background:${meta.c}"></i></div>
                  <div class="muted" style="font-size:10px;font-weight:800">patience ${r.pat}</div>
                </div>`;
              })
              .join('')}
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-top:auto">
            ${hand
              .map((id, i) => {
                const c = cardById(id);
                const on = i === sel;
                return `<button class="choice" data-h="${i}" style="margin:0;${on ? 'background:#FFF6DC;box-shadow:0 0 0 3px #FFC53D' : ''}">
                  <div style="display:flex;justify-content:space-between;gap:6px">
                    <b style="font-size:13px">${c.n}</b>
                    <span class="tag" style="padding:0 6px">⚡${c.cost}</span>
                  </div>
                  <div class="muted" style="font-size:11px;margin-top:4px">${c.txt}</div>
                </button>`;
              })
              .join('')}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">
            <button class="btn" id="feedPlay">Play card</button>
            <button class="btnG" id="feedPub">Publish post</button>
          </div>
          ${
            hand[sel]
              ? `<div class="card2" style="margin-top:8px;padding:10px;font-size:12px;font-weight:700;color:#fff;background:rgba(18,50,83,.65);border-color:#fff">
                  ${cardById(hand[sel]).why}
                </div>`
              : ''
          }
        </div>
      </div>`;
    host.querySelectorAll('[data-h]').forEach((b) =>
      b.addEventListener('click', () => {
        const i = +(b as HTMLElement).dataset.h!;
        if (sel === i) play(i);
        else {
          sel = i;
          msg = cardById(hand[i]).n + ' — ' + cardById(hand[i]).why;
          paint();
        }
      })
    );
    host.querySelector('#feedPlay')!.addEventListener('click', () => play(sel));
    host.querySelector('#feedPub')!.addEventListener('click', () => {
      endPost();
      msg = 'You published. Next post.';
      paint();
    });
    host.querySelector('#feedQuit')!.addEventListener('click', onClose);
  };

  startRound();
  paint();
}

export function medalFor(score: number): number {
  if (score >= 22000) return 3;
  if (score >= 15000) return 2;
  if (score >= 9000) return 1;
  return 0;
}
