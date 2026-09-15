import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import config from '../config/default.js';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const CLOSED_VALUES = new Set(['closed', 'выходной', 'dam olish', '-']);
const PHOTO_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export class RestaurantDataError extends Error {
  constructor(problems) {
    super(`Ошибки в данных ресторана (папка restaurant):\n  • ${problems.join('\n  • ')}`);
    this.name = 'RestaurantDataError';
    this.problems = problems;
  }
}

// Текущие данные ресторана — заполняются при запуске и при перезагрузке файлов
export const restaurant = {
  data: null,
  menu: null,
  texts: null,
  get languages() {
    return this.data.languages;
  },
  get defaultLanguage() {
    return this.data.languages[0];
  },
};

// Текст на нужном языке из поля вида { ru: '...', uz: '...' }
export function loc(value, lang) {
  if (value == null) return '';
  if (typeof value !== 'object') return String(value);
  return value[lang] ?? value[restaurant.defaultLanguage] ?? Object.values(value)[0] ?? '';
}

export function applyRestaurantData(bundle) {
  restaurant.data = bundle.data;
  restaurant.menu = bundle.menu;
  restaurant.texts = bundle.texts;
}

const isBlank = (value) => value == null || (typeof value === 'string' && value.trim() === '');

function readYaml(dir, file, problems) {
  const fullPath = path.join(dir, file);
  if (!fs.existsSync(fullPath)) {
    problems.push(`не найден файл restaurant/${file}`);
    return null;
  }
  const document = YAML.parseDocument(fs.readFileSync(fullPath, 'utf8'));
  if (document.errors.length) {
    for (const error of document.errors) {
      const line = error.linePos?.[0]?.line;
      problems.push(
        `restaurant/${file}${line ? `, строка ${line}` : ''}: ошибка оформления — проверьте отступы, двоеточия и кавычки (${error.code})`,
      );
    }
    return null;
  }
  const value = document.toJS();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    problems.push(`restaurant/${file}: файл пустой или заполнен неверно`);
    return null;
  }
  return value;
}

function createChecker(languages) {
  const problems = [];
  const warnings = [];

  function text(value, where, { required = true } = {}) {
    if (isBlank(value)) {
      if (required) problems.push(`${where}: не заполнено`);
      return null;
    }
    if (typeof value === 'string' || typeof value === 'number') {
      const single = String(value).trim();
      return Object.fromEntries(languages.map((lang) => [lang, single]));
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      const filled = languages.filter((lang) => !isBlank(value[lang]));
      if (!filled.length) {
        problems.push(`${where}: нет текста ни на одном из языков (${languages.join(', ')})`);
        return null;
      }
      const missing = languages.filter((lang) => isBlank(value[lang]));
      if (missing.length) {
        warnings.push(`${where}: нет перевода (${missing.join(', ')}) — будет показан текст на «${filled[0]}»`);
      }
      return Object.fromEntries(
        languages.map((lang) => [lang, String(isBlank(value[lang]) ? value[filled[0]] : value[lang]).trim()]),
      );
    }
    problems.push(`${where}: должно быть текстом`);
    return null;
  }

  function number(value, where, { required = true, integer = false, min = 0, max = Infinity } = {}) {
    if (isBlank(value)) {
      if (required) problems.push(`${where}: укажите число`);
      return null;
    }
    const parsed = typeof value === 'number' ? value : Number(String(value).replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
      const range = max < Infinity ? `от ${min} до ${max}` : `не меньше ${min}`;
      problems.push(`${where}: нужно ${integer ? 'целое ' : ''}число ${range}, а указано «${value}»`);
      return null;
    }
    return parsed;
  }

  function flag(value, where, fallback) {
    if (value == null) return fallback;
    if (typeof value === 'boolean') return value;
    problems.push(`${where}: напишите true или false`);
    return fallback;
  }

  return { problems, warnings, text, number, flag };
}

function parseLanguages(value, problems) {
  const list = (Array.isArray(value) ? value : [value])
    .filter((lang) => !isBlank(lang))
    .map((lang) => String(lang).trim().toLowerCase());
  const languages = [...new Set(list)];
  if (!languages.length) problems.push('restaurant.yaml → languages: укажите хотя бы один язык, например [ru]');
  for (const lang of languages) {
    if (!/^[a-z]{2,3}$/.test(lang)) problems.push(`restaurant.yaml → languages: неверный код языка «${lang}»`);
  }
  return languages;
}

