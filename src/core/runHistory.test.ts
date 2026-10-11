import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HISTORY_CAP,
  appendResult,
  bestOf,
  formatResultLine,
  parseHistory,
  serializeHistory,
  type RunResult,
} from './runHistory';
import { RUN_RECORD_VERSION } from './runRecord';

function result(over: Partial<RunResult> = {}): RunResult {
  return {
    version: RUN_RECORD_VERSION,
    at: 1,
    seed: 1,
    mode: 'normal',
    control: 'keyboard',
    timeMs: 60_000,
    level: 3,
    kills: 10,
    specialty: null,
    picks: [],
    valid: true,
    ...over,
  };
}

test('новый результат идёт первым, предел держится', () => {
  let list: RunResult[] = [];
  for (let i = 0; i < HISTORY_CAP + 5; i++) list = appendResult(list, result({ at: i }));
  assert.equal(list.length, HISTORY_CAP);
  assert.equal(list[0].at, HISTORY_CAP + 4, 'первым должен быть последний забег');
});

test('лучший ищется по времени, потом по уровню и убийствам', () => {
  assert.equal(bestOf([]), null);
  const a = result({ timeMs: 100_000, level: 5, kills: 20 });
  const b = result({ timeMs: 50_000, level: 9, kills: 99 });
  const c = result({ timeMs: 100_000, level: 6, kills: 1 });
  assert.equal(bestOf([a, b, c])?.level, 6, 'при равном времени решает уровень');
});

test('недействительный забег лучшим не становится', () => {
  const cheat = result({ timeMs: 999_999, valid: false });
  const honest = result({ timeMs: 10_000 });
  assert.equal(bestOf([cheat, honest])?.timeMs, 10_000);
  assert.equal(bestOf([cheat]), null);
});

test('разбор хранилища терпим к мусору', () => {
  assert.deepEqual(parseHistory(null), []);
  assert.deepEqual(parseHistory('не json'), []);
  assert.deepEqual(parseHistory('{"a":1}'), []);
  assert.deepEqual(parseHistory('[{"at":"нет"}]'), []);

  const good = result({ at: 7 });
  const mixed = JSON.stringify([good, { at: 1 }, 42, null]);
  const parsed = parseHistory(mixed);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].at, 7);
});

test('подозрительные поля приводятся к безопасным значениям', () => {
  const parsed = parseHistory(JSON.stringify([{ ...result(), picks: [1, 'nrg_cap', null], valid: 'нет' }]));
  assert.deepEqual(parsed[0].picks, ['nrg_cap']);
  assert.equal(parsed[0].valid, true, 'не-`false` значит действителен');
});

test('прогоны других правил в таблицу не попадают', () => {
  // Запись без версии — это прогон старых правил (до брони); запись с другой
  // версией — прогон будущих или прошлых контрактов. Обе не сравнимы с текущей.
  const legacy = { ...result(), version: undefined } as unknown as RunResult;
  const foreign = result({ version: RUN_RECORD_VERSION + 1 });
  const current = result({ at: 9 });
  const parsed = parseHistory(JSON.stringify([legacy, foreign, current]));
  assert.deepEqual(parsed.map((r) => r.at), [9], 'только записи текущих правил');
  // Лучший по чужой таблице тоже не находится: рекорд из другой игры — не рекорд.
  assert.equal(bestOf([foreign, legacy])?.at ?? null, null);
});

test('сериализация переживает круговой разбор', () => {
  const list = [result({ at: 2, specialty: 'mechanic' }), result({ at: 1, timeMs: 5_000 })];
  const back = parseHistory(serializeHistory(list));
  assert.deepEqual(back, list);
});

test('строка истории несёт время, режим, уровень и билд', () => {
  const line = formatResultLine(
    result({ timeMs: 125_000, level: 4, kills: 33, specialty: 'energy' }),
    'обычный',
  );
  assert.ok(line.includes('2:05'), line);
  assert.ok(line.includes('обычный'), line);
  assert.ok(line.includes('ур. 4'), line);
  assert.ok(line.includes('убито 33'), line);
  assert.ok(line.includes('energy'), line);
  assert.ok(!line.includes('недействителен'), line);
  assert.ok(formatResultLine(result({ valid: false }), 'хардкор').includes('недействителен'));
});
