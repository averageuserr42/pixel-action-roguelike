import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batteryIncomePerSec, supplyAt } from './supply';

test('на первом уровне числа равны базовым из строки режима', () => {
  const s = supplyAt('normal', 1);
  assert.equal(s.batteryValue, 6);
  assert.equal(s.spawnIntervalMs, 2400);
  assert.equal(s.onField, 2);
  assert.equal(batteryIncomePerSec(s), 2.5);
});

test('батарея дорожает ступенями, а не каждый уровень', () => {
  assert.equal(supplyAt('normal', 3).batteryValue, 6, 'третий уровень ещё база');
  assert.equal(supplyAt('normal', 4).batteryValue, 7, 'на четвёртом батарея дороже');
  assert.equal(supplyAt('normal', 6).batteryValue, 7, 'внутри ступени цена не растёт');
  assert.equal(supplyAt('normal', 7).batteryValue, 8);
});

test('пауза между батареями сокращается и не уходит ниже предела', () => {
  assert.equal(supplyAt('normal', 4).spawnIntervalMs, 2100);
  assert.ok(supplyAt('normal', 20).spawnIntervalMs >= 1400, 'ниже предела темп не растёт');
  assert.equal(supplyAt('normal', 15).spawnIntervalMs, 1400, 'на пятнадцатом уже предел');
});

test('мест на поле становится больше: это запас, а не темп дохода', () => {
  assert.equal(supplyAt('normal', 1).onField, 2);
  assert.equal(supplyAt('normal', 5).onField, 3);
  assert.equal(supplyAt('normal', 9).onField, 4);
});

test('осколок с убитого дорожает вместе с врагом', () => {
  assert.equal(supplyAt('normal', 1).dropValue, 2);
  assert.equal(supplyAt('normal', 4).dropValue, 3);
  assert.equal(supplyAt('normal', 7).dropValue, 4);
});

test('доход от батарей растёт монотонно: расход обгонял его при фиксированных числах', () => {
  let previous = batteryIncomePerSec(supplyAt('normal', 1));
  assert.equal(previous, 2.5);
  for (let level = 2; level <= 20; level++) {
    const income = batteryIncomePerSec(supplyAt('normal', level));
    assert.ok(income >= previous, `уровень ${level}: доход упал с ${previous} до ${income}`);
    previous = income;
  }
  assert.ok(previous > 5, `на двадцатом уровне доход обязан вырасти заметно, дал ${previous}`);
});

test('за уровнем ниже первого числа не портятся: считаем от базы', () => {
  assert.deepEqual(supplyAt('normal', 0), supplyAt('normal', 1));
  assert.deepEqual(supplyAt('normal', -5), supplyAt('normal', 1));
});

test('хардкор не беднее обычного: его жёсткость — в угрозе, а не в голоде', () => {
  for (const level of [1, 4, 7, 12, 20]) {
    const normal = supplyAt('normal', level);
    const hardcore = supplyAt('hardcore', level);
    assert.equal(hardcore.batteryValue, normal.batteryValue, `уровень ${level}: батарея беднее`);
    assert.ok(
      batteryIncomePerSec(hardcore) >= batteryIncomePerSec(normal),
      `уровень ${level}: доход хардкора ниже обычного`,
    );
    assert.ok(
      hardcore.dropTtlMs < normal.dropTtlMs,
      `уровень ${level}: окно осколка у хардкора обязано быть короче — это его риск`,
    );
  }
});
