-- Миграция 9: отдельная позиция обложки для каждого формата
-- Формат: "card|row|hero|thumb", например "50% 50%|50% 30%|50% 50%|50% 50%"
-- Запускать можно многократно.

SET client_encoding TO 'UTF8';

ALTER TABLE courses ALTER COLUMN cover_pos TYPE VARCHAR(80);
