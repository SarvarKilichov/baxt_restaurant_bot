import { useApp } from '../store.jsx';
import { api } from '../api.js';
import { haptic } from '../telegram.js';

export default function ProductCard({ product, onOpen }) {
  const { data, t, updateCart, showApiError } = useApp();
  const inCart = data.cart.lines.find((line) => line.productId === product.id)?.quantity ?? 0;

  const quickAdd = async (event) => {
    event.stopPropagation();
    if (!product.inStock) return;
    haptic('medium');
    try {
      updateCart(await api.setCartItem(product.id, inCart + 1));
    } catch (err) {
      showApiError(err);
    }
  };

  return (
    <button className={`product-card${product.inStock ? '' : ' disabled'}`} onClick={() => onOpen(product.id)}>
      <div className="product-photo" style={product.photo ? { backgroundImage: `url(${product.photo})` } : undefined}>
        {product.badges[0] && <span className="badge">{t(`badges.${product.badges[0]}`) || product.badges[0]}</span>}
        {!product.inStock && <div className="sold-out-tag">{t('catalog.outOfStock')}</div>}
        {product.inStock && (
          <button className="product-add" onClick={quickAdd} aria-label={t('product.add')}>
            {inCart > 0 ? inCart : '+'}
          </button>
        )}
      </div>
      <div className="product-info">
        <div className="product-name">{product.name}</div>
        <div className="product-price">
          {product.oldPriceText && <span className="old">{product.oldPriceText}</span>}
          <span>{product.priceText}</span>
        </div>
      </div>
    </button>
  );
}
