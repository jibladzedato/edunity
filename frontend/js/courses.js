// Каталог курсов — данные из API (только опубликованные курсы)

let CATEGORIES = []; // заполняется из базы при загрузке

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const params = new URLSearchParams(window.location.search);
let allCourses = [];
let activeCategory = params.get('category') || 'ყველა';

const searchInput = document.getElementById('search-input');
const filterFree = document.getElementById('filter-free');
const filterCert = document.getElementById('filter-cert');
const searchButton = document.getElementById('search-button');
const filterToggle = document.getElementById('filter-toggle');
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
            applyFilters();
        });
        categoryFiltersEl.appendChild(chip);
    });
}

function renderCourseCard(course) {
    const card = document.createElement('div');
    card.className = 'kursi-card';

    const initial = (course.title || '?').trim().charAt(0).toUpperCase();
    const rating = Number(course.rating) > 0 ? course.rating : '—';

    card.innerHTML = `
        ${
            course.coverUrl
                ? `<img class="kursi-picture" src="${EdunityUpload.fileUrl(course.coverUrl)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'kursi-picture kursi-noimg',textContent:'${esc(initial)}'}))">`
                : `<div class="kursi-picture kursi-noimg">${esc(initial)}</div>`
        }
        <div class="kursi-body">
            <div class="reitingi">
                <div class="shefaseba">
                    <span class="rating-star">★</span>
                    <span class="rating-value">${esc(rating)}</span>
                </div>
                <span class="kursis-fasi">${course.price === 0 ? 'უფასო' : esc(course.price) + '₾'}</span>
            </div>

            <div class="kursis-saxeli">${esc(course.title)}</div>

            <div class="kursis-agwera">
                <div class="agwera-item">
                    <img src="../assets/gakvetilebi.svg" alt="">
                    ${course.lessonsCount || 0} გაკვეთილი
                </div>
                <div class="agwera-item">
                    <img src="../assets/dro.svg" alt="">
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

function applyFilters() {
    const query = searchInput.value.trim().toLowerCase();
    const onlyFree = filterFree.checked;
    const onlyCert = filterCert.checked;

    const filtered = allCourses.filter((c) => {
        const matchesQuery = !query || (c.title || '').toLowerCase().includes(query);
        const matchesFree = !onlyFree || c.price === 0;
        const matchesCert = !onlyCert || c.hasCertificate === true;
        const matchesCategory = activeCategory === 'ყველა' || c.category === activeCategory;
        return matchesQuery && matchesFree && matchesCert && matchesCategory;
    });

    catalogGrid.innerHTML = '';
    if (filtered.length === 0) {
        catalogGrid.innerHTML = '<p class="catalog-empty">ვერაფერი მოიძებნა ამ პარამეტრებით</p>';
        return;
    }
    filtered.forEach((course) => catalogGrid.appendChild(renderCourseCard(course)));
}

searchButton.addEventListener('click', applyFilters);
filterToggle.addEventListener('click', applyFilters);
filterFree.addEventListener('change', applyFilters);
filterCert.addEventListener('change', applyFilters);
searchInput.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') applyFilters();
});
searchInput.addEventListener('input', applyFilters);

async function load() {
    catalogGrid.innerHTML = '<p class="catalog-empty">იტვირთება...</p>';
    try {
        CATEGORIES = await loadCategories();
        allCourses = await EdunityAPI.courses();
        renderCategoryChips();
        applyFilters();
    } catch (err) {
        catalogGrid.innerHTML = `<p class="catalog-empty">ვერ ჩაიტვირთა: ${esc(err.message)}</p>`;
    }
}

load();
