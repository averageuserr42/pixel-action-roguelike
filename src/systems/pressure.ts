import { TUNING, type PressureStage } from '../config/tuning';
import type { RunMode } from '../core/runRecord';

/**
 * Как давление врагов растёт по ВРЕМЕНИ забега, а не по уровню игрока.
 *
 * Почему так. Уровень растёт от убийств, а убийства — от фигур: замкнутый круг,
 * в котором сильный забег получает сильное давление, а слабый — слабое, и разброс
 * между прогонами только растёт. Замер девяти раундов это подтвердил: хардкор
 * стабильно кончался на 6–18 секундах, то есть всё давление успевало случиться в
 * первой минуте. Кривая по времени делает первую минуту разгоном в любом билде, а
 * пик — общим для всех.
 *
 * Модуль чистый: ни Phaser, ни часов, ни состояния сцены. Числа живут строкой
 * режима в tuning, здесь только выбор ступени — иначе кривую нельзя было бы ни
 * прочитать одним куском, ни проверить тестом. Поэтому он и лежит отдельно от
 * enemy.ts: там класс врага тянет Phaser, а этот файл обязан грузиться в node.
 */

/** Ступень кривой на прошедшем времени забега: последняя, чей порог наступил. */
export function pressureStageAt(mode: RunMode, elapsedMs: number): PressureStage {
  const stages = TUNING.enemyPressure[mode].stages;
  let current = stages[0];
  for (const stage of stages) {
    if (elapsedMs >= stage.atMs) current = stage;
    else break;
  }
  return current;
}

/**
 * Сколько врагов держим на поле. Ступень задаёт базу по времени забега, уровень
 * игрока добавляет сверху: быстро растущий билд получает давление выше — но не
 * раньше, чем забег дойдёт до своей ступени.
 */
export function enemyTargetCount(level: number, mode: RunMode, elapsedMs: number): number {
  const p = TUNING.enemyPressure[mode];
  const extra = Math.floor(Math.max(0, level - 1) / p.extraEnemyEveryLevels);
  return Math.min(pressureStageAt(mode, elapsedMs).enemies + extra, p.maxEnemies);
}

/** Пауза до следующего врага на этой секунде забега. */
export function enemySpawnIntervalAt(mode: RunMode, elapsedMs: number): number {
  return pressureStageAt(mode, elapsedMs).spawnIntervalMs;
}

/** Шанс элиты на этой секунде забега. */
export function eliteChanceAt(mode: RunMode, elapsedMs: number): number {
  return pressureStageAt(mode, elapsedMs).eliteChance;
}
