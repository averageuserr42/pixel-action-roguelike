import Phaser from 'phaser';
import { TUNING } from '../config/tuning';
import { createIntro, introMuted, muteIntro, nextHint, type IntroState } from '../core/intro';
import { approach, clampToBounds, distance, type Vec2 } from '../core/math';
import {
  applyCard,
  branchTitle,
  createBuild,
  offerCards,
  xpForNextLevel,
  type BranchId,
  type BuildState,
  type Card,
} from '../core/progression';
import { mulberry32, randomSeed, type Rng } from '../core/rng';
import {
  appendResult,
  bestOf,
  formatResultLine,
  parseHistory,
  serializeHistory,
  type RunResult,
} from '../core/runHistory';
import {
  createRunRecord,
  type RunMode,
  type RunRecord,
  type RunProfile,
} from '../core/runRecord';
import {
  createRunStats,
  formatClock,
  formatStats,
  noteBattery,
  noteDrop,
  noteKill,
  noteRefusal,
  noteSpend,
  reportLine,
  stepStats,
  type RunStats,
  type StatsHead,
} from '../core/runStats';
import { copyText, HISTORY_KEY, INTRO_KEY, loadText, saveText } from '../core/store';
import { isTouchDevice, VIEW } from '../core/viewport';
import {
  Ally,
  deployCost,
  holdCost,
  isWingKind,
  type AllyContext,
  type AllyKind,
} from '../entities/ally';
import { Enemy } from '../entities/enemy';
import { eliteChanceAt, enemySpawnIntervalAt, enemyTargetCount } from '../systems/pressure';
import { FixedStep } from '../sim/fixedStep';
import {
  add,
  avail,
  chargeNorm,
  clearHold,
  createCharge,
  hold,
  setCap,
  spend,
  stepCharge,
  type Charge,
} from '../systems/charge';
import { eliteNumbers, pickSpawn } from '../systems/spawnDirector';
import {
  addPickup,
  collect,
  createPickupField,
  createTally,
  spawnPoint,
  stepAge,
  takeSpawn,
  type PickupField,
  type PickupSpec,
  type PickupTally,
} from '../systems/pickups';
import { supplyAt, type Supply } from '../systems/supply';
import { InputHub } from '../systems/input';
import { Projectiles } from '../systems/projectiles';
import { Sfx, type AudioContextLike } from '../systems/sfx';
import { CardPicker } from '../ui/cards';
import { Juice } from '../ui/juice';

const PLAYER_ALIVE_COLOR = 0xffe066;
const PLAYER_IFRAMES_COLOR = 0xffffff;
const PLAYER_DEAD_COLOR = 0x3a3550;
const BATTERY_COLOR = 0xffd23f;
const BATTERY_STROKE = 0x8a6f00;
/**
 * Осколок цвета чистой энергии: он обязан отличаться и от батареи (жёлтой), и
 * от врагов (у тех свои цвета состояний), и от спутников. Светло-голубой не
 * занят никем, а сам вид мельче и тускнеет быстрее — осколок видно как вспышку,
 * а не как забытую батарею.
 */
const DROP_COLOR = 0xeaf6ff;
const DROP_STROKE = 0x5c7fa3;
/** Кольца событий: попадание белое, смерть врага — цветом угрозы, тёплым. */
const HIT_RING_COLOR = 0xffffff;
const KILL_RING_COLOR = 0xff9f1c;
/** Как режимы называются игроку. Числа живут в tuning, названия — только здесь. */
const MODE_TITLE: Record<RunMode, string> = { normal: 'ОБЫЧНЫЙ', hardcore: 'ХАРДКОР' };

/** Шкала Тока для HUD: десять делений, полные и пустые. */
function chargeBar(c: Charge): string {
  const filled = Math.round(chargeNorm(c) * 10);
  return `[${'■'.repeat(filled)}${'□'.repeat(10 - filled)}]`;
}

export class GameScene extends Phaser.Scene {
  private sim!: FixedStep;
  private rng: Rng = mulberry32(1);
  private seed = 1;
  /**
   * Профиль текущего прогона. Публичный намеренно: его будет читать слой
   * сохранений и отправки результатов на сервер, а пока — тесты и HUD.
   */
  runRecord!: RunRecord;

  /** Телеметрия забега: счётчики, из которых собирается отчёт. */
  private stats: RunStats = createRunStats();
  /** Подсказки первого забега. Показываются один раз на игрока. */
  private intro: IntroState = createIntro();
  /** История прошлых забегов: с чем сравнивать текущий. */
  private history: RunResult[] = [];
  /** Строки итога на экране смерти: их переставляет поворот экрана. */
  private summary: Phaser.GameObjects.Text[] = [];
  private bestLabel?: Phaser.GameObjects.Text;
  private copyLabel?: Phaser.GameObjects.Text;
  /** Строка отчёта одной строкой — то, что копирует кнопка на экране смерти. */
  private report = '';

  private controls!: InputHub;
  private grid!: Phaser.GameObjects.Graphics;
  private player!: Phaser.GameObjects.Arc;
  private deathText?: Phaser.GameObjects.Text;
  private hud!: Phaser.GameObjects.Text;
  /** Форма HUD: на узком поле одна строка не влезает, и он переносится на две. */
  private hudWrapped = false;
  private hudSignature = '';
  /** Строка о закреплении профессии: событие разовое, дальше о нём говорит HUD. */
  private toast?: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  /** Строка уровня и последнего взятого таланта. */
  private pickLine!: Phaser.GameObjects.Text;
  private status!: Phaser.GameObjects.Text;
  private restartKey!: Phaser.Input.Keyboard.Key;

  private enemies: Enemy[] = [];
  /** Переиспользуемый порядок врагов по углу: в шаге нет аллокаций. */
  private readonly slotOrder: Enemy[] = [];
  /** Остаток паузы до следующего врага, пока на поле меньше целевого числа. */
  private spawnTimerMs = 0;
  /** Угол кольца окружения: враги обходят игрока по кругу, а не стоят стеной. */
  private orbitT = 0;
  private killed = 0;
  /**
   * Режим давления. Меняется только на экране смерти, иначе забег несравним.
   *
   * По умолчанию — хардкор: обратная связь игрока была однозначной («обычный
   * слишком лёгкий, я специально умер, чтобы не играть его»), а выбор режима
   * живёт на экране смерти и до него надо было ещё дожить. Обычный никуда не делся:
   * он остаётся вторым в списке на экране смерти — как передышка, а не как вход.
   */
  private mode: RunMode = 'hardcore';
  /** Строки выбора режима: живут только на экране смерти. */
  private modeLabels: Phaser.GameObjects.Text[] = [];

  /** Снаряды общие для игрока, турелей и духов: один пул, одна ветка попаданий. */
  private shots!: Projectiles;
  private allies: Ally[] = [];
  private picker!: CardPicker;
  /** Сочность: кольца, подписи, следы и тряска. Отдельный слой от логики боя. */
  private juice!: Juice;
  /** Звук: синтез осциллятором, поэтому файлов в проекте нет. */
  private sfx!: Sfx;
  /**
   * Звуковой контекст. Создаётся лениво и один раз: браузер не даёт играть до
   * первого жеста, поэтому до него создавать просто нечего.
   */
  private audio: AudioContextLike | null = null;
  /** Миллисекунд без движения и дэша: после паузы крылья гаснут. */
  private idleMs = 0;
  /** Правило про гаснущее крыло показывается один раз за забег: иначе оно невидимо. */
  private wingsToldAbout = false;
  /** Слоты строя. Общие для духов и мотов: делить их по видам — значит ставить мот в крыло духа. */
  private wingSlots = 0;
  /** Первый отказ фигур из-за пустого пула: тост показывается один раз за забег. */
  private dryTold = false;

  /** Собранный за забег билд: и цифры, и порядок выбора для записи. */
  private build: BuildState = createBuild();
  private level = 1;
  private xp = 0;
  /** Уровней, ждущих выбора: один шаг может поднять сразу два. */
  private pendingLevels = 0;
  /** Пока открыт выбор таланта, мир стоит. */
  private choosing = false;
  private lastPickTitle = '';

