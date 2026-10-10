/**
 * Виды врагов. До этого вида был ровно один — догоняющий с замахом и выпадом, —
 * и вся сложность сводилась к цифрам того же самого врага. Здесь вид описан
 * данными, а не классом: у каждого вида своё ПОВЕДЕНИЕ (что он делает) и своя
 * цена отказа от него, поэтому виды различаются требованием к игроку, а не
 * размером полоски здоровья.
 *
 * Модуль чистый: ни Phaser, ни времени, ни состояния. Числа вида живут здесь
 * (это его определение), а числа брони, элит и пулов снарядов — в tuning.
 *
 * HP вида — МНОЖИТЕЛЬ к `enemyHpForLevel(level)`, а не своё число: кривая
 * сложности остаётся в одном месте (`enemy.ts`), и толстый вид не выбивается из
 * неё на высоких уровнях. Порядок применения: умножить, затем ограничить
 * пределом HP.
 */
export type EnemyKindId = 'charger' | 'tank' | 'shooter' | 'splitter';

/** Что вид умеет делать. Поведение реализовано в enemyBrain, по одной функции на вид. */
export type EnemyBehavior = 'orbit-charge' | 'walk' | 'standoff-shoot' | 'split-on-death';

export interface EnemyKind {
  id: EnemyKindId;
  title: string;
  behavior: EnemyBehavior;
  /**
   * Цвет заливки. У погонялы он не используется: её цвет — это её СОСТОЯНИЕ
   * (искать, замах, выпад, откат), и ломать читаемый цикл незачем
   * (`usesStateColors`).
   */
  color: number;
  radius: number;
  hpMult: number;
  speedMult: number;
  /** Относительный вес при выборе вида режиссёром спавна. */
  spawnWeight: number;
  /** С какого уровня игрока вид вообще появляется: первый уровень — не лотерея. */
  minLevel: number;
  /** Занимает ли вид слот на кольце окружения (это про погоню, а не про стрельбу). */
  usesRing: boolean;
  /** Может ли сцена назначить вид перехватчиком на маршруте игрока. */
  canIntercept: boolean;
  /** Красится ли вид цветом фазы вместо своего цвета. */
  usesStateColors: boolean;
}

export const ENEMY_KINDS: readonly EnemyKind[] = [
  {
    id: 'charger',
    title: 'Погоняла',
    behavior: 'orbit-charge',
    // Цвет фазы «искать»: остальные фазы вид берёт из STATE_COLOR в enemy.ts.
    color: 0x6ee7ff,
    radius: 5,
    hpMult: 1,
    speedMult: 1,
    // Вес задан заметно выше остальных: погоняла — тот, кто держит кольцо, и без
    // него поле перестаёт окружать игрока.
    spawnWeight: 60,
    minLevel: 1,
    usesRing: true,
    canIntercept: true,
    usesStateColors: true,
  },
  {
    id: 'tank',
    title: 'Танк',
    behavior: 'walk',
    color: 0x6b5b95,
    // Крупнее всех: его видно издалека, и это часть телеграфа — танк не делает
    // выпадов, поэтому единственное, что о нём надо знать заранее, — что он прёт.
    radius: 7,
    hpMult: 3,
    speedMult: 0.6,
    spawnWeight: 25,
    minLevel: 3,
    usesRing: false,
    canIntercept: false,
    usesStateColors: false,
  },
  {
    id: 'shooter',
    title: 'Стрелок',
    behavior: 'standoff-shoot',
    color: 0x7ddc7d,
    radius: 5,
    hpMult: 0.7,
    speedMult: 1,
    spawnWeight: 25,
    minLevel: 5,
    usesRing: false,
    canIntercept: false,
    usesStateColors: false,
  },
  {
    id: 'splitter',
    title: 'Делитель',
    behavior: 'split-on-death',
    // Спека: радиус 3 и скорость ×1.3 (план в этом месте расходился со спекой —
    // см. решение в ledger). Мелкий и быстрый — потому его и трудно добить до
    // деления.
    color: 0xff7ad9,
    radius: 3,
    hpMult: 0.7,
    speedMult: 1.3,
    spawnWeight: 20,
    minLevel: 7,
    usesRing: false,
    canIntercept: false,
    usesStateColors: false,
  },
];

export function kindById(id: EnemyKindId): EnemyKind {
  const kind = ENEMY_KINDS.find((k) => k.id === id);
  if (!kind) throw new Error(`неизвестный вид врага: ${id}`);
  return kind;
}

/** Виды, доступные на этом уровне игрока. Порядок — порядок открытия. */
export function kindsForLevel(level: number): EnemyKind[] {
  return ENEMY_KINDS.filter((kind) => level >= kind.minLevel);
}
