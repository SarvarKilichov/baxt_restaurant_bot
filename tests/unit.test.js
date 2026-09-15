// Проверки логики без базы данных и Telegram. Запуск: npm test
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import config from '../src/config/default.js';
import { applyRestaurantData, loadRestaurantData, restaurant, RestaurantDataError } from '../src/core/restaurant.js';
import { isText, t, tOr } from '../src/core/i18n.js';
import { getOpenStatus, hoursLines, startOfToday } from '../src/services/hours.service.js';
import { getDeliveryFee, meetsDeliveryMinimum } from '../src/services/pricing.service.js';
import { formatMoney, normalizePhone } from '../src/utils/format.js';
import { appDatabaseUrl, migrationDatabaseUrl } from '../src/database/url.js';

const plain = (text) => text.replace(/[  ]/g, ' ');

before(() => {
  applyRestaurantData(loadRestaurantData());
});

function withTempRestaurant(change) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'restaurant-'));
  fs.cpSync(config.restaurantDir, dir, { recursive: true });
  change(dir);
  return dir;
}

test('данные ресторана из папки restaurant загружаются без ошибок', () => {
  const { data, menu } = loadRestaurantData();
  assert.deepEqual(data.languages, ['ru', 'uz']);
  assert.ok(menu.categories.length > 0);
});

test('часы работы: открыто, закрыто, после полуночи', () => {
  // Вторник 15.09.2026, 19:00 по Ташкенту
  assert.deepEqual(getOpenStatus(new Date('2026-09-15T14:00:00Z')), { open: true, closesAt: '23:00' });
  // Среда, 00:30 — закрыто до 10:00
  assert.deepEqual(getOpenStatus(new Date('2026-09-15T19:30:00Z')), { open: false, opensAt: '10:00', inDays: 0, dayIndex: 2 });
  // Пятница, 23:30 — открыто до полуночи
  assert.deepEqual(getOpenStatus(new Date('2026-09-18T18:30:00Z')), { open: true, closesAt: '00:00' });

  const original = restaurant.data.hours;
  restaurant.data.hours = { ...original, monday: { open: 18 * 60, close: 26 * 60 }, tuesday: null };
  // Вторник 01:00 — ещё идёт смена понедельника
  assert.deepEqual(getOpenStatus(new Date('2026-09-14T20:00:00Z')), { open: true, closesAt: '02:00' });
  // Вторник 03:00 — закрыто до среды
  assert.equal(getOpenStatus(new Date('2026-09-14T22:00:00Z')).inDays, 1);
  restaurant.data.hours = original;

  assert.deepEqual(hoursLines('ru'), ['Пн–Чт: 10:00–23:00', 'Пт–Сб: 10:00–00:00', 'Вс: 10:00–23:00']);
});

test('начало дня считается в часовом поясе ресторана', () => {
  assert.equal(startOfToday(new Date('2026-09-15T14:27:13.504Z')).toISOString(), '2026-09-14T19:00:00.000Z');
});

test('телефон приводится к международному формату', () => {
  assert.equal(normalizePhone('90 123 45 67'), '+998901234567');
  assert.equal(normalizePhone('+998 (90) 123-45-67'), '+998901234567');
  assert.equal(normalizePhone('998901234567'), '+998901234567');
  assert.equal(normalizePhone('+7 916 123 45 67'), '+79161234567');
  assert.equal(normalizePhone('12345'), null);
  assert.equal(normalizePhone('позвоните мне'), null);
});

test('цены и доставка', () => {
  assert.equal(plain(formatMoney(85000, 'ru')), '85 000 сум');
  assert.equal(plain(formatMoney(85000, 'uz')), "85 000 so'm");
  assert.equal(getDeliveryFee(195000), 15000);
  assert.equal(getDeliveryFee(200000), 0);
  assert.equal(meetsDeliveryMinimum(59000), false);
  assert.equal(meetsDeliveryMinimum(60000), true);
});

test('тексты интерфейса на двух языках', () => {
  assert.equal(t('ru', 'orders.cannotCancel', { phone: '+998 71 200-00-00' }), 'Заказ уже в работе. Чтобы отменить его, позвоните нам: +998 71 200-00-00');
  assert.equal(t('uz', 'buttons.menu'), '🍽 Menyu');
  assert.ok(isText('🍽 Открыть меню', 'buttons.openApp'));
  assert.ok(isText('🍽 Menyuni ochish', 'buttons.openApp'));
  assert.equal(tOr('ru', 'badges.unknown', 'unknown'), 'unknown');
});

test('строка подключения Neon готовится для приложения и миграций', () => {
  const raw = 'postgresql://u:p@ep-x-pooler.c-2.us-east-2.aws.neon.tech/db?sslmode=require&channel_binding=require';
  assert.equal(appDatabaseUrl(raw), 'postgresql://u:p@ep-x-pooler.c-2.us-east-2.aws.neon.tech/db?sslmode=verify-full');
  assert.equal(migrationDatabaseUrl(raw), 'postgresql://u:p@ep-x.c-2.us-east-2.aws.neon.tech/db?sslmode=require');
});

test('понятные ошибки в данных ресторана', () => {
  const dir = withTempRestaurant((folder) => {
    const menuPath = path.join(folder, 'menu.yaml');
    const menu = fs
      .readFileSync(menuPath, 'utf8')
      .replace('price: 55000', 'price: дорого')
      .replace('id: lagman', 'id: plov');
    fs.writeFileSync(menuPath, menu);
    const infoPath = path.join(folder, 'restaurant.yaml');
    fs.writeFileSync(infoPath, fs.readFileSync(infoPath, 'utf8').replace('monday: "10:00-23:00"', 'monday: "с 10 до 23"'));
  });

  assert.throws(
    () => loadRestaurantData(dir),
    (error) => {
      assert.ok(error instanceof RestaurantDataError);
      const text = error.problems.join('\n');
      assert.match(text, /блюдо «plov» → price/);
      assert.match(text, /«plov» уже используется/);
      assert.match(text, /hours → monday: неверный формат/);
      return true;
    },
  );

  const broken = withTempRestaurant((folder) => {
    fs.writeFileSync(path.join(folder, 'menu.yaml'), 'categories:\n  - id: pizza\n   name: "Пицца"\n');
  });
  assert.throws(() => loadRestaurantData(broken), /menu\.yaml, строка \d+: ошибка оформления/);
});
