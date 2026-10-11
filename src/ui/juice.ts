import Phaser from 'phaser';
import { TUNING } from '../config/tuning';
import type { Vec2 } from '../core/math';
import { VIEW } from '../core/viewport';
import type { Projectiles } from '../systems/projectiles';

/**
 * Сочность: то, что видно в момент события. Кольца удара и смерти, всплывающие
 * «+6» за подбор, следы снарядов и дэша, тряска камеры.
 *
 * Модуль отдельный от сцены, потому что это другой слой: сцена решает, ЧТО
 * произошло, а здесь решается, как это выглядит. Все числа — в tuning, пулы
 * фиксированного размера: удар повторяется десятки раз в секунду, и создавать
 * объекты на каждый было бы мусором ровно в бою.
 *
 * Эффекты живут в игровом времени (сцена подаёт шаг), поэтому при смерти и на
 * выборе таланта они замирают вместе с миром, а не догорают в паузе.
 */
export type RingKind = 'hit' | 'kill' | 'pickup';
export type ShakeKind = 'hit' | 'kill' | 'death';

interface Ring {
  arc: Phaser.GameObjects.Arc;
  alive: boolean;
  ageMs: number;
  lifeMs: number;
}

interface Popup {
  text: Phaser.GameObjects.Text;
  alive: boolean;
  ageMs: number;
  lifeMs: number;
  x: number;
  y: number;
}

const RING_DEPTH = 12;
const TRAIL_DEPTH = 9;
const POPUP_DEPTH = 21;
/**
 * Во сколько раз кольцо меньше своего конечного радиуса в первый миг.
 *
 * Рост идёт масштабом, а не радиусом: setRadius пересчитывает геометрию дуги
 * и стоит 21 мкс на кольцо за кадр, а setScale — 0.08 мкс. В бою колец бывает
 * два десятка, поэтому разница видна именно там, где важен кадр.
 */
const RING_START_SCALE = 0.35;

