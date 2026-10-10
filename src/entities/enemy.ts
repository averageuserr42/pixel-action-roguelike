import Phaser from 'phaser';
import { TUNING } from '../config/tuning';
import { clampToBounds, type Vec2 } from '../core/math';
import type { RunMode } from '../core/runRecord';
import { VIEW } from '../core/viewport';

export type EnemyState = 'seek' | 'windup' | 'charge' | 'recover';

const STATE_COLOR: Record<EnemyState, number> = {
  seek: 0x6ee7ff,
  windup: 0xff4d6d,
  charge: 0xff9f1c,
  recover: 0x8b86a8,
};

const HIT_FLASH_COLOR = 0xffffff;
/** Обводка врага, который уже перерос базовые числа: сложность видно с одного взгляда. */
const SCALED_STROKE_COLOR = 0xff9f1c;

/**
 * Статы врага на текущем уровне игрока. Здесь и живёт кривая сложности:
 * опыт растёт линейно, поэтому и враг обязан расти вместе с билдом, иначе
 * прогрессия игрока работает против сложности, а не с ней.
 */
export function enemyHpForLevel(level: number): number {
  const steps = Math.floor(Math.max(0, level - 1) / TUNING.enemy.hpStepLevels);
  return Math.min(TUNING.enemy.maxHp + steps * TUNING.enemy.hpPerStep, TUNING.enemy.hpCap);
}

export function enemyChargeSpeedForLevel(level: number, mode: RunMode): number {
  const p = TUNING.enemyPressure[mode];
  const raw = p.chargeSpeed + Math.max(0, level - 1) * p.chargeSpeedPerLevel;
  return Math.min(raw, p.chargeSpeedCap);
}

/**
 * Сколько врагов держим на поле одновременно. Раньше этот вопрос решался сам
 * собой: новый враг появлялся только после смерти предыдущего, поэтому поле
 * пустовало, а стоящий игрок ничего не терял. Теперь число врагов — решение
 * дизайна, привязанное к уровню, и оно общее для спавна и для проверки.
 */
export function enemyTargetCount(level: number, mode: RunMode): number {
  const p = TUNING.enemyPressure[mode];
  const extra = Math.floor(Math.max(0, level - 1) / p.extraEnemyEveryLevels);
  return Math.min(p.baseEnemies + extra, p.maxEnemies);
}

export class Enemy {
  readonly arc: Phaser.GameObjects.Arc;
  readonly pos: Vec2;
  /** HP на момент появления: константа врага, а не «сколько осталось». */
  readonly maxHp: number;
  /**
   * Личный сдвиг для разброса первой паузы перед рывком: иначе тройка,
   * появившаяся одновременно, бьёт залпом в один кадр, и уклонение
   * превращается в лотерею. Углы слотов он больше не трогает: случайный
   * сдвиг ломал ровный строй, и враги собирались в один сектор.
   */
  readonly orbitJitter: number;

  hp: number;

  private readonly chargeSpeed: number;
  private readonly seekSpeed: number;
  private readonly windupMs: number;
  private readonly windupRange: number;
  private readonly chargeCooldownMs: number;
  /**
   * Точка прицела замаха: где игрок будет к концу телеграфа. Целиться в текущую
   * точку бессмысленно — за телеграф игрок смещается вбок, и выпад уходил в
   * пустоту (замер: уклонение в 90% случаев без чтения угрозы).
   */
  private readonly aim: Vec2 = { x: 0, y: 0 };
  private state: EnemyState = 'seek';
  /** Личный слот на кольце. Доворачивается к назначенному сцене углу. */
  private slotAngle = 0;
  private slotReady = false;
  /**
   * Куда идти наперерез: точка на маршруте игрока, назначенная сценой. Живёт
   * здесь, а не в сцене, потому что замораживается ПЕРСОНАЛЬНО: пока враг идёт
   * к точке и стоит на ней, она не меняется (движущуюся точку не догнать —
   * она едет со скоростью игрока, а враг медленнее).
   */
  readonly interceptTarget: Vec2 = { x: 0, y: 0 };
  /**
   * Роль перехватчика на этот шаг. Сцена снимает её у всех остальных и НЕ
   * сбрасывает у уже назначенного врага: иначе точка замораживалась бы заново
   * каждый шаг и перехват снова стал бы погоней за движущейся точкой.
   */
  interceptActive = false;
  /**
   * Сколько миллисекунд держится текущая точка перехвата. По истечении срока
   * сцена даёт свежую: застрявший на старом месте караул читался бы как враг,
   * который просто бросил охоту.
   */
  interceptAgeMs = 0;
  private timerMs = 0;
  /** Остаток паузы до следующего рывка. */
  private chargeCdMs = 0;
  private dir: Vec2 = { x: 0, y: 0 };
  private hitFlashMs = 0;

