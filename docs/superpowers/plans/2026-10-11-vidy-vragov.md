# Виды врагов, броня и язык угроз — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** превратить единственный вид врага в четыре разных по требованию к игроку, дать игроку броню против дальнего боя и сделать угрозы различимыми с одного взгляда.

**Architecture:** логика врага разделяется на чистые модули без Phaser (таблица видов, шаг поведения, режиссёр спавна) и тонкий слой отрисовки; это единственная причина, по которой поведение вообще можно измерить без браузера. Снаряды врага живут во втором пуле того же класса. Броня — отдельный чистый модуль с двумя каналами урона.

**Tech Stack:** Phaser 4, TypeScript 7 (`tsc --noEmit`), Vite 8 (Rolldown), тесты — встроенный `node --test` на Node 24 (нативное стирание типов) плюс хук-резолвер для импортов без расширений. Новых зависимостей нет.

**Spec:** [docs/superpowers/specs/2026-10-11-vidy-vragov-design.md](../specs/2026-10-11-vidy-vragov-design.md)

## Global Constraints

- Числа вида живут в таблице видов (`enemyKinds.ts`); числа брони, элит и второго пула — в `tuning.ts`. Логика своих чисел не выдумывает.
- Тестируемый модуль не импортирует Phaser и не импортирует модуль, который его импортирует. `import type` разрешён: стирание типов его удаляет и до резолва не доходит.
- Относительные импорты — без расширения (стиль проекта). Разрешает их хук.
- Ноль новых зависимостей. Тесты запускаются `npm test`.
- Детерминизм: любой случайный выбор — только через `Rng` сида забега. `Math.random()` в игровой логике запрещён.
- В игровом шаге нет аллокаций: пулы и переиспользуемые векторы.
- Контакт в упор убивает всегда; броня работает только против канала `ranged`.
- `RunRecord.version` — 4.
- Комментарии и документы — по-русски, как в проекте.
- git не инициализирован. Вместо шага «commit» — контрольная точка: `npm run typecheck` и `npm test` чистые, рабочее дерево не сломано.

## Review Focus

Классы ввода и режимы отказа, которые спека подразумевает, но ни один тест не покрывает сам собой. Для каждой строки тест добавлен в задачу-владельца.

1. **Узкое поле** (`VIEW.minSide` 180–270, телефон в горизонтали): дистанция удержания стрелка и радиус танка должны оставаться внутри поля, иначе стрелок встаёт в стену или внутрь игрока. Ожидаемое: зажим в границы и зазор больше суммы радиусов. — тест в Task 3.
2. **Первый уровень** (до гейтов): при `level = 1` обязан спавниться только `charger`, иначе первый уровень становится лотереей из четырёх угроз. Ожидаемое: единственный вид. — тесты в Task 1 и Task 2.
3. **Переполнение пула снарядов** (24 живых снаряда врага): выстрел игрока обязан проходить, а не пропадать молча. Ожидаемое: пулы независимы в обе стороны. — тест в Task 6.
4. **Залп в одном шаге** (три снаряда в одном кадре): броня обязана потерять ровно один слой, иначе она исчезает мгновенно. Ожидаемое: окно неуязвимости 600 мс. — тест в Task 5.
5. **Контакт и снаряд в одном шаге**: смерть от касания обязана победить, броня спасать не должна. Ожидаемое: канал `contact` убивает при любом числе слоёв. — тест в Task 5.

---

## Task 0: Инфраструктура тестов

**Files:**
- Create: `tools/ts-resolve/hooks.mjs`, `tools/ts-resolve/register.mjs`
- Create: `src/core/math.test.ts`
- Modify: `package.json` (скрипт `test`)

**Interfaces:**
- Produces: `npm test` — запускает все `src/**/*.test.ts` на встроенном раннере Node с разрешением импортов без расширений.

- [ ] **Step 1: Написать первый тест на существующем чистом коде**

