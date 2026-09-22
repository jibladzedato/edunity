const express = require('express');
const pool = require('../db/pool');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { requireVerified } = require('../middleware/require-verified');
const { helpers } = require('./courses');
const { enforceAfterChange } = require('../db/publish-rules');
const { removeIfOrphan, stepFiles } = require('../db/uploads-cleanup');
const { sanitizeHtml } = require('../db/sanitize');
const storage = require('../storage');

// Ссылку на видео отдаём подписанной и недолгой, чтобы её нельзя было
// переслать в обход покупки курса. Исходный url не трогаем: редактор
// сохраняет его обратно, и подписанная (истекающая) ссылка не должна
// попасть в базу. Смотреть — по playUrl.
async function signStep(step) {
  if (step.type !== 'video' || !step.content || !step.content.url) return step;
  return { ...step, content: { ...step.content, playUrl: await storage.signUrl(step.content.url) } };
}

// Меняет местами элемент и его соседа — так автор двигает модуль/урок/шаг
// вверх или вниз. Работает через position внутри одного родителя.
async function moveItem(table, parentColumn, id, direction) {
  const cur = await pool.query(`SELECT id, position, ${parentColumn} FROM ${table} WHERE id = $1`, [id]);
  if (cur.rows.length === 0) return { ok: false, code: 404, message: 'ელემენტი ვერ მოიძებნა' };

  const item = cur.rows[0];
  const parentId = item[parentColumn];

  // сосед в нужную сторону
  const neighbour = await pool.query(
    direction === 'up'
      ? `SELECT id, position FROM ${table} WHERE ${parentColumn} = $1 AND position < $2 ORDER BY position DESC, id DESC LIMIT 1`
      : `SELECT id, position FROM ${table} WHERE ${parentColumn} = $1 AND position > $2 ORDER BY position ASC, id ASC LIMIT 1`,
    [parentId, item.position]
  );

  if (neighbour.rows.length === 0) return { ok: true, moved: false }; // уже с краю

  const other = neighbour.rows[0];
  await pool.query(`UPDATE ${table} SET position = $1 WHERE id = $2`, [other.position, item.id]);
  await pool.query(`UPDATE ${table} SET position = $1 WHERE id = $2`, [item.position, other.id]);

  return { ok: true, moved: true };
}

// Уроки чужого черновика или заблокированного курса не должны открываться
// по прямой ссылке. Доступ есть у автора и админа всегда, остальным —
// только к опубликованному курсу и только после записи на него:
// иначе ссылку на урок можно переслать кому угодно, даже без входа.
async function canAccessCourse(courseId, userId) {
  const r = await pool.query('SELECT status, author_id FROM courses WHERE id = $1', [courseId]);
  const c = r.rows[0];
  if (!c) return { ok: false, code: 404, message: 'კურსი ვერ მოიძებნა' };
  if (userId && c.author_id === userId) return { ok: true };

  if (userId) {
    const admin = await pool.query(`SELECT 1 FROM users WHERE id = $1 AND role IN ('admin', 'owner')`, [userId]);
    if (admin.rows.length > 0) return { ok: true };
  }

  if (c.status === 'published') {
    if (!userId) return { ok: false, code: 401, message: 'გაიარე ავტორიზაცია' };

    const enrolled = await pool.query(
      'SELECT 1 FROM enrollments WHERE user_id = $1 AND course_id = $2',
      [userId, courseId]
    );
    if (enrolled.rows.length === 0) return { ok: false, code: 403, message: 'ჯერ ჩაეწერე კურსზე' };
    return { ok: true };
  }
  if (c.status === 'blocked') {
    return { ok: false, code: 403, message: 'კურსი დროებით მიუწვდომელია — ადმინისტრაცია ამოწმებს' };
  }
  return { ok: false, code: 404, message: 'კურსი ვერ მოიძებნა' };
}

