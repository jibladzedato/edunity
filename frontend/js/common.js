// Общий код для всех страниц: бургер-меню + состояние авторизации в шапке.
// Подключается ПОСЛЕ api.js и ДО остальных page-specific скриптов.

(function () {
  const navi = document.getElementById("nav");
  const overlay = document.getElementById("overlay");
  const burger = document.getElementById("burger-button");
  const closebutton = document.getElementById("close-button");

  function openburger() {
    navi.classList.add("open");
    overlay.classList.add("active");
  }

  function closeburger() {
    navi.classList.remove("open");
    overlay.classList.remove("active");
  }

  if (burger) burger.addEventListener("click", openburger);
  if (closebutton) closebutton.addEventListener("click", closeburger);

  // Определяем, находимся ли мы внутри /pages/, чтобы построить правильные относительные ссылки
  const inPagesFolder = window.location.pathname.includes("/pages/");
  const pagesPrefix = inPagesFolder ? "" : "pages/";

  // Есть два места, где показывается статус авторизации:
  // 1) .auth-slot внутри мобильного меню (li) — видно в бургер-меню
  // 2) .auth-slot внутри .desktop-auth — видно только на десктопе, справа от навигации
  // Оба обновляем одинаково.
  const authSlots = document.querySelectorAll(".auth-slot");

  // Ссылка на админку — только для администраторов
  const cachedUser = EdunityAuth.getUser();
  if (EdunityAuth.isLoggedIn() && cachedUser && (cachedUser.role === 'admin' || cachedUser.role === 'owner')) {
    const navList = document.querySelector('#nav ul');
    if (navList && !document.getElementById('admin-nav-link')) {
      const li = document.createElement('li');
      li.id = 'admin-nav-link';
      li.innerHTML = `<a href="${pagesPrefix}admin.html">ადმინი</a>`;
      // ставим перед пунктом авторизации
      const authItem = navList.querySelector('.nav-auth-item');
      if (authItem) navList.insertBefore(li, authItem);
      else navList.appendChild(li);
    }
  }

  authSlots.forEach((el) => {
    if (EdunityAuth.isLoggedIn()) {
      const user = EdunityAuth.getUser();
      el.textContent = user && user.name ? user.name.split(" ")[0] : "კაბინეტი";
      el.setAttribute("href", pagesPrefix + "cabinet.html");
      el.classList.add("logged-in");
    } else {
      el.textContent = "შესვლა/რეგისტრაცია";
      el.setAttribute("href", pagesPrefix + "login.html");
      el.classList.remove("logged-in");
    }
  });
})();
