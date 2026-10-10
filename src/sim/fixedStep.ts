/**
 * Фиксированный шаг симуляции.
 * Симуляция всегда идёт одинаковыми кусками времени, сколько бы FPS ни выдал браузер.
 * Это обязательное условие для честных i-frames, дэшей и воспроизводимых забегов.
 */
export class FixedStep {
  private acc = 0;

  constructor(
    private readonly stepMs: number,
    private readonly maxSteps: number,
  ) {}

  /** Сколько шагов симуляции выполнить в этом кадре. */
  advance(deltaMs: number): number {
    // Ограничиваем входящую дельту: после сворачивания окна не должно быть скачка.
    this.acc += Math.min(deltaMs, this.stepMs * this.maxSteps);

    let steps = 0;
    while (this.acc >= this.stepMs && steps < this.maxSteps) {
      this.acc -= this.stepMs;
      steps++;
    }

    // Остаток НЕ сбрасываем. Он всегда меньше одного шага (аккумулятор не может
    // вырасти больше, чем на clamp выше) и законно ждёт следующего кадра.
    // Сброс приводил к потере времени: на низких FPS, где кадр близок к бюджету
    // maxStepsPerFrame, игра незаметно замедлялась (замерено ~10% на 24 fps).
    return steps;
  }

  get stepSeconds(): number {
    return this.stepMs / 1000;
  }
}
