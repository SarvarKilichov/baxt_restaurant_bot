import { InlineKeyboard } from 'grammy';
import { restaurant, loc } from '../core/restaurant.js';
import { t } from '../core/i18n.js';
import { miniApp } from '../core/miniapp.js';
import * as User from '../models/User.js';
import { sendPhotoMessage } from '../services/photo.service.js';
import { escapeHtml } from '../utils/format.js';
import { answer } from '../utils/telegram.js';

export async function start(ctx) {
  if (restaurant.languages.length > 1 && !ctx.user.language) return askLanguage(ctx);
  return sendWelcome(ctx);
}

export async function askLanguage(ctx) {
  const keyboard = new InlineKeyboard();
  for (const lang of restaurant.languages) keyboard.text(t(lang, 'language.name'), `lang:${lang}`);
  const text = restaurant.languages.map((lang) => t(lang, 'language.choose')).join('\n');
  return ctx.reply(text, { reply_markup: keyboard });
}

export async function setLanguage(ctx) {
  const lang = ctx.match[1];
  if (!restaurant.languages.includes(lang)) return answer(ctx);
  const isFirstChoice = !ctx.user.language;
  ctx.user = await User.updateUser(ctx.from.id, { language: lang });
  ctx.lang = lang;
  await answer(ctx, { text: t(lang, 'language.changed') });
  await ctx.deleteMessage().catch(() => {});
  if (isFirstChoice) return sendWelcome(ctx);
  return ctx.reply(t(lang, 'language.changed'));
}

function openAppKeyboard(lang) {
  if (!miniApp.url) return undefined;
  return new InlineKeyboard().webApp(t(lang, 'buttons.openApp'), miniApp.url);
}

export async function sendWelcome(ctx) {
  const { data } = restaurant;
  const caption = loc(data.welcome, ctx.lang).replaceAll('{name}', escapeHtml(ctx.from.first_name));
  return sendPhotoMessage(ctx.api, ctx.chat.id, {
    photo: data.welcomePhoto,
    caption,
    other: { reply_markup: openAppKeyboard(ctx.lang) },
  });
}
