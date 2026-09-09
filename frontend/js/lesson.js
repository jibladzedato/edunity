// Страница обучения.
// Слева — структура курса (модули → уроки), сверху — шаги текущего урока.

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const TYPE_LABELS = { text: 'ტექსტი', video: 'ვიდეო', quiz: 'ტესტი', code: 'პროგრამირება' };

const params = new URLSearchParams(window.location.search);
let lessonId = Number(params.get('lessonId') || params.get('id'));

const sidebar = document.getElementById('lesson-sidebar');
const main = document.getElementById('lesson-main');
const topbarTitle = document.getElementById('lesson-topbar-title');

let data = null;          // текущий урок со своими шагами
let structure = [];       // модули → уроки → шаги (весь курс)
let completed = new Set(); // пройденные шаги по всему курсу
let activeStepId = null;

// Плоский список уроков курса — для перехода «предыдущий/следующий»
function flatLessons() {
    return structure.flatMap((m) => (m.lessons || []).map((l) => ({ ...l, moduleTitle: m.title })));
}

function lessonPosition() {
    const all = flatLessons();
    return all.findIndex((l) => l.id === lessonId);
}

function mediaUrl(url) {
    return EdunityUpload.fileUrl(url);
}

// ==========================================================
// Содержимое шага
// ==========================================================
function renderStepContent(step) {
    const c = step.content || {};

    if (step.type === 'text') {
        // текст приходит из визуального редактора — чистим перед показом
        const html = EdunityRich.sanitize(c.html || '');
        const legacyImage = c.imageUrl ? `<img class="lesson-image" src="${esc(mediaUrl(c.imageUrl))}" alt="">` : '';
        if (!html.trim() && !legacyImage) return '<p class="editor-empty">ეს ნაბიჯი ჯერ ცარიელია</p>';
        return `<div class="rich-content">${html}</div>` + legacyImage;
    }

    if (step.type === 'video') {
        if (!c.url) return '<p class="editor-empty">ვიდეო ჯერ არ არის დამატებული</p>';
        return `<div class="lesson-video"><video src="${esc(mediaUrl(c.url))}" controls preload="metadata"></video></div>`;
    }

    if (step.type === 'quiz') {
        if (!c.question) return '<p class="editor-empty">ტესტი ჯერ არ არის შევსებული</p>';
        return `
            <div class="lesson-quiz">
                <p class="lesson-quiz-question">${esc(c.question)}</p>
                <div class="lesson-quiz-options" id="quiz-options">
                    ${(c.options || [])
                        .map((opt, i) => `<button class="lesson-quiz-option" data-index="${i}">${esc(opt)}</button>`)
                        .join('')}
                </div>
                <button class="editor-save-btn" id="quiz-submit" style="margin-top:14px">პასუხის შემოწმება</button>
                <p class="lesson-quiz-feedback" id="quiz-feedback" hidden></p>
            </div>`;
    }

    if (step.type === 'code') {
        const lang = c.language || 'python';
        const langLabel = lang === 'javascript' ? 'JavaScript' : 'Python';
        const testCount = (c.tests || []).length;
        return `
            <div class="lesson-code">
                ${c.statement ? `<div class="rich-content">${EdunityRich.sanitize(c.statement)}</div>` : ''}
                <div class="code-toolbar">
                    <span class="code-lang">${esc(langLabel)}</span>
                    <span class="code-tests-count">${testCount ? testCount + ' ტესტი' : 'ტესტების გარეშე'}</span>
                </div>
                <textarea class="lesson-code-area" id="code-area" rows="14" spellcheck="false">${esc(c.template)}</textarea>
                <div class="code-actions">
                    <button class="editor-save-btn" id="run-code">გაშვება და შემოწმება</button>
                    <button class="studio-btn" id="reset-code">საწყისი კოდი</button>
                    <span class="code-status" id="code-status"></span>
                </div>
                <div id="code-results"></div>
            </div>`;
    }

    return '<p class="editor-empty">უცნობი ტიპი</p>';
}

