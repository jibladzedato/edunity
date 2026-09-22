// Админка: обзор, управление главной страницей, блокировка курсов, пользователи

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const main = document.getElementById('admin-main');

function categoryIconUrl(icon) {
    if (!icon) return '';
    if (icon.startsWith('/uploads/')) return EdunityUpload.fileUrl(icon);
    if (icon.startsWith('http')) return icon;
    return '../assets/' + icon;
}
const STATUS_LABELS = { draft: 'მონახაზი', published: 'გამოქვეყნებული', blocked: 'დაბლოკილი' };
const ROLE_LABELS = { student: 'სტუდენტი', instructor: 'ლექტორი', admin: 'ადმინი', owner: 'მფლობელი' };
let isOwner = false;

// ==========================================================
// Обзор
// ==========================================================
async function renderOverview() {
    main.innerHTML = '<h1 class="editor-h1">მიმოხილვა</h1><p class="editor-loading">იტვირთება...</p>';
    try {
        const s = await EdunityAPI.adminStats();
        main.innerHTML = `
            <h1 class="editor-h1">მიმოხილვა</h1>
            <div class="stat-row">
                <div class="stat-card"><div class="stat-value">${s.users}</div><div class="stat-label">მომხმარებელი</div></div>
                <div class="stat-card"><div class="stat-value">${s.courses}</div><div class="stat-label">კურსი</div></div>
                <div class="stat-card"><div class="stat-value">${s.published}</div><div class="stat-label">გამოქვეყნებული</div></div>
                <div class="stat-card"><div class="stat-value">${s.blocked}</div><div class="stat-label">დაბლოკილი</div></div>
                <div class="stat-card"><div class="stat-value">${s.enrollments}</div><div class="stat-label">ჩარიცხვა</div></div>
            </div>

            <h2 class="editor-h2">ფოსტის შემოწმება</h2>
            <p class="editor-sub">გაგზავნის ტესტურ წერილს და აჩვენებს, რა უპასუხა ფოსტის სერვისმა.</p>
            <div class="mail-test">
                <input type="email" id="mail-test-to" placeholder="მისამართი შესამოწმებლად">
                <button class="tool-btn primary" id="mail-test-btn">გაგზავნა</button>
            </div>
            <div id="mail-test-result"></div>
        `;

        document.getElementById('mail-test-btn').addEventListener('click', async (e) => {
            const to = document.getElementById('mail-test-to').value.trim();
            if (!to) return;
            e.target.disabled = true;
            const box = document.getElementById('mail-test-result');
            box.innerHTML = '<p class="editor-loading">იგზავნება...</p>';

            try {
                const r = await EdunityAPI.adminMailTest(to);
                box.innerHTML = `
                    <div class="mail-test-result ${r.sent ? 'ok' : 'fail'}">
                        <div><b>რეჟიმი:</b> ${esc(r.method)}</div>
                        <div><b>გამგზავნი:</b> ${esc(r.from)}</div>
                        <div><b>შედეგი:</b> ${r.sent ? 'გაიგზავნა ✓' : r.loggedToConsole ? 'ფოსტა არ არის კონფიგურირებული — ბმული კონსოლშია' : 'ვერ გაიგზავნა'}</div>
                        ${r.error ? `<div><b>შეცდომა:</b> ${esc(r.error)}</div>` : ''}
                    </div>`;
            } catch (err) {
                box.innerHTML = `<div class="mail-test-result fail">${esc(err.message)}</div>`;
            }
            e.target.disabled = false;
        });
    } catch (err) {
        main.innerHTML = `<h1 class="editor-h1">მიმოხილვა</h1><p class="editor-empty">${esc(err.message)}</p>`;
    }
}

