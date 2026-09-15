// Прогоняет все SQL-миграции по порядку.
// На хостинге запускается автоматически перед стартом сервера,
// чтобы не заходить в базу руками после каждого обновления.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./src/db/pool');

const FILES = ['schema.sql', 'migrate.sql', 'migrate2.sql', 'migrate3.sql', 'migrate4.sql', 'migrate5.sql', 'migrate6.sql', 'migrate7.sql'];

(async () => {
  // Запоминаем, какие миграции уже применялись. Без этого файл вроде
  // migrate5.sql выполнялся при каждом деплое — и его UPDATE каждый раз
  // перезаписывал данные пользователей.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name)
  );

  for (const file of FILES) {
    const full = path.join(__dirname, file);
    if (!fs.existsSync(full)) {
      console.log(`- ${file}: нет файла, пропускаю`);
      continue;
    }
    if (applied.has(file)) {
      console.log(`= ${file}: уже применён`);
      continue;
    }

    try {
      await pool.query(fs.readFileSync(full, 'utf8'));
      await pool.query('INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
      console.log(`+ ${file}: применён`);
    } catch (err) {
      // Ошибку показываем, но деплой не валим — миграции написаны так,
      // что повторный запуск безопасен.
      console.error(`! ${file}: ${err.message}`);
    }
  }

  console.log('Миграции завершены.');
  process.exit(0);
})();