function parseHours(value, check) {
  const hours = {};
  for (const day of DAYS) {
    const where = `restaurant.yaml → hours → ${day}`;
    const raw = String(value?.[day] ?? '').trim().toLowerCase();
    if (!raw) {
      check.problems.push(`${where}: не заполнено — напишите, например, "10:00-23:00" или "closed"`);
      continue;
    }
    if (CLOSED_VALUES.has(raw)) {
      hours[day] = null;
      continue;
    }
    const match = raw.match(/^(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})$/);
    const [openH, openM, closeH, closeM] = match ? match.slice(1).map(Number) : [];
    const valid = match && openH < 24 && openM < 60 && closeM < 60 && (closeH < 24 || (closeH === 24 && closeM === 0));
    if (!valid) {
      check.problems.push(`${where}: неверный формат «${value?.[day]}» — нужно "10:00-23:00" или "closed"`);
      continue;
    }
    const open = openH * 60 + openM;
    let close = closeH * 60 + closeM;
    if (close <= open) close += 24 * 60; // работа после полуночи
    hours[day] = { open, close };
  }
  return hours;
}

function parsePhoto(value, where, dir, check) {
  if (isBlank(value)) return null;
  const photo = String(value).trim();
  if (/^https?:\/\//i.test(photo)) return photo;
  const root = path.resolve(dir);
  const fullPath = path.resolve(root, photo);
  if (!fullPath.startsWith(root + path.sep) || !PHOTO_EXTENSIONS.has(path.extname(fullPath).toLowerCase())) {
    check.problems.push(`${where}: «${photo}» — укажите ссылку или файл .jpg/.png из папки restaurant/images`);
    return null;
  }
  if (!fs.existsSync(fullPath)) {
    check.warnings.push(`${where}: файл restaurant/${photo} не найден — будет показано без фото`);
    return null;
  }
  return photo;
}

function parseId(value, where, seen, check) {
  if (isBlank(value)) {
    check.problems.push(`${where} → id: не заполнено`);
    return null;
  }
  const id = String(value).trim();
  if (!ID_PATTERN.test(id)) {
    check.problems.push(
      `${where} → id: «${id}» — только маленькие латинские буквы, цифры, «-» и «_», до 32 символов`,
    );
    return null;
  }
  if (seen.has(id)) {
    check.problems.push(`${where} → id: «${id}» уже используется — id должен быть уникальным`);
    return null;
  }
  seen.add(id);
  return id;
}

function parseCoordinates(value, where, check) {
  if (value == null) return null;
  const latitude = check.number(value.latitude, `${where} → latitude`, { min: -90, max: 90 });
  const longitude = check.number(value.longitude, `${where} → longitude`, { min: -180, max: 180 });
  return latitude == null || longitude == null ? null : { latitude, longitude };
}

function parseMenu(rawMenu, dir, check) {
  const categories = [];
  const categoryIds = new Set();
  const productIds = new Set();

  if (!Array.isArray(rawMenu.categories) || !rawMenu.categories.length) {
    check.problems.push('menu.yaml: нет ни одной категории — заполните раздел categories');
    return { categories };
  }

  rawMenu.categories.forEach((rawCategory, categoryIndex) => {
    let where = `menu.yaml → категория №${categoryIndex + 1}`;
    if (!rawCategory || typeof rawCategory !== 'object') {
      check.problems.push(`${where}: заполнена неверно`);
      return;
    }
    const id = parseId(rawCategory.id, where, categoryIds, check);
    if (id) where = `menu.yaml → категория «${id}»`;
    const name = check.text(rawCategory.name, `${where} → name`);

    const rawItems = Array.isArray(rawCategory.items) ? rawCategory.items : [];
    if (!rawItems.length) check.warnings.push(`${where}: нет блюд (items) — категория не будет показана`);

    const items = [];
    rawItems.forEach((rawItem, itemIndex) => {
      let itemWhere = `${where} → блюдо №${itemIndex + 1}`;
      if (!rawItem || typeof rawItem !== 'object') {
        check.problems.push(`${itemWhere}: заполнено неверно`);
        return;
      }
      const itemId = parseId(rawItem.id, itemWhere, productIds, check);
      if (itemId) itemWhere = `${where} → блюдо «${itemId}»`;
      const item = {
        id: itemId,
        name: check.text(rawItem.name, `${itemWhere} → name`),
        description: check.text(rawItem.description, `${itemWhere} → description`, { required: false }),
        price: check.number(rawItem.price, `${itemWhere} → price`),
        oldPrice: check.number(rawItem.old_price, `${itemWhere} → old_price`, { required: false }),
        weight: check.text(rawItem.weight, `${itemWhere} → weight`, { required: false }),
        photo: parsePhoto(rawItem.photo, `${itemWhere} → photo`, dir, check),
        spicy: check.number(rawItem.spicy ?? 0, `${itemWhere} → spicy`, { integer: true, max: 3 }) ?? 0,
        badges: (Array.isArray(rawItem.badges) ? rawItem.badges : [rawItem.badges])
          .filter((badge) => !isBlank(badge))
          .map((badge) => String(badge).trim()),
      };
      if (item.id && item.name && item.price != null) items.push(item);
    });

    if (id && name) categories.push({ id, name, items });
  });

  return { categories };
}

function flatten(source, prefix = '', target = {}) {
  for (const [key, value] of Object.entries(source)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, fullKey, target);
    else target[fullKey] = typeof value === 'string' ? value.replace(/\n+$/, '') : value;
  }
  return target;
}

