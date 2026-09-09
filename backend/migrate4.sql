-- Миграция 4: цвет категорий + сертификаты
-- Запускать можно многократно.

SET client_encoding TO 'UTF8';

-- ==========================================================
-- Цвет плитки категории (как на главной странице)
-- ==========================================================
ALTER TABLE categories ADD COLUMN IF NOT EXISTS color VARCHAR(20);

-- Проставляем текущие цвета с главной, чтобы вид не изменился
UPDATE categories SET color = '#EEFBF5' WHERE name = 'პროგრამირება'        AND color IS NULL;
UPDATE categories SET color = '#EAF6FF' WHERE name = 'ხელოვნური ინტელექტი' AND color IS NULL;
UPDATE categories SET color = '#FFDAF0' WHERE name = 'მარკეტინგი'          AND color IS NULL;
UPDATE categories SET color = '#FFF3D9' WHERE name = 'UX/UI დიზაინი'       AND color IS NULL;
UPDATE categories SET color = '#DCF5FF' WHERE name = 'ვიდეო ედითინგი'      AND color IS NULL;
UPDATE categories SET color = '#DFD4F4' WHERE name = 'გრაფიკული დიზაინი'   AND color IS NULL;

-- Остальным — нейтральный цвет
UPDATE categories SET color = '#F5F8F4' WHERE color IS NULL;

-- ==========================================================
-- Сертификаты
-- code — публичный код для проверки подлинности
-- ==========================================================
CREATE TABLE IF NOT EXISTS certificates (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    code       VARCHAR(32) NOT NULL UNIQUE,
    issued_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_certificates_code ON certificates (code);
CREATE INDEX IF NOT EXISTS idx_certificates_user ON certificates (user_id);

SELECT name, color, icon FROM categories ORDER BY position;
