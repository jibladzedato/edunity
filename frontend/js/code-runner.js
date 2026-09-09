// Запуск кода ученика прямо в браузере, без сервера.
//
// JavaScript — в Web Worker (изолированный поток, можно прервать по таймауту).
// Python     — через Pyodide (настоящий CPython, скомпилированный в WebAssembly).
//
// Java и C++ здесь недоступны: для них нужен компилятор на сервере
// (Docker-песочница), в браузере их запустить нельзя.

const EdunityCode = (function () {
  const LANGUAGES = {
    python: { label: 'Python', runnable: true },
    javascript: { label: 'JavaScript', runnable: true },
  };

  const TIMEOUT_MS = 10000;

  // ---------- JavaScript ----------
  function runJavaScript(code, stdin) {
    return new Promise((resolve) => {
      const source = `
        self.onmessage = function (e) {
          const inputLines = String(e.data.stdin || '').split('\\n');
          let inputIndex = 0;
          const out = [];

          // ученический код читает ввод через input() и печатает через print()/console.log()
          function input() { return inputIndex < inputLines.length ? inputLines[inputIndex++] : ''; }
          function print(...args) { out.push(args.join(' ')); }
          const console = { log: print, error: print, warn: print };

          try {
            eval(e.data.code);
            self.postMessage({ ok: true, stdout: out.join('\\n') });
          } catch (err) {
            self.postMessage({ ok: false, error: String(err) });
          }
        };
      `;

      let worker;
      let finished = false;

      const done = (result) => {
        if (finished) return;
        finished = true;
        if (worker) worker.terminate();
        if (url) URL.revokeObjectURL(url);
        resolve(result);
      };

      const url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));

      try {
        worker = new Worker(url);
      } catch (err) {
        return done({ ok: false, error: 'ბრაუზერი ვერ უშვებს კოდს: ' + err.message });
      }

      const timer = setTimeout(() => done({ ok: false, error: 'შესრულებამ 10 წამზე მეტი დრო წაიღო' }), TIMEOUT_MS);

      worker.onmessage = (e) => {
        clearTimeout(timer);
        done(e.data);
      };
      worker.onerror = (e) => {
        clearTimeout(timer);
        done({ ok: false, error: e.message || 'შეცდომა შესრულებისას' });
      };

      worker.postMessage({ code, stdin });
    });
  }

  // ---------- Python (Pyodide) ----------
  let pyodidePromise = null;

  function loadPyodideOnce(onStatus) {
    if (pyodidePromise) return pyodidePromise;

    pyodidePromise = new Promise((resolve, reject) => {
      if (onStatus) onStatus('Python-ის გარემო იტვირთება (პირველად ~15 MB)...');

      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js';
      script.onload = async () => {
        try {
          const py = await loadPyodide();
          resolve(py);
        } catch (err) {
          pyodidePromise = null;
          reject(err);
        }
      };
      script.onerror = () => {
        pyodidePromise = null;
        reject(new Error('Python-ის გარემო ვერ ჩაიტვირთა — შეამოწმე ინტერნეტი'));
      };
      document.head.appendChild(script);
    });

    return pyodidePromise;
  }

  async function runPython(code, stdin, onStatus) {
    let py;
    try {
      py = await loadPyodideOnce(onStatus);
    } catch (err) {
      return { ok: false, error: err.message };
    }

    if (onStatus) onStatus('სრულდება...');

    try {
      // перенаправляем stdin/stdout, чтобы собрать вывод программы
      py.globals.set('__stdin_data', String(stdin || ''));
      const wrapper = `
import sys, io
__buf = io.StringIO()
__old_out, __old_in = sys.stdout, sys.stdin
sys.stdout = __buf
sys.stdin = io.StringIO(__stdin_data)
try:
${code
  .split('\n')
  .map((l) => '    ' + l)
  .join('\n')}
finally:
    sys.stdout, sys.stdin = __old_out, __old_in
__result = __buf.getvalue()
`;
      await py.runPythonAsync(wrapper);
      return { ok: true, stdout: py.globals.get('__result') || '' };
    } catch (err) {
      return { ok: false, error: String(err.message || err).split('\n').slice(-6).join('\n') };
    }
  }

  // ---------- Общий запуск ----------
  async function run(language, code, stdin, onStatus) {
    if (language === 'javascript') return runJavaScript(code, stdin);
    if (language === 'python') return runPython(code, stdin, onStatus);
    return { ok: false, error: 'ეს ენა ბრაუზერში არ სრულდება' };
  }

  // Прогон по всем тестам автора
  async function runTests(language, code, tests, onStatus) {
    const results = [];

    for (let i = 0; i < tests.length; i++) {
      const t = tests[i];
      if (onStatus) onStatus(`ტესტი ${i + 1} / ${tests.length}...`);

      const res = await run(language, code, t.input || '', onStatus);
      const actual = (res.stdout || '').trim();
      const expected = String(t.expected || '').trim();

      results.push({
        index: i + 1,
        input: t.input || '',
        expected,
        actual,
        passed: res.ok && actual === expected,
        error: res.ok ? null : res.error,
      });
    }

    return {
      results,
      passed: results.filter((r) => r.passed).length,
      total: results.length,
      allPassed: results.length > 0 && results.every((r) => r.passed),
    };
  }

  return { LANGUAGES, run, runTests };
})();
