# Развёртывание EDUNITY

Схема: **фронтенд** на GitHub Pages · **бэкенд** на Render · **база** в Neon · **файлы** в Cloudflare R2.

Всё, кроме бэкенда на Render, — бесплатно. Бэкенд можно начать тоже бесплатно, с оговорками (см. в конце).

---

## 1. База данных — Neon

1. Заведи аккаунт на [neon.tech](https://neon.tech), создай проект.
2. Выбери регион поближе — Frankfurt.
3. Скопируй строку подключения (Connection string), она вида
   `postgresql://user:pass@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`

Почему Neon, а не бесплатная база Render: бесплатная база Render **удаляется через 30 дней** после создания. Neon так не делает.

---

## 2. Файлы — Cloudflare R2

Это обязательный шаг. На хостинге папка с файлами очищается при каждом обновлении кода, и все загруженные видео и картинки пропадут. R2 бесплатен до 10 ГБ.

1. Зарегистрируйся на [cloudflare.com](https://cloudflare.com), открой раздел **R2**.
2. Создай бакет, назови `edunity`.
3. В настройках бакета включи **Public access** (r2.dev) — скопируй публичный адрес, вида `https://pub-xxxxx.r2.dev`.
https://pub-9af00dbceda848a8b5f17327b7bfa544.r2.dev
4. В разделе **Manage R2 API Tokens** создай токен с правами *Object Read & Write*. Сохрани:
   - Access Key ID
   134c746ae30c4dbed29b8bbebd332c3e
   - Secret Access Key
   26574d84c6f39333fd2c0d408fc51ec2c91525632f20da8c0dd07720ac5322a8
   - Endpoint (вида `https://<account_id>.r2.cloudflarestorage.com`)
   https://0085ed79e038c181f642d830d526ba23.r2.cloudflarestorage.com

---

## 3. Код — GitHub

Бэкенд должен лежать в репозитории, Render берёт код оттуда.

```bash
cd путь/к/edunity
git init
git add .
git commit -m "EDUNITY"
git branch -M main
git remote add origin https://github.com/jibladzedato/edunity.git
git push -u origin main
```

Проверь, что `backend/.env` **не попал** в репозиторий — там пароли. Он уже указан в `.gitignore`.

---

## 4. Бэкенд — Render

1. На [render.com](https://render.com) → **New → Web Service**, подключи репозиторий.
2. Настройки:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
3. В разделе **Environment** добавь переменные:

```
DATABASE_URL      = строка подключения из Neon
DB_SSL            = 1
JWT_SECRET        = длинная случайная строка
PORT              = 4000
CORS_STRICT       = 0
STORAGE_DRIVER    = s3
S3_ENDPOINT       = https://<account_id>.r2.cloudflarestorage.com
S3_BUCKET         = edunity
S3_ACCESS_KEY_ID  = из токена R2
S3_SECRET_ACCESS_KEY = из токена R2
S3_PUBLIC_URL     = https://pub-xxxxx.r2.dev
S3_REGION         = auto
```

`JWT_SECRET` сгенерируй случайный, например в терминале:
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

4. Нажми **Deploy**. Миграции применятся сами при запуске — команда `npm start` сначала выполняет `migrate.js`.

Проверка: открой `https://твой-сервис.onrender.com/api/health` — должно вернуть `{"ok":true}`.

---

## 5. Фронтенд — GitHub Pages

1. Открой `frontend/js/config.js` и впиши адрес бэкенда:

```js
const API_OVERRIDE = "https://твой-сервис.onrender.com/api";
```

2. Залей папку `frontend` в репозиторий GitHub Pages (как ты делал раньше).
3. В настройках Render поменяй `CORS_STRICT` на `1` и добавь
   `FRONTEND_ORIGIN = https://твой-логин.github.io` — так API будет отвечать только твоему сайту.

---

## 6. Первый вход

Первый зарегистрированный пользователь автоматически становится администратором
(это делает `migrate2.sql`). Зарегистрируйся сразу после деплоя.

---

## Что нужно знать про бесплатный тариф Render

- Сервис **засыпает через 15 минут** простоя. Первый запрос после сна идёт 30–60 секунд — сайт будет казаться зависшим. Лечится тарифом $7/мес.
- Загрузка видео до 300 МБ на бесплатном тарифе может обрываться по таймауту. Для тестов уменьши лимит в `src/routes/uploads.js` (`MAX_VIDEO`).

Файлы при этом не пострадают — они в R2, а не на диске Render.

---

## Обновление сайта после деплоя

```bash
git add .
git commit -m "что изменил"
git push
```

Render сам увидит изменения и передеплоит. Новые миграции применятся автоматически.
Фронтенд обновляется отдельным пушем в репозиторий GitHub Pages.

---

## Локальная разработка не ломается

На своём компьютере оставь в `backend/.env`:

```
STORAGE_DRIVER=local
DB_SSL=0
DATABASE_URL=postgres://postgres:пароль@localhost:5432/edunity
```

Тогда файлы, как и раньше, лежат в `backend/uploads`, база локальная. Прод и локальная
разработка используют один и тот же код — отличаются только переменные окружения.
