import type { BranchId } from './progression';
import { RUN_RECORD_VERSION, type ControlScheme, type RunMode } from './runRecord';

/**
 * История забегов: последние результаты, чтобы «стало лучше» было фактом, а не
 * воспоминанием. Модуль чистый: он не знает ни о localStorage, ни о браузере —
 * сцена отдаёт ему строку и забирает список. Разбор намеренно терпимый: испортив
 * хранилище, игрок не должен остаться без игры.
 */
export interface RunResult {
  /**
   * Правила, которыми сыгран забег. Раньше поля не было, и прогоны разных
   * контрактов лежали в одной таблице без различения: рекорд мог быть взят в
   * игре с другими числами урона или защиты, и «стало лучше» превращалось в
   * сравнение разных игр. Теперь версия едет вместе с записью, а разбор
   * отсекает чужие (`asResult`).
   */
  version: number;
  /** Когда забег закончился, миллисекунды эпохи. */
  at: number;
  seed: number;
  mode: RunMode;
  control: ControlScheme;
  timeMs: number;
  level: number;
  kills: number;
  specialty: BranchId | null;
  /** Взятые карты по порядку. */
  picks: string[];
  /** false — по ходу забега менялся способ управления: такой результат несравним. */
  valid: boolean;
}

/** Сколько результатов держим. Больше — уже не память, а архив. */
export const HISTORY_CAP = 10;

/** Новый результат идёт первым: свежее важнее давнего. */
export function appendResult(list: readonly RunResult[], result: RunResult): RunResult[] {
  return [result, ...list].slice(0, HISTORY_CAP);
}

/**
 * Лучший результат. Сравниваем по времени: забег — про то, сколько продержался.
 * При равном времени решают уровень и убийства — иначе две одинаковые минуты
 * выглядели бы как ничья. Недействительные забеги в лучшие не идут: иначе
 * смена управления по ходу давала бы «рекорд».
 */
export function bestOf(list: readonly RunResult[]): RunResult | null {
  let best: RunResult | null = null;
  for (const r of list) {
    // Чужие правила — мимо: рекорд из другой игры не является рекордом в этой.
    // Разбор и так отсекает такие записи, но лучший ищется по списку целиком,
    // и защита только на входе держалась бы на том, что никто не позвал bestOf
    // с руками.
    if (r.version !== RUN_RECORD_VERSION) continue;
    if (!r.valid) continue;
    if (best === null || isBetter(r, best)) best = r;
  }
  return best;
}

function isBetter(a: RunResult, b: RunResult): boolean {
  if (a.timeMs !== b.timeMs) return a.timeMs > b.timeMs;
  if (a.level !== b.level) return a.level > b.level;
  return a.kills > b.kills;
}

/**
 * Строка истории без даты: дату и название режима подставляет сцена, чтобы
 * модуль остался детерминированным и не знал про подписи интерфейса.
 */
export function formatResultLine(r: RunResult, modeTitle: string): string {
  const spec = r.specialty ? ` · ${r.specialty}` : '';
  const mark = r.valid ? '' : ' · недействителен';
  return `${timeText(r.timeMs)} · ${modeTitle} · ур. ${r.level} · убито ${r.kills}${spec}${mark}`;
}

function timeText(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

/**
 * Разбор хранилища. Любая неожиданность — не ошибка, а отсутствие истории:
 * испорченная запись отбрасывается, остальные остаются.
 */
export function parseHistory(raw: string | null): RunResult[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: RunResult[] = [];
  for (const item of parsed) {
    const r = asResult(item);
    if (r) out.push(r);
    if (out.length >= HISTORY_CAP) break;
  }
  return out;
}

function asResult(value: unknown): RunResult | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  // Запись других правил — это не мусор и не ошибка, но в ЭТУ таблицу она не
  // идёт: прогоны разных контрактов несравнимы (см. RUN_RECORD_VERSION).
  // Записи без версии (до 6-й) отсекаются тем же правилом.
  if (v.version !== RUN_RECORD_VERSION) return null;
  if (typeof v.at !== 'number' || typeof v.seed !== 'number') return null;
  if (typeof v.timeMs !== 'number' || typeof v.level !== 'number') return null;
  if (typeof v.kills !== 'number') return null;
  if (v.mode !== 'normal' && v.mode !== 'hardcore') return null;
  if (v.control !== 'keyboard' && v.control !== 'touch') return null;
  const specialty = v.specialty;
  if (specialty !== null && typeof specialty !== 'string') return null;
  const picks = Array.isArray(v.picks) ? v.picks.filter((p): p is string => typeof p === 'string') : [];
  return {
    version: RUN_RECORD_VERSION,
    at: v.at,
    seed: v.seed,
    mode: v.mode,
    control: v.control,
    timeMs: v.timeMs,
    level: v.level,
    kills: v.kills,
    specialty: (specialty as BranchId | null) ?? null,
    picks,
    valid: v.valid !== false,
  };
}

export function serializeHistory(list: readonly RunResult[]): string {
  return JSON.stringify(list.slice(0, HISTORY_CAP));
}
