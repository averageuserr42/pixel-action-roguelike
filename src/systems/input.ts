import Phaser from 'phaser';
import { TUNING } from '../config/tuning';
import type { Vec2 } from '../core/math';
import type { ControlScheme } from '../core/runRecord';
import { cssToLogical, VIEW } from '../core/viewport';

/**
 * Единое состояние ввода. Симуляция не знает, откуда оно пришло — с клавиатуры,
 * мыши или виртуального стика. Именно поэтому мобильный ввод остаётся бонусом,
 * а не второй игрой: настройка ощущений по-прежнему одна.
 */
export interface InputState {
  /** Вектор движения: единичной длины у клавиатуры, аналоговый (0..1) у стика. */
  move: Vec2;
  /** Точка в мире, куда целится ручной режим. */
  aim: Vec2;
  /** Огонь удерживается (актуально для ручного режима). */
  firing: boolean;
  /** Ввод идёт с сенсорного экрана. */
  touchActive: boolean;
}

export class InputHub {
  readonly state: InputState = {
    move: { x: 0, y: 0 },
    aim: { x: 0, y: 0 },
    firing: false,
    touchActive: false,
  };

  private dashQueued = false;
  private toggleFireQueued = false;
  private stickPointerId: number | null = null;
  private readonly stickOrigin: Vec2 = { x: 0, y: 0 };
  /** Пока открыт модальный экран (выбор таланта), ввод в мир не идёт. */
  private enabled = true;

  private readonly base: Phaser.GameObjects.Arc;
  private readonly knob: Phaser.GameObjects.Arc;
  private readonly dashButton: Phaser.GameObjects.Arc;

  // Размеры в игровых единицах, но вычислены из CSS-пикселей: палец живёт
  // в физическом мире, поэтому кнопка должна быть одинаковой и на телефоне,
  // и на мониторе с другим масштабом.
  private stickBaseRadius = 30;
  private stickRadius = 34;
  private knobRadius = 11;
  private dashButtonRadius = 20;
  private deadZone = 4;

  private readonly keys: Record<string, Phaser.Input.Keyboard.Key>;
  private readonly cursors: Phaser.Types.Input.Keyboard.CursorKeys;

  constructor(private readonly scene: Phaser.Scene) {
    const kb = scene.input.keyboard;
    if (!kb) throw new Error('Keyboard plugin недоступен');

    this.keys = kb.addKeys('W,A,S,D') as unknown as Record<string, Phaser.Input.Keyboard.Key>;
    this.cursors = kb.createCursorKeys();

    const dashKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    const fireModeKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.F);

    // Ввод событийный, а не опросом JustDown: если down и up приходят в один тик
    // (очень быстрое нажатие или просевший кадр), опрос молча терял нажатие.
    dashKey.off('down');
    dashKey.on('down', () => {
      this.dashQueued = true;
    });
    fireModeKey.off('down');
    fireModeKey.on('down', () => {
      this.toggleFireQueued = true;
    });

    // Нужен мультитач: стик и кнопка дэша должны работать одновременно.
    scene.input.addPointer(2);

    this.base = scene.add.circle(0, 0, 1, 0x2a2740).setDepth(30).setVisible(false);
    this.knob = scene.add.circle(0, 0, 1, 0x8b86a8).setDepth(31).setVisible(false);
    this.dashButton = scene.add.circle(0, 0, 1, 0x2a2740).setDepth(30).setVisible(false);

    this.applyViewport();

    scene.input.on('pointerdown', this.onDown);
    scene.input.on('pointermove', this.onMove);
    scene.input.on('pointerup', this.onUp);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  get control(): ControlScheme {
    return this.state.touchActive ? 'touch' : 'keyboard';
  }

  /**
   * Выключает ввод на время модальных экранов. Иначе тап по карте таланта
   * заодно ставил бы стик под палец: Phaser не «съедает» события для других
   * слушателей, их видит и сцена, и этот хаб.
   */
  setEnabled(value: boolean): void {
    this.enabled = value;
    if (value) return;

    this.stickPointerId = null;
    this.state.move.x = 0;
    this.state.move.y = 0;
    this.state.firing = false;
    this.base.setVisible(false);
    this.knob.setVisible(false);
  }

  /** Пересчёт размеров и позиций под новое поле (поворот телефона, ресайз окна). */
  applyViewport(): void {
    this.stickBaseRadius = cssToLogical(TUNING.touch.stickBaseRadiusCss);
    this.stickRadius = cssToLogical(TUNING.touch.stickRadiusCss);
    this.knobRadius = cssToLogical(TUNING.touch.knobRadiusCss);
    this.dashButtonRadius = cssToLogical(TUNING.touch.dashButtonRadiusCss);
    this.deadZone = cssToLogical(TUNING.touch.stickDeadZoneCss);

    this.base.setRadius(this.stickBaseRadius);
    this.knob.setRadius(this.knobRadius);

    const margin = cssToLogical(TUNING.touch.dashButtonMarginCss);
    this.dashButton.setRadius(this.dashButtonRadius);
    this.dashButton.setPosition(
      VIEW.w - margin - this.dashButtonRadius,
      VIEW.h - margin - this.dashButtonRadius,
    );
    this.dashButton.setStrokeStyle(Math.max(1, VIEW.minSide / 220), 0x8b86a8);
  }

