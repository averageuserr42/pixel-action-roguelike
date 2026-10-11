import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIntro, introMuted, muteIntro, nextHint, type IntroFacts } from './intro';

const QUIET: IntroFacts = { batteries: 0, spent: 0, refusals: 0, idleMs: 0 };

test('первая подсказка — про батарею, и она одна', () => {
  const intro = createIntro();
  const first = nextHint(intro, QUIET);
  assert.equal(first, 'СОБЕРИ БАТАРЕЮ — ЭТО ТОК ФИГУР');
  assert.equal(nextHint(intro, QUIET), null, 'без новых фактов показывать нечего');
});

test('подсказки не запирают друг друга: отказ не блокирует простой', () => {
  const intro = createIntro();
  nextHint(intro, QUIET);
  // Факты про батарею и трату ещё не наступили, а отказ на постановку — наступил.
  assert.equal(nextHint(intro, { ...QUIET, refusals: 2 }), 'НЕТ ТОКА — НОВАЯ ФИГУРА НЕ ВСТАНЕТ');
  assert.equal(nextHint(intro, { ...QUIET, idleMs: 3000 }), 'СТОИШЬ — КРЫЛО ГАСНЕТ');
  // Теперь батарея: подсказка про трату открылась вместе с ней.
  assert.equal(nextHint(intro, { ...QUIET, batteries: 1 }), 'ТОК ПЛАТИТСЯ ЗА ПОСТАНОВКУ ФИГУРЫ');
  assert.ok(introMuted(intro));
});

test('дважды одну подсказку не показываем', () => {
  const intro = createIntro();
  const first = nextHint(intro, { ...QUIET, batteries: 3 });
  assert.notEqual(first, null);
  const again = nextHint(intro, { ...QUIET, batteries: 3 });
  assert.notEqual(again, first);
});

test('игроку, который уже видел подсказки, не показывают ничего', () => {
  const intro = createIntro();
  muteIntro(intro);
  assert.equal(introMuted(intro), true);
  assert.equal(nextHint(intro, { batteries: 9, spent: 99, refusals: 9, idleMs: 9000 }), null);
});

test('порог отказа и простоя не срабатывает на границе', () => {
  const intro = createIntro();
  muteIntro(intro);
  const fresh = createIntro();
  nextHint(fresh, QUIET);
  assert.equal(nextHint(fresh, { ...QUIET, refusals: 1 }), null, 'ровно на пороге — ещё нет');
  assert.equal(nextHint(fresh, { ...QUIET, idleMs: 2500 }), null, 'ровно на пороге — ещё нет');
  assert.equal(nextHint(fresh, { ...QUIET, refusals: 2 }), 'НЕТ ТОКА — НОВАЯ ФИГУРА НЕ ВСТАНЕТ');
});
