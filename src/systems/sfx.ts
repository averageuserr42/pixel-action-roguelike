import { TUNING, type SfxKind, type SfxVoice } from '../config/tuning';

/**
 * Звук событий, синтезированный осциллятором: ни одного файла, ни одной
 * зависимости. Модуль не знает ни про Phaser, ни про сцену — он получает
 * способ добраться до звукового контекста и способ узнать время. Поэтому звук
 * проверяется тестами: подставь заглушку контекста — и видно, что именно
 * играет, какие ноты и с какой громкостью.
 *
 * Молчание — это тоже решение: без разблокировки браузер не даёт звук вообще
 * (жест пользователя обязателен), поэтому до первого касания или клавиши
 * play() тихо ничего не ломает.
 */

/** Голос звука по имени. Чистая функция: тесты сверяют числа без браузера. */
export function voiceOf(kind: SfxKind): SfxVoice {
  return TUNING.sfx.voices[kind];
}

/**
 * Минимум от WebAudio, который нужен синтезу. Настоящий AudioContext подходит
 * структурно, а тесты подставляют заглушку вместо браузера.
 */
export interface AudioParamLike {
  setValueAtTime(value: number, when: number): void;
  exponentialRampToValueAtTime(value: number, when: number): void;
}

export interface OscillatorLike {
  type: string;
  readonly frequency: AudioParamLike;
  connect(destination: unknown): void;
  start(when: number): void;
  stop(when: number): void;
}

export interface GainLike {
  readonly gain: AudioParamLike;
  connect(destination: unknown): void;
  /** Настоящий GainNode шлёт в destination: поле нужно только для проверки в тестах. */
  readonly destination?: unknown;
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: unknown;
  readonly state?: string;
  createOscillator(): OscillatorLike;
  createGain(): GainLike;
  resume?(): Promise<void>;
}

/**
 * Откуда берётся звук и время. Отдельно от класса потому, что в браузере это
 * ленивое создание AudioContext по жесту, а в тестах — заглушка.
 */
export interface SfxDeps {
  audio: () => AudioContextLike | null;
  now: () => number;
}

/** Атака — доли секунды: мгновенный старт тона слышен как щелчок. */
const ATTACK_SEC = 0.008;
/** Экспонента не терпит нуля, поэтому тишина задаётся почти нулём. */
const SILENCE = 0.0001;
/** Хвост после затухания: обрыв осциллятора тоже щёлкает. */
const TAIL_SEC = 0.02;

export class Sfx {
  private muted = false;
  private readonly lastPlayedAt = new Map<SfxKind, number>();
  /**
   * Контекст и часы приходят снаружи: тест подставляет свои списки вызовов,
   * а игра — реальный AudioContext, который создаётся только по жесту.
   */
  private readonly deps: SfxDeps;

  constructor(deps: SfxDeps) {
    this.deps = deps;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(value: boolean): void {
    this.muted = value;
  }

  /**
   * Будит звук по жесту пользователя. Браузер не даёт играть до первого касания
   * или клавиши, поэтому это вызывается из первого же события ввода, а не на
   * старте сцены: до жеста контекст всё равно остаётся спящим.
   */
  unlock(): void {
    const ctx = this.deps.audio();
    if (!ctx) return;
    void ctx.resume?.();
  }

  /** Событие произошло. Молчит, если звук выключен, контекста нет или сработал порог. */
  play(kind: SfxKind): void {
    if (this.muted) return;

    // Порог нужен попаданиям: турели бьют чаще, чем ухо различает отдельные звуки,
    // и без него выстрелы сливаются в треск, в котором тонут подбор и смерть.
    const gate = kind === 'hit' ? TUNING.sfx.hitGateMs : 0;
    if (gate > 0) {
      const now = this.deps.now();
      const last = this.lastPlayedAt.get(kind);
      if (last !== undefined && now - last < gate) return;
      this.lastPlayedAt.set(kind, now);
    }

    const ctx = this.deps.audio();
    if (!ctx) return;

    const voice = voiceOf(kind);
    const at = ctx.currentTime;
    const sustain = voice.durMs / 1000;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = voice.wave;
    osc.frequency.setValueAtTime(voice.freq, at);
    // Цель тона не может быть нулём: у экспоненты нет нуля, и рэмп молча не сработал бы.
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, voice.toFreq), at + sustain);

    gain.gain.setValueAtTime(SILENCE, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(SILENCE, voice.gain), at + ATTACK_SEC);
    gain.gain.exponentialRampToValueAtTime(SILENCE, at + sustain);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(at);
    osc.stop(at + sustain + TAIL_SEC);
  }
}