const { assertCourseOwner, courseIdByModule, courseIdByLesson, courseIdByStep, STEP_TYPES, fail } = helpers;

const router = express.Router();

// Проверка прав на редактирование по id модуля/урока/шага
async function ownerByModule(moduleId, userId) {
  const courseId = await courseIdByModule(moduleId);
  if (!courseId) return { ok: false, code: 404, message: 'მოდული ვერ მოიძებნა' };
  return { ...(await assertCourseOwner(courseId, userId)), courseId };
}
async function ownerByLesson(lessonId, userId) {
  const courseId = await courseIdByLesson(lessonId);
  if (!courseId) return { ok: false, code: 404, message: 'გაკვეთილი ვერ მოიძებნა' };
  return { ...(await assertCourseOwner(courseId, userId)), courseId };
}
async function ownerByStep(stepId, userId) {
  const courseId = await courseIdByStep(stepId);
  if (!courseId) return { ok: false, code: 404, message: 'ნაბიჯი ვერ მოიძებნა' };
  return { ...(await assertCourseOwner(courseId, userId)), courseId };
}

// ==========================================================
// МОДУЛИ
// ==========================================================
router.patch('/modules/:id', requireAuth, async (req, res) => {
  const own = await ownerByModule(req.params.id, req.userId);
  if (!own.ok) return fail(res, own.code, own.message);

  const title = (req.body.title || '').trim();
  if (!title) return fail(res, 400, 'შეიყვანე მოდულის სახელი');

  try {
    const r = await pool.query('UPDATE modules SET title = $1 WHERE id = $2 RETURNING *', [title, req.params.id]);
    res.json(r.rows[0]);
  } catch (err) {
    console.error('Ошибка обновления модуля:', err);
    fail(res, 500, 'სერვერის შეცდომა');
  }
});

router.delete('/modules/:id', requireAuth, async (req, res) => {
  const own = await ownerByModule(req.params.id, req.userId);
  if (!own.ok) return fail(res, own.code, own.message);
  try {
    const courseId = own.courseId;
    const steps = await pool.query(
      `SELECT s.content FROM steps s JOIN lessons l ON l.id = s.lesson_id WHERE l.module_id = $1`,
      [req.params.id]
    );

    await pool.query('DELETE FROM modules WHERE id = $1', [req.params.id]);

    for (const row of steps.rows) {
      for (const f of stepFiles(row.content)) await removeIfOrphan(f);
    }
    if (courseId) await enforceAfterChange(courseId);
    res.json({ ok: true });
  } catch (err) {
    console.error('Ошибка удаления модуля:', err);
    fail(res, 500, 'სერვერის შეცდომა');
  }
});

// Переместить модуль вверх/вниз
router.post('/modules/:id/move', requireAuth, async (req, res) => {
  const own = await ownerByModule(req.params.id, req.userId);
  if (!own.ok) return fail(res, own.code, own.message);
  const r = await moveItem('modules', 'course_id', req.params.id, req.body.direction === 'up' ? 'up' : 'down');
  if (!r.ok) return fail(res, r.code, r.message);
  res.json(r);
});

// Создать урок внутри модуля
router.post('/modules/:id/lessons', requireAuth, async (req, res) => {
  const own = await ownerByModule(req.params.id, req.userId);
  if (!own.ok) return fail(res, own.code, own.message);

  const title = (req.body.title || '').trim();
  if (!title) return fail(res, 400, 'შეიყვანე გაკვეთილის სახელი');

  try {
    const pos = await pool.query(
      'SELECT COALESCE(MAX(position), 0) + 1 AS next FROM lessons WHERE module_id = $1',
      [req.params.id]
    );
    const r = await pool.query(
      'INSERT INTO lessons (module_id, title, position) VALUES ($1, $2, $3) RETURNING *',
      [req.params.id, title, pos.rows[0].next]
    );
    res.status(201).json({ ...r.rows[0], steps: [] });
  } catch (err) {
    console.error('Ошибка создания урока:', err);
    fail(res, 500, 'სერვერის შეცდომა');
  }
});

