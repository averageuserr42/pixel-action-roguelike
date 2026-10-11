import { TUNING } from '../config/tuning';
import type { RunMode } from '../core/runRecord';

/**
 * Снабжение Током на текущем уровне игрока.
 *
 * Модуль существует потому, что доход — это кривая, а не константа. Замер двух
 * забегов (хардкор 67 с, обычный 36 с) дал одинаковые 2.0 Ток/с при разных
 * билдах: доход полностью задавали правила появления батарей. А расход растёт
 * линейно — каждая фигура платит за каждый свой выстрел, а враг дорожает с
 * уровнем. Фиксированный доход против растущего расхода и есть причина, по
 * которой все уровни уходили в энергию: любая карта урона делала забег голоднее.
 *
 * Поэтому числа снабжения живут здесь и считаются от уровня. Модуль чистый —
 * ни Phaser, ни времени: правила проверяются тестами без браузера, а забег
 * остаётся воспроизводимым по сиду.
 */
export interface Supply {
  /** Сколько Тока даёт одна батарея. */
  batteryValue: number;
  /** Пауза между появлениями батарей: она и задаёт темп дохода. */
  spawnIntervalMs: number;
  /** Сколько батарей помещается на поле — запас на «не успел подобрать». */
  onField: number;
  /** Сколько Тока даёт осколок с убитого: урон тоже кормит выводок. */
  dropValue: number;
  /** Окно подбора осколка. */
  dropTtlMs: number;
}

/**
 * Правила снабжения для режима на уровне. Уровень 1 — базовые числа строки:
 * ступени считаются от него, поэтому первый забег всегда начинается одинаково,
 * а воспроизводимость по сиду не зависит от того, как долго игрок рос.
 */
export function supplyAt(mode: RunMode, level: number): Supply {
  const row = TUNING.chargeSupply[mode];
  const steps = Math.max(0, level - 1);
  return {
    batteryValue: row.batteryValue + Math.floor(steps / row.valueEveryLevels),
    spawnIntervalMs: Math.max(
      row.spawnIntervalMinMs,
      row.spawnIntervalMs - steps * row.spawnIntervalPerLevelMs,
    ),
    onField: row.onField + Math.floor(steps / row.onFieldEveryLevels),
    dropValue: row.dropValue + Math.floor(steps / row.dropEveryLevels),
    dropTtlMs: row.dropTtlMs,
  };
}

/**
 * Доход от одних батарей, Ток/с. Нужен как проверяемое утверждение дизайна:
 * доход обязан расти с уровнем, иначе расход его перегонит. Осколки сюда не
 * входят — они зависят от темпа убийств, то есть от билда игрока, а не от
 * режима: это бонус за урон, а не база.
 */
export function batteryIncomePerSec(supply: Supply): number {
  return supply.batteryValue / (supply.spawnIntervalMs / 1000);
}
