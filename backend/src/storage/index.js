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

// Видео курсов лежат в отдельном закрытом бакете (S3_VIDEO_BUCKET).
// Публичной ссылки у них нет, поэтому в базе они хранятся как
// private://<ключ>, а смотреть их можно только по подписанной ссылке.
const PRIVATE_PREFIX = 'private://';

function isPrivate(url) {
  return typeof url === 'string' && url.startsWith(PRIVATE_PREFIX);
}

function bucketFor(url) {
  return isPrivate(url) ? process.env.S3_VIDEO_BUCKET : process.env.S3_BUCKET;
}

// Из URL достаём ключ файла — нужно при удалении и подписи
function keyFromUrl(url) {
  if (!url) return null;
  if (isPrivate(url)) return url.slice(PRIVATE_PREFIX.length);
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
  async save(tempPath, key, mimeType, { private: priv = false } = {}) {
    const { Upload } = require('@aws-sdk/lib-storage');
    // закрытый бакет — только если он настроен, иначе как раньше
    const toPrivate = priv && !!process.env.S3_VIDEO_BUCKET;

    const upload = new Upload({
      client: getS3(),
      params: {
        Bucket: toPrivate ? process.env.S3_VIDEO_BUCKET : process.env.S3_BUCKET,
        Key: key,
        Body: fsSync.createReadStream(tempPath), // потоком — большие видео не грузим в память
        ContentType: mimeType,
      },
    });

    await upload.done();
    await fs.unlink(tempPath).catch(() => {});

    if (toPrivate) return PRIVATE_PREFIX + key;

    // Публичный адрес файла (R2: включить Public access у бакета)
    const base = (process.env.S3_PUBLIC_URL || '').replace(/\/$/, '');
    return `${base}/${key}`;
  },

  async remove(url) {
    const key = keyFromUrl(url);
    if (!key) return false;

    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    await getS3().send(
      new DeleteObjectCommand({ Bucket: bucketFor(url), Key: key })
    );
    return true;
  },
};

// ==========================================================
// Подписанные ссылки (для видео уроков)
//
// Без подписи ссылку на видео можно переслать кому угодно и курс
// растащат. Подпись живёт несколько часов — хватает на просмотр урока,
// но не на раздачу ссылки.
// ==========================================================
const SIGN_TTL = Number(process.env.MEDIA_LINK_TTL || 6 * 3600); // секунды

function localSign(key, exp) {
  return crypto
    .createHmac('sha256', process.env.JWT_SECRET || 'dev')
    .update(`${key}:${exp}`)
    .digest('hex')
    .slice(0, 32);
}

function checkLocalSign(key, exp, sig) {
  if (!exp || !sig || Number(exp) * 1000 < Date.now()) return false;
  const good = Buffer.from(localSign(key, exp));
  const got = Buffer.from(String(sig));
  return good.length === got.length && crypto.timingSafeEqual(good, got);
}

async function signUrl(url) {
  const key = keyFromUrl(url);
  if (!key) return url;

  if (DRIVER !== 's3') {
    const exp = Math.floor(Date.now() / 1000) + SIGN_TTL;
    return `/uploads/${key}?exp=${exp}&sig=${localSign(key, exp)}`;
  }

  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  return getSignedUrl(
    getS3(),
    new GetObjectCommand({ Bucket: bucketFor(url), Key: key }),
    { expiresIn: SIGN_TTL }
  );
}

// ==========================================================
const driver = DRIVER === 's3' ? s3Driver : localDriver;

if (DRIVER === 's3') {
  const missing = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_URL']
    .filter((k) => !process.env[k]);
  if (missing.length) {
    console.error('[storage] STORAGE_DRIVER=s3, но не заданы переменные:', missing.join(', '));
  }
  if (!process.env.S3_VIDEO_BUCKET) {
    console.warn('[storage] S3_VIDEO_BUCKET не задан — видео уходят в публичный бакет');
  }
}

console.log(`[storage] режим: ${DRIVER === 's3' ? 'S3 / R2' : 'локальная папка uploads'}`);

module.exports = {
  driver: DRIVER,
  isLocal: DRIVER !== 's3',
  makeKey,
  keyFromUrl,
  save: (tempPath, key, mimeType, opts) => driver.save(tempPath, key, mimeType, opts),
  isPrivate,
  PRIVATE_PREFIX,
  remove: (url) => driver.remove(url),
  signUrl,
  checkLocalSign,
  LOCAL_ROOT,
};