  constructor(scene: Phaser.Scene, at: Vec2, level = 1, mode: RunMode = 'normal', jitter = 0.5) {
    const p = TUNING.enemyPressure[mode];
    this.pos = { x: at.x, y: at.y };
    this.maxHp = enemyHpForLevel(level);
    this.hp = this.maxHp;
    this.chargeSpeed = enemyChargeSpeedForLevel(level, mode);
    this.seekSpeed = p.seekSpeed;
    this.windupMs = p.windupMs;
    this.windupRange = p.windupRangeFactor * VIEW.minSide;
    this.chargeCooldownMs = p.chargeCooldownMs;
    this.orbitJitter = jitter * Math.PI * 2;
    this.chargeCdMs = jitter * p.chargeCooldownMs;
    this.arc = scene.add.circle(at.x, at.y, TUNING.enemy.radius, STATE_COLOR.seek).setDepth(9);
    if (this.maxHp > TUNING.enemy.maxHp) this.arc.setStrokeStyle(1, SCALED_STROKE_COLOR);
  }

  get radius(): number {
    return TUNING.enemy.radius;
  }

  get enemyState(): EnemyState {
    return this.state;
  }

  /**
   * Наносит урон. true — если враг погиб ИМЕННО от этого попадания.
   *
   * Повторный урон по уже мёртвому возвращает false: иначе одну смерть можно
   * было бы посчитать дважды (две пули в одном шаге, разрыв поверх попадания),
   * и опыт начислялся бы за каждого, кто добил труп.
   */
  hit(damage: number): boolean {
    if (this.hp <= 0) return false;
    this.hp -= damage;
    this.hitFlashMs = TUNING.enemy.hitFlashMs;
    return this.hp <= 0;
  }

