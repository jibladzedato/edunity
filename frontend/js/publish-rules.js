// Правила готовности курса к публикации.
// Используются и в разделе «პუბლიკაციის პარამეტრები», и при нажатии «გამოქვეყნება».

const EdunityPublish = (function () {
  // course — объект курса, structure — массив модулей с уроками и шагами
  function check(course, structure) {
    const modules = structure || [];
    const lessons = modules.flatMap((m) => m.lessons || []);
    const steps = lessons.flatMap((l) => l.steps || []);

    const rules = [
      {
        id: 'summary',
        label: 'მოკლე აღწერა 100 სიმბოლოზე გრძელია',
        ok: (course.summary || '').trim().length >= 100,
        hint: 'შეავსე «მოკლე აღწერა» აღწერის განყოფილებაში.',
        section: 'description',
      },
      {
        id: 'description',
        label: 'შევსებულია სრული აღწერა',
        ok: (course.description || '').trim().length >= 50,
        hint: 'სრული აღწერა უნდა იყოს მინიმუმ 50 სიმბოლო.',
        section: 'description',
      },
      {
        id: 'cover',
        label: 'დამატებულია ყდის სურათი',
        ok: !!(course.coverUrl || '').trim(),
        hint: 'მიუთითე ყდის სურათის ბმული აღწერის განყოფილებაში.',
        section: 'description',
      },
      {
        id: 'category',
        label: 'მითითებულია კურსის კატეგორია',
        ok: !!(course.category || '').trim(),
        hint: 'აირჩიე კატეგორია აღწერის განყოფილებაში.',
        section: 'description',
      },
      {
        id: 'has-modules',
        label: 'კურსს აქვს მინიმუმ ერთი მოდული',
        ok: modules.length > 0,
        hint: 'შექმენი მოდული შინაარსის განყოფილებაში.',
        section: 'content',
      },
      {
        id: 'no-empty-modules',
        label: 'არ არის ცარიელი მოდულები',
        ok: modules.length > 0 && modules.every((m) => (m.lessons || []).length > 0),
        hint: 'ყველა მოდულში უნდა იყოს მინიმუმ ერთი გაკვეთილი.',
        section: 'content',
      },
      {
        id: 'no-empty-lessons',
        label: 'არ არის ცარიელი გაკვეთილები',
        ok: lessons.length > 0 && lessons.every((l) => (l.steps || []).length > 0),
        hint: 'ყველა გაკვეთილში უნდა იყოს მინიმუმ ერთი ნაბიჯი.',
        section: 'content',
      },
      {
        id: 'meaningful-titles',
        label: 'მოდულებსა და გაკვეთილებს აქვთ შინაარსობრივი სახელები',
        ok:
          modules.every((m) => (m.title || '').trim().length >= 3) &&
          lessons.every((l) => (l.title || '').trim().length >= 3),
        hint: 'სახელი უნდა იყოს მინიმუმ 3 სიმბოლო.',
        section: 'content',
      },
      {
        id: 'steps-count',
        label: 'კურსში მინიმუმ 3 ნაბიჯია',
        ok: steps.length >= 3,
        hint: 'დაამატე მეტი ნაბიჯი, რომ კურსი სასარგებლო იყოს.',
        section: 'content',
      },
    ];

    const passed = rules.filter((r) => r.ok).length;

    return {
      rules,
      passed,
      total: rules.length,
      ready: passed === rules.length,
    };
  }

  return { check };
})();