// ==========================================================
// УРОКИ
// ==========================================================
router.patch('/lessons/:id', requireAuth, async (req, res) => {
  const own = await ownerByLesson(req.params.id, req.userId);
  if (!own.ok) return fail(res, own.code, own.message);

  const title = (req.body.title || '').trim();
  if (!title) return fail(res, 400, 'შეიყვანე გაკვეთილის სახელი');

  try {
    const r = await pool.query('UPDATE lessons SET title = $1 WHERE id = $2 RETURNING *', [title, req.params.id]);
    res.json(r.rows[0]);
  } catch (err) {
    console.error('Ошибка обновления урока:', err);
    fail(res, 500, 'სერვერის შეცდომა');
  }
});

router.delete('/lessons/:id', requireAuth, async (req, res) => {
  const own = await ownerByLesson(req.params.id, req.userId);
  if (!own.ok) return fail(res, own.code, own.message);
  try {
    const courseId = own.courseId;
    const steps = await pool.query('SELECT content FROM steps WHERE lesson_id = $1', [req.params.id]);

    await pool.query('DELETE FROM lessons WHERE id = $1', [req.params.id]);

    for (const row of steps.rows) {
      for (const f of stepFiles(row.content)) await removeIfOrphan(f);
    }
    if (courseId) await enforceAfterChange(courseId);
    res.json({ ok: true });
  } catch (err) {
    console.error('Ошибка удаления урока:', err);
    fail(res, 500, 'სერვერის შეცდომა');
  }
});

// Переместить урок вверх/вниз
router.post('/lessons/:id/move', requireAuth, async (req, res) => {
  const own = await ownerByLesson(req.params.id, req.userId);
  if (!own.ok) return fail(res, own.code, own.message);
  const r = await moveItem('lessons', 'module_id', req.params.id, req.body.direction === 'up' ? 'up' : 'down');
  if (!r.ok) return fail(res, r.code, r.message);
  res.json(r);
});

// Все шаги урока (с содержимым) — для страницы обучения и редактора
router.get('/lessons/:id/steps', optionalAuth, async (req, res) => {
  try {
    const lesson = await pool.query(
      `SELECT l.id, l.title, m.title AS module_title, m.course_id, c.title AS course_title, c.author_id
         FROM lessons l
         JOIN modules m ON m.id = l.module_id
         JOIN courses c ON c.id = m.course_id
        WHERE l.id = $1`,
      [req.params.id]
    );
    if (lesson.rows.length === 0) return fail(res, 404, 'გაკვეთილი ვერ მოიძებნა');

    const access = await canAccessCourse(lesson.rows[0].course_id, req.userId);
    if (!access.ok) return fail(res, access.code, access.message);

    const steps = await pool.query(
      'SELECT id, type, position, content FROM steps WHERE lesson_id = $1 ORDER BY position, id',
      [req.params.id]
    );

    let progress = [];
    if (req.userId) {
      const p = await pool.query(
        `SELECT step_id, is_correct FROM step_progress
          WHERE user_id = $1 AND step_id = ANY($2::int[])`,
        [req.userId, steps.rows.map((s) => s.id)]
      );
      progress = p.rows;
    }

    res.json({
      lessonId: lesson.rows[0].id,
      lessonTitle: lesson.rows[0].title,
      moduleTitle: lesson.rows[0].module_title,
      courseId: lesson.rows[0].course_id,
      courseTitle: lesson.rows[0].course_title,
      isOwner: lesson.rows[0].author_id === req.userId,
      steps: await Promise.all(steps.rows.map(signStep)),
      progress,
    });
  } catch (err) {
    console.error('Ошибка получения шагов:', err);
    fail(res, 500, 'სერვერის შეცდომა');
  }
});

