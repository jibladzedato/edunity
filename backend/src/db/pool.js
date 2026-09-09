const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('\n[EDUNITY] DATABASE_URL не задан.');
  console.error('Скопируй .env.example в .env и впиши строку подключения к своей базе.\n');
}

// SSL включается ЯВНО, а не угадывается по строке подключения:
//   DB_SSL=1               — включить (нужно для Neon / Supabase / Render)
//   sslmode=require в URL  — тоже включает
// По умолчанию SSL выключен: локальный PostgreSQL его не поддерживает
// и падает с "The server does not support SSL connections".
const url = process.env.DATABASE_URL || '';
const useSSL = process.env.DB_SSL === '1' || /sslmode=require/.test(url);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Неожиданная ошибка на клиенте пула PostgreSQL', err);
});

module.exports = pool;
