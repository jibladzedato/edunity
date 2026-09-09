const pool = require('./pool');

// Те же требования, что и в чек-листе на фронте (frontend/js/publish-rules.js).
// Проверяются на сервере, потому что фронт можно обойти — а публикация
// курса без описания или с пустыми уроками недопустима.

async function checkCourseReadiness(courseId) {
  const courseRes = await pool.query('SELECT * FROM courses WHERE id = $1', [courseId]);
  const course = courseRes.rows[0];
  if (!course) return { ready: false, failed: ['კურსი ვერ მოიძებნა'] };

  const modules = (await pool.query('SELECT id, title FROM modules WHERE course_id = $1', [courseId])).rows;
  const lessons = (
    await pool.query(
      `SELECT l.id, l.title, l.module_id FROM lessons l
         JOIN modules m ON m.id = l.module_id WHERE m.course_id = $1`,
      [courseId]
    )
  ).rows;
  const steps = (
    await pool.query(
      `SELECT s.id, s.lesson_id FROM steps s
         JOIN lessons l ON l.id = s.lesson_id
         JOIN modules m ON m.id = l.module_id WHERE m.course_id = $1`,
      [courseId]
    )
  ).rows;

  const lessonsByModule = (mid) => lessons.filter((l) => l.module_id === mid);
  const stepsByLesson = (lid) => steps.filter((s) => s.lesson_id === lid);

  const rules = [
    { id: 'summary', label: 'მოკლე აღწერა 100 სიმბოლოზე გრძელია', ok: (course.summary || '').trim().length >= 100 },
    { id: 'description', label: 'შევსებულია სრული აღწერა', ok: (course.description || '').trim().length >= 50 },
    { id: 'cover', label: 'დამატებულია ყდის სურათი', ok: !!(course.cover_url || '').trim() },
    { id: 'category', label: 'მითითებულია კურსის კატეგორია', ok: !!(course.category || '').trim() },
    { id: 'has-modules', label: 'კურსს აქვს მინიმუმ ერთი მოდული', ok: modules.length > 0 },
    {
      id: 'no-empty-modules',
      label: 'არ არის ცარიელი მოდულები',
      ok: modules.length > 0 && modules.every((m) => lessonsByModule(m.id).length > 0),
    },
    {
      id: 'no-empty-lessons',
      label: 'არ არის ცარიელი გაკვეთილები',
      ok: lessons.length > 0 && lessons.every((l) => stepsByLesson(l.id).length > 0),
    },
    {
      id: 'meaningful-titles',
      label: 'მოდულებსა და გაკვეთილებს აქვთ შინაარსობრივი სახელები',
      ok:
        modules.every((m) => (m.title || '').trim().length >= 3) &&
        lessons.every((l) => (l.title || '').trim().length >= 3),
    },
    { id: 'steps-count', label: 'კურსში მინიმუმ 3 ნაბიჯია', ok: steps.length >= 3 },
  ];

  const failed = rules.filter((r) => !r.ok);

  return {
    ready: failed.length === 0,
    passed: rules.length - failed.length,
    total: rules.length,
    failed: failed.map((r) => r.label),
    failedIds: failed.map((r) => r.id),
  };
}

// Если опубликованный курс перестал соответствовать требованиям —
// автоматически возвращаем его в черновики.
async function enforceAfterChange(courseId) {
  const cur = await pool.query('SELECT status FROM courses WHERE id = $1', [courseId]);
  if (!cur.rows[0] || cur.rows[0].status !== 'published') return null;

  const check = await checkCourseReadiness(courseId);
  if (check.ready) return null;

  await pool.query(`UPDATE courses SET status = 'draft', updated_at = now() WHERE id = $1`, [courseId]);
  return check;
}

module.exports = { checkCourseReadiness, enforceAfterChange };
