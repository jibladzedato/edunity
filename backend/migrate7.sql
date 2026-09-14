-- Миграция 7: вход через Google
-- Запускать можно многократно.

SET client_encoding TO 'UTF8';

-- Идентификатор аккаунта в Google. Привязываемся именно к нему, а не к почте:
-- почту пользователь может сменить, а этот идентификатор постоянный.
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_google_id ON users (google_id) WHERE google_id IS NOT NULL;

-- У пользователей, вошедших через Google, своего пароля нет.
-- Колонка password_hash обязательная, поэтому для них кладётся заглушка,
-- с которой невозможно войти обычным способом.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

SELECT id, email, role, google_id FROM users ORDER BY id LIMIT 5;
