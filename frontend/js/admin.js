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

        main.innerHTML = `
            <h1 class="editor-h1">კურსების მართვა</h1>
            <p class="editor-sub">დაბლოკილი კურსი ქრება კატალოგიდან. ავტორს რჩება რედაქტირების უფლება, მაგრამ ვერ გამოაქვეყნებს.</p>

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
