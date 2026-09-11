// Требование подтверждённой почты.
//
// Смотреть сайт можно и без подтверждения — иначе человек, у которого письмо
// попало в спам, просто теряет доступ. А вот действия, которые создают
// содержимое или влияют на других (запись на курс, комментарии, отзывы,
// создание курсов), требуют подтверждённого адреса.

const pool = require('./../db/pool');

async function requireVerified(req, res, next) {
  try {
    const r = await pool.query('SELECT email_verified FROM users WHERE id = $1', [req.userId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'მომხმარებელი ვერ მოიძებნა' });

    if (!r.rows[0].email_verified) {
      return res.status(403).json({
        error: 'ჯერ დაადასტურე ელ.ფოსტა — ბმული გამოგზავნილია შენს მისამართზე',
        emailNotVerified: true,
      });
    }

    next();
  } catch (err) {
    console.error('Ошибка проверки подтверждения почты:', err);
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
}

module.exports = { requireVerified };
