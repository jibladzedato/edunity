// Виджет загрузки файлов на сервер (без внешних сервисов вроде YouTube).
// Использование:
//   EdunityUpload.attach(containerEl, { kind: 'image', value: url, onChange: (url) => {...} })

const EdunityUpload = (function () {
  function fileUrl(url) {
    if (!url) return '';
    // относительные пути (/uploads/...) отдаются бэкендом
    if (url.startsWith('/uploads/')) {
      const root = window.EDUNITY_CONFIG.SERVER_URL || window.EDUNITY_CONFIG.API_BASE_URL.replace(/\/api\/?$/, '');
      return root + url;
    }
    return url;
  }

  // Сжатие картинки в браузере: обложка 8 МБ в карточке шириной 240px
  // не нужна никому. Уменьшаем до 1280px и переводим в WebP.
  // Трафик на сервер и место в хранилище — меньше в разы.
  const MAX_SIDE = 1280;

  async function shrink(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;

    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      // мелкие файлы не трогаем
      if (scale === 1 && file.size < 400 * 1024) return file;

      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();

      const blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.85));
      if (!blob || blob.size >= file.size) return file; // хуже — оставляем оригинал

      return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' });
    } catch (e) {
      return file; // старый браузер — отправляем как есть
    }
  }

  async function send(file, kind) {
    const form = new FormData();
    form.append('file', await shrink(file));

    const token = EdunityAuth.getToken();
    const res = await fetch(window.EDUNITY_CONFIG.API_BASE_URL + '/uploads/' + kind, {
      method: 'POST',
      headers: token ? { Authorization: 'Bearer ' + token } : {},
      body: form,
    });

    let data = null;
    try {
      data = await res.json();
    } catch (e) {}

    if (!res.ok) throw new Error((data && data.error) || 'ატვირთვა ვერ მოხერხდა');
    return data;
  }

  function attach(container, { kind = 'image', value = '', onChange = () => {} } = {}) {
    let current = value || '';

    function preview() {
      if (!current) return '<div class="up-empty">ფაილი არ არის არჩეული</div>';
      const src = fileUrl(current);
      if (kind === 'image') {
        return `<img class="up-preview-img" src="${src}" alt="" data-src="${src}">`;
      }
      return `<video class="up-preview-video" src="${src}" controls data-src="${src}"></video>`;
    }

    // Если файл не открывается — показываем причину, а не прячем молча
    function watchPreviewErrors() {
      const media = container.querySelector('.up-preview-img, .up-preview-video');
      if (!media) return;
      media.addEventListener('error', () => {
        const box = container.querySelector('.up-preview');
        box.innerHTML = `
          <div class="up-broken">
            <strong>ფაილი ვერ ჩაიტვირთა</strong>
            <span>${media.dataset.src}</span>
            <span class="up-broken-hint">შეამოწმე, რომ backend გაშვებულია და განახლებულია (საჭიროა /uploads მისამართი).</span>
          </div>`;
      });
    }

    function render() {
      container.innerHTML = `
        <div class="up-box">
          <div class="up-preview">${preview()}</div>
          <div class="up-controls">
            <label class="up-btn">
              ${current ? 'ფაილის შეცვლა' : (kind === 'image' ? 'სურათის ატვირთვა' : 'ვიდეოს ატვირთვა')}
              <input type="file" accept="${kind === 'image' ? 'image/*' : 'video/*'}" hidden>
            </label>
            ${current ? '<button type="button" class="up-clear">წაშლა</button>' : ''}
            <div class="up-progress" hidden><div class="up-progress-bar"><span></span></div><span class="up-progress-text"></span></div>
          </div>
          <p class="up-hint">${kind === 'image' ? 'JPG, PNG, WebP ან GIF — მაქსიმუმ 8 MB' : 'MP4, WebM ან MOV — მაქსიმუმ 300 MB'}</p>
          <p class="up-status" id="up-status" hidden></p>
        </div>
      `;

      watchPreviewErrors();

      const input = container.querySelector('input[type="file"]');
      const status = container.querySelector('.up-status');
      const progress = container.querySelector('.up-progress');

      function showError(message) {
        status.hidden = false;
        status.className = 'up-status error';
        status.textContent = message;
        console.error('[EDUNITY upload]', message);
      }
      function showOk(message) {
        status.hidden = false;
        status.className = 'up-status ok';
        status.textContent = message;
      }
      const bar = container.querySelector('.up-progress-bar span');
      const text = container.querySelector('.up-progress-text');

      input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;

        progress.hidden = false;
        status.hidden = true;
        bar.style.width = '0%';
        text.textContent = '0%';
        console.log('[EDUNITY upload] отправка на', window.EDUNITY_CONFIG.API_BASE_URL + '/uploads/' + kind, file.name, file.size + 'b');

        try {
          // XMLHttpRequest — чтобы показать реальный процент для больших видео
          const data = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', window.EDUNITY_CONFIG.API_BASE_URL + '/uploads/' + kind);
            const token = EdunityAuth.getToken();
            if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);

            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable) {
                const pct = Math.round((e.loaded / e.total) * 100);
                bar.style.width = pct + '%';
                text.textContent = pct + '%';
              }
            };
            xhr.onload = () => {
              let parsed = null;
              try {
                parsed = JSON.parse(xhr.responseText);
              } catch (e) {}
              if (xhr.status >= 200 && xhr.status < 300) return resolve(parsed);

              if (xhr.status === 404) {
                return reject(new Error('სერვერზე ატვირთვის მისამართი ვერ მოიძებნა (404) — backend ძველია, განაახლე src ფოლდერი'));
              }
              if (xhr.status === 401) {
                return reject(new Error('სესია ამოიწურა — გამოდი და თავიდან შედი'));
              }
              reject(new Error((parsed && parsed.error) || `ატვირთვა ვერ მოხერხდა (HTTP ${xhr.status})`));
            };
            xhr.onerror = () =>
              reject(
                new Error(
                  'სერვერთან კავშირი ვერ დამყარდა: ' +
                    window.EDUNITY_CONFIG.API_BASE_URL +
                    ' — შეამოწმე, რომ backend გაშვებულია'
                )
              );
            xhr.timeout = kind === 'video' ? 15 * 60 * 1000 : 2 * 60 * 1000;
            xhr.ontimeout = () => reject(new Error('ატვირთვას ძალიან დიდი დრო დასჭირდა — სცადე თავიდან'));

            const form = new FormData();
            form.append('file', file);
            xhr.send(form);
          });

          console.log('[EDUNITY upload] успешно:', data.url);
          current = data.url;
          onChange(current);
          render();
          const st = container.querySelector('.up-status');
          if (st) {
            st.hidden = false;
            st.className = 'up-status ok';
            st.textContent = 'ატვირთულია ✓';
          }
          if (window.EdunityUI) EdunityUI.toast('ატვირთულია', 'success');
        } catch (err) {
          progress.hidden = true;
          showError(err.message);
          if (window.EdunityUI) EdunityUI.toast(err.message);
        }
      });

      const clearBtn = container.querySelector('.up-clear');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          current = '';
          onChange('');
          render();
        });
      }
    }

    render();
    return {
      get value() {
        return current;
      },
    };
  }

  // style="object-position:..." для обложки курса
  // Позиции по форматам: card | row | hero | thumb.
  // Старое значение из одной пары применяется ко всем.
  const POS_KEYS = ['card', 'row', 'hero', 'thumb'];
  function parsePos(pos) {
    const parts = String(pos || '').split('|').filter((p) => /^\d{1,3}% \d{1,3}%$/.test(p));
    const first = parts[0] || '50% 50%';
    const out = {};
    POS_KEYS.forEach((k, i) => (out[k] = parts[i] || first));
    return out;
  }
  function posStyle(pos) {
    const p = parsePos(pos);
    return `style="${POS_KEYS.map((k) => `--pos-${k}:${p[k]}`).join(';')}"`;
  }

  return { attach, send, fileUrl, posStyle, parsePos, POS_KEYS };
})();
