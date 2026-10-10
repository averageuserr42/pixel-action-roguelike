import Phaser from 'phaser';
import { TUNING } from '../config/tuning';
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
  createRunRecord,
  type FireMode,
  type RunMode,
  type RunRecord,
  type RunProfile,
} from '../core/runRecord';
import { isTouchDevice, VIEW } from '../core/viewport';
import { Ally, isWingKind, type AllyContext, type AllyKind } from '../entities/ally';
import { Enemy, enemyTargetCount } from '../entities/enemy';
import { FixedStep } from '../sim/fixedStep';
import { InputHub } from '../systems/input';
import { Projectiles } from '../systems/projectiles';
import { Weapon, type WeaponMods } from '../systems/weapon';
import { CardPicker } from '../ui/cards';

const PLAYER_ALIVE_COLOR = 0xffe066;
const PLAYER_IFRAMES_COLOR = 0xffffff;
const PLAYER_DEAD_COLOR = 0x3a3550;
/** Как режимы называются игроку. Числа живут в tuning, названия — только здесь. */
const MODE_TITLE: Record<RunMode, string> = { normal: 'ОБЫЧНЫЙ', hardcore: 'ХАРДКОР' };

export class GameScene extends Phaser.Scene {
  private sim!: FixedStep;
  private rng: Rng = mulberry32(1);
  private seed = 1;
  /**
   * Профиль текущего прогона. Публичный намеренно: его будет читать слой
   * сохранений и отправки результатов на сервер, а пока — тесты и HUD.
   */
  runRecord!: RunRecord;

  private controls!: InputHub;
  private weapon!: Weapon;
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
  /** Режим давления. Меняется только на экране смерти, иначе забег несравним. */
  private mode: RunMode = 'normal';
  /** Строки выбора режима: живут только на экране смерти. */
  private modeLabels: Phaser.GameObjects.Text[] = [];

  /** Снаряды общие для игрока, турелей и духов: один пул, одна ветка попаданий. */
  private shots!: Projectiles;
  private allies: Ally[] = [];
  private picker!: CardPicker;
  /** Миллисекунд без движения и дэша: после паузы крылья гаснут. */
  private idleMs = 0;
  /** Правило про гаснущее крыло показывается один раз за забег: иначе оно невидимо. */
  private wingsToldAbout = false;
  /** Слоты строя. Общие для духов и мотов: делить их по видам — значит ставить мот в крыло духа. */
  private wingSlots = 0;

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
  private readonly weaponMods: WeaponMods = {
    fireIntervalMult: 1,
    damage: 0,
    pierce: 0,
    explosiveRadiusFactor: 0,
    targetRangeFactor: TUNING.weapon.targetRangeFactor,
  };
  /** Переиспользуемый контекст спутников: в игровом шаге нет аллокаций. */
  private readonly allyContext: AllyContext = {
    playerPos: { x: 0, y: 0 },
    playerFacing: { x: 1, y: 0 },
    playerActive: true,
    enemies: [],
    shots: null as unknown as Projectiles,
    damage: (enemy, amount) => this.damage(enemy, amount),
    turretRateMult: 1,
    spiritRateMult: 1,
    playerPierce: 0,
    playerExplosiveRadius: 0,
    turretRounds: false,
    spiritRounds: false,
    moteFastRechase: false,
  };

