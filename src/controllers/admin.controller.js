import { restaurant, loc, RestaurantDataError } from '../core/restaurant.js';
import { t } from '../core/i18n.js';
import { listUnanswered } from '../models/AiQuestion.js';
import * as Order from '../models/Order.js';
import * as Product from '../models/Product.js';
import * as User from '../models/User.js';
import { getSetting, setSetting } from '../models/Setting.js';
import { isAiEnabled } from '../services/ai.service.js';
import { startOfToday } from '../services/hours.service.js';
import { notifyCustomerStatus, refreshOrderCards } from '../services/notify.service.js';
import { loadRestaurant, setupBotProfile } from '../services/restaurant.service.js';
import {
  activeOrdersView,
  panelView,
  questionsView,
  statsView,
  stopCategoriesView,
  stopCategoryView,
} from '../views/admin.view.js';
import { adminOrderKeyboard, adminOrderText } from '../views/order.view.js';
import { escapeHtml } from '../utils/format.js';
import { answer, editOrReply, hasButtons, ignoreNotModified } from '../utils/telegram.js';
import { log } from '../utils/logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function staffName(from) {
  return from.username ? `@${escapeHtml(from.username)}` : escapeHtml([from.first_name, from.last_name].filter(Boolean).join(' '));
}

export async function showIds(ctx) {
  return ctx.reply(t(ctx.lang ?? restaurant.defaultLanguage, 'admin.ids', { userId: ctx.from.id, chatId: ctx.chat.id }), {
    parse_mode: 'HTML',
  });
}

async function buildPanel(lang) {
  return panelView(lang, {
    activeCount: await Order.countActiveOrders(),
    ordersPaused: getSetting('ordersPaused'),
    aiEnabled: isAiEnabled(),
  });
}

export async function showPanel(ctx) {
  const view = await buildPanel(ctx.lang);
  if (ctx.callbackQuery) {
    await answer(ctx);
    return editOrReply(ctx, view.text, { reply_markup: view.keyboard });
  }
  return ctx.reply(view.text, { parse_mode: 'HTML', reply_markup: view.keyboard });
}

export async function showActiveOrders(ctx) {
  const view = activeOrdersView(ctx.lang, await Order.listActiveOrders());
  await answer(ctx);
  return editOrReply(ctx, view.text, { reply_markup: view.keyboard });
}

// Отправляет карточку заказа отдельным сообщением
export async function openOrderCard(ctx) {
  const order = await Order.findOrder(Number(ctx.match[1]));
  if (!order) return answer(ctx);
  await answer(ctx);
  const lang = restaurant.defaultLanguage;
  const customer = await User.findUser(order.userId);
  const keyboard = adminOrderKeyboard(lang, order);
  const message = await ctx.reply(adminOrderText(lang, order, customer), {
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...(hasButtons(keyboard) ? { reply_markup: keyboard } : {}),
  });
  const messages = [...(order.adminMessages ?? []), { chatId: ctx.chat.id, messageId: message.message_id }].slice(-10);
  await Order.saveAdminMessages(order.id, messages);
  if (order.latitude != null && order.longitude != null) {
    await ctx.replyWithLocation(order.latitude, order.longitude).catch(() => {});
  }
}

// Возвращает обычные кнопки статусов (после «Не отменять»)
export async function restoreOrderButtons(ctx) {
  const order = await Order.findOrder(Number(ctx.match[1]));
  await answer(ctx);
  if (!order) return;
  const keyboard = adminOrderKeyboard(restaurant.defaultLanguage, order);
  await ctx.editMessageReplyMarkup(hasButtons(keyboard) ? { reply_markup: keyboard } : {}).catch(ignoreNotModified);
}

