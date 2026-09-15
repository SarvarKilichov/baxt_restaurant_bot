// Полный сценарий работы бота и Mini App на имитации Telegram API и реальном веб-сервере.
// Использует базу из .env и удаляет за собой тестовые данные.
// Запуск: npm run test:flow
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import config from '../src/config/default.js';
import { restaurant } from '../src/core/restaurant.js';
import { miniApp } from '../src/core/miniapp.js';
import { createBot } from '../src/core/bot.js';
import { prisma } from '../src/database/connection.js';
import { loadSettings, setSetting } from '../src/models/Setting.js';
import * as Product from '../src/models/Product.js';
import { loadRestaurant } from '../src/services/restaurant.service.js';
import { startWebServer } from '../src/webapp/server.js';

const CUSTOMER = { id: 990000001, is_bot: false, first_name: 'Тест', username: 'test_client', language_code: 'ru' };
const ADMIN = { id: 990000002, is_bot: false, first_name: 'Админ', username: 'test_admin', language_code: 'ru' };
const STRANGER = { id: 990000003, is_bot: false, first_name: 'Гость', language_code: 'en' };
const TEST_USER_IDS = [CUSTOMER, ADMIN, STRANGER].map((user) => BigInt(user.id));

const BOT_INFO = {
  id: 1,
  is_bot: true,
  first_name: 'Test Restaurant',
  username: 'test_restaurant_bot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
};

let bot;
let baseUrl;
let calls = [];
let updateId = 1;
let messageId = 5000;
const now = () => Math.floor(Date.now() / 1000);

function fakeResult(method, payload) {
  const base = { message_id: ++messageId, date: now(), chat: { id: payload.chat_id, type: 'private' } };
  if (method === 'sendPhoto') {
    return { ...base, caption: payload.caption, photo: [{ file_id: `test-file-${messageId}`, file_unique_id: 'u', width: 800, height: 600 }] };
  }
  if (['sendMessage', 'sendLocation', 'sendVenue'].includes(method)) return { ...base, text: payload.text };
  if (method.startsWith('editMessage')) return { ...base, message_id: payload.message_id, text: payload.text ?? '' };
  if (method === 'getMyDescription') return { description: '' };
  if (method === 'getMyShortDescription') return { short_description: '' };
  return true;
}

async function run(update) {
  calls = [];
  await bot.handleUpdate({ update_id: updateId++, ...update });
  return calls;
}

function sendText(user, text) {
  const command = text.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] : undefined;
  return run({
    message: {
      message_id: ++messageId,
      date: now(),
      chat: { id: user.id, type: 'private', first_name: user.first_name },
      from: user,
      text,
      ...(command ? { entities: command } : {}),
    },
  });
}

function press(user, data, { targetMessageId = 4000 } = {}) {
  const message = { message_id: targetMessageId, date: now(), chat: { id: user.id, type: 'private' }, text: 'message' };
  return run({ callback_query: { id: String(updateId), from: user, chat_instance: 'test', data, message } });
}

