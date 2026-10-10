import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approach, distance } from './math';

/**
 * Первый тест в проекте: он проверяет не только математику, но и сам конвейер —
 * что Node запускает .ts напрямую и что относительные импорты без расширения
 * (стиль проекта) разрешаются хуком tools/ts-resolve.
 */
test('distance считает евклидово расстояние', () => {
  assert.equal(distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
});

test('approach не перескакивает цель', () => {
  assert.equal(approach(0, 10, 100), 10);
  assert.equal(approach(0, 10, 3), 3);
});
