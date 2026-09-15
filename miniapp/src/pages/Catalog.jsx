import { useState } from 'react';
import { useApp } from '../store.jsx';
import ProductCard from '../components/ProductCard.jsx';

export default function Catalog({ onOpenDish }) {
  const { data, t } = useApp();
  const { categories } = data;
  const [selectedId, setSelectedId] = useState(categories[0]?.id);
  const category = categories.find((item) => item.id === selectedId) ?? categories[0];

  return (
    <div className="page">
      <div className="page-title">{t('catalog.title')}</div>

      <div className="category-scroll">
        {categories.map((item) => (
          <button
            key={item.id}
            className={`category-chip${item.id === category?.id ? ' active' : ''}`}
            onClick={() => setSelectedId(item.id)}
          >
            {item.name}
          </button>
        ))}
      </div>

      <div className="product-grid" style={{ marginTop: 14 }}>
        {category?.products.length ? (
          category.products.map((product) => <ProductCard key={product.id} product={product} onOpen={onOpenDish} />)
        ) : (
          <p style={{ gridColumn: '1 / -1', color: 'var(--text-secondary)' }}>{t('catalog.empty')}</p>
        )}
      </div>
    </div>
  );
}
