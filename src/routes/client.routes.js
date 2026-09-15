import { t } from '../core/i18n.js';
import { askLanguage, setLanguage, start } from '../controllers/start.controller.js';
import { answerQuestion, askExampleQuestion, showAskIntro } from '../controllers/ai.controller.js';
import { answer } from '../utils/telegram.js';

// Свободный текст вне команд — это вопрос AI-помощнику (меню, корзина и заказ теперь в Mini App)
async function onText(ctx) {
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return ctx.reply(t(ctx.lang, 'common.unknownCommand'));
  return answerQuestion(ctx, text);
}

async function onOtherMessage(ctx) {
  return ctx.reply(t(ctx.lang, 'common.useText'));
}

export function registerClientRoutes(bot) {
  const chat = bot.chatType('private');

  chat.command('start', start);
  chat.command('ask', showAskIntro);
  chat.command('language', askLanguage);

  chat.callbackQuery(/^lang:([a-z]{2,3})$/, setLanguage);
  chat.callbackQuery(/^ask:(\d+)$/, askExampleQuestion);

  chat.on('message:text', onText);
  chat.on('message', onOtherMessage);

  // Устаревшие или неизвестные кнопки — просто убираем «часики»
  bot.on('callback_query', (ctx) => answer(ctx));
}
