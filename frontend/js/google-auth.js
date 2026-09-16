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
  // Google рисует кнопку внутри iframe и не даёт сделать её шире 400px.
  // Нажать iframe программно нельзя (real.click() ничего не делает),
  // поэтому настоящая кнопка лежит прозрачной ПОВЕРХ своей и растягивается
  // на её размер. Пользователь видит свою кнопку, а кликает по Google.
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
        '<button type="button" class="avtorizacia-google" tabindex="-1">' +
        '<img src="../assets/google.svg" alt="">' +
        'გაგრძელება Google-ით' +
        '</button>';

      const hidden = container.querySelector('.google-hidden');
      const visible = container.querySelector('.avtorizacia-google');

      google.accounts.id.renderButton(hidden, {
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        width: 400,
      });

      // растягиваем прозрачную кнопку Google на размер своей
      function fit() {
        hidden.style.transform = 'none';
        const w = hidden.offsetWidth;
        const h = hidden.offsetHeight;
        if (!w || !h) return;
        hidden.style.transform =
          'scale(' + visible.offsetWidth / w + ',' + visible.offsetHeight / h + ')';
      }

      // iframe Google появляется с задержкой — ждём его размеры
      if (window.ResizeObserver) new ResizeObserver(fit).observe(visible);
      setTimeout(fit, 300);
      setTimeout(fit, 1200);
      window.addEventListener('resize', fit);
    } catch (err) {
      console.error('[google-auth]', err.message);
      container.remove();
    }
  }

  return { render };
})();
