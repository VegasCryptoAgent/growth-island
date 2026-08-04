import Phaser from 'phaser';
import './styles/main.css';
import { BootScene } from './game/scenes/BootScene';
import { TitleScene } from './game/scenes/TitleScene';
import { OverworldScene } from './game/scenes/OverworldScene';
import { GameApp } from './game/GameApp';
import { COLORS } from './game/config';

const gameRoot = document.getElementById('game-root')!;
const uiRoot = document.getElementById('ui-root')!;

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

const game = new Phaser.Game({
  type: isMobile ? Phaser.CANVAS : Phaser.AUTO,
  parent: gameRoot,
  backgroundColor: COLORS.sky,
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: startW,
    height: startH,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    expandParent: true,
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
});

// Bridge UI + game
new GameApp(game, uiRoot);

// Keep buffer size in sync with mobile browser chrome show/hide
let resizeT: ReturnType<typeof setTimeout> | null = null;
const onResize = () => {
  if (resizeT) clearTimeout(resizeT);
  resizeT = setTimeout(() => {
    const { w, h } = viewSize();
    if (game.scale) game.scale.resize(w, h);
  }, 50);
};
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);
window.visualViewport?.addEventListener('resize', onResize);
window.visualViewport?.addEventListener('scroll', onResize);

// Persist on hide
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    const scene = game.scene.getScene('overworld') as OverworldScene | null;
    scene?.persist?.();
  }
});

export default game;