// Подписывает initData так же, как это делает настоящий Telegram (для проверки Mini App API)
function signInitData(user) {
  const params = new URLSearchParams();
  params.set('user', JSON.stringify(user));
  params.set('auth_date', String(now()));
  params.set('query_id', 'AAtest');
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(config.botToken).digest();
  params.set('hash', crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex'));
  return params.toString();
}

async function api(user, path, { method = 'GET', body, rawInitData } = {}) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `tma ${rawInitData ?? signInitData(user)}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, body: json };
}

const byMethod = (list, method) => list.filter((call) => call.method === method);
const plain = (text) => String(text ?? '').replace(/[  ]/g, ' ');
const textOf = (call) => plain(call.payload.text ?? call.payload.caption);
const allText = (list) => list.map(textOf).join('\n');
const buttons = (call) =>
  (call?.payload.reply_markup?.inline_keyboard ?? []).flat().map((button) => ({ ...button, text: plain(button.text) }));
const alertText = (list) => byMethod(list, 'answerCallbackQuery').map((call) => call.payload.text ?? '').join('\n');

// Имитация Claude API
const aiRequests = [];
let aiReply = {};
const aiServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    aiRequests.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5',
        content: [{ type: 'text', text: JSON.stringify(aiReply) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      }),
    );
  });
});

let webServer;
let savedState;

async function cleanup() {
  await prisma.aiQuestion.deleteMany({ where: { userId: { in: TEST_USER_IDS } } });
  await prisma.order.deleteMany({ where: { userId: { in: TEST_USER_IDS } } });
  await prisma.user.deleteMany({ where: { id: { in: TEST_USER_IDS } } });
  // Номера заказов не откатываем назад: иначе кнопки в старых сообщениях администратору совпадут с новыми заказами
  await prisma.$executeRawUnsafe(
    `SELECT setval('"Order_id_seq"', GREATEST(COALESCE((SELECT MAX(id) FROM "Order"), 1000), ${Number(savedState?.orderSeq ?? 1000)}))`,
  );
  await prisma.product.updateMany({ where: { photoFileId: { startsWith: 'test-file-' } }, data: { photoFileId: null } });
  if (savedState) {
    await prisma.product.updateMany({ where: { id: { notIn: savedState.soldOut } }, data: { inStock: true } });
    await prisma.product.updateMany({ where: { id: { in: savedState.soldOut } }, data: { inStock: false } });
    await setSetting('ordersPaused', savedState.ordersPaused);
  }
}

before(async () => {
  await loadRestaurant();
  await loadSettings();
  savedState = {
    soldOut: (await prisma.product.findMany({ where: { inStock: false }, select: { id: true } })).map((row) => row.id),
    ordersPaused: (await prisma.setting.findUnique({ where: { key: 'ordersPaused' } }))?.value ?? false,
    orderSeq: (await prisma.$queryRawUnsafe('SELECT last_value FROM "Order_id_seq"'))[0].last_value,
  };
  await cleanup();
  await prisma.product.updateMany({ data: { inStock: true } });
  await setSetting('ordersPaused', false);
  await loadRestaurant();
  restaurant.data.orders.acceptWhenClosed = true;
  config.adminIds.splice(0, config.adminIds.length, ADMIN.id);
  config.ordersChatId = null;
  config.ai.apiKey = null;

  bot = createBot('test-token', { botInfo: BOT_INFO });
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    return { ok: true, result: fakeResult(method, payload) };
  });
  await bot.init();

  webServer = await startWebServer(bot.api, 0);
  baseUrl = `http://127.0.0.1:${webServer.address().port}`;
  miniApp.url = baseUrl;

  await new Promise((resolve) => aiServer.listen(0, '127.0.0.1', resolve));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${aiServer.address().port}`;
});

after(async () => {
  await cleanup();
  await prisma.$disconnect();
  await new Promise((resolve) => webServer.close(resolve));
  aiServer.close();
});

test('знакомство: выбор языка и кнопка открытия Mini App', async () => {
  let out = await sendText(CUSTOMER, '/start');
  const langButtons = byMethod(out, 'sendMessage')[0];
  assert.deepEqual(buttons(langButtons).map((b) => b.callback_data), ['lang:ru', 'lang:uz']);

  out = await press(CUSTOMER, 'lang:ru');
  const welcome = byMethod(out, 'sendPhoto')[0];
  assert.ok(welcome, 'приветствие с фото');
  assert.match(textOf(welcome), /Здравствуйте, Тест/);
  const openButton = buttons(welcome)[0];
  assert.equal(openButton.web_app.url, baseUrl);
});

test('Mini App: bootstrap отдаёт меню, часы и данные ресторана', async () => {
  const { status, body } = await api(CUSTOMER, '/bootstrap');
  assert.equal(status, 200);
  assert.equal(body.language, 'ru');
  assert.ok(body.categories.find((category) => category.id === 'pizza'));
  const diablo = body.categories.flatMap((category) => category.products).find((product) => product.id === 'diablo');
  assert.equal(plain(diablo.priceText), '85 000 сум');
  assert.equal(diablo.spicy, 3);
  assert.deepEqual(body.cart, { lines: [], count: 0, itemsTotal: 0, itemsTotalText: '0 сум', hasUnavailable: false });
  assert.equal(body.upsell.id, 'lemonade');
  assert.equal(body.ordering.allowed, true);
});

test('Mini App: без initData доступ запрещён', async () => {
  const { status, body } = await api(CUSTOMER, '/bootstrap', { rawInitData: '' });
  assert.equal(status, 401);
  assert.equal(body.error, 'UNAUTHORIZED');

  const tampered = signInitData(CUSTOMER).replace(/hash=[0-9a-f]+/, 'hash=0000');
  const bad = await api(CUSTOMER, '/bootstrap', { rawInitData: tampered });
  assert.equal(bad.status, 401);
});

test('Mini App: корзина — добавление, изменение количества, стоп-лист, очистка', async () => {
  let { body } = await api(CUSTOMER, '/cart/items', { method: 'POST', body: { productId: 'diablo', quantity: 1 } });
  assert.equal(body.itemsTotal, 85000);

  ({ body } = await api(CUSTOMER, '/cart/items', { method: 'POST', body: { productId: 'plov', quantity: 2 } }));
  assert.equal(body.count, 3);
  assert.equal(body.itemsTotal, 195000);

  await Product.setInStock('diablo', false);
  const soldOut = await api(CUSTOMER, '/cart/items', { method: 'POST', body: { productId: 'diablo', quantity: 2 } });
  assert.equal(soldOut.status, 409);
  assert.equal(soldOut.body.error, 'SOLD_OUT');

  ({ body } = await api(CUSTOMER, '/bootstrap'));
  assert.equal(body.cart.hasUnavailable, true);
  assert.ok(body.cart.lines.find((line) => line.productId === 'diablo' && !line.inStock));

  ({ body } = await api(CUSTOMER, '/cart/items', { method: 'POST', body: { productId: 'diablo', quantity: 0 } }));
  assert.equal(body.hasUnavailable, false);
  assert.equal(body.count, 2);

  await Product.setInStock('diablo', true);
  ({ body } = await api(CUSTOMER, '/cart/clear', { method: 'POST' }));
  assert.deepEqual(body.lines, []);
});

test('Mini App: оформление заказа — проверки полей', async () => {
  await api(CUSTOMER, '/cart/items', { method: 'POST', body: { productId: 'plov', quantity: 2 } }); // выше минимума доставки

  let res = await api(CUSTOMER, '/checkout', { method: 'POST', body: { method: 'DELIVERY' } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'INVALID_NAME');

  res = await api(CUSTOMER, '/checkout', { method: 'POST', body: { method: 'DELIVERY', name: 'Азиз', phone: '12345' } });
  assert.equal(res.body.error, 'INVALID_PHONE');

  res = await api(CUSTOMER, '/checkout', {
    method: 'POST',
    body: { method: 'DELIVERY', name: 'Азиз', phone: '+998901234567' },
  });
  assert.equal(res.body.error, 'INVALID_ADDRESS');

  res = await api(CUSTOMER, '/checkout', {
    method: 'POST',
    body: { method: 'DELIVERY', name: 'Азиз', phone: '+998901234567', address: 'ул. Тестовая, 1', paymentIndex: 99 },
  });
  assert.equal(res.body.error, 'INVALID_PAYMENT');

  await api(CUSTOMER, '/cart/clear', { method: 'POST' });
  res = await api(CUSTOMER, '/checkout', {
    method: 'POST',
    body: { method: 'DELIVERY', name: 'Азиз', phone: '+998901234567', address: 'ул. Тестовая, 1', paymentIndex: 0 },
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'CART_EMPTY');
});

test('Mini App: заказ не оформить на паузе или когда ресторан закрыт', async () => {
  await api(CUSTOMER, '/cart/items', { method: 'POST', body: { productId: 'plov', quantity: 1 } });
  const order = { method: 'DELIVERY', name: 'Азиз', phone: '+998901234567', address: 'ул. Тестовая, 1', paymentIndex: 0 };

  await setSetting('ordersPaused', true);
  try {
    const res = await api(CUSTOMER, '/checkout', { method: 'POST', body: order });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'PAUSED');
    assert.match(res.body.message, /приостановлен/);
  } finally {
    await setSetting('ordersPaused', false);
  }

  const hours = restaurant.data.hours;
  const acceptWhenClosed = restaurant.data.orders.acceptWhenClosed;
  restaurant.data.hours = Object.fromEntries(Object.keys(hours).map((day) => [day, null]));
  restaurant.data.orders.acceptWhenClosed = false;
  try {
    const res = await api(CUSTOMER, '/checkout', { method: 'POST', body: order });
    assert.equal(res.body.error, 'CLOSED');
  } finally {
    restaurant.data.hours = hours;
    restaurant.data.orders.acceptWhenClosed = acceptWhenClosed;
  }

  const bootstrap = await api(CUSTOMER, '/bootstrap');
  assert.equal(bootstrap.body.ordering.allowed, true);
});

let firstOrderId;

test('Mini App: полное оформление заказа с доставкой', async () => {
  await api(CUSTOMER, '/cart/items', { method: 'POST', body: { productId: 'lemonade', quantity: 1 } });

  calls = [];
  const { status, body } = await api(CUSTOMER, '/checkout', {
    method: 'POST',
    body: {
      method: 'DELIVERY',
      name: 'Алишер',
      phone: '90 123 45 67',
      address: 'ул. Навои, 12, кв. 5',
      comment: 'Домофон 12',
      paymentIndex: 0,
    },
  });
  assert.equal(status, 200);
  firstOrderId = body.orderId;
  assert.ok(firstOrderId >= 1001);
  assert.equal(plain(body.totalText), '92 000 сум'); // плов 55 000 + лимонад 22 000 + доставка 15 000
  assert.match(body.eta, /Доставим за/);

  await new Promise((resolve) => setTimeout(resolve, 300)); // уведомление администратору уходит асинхронно
  const adminMessage = calls.find((call) => call.method === 'sendMessage' && call.payload.chat_id === ADMIN.id);
  assert.ok(adminMessage, 'администратор получил заказ');
  assert.match(textOf(adminMessage), new RegExp(`Новый заказ №${firstOrderId}`));
  assert.match(textOf(adminMessage), /Ташкентский плов × 1 — 55 000 сум/);
  assert.match(textOf(adminMessage), /ул\. Навои, 12, кв\. 5/);
  assert.deepEqual(
    buttons(adminMessage).map((b) => b.callback_data),
    [`st:${firstOrderId}:ACCEPTED`, `st:${firstOrderId}:CANCELLED`],
  );

  const order = await prisma.order.findUnique({ where: { id: firstOrderId } });
  assert.equal(order.status, 'NEW');
  assert.equal(Number(order.total), 92000);
  assert.equal(order.phone, '+998901234567');
  assert.equal(await prisma.cartItem.count({ where: { userId: BigInt(CUSTOMER.id) } }), 0);

  const bootstrap = await api(CUSTOMER, '/bootstrap');
  assert.equal(bootstrap.body.user.name, 'Алишер');
  assert.equal(bootstrap.body.user.phone, '+998901234567');
});

test('администратор меняет статусы, клиент получает уведомления', async () => {
  let out = await press(ADMIN, `st:${firstOrderId}:ACCEPTED`);
  assert.match(textOf(byMethod(out, 'editMessageText')[0]), /Статус: <b>✅ Принят<\/b>/);
  assert.match(allText(byMethod(out, 'sendMessage')), new RegExp(`Ваш заказ №${firstOrderId} принят`));

  out = await press(ADMIN, `st:${firstOrderId}:ACCEPTED`);
  assert.match(alertText(out), /уже изменён/);

  out = await press(ADMIN, `st:${firstOrderId}:COOKING`);
  assert.match(allText(byMethod(out, 'sendMessage')), /готовится/);

  out = await press(ADMIN, `st:${firstOrderId}:DELIVERING`);
  assert.match(allText(byMethod(out, 'sendMessage')), /Курьер везёт/);

  out = await press(ADMIN, `st:${firstOrderId}:COMPLETED`);
  const finalCard = byMethod(out, 'editMessageText')[0];
  assert.match(textOf(finalCard), /Выполнен/);
  assert.equal(finalCard.payload.reply_markup, undefined);
  assert.match(allText(byMethod(out, 'sendMessage')), /выполнен/);

  out = await press(CUSTOMER, `st:${firstOrderId}:CANCELLED:y`);
  assert.match(alertText(out), /Нет доступа/);

  const { body } = await api(CUSTOMER, '/orders');
  const order = body.find((item) => item.id === firstOrderId);
  assert.equal(order.status, 'COMPLETED');
  assert.equal(order.canCancel, false);
  assert.equal(order.statusText, '🏁 Выполнен');
});

test('Mini App: повтор и отмена заказа клиентом', async () => {
  let { body } = await api(CUSTOMER, `/orders/${firstOrderId}/repeat`, { method: 'POST' });
  assert.equal(body.cart.count, 2);
  assert.deepEqual(body.skipped, []);
  await api(CUSTOMER, '/cart/clear', { method: 'POST' });

  assert.equal((await api(CUSTOMER, '/orders/abc/cancel', { method: 'POST' })).status, 404);
  assert.equal((await api(STRANGER, `/orders/${firstOrderId}/repeat`, { method: 'POST' })).status, 404);

  const cannotCancel = await api(CUSTOMER, `/orders/${firstOrderId}/cancel`, { method: 'POST' });
  assert.equal(cannotCancel.status, 409);
  assert.equal(cannotCancel.body.error, 'CANNOT_CANCEL');
  assert.match(cannotCancel.body.message, /Заказ уже в работе/);

  await api(CUSTOMER, '/cart/items', { method: 'POST', body: { productId: 'plov', quantity: 1 } });
  const created = await api(CUSTOMER, '/checkout', {
    method: 'POST',
    body: { method: 'PICKUP', name: 'Алишер', phone: '+998901234567', paymentIndex: 0 },
  });
  const secondOrderId = created.body.orderId;

  calls = [];
  const cancelled = await api(CUSTOMER, `/orders/${secondOrderId}/cancel`, { method: 'POST' });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.status, 'CANCELLED');

  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.match(allText(calls.filter((call) => call.method === 'sendMessage')), /Клиент отменил заказ/);

  const repeatSource = await api(CUSTOMER, `/orders/${secondOrderId}/repeat`, { method: 'POST' });
  assert.equal(repeatSource.status, 200); // повторить можно даже отменённый заказ
});

test('панель администратора: доступ, статистика, стоп-лист, пауза, обновление данных', async () => {
  let out = await sendText(STRANGER, '/admin');
  assert.match(allText(out), /Нет доступа/);

  out = await sendText(ADMIN, '/admin');
  assert.match(allText(out), /Панель администратора/);

  out = await press(ADMIN, 'adm:stats:today');
  const stats = allText(out);
  assert.match(stats, /Заказов: <b>1<\/b>/); // только выполненный заказ, отменённый не считается
  assert.match(stats, /Выручка: <b>92 000 сум<\/b>/);

  out = await press(ADMIN, 'adm:toggle:diablo');
  assert.match(alertText(out), /нет в наличии/);
  let bad = await api(CUSTOMER, '/cart/items', { method: 'POST', body: { productId: 'diablo', quantity: 1 } });
  assert.equal(bad.status, 409);
  const bootstrap = await api(CUSTOMER, '/bootstrap');
  assert.equal(bootstrap.body.categories.flatMap((c) => c.products).find((p) => p.id === 'diablo').inStock, false);
  await press(ADMIN, 'adm:toggle:diablo');

  await press(ADMIN, 'adm:pause');
  await api(CUSTOMER, '/cart/items', { method: 'POST', body: { productId: 'plov', quantity: 1 } });
  const blocked = await api(CUSTOMER, '/checkout', {
    method: 'POST',
    body: { method: 'PICKUP', name: 'Азиз', phone: '+998901234567', paymentIndex: 0 },
  });
  assert.equal(blocked.body.error, 'PAUSED');
  await press(ADMIN, 'adm:pause');
  await api(CUSTOMER, '/cart/clear', { method: 'POST' });

  out = await press(ADMIN, 'adm:reload');
  assert.match(allText(out), /Данные обновлены/);
  restaurant.data.orders.acceptWhenClosed = true; // reload перечитал файл — возвращаем тестовый режим
});

test('AI-помощник: без ключа, с ключом и ссылкой на блюдо в Mini App', async () => {
  let out = await sendText(CUSTOMER, 'до скольки вы работаете?');
  assert.match(allText(out), /AI-помощник пока не подключён/);
  assert.equal(buttons(byMethod(out, 'sendMessage')[0])[0].web_app.url, baseUrl);

  config.ai.apiKey = 'test-key';
  aiReply = { answer: 'Самые острые:\n• Диабло — 85 000 сум', dish_ids: ['diablo', 'no-such-dish'], found_in_data: true };
  out = await sendText(CUSTOMER, 'Что у вас самое острое?');
  const reply = byMethod(out, 'sendMessage')[0];
  assert.match(textOf(reply), /Самые острые/);
  const dishButton = buttons(reply)[0];
  assert.equal(new URL(dishButton.web_app.url).searchParams.get('dish'), 'diablo');

  const request = aiRequests.at(-1);
  assert.equal(request.body.model, 'claude-opus-5');
  assert.match(request.body.messages[0].content, /Что у вас самое острое\?/);
  config.ai.apiKey = null;

  // Вопрос сохраняется в фоне — дожидаемся записи, чтобы очистка после тестов её удалила
  let saved = 0;
  for (let attempt = 0; attempt < 20 && !saved; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    saved = await prisma.aiQuestion.count({ where: { userId: BigInt(CUSTOMER.id) } });
  }
  assert.equal(saved, 1);
});
