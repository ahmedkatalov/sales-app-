// ═══════════════════════════════════════════════════════════════════════
//  THEME ENGINE — движок оформления
//  Приложение построено на CSS-переменных (Tailwind v4 компилирует все
//  утилиты цвета/скругления/блюра/отступов в var(--*)). Поэтому чтобы
//  перекрасить ВСЁ приложение вживую — достаточно переопределить эти
//  переменные. Движок собирает один <style> и подменяет его содержимое.
//
//  Никаких хардкод-цветов: любой параметр — токен, значение — из профиля
//  оформления (appearance). Профиль сериализуется в localStorage и
//  применяется до первого рендера (см. index.html) чтобы не было вспышки.
// ═══════════════════════════════════════════════════════════════════════

const KEY_APPEARANCE = "sales_app_appearance";
const KEY_APPEARANCE_CSS = "sales_app_appearance_css";
const KEY_THEMES = "sales_app_themes";
const STYLE_ID = "appearance-style";

// Профиль по умолчанию. null у цвета = «не трогаем, берём родной токен
// приложения» (сохраняет выверенную палитру light/dark без искажений).
export const DEFAULT_APPEARANCE = {
  accent: null,      // основной цвет (кнопки, ссылки, акценты)
  accent2: null,     // второй цвет градиента
  success: null,
  warning: null,
  error: null,
  info: null,
  radius: 1,         // множитель скругления (0 = острые, 1.8 = «таблетка»)
  glass: true,       // стеклянные поверхности (backdrop-blur)
  blur: 1,           // множитель силы размытия стекла
  shadow: "soft",    // soft | none | strong(glow)
  font: "system",    // system | rounded | serif | mono
  fontScale: 1,      // масштаб шрифта (0.9 … 1.15)
  density: "normal", // compact | normal | comfortable
  motion: true,      // анимации/переходы вкл/выкл
};

export const FONT_STACKS = {
  system: `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`,
  rounded: `ui-rounded, "SF Pro Rounded", "Nunito", "Segoe UI", system-ui, sans-serif`,
  serif: `"Iowan Old Style", "Palatino Linotype", "Georgia", ui-serif, serif`,
  mono: `ui-monospace, "SF Mono", "JetBrains Mono", "Menlo", "Consolas", monospace`,
};

export const FONT_LABELS = { system: "Системный", rounded: "Округлый", serif: "Серифный", mono: "Моно" };
export const DENSITY_LABELS = { compact: "Плотно", normal: "Обычно", comfortable: "Просторно" };
export const SHADOW_LABELS = { soft: "Мягкие", none: "Без теней", strong: "Свечение" };

export const RADIUS_PRESETS = {
  sharp: 0, minimal: 0.5, modern: 1, rounded: 1.35, apple: 1.2, material: 0.75, pill: 1.8,
};
export const RADIUS_LABELS = {
  sharp: "Острые", minimal: "Строгие", material: "Material", modern: "Modern", apple: "Apple", rounded: "Скруглённые", pill: "Таблетка",
};

