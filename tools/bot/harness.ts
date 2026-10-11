import { TUNING } from '../../src/config/tuning';
import type { Vec2 } from '../../src/core/math';
import type { RunMode } from '../../src/core/runRecord';
import type { RunStats } from '../../src/core/runStats';
import {
  DEFAULT_POLICY,
  kiteCollect,
  type BotIntent,
  type BotView,
  type PolicyConfig,
} from './policy';

/**
 * Стенд замеров: гоняет НАСТОЯЩУЮ сцену синтетическими шагами симуляции.
 *
 * Зачем он существует. Плейтест мерил баланс руками игрока, а бот — через живой
 * луп в браузере: 45 секунд забега стоили 45 секунд реального времени, выборку
 * из пятидесяти сидов так не сделать. Стенд не изобретает второй симуляции —
 * он берёт ту же сцену, тот же фиксированный шаг (`TUNING.sim.stepMs`) и тот же
 * путь ввода (InputState), но крутит шаги в цикле, без рендера и без часов.
 *
 * Что отсюда следует:
 *  - прогон воспроизводим: один сид и одна политика дают один результат;
 *  - прогон быстрый: минута игрового времени — это 7200 шагов логики;
 *  - стенд не мерит то, что видно: кадр, отклик, ощущение. Это по-прежнему за
 *    игроком, и подменять одно другим нельзя.
 *
 * Сцена трогается только через те двери, которые уже есть: состояние сцены на
 * чтение и `step`/`openOffer` на шаг. Продуктовый код стенд не меняет.
 */
const SIM_DT = TUNING.sim.stepMs / 1000;

/** Что стенд берёт у сцены. Ровно то, что читает, — не «весь GameScene». */
export interface BotScene {
  seed: number;
  mode: RunMode;
  pos: Vec2;
  charge: { amount: number };
  enemies: readonly { pos: Vec2; enemyState: string }[];
  pickups: {
    items: readonly { x: number; y: number; kind: 'battery' | 'drop'; ttlMs: number; ageMs: number }[];
  };
  controls: { state: { move: Vec2 }; dashQueued: boolean };
  cameras: { main: { width: number; height: number } };
  stats: RunStats;
  sfx: { play: (kind: string) => void };
  dashCdT: number;
  iFramesT: number;
  dead: boolean;
  level: number;
  pendingLevels: number;
  choosing: boolean;
  report: string;
  build: { order: readonly string[] };
  picker: { cards: readonly unknown[]; onPick: (card: unknown) => void };
  scene: { restart: (data?: object) => void; manager: { processQueue: () => void } };
  step: (dt: number) => void;
  openOffer: () => void;
  saveResult: () => void;
}

export interface BotRunOptions {
  seed: number;
  mode: RunMode;
  /** Сколько секунд ИГРОВОГО времени длится прогон. */
  horizonSec: number;
  /** Бессмертие: тогда мерится экономика, а не выживаемость. */
  immortal?: boolean;
  /** Карта, которую бот берёт в предложении: индекс. */
  pickIndex?: number;
  policy?: (view: BotView) => BotIntent;
  cfg?: PolicyConfig;
}

export interface BotRunRecord {
  seed: number;
  mode: RunMode;
  died: boolean;
  timeSec: number;
  level: number;
  kills: number;
  batteries: number;
  batteryTok: number;
  drops: number;
  dropTok: number;
  spent: number;
  incomePerSec: number;
  /** Пик занятого залога за прогон: это и есть цена живого выводка. */
  heldMax: number;
  refusals: number;
  minCharge: number;
  /** Сколько шагов симуляции прошло: стенд обязан отчитываться и об этом. */
  steps: number;
  picks: readonly string[];
  report: string;
}

/**
 * Один прогон. Синхронный намеренно: шаги идут циклом, а не по кадрам, поэтому
 * прогон не зависит от того, рисует ли панель кадры и в фокусе ли вкладка.
 */
