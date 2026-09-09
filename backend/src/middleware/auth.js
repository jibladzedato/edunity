const jwt = require('jsonwebtoken');

// Ожидает заголовок: Authorization: Bearer <token>
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'საჭიროა ავტორიზაცია' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'სესია ვადაგასულია, გთხოვთ თავიდან შეხვიდეთ' });
  }
}

// Не требует авторизации, но если токен есть — подставляет req.userId.
// Нужен там, где страница работает и для гостя, и для владельца (например, курс).
function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme === 'Bearer' && token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      req.userId = payload.sub;
    } catch (err) {
      // просроченный/битый токен — просто считаем гостем
    }
  }
  next();
}

module.exports = { requireAuth, optionalAuth };