// ==========================================================
// Главная страница: что продвигаем
// ==========================================================
async function renderHomepage() {
    main.innerHTML = '<h1 class="editor-h1">მთავარი გვერდი</h1><p class="editor-loading">იტვირთება...</p>';

    try {
        const [featured, courses, users] = await Promise.all([
            EdunityAPI.adminFeatured(),
            EdunityAPI.adminCourses(),
            EdunityAPI.adminUsers(),
        ]);

        const publishable = courses.filter((c) => c.status === 'published');
        const chosenCourseIds = new Set(featured.courses.map((c) => c.id));
        const chosenUserIds = new Set(featured.instructors.map((i) => i.id));
        const instructorCandidates = users.filter((u) => u.coursesCount > 0);

        main.innerHTML = `
            <h1 class="editor-h1">მთავარი გვერდი</h1>
            <p class="editor-sub">აირჩიე, რომელი კურსები და ლექტორები გამოჩნდეს მთავარ გვერდზე. თუ არაფერს აირჩევ, საიტი ავტომატურად აჩვენებს ბოლო კურსებს.</p>

            <h2 class="editor-h2">პოპულარული კურსები</h2>
            ${
                featured.courses.length === 0
                    ? '<p class="editor-empty">ავტომატური რეჟიმი: ჩანს ბოლო გამოქვეყნებული კურსები</p>'
                    : `<div class="admin-chosen">${featured.courses
                          .map(
                              (c) => `
                        <div class="admin-chosen-item">
                            <span>${esc(c.title)}</span>
                            <button class="tool-btn danger" data-remove-featured="${c.featuredId}">მოხსნა</button>
                        </div>`
                          )
                          .join('')}</div>`
            }

            <div class="editor-field" style="margin-top:12px">
                <label>კურსის დამატება</label>
                <select id="add-course-select">
                    <option value="">— აირჩიე კურსი —</option>
                    ${publishable
                        .filter((c) => !chosenCourseIds.has(c.id))
                        .map((c) => `<option value="${c.id}">${esc(c.title)} — ${esc(c.authorName)}</option>`)
                        .join('')}
                </select>
                <button class="tool-btn primary" id="add-course-btn" style="margin-top:8px">დამატება</button>
            </div>

            <h2 class="editor-h2">აარჩიე სასურველი ლექტორი</h2>
            ${
                featured.instructors.length === 0
                    ? '<p class="editor-empty">ავტომატური რეჟიმი: ჩანან ყველაზე აქტიური ლექტორები</p>'
                    : `<div class="admin-chosen">${featured.instructors
                          .map(
                              (i) => `
                        <div class="admin-chosen-item">
                            <span>${esc(i.name)} · ${i.coursesCount} კურსი</span>
                            <button class="tool-btn danger" data-remove-featured="${i.featuredId}">მოხსნა</button>
                        </div>`
                          )
                          .join('')}</div>`
            }

            <div class="editor-field" style="margin-top:12px">
                <label>ლექტორის დამატება</label>
                <select id="add-user-select">
                    <option value="">— აირჩიე ლექტორი —</option>
                    ${instructorCandidates
                        .filter((u) => !chosenUserIds.has(u.id))
                        .map((u) => `<option value="${u.id}">${esc(u.name)} — ${u.coursesCount} კურსი</option>`)
                        .join('')}
                </select>
                <button class="tool-btn primary" id="add-user-btn" style="margin-top:8px">დამატება</button>
            </div>
        `;

        main.querySelectorAll('[data-remove-featured]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                try {
                    await EdunityAPI.adminRemoveFeatured(Number(btn.dataset.removeFeatured));
                    renderHomepage();
                } catch (err) {
                    EdunityUI.toast(err.message);
                }
            });
        });

        document.getElementById('add-course-btn').addEventListener('click', async () => {
            const id = Number(document.getElementById('add-course-select').value);
            if (!id) return;
            try {
                await EdunityAPI.adminAddFeatured({ kind: 'course', courseId: id });
                renderHomepage();
            } catch (err) {
                EdunityUI.toast(err.message);
            }
        });

        document.getElementById('add-user-btn').addEventListener('click', async () => {
            const id = Number(document.getElementById('add-user-select').value);
            if (!id) return;
            try {
                await EdunityAPI.adminAddFeatured({ kind: 'instructor', userId: id });
                renderHomepage();
            } catch (err) {
                EdunityUI.toast(err.message);
            }
        });
    } catch (err) {
        main.innerHTML = `<h1 class="editor-h1">მთავარი გვერდი</h1><p class="editor-empty">${esc(err.message)}</p>`;
    }
}

