/** Lightweight procedural Web Audio (no asset files required) */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

export function setMuted(m: boolean) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.22;
}

export function isMuted() {
  return muted;
}

export function bootAudio() {
  if (ctx) return;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.22;
  master.connect(ctx.destination);
}

function tone(
  freq: number,
  dur: number,
  type: OscillatorType = 'square',
  gain = 0.08
) {
  if (!ctx || !master || muted) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.value = gain;
  o.connect(g);
  g.connect(master);
  const t = ctx.currentTime;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const sfx = {
  ui: () => tone(520, 0.06, 'triangle', 0.05),
  pick: () => tone(660, 0.07, 'square', 0.05),
  win: () => {
    tone(523, 0.08);
    setTimeout(() => tone(659, 0.08), 70);
    setTimeout(() => tone(784, 0.12), 140);
  },
  hurt: () => tone(180, 0.12, 'sawtooth', 0.06),
  combo: () => {
    tone(880, 0.05);
    setTimeout(() => tone(1175, 0.08), 50);
  },
  gate: () => tone(392, 0.1, 'triangle', 0.06),
  scrollUp: () => tone(740, 0.09, 'triangle', 0.05),
};
