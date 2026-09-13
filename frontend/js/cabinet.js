// Личный кабинет: профиль + вкладки (обучение / мои курсы / настройки)

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const ROLE_LABELS = { student: 'სტუდენტი', instructor: 'ლექტორი', admin: 'ადმინისტრატორი' };

const profileEl = document.getElementById('cab-profile');
const contentEl = document.getElementById('cab-content');

let user = null;

// ==========================================================
// Шапка профиля
// ==========================================================
function renderProfile() {
    const initial = (user.name || '?').trim().charAt(0).toUpperCase();
    const joined = new Date(user.createdAt).toLocaleDateString('ka-GE', { year: 'numeric', month: 'long', day: 'numeric' });

    profileEl.innerHTML = `
        <div class="cab-avatar">${user.avatarUrl ? `<img src="${EdunityUpload.fileUrl(user.avatarUrl)}" alt="" onerror="this.remove()">` : esc(initial)}</div>
        <div class="cab-profile-info">
            <h1 class="cab-name">${esc(user.name)}</h1>
            <p class="cab-email">${esc(user.email)}</p>
            ${user.bio ? `<p class="cab-bio">${esc(user.bio)}</p>` : ''}
            <div class="cab-badges">
                <span class="cab-role">${ROLE_LABELS[user.role] || esc(user.role)}</span>
                <span class="cab-joined">რეგისტრაცია: ${joined}</span>
            </div>
        </div>
        <button class="studio-btn danger cab-logout" id="cab-logout">გასვლა</button>
    `;

    // Напоминание подтвердить почту
    if (user.emailVerified === false) {
        const banner = document.createElement('div');
        banner.className = 'verify-banner';
        banner.innerHTML = `
            <span>ელ.ფოსტა ჯერ არ არის დადასტურებული — შეამოწმე შემოსული წერილები.</span>
            <button class="studio-btn" id="resend-verify">ბმულის ხელახლა გამოგზავნა</button>`;
        profileEl.insertAdjacentElement('afterend', banner);

        document.getElementById('resend-verify').addEventListener('click', async (e) => {
            e.target.disabled = true;
            try {
                await EdunityAPI.resendVerification(user.email);
                EdunityUI.toast('წერილი გამოგზავნილია', 'success');
            } catch (err) {
                EdunityUI.toast(err.message);
            }
        });
    }

    document.getElementById('cab-logout').addEventListener('click', () => {
        EdunityAuth.clear();
        window.location.href = '../index.html';
    });
}

