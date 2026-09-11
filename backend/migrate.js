// Прогоняет все SQL-миграции по порядку.
// На хостинге запускается автоматически перед стартом сервера,
// чтобы не заходить в базу руками после каждого обновления.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./src/db/pool');

const FILES = ['schema.sql', 'migrate.sql', 'migrate2.sql', 'migrate3.sql', 'migrate4.sql', 'migrate5.sql'];

(async () => {
  for (const file of FILES) {
    const full = path.join(__dirname, file);
    if (!fs.existsSync(full)) {
      console.log(`- ${file}: нет файла, пропускаю`);
      continue;
    }
    try {
      await pool.query(fs.readFileSync(full, 'utf8'));
      console.log(`+ ${file}: применён`);
    } catch (err) {
      // Миграции написаны так, что повторный запуск безопасен.
      // Ошибку показываем, но деплой не валим.
      console.error(`! ${file}: ${err.message}`);
    }
  }
  console.log('Миграции завершены.');
  process.exit(0);
})();