// ==========================================================
// Поведение шагов (тест и код)
// ==========================================================
function attachStepBehaviour(step) {
    if (step.type === 'code') {
        const c = step.content || {};
        const lang = c.language || 'python';
        const area = document.getElementById('code-area');
        const statusEl = document.getElementById('code-status');
        const resultsEl = document.getElementById('code-results');
        const runBtn = document.getElementById('run-code');

        document.getElementById('reset-code').addEventListener('click', () => {
            area.value = c.template || '';
            resultsEl.innerHTML = '';
            statusEl.textContent = '';
        });

        runBtn.addEventListener('click', async () => {
            runBtn.disabled = true;
            resultsEl.innerHTML = '';
            const setStatus = (t) => (statusEl.textContent = t);
            setStatus('სრულდება...');

            const tests = c.tests || [];

            if (tests.length === 0) {
                const r = await EdunityCode.run(lang, area.value, '', setStatus);
                setStatus('');
                resultsEl.innerHTML = r.ok
                    ? `<pre class="code-output">${esc(r.stdout || '(ცარიელი გამოტანა)')}</pre>`
                    : `<pre class="code-output error">${esc(r.error)}</pre>`;
                runBtn.disabled = false;
                if (r.ok) await markDone(step.id, null);
                return;
            }

            const out = await EdunityCode.runTests(lang, area.value, tests, setStatus);
            setStatus('');

            resultsEl.innerHTML = `
                <div class="code-summary ${out.allPassed ? 'ok' : 'no'}">
                    ${out.allPassed ? 'ყველა ტესტი გავლილია' : `გავლილია ${out.passed} / ${out.total} ტესტი`}
                </div>
                ${out.results
                    .map(
                        (r) => `
                    <div class="code-test ${r.passed ? 'pass' : 'fail'}">
                        <div class="code-test-head"><span>${r.passed ? '✓' : '✕'} ტესტი ${r.index}</span></div>
                        ${
                            r.passed
                                ? ''
                                : `<div class="code-test-detail">
                                    ${r.input ? `<div><b>შემავალი:</b><pre>${esc(r.input)}</pre></div>` : ''}
                                    <div><b>მოსალოდნელი:</b><pre>${esc(r.expected)}</pre></div>
                                    <div><b>მიღებული:</b><pre>${esc(r.error || r.actual || '(ცარიელი)')}</pre></div>
                                   </div>`
                        }
                    </div>`
                    )
                    .join('')}
            `;

            runBtn.disabled = false;
            if (out.allPassed) await markDone(step.id, true);
        });
    }

    if (step.type === 'quiz') {
        const c = step.content || {};
        const multiple = !!c.multiple;
        const optionsEl = document.getElementById('quiz-options');
        if (!optionsEl) return;

        const chosen = new Set();

        optionsEl.querySelectorAll('.lesson-quiz-option').forEach((btn) => {
            btn.addEventListener('click', () => {
                const i = Number(btn.dataset.index);
                if (multiple) {
                    if (chosen.has(i)) chosen.delete(i);
                    else chosen.add(i);
                } else {
                    chosen.clear();
                    chosen.add(i);
                }
                optionsEl.querySelectorAll('.lesson-quiz-option').forEach((b) => {
                    b.classList.toggle('chosen', chosen.has(Number(b.dataset.index)));
                });
            });
        });

        document.getElementById('quiz-submit').addEventListener('click', async () => {
            if (chosen.size === 0) {
                EdunityUI.toast('აირჩიე პასუხი');
                return;
            }

            const correct = (c.correct || []).slice().sort().join(',');
            const given = Array.from(chosen).sort().join(',');
            const isCorrect = correct === given;

            optionsEl.querySelectorAll('.lesson-quiz-option').forEach((b) => {
                const i = Number(b.dataset.index);
                b.disabled = true;
                if ((c.correct || []).includes(i)) b.classList.add('correct');
                else if (chosen.has(i)) b.classList.add('incorrect');
            });

            const fb = document.getElementById('quiz-feedback');
            fb.hidden = false;
            fb.textContent = isCorrect ? 'სწორია!' : 'არასწორია — სწორი პასუხი მონიშნულია მწვანედ.';
            fb.className = 'lesson-quiz-feedback ' + (isCorrect ? 'ok' : 'no');
            document.getElementById('quiz-submit').disabled = true;

            await markDone(step.id, isCorrect);
        });
    }
}

