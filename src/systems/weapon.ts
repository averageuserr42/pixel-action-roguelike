import Phaser from 'phaser';
import { TUNING } from '../config/tuning';
import { rotateToward, type Vec2 } from '../core/math';
import { VIEW } from '../core/viewport';
import type { FireMode } from '../core/runRecord';
import type { Enemy } from '../entities/enemy';
import type { Projectiles } from './projectiles';

/** Что карты инженера сделали со стволом игрока. */
export interface WeaponMods {
  /** Множитель интервала: меньше единицы — чаще выстрелы. */
  fireIntervalMult: number;
  /** Прибавка к урону пули: база слабая, силу дают карты. */
  damage: number;
  pierce: number;
  /** Радиус разрыва как доля меньшей стороны поля. */
  explosiveRadiusFactor: number;
  /**
   * Дальность автонаводки как доля меньшей стороны поля. База берётся из tuning,
   * а таланты инженера её увеличивают — так дальний бой становится покупкой, а
   * не бесплатной настройкой.
   */
  targetRangeFactor: number;
}

/**
 * Оружие игрока: наводка, темп и выстрел. Снаряды живут в общем пуле
 * (Projectiles) вместе с выстрелами турелей и духов — так попадание, пробивание
 * и разрыв считаются в одном месте, а не тремя похожими кусками кода.
 */
/** Сколько миллисекунд летит пуля, чтобы пройти заданное расстояние. */
function msForRange(distance: number): number {
  return (distance / TUNING.weapon.projectileSpeed) * 1000 * TUNING.weapon.rangeLifePad;
}

export class Weapon {
  private readonly manualDir: Vec2 = { x: 1, y: 0 };
  private readonly desiredDir: Vec2 = { x: 1, y: 0 };
  private aimDir: Vec2 = { x: 1, y: 0 };
  private cooldownMs = 0;

  /** Интервал между выстрелами с учётом карт. */
  get fireIntervalMs(): number {
    return this.cooldownInterval;
  }

  private cooldownInterval: number = TUNING.weapon.fireIntervalMs;

  /**
   * Один шаг фиксированной длины. Стрельба и попадания разведены: этот метод
   * только стреляет, а полёт снарядов считает Projectiles.step — порядок в
   * игровом шаге задаёт сцена.
   */
  step(
    dt: number,
    playerPos: Vec2,
    aimPoint: Vec2,
    firing: boolean,
    mode: FireMode,
    enemies: Enemy[],
    shots: Projectiles,
    mods: WeaponMods,
  ): void {
    // Цель ищется ОДИН раз на шаг: по ней же решается, стрелять ли вообще.
    const target = this.pickTarget(playerPos, enemies, mods.targetRangeFactor);
    const dir = this.resolveAim(dt, playerPos, aimPoint, mode, target);

    this.cooldownInterval = Math.max(
      TUNING.weapon.minFireIntervalMs,
      TUNING.weapon.fireIntervalMs * mods.fireIntervalMult,
    );

    this.cooldownMs -= dt * 1000;
    // Нет врага в дальности — нет выстрела. В авто-режиме огонь был включён
    // принудительно, поэтому игрок стрелял всегда, в том числе в пустоту; в
    // ручном направление задаёт курсор, но условие «есть цель» действует и там
    // — иначе это то же самое «палю в никуда».
    if (firing && target !== null && this.cooldownMs <= 0) {
      shots.spawn(
        playerPos,
        dir,
        {
          speed: TUNING.weapon.projectileSpeed,
          damage: TUNING.weapon.projectileDamage + mods.damage,
          // Дальность боя одному числу — и пуле, и наводке. Тогда дальний
          // талант действительно удлиняет бой (и в ручном режиме тоже: там
          // дальность задаёт именно пуля), а не рисует обещание на бумаге.
          lifeMs: msForRange(mods.targetRangeFactor * VIEW.minSide),
          pierce: mods.pierce,
          explosiveRadius: mods.explosiveRadiusFactor * VIEW.minSide,
        },
        TUNING.player.radius + 1,
      );
      this.cooldownMs = this.cooldownInterval;
    }
  }

  reset(): void {
    this.cooldownMs = 0;
    this.aimDir = { x: 1, y: 0 };
  }

  /** Куда направлен ствол в этом шаге. */
  private resolveAim(
    dt: number,
    playerPos: Vec2,
    aimPoint: Vec2,
    mode: FireMode,
    target: Enemy | null,
  ): Vec2 {
    if (mode === 'auto') {
      if (target) {
        this.desiredDir.x = target.pos.x - playerPos.x;
        this.desiredDir.y = target.pos.y - playerPos.y;
      } else {
        // Цели нет — ствол просто держит прежнее направление.
        this.desiredDir.x = this.aimDir.x;
        this.desiredDir.y = this.aimDir.y;
      }
      const maxRadians = Phaser.Math.DegToRad(TUNING.autoFire.aimTurnRateDegPerSec) * dt;
      this.aimDir = rotateToward(this.aimDir, this.desiredDir, maxRadians);
      return this.aimDir;
    }

    const dx = aimPoint.x - playerPos.x;
    const dy = aimPoint.y - playerPos.y;
    const len = Math.hypot(dx, dy) || 1;
    this.manualDir.x = dx / len;
    this.manualDir.y = dy / len;
    return this.manualDir;
  }

  /**
   * Строго ближайший враг в пределах дальности. При равном расстоянии
   * выигрывает первый в массиве — а порядок врагов задаётся сидом, поэтому
   * выбор цели полностью детерминирован.
   */
  private pickTarget(playerPos: Vec2, enemies: Enemy[], rangeFactor: number): Enemy | null {
    let best: Enemy | null = null;
    const range = rangeFactor * VIEW.minSide;
    let bestDist2 = range * range;
    for (const e of enemies) {
      const dx = e.pos.x - playerPos.x;
      const dy = e.pos.y - playerPos.y;
      const dist2 = dx * dx + dy * dy;
      if (dist2 < bestDist2) {
        bestDist2 = dist2;
        best = e;
      }
    }
    return best;
  }
}
