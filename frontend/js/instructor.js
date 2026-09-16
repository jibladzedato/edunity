// Публичная страница лектора: описание + все его опубликованные курсы

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const params = new URLSearchParams(window.location.search);
const userId = Number(params.get('id'));
const page = document.getElementById('instructor-page');

async function load() {
    try {
        const p = await EdunityAPI.instructorProfile(userId);
        document.title = p.name + ' | EDUNITY';

        const initial = (p.name || '?').trim().charAt(0).toUpperCase();

        page.innerHTML = `
            <section class="instructor-head">
                <div class="instructor-avatar">
                    ${p.avatarUrl ? `<img src="${EdunityUpload.fileUrl(p.avatarUrl)}" alt="" onerror="this.remove()">` : esc(initial)}
                </div>
                <div class="instructor-info">
                    <h1>${esc(p.name)}</h1>
                    ${p.bio ? `<p class="instructor-bio">${esc(p.bio)}</p>` : ''}
                    <div class="instructor-stats">
                        <span><strong>${p.courses.length}</strong> კურსი</span>
                        <span><strong>${p.totalStudents}</strong> მოსწავლე</span>
                    </div>
                </div>
            </section>

            <h2 class="editor-h2">კურსები</h2>

            ${
                p.courses.length === 0
                    ? '<p class="editor-empty">ამ ლექტორს ჯერ არ აქვს გამოქვეყნებული კურსი</p>'
                    : `<div class="instructor-courses">${p.courses
                          .map((c) => {
                              const ci = (c.title || '?').trim().charAt(0).toUpperCase();
                              const rating = Number(c.rating) > 0 ? c.rating : '—';
                              return `
                        <a class="instructor-course" href="course.html?id=${c.id}">
                            <div class="instructor-course-cover">
                                ${c.coverUrl
                                    ? `<img src="${EdunityUpload.fileUrl(c.coverUrl)}" ${EdunityUpload.posStyle(c.coverPos)} alt="" onerror="this.remove()">`
                                    : `<span>${esc(ci)}</span>`}
                            </div>
                            <div class="instructor-course-body">
                                <h3>${esc(c.title)}</h3>
                                ${c.summary ? `<p class="instructor-course-summary">${esc(c.summary)}</p>` : ''}
                                <div class="instructor-course-meta">
                                    <span><span class="rating-star">★</span> ${esc(rating)}</span>
                                    <span>${c.lessonsCount} გაკვეთილი</span>
                                    <span>${c.studentsCount} მოსწავლე</span>
                                    <span class="instructor-course-price">${c.price === 0 ? 'უფასო' : esc(c.price) + '₾'}</span>
                                </div>
                            </div>
                        </a>`;
                          })
                          .join('')}</div>`
            }
        `;
    } catch (err) {
        page.innerHTML = `<p class="editor-empty">${esc(err.message)}</p>`;
    }
}

load();