async function markDone(stepId, isCorrect) {
    if (!EdunityAuth.isLoggedIn()) return;
    try {
        await EdunityAPI.completeStep(stepId, isCorrect);
        completed.add(stepId);
        renderSidebar();
        renderStepTabs();
        renderStepHead();
    } catch (err) {
        // прогресс не критичен для чтения урока
    }
}

// ==========================================================
// Комментарии (с ответами)
// ==========================================================
async function loadComments(stepId) {
    const box = document.getElementById('comments-box');
    if (!box) return;

    try {
        const all = await EdunityAPI.stepComments(stepId);
        const me = EdunityAuth.getUser();

        const roots = all.filter((c) => !c.parentId);
        const repliesOf = (id) => all.filter((c) => c.parentId === id);

        function commentHtml(cm, isReply) {
            return `
                <div class="comment-item ${isReply ? 'reply' : ''}">
                    <div class="comment-avatar">${esc((cm.userName || '?').charAt(0).toUpperCase())}</div>
                    <div class="comment-body">
                        <div class="comment-head">
                            <span class="comment-author">${esc(cm.userName)}</span>
                            <span class="comment-date">${new Date(cm.createdAt).toLocaleDateString('ka-GE')}</span>
                            ${EdunityAuth.isLoggedIn() && !isReply ? `<button class="comment-reply-btn" data-reply="${cm.id}">პასუხი</button>` : ''}
                            ${me && me.id === cm.userId ? `<button class="comment-delete" data-id="${cm.id}">წაშლა</button>` : ''}
                        </div>
                        <p class="comment-text">${esc(cm.body)}</p>
                        <div class="reply-form" id="reply-form-${cm.id}" hidden>
                            <textarea rows="2" placeholder="შენი პასუხი..."></textarea>
                            <button class="studio-btn primary" data-send-reply="${cm.id}">გაგზავნა</button>
                        </div>
                    </div>
                </div>`;
        }

        box.innerHTML = `
            <h3 class="comments-title">კომენტარები (${all.length})</h3>

            ${
                EdunityAuth.isLoggedIn()
                    ? `<div class="comment-form">
                        <textarea id="comment-body" rows="3" placeholder="დაწერე კომენტარი ან დასვი კითხვა..."></textarea>
                        <button class="editor-save-btn" id="comment-send">გაგზავნა</button>
                       </div>`
                    : '<p class="editor-hint">კომენტარის დასაწერად საჭიროა ავტორიზაცია</p>'
            }

            <div class="comment-list">
                ${
                    roots.length === 0
                        ? '<p class="editor-empty">ჯერ კომენტარები არ არის</p>'
                        : roots
                              .map(
                                  (cm) => commentHtml(cm, false) +
                                      repliesOf(cm.id).map((r) => commentHtml(r, true)).join('')
                              )
                              .join('')
                }
            </div>
        `;

        const sendBtn = document.getElementById('comment-send');
        if (sendBtn) {
            sendBtn.addEventListener('click', async () => {
                const body = document.getElementById('comment-body').value.trim();
                if (!body) return;
                sendBtn.disabled = true;
                try {
                    await EdunityAPI.addComment(stepId, body);
                    loadComments(stepId);
                } catch (err) {
                    EdunityUI.toast(err.message);
                    sendBtn.disabled = false;
                }
            });
        }

        box.querySelectorAll('[data-reply]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const form = document.getElementById('reply-form-' + btn.dataset.reply);
                form.hidden = !form.hidden;
                if (!form.hidden) form.querySelector('textarea').focus();
            });
        });

        box.querySelectorAll('[data-send-reply]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const parentId = Number(btn.dataset.sendReply);
                const form = document.getElementById('reply-form-' + parentId);
                const body = form.querySelector('textarea').value.trim();
                if (!body) return;
                btn.disabled = true;
                try {
                    await EdunityAPI.addComment(stepId, body, parentId);
                    loadComments(stepId);
                } catch (err) {
                    EdunityUI.toast(err.message);
                    btn.disabled = false;
                }
            });
        });

        box.querySelectorAll('.comment-delete').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const ok = await EdunityUI.confirm({ title: 'კომენტარის წაშლა', okText: 'წაშლა', danger: true });
                if (!ok) return;
                try {
                    await EdunityAPI.deleteComment(Number(btn.dataset.id));
                    loadComments(stepId);
                } catch (err) {
                    EdunityUI.toast(err.message);
                }
            });
        });
    } catch (err) {
        box.innerHTML = `<p class="editor-empty">${esc(err.message)}</p>`;
    }
}

