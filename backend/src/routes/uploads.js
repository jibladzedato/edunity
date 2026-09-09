const express = require('express');
const multer = require('multer');
const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { removeIfOrphan, isReferenced } = require('../db/uploads-cleanup');
const storage = require('../storage');

const router = express.Router();

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'];

const MAX_IMAGE = 8 * 1024 * 1024; // 8 МБ
const MAX_VIDEO = 300 * 1024 * 1024; // 300 МБ

// Файл сначала пишется во временную папку, потом хранилище само решает,
// оставить его на диске или отправить в облако.
const tempStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, os.tmpdir()),
  filename: (req, file, cb) => cb(null, 'edunity-' + Date.now() + '-' + Math.random().toString(16).slice(2)),
});

function makeUploader(allowedTypes, maxSize) {
  return multer({
    storage: tempStorage,
    limits: { fileSize: maxSize },
    fileFilter(req, file, cb) {
      if (!allowedTypes.includes(file.mimetype)) return cb(new Error('ფაილის ტიპი არ არის დაშვებული'));
      cb(null, true);
    },
  }).single('file');
}

const uploadImage = makeUploader(IMAGE_TYPES, MAX_IMAGE);
const uploadVideo = makeUploader(VIDEO_TYPES, MAX_VIDEO);

function handleUpload(uploader, kind, maxSize) {
  return (req, res) => {
    uploader(req, res, async (err) => {
      if (err) {
        const isSize = err.code === 'LIMIT_FILE_SIZE';
        return res.status(400).json({
          error: isSize
            ? `ფაილი ძალიან დიდია (მაქსიმუმ ${Math.round(maxSize / 1024 / 1024)} MB)`
            : err.message,
        });
      }
      if (!req.file) return res.status(400).json({ error: 'ფაილი არ არის არჩეული' });

      try {
        const key = storage.makeKey(req.file.originalname);
        const url = await storage.save(req.file.path, key, req.file.mimetype);

        await pool.query(
          `INSERT INTO uploads (user_id, filename, url, mime_type, size_bytes, kind)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [req.userId, req.file.originalname, url, req.file.mimetype, req.file.size, kind]
        );

        res.status(201).json({ url, kind, mimeType: req.file.mimetype, size: req.file.size });
      } catch (e) {
        console.error('Ошибка сохранения файла:', e);
        await fs.unlink(req.file.path).catch(() => {});
        res.status(500).json({ error: 'ფაილის შენახვა ვერ მოხერხდა' });
      }
    });
  };
}

router.post('/image', requireAuth, handleUpload(uploadImage, 'image', MAX_IMAGE));
router.post('/video', requireAuth, handleUpload(uploadVideo, 'video', MAX_VIDEO));

// GET /api/uploads/my — библиотека файлов пользователя
router.get('/my', requireAuth, async (req, res) => {
  try {
    const kind = req.query.kind;
    const params = [req.userId];
    let where = 'user_id = $1';
    if (kind === 'image' || kind === 'video') {
      params.push(kind);
      where += ` AND kind = $${params.length}`;
    }
    const r = await pool.query(
      `SELECT id, filename, url, mime_type, size_bytes, kind, created_at
         FROM uploads WHERE ${where} ORDER BY created_at DESC LIMIT 60`,
      params
    );
    res.json(
      r.rows.map((u) => ({
        id: u.id,
        filename: u.filename,
        url: u.url,
        mimeType: u.mime_type,
        size: Number(u.size_bytes),
        kind: u.kind,
        createdAt: u.created_at,
      }))
    );
  } catch (err) {
    console.error('Ошибка получения загрузок:', err);
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
});

// DELETE /api/uploads?url=... — удалить свой файл
router.delete('/', requireAuth, async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url არ არის მითითებული' });

  try {
    const own = await pool.query('SELECT id FROM uploads WHERE url = $1 AND user_id = $2', [url, req.userId]);
    if (own.rows.length === 0) return res.status(403).json({ error: 'ეს ფაილი თქვენი არ არის' });

    if (await isReferenced(url)) {
      return res.status(409).json({ error: 'ფაილი გამოიყენება — ჯერ მოხსენი კურსიდან ან ნაბიჯიდან' });
    }

    await removeIfOrphan(url);
    res.json({ ok: true });
  } catch (err) {
    console.error('Ошибка удаления файла:', err);
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
});

// GET /api/uploads/storage — сколько занимают мои файлы
router.get('/storage', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT COUNT(*) AS files, COALESCE(SUM(size_bytes), 0) AS bytes FROM uploads WHERE user_id = $1',
      [req.userId]
    );
    res.json({ files: Number(r.rows[0].files), bytes: Number(r.rows[0].bytes) });
  } catch (err) {
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
});

module.exports = router;
