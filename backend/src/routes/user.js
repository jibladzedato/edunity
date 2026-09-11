const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { replaceFile } = require('../db/uploads-cleanup');

const router = express.Router();
const SALT_ROUNDS = 12;

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    avatarUrl: u.avatar_url,
    bio: u.bio,
    createdAt: u.created_at,
    emailVerified: u.email_verified,
  };
}

// GET /api/users/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'მომხმარებელი ვერ მოიძებნა' });
    res.json(publicUser(user));
  } catch (err) {
    console.error('Ошибка получения профиля:', err);
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
});

// PATCH /api/users/me — настройки профиля (имя, био, аватар)
router.patch('/me', requireAuth, async (req, res) => {
  const allowed = { name: 'name', bio: 'bio', avatarUrl: 'avatar_url' };
  const sets = [];
  const params = [];

  for (const [key, column] of Object.entries(allowed)) {
    if (req.body[key] !== undefined) {
      params.push(req.body[key]);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (sets.length === 0) return res.status(400).json({ error: 'არაფერია შესაცვლელი' });

  // старый аватар удалим после замены
  let oldAvatar = null;
  if (req.body.avatarUrl !== undefined) {
    const prev = await pool.query('SELECT avatar_url FROM users WHERE id = $1', [req.userId]);
    oldAvatar = prev.rows[0] ? prev.rows[0].avatar_url : null;
  }

  params.push(req.userId);

  try {
    const r = await pool.query(
      `UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length} RETURNING *`,
      params
    );

    if (oldAvatar) await replaceFile(oldAvatar, req.body.avatarUrl);

    res.json(publicUser(r.rows[0]));
  } catch (err) {
    console.error('Ошибка обновления профиля:', err);
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
});

// POST /api/users/me/password — смена пароля
router.post('/me/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'შეავსე ორივე ველი' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'ახალი პაროლი უნდა იყოს მინიმუმ 8 სიმბოლო' });

  try {
    const r = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.userId]);
    const ok = await bcrypt.compare(currentPassword, r.rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'მიმდინარე პაროლი არასწორია' });

    const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await pool.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [hash, req.userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Ошибка смены пароля:', err);
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
});

// GET /api/users/me/enrollments — курсы, на которые я записан, с прогрессом
router.get('/me/enrollments', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT c.id, c.title, c.cover_url, c.category, c.price, u.name AS author_name,
              e.enrolled_at,
              (SELECT COUNT(*) FROM steps s
                 JOIN lessons l ON l.id = s.lesson_id
                 JOIN modules m ON m.id = l.module_id
                WHERE m.course_id = c.id) AS total_steps,
              (SELECT COUNT(*) FROM step_progress sp
                 JOIN steps s ON s.id = sp.step_id
                 JOIN lessons l ON l.id = s.lesson_id
                 JOIN modules m ON m.id = l.module_id
                WHERE m.course_id = c.id AND sp.user_id = $1) AS done_steps
         FROM enrollments e
         JOIN courses c ON c.id = e.course_id
         JOIN users u ON u.id = c.author_id
        WHERE e.user_id = $1
        ORDER BY e.enrolled_at DESC`,
      [req.userId]
    );

    res.json(
      r.rows.map((x) => {
        const total = Number(x.total_steps);
        const done = Number(x.done_steps);
        return {
          id: x.id,
          title: x.title,
          coverUrl: x.cover_url,
          category: x.category,
          price: x.price,
          authorName: x.author_name,
          enrolledAt: x.enrolled_at,
          totalSteps: total,
          doneSteps: done,
          progressPercent: total > 0 ? Math.round((done / total) * 100) : 0,
        };
      })
    );
  } catch (err) {
    console.error('Ошибка получения записей:', err);
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
});

// GET /api/users/:id/profile — публичный профиль лектора с его курсами
router.get('/:id/profile', async (req, res) => {
  try {
    const u = await pool.query(
      'SELECT id, name, avatar_url, bio, role, created_at FROM users WHERE id = $1',
      [req.params.id]
    );
    if (u.rows.length === 0) return res.status(404).json({ error: 'მომხმარებელი ვერ მოიძებნა' });

    const courses = await pool.query(
      `SELECT c.id, c.title, c.summary, c.cover_url, c.category, c.price, c.has_certificate,
              COALESCE(ROUND(AVG(r.rating)::numeric, 1), 0) AS rating,
              (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS students_count,
              (SELECT COUNT(*) FROM lessons l JOIN modules m ON m.id = l.module_id
                WHERE m.course_id = c.id) AS lessons_count
         FROM courses c
         LEFT JOIN reviews r ON r.course_id = c.id
        WHERE c.author_id = $1 AND c.status = 'published'
        GROUP BY c.id
        ORDER BY c.created_at DESC`,
      [req.params.id]
    );

    const totalStudents = courses.rows.reduce((sum, c) => sum + Number(c.students_count), 0);

    res.json({
      id: u.rows[0].id,
      name: u.rows[0].name,
      avatarUrl: u.rows[0].avatar_url,
      bio: u.rows[0].bio,
      role: u.rows[0].role,
      createdAt: u.rows[0].created_at,
      totalStudents,
      courses: courses.rows.map((c) => ({
        id: c.id,
        title: c.title,
        summary: c.summary,
        coverUrl: c.cover_url,
        category: c.category,
        price: c.price,
        hasCertificate: c.has_certificate,
        rating: c.rating,
        studentsCount: Number(c.students_count),
        lessonsCount: Number(c.lessons_count),
      })),
    });
  } catch (err) {
    console.error('Ошибка получения профиля лектора:', err);
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
});

module.exports = router;
