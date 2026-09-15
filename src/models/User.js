import { prisma, Prisma } from '../database/connection.js';

// Кэш клиентов в памяти, чтобы не ходить в базу на каждое нажатие кнопки
const cache = new Map();
const MAX_CACHED_USERS = 10_000;

function cacheUser(user) {
  const key = String(user.id);
  cache.delete(key);
  cache.set(key, user);
  if (cache.size > MAX_CACHED_USERS) cache.delete(cache.keys().next().value);
  return user;
}

export async function findOrCreateUser(from) {
  let user = cache.get(String(from.id));
  if (!user) {
    user = cacheUser(
      await prisma.user.upsert({
        where: { id: BigInt(from.id) },
        create: {
          id: BigInt(from.id),
          firstName: from.first_name ?? null,
          lastName: from.last_name ?? null,
          username: from.username ?? null,
        },
        update: {},
      }),
    );
  }

  const changes = {};
  if (user.firstName !== (from.first_name ?? null)) changes.firstName = from.first_name ?? null;
  if (user.lastName !== (from.last_name ?? null)) changes.lastName = from.last_name ?? null;
  if (user.username !== (from.username ?? null)) changes.username = from.username ?? null;
  if (user.isBlocked) changes.isBlocked = false;
  return Object.keys(changes).length ? updateUser(from.id, changes) : user;
}

export async function updateUser(id, data) {
  const values = { ...data };
  if ('checkout' in values && values.checkout === null) values.checkout = Prisma.DbNull;
  return cacheUser(await prisma.user.update({ where: { id: BigInt(id) }, data: values }));
}

export function rememberUser(user) {
  cacheUser(user);
}

export async function findUser(id) {
  return cache.get(String(id)) ?? prisma.user.findUnique({ where: { id: BigInt(id) } });
}

export async function markBlocked(id, isBlocked) {
  try {
    await updateUser(id, { isBlocked });
  } catch {
    // клиента ещё нет в базе
  }
}
