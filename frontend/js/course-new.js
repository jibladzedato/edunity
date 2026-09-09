// Страница создания курса

const input = document.getElementById('course-title');
const counter = document.getElementById('char-count');
const errorEl = document.getElementById('title-error');
const createBtn = document.getElementById('create-btn');

if (!EdunityAuth.isLoggedIn()) {
    window.location.href = 'login.html';
}

input.addEventListener('input', () => {
    counter.textContent = input.value.length + '/64';
    errorEl.hidden = true;
    input.classList.remove('invalid');
});

input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') create();
});

async function create() {
    const title = input.value.trim();

    if (title.length < 3) {
        errorEl.textContent = 'კურსის სახელი უნდა შედგებოდეს მინიმუმ 3 სიმბოლოსგან';
        errorEl.hidden = false;
        input.classList.add('invalid');
        input.focus();
        return;
    }

    createBtn.disabled = true;
    createBtn.textContent = 'იქმნება...';

    try {
        const course = await EdunityAPI.createCourse(title);
        window.location.href = 'course-editor.html?id=' + course.id;
    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.hidden = false;
        createBtn.disabled = false;
        createBtn.textContent = 'კურსის შექმნა';
    }
}

createBtn.addEventListener('click', create);
input.focus();