// ── Готовые темы ─────────────────────────────────────────────────────
export const PRESETS = [
  { id: "default", name: "Стандарт", mode: "dark", appearance: { ...DEFAULT_APPEARANCE } },
  { id: "apple", name: "Apple", mode: "dark", appearance: { accent: "#0a84ff", accent2: "#5e5ce6", radius: 1.2, glass: true, blur: 1.1, shadow: "soft", font: "rounded" } },
  { id: "glass", name: "Стекло", mode: "dark", appearance: { accent: "#22d3ee", accent2: "#818cf8", radius: 1.1, glass: true, blur: 1.45, shadow: "soft" } },
  { id: "midnight", name: "Midnight", mode: "dark", appearance: { accent: "#6366f1", accent2: "#8b5cf6", radius: 1, glass: true, shadow: "soft" } },
  { id: "ocean", name: "Ocean", mode: "dark", appearance: { accent: "#0ea5e9", accent2: "#06b6d4", radius: 1.1, glass: true } },
  { id: "emerald", name: "Emerald", mode: "dark", appearance: { accent: "#10b981", accent2: "#14b8a6", radius: 1 } },
  { id: "violet", name: "Violet", mode: "dark", appearance: { accent: "#8b5cf6", accent2: "#d946ef", radius: 1.1 } },
  { id: "carbon", name: "Carbon", mode: "dark", appearance: { accent: "#64748b", accent2: "#94a3b8", radius: 0.7, glass: false, shadow: "none" } },
  { id: "business", name: "Business", mode: "light", appearance: { accent: "#2563eb", accent2: "#1e40af", radius: 0.6, glass: false, shadow: "soft", font: "system" } },
  { id: "luxury", name: "Luxury", mode: "dark", appearance: { accent: "#d4af37", accent2: "#b45309", radius: 0.9, glass: true, shadow: "strong" } },
  { id: "neon", name: "Neon", mode: "dark", appearance: { accent: "#22d3ee", accent2: "#f472b6", radius: 1.2, glass: true, shadow: "strong" } },
  { id: "minimal", name: "Minimal", mode: "light", appearance: { accent: "#111827", accent2: "#374151", radius: 0.5, glass: false, shadow: "none", font: "system" } },
  { id: "nord", name: "Nord", mode: "dark", appearance: { accent: "#88c0d0", accent2: "#5e81ac", radius: 0.9 } },
  { id: "dracula", name: "Dracula", mode: "dark", appearance: { accent: "#bd93f9", accent2: "#ff79c6", radius: 1 } },
];

// ── Цветовая математика ──────────────────────────────────────────────
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function hexToHsl(hex) {
  let h = String(hex || "").replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hh = 0, s = 0; const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hh = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
    hh *= 60;
  }
  return { h: Math.round(hh), s: Math.round(s * 100), l: Math.round(l * 100) };
}

const hsl = (h, s, l) => `hsl(${h} ${clamp(s, 0, 100)}% ${clamp(l, 0, 100)}%)`;

// Строим перцептивно ровную «лесенку» оттенков из одного цвета.
// Уровни лёгкости подобраны так, чтобы читаться и на тёмном, и на светлом.
function ramp(hex) {
  const base = hexToHsl(hex);
  if (!base) return null;
  const s = clamp(base.s, 45, 96);
  const L = { 200: 78, 300: 70, 400: 62, 500: 55, 600: 48, 700: 40, 800: 32, 900: 24, 950: 18 };
  const out = {};
  for (const k of Object.keys(L)) out[k] = hsl(base.h, s, L[k]);
  return out;
}

// Соответствие «семантический цвет → семейства палитры Tailwind».
const FAMILY_MAP = {
  accent: ["blue"],
  accent2: ["violet", "indigo"],
  success: ["emerald", "green"],
  warning: ["amber", "orange", "yellow"],
  error: ["red", "rose"],
  info: ["cyan", "sky"],
};
const RAMP_LEVELS = ["200", "300", "400", "500", "600", "700", "800", "900", "950"];

// Значения по умолчанию для структурных токенов (в rem/px), = дефолт Tailwind.
const RADIUS_BASE = { sm: 0.25, md: 0.375, lg: 0.5, xl: 0.75, "2xl": 1, "3xl": 1.5, "4xl": 2 };
const BLUR_BASE = { xs: 2, sm: 4, md: 8, lg: 12, xl: 16, "2xl": 24, "3xl": 40 };

