import { MONS } from '../data/mons';
import { sfx } from '../systems/Audio';

type FoeData = {
  id: string;
  n: string;
  c?: string;
  glyph?: string;
  award?: string;
  foe?: { hp: number; atk: number; moves: string[] };
  final?: boolean;
};

type Mon = {
  id: string;
  n: string;
  c: string;
  hp: number;
  atk: number;
  sp: { n: string; p: number };
};

export type BattleResult = {
  won: boolean;
  foeId: string;
  award?: string;
  champion: boolean;
  itemsLeft: number;
};

function monOf(id: string): Mon {
  const m = (MONS as Mon[]).find((x) => x.id === id);
  return (
    m || {
      id: 'proof',
      n: 'ProofPaladin',
      c: '#7C5CE0',
      hp: 120,
      atk: 16,
      sp: { n: 'Receipt Slam', p: 26 },
    }
  );
}

/** Simple turn battle — Signal vs Blocker */
export function openBattle(
  host: HTMLElement,
  foe: FoeData,
  opts: {
    activeId: string;
    team: string[];
    champion: boolean;
    items: number;
  },
  onDone: (r: BattleResult) => void,
  onClose: () => void
) {
  const me0 = monOf(opts.activeId || opts.team[0] || 'proof');
  const mult = opts.champion ? 1.55 : 1;
  let meHp = me0.hp;
  const meMax = me0.hp;
  let foeHp = Math.round((foe.foe?.hp || 100) * mult);
  const foeMax = foeHp;
  const foeAtk = Math.round((foe.foe?.atk || 15) * (opts.champion ? 1.3 : 1));
  let busy = false;
  let items = opts.items;
  let log = opts.champion
    ? `${foe.n} returns edged in gold. Champion tier.`
    : `${foe.n} blocks the path.`;

  const paint = () => {
    host.innerHTML = `
      <div class="overlay-dim" style="align-items:stretch;padding:0">
        <div style="flex:1;display:flex;flex-direction:column;max-width:720px;margin:0 auto;width:100%;
          background:linear-gradient(180deg,rgba(18,50,83,.5),rgba(18,50,83,.75)),
          url(./assets/generated/battle-backdrop.jpg) center/cover;padding:14px">
          <div style="display:flex;gap:10px;align-items:flex-start">
            <div class="card" style="flex:1;padding:12px">
              <div style="display:flex;justify-content:space-between;font-weight:900;font-size:13px">
                <span>${foe.n}</span>
                <span class="tag" style="background:#FFE0E4">${opts.champion ? 'CHAMPION' : 'BLOCKER'}</span>
              </div>
              <div class="bar" style="margin-top:8px"><i style="width:${(foeHp / foeMax) * 100}%;background:linear-gradient(90deg,#FF6B7F,#FF9AA8)"></i></div>
            </div>
            <div class="card" style="width:88px;height:88px;display:grid;place-items:center;font-size:40px;background:#FFEFF1">${foe.glyph || '👾'}</div>
          </div>
          <div class="card" style="padding:14px;margin:12px 0;font-weight:700;min-height:56px" id="bLog">${log}</div>
          <div style="display:flex;gap:10px;align-items:flex-end;margin-top:auto">
            <div class="card" style="width:88px;height:88px;display:grid;place-items:center;font-size:36px;background:${me0.c}22">⚔️</div>
            <div class="card" style="flex:1;padding:12px">
              <div style="display:flex;justify-content:space-between;font-weight:900;font-size:13px">
                <span>${me0.n}</span>
                <span class="muted" style="font-size:11px">${meHp}/${meMax}</span>
              </div>
              <div class="bar" style="margin-top:8px"><i style="width:${(meHp / meMax) * 100}%;background:linear-gradient(90deg,#0A66C2,#4FB3F5)"></i></div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px" id="bActs">
            <button class="btn" data-a="hit">Strike</button>
            <button class="btnG" data-a="sp">${me0.sp.n}</button>
            <button class="btn2" data-a="heal">Focus Tonic (${items})</button>
            <button class="btn2" data-a="run">Disengage</button>
          </div>
        </div>
      </div>`;
    host.querySelectorAll('[data-a]').forEach((b) =>
      b.addEventListener('click', () => act((b as HTMLElement).dataset.a!))
    );
  };

  const end = (won: boolean) => {
    busy = true;
    if (won) {
      log = `You broke through. ${foe.n} falls back.`;
      sfx.win();
    } else {
      log = won === false ? 'You pull back to recover.' : log;
      sfx.hurt();
    }
    paint();
    setTimeout(() => {
      onDone({
        won,
        foeId: foe.id,
        award: won ? foe.award : undefined,
        champion: opts.champion,
        itemsLeft: items,
      });
    }, 700);
  };

  const foeTurn = () => {
    const moves = foe.foe?.moves || ['Pressure'];
    const mv = moves[(Math.random() * moves.length) | 0];
    const dmg = Math.max(
      4,
      Math.round(foeAtk * (0.75 + Math.random() * 0.5) - me0.atk * 0.08)
    );
    meHp = Math.max(0, meHp - dmg);
    log = `${foe.n} uses ${mv} — ${dmg} damage.`;
    sfx.hurt();
    paint();
    if (meHp <= 0) {
      setTimeout(() => end(false), 500);
      return;
    }
    busy = false;
  };

  const act = (a: string) => {
    if (busy) return;
    if (a === 'run') {
      onClose();
      return;
    }
    busy = true;
    if (a === 'heal') {
      if (items <= 0) {
        log = 'No Focus Tonics left.';
        sfx.hurt();
        busy = false;
        paint();
        return;
      }
      items--;
      const h = Math.round(meMax * 0.4);
      meHp = Math.min(meMax, meHp + h);
      log = `Focus Tonic — recovered ${h} HP.`;
      sfx.pick();
      paint();
      setTimeout(foeTurn, 450);
      return;
    }
    let dmg = 0;
    if (a === 'sp') {
      dmg = Math.round(
        me0.sp.p * (0.9 + Math.random() * 0.3) + me0.atk * 0.35
      );
      log = `${me0.n} uses ${me0.sp.n}! ${dmg} damage.`;
      sfx.combo();
    } else {
      dmg = Math.round(me0.atk * (0.85 + Math.random() * 0.4));
      if (Math.random() < 0.12) {
        dmg = Math.round(dmg * 1.6);
        log = `Critical strike — ${dmg}!`;
        sfx.combo();
      } else {
        log = `${me0.n} strikes for ${dmg}.`;
        sfx.pick();
      }
    }
    foeHp = Math.max(0, foeHp - dmg);
    paint();
    if (foeHp <= 0) {
      setTimeout(() => end(true), 450);
      return;
    }
    setTimeout(foeTurn, 500);
  };

  paint();
}
