// Хранилище загруженных файлов.
//
// Два режима, переключаются переменной STORAGE_DRIVER в .env:
//   local (по умолчанию) — файлы лежат в backend/uploads, как сейчас.
//                          Удобно для разработки на своём компьютере.
//   s3                   — файлы уходят в Cloudflare R2 (или любое S3-совместимое
//                          хранилище). Нужно для хостинга: на бесплатных тарифах
//                          файловая система стирается при каждом передеплое,
//                          и загруженные видео просто исчезли бы.
//
// Остальной код работает с хранилищем через этот файл и не знает, какой
// режим включён — поэтому переезд не требует правок в маршрутах.

const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const crypto = require('crypto');

const DRIVER = (process.env.STORAGE_DRIVER || 'local').toLowerCase();
const LOCAL_ROOT = path.join(__dirname, '..', '..', 'uploads');

// ==========================================================
// Общее
// ==========================================================
function makeKey(originalName) {
  const now = new Date();
  const folder = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const ext = path.extname(originalName || '').toLowerCase().slice(0, 10);
  return `${folder}/${crypto.randomBytes(16).toString('hex')}${ext}`;
}

// Из URL достаём ключ файла — нужно при удалении
function keyFromUrl(url) {
  if (!url) return null;
  if (url.startsWith('/uploads/')) return url.replace('/uploads/', '');
  // полный URL вида https://pub-xxx.r2.dev/2026-09/abc.png
  const m = String(url).match(/^https?:\/\/[^/]+\/(.+)$/);
  return m ? m[1] : null;
}

// ==========================================================
// Локальный диск
// ==========================================================
const localDriver = {
  async save(tempPath, key, mimeType) {
    const dest = path.join(LOCAL_ROOT, key);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(tempPath, dest).catch(async (err) => {
      // rename не работает между разными дисками — копируем
      if (err.code !== 'EXDEV') throw err;
      await fs.copyFile(tempPath, dest);
      await fs.unlink(tempPath);
    });
    return '/uploads/' + key;
  },

  async remove(url) {
    const key = keyFromUrl(url);
    if (!key) return false;
    const abs = path.join(LOCAL_ROOT, key);
    if (!abs.startsWith(LOCAL_ROOT)) return false; // защита от выхода за папку
    await fs.unlink(abs).catch((err) => {
      if (err.code !== 'ENOENT') throw err;
    });
    return true;
  },
};

// ==========================================================
// S3-совместимое хранилище (Cloudflare R2, Backblaze B2, AWS S3)
// ==========================================================
let s3Client = null;

function getS3() {
  if (s3Client) return s3Client;
  const { S3Client } = require('@aws-sdk/client-s3');

  s3Client = new S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT, // у R2: https://<account_id>.r2.cloudflarestorage.com
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });
  return s3Client;
}

const s3Driver = {
  async save(tempPath, key, mimeType) {
    const { Upload } = require('@aws-sdk/lib-storage');

    const upload = new Upload({
      client: getS3(),
      params: {
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: fsSync.createReadStream(tempPath), // потоком — большие видео не грузим в память
        ContentType: mimeType,
      },
    });

    await upload.done();
    await fs.unlink(tempPath).catch(() => {});

    // Публичный адрес файла (R2: включить Public access у бакета)
    const base = (process.env.S3_PUBLIC_URL || '').replace(/\/$/, '');
    return `${base}/${key}`;
  },

  async remove(url) {
    const key = keyFromUrl(url);
    if (!key) return false;

    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    await getS3().send(
      new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key })
    );
    return true;
  },
};

// ==========================================================
const driver = DRIVER === 's3' ? s3Driver : localDriver;

if (DRIVER === 's3') {
  const missing = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_URL']
    .filter((k) => !process.env[k]);
  if (missing.length) {
    console.error('[storage] STORAGE_DRIVER=s3, но не заданы переменные:', missing.join(', '));
  }
}

console.log(`[storage] режим: ${DRIVER === 's3' ? 'S3 / R2' : 'локальная папка uploads'}`);

module.exports = {
  driver: DRIVER,
  isLocal: DRIVER !== 's3',
  makeKey,
  keyFromUrl,
  save: (tempPath, key, mimeType) => driver.save(tempPath, key, mimeType),
  remove: (url) => driver.remove(url),
  LOCAL_ROOT,
};
