import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TUNING, type SfxKind } from '../config/tuning';
import { Sfx, voiceOf, type AudioContextLike, type AudioParamLike } from './sfx';

const KINDS: SfxKind[] = ['pickup', 'hit', 'kill', 'dash', 'death', 'level'];

/** Параметр записывает, что и когда в него писали: по этому видно огибающую. */
class FakeParam implements AudioParamLike {
  readonly events: Array<{ at: number; value: number }> = [];

  setValueAtTime(value: number, when: number): void {
    this.events.push({ at: when, value });
  }

  exponentialRampToValueAtTime(value: number, when: number): void {
    this.events.push({ at: when, value });
  }
}

class FakeOscillator {
  type = 'sine';
  readonly frequency = new FakeParam();
  readonly started: number[] = [];
  readonly stopped: number[] = [];
  readonly connected: unknown[] = [];

  connect(destination: unknown): void {
    this.connected.push(destination);
  }

  start(when: number): void {
    this.started.push(when);
  }

  stop(when: number): void {
    this.stopped.push(when);
  }
}

class FakeContext implements AudioContextLike {
  currentTime = 10;
  readonly destination = { name: 'out' };
  state = 'running';
  readonly oscillators: FakeOscillator[] = [];
  readonly gains: Array<{ gain: FakeParam; connected: unknown[]; connect(d: unknown): void }> = [];
  resumed = 0;

  createOscillator(): FakeOscillator {
    const osc = new FakeOscillator();
    this.oscillators.push(osc);
    return osc;
  }

  createGain() {
    const gain = new FakeParam();
    const node = {
      gain,
      connected: [] as unknown[],
      connect(destination: unknown): void {
        node.connected.push(destination);
      },
    };
    this.gains.push(node);
    return node;
  }

  resume(): Promise<void> {
    this.resumed++;
    return Promise.resolve();
  }
}

function makeSfx(ctx: FakeContext | null, clock = { t: 0 }): Sfx {
  return new Sfx({ audio: () => ctx, now: () => clock.t });
}

test('у каждого события есть голос, и числа в нём осмысленные', () => {
  for (const kind of KINDS) {
    const v = voiceOf(kind);
    assert.ok(v.durMs >= 20 && v.durMs <= 700, `${kind}: длительность ${v.durMs}`);
    assert.ok(v.freq >= 40 && v.freq <= 4000, `${kind}: частота ${v.freq}`);
    assert.ok(v.toFreq >= 1 && v.toFreq <= 4000, `${kind}: цель тона ${v.toFreq}`);
    assert.ok(v.gain > 0 && v.gain <= 0.4, `${kind}: громкость ${v.gain} — звук не должен орать`);
    assert.ok(v.wave.length > 0, `${kind}: форма волны не задана`);
  }
});

test('подбор звучит выше смерти: вверх — «взял», вниз — «плохо»', () => {
  const pickup = voiceOf('pickup');
  const death = voiceOf('death');
  assert.ok(pickup.toFreq > pickup.freq, 'подбор обязан уезжать вверх');
  assert.ok(death.toFreq < death.freq, 'смерть обязана обваливаться вниз');
  assert.ok(pickup.freq > death.freq, 'подбор обязан быть выше смертельного тона');
});

test('звук собирается из голоса: тон, развёртка и огибающая на месте', () => {
  const ctx = new FakeContext();
  const sfx = makeSfx(ctx);
  sfx.play('kill');

  assert.equal(ctx.oscillators.length, 1, 'на событие — один осциллятор');
  const osc = ctx.oscillators[0];
  const voice = voiceOf('kill');
  assert.equal(osc.type, voice.wave);
  assert.equal(osc.frequency.events[0].value, voice.freq, 'старт с частоты голоса');
  assert.equal(
    osc.frequency.events[1].value,
    voice.toFreq,
    'тон обязан уехать к цели голоса',
  );
  assert.equal(osc.started[0], ctx.currentTime);

  const gain = ctx.gains[0].gain;
  const tail = gain.events[gain.events.length - 1];
  assert.ok(tail.value < voice.gain, 'к концу звук обязан затухнуть почти в ноль');
  assert.ok(tail.at > gain.events[0].at, 'затухание обязано идти после начала');
  assert.equal(ctx.gains[0].connected.length, 1, 'усилитель подключён к выходу');
});

test('выключенный звук не создаёт нод вовсе', () => {
  const ctx = new FakeContext();
  const sfx = makeSfx(ctx);
  sfx.setMuted(true);
  assert.equal(sfx.isMuted, true);
  for (const kind of KINDS) sfx.play(kind);
  assert.equal(ctx.oscillators.length, 0);
});

test('без звукового контекста события не роняют игру', () => {
  const sfx = makeSfx(null);
  for (const kind of KINDS) sfx.play(kind);
  sfx.unlock();
  assert.ok(true, 'молчание — законное состояние: жеста ещё не было');
});

test('попадания гейтятся, остальные звуки — нет', () => {
  const ctx = new FakeContext();
  const clock = { t: 1000 };
  const sfx = makeSfx(ctx, clock);

  sfx.play('hit');
  sfx.play('hit');
  assert.equal(ctx.oscillators.length, 1, 'два щелчка в один миг — это треск, а не звук');

  clock.t += TUNING.sfx.hitGateMs - 1;
  sfx.play('hit');
  assert.equal(ctx.oscillators.length, 1, 'порог ещё не вышел');

  clock.t += 2;
  sfx.play('hit');
  assert.equal(ctx.oscillators.length, 2, 'после порога попадание слышно снова');

  // Смерть врага — редкое событие: порог к ней не применяется.
  clock.t += 1;
  sfx.play('kill');
  clock.t += 1;
  sfx.play('kill');
  assert.equal(ctx.oscillators.length, 4);
});

test('разблокировка будит контекст, а не создаёт звук', () => {
  const ctx = new FakeContext();
  const sfx = makeSfx(ctx);
  sfx.unlock();
  assert.equal(ctx.resumed, 1);
  assert.equal(ctx.oscillators.length, 0, 'разблокировка сама по себе молчит');
});
