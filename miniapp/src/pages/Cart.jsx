import { useState } from 'react';
import { useApp } from '../store.jsx';
import { api, ApiError } from '../api.js';
import { haptic, hapticNotify, useBackButton, useMainButton } from '../telegram.js';

const FIELD_BY_CODE = {
  INVALID_NAME: 'name',
  INVALID_PHONE: 'phone',
  INVALID_ADDRESS: 'address',
  INVALID_PAYMENT: 'payment',
  BAD_METHOD: 'method',
};

function CartList({ onOpenDish, onCheckout }) {
  const { data, t, updateCart, showApiError } = useApp();
  const { cart, upsell } = data;
  const showUpsell = upsell && !cart.lines.some((line) => line.productId === upsell.id);

  useMainButton({ text: t('cart.checkout'), onClick: onCheckout, visible: cart.lines.some((line) => line.inStock) });

  const changeQuantity = async (productId, quantity) => {
    haptic('light');
    try {
      updateCart(await api.setCartItem(productId, quantity));
    } catch (err) {
      showApiError(err);
    }
  };

  const clearCart = async () => {
    if (!window.confirm(t('cart.clearConfirm'))) return;
    try {
      updateCart(await api.clearCart());
    } catch (err) {
      showApiError(err);
    }
  };

  if (!cart.lines.length) {
    return (
      <div className="page">
        <div className="center-screen" style={{ minHeight: '70vh' }}>
          <div style={{ fontSize: 48 }}>🛒</div>
          <h2 style={{ margin: 0 }}>{t('cart.empty')}</h2>
          <p style={{ color: 'var(--text-secondary)', margin: 0 }}>{t('cart.emptyText')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-title">{t('cart.title')}</div>

      {cart.hasUnavailable && <div className="banner banner-warning">{t('cart.unavailableNotice')}</div>}

      <div>
        {cart.lines.map((line) => (
          <div key={line.productId} className={`cart-line${line.inStock ? '' : ' unavailable'}`}>
            <div
              className="cart-line-photo"
              style={line.product.photo ? { backgroundImage: `url(${line.product.photo})` } : undefined}
              onClick={() => onOpenDish(line.productId)}
            />
            <div className="cart-line-info">
              <div className="cart-line-name" onClick={() => onOpenDish(line.productId)}>
                {line.product.name}
              </div>
              {line.inStock ? (
                <div className="cart-line-controls">
                  <div className="stepper-mini">
                    <button onClick={() => changeQuantity(line.productId, line.quantity - 1)} aria-label="-">
                      −
                    </button>
                    <span className="value">{line.quantity}</span>
                    <button onClick={() => changeQuantity(line.productId, line.quantity + 1)} aria-label="+">
                      +
                    </button>
                  </div>
                  <b>{line.totalText}</b>
                </div>
              ) : (
                <div className="cart-line-price" style={{ color: 'var(--danger)' }}>
                  {t('catalog.outOfStock')}
                </div>
              )}
            </div>
            <button className="remove-btn" onClick={() => changeQuantity(line.productId, 0)} aria-label="remove">
              🗑
            </button>
          </div>
        ))}
      </div>

      {showUpsell && (
        <div className="upsell-card">
          {upsell.photo && <img src={upsell.photo} alt="" />}
          <div className="upsell-card-text">{t('cart.upsellQuestion', { name: upsell.name, price: upsell.priceText })}</div>
          <button className="btn btn-secondary" style={{ padding: '8px 12px', fontSize: 13 }} onClick={() => changeQuantity(upsell.id, 1)}>
            {t('cart.upsellAdd')}
          </button>
        </div>
      )}

      <button className="btn-text" onClick={clearCart} style={{ marginTop: 4 }}>
        🧹 {t('cart.clear')}
      </button>

      <div style={{ marginTop: 10 }}>
        <div className="summary-row">
          <span>{t('cart.itemsTotal')}</span>
          <span>{cart.itemsTotalText}</span>
        </div>
        {data.delivery.enabled && (
          <div className="summary-row">
            <span>{t('cart.delivery')}</span>
            <span>
              {data.delivery.price === 0
                ? t('cart.deliveryFree')
                : data.delivery.freeFromText
                  ? t('cart.deliveryFreeFrom', { amount: data.delivery.freeFromText })
                  : data.delivery.priceText}
            </span>
          </div>
        )}
      </div>

      {data.delivery.enabled && data.delivery.minOrderText && cart.itemsTotal < data.delivery.minOrder && (
        <div className="banner banner-warning">{t('cart.minOrderWarning', { amount: data.delivery.minOrderText })}</div>
      )}

      <div style={{ height: 90 }} />
    </div>
  );
}

function CheckoutForm({ onBack, onSuccess }) {
  const { data, t, showApiError } = useApp();
  const { restaurant, delivery, pickup, cart } = data;
  const bothMethods = delivery.enabled && pickup.enabled;

  const [method, setMethod] = useState(delivery.enabled ? 'DELIVERY' : 'PICKUP');
  const [name, setName] = useState(data.user.name ?? '');
  const [phone, setPhone] = useState(data.user.phone ?? '');
  const [address, setAddress] = useState(data.user.address ?? '');
  const [location, setLocation] = useState(null);
  const [comment, setComment] = useState('');
  const [paymentIndex, setPaymentIndex] = useState(restaurant.paymentMethods.length === 1 ? 0 : null);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  useBackButton(onBack);

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    haptic('light');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        hapticNotify('success');
      },
      () => hapticNotify('error'),
      { timeout: 8000 },
    );
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setErrors({});
    try {
      const result = await api.checkout({
        method,
        name: name.trim(),
        phone: phone.trim(),
        address: address.trim(),
        latitude: location?.latitude,
        longitude: location?.longitude,
        comment: comment.trim(),
        paymentIndex,
      });
      hapticNotify('success');
      onSuccess(result);
    } catch (err) {
      hapticNotify('error');
      const field = err instanceof ApiError ? FIELD_BY_CODE[err.code] : null;
      if (field) setErrors({ [field]: err.message || t(`errors.${err.code}`) });
      else showApiError(err);
    } finally {
      setSubmitting(false);
    }
  };

  useMainButton({ text: t('checkout.submit'), onClick: submit, disabled: submitting, loading: submitting });

  return (
    <div className="page">
      <div className="page-title">{t('checkout.title')}</div>
      {errors.method && <div className="banner banner-error">{errors.method}</div>}

      {bothMethods && (
        <div className="field">
          <label>{t('checkout.methodTitle')}</label>
          <div className="segmented">
            <button className={method === 'DELIVERY' ? 'active' : ''} onClick={() => setMethod('DELIVERY')}>
              {t('checkout.delivery')}
            </button>
            <button className={method === 'PICKUP' ? 'active' : ''} onClick={() => setMethod('PICKUP')}>
              {t('checkout.pickup')}
            </button>
          </div>
        </div>
      )}

      <div className="field">
        <label>{t('checkout.nameLabel')}</label>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('checkout.namePlaceholder')} />
        {errors.name && <div className="field-error">{errors.name}</div>}
      </div>

      <div className="field">
        <label>{t('checkout.phoneLabel')}</label>
        <input
          type="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder={t('checkout.phonePlaceholder')}
        />
        {errors.phone && <div className="field-error">{errors.phone}</div>}
      </div>

      {method === 'DELIVERY' ? (
        <div className="field">
          <label>{t('checkout.addressLabel')}</label>
          <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder={t('checkout.addressPlaceholder')} />
          <button type="button" className="location-btn" onClick={useMyLocation}>
            📍 {t('checkout.useLocation')}
          </button>
          {location && <div style={{ fontSize: 12.5, color: 'var(--success)' }}>✓ {t('checkout.locationSet')}</div>}
          {errors.address && <div className="field-error">{errors.address}</div>}
        </div>
      ) : (
        restaurant.address && <div className="banner">{t('checkout.pickupAddressNotice', { address: restaurant.address })}</div>
      )}

      <div className="field">
        <label>{t('checkout.commentLabel')}</label>
        <textarea rows={2} value={comment} onChange={(event) => setComment(event.target.value)} placeholder={t('checkout.commentPlaceholder')} />
      </div>

      {restaurant.paymentMethods.length > 1 && (
        <div className="field">
          <label>{t('checkout.paymentLabel')}</label>
          <div className="option-list">
            {restaurant.paymentMethods.map((label, index) => (
              <label key={label} className={`option-row${paymentIndex === index ? ' active' : ''}`}>
                <input type="radio" checked={paymentIndex === index} onChange={() => setPaymentIndex(index)} />
                {label}
              </label>
            ))}
          </div>
          {errors.payment && <div className="field-error">{errors.payment}</div>}
        </div>
      )}

      <div className="summary-row total">
        <span>{t('cart.total')}</span>
        <span>{cart.itemsTotalText}</span>
      </div>

      <div style={{ height: 90 }} />
    </div>
  );
}

