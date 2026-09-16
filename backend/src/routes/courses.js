const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../db/pool');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { requireVerified } = require('../middleware/require-verified');
const { checkCourseReadiness, enforceAfterChange } = require('../db/publish-rules');
const { replaceFile, removeIfOrphan, stepFiles } = require('../db/uploads-cleanup');
const { sanitizeHtml } = require('../db/sanitize');

const router = express.Router();

const STEP_TYPES = ['text', 'video', 'quiz', 'code'];

function fail(res, code, message) {
  return res.status(code).json({ error: message });
}

// Проверяет, что текущий пользователь — автор курса
async function assertCourseOwner(courseId, userId) {
  const r = await pool.query('SELECT author_id FROM courses WHERE id = $1', [courseId]);
  if (r.rows.length === 0) return { ok: false, code: 404, message: 'კურსი ვერ მოიძებნა' };
  if (r.rows[0].author_id !== userId) return { ok: false, code: 403, message: 'თქვენ არ ხართ ამ კურსის ავტორი' };
  return { ok: true };
}

// Находит course_id по module_id / lesson_id / step_id, чтобы проверить владельца
async function courseIdByModule(moduleId) {
  const r = await pool.query('SELECT course_id FROM modules WHERE id = $1', [moduleId]);
  return r.rows[0] ? r.rows[0].course_id : null;
}
async function courseIdByLesson(lessonId) {
  const r = await pool.query(
    `SELECT m.course_id FROM lessons l JOIN modules m ON m.id = l.module_id WHERE l.id = $1`,
    [lessonId]
  );
  return r.rows[0] ? r.rows[0].course_id : null;
}
async function courseIdByStep(stepId) {
  const r = await pool.query(
    `SELECT m.course_id
       FROM steps s
       JOIN lessons l ON l.id = s.lesson_id
       JOIN modules m ON m.id = l.module_id
      WHERE s.id = $1`,
    [stepId]
  );
  return r.rows[0] ? r.rows[0].course_id : null;
}

function publicCourse(row) {
  return {
    id: row.id,
    authorId: row.author_id,
    authorName: row.author_name,
    title: row.title,
    summary: row.summary,
    description: row.description,
    coverUrl: row.cover_url,
    coverPos: row.cover_pos || '50% 50%',
    category: row.category,
    price: row.price,
    hasCertificate: row.has_certificate,
    level: row.level,
    language: row.language,
    status: row.status,
    createdAt: row.created_at,
    blockedReason: row.blocked_reason,
    rating: row.rating !== undefined ? row.rating : undefined,
    studentsCount: row.students_count !== undefined ? Number(row.students_count) : undefined,
    lessonsCount: row.lessons_count !== undefined ? Number(row.lessons_count) : undefined,
  };
}