// ==========================================================
// Управление курсами
// ==========================================================
async function renderCourses() {
    main.innerHTML = '<h1 class="editor-h1">კურსების მართვა</h1><p class="editor-loading">იტვირთება...</p>';

    try {
        const courses = await EdunityAPI.adminCourses();
        try {
            isOwner = !!(await EdunityAPI.adminMe()).isOwner;
        } catch (e) {
            isOwner = false;
        }

        main.innerHTML = `
            <h1 class="editor-h1">კურსების მართვა</h1>
            <p class="editor-sub">დაბლოკილი კურსი ქრება კატალოგიდან. ავტორს რჩება რედაქტირების უფლება, მაგრამ ვერ გამოაქვეყნებს.</p>
            ${
                isOwner
                    ? `<div class="backup-bar">
                <label class="studio-btn">
                    კურსის იმპორტი (.zip)
                    <input type="file" id="import-file" accept=".zip" hidden>
                </label>
                <span class="editor-hint" id="backup-status"></span>
            </div>`
                    : ''
            }

            ${
                courses.length === 0
                    ? '<p class="editor-empty">კურსები ჯერ არ არის</p>'
                    : `<div class="admin-table">${courses
                          .map(
                              (c) => `
                        <div class="admin-row">
                            <div class="admin-row-main">
                                <span class="admin-row-title">${esc(c.title)}</span>
                                <span class="admin-row-meta">
                                    <em class="badge-${c.status}">${STATUS_LABELS[c.status] || c.status}</em>
                                    · ${esc(c.authorName)} · ${c.studentsCount} მოსწავლე
                                    ${c.blockedReason ? '· მიზეზი: ' + esc(c.blockedReason) : ''}
                                </span>
                            </div>
                            <div class="admin-row-actions">
                                <a class="tool-btn" href="course.html?id=${c.id}">ნახვა</a>
                                ${isOwner ? `<button class="tool-btn" data-export="${c.id}">ექსპორტი</button>` : ''}
                                ${
                                    c.status === 'blocked'
                                        ? `<button class="tool-btn primary" data-unblock="${c.id}">განბლოკვა</button>`
                                        : `<button class="tool-btn danger" data-block="${c.id}" data-title="${esc(c.title)}">დაბლოკვა</button>`
                                }
                            </div>
                        </div>`
                          )
                          .join('')}</div>`
            }
        `;

        if (isOwner) bindBackup();

        main.querySelectorAll('[data-block]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const reason = await EdunityUI.prompt({
                    title: 'კურსის დაბლოკვა',
                    text: `«${btn.dataset.title}» ქრება კატალოგიდან. მიუთითე მიზეზი — ავტორი მას დაინახავს.`,
                    placeholder: 'მაგ.: შინაარსი არღვევს წესებს',
                    okText: 'დაბლოკვა',
                });
                if (!reason) return;
                try {
                    await EdunityAPI.adminBlockCourse(Number(btn.dataset.block), reason);
                    EdunityUI.toast('კურსი დაიბლოკა', 'success');
                    renderCourses();
                } catch (err) {
                    EdunityUI.toast(err.message);
                }
            });
        });

        main.querySelectorAll('[data-unblock]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                try {
                    await EdunityAPI.adminUnblockCourse(Number(btn.dataset.unblock));
                    EdunityUI.toast('კურსი განიბლოკა — გადავიდა მონახაზებში', 'success');
                    renderCourses();
                } catch (err) {
                    EdunityUI.toast(err.message);
                }
            });
        });
    } catch (err) {
        main.innerHTML = `<h1 class="editor-h1">კურსების მართვა</h1><p class="editor-empty">${esc(err.message)}</p>`;
    }
}

