// Сброс пароля пользователя (когда пароль забыт).
// Запуск из папки backend:
//   node reset-password.js email@example.com новыйпароль
//
// Пароль хранится в виде bcrypt-хеша, поэтому старый пароль восстановить
// невозможно — этот скрипт просто ставит новый.

require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./src/db/pool');

const [, , email, newPassword] = process.argv;

if (!email || !newPassword) {
  console.log('\nИспользование:');
  console.log('  node reset-password.js <email> <новый пароль>\n');
  console.log('Пример:');
  console.log('  node reset-password.js asd@mail.com mynewpass123\n');
  process.exit(1);
}

if (newPassword.length < 8) {
  console.error('\nПароль должен быть минимум 8 символов.\n');
  process.exit(1);
}

(async () => {
  try {
    const found = await pool.query('SELECT id, name, email, role FROM users WHERE LOWER(email) = LOWER($1)', [email]);

    if (found.rows.length === 0) {
      console.error(`\nПользователь с почтой "${email}" не найден.\n`);
      const all = await pool.query('SELECT id, name, email, role FROM users ORDER BY id');
      console.log('Существующие пользователи:');
      all.rows.forEach((u) => console.log(`  ${u.id}. ${u.name} — ${u.email} (${u.role})`));
      console.log('');
      process.exit(1);
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [hash, found.rows[0].id]);

    const u = found.rows[0];
    console.log(`\nПароль обновлён для: ${u.name} (${u.email}, роль: ${u.role})`);
    console.log(`Новый пароль: ${newPassword}\n`);
    process.exit(0);
  } catch (err) {
    console.error('\nОшибка:', err.message, '\n');
    process.exit(1);
  }
})();
