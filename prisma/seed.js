// Заполняет базу меню из restaurant/menu.yaml (запуск: npm run db:seed)
import { RestaurantDataError } from '../src/core/restaurant.js';
import { prisma } from '../src/database/connection.js';
import { loadRestaurant } from '../src/services/restaurant.service.js';

try {
  const result = await loadRestaurant();
  console.log(
    `✅ Меню загружено в базу — категорий: ${result.categories}, блюд: ${result.products} ` +
      `(добавлено ${result.created}, изменено ${result.updated}, скрыто ${result.hidden})`,
  );
} catch (error) {
  console.error(error instanceof RestaurantDataError ? error.message : `❌ ${error.message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