// ==========================================================
// Пользователи
// ==========================================================
async function renderUsers() {
    main.innerHTML = '<h1 class="editor-h1">მომხმარებლები</h1><p class="editor-loading">იტვირთება...</p>';

    try {
        try {
            const me = await EdunityAPI.adminMe();
            isOwner = !!me.isOwner;
        } catch (e) {
            isOwner = false;
        }
        const users = await EdunityAPI.adminUsers();
        main.innerHTML = `
            <h1 class="editor-h1">მომხმარებლები</h1>
            <p class="editor-sub">${isOwner ? 'როგორც მფლობელი, შეგიძლია ადმინისტრატორების დანიშვნაც.' : 'ადმინისტრატორის დანიშვნა მხოლოდ საიტის მფლობელს შეუძლია.'}</p>
            <div class="admin-table">
                ${users
                    .map(
                        (u) => `
                    <div class="admin-row">
                        <div class="admin-row-main">
                            <span class="admin-row-title">${esc(u.name)}</span>
                            <span class="admin-row-meta">${esc(u.email)} · ${ROLE_LABELS[u.role] || esc(u.role)} · ${u.coursesCount} კურსი</span>
                        </div>
                        ${
                            u.role === 'owner'
                                ? '<span class="owner-badge">საიტის მფლობელი</span>'
                                : `<div class="admin-row-actions">
                                    <select class="role-select" data-roleuser="${u.id}">
                                        ${['student', 'instructor', 'admin']
                                            .map((r) => {
                                                const blocked = r === 'admin' && !isOwner;
                                                return `<option value="${r}" ${u.role === r ? 'selected' : ''} ${blocked ? 'disabled' : ''}>${ROLE_LABELS[r]}</option>`;
                                            })
                                            .join('')}
                                    </select>
                                    <button class="tool-btn danger" data-deluser="${u.id}" data-name="${esc(u.name)}">წაშლა</button>
                                   </div>`
                        }
                    </div>`
                    )
                    .join('')}
            </div>
        `;
        main.querySelectorAll('[data-roleuser]').forEach((sel) => {
            sel.addEventListener('change', async () => {
                const id = Number(sel.dataset.roleuser);
                try {
                    await EdunityAPI.adminSetRole(id, sel.value);
                    EdunityUI.toast('როლი შეიცვალა', 'success');
                } catch (err) {
                    EdunityUI.toast(err.message);
                    renderUsers();
                }
            });
        });

        main.querySelectorAll('[data-deluser]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const id = Number(btn.dataset.deluser);
                let preview = null;
                try {
                    preview = await EdunityAPI.adminUserDeletionPreview(id);
                } catch (e) {}

                const details = preview
                    ? `კურსები: ${preview.authoredCourses.length}, კომენტარები: ${preview.comments}, შეფასებები: ${preview.reviews}` +
                      (preview.affectedStudents ? `. ამ კურსებზე ${preview.affectedStudents} მოსწავლეა.` : '')
                    : '';

                const ok = await EdunityUI.confirm({
                    title: `წაიშალოს «${btn.dataset.name}»?`,
                    text: `ყველა მონაცემი სამუდამოდ წაიშლება. ${details}`,
                    okText: 'წაშლა',
                    danger: true,
                });
                if (!ok) return;

                try {
                    await EdunityAPI.adminDeleteUser(id);
                    EdunityUI.toast('მომხმარებელი წაშლილია', 'success');
                    renderUsers();
                } catch (err) {
                    EdunityUI.toast(err.message);
                }
            });
        });
    } catch (err) {
        main.innerHTML = `<h1 class="editor-h1">მომხმარებლები</h1><p class="editor-empty">${esc(err.message)}</p>`;
    }
}

