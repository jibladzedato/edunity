// Удаление аккаунта вместе со всеми данными.
//
// Связи в базе каскадные, поэтому записи (комментарии, отзывы, прогресс,
// сертификаты, курсы) удалятся сами. А вот файлы в хранилище — нет:
// их нужно собрать и удалить руками, иначе они останутся мусором навсегда.

const pool = require('./pool');
const storage = require('../storage');

// Что именно будет удалено — показываем пользователю до подтверждения
async function previewDeletion(userId) {
  const q = async (sql, params = [userId]) => Number((await pool.query(sql, params)).rows[0].n);

  const authoredCourses = await pool.query(
    `SELECT c.id, c.title,
            (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS students
       FROM courses c WHERE c.author_id = $1`,
    [userId]
  );

  const affectedStudents = authoredCourses.rows.reduce((sum, c) => sum + Number(c.students), 0);

  return {
    authoredCourses: authoredCourses.rows.map((c) => ({
      id: c.id,
      title: c.title,
      students: Number(c.students),
    })),
    affectedStudents,
    enrollments: await q('SELECT COUNT(*) n FROM enrollments WHERE user_id = $1'),
    comments: await q('SELECT COUNT(*) n FROM comments WHERE user_id = $1'),
    reviews: await q('SELECT COUNT(*) n FROM reviews WHERE user_id = $1'),
    certificates: await q('SELECT COUNT(*) n FROM certificates WHERE user_id = $1'),
    files: await q('SELECT COUNT(*) n FROM uploads WHERE user_id = $1'),
  };
}

// Собирает все файлы, которые исчезнут вместе с аккаунтом
async function collectFiles(userId) {
  const urls = new Set();

  const add = (v) => {
    if (v && typeof v === 'string') urls.add(v);
  };

  // аватар
  const user = await pool.query('SELECT avatar_url FROM users WHERE id = $1', [userId]);
  if (user.rows[0]) add(user.rows[0].avatar_url);

  // всё, что человек загружал
  const uploads = await pool.query('SELECT url FROM uploads WHERE user_id = $1', [userId]);
  uploads.rows.forEach((r) => add(r.url));

  // обложки его курсов
  const covers = await pool.query('SELECT cover_url FROM courses WHERE author_id = $1', [userId]);
  covers.rows.forEach((r) => add(r.cover_url));

  // видео и картинки внутри шагов его курсов
  const steps = await pool.query(
    `SELECT s.content FROM steps s
       JOIN lessons l ON l.id = s.lesson_id
       JOIN modules m ON m.id = l.module_id
       JOIN courses c ON c.id = m.course_id
      WHERE c.author_id = $1`,
    [userId]
  );
  steps.rows.forEach((r) => {
    if (r.content && typeof r.content === 'object') {
      add(r.content.url);
      add(r.content.imageUrl);
    }
  });

  return Array.from(urls);
}

async function deleteAccount(userId) {
  // Файлы собираем ДО удаления — после записи в базе пропадут
  const files = await collectFiles(userId);

  await pool.query('DELETE FROM users WHERE id = $1', [userId]);

  let removed = 0;
  for (const url of files) {
    try {
      await storage.remove(url);
      removed++;
    } catch (err) {
      console.error('[delete-account] файл не удалён:', url, err.message);
    }
  }

  console.log(`[delete-account] пользователь ${userId} удалён, файлов очищено: ${removed}/${files.length}`);
  return { filesRemoved: removed, filesTotal: files.length };
}

module.exports = { previewDeletion, deleteAccount };
