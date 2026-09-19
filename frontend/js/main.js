// Логика главной страницы: слайдер категорий + рендер курсов/лекторов из API
// Бургер-меню и авторизация в шапке — в common.js (подключается раньше этого файла)

const container = document.getElementById('cards-container');
const wina = document.getElementById('wina');
const shemdegi = document.getElementById('shemdegi');

let index = 0;
const total = container.children.length;

function getCardWidth() {
    return container.children[0].offsetWidth + 2;
}

shemdegi.onclick = () => {
    const visible = window.innerWidth >= 768 ? 3 : 2;

    if (index < total - visible) {
        index++;
        container.style.transform = `translateX(-${index * getCardWidth()}px)`;
    }
};

wina.onclick = () => {
    if (index > 0) {
        index--;
        container.style.transform = `translateX(-${index * getCardWidth()}px)`;
    }
};

// Клик по категории на главной — ведёт в каталог, отфильтрованный по этой категории
document.querySelectorAll('#cards-container [data-category]').forEach((card) => {
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => {
        const category = card.getAttribute('data-category');
        window.location.href = 'pages/courses.html?category=' + encodeURIComponent(category);
    });
});

document.getElementById('ipove-kursi-button').addEventListener('click', () => {
    window.location.href = 'pages/courses.html';
});

function renderkursebi(courses) {
    const cont = document.querySelector('.kursebi-container');
    cont.innerHTML = '';

    courses.forEach(course => {
        const card = document.createElement('div');
        card.className = 'kursi-card';

        const initial = (course.title || '?').trim().charAt(0).toUpperCase();

        card.innerHTML = `
            ${course.coverUrl
                ? `<img class="kursi-picture" src="${EdunityUpload.fileUrl(course.coverUrl)}" ${EdunityUpload.posStyle(course.coverPos)} alt="">`
                : `<div class="kursi-picture kursi-noimg">${initial}</div>`}
            <div class="kursi-body">
                <div class="reitingi">
                    ${
                        Number(course.rating) > 0
                            ? `<div class="shefaseba">
                        <span class="rating-star">★</span>
                        <span class="rating-value">${course.rating}</span>
                    </div>`
                            : '<span class="shefaseba-carieli">შეფასება ჯერ არ არის</span>'
                    }
                    <span class="kursis-fasi">${EdunityUI.price(course.price)}</span>
                </div>

                <div class="kursis-saxeli">${course.title}</div>

                <div class="kursis-agwera">
                    <div class="agwera-item">
                        <img src="assets/gakvetilebi.svg" alt="">
                        ${course.lessonsCount || 0} გაკვეთილი
                    </div>

                    ${
                        course.durationHours
                            ? `<div class="agwera-item">
                        <img src="assets/dro.svg" alt="">
                        ${course.durationHours} საათი
                    </div>`
                            : ''
                    }
                    <div class="agwera-item">${course.studentsCount || 0} მოსწავლე</div>
                </div>

                <div class="kursis-footer">
                    <div class="avtori">
                        <span class="avtoris-saxeli">${course.authorName}</span>
                    </div>

                    <button class="kursis-dawyeba" data-id="${course.id}">ნახვა</button>
                </div>
            </div>
        `;

        card.querySelector('.kursis-dawyeba').addEventListener('click', () => {
            window.location.href = 'pages/course.html?id=' + course.id;
        });

        cont.appendChild(card);
    });

    const meti = document.createElement('div');
    meti.className = 'kursi-card meti';
    meti.innerHTML = `
        <button class="meti-btn">ყველას ნახვა</button>
    `;
    meti.querySelector('.meti-btn').addEventListener('click', () => {
        window.location.href = 'pages/courses.html';
    });

    cont.appendChild(meti);
}

function renderLektorebi(instructors) {
    const cont = document.querySelector('.leqtorebis-fotoebi');
    cont.innerHTML = '';

    if (!instructors || instructors.length === 0) {
        cont.innerHTML = '<p class="catalog-empty">ლექტორები ჯერ არ არიან</p>';
        return;
    }

    instructors.slice(0, 4).forEach((leqtori) => {
        const card = document.createElement('a');
        card.className = 'leqtori-card';
        card.href = 'pages/instructor.html?id=' + leqtori.id;
        card.style.textDecoration = 'none';
        const initial = (leqtori.name || '?').trim().charAt(0).toUpperCase();

        card.innerHTML = `
            ${leqtori.avatarUrl
                ? `<img src="${EdunityUpload.fileUrl(leqtori.avatarUrl)}" alt="">`
                : `<div class="leqtori-initial">${initial}</div>`}
            <div class="leqtoris-agwera">
                <div class="leqtoris-saxeli">${leqtori.name}</div>
                <div class="leqtoris-pozicia">${leqtori.coursesCount} კურსი</div>
            </div>
        `;

        cont.appendChild(card);
    });
}

// Поиск на главной странице теперь не фильтрует список на месте —
// он ведёт на отдельную страницу с каталогом курсов (pages/courses.html)
function goToCatalogWithSearch() {
    const params = new URLSearchParams();
    const query = (searchInput.value || '').trim();
    if (query) params.set('q', query);
    if (filterFree.checked) params.set('free', '1');
    if (filterCert.checked) params.set('cert', '1');
    window.location.href = 'pages/courses.html' + (params.toString() ? '?' + params.toString() : '');
}

const searchInput = document.getElementById('search-input');
const filterFree = document.getElementById('filter-free');
const filterCert = document.getElementById('filter-cert');
const searchButton = document.getElementById('search-button');

searchButton.addEventListener('click', goToCatalogWithSearch);
searchInput.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') goToCatalogWithSearch();
});

async function load() {
    const cont = document.querySelector('.kursebi-container');
    try {
        // Что показывать на главной, задаёт админ; если ничего не задано —
        // бэкенд сам подставит свежие курсы и активных лекторов.
        const data = await EdunityAPI.homeFeatured();
        renderkursebi(data.courses.slice(0, 5));
        renderLektorebi(data.instructors);
    } catch (err) {
        cont.innerHTML = '<p class="catalog-empty">კურსები ვერ ჩაიტვირთა</p>';
    }
}

load();
