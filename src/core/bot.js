import { Bot } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import { sequentialize } from '@grammyjs/runner';
import config from '../config/default.js';
import { restaurant } from './restaurant.js';
import { t } from './i18n.js';
import { loadUser, trackBotBlocked } from '../middlewares/user.middleware.js';
import { registerAdminRoutes } from '../routes/admin.routes.js';
import { registerClientRoutes } from '../routes/client.routes.js';
import { log } from '../utils/logger.js';

export function createBot(token = config.botToken, options) {
  const bot = new Bot(token, options);

  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 30 }));

  // Сообщения одного чата обрабатываются по очереди, разных чатов — параллельно
  bot.use(
    sequentialize((ctx) => {
      const id = ctx.chat?.id ?? ctx.from?.id;
      return id === undefined ? undefined : String(id);
    }),
  );
  bot.use(loadUser);
  bot.on('my_chat_member', trackBotBlocked);

  registerAdminRoutes(bot);
  registerClientRoutes(bot);

  bot.catch(async ({ ctx, error }) => {
    log.error(`Ошибка при обработке сообщения (пользователь ${ctx.from?.id ?? '—'}):`, error);
    const lang = ctx.lang ?? restaurant.defaultLanguage;
    try {
      if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery({ text: t(lang, 'common.error'), show_alert: true });
      } else if (ctx.chat?.type === 'private') {
        await ctx.reply(t(lang, 'common.error'));
      }
    } catch {
      // Сообщить об ошибке не удалось — например, пользователь заблокировал бота
    }
  });

  return bot;
}
