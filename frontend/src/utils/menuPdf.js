// Импорт меню кухни из PDF — детерминированный парсер (без ИИ).
//
// Формат PDF («Меню — состав блюд»):
//   Категория            (Салаты, Супы, Паста…)
//   Блюдо                (жирный заголовок)
//   ТК № … · выход … г   (мета-строка блюда)
//   Ингредиент  кол-во ед (Помидоры п/ф  130 г)
//
// Правило различения строк:
//   • строка вида «…ТК №…» / «…выход…» — мета блюда (пропускаем);
//   • строка, оканчивающаяся числом+единицей — ингредиент;
//   • строка, за которой идёт мета-строка — название блюда;
//   • иначе — категория.

const TITLE_RE = /состав\s+блюд/i;
const SUBTITLE_RE = /^по\s+технологическ/i;
const META_RE = /^\s*ТК\s*(№|N|#|No|Nº)/i;
const OUTPUT_RE = /выход\b/i;
// Ингредиент: имя + число + единица (кириллица или латиница) в конце строки.
const ING_RE = /^(.+?)\s+(\d+(?:[.,]\d+)?)\s*(г|гр|мл|кг|л|шт\.?|g|ml|kg|l|pcs|pc)\s*$/i;

const isMeta = (l) => META_RE.test(l) || OUTPUT_RE.test(l);

/**
 * Парсит массив текстовых строк PDF в структуру для импорта.
 * @returns {{categories: {name:string, dishes:{name:string, output?:string, recipe:{name:string, quantity:number, unit:string}[]}[]}[]}}
 */
export function parseMenuLines(rawLines) {
  const lines = (rawLines || [])
    .map((l) => String(l || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((l) => !TITLE_RE.test(l) && !SUBTITLE_RE.test(l));

  const categories = [];
  let cat = null;
  let dish = null;

  const ensureCat = () => {
    if (!cat) {
      cat = { name: "Без категории", dishes: [] };
      categories.push(cat);
    }
    return cat;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Мета-строка блюда: «ТК № 00166 · выход 274 г» — структурная.
    if (isMeta(line)) {
      if (dish && !dish.output) {
        const mo = line.match(/выход\s+([\d.,]+\s*(?:г|гр|мл|кг|л|шт\.?))/i);
        if (mo) dish.output = mo[1].replace(/\s+/g, " ").trim();
      }
      continue;
    }

    // Ингредиент.
    const m = line.match(ING_RE);
    if (m) {
      const name = m[1].trim();
      const quantity = parseFloat(m[2].replace(",", "."));
      const unit = m[3].replace(".", "");
      if (dish && name && quantity > 0) dish.recipe.push({ name, quantity, unit });
      continue;
    }

    // Название блюда, если следующая строка — мета.
    const next = lines[i + 1];
    if (next && isMeta(next)) {
      dish = { name: line, recipe: [] };
      ensureCat().dishes.push(dish);
    } else {
      // Категория.
      cat = { name: line, dishes: [] };
      categories.push(cat);
      dish = null;
    }
  }

  // Пустые категории (случайные строки/подзаголовки) отбрасываем.
  return { categories: categories.filter((c) => c.dishes.length > 0) };
}

/**
 * Извлекает текстовые строки из PDF-файла через pdf.js.
 * Группирует текст-элементы по вертикали (Y) и склеивает по горизонтали (X),
 * чтобы восстановить строки «имя … количество» из двух колонок.
 */
export async function extractPdfLines(file) {
  const pdfjsLib = await import("pdfjs-dist");
  // Воркер бандлится локально (Vite ?url) — без внешних CDN.
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;

  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();

    const rows = [];
    for (const it of content.items) {
      const str = (it.str || "").trim();
      if (!str) continue;
      const y = Math.round(it.transform[5]);
      const x = it.transform[4];
      let row = rows.find((r) => Math.abs(r.y - y) <= 3);
      if (!row) {
        row = { y, items: [] };
        rows.push(row);
      }
      row.items.push({ x, str });
    }
    rows.sort((a, b) => b.y - a.y); // в PDF Y растёт вверх → сверху вниз
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x);
      const line = r.items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
      if (line) lines.push(line);
    }
    await page.cleanup();
  }
  return lines;
}
