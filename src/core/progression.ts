import { TUNING } from '../config/tuning';
import type { Rng } from './rng';

/**
 * Прогрессия забега: опыт, уровни, таланты и профессия.
 *
 * Три ветки — три разных способа играть, а не три набора цифр:
 *  - ИНЖЕНЕР работает с оружием: темп, пробивание, разрывные снаряды.
 *  - МЕХАНИК ставит устройства, которые держат поле без него: турели и дрон-мины.
 *  - СУММОНЕР водит спутников: духи-стрелки и стаи, что ищут врага сами.
 *
 * Класс выбирается не на старте, а по факту: ветка, набравшая достаточно карт,
 * закрепляется как ПРОФЕССИЯ забега (об этом знает и запись прогона). До этого
 * момента все ветки равноправны — игрок выбирает стиль, а не лотерея.
 *
 * После закрепления чужие обычные карты больше не предлагаются, но открываются
 * КРОС-КАРТЫ: они работают на стыке двух веток и требуют вложения в обе. Это
 * гибрид, за который заплачено уровнями, а не отмена выбора.
 *
 * Такая схема — надмножество чистых классов: когда в ветках станет больше
 * контента, «чистый инженер» останется тем же пулом с одним фильтром.
 *
 * Модуль чистый: никакого Phaser, никакого времени. Числа берутся из tuning,
 * поэтому подбор баланса не задевает логику.
 */
export type BranchId = 'engineer' | 'mechanic' | 'summoner';

export interface Branch {
  id: BranchId;
  title: string;
  /** Цвет ветки в интерфейсе выбора таланта. */
  color: number;
}

export const BRANCHES: readonly Branch[] = [
  { id: 'engineer', title: 'ИНЖЕНЕР', color: 0x8ef0b0 },
  { id: 'mechanic', title: 'МЕХАНИК', color: 0x9ad1ff },
  { id: 'summoner', title: 'СУММОНЕР', color: 0xc8b6ff },
];

/** Цвет крос-карты: она не принадлежит ни одной ветке, и это должно быть видно. */
export const CROSS_COLOR = 0xffb703;

export function branchTitle(id: BranchId): string {
  return BRANCHES.find((b) => b.id === id)?.title ?? id;
}

/** Что карта делает с забегом. Здесь только смысл — все числа в tuning. */
export interface CardEffects {
  /** Множитель интервала между выстрелами игрока (меньше — чаще). */
  fireIntervalMult?: number;
  /** Прибавка к урону пули: база — слабый пистолет, силу даёт инженер. */
  damage?: number;
  /** +1 означает «пробивает ещё одного врага». */
  pierce?: number;
  /** Прирост радиуса разрыва как доля меньшей стороны поля. */
  explosiveRadiusFactor?: number;
  /** Прирост дальности автонаводки как доля меньшей стороны поля. */
  autoRangeFactor?: number;
  /** Предел турелей; при взятии карты турель ещё и ставится сразу. */
  maxTurrets?: number;
  maxDroneMines?: number;
  maxSpirits?: number;
  /** Каждая карта стаи приводит пару мотов. */
  maxSwarms?: number;
  /** Множитель интервала стрельбы турелей (меньше — чаще). */
  turretRateMult?: number;
  /** Множитель интервала стрельбы духов. */
  spiritRateMult?: number;
  /** Крос ИНЖЕНЕР×МЕХАНИК: турели стреляют модификациями игрока. */
  turretRounds?: boolean;
  /** Крос ИНЖЕНЕР×СУММОНЕР: духи стреляют модификациями игрока. */
  spiritRounds?: boolean;
  /** Крос МЕХАНИК×СУММОНЕР: мот после укуса сразу ищет новую цель. */
  moteFastRechase?: boolean;
}

export interface Card {
  id: string;
  /** Ветка обычной карты. У крос-карты ветки нет: она принадлежит ПАРЕ. */
  branch?: BranchId;
  /** Пара веток крос-карты. Заполняется ровно вместо branch. */
  crossPair?: readonly [BranchId, BranchId];
  title: string;
  /** Одна строка, зачем это брать: игрок читает её в момент выбора. */
  blurb: string;
  /** Сколько раз карту можно взять за забег. */
  maxStacks: number;
  effects: CardEffects;
}