// ==========================================================
// Сайдбар: модули и уроки всего курса
// ==========================================================
function renderSidebar() {
    const allSteps = structure.flatMap((m) => (m.lessons || []).flatMap((l) => l.steps || []));
    const doneCount = allSteps.filter((s) => completed.has(s.id)).length;
    const percent = allSteps.length ? Math.round((doneCount / allSteps.length) * 100) : 0;

    sidebar.innerHTML = `
        <a class="lesson-sidebar-course" href="course.html?id=${data.courseId}">${esc(data.courseTitle)}</a>

        <div class="lesson-course-progress">
            <div class="cab-progress-bar"><span style="width:${percent}%"></span></div>
            <span class="cab-progress-text">კურსის პროგრესი: ${doneCount}/${allSteps.length} · ${percent}%</span>
        </div>

        ${structure
            .map((m, mi) => {
                const lessons = m.lessons || [];
                return `
            <div class="course-nav-module">
                <div class="course-nav-module-title">${mi + 1}. ${esc(m.title)}</div>
                ${lessons
                    .map((l, li) => {
                        const steps = l.steps || [];
                        const done = steps.filter((s) => completed.has(s.id)).length;
                        const isDone = steps.length > 0 && done === steps.length;
                        return `
                    <a class="course-nav-lesson ${l.id === lessonId ? 'active' : ''} ${isDone ? 'done' : ''}"
                       href="lesson.html?lessonId=${l.id}">
                        <span class="course-nav-mark">${isDone ? '✓' : mi + 1 + '.' + (li + 1)}</span>
                        <span class="course-nav-lesson-title">${esc(l.title)}</span>
                        <span class="course-nav-count">${done}/${steps.length}</span>
                    </a>`;
                    })
                    .join('')}
            </div>`;
            })
            .join('')}
    `;
}

// ==========================================================
// Верхняя лента шагов
// ==========================================================
function renderStepTabs() {
    const el = document.getElementById('step-nav');
    if (!el) return;
    el.innerHTML = data.steps
        .map(
            (s, i) => `
        <button class="step-tab ${s.id === activeStepId ? 'active' : ''} ${completed.has(s.id) ? 'done' : ''}" data-step-id="${s.id}">
            <span class="step-tab-num">${completed.has(s.id) ? '✓' : i + 1}</span>
            <span class="step-tab-type">${TYPE_LABELS[s.type] || s.type}</span>
        </button>`
        )
        .join('');
    el.querySelectorAll('[data-step-id]').forEach((b) => {
        b.addEventListener('click', () => selectStep(Number(b.dataset.stepId)));
    });
}

function renderStepHead() {
    const el = document.getElementById('step-head');
    if (!el) return;
    const step = data.steps.find((s) => s.id === activeStepId);
    if (!step) return;
    const index = data.steps.findIndex((s) => s.id === activeStepId);
    el.innerHTML = `
        <span class="lesson-step-badge ${step.type}">${TYPE_LABELS[step.type] || step.type}</span>
        <span class="lesson-step-counter">ნაბიჯი ${index + 1} / ${data.steps.length}</span>
        ${completed.has(step.id) ? '<span class="lesson-step-done">დასრულებულია ✓</span>' : ''}
    `;
}

