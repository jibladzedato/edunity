const pool = require('./pool');
const storage = require('../storage');

// Проверяет, ссылается ли кто-нибудь ещё на этот файл.
// Файл может использоваться как обложка курса, аватар пользователя,
// видео шага или картинка внутри текстового шага.
async function isReferenced(url) {
  const checks = [
    ['SELECT 1 FROM courses WHERE cover_url = $1 LIMIT 1', [url]],
    ['SELECT 1 FROM users WHERE avatar_url = $1 LIMIT 1', [url]],
    [
      `SELECT 1 FROM steps
        WHERE content->>'url' = $1 OR content->>'imageUrl' = $1
        LIMIT 1`,
      [url],
    ],
  ];

  for (const [sql, params] of checks) {
    const r = await pool.query(sql, params);
    if (r.rows.length > 0) return true;
  }
  return false;
}

// Удаляет файл с диска и запись из БД, если на него больше нет ссылок.
// Безопасно вызывать с чем угодно: чужие и внешние ссылки игнорируются.
async function removeIfOrphan(url) {
  if (!url || typeof url !== 'string') return false;

  // Файл считается нашим, если он лежит в локальной папке или в нашем бакете.
  const ours = url.startsWith('/uploads/') || (process.env.S3_PUBLIC_URL && url.startsWith(process.env.S3_PUBLIC_URL));
  if (!ours) return false; // чужие и внешние ссылки не трогаем

  try {
    if (await isReferenced(url)) return false;

    await storage.remove(url);
    await pool.query('DELETE FROM uploads WHERE url = $1', [url]);
    console.log('[uploads] удалён неиспользуемый файл:', url);
    return true;
  } catch (err) {
    console.error('[uploads] не удалось удалить', url, err.message);
    return false;
  }
}

// Удобная обёртка: старое значение заменили новым — подчистить старое
async function replaceFile(oldUrl, newUrl) {
  if (!oldUrl || oldUrl === newUrl) return false;
  return removeIfOrphan(oldUrl);
}

// Собирает все файлы, на которые ссылался шаг
function stepFiles(content) {
  if (!content || typeof content !== 'object') return [];
  return [content.url, content.imageUrl].filter(Boolean);
}

module.exports = { removeIfOrphan, replaceFile, stepFiles, isReferenced };
