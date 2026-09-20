// Каталог курсов — данные из API (только опубликованные курсы)

let CATEGORIES = []; // заполняется из базы при загрузке

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const params = new URLSearchParams(window.location.search);
let allCourses = [];
let currentPage = 1;
let totalPages = 1;
let activeCategory = params.get('category') || 'ყველა';

const searchInput = document.getElementById('search-input');
const filterFree = document.getElementById('filter-free');
const filterCert = document.getElementById('filter-cert');
const searchButton = document.getElementById('search-button');
const categoryFiltersEl = document.getElementById('category-filters');
const catalogGrid = document.getElementById('catalog-grid');

searchInput.value = params.get('q') || '';
filterFree.checked = params.get('free') === '1';
filterCert.checked = params.get('cert') === '1';

function renderCategoryChips() {
    const cats = ['ყველა', ...CATEGORIES];
    categoryFiltersEl.innerHTML = '';

    cats.forEach((cat) => {
        const chip = document.createElement('button');
        chip.className = 'category-chip' + (cat === activeCategory ? ' active' : '');
        chip.textContent = cat;
        chip.addEventListener('click', () => {
            activeCategory = cat;
            renderCategoryChips();
            applyFilters(1);
        });
        categoryFiltersEl.appendChild(chip);
    });
}

function renderCourseCard(course) {
    const card = document.createElement('div');
    card.className = 'kursi-card';

    const initial = (course.title || '?').trim().charAt(0).toUpperCase();

    card.innerHTML = `
        ${
            course.coverUrl
                ? `<img class="kursi-picture" src="${EdunityUpload.fileUrl(course.coverUrl)}" ${EdunityUpload.posStyle(course.coverPos)} alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'kursi-picture kursi-noimg',textContent:'${esc(initial)}'}))">`
                : `<div class="kursi-picture kursi-noimg">${esc(initial)}</div>`
        }
        <div class="kursi-body">
            <div class="reitingi">
                ${
                    Number(course.rating) > 0
                        ? `<div class="shefaseba">
                    <span class="rating-star">★</span>
                    <span class="rating-value">${esc(course.rating)}</span>
                </div>`
                        : '<span class="shefaseba-carieli">შეფასება ჯერ არ არის</span>'
                }
                <span class="kursis-fasi">${EdunityUI.price(course.price)}</span>
            </div>

            <div class="kursis-saxeli">${esc(course.title)}</div>

            <div class="kursis-agwera">
                <div class="agwera-item">
                    <img src="../assets/gakvetilebi.svg" alt="">
                    ${course.lessonsCount || 0} გაკვეთილი
                </div>
                ${
                    course.durationHours
                        ? `<div class="agwera-item">
                    <img src="../assets/dro.svg" alt="">
                    ${course.durationHours} საათი
                </div>`
                        : ''
                }
                <div class="agwera-item">
                    <img src="../assets/person.svg" alt="">
                    ${course.studentsCount || 0} მოსწავლე
                </div>
            </div>

            <div class="kursis-footer">
                <div class="avtori">
                    <span class="avtoris-saxeli">${esc(course.authorName)}</span>
                </div>
                <button class="kursis-dawyeba">ნახვა</button>
            </div>
        </div>
    `;

    card.querySelector('.kursis-dawyeba').addEventListener('click', () => {
        window.location.href = 'course.html?id=' + course.id;
    });
    card.addEventListener('click', (e) => {
        if (!e.target.closest('.kursis-dawyeba')) window.location.href = 'course.html?id=' + course.id;
    });
    card.style.cursor = 'pointer';

    return card;
}

// Фильтрация теперь на сервере: браузер получает только нужную страницу,
// а не весь каталог целиком.
let searchTimer = null;

async function applyFilters(page = 1) {
    currentPage = page;
    catalogGrid.innerHTML = '<p class="catalog-empty">იტვირთება...</p>';

    const query = {};
    const q = searchInput.value.trim();
    if (q) query.q = q;
    if (filterFree.checked) query.free = '1';
    if (filterCert.checked) query.cert = '1';
    if (activeCategory !== 'ყველა') query.category = activeCategory;
    query.page = page;
    query.limit = 12;

    try {
        const data = await EdunityAPI.courses(query);
        allCourses = data.courses;
        totalPages = data.pages;

        catalogGrid.innerHTML = '';
        if (allCourses.length === 0) {
            catalogGrid.innerHTML = '<p class="catalog-empty">ვერაფერი მოიძებნა ამ პარამეტრებით</p>';
            renderPagination(0);
            return;
        }

        allCourses.forEach((course) => catalogGrid.appendChild(renderCourseCard(course)));
        renderPagination(data.total);
    } catch (err) {
        catalogGrid.innerHTML = `<p class="catalog-empty">ვერ ჩაიტვირთა: ${esc(err.message)}</p>`;
    }
}

function renderPagination(total) {
    let box = document.getElementById('catalog-pagination');
    if (!box) {
        box = document.createElement('div');
        box.id = 'catalog-pagination';
        box.className = 'catalog-pagination';
        catalogGrid.parentElement.appendChild(box);
    }

    if (totalPages <= 1) {
        box.innerHTML = total ? `<span class="pagination-info">${total} კურსი</span>` : '';
        return;
    }

    box.innerHTML = `
        <button class="studio-btn" ${currentPage === 1 ? 'disabled' : ''} data-page="${currentPage - 1}">← წინა</button>
        <span class="pagination-info">გვერდი ${currentPage} / ${totalPages} · სულ ${total} კურსი</span>
        <button class="studio-btn" ${currentPage === totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">შემდეგი →</button>
    `;

    box.querySelectorAll('[data-page]').forEach((btn) => {
        btn.addEventListener('click', () => {
            applyFilters(Number(btn.dataset.page));
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    });
}

searchButton.addEventListener('click', () => applyFilters(1));
filterFree.addEventListener('change', () => applyFilters(1));
filterCert.addEventListener('change', () => applyFilters(1));
searchInput.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') applyFilters(1);
});
// Запрос уходит через полсекунды после последней буквы
searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => applyFilters(1), 500);
});

async function load() {
    catalogGrid.innerHTML = '<p class="catalog-empty">იტვირთება...</p>';
    try {
        CATEGORIES = await loadCategories();
        renderCategoryChips();
        await applyFilters(1);
    } catch (err) {
        catalogGrid.innerHTML = `<p class="catalog-empty">ვერ ჩაიტვირთა: ${esc(err.message)}</p>`;
    }
}

load();
