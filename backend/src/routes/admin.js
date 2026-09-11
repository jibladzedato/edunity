const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { previewDeletion, deleteAccount } = require('../db/delete-account');
const mail = require('../mail');

const router = express.Router();

// Все роуты этого файла доступны только администратору
async function requireAdmin(req, res, next) {
  try {
    const r = await pool.query('SELECT role FROM users WHERE id = $1', [req.userId]);
    if (!r.rows[0] || r.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'საჭიროა ადმინისტრატორის უფლებები' });
    }
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

    if (target.rows[0].role === 'admin') {
      return res.status(409).json({ error: 'ადმინისტრატორის წაშლა შეუძლებელია — ჯერ შეუცვალე როლი' });
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

module.exports = router;
