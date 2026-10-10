import { TUNING } from '../config/tuning';
import { kindsForLevel, type EnemyKind, type EnemyKindId } from '../config/enemyKinds';
import type { RunMode } from '../core/runRecord';
import type { Rng } from '../core/rng';

/**
 * Режиссёр спавна: решает, КТО появится следующим.
 *
 * Раньше этот вопрос решался одной строкой — «новый враг под текущий уровень», —
 * и вид у врага был единственный. С появлением четырёх видов выбор стал
 * решением: держать кольцо окружения (для него нужны погонялы) против того,
 * чтобы давить на игрока разными угрозами.
 *
 * Модуль чистый: ни Phaser, ни времени, ни состояния сцены. Всё случайное идёт
 * через сид забега, поэтому прогон воспроизводим, а записи прогонов сравнимы.
 */
export type EliteModifier = 'shielded' | 'swift' | 'volatile';

export interface SpawnPick {
  kind: EnemyKindId;
  /** Свойство элиты или null: элита — это ВИД ПЛЮС одно свойство, не отдельный вид. */
  elite: EliteModifier | null;
}

/** Порядок свойств фиксирован: по нему сид однозначно выбирает свойство. */
export const ELITE_MODIFIERS: readonly EliteModifier[] = ['shielded', 'swift', 'volatile'];

/**
 * Потолок не-погонял на поле. Без него поле заполонят стрелки и танки, кольцо
 * окружения исчезнет, и игра превратится в уклонение от пуль вместо охоты:
 * погоняла — единственный вид, который занимает слот на кольце.
 */
export function nonChaserCap(alive: number): number {
  return Math.max(1, Math.ceil(alive / 3));
}

/**
 * Сколько лишних попаданий держит элита. Щит — запас поверх HP вида, поэтому
 * считается отдельно и складывается с множителем HP, а не вместо него.
 */
export function eliteHpBonus(mod: EliteModifier): number {
  return mod === 'shielded' ? 2 : 0;
}

/** Множитель скорости элиты: «быстрый» и есть быстрый, остальные не ускоряются. */
export function eliteSpeedMult(mod: EliteModifier): number {
  return mod === 'swift' ? 1.35 : 1;
}

/** Взвешенный выбор вида. Ролл идёт от нуля: при rng() === 0 берётся первый вид. */
function pickKind(level: number, rng: Rng): EnemyKind {
  const available = kindsForLevel(level);
  let total = 0;
  for (const kind of available) total += kind.spawnWeight;
  let roll = rng() * total;
  for (const kind of available) {
    roll -= kind.spawnWeight;
    if (roll < 0) return kind;
  }
  return available[available.length - 1];
}

function pickElite(level: number, mode: RunMode, rng: Rng): EliteModifier | null {
  if (level < TUNING.enemy.eliteMinLevel) return null;
  if (rng() >= TUNING.enemyPressure[mode].eliteChance) return null;
  const index = Math.floor(rng() * ELITE_MODIFIERS.length);
  return ELITE_MODIFIERS[Math.min(index, ELITE_MODIFIERS.length - 1)];
}

/**
 * Кто появляется следующим.
 *
 * Порядок правил важен: сначала «держать кольцо» (мало живых — только погоняла),
 * потом потолок не-погонял, и лишь потом взвешенный выбор среди видов, которые
 * уже открыты уровнем. Иначе на первом же уровне игрок мог получить лотерею из
 * четырёх угроз сразу.
 */
export function pickSpawn(
  level: number,
  mode: RunMode,
  alive: number,
  nonChasers: number,
  rng: Rng,
): SpawnPick {
  const elite = pickElite(level, mode, rng);

  // Держать кольцо важнее разнообразия: с одним врагом на поле игрок должен
  // получать именно того, кто его окружает, иначе окружения не будет вообще.
  if (alive < 2) return { kind: 'charger', elite };

  if (nonChasers >= nonChaserCap(alive)) return { kind: 'charger', elite };

  return { kind: pickKind(level, rng).id, elite };
}

/** Вид элиты отличается от обычного только числами, которые даёт эта пара. */
export function eliteNumbers(mod: EliteModifier | null): { hpBonus: number; speedMult: number } {
  if (mod === null) return { hpBonus: 0, speedMult: 1 };
  return { hpBonus: eliteHpBonus(mod), speedMult: eliteSpeedMult(mod) };
}
