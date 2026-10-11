import type { Vec2 } from '../core/math';
import type { Rng } from '../core/rng';

/**
 * Предметы Тока на поле — источник энергии забега.
 *
 * Их два вида, и различие между ними — это различие двух способов играть:
 *  - БАТАРЕЯ лежит на арене и появляется вдали от игрока: чтобы добыть Ток,
 *    надо двигаться;
 *  - ОСКОЛОК сыплется с убитого врага и живёт считанные секунды: его приносит
 *    урон, но брать его надо там, где сейчас стоят враги.
 *
 * Механика у них общая, поэтому это один модуль и один тип предмета со своими
 * value, ttlMs и radius — а не две сущности с двумя путями подбора. Без осколков
 * доход был фиксированным, а расход рос с каждой фигурой: вложение в урон делало
 * забег голоднее, и все уровни уходили в энергию.
 *
 * Правила держатся здесь, а не в сцене, потому что это и есть решение дизайна:
 * сколько предметов лежит одновременно, как долго они живут и на каком
 * расстоянии появляются. Сцена из этого делает только картинку и подбор.
 *
 * Модуль чистый: времени внутри нет, длительности приходят аргументами, а
 * случайность — сидом забега. Поэтому забег воспроизводим, а правила
 * проверяются тестами без браузера.
 */
export type PickupKind = 'battery' | 'drop';

export interface Pickup {
  x: number;
  y: number;
  kind: PickupKind;
  /** Сколько Тока даёт подбор. */
  value: number;
  /** Сколько предмет живёт: по этому времени решается распад. */
  ttlMs: number;
  /** Видимый радиус. Живёт в предмете, а не в сцене: у осколка он свой. */
  radius: number;
  /** Сколько предмет уже лежит. */
  ageMs: number;
}

export interface PickupField {
  items: Pickup[];
  /** Остаток паузы до следующей батареи. */
  spawnTimerMs: number;
}

/**
 * Что собрал шаг подбора. Источники разведены по Току, а не только по числу
 * предметов: в отчёте нужно видеть, сколько энергии принесли ноги, а сколько —
 * урон. Иначе на вопрос «кормит ли забег билд» ответить нечем.
 */
export interface PickupTally {
  batteries: number;
  /** Сколько Тока дали батареи. */
  batteryTok: number;
  drops: number;
  /** Сколько Тока дали осколки с убитых. */
  dropTok: number;
}

/** Описание появляющегося предмета. Числа приходят из снабжения и tuning. */
export interface PickupSpec {
  kind: PickupKind;
  value: number;
  ttlMs: number;
  radius: number;
}

export function createPickupField(): PickupField {
  return { items: [], spawnTimerMs: 0 };
}

/**
 * Пустой счётчик подбора. Переиспользуется в игровом шаге: подбор идёт каждые
 * 8 мс, и аллокаций там быть не должно.
 */
export function createTally(): PickupTally {
  return { batteries: 0, batteryTok: 0, drops: 0, dropTok: 0 };
}

/**
 * Пора ли выкладывать батарею.
 *
 * Пока места на поле нет, таймер ЗАМИРАЕТ: ни копится, ни сгорает. Копиться ему
 * нельзя — иначе пачка застоявшегося времени выпалила бы несколько батарей сразу,
 * стоило игроку забрать одну. А сгорать нельзя тем более: обнуление превращало
 * спавнер в «одна батарея на каждый подбор», и темп дохода задавал не режим, а
 * скорость игрока — замер ботом на 20 секунд при паузе 2.4 с дал 17 батарей
 * вместо 9. Теперь темп задаёт пауза, а пауза — число из строки снабжения.
 *
 * Предел считает ТОЛЬКО батареи: осколки лежат своим счётом, и урожай с убитых
 * не должен отбирать у забега плановую энергию после удачного боя.
 */
export function takeSpawn(
  field: PickupField,
  dt: number,
  spawnIntervalMs: number,
  maxOnField: number,
): boolean {
  if (countKind(field, 'battery') >= maxOnField) return false;

  field.spawnTimerMs -= dt * 1000;
  if (field.spawnTimerMs > 0) return false;
  field.spawnTimerMs = spawnIntervalMs;
  return true;
}

export function countKind(field: PickupField, kind: PickupKind): number {
  let n = 0;
  for (const item of field.items) if (item.kind === kind) n++;
  return n;
}

export function addPickup(field: PickupField, at: Vec2, spec: PickupSpec): void {
  field.items.push({
    x: at.x,
    y: at.y,
    kind: spec.kind,
    value: spec.value,
    ttlMs: spec.ttlMs,
    radius: spec.radius,
    ageMs: 0,
  });
}

/** Старит предметы и убирает просроченные. Срок жизни у каждого свой. */
export function stepAge(field: PickupField, dt: number): void {
  const ms = dt * 1000;
  let write = 0;
  for (const item of field.items) {
    item.ageMs += ms;
    if (item.ageMs < item.ttlMs) field.items[write++] = item;
  }
  field.items.length = write;
}

/**
 * Подбор: собирает предметы в радиусе и складывает их в счётчик шага.
 *
 * Счётчик обнуляется здесь же: он переиспользуется, и «накопить за шаг» —
 * единственный способ им пользоваться. Проверка идёт по расстоянию до центра
 * игрока, а не до его радиуса: подбор — про тело игрока, а не про точный круг.
 */
export function collect(field: PickupField, at: Vec2, radius: number, out: PickupTally): void {
  out.batteries = 0;
  out.batteryTok = 0;
  out.drops = 0;
  out.dropTok = 0;

  const r2 = radius * radius;
  let write = 0;
  for (const item of field.items) {
    const dx = item.x - at.x;
    const dy = item.y - at.y;
    if (dx * dx + dy * dy <= r2) {
      if (item.kind === 'battery') {
        out.batteries++;
        out.batteryTok += item.value;
      } else {
        out.drops++;
        out.dropTok += item.value;
      }
      continue;
    }
    field.items[write++] = item;
  }
  field.items.length = write;
}

/**
 * Точка появления батареи: внутри поля и не ближе awayRadius к игроку.
 *
 * Расстояние принципиально: батарея под ногами превратила бы Ток в пассивный
 * доход, а забег — в стоянке у одной точки. Если разброс не нашёл места за
 * отведённые попытки (узкое поле, игрок в центре), батарея всё равно кладётся —
 * напротив игрока на границе отступа, лишь бы не пропала.
 */
export function spawnPoint(
  rng: Rng,
  w: number,
  h: number,
  margin: number,
  awayFrom: Vec2,
  awayRadius: number,
): Vec2 {
  const usableW = Math.max(0, w - 2 * margin);
  const usableH = Math.max(0, h - 2 * margin);
  for (let i = 0; i < 12; i++) {
    const x = margin + rng() * usableW;
    const y = margin + rng() * usableH;
    if (Math.hypot(x - awayFrom.x, y - awayFrom.y) >= awayRadius) return { x, y };
  }
  const angle = rng() * Math.PI * 2;
  const far = clamp(awayFrom.x + Math.cos(angle) * awayRadius, margin, w - margin);
  const near = clamp(awayFrom.y + Math.sin(angle) * awayRadius, margin, h - margin);
  return { x: far, y: near };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
