/**
 * Подсказки первого забега. После смены правил (у игрока больше нет оружия, а
 * Ток приносят батареи и тратится он на ВЫЗОВ фигур) петлю надо не угадывать, а
 * увидеть: иначе первые минуты уходят на «почему фигура не встаёт».
 *
 * Подсказки независимы друг от друга: каждая привязана к своему факту, и
 * порядок показа задаёт ход забега, а не номер в списке. Иначе подсказка про
 * голод, которая может не наступить, запирала бы следующую.
 *
 * Модуль чистый: время и счётчики приходят аргументом.
 */
export interface IntroFacts {
  /** Сколько батарей подобрано. */
  batteries: number;
  /** Сколько Тока уже потрачено на постановки фигур. */
  spent: number;
  /**
   * Сколько раз не хватило Тока на новую фигуру. Именно отказ, а не пустой пул:
   * пустой пул — это нормальное состояние «копию на следующую фигуру», а отказ —
   * событие, которое игрок видит и чувствует.
   */
  refusals: number;
  /** Сколько миллисекунд игрок стоял без движения и дэша. */
  idleMs: number;
}

interface Hint {
  text: string;
  ready(f: IntroFacts): boolean;
}

const HINTS: readonly Hint[] = [
  { text: 'СОБЕРИ БАТАРЕЮ — ЭТО ТОК ФИГУР', ready: () => true },
  { text: 'ТОК ПЛАТИТСЯ ЗА ПОСТАНОВКУ ФИГУРЫ', ready: (f) => f.batteries >= 1 },
  { text: 'НЕТ ТОКА — НОВАЯ ФИГУРА НЕ ВСТАНЕТ', ready: (f) => f.refusals >= 2 },
  { text: 'СТОИШЬ — КРЫЛО ГАСНЕТ', ready: (f) => f.idleMs > 2500 },
];

export interface IntroState {
  /** Какие подсказки уже показаны в этом забеге. */
  shown: boolean[];
}

export function createIntro(): IntroState {
  return { shown: HINTS.map(() => false) };
}

/** Версия для игрока, который уже видел подсказки: показать нечего. */
export function muteIntro(state: IntroState): void {
  state.shown = HINTS.map(() => true);
}

export function introMuted(state: IntroState): boolean {
  return state.shown.every(Boolean);
}

/**
 * Следующая подсказка, которую пора показать, или null. Каждая показывается
 * один раз за забег: повтор читался бы как заедание.
 */
export function nextHint(state: IntroState, facts: IntroFacts): string | null {
  for (let i = 0; i < HINTS.length; i++) {
    if (state.shown[i]) continue;
    if (!HINTS[i].ready(facts)) continue;
    state.shown[i] = true;
    return HINTS[i].text;
  }
  return null;
}
