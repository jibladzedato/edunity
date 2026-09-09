-- Миграция 2: блокировка курсов админом + промо-блоки на главной
-- Запускать можно многократно.

SET client_encoding TO 'UTF8';

-- ==========================================================
-- Блокировка курса администратором
-- courses.status теперь: 'draft' | 'published' | 'blocked'
-- ==========================================================
ALTER TABLE courses ADD COLUMN IF NOT EXISTS blocked_reason TEXT;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;

-- ==========================================================
-- Что продвигаем на главной (управляется из админки)
-- kind: 'course' | 'instructor'
-- ==========================================================
CREATE TABLE IF NOT EXISTS featured (
    id         SERIAL PRIMARY KEY,
    kind       VARCHAR(20) NOT NULL,
    course_id  INTEGER REFERENCES courses(id) ON DELETE CASCADE,
    user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_featured_kind ON featured (kind, position);

-- Один курс/лектор не может быть добавлен дважды
CREATE UNIQUE INDEX IF NOT EXISTS uq_featured_course ON featured (course_id) WHERE course_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_featured_user ON featured (user_id) WHERE user_id IS NOT NULL;

-- ==========================================================
-- Загруженные файлы
-- ==========================================================
CREATE TABLE IF NOT EXISTS uploads (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,
    url         TEXT NOT NULL,
    mime_type   VARCHAR(100),
    size_bytes  BIGINT,
    kind        VARCHAR(20),  -- 'image' | 'video'
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_uploads_user ON uploads (user_id, created_at DESC);

-- ==========================================================
-- Сделать первого зарегистрированного пользователя админом,
-- если админа ещё нет вообще.
-- ==========================================================
UPDATE users SET role = 'admin'
 WHERE id = (SELECT MIN(id) FROM users)
   AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin');

SELECT id, name, email, role FROM users ORDER BY id;
