// Адрес бэкенда.
//
// ВАЖНО: адрес берётся от того же хоста, с которого открыта страница.
// Если страница открыта как http://192.168.222.1:5500, то API будет
// http://192.168.222.1:4000/api — а не localhost.
//
// Почему так: Chrome блокирует запросы со страницы в «более приватную» сеть
// (Private Network Access). Страница на 192.168.x.x не может грузить картинки
// и видео с localhost — они молча не отображаются. Один и тот же хост решает
// проблему полностью.
//
// После деплоя backend впиши его адрес в API_OVERRIDE ниже, например:
//   const API_OVERRIDE = "https://edunity-api.onrender.com/api";

(function () {
  const API_OVERRIDE = "https://edunity-ld72.onrender.com/api";// ← заполнить только для продакшна

  const API_PORT = 4000;

  let base;

  if (API_OVERRIDE) {
    base = API_OVERRIDE;
  } else if (window.location.protocol === 'file:' || !window.location.hostname) {
    // страница открыта двойным кликом, без сервера
    base = 'http://localhost:' + API_PORT + '/api';
  } else {
    base = window.location.protocol + '//' + window.location.hostname + ':' + API_PORT + '/api';
  }

  window.EDUNITY_CONFIG = {
    API_BASE_URL: base,
    // корень сервера — для картинок и видео из /uploads
    SERVER_URL: base.replace(/\/api\/?$/, ''),
  };
})();
