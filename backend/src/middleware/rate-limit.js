// Ограничение частоты запросов.
//
// Без него пароль можно подбирать перебором: тысячи попыток в минуту
// с одного адреса. Здесь заданы разные лимиты для разных действий —
// вход строже, чем обычные запросы.

const rateLimit = require('express-rate-limit');

function make({ windowMinutes, max, message }) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    // Render и другие хостинги стоят за прокси — берём реальный IP
    handler: (req, res) =>
      res.status(429).json({
        error: message,
        retryAfterMinutes: windowMinutes,
      }),
  });
}

// Вход: 10 попыток за 15 минут
const loginLimiter = make({
  windowMinutes: 15,
  max: 10,
  message: 'ძალიან ბევრი მცდელობა — სცადე 15 წუთში',
});

// Регистрация: 5 аккаунтов в час с одного адреса
const registerLimiter = make({
  windowMinutes: 60,
  max: 5,
  message: 'ძალიან ბევრი რეგისტრაცია — სცადე მოგვიანებით',
});

// Письма (сброс пароля, повторное подтверждение): 5 за 15 минут
const mailLimiter = make({
  windowMinutes: 15,
  max: 5,
  message: 'ძალიან ბევრი მოთხოვნა — სცადე 15 წუთში',
});

module.exports = { loginLimiter, registerLimiter, mailLimiter };
