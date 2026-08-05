/**
 * Guided first-run tutorial: controls → first coach → first puzzle.
 */
import type { GameApp } from '../GameApp';
import { track } from '../systems/Analytics';
import { writeSave } from '../systems/Save';

const KEY = 'growth_island_tutorial_v1';

export function tutorialDone(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function markTutorialDone() {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* */
  }
}

export function startTutorial(app: GameApp) {
  if (tutorialDone()) return;
  const save = app.scene?.getSave?.();
  if (save?.sq?.tutorial) {
    markTutorialDone();
    return;
  }

  const isTouch =
    typeof navigator !== 'undefined' &&
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const steps: { title: string; body: string; action?: string }[] = [
    {
      title: 'You made landfall',
      body: isTouch
        ? 'Use the D-pad (or drag) to walk. Coaches greet you on approach — tap Talk near Ivy in Profile Plaza.'
        : 'WASD or arrows to walk · coaches greet you on approach · Space / E to continue · Journal · Menu for the Signal Deck.',
    },
    {
      title: 'Find Ivy',
      body: 'Ivy the Profile Architect is waiting on the plaza path. Talk to her first — she hands you the tools that make the Mainland work.',
    },
  ];

  let i = 0;
  const show = () => {
    const s = steps[i];
    if (!s) {
      markTutorialDone();
      if (app.scene) {
        const g = app.scene.getSave();
        g.sq = g.sq || {};
        g.sq.tutorial = true;
        writeSave(g);
      }
      track('tutorial_complete');
      app.ui.clearPanel();
      app.scene?.setBlocked(false);
      app.toast('Tutorial complete — explore!');
      return;
    }
    app.scene?.setBlocked(true);
    app.ui.showPanel(`
      <div class="overlay-dim">
        <div class="card pop" style="max-width:440px;padding:22px;text-align:center">
          <p style="font-size:11px;letter-spacing:.25em;font-weight:900;color:#0A66C2">
            GUIDE ${i + 1}/${steps.length}
          </p>
          <h2 style="margin:10px 0 8px">${s.title}</h2>
          <p style="font-weight:700;line-height:1.5;margin:0 0 16px">${s.body}</p>
          <button type="button" class="btn" id="tutNext" style="width:100%">
            ${i === steps.length - 1 ? 'Start exploring' : 'Next'}
          </button>
          <button type="button" class="btn2" id="tutSkip" style="width:100%;margin-top:8px">Skip guide</button>
        </div>
      </div>`);
    app.ui.panelHost.querySelector('#tutNext')!.addEventListener('click', () => {
      if (s.action === 'puzzle') {
        /* soft hint only */
      }
      i++;
      track('tutorial_step', { i });
      show();
    });
    app.ui.panelHost.querySelector('#tutSkip')!.addEventListener('click', () => {
      markTutorialDone();
      if (app.scene) {
        const g = app.scene.getSave();
        g.sq = g.sq || {};
        g.sq.tutorial = true;
        writeSave(g);
      }
      track('tutorial_skip', { at: i });
      app.ui.clearPanel();
      app.scene?.setBlocked(false);
    });
  };

  track('tutorial_start');
  window.setTimeout(show, 400);
}
