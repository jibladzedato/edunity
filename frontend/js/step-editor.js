// Редактор шагов урока: слева список уроков курса, сверху вкладки шагов,
// снизу форма редактирования в зависимости от типа шага.

const params = new URLSearchParams(window.location.search);
const lessonId = Number(params.get('lessonId'));

const sidebar = document.getElementById('step-sidebar');
const main = document.getElementById('step-main');
const topbarTitle = document.getElementById('topbar-title');
const modal = document.getElementById('step-modal');

const TYPE_LABELS = { text: 'ტექსტი', video: 'ვიდეო', quiz: 'ტესტი', code: 'პროგრამირება' };

let lessonData = null;
let activeStepId = null;
let uploadState = { videoUrl: '', imageUrl: '' };
let richState = { html: '', statement: '' };

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ==========================================================
// Модалка выбора типа
// ==========================================================
document.getElementById('step-modal-close').addEventListener('click', () => (modal.hidden = true));
modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.hidden = true;
});

document.querySelectorAll('.step-type-card').forEach((card) => {
    card.addEventListener('click', async () => {
        modal.hidden = true;
        try {
            const step = await EdunityAPI.createStep(lessonId, card.dataset.type);
            await load();
            selectStep(step.id);
        } catch (err) {
            EdunityUI.toast(err.message);
        }
    });
});

// ==========================================================
// Сайдбар — структура курса
// ==========================================================
async function renderSidebar() {
    try {
        const modules = await EdunityAPI.courseStructure(lessonData.courseId);
        sidebar.innerHTML = `
            <div class="step-sidebar-course">${esc(lessonData.courseTitle)}</div>
            ${modules
                .map(
                    (m, mi) => `
                <div class="step-sidebar-module">
                    <div class="step-sidebar-module-title">${mi + 1} ${esc(m.title)}</div>
                    ${m.lessons
                        .map(
                            (l, li) => `
                        <a class="step-sidebar-lesson ${l.id === lessonId ? 'active' : ''}" href="step-editor.html?lessonId=${l.id}">
                            <span>${mi + 1}.${li + 1}</span> ${esc(l.title)}
                        </a>`
                        )
                        .join('')}
                </div>`
                )
                .join('')}
        `;
    } catch (err) {
        sidebar.innerHTML = `<p class="editor-empty">${esc(err.message)}</p>`;
    }
}

// ==========================================================
// Вкладки шагов + форма редактирования
// ==========================================================
function renderStepTabs() {
    const steps = lessonData.steps;
    return `
        <div class="step-tabs">
            ${steps
                .map(
                    (s, i) => `
                <button class="step-tab ${s.id === activeStepId ? 'active' : ''}" data-step-id="${s.id}">
                    <span class="step-tab-num">${i + 1}</span>
                    <span class="step-tab-type">${TYPE_LABELS[s.type] || s.type}</span>
                </button>`
                )
                .join('')}
            <button class="step-tab add" id="add-step-btn">+</button>
        </div>
    `;
}