  /** Враги, погибшие в этом шаге. Убираются и считаются один раз, после всех. */
  private readonly pendingKills: Enemy[] = [];
  /**
   * Ток фигур: единственный ресурс забега. Добывается подбором батарей с поля,
   * поэтому фигуры работают ровно настолько, насколько игрок успевает двигаться.
   */
  private readonly charge: Charge = createCharge(TUNING.charge.capBase);
  /**
   * Снабжение текущего уровня: сколько даёт батарея, как часто она появляется,
   * сколько мест на поле и сколько стоит осколок с убитого. Пересчитывается на
   * каждом новом уровне: расход растёт с каждой фигурой и с каждым уровнем
   * врага, и фиксированный доход обгонялся бы им — забег упирался бы в голод,
   * а игрок обязан был бы вкладывать все уровни только в энергию.
   */
  private supply: Supply = supplyAt('normal', 1);
  /** Предметы Тока на поле: батареи и осколки. Правила — в systems/pickups. */
  private readonly pickups: PickupField = createPickupField();
  /** Круги под предметы. Пул, чтобы в игровом шаге не было аллокаций. */
  private pickupArcs: Phaser.GameObjects.Arc[] = [];
  /** Что собрал этот шаг. Переиспользуется: подбор идёт каждые 8 мс. */
  private readonly tally: PickupTally = createTally();

  /** Переиспользуемый контекст спутников: в игровом шаге нет аллокаций. */
  private readonly allyContext: AllyContext = {
    playerPos: { x: 0, y: 0 },
    playerFacing: { x: 1, y: 0 },
    playerActive: true,
    enemies: [],
    shots: null as unknown as Projectiles,
    damage: (enemy, amount) => this.damage(enemy, amount),
    // Цель враждебных выстрелов стрелка: тот же путь, что и контакт, поэтому
    // окно неуязвимости после удара защищает и от пули, и от тела.
    player: { pos: { x: 0, y: 0 }, radius: TUNING.player.radius, hit: () => this.hitByShot() },
    turretRateMult: 1,
    spiritRateMult: 1,
    turretPierce: 0,
    spiritPierce: 0,
    moteFastRechase: false,
  };

  /** Профиль помощи: кто играет и как. Отдельно от билда — он редко меняется. */
  private readonly profile: RunProfile = {
    seed: 1,
    mode: 'normal',
    control: 'keyboard',
    changedDuringRun: false,
  };

  private pos: Vec2 = { x: 0, y: 0 };
  private vel: Vec2 = { x: 0, y: 0 };
  /** Скорость прошлого шага: из неё считается ускорение для точки перехвата. */
  private readonly prevVel: Vec2 = { x: 0, y: 0 };
  private facing: Vec2 = { x: 1, y: 0 };

  private dashT = 0;
  private dashCdT = 0;
  private iFramesT = 0;
  private dashBufferT = 0;
  /**
   * Остаток пула ошибок. Контакт теперь снимает один удар, а не забег: смерть
   * приходит на третьем — и только если игрок не вышел из-под следующего.
   */
  private hp = TUNING.player.hits;
  /** Идёт ли напряжение: Ток выше порога — фигуры работают быстрее. */
  private boosted = false;
  private restartRequested = false;
  private dead = false;
  /** false, пока забег не начался: до первого действия профиль помощи ещё уточняется. */
  private profileLocked = false;

  constructor() {
    super('game');
  }

  init(data: { seed?: number; mode?: RunMode }): void {
    this.restartRequested = false;
    this.seed = data.seed ?? randomSeed();
    this.mode = data.mode ?? 'normal';
    this.rng = mulberry32(this.seed);
    this.sim = new FixedStep(TUNING.sim.stepMs, TUNING.sim.maxStepsPerFrame);
  }

  create(): void {
    this.dead = false;
    this.dashT = 0;
    this.dashCdT = 0;
    this.iFramesT = 0;
    this.dashBufferT = 0;
    this.hp = TUNING.player.hits;
    this.vel = { x: 0, y: 0 };
    this.prevVel.x = 0;
    this.prevVel.y = 0;
    this.facing = { x: 1, y: 0 };
    this.pos = { x: VIEW.w / 2, y: VIEW.h / 2 };
    this.enemies = [];
    this.spawnTimerMs = 0;
    this.orbitT = 0;
    this.killed = 0;
    this.modeLabels = [];
    this.profileLocked = false;
    this.deathText = undefined;
    this.toast = undefined;
    this.hudWrapped = false;
    this.hudSignature = '';

    this.build = createBuild();
    // Стартовая стая — часть билда, а не отдельный подарок: карта «Стая» потом
    // добирает мотов до предела, и без этого учёта первая карта не дала бы
    // ничего.
    this.build.maxSwarms = TUNING.progression.startSwarms;
    this.level = 1;
    this.xp = 0;
    this.pendingLevels = 0;
    this.choosing = false;
    this.lastPickTitle = '';
    this.allies = [];
    this.idleMs = 0;
    this.allyContext.playerActive = true;
    this.wingSlots = 0;
    this.wingsToldAbout = false;
    this.dryTold = false;
    // Порядок важен: сначала снять залог прошлого забега, потом потолок (он
    // подрезает пул по свободному Току), и только затем выдать стартовый запас.
    clearHold(this.charge);
    setCap(this.charge, this.build.chargeCap);
    this.charge.amount = TUNING.charge.start;
    this.supply = supplyAt(this.mode, this.level);
    this.pickups.items.length = 0;
    this.pickups.spawnTimerMs = 0;
    this.pendingKills.length = 0;
    this.stats = createRunStats();
    this.intro = createIntro();
    this.summary = [];
    this.bestLabel = undefined;
    this.copyLabel = undefined;
    this.report = '';
    // История и «уже видел подсказки» живут в браузере: читаем их раз на забег.
    this.history = parseHistory(loadText(HISTORY_KEY));
    if (loadText(INTRO_KEY) === 'done') muteIntro(this.intro);

    // Фон создаём первым (он глубже всего), но рисуем его в relayout():
    // сетка зависит от размера поля, а тот меняется при повороте экрана.
    this.grid = this.add.graphics().setDepth(-1);

    this.player = this.add
      .circle(this.pos.x, this.pos.y, TUNING.player.radius, PLAYER_ALIVE_COLOR)
      .setDepth(10);

    this.controls = new InputHub(this);
    this.shots = new Projectiles(this);
    this.allyContext.shots = this.shots;
    this.picker = new CardPicker(this);
    this.juice = new Juice(this);
    this.sfx = new Sfx({
      audio: () => this.audioContext(),
      now: () => performance.now(),
    });
    // Круги предметов создаются сразу и дальше только переезжают: в игровом шаге
    // аллокаций быть не должно. Пул общий на батареи и осколки — это одна
    // механика, а вид (размер и цвет) ставится при отрисовке по виду предмета.
    this.pickupArcs = [];
    for (let i = 0; i < TUNING.pickups.poolSize; i++) {
      this.pickupArcs.push(
        this.add
          .circle(0, 0, TUNING.pickups.batteryRadius, BATTERY_COLOR)
          .setStrokeStyle(1, BATTERY_STROKE)
          .setDepth(7)
          .setVisible(false),
      );
    }

    const kb = this.input.keyboard;
    if (!kb) throw new Error('Keyboard plugin недоступен');
    this.restartKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.restartKey.off('down');
    this.restartKey.on('down', () => {
      this.restartRequested = true;
    });

    // Звук браузер отдаёт только после жеста: первое касание или клавиша его будят.
    // Слушатели одноразовые — дальше контекст уже разбужен и просто работает.
    const unlock = (): void => this.sfx.unlock();
    this.input.once('pointerdown', unlock);
    kb.once('keydown', unlock);

    // Клавиша тишины: звук не должен быть навязан, а тихая игра обязана остаться игрой.
    const muteKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.M);
    muteKey.off('down');
    muteKey.on('down', () => {
      this.sfx.setMuted(!this.sfx.isMuted);
      this.showToast(this.sfx.isMuted ? 'ЗВУК ВЫКЛЮЧЕН' : 'ЗВУК ВКЛЮЧЁН', '#8b86a8');
    });
    // Режим меняется ТОЛЬКО на экране смерти: живой игрок не должен менять
    // правила прогона на ходу, иначе его результат нельзя ставить в таблицу.
    const modeKeys: ReadonlyArray<readonly [number, RunMode]> = [
      [Phaser.Input.Keyboard.KeyCodes.ONE, 'normal'],
      [Phaser.Input.Keyboard.KeyCodes.TWO, 'hardcore'],
    ];
    for (const [code, mode] of modeKeys) {
      const key = kb.addKey(code);
      key.off('down');
      key.on('down', () => {
        if (!this.dead) return;
        this.mode = mode;
        this.restartRequested = true;
      });
    }
    // На телефоне клавиши R нет, и после смерти единственным выходом оставалась
    // перезагрузка страницы. Касание экрана перезапускает забег.
    this.input.on('pointerdown', this.onDeathTap);

    // Стартовая группа: поле не должно пустовать ни секунды, иначе первые
    // секунды забега снова становятся паузой. Углы разведены по кругу.
    const initial = enemyTargetCount(this.level, this.mode, 0);
    for (let i = 0; i < initial; i++) this.spawnEnemy((i / initial) * Math.PI * 2);

