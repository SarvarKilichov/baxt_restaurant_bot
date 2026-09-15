import { useApp } from '../store.jsx';
import ProductCard from '../components/ProductCard.jsx';

export default function Home({ onOpenDish, onNavigate }) {
  const { data, t } = useApp();
  const { restaurant, hours, ordering, categories, user } = data;
  const hitProducts = categories.flatMap((category) => category.products).filter((product) => product.badges.includes('hit') && product.inStock).slice(0, 4);

  return (
    <div className="page">
      <div className="page-title">{t('home.greeting', { name: user.firstName ?? user.name ?? '' })}</div>

      {!hours.open && (
        <div className="banner banner-warning">🕒 {t('home.closedBanner', { when: hours.openingText })}</div>
      )}
      {hours.open && !ordering.allowed && <div className="banner banner-warning">⏸ {t('home.pausedBanner')}</div>}

      <div className="hero">
        <h2>{t('home.heroTitle')}</h2>
        <p>{t('home.heroSubtitle')}</p>
        <button className="btn" onClick={() => onNavigate('catalog')}>
          {t('home.heroButton')}
        </button>
      </div>

      <div className="section-title">
        <h2>{t('home.categoriesTitle')}</h2>
        <button className="btn-text" onClick={() => onNavigate('catalog')}>
          {t('home.seeAll')}
        </button>
      </div>
      <div className="category-scroll">
        {categories.map((category) => (
          <button key={category.id} className="category-chip" onClick={() => onNavigate('catalog')}>
            {category.name}
          </button>
        ))}
      </div>

      {hitProducts.length > 0 && (
        <>
          <div className="section-title">
            <h2>🔥 {t('home.hitsTitle')}</h2>
          </div>
          <div className="product-grid">
            {hitProducts.map((product) => (
              <ProductCard key={product.id} product={product} onOpen={onOpenDish} />
            ))}
          </div>
        </>
      )}

      {restaurant.exampleQuestions.length > 0 && (
        <div className="ask-card">
          <h3>🤖 {t('home.askTitle')}</h3>
          <p>{t('home.askText', { example: restaurant.exampleQuestions[0] })}</p>
          <p>{t('home.askHint')}</p>
        </div>
      )}
    </div>
  );
}
