import config from '../config/default.js';
import { log } from '../utils/logger.js';

// Открывает публичный HTTPS-адрес для Mini App через ngrok. Возвращает null, если это не настроено
export async function startMiniAppTunnel(port) {
  if (config.webapp.url) return config.webapp.url;
  if (!config.webapp.ngrokAuthtoken) return null;

  try {
    const ngrok = await import('@ngrok/ngrok');
    const listener = await ngrok.forward({
      addr: port,
      authtoken: config.webapp.ngrokAuthtoken,
      ...(config.webapp.ngrokDomain ? { domain: config.webapp.ngrokDomain } : {}),
    });
    return listener.url();
  } catch (error) {
    log.error(`Не удалось открыть туннель ngrok: ${error?.message ?? error}`);
    log.error('Проверьте NGROK_AUTHTOKEN в .env — получить его можно на https://dashboard.ngrok.com/get-started/your-authtoken');
    return null;
  }
}
