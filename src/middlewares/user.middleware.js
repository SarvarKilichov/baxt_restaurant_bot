import { restaurant } from '../core/restaurant.js';
import { resolveLanguage, t } from '../core/i18n.js';
import * as User from '../models/User.js';

// Загружает клиента из базы и определяет язык общения
export async function loadUser(ctx, next) {
  if (!ctx.from || ctx.from.is_bot) return next();
  ctx.user = await User.findOrCreateUser(ctx.from);
  ctx.lang = resolveLanguage(ctx.user, ctx.from.language_code);
  ctx.t = (key, params) => t(ctx.lang ?? restaurant.defaultLanguage, key, params);
  return next();
}

// Отмечает, что клиент заблокировал или разблокировал бота
export async function trackBotBlocked(ctx) {
  if (ctx.chat?.type !== 'private') return;
  const status = ctx.myChatMember.new_chat_member.status;
  await User.markBlocked(ctx.from.id, status === 'kicked');
}
