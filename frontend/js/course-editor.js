// Конструктор курса: აღწერა (описание) / შინაარსი (структура) / ანალიტიკა

let CATEGORIES = []; // заполняется из базы при загрузке
const LEVELS = [
    { value: 'beginner', label: 'დამწყები' },
    { value: 'medium', label: 'საშუალო' },
    { value: 'advanced', label: 'მაღალი' },
];

const params = new URLSearchParams(window.location.search);
const courseId = Number(params.get('id'));

const main = document.getElementById('editor-main');
const titleEl = document.getElementById('editor-course-title');
const badgeEl = document.getElementById('editor-status-badge');
const publishBtn = document.getElementById('editor-publish-btn');

let course = null;

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderHeader() {
    titleEl.textContent = course.title;
    const published = course.status === 'published';
    const blocked = course.status === 'blocked';

    badgeEl.textContent = blocked ? 'დაბლოკილია' : published ? 'გამოქვეყნებული' : 'მონახაზი';
    badgeEl.className = 'editor-status-badge ' + (blocked ? 'blocked' : published ? 'published' : 'draft');

    publishBtn.textContent = published ? 'გამოქვეყნების გაუქმება' : 'გამოქვეყნება';
    publishBtn.disabled = blocked;
    publishBtn.title = blocked ? 'დაბლოკილი კურსის გამოქვეყნება შეუძლებელია' : '';

    // Баннер о блокировке
    const old = document.getElementById('blocked-banner');
    if (old) old.remove();
    if (blocked) {
        const banner = document.createElement('div');
        banner.id = 'blocked-banner';
        banner.className = 'blocked-banner';
        banner.innerHTML = `
            <strong>კურსი დაბლოკილია ადმინისტრაციის მიერ</strong>
            <span>${esc(course.blockedReason || 'წესების დარღვევა')}</span>
            <span class="blocked-note">რედაქტირება შესაძლებელია, გამოქვეყნება — არა.</span>`;
        document.querySelector('.editor-sidebar').insertBefore(banner, document.querySelector('.editor-nav'));
    }
}

publishBtn.addEventListener('click', async () => {
    // Снять с публикации можно всегда
    if (course.status === 'published') {
        publishBtn.disabled = true;
        try {
            course = await EdunityAPI.updateCourse(courseId, { status: 'draft' });
            renderHeader();
        } catch (err) {
            EdunityUI.toast(err.message);
        } finally {
            publishBtn.disabled = false;
        }
        return;
    }

    // Публикация — только если выполнены все требования
    publishBtn.disabled = true;
    try {
        const structure = await EdunityAPI.courseStructure(courseId);
        const result = EdunityPublish.check(course, structure);

        if (!result.ready) {
            EdunityUI.toast(`კურსი ჯერ არ არის მზად: ${result.passed}/${result.total} მოთხოვნა შესრულებულია`);
            openSection('publish');
            return;
        }

        course = await EdunityAPI.updateCourse(courseId, { status: 'published' });
        renderHeader();
        EdunityUI.toast('კურსი გამოქვეყნდა', 'success');
    } catch (err) {
        // сервер тоже проверяет правила — показываем его список замечаний
        const failed = err.data && err.data.failed;
        EdunityUI.toast(failed ? err.message + ': ' + failed.join(', ') : err.message);
        openSection('publish');
    } finally {
        publishBtn.disabled = false;
    }
});

