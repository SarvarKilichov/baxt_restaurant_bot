import { InlineKeyboard } from 'grammy';
import { loc } from '../core/restaurant.js';
import { t } from '../core/i18n.js';
import { escapeHtml, formatDateTime, formatMoney, roundMoney } from '../utils/format.js';

// Следующий статус для кнопки администратора
const NEXT_STATUS = {
  NEW: 'ACCEPTED',
  ACCEPTED: 'COOKING',
  COOKING: null, // зависит от способа получения
  DELIVERING: 'COMPLETED',
  READY: 'COMPLETED',
};

export function nextStatus(order) {
  if (order.status === 'COOKING') return order.method === 'DELIVERY' ? 'DELIVERING' : 'READY';
  return NEXT_STATUS[order.status] ?? null;
}

// Детали заказа: способ получения, контакты, блюда и суммы
export function orderDetailsLines(lang, details, { nameHtml } = {}) {
  const isDelivery = details.method === 'DELIVERY';
  const lines = [t(lang, isDelivery ? 'order.delivery' : 'order.pickup')];
  lines.push(t(lang, 'order.name', { name: nameHtml ?? escapeHtml(details.name) }));
  lines.push(t(lang, 'order.phone', { phone: escapeHtml(details.phone) }));
  if (isDelivery) {
    lines.push(t(lang, 'order.address', { address: details.address ? escapeHtml(details.address) : t(lang, 'checkout.location') }));
  }
  if (details.comment) lines.push(t(lang, 'order.comment', { comment: escapeHtml(details.comment) }));
  if (details.payment) lines.push(t(lang, 'order.payment', { payment: escapeHtml(details.payment) }));

  lines.push('');
  for (const item of details.items) {
    lines.push(
      t(lang, 'order.line', {
        name: escapeHtml(loc(item.name, lang)),
        quantity: item.quantity,
        total: formatMoney(roundMoney(item.price * item.quantity), lang),
      }),
    );
  }

  lines.push('');
  lines.push(t(lang, 'order.itemsTotal', { amount: formatMoney(details.itemsTotal, lang) }));
  if (isDelivery) {
    lines.push(
      details.deliveryFee > 0
        ? t(lang, 'order.deliveryFee', { amount: formatMoney(details.deliveryFee, lang) })
        : t(lang, 'order.deliveryFree'),
    );
  }
  lines.push(t(lang, 'order.total', { amount: formatMoney(details.total, lang) }));
  return lines;
}

function customerNameHtml(order, customer) {
  const link = `<a href="tg://user?id=${order.userId}">${escapeHtml(order.customerName)}</a>`;
  return customer?.username ? `${link} (@${escapeHtml(customer.username)})` : link;
}

export function adminOrderText(lang, order, customer, { isNew = false, changedBy } = {}) {
  const lines = [
    t(lang, isNew ? 'admin.newOrder' : 'admin.order', { id: order.id }),
    t(lang, 'admin.createdAt', { date: formatDateTime(order.createdAt) }),
    '',
    ...orderDetailsLines(
      lang,
      {
        ...order,
        name: order.customerName,
        payment: order.paymentMethod,
      },
      { nameHtml: customerNameHtml(order, customer) },
    ),
    '',
    t(lang, 'admin.status', { status: t(lang, `status.${order.status}`) }),
  ];
  if (changedBy) lines.push(t(lang, 'admin.changedBy', { name: changedBy }));
  return lines.join('\n');
}

export function adminOrderKeyboard(lang, order, { confirmCancel = false } = {}) {
  const keyboard = new InlineKeyboard();
  if (confirmCancel) {
    return keyboard
      .text(t(lang, 'admin.cancelConfirm'), `st:${order.id}:CANCELLED:y`)
      .style('danger')
      .row()
      .text(t(lang, 'admin.cancelKeep'), `adm:ord:${order.id}`);
  }
  const next = nextStatus(order);
  if (!next) return keyboard;
  return keyboard
    .text(t(lang, `admin.actions.${next}`), `st:${order.id}:${next}`)
    .style('success')
    .text(t(lang, 'admin.actions.CANCELLED'), `st:${order.id}:CANCELLED`);
}
