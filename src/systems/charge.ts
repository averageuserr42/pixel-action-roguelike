import { TUNING } from '../config/tuning';

/**
 * «Ток» — общая энергия фигур и единственный ресурс забега.
 *
 * Добывается не уроном: ствола у игрока нет, урон наносят только фигуры. Ток
 * приносят батареи с поля, поэтому выводок работает ровно настолько, насколько
 * игрок успевает двигаться. Модуль чистый: ни Phaser, ни времени — только
 * числа, которые ему передают, поэтому правила проверяются тестами без браузера.
 */
export interface Charge {
  amount: number;
  /**
   * Потолок пула. Живёт в состоянии, а не берётся из tuning: его растит ветка
   * энергии, то есть у каждого билда он свой.
   */
  cap: number;
}

export function createCharge(cap: number): Charge {
  return { amount: 0, cap };
}

/** Начисление за подбор. Больше потолка пул не берёт. */
export function add(c: Charge, amount: number): void {
  c.amount = Math.min(c.cap, c.amount + amount);
}

/** Меняет потолок и подрезает пул: билд не должен держать лишнее. */
export function setCap(c: Charge, cap: number): void {
  c.cap = cap;
  if (c.amount > cap) c.amount = cap;
}

export function canAfford(c: Charge, cost: number): boolean {
  return c.amount >= cost;
}

/** Списывает цену действия. false — Тока не хватает, пул не тронут. */
export function spend(c: Charge, cost: number): boolean {
  if (!canAfford(c, cost)) return false;
  c.amount -= cost;
  return true;
}

/**
 * Затухание: пул тает, пока он выше защищённого порога, и ниже порога не идёт.
 *
 * И скорость, и порог приходят аргументами: их меняют карты, а сам модуль про
 * них не знает. Порог задан ДОЛЕЙ потолка, а не числом Тока, по двум причинам:
 * карта «Резерв» обязана работать одинаково на пуле в 20 и на пуле в 60, а
 * «Ёмкость» перестаёт быть мёртвой — она растит защищённую часть пула. Ноль
 * возвращает прежнее поведение: пул уходит в ноль.
 */
export function stepCharge(
  c: Charge,
  dt: number,
  decayPerSec: number,
  reserveFraction = 0,
): void {
  if (decayPerSec <= 0) return;
  const floor = c.cap * reserveFraction;
  if (c.amount <= floor) return;
  c.amount = Math.max(floor, c.amount - decayPerSec * dt);
}

/** 0..1 — для шкалы HUD и будущего агро врагов. */
export function chargeNorm(c: Charge): number {
  return c.cap > 0 ? c.amount / c.cap : 0;
}

/** Полный пул билда — стартовое значение для сцены. */
export function baseCap(): number {
  return TUNING.charge.capBase;
}