// ==========================================================
// РАЗДЕЛ: აღწერა
// ==========================================================
function renderDescription() {
    main.innerHTML = `
        <h1 class="editor-h1">კურსის აღწერა</h1>

        <div class="editor-field">
            <label for="f-title">კურსის სახელი</label>
            <input type="text" id="f-title" value="${esc(course.title)}" maxlength="200">
        </div>

        <div class="editor-field">
            <label for="cover-upload">ყდის სურათი</label>
            <div id="cover-upload"></div>
            <div class="cover-pos" id="cover-pos"></div>
        </div>

        <div class="editor-field">
            <label for="f-summary">მოკლე აღწერა <span class="editor-hint">ჩანს კატალოგში</span></label>
            <textarea id="f-summary" rows="3" maxlength="512">${esc(course.summary)}</textarea>
        </div>

        <div class="editor-field">
            <label>სრული აღწერა <span class="editor-hint">ჩანს კურსის გვერდზე</span></label>
            <div id="f-description-rich"></div>
        </div>

        <div class="editor-row">
            <div class="editor-field">
                <label for="f-category">კატეგორია</label>
                <select id="f-category">
                    <option value="">— აირჩიე —</option>
                    ${CATEGORIES.map((c) => `<option value="${esc(c)}" ${course.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
                </select>
            </div>
            <div class="editor-field">
                <label for="f-level">სირთულე</label>
                <select id="f-level">
                    <option value="">— აირჩიე —</option>
                    ${LEVELS.map((l) => `<option value="${l.value}" ${course.level === l.value ? 'selected' : ''}>${l.label}</option>`).join('')}
                </select>
            </div>
            <div class="editor-field">
                <label for="f-price">ფასი (₾) <span class="editor-hint">0 = უფასო</span></label>
                <input type="number" id="f-price" value="${course.price || 0}" min="0" max="9999" step="1">
            </div>
            <div class="editor-field">
                <label for="f-duration">ხანგრძლივობა (საათი) <span class="editor-hint">0 = არ ჩანს</span></label>
                <input type="number" id="f-duration" value="${course.durationHours || 0}" min="0" max="999" step="1">
            </div>
        </div>

        <label class="editor-checkbox">
            <input type="checkbox" id="f-cert" ${course.hasCertificate ? 'checked' : ''}> სერტიფიკატით დასრულების შემდეგ
        </label>

        <div class="editor-actions">
            <button class="editor-save-btn" id="save-description">შენახვა</button>
            <span class="editor-saved" id="saved-msg" hidden>შენახულია ✓</span>
        </div>
    `;

    let descriptionHtml = course.description || '';
    EdunityRich.attach(document.getElementById('f-description-rich'), {
        value: descriptionHtml,
        minHeight: 180,
        onChange: (html) => { descriptionHtml = html; },
    });

    let coverUrl = course.coverUrl || '';
    let coverPos = course.coverPos || '50% 50%';
    EdunityUpload.attach(document.getElementById('cover-upload'), {
        kind: 'image',
        value: coverUrl,
        // Сохраняем обложку сразу — чтобы результат не потерялся,
        // если страница перезагрузится до нажатия «შენახვა».
        onChange: async (url) => {
            coverUrl = url;
            renderCoverPos();
            try {
                course = await EdunityAPI.updateCourse(courseId, { coverUrl: url || null });
            } catch (err) {
                EdunityUI.toast(err.message);
            }
        },
    });

    // ==== Предпросмотр обложки во всех форматах ====
    // У каждого формата своя позиция (object-position).
    // На телефоне форматы те же, что и на компьютере.
    const coverFormats = [
        { key: 'card', cls: 'home', label: 'მთავარი გვერდი' },
        { key: 'row', cls: 'catalog', label: 'კურსების სია' },
        { key: 'hero', cls: 'hero', label: 'კურსის გვერდი' },
        { key: 'thumb', cls: 'thumb', label: 'სწავლება' },
    ];

    function renderCoverPos() {
        const box = document.getElementById('cover-pos');
        if (!coverUrl) {
            box.innerHTML = '';
            return;
        }
        const src = EdunityUpload.fileUrl(coverUrl);
        const pos = EdunityUpload.parsePos(coverPos);
        box.innerHTML = `
            <div class="cover-pos-head">
                <span class="editor-hint">გადაათრიე სურათი, რომ სწორად ჩანდეს</span>
                <button type="button" class="tool-btn" id="cover-pos-reset">ყველა ცენტრში</button>
            </div>
            <div class="cover-pos-grid">
                ${coverFormats.map((f) => `
                    <div class="cover-pos-item">
                        <div class="cover-pos-frame ${f.cls}" data-key="${f.key}">
                            <img src="${esc(src)}" alt="" draggable="false" style="object-position:${pos[f.key]}">
                        </div>
                        <span class="cover-pos-label">${f.label}</span>
                    </div>`).join('')}
            </div>
        `;

        function sync() {
            coverPos = EdunityUpload.POS_KEYS.map((k) => pos[k]).join('|');
        }

        async function save() {
            try {
                course = await EdunityAPI.updateCourse(courseId, { coverPos });
            } catch (err) {
                EdunityUI.toast(err.message);
            }
        }

        box.querySelectorAll('.cover-pos-frame').forEach((frame) => {
            const img = frame.querySelector('img');
            const key = frame.dataset.key;
            let start = null;

            frame.addEventListener('pointerdown', (e) => {
                if (!img.naturalWidth) return;
                const fw = frame.clientWidth;
                const fh = frame.clientHeight;
                const scale = Math.max(fw / img.naturalWidth, fh / img.naturalHeight);
                const [px, py] = pos[key].split(' ').map(parseFloat);
                start = {
                    x: e.clientX, y: e.clientY, px, py,
                    // сколько пикселей фото выходит за рамку
                    ox: img.naturalWidth * scale - fw,
                    oy: img.naturalHeight * scale - fh,
                };
                frame.setPointerCapture(e.pointerId);
                frame.classList.add('dragging');
            });

            frame.addEventListener('pointermove', (e) => {
                if (!start) return;
                const clamp = (v) => Math.min(100, Math.max(0, v));
                const x = start.ox > 0 ? clamp(start.px - ((e.clientX - start.x) / start.ox) * 100) : start.px;
                const y = start.oy > 0 ? clamp(start.py - ((e.clientY - start.y) / start.oy) * 100) : start.py;
                pos[key] = `${Math.round(x)}% ${Math.round(y)}%`;
                img.style.objectPosition = pos[key];
                sync();
            });

            const end = () => {
                if (!start) return;
                start = null;
                frame.classList.remove('dragging');
                save();
            };
            frame.addEventListener('pointerup', end);
            frame.addEventListener('pointercancel', end);
        });

        document.getElementById('cover-pos-reset').addEventListener('click', () => {
            EdunityUpload.POS_KEYS.forEach((k) => (pos[k] = '50% 50%'));
            box.querySelectorAll('img').forEach((im) => (im.style.objectPosition = '50% 50%'));
            sync();
            save();
        });
    }
    renderCoverPos();

    document.getElementById('save-description').addEventListener('click', async (e) => {
        const btn = e.target;
        btn.disabled = true;
        try {
            const updated = await EdunityAPI.updateCourse(courseId, {
                title: document.getElementById('f-title').value.trim(),
                coverUrl: coverUrl || null,
                coverPos,
                summary: document.getElementById('f-summary').value.trim() || null,
                description: descriptionHtml || null,
                category: document.getElementById('f-category').value || null,
                level: document.getElementById('f-level').value || null,
                price: Math.min(9999, Math.max(0, Math.round(Number(document.getElementById('f-price').value) || 0))),
                durationHours: Math.min(999, Math.max(0, Math.round(Number(document.getElementById('f-duration').value) || 0))),
                hasCertificate: document.getElementById('f-cert').checked,
            });
            course = updated;
            renderHeader();

            if (updated.unpublished) {
                // сервер снял курс с публикации, потому что он перестал отвечать требованиям
                EdunityUI.toast('კურსი მოიხსნა გამოქვეყნებიდან: ' + (updated.unpublishedReason || []).join(', '));
            } else {
                const msg = document.getElementById('saved-msg');
                msg.hidden = false;
                setTimeout(() => (msg.hidden = true), 2000);
            }
        } catch (err) {
            EdunityUI.toast(err.message);
        } finally {
            btn.disabled = false;
        }
    });
}

// ==========================================================
// РАЗДЕЛ: შინაარსი (модули → уроки → шаги)
// ==========================================================
const STEP_TYPE_LABELS = { text: 'ტექსტი', video: 'ვიდეო', quiz: 'ტესტი', code: 'პროგრამირება' };

async function renderContent() {
    main.innerHTML = `
        <h1 class="editor-h1">კურსის შინაარსი</h1>
        <p class="editor-sub">შექმენი მოდულები და გაკვეთილები. ნაბიჯების რედაქტირება ხდება ცალკე გვერდზე.</p>
        <div id="structure-tree" class="structure-tree"><p class="editor-loading">იტვირთება...</p></div>
        <button class="editor-add-btn" id="add-module">+ მოდულის დამატება</button>
    `;

    document.getElementById('add-module').addEventListener('click', async () => {
        const title = await EdunityUI.prompt({ title: 'ახალი მოდული', placeholder: 'მაგ.: თავი 1: შესავალი', okText: 'დამატება' });
        if (!title) return;
        try {
            await EdunityAPI.createModule(courseId, title);
            loadStructure();
        } catch (err) {
            EdunityUI.toast(err.message);
        }
    });

    loadStructure();
}

async function loadStructure() {
    const tree = document.getElementById('structure-tree');
    try {
        const modules = await EdunityAPI.courseStructure(courseId);

        if (modules.length === 0) {
            tree.innerHTML = '<p class="editor-empty">ჯერ არცერთი მოდული არ არის შექმნილი</p>';
            return;
        }

        tree.innerHTML = modules
            .map(
                (m, mi) => `
            <div class="module-block" data-module-id="${m.id}">
                <div class="module-head">
                    <span class="module-num">${mi + 1}</span>
                    <span class="module-title">${esc(m.title)}</span>
                    <div class="module-tools">
                        <button class="tool-btn move" data-action="move-module-up" data-id="${m.id}" title="ზემოთ" ${mi === 0 ? 'disabled' : ''}>↑</button>
                        <button class="tool-btn move" data-action="move-module-down" data-id="${m.id}" title="ქვემოთ" ${mi === modules.length - 1 ? 'disabled' : ''}>↓</button>
                        <button class="tool-btn" data-action="rename-module" data-id="${m.id}">გადარქმევა</button>
                        <button class="tool-btn danger" data-action="delete-module" data-id="${m.id}">წაშლა</button>
                    </div>
                </div>

                <div class="lesson-list">
                    ${m.lessons
                        .map(
                            (l, li) => `
                        <div class="lesson-row">
                            <span class="lesson-num">${mi + 1}.${li + 1}</span>
                            <span class="lesson-title">${esc(l.title)}</span>
                            <span class="lesson-steps">${l.steps.length ? l.steps.map((s) => `<span class="step-chip ${s.type}">${STEP_TYPE_LABELS[s.type] || s.type}</span>`).join('') : '<span class="lesson-nosteps">ნაბიჯების გარეშე</span>'}</span>
                            <div class="lesson-tools">
                                <button class="tool-btn move" data-action="move-lesson-up" data-id="${l.id}" title="ზემოთ" ${li === 0 ? 'disabled' : ''}>↑</button>
                                <button class="tool-btn move" data-action="move-lesson-down" data-id="${l.id}" title="ქვემოთ" ${li === m.lessons.length - 1 ? 'disabled' : ''}>↓</button>
                                <a class="tool-btn primary" href="step-editor.html?lessonId=${l.id}">ნაბიჯების რედაქტირება</a>
                                <button class="tool-btn" data-action="rename-lesson" data-id="${l.id}">გადარქმევა</button>
                                <button class="tool-btn danger" data-action="delete-lesson" data-id="${l.id}">წაშლა</button>
                            </div>
                        </div>
                    `
                        )
                        .join('')}
                    <button class="editor-add-btn small" data-action="add-lesson" data-id="${m.id}">+ გაკვეთილის დამატება</button>
                </div>
            </div>
        `
            )
            .join('');

        tree.querySelectorAll('[data-action]').forEach((btn) => {
            btn.addEventListener('click', onTreeAction);
        });
    } catch (err) {
        tree.innerHTML = `<p class="editor-empty">ვერ ჩაიტვირთა: ${esc(err.message)}</p>`;
    }
}

async function onTreeAction(e) {
    const action = e.currentTarget.dataset.action;
    const id = Number(e.currentTarget.dataset.id);

    try {
        if (action === 'move-module-up' || action === 'move-module-down') {
            await EdunityAPI.moveModule(id, action.endsWith('up') ? 'up' : 'down');
        } else if (action === 'move-lesson-up' || action === 'move-lesson-down') {
            await EdunityAPI.moveLesson(id, action.endsWith('up') ? 'up' : 'down');
        } else if (action === 'add-lesson') {
            const title = await EdunityUI.prompt({ title: 'ახალი გაკვეთილი', placeholder: 'გაკვეთილის სახელი', okText: 'დამატება' });
            if (!title) return;
            await EdunityAPI.createLesson(id, title);
        } else if (action === 'rename-module') {
            const title = await EdunityUI.prompt({ title: 'მოდულის გადარქმევა', placeholder: 'ახალი სახელი', okText: 'შენახვა' });
            if (!title) return;
            await EdunityAPI.updateModule(id, title);
        } else if (action === 'delete-module') {
            const ok = await EdunityUI.confirm({ title: 'მოდულის წაშლა', text: 'წაიშლება ყველა გაკვეთილი და ნაბიჯი ამ მოდულში.', okText: 'წაშლა', danger: true });
            if (!ok) return;
            await EdunityAPI.deleteModule(id);
        } else if (action === 'rename-lesson') {
            const title = await EdunityUI.prompt({ title: 'გაკვეთილის გადარქმევა', placeholder: 'ახალი სახელი', okText: 'შენახვა' });
            if (!title) return;
            await EdunityAPI.updateLesson(id, title);
        } else if (action === 'delete-lesson') {
            const ok = await EdunityUI.confirm({ title: 'გაკვეთილის წაშლა', text: 'წაიშლება ყველა ნაბიჯი ამ გაკვეთილში.', okText: 'წაშლა', danger: true });
            if (!ok) return;
            await EdunityAPI.deleteLesson(id);
        }
        loadStructure();
    } catch (err) {
        EdunityUI.toast(err.message);
    }
}

// ==========================================================
// РАЗДЕЛ: ანალიტიკა
// ==========================================================
async function renderAnalytics() {
    main.innerHTML = `<h1 class="editor-h1">ანალიტიკა</h1><p class="editor-loading">იტვირთება...</p>`;

    try {
        const a = await EdunityAPI.courseAnalytics(courseId);

        main.innerHTML = `
            <h1 class="editor-h1">ანალიტიკა</h1>

            <div class="stat-row">
                <div class="stat-card">
                    <div class="stat-value">${a.studentsCount}</div>
                    <div class="stat-label">ჩარიცხული მოსწავლე</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${a.averageRating ? `<span class="rating-star">★</span> ${a.averageRating}` : '—'}</div>
                    <div class="stat-label">საშუალო შეფასება</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${a.reviews.length}</div>
                    <div class="stat-label">შეფასება</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${a.comments.length}</div>
                    <div class="stat-label">კომენტარი</div>
                </div>
            </div>

            <h2 class="editor-h2">შეფასებები</h2>
            ${
                a.reviews.length === 0
                    ? '<p class="editor-empty">ჯერ არცერთი შეფასება არ არის</p>'
                    : a.reviews
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

            <h2 class="editor-h2">კომენტარები ნაბიჯებზე</h2>
            ${
                a.comments.length === 0
                    ? '<p class="editor-empty">ჯერ არცერთი კომენტარი არ არის</p>'
                    : a.comments
                          .map(
                              (c) => `
                    <div class="review-card">
                        <div class="review-head">
                            <span class="review-user">${esc(c.userName)}</span>
                            <span class="comment-where">${esc(c.moduleTitle)} · ${esc(c.lessonTitle)}</span>
                        </div>
                        <p class="review-body">${esc(c.body)}</p>
                    </div>`
                          )
                          .join('')
            }
        `;
    } catch (err) {
        main.innerHTML = `<h1 class="editor-h1">ანალიტიკა</h1><p class="editor-empty">${esc(err.message)}</p>`;
    }
}

// ==========================================================
// РАЗДЕЛ: პუბლიკაციის პარამეტრები
// ==========================================================
async function renderPublish() {
    main.innerHTML = `<h1 class="editor-h1">პუბლიკაციის პარამეტრები</h1><p class="editor-loading">იტვირთება...</p>`;

    try {
        const structure = await EdunityAPI.courseStructure(courseId);
        const result = EdunityPublish.check(course, structure);
        const published = course.status === 'published';

        main.innerHTML = `
            <h1 class="editor-h1">პუბლიკაციის პარამეტრები</h1>
            <p class="editor-sub">გამოქვეყნებამდე კურსმა უნდა დააკმაყოფილოს ქვემოთ ჩამოთვლილი მოთხოვნები.</p>

            <div class="publish-progress">
                <div class="publish-progress-head">
                    <span>კურსის მზაობა</span>
                    <strong>${result.passed}/${result.total}</strong>
                </div>
                <div class="publish-progress-bar">
                    <span style="width:${Math.round((result.passed / result.total) * 100)}%"></span>
                </div>
            </div>

            <ul class="publish-checklist">
                ${result.rules
                    .map(
                        (r) => `
                    <li class="publish-rule ${r.ok ? 'ok' : 'fail'}">
                        <span class="publish-mark">${r.ok ? '✓' : '✕'}</span>
                        <div class="publish-rule-body">
                            <span class="publish-rule-label">${r.label}</span>
                            ${r.ok ? '' : `<span class="publish-rule-hint">${r.hint}</span>`}
                            ${r.ok ? '' : `<button class="publish-goto" data-goto="${r.section}">გასწორება →</button>`}
                        </div>
                    </li>`
                    )
                    .join('')}
            </ul>

            <div class="publish-final">
                ${
                    result.ready
                        ? published
                            ? '<p class="publish-ready">კურსი გამოქვეყნებულია და ჩანს კატალოგში.</p>'
                            : '<p class="publish-ready">ყველა მოთხოვნა შესრულებულია — კურსი მზადაა გამოსაქვეყნებლად.</p><button class="editor-save-btn" id="publish-now">კურსის გამოქვეყნება</button>'
                        : '<p class="publish-notready">გაასწორე მონიშნული პუნქტები, რომ კურსი გამოაქვეყნო.</p>'
                }
            </div>
        `;

        main.querySelectorAll('[data-goto]').forEach((btn) => {
            btn.addEventListener('click', () => openSection(btn.dataset.goto));
        });

        const publishNow = document.getElementById('publish-now');
        if (publishNow) {
            publishNow.addEventListener('click', async () => {
                publishNow.disabled = true;
                try {
                    course = await EdunityAPI.updateCourse(courseId, { status: 'published' });
                    renderHeader();
                    EdunityUI.toast('კურსი გამოქვეყნდა', 'success');
                    renderPublish();
                } catch (err) {
                    EdunityUI.toast(err.message);
                    publishNow.disabled = false;
                }
            });
        }
    } catch (err) {
        main.innerHTML = `<h1 class="editor-h1">პუბლიკაციის პარამეტრები</h1><p class="editor-empty">${esc(err.message)}</p>`;
    }
}

// ==========================================================
// Навигация по разделам
// ==========================================================
const SECTIONS = { description: renderDescription, content: renderContent, publish: renderPublish, analytics: renderAnalytics };

function openSection(name) {
    document.querySelectorAll('.editor-nav-item').forEach((b) => {
        b.classList.toggle('active', b.dataset.section === name);
    });
    SECTIONS[name]();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.querySelectorAll('.editor-nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.editor-nav-item').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        SECTIONS[btn.dataset.section]();
    });
});

async function init() {
    if (!EdunityAuth.isLoggedIn()) {
        window.location.href = 'login.html';
        return;
    }
    try {
        CATEGORIES = await loadCategories();
        course = await EdunityAPI.course(courseId);
        if (!course.isOwner) {
            main.innerHTML = '<p class="editor-empty">თქვენ არ ხართ ამ კურსის ავტორი</p>';
            return;
        }
        renderHeader();
        renderDescription();
    } catch (err) {
        main.innerHTML = `<p class="editor-empty">${esc(err.message)}</p>`;
    }
}

init();