    // Стартовый набор: ствола у игрока нет, урон наносят только фигуры, поэтому
    // без старой стаи забег не может начаться вовсе. Пара батарей рядом даёт
    // первые секунды на подбор, а не на выживание без ответа.
    const startMotes = TUNING.progression.startSwarms * TUNING.progression.motesPerSwarm;
    for (let i = 0; i < startMotes; i++) {
      // Стартовая стая тоже держит залог: правило залога — общее для всех фигур,
      // иначе первые секунды игрались бы по другим правилам, чем остальной забег.
      hold(this.charge, holdCost('mote'));
      this.addAlly('mote', this.pos);
    }
    for (let i = 0; i < 2; i++) this.spawnBattery();

    this.profile.seed = this.seed;
    this.profile.mode = this.mode;
    this.profile.control = this.controls.control;
    this.profile.changedDuringRun = false;
    this.writeRecord();

    this.hud = this.add.text(0, 0, '', { fontFamily: 'monospace' }).setDepth(20);
    this.hint = this.add
      .text(0, 0, 'WASD — движение   SPACE — дэш   R — сид', {
        fontFamily: 'monospace',
      })
      .setDepth(20);
    this.pickLine = this.add.text(0, 0, '', { fontFamily: 'monospace' }).setDepth(20);
    this.status = this.add.text(0, 0, '', { fontFamily: 'monospace' }).setDepth(20);

