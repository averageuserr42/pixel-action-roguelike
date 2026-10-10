import Phaser from 'phaser';
import { BRANCHES, branchTitle, CROSS_COLOR, type Card } from '../core/progression';
import { VIEW } from '../core/viewport';

const DEPTH_DIM = 38;
const DEPTH_PANEL = 39;
const DEPTH_TEXT = 40;

const PANEL_FILL = 0x1b1830;
const PANEL_STROKE = 0x4a4468;

interface CardView {
  /** null — слот пуст: карт в предложении может быть меньше трёх. */
  card: Card | null;
  panel: Phaser.GameObjects.Rectangle;
  branch: Phaser.GameObjects.Text;
  title: Phaser.GameObjects.Text;
  blurb: Phaser.GameObjects.Text;
  hint: Phaser.GameObjects.Text;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Экран выбора таланта. Пока он открыт, мир стоит: сцена просто не шагает.
 *
 * Слушаются три способа ввода — тап, клик мышью и клавиши 1..3: на телефоне
 * палец, на мониторе клавиатура, и оба обязаны работать.
 */
export class CardPicker {
  private readonly dim: Phaser.GameObjects.Rectangle;
  private readonly heading: Phaser.GameObjects.Text;
  private readonly views: CardView[] = [];
  private readonly onPointerDown = (pointer: Phaser.Input.Pointer): void => {
    if (!this.open) return;
    for (const view of this.views) {
      if (
        pointer.x >= view.x &&
        pointer.x <= view.x + view.w &&
        pointer.y >= view.y &&
        pointer.y <= view.y + view.h
      ) {
        this.pick(view.card);
        return;
      }
    }
  };

  private cards: Card[] = [];
  private title = '';
  private onPick: ((card: Card) => void) | null = null;
  private open = false;

