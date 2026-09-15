import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../generated/prisma/client.ts';
import config from '../config/default.js';
import { appDatabaseUrl } from './url.js';
import { log } from '../utils/logger.js';

const adapter = new PrismaPg(
  {
    connectionString: config.databaseUrl ? appDatabaseUrl(config.databaseUrl) : undefined,
    max: 10,
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: 20_000,
    keepAlive: true,
  },
  {
    onPoolError: (error) => log.warn('База данных: соединение закрыто —', error.message),
    onConnectionError: (error) => log.warn('База данных: ошибка соединения —', error.message),
  },
);

export const prisma = new PrismaClient({ adapter });
export { Prisma };

// Проверяет подключение и что таблицы созданы (npm run setup)
export async function checkDatabase() {
  try {
    await prisma.setting.findFirst();
  } catch (error) {
    if (error?.code === 'P2021' || /does not exist/i.test(error?.message ?? '')) {
      throw new Error('Таблицы в базе данных ещё не созданы. Выполните команду: npm run setup');
    }
    throw new Error(`Не удалось подключиться к базе данных: ${error?.message ?? error}\nПроверьте DATABASE_URL в файле .env и интернет.`);
  }
}
