import { useEffect, useState } from 'react';
import { useApp } from '../store.jsx';
import { api } from '../api.js';
import { haptic, useMainButton } from '../telegram.js';

export default function ProductSheet({ productId, onClose }) {
  const { data, t, updateCart, showToast, showApiError } = useApp();
  const product = data.categories.flatMap((category) => category.products).find((item) => item.id === productId);
  const [saving, setSaving] = useState(false);

  // Закрытие по системной кнопке «назад» (жест/аппаратная кнопка Android)
  useEffect(() => {
    window.history.pushState({ sheet: true }, '');
    const onPop = () => onClose();
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (window.history.state?.sheet) window.history.back();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const quantity = data.cart.lines.find((line) => line.productId === productId)?.quantity ?? 0;

  const changeQuantity = async (next) => {
    if (saving) return;
    setSaving(true);
    haptic('medium');
    try {
      updateCart(await api.setCartItem(productId, next));
    } catch (err) {
      showApiError(err);
    } finally {
      setSaving(false);
    }
  };

  const addAndClose = async () => {
    await changeQuantity(1);
    showToast(t('product.add') + ' ✅');
    onClose();
  };

  useMainButton({
    text: t('product.addFor', { price: product?.priceText }),
    onClick: addAndClose,
    visible: Boolean(product?.inStock) && quantity === 0,
    disabled: saving,
    loading: saving,
  });

  if (!product) return null;

  return (
    <>
      <div className="sheet-overlay" onClick={onClose} />
      <div className="sheet">
        {product.photo && <div className="sheet-photo" style={{ backgroundImage: `url(${product.photo})` }} />}
        <button className="icon-btn sheet-close" onClick={onClose} aria-label={t('common.close')}>
          ✕
        </button>
        <div className="sheet-body">
          <h2>{product.name}</h2>
          {(product.badges.length > 0 || product.spicy > 0) && (
            <div className="sheet-tags">
              {product.badges.map((badge) => (
                <span key={badge} className="tag">
                  {t(`badges.${badge}`) || badge}
                </span>
              ))}
              {product.spicy > 0 && (
                <span className="tag">
                  {'🌶'.repeat(product.spicy)} {t('product.spicy')[product.spicy]}
                </span>
              )}
            </div>
          )}
          {product.description && <p className="sheet-description">{product.description}</p>}
          {product.weight && <div className="sheet-weight">⚖️ {product.weight}</div>}
          <div className="sheet-price">
            {product.oldPriceText && <span className="old">{product.oldPriceText}</span>}
            <span>{product.priceText}</span>
          </div>
        </div>
        {!product.inStock && (
          <div className="sheet-footer">
            <div className="banner banner-warning">{t('product.soldOut')}</div>
          </div>
        )}
        {product.inStock && quantity > 0 && (
          <div className="sheet-footer">
            <div className="stepper">
              <button onClick={() => changeQuantity(quantity - 1)} disabled={saving} aria-label="-">
                −
              </button>
              <span className="value">{quantity}</span>
              <button onClick={() => changeQuantity(quantity + 1)} disabled={saving} aria-label="+">
                +
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
