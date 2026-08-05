/**
 * First-run onboarding: make the value of Growth Island obvious in under 3 minutes.
 * Promise → walk to Ivy → forge a real opener you can post.
 */
import type { GameApp } from '../GameApp';
import { track } from '../systems/Analytics';
import { writeSave } from '../systems/Save';

const KEY = 'growth_island_tutorial_v2';

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
  // Already forged a hook = they understand the product
  if (save?.tools?.forge || save?.sq?.tutorial) {
    markTutorialDone();
    return;
  }

  const isTouch =
    typeof navigator !== 'undefined' &&
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  app.scene?.setBlocked(true);
  app.ui.showPanel(`
    <div class="overlay-dim">
      <div class="card pop" style="max-width:440px;padding:22px;text-align:left">
        <p style="font-size:11px;letter-spacing:.22em;font-weight:900;color:#0A66C2;margin:0 0 8px">
          WHAT THIS IS
        </p>
        <h2 style="margin:0 0 10px;font-size:22px;line-height:1.2">
          Leave with a LinkedIn opener you can post today.
        </h2>
        <p style="font-weight:700;line-height:1.5;margin:0 0 14px;color:#123253">
          Growth Island is a 10-minute practice ground for LinkedIn growth —
          not a time sink. You talk to coaches, run real tools, and walk away
          with copy you can publish.
        </p>
        <div class="card2" style="padding:12px;margin:0 0 14px">
          <p style="font-weight:900;margin:0 0 8px;font-size:13px">Your first 3 minutes</p>
          <ol style="margin:0;padding-left:18px;font-weight:700;line-height:1.65;font-size:13px">
            <li><b>Talk to Ivy</b> on the plaza path (blue jacket)</li>
            <li>Answer 2 questions — she opens the workshop</li>
            <li><b>Forge a real opener</b> with your numbers → <b>Copy</b> it</li>
          </ol>
        </div>
        <p style="font-size:12px;font-weight:700;color:#5C7A99;margin:0 0 14px">
          ${
            isTouch
              ? 'D-pad to walk. When you get close, Ivy talks automatically — or tap her, or the blue Talk button.'
              : 'WASD to walk. When you get close, Ivy talks automatically — or click her / press Space.'
          }
        </p>
        <button type="button" class="btn" id="tutGo" style="width:100%">Find Ivy — let's go</button>
        <button type="button" class="btn2" id="tutSkip" style="width:100%;margin-top:8px">Skip intro</button>
      </div>
    </div>`);

  const finish = (skipped: boolean) => {
    markTutorialDone();
    if (app.scene) {
      const g = app.scene.getSave();
      g.sq = g.sq || {};
      g.sq.tutorial = true;
      writeSave(g);
    }
    track(skipped ? 'tutorial_skip' : 'tutorial_start');
    app.ui.clearPanel();
    app.scene?.setBlocked(false);
    if (!skipped) {
      app.toast('Walk to Ivy — blue jacket on the plaza');
      // Soft arrow: centre camera slightly toward Ivy
      try {
        const ivy = app.scene?.ents?.find((e: any) => e.id === 'ivy');
        if (ivy?.sprite && app.scene?.cameras?.main) {
          app.scene.cameras.main.pan(ivy.sprite.x, ivy.sprite.y, 600, 'Sine.easeInOut');
          window.setTimeout(() => {
            if (app.scene?.player) {
              app.scene.cameras.main.startFollow(app.scene.player, true, 0.18, 0.18);
            }
          }, 900);
        }
      } catch {
        /* */
      }
    }
  };

  app.ui.panelHost.querySelector('#tutGo')?.addEventListener('click', () => finish(false));
  app.ui.panelHost.querySelector('#tutSkip')?.addEventListener('click', () => finish(true));
}
