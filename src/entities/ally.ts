import Phaser from 'phaser';
import { TUNING } from '../config/tuning';
import { clampToBounds, type Vec2 } from '../core/math';
import { VIEW } from '../core/viewport';
import { canAfford, spend, type Charge } from '../systems/charge';
import type { Projectiles } from '../systems/projectiles';
import type { Enemy } from './enemy';

export type AllyKind = 'turret' | 'drone' | 'spirit' | 'mote';

/** У каждой роли свой цвет: спутника надо отличать от врага с одного взгляда. */
const ALLY_COLOR: Record<AllyKind, number> = {
  turret: 0x8ef0b0,
  drone: 0xe879f9,
  spirit: 0xa78bfa,
  mote: 0xfca5f5,
};

/**
 * Роли разделены намеренно, и это главное правило баланса спутников:
 *  - КРЫЛЬЯ (дух, мот) ходят с игроком и работают, пока он играет;
 *  - УСТРОЙСТВА (турель, дрон) стоят/кружат сами и работают всегда.
 * Иначе весь смысл игры сводится к «поставь и стой» — а это не игра.
 */
const WING_KINDS: readonly AllyKind[] = ['spirit', 'mote'];

/**
 * Ходит ли спутник в крыле (тогда ему нужен слот строя). Устройства живут
 * отдельно: турель стоит, где поставили, дрон кружит на своём поводке.
 */
export function isWingKind(kind: AllyKind): boolean {
  return WING_KINDS.includes(kind);
}

export interface AllyContext {
  playerPos: Vec2;
  /** Куда смотрит игрок: от этого направления строится крыло. */
  playerFacing: Vec2;
  /** Игрок в бою (двигался или уходил в дэш недавно). false — крылья гаснут. */
  playerActive: boolean;
  enemies: Enemy[];
  shots: Projectiles;
  /** Единственный путь смерти врага: отсюда же приходит учёт опыта. */
  damage(enemy: Enemy, amount: number): void;
  /** Общий запас Тока: без него фигура не действует вовсе. */
  charge: Charge;
  /** Первый отказ из-за пустого пула: сцена показывает тост ровно один раз. */
  onDry(): void;
  /** Множители темпа из карт: механик ускоряет турели, суммонер — духов. */
  turretRateMult: number;
  spiritRateMult: number;
  /** Множитель цены действий: карта экономии делает Ток дешевле. */
  costMult: number;
  /** Сцена узнаёт о каждой удачной трате: без этого телеметрия не сойдётся. */
  onSpend(cost: number): void;
  /** Крос-карты ЭНЕРГЕТИК×МЕХАНИК и ЭНЕРГЕТИК×СУММОНЕР: пробивание. */
  turretPierce: number;
  spiritPierce: number;
  /** Крос МЕХАНИК×СУММОНЕР. */
  moteFastRechase: boolean;
}

/**
 * Спутник или устройство. Одна сущность на четыре роли: различаются они
 * поведением в step, а не устройством класса — так у них общий путь попаданий,
 * общая отрисовка и одна точка правки, если поменяются правила.
 *
 * Все дистанции считаются от меньшей стороны поля: спутники обязаны оставаться
 * в кадре на любом экране, а не улетать за край узкого.
 */
export class Ally {
  readonly kind: AllyKind;
  readonly pos: Vec2;

  private readonly arc: Phaser.GameObjects.Arc;
  /** Сторона строя: +1 — правое крыло, -1 — левое. */
  private readonly slotSide: number;
  /** Ранг в крыле: 0 — ближний к игроку, 1 — дальний. */
  private readonly slotRank: number;
  /** Точка строя этого шага. Переиспользуется: в игровом шаге нет аллокаций. */
  private readonly slotTarget: Vec2 = { x: 0, y: 0 };
  /** Угол орбиты: остался только у дрона-мины, она кружит на коротком поводке. */
  private angle: number;
  private cooldownMs = 0;
  /** Дрон и мот после срабатывания уходят на перезарядку. */
  private rearmMs = 0;
  /** Игрок встал — крыло сейчас не работает. Отдельно от перезарядки: причины видны по разному. */
  private idle = false;
  /** Пул пуст: фигура тускнеет, чтобы причина читалась без текста. */
  private dry = false;
  /**
   * Остаток паузы между учтёнными отказами. Голодная фигура переспрашивает
   * каждый шаг симуляции (120 раз в секунду), но отказ — это СОБЫТИЕ: одна
   * неоплаченная попытка действия. Без паузы отчёты показывали 8559 отказов за
   * 67 секунд — на порядок больше, чем было бы выстрелов, и баланс считался бы
   * по мусору. Пауза равна собственному интервалу роли, поэтому число отказов
   * равно числу потерянных действий.
   */
  private refuseGateMs = 0;
  private target: Enemy | null = null;