export function runBot(scene: unknown, opts: BotRunOptions): BotRunRecord {
  const s = scene as BotScene;
  const { seed, mode, horizonSec, immortal = false, pickIndex = 0 } = opts;
  const decide = opts.policy ?? ((view: BotView) => kiteCollect(view, opts.cfg ?? DEFAULT_POLICY));

  // История забегов и звук — для игрока: пятьдесят прогонов бота не должны
  // попадать в его «лучший результат» и не должны шуметь на весь дом.
  //
  // Глушение ОБЯЗАНО быть временным. У сцены метод с прототипа, поэтому подмена
  // — это own-свойство объекта, а объект сцены переживает перезапуск: забыв
  // вернуть метод, стенд оставил бы игрока без истории забегов и без звука.
  const unmute = [mute(s, 'saveResult')];
  restart(s, seed, mode);
  unmute.push(mute(s.sfx, 'play'));
  settleOffers(s, pickIndex);

  const maxSteps = Math.ceil(horizonSec / SIM_DT);
  let steps = 0;
  try {
    while (steps < maxSteps && !s.dead) {
      // Бессмертие ставится перед каждым шагом: рывок перезаписывает неуязвимость
      // своим окном, и без этого «бессмертный» прогон заканчивался бы смертью.
      if (immortal) s.iFramesT = 999;
      const intent = decide(viewOf(s));
      s.controls.state.move.x = intent.move.x;
      s.controls.state.move.y = intent.move.y;
      if (intent.dash) s.controls.dashQueued = true;

      s.step(SIM_DT);
      steps++;

      // Уровень поднимается между шагами, как и в игре: выбор карты — не часть шага.
      if (!s.choosing && s.pendingLevels > 0) {
        s.openOffer();
        settleOffers(s, pickIndex);
      }
    }
  } finally {
    for (const restore of unmute) restore();
  }

  // Мир не должен доигрывать сам. После возврата стенда настоящий луп сцены
  // продолжает шагать с последним вводом бота, и этот «фантомный» забег доживал
  // бы до смерти — а смерть пишет результат игроку. Прогон закрывается явно:
  // поля `dead` достаточно, чтобы шаг и кадр выходили сразу, без побочных эффектов
  // (die() при этом не вызывается).
  const died = s.dead;
  s.dead = true;
  return record(s, steps, died);
}

/**
 * Глушение для ручных замеров: возвращает функцию, которая вернёт всё как было.
 *
 * `runBot` делает это сам, но замеры часто гоняют вручную — прямо в консоли
 * страницы, где соблазн «просто дёрнуть сцену» самый большой. Десять записей в
 * истории забегов — вся цена ошибки, поэтому дверь для ручного замера должна
 * быть такой же удобной, как для автоматического.
 */
export function muteForMeasure(scene: unknown): () => void {
  return mute(scene as object, 'saveResult');
}

/**
 * Временное глушение метода: возвращает функцию, которая ставит всё как было —
 * в том числе убирает own-свойство, если метод жил на прототипе. Без этого
 * «временная» подмена пережила бы перезапуск сцены и осталась бы навсегда.
 */
function mute(target: object, key: string): () => void {
  const bag = target as Record<string, unknown>;
  const hadOwn = Object.prototype.hasOwnProperty.call(bag, key);
  const original = bag[key];
  bag[key] = () => {};
  return () => {
    if (hadOwn) bag[key] = original;
    else delete bag[key];
  };
}

/** Перезапуск сцены без ожидания кадров: менеджер сцен разбирает очередь сам. */
function restart(s: BotScene, seed: number, mode: RunMode): void {
  s.scene.restart({ seed, mode });
  s.scene.manager.processQueue();
}

/** Карты берутся сразу: мир на предложении стоит, и ждать ему нечего. */
function settleOffers(s: BotScene, pickIndex: number): void {
  for (let guard = 0; s.choosing && guard < 8; guard++) {
    const cards = s.picker.cards;
    if (cards.length === 0) return;
    s.picker.onPick(cards[Math.min(pickIndex, cards.length - 1)]);
  }
}

/** То, что видит политика. Копий не делает: их читают сразу, в том же шаге. */
function viewOf(s: BotScene): BotView {
  const camera = s.cameras.main;
  const enemies = s.enemies.map((e) => ({ pos: e.pos, state: e.enemyState }));
  const pickups = s.pickups.items.map((item) => ({
    pos: { x: item.x, y: item.y },
    kind: item.kind,
    ttlLeftMs: item.ttlMs - item.ageMs,
  }));
  return {
    player: s.pos,
    enemies,
    pickups,
    bounds: { w: camera.width, h: camera.height },
    dashReady: s.dashCdT <= 0,
  };
}

function record(s: BotScene, steps: number, died: boolean): BotRunRecord {
  const stats = s.stats;
  const timeSec = stats.timeMs / 1000;
  const income = stats.batteryTok + stats.dropTok;
  return {
    seed: s.seed,
    mode: s.mode,
    died,
    timeSec: round(timeSec, 1),
    level: s.level,
    kills: stats.kills,
    batteries: stats.batteries,
    batteryTok: round(stats.batteryTok, 1),
    drops: stats.drops,
    dropTok: round(stats.dropTok, 1),
    spent: round(stats.chargeSpent, 1),
    incomePerSec: round(income / Math.max(timeSec, 0.01), 2),
    heldMax: round(stats.heldMax, 1),
    refusals: stats.dryRefusals,
    minCharge: Number.isFinite(stats.minCharge) ? round(stats.minCharge, 1) : 0,
    steps,
    picks: [...s.build.order],
    report: s.report,
  };
}

export interface SweepOptions extends Omit<BotRunOptions, 'seed'> {
  seeds: readonly number[];
}

