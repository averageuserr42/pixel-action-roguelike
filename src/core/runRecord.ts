import type { BranchId } from './progression';

export type FireMode = 'manual' | 'auto';
export type ControlScheme = 'keyboard' | 'touch';
/**
 * Режим давления врагов. Часть опознания прогона, а не украшение: результат
 * «хардкора» и «обычного» — это результаты разных игр, и в одной таблице им
 * места нет.
 */
export type RunMode = 'normal' | 'hardcore';

/**
 * Запись прогона. Профиль помощи фиксируется с самого начала, потому что
 * рекорды для ручного огня и для облегчённого режима обязаны жить в разных
 * таблицах: иначе игра с автострельбой обесценит чужие результаты, и поделить
 * их задним числом будет невозможно.
 *
 * Клиент не может проверить это сам в принципе. Смысл записи в том, чтобы
 * микросервер (когда он появится) получил профиль вместе с результатом и сам
 * решил, в какую таблицу его класть.
 *
 * Билд (picks) — не украшение, а часть того же вопроса: «что за забег был».
 * Две таблицы для профиля помощи бессмысленны, если один забег шёл с турелью
 * и разрывными, а другой — на голом стволе. Профессия (specialty) отвечает на
 * тот же вопрос с другой стороны — кем игрок этот забег прошёл.
 */
export interface RunRecord {
  version: 3;
  seed: number;
  /** Режим, в котором игрался прогон. Меняется только на экране смерти. */
  mode: RunMode;
  control: ControlScheme;
  /** Режим огня, который был активен на старте прогона. */
  fireModeAtStart: FireMode;
  /** Активна ли автоматическая наводка (следствие автострельбы). */
  autoAim: boolean;
  /** Менялся ли режим по ходу прогона: такой прогон для рекордов недействителен. */
  changedDuringRun: boolean;
  /** Взятые карты по порядку: это и есть билд забега. */
  picks: string[];
  /**
   * Профессия забега: ветка, которую игрок довёл до порога, или null, если не
   * довёл ни одну. Пишется в момент закрепления, а не выводится из picks: иначе
   * смена правил карт пересчитала бы задним числом уже сыгранные прогоны.
   */
  specialty: BranchId | null;
  /** Уровень, до которого забег дожил. */
  level: number;
}

export interface RunProfile {
  seed: number;
  mode: RunMode;
  control: ControlScheme;
  fireModeAtStart: FireMode;
  changedDuringRun: boolean;
}

/**
 * Запись собирается из двух частей: профиль помощи (кто играет и как) и билд
 * (что взято). Профиль меняется редко и с оговорками, билд — каждый уровень,
 * поэтому складывать их в одну структуру и переписывать целиком дешевле, чем
 * синхронизировать два независимых места.
 */
export function createRunRecord(
  profile: RunProfile,
  picks: readonly string[],
  level: number,
  specialty: BranchId | null,
): RunRecord {
  return {
    version: 3,
    seed: profile.seed,
    mode: profile.mode,
    control: profile.control,
    fireModeAtStart: profile.fireModeAtStart,
    autoAim: profile.fireModeAtStart === 'auto',
    changedDuringRun: profile.changedDuringRun,
    // Копия, а не ссылка: запись уезжает дальше (тесты, будущий сервер) и не
    // должна меняться, если билд продолжит расти.
    picks: [...picks],
    specialty,
    level,
  };
}
