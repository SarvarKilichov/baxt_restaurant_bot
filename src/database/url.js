// Приводит строку подключения PostgreSQL к виду, который понимают драйверы.

function parse(raw) {
  try {
    return new URL(raw);
  } catch {
    throw new Error('DATABASE_URL в файле .env заполнен неверно — скопируйте строку подключения из Neon заново');
  }
}

// Для приложения: драйвер pg не поддерживает channel_binding, а sslmode=require считает устаревшим
export function appDatabaseUrl(raw) {
  const url = parse(raw);
  url.searchParams.delete('channel_binding');
  if (['prefer', 'require', 'verify-ca'].includes(url.searchParams.get('sslmode'))) {
    url.searchParams.set('sslmode', 'verify-full');
  }
  return url.toString();
}

// Для миграций: Neon требует прямое подключение, без пула (-pooler)
export function migrationDatabaseUrl(raw) {
  if (!raw) return undefined;
  const url = parse(raw);
  url.hostname = url.hostname.replace('-pooler.', '.');
  url.searchParams.delete('channel_binding');
  return url.toString();
}