// ==========================================================
// Категории
// ==========================================================
async function renderCategories() {
    main.innerHTML = '<h1 class="editor-h1">კატეგორიები</h1><p class="editor-loading">იტვირთება...</p>';

    try {
        const cats = await EdunityAPI.adminCategories();

        main.innerHTML = `
            <h1 class="editor-h1">კატეგორიები</h1>
            <p class="editor-sub">კატეგორიები ჩანს კატალოგში და კურსის რედაქტორში.</p>

            <div class="cat-list">
                ${cats
                    .map(
                        (c) => `
                    <div class="cat-row" data-id="${c.id}">
                        <div class="cat-preview" style="background-color:${esc(c.color || '#F5F8F4')}">
                            ${c.icon ? `<img src="${categoryIconUrl(c.icon)}" alt="">` : ''}
                            <span>${esc(c.name)}</span>
                        </div>
                        <div class="cat-controls">
                            <label class="cat-color-label">
                                ფერი
                                <input type="color" class="cat-color" value="${esc(c.color || '#F5F8F4')}" data-id="${c.id}">
                            </label>
                            <div class="cat-icon-upload" data-id="${c.id}" data-icon="${esc(c.icon || '')}"></div>
                            <button class="tool-btn" data-rename="${c.id}" data-name="${esc(c.name)}">გადარქმევა</button>
                            <button class="tool-btn danger" data-delcat="${c.id}">წაშლა</button>
                        </div>
                        <span class="cat-count">${c.courses_count} კურსი</span>
                    </div>`
                    )
                    .join('')}
            </div>

            <div class="editor-field" style="margin-top:22px">
                <label for="new-category">ახალი კატეგორია</label>
                <input type="text" id="new-category" placeholder="კატეგორიის სახელი">
                <div class="new-cat-row">
                    <label class="cat-color-label">
                        ფერი
                        <input type="color" id="new-category-color" value="#EEFBF5">
                    </label>
                    <button class="tool-btn primary" id="add-category">დამატება</button>
                </div>
                <p class="editor-hint">ხატულა დაამატე კატეგორიის შექმნის შემდეგ</p>
            </div>
        `;

        // Цвет сохраняется сразу при выборе
        main.querySelectorAll('.cat-color').forEach((input) => {
            input.addEventListener('change', async () => {
                const row = input.closest('.cat-row');
                const name = row.querySelector('.cat-preview span').textContent;
                try {
                    await EdunityAPI.adminUpdateCategory(Number(input.dataset.id), { name, color: input.value });
                    row.querySelector('.cat-preview').style.backgroundColor = input.value;
                    EdunityUI.toast('ფერი შენახულია', 'success');
                } catch (err) {
                    EdunityUI.toast(err.message);
                }
            });
        });

        // Загрузка иконки для каждой категории
        main.querySelectorAll('.cat-icon-upload').forEach((box) => {
            const id = Number(box.dataset.id);
            const row = box.closest('.cat-row');
            EdunityUpload.attach(box, {
                kind: 'image',
                value: box.dataset.icon,
                onChange: async (url) => {
                    const name = row.querySelector('.cat-preview span').textContent;
                    try {
                        await EdunityAPI.adminUpdateCategory(id, { name, icon: url || null });
                        renderCategories();
                    } catch (err) {
                        EdunityUI.toast(err.message);
                    }
                },
            });
        });

        document.getElementById('add-category').addEventListener('click', async () => {
            const name = document.getElementById('new-category').value.trim();
            const color = document.getElementById('new-category-color').value;
            if (!name) return;
            try {
                await EdunityAPI.adminAddCategory(name, color);
                renderCategories();
            } catch (err) {
                EdunityUI.toast(err.message);
            }
        });

        main.querySelectorAll('[data-rename]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const name = await EdunityUI.prompt({
                    title: 'კატეგორიის გადარქმევა',
                    text: 'კურსები ავტომატურად გადავლენ ახალ სახელზე.',
                    value: btn.dataset.name,
                    okText: 'შენახვა',
                });
                if (!name) return;
                try {
                    await EdunityAPI.adminUpdateCategory(Number(btn.dataset.rename), { name });
                    renderCategories();
                } catch (err) {
                    EdunityUI.toast(err.message);
                }
            });
        });

        main.querySelectorAll('[data-delcat]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const ok = await EdunityUI.confirm({ title: 'კატეგორიის წაშლა', okText: 'წაშლა', danger: true });
                if (!ok) return;
                try {
                    await EdunityAPI.adminDeleteCategory(Number(btn.dataset.delcat));
                    renderCategories();
                } catch (err) {
                    EdunityUI.toast(err.message);
                }
            });
        });
    } catch (err) {
        main.innerHTML = `<h1 class="editor-h1">კატეგორიები</h1><p class="editor-empty">${esc(err.message)}</p>`;
    }
}

// ==========================================================
const SECTIONS = { overview: renderOverview, homepage: renderHomepage, courses: renderCourses, categories: renderCategories, users: renderUsers };

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
        const me = await EdunityAPI.me();
        if (me.role !== 'admin' && me.role !== 'owner') {
            main.innerHTML = '<p class="editor-empty">ეს გვერდი ხელმისაწვდომია მხოლოდ ადმინისტრატორისთვის</p>';
            return;
        }
        renderOverview();
    } catch (err) {
        main.innerHTML = `<p class="editor-empty">${esc(err.message)}</p>`;
    }
}