    this.hud.setColor('#a9a3c9');
    this.hint.setColor('#6f6991');
    this.pickLine.setColor('#8ef0b0');
    this.status.setColor('#6f6991');

    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize);
      this.input.off('pointerdown', this.onDeathTap);
      // Эффекты живут на объектах сцены: без этого перезапуск оставлял бы их висеть.
      this.juice.destroy();
    });

    this.relayout();

    // Забег начинается с выбора таланта: первое решение игрок принимает ДО
    // первого врага, а не через полминуты боя. Мир при этом стоит — ровно так
    // же, как на любом другом уровне (см. update).
    this.pendingLevels = 1;
    this.openOffer();
  }

  /**
   * Описание батареи на текущем уровне: снабжение плюс карты «Плотная батарея».
   * Ценность считается здесь, а не хранится в билде: база растёт с уровнем, и
   * два независимых источника одного числа рано или поздно разошлись бы.
   */
  private batterySpec(): PickupSpec {
    return {
      kind: 'battery',
      value: this.supply.batteryValue + this.build.batteryBonus,
      ttlMs: TUNING.pickups.batteryTtlMs,
      radius: TUNING.pickups.batteryRadius,
    };
  }

  /**
   * Осколок с убитого: урон тоже кормит выводок. Падает там, где убили, и живёт
   * секунды — взять его значит сходить туда, где сейчас стоят враги.
   */
  private dropSpec(): PickupSpec {
    return {
      kind: 'drop',
      value: this.supply.dropValue,
      ttlMs: this.supply.dropTtlMs,
      radius: TUNING.pickups.dropRadius,
    };
  }

  /** Кладёт батарею вдали от игрока: добыча Тока — это движение. */
  private spawnBattery(): void {
    addPickup(
      this.pickups,
      spawnPoint(
        this.rng,
        VIEW.w,
        VIEW.h,
        TUNING.pickups.edgeMargin,
        this.pos,
        TUNING.pickups.minDistFactor * VIEW.minSide,
      ),
      this.batterySpec(),
    );
  }

  /** Сколько батарей помещается на поле: снабжение уровня плюс карты «Сборка». */
  private batteryLimit(): number {
    return this.supply.onField + this.build.extraBatterySlots;
  }

  /** Раскладка всего экранного под текущее поле. Вызывается и при повороте телефона. */
  private relayout(): void {
    this.drawGrid();

    const font = this.fontLogical(TUNING.hud.fontLogical);
    const small = this.fontLogical(TUNING.hud.smallFontLogical);

    this.hud.setFontSize(font);
    this.hint.setFontSize(small);
    this.pickLine.setFontSize(small);
    this.status.setFontSize(small);
    // На сенсорном устройстве подсказка про WASD только мешает.
    this.hint.setVisible(!isTouchDevice());

    this.controls.applyViewport();

    // Экран смерти мог быть создан до поворота — держим его по центру нового поля.
    if (this.deathText) this.layoutDeathScreen();
    this.toast?.setPosition(VIEW.w / 2, VIEW.h * 0.76);

    clampToBounds(this.pos, TUNING.player.radius, VIEW.w, VIEW.h);
    for (const e of this.enemies) clampToBounds(e.pos, e.radius, VIEW.w, VIEW.h);
    for (const item of this.pickups.items) clampToBounds(item, item.radius, VIEW.w, VIEW.h);

    // Ширина поля изменилась — решение о переносе HUD надо принять заново.
    this.hudSignature = '';
    this.picker.relayout();
    this.updateHud();
  }

  /**
   * Кегль уменьшается на узком поле: строка HUD обязана влезать в телефонный
   * экран, а не уезжать за край. На широком поле он остаётся эталонным.
   */
  private fontLogical(base: number): number {
    const hud = TUNING.hud;
    const scaled = (base * VIEW.w) / hud.referenceWidth;
    return Math.round(Math.max(hud.minFontLogical, Math.min(base, scaled)));
  }

  private readonly onResize = (): void => {
    this.relayout();
  };

  /**
   * Тап по экрану смерти перезапускает забег. Строку режима здесь пропускаем:
   * её обрабатывает сама строка, и от порядка событий выбор бы зависел.
   */
  private readonly onDeathTap = (pointer: Phaser.Input.Pointer): void => {
    if (!this.dead) return;
    for (const label of this.modeLabels) {
      if (Phaser.Geom.Rectangle.Contains(label.getBounds(), pointer.x, pointer.y)) return;
    }
    // Кнопка отчёта — единственное на экране смерти, что не перезапускает забег.
    if (
      this.copyLabel &&
      Phaser.Geom.Rectangle.Contains(this.copyLabel.getBounds(), pointer.x, pointer.y)
    ) {
      return;
    }
    this.restartRequested = true;
  };

  update(_time: number, delta: number): void {
    // Вертикальный экран: игра ландшафтная, мир стоит под заглушкой «поверни
    // телефон». Просто не шагаем — ни дие, ни респауна за заглушкой быть не может.
    if (VIEW.needsRotate) return;

    // Открыт выбор таланта: мир не шагает, пока решение не принято.
    if (this.choosing) return;

    if (this.dead) {
      if (this.restartRequested) {
        this.restartRequested = false;
        this.scene.restart({ seed: randomSeed(), mode: this.mode });
      }
      return;
    }

    // Нажатие R в бою не должно «запомниться» и выстрелить перезапуском ровно в
    // момент смерти: флаг живёт только на экране смерти.
    this.restartRequested = false;

    this.controls.update();

    const steps = this.sim.advance(delta);
    for (let i = 0; i < steps; i++) this.step(this.sim.stepSeconds);

    this.render();

    // Уровень поднимается между кадрами, а не посреди симуляции: иначе выбор
    // таланта открывался бы из середины шага, с недоигранным уроном.
    if (this.pendingLevels > 0) this.openOffer();
  }

  /** Один шаг симуляции фиксированной длины. Здесь живёт вся игровая логика. */
  private step(dt: number): void {
    // Мёртвый мир не шагает. Это не украшение: без проверки любой шаг после
    // смерти заново начислял бы смерти и отчёты — история забивалась мусором.
    if (this.dead) return;
    const ms = dt * 1000;

    // Эффекты старятся до событий этого шага: тогда созданное сейчас кольцо
    // успевает пожить полный срок, а не теряет один шаг сразу.
    this.juice.step(dt);

    this.dashCdT = Math.max(0, this.dashCdT - ms);
    this.iFramesT = Math.max(0, this.iFramesT - ms);
    this.dashBufferT = Math.max(0, this.dashBufferT - ms);

    const wasDashing = this.dashT > 0;
    if (wasDashing) this.dashT = Math.max(0, this.dashT - ms);
    if (wasDashing && this.dashT === 0) {
      this.dashCdT = TUNING.player.dashCooldownMs;
      // Гасим большую часть импульса: иначе «дэш» продолжается скольжением ещё
      // на треть дистанции, и сокращение самого рывка ничего не даёт (замер).
      this.vel.x *= TUNING.player.dashExitKeep;
      this.vel.y *= TUNING.player.dashExitKeep;
    }

    if (this.controls.takeDash()) this.dashBufferT = TUNING.player.dashBufferMs;

    const mv = this.controls.state.move;
    const inputLen = Math.hypot(mv.x, mv.y);
    this.syncProfile(inputLen > 0.001 || this.dashBufferT > 0);

    // Аналоговый ввод: у стика длина меньше единицы, у клавиатуры ровно единица.
    let ix = 0;
    let iy = 0;
    if (inputLen > 0.001) {
      const scale = inputLen > 1 ? 1 / inputLen : 1;
      ix = mv.x * scale;
      iy = mv.y * scale;
      this.facing = { x: mv.x / inputLen, y: mv.y / inputLen };
    }

    // Дэш с буфером ввода: нажатие «запоминается» на пару кадров.
    if (this.dashBufferT > 0 && this.dashT === 0 && this.dashCdT === 0) {
      this.dashBufferT = 0;
      this.dashT = TUNING.player.dashMs;
      this.iFramesT = TUNING.player.iFramesMs;
      // Свист уходит вместе с рывком: дэш — решение, и он должен быть слышен.
      this.sfx.play('dash');
    }

    if (this.dashT > 0) {
      this.vel.x = this.facing.x * TUNING.player.dashSpeed;
      this.vel.y = this.facing.y * TUNING.player.dashSpeed;
    } else {
      const rate = (inputLen > 0.001 ? TUNING.player.accel : TUNING.player.friction) * dt;
      this.vel.x = approach(this.vel.x, ix * TUNING.player.speed, rate);
      this.vel.y = approach(this.vel.y, iy * TUNING.player.speed, rate);
    }

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    clampToBounds(this.pos, TUNING.player.radius, VIEW.w, VIEW.h);

    this.assignSlots(dt);

    // Предметы: распад, появление, подбор. Ток приходит двумя путями — батареи
    // за движение и осколки за урон, — и оба обязаны быть видны в отчёте.
    stepAge(this.pickups, dt);
    // «Разгон батарей» ускоряет ПОЯВЛЕНИЕ, а не расширяет поле: место на поле не
    // даёт ничего, потому что доход задаёт темп (замер стенда).
    const batteryInterval = this.supply.spawnIntervalMs * this.build.supplyIntervalMult;
    if (takeSpawn(this.pickups, dt, batteryInterval, this.batteryLimit())) {
      this.spawnBattery();
    }
    collect(this.pickups, this.pos, TUNING.pickups.pickupRadius, this.tally);
    const gained = this.tally.batteryTok + this.tally.dropTok;
    if (gained > 0) {
      add(this.charge, gained);
      // Подбор виден, слышен и назван числом: это единственный источник Тока,
      // и без отклика игрок узнаёт о нём только по шкале в углу.
      this.juice.burst(
        this.pos.x,
        this.pos.y,
        this.tally.batteries > 0 ? BATTERY_COLOR : DROP_COLOR,
        'pickup',
      );
      this.juice.popup(this.pos.x, this.pos.y - TUNING.player.radius, `+${Math.round(gained)}`, '#ffe066');
      this.sfx.play('pickup');
      if (this.tally.batteries > 0) {
        noteBattery(this.stats, this.tally.batteries, this.tally.batteryTok);
      }
      if (this.tally.drops > 0) noteDrop(this.stats, this.tally.drops, this.tally.dropTok);
    }

    this.allyContext.playerPos = this.pos;
    // Позиция цели для враждебных выстрелов — тот же объект, что и у игрока:
    // обновляем ссылку, потому что create() создаёт позицию заново.
    if (this.allyContext.player) this.allyContext.player.pos = this.pos;
    this.allyContext.enemies = this.enemies;
    // Крылья держатся по бокам от направления взгляда и работают только пока
    // игрок играет: движение и дэш — это и есть участие, стояние — нет.
    this.idleMs = inputLen > 0.001 || this.dashT > 0 ? 0 : this.idleMs + ms;
    this.allyContext.playerFacing = this.facing;
    const wasActive = this.allyContext.playerActive;
    const active = this.idleMs < TUNING.ally.idleGraceMs;
    this.allyContext.playerActive = active;
    if (wasActive && !active && this.wingSlots > 0 && !this.wingsToldAbout) {
      this.wingsToldAbout = true;
      this.showToast('КРЫЛЬЯ ЖДУТ ДЕЙСТВИЯ', '#8b86a8');
    }

    // НАПРЯЖЕНИЕ: пока Ток держится выше порога, фигуры работают быстрее. Это и
    // есть роль ветки энергии — она влияет на бой, а не на бюджет постановок.
    this.boosted = chargeNorm(this.charge) >= TUNING.charge.boostFromNorm;
    const boost = this.boosted ? TUNING.charge.boostRateMult : 1;
    this.allyContext.turretRateMult = this.build.turretRateMult * boost;
    this.allyContext.spiritRateMult = this.build.spiritRateMult * boost;
    // Карты энергии: пробивание у союзников. Цена постановки в контекст не идёт:
    // платит сцена в момент вызова, поэтому и множитель цены живёт там же.
    this.allyContext.turretPierce = this.build.turretPierce;
    this.allyContext.spiritPierce = this.build.spiritPierce;
    this.allyContext.moteFastRechase = this.build.moteFastRechase;
    for (const ally of this.allies) ally.step(dt, this.allyContext);

    this.shots.step(dt, this.allyContext);
    stepCharge(this.charge, dt, TUNING.charge.decayPerSec, this.build.decayReserve);
    // Телеметрия читает пул ПОСЛЕ всех трат шага: иначе минимум был бы завышен.
    // Вместо простоя фигур считаем залог: он и есть цена живого выводка.
    stepStats(this.stats, dt, this.charge.amount, this.charge.held);

    // Подсказки первого забега: по одной, и только когда экран свободен.
    if (this.toast === undefined) {
      const hint = nextHint(this.intro, {
        batteries: this.stats.batteries,
        spent: this.stats.chargeSpent,
        refusals: this.stats.dryRefusals,
        idleMs: this.idleMs,
      });
      if (hint) this.showToast(hint, '#ffe066');
    }

    if (this.pendingKills.length > 0) this.resolveKills();

    // Режиссёр спавна: держим целевое число живых врагов. Раньше новый враг
    // приходил только после смерти предыдущего — поле пустовало, и стоящий
    // игрок ничего не терял. Теперь наоборот: убыль сразу восполняется.
    // Кривая давления идёт по ВРЕМЕНИ забега: первая минута — разгон, дальше
    // ступени. Числа живут строкой режима, здесь только выбор ступени.
    const elapsedMs = this.stats.timeMs;
    const spawnTarget = enemyTargetCount(this.level, this.mode, elapsedMs);
    this.spawnTimerMs -= ms;
    if (this.enemies.length < spawnTarget && this.spawnTimerMs <= 0) {
      this.spawnEnemy();
      this.spawnTimerMs = enemySpawnIntervalAt(this.mode, elapsedMs);
    }

    // Контакт — удар по пулу, а не конец забега. Окно неуязвимости после удара
    // шире окна рывка: тело врага остаётся рядом ещё несколько шагов, и без окна
    // один проход выпада снимал бы все три удара сразу.
    for (const e of this.enemies) {
      if (distance(this.pos, e.pos) <= TUNING.player.radius + e.radius && this.iFramesT === 0) {
        this.takeHit();
        break;
      }
    }
  }

  /**
   * Раздача слотов кольца. Слот не привязан к индексу в массиве: смерть врага
   * сдвигала индексы, кольцо прыгало, и строй не успевал сложиться. Слоты идут
   * ровно по кругу в порядке ТЕКУЩИХ углов — только так группа действительно
   * окружает игрока, а не собирается в один сектор (замер до правки: бег по
   * кругу 60 секунд без единого дэша, враги в дуге 30°).
   */
  private assignSlots(dt: number): void {
    const alive = this.enemies.length;
    if (alive === 0) return;
    // Кольцо медленно вращается, поэтому враги всё время двигаются и обходят
    // игрока, даже если он встал. Стоять — значит стоять в карусели.
    this.orbitT += TUNING.enemy.orbitSpeedRadPerSec * dt;

    const order = this.slotOrder;
    order.length = 0;
    // Слоты делим только между теми, кто стоит на КОЛЬЦЕ: стрелок и танк кольца не
    // держат (usesRing), и если дать им слоты, окружение станет жиже — их места
    // никому не достанутся.
    let ring = 0;
    for (const e of this.enemies) {
      order.push(e);
      if (e.usesRing) ring++;
    }
    const px = this.pos.x;
    const py = this.pos.y;
    order.sort(
      (a, b) =>
        Math.atan2(a.pos.y - py, a.pos.x - px) - Math.atan2(b.pos.y - py, b.pos.x - px),
    );

    const stepAngle = ring > 0 ? (Math.PI * 2) / ring : Math.PI * 2;
    this.assignInterceptors(dt, ring);
    let rank = 0;
    for (const e of order) {
      const slotAngle = e.usesRing ? this.orbitT + rank++ * stepAngle : this.orbitT;
      e.step(dt, this.pos, slotAngle, this.vel, this.shots);
    }
  }

  /**
   * Ведёт перехватчиков: врагов, которые уходят с кольца и встают ТЕЛОМ на
   * маршрут игрока. Кольцо едет вместе с игроком, поэтому само по себе кайтинг
   * не наказывает: замер до правки — хардкор, круг r=156, без дэшей — 60 секунд
   * выживания при 51 атаке в минуту и ни одном контакте. Поэтому перехватчик не
   * гонится за игроком, а выигрывает гонку к точке впереди и стоит на ней.
   *
   * Число перехватчиков растёт вместе с числом живых: двое-трое — один, плотная
   * группа — два. Стоящему игроку перехват не нужен: его и так достаёт кольцо,
   * и замеры стоянки не должны измениться.
   */
  private assignInterceptors(dt: number, alive: number): void {
    const speed = Math.hypot(this.vel.x, this.vel.y);
    // Ускорение нужно для точки прогноза: без него цель уходит по касательной
    // в стену, а с ним ложится на дугу виража (второй член формулы).
    const ax = (this.vel.x - this.prevVel.x) / dt;
    const ay = (this.vel.y - this.prevVel.y) / dt;
    this.prevVel.x = this.vel.x;
    this.prevVel.y = this.vel.y;

    const want =
      speed > TUNING.enemy.interceptMinSpeed
        ? Math.min(TUNING.enemy.interceptMax, Math.floor((alive + 1) / 3))
        : 0;

    const ringR = TUNING.enemyPressure[this.mode].windupRangeFactor * VIEW.minSide;
    const pairGapSec = TUNING.enemy.interceptPairGapMs / 1000;

    // 1) Караулы держат точку, пока игрок её не прошёл. Точка не «дрейфует»
    // вместе с игроком — она стоит на маршруте: движущуюся точку враг не
    // догонит, и перехват выродился бы в вечную погоню (замер v2: дэш-бот
    // проходил мимо, ближайшая дистанция 29–37 и ноль секунд караула в пути).
    let held = 0;
    for (const e of this.enemies) {
      if (!e.interceptActive) continue;
      const passed =
        (this.pos.x - e.interceptTarget.x) * this.vel.x +
          (this.pos.y - e.interceptTarget.y) * this.vel.y >
        0;
      const stale = e.interceptAgeMs > TUNING.enemy.interceptTimeoutMs;
      if (!passed && !stale && e.enemyState === 'seek') {
        held++;
        continue;
      }
      // Прошёл точку, караул застоялся или враг ушёл в рывок: ищем следующую
      // точку, куда успеваем. Не успеваем — роль снимается, враг возвращается
      // на кольцо: гонка за недостижимой точкой хуже, чем строй.
      e.interceptActive =
        e.enemyState === 'seek' &&
        this.pickInterceptPoint(e, speed, ax, ay, held === 0 ? 0 : pairGapSec);
      if (e.interceptActive) held++;
    }

    // 2) Добираем новых: ближайший к игроку — он и до точки дойдёт скорее всех.
    while (held < want) {
      let pick: Enemy | null = null;
      let pickDist = Infinity;
      for (const e of this.enemies) {
        // Перехват — роль ПОГОНИ: танк и стрелок её не берут (canIntercept).
        if (!e.kind.canIntercept) continue;
        if (e.interceptActive || e.enemyState !== 'seek') continue;
        const d = Math.hypot(e.pos.x - this.pos.x, e.pos.y - this.pos.y);
        if (d <= ringR) continue; // внутри кольца враг занят рывком
        if (d < pickDist) {
          pickDist = d;
          pick = e;
        }
      }
      if (!pick) break;
      if (!this.pickInterceptPoint(pick, speed, ax, ay, held === 0 ? 0 : pairGapSec)) break;
      // Флаг роли ставится здесь же: точка без роли — это враг на кольце со
      // стёртой целью (именно так механизм и простаивал — замер: icSec 0).
      pick.interceptActive = true;
      held++;
    }
  }

  /**
   * Ищет точку на маршруте, до которой перехватчик успевает дойти РАНЬШЕ игрока,
   * и замораживает её. Маршрут считаем дугой окружности: бег по кругу — это
   * постоянная угловая скорость, и дуга предсказывает положение точно, тогда как
   * прямая по касательной уходит от маршрута (сдвиг растёт как v·T²/2r: на вираже
   * r=86 уже к 0.7 с это 26 единиц).
   *
   * Гонку решаем перебором сроков: от раннего (тело вплотную) до позднего
   * (предел прогноза). Победа обязана быть с запасом: прийти вместе с игроком
   * значит прийти поздно — тело должно уже стоять, когда он подходит. Нет
   * выигрышного срока — враг остаётся на кольце: гнаться за недостижимой точкой
   * хуже, чем держать строй.
   */
  private pickInterceptPoint(
    e: Enemy,
    speed: number,
    ax: number,
    ay: number,
    minLeadSec: number,
  ): boolean {
    // Гонка считается по темпу ПЕРЕХВАТЧИКА (спринт), а не по обычному темпу
    // подхода: иначе механизм никогда не включается (замер: отрыв 163 и
    // ни одной выигранной гонки за 30 секунд кайтинга).
    const seek =
      TUNING.enemyPressure[this.mode].seekSpeed * TUNING.enemy.interceptSprintMult;
    // Угловая скорость разворота игрока: её знак задаёт сторону поворота, модуль
    // — радиус дуги (speed / |turn|). Ускорение берём полное: поперечная часть и
    // есть поворот, продольная на дугу почти не влияет.
    let turn = (this.vel.x * ay - this.vel.y * ax) / (speed * speed);
    if (turn > 3) turn = 3;
    if (turn < -3) turn = -3;
    const arc = Math.abs(turn) > 0.05;
    const sgn = turn > 0 ? 1 : -1;
    const k = arc ? 1 / Math.abs(turn) : 0;
    // Центр дуги — слева по движению при повороте против часовой.
    const cX = this.pos.x + -this.vel.y * sgn * k;
    const cY = this.pos.y + this.vel.x * sgn * k;
    const rX = this.pos.x - cX;
    const rY = this.pos.y - cY;

    const minLead = Math.max(TUNING.enemy.interceptMinLeadMs / 1000, minLeadSec);
    const maxLead = TUNING.enemy.interceptMaxLeadMs / 1000;
    const margin = TUNING.enemy.interceptRaceMarginMs / 1000;
    const step = (maxLead - minLead) / 5;
    if (step <= 0) return false;

    for (let t = minLead; t <= maxLead + 0.001; t += step) {
      let qX: number;
      let qY: number;
      if (arc) {
        const ang = turn * t;
        const cos = Math.cos(ang);
        const sin = Math.sin(ang);
        qX = cX + rX * cos - rY * sin;
        qY = cY + rX * sin + rY * cos;
      } else {
        qX = this.pos.x + this.vel.x * t;
        qY = this.pos.y + this.vel.y * t;
      }
      const travel = Math.hypot(e.pos.x - qX, e.pos.y - qY) / seek;
      if (travel + margin > t) continue; // не успевает — срок подальше
      // Точка обязана лежать в границах поля: караул не должен упираться в стену.
      const edge = TUNING.enemy.radius;
      e.interceptTarget.x = Math.min(Math.max(qX, edge), VIEW.w - edge);
      e.interceptTarget.y = Math.min(Math.max(qY, edge), VIEW.h - edge);
      e.interceptAgeMs = 0;
      return true;
    }
    return false;
  }

  /**
   * Профиль забега: кто играет — на клавиатуре или пальцем по экрану.
   * Один профиль на весь забег — иначе результат нельзя ставить в таблицу.
   *
   * До первого осмысленного действия профиль уточняется свободно: на телефоне
   * касания ещё не было, и первое касание — это НАЧАЛО забега, а не смена
   * профиля по ходу. После начала расхождение помечает прогон недействительным.
   */
  private syncProfile(started: boolean): void {
    const control = this.controls.control;

    if (control !== this.profile.control) {
      this.profile.control = control;
      if (this.profileLocked) this.profile.changedDuringRun = true;
      this.writeRecord();
    }

    // Фиксируем ПОСЛЕ уточнения: на 120 Гц касание и рывок стика вполне могут
    // попасть в один шаг, и тогда порядок решает — иначе забег стал бы
    // недействительным сам собой, без единого признака смены профиля.
    if (started) this.profileLocked = true;
  }

  /**
   * Единственный путь смерти врага. Турель, дух, дрон и мот бьют через этот
   * метод — поэтому опыт нельзя случайно не начислить.
   */
  private damage(enemy: Enemy, amount: number): void {
    if (enemy.hp <= 0) return;
    if (enemy.hit(amount)) {
      this.pendingKills.push(enemy);
      return;
    }
    // Удар по живому виден и слышен. Смертельный удар сюда не доходит: у смерти
    // свой, более крупный отклик — иначе одно событие звучало бы дважды.
    this.juice.burst(enemy.pos.x, enemy.pos.y, HIT_RING_COLOR, 'hit');
    this.sfx.play('hit');
  }

  /** Убирает погибших за шаг: со сцены, из списка, в счётчик и в опыт. */
  private resolveKills(): void {
    for (const e of this.pendingKills) {
      // Осколок падает ТАМ, ГДЕ УБИЛИ: фигуры бьют с дистанции, поэтому взять
      // его — значит сходить к врагам. Риск подбора и есть цена награды, а окно
      // в пару секунд не даёт отложить это на потом.
      addPickup(this.pickups, e.pos, this.dropSpec());
      this.juice.burst(e.pos.x, e.pos.y, KILL_RING_COLOR, 'kill');
      this.sfx.play('kill');
      e.destroy();
      const index = this.enemies.indexOf(e);
      if (index >= 0) this.enemies.splice(index, 1);
      this.killed++;
      noteKill(this.stats);
      this.gainXp(TUNING.progression.xpPerKill);
      this.splitEnemy(e);
      this.blastVolatile(e);
    }
    // Тряска одна на пачку убийств: удар по нескольким врагам в один шаг —
    // это одно событие для глаза, а не три подряд.
    if (this.pendingKills.length > 0) this.juice.shake('kill');
    this.pendingKills.length = 0;
  }

  /**
   * Делитель расщепляется на двух мелких: убить его надо ДО подхода, иначе одна
   * цель становится двумя. Дети — погонялы, поэтому второй генерации не бывает:
   * поле не должно зарастать из одного врага.
   */
  private splitEnemy(e: Enemy): void {
    if (e.kind.behavior !== 'split-on-death') return;
    const children = TUNING.enemy.splitChildren;
    for (let i = 0; i < children; i++) {
      const angle = (i / children) * Math.PI * 2;
      this.enemies.push(
        new Enemy(
          this,
          {
            x: e.pos.x + Math.cos(angle) * TUNING.enemy.radius * 2,
            y: e.pos.y + Math.sin(angle) * TUNING.enemy.radius * 2,
          },
          {
            level: this.level,
            mode: this.mode,
            jitter: this.rng(),
            kindId: 'charger',
            elite: null,
            eliteHpBonus: 0,
            eliteSpeedMult: 1,
          },
        ),
      );
    }
  }

  /** «Нестабильная» элита взрывается на смерти: добивать её вплотную дорого. */
  private blastVolatile(e: Enemy): void {
    if (e.elite !== 'volatile') return;
    this.juice.burst(e.pos.x, e.pos.y, HIT_RING_COLOR, 'hit');
    if (distance(this.pos, e.pos) <= TUNING.enemy.volatileBlastRadius) this.hitByShot();
  }

  /** Попадание враждебного выстрела: тот же пул ошибок, что и контакт. */
  private hitByShot(): void {
    if (this.iFramesT > 0) return;
    this.takeHit();
  }

  private gainXp(amount: number): void {
    this.xp += amount;
    let need = xpForNextLevel(this.level);
    while (this.xp >= need) {
      this.xp -= need;
      this.level++;
      this.pendingLevels++;
      // Доход растёт вместе с уровнем: расход поднимается и от новых фигур, и
      // от жирных врагов, поэтому старые числа снабжения стали бы голодом.
      this.supply = supplyAt(this.mode, this.level);
      this.sfx.play('level');
      need = xpForNextLevel(this.level);
    }
    this.maybeRetireIntro();
  }

  /**
   * Игрок освоил петлю: либо подсказки все показаны, либо он дошёл до третьего
   * уровня. Иначе они всплывали бы в каждом забеге и мешали играть.
   */
  private maybeRetireIntro(): void {
    if (this.level >= TUNING.progression.introRetireLevel || introMuted(this.intro)) {
      saveText(INTRO_KEY, 'done');
    }
  }

  /**
   * Предложение уровня: до профессии — по карте от каждой ветки, после — карта
   * профессии плюс крос-карты вложенных веток (правила живут в progression).
   * Когда выбирать уже нечего, мир спокойно едет дальше без остановки.
   */
  private openOffer(): void {
    this.pendingLevels--;
    const cards = offerCards(this.build, this.rng);
    if (cards.length === 0) {
      this.pendingLevels = 0;
      return;
    }

    // Профессию называем в заголовке только тогда, когда в предложении и правда
    // есть крос: обещать выбор, которого нет, — худшее, что может сделать
    // подпись над кнопками.
    const specialty = this.build.specialty;
    const hasCross = cards.some((card) => card.crossPair !== undefined);
    const title =
      specialty !== null && hasCross
        ? `Уровень ${this.level} — ${branchTitle(specialty)}: талант или крос`
        : `Уровень ${this.level} — выбери талант`;

    this.choosing = true;
    this.controls.setEnabled(false);
    // Мир встаёт вместе с врагами: их замах и рывок замирают на полуслове, и без
    // отбоя удар приходил бы в первый же кадр после подбора карты — то есть
    // ровно тогда, когда игрок ещё читает панель, а не поле.
    for (const enemy of this.enemies) enemy.standDown(TUNING.enemy.standDownMs);
    this.picker.show(cards, title, (card) => this.pick(card));
  }

  private pick(card: Card): void {
    const specialtyBefore = this.build.specialty;
    if (applyCard(this.build, card)) {
      this.lastPickTitle = card.title;
      // Ёмкость могла вырасти — пул обязан узнать новый потолок сразу, а не к
      // следующему начислению.
      setCap(this.charge, this.build.chargeCap);
      this.spawnForCard(card);
      if (this.build.specialty !== null && this.build.specialty !== specialtyBefore) {
        this.announceSpecialty(this.build.specialty);
      }
    } else {
      // Карта исчерпана — уровень не тратим впустую, а предложим заново.
      this.pendingLevels++;
    }
    this.picker.hide();
    this.choosing = false;
    this.controls.setEnabled(true);
    // Передышка на выходе из паузы: решение только что принято, а мир шагает
    // сразу. Окно шире кд дэша, поэтому рывок в нём гарантированно доступен —
    // это время на то, чтобы увидеть поле и уйти, а не на то, чтобы постоять.
    this.iFramesT = Math.max(this.iFramesT, TUNING.player.resumeGraceMs);
    this.writeRecord();
    this.updateHud();

    // Два уровня одним шагом разбираются по очереди, а не пропадают.
    if (this.pendingLevels > 0) this.openOffer();
  }

  /**
   * Что карта ставит на поле. Числа уже применены к билду — здесь только
   * материализация: турель встаёт там, где стоял игрок, спутники уходят на
   * свободные слоты орбиты. Цикл сверяет количество с пределом, поэтому
   * повторно взятая карта добирает недостающее, а не плодит лишнее.
   */
  private spawnForCard(card: Card): void {
    const e = card.effects;
    if (e.maxTurrets) this.deployUpTo('turret', this.build.maxTurrets);
    if (e.maxDroneMines) this.deployUpTo('drone', this.build.maxDroneMines);
    if (e.maxSpirits) this.deployUpTo('spirit', this.build.maxSpirits);
    if (e.maxSwarms) {
      this.deployUpTo('mote', this.build.maxSwarms * TUNING.progression.motesPerSwarm);
    }
  }

  /**
   * Постановка фигур до предела билда: Ток платится ЗА ВЫЗОВ, один раз. Не хватило
   * — фигура не встаёт вовсе (половину цены не списываем), а игрок узнаёт причину
   * тостом. Потолок числа фигур задаёт билд, а не цена выстрела: именно так
   * ограничены суммонеры в Deadlock, Diablo и PoE 2.
   */
  private deployUpTo(kind: AllyKind, limit: number): void {
    while (this.countAllies(kind) < limit) {
      const price = deployCost(kind) * this.build.costMult;
      const pledge = holdCost(kind);
      // Проверка ДО трат: цена плюс залог обязаны уместиться в свободный Ток.
      // Иначе неудачный залог оставил бы цену списанной, а фигуру — непоставленной.
      if (this.charge.amount < price || avail(this.charge) < price + pledge) {
        this.reportDeployDry();
        return;
      }
      hold(this.charge, pledge);
      spend(this.charge, price);
      noteSpend(this.stats, price);
      this.addAlly(kind, this.pos);
    }
  }

  /**
   * Номер слота зависит от роли спутника. Крыло (дух, мот) нумеруется общим
   * счётчиком: иначе дух и мот сядут в один и тот же слот и сольются в одну
   * точку, а турель, поставленная первой, съедала бы ближний фланг. Устройства
   * же нумеруются по видам: турель и дрон друг другу не мешают.
   */
  private addAlly(kind: AllyKind, at: Vec2): void {
    const slot = isWingKind(kind) ? this.wingSlots++ : this.countAllies(kind);
    this.allies.push(new Ally(this, kind, slot, at));
  }

  /**
   * Звуковой контекст. Создаётся при первом обращении: до жеста пользователя
   * браузер держит звук выключенным, и создавать заранее нечего. Ошибку
   * создания глушим: старому браузеру без WebAudio игра обязана остаться игрой.
   */
  private audioContext(): AudioContextLike | null {
    if (this.audio) return this.audio;
    try {
      this.audio = new AudioContext();
    } catch {
      this.audio = null;
    }
    return this.audio;
  }

  private countAllies(kind: AllyKind): number {
    let n = 0;
    for (const a of this.allies) if (a.kind === kind) n++;
    return n;
  }

  /**
   * Закрепление профессии — главное событие прогрессии забега: игрок обязан
   * увидеть момент, когда его стиль стал классом, а не заметить потом в HUD.
   */
  private announceSpecialty(branch: BranchId): void {
    this.showToast(`ПРОФЕССИЯ: ${branchTitle(branch)}`, '#ffb703');
  }

  /** Не хватило Тока на постановку фигуры: правило показывается раз за забег. */
  private reportDeployDry(): void {
    noteRefusal(this.stats);
    if (this.dryTold) return;
    this.dryTold = true;
    this.showToast('НЕ ХВАТАЕТ ТОКА НА ФИГУРУ', '#8b86a8');
  }

  /** Разовое сообщение по центру: им живут закрепление профессии и гаснущее крыло. */
  private showToast(text: string, color: string): void {
    this.toast?.destroy();
    const toast = this.add
      .text(VIEW.w / 2, VIEW.h * 0.76, text, {
        fontFamily: 'monospace',
        fontSize: `${this.fontLogical(TUNING.hud.fontLogical)}px`,
        color,
      })
      .setOrigin(0.5)
      .setDepth(31);
    this.toast = toast;
    this.tweens.add({
      targets: toast,
      alpha: 0,
      delay: 1400,
      duration: 600,
      onComplete: () => {
        toast.destroy();
        if (this.toast === toast) this.toast = undefined;
      },
    });
  }

  /** Переписывает запись забега: профиль помощи плюс текущий билд. */
  private writeRecord(): void {
    this.runRecord = createRunRecord(
      this.profile,
      this.build.order,
      this.level,
      this.build.specialty,
    );
  }

  /** Шапка отчёта: то, чем забег опознаётся без доступа к записи прогона. */
  private statsHead(): StatsHead {
    return {
      seed: this.seed,
      modeTitle: MODE_TITLE[this.mode].toLowerCase(),
      controlTitle: this.profile.control === 'touch' ? 'палец' : 'клавиатура',
      level: this.level,
      specialtyTitle: this.build.specialty ? branchTitle(this.build.specialty) : null,
      picks: this.build.order,
    };
  }

  /** С чем этот забег меряется: лучший из прошлых, а не «ощущение». */
  private bestLine(): string {
    const best = bestOf(this.history);
    if (!best) return 'лучший: это первый забег';
    return `лучший: ${formatResultLine(best, MODE_TITLE[best.mode].toLowerCase())}`;
  }

  /** Отчёт в буфер. Если браузер не даёт — говорим об этом, а не молчим. */
  private copyReport(): void {
    void copyText(this.report).then((ok) => {
      this.showToast(
        ok ? 'ОТЧЁТ СКОПИРОВАН' : 'НЕ УДАЛОСЬ: ОТЧЁТ НА ЭКРАНЕ',
        ok ? '#8ef0b0' : '#ff9f1c',
      );
    });
  }

  /**
   * Результат в историю. Недействительные забеги (смена управления по ходу)
   * сохраняются как есть: их видно в списке, но лучшими они не становятся.
   */
  private saveResult(): void {
    const result: RunResult = {
      at: Date.now(),
      seed: this.seed,
      mode: this.mode,
      control: this.profile.control,
      timeMs: this.stats.timeMs,
      level: this.level,
      kills: this.stats.kills,
      specialty: this.build.specialty,
      picks: [...this.build.order],
      valid: !this.runRecord.changedDuringRun,
    };
    this.history = appendResult(this.history, result);
    saveText(HISTORY_KEY, serializeHistory(this.history));
  }

  private spawnEnemy(angle = this.rng() * Math.PI * 2): void {
    // Дистанция — доля меньшей стороны поля, иначе на узком телефонном поле
    // враг появлялся бы за краем экрана.
    const spawnDistance = TUNING.enemy.spawnFactor * VIEW.minSide;
    // Точку у стены граница зажимает — и она прилипает к игроку: замер — игрок
    // в 12 единицах от края, угол наружу, враг появился в 7 единицах от него
    // вместо 182. Так и рождался «спавн в упор». Поэтому угол подбирается из
    // четырёх проб, разведённых на четверть оборота, плюс направление к центру
    // арены: берём первую, где после зажима враг остаётся не ближе половины
    // дистанции спавна, иначе — самую далёкую из проб.
    const minDist = spawnDistance * 0.5;
    let at: Vec2 | null = null;
    let bestDist = -1;
    for (let i = 0; i < 5; i++) {
      let probeAngle: number;
      if (i < 4) {
        probeAngle = angle + (i * Math.PI) / 2;
      } else {
        // Пятая проба — к центру арены: выручает, когда игрок зажат в углу и все
        // четыре направления упираются в стены.
        probeAngle = Math.atan2(VIEW.h / 2 - this.pos.y, VIEW.w / 2 - this.pos.x);
      }
      const probe: Vec2 = {
        x: this.pos.x + Math.cos(probeAngle) * spawnDistance,
        y: this.pos.y + Math.sin(probeAngle) * spawnDistance,
      };
      clampToBounds(probe, TUNING.enemy.radius, VIEW.w, VIEW.h);
      const d = Math.hypot(probe.x - this.pos.x, probe.y - this.pos.y);
      if (d >= minDist) {
        at = probe;
        break;
      }
      if (d > bestDist) {
        bestDist = d;
        at = probe;
      }
    }
    if (!at) return;
    // Кто именно появится — решает режиссёр спавна: он держит кольцо, потолок
    // не-погонял и взвешенный выбор среди видов, которые уже открыты уровнем.
    // До этого вида он был написан и протестирован, но сцена его не звала вовсе
    // — в игре существовал ровно один враг при четырёх описанных.
    let nonChasers = 0;
    for (const e of this.enemies) if (!e.usesRing) nonChasers++;
    const pick = pickSpawn(
      this.level,
      eliteChanceAt(this.mode, this.stats.timeMs),
      this.enemies.length,
      nonChasers,
      this.rng,
    );
    const elite = eliteNumbers(pick.elite);
    // jitter — один бросок сида на двоих: он задаёт и слот на кольце, и разброс
    // первой паузы перед рывком.
    this.enemies.push(
      new Enemy(this, at, {
        level: this.level,
        mode: this.mode,
        jitter: this.rng(),
        kindId: pick.kind,
        elite: pick.elite,
        eliteHpBonus: elite.hpBonus,
        eliteSpeedMult: elite.speedMult,
      }),
    );
  }

  /**
   * Удар по игроку: цена ошибки, а не конец забега. Отклик обязателен — без него
   * первый удар читался бы как бесплатный, и третий заставал бы врасплох.
   */
  private takeHit(): void {
    this.hp--;
    this.iFramesT = TUNING.player.hitInvulnMs;
    this.sfx.play('hit');
    this.juice.shake('hit');
    this.juice.burst(this.pos.x, this.pos.y, HIT_RING_COLOR, 'hit');
    this.juice.popup(
      this.pos.x,
      this.pos.y - TUNING.player.radius * 4,
      '-1',
      '#ff4d6d',
    );
    if (this.hp <= 0) this.die();
  }

  private die(): void {
    // Смерть одна на забег: экран смерти и запись результата не должны
    // выполняться повторно — ни вторым касанием в том же кадре, ни шагом после.
    if (this.dead) return;
    this.dead = true;
    // Смерть обязана читаться до слов: обвал тона, тряска и вспышка экрана.
    this.sfx.play('death');
    this.juice.shake('death');
    this.juice.flash(140, 255, 60, 90);
    this.player.setFillStyle(PLAYER_DEAD_COLOR);
    this.deathText = this.add
      .text(VIEW.w / 2, VIEW.h * 0.15, isTouchDevice() ? 'DEAD\nкоснись экрана' : 'DEAD\nR — новый забег', {
        fontFamily: 'monospace',
        fontSize: `${this.fontLogical(TUNING.hud.fontLogical)}px`,
        color: '#ff4d6d',
        align: 'center',
      })
      .setOrigin(0.5, 0)
      .setDepth(30);

    // Итог забега и отчёт: без них забег заканчивается словом DEAD и никакого
    // опыта из него не вынести. Строка отчёта копируется целиком — её и присылают.
    const head = this.statsHead();
    this.report = reportLine(this.stats, head);
    this.summary = formatStats(this.stats, head).map((line) =>
      this.add
        .text(0, 0, line, { fontFamily: 'monospace', color: '#a9a3c9' })
        .setOrigin(0.5, 0)
        .setDepth(30),
    );
    this.bestLabel = this.add
      .text(0, 0, this.bestLine(), { fontFamily: 'monospace', color: '#8b86a8' })
      .setOrigin(0.5, 0)
      .setDepth(30);
    this.copyLabel = this.add
      .text(0, 0, 'СКОПИРОВАТЬ ОТЧЁТ', { fontFamily: 'monospace', color: '#ffe066' })
      .setOrigin(0.5, 0)
      .setDepth(30)
      .setInteractive({ useHandCursor: true });
    this.copyLabel.on('pointerdown', () => this.copyReport());
    this.saveResult();
    this.maybeRetireIntro();

    // Режим выбирается здесь же: экран смерти — единственное состояние, где мир
    // уже остановлен. Тап по строке режима сразу начинает забег в нём; тап по
    // пустому месту — в текущем (см. onDeathTap).
    this.modeLabels = (['normal', 'hardcore'] as const).map((mode) => {
      const label = this.add
        .text(0, 0, `режим: ${MODE_TITLE[mode]}`, {
          fontFamily: 'monospace',
          fontSize: `${this.fontLogical(TUNING.hud.smallFontLogical)}px`,
          color: mode === this.mode ? '#ffe066' : '#6f6991',
        })
        .setOrigin(0.5, 0)
        .setDepth(30)
        .setInteractive({ useHandCursor: true });
      label.on('pointerdown', () => {
        this.mode = mode;
        this.restartRequested = true;
      });
      return label;
    });
    this.layoutDeathScreen();
  }

  /**
   * Раскладка экрана смерти: итог, сравнение с лучшим забегом, кнопка отчёта и
   * выбор режима. Общая для смерти и поворота телефона: порядок строк один.
   */
  private layoutDeathScreen(): void {
    const death = this.deathText;
    if (!death) return;
    const small = this.fontLogical(TUNING.hud.smallFontLogical);
    const step = small + 6;
    death.setPosition(VIEW.w / 2, VIEW.h * 0.12);
    let y = death.y + death.height + 6;
    for (const line of this.summary) {
      line.setFontSize(small).setPosition(VIEW.w / 2, y);
      y += line.height + 2;
    }
    if (this.bestLabel) {
      this.bestLabel.setFontSize(small).setPosition(VIEW.w / 2, y);
      y += this.bestLabel.height + 6;
    }
    if (this.copyLabel) {
      this.copyLabel.setFontSize(small).setPosition(VIEW.w / 2, y);
      y += this.copyLabel.height + step;
    }
    for (let i = 0; i < this.modeLabels.length; i++) {
      const label = this.modeLabels[i];
      label.setFontSize(small);
      label.setPosition(VIEW.w / 2, y + i * step);
    }
  }

  private render(): void {
    this.player.setPosition(this.pos.x, this.pos.y);
    // Цвет «живого» игрока не должен затирать вид мёртвого.
    if (!this.dead) {
      this.player.setFillStyle(this.iFramesT > 0 ? PLAYER_IFRAMES_COLOR : PLAYER_ALIVE_COLOR);
      this.player.setAlpha(this.dashT > 0 ? 0.85 : 1);
    }

    for (const e of this.enemies) e.render();
    for (const ally of this.allies) ally.render();

    // Предметы рисуются пулом: сколько их лежит, столько кругов и видно. Вид
    // (размер и цвет) берётся из самого предмета: осколок обязан читаться как
    // осколок, а не как забытая батарея.
    for (let i = 0; i < this.pickupArcs.length; i++) {
      const arc = this.pickupArcs[i];
      const item = this.pickups.items[i];
      if (!item) {
        arc.setVisible(false);
        continue;
      }
      const drop = item.kind === 'drop';
      arc
        .setVisible(true)
        .setPosition(item.x, item.y)
        .setRadius(item.radius)
        .setFillStyle(drop ? DROP_COLOR : BATTERY_COLOR)
        .setStrokeStyle(1, drop ? DROP_STROKE : BATTERY_STROKE);
      // Предмет тускнеет к концу срока: игрок видит, что брать надо сейчас.
      arc.setAlpha(item.ageMs > item.ttlMs * 0.7 ? 0.45 : 1);
    }

    // Следы рисуются после мира и до HUD: они часть боя, а не интерфейса.
    this.juice.render(this.shots, this.pos, this.vel, this.dashT > 0);

    this.updateHud();
  }

  private updateHud(): void {
    const invalid = this.runRecord.changedDuringRun ? '  [рекорд: недействителен]' : '';
    // Профессия — часть опознания забега, поэтому едет в заголовок HUD: он умеет
    // переноситься на узком поле, а строка уровня — нет.
    const spec = this.build.specialty ? `  ${branchTitle(this.build.specialty)}` : '';
    // Режим — часть опознания забега: «обычный» и «хардкор» несравнимы между
    // собой, поэтому он виден в HUD, а не только в записи.
    const head = `сид ${this.seed}  ${MODE_TITLE[this.mode].toLowerCase()}${spec}`;
    const tail = `убито: ${this.killed}${invalid}`;

    // Решение о переносе принимается ТОЛЬКО по ширине однострочного варианта:
    // измерять текущую форму нельзя — строки мигали бы между видами.
    const signature = `${head}|${tail}`;
    if (signature !== this.hudSignature) {
      this.hudSignature = signature;
      this.hud.setText(`${head}  ${tail}`);
      this.hudWrapped = this.hud.width > VIEW.w - 2 * TUNING.hud.marginLogical;
    }
    this.hud.setText(this.hudWrapped ? `${head}\n${tail}` : `${head}  ${tail}`);

    const picked = this.lastPickTitle ? `  взято: ${this.lastPickTitle}` : '';
    // Шкала Тока видна всегда: это единственный ресурс забега, а не украшение
    // одной из веток.
    // Занятый Ток виден числом: без него непонятно, почему шкала не полна при
    // живом выводке — а это и есть цена силы фигур.
    const busy = this.charge.held > 0 ? ` занято ${this.charge.held}` : '';
    // ▲ — напряжение: без него ускорение выводка не отличить от просто удачного билда.
    const charge = `  ток: ${chargeBar(this.charge)}${busy}${this.boosted ? ' ▲' : ''}`;
    this.pickLine.setText(
      `ур. ${this.level}  опыт: ${this.xp}/${xpForNextLevel(this.level)}${picked}${charge}`,
    );

    const dash =
      this.dashT > 0 ? 'DASH' : this.dashCdT > 0 ? `cd ${Math.ceil(this.dashCdT)}` : 'ready';
    // Время и лучший забег видны прямо в бою: сравнивать себя хочется не только
    // после смерти. Отладочные i-frames убраны — в отчёте они не нужны.
    const best = bestOf(this.history);
    // Пул ошибок виден в бою: узнать о нём на экране смерти поздно, а шкала Тока
    // об этом не говорит ничего.
    const lives =
      '█'.repeat(Math.max(0, this.hp)) + '░'.repeat(Math.max(0, TUNING.player.hits - this.hp));
    this.status.setText(
      `жизни ${lives} · dash ${dash} · время ${formatClock(this.stats.timeMs)}${best ? ` · лучший ${formatClock(best.timeMs)}` : ''}`,
    );

    this.layoutHud();
  }

  /** Столбик HUD: заголовок → подсказка → состояние. Позиции — от фактических высот. */
  private layoutHud(): void {
    const margin = TUNING.hud.marginLogical;
    const gap = 3;

    this.hud.setPosition(margin, margin);
    let y = margin + this.hud.height + gap;
    if (this.hint.visible) {
      this.hint.setPosition(margin, y);
      y += this.hint.height + gap;
    }
    this.pickLine.setPosition(margin, y);
    y += this.pickLine.height + gap;
    this.status.setPosition(margin, y);
  }

  private drawGrid(): void {
    const g = this.grid;
    g.clear();
    g.fillStyle(0x151321, 1).fillRect(0, 0, VIEW.w, VIEW.h);
    g.lineStyle(1, 0x1e1b2e, 1);
    for (let x = 0; x <= VIEW.w; x += 16) g.lineBetween(x, 0, x, VIEW.h);
    for (let y = 0; y <= VIEW.h; y += 16) g.lineBetween(0, y, VIEW.w, y);
  }
}
