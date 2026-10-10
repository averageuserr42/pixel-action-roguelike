import Phaser from 'phaser';
import { refreshViewport, VIEW } from './core/viewport';
import { GameScene } from './scenes/GameScene';
import { createRotateHint, restoreFullscreenOnFirstTouch } from './ui/rotateHint';

// Поле зависит от устройства, поэтому его размер считаем до создания игры.
refreshViewport();

const rotateHint = createRotateHint();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: VIEW.w,
  height: VIEW.h,
  backgroundColor: '#0d0b12',
  // Пиксель-арт: без сглаживания текстур и с выравниванием по целым пикселям.
  pixelArt: true,
  roundPixels: true,
  scale: {
    // Никакого вписывания с полосами: размер буфера задаём сами, а увеличение
    // делаем целочисленным зумом, чтобы пиксели остались ровными.
    mode: Phaser.Scale.NONE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [GameScene],
});

game.scale.setZoom(VIEW.zoom);

// Поворот телефона или изменение размера окна: пересчитываем поле и зум.
window.addEventListener('resize', () => {
  refreshViewport();
  game.scale.resize(VIEW.w, VIEW.h);
  game.scale.setZoom(VIEW.zoom);
  rotateHint.setVisible(VIEW.needsRotate);
});

rotateHint.setVisible(VIEW.needsRotate);
// После перезагрузки браузер выходит из полного экрана сам: первый тап в
// горизонтали возвращает его, иначе помогала только смена ориентации.
restoreFullscreenOnFirstTouch();

// Только для режима разработки: даёт доступ к игре из консоли браузера,
// чтобы смотреть состояние и прогонять сценарии. В прод не попадает —
// в собранной версии import.meta.env.DEV === false.
if (import.meta.env.DEV) {
  (window as unknown as { __game?: Phaser.Game }).__game = game;
}