```ts
// src/core/math.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approach, distance } from './math';   // импорт без расширения — как в проекте

test('distance считает евклидово расстояние', () => {
  assert.equal(distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
});

test('approach не перескакивает цель', () => {
  assert.equal(approach(0, 10, 100), 10);
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `node --test src/core/math.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND: Cannot find module './math'`. Это подтверждает, что дело именно в резолве импортов без расширения.

- [ ] **Step 3: Добавить хук-резолвер**

```js
// tools/ts-resolve/hooks.mjs
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Дописывает .ts к относительным импортам без расширения — стиль проекта. */
export async function resolve(specifier, context, next) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier)) {
    const candidate = context.parentURL ? new URL(`${specifier}.ts`, context.parentURL) : null;
    if (candidate && existsSync(fileURLToPath(candidate))) return next(`${specifier}.ts`, context);
  }
  return next(specifier, context);
}
```

```js
// tools/ts-resolve/register.mjs
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
```

- [ ] **Step 4: Добавить скрипт в package.json**

```json
"test": "node --import ./tools/ts-resolve/register.mjs --test \"src/**/*.test.ts\""
```

- [ ] **Step 5: Убедиться, что тест проходит**

Run: `npm test`
Expected: PASS — `tests 2`, `pass 2`, `fail 0`.

- [ ] **Step 6: Контрольная точка**

Run: `npm run typecheck`
Expected: `EXIT=0` (тестовые файлы тоже проверяются tsc, потому что `include` — `src`).

---

## Task 1: Таблица видов

**Files:**
- Create: `src/config/enemyKinds.ts`
- Test: `src/config/enemyKinds.test.ts`

**Interfaces:**
- Produces:
  - `type EnemyKindId = 'charger' | 'tank' | 'shooter' | 'splitter'`
  - `type EnemyBehavior = 'orbit-charge' | 'walk' | 'standoff-shoot' | 'split-on-death'`
  - `interface EnemyKind { id: EnemyKindId; title: string; behavior: EnemyBehavior; color: number; radius: number; hpMult: number; speedMult: number; spawnWeight: number; minLevel: number; usesRing: boolean; canIntercept: boolean; usesStateColors: boolean }`
  - `const ENEMY_KINDS: readonly EnemyKind[]`
  - `function kindById(id: EnemyKindId): EnemyKind`
  - `function kindsForLevel(level: number): EnemyKind[]`

- [ ] **Step 1: Написать падающие тесты**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENEMY_KINDS, kindById, kindsForLevel } from './enemyKinds';

test('видов ровно четыре', () => {
  assert.deepEqual(ENEMY_KINDS.map((k) => k.id), ['charger', 'tank', 'shooter', 'splitter']);
});

test('виды открываются по уровню', () => {
  assert.deepEqual(kindsForLevel(1).map((k) => k.id), ['charger']);
  assert.deepEqual(kindsForLevel(3).map((k) => k.id), ['charger', 'tank']);
  assert.deepEqual(kindsForLevel(5).map((k) => k.id), ['charger', 'tank', 'shooter']);
  assert.deepEqual(kindsForLevel(7).map((k) => k.id).length, 4);
});

test('эталонный вид не меняет нынешние числа', () => {
  const charger = kindById('charger');
  assert.equal(charger.hpMult, 1);
  assert.equal(charger.speedMult, 1);
  assert.equal(charger.usesRing, true);
  assert.equal(charger.canIntercept, true);
});

test('кольцо и перехват только у погонялы', () => {
  for (const kind of ENEMY_KINDS.filter((k) => k.id !== 'charger')) {
    assert.equal(kind.usesRing, false);
    assert.equal(kind.canIntercept, false);
  }
});

test('числа вменяемы: веса положительны, цвета уникальны, радиусы положительны', () => {
  assert.equal(new Set(ENEMY_KINDS.map((k) => k.color)).size, ENEMY_KINDS.length);
  for (const kind of ENEMY_KINDS) {
    assert.ok(kind.spawnWeight > 0);
    assert.ok(kind.radius > 0);
    assert.ok(kind.hpMult > 0);
    assert.ok(kind.speedMult > 0);
  }
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — `Cannot find module './enemyKinds'`.

- [ ] **Step 3: Написать таблицу**

Значения — из раздела 6 спеки: `tank` HP ×3, скорость ×0.6, радиус 7, вес 25, с уровня 3; `shooter` HP ×0.7, радиус 5, скорость ×1.0, вес 25, с уровня 5; `splitter` HP ×0.7, радиус 5, скорость ×1.0, вес 20, с уровня 7; `charger` — как сейчас (вес 60, с уровня 1, состояние красится по фазе, `usesStateColors: true`). Цвета — из таблицы спеки 3.4: `charger` `0x6ee7ff`, `tank` `0x6b5b95`, `shooter` `0x7ddc7d`, `splitter` `0xff7ad9`.

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS, `fail 0`.

---

## Task 2: Режиссёр спавна

**Files:**
- Create: `src/systems/spawnDirector.ts`
- Test: `src/systems/spawnDirector.test.ts`
- Modify: `src/config/tuning.ts` (в блоки `enemyPressure[mode]` добавить `eliteChance: 0.12` для `normal` и `0.18` для `hardcore`; рядом `eliteMinLevel: 4`)

**Interfaces:**
- Consumes: `EnemyKind`, `kindsForLevel()`, `kindById()` из Task 1; `Rng` из `src/core/rng`; `RunMode` из `src/core/runRecord`.
- Produces:
  - `type EliteModifier = 'shielded' | 'swift' | 'volatile'`
  - `interface SpawnPick { kind: EnemyKindId; elite: EliteModifier | null }`
  - `function nonChaserCap(alive: number): number` — `ceil(alive / 3)`, минимум 1
  - `function pickSpawn(level: number, mode: RunMode, alive: number, nonChasers: number, rng: Rng): SpawnPick`
  - `function eliteHpBonus(mod: EliteModifier): number` — `shielded` 2, остальные 0
  - `function eliteSpeedMult(mod: EliteModifier): number` — `swift` 1.35, остальные 1

- [ ] **Step 1: Написать падающие тесты**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../core/rng';
import { eliteHpBonus, eliteSpeedMult, nonChaserCap, pickSpawn } from './spawnDirector';

test('на первом уровне спавнится только погоняла', () => {
  const rng = mulberry32(7);
  for (let i = 0; i < 40; i++) assert.equal(pickSpawn(1, 'normal', 4, 0, rng).kind, 'charger');
});

test('тот же сид — та же последовательность видов', () => {
  const run = () => { const r = mulberry32(99); return Array.from({ length: 12 }, () => pickSpawn(9, 'hardcore', 8, 1, r).kind); };
  assert.deepEqual(run(), run());
});

test('потолок не-погонял удерживается', () => {
  assert.equal(nonChaserCap(1), 1);
  assert.equal(nonChaserCap(3), 1);
  assert.equal(nonChaserCap(8), 3);
  const rng = mulberry32(3);
  for (let i = 0; i < 50; i++) assert.equal(pickSpawn(12, 'hardcore', 8, 3, rng).kind, 'charger');
});

test('элиты не раньше четвёртого уровня', () => {
  const rng = mulberry32(5);
  for (let i = 0; i < 40; i++) assert.equal(pickSpawn(3, 'normal', 4, 0, rng).elite, null);
});

test('бросок элиты читается по сиду', () => {
  assert.equal(pickSpawn(8, 'normal', 4, 0, () => 0).elite, 'shielded');
  assert.equal(pickSpawn(8, 'normal', 4, 0, () => 0.999).elite, null);
});

test('числа модификаторов', () => {
  assert.equal(eliteHpBonus('shielded'), 2);
  assert.equal(eliteHpBonus('swift'), 0);
  assert.equal(eliteSpeedMult('swift'), 1.35);
  assert.equal(eliteSpeedMult('volatile'), 1);
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — `Cannot find module './spawnDirector'`.

- [ ] **Step 3: Написать режиссёра**

Правило выбора: если `nonChasers >= nonChaserCap(alive)` — вид `charger`; иначе взвешенный выбор среди `kindsForLevel(level)`, где вес погонялы повышается, когда живых мало (живых < 2 → всегда `charger`). Бросок элиты — второй вызов `rng()`, только при `level >= eliteMinLevel`.

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS, `fail 0`.

---

## Task 3: Чистое поведение видов

**Files:**
- Create: `src/entities/enemyBrain.ts`
- Test: `src/entities/enemyBrain.test.ts`

**Interfaces:**
- Consumes: `TUNING`; `VIEW` из `src/core/viewport`; `clampToBounds`, `Vec2` из `src/core/math`; `EnemyState` — тип объявляется здесь и реэкспортируется из `enemy.ts` (Task 4), чтобы не тянуть Phaser.
- Produces:
  - `type EnemyState = 'seek' | 'windup' | 'charge' | 'recover'` (перенос из `enemy.ts`)
  - `interface BrainState { pos: Vec2; hp: number; maxHp: number; state: EnemyState; timerMs: number; chargeCdMs: number; shotCdMs: number; wantsShot: boolean; orbitJitter: number; slotAngle: number; slotReady: boolean; aim: Vec2; dir: Vec2; interceptTarget: Vec2; interceptActive: boolean; interceptAgeMs: number }`
  - `interface BrainContext { dt: number; playerPos: Vec2; playerVel: Vec2; slotAngle: number }`
  - `function createBrain(kind: EnemyKindId, at: Vec2, level: number, mode: RunMode, jitter: number): BrainState` — заполняет числа из `TUNING.enemyPressure[mode]` и таблицы видов; `state` — `'seek'`
  - `function stepBrain(s: BrainState, c: BrainContext, kind: EnemyKind): void` — выставляет `wantsShot` для стрелка (сам снаряд пускает сцена)
  - `interface SpawnChild { kind: EnemyKindId; hpFactor: number; speedMult: number; sterile: boolean }`
  - `function onDeathSpawns(kind: EnemyKindId, sterile: boolean): SpawnChild[]`
  - `const SHOOTER_STANDOFF_FACTOR = 0.30`

- [ ] **Step 1: Написать падающие тесты**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TUNING } from '../config/tuning';
import { VIEW } from '../core/viewport';
import { kindById } from '../config/enemyKinds';
import { SHOOTER_STANDOFF_FACTOR, createBrain, onDeathSpawns, stepBrain } from './enemyBrain';

const DT = 1 / 60;

test('перенос не сломал погонялу: замах длится windupMs', () => {
  const kind = kindById('charger');
  const s = createBrain('charger', { x: 200, y: 120 }, 1, 'normal', 0.5);
  const ctx = { dt: DT, playerPos: { x: 200, y: 120 }, playerVel: { x: 0, y: 0 }, slotAngle: 0 };
  let guard = 0;
  while (s.state !== 'windup' && guard++ < 1200) stepBrain(s, ctx, kind);
  assert.equal(s.state, 'windup', 'погоняла обязан дойти до замаха');
  let msInWindup = 0;
  while (s.state === 'windup' && guard++ < 1200) { stepBrain(s, ctx, kind); msInWindup += DT * 1000; }
  const want = TUNING.enemyPressure.normal.windupMs;
  assert.ok(Math.abs(msInWindup - want) <= DT * 1000 * 1.5, `замах ${msInWindup} мс вместо ${want}`);
});

test('стоящего игрока погоняла достаёт за разумное время', () => {
  const s = createBrain('charger', { x: 200, y: 120 }, 1, 'hardcore', 0.5);
  const ctx = { dt: DT, playerPos: { x: 200, y: 120 }, playerVel: { x: 0, y: 0 }, slotAngle: 0 };
  let ms = 0;
  const limit = TUNING.player.radius + kindById('charger').radius;
  while (Math.hypot(s.pos.x - 200, s.pos.y - 120) > limit && ms < 8000) { stepBrain(s, ctx, kindById('charger')); ms += DT * 1000; }
  assert.ok(ms <= 3500, `контакт за ${ms} мс`);
});

test('танк идёт прямо и не делает выпадов', () => {
  const s = createBrain('tank', { x: 300, y: 120 }, 1, 'normal', 0.5);
  const ctx = { dt: DT, playerPos: { x: 100, y: 120 }, playerVel: { x: 0, y: 0 }, slotAngle: 0 };
  for (let i = 0; i < 300; i++) { stepBrain(s, ctx, kindById('tank')); assert.equal(s.state, 'seek'); }
  assert.ok(s.pos.x < 300 - 10, 'танк должен приблизиться');
});

test('стрелок держит дистанцию внутри дальности боя', () => {
  const s = createBrain('shooter', { x: 200 + 200, y: 120 }, 1, 'normal', 0.5);
  const ctx = { dt: DT, playerPos: { x: 200, y: 120 }, playerVel: { x: 0, y: 0 }, slotAngle: 0 };
  for (let i = 0; i < 300; i++) stepBrain(s, ctx, kindById('shooter'));
  const dist = Math.hypot(s.pos.x - 200, s.pos.y - 120);
  const want = SHOOTER_STANDOFF_FACTOR * VIEW.minSide;
  assert.ok(Math.abs(dist - want) < 20, `дистанция ${dist}, ожидание ~${want}`);
  assert.ok(dist < TUNING.weapon.targetRangeFactor * VIEW.minSide, 'стрелок обязан быть досягаем');
});

test('узкое поле: стрелок не залезает внутрь игрока', () => {
  const s = createBrain('shooter', { x: 10, y: 10 }, 1, 'normal', 0.5);
  const ctx = { dt: DT, playerPos: { x: 12, y: 12 }, playerVel: { x: 0, y: 0 }, slotAngle: 0 };
  for (let i = 0; i < 600; i++) stepBrain(s, ctx, kindById('shooter'));
  const dist = Math.hypot(s.pos.x - 12, s.pos.y - 12);
  assert.ok(dist > TUNING.player.radius + kindById('shooter').radius + 4, `дистанция ${dist}`);
});

test('делитель даёт двух детей и не делится рекурсивно', () => {
  const children = onDeathSpawns('splitter', false);
  assert.equal(children.length, 2);
  assert.ok(children.every((c) => c.kind === 'splitter' && c.hpFactor === 0.5 && c.sterile));
  assert.deepEqual(onDeathSpawns('splitter', true), [], 'ребёнок делиться не должен');
});

test('погоняла и танк детей не дают', () => {
  assert.deepEqual(onDeathSpawns('charger', false), []);
  assert.deepEqual(onDeathSpawns('tank', false), []);
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — `Cannot find module './enemyBrain'`.

- [ ] **Step 3: Перенести поведение погонялы и добавить три новых**

Перенос — буквальный: логика `seek` / `windup` / `charge` / `recover` из `Enemy.step` переезжает в `stepBrain` без изменения чисел (все берутся из `TUNING.enemyPressure`). Новые виды: `walk` — прямое движение к игроку, состояние всегда `seek`, без замаха; `standoff-shoot` — движение к точке на дистанции `SHOOTER_STANDOFF_FACTOR * VIEW.minSide` с гистерезисом 8 единиц, затем замах `TUNING.enemyPressure[mode].shooterWindupMs` и выстрел через колбэк сцены (испуск снаряда в `stepBrain` не входит: он только выставляет флаг `wantsShot`); `split-on-death` — поведение как у `tank`, но с меньшими числами из таблицы.

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS, `fail 0`. Если «контакт за N мс» падает — числа выпада менять нельзя: значит перенос неверен.

---

## Task 4: Тонкий мост `Enemy` → `stepBrain`

**Files:**
- Modify: `src/entities/enemy.ts`
- Modify: `src/config/tuning.ts` (если новые числа видов требуют места — только те, что читает мозг)

**Interfaces:**
- Consumes: `BrainState`, `stepBrain`, `onDeathSpawns`, `EnemyState` из Task 3.
- Produces: публичный интерфейс `Enemy` **без изменений**: `hit(damage): boolean`, `step(dt, playerPos, slotAngle, playerVel)`, `enemyState`, `radius`, `maxHp`, `hp`, `pos`, `orbitJitter`, `interceptTarget`, `interceptActive`, `interceptAgeMs`, `destroy()`. Дополнительно: `kind: EnemyKindId` и `elite: EliteModifier | null` (нужны Task 7 и Task 8).

- [ ] **Step 1: Заменить тело `step` на делегирование**

`Enemy` держит `Arc`, `BrainState` и вызывает `stepBrain`. Цвет заливки: если `kind.usesStateColors` — как сейчас по фазе; иначе `kind.color`. `hit()` и `destroy()` не меняются. HP считается как `min(enemyHpForLevel(level) * kind.hpMult + eliteHpBonus(elite), TUNING.enemy.hpCap)`.

- [ ] **Step 2: Проверить типы и сборку**

Run: `npm run typecheck` — Expected: `EXIT=0`.
Run: `npm run build` — Expected: сборка завершается успешно.

- [ ] **Step 3: Проверить руками, что погоняла не изменился**

Дев-сервер `npm run dev` на десктопе: кольцо вращается, замах виден красным, выпад достаёт, после выпада откат. Ожидаемое: поведение идентично версии до правки, включая смерть стоящего игрока примерно за 2 секунды в хардкоре.

- [ ] **Step 4: Контрольная точка**

Run: `npm test && npm run typecheck`
Expected: PASS, `EXIT=0`.

---

## Task 5: Броня

**Files:**
- Create: `src/core/armor.ts`
- Test: `src/core/armor.test.ts`
- Modify: `src/config/tuning.ts` (новый блок `armor: { layers: 3, hitIFramesMs: 600, refillOnLevelUp: true }`)

**Interfaces:**
- Produces:
  - `type DamageChannel = 'contact' | 'ranged'`
  - `interface ArmorState { layers: number; iFramesMs: number }`
  - `function createArmor(): ArmorState`
  - `function applyDamage(a: ArmorState, channel: DamageChannel): { killed: boolean; layerLost: boolean }`
  - `function armorStep(a: ArmorState, dt: number): void`
  - `function refillArmor(a: ArmorState): void`

- [ ] **Step 1: Написать падающие тесты**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TUNING } from '../config/tuning';
import { applyDamage, armorStep, createArmor, refillArmor } from './armor';

test('стартовая броня — три слоя', () => {
  assert.equal(createArmor().layers, TUNING.armor.layers);
  assert.equal(createArmor().layers, 3);
});

test('залп в одном шаге снимает ровно один слой', () => {
  const a = createArmor();
  let lost = 0;
  for (let i = 0; i < 3; i++) if (applyDamage(a, 'ranged').layerLost) lost++;
  assert.equal(lost, 1);
  assert.equal(a.layers, 2);
  assert.equal(a.iFramesMs, TUNING.armor.hitIFramesMs);
});

test('после окна попадание снова снимает слой', () => {
  const a = createArmor();
  applyDamage(a, 'ranged');
  armorStep(a, TUNING.armor.hitIFramesMs / 1000);
  assert.equal(applyDamage(a, 'ranged').layerLost, true);
  assert.equal(a.layers, 1);
});

test('контакт убивает при любом числе слоёв', () => {
  const a = createArmor();
  assert.equal(applyDamage(a, 'contact').killed, true);
  assert.equal(a.layers, 3, 'контакт броню не тратит');
  refillArmor(a);
  assert.equal(applyDamage(a, 'contact').killed, true);
});

test('на нуле слоёв снаряд убивает', () => {
  const a = createArmor();
  a.layers = 0;
  assert.equal(applyDamage(a, 'ranged').killed, true);
});

test('уровень восстанавливает броню полностью', () => {
  const a = createArmor();
  applyDamage(a, 'ranged');
  applyDamage(a, 'ranged');
  assert.equal(a.layers, 1);
  refillArmor(a);
  assert.equal(a.layers, 3);
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — `Cannot find module './armor'`.

- [ ] **Step 3: Написать модуль**

`ranged` при `iFramesMs > 0` не делает ничего; иначе тратит слой (если слоёв 0 — `killed: true`) и ставит окно. `armorStep` только уменьшает окно. Правило «при нуле слоёв снаряд убивает» записано в спеку (раздел 3.2).

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS, `fail 0`.

---

## Task 6: Второй пул снарядов

**Files:**
- Modify: `src/systems/projectiles.ts`
- Test: `src/systems/projectiles.test.ts`

**Interfaces:**
- Produces:
  - `interface PoolConfig { color: number; radius: number; poolSize: number }`
  - `class Projectiles { constructor(scene: Phaser.Scene, config?: PoolConfig) }` — поведение `spawn` / `step(dt, targets: HitTargets)` без изменений
  - `interface PlayerTarget { playerPos: Vec2; playerRadius: number; hitPlayer(): void }`
  - `stepTowardsPlayer(dt: number, target: PlayerTarget): void`

- [ ] **Step 1: Написать падающие тесты**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Projectiles } from './projectiles';

/** Заглушка сцены: класс использует только add.circle().setVisible().setDepth(). */
function fakeScene() {
  return { add: { circle: () => ({ setPosition() { return this; }, setVisible() { return this; }, setFillStyle() { return this; }, setDepth() { return this; }, destroy() {} }) } } as never;
}

const spec = { speed: 100, damage: 1, lifeMs: 1000, pierce: 0, explosiveRadius: 0 };

test('переполнение пула врага не отменяет выстрел игрока', () => {
  const player = new Projectiles(fakeScene(), { color: 1, radius: 2, poolSize: 4 });
  const enemy = new Projectiles(fakeScene(), { color: 2, radius: 3, poolSize: 2 });
  for (let i = 0; i < 2; i++) enemy.spawn({ x: 0, y: 0 }, { x: 1, y: 0 }, spec);
  assert.equal(enemy.active, 2);
  enemy.spawn({ x: 0, y: 0 }, { x: 1, y: 0 }, spec);   // пул врага исчерпан
  player.spawn({ x: 0, y: 0 }, { x: 1, y: 0 }, spec);
  assert.equal(player.active, 1, 'выстрел игрока обязан пройти');
});

test('снаряд врага попадает в игрока ровно один раз и исчезает', () => {
  const enemy = new Projectiles(fakeScene(), { color: 2, radius: 3, poolSize: 2 });
  enemy.spawn({ x: 0, y: 0 }, { x: 1, y: 0 }, { ...spec, speed: 60 });
  let hits = 0;
  for (let i = 0; i < 30; i++) enemy.stepTowardsPlayer(1 / 60, { playerPos: { x: 20, y: 0 }, playerRadius: 4, hitPlayer: () => { hits++; } });
  assert.equal(hits, 1);
  assert.equal(enemy.active, 0);
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — `Phaser` не загружается как значение (`import Phaser` при `verbatimModuleSyntax` едет в рантайм).

- [ ] **Step 3: Сделать модуль node-совместимым и конфигурируемым**

Заменить `import Phaser from 'phaser'` на `import type Phaser from 'phaser'` (Phaser тут только в типах — рантайм-зависимость не нужна). Константы цвета и радиуса заменить на `config` с умолчанием из `TUNING`. Добавить `stepTowardsPlayer` с проверкой расстояния до игрока и самоуничтожением после попадания.

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS, `fail 0`.
Run: `npm run typecheck` — Expected: `EXIT=0`.

---

## Task 7a: Виды в сцене

**Files:**
- Modify: `src/scenes/GameScene.ts`
- Modify: `src/config/tuning.ts` (`shooterWindupMs` в блоках `enemyPressure[mode]`)

**Interfaces:**
- Consumes: `pickSpawn`, `nonChaserCap` (Task 2); `Enemy.kind` (Task 4); `onDeathSpawns`, `SpawnChild` (Task 3).

- [ ] **Step 1: Спавнить через режиссёра**

`spawnEnemy` зовёт `pickSpawn(level, mode, alive, nonChasers, rng)` и создаёт врага нужного вида; не-погонялы не занимают слот кольца (`usesRing === false`) и не назначаются перехватчиками (`canIntercept === false`); делитель при смерти создаёт двух детей из `onDeathSpawns('splitter', false)`.

- [ ] **Step 2: Телеграф стрелка**

На время `stepBrain` с выставленным `wantsShot` сцена рисует линию от стрелка к игроку; по истечении замаха пускает снаряд в `enemyShots` и сбрасывает флаг.

- [ ] **Step 3: Проверить типы и сборку**

Run: `npm run typecheck && npm run build`
Expected: `EXIT=0`, сборка успешна.

- [ ] **Step 4: Проверить руками на десктопе**

Чеклист: 1) на 1-м уровне только погоняла, на 3-м появляется танк, на 5-м стрелок, на 7-м делитель; 2) танк идёт прямо и не делает выпадов; 3) у стрелка видна линия прицела до выстрела; 4) делитель при смерти даёт две половины и они не делятся снова; 5) цвета видов не путаются между собой и с игроком.

- [ ] **Step 5: Контрольная точка**

Run: `npm test && npm run typecheck`
Expected: PASS, `EXIT=0`.

---

## Task 7b: Броня в сцене и HUD

**Files:**
- Modify: `src/scenes/GameScene.ts`
- Modify: `src/config/tuning.ts` (блок `enemyShot: { poolSize: 24, radius: 3, color: 0xff4d6d }`)

**Interfaces:**
- Consumes: `createArmor`, `applyDamage`, `armorStep`, `refillArmor` (Task 5); `Projectiles`, `PlayerTarget` (Task 6).

- [ ] **Step 1: Второй пул и попадание**

`this.enemyShots = new Projectiles(this, TUNING.enemyShot)` создаётся рядом с `this.shots`. В шаге: `enemyShots.stepTowardsPlayer(dt, target)`, где `hitPlayer` вызывает `applyDamage(this.armor, 'ranged')` и при `killed` — `die()`. Путь касания врага (`die()` при пересечении) остаётся **без** обращения к броне.

- [ ] **Step 2: HUD и восстановление**

Три точки брони рядом с уровнем: потеря слоя гасит одну, попадание по игроку даёт белую вспышку (не красную). `refillArmor` вызывается в `gainXp` в момент повышения уровня; `armorStep` — в игровом шаге.

- [ ] **Step 3: Проверить типы и сборку**

Run: `npm run typecheck && npm run build`
Expected: `EXIT=0`, сборка успешна.

- [ ] **Step 4: Проверить руками на десктопе**

Чеклист: 1) попадание снаряда гасит одну точку и три точки возвращаются на новом уровне; 2) касание врага по-прежнему убивает мгновенно — броня не спасает; 3) на нуле слоёв снаряд убивает; 4) залп из нескольких снарядов в один момент снимает только одну точку.

- [ ] **Step 5: Контрольная точка**

Run: `npm test && npm run typecheck`
Expected: PASS, `EXIT=0`.

---

## Task 8: Элиты и особый дроп

**Files:**
- Modify: `src/entities/enemy.ts` (двойная пульсирующая обводка, щит как запас попаданий)
- Modify: `src/core/progression.ts` (экспортировать `drawSpecialtyCard(build, rng): Card | null`)
- Test: `src/core/progression.test.ts` (новый)
- Modify: `src/scenes/GameScene.ts` (применение дропа)

**Interfaces:**
- Consumes: `EliteModifier`, `eliteHpBonus`, `eliteSpeedMult` (Task 2).
- Produces (оба в `src/core/progression.ts`):
  - `function eliteDropKind(specialty: BranchId | null): 'specialty' | 'level'`
  - `function drawSpecialtyCard(build: BuildState, rng: Rng): Card | null`

- [ ] **Step 1: Написать падающие тесты**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from './rng';
import { applyCard, CARDS, createBuild, drawSpecialtyCard, eliteDropKind } from './progression';

test('без профессии элита даёт обычный выбор', () => {
  assert.equal(eliteDropKind(null), 'level');
});

test('с профессией элита даёт карту этой ветки', () => {
  assert.equal(eliteDropKind('engineer'), 'specialty');
  const build = createBuild();
  const card = drawSpecialtyCard(build, mulberry32(1));
  assert.equal(card?.branch, 'engineer');
});

test('исчерпанная ветка не выдаёт карту', () => {
  const build = createBuild();
  for (const card of CARDS.filter((c) => c.branch === 'engineer')) {
    for (let i = 0; i < card.maxStacks; i++) applyCard(build, card);
  }
  assert.equal(drawSpecialtyCard(build, mulberry32(1)), null);
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL — `eliteDropKind is not defined`.

- [ ] **Step 3: Реализовать**

`eliteDropKind` — три строки. `drawSpecialtyCard` — обёртка над существующим приватным `drawBranchCard`. `shielded` даёт `+2` к HP на спавне. Обводка элиты — двойное кольцо с пульсацией; обводка «перерос числа» меняется на белую, чтобы не спорить с ней и с игроком.

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS, `fail 0`.

---

## Task 9: Версия записи прогона

**Files:**
- Modify: `src/core/runRecord.ts`
- Test: `src/core/runRecord.test.ts` (новый)

**Interfaces:**
- Produces: `RunRecord.version: 4`.

- [ ] **Step 1: Написать падающий тест**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRunRecord } from './runRecord';

test('запись помечена четвёртой версией', () => {
  const rec = createRunRecord({ seed: 1, mode: 'normal', control: 'keyboard', fireModeAtStart: 'manual', changedDuringRun: false }, ['eng_rof'], 3, null);
  assert.equal(rec.version, 4);
});

test('picks копируется, а не передаётся ссылкой', () => {
  const picks = ['eng_rof'];
  const rec = createRunRecord({ seed: 1, mode: 'normal', control: 'keyboard', fireModeAtStart: 'manual', changedDuringRun: false }, picks, 3, null);
  picks.push('eng_caliber');
  assert.deepEqual(rec.picks, ['eng_rof']);
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test`
Expected: FAIL — `expected 3 to equal 4`.