/**
 * Серия прогонов по сидам: то, ради чего стенд и построен.
 *
 * Хранилище на время серии замораживается и возвращается как было. Глушение
 * `saveResult` уже сделано — это второй замок, и он не лишний: список забегов
 * вмещает всего десять записей, поэтому серия замеров, которая случайно в них
 * запишется, стирает забеги игрока без следа. Ошибка такой цены не заслуживает
 * надежды на одну защиту.
 */
export function sweep(scene: unknown, opts: SweepOptions): BotRunRecord[] {
  const frozen = freezeStorage();
  const rows: BotRunRecord[] = [];
  try {
    for (const seed of opts.seeds) rows.push(runBot(scene, { ...opts, seed }));
  } finally {
    thawStorage(frozen);
  }
  return rows;
}

/** Слепок локального хранилища: маленькое, поэтому копируется целиком. */
function freezeStorage(): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key !== null) snapshot[key] = localStorage.getItem(key) ?? '';
  }
  return snapshot;
}

function thawStorage(snapshot: Record<string, string>): void {
  for (const [key, value] of Object.entries(snapshot)) localStorage.setItem(key, value);
}

export interface SweepSummary {
  mode: RunMode;
  immortal: boolean;
  horizonSec: number;
  runs: number;
  diedRuns: number;
  timeSec: { min: number; median: number; max: number };
  /** Доля забегов дольше минуты — тот самый критерий плейтеста. */
  shareOverMinute: number;
  killsMedian: number;
  levelMedian: number;
  incomePerSecMedian: number;
  refusalsMedian: number;
  heldMaxMedian: number;
  minChargeMedian: number;
  /** Самая частая первая карта: по ней видно, что бот вообще брал. */
  firstPick: string;
}

export function summarize(rows: readonly BotRunRecord[], opts: { immortal: boolean; horizonSec: number }): SweepSummary {
  const times = rows.map((r) => r.timeSec);
  const sorted = [...times].sort((a, b) => a - b);
  const firstPicks = new Map<string, number>();
  for (const row of rows) {
    const pick = row.picks[0] ?? '—';
    firstPicks.set(pick, (firstPicks.get(pick) ?? 0) + 1);
  }
  const firstPick = [...firstPicks.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
  return {
    mode: rows[0]?.mode ?? 'normal',
    immortal: opts.immortal,
    horizonSec: opts.horizonSec,
    runs: rows.length,
    diedRuns: rows.filter((r) => r.died).length,
    timeSec: {
      min: round(sorted[0] ?? 0, 1),
      median: round(median(sorted), 1),
      max: round(sorted[sorted.length - 1] ?? 0, 1),
    },
    shareOverMinute: round(rows.filter((r) => r.timeSec >= 60).length / Math.max(rows.length, 1), 2),
    killsMedian: median(rows.map((r) => r.kills)),
    levelMedian: median(rows.map((r) => r.level)),
    incomePerSecMedian: round(median(rows.map((r) => r.incomePerSec)), 2),
    refusalsMedian: median(rows.map((r) => r.refusals)),
    heldMaxMedian: round(median(rows.map((r) => r.heldMax)), 1),
    minChargeMedian: round(median(rows.map((r) => r.minCharge)), 1),
    firstPick,
  };
}

/** Человекочитаемая сводка: её и печатает тот, кто гоняет стенд. */
export function formatSweep(summary: SweepSummary): string {
  const t = summary.timeSec;
  const lines = [
    `${summary.mode}${summary.immortal ? ' (бессмертие)' : ''}, горизонт ${summary.horizonSec} с, прогонов ${summary.runs}`,
    `  смерть: ${summary.diedRuns} из ${summary.runs}`,
    `  время: min ${t.min} / медиана ${t.median} / max ${t.max} с`,
    `  дольше минуты: ${Math.round(summary.shareOverMinute * 100)}%`,
    `  убийств (медиана): ${summary.killsMedian}, уровень: ${summary.levelMedian}`,
    `  доход: ${summary.incomePerSecMedian} Ток/с, занято: ${summary.heldMaxMedian} (пик), отказов: ${summary.refusalsMedian}`,
    `  минимум пула (медиана): ${summary.minChargeMedian}`,
    `  частая первая карта: ${summary.firstPick}`,
  ];
  return lines.join('\n');
}

/** Одна строка на прогон — чтобы видеть не только медианы, но и разброс. */
export function formatRows(rows: readonly BotRunRecord[]): string[] {
  return rows.map((r) =>
    [
      `сид ${r.seed}`,
      r.died ? 'умер' : 'жив',
      `${r.timeSec}s`,
      `ур.${r.level}`,
      `убито ${r.kills}`,
      `доход ${r.batteryTok}+${r.dropTok}`,
      `расход ${r.spent}`,
      `мин ${r.minCharge}`,
      `занято ${r.heldMax}`,
      `отказов ${r.refusals}`,
      `взято: ${r.picks.join(', ') || '—'}`,
    ].join(' · '),
  );
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
