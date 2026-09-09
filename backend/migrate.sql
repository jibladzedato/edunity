-- Миграция для тех, у кого таблица users создавалась по СТАРОЙ схеме.
-- CREATE TABLE IF NOT EXISTS её пропускает, поэтому новые колонки нужно добавить отдельно.
-- Запускать безопасно сколько угодно раз: IF NOT EXISTS.

SET client_encoding TO 'UTF8';

ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Проверка: должно показать все колонки таблицы users
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'users'
 ORDER BY ordinal_position;
