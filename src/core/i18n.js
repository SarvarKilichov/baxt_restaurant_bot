import { restaurant } from './restaurant.js';
import { log } from '../utils/logger.js';

const reportedKeys = new Set();

function lookup(lang, key) {
  return restaurant.texts[lang]?.[key] ?? restaurant.texts[restaurant.defaultLanguage]?.[key];
}

// Текст интерфейса из restaurant/texts/<язык>.yaml с подстановкой {параметров}
export function t(lang, key, params) {
  const value = lookup(lang, key);
  if (value == null) {
    if (!reportedKeys.has(key)) {
      reportedKeys.add(key);
      log.warn(`В restaurant/texts нет текста «${key}»`);
    }
    return key;
  }
  if (typeof value !== 'string' || !params) return value;
  return value.replace(/\{(\w+)\}/g, (match, name) => (params[name] == null ? match : String(params[name])));
}

// Текст, если он есть, иначе запасное значение (без предупреждения)
export function tOr(lang, key, fallback) {
  return lookup(lang, key) ?? fallback;
}

// Совпадает ли текст сообщения с кнопкой на любом из языков
export function isText(text, key) {
  return restaurant.languages.some((lang) => lookup(lang, key) === text);
}

export function resolveLanguage(user, telegramLanguage) {
  const { languages } = restaurant;
  if (user?.language && languages.includes(user.language)) return user.language;
  const fromTelegram = telegramLanguage?.slice(0, 2);
  if (fromTelegram && languages.includes(fromTelegram)) return fromTelegram;
  return restaurant.defaultLanguage;
}
