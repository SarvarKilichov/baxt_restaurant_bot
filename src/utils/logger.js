const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function write(level, prefix, args) {
  if (LEVELS[level] > currentLevel) return;
  const time = new Date().toLocaleTimeString('ru-RU', { hour12: false });
  const output = level === 'error' || level === 'warn' ? console.error : console.log;
  output(`[${time}] ${prefix}`, ...args);
}

export const log = {
  error: (...args) => write('error', '❌', args),
  warn: (...args) => write('warn', '⚠️ ', args),
  info: (...args) => write('info', '•', args),
  debug: (...args) => write('debug', '·', args),
};
