// Страница "სწავლება" имеет два состояния:
//  1) гость или автор без курсов → лендинг (приветствие + преимущества)
//  2) у автора есть курсы        → студия: сетка курсов с управлением

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const landing = document.getElementById('teach-landing');
const studio = document.getElementById('teach-studio');
const grid = document.getElementById('studio-grid');
const studioSub = document.getElementById('studio-sub');

function createCourse() {
    window.location.href = 'course-new.html';
}

document.getElementById('teach-cta').addEventListener('click', () => {
    if (EdunityAuth.isLoggedIn()) createCourse();
    else window.location.href = 'register.html';
});
document.getElementById('create-course-btn').addEventListener('click', createCourse);

function courseCard(c) {
    const published = c.status === 'published';
    const initial = (c.title || '?').trim().charAt(0).toUpperCase();

    return `
        <article class="course-row" data-id="${c.id}">
            <a class="course-row-logo" href="course-editor.html?id=${c.id}">
                ${c.coverUrl
                    ? `<img src="${EdunityUpload.fileUrl(c.coverUrl)}" ${EdunityUpload.posStyle(c.coverPos)} alt="" onerror="this.parentElement.textContent='${esc(initial)}'">`
                    : esc(initial)}
                ${published ? '' : '<span class="course-row-draft" title="მონახაზი"></span>'}
            </a>

            <a class="course-row-main" href="course-editor.html?id=${c.id}">
                <span class="course-row-title">${esc(c.title)}</span>
                <span class="course-row-meta">
                    ${published ? '<em class="dot-published">გამოქვეყნებული</em>' : '<em class="dot-draft">მონახაზი</em>'}
                    · ${c.studentsCount || 0} მოსწავლე
                    ${c.category ? '· ' + esc(c.category) : ''}
                </span>
            </a>

            <div class="course-row-menu">
                <button class="row-menu-btn" data-action="menu" data-id="${c.id}" aria-label="მენიუ">⋮</button>
                <div class="row-menu-list" hidden>
                    <a href="course-editor.html?id=${c.id}">რედაქტირება</a>
                    ${published ? `<a href="course.html?id=${c.id}">კურსის ნახვა</a>` : ''}
                    <button data-action="delete" data-id="${c.id}" class="danger">წაშლა</button>
                </div>
            </div>
        </article>`;
}

async function deleteCourse(id, title) {
    const ok = await EdunityUI.confirm({
        title: 'კურსის წაშლა',
        text: `წავშალოთ «${esc(title)}» ყველა მოდულთან, გაკვეთილთან და ნაბიჯთან ერთად? ამ მოქმედების გაუქმება შეუძლებელია.`,
        okText: 'წაშლა',
        danger: true,
    });
    if (!ok) return;

    try {
        await EdunityAPI.deleteCourse(id);
        load();
    } catch (err) {
        // На курсе есть студенты — сервер требует явного подтверждения
        if (err.data && err.data.needsConfirmation) {
            const confirmed = await EdunityUI.confirm({
                title: 'კურსზე არიან მოსწავლეები',
                text: `${err.data.studentsCount} მოსწავლე დაკარგავს წვდომას სამუდამოდ. თუ უბრალოდ გინდა კურსი დამალო, სჯობს გამოქვეყნება გააუქმო რედაქტორში.`,
                okText: 'მაინც წავშალო',
                danger: true,
            });
            if (!confirmed) return;
            try {
                await EdunityAPI.deleteCourse(id, true);
                load();
            } catch (e) {
                EdunityUI.toast(e.message);
            }
            return;
        }
        EdunityUI.toast(err.message);
    }
}

async function load() {
    if (!EdunityAuth.isLoggedIn()) return; // гость видит лендинг

    // заглушки — только если ждём студию (в прошлый раз курсы были)
    const expectStudio = document.documentElement.classList.contains('teach-checking');
    if (expectStudio) {
        studio.hidden = false;
        grid.innerHTML = EdunityUI.skeleton(3, 'skel-studio');
    }

    let courses = [];
    try {
        courses = await EdunityAPI.myCourses();
    } catch (err) {
        EdunityUI.toast(err.message);
        studio.hidden = true;
        landing.hidden = false;
        return;
    } finally {
        document.documentElement.classList.remove('teach-checking');
    }

    // запоминаем для следующего захода
    localStorage.setItem('edunity_has_courses', courses.length > 0 ? '1' : '0');

    if (courses.length === 0) {
        // автор без курсов — оставляем лендинг
        landing.hidden = false;
        studio.hidden = true;
        return;
    }

    // есть курсы — прячем лендинг целиком, показываем студию
    landing.hidden = true;
    studio.hidden = false;

    const published = courses.filter((c) => c.status === 'published').length;
    const students = courses.reduce((sum, c) => sum + (c.studentsCount || 0), 0);
    studioSub.textContent = `${courses.length} კურსი · ${published} გამოქვეყნებული · ${students} მოსწავლე`;

    grid.innerHTML = courses.map(courseCard).join('');

    // выпадающее меню строки
    grid.querySelectorAll('[data-action="menu"]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const list = btn.nextElementSibling;
            const wasHidden = list.hidden;
            grid.querySelectorAll('.row-menu-list').forEach((l) => (l.hidden = true));
            list.hidden = !wasHidden;
        });
    });
    document.addEventListener('click', () => {
        grid.querySelectorAll('.row-menu-list').forEach((l) => (l.hidden = true));
    });

    grid.querySelectorAll('[data-action="delete"]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const c = courses.find((x) => x.id === Number(btn.dataset.id));
            deleteCourse(c.id, c.title);
        });
    });
}

load();
