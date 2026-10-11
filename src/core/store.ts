/**
 * Мост к браузерным возможностям, которые не относятся к симуляции: память
 * между забегами и буфер обмена для отчёта.
 *
 * Здесь и только здесь игра трогает хранилище: приватный режим и запрет на
 * cookies умеют бросать исключение, а забег из-за этого падать не должен —
 * история и подсказки не стоят сломанной игры.
 */
const PREFIX = 'par.';

/** Ключ истории забегов. Версия в имени — чтобы смена формата не ломала старую. */
export const HISTORY_KEY = 'history.v1';
/** Ключ «игрок уже видел подсказки первого забега». */
export const INTRO_KEY = 'intro.v1';
/** Ключ открытых достижений. Мета — единственное, что переживает забег. */
export const META_KEY = 'meta.v1';

export function loadText(key: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function saveText(key: string, value: string): void {
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    // Сохранить не удалось — играем дальше без памяти.
  }
}

/**
 * Копирование в буфер. Сначала пробуем современный способ, затем старый:
 * по http на телефоне (адрес по LAN) современный API недоступен, потому что
 * контекст не считается безопасным, а отчёт нужен именно оттуда.
 */
export function copyText(text: string): Promise<boolean> {
  const clip = navigator.clipboard;
  if (clip && typeof clip.writeText === 'function') {
    return clip.writeText(text).then(
      () => true,
      () => legacyCopy(text),
    );
  }
  return Promise.resolve(legacyCopy(text));
}

function legacyCopy(text: string): boolean {
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
