import { isTouchDevice, VIEW } from '../core/viewport';

/**
 * Заглушка для вертикального экрана.
 *
 * Кроме подсказки она даёт кнопку «во весь экран»: на Android именно полный
 * экран — единственный способ заблокировать ориентацию, а заодно прячется
 * адресная строка браузера, которая съедает место у арены.
 */
export interface RotateHint {
  setVisible(visible: boolean): void;
}

export function createRotateHint(): RotateHint {
  const root = document.getElementById('rotate-hint');
  const button = document.getElementById('rotate-hint-fullscreen');
  if (!root || !button) throw new Error('нет разметки заглушки поворота');

  let wasVisible = false;
  button.addEventListener('click', () => {
    void enterFullscreenLandscape();
  });

  return {
    setVisible(visible: boolean): void {
      if (visible === wasVisible && root.hidden === !visible) return;
      wasVisible = visible;
      root.hidden = !visible;
    },
  };
}

/**
 * Возврат в полный экран после перезагрузки страницы.
 *
 * Браузер выходит из полного экрана сам, а кнопка «во весь экран» живёт только в
 * заглушке вертикали — и если телефон и так лежит горизонтально, вернуться
 * обратно без поворота было нечем. Поэтому полный экран просит первое действие
 * игрока.
 *
 * Просить его можно только по действию, и НЕЛЬЗЯ сдаваться после первой осечки:
 * сразу после загрузки браузер ещё отдаёт портретные `innerWidth/innerHeight`,
 * поэтому первая попытка могла попасть в «нужна заглушка» и обработчик снимал
 * себя до того, как экран успевал перестроиться — полный экран не возвращался
 * больше никогда, и помогало только переворачивание телефона. Теперь обработчик
 * живёт, пока попытка не удалась, но не дольше нескольких действий: если
 * браузер запретил, повторять бесконечно бессмысленно.
 */
export function restoreFullscreenOnFirstTouch(): void {
  if (!isTouchDevice()) return;

  const MAX_TRIES = 3;
  let tries = 0;

  const attempt = (): void => {
    if (document.fullscreenElement) {
      window.removeEventListener('pointerdown', attempt, true);
      return;
    }
    // Портрет отдан заглушке: там своя кнопка, и она честнее автоматики.
    // Такое действие попыткой не считается — оно просто не наше.
    if (VIEW.needsRotate) return;

    tries++;
    void enterFullscreenLandscape().then((ok) => {
      if (ok || tries >= MAX_TRIES) window.removeEventListener('pointerdown', attempt, true);
    });
  };

  window.addEventListener('pointerdown', attempt, true);
}

/**
 * Пытается уйти в полный экран и заблокировать ландшафт.
 * true — полный экран действительно включён (значит, цель достигнута и
 * повторять попытку незачем). Ошибка блокировки ориентации сама по себе НЕ
 * считается неудачей: Safari (iOS) её не поддерживает вовсе, там просто
 * остаётся подсказка повернуть телефон руками.
 */
async function enterFullscreenLandscape(): Promise<boolean> {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
  } catch {
    // Полный экран может быть запрещён политикой браузера: попробуем на следующем действии.
    return false;
  }

  try {
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (orientation: string) => Promise<void>;
    };
    await orientation.lock?.('landscape');
  } catch {
    // Блокировка недоступна — не беда: полный экран уже включён.
  }

  return document.fullscreenElement !== null;
}
