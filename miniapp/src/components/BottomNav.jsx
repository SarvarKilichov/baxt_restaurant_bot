import { useApp } from '../store.jsx';
import { haptic } from '../telegram.js';

const TABS = [
  { key: 'home', icon: '🏠' },
  { key: 'catalog', icon: '🔍' },
  { key: 'cart', icon: '🛒' },
  { key: 'profile', icon: '👤' },
];

export default function BottomNav({ active, onChange }) {
  const { data, t } = useApp();
  const cartCount = data?.cart?.count ?? 0;

  return (
    <nav className="bottom-nav">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          className={tab.key === active ? 'active' : ''}
          onClick={() => {
            haptic('light');
            onChange(tab.key);
          }}
        >
          <span className="nav-icon">{tab.icon}</span>
          {t(`nav.${tab.key}`)}
          {tab.key === 'cart' && cartCount > 0 && <span className="nav-badge">{cartCount}</span>}
        </button>
      ))}
    </nav>
  );
}
