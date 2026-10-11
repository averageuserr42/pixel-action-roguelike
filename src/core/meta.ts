/**
 * Мета: то, что переносится ИЗ забега в забег.
 *
 * До сих пор у игры была память только о форме вещей — история рекордов и
 * «подсказки показаны». Игроку это не даёт ничего: смерть каждый раз откатывает
 * всё, кроме таблички. Здесь появляется ровно один переносимый эффект —
 * достижения. Каждое открывается фактом ЗАВЕРШЁННОГО забега (убийства, время,
 * уровень, профессия, батареи) и даёт небольшой постоянный бонус на старте.
 *
 * Почему бонусы именно к СТАРТУ, а не к силе по ходу:
 * 1. Стартовые числа не разъезжаются с кривой уровня: усиливать середину забега
 *    означает пересчитывать каждую кривую по числу достижений.
 * 2. Мета не должна играть за игрока. Она сокращает первые минуты («уже видел,
 *    не хочу заново собирать с нуля»), а не решает бой — бой решает билд.
 * 3. Старт виден сразу и потому ощущается: игрок видит, ЧТО именно ему дала мета.
 *
 * Модуль чистый: ни Phaser, ни хранилища, ни часов. Факты забега сюда подаёт
 * сцена, а текст — дело store.
 */
/** Что забег рассказал о себе. Все числа уже посчитаны сценой. */
export interface MetaFacts {
  timeMs: number;
  kills: number;
  level: number;
  /** Профессия закреплена в этом забеге. */
  specialty: string | null;
  /** Сколько батарей подобрано за забег. */
  batteries: number;
}

export interface Achievement {
  id: string;
  title: string;
  /** Формулировка цели для игрока: «убить 10». */
  goal: string;
  /** Что достижение даёт. Текст обязан совпадать с цифрой в metaBonuses. */
  reward: string;
  done(f: MetaFacts): boolean;
}

/**
 * Список достижений. Пороги намеренно НИЗКИЕ: первое должно открыться в первом
 * же забеге, иначе мета не начнётся. Задача списка — не отделить мастеров, а
 * дать новичку почувствовать, что забег что-то оставил.
 */
export const ACHIEVEMENTS: readonly Achievement[] = [
  {
    id: 'first_blood',
    title: 'ПЕРВАЯ КРОВЬ',
    goal: 'убить 10',
    reward: '+4 Тока на старте',
    done: (f) => f.kills >= 10,
  },
  {
    id: 'survivor',
    title: 'ВЫЖИВШИЙ',
    goal: 'продержаться 1:30',
    reward: 'потолок Тока +4',
    done: (f) => f.timeMs >= 90_000,
  },
  {
    id: 'climber',
    title: 'ВЗБИРАЮЩИЙСЯ',
    goal: 'дожить до ур. 8',
    reward: '+1 мот на старте',
    done: (f) => f.level >= 8,
  },
  {
    id: 'master',
    title: 'МАСТЕР',
    goal: 'закрепить профессию',
    reward: '+1 батарея на старте',
    done: (f) => f.specialty !== null,
  },
  {
    id: 'collector',
    title: 'СОБИРАТЕЛЬ',
    goal: 'подобрать 25 батарей',
    reward: '+4 Тока на старте',
    done: (f) => f.batteries >= 25,
  },
];

export interface MetaState {
  /** Открытые достижения. Карта, а не список: «открыто ли» — вопрос на каждый забег. */
  unlocked: Record<string, boolean>;
}

export function createMeta(): MetaState {
  return { unlocked: {} };
}

/**
 * Отмечает открытые достижения и возвращает ТОЛЬКО новые: игроку показывают
 * именно их, а список всех открытых на экране смерти был бы шумом.
 *
 * Пометка идёт здесь, а не в сцене: если бы сцена сама решала «показывать», она
 * могла бы показать одно и то же дважды, а сохранение забыть — состояние меты
 * живёт в одном месте.
 */
export function unlockNew(meta: MetaState, facts: MetaFacts): Achievement[] {
  const fresh: Achievement[] = [];
  for (const a of ACHIEVEMENTS) {
    if (meta.unlocked[a.id]) continue;
    if (!a.done(facts)) continue;
    meta.unlocked[a.id] = true;
    fresh.push(a);
  }
  return fresh;
}

/**
 * Суммарный бонус открытого. Одна функция на все эффекты: иначе сцена собирала бы
 * его по частям, и достижение, добавленное в список, молча ничего не давало бы.
 */
export interface MetaBonuses {
  /** Добавка к стартовому Току. */
  startCharge: number;
  /** Добавка к потолку Тока. */
  capBonus: number;
  /** Сколько мотов даётся на старте сверх обычного. */
  startMotes: number;
  /** Сколько батарей помещается на поле сверх уровня. */
  startBatteries: number;
}

export function metaBonuses(meta: MetaState): MetaBonuses {
  const b: MetaBonuses = { startCharge: 0, capBonus: 0, startMotes: 0, startBatteries: 0 };
  if (meta.unlocked.first_blood) b.startCharge += 4;
  if (meta.unlocked.collector) b.startCharge += 4;
  if (meta.unlocked.survivor) b.capBonus += 4;
  if (meta.unlocked.climber) b.startMotes += 1;
  if (meta.unlocked.master) b.startBatteries += 1;
  return b;
}

/** «медалей 2 из 5» — игрок обязан видеть, что у меты есть дно и потолок. */
export function metaProgress(meta: MetaState): string {
  const done = ACHIEVEMENTS.filter((a) => meta.unlocked[a.id]).length;
  return `медалей ${done}/${ACHIEVEMENTS.length}`;
}

/**
 * Ближайшая невыполненная цель или null, если всё открыто. Нужна, потому что
 * медалей пять и они разные: без строки цели игрок не знает, что именно от него
 * хотят, и мета остаётся списком галочек, на которые нельзя повлиять.
 */
export function nextGoal(meta: MetaState): string | null {
  const a = ACHIEVEMENTS.find((x) => !meta.unlocked[x.id]);
  return a ? `${a.title} — ${a.goal}` : null;
}

/**
 * Разбор сохранённого. Неизвестные id выбрасываются: список достижений меняется,
 * а память остаётся, и старый ключ не должен оживлять удалённое достижение.
 */
export function parseMeta(text: string | null): MetaState {
  const meta = createMeta();
  if (!text) return meta;
  try {
    const parsed = JSON.parse(text) as Partial<MetaState>;
    const unlocked = parsed.unlocked ?? {};
    for (const a of ACHIEVEMENTS) if (unlocked[a.id]) meta.unlocked[a.id] = true;
  } catch {
    // Испорченная запись — это отсутствие записи: мета начинается заново.
  }
  return meta;
}

export function serializeMeta(meta: MetaState): string {
  return JSON.stringify({ unlocked: meta.unlocked });
}