// ==========================================================
// Вкладка: ჩემი სწავლა
// ==========================================================
async function renderLearning() {
    contentEl.innerHTML = '<p class="editor-loading">იტვირთება...</p>';

    try {
        const list = await EdunityAPI.myEnrollments();

        if (list.length === 0) {
            contentEl.innerHTML = `
                <div class="cab-empty">
                    <p>ჯერ არცერთ კურსზე არ ხართ ჩარიცხული.</p>
                    <a class="studio-btn primary" href="courses.html">კურსების ნახვა</a>
                </div>`;
            return;
        }

        const finished = list.filter((c) => c.progressPercent === 100).length;

        contentEl.innerHTML = `
            <div class="stat-row">
                <div class="stat-card"><div class="stat-value">${list.length}</div><div class="stat-label">კურსი</div></div>
                <div class="stat-card"><div class="stat-value">${finished}</div><div class="stat-label">დასრულებული</div></div>
            </div>

            <div id="my-certs"></div>

            <div class="cab-course-list">
                ${list
                    .map(
                        (c) => `
                    <article class="cab-course">
                        <div class="cab-course-cover">
                            ${c.coverUrl ? `<img src="${EdunityUpload.fileUrl(c.coverUrl)}" alt="" onerror="this.remove()">` : ''}
                        </div>
                        <div class="cab-course-body">
                            <h3 class="cab-course-title">${esc(c.title)}</h3>
                            <p class="cab-course-author">${esc(c.authorName)}${c.category ? ' · ' + esc(c.category) : ''}</p>

                            <div class="cab-progress">
                                <div class="cab-progress-bar"><span style="width:${c.progressPercent}%"></span></div>
                                <span class="cab-progress-text">${c.doneSteps}/${c.totalSteps} ნაბიჯი · ${c.progressPercent}%</span>
                            </div>
                        </div>
                        <div class="cab-course-actions">
                            ${c.progressPercent === 100 ? `<button class="studio-btn primary" data-cert="${c.id}">სერტიფიკატი</button>` : ''}
                            <a class="studio-btn" data-resume="${c.id}" href="course.html?id=${c.id}">${c.progressPercent === 100 ? 'გამეორება' : c.doneSteps > 0 ? 'გაგრძელება' : 'დაწყება'}</a>
                        </div>
                    </article>`
                    )
                    .join('')}
            </div>
        `;
        // Сертификат выдаётся при 100% прохождения
        contentEl.querySelectorAll('[data-cert]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                try {
                    const cert = await EdunityAPI.issueCertificate(Number(btn.dataset.cert));
                    window.location.href = 'certificate.html?code=' + encodeURIComponent(cert.code);
                } catch (err) {
                    EdunityUI.toast(err.message);
                    btn.disabled = false;
                }
            });
        });

        // Кнопка ведёт прямо на тот шаг, где человек остановился
        contentEl.querySelectorAll('[data-resume]').forEach((link) => {
            const id = Number(link.dataset.resume);
            EdunityAPI.courseProgress(id)
                .then((p) => {
                    if (p.resumeLessonId) link.setAttribute('href', 'lesson.html?lessonId=' + p.resumeLessonId);
                })
                .catch(() => {});
        });
        loadCertificates();
    } catch (err) {
        contentEl.innerHTML = `<p class="editor-empty">${esc(err.message)}</p>`;
    }
}

// Полученные сертификаты
async function loadCertificates() {
    const box = document.getElementById('my-certs');
    if (!box) return;
    try {
        const certs = await EdunityAPI.myCertificates();
        if (certs.length === 0) return;

        box.innerHTML = `
            <h2 class="editor-h2">ჩემი სერტიფიკატები</h2>
            <div class="cert-list">
                ${certs
                    .map(
                        (c) => `
                    <a class="cert-item" href="certificate.html?code=${encodeURIComponent(c.code)}">
                        <div>
                            <div class="cert-item-title">${esc(c.courseTitle)}</div>
                            <div class="cert-item-code">${esc(c.code)}</div>
                        </div>
                        <span class="studio-btn">ნახვა</span>
                    </a>`
                    )
                    .join('')}
            </div>`;
    } catch (err) {
        // сертификатов может не быть — это не ошибка
    }
}

// ==========================================================
// Вкладка: ჩემი კურსები (как автора)
// ==========================================================
async function renderTeaching() {
    contentEl.innerHTML = '<p class="editor-loading">იტვირთება...</p>';

    try {
        const courses = await EdunityAPI.myCourses();

        if (courses.length === 0) {
            contentEl.innerHTML = `
                <div class="cab-empty">
                    <p>ჯერ არცერთი კურსი არ შეგიქმნია.</p>
                    <a class="studio-btn primary" href="teaching.html">კურსის შექმნა</a>
                </div>`;
            return;
        }

        contentEl.innerHTML = `
            <div class="cab-course-list">
                ${courses
                    .map(
                        (c) => `
                    <article class="cab-course">
                        <div class="cab-course-cover">
                            ${c.coverUrl ? `<img src="${EdunityUpload.fileUrl(c.coverUrl)}" alt="" onerror="this.remove()">` : ''}
                        </div>
                        <div class="cab-course-body">
                            <h3 class="cab-course-title">${esc(c.title)}</h3>
                            <p class="cab-course-author">
                                <span class="my-course-status ${c.status}">${c.status === 'published' ? 'გამოქვეყნებული' : 'მონახაზი'}</span>
                                ${c.studentsCount || 0} მოსწავლე
                            </p>
                        </div>
                        <a class="studio-btn primary" href="course-editor.html?id=${c.id}">რედაქტირება</a>
                    </article>`
                    )
                    .join('')}
            </div>
        `;
    } catch (err) {
        contentEl.innerHTML = `<p class="editor-empty">${esc(err.message)}</p>`;
    }
}