// ==========================================================
// Каталог: только опубликованные курсы
// GET /api/courses?category=...&q=...&free=1&cert=1
// ==========================================================
router.get('/', async (req, res) => {
  try {
    const conditions = [`c.status = 'published'`];
    const params = [];

    if (req.query.category) {
      params.push(req.query.category);
      conditions.push(`c.category = $${params.length}`);
    }
    if (req.query.q) {
      params.push('%' + req.query.q + '%');
      conditions.push(`c.title ILIKE $${params.length}`);
    }
    if (req.query.free === '1') conditions.push('c.price = 0');
    if (req.query.cert === '1') conditions.push('c.has_certificate = true');

    // Постраничная выдача: раньше отдавались все курсы разом и фильтровались
    // в браузере — на нескольких сотнях курсов страница вставала.
    const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 48);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const offset = (page - 1) * limit;

    const totalRes = await pool.query(
      `SELECT COUNT(*) AS n FROM courses c WHERE ${conditions.join(' AND ')}`,
      params
    );
    const total = Number(totalRes.rows[0].n);

    const result = await pool.query(
      `SELECT c.*, u.name AS author_name,
              COALESCE(ROUND(AVG(r.rating)::numeric, 1), 0) AS rating,
              (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS students_count,
              (SELECT COUNT(*) FROM lessons l
                 JOIN modules m ON m.id = l.module_id
                WHERE m.course_id = c.id) AS lessons_count
         FROM courses c
         JOIN users u ON u.id = c.author_id
         LEFT JOIN reviews r ON r.course_id = c.id
        WHERE ${conditions.join(' AND ')}
        GROUP BY c.id, u.name
        ORDER BY c.created_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    res.json({
      courses: result.rows.map(publicCourse),
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    console.error('Ошибка получения каталога:', err);
    fail(res, 500, 'სერვერის შეცდომა');
  }
});

// Список категорий (публичный) — управляется из админки
router.get('/meta/categories', async (req, res) => {
  try {
    const r = await pool.query('SELECT id, name, icon, color, position FROM categories ORDER BY position, id');
    res.json(r.rows);
  } catch (err) {
    console.error('Ошибка получения категорий:', err);
    fail(res, 500, 'სერვერის შეცდომა');
  }
});

// ==========================================================
// Данные для главной страницы: промо-курсы и промо-лекторы.
// Если админ ничего не выбрал — берём свежие опубликованные курсы
// и авторов с наибольшим числом курсов.
// ==========================================================
router.get('/home/featured', async (req, res) => {
  try {
    let courses = (await pool.query(
      `SELECT c.*, u.name AS author_name,
              COALESCE(ROUND(AVG(r.rating)::numeric, 1), 0) AS rating,
              (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS students_count,
              (SELECT COUNT(*) FROM lessons l JOIN modules m ON m.id = l.module_id
                WHERE m.course_id = c.id) AS lessons_count
         FROM featured f
         JOIN courses c ON c.id = f.course_id
         JOIN users u ON u.id = c.author_id
         LEFT JOIN reviews r ON r.course_id = c.id
        WHERE f.kind = 'course' AND c.status = 'published'
        GROUP BY c.id, u.name, f.position
        ORDER BY f.position`
    )).rows;

    if (courses.length === 0) {
      courses = (await pool.query(
        `SELECT c.*, u.name AS author_name,
                COALESCE(ROUND(AVG(r.rating)::numeric, 1), 0) AS rating,
                (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS students_count,
                (SELECT COUNT(*) FROM lessons l JOIN modules m ON m.id = l.module_id
                  WHERE m.course_id = c.id) AS lessons_count
           FROM courses c JOIN users u ON u.id = c.author_id
           LEFT JOIN reviews r ON r.course_id = c.id
          WHERE c.status = 'published'
          GROUP BY c.id, u.name
          ORDER BY c.created_at DESC
          LIMIT 5`
      )).rows;
    }

    let instructors = (await pool.query(
      `SELECT u.id, u.name, u.avatar_url, u.bio,
              (SELECT COUNT(*) FROM courses c WHERE c.author_id = u.id AND c.status = 'published') AS courses_count
         FROM featured f JOIN users u ON u.id = f.user_id
        WHERE f.kind = 'instructor'
        ORDER BY f.position`
    )).rows;

    if (instructors.length === 0) {
      instructors = (await pool.query(
        `SELECT u.id, u.name, u.avatar_url, u.bio, COUNT(c.id) AS courses_count
           FROM users u JOIN courses c ON c.author_id = u.id AND c.status = 'published'
          GROUP BY u.id
          ORDER BY COUNT(c.id) DESC
          LIMIT 4`
      )).rows;
    }

    res.json({
      courses: courses.map(publicCourse),
      instructors: instructors.map((i) => ({
        id: i.id,
        name: i.name,
        avatarUrl: i.avatar_url,
        bio: i.bio,
        coursesCount: Number(i.courses_count),
      })),
    });
  } catch (err) {
    console.error('Ошибка получения промо для главной:', err);
    fail(res, 500, 'სერვერის შეცდომა');
  }
});

// ==========================================================
// Мои курсы (как автора)
// ==========================================================
router.get('/my', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, u.name AS author_name,
              (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS students_count
         FROM courses c JOIN users u ON u.id = c.author_id
        WHERE c.author_id = $1
        ORDER BY c.updated_at DESC`,
      [req.userId]
    );
    res.json(result.rows.map(publicCourse));
  } catch (err) {
    console.error('Ошибка получения своих курсов:', err);
    fail(res, 500, 'სერვერის შეცდომა');
  }
});

// ==========================================================
// Создать курс (шаг 1 — только название)
// ==========================================================
router.post(
  '/',
  requireAuth,
  requireVerified,
  [body('title').trim().isLength({ min: 3 }).withMessage('კურსის სახელი უნდა შედგებოდეს მინიმუმ 3 სიმბოლოსგან')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return fail(res, 400, errors.array()[0].msg);

    try {
      const result = await pool.query(
        `INSERT INTO courses (author_id, title) VALUES ($1, $2) RETURNING *`,
        [req.userId, req.body.title.trim()]
      );
      // автор автоматически становится инструктором
      await pool.query(`UPDATE users SET role = 'instructor' WHERE id = $1 AND role = 'student'`, [req.userId]);
      res.status(201).json(publicCourse(result.rows[0]));
    } catch (err) {
      console.error('Ошибка создания курса:', err);
      fail(res, 500, 'სერვერის შეცდომა');
    }
  }
);

// ==========================================================
// Один курс
// ==========================================================
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, u.name AS author_name,
              COALESCE(ROUND(AVG(r.rating)::numeric, 1), 0) AS rating,
              (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS students_count,
              (SELECT COUNT(*) FROM lessons l JOIN modules m ON m.id = l.module_id
                WHERE m.course_id = c.id) AS lessons_count
         FROM courses c
         JOIN users u ON u.id = c.author_id
         LEFT JOIN reviews r ON r.course_id = c.id
        WHERE c.id = $1
        GROUP BY c.id, u.name`,
      [req.params.id]
    );

    const row = result.rows[0];
    if (!row) return fail(res, 404, 'კურსი ვერ მოიძებნა');

    if (row.status !== 'published' && row.author_id !== req.userId) {
      // Заблокированный курс: тем, кто уже записан, объясняем что происходит,
      // вместо того чтобы делать вид, будто курса не существует.
      if (row.status === 'blocked') {
        return res.status(403).json({
          error: 'კურსი დროებით მიუწვდომელია — ადმინისტრაცია ამოწმებს მას',
          blocked: true,
          title: row.title,
        });
      }
      return fail(res, 404, 'კურსი ვერ მოიძებნა');
    }

    const course = publicCourse(row);
    course.isOwner = row.author_id === req.userId;

    if (req.userId) {
      const e = await pool.query('SELECT 1 FROM enrollments WHERE user_id = $1 AND course_id = $2', [
        req.userId,
        req.params.id,
      ]);
      course.isEnrolled = e.rows.length > 0;
    } else {
      course.isEnrolled = false;
    }

    res.json(course);
  } catch (err) {
    console.error('Ошибка получения курса:', err);
    fail(res, 500, 'სერვერის შეცდომა');
  }
});

// ==========================================================
// Обновить курс (описание, обложка, цена, публикация...)
// ==========================================================
router.patch('/:id', requireAuth, async (req, res) => {
  const own = await assertCourseOwner(req.params.id, req.userId);
  if (!own.ok) return fail(res, own.code, own.message);

  const allowed = {
    title: 'title',
    summary: 'summary',
    description: 'description',
    coverUrl: 'cover_url',
    coverPos: 'cover_pos',
    category: 'category',
    price: 'price',
    hasCertificate: 'has_certificate',
    level: 'level',
    language: 'language',
    status: 'status',
  };

  // Заблокированный админом курс редактировать можно, публиковать — нет
  if (req.body.status !== undefined) {
    const cur = await pool.query('SELECT status FROM courses WHERE id = $1', [req.params.id]);
    if (cur.rows[0] && cur.rows[0].status === 'blocked') {
      return fail(res, 403, 'კურსი დაბლოკილია ადმინისტრაციის მიერ — გამოქვეყნება შეუძლებელია');
    }
    if (!['draft', 'published'].includes(req.body.status)) {
      return fail(res, 400, 'სტატუსი არასწორია');
    }
    // Публиковать можно только курс, отвечающий всем требованиям
    if (req.body.status === 'published') {
      const check = await checkCourseReadiness(req.params.id);
      if (!check.ready) {
        return res.status(400).json({
          error: `კურსი არ აკმაყოფილებს მოთხოვნებს (${check.passed}/${check.total})`,
          failed: check.failed,
          failedIds: check.failedIds,
        });
      }
    }
  }

  // положение обложки: "X% Y%", числа 0–100
  if (req.body.coverPos !== undefined && !/^(100|\d{1,2})(\.\d{1,2})?% (100|\d{1,2})(\.\d{1,2})?%$/.test(req.body.coverPos)) {
    return fail(res, 400, 'სურათის პოზიცია არასწორია');
  }

  // старая обложка нужна, чтобы удалить её после замены
  let oldCover = null;
  if (req.body.coverUrl !== undefined) {
    const prev = await pool.query('SELECT cover_url FROM courses WHERE id = $1', [req.params.id]);
    oldCover = prev.rows[0] ? prev.rows[0].cover_url : null;
  }

  const sets = [];
  const params = [];
  for (const [key, column] of Object.entries(allowed)) {
    if (req.body[key] !== undefined) {
      // полное описание приходит из визуального редактора
      const value = key === 'description' && typeof req.body[key] === 'string'
        ? sanitizeHtml(req.body[key])
        : req.body[key];
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (sets.length === 0) return fail(res, 400, 'არაფერია შესაცვლელი');

  params.push(req.params.id);

  try {
    const result = await pool.query(
      `UPDATE courses SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length} RETURNING *`,
      params
    );

    // Обложку заменили — старый файл больше не нужен
    if (oldCover) await replaceFile(oldCover, req.body.coverUrl);

    // Если после правки опубликованный курс перестал отвечать требованиям —
    // он автоматически возвращается в черновики.
    const demoted = await enforceAfterChange(req.params.id);
    if (demoted) {
      const fresh = await pool.query('SELECT * FROM courses WHERE id = $1', [req.params.id]);
      return res.json({
        ...publicCourse(fresh.rows[0]),
        unpublished: true,
        unpublishedReason: demoted.failed,
      });
    }

    res.json(publicCourse(result.rows[0]));
  } catch (err) {
    console.error('Ошибка обновления курса:', err);
    fail(res, 500, 'სერვერის შეცდომა');
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  const own = await assertCourseOwner(req.params.id, req.userId);
  if (!own.ok) return fail(res, own.code, own.message);
  try {
    // Если на курсе есть студенты, удаление отберёт у них доступ.
    // Требуем осознанного подтверждения (?force=1) и подсказываем снять с публикации.
    const enrolled = await pool.query('SELECT COUNT(*) AS n FROM enrollments WHERE course_id = $1', [req.params.id]);
    const students = Number(enrolled.rows[0].n);

    if (students > 0 && req.query.force !== '1') {
      return res.status(409).json({
        error: `კურსზე ჩარიცხულია ${students} მოსწავლე — წაშლისას ისინი დაკარგავენ წვდომას`,
        studentsCount: students,
        needsConfirmation: true,
      });
    }
    // собираем файлы курса до удаления
    const cover = (await pool.query('SELECT cover_url FROM courses WHERE id = $1', [req.params.id])).rows[0];
    const steps = await pool.query(
      `SELECT s.content FROM steps s
         JOIN lessons l ON l.id = s.lesson_id
         JOIN modules m ON m.id = l.module_id
        WHERE m.course_id = $1`,
      [req.params.id]
    );

    await pool.query('DELETE FROM courses WHERE id = $1', [req.params.id]);

    // после удаления записей файлы стали ничьими
    if (cover && cover.cover_url) await removeIfOrphan(cover.cover_url);
    for (const row of steps.rows) {
      for (const f of stepFiles(row.content)) await removeIfOrphan(f);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Ошибка удаления курса:', err);
    fail(res, 500, 'სერვერის შეცდომა');
  }
});

// Прогресс текущего пользователя по курсу
router.get('/:id/progress', requireAuth, async (req, res) => {
  try {
    const total = await pool.query(
      `SELECT s.id FROM steps s
         JOIN lessons l ON l.id = s.lesson_id
         JOIN modules m ON m.id = l.module_id
        WHERE m.course_id = $1`,
      [req.params.id]
    );
    const done = await pool.query(
      `SELECT sp.step_id FROM step_progress sp
         JOIN steps s ON s.id = sp.step_id
         JOIN lessons l ON l.id = s.lesson_id
         JOIN modules m ON m.id = l.module_id
        WHERE m.course_id = $1 AND sp.user_id = $2`,
      [req.params.id, req.userId]
    );

    const totalCount = total.rows.length;
    const doneIds = done.rows.map((r) => r.step_id);

    // Куда вернуть пользователя: первый непройденный шаг по порядку курса.
    // Если всё пройдено — на последний шаг.
    const ordered = await pool.query(
      `SELECT s.id AS step_id, l.id AS lesson_id
         FROM steps s
         JOIN lessons l ON l.id = s.lesson_id
         JOIN modules m ON m.id = l.module_id
        WHERE m.course_id = $1
        ORDER BY m.position, m.id, l.position, l.id, s.position, s.id`,
      [req.params.id]
    );

    const doneSet = new Set(doneIds);
    const nextStep = ordered.rows.find((r) => !doneSet.has(r.step_id)) || ordered.rows[ordered.rows.length - 1] || null;

    res.json({
      total: totalCount,
      done: doneIds.length,
      percent: totalCount ? Math.round((doneIds.length / totalCount) * 100) : 0,
      completedStepIds: doneIds,
      resumeLessonId: nextStep ? nextStep.lesson_id : null,
      resumeStepId: nextStep ? nextStep.step_id : null,
      finished: totalCount > 0 && doneIds.length === totalCount,
    });
  } catch (err) {
    console.error('Ошибка получения прогресса:', err);
    fail(res, 500, 'სერვერის შეცდომა');
  }
});

// Проверка готовности курса к публикации (для чек-листа)
router.get('/:id/readiness', requireAuth, async (req, res) => {
  const own = await assertCourseOwner(req.params.id, req.userId);
  if (!own.ok) return fail(res, own.code, own.message);
  try {
    res.json(await checkCourseReadiness(req.params.id));
  } catch (err) {
    console.error('Ошибка проверки готовности:', err);
    fail(res, 500, 'სერვერის შეცდომა');
  }
});

// ==========================================================
// Структура курса: модули → уроки → шаги (без содержимого шагов)
// ==========================================================
router.get('/:id/structure', optionalAuth, async (req, res) => {
  try {
    const modules = await pool.query(
      'SELECT * FROM modules WHERE course_id = $1 ORDER BY position, id',
      [req.params.id]
    );
    const lessons = await pool.query(
      `SELECT l.* FROM lessons l JOIN modules m ON m.id = l.module_id
        WHERE m.course_id = $1 ORDER BY l.position, l.id`,
      [req.params.id]
    );
    const steps = await pool.query(
      `SELECT s.id, s.lesson_id, s.type, s.position
         FROM steps s
         JOIN lessons l ON l.id = s.lesson_id
         JOIN modules m ON m.id = l.module_id
        WHERE m.course_id = $1
        ORDER BY s.position, s.id`,
      [req.params.id]
    );

    const structure = modules.rows.map((m) => ({
      id: m.id,
      title: m.title,
      position: m.position,
      lessons: lessons.rows
        .filter((l) => l.module_id === m.id)
        .map((l) => ({
          id: l.id,
          title: l.title,
          position: l.position,
          steps: steps.rows
            .filter((s) => s.lesson_id === l.id)
            .map((s) => ({ id: s.id, type: s.type, position: s.position })),
        })),
    }));

    res.json(structure);
  } catch (err) {
    console.error('Ошибка получения структуры:', err);
    fail(res, 500, 'სერვერის შეცდომა');
  }
});

// ==========================================================
// Модули
// ==========================================================
router.post('/:id/modules', requireAuth, async (req, res) => {
  const own = await assertCourseOwner(req.params.id, req.userId);
  if (!own.ok) return fail(res, own.code, own.message);

  const title = (req.body.title || '').trim();
  if (!title) return fail(res, 400, 'შეიყვანე მოდულის სახელი');

  try {
    const pos = await pool.query(
      'SELECT COALESCE(MAX(position), 0) + 1 AS next FROM modules WHERE course_id = $1',
      [req.params.id]
    );
    const result = await pool.query(
      'INSERT INTO modules (course_id, title, position) VALUES ($1, $2, $3) RETURNING *',
      [req.params.id, title, pos.rows[0].next]
    );
    res.status(201).json({ ...result.rows[0], lessons: [] });
  } catch (err) {
    console.error('Ошибка создания модуля:', err);
    fail(res, 500, 'სერვერის შეცდომა');
  }
});

// ==========================================================
// Аналитика курса (для автора)
// ==========================================================
router.get('/:id/analytics', requireAuth, async (req, res) => {
  const own = await assertCourseOwner(req.params.id, req.userId);
  if (!own.ok) return fail(res, own.code, own.message);

  try {
    const students = await pool.query(
      'SELECT COUNT(*) AS n FROM enrollments WHERE course_id = $1',
      [req.params.id]
    );
    const reviews = await pool.query(
      `SELECT r.id, r.rating, r.body, r.created_at, u.name AS user_name
         FROM reviews r JOIN users u ON u.id = r.user_id
        WHERE r.course_id = $1 ORDER BY r.created_at DESC`,
      [req.params.id]
    );
    const avg = await pool.query(
      'SELECT COALESCE(ROUND(AVG(rating)::numeric, 1), 0) AS avg FROM reviews WHERE course_id = $1',
      [req.params.id]
    );
    const comments = await pool.query(
      `SELECT cm.id, cm.body, cm.created_at, u.name AS user_name,
              s.id AS step_id, s.type AS step_type, l.title AS lesson_title, m.title AS module_title
         FROM comments cm
         JOIN users u ON u.id = cm.user_id
         JOIN steps s ON s.id = cm.step_id
         JOIN lessons l ON l.id = s.lesson_id
         JOIN modules m ON m.id = l.module_id
        WHERE m.course_id = $1
        ORDER BY cm.created_at DESC
        LIMIT 100`,
      [req.params.id]
    );

    res.json({
      studentsCount: Number(students.rows[0].n),
      averageRating: Number(avg.rows[0].avg),
      reviews: reviews.rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        body: r.body,
        createdAt: r.created_at,
        userName: r.user_name,
      })),
      comments: comments.rows.map((c) => ({
        id: c.id,
        body: c.body,
        createdAt: c.created_at,
        userName: c.user_name,
        stepId: c.step_id,
        stepType: c.step_type,
        lessonTitle: c.lesson_title,
        moduleTitle: c.module_title,
      })),
    });
  } catch (err) {
    console.error('Ошибка аналитики:', err);
    fail(res, 500, 'სერვერის შეცდომა');
  }
});

// ==========================================================
// Запись на курс
// ==========================================================
router.post('/:id/enroll', requireAuth, requireVerified, async (req, res) => {
  try {
    const c = await pool.query(`SELECT id FROM courses WHERE id = $1 AND status = 'published'`, [req.params.id]);
    if (c.rows.length === 0) return fail(res, 404, 'კურსი ვერ მოიძებნა');

    await pool.query(
      'INSERT INTO enrollments (user_id, course_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.userId, req.params.id]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('Ошибка записи на курс:', err);
    fail(res, 500, 'სერვერის შეცდომა');
  }
});

// Отписаться от курса. Прогресс сохраняем — если человек вернётся,
// ему не придётся проходить всё заново.
router.delete('/:id/enroll', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM enrollments WHERE user_id = $1 AND course_id = $2', [req.userId, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Ошибка отписки:', err);
    fail(res, 500, 'სერვერის შეცდომა');
  }
});

// ==========================================================
// Отзывы
// ==========================================================
router.get('/:id/reviews', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT r.id, r.rating, r.body, r.created_at, u.name AS user_name
         FROM reviews r JOIN users u ON u.id = r.user_id
        WHERE r.course_id = $1 ORDER BY r.created_at DESC`,
      [req.params.id]
    );
    res.json(
      r.rows.map((x) => ({
        id: x.id,
        rating: x.rating,
        body: x.body,
        createdAt: x.created_at,
        userName: x.user_name,
      }))
    );
  } catch (err) {
    console.error('Ошибка получения отзывов:', err);
    fail(res, 500, 'სერვერის შეცდომა');
  }
});

