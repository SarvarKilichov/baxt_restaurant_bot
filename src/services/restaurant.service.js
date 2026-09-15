import config from '../config/default.js';
import { applyRestaurantData, loadRestaurantData, restaurant, loc } from '../core/restaurant.js';
import { t } from '../core/i18n.js';
import { getAllProducts, getCategories, loadCatalog, syncMenu } from '../models/Product.js';
import { truncate } from '../utils/format.js';
import { describeError } from '../utils/telegram.js';
import { log } from '../utils/logger.js';

// Читает файлы ресторана, переносит меню в базу и обновляет данные в памяти
export async function loadRestaurant() {
  const bundle = loadRestaurantData();
  applyRestaurantData(bundle);
  for (const warning of bundle.warnings) log.warn(warning);
  const result = await syncMenu(bundle.menu);
  await loadCatalog();
  return {
    ...result,
    categories: getCategories().length,
    products: getAllProducts().length,
    warnings: bundle.warnings,
  };
}

const CLIENT_COMMANDS = ['start'];
const ADMIN_COMMANDS = [...CLIENT_COMMANDS, 'admin', 'id'];

const commandList = (lang, names) => names.map((command) => ({ command, description: t(lang, `commands.${command}`) }));

async function syncDescription(api, lang, languageCode) {
  const { description, tagline } = restaurant.data;
  const other = languageCode ? { language_code: languageCode } : {};
  const wantedDescription = truncate(loc(description, lang), 512);
  const wantedShort = truncate(loc(tagline, lang), 120);

  const current = await api.getMyDescription(other);
  if (current.description !== wantedDescription) await api.setMyDescription(wantedDescription, other);
  const currentShort = await api.getMyShortDescription(other);
  if (currentShort.short_description !== wantedShort) await api.setMyShortDescription(wantedShort, other);
}

// Команды в меню Telegram, описание бота и кнопка открытия Mini App — из данных ресторана
export async function setupBotProfile(api, miniAppUrl = null) {
  const { languages, defaultLanguage } = restaurant;
  const menuButton = miniAppUrl
    ? { type: 'web_app', text: truncate(t(defaultLanguage, 'buttons.menu'), 64), web_app: { url: miniAppUrl } }
    : { type: 'default' };

  const tasks = [
    api.setMyCommands(commandList(defaultLanguage, CLIENT_COMMANDS)),
    syncDescription(api, defaultLanguage),
    api.setChatMenuButton({ menu_button: menuButton }),
    ...languages.map((lang) => api.setMyCommands(commandList(lang, CLIENT_COMMANDS), { language_code: lang })),
    ...languages.map((lang) => syncDescription(api, lang, lang)),
  ];
  const staffChats = [...config.adminIds, ...(config.ordersChatId ? [config.ordersChatId] : [])];
  for (const chatId of staffChats) {
    tasks.push(api.setMyCommands(commandList(defaultLanguage, ADMIN_COMMANDS), { scope: { type: 'chat', chat_id: chatId } }));
  }

  const results = await Promise.allSettled(tasks);
  for (const result of results) {
    if (result.status === 'rejected') log.debug('Профиль бота обновлён не полностью:', describeError(result.reason));
  }
}
