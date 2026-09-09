const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const pool = require('../db/pool');

const router = express.Router();
const SALT_ROUNDS = 12;

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
  };
}

// POST /api/auth/register
router.post(
  '/register',
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

      res.status(201).json({ token, user: toPublicUser(user) });
    } catch (err) {
      console.error('Ошибка регистрации:', err);
      res.status(500).json({ error: 'სერვერის შეცდომა, სცადეთ მოგვიანებით' });
    }
  }
);

// POST /api/auth/login
router.post(
  '/login',
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

module.exports = router;
