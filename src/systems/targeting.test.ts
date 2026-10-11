import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusPriority, pickFocusTarget, type FocusCandidate } from './targeting';
import type { EnemyKindId } from '../config/enemyKinds';
import type { EliteModifier } from './spawnDirector';

/**
 * Кандидат для тестов. Позиции подобраны так, чтобы порядок в списке ничего не
 * решал сам по себе: при равных приоритетах побеждает близость к игроку.
 */
function foe(
  id: EnemyKindId,
  x: number,
  y: number,
  elite: EliteModifier | null = null,
  hp = 10,
): FocusCandidate {
  return { kind: { id }, pos: { x, y }, hp, elite };
}

const PLAYER = { x: 0, y: 0 };
/** Радиус погони в квадрате: 100 единиц от игрока. */
const RANGE_SQ = 100 * 100;

test('приоритет угрозы: танк важнее стрелка, стрелок важнее погонялы', () => {
  assert.ok(focusPriority('tank', null) > focusPriority('shooter', null));
  assert.ok(focusPriority('shooter', null) > focusPriority('charger', null));
  assert.equal(focusPriority('charger', null), 0);
  assert.equal(focusPriority('splitter', null), 0);
});

test('элита любого вида опаснее обычного танка, но не элитного танка', () => {
  assert.ok(focusPriority('charger', 'shielded') > focusPriority('tank', null));
  assert.ok(focusPriority('tank', 'volatile') > focusPriority('charger', 'shielded'));
});

test('рой берёт дальнего танка, а не ближнюю погонялу: угроза важнее близости', () => {
  const near = foe('charger', 10, 0);
  const far = foe('tank', 90, 0);
  assert.equal(pickFocusTarget([near, far], PLAYER, RANGE_SQ), far);
});

test('из равных по приоритету берётся ближайший к ИГРОКУ', () => {
  const near = foe('tank', 20, 0);
  const far = foe('tank', 80, 0);
  assert.equal(pickFocusTarget([far, near], PLAYER, RANGE_SQ), near);
  // Порядок в списке решение не меняет.
  assert.equal(pickFocusTarget([near, far], PLAYER, RANGE_SQ), near);
});

test('без угроз рой просто берёт ближнего', () => {
  const near = foe('charger', 15, 0);
  const mid = foe('splitter', 50, 0);
  assert.equal(pickFocusTarget([mid, near], PLAYER, RANGE_SQ), near);
});

test('мёртвые не берутся: труп остаётся в списке до уборки', () => {
  const deadTank = foe('tank', 20, 0, null, 0);
  const alive = foe('charger', 30, 0);
  assert.equal(pickFocusTarget([deadTank, alive], PLAYER, RANGE_SQ), alive);
});

test('дальние цели отсекаются радиусом погони — стая не растягивается в нитку', () => {
  const outOfRange = foe('tank', 200, 0);
  const inRange = foe('charger', 50, 0);
  assert.equal(pickFocusTarget([outOfRange, inRange], PLAYER, RANGE_SQ), inRange);
  // Всё вне радиуса — стая возвращается в строй.
  assert.equal(pickFocusTarget([outOfRange], PLAYER, RANGE_SQ), null);
  assert.equal(pickFocusTarget([], PLAYER, RANGE_SQ), null);
});

test('выбор устойчив: одинаковый вход — та же цель', () => {
  const field = [
    foe('charger', 12, 5),
    foe('tank', 60, -20, 'swift'),
    foe('shooter', 30, 30),
    foe('splitter', 8, -8),
    foe('tank', 95, 5),
  ];
  const first = pickFocusTarget(field, PLAYER, RANGE_SQ);
  for (let i = 0; i < 5; i++) assert.equal(pickFocusTarget(field, PLAYER, RANGE_SQ), first);
  // Цель — элитный танк, а не самый дальний обычный.
  assert.equal(first, field[1]);
});
