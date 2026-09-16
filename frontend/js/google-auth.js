// Вход через Google.
//
// Браузер получает от Google подписанный токен и отправляет его нам,
// а сервер проверяет подпись. Данным из браузера доверять нельзя —
// проверка на сервере обязательна, иначе вход подделывается тривиально.
//
// Если GOOGLE_CLIENT_ID на сервере не задан, кнопка просто не появляется.

const EdunityGoogle = (function () {
  let clientId = null;

  function loadScript() {
    return new Promise((resolve, reject) => {
      if (window.google && window.google.accounts) return resolve();
      const el = document.createElement('script');
      el.src = 'https://accounts.google.com/gsi/client';
      el.async = true;
      el.onload = resolve;
      el.onerror = () => reject(new Error('Google-ის სკრიპტი ვერ ჩაიტვირთა'));
      document.head.appendChild(el);
    });
  }

  async function handleCredential(response) {
    try {
      const data = await EdunityAPI.googleLogin(response.credential);
      EdunityAuth.save(data.token, data.user);
      window.location.href = 'cabinet.html';
    } catch (err) {
      if (window.EdunityUI) EdunityUI.toast(err.message);
      else alert(err.message);
    }
  }

  // container — элемент, вместо которого появится кнопка Google.
  //
  // Google рисует свою кнопку внутри iframe и не даёт сделать её шире 400px,
  // поэтому она выбивалась из формы. Решение: настоящая кнопка прячется,
  // а сверху показывается своя — с размерами как у кнопки входа.
  // Клик по ней программно нажимает настоящую.
  async function render(container) {
    if (!container) return;

    try {
      const providers = await EdunityAPI.authProviders();
      if (!providers.google || !providers.googleClientId) {
        container.remove(); // вход через Google выключен на сервере
        return;
      }
      clientId = providers.googleClientId;

      await loadScript();

      google.accounts.id.initialize({
        client_id: clientId,
        callback: handleCredential,
      });

      container.innerHTML =
        '<div class="google-hidden" aria-hidden="true"></div>' +
        '<button type="button" class="avtorizacia-google">' +
        '<img src="../assets/google.svg" alt="">' +
        'გაგრძელება Google-ით' +
        '</button>';

      const hidden = container.querySelector('.google-hidden');
      const visible = container.querySelector('.avtorizacia-google');

      google.accounts.id.renderButton(hidden, {
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        width: 300,
      });

      visible.addEventListener('click', () => {
        // ищем настоящую кнопку внутри контейнера Google и нажимаем её
        const real =
          hidden.querySelector('div[role="button"]') ||
          hidden.querySelector('button') ||
          hidden.querySelector('iframe');

        if (real && typeof real.click === 'function') {
          real.click();
        } else {
          // если структура Google изменилась — показываем их кнопку как есть,
          // чтобы вход всё равно остался рабочим
          hidden.classList.remove('google-hidden');
          visible.remove();
        }
      });
    } catch (err) {
      console.error('[google-auth]', err.message);
      container.remove();
    }
  }

  return { render };
})();