function renderStepForm(step) {
    if (!step) {
        return '<p class="editor-empty">ამ გაკვეთილს ჯერ ნაბიჯები არ აქვს. დააჭირე «+»-ს დასამატებლად.</p>';
    }

    const c = step.content || {};

    if (step.type === 'text') {
        return `
            <div class="editor-field">
                <label>ტექსტი</label>
                <div id="c-html-rich"></div>
                <p class="editor-hint">სურათის ჩასმა შესაძლებელია პირდაპირ ტექსტში — ღილაკით 🖼</p>
            </div>`;
    }

    if (step.type === 'video') {
        return `
            <div class="editor-field">
                <label for="video-upload">ვიდეო ფაილი</label>
                <div id="video-upload"></div>
            </div>`;
    }

    if (step.type === 'quiz') {
        const options = c.options && c.options.length ? c.options : ['', '', '', ''];
        const correct = c.correct || [];
        return `
            <div class="editor-field">
                <label for="c-question">კითხვა</label>
                <textarea id="c-question" rows="3">${esc(c.question)}</textarea>
            </div>
            <div class="editor-field">
                <label>პასუხის ვარიანტები <span class="editor-hint">მონიშნე ყველა სწორი პასუხი</span></label>
                <p class="quiz-mode-hint" id="quiz-mode-hint"></p>
                <div id="quiz-options">
                    ${options
                        .map(
                            (opt, i) => `
                        <div class="quiz-option-row">
                            <input type="checkbox" class="quiz-correct" data-index="${i}" ${correct.includes(i) ? 'checked' : ''}>
                            <input type="text" class="quiz-option-text" data-index="${i}" value="${esc(opt)}" placeholder="ვარიანტი ${i + 1}">
                        </div>`
                        )
                        .join('')}
                </div>
            </div>`;
    }

    if (step.type === 'code') {
        const tests = (c.tests && c.tests.length) ? c.tests : [{ input: '', expected: '' }];
        return `
            <div class="editor-field">
                <label>დავალების პირობა</label>
                <div id="c-statement-rich"></div>
            </div>

            <div class="editor-row">
                <div class="editor-field">
                    <label for="c-language">ენა</label>
                    <select id="c-language">
                        <option value="python" ${c.language === 'python' || !c.language ? 'selected' : ''}>Python</option>
                        <option value="javascript" ${c.language === 'javascript' ? 'selected' : ''}>JavaScript</option>
                    </select>
                    <p class="editor-hint">კოდი სრულდება ბრაუზერში. Java და C++ სერვერულ გარემოს საჭიროებს.</p>
                </div>
            </div>

            <div class="editor-field">
                <label for="c-template">საწყისი კოდი</label>
                <textarea id="c-template" rows="7" class="mono" placeholder="# მოსწავლე აქედან იწყებს">${esc(c.template)}</textarea>
                <p class="editor-hint">მონაცემების წაკითხვა: <code>input()</code> · გამოტანა: <code>print()</code></p>
            </div>

            <div class="editor-field">
                <label>ტესტები <span class="editor-hint">შემავალი მონაცემები და მოსალოდნელი პასუხი</span></label>
                <div id="tests-list">
                    ${tests.map((t, i) => testRow(t, i)).join('')}
                </div>
                <button type="button" class="editor-add-btn small" id="add-test">+ ტესტის დამატება</button>
            </div>`;
    }

    return '<p class="editor-empty">უცნობი ტიპი</p>';
}

function testRow(t, i) {
    return `
        <div class="test-row" data-test-index="${i}">
            <span class="test-num">${i + 1}</span>
            <div class="test-fields">
                <textarea class="test-input mono" rows="2" placeholder="შემავალი (input)">${esc(t.input)}</textarea>
                <textarea class="test-expected mono" rows="2" placeholder="მოსალოდნელი პასუხი">${esc(t.expected)}</textarea>
            </div>
            <button type="button" class="tool-btn danger test-remove">✕</button>
        </div>`;
}

function collectContent(step) {
    if (step.type === 'text') return { html: richState.html };
    if (step.type === 'video') return { url: uploadState.videoUrl };
    if (step.type === 'quiz') {
        const options = Array.from(document.querySelectorAll('.quiz-option-text')).map((i) => i.value);
        const correct = Array.from(document.querySelectorAll('.quiz-correct'))
            .filter((cb) => cb.checked)
            .map((cb) => Number(cb.dataset.index));
        return {
            question: document.getElementById('c-question').value.trim(),
            options,
            correct,
            // Тип теста определяется автоматически: отмечено больше одного
            // правильного ответа — значит ученик тоже сможет выбрать несколько.
            // Раньше для этого была отдельная галочка, и её легко было забыть.
            multiple: correct.length > 1,
        };
    }
    if (step.type === 'code') {
        const tests = Array.from(document.querySelectorAll('.test-row')).map((row) => ({
            input: row.querySelector('.test-input').value,
            expected: row.querySelector('.test-expected').value,
        })).filter((t) => t.expected.trim() !== '');

        return {
            statement: richState.statement,
            language: document.getElementById('c-language').value,
            template: document.getElementById('c-template').value,
            tests,
        };
    }
    return {};
}

