// Проверяет файлы из папки restaurant без запуска бота (запуск: npm run check)
import { loadRestaurantData, RestaurantDataError } from '../src/core/restaurant.js';

try {
  const { menu, warnings } = loadRestaurantData();
  const products = menu.categories.reduce((sum, category) => sum + category.items.length, 0);
  for (const warning of warnings) console.warn(`⚠️  ${warning}`);
  console.log(`✅ Ошибок нет — категорий: ${menu.categories.length}, блюд: ${products}`);
} catch (error) {
  if (!(error instanceof RestaurantDataError)) throw error;
  console.error(`❌ ${error.message}`);
  process.exitCode = 1;
}
