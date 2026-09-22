// Визуальный редактор текста и очистка HTML при показе.
//
// Редактор построен на contenteditable: пишем как в обычном документе,
// кнопки применяют форматирование. На выходе получается HTML, который
// перед сохранением и перед показом прогоняется через очистку —
// иначе автор курса мог бы вставить <script> и он выполнился бы у учеников.

const EdunityRich = (function () {
  const ALLOWED_TAGS = ['P','BR','B','STRONG','I','EM','U','S','H3','H4','UL','OL','LI','BLOCKQUOTE','CODE','PRE','A','IMG','DIV'];
  // data-src — постоянный адрес закрытой картинки урока (src у неё временный)
  const ALLOWED_ATTRS = { A: ['href', 'title'], IMG: ['src', 'alt', 'data-src'] };

  function safeUrl(v) {
    return /^(javascript|data|vbscript|file):/i.test(String(v || '').trim()) ? null : v;
  }

  // Очистка HTML перед показом на странице
  function sanitize(dirty) {
    if (!dirty) return '';
    const tpl = document.createElement('div');
    tpl.innerHTML = dirty;

    (function walk(node) {
      for (const child of Array.from(node.children)) {
        if (!ALLOWED_TAGS.includes(child.tagName)) {
          // тег запрещён — оставляем только его текст
          child.replaceWith(...Array.from(child.childNodes));
          continue;
        }

        const allowed = ALLOWED_ATTRS[child.tagName] || [];
        for (const attr of Array.from(child.attributes)) {
          if (!allowed.includes(attr.name.toLowerCase())) {
            child.removeAttribute(attr.name);
            continue;
          }
          if ((attr.name === 'href' || attr.name === 'src') && safeUrl(attr.value) === null) {
            child.removeAttribute(attr.name);
          }
        }

        if (child.tagName === 'A' && child.getAttribute('href')) {
          child.setAttribute('target', '_blank');
          child.setAttribute('rel', 'noopener noreferrer');
        }

        walk(child);
      }
    })(tpl);

    return tpl.innerHTML;
  }

  const BUTTONS = [
    { cmd: 'bold', label: 'B', title: 'მსხვილი', style: 'font-weight:700' },
    { cmd: 'italic', label: 'I', title: 'დახრილი', style: 'font-style:italic' },
    { cmd: 'underline', label: 'U', title: 'ხაზგასმული', style: 'text-decoration:underline' },
    { cmd: 'formatBlock', value: 'h3', label: 'H', title: 'სათაური' },
    { cmd: 'insertUnorderedList', label: '•', title: 'სია' },
    { cmd: 'insertOrderedList', label: '1.', title: 'ნუმერაცია' },
    { cmd: 'formatBlock', value: 'blockquote', label: '❝', title: 'ციტატა' },
    { cmd: 'createLink', label: '🔗', title: 'ბმული' },
    { cmd: 'insertImage', label: '🖼', title: 'სურათი' },
    { cmd: 'removeFormat', label: '✕', title: 'ფორმატირების მოხსნა' },
  ];

  // container — пустой div, куда встроится редактор
  // privateImages — картинки уходят в закрытое хранилище (содержимое урока)
  function attach(container, { value = '', onChange = () => {}, minHeight = 220, privateImages = false } = {}) {
    // Если контейнера нет (разметка изменилась, а вызов остался) — не роняем
    // всю страницу: без этого переставали работать и остальные кнопки формы.
    if (!container) {
      console.warn('[EdunityRich] контейнер не найден — редактор не подключён');
      return { value: value, };
    }

    container.innerHTML = `
      <div class="rich">
        <div class="rich-toolbar">
          ${BUTTONS.map(
            (b, i) =>
              `<button type="button" class="rich-btn" data-i="${i}" title="${b.title}" ${b.style ? `style="${b.style}"` : ''}>${b.label}</button>`
          ).join('')}
        </div>
        <div class="rich-area" contenteditable="true" style="min-height:${minHeight}px"></div>
      </div>
    `;

    const area = container.querySelector('.rich-area');
    area.innerHTML = sanitize(value);

    function emit() {
      onChange(sanitize(area.innerHTML));
    }

    area.addEventListener('input', emit);
    area.addEventListener('blur', emit);

    // Вставка только текстом — иначе из Word приезжает мусорная разметка
    area.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });

    container.querySelectorAll('.rich-btn').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => e.preventDefault()); // не терять выделение
      btn.addEventListener('click', async () => {
        const b = BUTTONS[Number(btn.dataset.i)];
        area.focus();

        if (b.cmd === 'createLink') {
          const url = await EdunityUI.prompt({ title: 'ბმული', placeholder: 'https://...', okText: 'დამატება' });
          if (url && safeUrl(url)) document.execCommand('createLink', false, url);
        } else if (b.cmd === 'insertImage') {
          await insertImage(area, privateImages);
        } else if (b.cmd === 'formatBlock') {
          document.execCommand('formatBlock', false, b.value);
        } else {
          document.execCommand(b.cmd, false, null);
        }

        emit();
      });
    });

    return {
      get value() {
        return sanitize(area.innerHTML);
      },
      set value(v) {
        area.innerHTML = sanitize(v);
      },
    };
  }

  // Загрузка картинки прямо в текст
  async function insertImage(area, privateImages) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';

    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        EdunityUI.toast('სურათი იტვირთება...', 'success');
        const data = await EdunityUpload.send(file, privateImages ? 'lesson-image' : 'image');
        area.focus();
        const src = EdunityUpload.fileUrl(data.previewUrl || data.url);
        const keep = data.url.startsWith('private://') ? ` data-src="${data.url}"` : '';
        document.execCommand('insertHTML', false, `<img src="${src}"${keep} alt="">`);
        area.dispatchEvent(new Event('input'));
      } catch (err) {
        EdunityUI.toast(err.message);
      }
    };

    input.click();
  }

  return { attach, sanitize };
})();