// ==========================================================
// Вкладка: პარამეტრები
// ==========================================================
function renderSettings() {
    contentEl.innerHTML = `
        <div class="cab-settings">
            <h2 class="editor-h2" style="margin-top:0">პროფილის მონაცემები</h2>

            <div class="editor-field">
                <label for="s-name">სახელი</label>
                <input type="text" id="s-name" value="${esc(user.name)}" maxlength="100">
            </div>

            <div class="editor-field">
                <label for="avatar-upload">ავატარი</label>
                <div id="avatar-upload"></div>
            </div>

            <div class="editor-field">
                <label for="s-bio">ჩემ შესახებ</label>
                <textarea id="s-bio" rows="4" maxlength="500">${esc(user.bio)}</textarea>
            </div>

            <div class="editor-actions">
                <button class="editor-save-btn" id="save-profile">შენახვა</button>
            </div>

            <h2 class="editor-h2">პაროლის შეცვლა</h2>

            <div class="editor-field">
                <label for="s-current">მიმდინარე პაროლი</label>
                <input type="password" id="s-current" autocomplete="current-password">
            </div>

            <div class="editor-field">
                <label for="s-new">ახალი პაროლი <span class="editor-hint">მინიმუმ 8 სიმბოლო</span></label>
                <input type="password" id="s-new" autocomplete="new-password">
            </div>

            <div class="editor-actions">
                <button class="editor-save-btn" id="save-password">პაროლის შეცვლა</button>
            </div>

            <h2 class="editor-h2">ფაილების ადგილი</h2>
            <div id="storage-usage" class="storage-usage"><p class="editor-loading">იტვირთება...</p></div>

            <h2 class="editor-h2" style="color:#b5391c">ანგარიშის წაშლა</h2>
            <div class="danger-zone">
                <p>წაიშლება სამუდამოდ: შენი პროფილი, კურსები, კომენტარები, შეფასებები, პროგრესი,
                   სერტიფიკატები და ატვირთული ფაილები. ამის დაბრუნება შეუძლებელია.</p>
                <div id="deletion-preview" class="deletion-preview"></div>
                <button class="studio-btn danger" id="delete-account">ანგარიშის წაშლა</button>
            </div>
        </div>
    `;

    let avatarUrl = user.avatarUrl || '';
    EdunityUpload.attach(document.getElementById('avatar-upload'), {
        kind: 'image',
        value: avatarUrl,
        onChange: (url) => { avatarUrl = url; },
    });

    document.getElementById('save-profile').addEventListener('click', async (e) => {
        e.target.disabled = true;
        try {
            user = await EdunityAPI.updateMe({
                name: document.getElementById('s-name').value.trim(),
                avatarUrl: avatarUrl || null,
                bio: document.getElementById('s-bio').value.trim() || null,
            });
            // обновляем кеш, чтобы имя в шапке поменялось сразу
            EdunityAuth.save(EdunityAuth.getToken(), user);
            renderProfile();
            EdunityUI.toast('პროფილი განახლდა', 'success');
        } catch (err) {
            EdunityUI.toast(err.message);
        } finally {
            e.target.disabled = false;
        }
    });

    // Сколько места занято загруженными файлами
    EdunityAPI.storageUsage()
        .then((u) => {
            const box = document.getElementById('storage-usage');
            if (!box) return;
            const mb = (b) => (b / 1024 / 1024).toFixed(1);
            box.innerHTML = `
                <div class="cab-progress-bar"><span style="width:${Math.min(100, u.percentUsed)}%"></span></div>
                <span class="cab-progress-text">${mb(u.bytes)} MB / ${mb(u.quotaBytes)} MB · ${u.files} ფაილი</span>`;
        })
        .catch(() => {});

    // Показываем, что именно исчезнет
    EdunityAPI.deletionPreview()
        .then((p) => {
            const box = document.getElementById('deletion-preview');
            if (!box) return;
            const lines = [];
            if (p.authoredCourses.length) {
                lines.push(`<strong>${p.authoredCourses.length} შენი კურსი</strong> — ${esc(p.authoredCourses.map((c) => c.title).join(', '))}`);
                if (p.affectedStudents > 0) {
                    lines.push(`<span class="deletion-warning">${p.affectedStudents} მოსწავლე დაკარგავს წვდომას ამ კურსებზე</span>`);
                }
            }
            if (p.enrollments) lines.push(`${p.enrollments} კურსზე ჩარიცხვა`);
            if (p.comments) lines.push(`${p.comments} კომენტარი`);
            if (p.reviews) lines.push(`${p.reviews} შეფასება`);
            if (p.certificates) lines.push(`${p.certificates} სერტიფიკატი`);
            if (p.files) lines.push(`${p.files} ატვირთული ფაილი`);
            box.innerHTML = lines.length ? '<ul><li>' + lines.join('</li><li>') + '</li></ul>' : '';
        })
        .catch(() => {});

    document.getElementById('delete-account').addEventListener('click', async () => {
        const confirmed = await EdunityUI.confirm({
            title: 'ნამდვილად წაშალო ანგარიში?',
            text: 'ყველა მონაცემი სამუდამოდ წაიშლება. ამის დაბრუნება შეუძლებელია.',
            okText: 'გავაგრძელოთ',
            danger: true,
        });
        if (!confirmed) return;

        const password = await EdunityUI.prompt({
            title: 'დაადასტურე პაროლით',
            text: 'უსაფრთხოებისთვის შეიყვანე შენი პაროლი.',
            placeholder: 'პაროლი',
            okText: 'ანგარიშის წაშლა',
        });
        if (!password) return;

        try {
            await EdunityAPI.deleteMyAccount(password);
            EdunityAuth.clear();
            alert('ანგარიში წაშლილია.');
            window.location.href = '../index.html';
        } catch (err) {
            EdunityUI.toast(err.message);
        }
    });

    document.getElementById('save-password').addEventListener('click', async (e) => {
        const current = document.getElementById('s-current').value;
        const next = document.getElementById('s-new').value;
        if (!current || !next) {
            EdunityUI.toast('შეავსე ორივე ველი');
            return;
        }
        e.target.disabled = true;
        try {
            await EdunityAPI.changePassword(current, next);
            document.getElementById('s-current').value = '';
            document.getElementById('s-new').value = '';
            EdunityUI.toast('პაროლი შეიცვალა', 'success');
        } catch (err) {
            EdunityUI.toast(err.message);
        } finally {
            e.target.disabled = false;
        }
    });
}

// ==========================================================
// Вкладки
// ==========================================================
const TABS = { learning: renderLearning, teaching: renderTeaching, settings: renderSettings };

document.querySelectorAll('.cab-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.cab-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        TABS[tab.dataset.tab]();
    });
});

async function init() {
    if (!EdunityAuth.isLoggedIn()) {
        window.location.href = 'login.html';
        return;
    }

    try {
        user = await EdunityAPI.me();
        EdunityAuth.save(EdunityAuth.getToken(), user);
        renderProfile();
        renderLearning();
    } catch (err) {
        if (err.status === 401) {
            EdunityAuth.clear();
            window.location.href = 'login.html';
            return;
        }
        profileEl.innerHTML = `<p class="editor-empty">${esc(err.message)}</p>`;
        contentEl.innerHTML = '';
    }
}

init();
