import { prisma } from '../database/connection.js';
import { getProduct } from './Product.js';
import { roundMoney } from '../utils/format.js';
import { log } from '../utils/logger.js';

export const MAX_QUANTITY = 50;

// Корзины в памяти: userId → Map(productId → количество). Каждое изменение сохраняется в базу
const carts = new Map();
const MAX_CACHED_CARTS = 10_000;

async function loadItems(userId) {
  const key = String(userId);
  if (carts.has(key)) return carts.get(key);
  const rows = await prisma.cartItem.findMany({
    where: { userId: BigInt(userId) },
    orderBy: { createdAt: 'asc' },
  });
  const items = new Map(rows.map((row) => [row.productId, row.quantity]));
  carts.set(key, items);
  if (carts.size > MAX_CACHED_CARTS) carts.delete(carts.keys().next().value);
  return items;
}

export async function getQuantity(userId, productId) {
  const items = await loadItems(userId);
  return items.get(productId) ?? 0;
}

export async function setQuantity(userId, productId, quantity) {
  const items = await loadItems(userId);
  const next = Math.max(0, Math.min(MAX_QUANTITY, quantity));
  if (next === 0) {
    if (!items.has(productId)) return 0;
    await prisma.cartItem.deleteMany({ where: { userId: BigInt(userId), productId } });
    items.delete(productId);
    return 0;
  }
  await prisma.cartItem.upsert({
    where: { userId_productId: { userId: BigInt(userId), productId } },
    create: { userId: BigInt(userId), productId, quantity: next },
    update: { quantity: next },
  });
  items.set(productId, next);
  return next;
}

export async function changeQuantity(userId, productId, delta) {
  const current = await getQuantity(userId, productId);
  return setQuantity(userId, productId, current + delta);
}

export async function clearCart(userId) {
  await prisma.cartItem.deleteMany({ where: { userId: BigInt(userId) } });
  carts.set(String(userId), new Map());
}

// Убирает из кэша заказанные блюда (в базе их удаляет транзакция заказа)
export function forgetItems(userId, productIds) {
  const items = carts.get(String(userId));
  if (!items) return;
  for (const productId of productIds) items.delete(productId);
}

export async function getCart(userId) {
  const items = await loadItems(userId);
  const lines = [];
  const removed = [];

  for (const [productId, quantity] of items) {
    const product = getProduct(productId);
    if (!product) {
      removed.push(productId);
      continue;
    }
    lines.push({ product, quantity, total: roundMoney(product.price * quantity) });
  }

  if (removed.length) {
    for (const productId of removed) items.delete(productId);
    prisma.cartItem
      .deleteMany({ where: { userId: BigInt(userId), productId: { in: removed } } })
      .catch((error) => log.warn('Не удалось очистить корзину от удалённых блюд:', error.message));
  }

  const available = lines.filter((line) => line.product.inStock);
  const unavailable = lines.filter((line) => !line.product.inStock);

  return {
    lines,
    available,
    unavailable,
    count: available.reduce((sum, line) => sum + line.quantity, 0),
    itemsTotal: roundMoney(available.reduce((sum, line) => sum + line.total, 0)),
  };
}
