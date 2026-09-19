// Страница курса: описание, программа (модули/уроки), запись, отзывы

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const LEVEL_LABELS = { beginner: 'დამწყები', medium: 'საშუალო', advanced: 'მაღალი' };
const STEP_TYPE_LABELS = { text: 'ტექსტი', video: 'ვიდეო', quiz: 'ტესტი', code: 'პროგრამირება' };

const params = new URLSearchParams(window.location.search);
const courseId = Number(params.get('id'));
const page = document.getElementById('course-page');

let course = null;
let structure = [];
let progress = null;

function firstLessonId() {
    for (const m of structure) {
        if (m.lessons && m.lessons.length) return m.lessons[0].id;
    }
    return null;
}

function render() {
    const initial = (course.title || '?').trim().charAt(0).toUpperCase();
    const lessons = structure.flatMap((m) => m.lessons || []);
    const steps = lessons.flatMap((l) => l.steps || []);
    const rating = Number(course.rating) > 0 ? course.rating : null;

    page.innerHTML = `
        <div class="course-hero">
            <div class="course-hero-cover">
                ${
                    course.coverUrl
                        ? `<img src="${EdunityUpload.fileUrl(course.coverUrl)}" ${EdunityUpload.posStyle(course.coverPos)} alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'course-hero-initial',textContent:'${esc(initial)}'}))">`
                        : `<div class="course-hero-initial">${esc(initial)}</div>`
                }
            </div>
            <div class="course-hero-text">
                <h1>${esc(course.title)}</h1>
                ${course.summary ? `<p class="course-summary">${esc(course.summary)}</p>` : ''}
                <div class="course-hero-meta">
                    ${rating ? `<span class="course-rating"><span class="rating-star">★</span> ${esc(rating)}</span>` : ''}
                    <span>${course.studentsCount || 0} მოსწავლე</span>
                    ${course.category ? `<span>${esc(course.category)}</span>` : ''}
                    ${course.level ? `<span>${esc(LEVEL_LABELS[course.level] || course.level)}</span>` : ''}
                </div>
                <p class="course-author">ავტორი: <a class="author-link" href="instructor.html?id=${course.authorId}">${esc(course.authorName)}</a></p>
            </div>
        </div>

        <div class="course-body">
            <div class="course-content-columns">
                <div class="course-main">
                    ${
                        course.description
                            ? `<section>
                                    <h2>კურსის შესახებ</h2>
                                    <div class="course-description rich-content">${EdunityRich.sanitize(course.description)}</div>
                               </section>`
                            : ''
                    }

                    <section style="margin-top:28px">
                        <h2>კურსის პროგრამა</h2>
                        ${
                            structure.length === 0
                                ? '<p class="editor-empty">პროგრამა ჯერ არ არის შევსებული</p>'
                                : structure
                                      .map(
                                          (m, mi) => `
                                <div class="program-module">
                                    <div class="program-module-head">
                                        <span class="module-num">${mi + 1}</span>
                                        <span>${esc(m.title)}</span>
                                    </div>
                                    ${(m.lessons || [])
                                        .map(
                                            (l, li) => `
                                        <div class="program-lesson">
                                            <span class="program-lesson-num">${mi + 1}.${li + 1}</span>
                                            <span class="program-lesson-title">${esc(l.title)}</span>
                                            <span class="program-lesson-steps">${(l.steps || [])
                                                .map((s) => `<span class="step-chip ${s.type}">${STEP_TYPE_LABELS[s.type] || s.type}</span>`)
                                                .join('')}</span>
                                        </div>`
                                        )
                                        .join('')}
                                </div>`
                                      )
                                      .join('')
                        }
                    </section>

                    <section style="margin-top:28px">
                        <h2>შეფასებები</h2>
                        <div id="reviews-block"><p class="editor-loading">იტვირთება...</p></div>
                    </section>
                </div>

                <aside class="course-sidebar">
                    ${
                        progress && course.isEnrolled
                            ? `<div class="course-progress-box">
                                    <div class="cab-progress-bar"><span style="width:${progress.percent}%"></span></div>
                                    <span class="cab-progress-text">${progress.done}/${progress.total} ნაბიჯი · ${progress.percent}%</span>
                               </div>`
                            : ''
                    }
                    <div class="course-price">${EdunityUI.price(course.price)}</div>
                    <button class="course-start-btn" id="course-action-btn">...</button>
                    <div class="course-stats">
                        <div>${structure.length} მოდული</div>
                        <div>${lessons.length} გაკვეთილი</div>
                        <div>${steps.length} ნაბიჯი</div>
                        ${course.hasCertificate ? '<div>სერტიფიკატით</div>' : ''}
                    </div>
                    ${course.isOwner ? `<a class="studio-btn primary" style="margin-top:12px;display:block;text-align:center" href="course-editor.html?id=${course.id}">რედაქტირება</a>` : ''}
                    ${course.isEnrolled && !course.isOwner ? '<button class="course-unenroll" id="unenroll-btn">კურსიდან გაწერა</button>' : ''}
                </aside>
            </div>
        </div>
    `;

    setupActionButton();
    loadReviews();
}

function setupActionButton() {
    const btn = document.getElementById('course-action-btn');
    const lessonId = firstLessonId();

    if (!EdunityAuth.isLoggedIn()) {
        btn.textContent = 'შესვლა და დაწყება';
        btn.addEventListener('click', () => (window.location.href = 'login.html'));
        return;
    }

    if (course.isEnrolled) {
        btn.textContent = lessonId ? 'სწავლის გაგრძელება' : 'გაკვეთილები ჯერ არ არის';
        btn.disabled = !lessonId;
        if (lessonId) btn.addEventListener('click', () => (window.location.href = 'lesson.html?lessonId=' + lessonId));

        // Отписка — если записался по ошибке
        const unenrollBtn = document.getElementById('unenroll-btn');
        if (unenrollBtn) {
            unenrollBtn.addEventListener('click', async () => {
                const ok = await EdunityUI.confirm({
                    title: 'კურსიდან გაწერა',
                    text: 'კურსი გაქრება შენი კაბინეტიდან. პროგრესი შენახული დარჩება — თუ დაბრუნდები, თავიდან გავლა არ დაგჭირდება.',
                    okText: 'გაწერა',
                    danger: true,
                });
                if (!ok) return;
                try {
                    await EdunityAPI.unenroll(courseId);
                    EdunityUI.toast('კურსიდან გაიწერე', 'success');
                    load();
                } catch (err) {
                    EdunityUI.toast(err.message);
                }
            });
        }
        return;
    }

    btn.textContent = 'კურსზე ჩარიცხვა';
    btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
            await EdunityAPI.enroll(courseId);
            course.isEnrolled = true;
            EdunityUI.toast('კურსზე ჩაირიცხე', 'success');
            render();
        } catch (err) {
            // Почта не подтверждена — объясняем, что делать,
            // и даём отправить письмо повторно прямо отсюда
            if (err.data && err.data.emailNotVerified) {
                showVerifyNeeded();
            } else {
                EdunityUI.toast(err.message);
            }
            btn.disabled = false;
        }
    });
}

// Окно с объяснением, что нужно подтвердить почту
async function showVerifyNeeded() {
    const me = EdunityAuth.getUser();

    const resend = await EdunityUI.confirm({
        title: 'ჯერ დაადასტურე ელ.ფოსტა',
        text: `კურსზე ჩასაწერად საჭიროა ელ.ფოსტის დადასტურება. ბმული გამოგზავნილია მისამართზე ${me && me.email ? me.email : ''}. შეამოწმე შემოსულები და სპამიც.`,
        okText: 'ბმულის ხელახლა გამოგზავნა',
        cancelText: 'დახურვა',
    });

    if (!resend) return;

    try {
        await EdunityAPI.resendVerification(me.email);
        EdunityUI.toast('წერილი გამოგზავნილია', 'success');
    } catch (err) {
        EdunityUI.toast(err.message);
    }
}

async function loadReviews() {
    const box = document.getElementById('reviews-block');
    try {
        const reviews = await EdunityAPI.courseReviews(courseId);

        // Оценивать можно, только начав проходить курс
        const started = progress && progress.done > 0;
        const canReview = EdunityAuth.isLoggedIn() && course.isEnrolled && !course.isOwner && started;
        const notStartedYet = EdunityAuth.isLoggedIn() && course.isEnrolled && !course.isOwner && !started;

        box.innerHTML = `
            ${
                reviews.length === 0
                    ? '<p class="editor-empty">ჯერ არცერთი შეფასება არ არის</p>'
                    : reviews
                          .map(
                              (r) => `
                    <div class="review-card">
                        <div class="review-head">
                            <span class="review-user">${esc(r.userName)}</span>
                            <span class="review-stars"><span class="rating-star">★</span> ${r.rating}</span>
                        </div>
                        ${r.body ? `<p class="review-body">${esc(r.body)}</p>` : ''}
                    </div>`
                          )
                          .join('')
            }

            ${
                notStartedYet
                    ? '<p class="editor-hint" style="margin-top:12px">შეფასების დასატოვებლად ჯერ გაიარე მინიმუმ ერთი ნაბიჯი</p>'
                    : canReview
                    ? `<div class="review-form">
                        <h3>დატოვე შეფასება</h3>
                        <div class="rating-picker" id="rating-picker">
                            ${[1, 2, 3, 4, 5].map((n) => `<button data-rating="${n}">★</button>`).join('')}
                        </div>
                        <textarea id="review-body" rows="3" placeholder="შენი აზრი კურსზე (არასავალდებულო)"></textarea>
                        <button class="editor-save-btn" id="send-review">გაგზავნა</button>
                       </div>`
                    : ''
            }
        `;

        if (canReview) {
            let chosen = 0;
            const picker = document.getElementById('rating-picker');
            picker.querySelectorAll('button').forEach((b) => {
                b.addEventListener('click', () => {
                    chosen = Number(b.dataset.rating);
                    picker.querySelectorAll('button').forEach((x) => {
                        x.classList.toggle('on', Number(x.dataset.rating) <= chosen);
                    });
                });
            });

            document.getElementById('send-review').addEventListener('click', async (e) => {
                if (!chosen) {
                    EdunityUI.toast('აირჩიე შეფასება 1-დან 5-მდე');
                    return;
                }
                e.target.disabled = true;
                try {
                    await EdunityAPI.addReview(courseId, chosen, document.getElementById('review-body').value.trim());
                    EdunityUI.toast('მადლობა შეფასებისთვის', 'success');
                    loadReviews();
                } catch (err) {
                    EdunityUI.toast(err.message);
                    e.target.disabled = false;
                }
            });
        }
    } catch (err) {
        box.innerHTML = `<p class="editor-empty">${esc(err.message)}</p>`;
    }
}

async function load() {
    try {
        course = await EdunityAPI.course(courseId);
        document.title = course.title + ' | EDUNITY';
        structure = await EdunityAPI.courseStructure(courseId);

        if (EdunityAuth.isLoggedIn()) {
            try {
                progress = await EdunityAPI.courseProgress(courseId);
            } catch (e) {
                progress = null;
            }
        }

        render();
    } catch (err) {
        // заблокированный курс: объясняем, а не показываем «не найдено»
        const blocked = err.data && err.data.blocked;
        page.innerHTML = `
            <div class="course-blocked">
                <h1>${blocked ? esc(err.data.title || 'კურსი') : 'კურსი ვერ მოიძებნა'}</h1>
                <p>${esc(err.message)}</p>
                <a class="studio-btn primary" href="courses.html">სხვა კურსების ნახვა</a>
            </div>`;
    }
}

load();
