// Логика страницы входа: показ/скрытие пароля + запрос к backend API
// Бургер-меню — в common.js

const parolisNaxvaBtn = document.getElementById('parolisnaxva');
const parolisNaxvaIcon = document.getElementById('parolisnaxvaicon');
const paroliInput = document.getElementById('paroli');

parolisNaxvaBtn.addEventListener('click', () => {
    const hidden = paroliInput.type === 'password';
    paroliInput.type = hidden ? 'text' : 'password';
});

const form = document.getElementById('login');
const meiliInput = document.getElementById('meili');
const shecdomaMeilshi = document.getElementById('shecdomameilshi');
const shecdomaParolshi = document.getElementById('shecdomaparolshi');
const saertoShecdoma = document.getElementById('saerto-shecdoma');
const submitButton = document.getElementById('submit-button');

function clearErrors() {
    shecdomaMeilshi.textContent = '';
    shecdomaParolshi.textContent = '';
    saertoShecdoma.textContent = '';
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();

    const email = meiliInput.value.trim();
    const password = paroliInput.value;

    if (!email) {
        shecdomaMeilshi.textContent = 'შეიყვანე ელ.ფოსტა';
        return;
    }
    if (!password) {
        shecdomaParolshi.textContent = 'შეიყვანე პაროლი';
        return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'იტვირთება...';

    try {
        const { token, user } = await EdunityAPI.login(email, password);
        EdunityAuth.save(token, user);
        window.location.href = 'cabinet.html';
    } catch (err) {
        saertoShecdoma.textContent = err.message || 'ავტორიზაცია ვერ მოხერხდა';
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'შესვლა';
    }
});