// Читает и проверяет все файлы из папки restaurant. При ошибках бросает RestaurantDataError
export function loadRestaurantData(dir = config.restaurantDir) {
  const fileProblems = [];
  const raw = readYaml(dir, 'restaurant.yaml', fileProblems);
  const rawMenu = readYaml(dir, 'menu.yaml', fileProblems);
  if (fileProblems.length) throw new RestaurantDataError(fileProblems);

  const languageProblems = [];
  const languages = parseLanguages(raw.languages, languageProblems);
  if (languageProblems.length) throw new RestaurantDataError(languageProblems);

  const check = createChecker(languages);
  const { problems, warnings } = check;

  const texts = {};
  for (const lang of languages) {
    const rawTexts = readYaml(dir, `texts/${lang}.yaml`, problems);
    if (rawTexts) texts[lang] = flatten(rawTexts);
  }
  const baseTexts = texts[languages[0]];
  for (const lang of languages.slice(1)) {
    if (!baseTexts || !texts[lang]) continue;
    const missing = Object.keys(baseTexts).filter((key) => !(key in texts[lang]));
    if (missing.length) {
      warnings.push(
        `texts/${lang}.yaml: нет текстов ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' и других' : ''} — будут показаны на «${languages[0]}»`,
      );
    }
  }

  const timezone = String(raw.timezone ?? 'Asia/Tashkent').trim();
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: timezone });
  } catch {
    problems.push(`restaurant.yaml → timezone: неизвестный часовой пояс «${timezone}»`);
  }

  const currencyLocale = String(raw.currency?.locale ?? 'ru-RU');
  const contacts = raw.contacts ?? {};
  const delivery = raw.delivery ?? {};
  const pickup = raw.pickup ?? {};

  const data = {
    languages,
    timezone,
    currency: {
      name: check.text(raw.currency?.name, 'restaurant.yaml → currency → name', { required: false }) ?? {},
      decimals: check.number(raw.currency?.decimals ?? 0, 'restaurant.yaml → currency → decimals', { integer: true, max: 3 }) ?? 0,
      locale: Intl.NumberFormat.supportedLocalesOf(currencyLocale).length ? currencyLocale : 'ru-RU',
    },
    phoneCountryCode: String(raw.phone_country_code ?? '').replace(/\D/g, ''),
    name: check.text(raw.name, 'restaurant.yaml → name'),
    tagline: check.text(raw.tagline, 'restaurant.yaml → tagline', { required: false }),
    description: check.text(raw.description, 'restaurant.yaml → description', { required: false }),
    welcome: check.text(raw.welcome, 'restaurant.yaml → welcome'),
    welcomePhoto: parsePhoto(raw.welcome_photo, 'restaurant.yaml → welcome_photo', dir, check),
    contacts: {
      phone: isBlank(contacts.phone) ? null : String(contacts.phone).trim(),
      address: check.text(contacts.address, 'restaurant.yaml → contacts → address', { required: false }),
      landmark: check.text(contacts.landmark, 'restaurant.yaml → contacts → landmark', { required: false }),
      location: parseCoordinates(contacts.location, 'restaurant.yaml → contacts → location', check),
      instagram: isBlank(contacts.instagram) ? null : String(contacts.instagram).trim(),
      website: isBlank(contacts.website) ? null : String(contacts.website).trim(),
    },
    hours: parseHours(raw.hours, check),
    orders: {
      acceptWhenClosed: check.flag(raw.orders?.accept_when_closed, 'restaurant.yaml → orders → accept_when_closed', false),
    },
    delivery: {
      enabled: check.flag(delivery.enabled, 'restaurant.yaml → delivery → enabled', false),
      price: check.number(delivery.price ?? 0, 'restaurant.yaml → delivery → price') ?? 0,
      freeFrom: check.number(delivery.free_from ?? 0, 'restaurant.yaml → delivery → free_from') ?? 0,
      minOrder: check.number(delivery.min_order ?? 0, 'restaurant.yaml → delivery → min_order') ?? 0,
      time: check.text(delivery.time, 'restaurant.yaml → delivery → time', { required: false }),
      area: check.text(delivery.area, 'restaurant.yaml → delivery → area', { required: false }),
    },
    pickup: {
      enabled: check.flag(pickup.enabled, 'restaurant.yaml → pickup → enabled', false),
      time: check.text(pickup.time, 'restaurant.yaml → pickup → time', { required: false }),
    },
    paymentMethods: (Array.isArray(raw.payment_methods) ? raw.payment_methods : [])
      .map((method, index) => check.text(method, `restaurant.yaml → payment_methods → №${index + 1}`))
      .filter(Boolean),
    faq: (Array.isArray(raw.faq) ? raw.faq : [])
      .map((item, index) => {
        const where = `restaurant.yaml → faq → вопрос №${index + 1}`;
        if (!item || typeof item !== 'object') {
          problems.push(`${where}: укажите q (вопрос) и a (ответ)`);
          return null;
        }
        const q = check.text(item.q, `${where} → q`);
        const a = check.text(item.a, `${where} → a`);
        return q && a ? { q, a } : null;
      })
      .filter(Boolean),
    upsellProductId: isBlank(raw.upsell_product_id) ? null : String(raw.upsell_product_id).trim(),
    aiNotes: check.text(raw.ai_notes, 'restaurant.yaml → ai_notes', { required: false }),
    exampleQuestions: (Array.isArray(raw.example_questions) ? raw.example_questions : [])
      .slice(0, 6)
      .map((question, index) => check.text(question, `restaurant.yaml → example_questions → №${index + 1}`))
      .filter(Boolean),
  };

  if (!data.delivery.enabled && !data.pickup.enabled) {
    problems.push('restaurant.yaml: включите доставку (delivery → enabled: true) или самовывоз (pickup → enabled: true)');
  }
  if (!data.contacts.phone) warnings.push('restaurant.yaml → contacts → phone: не указан телефон ресторана');

  const menu = parseMenu(rawMenu, dir, check);

  if (data.upsellProductId && !menu.categories.some((category) => category.items.some((item) => item.id === data.upsellProductId))) {
    warnings.push(`restaurant.yaml → upsell_product_id: блюдо «${data.upsellProductId}» не найдено в menu.yaml — предложение не будет показано`);
    data.upsellProductId = null;
  }

  if (baseTexts) {
    const unknownBadges = new Set(
      menu.categories.flatMap((category) => category.items.flatMap((item) => item.badges)).filter((badge) => !(`badges.${badge}` in baseTexts)),
    );
    for (const badge of unknownBadges) {
      warnings.push(`menu.yaml → badges: метка «${badge}» не описана в texts/${languages[0]}.yaml (раздел badges)`);
    }
  }

  if (problems.length) throw new RestaurantDataError(problems);
  return { data, menu, texts, warnings };
}
