import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACHIEVEMENTS,
  createMeta,
  metaBonuses,
  metaProgress,
  parseMeta,
  serializeMeta,
  unlockNew,
  type MetaFacts,
} from './meta';

const NOTHING: MetaFacts = { timeMs: 0, kills: 0, level: 1, specialty: null, batteries: 0 };

test('достижения открываются фактами забега', () => {
  const meta = createMeta();
  assert.deepEqual(unlockNew(meta, NOTHING), []);
  assert.deepEqual(unlockNew(meta, { ...NOTHING, kills: 10 }).map((a) => a.id), ['first_blood']);
  assert.deepEqual(
    unlockNew(meta, { timeMs: 90_000, kills: 12, level: 8, specialty: 'summoner', batteries: 25 })
      .map((a) => a.id),
    ['survivor', 'climber', 'master', 'collector'],
  );
});

test('открытое не открывается вторым забегом', () => {
  const meta = createMeta();
  unlockNew(meta, { ...NOTHING, kills: 10 });
  assert.deepEqual(unlockNew(meta, { ...NOTHING, kills: 40 }), []);
});

test('бонусы складываются из открытого и совпадают с обещанием', () => {
  const meta = createMeta();
  const empty = metaBonuses(meta);
  assert.deepEqual(empty, { startCharge: 0, capBonus: 0, startMotes: 0, startBatteries: 0 });

  // Обещание в тексте достижения и цифра здесь обязаны совпадать: игрок читает
  // строку награды как договор.
  assert.match(ACHIEVEMENTS.find((a) => a.id === 'first_blood')!.reward, /\+4 Тока/);
  assert.match(ACHIEVEMENTS.find((a) => a.id === 'survivor')!.reward, /\+4/);
  assert.match(ACHIEVEMENTS.find((a) => a.id === 'climber')!.reward, /\+1 мот/);

  unlockNew(meta, { ...NOTHING, kills: 10 });
  assert.equal(metaBonuses(meta).startCharge, 4);
  unlockNew(meta, { ...NOTHING, kills: 10, batteries: 25 });
  assert.equal(metaBonuses(meta).startCharge, 8);
  unlockNew(meta, { ...NOTHING, kills: 10, timeMs: 120_000, level: 9, specialty: 'x', batteries: 25 });
  assert.deepEqual(metaBonuses(meta), { startCharge: 8, capBonus: 4, startMotes: 1, startBatteries: 1 });
});

test('строка прогресса считает медали', () => {
  const meta = createMeta();
  assert.equal(metaProgress(meta), `медалей 0/${ACHIEVEMENTS.length}`);
  unlockNew(meta, { ...NOTHING, kills: 10 });
  assert.equal(metaProgress(meta), `медалей 1/${ACHIEVEMENTS.length}`);
});

test('сохранение и разбор: мусор и чужие ключи не оживают', () => {
  const meta = createMeta();
  unlockNew(meta, { ...NOTHING, kills: 10, timeMs: 200_000 });
  const round = parseMeta(serializeMeta(meta));
  assert.deepEqual(round.unlocked, meta.unlocked);

  assert.deepEqual(parseMeta(null).unlocked, {});
  assert.deepEqual(parseMeta('не json').unlocked, {});
  assert.deepEqual(parseMeta('{"unlocked":{"ghost":true}}').unlocked, {}, 'удалённое не возвращается');
});