  /** Нажатие дэша: читается один раз и сбрасывается. */
  takeDash(): boolean {
    const queued = this.dashQueued;
    this.dashQueued = false;
    return queued;
  }

  /** Запрос на смену режима огня (клавиша F). */
  takeToggleFire(): boolean {
    const queued = this.toggleFireQueued;
    this.toggleFireQueued = false;
    return queued;
  }

  /** Опрос клавиатуры и курсора. Вызывается один раз за кадр, до шагов симуляции. */
  update(): void {
    if (!this.enabled) return;
    // Пока палец держит стик, клавиатура не перебивает тач-ввод.
    if (this.stickPointerId !== null) return;

    const k = this.keys;
    const up = this.cursors.up.isDown || k.W.isDown;
    const down = this.cursors.down.isDown || k.S.isDown;
    const left = this.cursors.left.isDown || k.A.isDown;
    const right = this.cursors.right.isDown || k.D.isDown;

    let ix = (right ? 1 : 0) - (left ? 1 : 0);
    let iy = (down ? 1 : 0) - (up ? 1 : 0);
    const len = Math.hypot(ix, iy);
    if (len > 0) {
      ix /= len;
      iy /= len;
    }
    this.state.move.x = ix;
    this.state.move.y = iy;
  }

  destroy(): void {
    this.scene.input.off('pointerdown', this.onDown);
    this.scene.input.off('pointermove', this.onMove);
    this.scene.input.off('pointerup', this.onUp);
    this.base.destroy();
    this.knob.destroy();
    this.dashButton.destroy();
  }

  private isTouchPointer(pointer: Phaser.Input.Pointer): boolean {
    return (pointer as unknown as { wasTouch?: boolean }).wasTouch === true;
  }

  private withinDashButton(x: number, y: number): boolean {
    const gap = Math.hypot(x - this.dashButton.x, y - this.dashButton.y);
    // Чуть щедрее ради пальца: попасть точно в круг на ходу тяжело.
    return gap <= this.dashButtonRadius * 1.4;
  }

  private readonly onDown = (pointer: Phaser.Input.Pointer): void => {
    if (!this.enabled) return;

    if (this.isTouchPointer(pointer)) {
      this.state.touchActive = true;
      this.dashButton.setVisible(true);

      if (this.stickPointerId === null && pointer.x < VIEW.w * 0.5) {
        this.stickPointerId = pointer.id;
        this.stickOrigin.x = pointer.x;
        this.stickOrigin.y = pointer.y;
        this.base.setPosition(pointer.x, pointer.y).setVisible(true);
        this.knob.setPosition(pointer.x, pointer.y).setVisible(true);
        return;
      }

      if (this.withinDashButton(pointer.x, pointer.y)) this.dashQueued = true;
      return;
    }

    this.state.aim.x = pointer.x;
    this.state.aim.y = pointer.y;
    this.state.firing = true;
  };

  private readonly onMove = (pointer: Phaser.Input.Pointer): void => {
    if (!this.enabled) return;

    if (this.isTouchPointer(pointer)) {
      if (pointer.id !== this.stickPointerId) return;

      const dx = pointer.x - this.stickOrigin.x;
      const dy = pointer.y - this.stickOrigin.y;
      const len = Math.hypot(dx, dy);

      if (len < this.deadZone) {
        this.state.move.x = 0;
        this.state.move.y = 0;
        return;
      }

      // Стик аналоговый: дальше от центра — быстрее, но не быстрее клавиатуры.
      const reach = Math.min(len, this.stickRadius);
      const unitX = dx / len;
      const unitY = dy / len;
      const magnitude = reach / this.stickRadius;

      this.state.move.x = unitX * magnitude;
      this.state.move.y = unitY * magnitude;
      this.knob.setPosition(
        this.stickOrigin.x + unitX * reach,
        this.stickOrigin.y + unitY * reach,
      );
      return;
    }

    this.state.aim.x = pointer.x;
    this.state.aim.y = pointer.y;
  };

  private readonly onUp = (pointer: Phaser.Input.Pointer): void => {
    if (!this.enabled) return;

    if (pointer.id === this.stickPointerId) {
      this.stickPointerId = null;
      this.state.move.x = 0;
      this.state.move.y = 0;
      this.base.setVisible(false);
      this.knob.setVisible(false);
    }
    if (!this.isTouchPointer(pointer)) this.state.firing = false;
  };
}
