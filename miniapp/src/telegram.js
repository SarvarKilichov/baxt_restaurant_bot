import { useEffect } from 'react';

// Не кэшируем объект в константе: он должен быть прочитан заново на случай,
// если скрипт telegram-web-app.js подключился чуть позже наших модулей
function getTg() {
  return window.Telegram?.WebApp ?? null;
}

export function initTelegram() {
  const tg = getTg();
  if (!tg) return;
  tg.ready();
  tg.expand();
  try {
    tg.setBackgroundColor('#ffffff');
    tg.setHeaderColor('#ffffff');
  } catch {
    // старая версия клиента Telegram — не критично
  }
  try {
    tg.disableVerticalSwipes?.();
  } catch {
    // метод есть не во всех версиях
  }
}

export function getInitData() {
  return getTg()?.initData ?? '';
}

export function haptic(style = 'light') {
  try {
    getTg()?.HapticFeedback?.impactOccurred(style);
  } catch {
    // не критично
  }
}

export function hapticNotify(type = 'success') {
  try {
    getTg()?.HapticFeedback?.notificationOccurred(type);
  } catch {
    // не критично
  }
}

export function openLink(url) {
  const tg = getTg();
  if (tg?.openLink) tg.openLink(url);
  else window.open(url, '_blank');
}

const ACCENT = '#ff6b35';

// Главная кнопка Telegram внизу экрана — используется для «Оформить заказ» и т.п.
// Эффект без списка зависимостей срабатывает при каждом рендере: если на экране на
// мгновение смонтированы два компонента с такой кнопкой (например, карточка блюда
// поверх корзины), после закрытия верхнего компонента React перерисовывает дерево
// и нижний компонент тут же переустанавливает свою кнопку — без этого она могла бы
// остаться в чужом, устаревшем состоянии.
export function useMainButton({ text, onClick, visible = true, disabled = false, loading = false }) {
  useEffect(() => {
    const button = getTg()?.MainButton;
    if (!button) return undefined;

    button.setParams({ text, color: ACCENT, text_color: '#ffffff', is_active: !disabled, is_visible: visible });
    if (loading) button.showProgress(false);
    else button.hideProgress();

    const handler = () => onClick?.();
    button.onClick(handler);
    return () => button.offClick(handler);
  });

  useEffect(
    () => () => {
      getTg()?.MainButton?.hide();
    },
    [],
  );
}

// Кнопка «Назад» в шапке Telegram
export function useBackButton(onClick) {
  useEffect(() => {
    const button = getTg()?.BackButton;
    if (!button) return undefined;
    if (!onClick) {
      button.hide();
      return undefined;
    }
    button.show();
    const handler = () => onClick();
    button.onClick(handler);
    return () => {
      button.offClick(handler);
      button.hide();
    };
  }, [onClick]);
}