  /**
   * Один шаг фиксированной длины. slotAngle — куда врагу положено встать на
   * кольце вокруг игрока; считает его сцена, потому что только она знает,
   * сколько врагов сейчас живо. playerVel — для упреждения: без него погоня
   * идёт за хвостом, и бег по кругу становится бесплатным. У перехватчика
   * (interceptActive) цель другая: назначенная сценой точка на маршруте
   * игрока — кольцо едет вместе с игроком и на вираже его не встречает.
   */
  step(dt: number, playerPos: Vec2, slotAngle: number, playerVel: Vec2): void {
    const ms = dt * 1000;
    this.hitFlashMs = Math.max(0, this.hitFlashMs - ms);
    this.interceptAgeMs += ms;
    this.timerMs -= ms;
    this.chargeCdMs = Math.max(0, this.chargeCdMs - ms);

    // Личный слот доворачивается к назначенному: строй переживает и смерть
    // соседа, и смену порядка по углу без броска в другую сторону.
    if (!this.slotReady) {
      this.slotAngle = slotAngle;
      this.slotReady = true;
    } else {
      const turn = Math.atan2(
        Math.sin(slotAngle - this.slotAngle),
        Math.cos(slotAngle - this.slotAngle),
      );
      this.slotAngle += turn * Math.min(1, TUNING.enemy.slotTurnRadPerSec * dt);
    }

    const dx = playerPos.x - this.pos.x;
    const dy = playerPos.y - this.pos.y;
    const dist = Math.hypot(dx, dy) || 0.001;

    switch (this.state) {
      case 'seek': {
        if (this.interceptActive) {
          // Наперерез: цель — точка на маршруте игрока, назначенная сценой. Идём
          // к ней по прямой (короткий путь по хорде против дуги, по которой бежит
          // игрок) и СТОИМ на ней, пока сцена не сменит точку: тело на маршруте
          // заставляет кайтера тратить рывок, а кольцо его не встречает — оно
          // едет вместе с игроком. Кольцевую логику перехватчик не использует
          // вовсе: стоило отпустить его на радиус кольца — и ветка ниже уводила
          // его с маршрута на орбиту (замер: дэш-бот проходил мимо, ближайшая
          // дистанция 29–37 при 85 у кольца).
          const tdx = this.interceptTarget.x - this.pos.x;
          const tdy = this.interceptTarget.y - this.pos.y;
          const targetDist = Math.hypot(tdx, tdy);
          if (targetDist > 0.5) {
            // Наперерез — это рывок: пока враг идёт к точке, он быстрее игрока,
            // иначе гонку не выиграть (замер: отрыв 163 при скорости ниже).
            // Встал на точку — стоит: спринт кончается вместе с дорогой.
            const sprintSpeed = this.seekSpeed * TUNING.enemy.interceptSprintMult;
            this.pos.x += (tdx / targetDist) * sprintSpeed * dt;
            this.pos.y += (tdy / targetDist) * sprintSpeed * dt;
          }
        } else if (dist > this.windupRange) {
          // Снаружи кольца идём к слоту вокруг ТОЧКИ УПРЕЖДЕНИЯ, а не вокруг
          // самого игрока: погоня за текущей точкой — это погоня за хвостом
          // (замер: 60 секунд бесплатного кайтинга по кругу). Потолок упреждения
          // живёт в tuning (seekLeadFactor): без него враг гонится за
          // недостижимой точкой и висит рядом, не доходя до замаха.
          const leadMs = Math.min(TUNING.enemy.seekLeadMs, (dist / this.seekSpeed) * 1000);
          const speed = Math.hypot(playerVel.x, playerVel.y);
          let leadDist = speed * (leadMs / 1000);
          const maxLeadDist = TUNING.enemy.seekLeadFactor * this.windupRange;
          if (leadDist > maxLeadDist) leadDist = maxLeadDist;
          const leadScale = speed > 1 ? leadDist / speed : 0;
          const anchorX = playerPos.x + playerVel.x * leadScale;
          const anchorY = playerPos.y + playerVel.y * leadScale;
          const targetX = anchorX + Math.cos(this.slotAngle) * this.windupRange;
          const targetY = anchorY + Math.sin(this.slotAngle) * this.windupRange;
          const tdx = targetX - this.pos.x;
          const tdy = targetY - this.pos.y;
          const targetDist = Math.hypot(tdx, tdy);
          if (targetDist > 0.5) {
            this.pos.x += (tdx / targetDist) * this.seekSpeed * dt;
            this.pos.y += (tdy / targetDist) * this.seekSpeed * dt;
          }
        } else {
          // Внутри кольца — обходим игрока ПО КАСАТЕЛЬНОЙ, в сторону своего слота.
          // Радиально отходить нельзя: если после рывка вести врага обратно на
          // кольцо, он отступает от игрока, и стоять становится безопасно
          // (замер: 26 секунд стоянки без единого удара — ровно эта ошибка).
          const rX = -dx / dist;
          const rY = -dy / dist;
          const ownAngle = Math.atan2(rY, rX);
          // Кратчайший разворот к слоту: иначе враг пойдёт по длинной дуге.
          const delta = Math.atan2(
            Math.sin(this.slotAngle - ownAngle),
            Math.cos(this.slotAngle - ownAngle),
          );
          const sign = delta >= 0 ? 1 : -1;
          this.pos.x += (-rY * sign) * this.seekSpeed * dt;
          this.pos.y += (rX * sign) * this.seekSpeed * dt;
        }
        clampToBounds(this.pos, TUNING.enemy.radius, VIEW.w, VIEW.h);

        if (dist <= this.windupRange && this.chargeCdMs <= 0) {
          this.state = 'windup';
          this.timerMs = this.windupMs;
          // Прицел — не в текущую точку, а в точку ВСТРЕЧИ: выпад обязан пройти
          // место, где игрок окажется к его приходу. Стоящая цель за телеграф
          // уходит вбок (замер: 39 единиц за 420 мс), и выпад уходил в пустоту —
          // уклонение превращалось в формальность. Срок встречи решается
          // итерациями: игрок движется, поэтому «где он будет» и «докуда выпад
          // достанет» зависят друг от друга. Смена курса по-прежнему спасает —
          // врёт только прогноз по ПРЯМОЙ.
          let t = 0;
          let aimX = playerPos.x;
          let aimY = playerPos.y;
          for (let i = 0; i < 3; i++) {
            aimX = playerPos.x + playerVel.x * t;
            aimY = playerPos.y + playerVel.y * t;
            const d = Math.hypot(aimX - this.pos.x, aimY - this.pos.y);
            const flight = Math.min(TUNING.enemy.maxChargeMs, (d / this.chargeSpeed) * 1000) / 1000;
            t = this.windupMs / 1000 + flight;
          }
          // Потолок: выпад не должен тянуться через пол-арены.
          const maxAim = TUNING.enemy.windupAimMaxFactor * this.windupRange;
          const adx0 = aimX - this.pos.x;
          const ady0 = aimY - this.pos.y;
          const adist0 = Math.hypot(adx0, ady0) || 0.001;
          if (adist0 > maxAim) {
            aimX = this.pos.x + (adx0 / adist0) * maxAim;
            aimY = this.pos.y + (ady0 / adist0) * maxAim;
          }
          this.aim.x = aimX;
          this.aim.y = aimY;
          const adx = aimX - this.pos.x;
          const ady = aimY - this.pos.y;
          const adist = Math.hypot(adx, ady) || 0.001;
          this.dir = { x: adx / adist, y: ady / adist };
        }
        break;
      }

      case 'windup':
        // Во время замаха враг стоит: движение на телеграфе читалось бы как рывок.
        if (this.timerMs <= 0) {
          this.state = 'charge';
          // Выпад обязан ПРОЙТИ позицию игрока. Фиксированная длительность не
          // доставала с кольца (260 мс ≈ 41 единица против 92), и стоящего
          // игрока нельзя было наказать вообще — замер дал 10 секунд стоянки
          // без единого удара при шести убитых врагах. Считаем по точке прицела:
          // выпад должен пройти и её — тогда упреждение имеет смысл.
          const aimDist = Math.hypot(this.aim.x - this.pos.x, this.aim.y - this.pos.y);
          const reach = Math.max(dist, aimDist) + TUNING.player.radius + this.radius + 4;
          this.timerMs = Math.min(TUNING.enemy.maxChargeMs, (reach / this.chargeSpeed) * 1000);
        }
        break;

      case 'charge':
        this.pos.x += this.dir.x * this.chargeSpeed * dt;
        this.pos.y += this.dir.y * this.chargeSpeed * dt;
        clampToBounds(this.pos, TUNING.enemy.radius, VIEW.w, VIEW.h);
        if (this.timerMs <= 0) {
          this.state = 'recover';
          this.timerMs = TUNING.enemy.recoverMs;
        }
        break;

      case 'recover':
        if (this.timerMs <= 0) {
          this.dir = { x: 0, y: 0 };
          // Восстановление разной длины: одинаковый ритм у всей группы читался бы
          // как метроном, и уклоняться стало бы механически скучно.
          this.chargeCdMs = this.chargeCooldownMs * (0.8 + 0.4 * (this.orbitJitter / (Math.PI * 2)));
          this.state = 'seek';
        }
        break;
    }
  }

  render(): void {
    this.arc.setPosition(this.pos.x, this.pos.y);
    this.arc.setFillStyle(this.hitFlashMs > 0 ? HIT_FLASH_COLOR : STATE_COLOR[this.state]);
    const pulse = this.state === 'windup' ? 1 + 0.35 * Math.sin(this.timerMs * 0.03) : 1;
    this.arc.setScale(pulse);
  }

  destroy(): void {
    this.arc.destroy();
  }
}