  constructor(scene: Phaser.Scene, kind: AllyKind, slot: number, at: Vec2) {
    this.kind = kind;
    this.pos = { x: at.x, y: at.y };
    this.slotSide = slot % 2 === 0 ? 1 : -1;
    this.slotRank = Math.floor(slot / 2);
    this.angle = slot * TUNING.ally.orbitSlotAngleRad;
    this.rearmMs = 0;

    this.arc = scene.add.circle(at.x, at.y, this.radius, ALLY_COLOR[kind]).setDepth(11);
    // Кольцо отличает устройства от врагов даже боковым зрением.
    if (kind === 'turret') this.arc.setStrokeStyle(1, 0x2f6f4f);
  }

  get radius(): number {
    switch (this.kind) {
      case 'turret':
        return TUNING.ally.turretRadius;
      case 'drone':
        return TUNING.ally.droneRadius;
      case 'spirit':
        return TUNING.ally.spiritRadius;
      case 'mote':
        return TUNING.ally.moteRadius;
    }
  }

  /** Один шаг фиксированной длины. */
  step(dt: number, ctx: AllyContext): void {
    const ms = dt * 1000;
    this.cooldownMs -= ms;
    this.rearmMs = Math.max(0, this.rearmMs - ms);
    this.refuseGateMs = Math.max(0, this.refuseGateMs - ms);
    // Крылья работают только в бою: спутники не должны выигрывать забег вместо игрока.
    this.idle = !ctx.playerActive && WING_KINDS.includes(this.kind);
    this.dry = false;

    switch (this.kind) {
      case 'turret':
        this.stepTurret(ctx);
        break;
      case 'spirit':
        this.stepSpirit(dt, ctx);
        break;
      case 'drone':
        this.stepDrone(dt, ctx);
        break;
      case 'mote':
        this.stepMote(dt, ctx);
        break;
    }
  }

  render(): void {
    this.arc.setPosition(this.pos.x, this.pos.y);
    // Тусклый спутник — тот, что сейчас не работает: перезарядка или игрок встал.
    this.arc.setAlpha(this.rearmMs > 0 || this.idle || this.dry ? 0.3 : 1);
  }

  destroy(): void {
    this.arc.destroy();
  }

  /** Турель стоит на месте и сама выбирает цель в своём радиусе. */
  private stepTurret(ctx: AllyContext): void {
    if (this.cooldownMs > 0) return;

    const enemy = this.nearestEnemy(ctx, TUNING.ally.turretRangeFactor * VIEW.minSide);
    if (!enemy) return;

    if (!this.pay(ctx, TUNING.charge.costTurret)) {
      this.refuse(ctx, TUNING.ally.turretFireIntervalMs * ctx.turretRateMult);
      return;
    }

    this.shootAt(
      enemy,
      ctx,
      {
        speed: TUNING.ally.turretShotSpeed,
        damage: TUNING.ally.turretDamage,
      },
      ctx.turretPierce,
    );
    this.cooldownMs = TUNING.ally.turretFireIntervalMs * ctx.turretRateMult;
  }

  /** Дух ходит в крыле игрока и стреляет по ближайшей цели. */
  private stepSpirit(dt: number, ctx: AllyContext): void {
    this.followSlot(dt, ctx);
    if (this.idle) return;
    if (this.cooldownMs > 0) return;

    const enemy = this.nearestEnemy(ctx, TUNING.ally.spiritRangeFactor * VIEW.minSide, true);
    if (!enemy) return;

    if (!this.pay(ctx, TUNING.charge.costSpirit)) {
      this.refuse(ctx, TUNING.ally.spiritFireIntervalMs * ctx.spiritRateMult);
      return;
    }

    this.shootAt(
      enemy,
      ctx,
      {
        speed: TUNING.ally.spiritShotSpeed,
        damage: TUNING.ally.spiritDamage,
      },
      ctx.spiritPierce,
    );
    this.cooldownMs = TUNING.ally.spiritFireIntervalMs * ctx.spiritRateMult;
  }

