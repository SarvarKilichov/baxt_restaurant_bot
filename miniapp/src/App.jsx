import { useEffect, useState } from 'react';
import { AppProvider, useApp } from './store.jsx';
import { initTelegram } from './telegram.js';
import Onboarding from './pages/Onboarding.jsx';
import Home from './pages/Home.jsx';
import Catalog from './pages/Catalog.jsx';
import Cart from './pages/Cart.jsx';
import Profile from './pages/Profile.jsx';
import BottomNav from './components/BottomNav.jsx';
import ProductSheet from './components/ProductSheet.jsx';

const ONBOARDING_KEY = 'onboarding_seen_v1';

function readStartDish() {
  try {
    return new URLSearchParams(window.location.search).get('dish');
  } catch {
    return null;
  }
}

function Shell() {
  const { data, error, reload, t } = useApp();
  const [tab, setTab] = useState('home');
  const [dishId, setDishId] = useState(null);
  const [onboardingSeen, setOnboardingSeen] = useState(() => {
    try {
      return localStorage.getItem(ONBOARDING_KEY) === '1';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    initTelegram();
  }, []);

  useEffect(() => {
    if (!data) return;
    const startDish = readStartDish();
    if (startDish) {
      setDishId(startDish);
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [data]);

  const finishOnboarding = () => {
    try {
      localStorage.setItem(ONBOARDING_KEY, '1');
    } catch {
      // приватный режим — просто не запомним
    }
    setOnboardingSeen(true);
  };

  if (error) {
    return (
      <div className="center-screen">
        <p>{t('common.somethingWrong')}</p>
        <button className="btn btn-primary" onClick={reload}>
          {t('common.retry')}
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="center-screen">
        <div className="spinner" />
        <p>{t('common.loading')}</p>
      </div>
    );
  }

  if (!onboardingSeen) return <Onboarding onFinish={finishOnboarding} />;

  return (
    <div className="app">
      {tab === 'home' && <Home onOpenDish={setDishId} onNavigate={setTab} />}
      {tab === 'catalog' && <Catalog onOpenDish={setDishId} />}
      {tab === 'cart' && <Cart onOpenDish={setDishId} onNavigate={setTab} />}
      {tab === 'profile' && <Profile />}
      <BottomNav active={tab} onChange={setTab} />
      {dishId && <ProductSheet productId={dishId} onClose={() => setDishId(null)} />}
      <Toast />
    </div>
  );
}

function Toast() {
  const { toast } = useApp();
  if (!toast) return null;
  return <div className="toast">{toast.message}</div>;
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
