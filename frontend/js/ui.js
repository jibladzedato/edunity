// Модальные окна в стиле сайта — замена браузерным prompt() / confirm().
// Использование:
//   const name = await EdunityUI.prompt({ title: 'კურსის სახელი', okText: 'შექმნა' });
//   if (name) { ... }   // null = отменено
//   const yes = await EdunityUI.confirm({ title: '...', text: '...' });

const EdunityUI = (function () {
  function buildOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'ui-modal';
    document.body.appendChild(overlay);
    return overlay;
  }

  function close(overlay) {
    overlay.remove();
    document.removeEventListener('keydown', overlay._onKey);
  }

  function prompt({ title, text = '', placeholder = '', value = '', okText = 'დადასტურება', cancelText = 'გაუქმება' }) {
    return new Promise((resolve) => {
      const overlay = buildOverlay();
      overlay.innerHTML = `
        <div class="ui-modal-box">
          <h3 class="ui-modal-title">${title}</h3>
          ${text ? `<p class="ui-modal-text">${text}</p>` : ''}
          <input type="text" class="ui-modal-input" placeholder="${placeholder}" value="${value}">
          <div class="ui-modal-actions">
            <button class="ui-modal-btn ghost" data-act="cancel">${cancelText}</button>
            <button class="ui-modal-btn primary" data-act="ok">${okText}</button>
          </div>
        </div>
      `;

      const input = overlay.querySelector('.ui-modal-input');
      setTimeout(() => input.focus(), 30);

      function finish(result) {
        close(overlay);
        resolve(result);
      }

      overlay.querySelector('[data-act="ok"]').addEventListener('click', () => {
        const v = input.value.trim();
        if (!v) {
          input.classList.add('invalid');
          input.focus();
          return;
        }
        finish(v);
      });
      overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => finish(null));
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) finish(null);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') overlay.querySelector('[data-act="ok"]').click();
      });
      input.addEventListener('input', () => input.classList.remove('invalid'));

      overlay._onKey = (e) => {
        if (e.key === 'Escape') finish(null);
      };
      document.addEventListener('keydown', overlay._onKey);
    });
  }

  function confirm({ title, text = '', okText = 'დიახ', cancelText = 'გაუქმება', danger = false }) {
    return new Promise((resolve) => {
      const overlay = buildOverlay();
      overlay.innerHTML = `
        <div class="ui-modal-box">
          <h3 class="ui-modal-title">${title}</h3>
          ${text ? `<p class="ui-modal-text">${text}</p>` : ''}
          <div class="ui-modal-actions">
            <button class="ui-modal-btn ghost" data-act="cancel">${cancelText}</button>
            <button class="ui-modal-btn ${danger ? 'danger' : 'primary'}" data-act="ok">${okText}</button>
          </div>
        </div>
      `;

      function finish(result) {
        close(overlay);
        resolve(result);
      }

      overlay.querySelector('[data-act="ok"]').addEventListener('click', () => finish(true));
      overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => finish(false));
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) finish(false);
      });

      overlay._onKey = (e) => {
        if (e.key === 'Escape') finish(false);
      };
      document.addEventListener('keydown', overlay._onKey);
    });
  }

  // Короткое уведомление внизу экрана (вместо alert для ошибок)
  function toast(message, type = 'error') {
    const el = document.createElement('div');
    el.className = 'ui-toast ' + type;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, 3200);
  }

  return { prompt, confirm, toast };
})();
