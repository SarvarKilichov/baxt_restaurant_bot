import { GrammyError } from 'grammy';

export function isNotModified(error) {
  return error instanceof GrammyError && /message is not modified/i.test(error.description);
}

export function isBlockedByUser(error) {
  return error instanceof GrammyError && error.error_code === 403;
}

export function describeError(error) {
  return error?.description ?? error?.message ?? String(error);
}

export function ignoreNotModified(error) {
  if (!isNotModified(error)) throw error;
}

// Ответ на нажатие inline-кнопки. Ошибки (например, устаревшая кнопка) не важны
export async function answer(ctx, options) {
  try {
    await ctx.answerCallbackQuery(options);
  } catch {
    // кнопка устарела
  }
}

export function hasButtons(keyboard) {
  return Boolean(keyboard?.inline_keyboard?.some((row) => row.length));
}

// Редактирует текстовое сообщение с кнопкой. Если это фото или старое сообщение — отправляет новое
export async function editOrReply(ctx, text, other = {}) {
  const extra = { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...other };
  const message = ctx.callbackQuery?.message;
  if (message && 'text' in message) {
    try {
      await ctx.editMessageText(text, extra);
      return;
    } catch (error) {
      if (isNotModified(error)) return;
    }
  }
  if (message) await ctx.deleteMessage().catch(() => {});
  await ctx.reply(text, extra);
}

// Показывает «печатает…», пока идёт долгая операция
export function keepTyping(ctx) {
  const send = () => ctx.replyWithChatAction('typing').catch(() => {});
  send();
  const timer = setInterval(send, 4500);
  return () => clearInterval(timer);
}
