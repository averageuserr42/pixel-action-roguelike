import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRunStats,
  formatClock,
  formatStats,
  noteBattery,
  noteDrop,
  noteKill,
  noteRefusal,
  noteSpend,
  reportLine,
  stepStats,
  type StatsHead,
} from './runStats';

const HEAD: StatsHead = {
  seed: 42,
  modeTitle: 'обычный',
  controlTitle: 'клавиатура',
  level: 7,
  specialtyTitle: 'ЭНЕРГЕТИК',
  picks: ['nrg_cap', 'mech_turret'],
};

test('счётчики складываются, ноль на старте', () => {
  const s = createRunStats();
  assert.equal(s.kills, 0);
  assert.equal(s.batteries, 0);
  assert.equal(s.drops, 0);
  assert.equal(s.dryRefusals, 0);
  noteKill(s);
  noteKill(s);
  noteBattery(s, 2, 12);
  noteDrop(s, 3, 6);
  noteSpend(s, 1.5);
  noteRefusal(s);
  assert.equal(s.kills, 2);
  assert.equal(s.batteries, 2);
  assert.equal(s.batteryTok, 12);
  assert.equal(s.drops, 3);
  assert.equal(s.dropTok, 6);
  assert.equal(s.chargeSpent, 1.5);
  assert.equal(s.dryRefusals, 1);
});

test('простой считается только при живых фигурах и пустом пуле', () => {
  const s = createRunStats();
  stepStats(s, 1, 5, 2);
  assert.equal(s.dryMs, 0, 'с Током простоя нет');
  stepStats(s, 1, 0, 0);
  assert.equal(s.dryMs, 0, 'без фигур молчание никого не волнует');
  stepStats(s, 2, 0, 2);
  assert.equal(s.dryMs, 2000);
  assert.equal(s.timeMs, 4000);
  assert.equal(s.minCharge, 0);
});

test('минимум пула не сбивается нулём на старте', () => {
  const s = createRunStats();
  stepStats(s, 0.5, 12, 1);
  stepStats(s, 0.5, 7, 1);
  assert.equal(s.minCharge, 7);
});

test('часы читаются как минуты:секунды', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(65_000), '1:05');
  assert.equal(formatClock(600_000), '10:00');
  assert.equal(formatClock(-5), '0:00');
});

test('отчёт опознаёт забег, разводит доход по источникам и перечисляет билд', () => {
  const s = createRunStats();
  noteKill(s);
  noteBattery(s, 1, 6);
  noteDrop(s, 1, 2);
  noteSpend(s, 4);
  stepStats(s, 192, 3, 2);
  const lines = formatStats(s, HEAD);
  assert.equal(lines.length, 5);
  assert.ok(lines[0].includes('сид 42'), lines[0]);
  assert.ok(lines[0].includes('3:12'), lines[0]);
  assert.ok(lines[1].includes('ур. 7'), lines[1]);
  assert.ok(lines[1].includes('ЭНЕРГЕТИК'), lines[1]);
  assert.ok(lines[1].includes('убито 1'), lines[1]);
  assert.ok(lines[2].includes('батарей 1 → 6'), lines[2]);
  assert.ok(lines[2].includes('осколков 1 → 2'), lines[2]);
  assert.ok(lines[3].includes('расход 4'), lines[3]);
  assert.ok(lines[3].includes('минимум 3'), lines[3]);
  assert.ok(lines[4].includes('nrg_cap, mech_turret'), lines[4]);
});

test('строки отчёта короткие: отчёт читают на телефоне', () => {
  const s = createRunStats();
  noteBattery(s, 12, 114);
  noteDrop(s, 8, 20);
  for (const line of formatStats(s, HEAD)) {
    assert.ok(line.length <= 60, `строка длиной ${line.length}: ${line}`);
  }
});

test('пустой забег в отчёте читается, а не молчит', () => {
  const s = createRunStats();
  const lines = formatStats(s, { ...HEAD, picks: [], specialtyTitle: null });
  assert.equal(lines[4], 'взято: —');
  assert.ok(lines[1].includes('без профессии'), lines[1]);
  assert.ok(lines[2].includes('батарей 0 → 0'), lines[2]);
  assert.ok(!lines[0].includes(' · null'), lines[0]);
});

test('строка отчёта — одной строкой всё, что нужно прислать', () => {
  const s = createRunStats();
  const line = reportLine(s, HEAD);
  assert.equal(line.split(' | ').length, 5);
  assert.ok(line.includes('сид 42') && line.includes('взято: nrg_cap, mech_turret'));
});