export async function changeOrderStatus(ctx) {
  const id = Number(ctx.match[1]);
  const status = ctx.match[2];
  const confirmed = Boolean(ctx.match[3]);
  if (!Order.ALLOWED_FROM[status]) return answer(ctx);

  if (status === 'CANCELLED' && !confirmed) {
    const order = await Order.findOrder(id);
    await answer(ctx);
    if (!order) return;
    const keyboard = adminOrderKeyboard(restaurant.defaultLanguage, order, { confirmCancel: true });
    return ctx.editMessageReplyMarkup({ reply_markup: keyboard }).catch(ignoreNotModified);
  }

  const order = await Order.changeStatus(id, status);
  const message = ctx.callbackQuery.message;
  const currentMessage = message ? { chatId: message.chat.id, messageId: message.message_id } : undefined;

  if (!order) {
    await answer(ctx, { text: t(ctx.lang, 'admin.statusStale'), show_alert: true });
    const current = await Order.findOrder(id);
    if (current) await refreshOrderCards(ctx.api, current, { extraMessage: currentMessage });
    return;
  }

  await answer(ctx, { text: t(ctx.lang, 'admin.statusChanged', { status: t(ctx.lang, `status.${status}`) }) });
  log.info(`Заказ №${order.id}: статус «${status}» (${ctx.from.username ? `@${ctx.from.username}` : ctx.from.id})`);
  await refreshOrderCards(ctx.api, order, { changedBy: staffName(ctx.from), extraMessage: currentMessage });

  const delivered = await notifyCustomerStatus(ctx.api, order);
  if (!delivered) await ctx.reply(t(restaurant.defaultLanguage, 'admin.customerBlocked', { id: order.id }));
}

export async function showStats(ctx) {
  const period = ctx.match[1];
  const since = period === 'today' ? startOfToday() : new Date(Date.now() - (period === 'week' ? 7 : 30) * DAY_MS);
  const view = statsView(ctx.lang, period, await Order.getStats(since));
  await answer(ctx);
  return editOrReply(ctx, view.text, { reply_markup: view.keyboard });
}

export async function showStopCategories(ctx) {
  const view = stopCategoriesView(ctx.lang);
  await answer(ctx);
  return editOrReply(ctx, view.text, { reply_markup: view.keyboard });
}

export async function showStopCategory(ctx) {
  const category = Product.getCategory(ctx.match[1]);
  if (!category) return showStopCategories(ctx);
  const view = stopCategoryView(ctx.lang, category);
  await answer(ctx);
  return editOrReply(ctx, view.text, { reply_markup: view.keyboard });
}

export async function toggleStock(ctx) {
  const product = Product.getProduct(ctx.match[1]);
  if (!product) return answer(ctx);
  const updated = await Product.setInStock(product.id, !product.inStock);
  const name = loc(updated.name, ctx.lang);
  await answer(ctx, { text: t(ctx.lang, updated.inStock ? 'admin.stopOn' : 'admin.stopOff', { name }) });
  log.info(`Стоп-лист: «${name}» — ${updated.inStock ? 'в продаже' : 'нет в наличии'}`);
  const category = Product.getCategory(updated.categoryId);
  if (category) {
    await ctx.editMessageReplyMarkup({ reply_markup: stopCategoryView(ctx.lang, category).keyboard }).catch(ignoreNotModified);
  }
}

export async function showQuestions(ctx) {
  const view = questionsView(ctx.lang, await listUnanswered(15));
  await answer(ctx);
  return editOrReply(ctx, view.text, { reply_markup: view.keyboard });
}

export async function toggleOrdersPause(ctx) {
  const paused = !getSetting('ordersPaused');
  await setSetting('ordersPaused', paused);
  await answer(ctx, { text: t(ctx.lang, paused ? 'admin.paused' : 'admin.resumed') });
  log.info(paused ? '⏸ Приём заказов остановлен' : '▶️ Приём заказов возобновлён');
  const view = await buildPanel(ctx.lang);
  return editOrReply(ctx, view.text, { reply_markup: view.keyboard });
}

export async function reloadData(ctx) {
  await answer(ctx);
  try {
    const result = await loadRestaurant();
    log.info(`🔄 Данные ресторана обновлены — категорий: ${result.categories}, блюд: ${result.products}`);
    setupBotProfile(ctx.api).catch(() => {});
    return ctx.reply(t(ctx.lang, 'admin.reloaded', { categories: result.categories, products: result.products }));
  } catch (error) {
    if (!(error instanceof RestaurantDataError)) throw error;
    const problems = error.problems.slice(0, 10).map((problem) => `• ${problem}`).join('\n');
    return ctx.reply(t(ctx.lang, 'admin.reloadFailed', { problems: escapeHtml(problems) }), { parse_mode: 'HTML' });
  }
}
