-- Миграция 10: примерная длительность курса в часах
-- Запускать можно многократно.

SET client_encoding TO 'UTF8';

ALTER TABLE courses ADD COLUMN IF NOT EXISTS duration_hours INTEGER NOT NULL DEFAULT 0;

-- Оплаты. Пока используется только как признак «курс оплачен»,
-- заполнять её будет интеграция с банком.
CREATE TABLE IF NOT EXISTS payments (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    amount      INTEGER NOT NULL,
    provider    VARCHAR(20) NOT NULL DEFAULT 'bog',
    order_id    VARCHAR(80),
    status      VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_user_course_idx ON payments (user_id, course_id);
