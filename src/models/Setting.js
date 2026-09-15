import { prisma } from '../database/connection.js';

const DEFAULTS = {
  ordersPaused: false,
};

const values = { ...DEFAULTS };

export async function loadSettings() {
  const rows = await prisma.setting.findMany();
  for (const row of rows) values[row.key] = row.value;
}

export function getSetting(key) {
  return values[key] ?? DEFAULTS[key];
}

export async function setSetting(key, value) {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
  values[key] = value;
}
