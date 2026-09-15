import { restaurant, loc } from '../core/restaurant.js';

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function roundMoney(value) {
  const factor = 10 ** restaurant.data.currency.decimals;
  return Math.round(value * factor) / factor;
}

export function formatMoney(value, lang) {
  const { decimals, locale, name } = restaurant.data.currency;
  const amount = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
  const currency = loc(name, lang);
  return currency ? `${amount} ${currency}` : amount;
}

export function formatDateTime(date) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: restaurant.data.timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(date)
    .replace(',', '');
}

export function formatShortDateTime(date) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: restaurant.data.timezone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(date)
    .replace(',', '');
}

export function truncate(text, maxLength) {
  const value = String(text ?? '');
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

// Приводит номер к виду +998901234567. Возвращает null, если это не номер
export function normalizePhone(raw) {
  const value = String(raw ?? '').trim();
  if (!/^\+?[\d\s()-]+$/.test(value)) return null;
  let digits = value.replace(/\D/g, '');
  const { phoneCountryCode } = restaurant.data;
  if (phoneCountryCode && !value.startsWith('+') && digits.length === 9) digits = phoneCountryCode + digits;
  if (digits.length < 10 || digits.length > 15) return null;
  return `+${digits}`;
}
