// Логика страницы регистрации: показ/скрытие паролей, валидация совпадения
// паролей на клиенте + реальная регистрация через backend API.

const parolisNaxvaBtn = document.getElementById('parolis-naxva');
const paroliInput = document.getElementById('paroli');
parolisNaxvaBtn.addEventListener('click', () => {
    paroliInput.type = paroliInput.type === 'password' ? 'text' : 'password';
});

const ganmeorebisNaxvaBtn = document.getElementById('ganmeorebis-naxva');
const gaimeoreInput = document.getElementById('gaimeore-paroli');
ganmeorebisNaxvaBtn.addEventListener('click', () => {
    gaimeoreInput.type = gaimeoreInput.type === 'password' ? 'text' : 'password';
});

const form = document.getElementById('registracia');
const saxeliInput = document.getElementById('saxeli');
const meiliInput = document.getElementById('meili');

const shecdomaSaxelshi = document.getElementById('shecdoma-saxelshi');
const shecdomaMeilshi = document.getElementById('shecdoma-meilshi');
const shecdomaParolshi = document.getElementById('shecdoma-parolshi');
const shecdomaGameorebashi = document.getElementById('shecdoma-gameorebashi');
const saertoShecdoma = document.getElementById('saerto-shecdoma');
const submitButton = document.getElementById('submit-button');

function clearErrors() {
    shecdomaSaxelshi.textContent = '';
    shecdomaMeilshi.textContent = '';
    shecdomaParolshi.textContent = '';
    shecdomaGameorebashi.textContent = '';
    saertoShecdoma.textContent = '';
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();

    const name = saxeliInput.value.trim();
    const email = meiliInput.value.trim();
    const password = paroliInput.value;
    const repeatPassword = gaimeoreInput.value;

    let hasError = false;

    if (name.length < 2) {
        shecdomaSaxelshi.textContent = 'შეიყვანე სახელი';
        hasError = true;
    }
    if (!email) {
        shecdomaMeilshi.textContent = 'შეიყვანე ელ.ფოსტა';
        hasError = true;
    }
    if (password.length < 8) {
        shecdomaParolshi.textContent = 'პაროლი უნდა შედგებოდეს მინიმუმ 8 სიმბოლოსგან';
        hasError = true;
    }
    if (password !== repeatPassword) {
        shecdomaGameorebashi.textContent = 'პაროლები არ ემთხვევა';
        hasError = true;
    }

    if (hasError) return;

    submitButton.disabled = true;
    submitButton.textContent = 'იტვირთება...';

    try {
        const { token, user } = await EdunityAPI.register(name, email, password);
        EdunityAuth.save(token, user);
        window.location.href = 'cabinet.html';
    } catch (err) {
        saertoShecdoma.textContent = err.message || 'რეგისტრაცია ვერ მოხერხდა';
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'რეგისტრაცია';
    }
});
