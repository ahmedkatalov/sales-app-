// Управление темой оформления (тёмная / светлая).
// Тема хранится в localStorage и применяется к <html data-theme="...">.
// Инициализация без мигания делается инлайн-скриптом в index.html.

const STORAGE_KEY = "sales_app_theme";
const THEMES = ["dark", "light"];

export function getTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (THEMES.includes(saved)) return saved;
  // По умолчанию — системная тема, иначе тёмная
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

export function applyTheme(theme) {
  const t = THEMES.includes(theme) ? theme : "dark";
  document.documentElement.setAttribute("data-theme", t);
  document.documentElement.style.colorScheme = t;
}

export function setTheme(theme) {
  const t = THEMES.includes(theme) ? theme : "dark";
  localStorage.setItem(STORAGE_KEY, t);
  applyTheme(t);
  window.dispatchEvent(new CustomEvent("sales-theme-change", { detail: t }));
}

export function toggleTheme() {
  const next = getTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}
