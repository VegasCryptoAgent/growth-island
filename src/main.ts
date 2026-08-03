import Phaser from 'phaser';
import './styles/main.css';
import { BootScene } from './game/scenes/BootScene';
import { TitleScene } from './game/scenes/TitleScene';
import { OverworldScene } from './game/scenes/OverworldScene';
import { GameApp } from './game/GameApp';
import { COLORS } from './game/config';

const gameRoot = document.getElementById('game-root')!;
const uiRoot = document.getElementById('ui-root')!;

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: gameRoot,
  backgroundColor: COLORS.sky,
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: { debug: false },
  },
  scene: [BootScene, TitleScene, OverworldScene],
  render: {
    antialias: true,
    pixelArt: false,
    roundPixels: true,
  },
  audio: {
    disableWebAudio: false,
  },
});

// Bridge UI + game
new GameApp(game, uiRoot);

// Persist on hide
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    const scene = game.scene.getScene('overworld') as OverworldScene | null;
    scene?.persist?.();
  }
});

export default game;
