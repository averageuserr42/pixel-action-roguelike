import { TUNING } from '../config/tuning';
import type { EnemyKindId } from '../config/enemyKinds';
import type { Rng } from './rng';

/**
 * Прогрессия забега: опыт, уровни, таланты и профессия.
 *
 * Три ветки — три разных способа играть, а не три набора цифр:
 *  - ЭНЕРГЕТИК отвечает за Ток: ёмкость, батареи, резерв и цену действий фигур.
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
export type BranchId = 'energy' | 'mechanic' | 'summoner';

export interface Branch {
  id: BranchId;
  title: string;
  /** Цвет ветки в интерфейсе выбора таланта. */
  color: number;
}

export const BRANCHES: readonly Branch[] = [
  { id: 'energy', title: 'ЭНЕРГЕТИК', color: 0x8ef0b0 },
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
  /** Прибавка к потолку Тока. */
  chargeCap?: number;
  /**
   * Прибавка к Току за одну батарею — ПОВЕРХ уровня, а не вместо него: базовую
   * ценность задаёт снабжение режима, иначе карта обесценивала бы рост уровня.
   */
  batteryBonus?: number;
  /** Сколько батарей помещается на поле сверх уровня. */
  extraBatterySlots?: number;
  /**
   * Множитель паузы между батареями. Место на поле ничего не даёт: доход задаёт
   * ТЕМП появления батарей, а не число свободных кружков (замер стенда: поле
   * успевает пустеть между появлениями). Поэтому карта ускоряет сам темп.
   */
  supplyIntervalMult?: number;
  /** Множитель цены действий фигур (меньше — дешевле). */
  costMult?: number;
  /**
   * Доля потолка, ниже которой Ток не утекает вовсе. Растёт со стопками: две
   * карты защищают вдвое больше, а «Ёмкость» от этого перестаёт быть мёртвой —
   * она растит защищённую часть пула.
   */
  decayReserve?: number;
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
  /** Крос ЭНЕРГЕТИК×МЕХАНИК: выстрел турели идёт насквозь. */
  turretPierce?: number;
  /** Крос ЭНЕРГЕТИК×СУММОНЕР: выстрел духа идёт насквозь. */
  spiritPierce?: number;
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
  // Энергетик — Ток: ёмкость, батареи и цена постановок. Ствола в забеге нет,
  // поэтому ветка отвечает не за силу выстрела, а за то, СКОЛЬКО фигур вообще
  // поместится: каждая живая фигура держит залог, и потолок — это бюджет выводка.
  // Замеры без залога показали цену ошибки: доход перекрывал расход вчетверо
  // (173 против 40 за 1:23), и карты энергии игрок не брал вовсе.
  {
    id: 'nrg_cap',
    branch: 'energy',
    title: 'Ёмкость',
    blurb: 'Потолок Тока выше на 8: держать его полным проще.',
    maxStacks: 3,
    effects: { chargeCap: 8 },
  },
  {
    id: 'nrg_cell',
    branch: 'energy',
    title: 'Плотная батарея',
    blurb: 'Батарея даёт на 2 Тока больше — дольше держится напряжение.',
    maxStacks: 3,
    effects: { batteryBonus: 2 },
  },
  {
    id: 'nrg_field',
    branch: 'energy',
    title: 'Разгон батарей',
    blurb: 'Батареи появляются на 15% чаще.',
    maxStacks: 2,
    // Было «+1 батарея на поле» — и это не давало ничего: доход задаёт темп
    // появления, а не число мест (замер стенда: поле успевает пустеть между
    // батареями при любом билде). Карта, которой нечего менять, — мёртвая карта.
    effects: { supplyIntervalMult: 0.85 },
  },
  {
    id: 'nrg_economy',
    branch: 'energy',
    title: 'Экономия',
    blurb: 'Постановка фигур стоит на 15% меньше.',
    maxStacks: 3,
    effects: { costMult: 0.85 },
  },
  {
    // Id переименован вместе с эффектом: старая «Удержание» множила затухание,
    // новая «Резерв» держит его порогом. Старые записи забегов содержат
    // nrg_hold — это они сами, отчёт по ним читается в старом смысле карты.
    id: 'nrg_reserve',
    branch: 'energy',
    title: 'Резерв',
    blurb: 'Свободный пул не течёт, пока в нём меньше двух делений из десяти.',
    maxStacks: 2,
    effects: { decayReserve: 0.2 },
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
    id: 'cross_turret_pierce',
    crossPair: ['energy', 'mechanic'],
    title: 'Бронебойные турели',
    blurb: 'Выстрел турели проходит сквозь лишнего врага.',
    maxStacks: 1,
    effects: { turretPierce: 1 },
  },
  {
    id: 'cross_spirit_pierce',
    crossPair: ['energy', 'summoner'],
    title: 'Духи-наводчики',
    blurb: 'Выстрел духа проходит сквозь лишнего врага.',
    maxStacks: 1,
    effects: { spiritPierce: 1 },
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
  /** Потолок Тока: стартует с базового из tuning и растёт картами. */
  chargeCap: number;
  /** Ток за одну батарею — ПОПРАВКА к уровню, который даёт снабжение режима. */
  batteryBonus: number;
  /** Сколько батарей помещается на поле сверх уровня. */
  extraBatterySlots: number;
  /** Множитель паузы между батареями: меньше единицы — темп выше. */
  supplyIntervalMult: number;
  /** Множитель цены постановки фигур. */
  costMult: number;
  /** Доля потолка, ниже которой Ток не утекает. */
  decayReserve: number;
  maxTurrets: number;
  maxDroneMines: number;
  maxSpirits: number;
  maxSwarms: number;
  turretRateMult: number;
  spiritRateMult: number;
  turretPierce: number;
  spiritPierce: number;
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
    chargeCap: TUNING.charge.capBase,
    // Снабжение уровня приходит из supply на каждый шаг, а билд держит только
    // ПОПРАВКУ карт: два независимых источника батарейной цены разъехались бы.
    batteryBonus: 0,
    extraBatterySlots: 0,
    supplyIntervalMult: 1,
    costMult: 1,
    decayReserve: 0,
    maxTurrets: 0,
    maxDroneMines: 0,
    maxSpirits: 0,
    maxSwarms: 0,
    turretRateMult: 1,
    spiritRateMult: 1,
    turretPierce: 0,
    spiritPierce: 0,
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
  if (e.chargeCap !== undefined) build.chargeCap += e.chargeCap;
  if (e.batteryBonus !== undefined) build.batteryBonus += e.batteryBonus;
  if (e.extraBatterySlots !== undefined) build.extraBatterySlots += e.extraBatterySlots;
  if (e.supplyIntervalMult !== undefined) build.supplyIntervalMult *= e.supplyIntervalMult;
  if (e.costMult !== undefined) build.costMult *= e.costMult;
  if (e.decayReserve !== undefined) build.decayReserve += e.decayReserve;
  if (e.maxTurrets !== undefined) build.maxTurrets += e.maxTurrets;
  if (e.maxDroneMines !== undefined) build.maxDroneMines += e.maxDroneMines;
  if (e.maxSpirits !== undefined) build.maxSpirits += e.maxSpirits;
  if (e.maxSwarms !== undefined) build.maxSwarms += e.maxSwarms;
  if (e.turretRateMult !== undefined) build.turretRateMult *= e.turretRateMult;
  if (e.spiritRateMult !== undefined) build.spiritRateMult *= e.spiritRateMult;
  if (e.turretPierce !== undefined) build.turretPierce += e.turretPierce;
  if (e.spiritPierce !== undefined) build.spiritPierce += e.spiritPierce;
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

/**
 * Сколько опыта стоит УБИЙСТВО ЦЕЛИ, а не «одно убийство».
 *
 * Зачем. Опыт был плоским (1 за любого), и это тихо награждало за добивание
 * мелочи: когда рой получил общую цель и начал танковать толстых (см.
 * systems/targeting), темп убийств упал — замер: 50 → 39 за тот же забег, а
 * вместе с ним и уровни (10 → 8), хотя суммарный урон вырос не стал. То есть
 * правильное поведение (убить танка) наказывалось медленной прогрессией, а
 * неправильное (расклевать погонял) — быстрой.
 *
 * Теперь цена цели в опыте следует той же логике, что и цена в уроне: танк
 * даёт столько, сколько стоит его убийство (его HP ×3 от базы врага), стрелок —
 * меньше, но больше мелочи (его надо догонять, а он бьёт издалека), элита —
 * надбавку за своё свойство. Делитель сознательно остаётся дешёвым: он и так
 * даёт тройное убийство (сам плюс двое детей).
 *
 * Эффект на кривую намеренно нейтральный: за старый «плоский» темп убийств
 * забег получает примерно столько же опыта, но уже за СМЫСЛОВЫЕ цели.
 */
export function xpForKill(kindId: EnemyKindId, elite: boolean): number {
  let multiplier = 1;
  if (kindId === 'tank') multiplier += 2;
  else if (kindId === 'shooter') multiplier += 1;
  if (elite) multiplier += 2;
  return TUNING.progression.xpPerKill * multiplier;
}
