import { InlineKeyboard } from 'grammy';
import { loc } from '../core/restaurant.js';
import { t } from '../core/i18n.js';
import { getCategories } from '../models/Product.js';
import { escapeHtml, formatMoney, formatShortDateTime, truncate } from '../utils/format.js';

export function panelView(lang, { activeCount, ordersPaused, aiEnabled }) {
  const text = t(lang, 'admin.panel', {
    orders: t(lang, ordersPaused ? 'admin.ordersOff' : 'admin.ordersOn'),
    ai: t(lang, aiEnabled ? 'admin.aiOn' : 'admin.aiOff'),
    active: activeCount,
  });
  const keyboard = new InlineKeyboard()
    .text(t(lang, 'admin.activeOrders'), 'adm:active')
    .text(t(lang, 'admin.stats'), 'adm:stats:today')
    .row()
    .text(t(lang, 'admin.stopList'), 'adm:stop')
    .text(t(lang, 'admin.questions'), 'adm:questions')
    .row()
    .text(t(lang, ordersPaused ? 'admin.resume' : 'admin.pause'), 'adm:pause')
    .row()
    .text(t(lang, 'admin.reload'), 'adm:reload');
  return { text, keyboard };
}

export function activeOrdersView(lang, orders) {
  const keyboard = new InlineKeyboard();
  for (const order of orders) {
    const label = t(lang, 'admin.activeItem', {
      id: order.id,
      status: t(lang, `status.${order.status}`),
      total: formatMoney(order.total, lang),
    });
    keyboard.text(label, `adm:open:${order.id}`).row();
  }
  keyboard.text(t(lang, 'admin.back'), 'adm:panel');
  const text = orders.length ? t(lang, 'admin.activeTitle', { count: orders.length }) : t(lang, 'admin.activeEmpty');
  return { text, keyboard };
}

export function statsView(lang, period, stats) {
  const lines = [t(lang, 'admin.statsTitle', { period: t(lang, `admin.periods.${period}`) }), ''];
  if (!stats.count && !stats.cancelled) {
    lines.push(t(lang, 'admin.statsEmpty'));
  } else {
    lines.push(
      t(lang, 'admin.statsBody', {
        count: stats.count,
        revenue: formatMoney(stats.revenue, lang),
        average: formatMoney(stats.average, lang),
        cancelled: stats.cancelled,
      }),
    );
    if (stats.top.length) {
      lines.push('', t(lang, 'admin.statsTop'));
      stats.top.forEach((item, index) => {
        lines.push(
          t(lang, 'admin.statsTopLine', {
            place: index + 1,
            name: escapeHtml(loc(item.name, lang)),
            quantity: item.quantity,
          }),
        );
      });
    }
  }

  const keyboard = new InlineKeyboard();
  for (const key of ['today', 'week', 'month']) {
    keyboard.text(`${key === period ? '• ' : ''}${t(lang, `admin.periods.${key}`)}`, `adm:stats:${key}`);
  }
  keyboard.row().text(t(lang, 'admin.back'), 'adm:panel');
  return { text: lines.join('\n'), keyboard };
}

export function stopCategoriesView(lang) {
  const keyboard = new InlineKeyboard();
  for (const category of getCategories()) {
    const soldOut = category.products.filter((product) => !product.inStock).length;
    keyboard.text(`${loc(category.name, lang)}${soldOut ? ` · ⛔ ${soldOut}` : ''}`, `adm:stopcat:${category.id}`).row();
  }
  keyboard.text(t(lang, 'admin.back'), 'adm:panel');
  return { text: t(lang, 'admin.stopTitle'), keyboard };
}

export function stopCategoryView(lang, category) {
  const keyboard = new InlineKeyboard();
  for (const product of category.products) {
    keyboard.text(`${product.inStock ? '✅' : '⛔'} ${loc(product.name, lang)}`, `adm:toggle:${product.id}`).row();
  }
  keyboard.text(t(lang, 'admin.back'), 'adm:stop');
  return {
    text: t(lang, 'admin.stopCategory', { category: escapeHtml(loc(category.name, lang)) }),
    keyboard,
  };
}

export function questionsView(lang, questions) {
  const lines = questions.length
    ? [
        t(lang, 'admin.questionsTitle'),
        '',
        ...questions.map((row) =>
          t(lang, 'admin.questionLine', {
            date: formatShortDateTime(row.createdAt),
            question: escapeHtml(truncate(row.question, 150)),
          }),
        ),
      ]
    : [t(lang, 'admin.questionsEmpty')];
  return {
    text: lines.join('\n'),
    keyboard: new InlineKeyboard().text(t(lang, 'admin.back'), 'adm:panel'),
  };
}
