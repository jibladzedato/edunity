const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const pool = require('../db/pool');
const mail = require('../mail');
const { loginLimiter, registerLimiter, mailLimiter } = require('../middleware/rate-limit');
const { OAuth2Client } = require('google-auth-library');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client() : null;

if (GOOGLE_CLIENT_ID) {
  console.log('[auth] вход через Google включён');
} else {
  console.log('[auth] вход через Google выключен (нет GOOGLE_CLIENT_ID)');
}

const router = express.Router();
const SALT_ROUNDS = 12;

// Адрес сайта — нужен, чтобы собрать ссылку в письме.
//
// Это НЕ то же самое, что FRONTEND_ORIGIN: для CORS нужен только домен
// (https://user.github.io), а ссылка в письме должна вести в папку, где
// реально лежит сайт (https://user.github.io/edunity/frontend).
// Поэтому адрес для писем задаётся отдельно, через SITE_URL.
function siteUrl() {
  return (process.env.SITE_URL || process.env.FRONTEND_ORIGIN || 'http://localhost:5500').replace(/\/$/, '');
}

// В базе храним только хеш токена
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function createToken(userId, kind, hours) {
  // Старые неиспользованные токены того же типа больше не нужны
  await pool.query('DELETE FROM auth_tokens WHERE user_id = $1 AND kind = $2 AND used_at IS NULL', [userId, kind]);

  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO auth_tokens (user_id, kind, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' hours')::interval)`,
    [userId, kind, hashToken(token), String(hours)]
  );
  return token;
}

// Возвращает пользователя, если токен годный
async function consumeToken(token, kind) {
  const r = await pool.query(
    `SELECT t.id, t.user_id, u.email, u.name
       FROM auth_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.kind = $2
        AND t.used_at IS NULL AND t.expires_at > now()`,
    [hashToken(token), kind]
  );
  if (r.rows.length === 0) return null;

  await pool.query('UPDATE auth_tokens SET used_at = now() WHERE id = $1', [r.rows[0].id]);
  return r.rows[0];
}

function signToken(user) {
  return jwt.sign({ sub: user.id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function toPublicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
    emailVerified: row.email_verified,
  };
}

// POST /api/auth/register
router.post(
  '/register',
  registerLimiter,
  [
    body('name').trim().isLength({ min: 2 }).withMessage('შეიყვანე სახელი'),
    body('email').trim().isEmail().withMessage('შეიყვანე კორექტული ფოსტა'),
    body('password').isLength({ min: 8 }).withMessage('პაროლი უნდა შედგებოდეს მინიმუმ 8 სიმბოლოსგან'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg, fields: errors.array() });
    }

    const name = req.body.name.trim();
    const email = req.body.email.trim().toLowerCase();
    const password = req.body.password;

    try {
      const existing = await pool.query('SELECT id FROM users WHERE LOWER(email) = $1', [email]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'ფოსტა დაკავებულია' });
      }

      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

      const result = await pool.query(
        `INSERT INTO users (name, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, name, email, role, avatar_url, created_at`,
        [name, email, passwordHash]
      );

      const user = result.rows[0];
      const token = signToken(user);

      // Ответ отдаём сразу, письмо уходит следом.
      // Раньше здесь стоял await: если почтовый сервер не отвечал,
      // регистрация «висела» до бесконечности.
      res.status(201).json({ token, user: toPublicUser(user) });

      createToken(user.id, 'verify_email', 24)
        .then((verifyToken) =>
          mail.sendVerification(user.email, user.name, `${siteUrl()}/pages/verify-email.html?token=${verifyToken}`)
        )
        .catch((e) => console.error('[auth] письмо подтверждения:', e.message));
    } catch (err) {
      console.error('Ошибка регистрации:', err);
      res.status(500).json({ error: 'სერვერის შეცდომა, სცადეთ მოგვიანებით' });
    }
  }
);

// POST /api/auth/login
router.post(
  '/login',
  loginLimiter,
  [
    body('email').trim().isEmail().withMessage('შეიყვანე კორექტული ფოსტა'),
    body('password').notEmpty().withMessage('შეიყვანე პაროლი'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const email = req.body.email.trim().toLowerCase();
    const password = req.body.password;

    try {
      const result = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1', [email]);
      const user = result.rows[0];

      if (!user) {
        return res.status(401).json({ error: 'მეილი ვერ მოიძებნა' });
      }

      // У аккаунтов, созданных через Google, пароля нет —
      // подсказываем, каким способом входить
      if (!user.password_hash) {
        return res.status(401).json({
          error: 'ეს ანგარიში Google-ით შეიქმნა — შედი Google-ის ღილაკით',
          useGoogle: true,
        });
      }

      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) {
        return res.status(401).json({ error: 'პაროლი არასწორია' });
      }

      const token = signToken(user);
      res.json({ token, user: toPublicUser(user) });
    } catch (err) {
      console.error('Ошибка входа:', err);
      res.status(500).json({ error: 'სერვერის შეცდომა, სცადეთ მოგვიანებით' });
    }
  }
);

// ==========================================================
// Вход через Google
// ==========================================================

// Фронт спрашивает, какие способы входа доступны
router.get('/providers', (req, res) => {
  res.json({ google: !!GOOGLE_CLIENT_ID, googleClientId: GOOGLE_CLIENT_ID || null });
});

router.post('/google', loginLimiter, async (req, res) => {
  if (!googleClient) return res.status(400).json({ error: 'Google-ით შესვლა გამორთულია' });

  const credential = req.body.credential;
  if (!credential) return res.status(400).json({ error: 'ტოკენი არ არის გადმოცემული' });

  try {
    // Проверяем подпись Google. Доверять данным из браузера нельзя —
    // их легко подделать, поэтому токен всегда проверяется на сервере.
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const googleId = payload.sub;
    const email = (payload.email || '').toLowerCase();
    const name = payload.name || email.split('@')[0];
    const picture = payload.picture || null;

    if (!email || !payload.email_verified) {
      return res.status(400).json({ error: 'Google-ის ანგარიშის ფოსტა არ არის დადასტურებული' });
    }

    // 1. Уже входил через Google
    let user = (await pool.query('SELECT * FROM users WHERE google_id = $1', [googleId])).rows[0];

    // 2. Регистрировался обычным способом на ту же почту — связываем аккаунты,
    //    чтобы не появился второй профиль на того же человека
    if (!user) {
      const byEmail = (await pool.query('SELECT * FROM users WHERE LOWER(email) = $1', [email])).rows[0];
      if (byEmail) {
        user = (
          await pool.query(
            `UPDATE users SET google_id = $1, email_verified = true,
                    avatar_url = COALESCE(avatar_url, $2), updated_at = now()
              WHERE id = $3 RETURNING *`,
            [googleId, picture, byEmail.id]
          )
        ).rows[0];
      }
    }

    // 3. Новый пользователь. Почта уже подтверждена самим Google,
    //    поэтому письмо с подтверждением не отправляем.
    if (!user) {
      user = (
        await pool.query(
          `INSERT INTO users (name, email, google_id, avatar_url, email_verified, password_hash)
           VALUES ($1, $2, $3, $4, true, NULL) RETURNING *`,
          [name, email, googleId, picture]
        )
      ).rows[0];
    }

    res.json({ token: signToken(user), user: toPublicUser(user) });
  } catch (err) {
    console.error('[auth] ошибка входа через Google:', err.message);
    res.status(401).json({ error: 'Google-ით შესვლა ვერ მოხერხდა' });
  }
});

// ==========================================================
// Подтверждение почты
// ==========================================================
router.post('/verify/:token', async (req, res) => {
  try {
    const found = await consumeToken(req.params.token, 'verify_email');
    if (!found) return res.status(400).json({ error: 'ბმული არასწორია ან ვადაგასულია' });

    await pool.query('UPDATE users SET email_verified = true WHERE id = $1', [found.user_id]);
    res.json({ ok: true, email: found.email });
  } catch (err) {
    console.error('Ошибка подтверждения почты:', err);
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
});

// Отправить письмо повторно
router.post('/verify/resend', mailLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'შეიყვანე ელ.ფოსტა' });

  try {
    const r = await pool.query('SELECT id, name, email, email_verified FROM users WHERE LOWER(email) = $1', [email]);
    const user = r.rows[0];

    // Ответ одинаковый в любом случае — чтобы нельзя было
    // проверять, есть ли такая почта в базе
    res.json({ ok: true });

    if (user && !user.email_verified) {
      createToken(user.id, 'verify_email', 24)
        .then((token) =>
          mail.sendVerification(user.email, user.name, `${siteUrl()}/pages/verify-email.html?token=${token}`)
        )
        .catch((e) => console.error('[auth] повторное письмо:', e.message));
    }
  } catch (err) {
    console.error('Ошибка повторной отправки:', err);
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
});

// ==========================================================
// Восстановление пароля
// ==========================================================
router.post('/forgot', mailLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'შეიყვანე ელ.ფოსტა' });

  try {
    const r = await pool.query('SELECT id, name, email FROM users WHERE LOWER(email) = $1', [email]);
    const user = r.rows[0];

    // Не сообщаем, существует ли адрес — иначе форма превращается
    // в инструмент для сбора зарегистрированных почт
    res.json({ ok: true });

    if (user) {
      createToken(user.id, 'reset_password', 1)
        .then((token) =>
          mail.sendPasswordReset(user.email, user.name, `${siteUrl()}/pages/reset-password.html?token=${token}`)
        )
        .catch((e) => console.error('[auth] письмо сброса пароля:', e.message));
    }
  } catch (err) {
    console.error('Ошибка восстановления пароля:', err);
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
});

router.post('/reset/:token', async (req, res) => {
  const password = req.body.password || '';
  if (password.length < 8) return res.status(400).json({ error: 'პაროლი უნდა იყოს მინიმუმ 8 სიმბოლო' });

  try {
    const found = await consumeToken(req.params.token, 'reset_password');
    if (!found) return res.status(400).json({ error: 'ბმული არასწორია ან ვადაგასულია' });

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    await pool.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [hash, found.user_id]);

    res.json({ ok: true });
  } catch (err) {
    console.error('Ошибка сброса пароля:', err);
    res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
});

module.exports = router;