// ── Сборка CSS ───────────────────────────────────────────────────────
export function buildCss(appearanceInput) {
  const a = { ...DEFAULT_APPEARANCE, ...(appearanceInput || {}) };
  const root = [];
  const recolored = new Set();

  // Акцентные и статусные цвета → переопределяем семейства палитры
  const applyColor = (hex, families) => {
    if (!hex) return;
    const r = ramp(hex);
    if (!r) return;
    for (const fam of families) {
      recolored.add(fam);
      for (const lvl of RAMP_LEVELS) root.push(`--color-${fam}-${lvl}:${r[lvl]};`);
    }
  };
  applyColor(a.accent, FAMILY_MAP.accent);
  applyColor(a.accent2, FAMILY_MAP.accent2);
  applyColor(a.success, FAMILY_MAP.success);
  applyColor(a.warning, FAMILY_MAP.warning);
  applyColor(a.error, FAMILY_MAP.error);
  applyColor(a.info, FAMILY_MAP.info);

  // Бренд-градиент (кнопки/CTA)
  if (a.accent) { root.push(`--brand:${a.accent};`); }
  if (a.accent2) { root.push(`--brand-2:${a.accent2};`); }

  // Скругление (только при отличии от дефолта — иначе не трогаем токены Tailwind)
  const rr = clamp(Number(a.radius ?? 1), 0, 1.8);
  if (rr !== 1) for (const [k, v] of Object.entries(RADIUS_BASE)) root.push(`--radius-${k}:${(v * rr).toFixed(4)}rem;`);

  // Стекло (сила размытия)
  const bl = clamp(Number(a.blur ?? 1), 0.2, 1.8);
  if (bl !== 1) for (const [k, v] of Object.entries(BLUR_BASE)) root.push(`--blur-${k}:${Math.round(v * bl)}px;`);

  // Плотность (базовый шаг отступов Tailwind)
  const dens = a.density === "compact" ? 0.92 : a.density === "comfortable" ? 1.1 : 1;
  if (dens !== 1) root.push(`--spacing:${(0.25 * dens).toFixed(4)}rem;`);

  // Масштаб шрифта (через корневой font-size → все rem)
  const fs = clamp(Number(a.fontScale ?? 1), 0.85, 1.2);
  if (fs !== 1) root.push(`font-size:${(fs * 100).toFixed(1)}%;`);

  // Селектор html:root специфичнее обычного :root (0,1,1 против 0,1,0),
  // поэтому наши токены выигрывают у любых :root в стилях приложения —
  // включая мобильные @media-переопределения радиусов — независимо от
  // порядка подключения стилей.
  const blocks = [];
  if (root.length) blocks.push(`html:root{${root.join("")}}`);

  // Tailwind v4 инлайнит ЛИТЕРАЛЬНЫЙ цвет в --tw-gradient-from/-to/-via, поэтому
  // переопределения --color-* сами по себе НЕ перекрашивают градиенты (главные
  // CTA-кнопки from-blue-600 to-violet-600). Привязываем стопы градиента обратно
  // к нашим токенам цвета — тогда весь бренд-градиент следует за акцентом.
  if (recolored.size) {
    const grad = [];
    for (const fam of recolored) {
      for (const lvl of RAMP_LEVELS) {
        grad.push(`.from-${fam}-${lvl}{--tw-gradient-from:var(--color-${fam}-${lvl})!important}`);
        grad.push(`.to-${fam}-${lvl}{--tw-gradient-to:var(--color-${fam}-${lvl})!important}`);
        grad.push(`.via-${fam}-${lvl}{--tw-gradient-via:var(--color-${fam}-${lvl})!important}`);
      }
    }
    blocks.push(grad.join(""));
  }

  // Шрифт (system = дефолт приложения — не переопределяем)
  if (a.font && a.font !== "system") {
    const stack = FONT_STACKS[a.font] || FONT_STACKS.system;
    blocks.push(`body{font-family:${stack};}`);
  }

  // Стекло выкл → убираем backdrop-blur и делаем поверхности плотнее
  if (!a.glass) {
    blocks.push(`[class*="backdrop-blur"]{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;}`);
  }

  // Тени
  if (a.shadow === "none") {
    blocks.push(`[class*="shadow-"]{box-shadow:none!important;}`);
  } else if (a.shadow === "strong" && a.accent) {
    blocks.push(`[class*="shadow-"]{box-shadow:0 10px 40px -12px ${a.accent}55,0 4px 14px -6px ${a.accent}33!important;}`);
  }

  // Анимации выкл
  if (!a.motion) {
    blocks.push(`*,*::before,*::after{transition-duration:0.001ms!important;animation-duration:0.001ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important;}`);
  }

  return blocks.join("\n");
}

