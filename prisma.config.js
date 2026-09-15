import { defineConfig } from 'prisma/config';
import { migrationDatabaseUrl } from './src/database/url.js';

try {
  process.loadEnvFile();
} catch {
  // .env может отсутствовать, если переменные заданы в окружении
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node prisma/seed.js',
  },
  datasource: {
    url: migrationDatabaseUrl(process.env.DATABASE_URL),
  },
});
