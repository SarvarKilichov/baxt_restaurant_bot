import crypto from 'node:crypto';
import config from '../config/default.js';

// Подписанные Telegram данные считаем действительными не дольше суток
const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60;

// Проверка initData по алгоритму Telegram:
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
export function verifyInitData(initData, botToken) {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (computedHash.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(computedHash), Buffer.from(hash))) {
    return null;
  }

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > MAX_INIT_DATA_AGE_SECONDS) return null;

  let user;
  try {
    user = JSON.parse(params.get('user') ?? '');
  } catch {
    return null;
  }
  if (!user?.id) return null;

  return { user, authDate };
}

function readInitData(req) {
  const header = req.get('authorization') ?? '';
  if (header.startsWith('tma ')) return header.slice(4);
  return req.get('x-telegram-init-data') ?? '';
}

// Пропускает только запросы с подлинными данными Telegram Mini App
export function telegramAuth(req, res, next) {
  const result = verifyInitData(readInitData(req), config.botToken);
  if (!result) return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Откройте приложение заново из Telegram' });
  req.tgUser = result.user;
  next();
}
