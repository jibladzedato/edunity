const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { previewDeletion, deleteAccount } = require('../db/delete-account');
const mail = require('../mail');
const storage = require('../storage');
const { sanitizeHtml } = require('../db/sanitize');

const router = express.Router();

// Все роуты этого файла доступны только администратору
async function requireAdmin(req, res, next) {
  try {
    const r = await pool.query('SELECT role FROM users WHERE id = $1', [req.userId]);
    const role = r.rows[0] && r.rows[0].role;
    if (role !== 'admin' && role !== 'owner') {
      return res.status(403).json({ error: 'საჭიროა ადმინისტრატორის უფლებები' });
    }
    req.userRole = role;
    next();
  } catch (err) {
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
}

router.use(requireAuth, requireAdmin);

// ==========================================================
// Сводка
// ==========================================================
router.get('/stats', async (req, res) => {
  try {
    const q = async (sql) => Number((await pool.query(sql)).rows[0].n);
    res.json({
      users: await q('SELECT COUNT(*) n FROM users'),
      courses: await q('SELECT COUNT(*) n FROM courses'),
      published: await q("SELECT COUNT(*) n FROM courses WHERE status = 'published'"),
      blocked: await q("SELECT COUNT(*) n FROM courses WHERE status = 'blocked'"),
      enrollments: await q('SELECT COUNT(*) n FROM enrollments'),
    });
  } catch (err) {
    console.error('Ошибка админ-статистики:', err);
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
});

// ==========================================================
// Все курсы (включая черновики и заблокированные)
// ==========================================================
router.get('/courses', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT c.id, c.title, c.status, c.category, c.price, c.cover_url, c.blocked_reason,
              u.name AS author_name, u.id AS author_id,
              (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS students_count,
              EXISTS (SELECT 1 FROM featured f WHERE f.course_id = c.id) AS is_featured
         FROM courses c JOIN users u ON u.id = c.author_id
        ORDER BY c.created_at DESC`
    );
    res.json(
      r.rows.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        category: c.category,
        price: c.price,
        coverUrl: c.cover_url,
        blockedReason: c.blocked_reason,
        authorName: c.author_name,
        authorId: c.author_id,
        studentsCount: Number(c.students_count),
        isFeatured: c.is_featured,
      }))
    );
  } catch (err) {
    console.error('Ошибка получения курсов:', err);
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
});

// Заблокировать курс
router.post('/courses/:id/block', async (req, res) => {
  try {
    const reason = (req.body.reason || '').trim() || 'წესების დარღვევა';
    const r = await pool.query(
      `UPDATE courses
          SET status = 'blocked', blocked_reason = $1, blocked_at = now(), updated_at = now()
        WHERE id = $2 RETURNING id, status`,
      [reason, req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'კურსი ვერ მოიძებნა' });
    // убираем из промо, если был
    await pool.query('DELETE FROM featured WHERE course_id = $1', [req.params.id]);
    res.json(r.rows[0]);
  } catch (err) {
    console.error('Ошибка блокировки:', err);
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
});

// Разблокировать (курс возвращается в черновики)
router.post('/courses/:id/unblock', async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE courses SET status = 'draft', blocked_reason = NULL, blocked_at = NULL, updated_at = now()
        WHERE id = $1 RETURNING id, status`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'კურსი ვერ მოიძებნა' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('Ошибка разблокировки:', err);
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
});

// ==========================================================
// Промо на главной
// ==========================================================
router.get('/featured', async (req, res) => {
  try {
    const courses = await pool.query(
      `SELECT f.id, f.position, c.id AS course_id, c.title, c.cover_url, c.status, u.name AS author_name
         FROM featured f JOIN courses c ON c.id = f.course_id JOIN users u ON u.id = c.author_id
        WHERE f.kind = 'course' ORDER BY f.position, f.id`
    );
    const instructors = await pool.query(
      `SELECT f.id, f.position, u.id AS user_id, u.name, u.avatar_url, u.bio,
              (SELECT COUNT(*) FROM courses c WHERE c.author_id = u.id AND c.status = 'published') AS courses_count
         FROM featured f JOIN users u ON u.id = f.user_id
        WHERE f.kind = 'instructor' ORDER BY f.position, f.id`
    );

    res.json({
      courses: courses.rows.map((c) => ({
        featuredId: c.id,
        id: c.course_id,
        title: c.title,
        coverUrl: c.cover_url,
        status: c.status,
        authorName: c.author_name,
      })),
      instructors: instructors.rows.map((i) => ({
        featuredId: i.id,
        id: i.user_id,
        name: i.name,
        avatarUrl: i.avatar_url,
        bio: i.bio,
        coursesCount: Number(i.courses_count),
      })),
    });
  } catch (err) {
    console.error('Ошибка получения промо:', err);
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
});

router.post('/featured', async (req, res) => {
  const { kind, courseId, userId } = req.body;
  if (kind !== 'course' && kind !== 'instructor') return res.status(400).json({ error: 'kind უნდა იყოს course ან instructor' });

  try {
    const pos = await pool.query('SELECT COALESCE(MAX(position),0)+1 AS n FROM featured WHERE kind = $1', [kind]);
    await pool.query(
      `INSERT INTO featured (kind, course_id, user_id, position) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [kind, kind === 'course' ? courseId : null, kind === 'instructor' ? userId : null, pos.rows[0].n]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('Ошибка добавления в промо:', err);
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
});

router.delete('/featured/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM featured WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Ошибка удаления из промо:', err);
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
});

// Список пользователей — чтобы выбрать лектора для промо
router.get('/users', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.avatar_url,
              (SELECT COUNT(*) FROM courses c WHERE c.author_id = u.id) AS courses_count
         FROM users u ORDER BY u.created_at DESC LIMIT 200`
    );
    res.json(
      r.rows.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        avatarUrl: u.avatar_url,
        coursesCount: Number(u.courses_count),
      }))
    );
  } catch (err) {
    console.error('Ошибка получения пользователей:', err);
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
});

// Смена роли пользователя
router.patch('/users/:id/role', async (req, res) => {
  const targetId = Number(req.params.id);
  const role = req.body.role;

  if (!['student', 'instructor', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'როლი არასწორია' });
  }

  if (targetId === req.userId) {
    return res.status(400).json({ error: 'საკუთარი როლის შეცვლა შეუძლებელია' });
  }

  try {
    const target = await pool.query('SELECT id, role FROM users WHERE id = $1', [targetId]);
    if (target.rows.length === 0) return res.status(404).json({ error: 'მომხმარებელი ვერ მოიძებნა' });

    // Владелец — единственная роль, которую нельзя ни снять, ни выдать:
    // он назначается один раз, при создании сайта
    if (target.rows[0].role === 'owner') {
      return res.status(409).json({ error: 'მფლობელის როლის შეცვლა შეუძლებელია' });
    }

    // Назначать и снимать администраторов может только владелец
    if ((role === 'admin' || target.rows[0].role === 'admin') && req.userRole !== 'owner') {
      return res.status(403).json({ error: 'ადმინისტრატორის დანიშვნა მხოლოდ მფლობელს შეუძლია' });
    }

    const r = await pool.query('UPDATE users SET role = $1, updated_at = now() WHERE id = $2 RETURNING id, name, role', [
      role,
      targetId,
    ]);
    res.json(r.rows[0]);
  } catch (err) {
    console.error('Ошибка смены роли:', err);
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
});

// Кто я — чтобы фронт знал, показывать ли управление ролями
router.get('/me', async (req, res) => {
  res.json({ role: req.userRole, isOwner: req.userRole === 'owner' });
});

// Что исчезнет вместе с пользователем
router.get('/users/:id/deletion-preview', async (req, res) => {
  try {
    res.json(await previewDeletion(req.params.id));
  } catch (err) {
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
});

// Удалить пользователя со всеми его данными
router.delete('/users/:id', async (req, res) => {
  const targetId = Number(req.params.id);

  if (targetId === req.userId) {
    return res.status(400).json({ error: 'საკუთარი ანგარიში წაშალე პარამეტრებიდან' });
  }

  try {
    const target = await pool.query('SELECT id, role FROM users WHERE id = $1', [targetId]);
    if (target.rows.length === 0) return res.status(404).json({ error: 'მომხმარებელი ვერ მოიძებნა' });

    if (target.rows[0].role === 'owner') {
      return res.status(409).json({ error: 'საიტის მფლობელის წაშლა შეუძლებელია' });
    }
    // Админа может удалить только владелец
    if (target.rows[0].role === 'admin' && req.userRole !== 'owner') {
      return res.status(409).json({ error: 'ადმინისტრატორის წაშლა მხოლოდ მფლობელს შეუძლია' });
    }

    const result = await deleteAccount(targetId);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Ошибка удаления пользователя:', err);
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
});

// Проверка настроек почты: отправляет тестовое письмо и показывает,
// что именно ответил почтовый сервис. Избавляет от гадания по логам.
router.post('/mail-test', async (req, res) => {
  const to = (req.body.to || '').trim();
  if (!to) return res.status(400).json({ error: 'მიუთითე მისამართი' });

  const method = process.env.BREVO_API_KEY
    ? 'HTTP API Brevo'
    : process.env.SMTP_HOST
    ? 'SMTP: ' + process.env.SMTP_HOST
    : 'не настроено (ссылки идут в консоль)';

  const result = await mail.send(
    to,
    'ტესტური წერილი — EDUNITY',
    '<p>თუ ეს წერილი მოვიდა, ფოსტის პარამეტრები სწორია.</p>'
  );

  res.json({
    method,
    from: process.env.MAIL_FROM || '(не задан)',
    sent: !!result.sent,
    error: result.error || null,
    loggedToConsole: !!result.logged,
  });
});

// ==========================================================
// Категории
// ==========================================================
router.get('/categories', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT c.id, c.name, c.icon, c.color, c.position,
              (SELECT COUNT(*) FROM courses co WHERE co.category = c.name) AS courses_count
         FROM categories c ORDER BY c.position, c.id`
    );
    res.json(r.rows.map((c) => ({ ...c, courses_count: Number(c.courses_count) })));
  } catch (err) {
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
});

router.post('/categories', async (req, res) => {
  const name = (req.body.name || '').trim();
  if (name.length < 2) return res.status(400).json({ error: 'კატეგორიის სახელი ძალიან მოკლეა' });

  try {
    const pos = await pool.query('SELECT COALESCE(MAX(position),0)+1 AS n FROM categories');
    const r = await pool.query(
      `INSERT INTO categories (name, icon, color, position) VALUES ($1, $2, $3, $4)
       ON CONFLICT (name) DO NOTHING RETURNING *`,
      [name, req.body.icon || null, req.body.color || '#F5F8F4', pos.rows[0].n]
    );
    if (r.rows.length === 0) return res.status(409).json({ error: 'ასეთი კატეგორია უკვე არსებობს' });
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('Ошибка создания категории:', err);
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
});

router.patch('/categories/:id', async (req, res) => {
  const name = (req.body.name || '').trim();
  if (name.length < 2) return res.status(400).json({ error: 'კატეგორიის სახელი ძალიან მოკლეა' });

  try {
    const old = await pool.query('SELECT name FROM categories WHERE id = $1', [req.params.id]);
    if (old.rows.length === 0) return res.status(404).json({ error: 'კატეგორია ვერ მოიძებნა' });

    const sets = ['name = $1'];
    const params = [name];
    if (req.body.icon !== undefined) {
      params.push(req.body.icon || null);
      sets.push(`icon = $${params.length}`);
    }
    if (req.body.color !== undefined) {
      params.push(req.body.color || null);
      sets.push(`color = $${params.length}`);
    }
    params.push(req.params.id);

    const r = await pool.query(
      `UPDATE categories SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    // переносим курсы на новое название, чтобы они не остались без категории
    await pool.query('UPDATE courses SET category = $1 WHERE category = $2', [name, old.rows[0].name]);
    res.json(r.rows[0]);
  } catch (err) {
    console.error('Ошибка обновления категории:', err);
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
});

router.delete('/categories/:id', async (req, res) => {
  try {
    const cat = await pool.query('SELECT name FROM categories WHERE id = $1', [req.params.id]);
    if (cat.rows.length === 0) return res.status(404).json({ error: 'კატეგორია ვერ მოიძებნა' });

    const used = await pool.query('SELECT COUNT(*) AS n FROM courses WHERE category = $1', [cat.rows[0].name]);
    if (Number(used.rows[0].n) > 0) {
      return res.status(409).json({
        error: `კატეგორია გამოიყენება ${used.rows[0].n} კურსში — ჯერ შეცვალე მათი კატეგორია`,
      });
    }

    await pool.query('DELETE FROM categories WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Ошибка удаления категории:', err);
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
});

// ==========================================================
// Экспорт / импорт курса — только владелец сайта
//
// Экспорт отдаёт курс целиком (без учеников и прогресса) и список
// медиафайлов. Браузер сам скачивает файлы и собирает zip — сервер
// на бесплатном тарифе не должен держать гигабайты видео в памяти.
// Импорт принимает тот же JSON, где ссылки уже заменены на новые
// (браузер заново загрузил файлы), и создаёт курс-черновик.
// ==========================================================
function requireOwner(req, res, next) {
  if (req.userRole !== 'owner') return res.status(403).json({ error: 'მხოლოდ საიტის მფლობელს შეუძლია' });
  next();
}

const EXPORT_FIELDS = [
  'title', 'summary', 'description', 'cover_url', 'cover_pos', 'category',
  'price', 'has_certificate', 'level', 'language', 'duration_hours',
];
const STEP_TYPES = ['text', 'video', 'quiz', 'code'];

router.get('/courses/:id/export', requireOwner, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const c = await pool.query(`SELECT author_id, ${EXPORT_FIELDS.join(', ')} FROM courses WHERE id = $1`, [id]);
    if (c.rows.length === 0) return res.status(404).json({ error: 'კურსი ვერ მოიძებნა' });

    const { author_id: authorId, ...course } = c.rows[0];

    const mods = await pool.query('SELECT id, title, position FROM modules WHERE course_id = $1 ORDER BY position, id', [id]);
    const less = await pool.query(
      `SELECT l.id, l.module_id, l.title, l.position FROM lessons l
       JOIN modules m ON m.id = l.module_id WHERE m.course_id = $1 ORDER BY l.position, l.id`,
      [id]
    );
    const steps = await pool.query(
      `SELECT s.lesson_id, s.type, s.position, s.content FROM steps s
       JOIN lessons l ON l.id = s.lesson_id JOIN modules m ON m.id = l.module_id
       WHERE m.course_id = $1 ORDER BY s.position, s.id`,
      [id]
    );

    course.modules = mods.rows.map((m) => ({
      title: m.title,
      position: m.position,
      lessons: less.rows
        .filter((l) => l.module_id === m.id)
        .map((l) => ({
          title: l.title,
          position: l.position,
          steps: steps.rows
            .filter((s) => s.lesson_id === l.id)
            .map((s) => ({ type: s.type, position: s.position, content: s.content })),
        })),
    }));

    // Медиа — загруженные автором файлы, на которые ссылается курс
    const text = JSON.stringify(course);
    const files = await pool.query('SELECT DISTINCT url, mime_type, kind FROM uploads WHERE user_id = $1', [authorId]);
    const media = [];
    for (const f of files.rows) {
      if (!text.includes(f.url)) continue;
      media.push({ url: f.url, mimeType: f.mime_type, kind: f.kind, fetchUrl: await storage.signUrl(f.url) });
    }

    res.json({ format: 'edunity-course', version: 1, exportedAt: new Date().toISOString(), course, media });
  } catch (err) {
    console.error('Ошибка экспорта курса:', err);
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
});

router.post('/courses/import', requireOwner, async (req, res) => {
  const course = req.body && req.body.course;
  if (!course || typeof course.title !== 'string' || !course.title.trim() || !Array.isArray(course.modules)) {
    return res.status(400).json({ error: 'ფაილი არ არის EDUNITY-ის კურსი' });
  }

  const int = (v, max) => Math.min(max, Math.max(0, Math.round(Number(v) || 0)));
  const str = (v, len) => (typeof v === 'string' ? v.slice(0, len) : null);
  const pos = /^\d{1,3}% \d{1,3}%(\|\d{1,3}% \d{1,3}%){0,3}$/.test(course.cover_pos || '') ? course.cover_pos : '50% 50%';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const c = await client.query(
      `INSERT INTO courses (author_id, title, summary, description, cover_url, cover_pos, category,
                            price, has_certificate, level, language, duration_hours, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'draft') RETURNING id`,
      [
        req.userId,
        course.title.trim().slice(0, 200),
        str(course.summary, 5000),
        typeof course.description === 'string' ? sanitizeHtml(course.description) : null,
        str(course.cover_url, 1000),
        pos,
        str(course.category, 100),
        int(course.price, 9999),
        !!course.has_certificate,
        str(course.level, 20),
        str(course.language, 20) || 'ka',
        int(course.duration_hours, 999),
      ]
    );
    const courseId = c.rows[0].id;

    for (const [mi, m] of course.modules.entries()) {
      const mod = await client.query(
        'INSERT INTO modules (course_id, title, position) VALUES ($1, $2, $3) RETURNING id',
        [courseId, String(m.title || 'მოდული').slice(0, 200), int(m.position, 10000) || mi + 1]
      );
      for (const [li, l] of (Array.isArray(m.lessons) ? m.lessons : []).entries()) {
        const les = await client.query(
          'INSERT INTO lessons (module_id, title, position) VALUES ($1, $2, $3) RETURNING id',
          [mod.rows[0].id, String(l.title || 'გაკვეთილი').slice(0, 200), int(l.position, 10000) || li + 1]
        );
        for (const [si, s] of (Array.isArray(l.steps) ? l.steps : []).entries()) {
          if (!STEP_TYPES.includes(s.type)) continue;
          const content = s.content && typeof s.content === 'object' ? { ...s.content } : {};
          // тот же фильтр HTML, что и при обычном сохранении шага
          if (typeof content.html === 'string') content.html = sanitizeHtml(content.html);
          if (typeof content.statement === 'string') content.statement = sanitizeHtml(content.statement);
          await client.query(
            'INSERT INTO steps (lesson_id, type, position, content) VALUES ($1, $2, $3, $4)',
            [les.rows[0].id, s.type, int(s.position, 10000) || si + 1, content]
          );
        }
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ id: courseId });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Ошибка импорта курса:', err);
    res.status(500).json({ error: 'იმპორტი ვერ მოხერხდა' });
  } finally {
    client.release();
  }
});

module.exports = router;
