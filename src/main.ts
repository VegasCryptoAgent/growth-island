import Phaser from 'phaser';
import './styles/main.css';
/* classic LinkedIn-bright theme is primary; cyber.css optional accents kept light */
import './styles/cyber.css';
import { BootScene } from './game/scenes/BootScene';
import { TitleScene } from './game/scenes/TitleScene';
import { OverworldScene } from './game/scenes/OverworldScene';
import { GameApp } from './game/GameApp';
import { COLORS } from './game/config';
import { initSentry, track } from './game/systems/Analytics';
import { mountSyncBanner, setSyncState } from './game/systems/SyncStatus';

const gameRoot = document.getElementById('game-root')!;
const uiRoot = document.getElementById('ui-root')!;

// Boot failure UI
function showBootError(msg: string) {
  const el = document.createElement('div');
  el.id = 'gi-boot-error';
  el.innerHTML = `
    <div class="gi-boot-card">
      <div style="font-size:40px">🏝️</div>
      <h1>Couldn’t start Growth Island</h1>
      <p>${msg}</p>
      <button type="button" class="btn" id="giBootReload">Reload</button>
    </div>`;
  document.body.appendChild(el);
  document.getElementById('giBootReload')?.addEventListener('click', () =>
    location.reload()
  );
}

try {
  initSentry();
  mountSyncBanner();
  track('app_boot');
} catch {
  /* */
}

// Claim invite from URL
try {
  const u = new URL(location.href);
  const inv = u.searchParams.get('invite');
  if (inv) sessionStorage.setItem('gi_invite', inv);
} catch {
  /* */
}

/** iOS Safari / coarse pointer — prefer Canvas; avoid WebGL black screens */
const isMobile =
  typeof navigator !== 'undefined' &&
  (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 &&
      window.matchMedia('(pointer: coarse)').matches));

function viewSize() {
  const vv = window.visualViewport;
  const w = Math.max(1, Math.floor(vv?.width || window.innerWidth || 320));
  const h = Math.max(1, Math.floor(vv?.height || window.innerHeight || 480));
  return { w, h };
}

const { w: startW, h: startH } = viewSize();

let game: Phaser.Game;
try {
  game = new Phaser.Game({
    type: Phaser.CANVAS,
    parent: gameRoot,
    backgroundColor: 0xbfeaf5,
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: startW,
      height: startH,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      expandParent: true,
    },
    fps: {
      target: isMobile ? 45 : 60,
      forceSetTimeOut: false,
      smoothStep: true,
    },
    input: {
      activePointers: 3,
      windowEvents: true,
    },
    physics: {
      default: 'arcade',
      arcade: { debug: false },
    },
    scene: [BootScene, TitleScene, OverworldScene],
    render: {
      antialias: !isMobile,
      pixelArt: false,
      roundPixels: true,
      powerPreference: isMobile ? 'default' : 'high-performance',
    },
    audio: {
      disableWebAudio: false,
    },
    banner: false,
    dom: {
      createContainer: false,
    },
  });

  queueMicrotask(() => {
    const canvas = gameRoot.querySelector('canvas') as HTMLElement | null;
    if (canvas) {
      canvas.style.zIndex = '1';
      canvas.style.position = 'relative';
      canvas.style.touchAction = 'none';
    }
    const ui = document.getElementById('ui-root');
    if (ui) ui.style.zIndex = '30';
  });

  new GameApp(game, uiRoot);

  // Register service worker for PWA offline shell
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* optional */
    });
  }
} catch (e) {
  console.error(e);
  showBootError(
    (e as Error).message ||
      'The game engine failed to start. Try another browser or reload.'
  );
  setSyncState('error', 'Boot failed');
  throw e;
}

let resizeT: ReturnType<typeof setTimeout> | null = null;
const onResize = () => {
  if (resizeT) clearTimeout(resizeT);
  resizeT = setTimeout(() => {
    const { w, h } = viewSize();
    if (game?.scale) game.scale.resize(w, h);
  }, 50);
};
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);
window.visualViewport?.addEventListener('resize', onResize);
window.visualViewport?.addEventListener('scroll', onResize);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    const scene = game.scene.getScene('overworld') as OverworldScene | null;
    scene?.persist?.();
  }
});

export default game;
