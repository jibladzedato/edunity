// Очистка HTML, который присылает автор курса из визуального редактора.
//
// Хранить сырой HTML нельзя: автор курса мог бы вставить <script> и получить
// выполнение кода у каждого ученика. Поэтому оставляем только безопасный
// набор тегов и атрибутов, всё остальное вырезаем.

const ALLOWED_TAGS = new Set([
  'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's',
  'h3', 'h4',
  'ul', 'ol', 'li',
  'blockquote', 'code', 'pre',
  'a', 'img',
]);

// Для каждого тега — какие атрибуты разрешены
const ALLOWED_ATTRS = {
  a: ['href', 'title'],
  img: ['src', 'alt'],
};

function safeUrl(value) {
  const v = String(value || '').trim();
  // javascript:, data: и подобное — потенциальный запуск кода
  if (/^(javascript|data|vbscript|file):/i.test(v)) return null;
  return v;
}

function cleanAttributes(tag, attrString) {
  const allowed = ALLOWED_ATTRS[tag];
  if (!allowed) return '';

  const out = [];
  const attrRe = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;

  while ((m = attrRe.exec(attrString)) !== null) {
    const name = m[1].toLowerCase();
    if (!allowed.includes(name)) continue;

    let value = m[3] !== undefined ? m[3] : m[4];

    if (name === 'href' || name === 'src') {
      value = safeUrl(value);
      if (value === null) continue;
    }

    // экранируем кавычки внутри значения
    value = String(value).replace(/"/g, '&quot;');
    out.push(`${name}="${value}"`);
  }

  // внешние ссылки открываем безопасно
  if (tag === 'a' && out.some((a) => a.startsWith('href='))) {
    out.push('target="_blank"', 'rel="noopener noreferrer"');
  }

  return out.length ? ' ' + out.join(' ') : '';
}

function sanitizeHtml(dirty) {
  if (!dirty || typeof dirty !== 'string') return '';

  let html = dirty;

  // Полностью удаляем опасные блоки вместе с содержимым
  html = html.replace(/<(script|style|iframe|object|embed|form)[\s\S]*?<\/\1>/gi, '');
  html = html.replace(/<(script|style|iframe|object|embed|form)[^>]*\/?>/gi, '');

  // Обрабатываем оставшиеся теги
  html = html.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (match, rawTag, attrs) => {
    const tag = rawTag.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return '';

    const isClosing = match.startsWith('</');
    if (isClosing) return `</${tag}>`;

    const selfClosing = tag === 'br' || tag === 'img';
    return `<${tag}${cleanAttributes(tag, attrs)}${selfClosing ? '>' : '>'}`;
  });

  // on* обработчики могли остаться в тексте — подстраховка
  html = html.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  return html.trim();
}

module.exports = { sanitizeHtml };
