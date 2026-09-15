import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

try {
  process.loadEnvFile(path.join(rootDir, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

function idList(value) {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map(Number)
    .filter(Number.isSafeInteger);
}

const env = process.env;
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
const effort = env.AI_EFFORT?.trim().toLowerCase();

const config = {
  rootDir,
  restaurantDir: path.join(rootDir, 'restaurant'),
  botToken: env.BOT_TOKEN?.trim(),
  adminIds: idList(env.ADMIN_IDS),
  ordersChatId: idList(env.ORDERS_CHAT_ID)[0] ?? null,
  databaseUrl: env.DATABASE_URL?.trim(),
  webapp: {
    port: Number(env.WEBAPP_PORT) || 3001,
    // Готовый публичный адрес Mini App, если он уже есть (например, свой домен)
    url: env.MINI_APP_URL?.trim().replace(/\/$/, '') || null,
    ngrokAuthtoken: env.NGROK_AUTHTOKEN?.trim() || null,
    ngrokDomain: env.NGROK_DOMAIN?.trim() || null,
  },
  ai: {
    apiKey: env.ANTHROPIC_API_KEY?.trim() || null,
    model: env.AI_MODEL?.trim() || 'claude-opus-5',
    effort: EFFORT_LEVELS.includes(effort) ? effort : effort === '' ? null : 'low',
    questionsPerHour: Number(env.AI_QUESTIONS_PER_HOUR) || 20,
  },
};

export function assertConfig() {
  const missing = [];
  if (!config.botToken) missing.push('BOT_TOKEN — токен бота от @BotFather');
  if (!config.databaseUrl) missing.push('DATABASE_URL — строка подключения к базе данных');
  if (missing.length) {
    throw new Error(`В файле .env не заполнено:\n  • ${missing.join('\n  • ')}`);
  }
}

export default config;
