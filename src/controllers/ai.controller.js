import { InlineKeyboard } from 'grammy';
import config from '../config/default.js';
import { restaurant, loc } from '../core/restaurant.js';
import { t } from '../core/i18n.js';
import { miniApp } from '../core/miniapp.js';
import { isAdminId } from '../middlewares/auth.middleware.js';
import { saveQuestion } from '../models/AiQuestion.js';
import { getProduct } from '../models/Product.js';
import { askAi, describeAiError, isAiEnabled } from '../services/ai.service.js';
import { escapeHtml, formatMoney, truncate } from '../utils/format.js';
import { answer, hasButtons, keepTyping } from '../utils/telegram.js';
import { log } from '../utils/logger.js';

const MAX_QUESTION_LENGTH = 500;
const HISTORY_SIZE = 3;
const HISTORY_TTL_MS = 30 * 60 * 1000;
const MAX_PARALLEL_REQUESTS = 4;

const histories = new Map(); // userId → { items: [{ question, answer }], updatedAt }
const questionTimes = new Map(); // userId → время последних вопросов
let running = 0;
const queue = [];

async function withSlot(task) {
  while (running >= MAX_PARALLEL_REQUESTS) await new Promise((resolve) => queue.push(resolve));
  running += 1;
  try {
    return await task();
  } finally {
    running -= 1;
    queue.shift()?.();
  }
}

// Удаляет из памяти давно неактивных пользователей
function pruneMemory(now) {
  if (questionTimes.size > 5000) {
    for (const [userId, times] of questionTimes) {
      if (!times.length || now - times.at(-1) > 60 * 60 * 1000) questionTimes.delete(userId);
    }
  }
  if (histories.size > 5000) {
    for (const [userId, entry] of histories) {
      if (now - entry.updatedAt > HISTORY_TTL_MS) histories.delete(userId);
    }
  }
}

function isRateLimited(userId) {
  if (isAdminId(userId)) return false;
  const now = Date.now();
  pruneMemory(now);
  const recent = (questionTimes.get(userId) ?? []).filter((time) => now - time < 60 * 60 * 1000);
  if (recent.length >= config.ai.questionsPerHour) {
    questionTimes.set(userId, recent);
    return true;
  }
  recent.push(now);
  questionTimes.set(userId, recent);
  return false;
}

function getHistory(userId) {
  const entry = histories.get(userId);
  if (!entry || Date.now() - entry.updatedAt > HISTORY_TTL_MS) return [];
  return entry.items;
}

function rememberExchange(userId, question, reply) {
  const items = [...getHistory(userId), { question, answer: reply }].slice(-HISTORY_SIZE);
  histories.set(userId, { items, updatedAt: Date.now() });
}

const restaurantPhone = () => escapeHtml(restaurant.data.contacts.phone ?? '');

function disabledReply(ctx) {
  const { lang } = ctx;
  const keyboard = miniApp.url ? new InlineKeyboard().webApp(t(lang, 'buttons.openApp'), miniApp.url) : undefined;
  return ctx.reply(t(lang, 'ai.disabled', { phone: restaurantPhone() }), { parse_mode: 'HTML', reply_markup: keyboard });
}

// Ссылка на конкретное блюдо в Mini App — открывает его карточку сразу при запуске
function dishLink(productId) {
  const url = new URL(miniApp.url);
  url.searchParams.set('dish', productId);
  return url.toString();
}

export async function showAskIntro(ctx) {
  if (ctx.callbackQuery) await answer(ctx);
  if (!isAiEnabled()) return disabledReply(ctx);
  const { lang } = ctx;
  const keyboard = new InlineKeyboard();
  restaurant.data.exampleQuestions.forEach((question, index) => {
    if (index) keyboard.row();
    keyboard.text(loc(question, lang), `ask:${index}`);
  });
  return ctx.reply(t(lang, 'ai.intro'), {
    parse_mode: 'HTML',
    ...(hasButtons(keyboard) ? { reply_markup: keyboard } : {}),
  });
}

export async function askExampleQuestion(ctx) {
  const question = restaurant.data.exampleQuestions[Number(ctx.match[1])];
  await answer(ctx);
  if (question) return answerQuestion(ctx, loc(question, ctx.lang));
}

export async function answerQuestion(ctx, question) {
  const { lang } = ctx;
  const userId = ctx.from.id;

  if (!isAiEnabled()) return disabledReply(ctx);
  if (question.length > MAX_QUESTION_LENGTH) return ctx.reply(t(lang, 'ai.tooLong'));
  if (isRateLimited(userId)) return ctx.reply(t(lang, 'ai.limit', { phone: restaurantPhone() }), { parse_mode: 'HTML' });

  const stopTyping = keepTyping(ctx);
  let result;
  try {
    result = await withSlot(() => askAi({ question, lang, history: getHistory(userId) }));
  } catch (error) {
    log.error(`AI-помощник не ответил: ${describeAiError(error)}`);
    return ctx.reply(t(lang, 'ai.error', { phone: restaurantPhone() }), { parse_mode: 'HTML' });
  } finally {
    stopTyping();
  }

  if (!result.answer) {
    if (result.refused) log.warn(`AI отказался отвечать на вопрос: «${truncate(question, 100)}»`);
    return ctx.reply(t(lang, 'ai.error', { phone: restaurantPhone() }), { parse_mode: 'HTML' });
  }

  const keyboard = new InlineKeyboard();
  if (miniApp.url) {
    for (const product of result.dishIds.map(getProduct).filter(Boolean)) {
      if (hasButtons(keyboard)) keyboard.row();
      keyboard.webApp(`${loc(product.name, lang)} — ${formatMoney(product.price, lang)}`, dishLink(product.id));
    }
  }

  await ctx.reply(escapeHtml(truncate(result.answer, 3500)), {
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...(hasButtons(keyboard) ? { reply_markup: keyboard } : {}),
  });

  rememberExchange(userId, question, result.answer);
  const usage = result.usage;
  log.debug(
    `AI: вход ${usage?.input_tokens ?? 0}, из кэша ${usage?.cache_read_input_tokens ?? 0}, выход ${usage?.output_tokens ?? 0} токенов`,
  );
  saveQuestion({ userId, question, answer: result.answer, found: result.found }).catch((error) =>
    log.warn('Вопрос к AI не сохранён:', error.message),
  );
}
