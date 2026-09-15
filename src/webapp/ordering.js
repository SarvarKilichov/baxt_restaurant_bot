import { restaurant } from '../core/restaurant.js';
import { t } from '../core/i18n.js';
import { getSetting } from '../models/Setting.js';
import { getOpenStatus, describeOpening } from '../services/hours.service.js';

// Можно ли сейчас принимать заказы. Возвращает null, если можно, иначе { code, message }
export function checkOrderingAllowed(lang) {
  if (getSetting('ordersPaused')) {
    return { code: 'PAUSED', message: t(lang, 'checkout.paused', { phone: restaurant.data.contacts.phone ?? '' }) };
  }
  if (!restaurant.data.orders.acceptWhenClosed) {
    const status = getOpenStatus();
    if (!status.open) {
      return { code: 'CLOSED', message: t(lang, 'checkout.closed', { when: describeOpening(lang, status) }) };
    }
  }
  return null;
}
