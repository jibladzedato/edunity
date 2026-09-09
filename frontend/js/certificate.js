// Страница сертификата: показ и проверка подлинности по коду.
// Открывается по ссылке certificate.html?code=EDU-XXXX-XXXX — её можно
// дать работодателю, он увидит те же данные из базы.

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const page = document.getElementById('cert-page');
const code = new URLSearchParams(window.location.search).get('code');

function verifyForm(message) {
    page.innerHTML = `
        <div class="cert-verify">
            <a href="../index.html" class="logo">EDUNITY</a>
            <h1>სერტიფიკატის შემოწმება</h1>
            ${message ? `<p class="cert-error">${esc(message)}</p>` : ''}
            <input type="text" id="code-input" placeholder="EDU-XXXX-XXXX" value="${esc(code || '')}">
            <button class="editor-save-btn" id="check-btn">შემოწმება</button>
        </div>`;

    document.getElementById('check-btn').addEventListener('click', () => {
        const v = document.getElementById('code-input').value.trim();
        if (v) window.location.href = 'certificate.html?code=' + encodeURIComponent(v);
    });
}

async function load() {
    if (!code) return verifyForm(null);

    try {
        const c = await EdunityAPI.verifyCertificate(code);
        const date = new Date(c.issuedAt).toLocaleDateString('ka-GE', { year: 'numeric', month: 'long', day: 'numeric' });

        page.innerHTML = `
            <div class="cert-actions no-print">
                <a href="../index.html" class="studio-btn">← EDUNITY</a>
                <button class="studio-btn primary" onclick="window.print()">ბეჭდვა / PDF</button>
            </div>

            <div class="cert-sheet">
                <div class="cert-brand">EDUNITY</div>
                <p class="cert-kicker">სერტიფიკატი</p>

                <h1 class="cert-name">${esc(c.studentName)}</h1>
                <p class="cert-text">წარმატებით დაასრულა კურსი</p>
                <h2 class="cert-course">${esc(c.courseTitle)}</h2>

                <div class="cert-meta">
                    <div>
                        <span class="cert-meta-label">ლექტორი</span>
                        <span class="cert-meta-value">${esc(c.authorName)}</span>
                    </div>
                    <div>
                        <span class="cert-meta-label">გაკვეთილები</span>
                        <span class="cert-meta-value">${c.lessonsCount}</span>
                    </div>
                    <div>
                        <span class="cert-meta-label">გაცემის თარიღი</span>
                        <span class="cert-meta-value">${date}</span>
                    </div>
                </div>

                <div class="cert-footer">
                    <span class="cert-code">${esc(c.code)}</span>
                    <span class="cert-verify-note">ნამდვილობის შემოწმება: certificate.html?code=${esc(c.code)}</span>
                </div>
            </div>`;
    } catch (err) {
        verifyForm(err.message);
    }
}

load();