router.post('/:id/reviews', requireAuth, requireVerified, async (req, res) => {
  const rating = Number(req.body.rating);
  if (!(rating >= 1 && rating <= 5)) return fail(res, 400, 'შეაფასე კურსი 1-დან 5-მდე');

  try {
    // Оценивать курс можно, только начав его проходить —
    // иначе оценки ставили бы сразу после записи.
    const progress = await pool.query(
      `SELECT COUNT(*) AS n FROM step_progress sp
         JOIN steps s ON s.id = sp.step_id
         JOIN lessons l ON l.id = s.lesson_id
         JOIN modules m ON m.id = l.module_id
        WHERE m.course_id = $1 AND sp.user_id = $2`,
      [req.params.id, req.userId]
    );
    if (Number(progress.rows[0].n) === 0) {
      return fail(res, 403, 'შეფასების დასატოვებლად ჯერ გაიარე მინიმუმ ერთი ნაბიჯი');
    }
    const result = await pool.query(
      `INSERT INTO reviews (course_id, user_id, rating, body)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (course_id, user_id)
       DO UPDATE SET rating = EXCLUDED.rating, body = EXCLUDED.body, created_at = now()
       RETURNING *`,
      [req.params.id, req.userId, rating, req.body.body || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Ошибка отзыва:', err);
    fail(res, 500, 'სერვერის შეცდომა');
  }
});

module.exports = router;
module.exports.helpers = { assertCourseOwner, courseIdByModule, courseIdByLesson, courseIdByStep, STEP_TYPES, fail };