// Создать шаг
router.post('/lessons/:id/steps', requireAuth, async (req, res) => {
  const own = await ownerByLesson(req.params.id, req.userId);
  if (!own.ok) return fail(res, own.code, own.message);

  const type = req.body.type;
  if (!STEP_TYPES.includes(type)) return fail(res, 400, 'ნაბიჯის უცნობი ტიპი');

  // Заготовка содержимого под каждый тип
  const defaults = {
    text: { html: '' },
    video: { url: '' },
    quiz: { question: '', options: ['', '', '', ''], correct: [0], multiple: false },
    code: { statement: '', language: 'python', template: '' },
  };

  try {
    const pos = await pool.query(
      'SELECT COALESCE(MAX(position), 0) + 1 AS next FROM steps WHERE lesson_id = $1',
      [req.params.id]
    );
    const r = await pool.query(
      'INSERT INTO steps (lesson_id, type, position, content) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.params.id, type, pos.rows[0].next, JSON.stringify(req.body.content || defaults[type])]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('Ошибка создания шага:', err);
    fail(res, 500, 'სერვერის შეცდომა');
  }
});

// ==========================================================
// ШАГИ
// ==========================================================
router.get('/steps/:id', optionalAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT s.*, l.title AS lesson_title, m.title AS module_title, m.course_id, c.author_id
         FROM steps s
         JOIN lessons l ON l.id = s.lesson_id
         JOIN modules m ON m.id = l.module_id
         JOIN courses c ON c.id = m.course_id
        WHERE s.id = $1`,
      [req.params.id]
    );
    if (r.rows.length === 0) return fail(res, 404, 'ნაბიჯი ვერ მოიძებნა');
    const s = r.rows[0];

    const access = await canAccessCourse(s.course_id, req.userId);
    if (!access.ok) return fail(res, access.code, access.message);

    const signed = await signStep({ type: s.type, content: s.content });

    res.json({
      id: s.id,
      lessonId: s.lesson_id,
      type: s.type,
      position: s.position,
      content: signed.content,
      lessonTitle: s.lesson_title,
      moduleTitle: s.module_title,
      courseId: s.course_id,
      isOwner: s.author_id === req.userId,
    });
  } catch (err) {
    console.error('Ошибка получения шага:', err);
    fail(res, 500, 'სერვერის შეცდომა');
  }
});

router.patch('/steps/:id', requireAuth, async (req, res) => {
  const own = await ownerByStep(req.params.id, req.userId);
  if (!own.ok) return fail(res, own.code, own.message);

  if (req.body.content === undefined) return fail(res, 400, 'არაფერია შესაცვლელი');

  try {
    // файлы, которые были в шаге до изменения
    const before = await pool.query('SELECT content FROM steps WHERE id = $1', [req.params.id]);
    const oldFiles = before.rows[0] ? stepFiles(before.rows[0].content) : [];

    // Текстовые поля приходят из визуального редактора — чистим их от
    // потенциально опасной разметки перед сохранением
    const content = { ...req.body.content };
    delete content.playUrl; // временная подписанная ссылка, в базу не пишем
    if (typeof content.html === 'string') content.html = sanitizeHtml(content.html);
    if (typeof content.statement === 'string') content.statement = sanitizeHtml(content.statement);

    const r = await pool.query(
      'UPDATE steps SET content = $1, updated_at = now() WHERE id = $2 RETURNING *',
      [JSON.stringify(content), req.params.id]
    );

    // те, что пропали из шага, удаляем с диска
    const newFiles = stepFiles(content);
    for (const f of oldFiles) {
      if (!newFiles.includes(f)) await removeIfOrphan(f);
    }

    res.json(r.rows[0]);
  } catch (err) {
    console.error('Ошибка обновления шага:', err);
    fail(res, 500, 'სერვერის შეცდომა');
  }
});

router.delete('/steps/:id', requireAuth, async (req, res) => {
  const own = await ownerByStep(req.params.id, req.userId);
  if (!own.ok) return fail(res, own.code, own.message);
  try {
    const courseId = own.courseId;
    const before = await pool.query('SELECT content FROM steps WHERE id = $1', [req.params.id]);
    const files = before.rows[0] ? stepFiles(before.rows[0].content) : [];

    await pool.query('DELETE FROM steps WHERE id = $1', [req.params.id]);

    for (const f of files) await removeIfOrphan(f);
    if (courseId) await enforceAfterChange(courseId);
    res.json({ ok: true });
  } catch (err) {
    console.error('Ошибка удаления шага:', err);
    fail(res, 500, 'სერვერის შეცდომა');
  }
});

// Переместить шаг вверх/вниз
router.post('/steps/:id/move', requireAuth, async (req, res) => {
  const own = await ownerByStep(req.params.id, req.userId);
  if (!own.ok) return fail(res, own.code, own.message);
  const r = await moveItem('steps', 'lesson_id', req.params.id, req.body.direction === 'up' ? 'up' : 'down');
  if (!r.ok) return fail(res, r.code, r.message);
  res.json(r);
});

// Отметить шаг пройденным (для quiz — с результатом)
router.post('/steps/:id/complete', requireAuth, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO step_progress (user_id, step_id, is_correct)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, step_id)
       DO UPDATE SET is_correct = EXCLUDED.is_correct, completed_at = now()`,
      [req.userId, req.params.id, req.body.isCorrect === undefined ? null : !!req.body.isCorrect]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Ошибка сохранения прогресса:', err);
    fail(res, 500, 'სერვერის შეცდომა');
  }
});