export const CARDS: readonly Card[] = [
  // Инженер — оружие.
  {
    id: 'eng_rof',
    branch: 'engineer',
    title: 'Скорострельность',
    blurb: 'Ствол стреляет на 20% чаще.',
    maxStacks: 3,
    effects: { fireIntervalMult: 0.8 },
  },
  // Урон ступенчатый (пуля 1 -> 2), поэтому одна карта удваивала силу ствола и
  // была ценнее любой другой. Плата темпом возвращает её в один ряд с остальными:
  // тяжёлая пуля бьёт больно, но реже, и по толпе слабых врагов темп всё ещё
  // выигрывает.
  {
    id: 'eng_caliber',
    branch: 'engineer',
    title: 'Калибр',
    blurb: 'Пуля бьёт на 1 больше, но ствол стреляет на 20% реже.',
    maxStacks: 2,
    effects: { damage: 1, fireIntervalMult: 1.2 },
  },
  {
    id: 'eng_pierce',
    branch: 'engineer',
    title: 'Пробивные',
    blurb: 'Пуля проходит сквозь лишнего врага.',
    maxStacks: 2,
    effects: { pierce: 1 },
  },
  {
    id: 'eng_he',
    branch: 'engineer',
    title: 'Разрывные',
    blurb: 'Попадание бьёт по площади вокруг цели.',
    maxStacks: 2,
    effects: { explosiveRadiusFactor: 0.09 },
  },
  // Дальний бой — не базовая настройка, а покупка: базовая автонаводка короче
  // дистанции появления врага, поэтому без этой карты к цели надо подходить.
  {
    id: 'eng_sniper',
    branch: 'engineer',
    title: 'Снайпер',
    blurb: 'Ствол бьёт дальше: цель берётся на подлёте, а не в упор.',
    maxStacks: 2,
    effects: { autoRangeFactor: 0.12 },
  },
  // Механик — устройства на поле.
  {
    id: 'mech_turret',
    branch: 'mechanic',
    title: 'Турель',
    blurb: 'Ставит турель: она держит сектор сама.',
    maxStacks: 3,
    effects: { maxTurrets: 1 },
  },
  {
    id: 'mech_drone',
    branch: 'mechanic',
    title: 'Дрон-мина',
    blurb: 'Кружит рядом и взрывается при контакте.',
    maxStacks: 2,
    effects: { maxDroneMines: 1 },
  },
  {
    id: 'mech_rate',
    branch: 'mechanic',
    title: 'Точеная механика',
    blurb: 'Турели стреляют на 25% чаще.',
    maxStacks: 2,
    effects: { turretRateMult: 0.75 },
  },
  // Суммонер — спутники.
  {
    id: 'sum_spirit',
    branch: 'summoner',
    title: 'Дух-стрелок',
    blurb: 'Дух кружит вокруг и бьёт по цели сам.',
    maxStacks: 3,
    effects: { maxSpirits: 1 },
  },
  {
    id: 'sum_swarm',
    branch: 'summoner',
    title: 'Стая',
    blurb: 'Два мота ищут врага и жалят его.',
    maxStacks: 2,
    effects: { maxSwarms: 1 },
  },
  {
    id: 'sum_affinity',
    branch: 'summoner',
    title: 'Сродство',
    blurb: 'Духи стреляют на 25% чаще.',
    maxStacks: 2,
    effects: { spiritRateMult: 0.75 },
  },
  // Крос-карты: играются только после закрепления профессии и только если во
  // второй ветке уже есть вложения. Одна карта на пару — здесь собирается тот
  // самый гибрид, за который игрок платит уровнями.
  {
    id: 'cross_turret_rounds',
    crossPair: ['engineer', 'mechanic'],
    title: 'Турельные патроны',
    blurb: 'Турели бьют твоими патронами: пробой и разрыв переносятся на них.',
    maxStacks: 1,
    effects: { turretRounds: true },
  },
  {
    id: 'cross_spirit_rounds',
    crossPair: ['engineer', 'summoner'],
    title: 'Духи-наводчики',
    blurb: 'Духи бьют твоими патронами: пробой и разрыв переносятся на них.',
    maxStacks: 1,
    effects: { spiritRounds: true },
  },
  {
    id: 'cross_swarm_rechase',
    crossPair: ['mechanic', 'summoner'],
    title: 'Дисциплина роя',
    blurb: 'Моты не уходят на переформирование: укус — и сразу новая цель.',
    maxStacks: 1,
    effects: { moteFastRechase: true },
  },
];

/** Собранный за забег билд: и цифры, и история выбора. */
export interface BuildState {
  fireIntervalMult: number;
  damage: number;
  pierce: number;
  explosiveRadiusFactor: number;
  /** Дальность автонаводки: стартует с базовой из tuning и растёт картами. */
  autoRangeFactor: number;
  maxTurrets: number;
  maxDroneMines: number;
  maxSpirits: number;
  maxSwarms: number;
  turretRateMult: number;
  spiritRateMult: number;
  turretRounds: boolean;
  spiritRounds: boolean;
  moteFastRechase: boolean;
  /** Профессия забега: ветка, которая набрала порог карт. До этого — null. */
  specialty: BranchId | null;
  /** Сколько раз каждая карта уже взята. */
  stacks: Record<string, number>;
  /** Порядок взятия. Это и есть «билд» в записи забега. */
  order: string[];
}

export function createBuild(): BuildState {
  return {
    fireIntervalMult: 1,
    damage: 0,
    pierce: 0,
    explosiveRadiusFactor: 0,
    autoRangeFactor: TUNING.weapon.targetRangeFactor,
    maxTurrets: 0,
    maxDroneMines: 0,
    maxSpirits: 0,
    maxSwarms: 0,
    turretRateMult: 1,
    spiritRateMult: 1,
    turretRounds: false,
    spiritRounds: false,
    moteFastRechase: false,
    specialty: null,
    stacks: {},
    order: [],
  };
}

