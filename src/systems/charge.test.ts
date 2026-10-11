import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TUNING } from '../config/tuning';
import {
  add,
  avail,
  baseCap,
  canAfford,
  chargeNorm,
  clearHold,
  createCharge,
  hold,
  release,
  setCap,
  spend,
  stepCharge,
} from './charge';
import { supplyAt } from './supply';

/** Ценность батареи приходит из снабжения: она растёт с уровнем, а не константа. */
const BATTERY = supplyAt('normal', 1).batteryValue;

test('начисление за подбор и потолок пула', () => {
  const c = createCharge(baseCap());
  add(c, BATTERY);
  assert.equal(c.amount, BATTERY);
  for (let i = 0; i < 100; i++) add(c, BATTERY);
  assert.equal(c.amount, baseCap());
  assert.equal(chargeNorm(c), 1);
});

test('setCap подрезает пул, но не растит его сам', () => {
  const c = createCharge(10);
  add(c, 10);
  setCap(c, 24);
  assert.equal(c.amount, 10, 'рост потолка не должен начислять Ток');
  assert.equal(c.cap, 24);
  setCap(c, 4);
  assert.equal(c.amount, 4, 'падение потолка обязано подрезать пул');
});

test('spend: не хватает — не списывает, хватает — списывает', () => {
  const c = createCharge(20);
  add(c, TUNING.charge.deployDrone);
  const before = c.amount;
  assert.equal(canAfford(c, TUNING.charge.deployDrone + 1), false);
  assert.equal(spend(c, TUNING.charge.deployDrone + 1), false);
  assert.equal(c.amount, before, 'отказ не должен менять пул');
  assert.equal(spend(c, TUNING.charge.deployDrone), true);
  assert.equal(c.amount, 0);
});

test('затухание гасит пул и не уходит ниже нуля', () => {
  const c = createCharge(20);
  add(c, 2);
  stepCharge(c, 0.5, TUNING.charge.decayPerSec);
  assert.equal(c.amount, 2 - TUNING.charge.decayPerSec * 0.5);
  stepCharge(c, 60, TUNING.charge.decayPerSec);
  assert.equal(c.amount, 0);
  assert.equal(chargeNorm(c), 0);
});

test('затухание приходит аргументом: карты его замедляют', () => {
  const full = createCharge(20);
  const slow = createCharge(20);
  add(full, 10);
  add(slow, 10);
  stepCharge(full, 1, TUNING.charge.decayPerSec);
  stepCharge(slow, 1, TUNING.charge.decayPerSec * 0.5);
  assert.ok(slow.amount > full.amount, 'замедленное затухание обязано сохранить больше Тока');
});

test('резерв: ниже порога пул не течёт вовсе', () => {
  const c = createCharge(20);
  add(c, 20);
  stepCharge(c, 1, 10, 0.2);
  assert.equal(c.amount, 10, 'выше порога пул обязан таять');
  stepCharge(c, 10, 10, 0.2);
  assert.equal(c.amount, 4, 'у порога 0.2 от 20 пул обязан встать и не идти ниже');
});

test('резерв не мешает тратить: он держит только затухание', () => {
  const c = createCharge(20);
  add(c, 4);
  stepCharge(c, 10, 1, 0.2);
  assert.equal(c.amount, 4, 'на пороге затухание не работает');
  assert.equal(spend(c, 4), true, 'действия оплачиваются из резерва как обычно');
  assert.equal(c.amount, 0);
});

test('больший потолок — больший защищённый запас, а не мёртвая карта', () => {
  const small = createCharge(20);
  const big = createCharge(44);
  add(small, 20);
  add(big, 44);
  stepCharge(small, 600, 1, 0.2);
  stepCharge(big, 600, 1, 0.2);
  assert.equal(small.amount, 20 * 0.2);
  assert.equal(big.amount, 44 * 0.2, '«Ёмкость» обязана защищать больше Тока');
});

test('залог занимает бюджет: живая фигура держит свой Ток', () => {
  const c = createCharge(20);
  add(c, 20);
  assert.equal(hold(c, 15), true);
  assert.equal(avail(c), 5);
  assert.equal(c.amount, 5, 'залог обязан подрезать уже набранный пул');
  // Свободного Тока пять — шестёрку ни оплатить, ни занять больше нельзя.
  assert.equal(canAfford(c, 6), false);
  assert.equal(spend(c, 6), false);
  assert.equal(hold(c, 1), true);
  release(c, 16);
  assert.equal(avail(c), 20);
  // Залог больше потолка не берётся: фигура без покрытия — это бюджет фикций.
  assert.equal(hold(c, 21), false);
  assert.equal(avail(c), 20);
});

test('рост потолка подрезает пул по свободному остатку, а не по потолку', () => {
  const c = createCharge(20);
  add(c, 20);
  hold(c, 12);
  assert.equal(c.amount, 8, 'залог подрезает уже набранный пул');
  setCap(c, 24);
  assert.equal(avail(c), 12);
  assert.equal(c.amount, 8, 'рост потолка не должен затирать подрезку по залогу');
  assert.ok(chargeNorm(c) <= 1, `норма пула вылезла за единицу: ${chargeNorm(c)}`);
  setCap(c, 8);
  assert.equal(avail(c), 0);
  assert.equal(c.amount, 0, 'потолок ниже залога — свободного Тока нет вовсе');
});

test('новый забег начинается без залога прошлого', () => {
  const c = createCharge(20);
  add(c, 20);
  hold(c, 16);
  // Сцена переживает перезапуск: без сброса залог прошлого забега остался бы.
  clearHold(c);
  setCap(c, baseCap());
  c.amount = TUNING.charge.start;
  assert.equal(avail(c), baseCap());
  assert.equal(c.amount, TUNING.charge.start);
  assert.equal(chargeNorm(c), c.amount / baseCap());
});

test('полный цикл: батареи оплачивают постановку турелей', () => {
  const c = createCharge(baseCap());
  const batteries = Math.floor((baseCap() / BATTERY) * 2);
  for (let i = 0; i < batteries; i++) add(c, BATTERY);
  const stored = c.amount;
  const affordable = Math.floor(stored / TUNING.charge.deployTurret);
  let deployed = 0;
  while (spend(c, TUNING.charge.deployTurret)) deployed++;
  assert.equal(
    deployed,
    affordable,
    `поставлено ${deployed} турелей вместо ${affordable} по цене постановки`,
  );
  // Цена постановки больше единицы, поэтому пул обнуляется не всегда: важно, что
  // остатка больше не хватает ни на одну фигуру.
  assert.ok(
    c.amount < TUNING.charge.deployTurret,
    `остаток ${c.amount} не должен хватать на постановку`,
  );
});