  /** Дрон-мина кружит рядом и взрывается о первого подошедшего. */
  private stepDrone(dt: number, ctx: AllyContext): void {
    this.angle += TUNING.ally.droneOrbitSpeedRadPerSec * dt;
    this.orbit(ctx.playerPos, TUNING.ally.droneOrbitFactor * VIEW.minSide);

    if (this.rearmMs > 0) return;

    for (const e of ctx.enemies) {
      const reach = this.radius + e.radius;
      const dx = e.pos.x - this.pos.x;
      const dy = e.pos.y - this.pos.y;
      if (dx * dx + dy * dy <= reach * reach) {
        // Мина без Тока не разряжается: остаётся заряженной и ждёт следующего контакта.
        if (!this.pay(ctx, TUNING.charge.costDrone)) {
          this.refuse(ctx, TUNING.ally.droneRearmMs);
          return;
        }
        ctx.damage(e, TUNING.ally.droneDamage);
        this.rearmMs = TUNING.ally.droneRearmMs;
        return;
      }
    }
  }

  /**
   * Мот стаи: сам летит к врагу и жалит. Цель потеряна — возвращается на
   * орбиту и ждёт переформирования, поэтому стая не «тратится» навсегда.
   */
  private stepMote(dt: number, ctx: AllyContext): void {
    if (
      this.rearmMs > 0 ||
      this.idle ||
      !this.target ||
      // Труп остаётся в списке до resolveKills: без этой проверки мот летел бы
      // к уже убитому врагу и жалил пустоту вместо живого.
      this.target.hp <= 0 ||
      !ctx.enemies.includes(this.target)
    ) {
      // Цель потеряна — ищем новую сами и возвращаемся в своё крыло. Без этого
      // мот после первого врага кружил бы рядом до конца забега без дела.
      const candidate = this.idle
        ? null
        : this.nearestEnemy(ctx, TUNING.ally.moteChaseRangeFactor * VIEW.minSide);
      // Цель есть, а укус нечем оплатить — вот это и есть «фигуры без питания».
      // Без этого сигнала мот просто висел бы в крыле, и голодный выводок ничем
      // не отличался бы от сытого.
      if (candidate && !this.canPay(ctx, TUNING.charge.costMote)) {
        this.refuse(ctx, TUNING.ally.moteRearmMs);
        this.target = null;
      } else {
        this.target = candidate;
      }
      this.followSlot(dt, ctx);
      return;
    }

    const dx = this.target.pos.x - this.pos.x;
    const dy = this.target.pos.y - this.pos.y;
    const dist = Math.hypot(dx, dy) || 1;
    const reach = this.radius + this.target.radius;

    if (dist <= reach) {
      if (!this.pay(ctx, TUNING.charge.costMote)) {
        this.refuse(ctx, TUNING.ally.moteRearmMs);
        this.target = null;
        this.followSlot(dt, ctx);
        return;
      }
      ctx.damage(this.target, TUNING.ally.moteDamage);
      // Крос МЕХАНИК×СУММОНЕР: рой не расходится на переформирование — мот той
      // же секундой ищет следующего. Без кроса — прежняя пауза на восстановление.
      this.target = ctx.moteFastRechase
        ? this.nearestEnemy(ctx, TUNING.ally.moteChaseRangeFactor * VIEW.minSide)
        : null;
      this.rearmMs = ctx.moteFastRechase ? 0 : TUNING.ally.moteRearmMs;
      return;
    }

    const step = TUNING.ally.moteSpeed * dt;
    this.pos.x += (dx / dist) * step;
    this.pos.y += (dy / dist) * step;
    clampToBounds(this.pos, this.radius, VIEW.w, VIEW.h);
  }

  /**
   * Отказ из-за пустого пула: фигура тускнеет, а сцена узнаёт о потере действия.
   *
   * Тускнеть фигура обязана каждый шаг голода — это её вид. А вот сообщать об
   * отказе чаще, чем сама могла бы действовать, нельзя: переспрос идёт 120 раз в
   * секунду, и счётчик превращался бы в меру скорости симуляции. Пауза приходит
   * аргументом и равна интервалу роли: турель переспрашивает по своему темпу,
   * мот — по своему, и каждый отказ соответствует одному потерянному действию.
   */
  private refuse(ctx: AllyContext, gateMs: number): void {
    this.dry = true;
    if (this.refuseGateMs > 0) return;
    this.refuseGateMs = gateMs;
    ctx.onDry();
  }