init();


// ==========================================================
// Бэкап курса: экспорт в .zip и импорт обратно (только владелец)
//
// Архив: course.json + папка media/. Файлы качает и заливает браузер,
// поэтому сервер не держит видео в памяти. Ссылки на файлы в course.json
// заменены на edunity-media://media/N — при импорте файлы загружаются
// заново и ссылки подставляются новые.
// ==========================================================
const MEDIA_PREFIX = 'edunity-media://';

function loadJSZip() {
    if (window.JSZip) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        el.onload = resolve;
        el.onerror = () => reject(new Error('JSZip ვერ ჩაიტვირთა'));
        document.head.appendChild(el);
    });
}

function extFromMime(mime) {
    const map = {
        'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
        'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
    };
    return map[mime] || 'bin';
}

// JSON-строка с заменой всех вхождений (ссылки встречаются и внутри HTML)
function replaceAll(text, from, to) {
    return text.split(from).join(to);
}

function bindBackup() {
    const status = document.getElementById('backup-status');
    const say = (t) => (status.textContent = t);

    main.querySelectorAll('[data-export]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            try {
                await loadJSZip();
                const data = await EdunityAPI.adminExportCourse(Number(btn.dataset.export));
                const zip = new JSZip();
                let json = JSON.stringify(data.course);
                const media = [];

                for (const [i, m] of data.media.entries()) {
                    say(`ფაილი ${i + 1}/${data.media.length}...`);
                    const res = await fetch(EdunityUpload.fileUrl(m.fetchUrl));
                    if (!res.ok) throw new Error('ფაილი ვერ ჩამოიტვირთა: ' + m.url);
                    const name = `media/${i + 1}.${extFromMime(m.mimeType)}`;
                    zip.file(name, await res.blob());
                    json = replaceAll(json, m.url, MEDIA_PREFIX + name);
                    media.push({ name, mimeType: m.mimeType, kind: m.kind });
                }

                zip.file('course.json', JSON.stringify({
                    format: data.format,
                    version: data.version,
                    exportedAt: data.exportedAt,
                    course: JSON.parse(json),
                    media,
                }, null, 2));

                say('არქივი იქმნება...');
                const blob = await zip.generateAsync({ type: 'blob' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `edunity-course-${btn.dataset.export}.zip`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 5000);
                say('');
                EdunityUI.toast('ექსპორტი დასრულდა', 'success');
            } catch (err) {
                say('');
                EdunityUI.toast(err.message);
            } finally {
                btn.disabled = false;
            }
        });
    });

    document.getElementById('import-file').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;

        try {
            await loadJSZip();
            const zip = await JSZip.loadAsync(file);
            const manifestFile = zip.file('course.json');
            if (!manifestFile) throw new Error('არქივში არ არის course.json');

            const manifest = JSON.parse(await manifestFile.async('string'));
            if (manifest.format !== 'edunity-course') throw new Error('ფაილი არ არის EDUNITY-ის კურსი');

            let json = JSON.stringify(manifest.course);
            for (const [i, m] of (manifest.media || []).entries()) {
                say(`ატვირთვა ${i + 1}/${manifest.media.length}...`);
                const entry = zip.file(m.name);
                if (!entry) continue;
                const blob = await entry.async('blob');
                const upload = new File([blob], m.name.split('/').pop(), { type: m.mimeType });
                const kind = ['video', 'image', 'lesson-image'].includes(m.kind) ? m.kind : 'image';
                const saved = await EdunityUpload.send(upload, kind);
                json = replaceAll(json, MEDIA_PREFIX + m.name, saved.url);
            }

            say('კურსი იქმნება...');
            await EdunityAPI.adminImportCourse(JSON.parse(json));
            say('');
            EdunityUI.toast('კურსი აღდგა მონახაზად', 'success');
            renderCourses();
        } catch (err) {
            say('');
            EdunityUI.toast(err.message);
        }
    });
}