function SuccessScreen({ order, onDone }) {
  const { t } = useApp();
  useMainButton({ text: t('checkout.backToHome'), onClick: onDone });

  return (
    <div className="page success-screen">
      <div className="success-emoji">🎉</div>
      <h2>{t('checkout.successTitle', { id: order.orderId })}</h2>
      <p>{t('checkout.successBody', { total: order.totalText })}</p>
      {order.eta && <p>{order.eta}</p>}
      <p>{t('checkout.successHint')}</p>
    </div>
  );
}

export default function Cart({ onOpenDish, onNavigate }) {
  const { data, reload, t } = useApp();
  const [view, setView] = useState('cart');
  const [order, setOrder] = useState(null);

  const goCheckout = () => setView('checkout');

  const handleSuccess = (result) => {
    setOrder(result);
    setView('success');
    reload();
  };

  const finish = () => {
    setView('cart');
    setOrder(null);
    onNavigate('home');
  };

  useBackButton(view === 'checkout' && !data.ordering.allowed ? () => setView('cart') : null);

  if (view === 'checkout') {
    if (!data.ordering.allowed) {
      return (
        <div className="page">
          <div className="center-screen">
            <h2>{t('checkout.closedTitle')}</h2>
            <p style={{ color: 'var(--text-secondary)' }}>{data.ordering.message}</p>
            <button className="btn btn-secondary" onClick={() => setView('cart')}>
              {t('common.close')}
            </button>
          </div>
        </div>
      );
    }
    return <CheckoutForm onBack={() => setView('cart')} onSuccess={handleSuccess} />;
  }

  if (view === 'success' && order) return <SuccessScreen order={order} onDone={finish} />;

  return <CartList onOpenDish={onOpenDish} onCheckout={goCheckout} />;
}
