const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Код вида EDU-4F2A-9C31 — короткий, читается вслух, легко проверить
function generateCode() {
  const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `EDU-${part()}-${part()}`;
}

async function courseProgressOf(courseId, userId) {
  const total = await pool.query(
    `SELECT COUNT(*) AS n FROM steps s
       JOIN lessons l ON l.id = s.lesson_id
       JOIN modules m ON m.id = l.module_id
      WHERE m.course_id = $1`,
    [courseId]
  );
  const done = await pool.query(
    `SELECT COUNT(*) AS n FROM step_progress sp
       JOIN steps s ON s.id = sp.step_id
       JOIN lessons l ON l.id = s.lesson_id
       JOIN modules m ON m.id = l.module_id
      WHERE m.course_id = $1 AND sp.user_id = $2`,
    [courseId, userId]
  );
  return { total: Number(total.rows[0].n), done: Number(done.rows[0].n) };
}

// POST /api/certificates/issue/:courseId — выдать сертификат
router.post('/issue/:courseId', requireAuth, async (req, res) => {
  try {
    const course = await pool.query('SELECT id, title, has_certificate FROM courses WHERE id = $1', [req.params.courseId]);
    if (course.rows.length === 0) return res.status(404).json({ error: 'კურსი ვერ მოიძებნა' });
    if (!course.rows[0].has_certificate) {
      return res.status(400).json({ error: 'ეს კურსი სერტიფიკატს არ გასცემს' });
    }

    const enrolled = await pool.query('SELECT 1 FROM enrollments WHERE user_id = $1 AND course_id = $2', [
      req.userId,
      req.params.courseId,
    ]);
    if (enrolled.rows.length === 0) return res.status(403).json({ error: 'შენ არ ხარ ჩარიცხული ამ კურსზე' });

    const { total, done } = await courseProgressOf(req.params.courseId, req.userId);
    if (total === 0 || done < total) {
      return res.status(403).json({
        error: `სერტიფიკატისთვის საჭიროა კურსის სრულად გავლა (${done}/${total})`,
        done,
        total,
      });
    }

    // Повторный запрос возвращает уже выданный сертификат, а не создаёт новый
    const existing = await pool.query('SELECT * FROM certificates WHERE user_id = $1 AND course_id = $2', [
      req.userId,
      req.params.courseId,
    ]);
    if (existing.rows.length > 0) {
      return res.json({ code: existing.rows[0].code, issuedAt: existing.rows[0].issued_at, alreadyIssued: true });
    }

    let code;
    for (let attempt = 0; attempt < 5; attempt++) {
      code = generateCode();
      const clash = await pool.query('SELECT 1 FROM certificates WHERE code = $1', [code]);
      if (clash.rows.length === 0) break;
    }

    const r = await pool.query(
      'INSERT INTO certificates (user_id, course_id, code) VALUES ($1, $2, $3) RETURNING *',
      [req.userId, req.params.courseId, code]
    );

    res.status(201).json({ code: r.rows[0].code, issuedAt: r.rows[0].issued_at });
  } catch (err) {
    console.error('Ошибка выдачи сертификата:', err);
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
});

// GET /api/certificates/my — мои сертификаты
router.get('/my', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ce.code, ce.issued_at, c.id AS course_id, c.title, u.name AS author_name
         FROM certificates ce
         JOIN courses c ON c.id = ce.course_id
         JOIN users u ON u.id = c.author_id
        WHERE ce.user_id = $1
        ORDER BY ce.issued_at DESC`,
      [req.userId]
    );
    res.json(
      r.rows.map((x) => ({
        code: x.code,
        issuedAt: x.issued_at,
        courseId: x.course_id,
        courseTitle: x.title,
        authorName: x.author_name,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
});

// GET /api/certificates/verify/:code — публичная проверка подлинности
router.get('/verify/:code', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ce.code, ce.issued_at, c.title, c.id AS course_id,
              u.name AS student_name, a.name AS author_name,
              (SELECT COUNT(*) FROM lessons l JOIN modules m ON m.id = l.module_id
                WHERE m.course_id = c.id) AS lessons_count
         FROM certificates ce
         JOIN courses c ON c.id = ce.course_id
         JOIN users u ON u.id = ce.user_id
         JOIN users a ON a.id = c.author_id
        WHERE UPPER(ce.code) = UPPER($1)`,
      [req.params.code]
    );

    if (r.rows.length === 0) {
      return res.status(404).json({ valid: false, error: 'ასეთი სერტიფიკატი ვერ მოიძებნა' });
    }

    const c = r.rows[0];
    res.json({
      valid: true,
      code: c.code,
      issuedAt: c.issued_at,
      studentName: c.student_name,
      courseId: c.course_id,
      courseTitle: c.title,
      authorName: c.author_name,
      lessonsCount: Number(c.lessons_count),
    });
  } catch (err) {
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
});

module.exports = router;