export class Juice {
  private readonly rings: Ring[] = [];
  private readonly popups: Popup[] = [];
  private readonly trails: Phaser.GameObjects.Graphics;
  /** Сцена — хозяин всех объектов эффектов: по её shutdown они и убираются. */
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    for (let i = 0; i < TUNING.juice.ringPoolSize; i++) {
      this.rings.push({
        arc: scene.add
          .circle(0, 0, 1)
          .setFillStyle(0x000000, 0)
          .setStrokeStyle(1, 0xffffff, 1)
          .setDepth(RING_DEPTH)
          .setVisible(false),
        alive: false,
        ageMs: 0,
        lifeMs: 0,
      });
    }
    for (let i = 0; i < TUNING.juice.popupPoolSize; i++) {
      this.popups.push({
        text: scene.add
          .text(0, 0, '', { fontFamily: 'monospace', color: '#ffe066' })
          .setOrigin(0.5, 0.5)
          .setDepth(POPUP_DEPTH)
          .setVisible(false),
        alive: false,
        ageMs: 0,
        lifeMs: 0,
        x: 0,
        y: 0,
      });
    }
    // Один графический слой на все следы: рисование очищается каждый кадр, поэтому
    // следов может быть сколько угодно без единого нового объекта.
    this.trails = scene.add.graphics().setDepth(TRAIL_DEPTH);
  }

  /**
   * Кольцо события. Цвет приходит от того, кто его вызвал: попадание и смерть
   * цвета врага, подбор — цвета предмета.
   */
  burst(x: number, y: number, color: number, kind: RingKind): void {
    const ring = this.rings.find((r) => !r.alive);
    // Пул занят — эффект пропускается. Пропущенное кольцо не стоит ломать бой.
    if (!ring) return;

    const spec =
      kind === 'kill'
        ? { radius: TUNING.juice.killRingRadius, lifeMs: TUNING.juice.killRingLifeMs }
        : kind === 'pickup'
          ? { radius: TUNING.juice.pickupRingRadius, lifeMs: TUNING.juice.pickupRingLifeMs }
          : { radius: TUNING.juice.hitRingRadius, lifeMs: TUNING.juice.hitRingLifeMs };

    ring.alive = true;
    ring.ageMs = 0;
    ring.lifeMs = spec.lifeMs;
    // Радиус задаётся один раз на событие, а рост дальше идёт масштабом.
    ring.arc
      .setVisible(true)
      .setPosition(x, y)
      .setStrokeStyle(1, color, 1)
      .setRadius(spec.radius)
      .setScale(RING_START_SCALE)
      .setAlpha(1);
  }

  /** Всплывающее число. Им подбор говорит, сколько Тока пришло. */
  popup(x: number, y: number, text: string, color: string): void {
    const popup = this.popups.find((p) => !p.alive);
    if (!popup) return;
    popup.alive = true;
    popup.ageMs = 0;
    popup.lifeMs = TUNING.juice.popupLifeMs;
    popup.x = x;
    popup.y = y;
    popup.text.setVisible(true).setText(text).setColor(color).setAlpha(1).setPosition(x, y);
  }

  /** Тряска камеры: удар — короткая, смерть — заметная. */
  shake(kind: ShakeKind): void {
    const spec =
      kind === 'death'
        ? { force: TUNING.juice.shakeDeath, ms: TUNING.juice.shakeDeathMs }
        : kind === 'kill'
          ? { force: TUNING.juice.shakeKill, ms: TUNING.juice.shakeKillMs }
          : { force: TUNING.juice.shakeHit, ms: TUNING.juice.shakeHitMs };
    this.scene.cameras.main.shake(spec.ms, spec.force);
  }

  /** Вспышка экрана: смерть обязана читаться даже боковым зрением. */
  flash(ms: number, r: number, g: number, b: number): void {
    this.scene.cameras.main.flash(ms, r, g, b);
  }

  /** Шаг игрового времени: эффекты старятся вместе с миром. */
  step(dt: number): void {
    const ms = dt * 1000;
    for (const ring of this.rings) {
      if (!ring.alive) continue;
      ring.ageMs += ms;
      if (ring.ageMs >= ring.lifeMs) {
        ring.alive = false;
        ring.arc.setVisible(false);
        continue;
      }
      const t = ring.ageMs / ring.lifeMs;
      ring.arc.setScale(RING_START_SCALE + (1 - RING_START_SCALE) * t);
      ring.arc.setAlpha(1 - t);
    }
    for (const popup of this.popups) {
      if (!popup.alive) continue;
      popup.ageMs += ms;
      if (popup.ageMs >= popup.lifeMs) {
        popup.alive = false;
        popup.text.setVisible(false);
        continue;
      }
      const t = popup.ageMs / popup.lifeMs;
      popup.text.setPosition(popup.x, popup.y - TUNING.juice.popupRiseY * t);
      popup.text.setAlpha(1 - t * t);
    }
  }

  /**
   * Отрисовка следов: короткая чёрточка назад по скорости у каждого живого
   * снаряда и полоса за игроком в рывке. Рисуется каждый кадр заново — это
   * дешевле, чем держать объект на каждую пулю.
   */
  render(shots: Projectiles, player: Vec2, vel: Vec2, dashing: boolean): void {
    const g = this.trails;
    g.clear();

    const shotTrail = TUNING.juice.shotTrail * TUNING.shots.projectileRadius;
    shots.each((x, y, vx, vy) => {
      const len = Math.hypot(vx, vy) || 1;
      g.lineStyle(1, 0xfff3b0, 0.35);
      g.lineBetween(x, y, x - (vx / len) * shotTrail, y - (vy / len) * shotTrail);
    });

    if (!dashing) return;
    const speed = Math.hypot(vel.x, vel.y) || 1;
    const len = TUNING.juice.dashTrail;
    g.lineStyle(Math.max(1, VIEW.minSide / 240), 0xffe066, 0.5);
    g.lineBetween(
      player.x,
      player.y,
      player.x - (vel.x / speed) * len,
      player.y - (vel.y / speed) * len,
    );
  }

  /** Мир начался заново: эффекты прошлого забега не должны в нём висеть. */
  reset(): void {
    for (const ring of this.rings) {
      ring.alive = false;
      ring.arc.setVisible(false);
    }
    for (const popup of this.popups) {
      popup.alive = false;
      popup.text.setVisible(false);
    }
    this.trails.clear();
  }

  destroy(): void {
    for (const ring of this.rings) ring.arc.destroy();
    for (const popup of this.popups) popup.text.destroy();
    this.trails.destroy();
    this.rings.length = 0;
    this.popups.length = 0;
  }
}
