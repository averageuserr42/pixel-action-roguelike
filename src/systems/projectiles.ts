import Phaser from 'phaser';
import { TUNING } from '../config/tuning';
import type { Vec2 } from '../core/math';
import { VIEW } from '../core/viewport';
import type { Enemy } from '../entities/enemy';

const PROJECTILE_COLOR = 0xfff3b0;

/**
 * Параметры выстрела. У каждого снаряда они свои: выстрелы турели и духа
 * живут по своим числам, а крос-карты меняют только пробивание.
 */
export interface ShotSpec {
  speed: number;
  damage: number;
  lifeMs: number;
  /** Сколько врагов снаряд пробьёт насквозь, не считая первого. */
  pierce: number;
  /** Радиус разрыва в игровых единицах. 0 — обычная пуля. */
  explosiveRadius: number;
  /**
   * Враждебный выстрел: бьёт по ИГРОКУ, а не по врагам. Один пул на обе
   * стороны выбран не из экономии: правила полёта и попадания у выстрелов
   * одинаковые, различается только сторона, которую они проверяют.
   */
  hostile?: boolean;
}

export interface HitTargets {
  enemies: Enemy[];
  /** Единственный путь смерти врага: отсюда же приходит и учёт опыта. */
  damage(enemy: Enemy, amount: number): void;
  /** Цель враждебных выстрелов. Нет её — выстрел летит в пустоту. */
  player?: { pos: Vec2; radius: number; hit(): void };
}

interface Projectile {
  arc: Phaser.GameObjects.Arc;
  pos: Vec2;
  vel: Vec2;
  lifeMs: number;
  damage: number;
  pierceLeft: number;
  explosiveRadius: number;
  /** Последний задетый враг: без этого пробивающая пуля выпаливала бы весь
   *  запас пробитий в одну и ту же цель, пока летит сквозь неё. */
  lastHit: Enemy | null;
  hostile: boolean;
  alive: boolean;
}

/**
 * Общий пул снарядов для всех, кто стреляет: турелей и духов.
 *
 * Пул создаётся один раз и дальше только переиспользуется: аллокаций в игровом
 * цикле быть не должно, иначе сборщик мусора даст микрофризы ровно во время боя.
 */
export class Projectiles {
  private readonly items: Projectile[] = [];

  constructor(scene: Phaser.Scene) {
    for (let i = 0; i < TUNING.shots.poolSize; i++) {
      this.items.push({
        arc: scene.add
          .circle(0, 0, TUNING.shots.projectileRadius, PROJECTILE_COLOR)
          .setVisible(false)
          .setDepth(8),
        pos: { x: 0, y: 0 },
        vel: { x: 0, y: 0 },
        lifeMs: 0,
        damage: 0,
        pierceLeft: 0,
        explosiveRadius: 0,
        lastHit: null,
        hostile: false,
        alive: false,
      });
    }
  }

  get active(): number {
    let n = 0;
    for (const p of this.items) if (p.alive) n++;
    return n;
  }

  /** Выстрел из точки from в направлении dir. muzzle — насколько вынести ствол вперёд. */
  spawn(from: Vec2, dir: Vec2, spec: ShotSpec, muzzle = 1): void {
    let free: Projectile | null = null;
    for (const p of this.items) {
      if (!p.alive) {
        free = p;
        break;
      }
    }
    // Пул исчерпан — выстрел просто пропускается, а не ломает игровой цикл.
    if (!free) return;

    free.alive = true;
    free.lifeMs = spec.lifeMs;
    free.damage = spec.damage;
    free.pierceLeft = spec.pierce;
    free.explosiveRadius = spec.explosiveRadius;
    free.lastHit = null;
    free.hostile = spec.hostile === true;
    free.pos.x = from.x + dir.x * muzzle;
    free.pos.y = from.y + dir.y * muzzle;
    free.vel.x = dir.x * spec.speed;
    free.vel.y = dir.y * spec.speed;
    free.arc.setPosition(free.pos.x, free.pos.y).setVisible(true);
  }

  /**
   * Один шаг фиксированной длины: движение, попадания, пробивание и разрывы.
   * Разрушением погибших врагов занимается сцена — здесь только урон.
   */
  step(dt: number, targets: HitTargets): void {
    const ms = dt * 1000;

    for (const p of this.items) {
      if (!p.alive) continue;

      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      p.lifeMs -= ms;

      let dead = p.lifeMs <= 0;
      if (p.pos.x < 0 || p.pos.y < 0 || p.pos.x > VIEW.w || p.pos.y > VIEW.h) {
        dead = true;
      }

      if (!dead && p.hostile) {
        const player = targets.player;
        if (player) {
          const dx = player.pos.x - p.pos.x;
          const dy = player.pos.y - p.pos.y;
          const r = TUNING.shots.projectileRadius + player.radius;
          if (dx * dx + dy * dy <= r * r) {
            player.hit();
            dead = true;
          }
        }
      }

      if (!dead && !p.hostile) {
        const enemy = this.enemyAt(p, targets.enemies);
        if (enemy) {
          targets.damage(enemy, p.damage);
          p.lastHit = enemy;

          if (p.explosiveRadius > 0) this.explode(p, targets);

          if (p.pierceLeft > 0) {
            p.pierceLeft--;
            // Пуля идёт дальше: пробивание — это право не останавливаться.
          } else {
            dead = true;
          }
        }
      }

      if (dead) {
        p.alive = false;
        p.arc.setVisible(false);
      } else {
        p.arc.setPosition(p.pos.x, p.pos.y);
      }
    }
  }

  /**
   * Обход живых снарядов для визуального слоя. Числами, а не объектом: следы
   * рисуются каждый кадр, и аллокаций на кадр здесь быть не должно.
   */
  each(visit: (x: number, y: number, vx: number, vy: number) => void): void {
    for (const p of this.items) {
      if (p.alive) visit(p.pos.x, p.pos.y, p.vel.x, p.vel.y);
    }
  }

  reset(): void {
    for (const p of this.items) {
      p.alive = false;
      p.arc.setVisible(false);
    }
  }

  destroy(): void {
    for (const p of this.items) p.arc.destroy();
    this.items.length = 0;
  }

  /** Первый враг, в которого попал снаряд (не тот, кого он задел шагом раньше). */
  private enemyAt(p: Projectile, enemies: Enemy[]): Enemy | null {
    const reach = TUNING.shots.projectileRadius;
    for (const e of enemies) {
      if (e === p.lastHit) continue;
      // Труп живёт в списке до resolveKills: без этой проверки пробивающая пуля
      // тратила бы запас пробитий на уже убитого врага.
      if (e.hp <= 0) continue;
      const dx = e.pos.x - p.pos.x;
      const dy = e.pos.y - p.pos.y;
      const r = reach + e.radius;
      if (dx * dx + dy * dy <= r * r) return e;
    }
    return null;
  }

  /** Разрыв: урон всем вокруг точки попадания, кроме цели, которая уже получила своё. */
  private explode(p: Projectile, targets: HitTargets): void {
    const r2 = p.explosiveRadius * p.explosiveRadius;
    for (const e of targets.enemies) {
      if (e === p.lastHit) continue;
      const dx = e.pos.x - p.pos.x;
      const dy = e.pos.y - p.pos.y;
      if (dx * dx + dy * dy <= r2) targets.damage(e, p.damage);
    }
  }
}
