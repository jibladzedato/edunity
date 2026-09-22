// Перенос уже загруженных видео из публичного бакета в закрытый.
//
// Запуск (один раз, с компьютера, с теми же переменными, что на Render):
//   node move-videos.js          — только показать, что будет перенесено
//   node move-videos.js --run    — перенести
//
// Что делает для каждого видео шага:
//   1) копирует файл из S3_BUCKET в S3_VIDEO_BUCKET под тем же ключом,
//   2) меняет ссылку в шаге и в таблице uploads на private://<ключ>,
//   3) удаляет файл из публичного бакета.
// Если на шаге 1 или 2 ошибка — оригинал остаётся на месте.

require('dotenv').config();
const pool = require('./src/db/pool');
const storage = require('./src/storage');
const { CopyObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { S3Client } = require('@aws-sdk/client-s3');

const RUN = process.argv.includes('--run');

const need = ['DATABASE_URL', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_VIDEO_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_URL'];
const missing = need.filter((k) => !process.env[k]);
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

async function main() {
  const base = process.env.S3_PUBLIC_URL.replace(/\/$/, '');
  const r = await pool.query(
    `SELECT DISTINCT content->>'url' AS url FROM steps WHERE type = 'video' AND content->>'url' LIKE $1`,
    [base + '/%']
  );

  console.log(`Видео в публичном бакете: ${r.rows.length}${RUN ? '' : ' (пробный запуск, добавь --run)'}`);

  let moved = 0;
  for (const { url } of r.rows) {
    const key = storage.keyFromUrl(url);
    const privateUrl = storage.PRIVATE_PREFIX + key;
    console.log(key);
    if (!RUN) continue;

    try {
      await s3.send(new CopyObjectCommand({
        Bucket: process.env.S3_VIDEO_BUCKET,
        Key: key,
        CopySource: `${process.env.S3_BUCKET}/${key}`,
      }));

      // одна и та же ссылка могла стоять в нескольких шагах
      await pool.query(
        `UPDATE steps SET content = jsonb_set(content, '{url}', to_jsonb($1::text)) WHERE content->>'url' = $2`,
        [privateUrl, url]
      );
      await pool.query('UPDATE uploads SET url = $1 WHERE url = $2', [privateUrl, url]);

      await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
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