function renderMain() {
    const step = lessonData.steps.find((s) => s.id === activeStepId);

    main.innerHTML = `
        <div class="step-main-head">
            <h1 class="editor-h1">${esc(lessonData.lessonTitle)}</h1>
            <p class="editor-sub">${esc(lessonData.moduleTitle)}</p>
        </div>

        ${renderStepTabs()}

        ${
            step
                ? `
            <div class="step-form">
                <div class="step-form-head">
                    <h2 class="editor-h2">ნაბიჯი: ${TYPE_LABELS[step.type] || step.type}</h2>
                    <div class="step-head-tools">
                        <button class="tool-btn move" id="move-step-up" title="ადრე" ${lessonData.steps.findIndex((x) => x.id === step.id) === 0 ? 'disabled' : ''}>↑</button>
                        <button class="tool-btn move" id="move-step-down" title="მოგვიანებით" ${lessonData.steps.findIndex((x) => x.id === step.id) === lessonData.steps.length - 1 ? 'disabled' : ''}>↓</button>
                        <button class="tool-btn danger" id="delete-step">ნაბიჯის წაშლა</button>
                    </div>
                </div>
                ${renderStepForm(step)}
                <div class="editor-actions">
                    <button class="editor-save-btn" id="save-step">შენახვა</button>
                    <span class="editor-saved" id="saved-msg" hidden>შენახულია ✓</span>
                </div>
            </div>`
                : renderStepForm(null)
        }
    `;

    document.getElementById('add-step-btn').addEventListener('click', () => (modal.hidden = false));

    document.querySelectorAll('.step-tab[data-step-id]').forEach((tab) => {
        tab.addEventListener('click', () => selectStep(Number(tab.dataset.stepId)));
    });

    // Подсказка о типе теста — обновляется при каждой отметке
    if (step && step.type === 'quiz') {
        const hint = document.getElementById('quiz-mode-hint');

        function updateQuizHint() {
            const n = document.querySelectorAll('.quiz-correct:checked').length;
            if (n === 0) {
                hint.textContent = 'ჯერ არცერთი სწორი პასუხი არ არის მონიშნული';
                hint.className = 'quiz-mode-hint warn';
            } else if (n === 1) {
                hint.textContent = 'ერთი სწორი პასუხი — მოსწავლე აირჩევს ერთს';
                hint.className = 'quiz-mode-hint';
            } else {
                hint.textContent = `${n} სწორი პასუხი — მოსწავლე შეძლებს რამდენიმეს მონიშვნას`;
                hint.className = 'quiz-mode-hint multi';
            }
        }

        document.querySelectorAll('.quiz-correct').forEach((cb) => {
            cb.addEventListener('change', updateQuizHint);
        });
        updateQuizHint();
    }

    // Управление списком тестов
    if (step && step.type === 'code') {
        const list = document.getElementById('tests-list');

        function bindRemove() {
            list.querySelectorAll('.test-remove').forEach((btn) => {
                btn.onclick = () => {
                    if (list.querySelectorAll('.test-row').length <= 1) {
                        EdunityUI.toast('მინიმუმ ერთი ტესტი უნდა დარჩეს');
                        return;
                    }
                    btn.closest('.test-row').remove();
                    list.querySelectorAll('.test-num').forEach((n, i) => (n.textContent = i + 1));
                };
            });
        }
        bindRemove();

        document.getElementById('add-test').addEventListener('click', () => {
            const i = list.querySelectorAll('.test-row').length;
            list.insertAdjacentHTML('beforeend', testRow({ input: '', expected: '' }, i));
            bindRemove();
        });
    }

    // Визуальные редакторы текста.
    // Оборачиваем в try, чтобы сбой редактора не мешал сохранению и навигации.
    try {
    if (step && step.type === 'text') {
        richState.html = (step.content && step.content.html) || '';
        EdunityRich.attach(document.getElementById('c-html-rich'), {
            value: richState.html,
            onChange: (html) => { richState.html = html; },
        });
    }
    if (step && step.type === 'code') {
        richState.statement = (step.content && step.content.statement) || '';
        EdunityRich.attach(document.getElementById('c-statement-rich'), {
            value: richState.statement,
            minHeight: 140,
            onChange: (html) => { richState.statement = html; },
        });
    }

    } catch (err) {
        console.error('[step-editor] редактор текста:', err);
        EdunityUI.toast('ტექსტის რედაქტორი ვერ ჩაიტვირთა');
    }

    // Виджеты загрузки файлов
    if (step && step.type === 'video') {
        uploadState.videoUrl = (step.content && step.content.url) || '';
        EdunityUpload.attach(document.getElementById('video-upload'), {
            kind: 'video',
            value: uploadState.videoUrl,
            onChange: async (url) => {
                uploadState.videoUrl = url;
                try {
                    const content = { url };
                    await EdunityAPI.updateStep(step.id, content);
                    step.content = content;
                } catch (err) {
                    EdunityUI.toast(err.message);
                }
            },
        });
    }
    if (step) {
        document.getElementById('save-step').addEventListener('click', async (e) => {
            e.target.disabled = true;
            try {
                const content = collectContent(step);
                await EdunityAPI.updateStep(step.id, content);
                step.content = content;
                const msg = document.getElementById('saved-msg');
                msg.hidden = false;
                setTimeout(() => (msg.hidden = true), 2000);
            } catch (err) {
                EdunityUI.toast(err.message);
            } finally {
                e.target.disabled = false;
            }
        });

        ['up', 'down'].forEach((dir) => {
            const btn = document.getElementById('move-step-' + dir);
            if (!btn) return;
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                try {
                    await EdunityAPI.moveStep(step.id, dir);
                    await load();
                } catch (err) {
                    EdunityUI.toast(err.message);
                    btn.disabled = false;
                }
            });
        });

        document.getElementById('delete-step').addEventListener('click', async () => {
            const ok = await EdunityUI.confirm({ title: 'ნაბიჯის წაშლა', text: 'ეს ნაბიჯი და მისი შიგთავსი წაიშლება.', okText: 'წაშლა', danger: true });
            if (!ok) return;
            try {
                await EdunityAPI.deleteStep(step.id);
                activeStepId = null;
                await load();
            } catch (err) {
                EdunityUI.toast(err.message);
            }
        });
    }
}

function selectStep(id) {
    activeStepId = id;
    renderMain();
}

async function load() {
    lessonData = await EdunityAPI.lessonSteps(lessonId);

    if (!lessonData.isOwner) {
        main.innerHTML = '<p class="editor-empty">თქვენ არ ხართ ამ კურსის ავტორი</p>';
        sidebar.innerHTML = '';
        return;
    }

    topbarTitle.textContent = lessonData.courseTitle;
    document.getElementById('back-to-course').setAttribute('href', 'course-editor.html?id=' + lessonData.courseId);

    if (!activeStepId && lessonData.steps.length > 0) activeStepId = lessonData.steps[0].id;

    renderMain();
    renderSidebar();
}

async function init() {
    if (!EdunityAuth.isLoggedIn()) {
        window.location.href = 'login.html';
        return;
    }
    try {
        await load();
    } catch (err) {
        main.innerHTML = `<p class="editor-empty">${esc(err.message)}</p>`;
    }
}

init();
