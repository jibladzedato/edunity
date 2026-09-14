// Вход через Google.
//
// Работает так: браузер получает от Google подписанный токен, отправляет его
// нам, а сервер проверяет подпись. Данным из браузера доверять нельзя —
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

  // container — элемент, вместо которого отрисуется кнопка Google
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

      container.innerHTML = '';
      google.accounts.id.renderButton(container, {
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'pill',
        width: container.offsetWidth || 320,
        locale: 'ka',
      });
    } catch (err) {
      console.error('[google-auth]', err.message);
      container.remove();
    }
  }

  return { render };
})();
