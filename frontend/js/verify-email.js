// Подтверждение почты по ссылке из письма

const page = document.getElementById('page');
const token = new URLSearchParams(window.location.search).get('token');

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function show(icon, title, text, actionHtml) {
    page.innerHTML = `
        <a href="../index.html" class="logo">EDUNITY</a>
        <div class="auth-msg-icon">${icon}</div>
        <h1>${title}</h1>
        <p>${text}</p>
        ${actionHtml || ''}`;
}

async function run() {
    if (!token) {
        return show('✕', 'ბმული არასწორია', 'ბმული არასრულია — გადმოწერე წერილიდან თავიდან.',
            '<a class="studio-btn primary" href="login.html">შესვლა</a>');
    }

    try {
        const r = await EdunityAPI.verifyEmail(token);
        show('✓', 'ფოსტა დადასტურებულია', `${esc(r.email)} — ყველაფერი მზადაა.`,
            '<a class="studio-btn primary" href="login.html">შესვლა</a>');
    } catch (err) {
        show('✕', 'დადასტურება ვერ მოხერხდა', esc(err.message), `
            <div class="auth-msg-resend">
                <input type="email" id="resend-email" placeholder="შენი ელ.ფოსტა">
                <button class="studio-btn primary" id="resend-btn">ბმულის ხელახლა გამოგზავნა</button>
                <p class="auth-msg-note" id="resend-note" hidden>თუ ასეთი ფოსტა არსებობს, წერილი გამოგზავნილია.</p>
            </div>`);

        const btn = document.getElementById('resend-btn');
        if (btn) {
            btn.addEventListener('click', async () => {
                const email = document.getElementById('resend-email').value.trim();
                if (!email) return;
                btn.disabled = true;
                try {
                    await EdunityAPI.resendVerification(email);
                } catch (e) {}
                document.getElementById('resend-note').hidden = false;
            });
        }
    }
}

run();
