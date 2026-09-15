import { restaurant } from '../core/restaurant.js';
import { t } from '../core/i18n.js';

export const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const WEEKDAY_INDEX = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const DAY_MINUTES = 24 * 60;

// Текущие дата и время в часовом поясе ресторана
export function zonedNow(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: restaurant.data.timezone,
      weekday: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    dayIndex: WEEKDAY_INDEX[parts.weekday],
    minutes: hour * 60 + minute,
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute,
    second: Number(parts.second),
  };
}

// Начало текущего дня в часовом поясе ресторана
export function startOfToday(date = new Date()) {
  const now = zonedNow(date);
  const zonedAsUtc = Date.UTC(now.year, now.month - 1, now.day, now.hour, now.minute, now.second);
  const offset = zonedAsUtc - Math.floor(date.getTime() / 1000) * 1000;
  return new Date(Date.UTC(now.year, now.month - 1, now.day) - offset);
}

export function formatMinutes(total) {
  const minutes = ((total % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

const isAllDay = (day) => Boolean(day) && day.open === 0 && day.close >= DAY_MINUTES;

export function isAlwaysOpen() {
  return DAYS.every((day) => isAllDay(restaurant.data.hours[day]));
}

// { open, closesAt } — если открыто; { open: false, opensAt, inDays, dayIndex } — если закрыто
export function getOpenStatus(date = new Date()) {
  const { hours } = restaurant.data;
  if (isAlwaysOpen()) return { open: true, closesAt: null };

  const now = zonedNow(date);
  const today = hours[DAYS[now.dayIndex]];
  const yesterday = hours[DAYS[(now.dayIndex + 6) % 7]];

  if (yesterday && yesterday.close > DAY_MINUTES && now.minutes < yesterday.close - DAY_MINUTES) {
    return { open: true, closesAt: formatMinutes(yesterday.close) };
  }
  if (today && now.minutes >= today.open && now.minutes < today.close) {
    return { open: true, closesAt: formatMinutes(today.close) };
  }
  if (today && now.minutes < today.open) {
    return { open: false, opensAt: formatMinutes(today.open), inDays: 0, dayIndex: now.dayIndex };
  }
  for (let offset = 1; offset <= 7; offset += 1) {
    const dayIndex = (now.dayIndex + offset) % 7;
    const day = hours[DAYS[dayIndex]];
    if (day) return { open: false, opensAt: formatMinutes(day.open), inDays: offset, dayIndex };
  }
  return { open: false, opensAt: null, inDays: null, dayIndex: null };
}

// «сегодня в 10:00», «завтра в 10:00», «в понедельник в 10:00»
export function describeOpening(lang, status) {
  if (!status.opensAt) return '—';
  if (status.inDays === 0) return t(lang, 'hours.today', { time: status.opensAt });
  if (status.inDays === 1) return t(lang, 'hours.tomorrow', { time: status.opensAt });
  const days = t(lang, 'hours.daysOn');
  return t(lang, 'hours.onDay', { day: Array.isArray(days) ? days[status.dayIndex] : '', time: status.opensAt });
}

export function formatDayHours(lang, day) {
  if (!day) return t(lang, 'hours.closed');
  if (isAllDay(day)) return t(lang, 'hours.allDay');
  return `${formatMinutes(day.open)}–${formatMinutes(day.close)}`;
}

// Часы работы, сгруппированные по одинаковым дням: «Пн–Чт: 10:00–23:00»
export function hoursLines(lang) {
  const shortNames = t(lang, 'hours.daysShort');
  const groups = [];
  DAYS.forEach((day, index) => {
    const value = formatDayHours(lang, restaurant.data.hours[day]);
    const last = groups.at(-1);
    if (last && last.value === value) last.end = index;
    else groups.push({ start: index, end: index, value });
  });
  const name = (index) => (Array.isArray(shortNames) ? shortNames[index] : DAYS[index]);
  return groups.map((group) =>
    group.start === group.end
      ? `${name(group.start)}: ${group.value}`
      : `${name(group.start)}–${name(group.end)}: ${group.value}`,
  );
}