- [ ] **Step 3: Поднять версию**

Изменить литеральный тип и значение `version: 3` → `version: 4` в интерфейсе и в `createRunRecord`.

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS, `fail 0`.

---

## Task 10: Бот-замеры

**Files:**
- Create: `tools/bot.ts`
- Modify: `package.json` (скрипт `bot`)

**Interfaces:**
- Consumes: `stepBrain`, `createBrain` (Task 3); `pickSpawn` (Task 2); `applyDamage` (Task 5).

- [ ] **Step 1: Написать замер**

`tools/bot.ts` без Phaser: прогон шагами 1/60 с, печатает таблицу «вид → время до контакта со стоящим игроком» (обычный и хардкор), «слоёв брони за уровень», «сколько шагов занято при 8 врагах и двух элитах». Скрипт: `"bot": "node --import ./tools/ts-resolve/register.mjs tools/bot.ts"`.

- [ ] **Step 2: Прогнать и сравнить с базой**

Run: `npm run bot`
Expected: у `charger` время до контакта ≈ 2.0 с в хардкore и ≈ 2.6 с в обычном (числа из [PLAYTEST.md](../../../PLAYTEST.md), забег №2). Расхождение больше 20% означает, что перенос на `stepBrain` изменил поведение, — это ошибка Task 3, а не повод править числа.

- [ ] **Step 3: Записать числа**

Внести таблицу в `PLAYTEST.md` в раздел замеров.

- [ ] **Step 4: Контрольная точка**

Run: `npm test && npm run typecheck`
Expected: PASS, `EXIT=0`.

---

## Task 11: Подготовить плейтест

**Files:**
- Modify: `PLAYTEST.md`

- [ ] **Step 1: Написать раздел «Забег №5: что проверять»**

Список ровно по введённому: четыре вида (по одному пункту на вид), броня, элиты, различимость цветов. Для каждого пункта — что именно написать: не «нормально», а что происходило и на каком уровне.

- [ ] **Step 2: Сверить список с тем, что реально в коде**

Run: `grep -c "charger\|tank\|shooter\|splitter" src/config/enemyKinds.ts`
Expected: 4 вида на месте, и все четыре упомянуты в чеклисте.

- [ ] **Step 3: Контрольная точка**

Run: `npm test && npm run typecheck && npm run build`
Expected: все три чистые — ветка в состоянии, которое можно отдать на плейтест.
