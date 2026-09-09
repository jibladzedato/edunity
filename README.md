# EDUNITY

Онлайн-платформа курсов (аналог Udemy) на грузинском языке.

## Структура

```
edunity/
├── backend/     Node.js + Express + PostgreSQL API (регистрация/логин/профиль)
└── frontend/    Статический сайт (HTML/CSS/JS), деплоится на GitHub Pages
```

## Что уже готово (этот этап)

- Реальная авторизация: пароли хешируются bcrypt, сессии — JWT (7 дней)
- PostgreSQL хранит пользователей (users: id, name, email, password_hash, role, created_at)
- Личный кабинет (`pages/cabinet.html`), защищённый — без токена редиректит на логин
- Общая логика шапки/бургер-меню вынесена в `js/common.js` (было продублировано 3 раза)
- Починены пути к иконкам (были абсолютные `/assets/...`, ломались на GitHub Pages)
- Убрана случайно закоммиченная дублирующая папка `frontend-finaluri/`

## Как запустить локально

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
# впиши DATABASE_URL от своей PostgreSQL (можно поставить локально или взять
# бесплатную БД на Neon.tech / Supabase / Render)
psql "$DATABASE_URL" -f schema.sql   # создать таблицу users
npm run dev   # или: node src/server.js
```

Сервер поднимется на `http://localhost:4000`.

### 2. Frontend

Открой `frontend/js/config.js` — там указан адрес backend API (`API_BASE_URL`).
Для локального теста оставь `http://localhost:4000/api`.

Дальше просто открой `frontend/index.html` через любой статический сервер
(например, расширение Live Server в VS Code, или `python3 -m http.server`
из папки `frontend`).

## Деплой в продакшн

1. **База данных**: создай бесплатную PostgreSQL на [Neon](https://neon.tech)
   или [Supabase](https://supabase.com) — получишь `DATABASE_URL`.
2. **Backend**: задеплой папку `backend/` на [Render](https://render.com)
   (Web Service → Node) или Railway. Пропиши переменные окружения из
   `.env.example` (`DATABASE_URL`, `JWT_SECRET`, `FRONTEND_ORIGIN` — укажи
   реальный домен твоего GitHub Pages, например
   `https://davitjibladze.github.io`). После первого деплоя один раз выполни
   `schema.sql` на продакшн-базе.
3. **Frontend**: в `frontend/js/config.js` пропиши реальный адрес бэкенда
   (например `https://edunity-api.onrender.com/api`) и запушь `frontend/`
   в свой репозиторий на GitHub Pages.

## Дальше по плану

- Конструктор курсов (создание курса лектором: модули, уроки, видео/текст)
- Сам процесс прохождения курса (плеер уроков, прогресс, тест/квиз)
- Роли: студент / лектор в БД уже заложены (поле `role`) — пригодится, когда
  будем делать конструктор
