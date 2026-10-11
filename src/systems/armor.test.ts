import { test } from 'node:test';
import assert from 'node:assert/strict';
import { absorb, createArmor, stepArmor } from './armor';

/**
 * Тесты — это требования плана «виды врагов», записанные кодом: залп теряет
 * ровно один слой, контакт всегда идёт в пул жизней, броня восстанавливается
 * только после выдержки. Без них броня молча станет куполом или пустым местом.
 */
test('залп в одном кадре тратит ровно один слой', () => {
  const armor = createArmor(1, 5000);
  // Первый снаряд гасит щит, остальные уже идут в пул: окно неуязвимости между
  // ними даёт сцена, а модуль честно тратит слой за попаданием.
  assert.equal(absorb(armor, 'ranged'), true);
  assert.equal(armor.charged, 0);
  assert.equal(absorb(armor, 'ranged'), false);
  assert.equal(absorb(armor, 'ranged'), false);
});

test('контакт игнорирует броню всегда', () => {
  const armor = createArmor(3, 5000);
  assert.equal(absorb(armor, 'contact'), false);
  assert.equal(armor.charged, 3, 'контакт не тратит слой — он идёт мимо');
});

test('слой возвращается после выдержки без попаданий, не раньше', () => {
  const armor = createArmor(1, 5000);
  assert.equal(absorb(armor, 'ranged'), true);
  stepArmor(armor, 4.9);
  assert.equal(armor.charged, 0, 'рано: таймер ещё не выдержан');
  stepArmor(armor, 0.2);
  assert.equal(armor.charged, 1);
  stepArmor(armor, 10);
  assert.equal(armor.charged, 1, 'копиться выше запаса слои не должны');
});

test('попадание сбрасывает выдержку регена', () => {
  const armor = createArmor(2, 5000);
  assert.equal(absorb(armor, 'ranged'), true);
  stepArmor(armor, 4);
  // Второе попадание до регена: таймер пошёл заново, слои не вернулись раньше.
  assert.equal(absorb(armor, 'ranged'), true);
  stepArmor(armor, 1);
  assert.equal(armor.charged, 0);
  stepArmor(armor, 4.5);
  assert.equal(armor.charged, 1);
});

test('без слоёв снаряд идёт в пул жизней, а не в пустоту', () => {
  const armor = createArmor(0, 5000);
  assert.equal(absorb(armor, 'ranged'), false);
  stepArmor(armor, 100);
  assert.equal(armor.charged, 0, 'нулевой запас не заряжается сам');
});
