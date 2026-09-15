import { useEffect, useState } from 'react';
import { useApp } from '../store.jsx';
import { api, ApiError } from '../api.js';
import { haptic, hapticNotify, openLink } from '../telegram.js';

const STATUS_COLORS = {
  NEW: '#ffe8b8',
  ACCEPTED: '#d6ecff',
  COOKING: '#d6ecff',
  DELIVERING: '#d6ecff',
  READY: '#d9f5df',
  COMPLETED: '#d9f5df',
  CANCELLED: '#f3d6d6',
};

function OrderCard({ order, onChanged }) {
  const { t, lang, showApiError, showToast } = useApp();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);

  const repeat = async () => {
    setBusy(true);
    haptic('medium');
    try {
      const result = await api.repeatOrder(order.id);
      onChanged(result.cart);
      showToast(result.skipped.length ? t('profile.repeatSkipped', { items: result.skipped.join(', ') }) : t('profile.repeated'));
    } catch (err) {
      showApiError(err);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      const updated = await api.cancelOrder(order.id);
      hapticNotify('success');
      showToast(t('profile.cancelled'));
      onChanged(null, updated);
    } catch (err) {
      const message = err instanceof ApiError ? err.message || t(`errors.${err.code}`) : null;
      if (message) showToast(message, 'error');
      else showApiError(err);
    } finally {
      setBusy(false);
      setConfirmCancel(false);
    }
  };

  return (
    <div className="order-card">
      <div className="order-card-top">
        <span className="order-id">№{order.id}</span>
        <span className="order-date">
          {new Date(order.createdAt).toLocaleString(lang === 'uz' ? 'uz-UZ' : 'ru-RU', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>
      <span className="status-pill" style={{ background: STATUS_COLORS[order.status] }}>
        {order.statusText}
      </span>
      <div className="order-items" style={{ marginTop: 8 }}>
        {order.items.map((item) => `${item.name} × ${item.quantity}`).join(', ')}
      </div>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>{order.totalText}</div>
      {confirmCancel ? (
        <div>
          <p style={{ fontSize: 13, marginBottom: 8 }}>{t('profile.cancelConfirmTitle', { id: order.id })}</p>
          <div className="order-actions">
            <button className="btn btn-danger" disabled={busy} onClick={cancel}>
              {t('profile.cancelConfirmYes')}
            </button>
            <button className="btn btn-secondary" disabled={busy} onClick={() => setConfirmCancel(false)}>
              {t('profile.cancelConfirmNo')}
            </button>
          </div>
        </div>
      ) : (
        <div className="order-actions">
          <button className="btn btn-secondary" disabled={busy} onClick={repeat}>
            🔁 {t('profile.repeat')}
          </button>
          {order.canCancel && (
            <button className="btn btn-outline" disabled={busy} onClick={() => setConfirmCancel(true)}>
              {t('profile.cancel')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function Profile() {
  const { data, lang, t, setLanguage, updateCart, showApiError } = useApp();
  const [orders, setOrders] = useState(null);

  useEffect(() => {
    api
      .getOrders()
      .then(setOrders)
      .catch(() => setOrders([]));
    // Перезапрашиваем при смене языка: карточки заказов приходят уже переведёнными с сервера
  }, [lang]);

  const handleOrderChange = (cart, updatedOrder) => {
    if (cart) updateCart(cart);
    if (updatedOrder) setOrders((prev) => prev.map((order) => (order.id === updatedOrder.id ? updatedOrder : order)));
  };

  const changeLanguage = async (nextLang) => {
    if (nextLang === lang) return;
    haptic('light');
    try {
      await setLanguage(nextLang);
    } catch (err) {
      showApiError(err);
    }
  };

  const { restaurant, hours, delivery, pickup, languages } = data;

  return (
    <div className="page">
      <div className="page-title">{t('profile.title')}</div>

      <div className="profile-card">
        <div className="profile-row">
          <span className="label">{t('profile.nameLabel')}</span>
          <span>{data.user.name || t('profile.notSet')}</span>
        </div>
        <div className="profile-row">
          <span className="label">{t('profile.phoneLabel')}</span>
          <span>{data.user.phone || t('profile.notSet')}</span>
        </div>
        {languages.length > 1 && (
          <>
            <div className="profile-row" style={{ paddingBottom: 0 }}>
              <span className="label">{t('profile.language')}</span>
            </div>
            <div className="lang-switch">
              {languages.map((code) => (
                <button key={code} className={code === lang ? 'active' : ''} onClick={() => changeLanguage(code)}>
                  {code.toUpperCase()}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="section-title">
        <h2>{t('profile.ordersTitle')}</h2>
      </div>
      {orders == null && <p style={{ color: 'var(--text-secondary)' }}>{t('common.loading')}</p>}
      {orders?.length === 0 && (
        <div className="center-screen" style={{ minHeight: 120, padding: 0 }}>
          <p style={{ color: 'var(--text-secondary)', margin: 0 }}>{t('profile.ordersEmptyText')}</p>
        </div>
      )}
      {orders?.map((order) => (
        <OrderCard key={order.id} order={order} onChanged={handleOrderChange} />
      ))}

      <div className="section-title">
        <h2>{t('profile.aboutTitle')}</h2>
      </div>
      <div className="about-list">
        {restaurant.address && (
          <div className="about-item">
            <span className="icon">📍</span>
            <div>
              <div className="label">{t('profile.addressLabel')}</div>
              <div className="value">{restaurant.address}</div>
            </div>
          </div>
        )}
        <div className="about-item">
          <span className="icon">🕒</span>
          <div>
            <div className="label">{t('profile.hoursLabel')}</div>
            <div className="value">
              {hours.lines.join(' · ')}
              <br />
              {hours.open
                ? hours.closesAt
                  ? t('profile.openNow', { time: hours.closesAt })
                  : t('profile.openAllDay')
                : t('profile.closedNow', { when: hours.openingText })}
            </div>
          </div>
        </div>
        {delivery.enabled && (
          <div className="about-item">
            <span className="icon">🚚</span>
            <div>
              <div className="label">{t('profile.deliveryLabel')}</div>
              <div className="value">
                {[delivery.area, delivery.time].filter(Boolean).join(', ')}
                {delivery.priceText && <> · {t('profile.deliveryPrice', { price: delivery.priceText })}</>}
              </div>
            </div>
          </div>
        )}
        {pickup.enabled && pickup.time && (
          <div className="about-item">
            <span className="icon">🏃</span>
            <div>
              <div className="label">{t('profile.pickupLabel')}</div>
              <div className="value">{pickup.time}</div>
            </div>
          </div>
        )}
        {restaurant.paymentMethods.length > 0 && (
          <div className="about-item">
            <span className="icon">💳</span>
            <div>
              <div className="label">{t('profile.paymentLabel')}</div>
              <div className="value">{restaurant.paymentMethods.join(', ')}</div>
            </div>
          </div>
        )}
        {restaurant.phone && (
          <div className="about-item">
            <span className="icon">📞</span>
            <div>
              <div className="label">{t('common.call')}</div>
              <a className="btn-text" style={{ padding: 0, display: 'inline-block' }} href={`tel:${restaurant.phone}`}>
                {restaurant.phone}
              </a>
            </div>
          </div>
        )}
      </div>
      {restaurant.location && (
        <button
          className="btn btn-outline btn-block"
          style={{ marginTop: 14 }}
          onClick={() => openLink(`https://maps.google.com/?q=${restaurant.location.latitude},${restaurant.location.longitude}`)}
        >
          📍 {t('profile.map')}
        </button>
      )}
    </div>
  );
}
