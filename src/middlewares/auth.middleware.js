import config from '../config/default.js';
import { restaurant } from '../core/restaurant.js';
import { t } from '../core/i18n.js';

export function isAdminId(userId) {
  return config.adminIds.includes(Number(userId));
}

// Администратор — это ID из ADMIN_IDS или любой участник группы заказов (ORDERS_CHAT_ID)
export function isStaff(ctx) {
  return isAdminId(ctx.from?.id) || (config.ordersChatId !== null && ctx.chat?.id === config.ordersChatId);
}

export async function adminOnly(ctx, next) {
  if (isStaff(ctx)) return next();
  const text = t(ctx.lang ?? restaurant.defaultLanguage, 'admin.noAccess');
  if (ctx.callbackQuery) return ctx.answerCallbackQuery({ text, show_alert: true });
  if (ctx.chat?.type === 'private') return ctx.reply(text);
}
