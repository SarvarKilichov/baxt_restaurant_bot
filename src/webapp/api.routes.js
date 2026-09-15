import express from 'express';
import { restaurant, loc } from '../core/restaurant.js';
import { resolveLanguage, t } from '../core/i18n.js';
import * as User from '../models/User.js';
import * as Cart from '../models/Cart.js';
import * as Product from '../models/Product.js';
import * as Order from '../models/Order.js';
import { describeOpening, getOpenStatus, hoursLines } from '../services/hours.service.js';
import { getDeliveryFee, meetsDeliveryMinimum } from '../services/pricing.service.js';
import { publicPhotoUrl } from '../services/photo.service.js';
import { notifyAdminsText, notifyNewOrder, refreshOrderCards } from '../services/notify.service.js';
import { checkOrderingAllowed } from './ordering.js';
import { formatMoney, normalizePhone } from '../utils/format.js';
import { log } from '../utils/logger.js';

const NAME_PATTERN = /^[^/].{1,59}$/s;

function userLang(req) {
  return resolveLanguage(req.dbUser, req.tgUser.language_code);
}

// Номер заказа из адреса запроса или null, если это не положительное целое число
function orderIdParam(req) {
  const id = Number(req.params.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function serializeProduct(product, lang) {
  return {
    id: product.id,
    name: loc(product.name, lang),
    description: loc(product.description, lang) || null,
    price: product.price,
    priceText: formatMoney(product.price, lang),
    oldPrice: product.oldPrice,
    oldPriceText: product.oldPrice ? formatMoney(product.oldPrice, lang) : null,
    weight: loc(product.weight, lang) || null,
    photo: publicPhotoUrl(product.photo),
    spicy: product.spicy,
    badges: product.badges,
    inStock: product.inStock,
  };
}

function serializeCart(cart, lang) {
  return {
    lines: cart.lines.map((line) => ({
      productId: line.product.id,
      quantity: line.quantity,
      total: line.total,
      totalText: formatMoney(line.total, lang),
      inStock: line.product.inStock,
      product: serializeProduct(line.product, lang),
    })),
    count: cart.count,
    itemsTotal: cart.itemsTotal,
    itemsTotalText: formatMoney(cart.itemsTotal, lang),
    hasUnavailable: cart.unavailable.length > 0,
  };
}

function serializeOrder(order, lang) {
  return {
    id: order.id,
    status: order.status,
    statusText: t(lang, `status.${order.status}`),
    method: order.method,
    total: order.total,
    totalText: formatMoney(order.total, lang),
    createdAt: order.createdAt,
    canCancel: order.status === 'NEW',
    items: order.items.map((item) => ({
      productId: item.productId,
      name: loc(item.name, lang),
      quantity: item.quantity,
      price: item.price,
      available: Boolean(Product.getProduct(item.productId)?.inStock),
    })),
  };
}

function deliverySummary(lang) {
  const { delivery, pickup } = restaurant.data;
  return {
    delivery: delivery.enabled
      ? {
          enabled: true,
          price: delivery.price,
          priceText: delivery.price > 0 ? formatMoney(delivery.price, lang) : null,
          freeFrom: delivery.freeFrom,
          freeFromText: delivery.freeFrom > 0 ? formatMoney(delivery.freeFrom, lang) : null,
          minOrder: delivery.minOrder,
          minOrderText: delivery.minOrder > 0 ? formatMoney(delivery.minOrder, lang) : null,
          time: loc(delivery.time, lang) || null,
          area: loc(delivery.area, lang) || null,
        }
      : { enabled: false },
    pickup: pickup.enabled ? { enabled: true, time: loc(pickup.time, lang) || null } : { enabled: false },
  };
}

// Предложение добавить сопутствующее блюдо, если его ещё нет в корзине
function upsellProduct(cart, lang) {
  const id = restaurant.data.upsellProductId;
  if (!id || cart.lines.some((line) => line.product.id === id)) return null;
  const product = Product.getProduct(id);
  return product?.inStock ? serializeProduct(product, lang) : null;
}

// Полная сводка для главного экрана приложения
async function buildBootstrap(req) {
  const lang = userLang(req);
  const { data } = restaurant;
  const status = getOpenStatus();
  const blocked = checkOrderingAllowed(lang);
  const cart = await Cart.getCart(req.dbUser.id);

  return {
    language: lang,
    languages: restaurant.languages,
    user: {
      id: String(req.dbUser.id),
      firstName: req.tgUser.first_name ?? null,
      name: req.dbUser.name,
      phone: req.dbUser.phone,
      address: req.dbUser.address,
    },
    restaurant: {
      name: loc(data.name, lang),
      tagline: loc(data.tagline, lang) || null,
      description: loc(data.description, lang) || null,
      welcomePhoto: publicPhotoUrl(data.welcomePhoto),
      phone: data.contacts.phone,
      address: loc(data.contacts.address, lang) || null,
      landmark: loc(data.contacts.landmark, lang) || null,
      location: data.contacts.location,
      instagram: data.contacts.instagram,
      website: data.contacts.website,
      currencyName: loc(data.currency.name, lang),
      paymentMethods: data.paymentMethods.map((method) => loc(method, lang)),
      exampleQuestions: data.exampleQuestions.map((question) => loc(question, lang)),
    },
    hours: {
      lines: hoursLines(lang),
      open: status.open,
      closesAt: status.open ? (status.closesAt ?? null) : null,
      openingText: status.open ? null : describeOpening(lang, status),
    },
    ...deliverySummary(lang),
    ordering: { allowed: !blocked, code: blocked?.code ?? null, message: blocked?.message ?? null },
    upsell: upsellProduct(cart, lang),
    categories: Product.getCategories().map((category) => ({
      id: category.id,
      name: loc(category.name, lang),
      products: category.products.map((product) => serializeProduct(product, lang)),
    })),
    cart: serializeCart(cart, lang),
  };
}

export function createApiRouter(botApi) {
  const router = express.Router();
  router.use(express.json());

  // Клиент подгружен впервые — находим/создаём пользователя по данным Telegram
  router.use(async (req, res, next) => {
    try {
      req.dbUser = await User.findOrCreateUser(req.tgUser);
      next();
    } catch (error) {
      log.error('Mini App: не удалось загрузить пользователя:', error);
      res.status(500).json({ error: 'SERVER_ERROR', message: 'Ошибка сервера' });
    }
  });

  router.get('/bootstrap', async (req, res, next) => {
    try {
      res.json(await buildBootstrap(req));
    } catch (error) {
      next(error);
    }
  });

  router.post('/language', async (req, res, next) => {
    try {
      const lang = String(req.body?.lang ?? '');
      if (!restaurant.languages.includes(lang)) return res.status(400).json({ error: 'BAD_LANGUAGE' });
      req.dbUser = await User.updateUser(req.dbUser.id, { language: lang });
      res.json(await buildBootstrap(req));
    } catch (error) {
      next(error);
    }
  });

  router.post('/cart/items', async (req, res, next) => {
    try {
      const { productId, quantity } = req.body ?? {};
      const product = Product.getProduct(String(productId ?? ''));
      const lang = userLang(req);
      if (!product) return res.status(404).json({ error: 'NOT_FOUND', message: t(lang, 'menu.notFound') });
      const desired = Math.trunc(Number(quantity));
      if (!Number.isFinite(desired) || desired < 0) return res.status(400).json({ error: 'BAD_QUANTITY' });
      if (desired > 0 && !product.inStock) {
        return res.status(409).json({ error: 'SOLD_OUT', message: t(lang, 'menu.soldOutAlert') });
      }
      await Cart.setQuantity(req.dbUser.id, product.id, desired);
      res.json(serializeCart(await Cart.getCart(req.dbUser.id), lang));
    } catch (error) {
      next(error);
    }
  });

  router.post('/cart/clear', async (req, res, next) => {
    try {
      await Cart.clearCart(req.dbUser.id);
      res.json(serializeCart(await Cart.getCart(req.dbUser.id), userLang(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post('/checkout', async (req, res, next) => {
    try {
      const lang = userLang(req);
      const blocked = checkOrderingAllowed(lang);
      if (blocked) return res.status(409).json({ error: blocked.code, message: blocked.message });

      const cart = await Cart.getCart(req.dbUser.id);
      if (!cart.available.length) {
        return res.status(409).json({ error: 'CART_EMPTY', message: t(lang, 'checkout.cartEmpty') });
      }

      const body = req.body ?? {};
      const { delivery, pickup } = restaurant.data;
      const method = body.method === 'DELIVERY' ? 'DELIVERY' : body.method === 'PICKUP' ? 'PICKUP' : null;
      if (!method || (method === 'DELIVERY' && !delivery.enabled) || (method === 'PICKUP' && !pickup.enabled)) {
        return res.status(400).json({ error: 'BAD_METHOD' });
      }
      if (method === 'DELIVERY' && !meetsDeliveryMinimum(cart.itemsTotal)) {
        return res.status(409).json({
          error: 'MIN_ORDER',
          message: t(lang, 'checkout.minOrder', {
            amount: formatMoney(delivery.minOrder, lang),
            total: formatMoney(cart.itemsTotal, lang),
          }),
        });
      }

      const name = String(body.name ?? '').trim();
      if (!NAME_PATTERN.test(name)) return res.status(400).json({ error: 'INVALID_NAME', message: t(lang, 'checkout.badName') });

      const phone = normalizePhone(body.phone);
      if (!phone) return res.status(400).json({ error: 'INVALID_PHONE', message: t(lang, 'checkout.badPhone') });

      const latitude = Number.isFinite(body.latitude) ? body.latitude : null;
      const longitude = Number.isFinite(body.longitude) ? body.longitude : null;
      const address = typeof body.address === 'string' ? body.address.trim().slice(0, 300) : '';
      if (method === 'DELIVERY' && !address && latitude == null) {
        return res.status(400).json({ error: 'INVALID_ADDRESS', message: t(lang, 'checkout.badAddress') });
      }

      let paymentMethod = null;
      if (delivery.enabled || pickup.enabled) {
        const index = Number(body.paymentIndex);
        const options = restaurant.data.paymentMethods;
        if (options.length) {
          if (!Number.isInteger(index) || !options[index]) return res.status(400).json({ error: 'INVALID_PAYMENT' });
          paymentMethod = loc(options[index], restaurant.defaultLanguage);
        }
      }

      const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 500) : '';
      const deliveryFee = method === 'DELIVERY' ? getDeliveryFee(cart.itemsTotal) : 0;

      const order = await Order.createOrder({
        userId: req.dbUser.id,
        language: lang,
        cart,
        deliveryFee,
        paymentMethod,
        draft: { method, name, phone, address: address || null, latitude, longitude, comment },
      });
      req.dbUser = await User.findUser(req.dbUser.id);
      log.info(`🆕 Заказ №${order.id} (Mini App): ${formatMoney(order.total, restaurant.defaultLanguage)}, ${order.customerName}, ${order.phone}`);

      const eta =
        method === 'DELIVERY'
          ? loc(delivery.time, lang) ? t(lang, 'checkout.etaDelivery', { time: loc(delivery.time, lang) }) : null
          : loc(pickup.time, lang) ? t(lang, 'checkout.etaPickup', { time: loc(pickup.time, lang) }) : null;

      res.json({ orderId: order.id, total: order.total, totalText: formatMoney(order.total, lang), eta });

      notifyNewOrder(botApi, order).catch((error) => log.error(`Заказ №${order.id} не отправлен администраторам:`, error));
    } catch (error) {
      next(error);
    }
  });

  router.get('/orders', async (req, res, next) => {
    try {
      const lang = userLang(req);
      const orders = await Order.listUserOrders(req.dbUser.id);
      res.json(orders.map((order) => serializeOrder(order, lang)));
    } catch (error) {
      next(error);
    }
  });

  router.post('/orders/:id/repeat', async (req, res, next) => {
    try {
      const lang = userLang(req);
      const id = orderIdParam(req);
      const order = id ? await Order.findOrder(id) : null;
      if (!order || String(order.userId) !== String(req.dbUser.id)) return res.status(404).json({ error: 'NOT_FOUND' });

      const skipped = [];
      for (const item of order.items) {
        const product = Product.getProduct(item.productId);
        if (!product?.inStock) {
          skipped.push(loc(item.name, lang));
          continue;
        }
        await Cart.changeQuantity(req.dbUser.id, product.id, item.quantity);
      }
      res.json({ cart: serializeCart(await Cart.getCart(req.dbUser.id), lang), skipped });
    } catch (error) {
      next(error);
    }
  });

  router.post('/orders/:id/cancel', async (req, res, next) => {
    try {
      const lang = userLang(req);
      const id = orderIdParam(req);
      if (!id) return res.status(404).json({ error: 'NOT_FOUND' });
      const cancelled = await Order.cancelByCustomer(id, req.dbUser.id);
      if (!cancelled) {
        const existing = await Order.findOrder(id);
        const message =
          existing && String(existing.userId) === String(req.dbUser.id)
            ? t(lang, 'orders.cannotCancel', { phone: restaurant.data.contacts.phone ?? '' })
            : undefined;
        return res.status(409).json({ error: 'CANNOT_CANCEL', message });
      }
      refreshOrderCards(botApi, cancelled).catch(() => {});
      notifyAdminsText(botApi, cancelled, t(restaurant.defaultLanguage, 'admin.customerCancelled', { id })).catch(() => {});
      res.json(serializeOrder(cancelled, lang));
    } catch (error) {
      next(error);
    }
  });

  router.use((error, req, res, _next) => {
    log.error('Mini App API:', error);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Ошибка сервера, попробуйте ещё раз' });
  });

  return router;
}
