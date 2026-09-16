-- Миграция 8: положение обложки (object-position)
-- Запускать можно многократно.

SET client_encoding TO 'UTF8';

ALTER TABLE courses ADD COLUMN IF NOT EXISTS cover_pos VARCHAR(20) NOT NULL DEFAULT '50% 50%';