// ── Применение / хранение ────────────────────────────────────────────
export function applyAppearance(appearance) {
  if (typeof document === "undefined") return;
  const css = buildCss(appearance);
  let el = document.getElementById(STYLE_ID);
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
  try { localStorage.setItem(KEY_APPEARANCE_CSS, css); } catch { /* ignore */ }
}

export function getAppearance() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY_APPEARANCE) || "null");
    if (raw && typeof raw === "object") return { ...DEFAULT_APPEARANCE, ...raw };
  } catch { /* ignore */ }
  return { ...DEFAULT_APPEARANCE };
}

export function setAppearance(partial) {
  const next = { ...getAppearance(), ...partial };
  try { localStorage.setItem(KEY_APPEARANCE, JSON.stringify(next)); } catch { /* ignore */ }
  applyAppearance(next);
  window.dispatchEvent(new CustomEvent("sales-appearance-change", { detail: next }));
  return next;
}

// hydrateAppearance — применить оформление, ПРИШЕДШЕЕ С СЕРВЕРА (общее на
// аккаунт). Пишем в localStorage как базовое и применяем, но не шлём событие
// изменения (это не действие пользователя, а синхронизация). null = сброс.
export function hydrateAppearance(appearance) {
  const next = appearance && typeof appearance === "object"
    ? { ...DEFAULT_APPEARANCE, ...appearance }
    : { ...DEFAULT_APPEARANCE };
  try { localStorage.setItem(KEY_APPEARANCE, JSON.stringify(next)); } catch { /* ignore */ }
  applyAppearance(next);
  window.dispatchEvent(new CustomEvent("sales-appearance-change", { detail: next }));
  return next;
}

export function resetAppearance() {
  try { localStorage.removeItem(KEY_APPEARANCE); } catch { /* ignore */ }
  applyAppearance(DEFAULT_APPEARANCE);
  window.dispatchEvent(new CustomEvent("sales-appearance-change", { detail: { ...DEFAULT_APPEARANCE } }));
  return { ...DEFAULT_APPEARANCE };
}

export function initAppearance() {
  applyAppearance(getAppearance());
}

// ── Пользовательские темы (CRUD + экспорт/импорт) ────────────────────
export function listThemes() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY_THEMES) || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function writeThemes(arr) {
  try { localStorage.setItem(KEY_THEMES, JSON.stringify(arr)); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent("sales-themes-change"));
}
const rid = () => `t_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

export function saveTheme(name, appearance) {
  const arr = listThemes();
  const item = { id: rid(), name: (name || "Моя тема").trim(), appearance: { ...appearance } };
  writeThemes([item, ...arr]);
  return item;
}
export function renameTheme(id, name) {
  writeThemes(listThemes().map((t) => (t.id === id ? { ...t, name: (name || t.name).trim() } : t)));
}
export function duplicateTheme(id) {
  const src = listThemes().find((t) => t.id === id);
  if (!src) return;
  const copy = { id: rid(), name: `${src.name} (копия)`, appearance: { ...src.appearance } };
  writeThemes([copy, ...listThemes()]);
  return copy;
}
export function deleteTheme(id) {
  writeThemes(listThemes().filter((t) => t.id !== id));
}
export function exportTheme(appearance, name) {
  return JSON.stringify({ app: "sales-app", kind: "appearance", name: name || "theme", appearance }, null, 2);
}
export function importTheme(text) {
  const data = JSON.parse(text);
  const ap = data?.appearance && typeof data.appearance === "object" ? data.appearance : data;
  if (!ap || typeof ap !== "object") throw new Error("Некорректный формат темы");
  // берём только известные ключи
  const clean = {};
  for (const k of Object.keys(DEFAULT_APPEARANCE)) if (k in ap) clean[k] = ap[k];
  return { name: data?.name || "Импортированная тема", appearance: { ...DEFAULT_APPEARANCE, ...clean } };
}
