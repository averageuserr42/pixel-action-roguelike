/**
 * Телеметрия забега: то, что превращает разговор о забеге из вкусового в
 * числовой. Модуль чистый — ни Phaser, ни часов внутри: сцена подаёт шаг,
 * суммы и состояние пула, а он их складывает. Здесь же собирается строка
 * отчёта, которую игрок копирует и присылает как есть.
 *
 * Доход считается по источникам РАЗДЕЛЬНО, и это не украшение отчёта: батареи
 * платят за движение, осколки — за урон. Пока числа лежали в одной куче, нельзя
 * было ответить на главный вопрос баланса — «хватает ли забегу энергии, когда он
 * вкладывается в урон, или весь доход приносят ноги».
 *
 * Расход и залог — тоже разведены: расход это цена постановок, а залог — доля
 * бюджета, которую держат живые фигуры. По этим двум числам видно, что именно
 * мешает поставить следующую фигуру: нехватка дохода или маленький потолок.
 */
export interface RunStats {
  /** Сколько длился забег. */
  timeMs: number;
  kills: number;
  /** Сколько батарей подобрано (не Тока, а именно предметов). */
  batteries: number;
  /** Сколько Тока дали батареи. */
  batteryTok: number;
  /** Сколько осколков подобрано с убитых. */
  drops: number;
  /** Сколько Тока дали осколки. */
  dropTok: number;
  /** Сколько Тока списано постановками фигур. */
  chargeSpent: number;
  /**
   * Сколько Тока было занято фигурами на пике забега.
   *
   * Это и есть цена силы выводка: фигура больше не платит за выстрел, она держит
   * долю бюджета, поэтому рост билда видно именно здесь. Раньше на этом месте был
   * «простой фигур» — после смены контракта он ничего не значит: фигуры работают
   * без Тока, а пустой пул — это нормальное состояние «копию на следующую».
   */
  heldMax: number;
  /** Сколько раз не хватило Тока на постановку фигуры. */
  dryRefusals: number;
  /**
   * Самый низкий уровень Тока в бою. Ноль здесь — не трагедия, а факт: по
   * этому числу видно, насколько тесно забегу с энергией.
   */
  minCharge: number;
}

export function createRunStats(): RunStats {
  return {
    timeMs: 0,
    kills: 0,
    batteries: 0,
    batteryTok: 0,
    drops: 0,
    dropTok: 0,
    chargeSpent: 0,
    heldMax: 0,
    dryRefusals: 0,
    minCharge: Infinity,
  };
}

/** Один шаг забега: время, минимум свободного Тока и пик занятого залога. */
export function stepStats(
  stats: RunStats,
  dt: number,
  chargeAmount: number,
  held: number,
): void {
  const ms = dt * 1000;
  stats.timeMs += ms;
  if (chargeAmount < stats.minCharge) stats.minCharge = chargeAmount;
  if (held > stats.heldMax) stats.heldMax = held;
}

export function noteKill(stats: RunStats): void {
  stats.kills++;
}

/** Подбор с поля: счётчик предметов и отдельно — сколько Тока они принесли. */
export function noteBattery(stats: RunStats, count: number, tok: number): void {
  stats.batteries += count;
  stats.batteryTok += tok;
}

/** Осколок с убитого: та же пара чисел, но свой источник дохода. */
export function noteDrop(stats: RunStats, count: number, tok: number): void {
  stats.drops += count;
  stats.dropTok += tok;
}

export function noteSpend(stats: RunStats, cost: number): void {
  stats.chargeSpent += cost;
}

export function noteRefusal(stats: RunStats): void {
  stats.dryRefusals++;
}

/** Минуты и секунды: «3:12». Для отчёта важнее читаемость, чем точность. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Что ещё нужно знать строке отчёта, кроме счётчиков. */
export interface StatsHead {
  seed: number;
  modeTitle: string;
  controlTitle: string;
  level: number;
  specialtyTitle: string | null;
  picks: readonly string[];
}

/**
 * Отчёт забега: пять коротких строк. Длинные строки не влезали бы на телефонный
 * экран — а именно там отчёт и читают. Текст самодостаточен: его понимает тот,
 * у кого нет доступа к записи прогона.
 *
 * Источники дохода разведены по строкам намеренно: по ним видно, кормит забег
 * движение или урон, и это первое, что нужно для правки баланса.
 */
export function formatStats(stats: RunStats, head: StatsHead): string[] {
  const min = stats.minCharge === Infinity ? 0 : stats.minCharge;
  return [
    `сид ${head.seed} · ${head.modeTitle} · ${head.controlTitle} · ${formatClock(stats.timeMs)}`,
    `ур. ${head.level} · ${head.specialtyTitle ?? 'без профессии'} · убито ${stats.kills}`,
    `доход: батарей ${stats.batteries} → ${Math.round(stats.batteryTok)}` +
      ` · осколков ${stats.drops} → ${Math.round(stats.dropTok)}`,
    `расход ${Math.round(stats.chargeSpent)} · занято ${Math.round(stats.heldMax)}` +
      ` · минимум ${Math.round(min)} · отказов ${stats.dryRefusals}`,
    `взято: ${head.picks.length > 0 ? head.picks.join(', ') : '—'}`,
  ];
}

/** Тот же отчёт одной строкой — для копирования в мессенджер. */
export function reportLine(stats: RunStats, head: StatsHead): string {
  return formatStats(stats, head).join(' | ');
}
