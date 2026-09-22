// Перенос содержимого курсов (видео и картинок уроков) из публичного
// бакета в закрытый. Обложки, аватары и иконки не трогаются.
//
// Запуск с компьютера из папки backend, с .env как на Render:
//   node move-to-private.js          — только показать список
//   node move-to-private.js --run    — перенести
//
// Для каждого файла: копия в закрытый бакет → ссылки в шагах и в uploads
// меняются на private://<ключ> → оригинал удаляется из публичного бакета
// (если он не используется как обложка или аватар).
// При ошибке на любом шаге оригинал остаётся на месте.

require('dotenv').config();
const pool = require('./src/db/pool');
const storage = require('./src/storage');
const { S3Client, CopyObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const RUN = process.argv.includes('--run');
const PRIVATE_BUCKET = process.env.S3_PRIVATE_BUCKET || process.env.S3_VIDEO_BUCKET;

const need = ['DATABASE_URL', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_URL'];
const missing = need.filter((k) => !process.env[k]);
if (!PRIVATE_BUCKET) missing.push('S3_PRIVATE_BUCKET');
if (missing.length) {
  console.error('Не заданы переменные:', missing.join(', '));
  process.exit(1);
}

const s3 = new S3Client({
  region: process.env.S3_REGION || 'auto',
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function main() {
  const base = process.env.S3_PUBLIC_URL.replace(/\/$/, '');
  const re = new RegExp(escapeRe(base) + '/[^"\'\\s<>]+', 'g');

  // все публичные ссылки внутри содержимого шагов (видео, картинки, HTML)
  const steps = await pool.query(`SELECT content::text AS text FROM steps WHERE content::text LIKE $1`, ['%' + base + '/%']);
  const urls = new Set();
  for (const row of steps.rows) for (const u of row.text.match(re) || []) urls.add(u);

  console.log(`Файлов в публичном бакете: ${urls.size}${RUN ? '' : ' (пробный запуск, добавь --run)'}`);

  let moved = 0;
  for (const url of urls) {
    const key = storage.keyFromUrl(url);
    const privateUrl = storage.PRIVATE_PREFIX + key;
    console.log(key);
    if (!RUN) continue;

    try {
      await s3.send(new CopyObjectCommand({
        Bucket: PRIVATE_BUCKET,
        Key: key,
        CopySource: `${process.env.S3_BUCKET}/${key}`,
      }));

      await pool.query(
        `UPDATE steps SET content = replace(content::text, $1, $2)::jsonb WHERE content::text LIKE $3`,
        [url, privateUrl, '%' + url + '%']
      );

      // если этот же файл ещё и обложка/аватар — в публичном оставляем
      const used = await pool.query(
        `SELECT 1 FROM courses WHERE cover_url = $1 UNION ALL SELECT 1 FROM users WHERE avatar_url = $1 LIMIT 1`,
        [url]
      );
      if (used.rows.length === 0) {
        await pool.query('UPDATE uploads SET url = $1 WHERE url = $2', [privateUrl, url]);
        await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
      }
      moved++;
    } catch (err) {
      console.error(`  ошибка, оригинал не тронут: ${err.message}`);
    }
  }

  if (RUN) console.log(`Готово, перенесено: ${moved}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
