-- Файл сохранён в UTF-8. На Windows psql по умолчанию читает в WIN1252
-- и падает на кириллице/грузинском — эта строка переключает кодировку.
SET client_encoding TO 'UTF8';

-- EDUNITY: схема базы данных (PostgreSQL)
-- Иерархия контента: კურსი → მოდული (глава) → გაკვეთილი (урок) → ნაბიჯი (шаг)

-- ==========================================================
-- Пользователи
-- ==========================================================
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(100) NOT NULL,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          VARCHAR(20) NOT NULL DEFAULT 'student', -- 'student' | 'instructor' | 'admin'
    avatar_url    TEXT,
    bio           TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (LOWER(email));

-- ==========================================================
-- Курсы
-- ==========================================================
CREATE TABLE IF NOT EXISTS courses (
    id               SERIAL PRIMARY KEY,
    author_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title            VARCHAR(200) NOT NULL,
    summary          TEXT,               -- краткое описание (в каталоге)
    description      TEXT,               -- полное описание (страница курса)
    cover_url        TEXT,               -- обложка/превью
    category         VARCHAR(100),
    price            INTEGER NOT NULL DEFAULT 0,
    has_certificate  BOOLEAN NOT NULL DEFAULT false,
    level            VARCHAR(20),        -- 'beginner' | 'medium' | 'advanced'
    language         VARCHAR(20) DEFAULT 'ka',
    status           VARCHAR(20) NOT NULL DEFAULT 'draft', -- 'draft' | 'published'
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_courses_author ON courses (author_id);
CREATE INDEX IF NOT EXISTS idx_courses_status ON courses (status);
CREATE INDEX IF NOT EXISTS idx_courses_category ON courses (category);

-- ==========================================================
-- Модули (главы)
-- ==========================================================
CREATE TABLE IF NOT EXISTS modules (
    id         SERIAL PRIMARY KEY,
    course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title      VARCHAR(200) NOT NULL,
    position   INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_modules_course ON modules (course_id, position);

-- ==========================================================
-- Уроки
-- ==========================================================
CREATE TABLE IF NOT EXISTS lessons (
    id         SERIAL PRIMARY KEY,
    module_id  INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    title      VARCHAR(200) NOT NULL,
    position   INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lessons_module ON lessons (module_id, position);

-- ==========================================================
-- Шаги
-- content хранится в JSONB, потому что у каждого типа своя форма:
--   text:  { "html": "..." }
--   video: { "url": "..." }
--   quiz:  { "question": "...", "options": ["..."], "correct": [0], "multiple": false }
--   code:  { "statement": "...", "language": "python", "template": "..." }
-- Добавить новый тип шага = добавить обработчик на фронте, без миграции БД.
-- ==========================================================
CREATE TABLE IF NOT EXISTS steps (
    id         SERIAL PRIMARY KEY,
    lesson_id  INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    type       VARCHAR(20) NOT NULL, -- 'text' | 'video' | 'quiz' | 'code'
    position   INTEGER NOT NULL DEFAULT 1,
    content    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_steps_lesson ON steps (lesson_id, position);

-- ==========================================================
-- Запись на курс
-- ==========================================================
CREATE TABLE IF NOT EXISTS enrollments (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_enrollments_user ON enrollments (user_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_course ON enrollments (course_id);

-- ==========================================================
-- Прогресс по шагам (что пройдено)
-- ==========================================================
CREATE TABLE IF NOT EXISTS step_progress (
    id           SERIAL PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    step_id      INTEGER NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
    is_correct   BOOLEAN,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, step_id)
);

CREATE INDEX IF NOT EXISTS idx_step_progress_user ON step_progress (user_id);

-- ==========================================================
-- Комментарии к шагам (parent_id — для ответов)
-- ==========================================================
CREATE TABLE IF NOT EXISTS comments (
    id         SERIAL PRIMARY KEY,
    step_id    INTEGER NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id  INTEGER REFERENCES comments(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comments_step ON comments (step_id, created_at);

-- ==========================================================
-- Отзывы о курсе
-- ==========================================================
CREATE TABLE IF NOT EXISTS reviews (
    id         SERIAL PRIMARY KEY,
    course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating     SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    body       TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (course_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_course ON reviews (course_id);
