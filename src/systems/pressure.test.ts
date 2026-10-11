import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TUNING } from '../config/tuning';
import {
  eliteChanceAt,
  enemySpawnIntervalAt,
  enemyTargetCount,
  pressureStageAt,
} from './pressure';

test('первая минута — разгон: два врага и длинная пауза в обоих режимах', () => {
  for (const mode of ['normal', 'hardcore'] as const) {
    assert.equal(enemyTargetCount(1, mode, 0), 2, `${mode}: старт`);
    assert.equal(enemyTargetCount(1, mode, 59_999), 2, `${mode}: ещё разгон`);
    assert.equal(eliteChanceAt(mode, 0), 0, `${mode}: элит в разгоне нет`);
    assert.equal(pressureStageAt(mode, 0).atMs, 0);
  }
});

test('ступени наступают по времени забега, а не по уровню', () => {
  // Уровень тот же — меняется только время: это и есть кривая.
  assert.equal(enemyTargetCount(1, 'normal', 59_999), 2);
  assert.equal(enemyTargetCount(1, 'normal', 60_000), 3);
  assert.equal(enemyTargetCount(1, 'normal', 150_000), 4);
  assert.ok(enemySpawnIntervalAt('normal', 60_000) < enemySpawnIntervalAt('normal', 0));
});

test('уровень добавляет врагов поверх ступени, но не выше потолка', () => {
  const p = TUNING.enemyPressure.normal;
  const base = pressureStageAt('normal', 0).enemies;
  assert.equal(enemyTargetCount(1 + p.extraEnemyEveryLevels, 'normal', 0), base + 1);
  assert.equal(enemyTargetCount(99, 'normal', 0), p.maxEnemies);
});

test('давление не падает со временем: кривая монотонна', () => {
  for (const mode of ['normal', 'hardcore'] as const) {
    const stages = TUNING.enemyPressure[mode].stages;
    for (let i = 1; i < stages.length; i++) {
      assert.ok(stages[i].atMs > stages[i - 1].atMs, `${mode}: ступень позже предыдущей`);
      assert.ok(stages[i].enemies >= stages[i - 1].enemies, `${mode}: врагов не меньше`);
      assert.ok(
        stages[i].spawnIntervalMs <= stages[i - 1].spawnIntervalMs,
        `${mode}: пауза не длиннее`,
      );
      assert.ok(stages[i].eliteChance >= stages[i - 1].eliteChance, `${mode}: элит не меньше`);
    }
  }
});

test('элиты приходят только на поздних ступенях, и хардкор раньше обычного', () => {
  assert.equal(eliteChanceAt('normal', 120_000), 0);
  assert.ok(eliteChanceAt('normal', 150_000) > 0);
  assert.ok(eliteChanceAt('hardcore', 60_000) > 0, 'хардкор вводит элит на минуте');
});
