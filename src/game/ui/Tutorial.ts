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

  const steps: { title: string; body: string; action?: string }[] = [
    {
      title: 'Welcome to the island',
      body: 'This game teaches LinkedIn growth by walking, talking, and shipping real hooks.',
    },
    {
      title: 'How to walk',
      body:
        typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0
          ? 'Drag your finger on the island. A blue stick appears under your touch — walk that way.'
          : 'Click and hold on the island with your mouse to walk toward the cursor. Or use WASD.',
    },
    {
      title: 'Talk to coaches',
      body: 'Walk near a coach (look for !) and press Talk. They teach tools you can use today.',
      action: 'talk',
    },
    {
      title: 'Daily puzzles',
      body: 'Press Puzzles anytime for Thread, Grid, and Ladder. Same seed for everyone each day.',
      action: 'puzzle',
    },
    {
      title: 'You’re set',
      body: 'Explore Profile Plaza first. Your first Signal is already with you. Have fun.',
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
