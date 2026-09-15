import { prisma, Prisma } from '../database/connection.js';
import { rememberUser } from './User.js';
import { forgetItems } from './Cart.js';
import { roundMoney } from '../utils/format.js';

export const ACTIVE_STATUSES = ['NEW', 'ACCEPTED', 'COOKING', 'DELIVERING', 'READY'];

// Из каких статусов можно перейти в указанный
export const ALLOWED_FROM = {
  ACCEPTED: ['NEW'],
  COOKING: ['NEW', 'ACCEPTED'],
  DELIVERING: ['ACCEPTED', 'COOKING'],
  READY: ['ACCEPTED', 'COOKING'],
  COMPLETED: ['ACCEPTED', 'COOKING', 'DELIVERING', 'READY'],
  CANCELLED: ['NEW', 'ACCEPTED', 'COOKING', 'DELIVERING', 'READY'],
};

function toOrder(row) {
  return {
    ...row,
    itemsTotal: Number(row.itemsTotal),
    deliveryFee: Number(row.deliveryFee),
    total: Number(row.total),
  };
}

// Создаёт заказ, убирает заказанные блюда из корзины и запоминает контакты клиента
export async function createOrder({ userId, language, draft, cart, deliveryFee, paymentMethod }) {
  const items = cart.available.map((line) => ({
    productId: line.product.id,
    name: line.product.name,
    price: line.product.price,
    quantity: line.quantity,
  }));
  const isDelivery = draft.method === 'DELIVERY';

  const [order, , user] = await prisma.$transaction(
    [
      prisma.order.create({
        data: {
          userId: BigInt(userId),
          method: draft.method,
          items,
          itemsTotal: cart.itemsTotal,
          deliveryFee,
          total: roundMoney(cart.itemsTotal + deliveryFee),
          customerName: draft.name,
          phone: draft.phone,
          address: isDelivery ? (draft.address ?? null) : null,
          latitude: isDelivery ? (draft.latitude ?? null) : null,
          longitude: isDelivery ? (draft.longitude ?? null) : null,
          comment: draft.comment || null,
          paymentMethod,
          language,
        },
      }),
      prisma.cartItem.deleteMany({
        where: { userId: BigInt(userId), productId: { in: items.map((item) => item.productId) } },
      }),
      prisma.user.update({
        where: { id: BigInt(userId) },
        data: {
          name: draft.name,
          phone: draft.phone,
          ...(isDelivery && draft.address ? { address: draft.address } : {}),
          checkout: Prisma.DbNull,
        },
      }),
    ],
    { maxWait: 20_000, timeout: 30_000 },
  );

  rememberUser(user);
  forgetItems(userId, items.map((item) => item.productId));
  return toOrder(order);
}

export async function findOrder(id) {
  const row = await prisma.order.findUnique({ where: { id } });
  return row ? toOrder(row) : null;
}

export async function listUserOrders(userId, take = 5) {
  const rows = await prisma.order.findMany({
    where: { userId: BigInt(userId) },
    orderBy: { createdAt: 'desc' },
    take,
  });
  return rows.map(toOrder);
}

export async function listActiveOrders(take = 30) {
  const rows = await prisma.order.findMany({
    where: { status: { in: ACTIVE_STATUSES } },
    orderBy: { createdAt: 'asc' },
    take,
  });
  return rows.map(toOrder);
}

export function countActiveOrders() {
  return prisma.order.count({ where: { status: { in: ACTIVE_STATUSES } } });
}

// Статусы, которые подходят только одному способу получения
const METHOD_ONLY = { DELIVERING: 'DELIVERY', READY: 'PICKUP' };

// Меняет статус, только если заказ сейчас в подходящем статусе. Иначе возвращает null
export async function changeStatus(id, status) {
  const { count } = await prisma.order.updateMany({
    where: {
      id,
      status: { in: ALLOWED_FROM[status] ?? [] },
      ...(METHOD_ONLY[status] ? { method: METHOD_ONLY[status] } : {}),
    },
    data: { status },
  });
  return count ? findOrder(id) : null;
}

export async function cancelByCustomer(id, userId) {
  const { count } = await prisma.order.updateMany({
    where: { id, userId: BigInt(userId), status: 'NEW' },
    data: { status: 'CANCELLED' },
  });
  return count ? findOrder(id) : null;
}

export async function saveAdminMessages(id, messages) {
  await prisma.order.update({ where: { id }, data: { adminMessages: messages } });
}

export async function getStats(since) {
  const rows = await prisma.order.findMany({
    where: { createdAt: { gte: since } },
    select: { status: true, total: true, items: true },
  });
  const done = rows.filter((row) => row.status !== 'CANCELLED');
  const revenue = roundMoney(done.reduce((sum, row) => sum + Number(row.total), 0));

  const dishes = new Map();
  for (const row of done) {
    for (const item of row.items) {
      const entry = dishes.get(item.productId) ?? { name: item.name, quantity: 0 };
      entry.quantity += item.quantity;
      dishes.set(item.productId, entry);
    }
  }

  return {
    count: done.length,
    cancelled: rows.length - done.length,
    revenue,
    average: done.length ? roundMoney(revenue / done.length) : 0,
    top: [...dishes.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 5),
  };
}
