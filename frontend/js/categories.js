// Категории берутся из базы (управляются в админке).
// Список кешируется на время загрузки страницы.
let EDUNITY_CATEGORIES = [];

async function loadCategories() {
    try {
        const list = await EdunityAPI.categories();
        EDUNITY_CATEGORIES = list.map((c) => c.name);
    } catch (err) {
        EDUNITY_CATEGORIES = [];
    }
    return EDUNITY_CATEGORIES;
}
