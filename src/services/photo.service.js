import fs from 'node:fs';
import path from 'node:path';
import { InputFile } from 'grammy';
import config from '../config/default.js';
import { isBlockedByUser, describeError } from '../utils/telegram.js';
import { log } from '../utils/logger.js';

const CAPTION_LIMIT = 1024;
const uploadedPhotos = new Map(); // фото → file_id Telegram (чтобы не загружать повторно)

function resolveSource(photo) {
  if (/^https?:\/\//i.test(photo)) return photo;
  const fullPath = path.join(config.restaurantDir, photo);
  return fs.existsSync(fullPath) ? new InputFile(fullPath) : null;
}

// Адрес фото для Mini App: внешняя ссылка — как есть, свой файл — через веб-сервер бота
export function publicPhotoUrl(photo) {
  if (!photo) return null;
  return /^https?:\/\//i.test(photo) ? photo : `/assets/restaurant/${photo}`;
}

const stripTags = (html) => html.replace(/<[^>]+>/g, '');
const isHtmlError = (error) => /can't parse entities/i.test(describeError(error));

// Отправляет фото с подписью. Если фото недоступно — отправляет только текст
export async function sendPhotoMessage(api, chatId, { photo, fileId, caption, other = {}, onFileId }) {
  const cachedFileId = fileId ?? (photo ? uploadedPhotos.get(photo) : undefined);
  const source = cachedFileId ?? (photo ? resolveSource(photo) : null);
  const fitsCaption = stripTags(caption).length <= CAPTION_LIMIT;

  if (source) {
    try {
      const message = await api.sendPhoto(chatId, source, fitsCaption ? { caption, parse_mode: 'HTML', ...other } : {});
      const newFileId = message.photo?.at(-1)?.file_id;
      if (photo && newFileId && newFileId !== cachedFileId) {
        uploadedPhotos.set(photo, newFileId);
        onFileId?.(newFileId);
      }
      if (fitsCaption) return message;
    } catch (error) {
      if (isBlockedByUser(error)) throw error;
      if (isHtmlError(error)) {
        log.warn(`Ошибка оформления текста (проверьте теги <b>, <i> в файлах restaurant): ${describeError(error)}`);
        return api.sendPhoto(chatId, source, { caption: stripTags(caption).slice(0, CAPTION_LIMIT), ...other });
      }
      if (cachedFileId) {
        uploadedPhotos.delete(photo);
        return sendPhotoMessage(api, chatId, { photo, caption, other, onFileId });
      }
      log.warn(`Фото «${photo}» не отправилось (${describeError(error)}) — отправляю без фото`);
    }
  }

  try {
    return await api.sendMessage(chatId, caption, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...other });
  } catch (error) {
    if (!isHtmlError(error)) throw error;
    log.warn(`Ошибка оформления текста (проверьте теги <b>, <i> в файлах restaurant): ${describeError(error)}`);
    return api.sendMessage(chatId, stripTags(caption), other);
  }
}
