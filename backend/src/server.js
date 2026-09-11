require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const courseRoutes = require('./routes/courses');
const contentRoutes = require('./routes/content');
const uploadRoutes = require('./routes/uploads');
const adminRoutes = require('./routes/admin');
const certificateRoutes = require('./routes/certificates');
const path = require('path');

const app = express();

// Render и подобные хостинги ставят приложение за обратным прокси.
// Без этого express-rate-limit видел бы один и тот же IP у всех
// посетителей и блокировал бы всех разом.
app.set('trust proxy', 1);

// В разработке разрешаем запросы с любого адреса (Live Server часто открывается
// то на localhost, то на локальном IP вроде 192.168.x.x, и адрес меняется от
// перезапуска к перезапуску — CORS_STRICT=1 в .env включает старое строгое
// поведение, если понадобится для продакшна).
const corsOrigin =
  process.env.CORS_STRICT === '1'
    ? process.env.FRONTEND_ORIGIN || '*'
    : true;

app.use(cors({ origin: corsOrigin }));
app.use(express.json());

// В локальном режиме файлы раздаёт сам сервер: /uploads/2026-09/xxx.png
// В режиме S3/R2 они лежат в облаке и отдаются оттуда напрямую.
const storage = require('./storage');
if (storage.isLocal) {
  app.use('/uploads', express.static(storage.LOCAL_ROOT, { maxAge: '7d' }));
}

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/certificates', certificateRoutes);
app.use('/api', contentRoutes); // /api/modules/..., /api/lessons/..., /api/steps/...

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`EDUNITY API запущен на порту ${PORT}`);
});