export function stacksOf(build: BuildState, cardId: string): number {
  return build.stacks[cardId] ?? 0;
}

/**
 * Сколько карт взято в ветке. Считается по стеку, а не хранится отдельно:
 * два независимых счётчика одного и того же рано или поздно разойдутся.
 *
 * Крос-карты сюда не входят НАМЕРЕННО: они работают на стыке двух веток и не
 * должны выглядеть как вложение в одну из них — иначе одна крос-карта открывала
 * бы следующую и гибрид раздавался бы сам собой.
 */
export function branchPicks(build: BuildState, branch: BranchId): number {
  let picks = 0;
  for (const card of CARDS) {
    if (card.branch !== branch) continue;
    picks += stacksOf(build, card.id);
  }
  return picks;
}

/** Применяет карту к билду. Возвращает false, если карта уже исчерпана. */
export function applyCard(build: BuildState, card: Card): boolean {
  if (stacksOf(build, card.id) >= card.maxStacks) return false;

  build.stacks[card.id] = stacksOf(build, card.id) + 1;
  build.order.push(card.id);

  const e = card.effects;
  if (e.fireIntervalMult !== undefined) build.fireIntervalMult *= e.fireIntervalMult;
  if (e.damage !== undefined) build.damage += e.damage;
  if (e.pierce !== undefined) build.pierce += e.pierce;
  if (e.explosiveRadiusFactor !== undefined) build.explosiveRadiusFactor += e.explosiveRadiusFactor;
  if (e.autoRangeFactor !== undefined) build.autoRangeFactor += e.autoRangeFactor;
  if (e.maxTurrets !== undefined) build.maxTurrets += e.maxTurrets;
  if (e.maxDroneMines !== undefined) build.maxDroneMines += e.maxDroneMines;
  if (e.maxSpirits !== undefined) build.maxSpirits += e.maxSpirits;
  if (e.maxSwarms !== undefined) build.maxSwarms += e.maxSwarms;
  if (e.turretRateMult !== undefined) build.turretRateMult *= e.turretRateMult;
  if (e.spiritRateMult !== undefined) build.spiritRateMult *= e.spiritRateMult;
  if (e.turretRounds) build.turretRounds = true;
  if (e.spiritRounds) build.spiritRounds = true;
  if (e.moteFastRechase) build.moteFastRechase = true;

  // Профессия закрепляется ровно в момент порога и больше не меняется: это
  // решение игрока, и запись прогона обязана помнить именно его. Считать
  // профессию задним числом нельзя — правила карт поменяются, и старые таблицы
  // пересчитались бы иначе.
  const branch = card.branch;
  const threshold = TUNING.progression.specialtyPicks;
  if (build.specialty === null && branch && branchPicks(build, branch) >= threshold) {
    build.specialty = branch;
  }
  return true;
}

function drawBranchCard(build: BuildState, branch: BranchId, rng: Rng): Card | null {
  const available = CARDS.filter(
    (card) => card.branch === branch && stacksOf(build, card.id) < card.maxStacks,
  );
  if (available.length === 0) return null;
  return available[Math.floor(rng() * available.length)];
}

/**
 * Предложение уровня. До профессии — по одной доступной карте от каждой ветки.
 *
 * Именно так, а не «три случайные карты»: выбор между ветками должен быть
 * выбором стиля игры, а не лотереей. Внутри ветки карта берётся по сиду забега,
 * поэтому прогон остаётся воспроизводимым.
 *
 * После закрепления профессии правила меняются: чужие обычные карты исчезают из
 * предложения (иначе профессия ничего не значит), и вместо них приходят
 * крос-карты — по одной на каждую чужую ветку, в которой уже есть вложения.
 */
export function offerCards(build: BuildState, rng: Rng): Card[] {
  const specialty = build.specialty;
  if (specialty === null) {
    const offer: Card[] = [];
    for (const branch of BRANCHES) {
      const card = drawBranchCard(build, branch.id, rng);
      if (card) offer.push(card);
    }
    return offer;
  }

  const offer: Card[] = [];
  const main = drawBranchCard(build, specialty, rng);
  if (main) offer.push(main);

  for (const branch of BRANCHES) {
    if (branch.id === specialty) continue;
    if (branchPicks(build, branch.id) < TUNING.progression.crossMinPicks) continue;
    const cross = CARDS.find(
      (card) =>
        card.crossPair !== undefined &&
        card.crossPair.includes(specialty) &&
        card.crossPair.includes(branch.id) &&
        stacksOf(build, card.id) < card.maxStacks,
    );
    if (cross) offer.push(cross);
  }
  return offer;
}

/**
 * Сколько убийств нужно до следующего уровня. Растёт линейно: первые уровни
 * приходят быстро (игрок сразу видит, что прогрессия есть), дальше реже.
 */
export function xpForNextLevel(level: number): number {
  return (
    TUNING.progression.levelBaseKills + Math.floor(level / TUNING.progression.levelStepLevels)
  );
}