  constructor(private readonly scene: Phaser.Scene) {
    this.dim = scene.add
      .rectangle(0, 0, VIEW.w, VIEW.h, 0x0d0b12, 0.86)
      .setOrigin(0, 0)
      .setDepth(DEPTH_DIM)
      .setVisible(false);
    this.heading = scene.add
      .text(0, 0, '', { fontFamily: 'monospace', color: '#ffe066' })
      .setDepth(DEPTH_TEXT)
      .setOrigin(0.5, 0)
      .setVisible(false);

    const kb = scene.input.keyboard;
    if (kb) {
      const codes = [
        Phaser.Input.Keyboard.KeyCodes.ONE,
        Phaser.Input.Keyboard.KeyCodes.TWO,
        Phaser.Input.Keyboard.KeyCodes.THREE,
      ];
      codes.forEach((code, index) => {
        const key = kb.addKey(code);
        key.off('down');
        key.on('down', () => this.pick(this.cards[index]));
      });
    }

    scene.input.on('pointerdown', this.onPointerDown);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.input.off('pointerdown', this.onPointerDown);
      this.destroy();
    });
  }

  get visible(): boolean {
    return this.open;
  }

  show(cards: Card[], title: string, onPick: (card: Card) => void): void {
    this.cards = cards;
    this.title = title;
    this.onPick = onPick;
    this.open = true;

    this.ensureViews(cards.length);
    for (let i = 0; i < this.views.length; i++) {
      const view = this.views[i];
      const card = cards[i];
      // Ссылку на карту хранит вид: по ней решается, что именно выбрал палец.
      view.card = card;
      view.panel.setVisible(!!card);
      view.branch.setVisible(!!card);
      view.title.setVisible(!!card);
      view.blurb.setVisible(!!card);
      view.hint.setVisible(!!card);
      if (!card) continue;

      // Крос-карта не принадлежит ветке: у неё свой цвет и своя подпись, чтобы
      // игрок не принял её за обычный талант одной из трёх веток.
      const pair = card.crossPair;
      const branch = card.branch ? BRANCHES.find((b) => b.id === card.branch) : undefined;
      const accent = pair ? CROSS_COLOR : (branch?.color ?? PANEL_STROKE);
      view.branch.setText(
        pair ? `крос: ${branchTitle(pair[0])} × ${branchTitle(pair[1])}` : (branch?.title ?? ''),
      );
      view.branch.setColor(hexColor(accent));
      view.panel.setStrokeStyle(1, accent);
      view.title.setText(card.title);
      view.blurb.setText(card.blurb);
      view.hint.setText(`${i + 1}`);
    }

    this.dim.setVisible(true);
    this.heading.setVisible(true);
    this.layout();
  }

  hide(): void {
    this.open = false;
    this.onPick = null;
    this.dim.setVisible(false);
    this.heading.setVisible(false);
    for (const view of this.views) {
      view.panel.setVisible(false);
      view.branch.setVisible(false);
      view.title.setVisible(false);
      view.blurb.setVisible(false);
      view.hint.setVisible(false);
    }
  }

  /** Раскладка под текущее поле: игрок мог повернуть телефон прямо на выборе. */
  relayout(): void {
    if (!this.open) return;
    this.layout();
  }

  destroy(): void {
    this.dim.destroy();
    this.heading.destroy();
    for (const view of this.views) {
      view.panel.destroy();
      view.branch.destroy();
      view.title.destroy();
      view.blurb.destroy();
      view.hint.destroy();
    }
    this.views.length = 0;
  }

  private pick(card: Card | null | undefined): void {
    if (!this.open || !card) return;
    const callback = this.onPick;
    this.hide();
    callback?.(card);
  }

  private ensureViews(count: number): void {
    while (this.views.length < count) {
      this.views.push({
        card: null,
        panel: this.scene.add
          .rectangle(0, 0, 1, 1, PANEL_FILL, 0.96)
          .setOrigin(0, 0)
          .setDepth(DEPTH_PANEL),
        branch: this.scene.add.text(0, 0, '', { fontFamily: 'monospace' }).setDepth(DEPTH_TEXT),
        title: this.scene.add
          .text(0, 0, '', { fontFamily: 'monospace', color: '#ffe9a8' })
          .setDepth(DEPTH_TEXT),
        blurb: this.scene.add
          .text(0, 0, '', { fontFamily: 'monospace', color: '#a9a3c9' })
          .setDepth(DEPTH_TEXT),
        hint: this.scene.add
          .text(0, 0, '', { fontFamily: 'monospace', color: '#6f6991' })
          .setDepth(DEPTH_TEXT),
        x: 0,
        y: 0,
        w: 1,
        h: 1,
      });
    }
  }

  /**
   * Карты занимают центр поля. Размеры считаются от меньшей стороны: на
   * телефоне в ландшафте три карты должны читаться, а не сливаться в кашу.
   */
  private layout(): void {
    const n = this.cards.length;
    if (n === 0) return;

    const margin = Math.max(6, VIEW.minSide * 0.05);
    const gap = Math.max(4, VIEW.minSide * 0.03);
    const headingFont = Math.max(9, Math.round(VIEW.minSide * 0.05));
    const branchFont = Math.max(7, Math.round(VIEW.minSide * 0.032));
    const titleFont = Math.max(8, Math.round(VIEW.minSide * 0.04));
    const bodyFont = Math.max(7, Math.round(VIEW.minSide * 0.031));

    this.dim.setSize(VIEW.w, VIEW.h);
    this.heading.setFontSize(headingFont).setPosition(VIEW.w / 2, margin);
    this.heading.setText(this.title);

    const top = margin + headingFont + margin;
    const bottom = VIEW.h - margin;
    const cardW = Math.min((VIEW.w - 2 * margin - (n - 1) * gap) / n, VIEW.minSide * 0.62);
    const totalW = n * cardW + (n - 1) * gap;
    const x0 = (VIEW.w - totalW) / 2;
    let cardH = 0;

    for (let i = 0; i < this.views.length; i++) {
      const view = this.views[i];
      if (!view.panel.visible) continue;

      view.x = x0 + i * (cardW + gap);
      view.y = top;
      view.w = cardW;
      view.h = bottom - top;

      // Строки ставим друг за другом ПО ФАКТИЧЕСКОЙ высоте: подзаголовок
      // крос-карты («крос: ИНЖЕНЕР × СУММОНЕР») на узком телефоне переносится на
      // две строки, и жёсткие смещения наехали бы друг на друга.
      view.branch
        .setFontSize(branchFont)
        .setWordWrapWidth(cardW - 16)
        .setPosition(view.x + 8, view.y + 8);
      view.title
        .setFontSize(titleFont)
        .setWordWrapWidth(cardW - 16)
        .setPosition(view.x + 8, view.branch.y + view.branch.height + 6);
      view.blurb
        .setFontSize(bodyFont)
        .setWordWrapWidth(cardW - 16)
        .setPosition(view.x + 8, view.title.y + view.title.height + 6);
      view.hint
        .setFontSize(branchFont)
        .setPosition(view.x + cardW - 14, view.y + 8);

      // Панель ровно по содержимому: пустое поле на пол-экрана читается как
      // недоделанный интерфейс, а не как запас места.
      cardH = Math.max(cardH, view.blurb.y + view.blurb.height + 8 - view.y);
    }

    for (const view of this.views) {
      if (!view.panel.visible) continue;
      view.h = cardH;
      // Высоту берём общую (по самой высокой карте), а позицию — свою:
      // панель обязана стоять там же, где её текст, иначе рамки уедут в угол.
      view.panel.setSize(cardW, cardH).setPosition(view.x, view.y);
    }
  }
}

/** Число цвета -> строка для стиля текста Phaser. */
function hexColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