// ==========================================================
// Переход между уроками
// ==========================================================
// В конце урока — одна кнопка продолжения (на следующий урок либо к курсу)
function renderLessonNav() {
    const all = flatLessons();
    const pos = lessonPosition();
    const next = pos >= 0 && pos < all.length - 1 ? all[pos + 1] : null;

    return `
        <div class="lesson-next">
            ${
                next
                    ? `<a class="studio-btn primary" href="lesson.html?lessonId=${next.id}">შემდეგი ნაბიჯი →</a>`
                    : `<a class="studio-btn primary" href="course.html?id=${data.courseId}">კურსის დასრულება →</a>`
            }
        </div>`;
}

// ==========================================================
// Основная отрисовка
// ==========================================================
function renderStep() {
    const step = data.steps.find((s) => s.id === activeStepId);
    const index = data.steps.findIndex((s) => s.id === activeStepId);

    if (!step) {
        main.innerHTML = `
            <div class="lesson-content">
                <p class="lesson-eyebrow">${esc(data.moduleTitle)}</p>
                <h1>${esc(data.lessonTitle)}</h1>
                <p class="editor-empty">ამ გაკვეთილს ჯერ ნაბიჯები არ აქვს.</p>
                ${renderLessonNav()}
            </div>`;
        return;
    }

    const isDone = completed.has(step.id);

    main.innerHTML = `
        <div class="lesson-content">
            <p class="lesson-eyebrow">${esc(data.moduleTitle)}</p>
            <h1>${esc(data.lessonTitle)}</h1>

            <div class="step-tabs" id="step-nav"></div>
            <div class="lesson-step-head" id="step-head"></div>

            <div class="lesson-step-body">${renderStepContent(step)}</div>

            <div class="lesson-step-actions">
                ${
                    step.type !== 'quiz' && step.type !== 'code'
                        ? `<button class="editor-save-btn" id="mark-done" ${isDone ? 'disabled' : ''}>${isDone ? 'დასრულებულია ✓' : 'დასრულებულად მონიშვნა'}</button>`
                        : ''
                }
                ${index < data.steps.length - 1 ? '<button class="studio-btn primary" id="next-step">შემდეგი ნაბიჯი →</button>' : ''}
            </div>

            ${index === data.steps.length - 1 ? renderLessonNav() : ''}

            <div id="comments-box" class="comments-box"><p class="editor-loading">იტვირთება...</p></div>
        </div>
    `;

    renderStepTabs();
    renderStepHead();
    attachStepBehaviour(step);

    const markBtn = document.getElementById('mark-done');
    if (markBtn) {
        markBtn.addEventListener('click', async () => {
            markBtn.disabled = true;
            markBtn.textContent = 'დასრულებულია ✓';
            await markDone(step.id, null);
        });
    }

    const nextBtn = document.getElementById('next-step');
    if (nextBtn) nextBtn.addEventListener('click', () => selectStep(data.steps[index + 1].id));

    loadComments(step.id);
}

function selectStep(id) {
    activeStepId = id;
    renderStep();
    renderSidebar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function load() {
    try {
        data = await EdunityAPI.lessonSteps(lessonId);

        topbarTitle.textContent = data.courseTitle;
        document.title = data.lessonTitle + ' | EDUNITY';
        document.getElementById('lesson-exit').setAttribute('href', 'course.html?id=' + data.courseId);

        // структура всего курса — для сайдбара и перехода между уроками
        structure = await EdunityAPI.courseStructure(data.courseId);

        if (EdunityAuth.isLoggedIn()) {
            try {
                const p = await EdunityAPI.courseProgress(data.courseId);
                completed = new Set(p.completedStepIds);
            } catch (e) {
                completed = new Set((data.progress || []).map((x) => x.step_id));
            }
        }

        if (data.steps.length > 0) activeStepId = data.steps[0].id;

        renderSidebar();
        renderStep();
    } catch (err) {
        main.innerHTML = `<div class="lesson-content"><p class="editor-empty">${esc(err.message)}</p>
            <a class="studio-btn primary" href="courses.html">კურსებში დაბრუნება</a></div>`;
        sidebar.innerHTML = '';
    }
}

load();
