import { adminOnly } from '../middlewares/auth.middleware.js';
import {
  changeOrderStatus,
  openOrderCard,
  reloadData,
  restoreOrderButtons,
  showActiveOrders,
  showIds,
  showPanel,
  showQuestions,
  showStats,
  showStopCategories,
  showStopCategory,
  toggleOrdersPause,
  toggleStock,
} from '../controllers/admin.controller.js';

export function registerAdminRoutes(bot) {
  bot.command('id', showIds);
  bot.command('admin', adminOnly, showPanel);

  bot.callbackQuery(/^st:(\d+):([A-Z]+)(:y)?$/, adminOnly, changeOrderStatus);
  bot.callbackQuery(/^adm:ord:(\d+)$/, adminOnly, restoreOrderButtons);
  bot.callbackQuery(/^adm:open:(\d+)$/, adminOnly, openOrderCard);
  bot.callbackQuery('adm:panel', adminOnly, showPanel);
  bot.callbackQuery('adm:active', adminOnly, showActiveOrders);
  bot.callbackQuery(/^adm:stats:(today|week|month)$/, adminOnly, showStats);
  bot.callbackQuery('adm:stop', adminOnly, showStopCategories);
  bot.callbackQuery(/^adm:stopcat:(.+)$/, adminOnly, showStopCategory);
  bot.callbackQuery(/^adm:toggle:(.+)$/, adminOnly, toggleStock);
  bot.callbackQuery('adm:questions', adminOnly, showQuestions);
  bot.callbackQuery('adm:pause', adminOnly, toggleOrdersPause);
  bot.callbackQuery('adm:reload', adminOnly, reloadData);
}