  /** Профиль помощи: кто играет и как. Отдельно от билда — он редко меняется. */
  private readonly profile: RunProfile = {
    seed: 1,
    mode: 'normal',
    control: 'keyboard',
    fireModeAtStart: 'manual',
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
  private restartRequested = false;
  private fireMode: FireMode = 'manual';
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
    this.fireMode = 'manual';
    this.profileLocked = false;
    this.deathText = undefined;
    this.toast = undefined;
    this.hudWrapped = false;
    this.hudSignature = '';

    this.build = createBuild();
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
    this.pendingKills.length = 0;

    // Фон создаём первым (он глубже всего), но рисуем его в relayout():
    // сетка зависит от размера поля, а тот меняется при повороте экрана.
    this.grid = this.add.graphics().setDepth(-1);

    this.player = this.add
      .circle(this.pos.x, this.pos.y, TUNING.player.radius, PLAYER_ALIVE_COLOR)
      .setDepth(10);

    this.controls = new InputHub(this);
    this.weapon = new Weapon();
    this.shots = new Projectiles(this);
    this.allyContext.shots = this.shots;
    this.picker = new CardPicker(this);
    // Прицел по умолчанию — вправо, пока игрок не двинул мышь.
    this.controls.state.aim.x = this.pos.x + 60;
    this.controls.state.aim.y = this.pos.y;

    const kb = this.input.keyboard;
    if (!kb) throw new Error('Keyboard plugin недоступен');
    this.restartKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.restartKey.off('down');
    this.restartKey.on('down', () => {
      this.restartRequested = true;
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
    const initial = enemyTargetCount(this.level, this.mode);
    for (let i = 0; i < initial; i++) this.spawnEnemy((i / initial) * Math.PI * 2);

    this.profile.seed = this.seed;
    this.profile.mode = this.mode;
    this.profile.control = this.controls.control;
    this.profile.fireModeAtStart = this.effectiveFireMode();
    this.profile.changedDuringRun = false;
    this.writeRecord();

    this.hud = this.add.text(0, 0, '', { fontFamily: 'monospace' }).setDepth(20);
    this.hint = this.add
      .text(0, 0, 'WASD — движение   SPACE — дэш   ЛКМ — огонь   F — режим огня   R — сид', {
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
    });

    this.relayout();
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
    this.deathText?.setPosition(VIEW.w / 2, VIEW.h * 0.15);
    if (this.deathText) this.layoutDeathScreen();
    this.toast?.setPosition(VIEW.w / 2, VIEW.h * 0.76);

    clampToBounds(this.pos, TUNING.player.radius, VIEW.w, VIEW.h);
    for (const e of this.enemies) clampToBounds(e.pos, e.radius, VIEW.w, VIEW.h);

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
    this.restartRequested = true;
  };

  update(_time: number, delta: number): void {
    // Вертикальный экран: игра ландшафтная, мир стоит под заглушкой «поверни
    // телефон». Просто не шагаем — ни дие, ни респауна за заглушкой быть не может.
    if (VIEW.needsRotate) return;

    // Открыт выбор таланта: мир не шагает, пока решение не принято.
    if (this.choosing) return;

    if (this.controls.takeToggleFire()) {
      this.fireMode = this.fireMode === 'manual' ? 'auto' : 'manual';
    }

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
    const ms = dt * 1000;

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
    this.syncProfile(inputLen > 0.001 || this.controls.state.firing || this.dashBufferT > 0);

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

    const mode = this.effectiveFireMode();
    const firing = mode === 'auto' ? true : this.controls.state.firing;

    // Порядок боя: сначала все выстрелы, потом один проход попаданий, потом
    // разбор погибших. Так урон игрока, турели и духа считается в одном месте.
    this.weaponMods.fireIntervalMult = this.build.fireIntervalMult;
    this.weaponMods.damage = this.build.damage;
    this.weaponMods.pierce = this.build.pierce;
    this.weaponMods.explosiveRadiusFactor = this.build.explosiveRadiusFactor;
    this.weaponMods.targetRangeFactor = this.build.autoRangeFactor;
    this.weapon.step(
      dt,
      this.pos,
      this.controls.state.aim,
      firing,
      mode,
      this.enemies,
      this.shots,
      this.weaponMods,
    );

    this.allyContext.playerPos = this.pos;
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

    this.allyContext.turretRateMult = this.build.turretRateMult;
    this.allyContext.spiritRateMult = this.build.spiritRateMult;
    // Крос-карты инженера: те же патроны, что у игрока, но у союзников.
    this.allyContext.playerPierce = this.build.pierce;
    this.allyContext.playerExplosiveRadius = this.build.explosiveRadiusFactor * VIEW.minSide;
    this.allyContext.turretRounds = this.build.turretRounds;
    this.allyContext.spiritRounds = this.build.spiritRounds;
    this.allyContext.moteFastRechase = this.build.moteFastRechase;
    for (const ally of this.allies) ally.step(dt, this.allyContext);

    this.shots.step(dt, this.allyContext);

    if (this.pendingKills.length > 0) this.resolveKills();

    // Режиссёр спавна: держим целевое число живых врагов. Раньше новый враг
    // приходил только после смерти предыдущего — поле пустовало, и стоящий
    // игрок ничего не терял. Теперь наоборот: убыль сразу восполняется.
    const spawnTarget = enemyTargetCount(this.level, this.mode);
    this.spawnTimerMs -= ms;
    if (this.enemies.length < spawnTarget && this.spawnTimerMs <= 0) {
      this.spawnEnemy();
      this.spawnTimerMs = TUNING.enemyPressure[this.mode].spawnIntervalMs;
    }

    for (const e of this.enemies) {
      if (distance(this.pos, e.pos) <= TUNING.player.radius + e.radius && this.iFramesT === 0) {
        this.die();
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
    for (const e of this.enemies) order.push(e);
    const px = this.pos.x;
    const py = this.pos.y;
    order.sort(
      (a, b) =>
        Math.atan2(a.pos.y - py, a.pos.x - px) - Math.atan2(b.pos.y - py, b.pos.x - px),
    );

    const stepAngle = (Math.PI * 2) / alive;
    this.assignInterceptors(dt, alive);
    for (let rank = 0; rank < alive; rank++) {
      order[rank].step(dt, this.pos, this.orbitT + rank * stepAngle, this.vel);
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
   * Автострельба заставляется на сенсорном экране: там нет второго пальца под
   * прицел, и без неё игра просто неиграбельна.
   */
  private effectiveFireMode(): FireMode {
    return this.controls.state.touchActive ? 'auto' : this.fireMode;
  }

  /**
   * Профиль забега: кто играет (клавиатура или тач) и с какой помощью.
   * Один профиль на весь забег — иначе результат нельзя ставить в таблицу.
   *
   * До первого осмысленного действия профиль уточняется свободно: на телефоне
   * касания ещё не было, и первое касание — это НАЧАЛО забега, а не смена
   * профиля по ходу. После начала расхождение помечает прогон недействительным.
   */
  private syncProfile(started: boolean): void {
    const control = this.controls.control;
    const mode = this.effectiveFireMode();

    if (control !== this.profile.control || mode !== this.profile.fireModeAtStart) {
      this.profile.control = control;
      this.profile.fireModeAtStart = mode;
      if (this.profileLocked) this.profile.changedDuringRun = true;
      this.writeRecord();
    }

    // Фиксируем ПОСЛЕ уточнения: на 120 Гц касание и рывок стика вполне могут
    // попасть в один шаг, и тогда порядок решает — иначе забег стал бы
    // недействительным сам собой, без единого признака смены профиля.
    if (started) this.profileLocked = true;
  }

  /**
   * Единственный путь смерти врага. Игрок, турель, дух, дрон и мот бьют через
   * этот метод — поэтому опыт нельзя случайно не начислить.
   */
  private damage(enemy: Enemy, amount: number): void {
    if (enemy.hit(amount)) this.pendingKills.push(enemy);
  }

  /** Убирает погибших за шаг: со сцены, из списка, в счётчик и в опыт. */
  private resolveKills(): void {
    for (const e of this.pendingKills) {
      e.destroy();
      const index = this.enemies.indexOf(e);
      if (index >= 0) this.enemies.splice(index, 1);
      this.killed++;
      this.gainXp(TUNING.progression.xpPerKill);
    }
    this.pendingKills.length = 0;
  }

  private gainXp(amount: number): void {
    this.xp += amount;
    let need = xpForNextLevel(this.level);
    while (this.xp >= need) {
      this.xp -= need;
      this.level++;
      this.pendingLevels++;
      need = xpForNextLevel(this.level);
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
    this.picker.show(cards, title, (card) => this.pick(card));
  }

  private pick(card: Card): void {
    const specialtyBefore = this.build.specialty;
    if (applyCard(this.build, card)) {
      this.lastPickTitle = card.title;
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
    if (e.maxTurrets) {
      while (this.countAllies('turret') < this.build.maxTurrets) this.addAlly('turret', this.pos);
    }
    if (e.maxDroneMines) {
      while (this.countAllies('drone') < this.build.maxDroneMines) this.addAlly('drone', this.pos);
    }
    if (e.maxSpirits) {
      while (this.countAllies('spirit') < this.build.maxSpirits) this.addAlly('spirit', this.pos);
    }
    if (e.maxSwarms) {
      const wanted = this.build.maxSwarms * TUNING.progression.motesPerSwarm;
      while (this.countAllies('mote') < wanted) this.addAlly('mote', this.pos);
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
    // Враг появляется под текущий уровень игрока: кривая сложности живёт в enemy.
    // jitter — один бросок сида на двоих: он задаёт и слот на кольце, и разброс
    // первой паузы перед рывком.
    this.enemies.push(new Enemy(this, at, this.level, this.mode, this.rng()));
  }

  private die(): void {
    this.dead = true;
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

  /** Раскладка экрана смерти: заголовок и строки выбора режима. Общая для смерти и поворота. */
  private layoutDeathScreen(): void {
    const death = this.deathText;
    if (!death) return;
    death.setPosition(VIEW.w / 2, VIEW.h * 0.15);
    const small = this.fontLogical(TUNING.hud.smallFontLogical);
    const step = small + 6;
    const firstY = VIEW.h * 0.15 + death.height + 8;
    for (let i = 0; i < this.modeLabels.length; i++) {
      const label = this.modeLabels[i];
      label.setFontSize(small);
      label.setPosition(VIEW.w / 2, firstY + i * step);
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

    this.updateHud();
  }

  private updateHud(): void {
    const mode = this.effectiveFireMode() === 'auto' ? 'авто' : 'ручной';
    const invalid = this.runRecord.changedDuringRun ? '  [рекорд: недействителен]' : '';
    // Профессия — часть опознания забега, поэтому едет в заголовок HUD: он умеет
    // переноситься на узком поле, а строка уровня — нет.
    const spec = this.build.specialty ? `  ${branchTitle(this.build.specialty)}` : '';
    // Режим — часть опознания забега: «обычный» и «хардкор» несравнимы между
    // собой, поэтому он виден в HUD, а не только в записи.
    const head = `сид ${this.seed}  ${MODE_TITLE[this.mode].toLowerCase()}${spec}  огонь: ${mode}`;
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
    this.pickLine.setText(
      `ур. ${this.level}  опыт: ${this.xp}/${xpForNextLevel(this.level)}${picked}`,
    );

    const dash =
      this.dashT > 0 ? 'DASH' : this.dashCdT > 0 ? `cd ${Math.ceil(this.dashCdT)}` : 'ready';
    this.status.setText(`dash: ${dash}  i-frames: ${Math.round(this.iFramesT)}ms`);

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
