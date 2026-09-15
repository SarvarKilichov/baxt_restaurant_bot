import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api.js';
import { translate } from './i18n.js';
import { haptic } from './telegram.js';

const AppContext = createContext(null);

export function useApp() {
  return useContext(AppContext);
}

export function AppProvider({ children }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [toast, setToastState] = useState(null);
  const toastTimer = useRef(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const bootstrap = await api.bootstrap();
      setData(bootstrap);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const lang = data?.language ?? 'ru';

  const t = useCallback((path, params) => translate(lang, path, params), [lang]);

  const showToast = useCallback((message, tone = 'default') => {
    clearTimeout(toastTimer.current);
    setToastState({ message, tone });
    toastTimer.current = setTimeout(() => setToastState(null), 2600);
  }, []);

  // Показывает сообщение об ошибке от сервера (или общий текст, если код неизвестен)
  const showApiError = useCallback(
    (err) => {
      const message = err instanceof ApiError ? err.message || translate(lang, `errors.${err.code}`) : translate(lang, 'errors.SERVER_ERROR');
      haptic('rigid');
      showToast(message, 'error');
    },
    [lang, showToast],
  );

  const updateCart = useCallback((cart) => setData((prev) => (prev ? { ...prev, cart } : prev)), []);

  const setLanguage = useCallback(
    async (nextLang) => {
      const updated = await api.setLanguage(nextLang);
      setData(updated);
    },
    [],
  );

  const value = {
    data,
    error,
    lang,
    t,
    reload: load,
    updateCart,
    setLanguage,
    toast,
    showToast,
    showApiError,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
