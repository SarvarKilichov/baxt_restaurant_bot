import config from '../config/default.js';
import { restaurant, loc } from '../core/restaurant.js';
import { t } from '../core/i18n.js';
import * as Order from '../models/Order.js';
import * as User from '../models/User.js';
import { adminOrderKeyboard, adminOrderText } from '../views/order.view.js';
import { escapeHtml } from '../utils/format.js';
import { describeError, hasButtons, isBlockedByUser, isNotModified } from '../utils/telegram.js';
import { log } from '../utils/logger.js';

// Куда отправлять заказы: в группу сотрудников или администраторам в личку
export function orderChatIds() {
  return config.ordersChatId ? [config.ordersChatId] : config.adminIds;
}

export async function notifyNewOrder(api, order) {
  const chatIds = orderChatIds();
  if (!chatIds.length) {
    log.warn(`Заказ №${order.id} не отправлен: в .env не указан ADMIN_IDS. Отправьте боту /id и впишите ID в .env`);
    return;
  }

  const lang = restaurant.defaultLanguage;
  const customer = await User.findUser(order.userId);
  const text = adminOrderText(lang, order, customer, { isNew: true });
  const keyboard = adminOrderKeyboard(lang, order);
  const messages = [];

  for (const chatId of chatIds) {
    try {
      const message = await api.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
        link_preview_options: { is_disabled: true },
      });
      messages.push({ chatId, messageId: message.message_id });
      if (order.latitude != null && order.longitude != null) {
        await api.sendLocation(chatId, order.latitude, order.longitude, {
          reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true },
        });
      }
    } catch (error) {
      log.error(
        `Заказ №${order.id} не доставлен в чат ${chatId}: ${describeError(error)}. ` +
          'Администратор должен открыть бота и нажать Start, а бот — быть участником группы.',
      );
    }
  }

  if (messages.length) {
    order.adminMessages = messages;
    await Order.saveAdminMessages(order.id, messages);
  }
}

// Обновляет карточку заказа во всех чатах администраторов
export async function refreshOrderCards(api, order, { changedBy, extraMessage } = {}) {
  const lang = restaurant.defaultLanguage;
  const customer = await User.findUser(order.userId);
  const text = adminOrderText(lang, order, customer, { changedBy });
  const keyboard = adminOrderKeyboard(lang, order);

  const targets = [...(order.adminMessages ?? [])];
  if (extraMessage && !targets.some((m) => m.chatId === extraMessage.chatId && m.messageId === extraMessage.messageId)) {
    targets.push(extraMessage);
  }

  await Promise.all(
    targets.map(({ chatId, messageId }) =>
      api
        .editMessageText(chatId, messageId, text, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          ...(hasButtons(keyboard) ? { reply_markup: keyboard } : {}),
        })
        .catch((error) => {
          if (!isNotModified(error)) log.warn(`Карточка заказа №${order.id} не обновлена: ${describeError(error)}`);
        }),
    ),
  );
}

// Сообщает клиенту о новом статусе заказа. Возвращает false, если клиент заблокировал бота
export async function notifyCustomerStatus(api, order) {
  const lang = order.language ?? restaurant.defaultLanguage;
  const { data } = restaurant;
  const text = t(lang, `notify.${order.status}`, {
    id: order.id,
    restaurant: escapeHtml(loc(data.name, lang)),
    phone: escapeHtml(data.contacts.phone ?? ''),
    address: escapeHtml(loc(data.contacts.address, lang)),
  });
  try {
    await api.sendMessage(Number(order.userId), text, { parse_mode: 'HTML' });
    return true;
  } catch (error) {
    if (isBlockedByUser(error)) {
      await User.markBlocked(order.userId, true);
      return false;
    }
    log.warn(`Клиент не получил уведомление по заказу №${order.id}: ${describeError(error)}`);
    return true;
  }
}

export async function notifyAdminsText(api, order, text) {
  const targets = order.adminMessages?.length
    ? order.adminMessages
    : orderChatIds().map((chatId) => ({ chatId }));
  for (const { chatId, messageId } of targets) {
    await api
      .sendMessage(chatId, text, {
        parse_mode: 'HTML',
        ...(messageId ? { reply_parameters: { message_id: messageId, allow_sending_without_reply: true } } : {}),
      })
      .catch((error) => log.warn(`Сообщение администратору не отправлено: ${describeError(error)}`));
  }
}