  /**
   * Единственная точка оплаты действия: цена умножается на карту экономии, а
   * сцена узнаёт о каждой удачной трате. Через неё проходят все четыре роли —
   * иначе телеметрия считала бы только часть расходов.
   */
  private pay(ctx: AllyContext, cost: number): boolean {
    const price = cost * ctx.costMult;
    if (!spend(ctx.charge, price)) return false;
    ctx.onSpend(price);
    return true;
  }

  private canPay(ctx: AllyContext, cost: number): boolean {
    return canAfford(ctx.charge, cost * ctx.costMult);
  }

  private nearestEnemy(ctx: AllyContext, range: number, allowDistanceZero = false): Enemy | null {
    let best: Enemy | null = null;
    let bestDist2 = range * range;
    for (const e of ctx.enemies) {
      // Мёртвых не выбираем: иначе выстрел или бросок уходил бы в труп.
      if (e.hp <= 0) continue;
      const dx = e.pos.x - this.pos.x;
      const dy = e.pos.y - this.pos.y;
      const dist2 = dx * dx + dy * dy;
      if (allowDistanceZero ? dist2 <= bestDist2 : dist2 < bestDist2) {
        bestDist2 = dist2;
        best = e;
      }
    }
    return best;
  }

  /**
   * Выстрел по цели. pierce — крос-карта энергии: союзник бьёт насквозь.
   * Разрывов у выводка нет вовсе: разрывные снаряды были привилегией ствола,
   * а ствола в забеге больше нет.
   */
  private shootAt(
    enemy: Enemy,
    ctx: AllyContext,
    shot: { speed: number; damage: number },
    pierce: number,
  ): void {
    const dx = enemy.pos.x - this.pos.x;
    const dy = enemy.pos.y - this.pos.y;
    const len = Math.hypot(dx, dy) || 1;
    ctx.shots.spawn(
      this.pos,
      { x: dx / len, y: dy / len },
      {
        speed: shot.speed,
        damage: shot.damage,
        lifeMs: TUNING.shots.allyShotLifeMs,
        pierce,
        explosiveRadius: 0,
      },
      this.radius + 1,
    );
  }

  /**
   * Крыло строится по бокам от направления взгляда игрока. Спутник больше не
   * облетает его по кругу: круг собирал все цели сам, и забег выигрывался
   * стоянием. Фланг же приходится разворачивать — поворот теперь оружие, а не
   * украшение. Догоняет крыло с отставанием, поэтому читается как ведомый.
   */
  private followSlot(dt: number, ctx: AllyContext): void {
    const dist =
      (this.slotRank === 0 ? TUNING.ally.flankNearFactor : TUNING.ally.flankFarFactor) *
      VIEW.minSide;
    const f = ctx.playerFacing;
    const len = Math.hypot(f.x, f.y) || 1;
    const fx = f.x / len;
    const fy = f.y / len;
    // Перпендикуляр к взгляду — это и есть «бок».
    const px = -fy * this.slotSide;
    const py = fx * this.slotSide;
    // Третий и дальше идут не шире, а ЗА спину: расширяться некуда — поле узкое,
    // и крайние крылья упёрлись бы в стену.
    const rows = this.slotRank >= 2 ? (this.slotRank - 1) * TUNING.ally.flankRowGapFactor : 0;
    const back = (TUNING.ally.flankBackFactor + rows) * VIEW.minSide;

    this.slotTarget.x = ctx.playerPos.x + px * dist - fx * back;
    this.slotTarget.y = ctx.playerPos.y + py * dist - fy * back;

    const dx = this.slotTarget.x - this.pos.x;
    const dy = this.slotTarget.y - this.pos.y;
    const gap = Math.hypot(dx, dy);
    if (gap < 0.5) return;

    const step = Math.min(gap, TUNING.ally.flankFollowSpeed * dt);
    this.pos.x += (dx / gap) * step;
    this.pos.y += (dy / gap) * step;
    clampToBounds(this.pos, this.radius, VIEW.w, VIEW.h);
  }

  private orbit(center: Vec2, radius: number): void {
    this.pos.x = center.x + Math.cos(this.angle) * radius;
    this.pos.y = center.y + Math.sin(this.angle) * radius;
    clampToBounds(this.pos, this.radius, VIEW.w, VIEW.h);
  }
}
