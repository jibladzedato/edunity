// Отправка писем.
//
// Если SMTP не настроен (нет SMTP_HOST), письма не отправляются, а ссылка
// печатается в консоль сервера. Это сделано намеренно: разработка и первые
// тесты не должны требовать почтового сервиса, а забытая настройка не должна
// ломать регистрацию.

const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST;
const FROM = process.env.MAIL_FROM || 'EDUNITY <no-reply@edunity.ge>';

let transporter = null;

if (SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '') === '1', // true для порта 465
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  console.log('[mail] SMTP настроен:', SMTP_HOST);
} else {
  console.log('[mail] SMTP не настроен — ссылки будут печататься в консоль');
}

function layout(title, bodyHtml) {
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#eef1ec;padding:28px">
    <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:32px">
      <div style="font-size:20px;font-weight:700;color:#5fb670;letter-spacing:1px;margin-bottom:22px">EDUNITY</div>
      <h1 style="font-size:19px;color:#000;margin:0 0 14px">${title}</h1>
      ${bodyHtml}
      <p style="font-size:12px;color:#9e9e9e;margin-top:26px;border-top:1px solid #eef0ed;padding-top:14px">
        თუ ეს წერილი შეცდომით მიიღეთ, უბრალოდ იგნორირება გაუკეთეთ.
      </p>
    </div>
  </div>`;
}

function button(url, label) {
  return `
    <a href="${url}" style="display:inline-block;background:#5fb670;color:#fff;text-decoration:none;
       padding:12px 26px;border-radius:24px;font-weight:700;font-size:14px;margin:8px 0 16px">${label}</a>
    <p style="font-size:12px;color:#4d5756;line-height:1.6">
      თუ ღილაკი არ მუშაობს, დააკოპირე ეს მისამართი:<br>
      <span style="color:#1f6b3a;word-break:break-all">${url}</span>
    </p>`;
}

async function send(to, subject, html) {
  if (!transporter) {
    console.log(`\n[mail] письмо для ${to}: ${subject}`);
    const link = (html.match(/https?:\/\/[^\s"<]+/) || [])[0];
    if (link) console.log(`[mail] ссылка: ${link}\n`);
    return { sent: false, logged: true };
  }

  try {
    await transporter.sendMail({ from: FROM, to, subject, html });
    return { sent: true };
  } catch (err) {
    // Письмо не ушло — но регистрацию из-за этого ронять нельзя
    console.error('[mail] не удалось отправить:', err.message);
    return { sent: false, error: err.message };
  }
}

function sendVerification(to, name, url) {
  return send(
    to,
    'დაადასტურე ელ.ფოსტა — EDUNITY',
    layout(
      `გამარჯობა, ${name}!`,
      `<p style="font-size:14px;color:#000;line-height:1.6">
         რეგისტრაციის დასასრულებლად დაადასტურე შენი ელ.ფოსტა.
       </p>` + button(url, 'ფოსტის დადასტურება') +
      `<p style="font-size:12px;color:#9e9e9e">ბმული მოქმედებს 24 საათის განმავლობაში.</p>`
    )
  );
}

function sendPasswordReset(to, name, url) {
  return send(
    to,
    'პაროლის აღდგენა — EDUNITY',
    layout(
      `გამარჯობა, ${name}!`,
      `<p style="font-size:14px;color:#000;line-height:1.6">
         მივიღეთ მოთხოვნა პაროლის შეცვლაზე. ახალი პაროლის დასაყენებლად დააჭირე ღილაკს.
       </p>` + button(url, 'ახალი პაროლის დაყენება') +
      `<p style="font-size:12px;color:#9e9e9e">ბმული მოქმედებს 1 საათის განმავლობაში.
       თუ პაროლის შეცვლა შენ არ მოგითხოვია, არაფერი გააკეთო — პაროლი უცვლელი დარჩება.</p>`
    )
  );
}

module.exports = { send, sendVerification, sendPasswordReset, isConfigured: !!transporter };
