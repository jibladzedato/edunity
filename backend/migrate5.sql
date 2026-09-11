-- Миграция 5: подтверждение почты и восстановление пароля
-- Запускать можно многократно.

SET client_encoding TO 'UTF8';

-- Подтверждена ли почта
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;

-- ==========================================================
-- Одноразовые токены (подтверждение почты и сброс пароля)
--
-- В базе хранится не сам токен, а его SHA-256 хеш: если база утечёт,
-- по её содержимому нельзя будет войти в чужой аккаунт.
-- ==========================================================
CREATE TABLE IF NOT EXISTS auth_tokens (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        VARCHAR(20) NOT NULL,        -- 'verify_email' | 'reset_password'
    token_hash  TEXT NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_hash ON auth_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens (user_id, kind);

-- Существующие пользователи (зарегистрировались до этой функции)
-- считаются подтверждёнными, иначе они потеряют доступ на ровном месте.
UPDATE users SET email_verified = true WHERE created_at < now() AND email_verified = false;

SELECT id, email, role, email_verified FROM users ORDER BY id;
