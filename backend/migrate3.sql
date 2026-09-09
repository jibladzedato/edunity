-- Миграция 3: категории в базе (раньше были захардкожены в JS)
-- Запускать можно многократно.

SET client_encoding TO 'UTF8';

CREATE TABLE IF NOT EXISTS categories (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(100) NOT NULL UNIQUE,
    slug       VARCHAR(100),
    icon       VARCHAR(100),          -- имя файла иконки в assets
    position   INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_categories_position ON categories (position);

-- Переносим текущие категории, чтобы ничего не потерялось
INSERT INTO categories (name, icon, position) VALUES
    ('პროგრამირება',           'programireba.svg',        1),
    ('ხელოვნური ინტელექტი',    'xelovnuri-inteleqti.svg', 2),
    ('მარკეტინგი',             'marketingi.svg',          3),
    ('UX/UI დიზაინი',          'ux-ui.svg',               4),
    ('ვიდეო ედითინგი',         'video-editingi.svg',      5),
    ('გრაფიკული დიზაინი',      'grafikuli-dizaini.svg',   6)
ON CONFLICT (name) DO NOTHING;

SELECT id, name, position FROM categories ORDER BY position;