// ==========================================================
// КОММЕНТАРИИ К ШАГУ
// ==========================================================
router.get('/steps/:id/comments', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT cm.id, cm.body, cm.parent_id, cm.created_at, u.id AS user_id, u.name AS user_name
         FROM comments cm JOIN users u ON u.id = cm.user_id
        WHERE cm.step_id = $1
        ORDER BY cm.created_at ASC`,
      [req.params.id]
    );
    res.json(
      r.rows.map((c) => ({
        id: c.id,
        body: c.body,
        parentId: c.parent_id,
        createdAt: c.created_at,
        userId: c.user_id,
        userName: c.user_name,
      }))
    );
  } catch (err) {
    console.error('Ошибка получения комментариев:', err);
    fail(res, 500, 'სერვერის შეცდომა');
  }
});

router.post('/steps/:id/comments', requireAuth, requireVerified, async (req, res) => {
  const body = (req.body.body || '').trim();
  if (!body) return fail(res, 400, 'კომენტარი ცარიელია');

  try {
    const r = await pool.query(
      'INSERT INTO comments (step_id, user_id, parent_id, body) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.params.id, req.userId, req.body.parentId || null, body]
    );
    const u = await pool.query('SELECT name FROM users WHERE id = $1', [req.userId]);
    res.status(201).json({
      id: r.rows[0].id,
      body: r.rows[0].body,
      parentId: r.rows[0].parent_id,
      createdAt: r.rows[0].created_at,
      userId: req.userId,
      userName: u.rows[0].name,
    });
  } catch (err) {
    console.error('Ошибка создания комментария:', err);
    fail(res, 500, 'სერვერის შეცდომა');
  }
});

router.delete('/comments/:id', requireAuth, async (req, res) => {
  try {
    const c = await pool.query('SELECT user_id FROM comments WHERE id = $1', [req.params.id]);
    if (c.rows.length === 0) return fail(res, 404, 'კომენტარი ვერ მოიძებნა');
    if (c.rows[0].user_id !== req.userId) return fail(res, 403, 'ეს თქვენი კომენტარი არ არის');
    await pool.query('DELETE FROM comments WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Ошибка удаления комментария:', err);
    fail(res, 500, 'სერვერის შეცდომა');
  }
});

module.exports = router;
