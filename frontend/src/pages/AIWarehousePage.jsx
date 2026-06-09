import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { get, getCurrentWorkspace, getSession, post } from "../api";
import { formatMoney, num } from "../utils/format";

const UNIT_LABELS = { g: "г", kg: "кг", ml: "мл", l: "л", pcs: "шт", bottle: "бут", pack: "упак", box: "кор" };
const CONTAINER_UNITS = ["box", "pack", "bottle"];
const unitLabel = (unit) => UNIT_LABELS[unit] || unit || "";

const PURCHASE_VERB_RE = /^(я\s+|мы\s+)?(купил[аи]?|купили|докупил[аи]?|докупили|закупил[аи]?|закупили|взял[аи]?|взяли|добавил[аи]?|добавили)\s+/i;
const FILLER_RE = /^(такс|так|короче|ну|значит|ладно|я|мы|еще|ещё)\s+/i;

const normalizeText = (text) => String(text || "").replace(/ё/g, "е").replace(/,/g, ".").replace(/\s+/g, " ").trim();
const lower = (text) => normalizeText(text).toLowerCase();

const AI_MODE = {
  HUMAN_OPERATOR: "human_operator",
  STRICT_FLOW: "strict_flow",
};

const CURRENT_AI_MODE = AI_MODE.HUMAN_OPERATOR;

const isCancelContextText = (text) => {
  const t = lower(text);
  return /^(стоп|отмена|отмени|не надо|не нужно|забей|хватит|закрой|сброс|сбрось|другая тема|другое|сменим тему|уходи от этой темы|уйди от этой темы|забудь это|не записывай|не сохраняй)$/i.test(t)
    || /(уходи|уйди|отстань|забей|закрой)\s+(от\s+)?(этой\s+)?тем/i.test(t);
};

const sanitizeAssistantAnswer = (answer) => {
  const text = String(answer || "").trim();
  return text || "Готово.";
};
const isExpenseText = (text) => /(расход|потратил|потратила|оплатил|оплатила|заплатил|заплатила|аренда|такси|зарплата|аванс|сайт|реклама|коммунал|доставка)/i.test(String(text || ""));

const isMenuCreateText = (text) => {
  const t = lower(text);
  if (isMenuTypeCreateText(text) || isMenuCategoryCreateText(text)) return false;
  if (/(создай|создать|добавь|добавить|внеси|внести|сделай)\s+.*(тип|папк|категор|меню|напит|блюд|товар меню|продукт меню)/i.test(t)) return true;
  if (/(эспрессо|espresso|латте|капучино|флэт\s*уайт|раф|американо|макиато|чай|бургер|десерт)/i.test(t) && /(цена|руб|₽|состав|рецепт|используем|грам|мл|тип|папк|категор)/i.test(t)) return true;
  if (/(тип|папк|категор).*?(цена|состав|рецепт|эспрессо|латте|капучино|товар|напит|блюд)/i.test(t)) return true;
  return false;
};


const MENU_TYPE_ALIASES = [
  { name: "Еда", re: /\b(еда|еду|блюда|кухня)\b/i },
  { name: "Напитки", re: /\b(напитки|напиток|напитков|кофе|чай|бар)\b/i },
  { name: "Десерты", re: /\b(десерты|десерт|сладкое)\b/i },
];

const isMenuTypeCreateText = (text) => {
  const t = lower(text);
  const wantsCreate = /(создай|создать|добавь|добавить|внеси|внести|сделай|нужно|надо|хочу)/i.test(t);
  const mentionsType = /(тип|типы|раздел|разделы)/i.test(t);
  const mentionsKnownType = MENU_TYPE_ALIASES.some(({ re }) => re.test(t));
  const asksQuestion = /(какие|сколько|покажи|список|есть|что есть)/i.test(t);
  const isProductCommand = /(товар|продукт|позици|блюдо|цена|состав|рецепт|руб|₽)/i.test(t);

  return !asksQuestion && !isProductCommand && mentionsType && (wantsCreate || mentionsKnownType);
};

const isMenuTypeQuestionText = (text) => {
  const t = lower(text);
  return /(какие|сколько|покажи|список|есть|что есть)/i.test(t)
    && /(тип|типы|раздел|разделы)/i.test(t)
    && !/склад/i.test(t);
};

const isMenuCategoryCreateText = (text) => {
  const t = lower(text);
  const wantsCreate = /(создай|создать|добавь|добавить|внеси|внести|сделай|нужно|надо|хочу)/i.test(t);
  const mentionsCategory = /(папк|категор)/i.test(t);
  const asksQuestion = /(какие|сколько|покажи|список|есть|что есть)/i.test(t);
  const isProductCommand = /(товар|продукт|позици|цена|состав|рецепт|руб|₽)/i.test(t);

  return wantsCreate && mentionsCategory && !asksQuestion && !isProductCommand;
};

const isMenuCategoryQuestionText = (text) => {
  const t = lower(text);
  return /(какие|сколько|покажи|список|есть|что есть)/i.test(t)
    && /(папк|категор)/i.test(t)
    && !/склад/i.test(t);
};

const extractMenuTypeNames = (text) => {
  const t = lower(text);
  const found = [];
  MENU_TYPE_ALIASES.forEach(({ name, re }) => {
    if (re.test(t) && !found.includes(name)) found.push(name);
  });

  const quoted = [...String(text || "").matchAll(/[«"“]([^»"”]{2,30})[»"”]/g)]
    .map((m) => m[1].trim())
    .filter(Boolean);
  quoted.forEach((name) => {
    const normalized = name.charAt(0).toUpperCase() + name.slice(1);
    if (!found.some((x) => normalizeName(x) === normalizeName(normalized))) found.push(normalized);
  });

  const afterType = t.match(/(?:тип|типы|раздел|разделы)(?:\s+\w+){0,4}?\s+(?:это|будет|назови|называется)?\s*([^.;!?]+)/i)?.[1] || "";
  if (afterType) {
    afterType
      .replace(/\b(мне|для|меню|менюшки|надо|нужно|пока|что|просто|создай|добавь|и)\b/gi, " ")
      .split(/[,/]+|\s+и\s+/i)
      .map((x) => x.trim())
      .filter((x) => /^[а-яa-z\s-]{2,25}$/i.test(x))
      .forEach((name) => {
        const n = name.replace(/\s+/g, " ").trim();
        if (!n) return;
        const normalized = n.charAt(0).toUpperCase() + n.slice(1);
        if (!found.some((x) => normalizeName(x) === normalizeName(normalized))) found.push(normalized);
      });
  }
  return found;
};

const extractCategoryRequest = (text) => {
  const t = lower(text);
  const category =
    t.match(/(?:папк\w*|категор\w*)\s+([а-яa-z0-9\s-]{2,40}?)(?:\s+в\s+|\s+для\s+|$)/i)?.[1]?.trim() || "";
  const typeName =
    t.match(/(?:в|для)\s+(?:тип\w*\s+)?([а-яa-z0-9\s-]{2,30})/i)?.[1]?.trim() || "";
  return { category, typeName };
};

const isPurchaseText = (text) => {
  if (isMenuCreateText(text)) return false;
  const t = lower(text);
  const isQuestion = /(\?|за\s+сколько|почем|по\s+чем|цена|стоимость|сколько\s+стоил|сколько\s+обош|покажи|список|какие|что есть|остатк)/i.test(t);
  if (isQuestion) return false;
  return /(купил|купила|купили|купи|купить|докупил|докупила|закупил|закупила|взял|взяла|приход|поступил|добавил|добавила)/i.test(t)
    && /\d/i.test(t);
};

const isAffirmativeText = (text) => /^(да|ага|угу|ок|окей|подтверждаю|запиши|сохрани|добавь|верно|правильно)$/i.test(lower(text));
const isNegativeText = (text) => /^(нет|не|отмена|отмени|не надо|не записывай|не сохраняй)$/i.test(lower(text));

const isPurchaseOrderText = (text) => {
  if (isMenuCreateText(text)) return false;
  const t = lower(text);
  if (isPurchaseHistoryQuestionText(text) || isWarehouseListQuestionText(text)) return false;

  const hasQty = /\d+(?:[,.]\d+)?\s*(кг|килограмм\w*|гр|грамм\w*|мл|миллилитр\w*|л\b|литр\w*|шт|штук\w*|шту\w*|бутыл\w*|упак\w*|пач\w*|короб\w*)/i.test(t);
  const hasMoney = /(?:за|цена|стоимость|сумма|обошл\w*)\s*\d+(?:[,.]\d+)?(?:\s*(?:к|тыс|тысяч))?\s*(?:₽|руб\w*|р\b)?/i.test(t)
    || /\d+(?:[,.]\d+)?(?:\s*(?:к|тыс|тысяч))?\s*(?:₽|руб\w*|р\b)/i.test(t);
  const hasPurchaseWord = /(купил|купила|купили|купи|купить|докупил|докупила|закуп|взял|взяла|приход|поступил|добавил|добавила|мой\s+закуп)/i.test(t);

  // Важно: пользователь часто пишет закупку без слова «купил»: «граната 3кг за 500рублей».
  // Это всё равно закупка, а не вопрос к AI-чату. Иначе бот начинает отвечать глупо:
  // «скажи купил гранату...».
  const name = extractPurchaseName(t);
  const hasProductName = Boolean(name && name.length >= 2 && !/^(товар|сырье|сырьё|руб|лей|за)$/i.test(name));

  return hasQty && hasMoney && (hasPurchaseWord || hasProductName);
};

const extractPurchaseOrderParts = (text) => {
  const qtyRe = /\d+(?:[,.]\d+)?\s*(?:кг|килограмм\w*|гр|грамм\w*|мл|миллилитр\w*|л\b|литр\w*|шт|штук\w*|шту\w*|бутыл\w*|упак\w*|пач\w*|короб\w*)/i;
  const moneyRe = /\d+(?:[,.]\d+)?\s*(?:₽|руб\w*|р\b)/i;
  const rawLines = String(text || "")
    .replace(/^(мой\s+закуп|закуп|закупка|приход)\s*[:：-]?/i, "")
    .split(/\n+/)
    .map((line) => normalizeText(line))
    .filter(Boolean);

  const chunks = [];
  for (const line of rawLines) {
    const prepared = line
      .replace(/^(?:и\s+)?так\s*же\s+/i, "")
      .replace(/^также\s+/i, "")
      .replace(/^(?:ещё|еще)\s+/i, "")
      .replace(/\s+(?:и\s+)?так\s*же\s+/gi, " | ")
      .replace(/\s+также\s+/gi, " | ")
      .replace(/\s+(?:ещё|еще)\s+/gi, " | ")
      .replace(/\s*;\s*/g, " | ");
    prepared.split("|").map((x) => x.trim()).filter(Boolean).forEach((x) => chunks.push(x));
  }

  const parts = chunks
    .filter((part) => qtyRe.test(part) && (moneyRe.test(part) || /(?:за|ща)\s*\d/i.test(part)))
    .map((part) => part.replace(/\bща\b/gi, "за"))
    .map((part) => /\b(купил|купила|купили|купи|купить|докупил|закупил|взял|взяла|взяли|добавил|добавила|добавили)\b/i.test(part) ? part : `купил ${part}`);

  return parts.length ? parts : splitPurchaseText(text);
};

const normalizeName = (value) => lower(value).replace(/[^а-яa-z0-9 ]/gi, " ").replace(/\s+/g, " ").trim();


const COMMAND_WORDS = new Set([
  "удали", "удалить", "убери", "убрать", "скрой", "скрыть", "спрячь", "спрятать",
  "сделай", "поставь", "отметь", "верни", "включи", "активируй", "покажи", "снова",
  "активным", "активной", "активные", "активный", "активная",
  "неактивным", "неактивной", "неактивные", "неактивный", "неактивная", "не", "активным", "активной",
  "товар", "товара", "склада", "склад", "из", "его", "ее", "её", "их", "это", "этот", "эту", "эти", "пожалуйста", "говорю", "же", "уже", "их",
  "неактиновй", "неактивно", "неактивной", "неактивным", "актиновй",
]);

const stripCommandWords = (text) => normalizeName(text)
  .split(" ")
  .filter((word) => word && !COMMAND_WORDS.has(word))
  .join(" ")
  .trim();

const isWarehouseVisibilityCommand = (text) => {
  const t = lower(text);
  const wantsHide = /(удали|удалить|убери|убрать|скрой|скрыть|спрячь|спрятать|не\s*актив|неактив|деактив|отключ)/i.test(t);
  const wantsShow = /\b(верни|включи|активируй|сделай\s+актив|сделай\s+активн|покажи\s+снова)\b/i.test(t) && !/(не\s*актив|неактив)/i.test(t);
  return wantsHide || wantsShow;
};

const getVisibilityCommandMode = (text) => {
  const t = lower(text);
  if (/\b(верни|включи|активируй|сделай\s+актив|сделай\s+активн|покажи\s+снова)\b/i.test(t) && !/(не\s*актив|неактив)/i.test(t)) return "show";
  return "hide";
};

const findBestWarehouseItem = (text, list = []) => {
  const cleaned = stripCommandWords(text);
  const needle = cleaned || normalizeName(text);
  if (!needle) return null;

  let best = null;
  let bestScore = 0;

  for (const item of list) {
    const name = normalizeName(item?.name || "");
    if (!name) continue;

    let score = 0;
    if (name === needle) score = 100;
    else if (name.includes(needle) || needle.includes(name)) score = 90;
    else {
      const words = needle.split(" ").filter((x) => x.length >= 2);
      for (const word of words) {
        if (name.includes(word)) score += word.length >= 4 ? 26 : 12;
      }
      const nameWords = name.split(" ").filter((x) => x.length >= 3);
      for (const word of nameWords) {
        if (needle.includes(word)) score += 18;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  return bestScore >= 35 ? best : null;
};

const isPronounOnlyVisibilityCommand = (text) => {
  const cleaned = stripCommandWords(text);
  return cleaned.length === 0 || /^(это|этот|эту|эти|его|ее|её|их|товар)$/i.test(cleaned);
};

const cleanPurchaseText = (text) => {
  let value = normalizeText(text);
  for (let i = 0; i < 4; i += 1) value = value.replace(FILLER_RE, "").trim();
  return value;
};

const stripPurchasePrefix = (text) => cleanPurchaseText(text)
  .replace(PURCHASE_VERB_RE, "")
  .replace(/\b(купил[аи]?|купили|докупил[аи]?|докупили|закупил[аи]?|закупили|взял[аи]?|взяли|добавил[аи]?|добавили|приход|поступил[аи]?)\b/gi, " ")
  .replace(/\s+/g, " ")
  .trim();

const splitPurchaseText = (text) => {
  const cleaned = cleanPurchaseText(text);
  const verb = cleaned.match(PURCHASE_VERB_RE)?.[2] || "купил";
  let body = cleaned
    .replace(/^(?:и\s+)?так\s*же\s+/i, "")
    .replace(/^также\s+/i, "")
    .replace(/^(?:ещё|еще)\s+/i, "")
    .replace(/\s*,\s*/g, " и ")
    .replace(/\s*;\s*/g, " и ")
    .replace(/\s*\+\s*/g, " и ")
    .replace(/\s+(?:и\s+)?так\s*же\s+/gi, " | ")
    .replace(/\s+также\s+/gi, " | ")
    .replace(/\s+(?:ещё|еще)\s+/gi, " | ");

  // Делим только там, где после союза начинается новая покупка/новый товар с количеством.
  body = body.replace(/\s+и\s+(?=(?:я\s+|мы\s+)?(?:купил[аи]?|купили|купи|купить|докупил[аи]?|закупил[аи]?|взял[аи]?|взяли|добавил[аи]?|добавили)\b)/gi, " | ");
  body = body.replace(/\s+и\s+(?=[а-яёa-z][а-яёa-z\s-]{1,40}\s+\d+(?:[,.]\d+)?\s*(?:короб\w*|упак\w*|пач\w*|бутыл\w*|кг|килограмм\w*|гр|грамм\w*|мл|миллилитр\w*|л\b|литр\w*|шт|штук\w*|шту\w*))/gi, " | ");

  const parts = body.split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part
      // Убираем хвосты вида: "а апельсину купил за 350" из части про другой товар.
      .replace(/\s+а\s+[а-яёa-z]{3,}[а-яёa-z\s-]{0,24}?\s+(?:купил[аи]?|купили|купить|купи|взял[аи]?|взяли)?\s*за\s*\d+(?:[,.]\d+)?\s*(?:к|тыс|тысяч)?\s*(?:₽|руб\w*|р\b)?\s*$/i, "")
      .trim())
    .filter(Boolean);

  if (parts.length <= 1) return [cleaned];
  return parts.map((part) => /\b(купил|купила|купили|купи|купить|докупил|закупил|взял|взяла|взяли|добавил|добавила|добавили)\b/i.test(part) ? part : `${verb} ${part}`);
};

const normalizeQuestionText = (questions) => Array.isArray(questions) ? questions.filter(Boolean).join("\n") : "";

const computeWarehouseAmount = (form) => {
  const purchaseQty = num(form.purchaseQuantity || form.quantity);
  const purchaseUnit = form.purchaseUnit || form.unit || "g";
  const storageUnit = form.unit || "g";
  const unitsPerPackage = Math.max(num(form.unitsPerPackage) || 1, 1);
  const basePerUnit = Math.max(num(form.basePerUnit) || 1, 1);

  if (purchaseQty <= 0) return { quantity: 0, unit: storageUnit, unitCost: 0, detail: "" };

  let total = purchaseQty;
  let unit = storageUnit;
  let detail = `${purchaseQty} ${unitLabel(purchaseUnit)}`;

  if (purchaseUnit === "kg") {
    unit = "g";
    total = purchaseQty * 1000;
    detail = `${purchaseQty} кг × 1000 = ${total} г`;
  } else if (purchaseUnit === "l") {
    unit = "ml";
    total = purchaseQty * 1000;
    detail = `${purchaseQty} л × 1000 = ${total} мл`;
  } else if (["g", "ml"].includes(purchaseUnit)) {
    unit = purchaseUnit;
  } else if (purchaseUnit === "pcs") {
    unit = storageUnit;
    if (["g", "ml"].includes(storageUnit) && basePerUnit > 1) {
      total = purchaseQty * basePerUnit;
      detail = `${purchaseQty} шт × ${basePerUnit} ${unitLabel(unit)} = ${total} ${unitLabel(unit)}`;
    } else {
      unit = "pcs";
    }
  } else if (CONTAINER_UNITS.includes(purchaseUnit)) {
    unit = storageUnit;
    total = purchaseQty * unitsPerPackage * basePerUnit;
    detail = `${purchaseQty} ${unitLabel(purchaseUnit)} × ${unitsPerPackage} шт × ${basePerUnit} ${unitLabel(unit)} = ${total} ${unitLabel(unit)}`;
  }

  return { quantity: total, unit, unitCost: total > 0 ? num(form.price) / total : 0, detail };
};

const formFromAIResult = (result) => {
  const unit = result.unit || result.storageUnit || "g";
  return {
    name: normalizeProductEntityName(result.name || ""),
    purchaseQuantity: String(result.purchaseQuantity || result.quantity || ""),
    quantity: String(result.purchaseQuantity || result.quantity || ""),
    purchaseUnit: result.purchaseUnit || unit,
    unit,
    price: result.price ? String(result.price) : "",
    minQuantity: result.minQuantity ? String(result.minQuantity) : "",
    supplier: result.supplier || "",
    expiryDate: result.expiryDate || "",
    note: result.note || "",
    unitsPerPackage: String(result.unitsPerPackage || 1),
    basePerUnit: String(result.basePerUnit || result.packagingQuantity || 1),
    packagingQuantity: String(result.basePerUnit || result.packagingQuantity || 1),
    controlMode: unit === "pcs" ? "piece" : "approximate",
    lossPercent: unit === "ml" ? 5 : unit === "g" ? 3 : 0,
    inventoryMethod: unit === "pcs" ? "fifo" : "average",
  };
};

const payloadFromForm = (sourceForm) => {
  const computed = computeWarehouseAmount(sourceForm);
  const noteParts = [];
  if (String(sourceForm.note || "").trim()) noteParts.push(String(sourceForm.note || "").trim());
  if (computed.detail) noteParts.push(`AI расчёт: ${computed.detail}`);
  const safeName = normalizeProductEntityName(sourceForm.name || "");
  return {
    name: safeName,
    quantity: computed.quantity,
    unit: computed.unit,
    price: num(sourceForm.price),
    minQuantity: num(sourceForm.minQuantity),
    min_quantity: num(sourceForm.minQuantity),
    supplier: String(sourceForm.supplier || "").trim(),
    expiryDate: sourceForm.expiryDate || "",
    expiry_date: sourceForm.expiryDate || "",
    note: noteParts.join(" · "),
    controlMode: sourceForm.controlMode,
    lossPercent: num(sourceForm.lossPercent),
    inventoryMethod: sourceForm.inventoryMethod,
    packagingQuantity: num(sourceForm.basePerUnit || sourceForm.packagingQuantity || 1),
  };
};


const AI_WELCOME_MESSAGE = {
  role: "bot",
  text: "Привет! Я Claude — AI-ассистент твоего бизнеса 👋\n\nМогу помочь со складом, меню, продажами, долгами, расходами. Или просто поговорим — спрашивай что угодно: калорийность, советы по бизнесу, рецепты. Пиши как обычно.",
};

const DEFAULT_SIDE_PANELS = {
  recent: true,
  stocks: true,
  suggestions: true,
};

const SIDE_PANEL_NAMES = {
  recent: "Последние добавления",
  stocks: "Остатки",
  suggestions: "Можно спросить",
};

const normalizeSidePanels = (value) => ({
  ...DEFAULT_SIDE_PANELS,
  ...(value && typeof value === "object" ? value : {}),
});

const resolveSidePanelCommand = (text, lastUIPanel = "") => {
  const t = lower(text);
  const negativeShow = /(не\s+покажи|не\s+показывай|не\s+выводи|не\s+открывай|не\s+ставь)/i.test(t);
  const wantsShow = !negativeShow && /(покажи|показать|выведи|вывести|открой|открыть|добавь|добавить|верни|вернуть|поставь|поставить)/i.test(t);
  const wantsHide = negativeShow || /(убери|убрать|скрой|скрыть|спрячь|спрятать|закрой|закрыть|удали|удалить)/i.test(t);
  const mentionsStocks = /(остатк|остатки|складской\s+остаток|остаток\s+склада)/i.test(t);
  const mentionsRecent = /(последн|добавлен|приход|приходы|поступлен)/i.test(t);
  const mentionsSuggestions = /(можно\s+спросить|подсказк|пример|быстр\w*\s+команд)/i.test(t);
  const pronounOnly = /^(убери|убрать|скрой|скрыть|спрячь|спрятать|закрой|закрыть)\s+(это|его|ее|её|их|блок|панель|карточку)?$/i.test(t);

  let panel = "";
  if (mentionsStocks) panel = "stocks";
  else if (mentionsRecent) panel = "recent";
  else if (mentionsSuggestions) panel = "suggestions";
  else if (pronounOnly && lastUIPanel) panel = lastUIPanel;

  if (!panel) return null;
  if (wantsHide) return { panel, visible: false };
  if (wantsShow || mentionsStocks || mentionsRecent || mentionsSuggestions) return { panel, visible: true };
  return null;
};

const safeJsonParse = (value, fallback = null) => {
  try {
    return JSON.parse(value || "null") ?? fallback;
  } catch {
    return fallback;
  }
};

const getAIChatStorageKey = () => {
  const session = getSession?.() || safeJsonParse(localStorage.getItem("sales_app_session"), {});
  const workspace = getCurrentWorkspace?.() || safeJsonParse(localStorage.getItem("sales_app_workspace"), {});
  const accountId = workspace?.dataAccountId || session?.dataAccountId || workspace?.id || session?.accountId || session?.ownerAccountId;
  // Если accountId нет — используем уникальный ключ "nosession" чтобы не смешивать разные аккаунты
  if (!accountId || accountId === 0) return "sales_app_ai_operator_chat_nosession";
  return `sales_app_ai_operator_chat_${accountId}`;
};

const loadAIChatState = (storageKey) => {
  const empty = {
    messages: [AI_WELCOME_MESSAGE],
    pendingItems: [],
    lastEntity: null,
    pendingVisibility: null,
    pendingMenuTypeCreation: false,
    pendingPurchaseConfirmation: null,
    sidePanels: DEFAULT_SIDE_PANELS,
    lastUIPanel: "",
  };
  if (typeof window === "undefined") return empty;
  const saved = safeJsonParse(localStorage.getItem(storageKey), null);
  if (!saved || typeof saved !== "object") return empty;
  const savedMessages = Array.isArray(saved.messages) && saved.messages.length ? saved.messages : empty.messages;
  const welcomeText = AI_WELCOME_MESSAGE.text;
  const messages = [];
  let hasWelcome = false;
  for (const msg of savedMessages) {
    if (!msg?.text) continue;
    const isWelcome = msg.role === "bot" && msg.text === welcomeText;
    if (isWelcome) {
      if (hasWelcome) continue;
      hasWelcome = true;
    }
    messages.push(msg);
  }
  if (!hasWelcome) messages.unshift(AI_WELCOME_MESSAGE);
  return {
    messages: messages.slice(-80),
    pendingItems: Array.isArray(saved.pendingItems) ? saved.pendingItems : [],
    lastEntity: saved.lastEntity || null,
    pendingVisibility: saved.pendingVisibility || null,
    pendingMenuTypeCreation: Boolean(saved.pendingMenuTypeCreation),
    pendingPurchaseConfirmation: saved.pendingPurchaseConfirmation || null,
    sidePanels: normalizeSidePanels(saved.sidePanels),
    lastUIPanel: saved.lastUIPanel || "",
  };
};

const makeAIHistory = (messages, nextUserText = "") => {
  const history = [...(messages || [])];
  if (nextUserText) history.push({ role: "user", text: nextUserText });
  return history
    .filter((msg) => msg?.text)
    .slice(-18)
    .map((msg) => ({
      role: msg.role === "user" ? "user" : "assistant",
      text: String(msg.text || "").slice(0, 900),
    }));
};



const WORD_SYNONYMS = {
  "молоко": ["молоко", "молаако", "малако", "молока"],
  "яблоки": ["яблоки", "яблок", "яблоко", "яблоки"],
  "стаканчики": ["стаканчики", "стаканчили", "стаканы", "стаканчик", "стаканов", "стаканч"],
  "тарелки": ["тарелки", "тарелок", "тарелка"],
  "масло": ["масло", "масла", "маслло"],
  "рис": ["рис", "риса"],
};

const productAliases = (name = "") => {
  const n = normalizeName(name);
  const words = n.split(" ").filter((x) => x.length >= 3);
  const aliases = new Set([n, ...words]);
  Object.entries(WORD_SYNONYMS).forEach(([key, list]) => {
    if (list.some((x) => n.includes(normalizeName(x)))) {
      aliases.add(key);
      list.forEach((x) => aliases.add(normalizeName(x)));
    }
  });
  return [...aliases].filter(Boolean);
};

const textMentionsProduct = (text, productName) => {
  const t = normalizeName(text);
  return productAliases(productName).some((alias) => alias.length >= 3 && t.includes(alias));
};


const normalizeProductEntityName = (value = "") => {
  const dictionary = {
    "гранату": "гранат", "граната": "гранат", "гранаты": "гранат", "гранатом": "гранат", "гранатовый": "гранат", "гранат": "гранат",
    "апельсина": "апельсин", "апельсину": "апельсин", "апельсины": "апельсин", "апельсином": "апельсин", "апельсин": "апельсин",
    "ананаса": "ананас", "ананасу": "ананас", "ананасы": "ананас", "ананасом": "ананас", "ананас": "ананас",
    "мандарина": "мандарин", "мандарину": "мандарин", "мандарины": "мандарин", "мандарином": "мандарин", "мандарин": "мандарин",
    "андерин": "мандарин", "андерина": "мандарин", "андерину": "мандарин",
    "яблоки": "яблоки", "яблок": "яблоки", "яблока": "яблоки", "яблоко": "яблоки",
    "молока": "молоко", "молоку": "молоко", "молоко": "молоко",
    "зерна": "зерно", "зерно": "зерно",
    "кинзы": "кинза", "кинзу": "кинза", "кинза": "кинза",
    "стаканчиков": "стаканчики", "стаканчики": "стаканчики", "стаканчик": "стаканчики", "стаканы": "стаканчики",
    "сиропа": "сироп", "сиропу": "сироп", "сироп": "сироп",
    "клубники": "клубника", "клубнику": "клубника", "клубника": "клубника",
    "банана": "банан", "бананы": "банан", "банану": "банан", "банан": "банан",
    "лимона": "лимон", "лимоны": "лимон", "лимону": "лимон", "лимон": "лимон",
    "груши": "груша", "грушу": "груша", "груша": "груша",
    "манго": "манго", "киви": "киви",
  };

  let n = normalizeName(value)
    .replace(/\b\d{4}[-./]\d{2}[-./]\d{2}t?\d{0,2}:?\d{0,2}:?\d{0,2}\b/gi, " ")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/gi, " ")
    .replace(/\b(купил|купила|купили|купи|купить|докупил|докупила|докупили|закупил|закупила|закупили|взял|взяла|взяли|добавил|добавила|добавили|приход|поступил|поступила|поступили|мой|закуп|закупка)\b/gi, " ")
    .replace(/\b(руб|рубль|рублей|рубля|р|лей|за|ща|по|цена|цене|стоимость|сумма|обошлось|так|же|также|еще|ещё|и|а|я|мы|мне|нам|он|она|оно|они|его|ее|её|их|это|этот|эта|эту|эти|товар|сырье|сырьё|сколько|почем|чем|какой|какая|какие|посмотри|покажи|в|во|на|из|для|котором|который|которая|которые|упаковка|упаковку|упаковки|пачка|пачку|пачки|бутылка|бутылку|бутылки|коробка|коробку|коробки|примерно|примерный|граммовка|граммовку|одной|один|одна)\b/gi, " ")
    .replace(/\d+(?:[,.]\d+)?\s*(?:кг|килограмм\w*|гр|грамм\w*|мл|миллилитр\w*|л\b|литр\w*|шт|штук\w*|шту\w*|₽|руб\w*|р\b)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = n.split(" ").filter((word) => word.length >= 2);
  if (!words.length) return "";

  const mappedWords = words.map((word) => dictionary[word] || word);
  n = mappedWords.join(" ").trim();

  if (dictionary[n]) return dictionary[n];
  if (/стаканчик/i.test(n) && /кофе/i.test(value)) return "стаканчики для кофе";

  // Если внутри грязной фразы есть один понятный товар, сохраняем только его, а не всю команду.
  // Примеры: "купил гранату" -> "гранат", "купил апельсина" -> "апельсин".
  const knownProductWords = mappedWords.filter((word) => Object.values(dictionary).includes(word));
  const otherWords = mappedWords.filter((word) => !Object.values(dictionary).includes(word));
  if (knownProductWords.length === 1 && otherWords.length <= 2) return knownProductWords[0];

  return n;
};

const productNamePattern = (name = "") => {
  const normalized = normalizeProductEntityName(name);
  const first = normalized.split(" ")[0] || "";
  const root = first.length > 5 ? first.slice(0, Math.max(5, first.length - 2)) : first;
  return root ? `${root}[а-яa-z]*` : "";
};

const extractNumber = (value) => {
  const match = String(value || "").replace(",", ".").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
};

const parseMoneyNumber = (value) => {
  const raw = String(value || "").replace(",", ".").trim().toLowerCase();
  const match = raw.match(/\d+(?:\.\d+)?/);
  if (!match) return 0;
  const amount = Number(match[0]);
  if (!Number.isFinite(amount)) return 0;
  return /\s*(к|тыс|тысяч)/i.test(raw.slice(match[0].length)) ? amount * 1000 : amount;
};

const extractPrice = (text) => {
  const t = lower(text);

  // Самый надёжный вариант — число рядом с руб/₽/р. Берём последнее, чтобы
  // «купил гранату за 5кг за 200 рублей» не превращалось в цену 5.
  const explicitMoney = [...t.matchAll(/(\d+(?:\.\d+)?\s*(?:к|тыс|тысяч)?)(?=\s*(?:₽|руб\w*|р\b))/gi)];
  if (explicitMoney.length) return parseMoneyNumber(explicitMoney[explicitMoney.length - 1][1]);

  // Если рублей не написали: «гранат 2 кг 450». Берём последнее число,
  // которое не является количеством/размером с единицей измерения.
  const afterZa = [...t.matchAll(/(?:за|цена|стоимость|сумма|обошл\w*)\s*(\d+(?:\.\d+)?\s*(?:к|тыс|тысяч)?)(?!\s*(?:кг|килограмм|гр|грамм|мл|миллилитр|л\b|литр|шт|штук|шту))/gi)];
  if (afterZa.length) return parseMoneyNumber(afterZa[afterZa.length - 1][1]);

  const numbers = [...t.matchAll(/\d+(?:\.\d+)?\s*(?:к|тыс|тысяч)?/gi)]
    .filter((m) => {
      const tail = t.slice(m.index + m[0].length, m.index + m[0].length + 16);
      return !/^\s*(?:кг|килограмм|гр|грамм|мл|миллилитр|л\b|литр|шт|штук|шту|короб|упак|пач|бутыл)/i.test(tail);
    });
  return numbers.length ? parseMoneyNumber(numbers[numbers.length - 1][0]) : 0;
};

const extractQuantityAndUnit = (text) => {
  const t = lower(text);
  const m = t.match(/(\d+(?:\.\d+)?)\s*(короб\w*|упак\w*|пач\w*|бутыл\w*|кг|килограмм\w*|гр|грамм\w*|мл|миллилитр\w*|л\b|литр\w*|шт|штук\w*|шту\w*)/i);
  if (!m) return null;
  const value = Number(m[1]);
  const unitText = m[2];
  let purchaseUnit = "pcs";
  let unit = "pcs";
  let basePerUnit = 1;
  if (/кг|килограмм/.test(unitText)) { purchaseUnit = "kg"; unit = "g"; }
  else if (/гр|грамм|\bг\b/.test(unitText)) { purchaseUnit = "g"; unit = "g"; }
  else if (/мл|миллилитр/.test(unitText)) { purchaseUnit = "ml"; unit = "ml"; }
  else if (/л\b|литр/.test(unitText)) { purchaseUnit = "l"; unit = "ml"; }
  else if (/короб/.test(unitText)) purchaseUnit = "box";
  else if (/упак|пач/.test(unitText)) purchaseUnit = "pack";
  else if (/бутыл/.test(unitText)) purchaseUnit = "bottle";
  return { purchaseQuantity: String(value), quantity: String(value), purchaseUnit, unit, basePerUnit: String(basePerUnit) };
};

const extractSize = (text, fallbackUnit = "pcs") => {
  const t = lower(text);
  const m = t.match(/(?:по|кажд\w*|одн\w*)\s*(\d+(?:\.\d+)?)\s*(кг|килограмм\w*|гр|грамм\w*|мл|миллилитр\w*|л\b|литр\w*)/i)
    || t.match(/(\d+(?:\.\d+)?)\s*(кг|килограмм\w*|гр|грамм\w*|мл|миллилитр\w*|л\b|литр\w*)/i);
  if (!m) return null;
  let value = Number(m[1]);
  const unitText = m[2];
  let unit = fallbackUnit;
  if (/кг|килограмм/.test(unitText)) { value *= 1000; unit = "g"; }
  else if (/гр|грамм|\bг\b/.test(unitText)) unit = "g";
  else if (/л\b|литр/.test(unitText)) { value *= 1000; unit = "ml"; }
  else if (/мл|миллилитр/.test(unitText)) unit = "ml";
  return { basePerUnit: String(value), packagingQuantity: String(value), unit };
};

const extractNameNearQuantity = (text) => {
  const t = lower(text);
  const unitRe = "короб\w*|упак\w*|пач\w*|бутыл\w*|кг|килограмм\w*|гр|грамм\w*|мл|миллилитр\w*|л\b|литр\w*|шт|штук\w*|шту\w*";
  const matches = [...t.matchAll(new RegExp(`\d+(?:[,.]\d+)?\s*(?:${unitRe})`, "gi"))];
  if (!matches.length) return "";

  const m = matches[0];
  const before = t.slice(Math.max(0, m.index - 60), m.index).trim();
  const after = t.slice(m.index + m[0].length, m.index + m[0].length + 60).trim();

  const beforeClean = normalizeProductEntityName(before.replace(/.*(?:купил[аи]?|купили|купи|купить|взял[аи]?|взяли|добавил[аи]?|добавили|закупил[аи]?|закупили)\s+/i, ""));
  if (beforeClean && !/^(за|по|руб|лей)$/i.test(beforeClean)) return beforeClean;

  const afterClean = normalizeProductEntityName(after.replace(/\s+(?:за|цена|стоимость|сумма)\s+.*$/i, "").replace(/\s+(?:и|а|также|так\s+же)\s+.*$/i, ""));
  if (afterClean) return afterClean;
  return "";
};

const extractPurchaseName = (text) => {
  const near = extractNameNearQuantity(text);
  if (near) return near;

  let t = lower(text);

  // Удаляем деньги целиком, включая варианты без пробела: 500рублей, 500р, 5к, 5 тыс.
  t = t.replace(/(?:за|цена|стоимость|сумма|обошл\w*)?\s*\d+(?:\.\d+)?\s*(?:к|тыс|тысяч)?\s*(?:₽|руб\w*|р\b)/gi, " ");

  // Удаляем количество/единицы: 5кг, 4 кг, 250мл, 5шт.
  t = t.replace(/\d+(?:\.\d+)?\s*(?:короб\w*|упак\w*|пач\w*|бутыл\w*|кг|килограмм\w*|гр|грамм\w*|мл|миллилитр\w*|л\b|литр\w*|шт|штук\w*|шту\w*)/gi, " ");

  // Сохраняем важные уточнения: "для кофе" у стаканчиков.
  const hasCoffee = /кофе/i.test(t);

  t = t.replace(/\b(я|мы|мне|за|по|и|а|так|же|также|еще|ещё|короче|ну|купил[аи]?|купили|купи|купить|докупил[аи]?|докупили|закупил[аи]?|закупили|взял[аи]?|взяли|добавил[аи]?|добавили|приход|поступил[аи]?|товар|сырье|сырьё|руб|рублей|рубля|лей|р|в|во|на|из|котором|который|которая|упаковка|упаковку|упаковки|пачка|пачку|пачки|бутылка|бутылку|бутылки|коробка|коробку|коробки)\b/gi, " ");

  let name = normalizeProductEntityName(t);
  if (/стаканчик/i.test(name) && hasCoffee) name = "стаканчики для кофе";
  return name;
};

const localPurchaseOverrides = (text) => {
  const name = extractPurchaseName(text);
  const qty = extractQuantityAndUnit(text);
  const size = extractSize(text, qty?.unit || "pcs");
  const price = extractPrice(text);
  return { name, qty, size, price };
};


const PURCHASE_STOP_WORD_RE = /\b(мой|закуп|закупка|приход|купил|купила|купили|купи|купить|докупил|докупила|докупили|закупил|закупила|закупили|взял|взяла|взяли|добавил|добавила|добавили|товар|сырье|сырьё|за|ща|по|цене|цена|стоимость|сумма|руб|рублей|рубля|рубль|р|лей|и|а|так|же|также|еще|ещё|ну|короче|мне|нам|я|мы)\b/gi;

const normalizePurchaseUnitText = (unitText = "") => {
  const u = lower(unitText);
  if (/кг|килограмм/.test(u)) return { purchaseUnit: "kg", unit: "g" };
  if (/гр|грамм|\bг\b/.test(u)) return { purchaseUnit: "g", unit: "g" };
  if (/мл|миллилитр/.test(u)) return { purchaseUnit: "ml", unit: "ml" };
  if (/л\b|литр/.test(u)) return { purchaseUnit: "l", unit: "ml" };
  if (/бутыл/.test(u)) return { purchaseUnit: "bottle", unit: "pcs" };
  if (/упак|пач/.test(u)) return { purchaseUnit: "pack", unit: "pcs" };
  if (/короб/.test(u)) return { purchaseUnit: "box", unit: "pcs" };
  return { purchaseUnit: "pcs", unit: "pcs" };
};

const cleanPurchaseItemName = (value = "") => {
  const hasCoffee = /кофе/i.test(value);
  let text = lower(value)
    .replace(/\bща\b/gi, "за")
    .replace(/\b\d{4}[-./]\d{2}[-./]\d{2}t?\d{0,2}:?\d{0,2}:?\d{0,2}\b/gi, " ")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/gi, " ")
    .replace(/\d+(?:[,.]\d+)?\s*(?:₽|руб\w*|р\b)/gi, " ")
    .replace(/\d+(?:[,.]\d+)?\s*(?:кг|килограмм\w*|гр|грамм\w*|мл|миллилитр\w*|л\b|литр\w*|шт|штук\w*|шту\w*|бутыл\w*|упак\w*|пач\w*|короб\w*)/gi, " ")
    .replace(PURCHASE_STOP_WORD_RE, " ")
    .replace(/\b(в|во|на|из|для|котором|который|которая|которые|одной|один|примерно|примерный|граммовк\w*)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  text = normalizeProductEntityName(text)
    .replace(/\b(купил|купила|купили|купи|купить|руб|рублей|лей|за|ща)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (/стаканчик/i.test(text) && hasCoffee) return "стаканчики для кофе";
  return text;
};

const parsePurchaseLineLocally = (textPart, fullText = textPart) => {
  const original = normalizeText(textPart)
    .replace(/\bща\b/gi, "за")
    .replace(/\s+/g, " ")
    .trim();

  const qtyMatch = original.match(/(\d+(?:[,.]\d+)?)\s*(кг|килограмм\w*|гр|грамм\w*|мл|миллилитр\w*|л\b|литр\w*|шт|штук\w*|шту\w*|бутыл\w*|упак\w*|пач\w*|короб\w*)/i);
  const price = extractPrice(original) || extractPrice(String(fullText || "").replace(/\bща\b/gi, "за"));

  if (!qtyMatch) return null;

  const purchaseQuantity = Number(String(qtyMatch[1]).replace(",", "."));
  const unitText = qtyMatch[2];
  const units = normalizePurchaseUnitText(unitText);
  const beforeQty = original.slice(0, qtyMatch.index).trim();
  const afterQty = original.slice(qtyMatch.index + qtyMatch[0].length).trim();

  let name = cleanPurchaseItemName(beforeQty.replace(/.*\b(купил[аи]?|купили|купи|купить|взял[аи]?|взяли|добавил[аи]?|добавили|закупил[аи]?|закупили)\s+/i, ""));
  if (!name) name = cleanPurchaseItemName(afterQty.replace(/\b(?:за|цена|стоимость|сумма)\b.*$/i, ""));
  if (!name) name = cleanPurchaseItemName(original);

  name = normalizeProductEntityName(name);
  if (!name || /\b(купил|купила|купили|купи|купить|руб|рублей|лей|за|ща)\b/i.test(name)) {
    name = cleanPurchaseItemName(original);
  }

  const size = extractSize(original, units.unit);
  const form = {
    name,
    purchaseQuantity: String(purchaseQuantity || ""),
    quantity: String(purchaseQuantity || ""),
    purchaseUnit: units.purchaseUnit,
    unit: units.unit,
    price: price ? String(price) : "",
    minQuantity: "",
    supplier: "",
    expiryDate: "",
    note: "",
    unitsPerPackage: "1",
    basePerUnit: String(size?.basePerUnit || 1),
    packagingQuantity: String(size?.packagingQuantity || 1),
    controlMode: units.unit === "pcs" ? "piece" : "approximate",
    lossPercent: units.unit === "ml" ? 5 : units.unit === "g" ? 3 : 0,
    inventoryMethod: units.unit === "pcs" ? "fifo" : "average",
  };

  const shouldAskWeight = units.purchaseUnit === "pcs"
    && !size?.basePerUnit
    && !/(стаканчик|стакан|тарелк|ложк|вилк|салфет|пакет|крышк|трубоч|бутыл|упаков|короб|пачк)/i.test(name);

  if (shouldAskWeight) {
    form.unit = "g";
    form.basePerUnit = "";
    form.packagingQuantity = "";
  }

  const payload = payloadFromForm(form);
  const computed = computeWarehouseAmount(form);
  const questions = [];
  if (!form.name) questions.push("Как называется товар?");
  if (!form.price || num(form.price) <= 0) questions.push(`За сколько купили «${form.name || "товар"}»?`);
  if (shouldAskWeight) questions.push(`Сколько примерно грамм в 1 шт товара «${form.name}»? Например: “1 шт примерно 900г”.`);

  return {
    originalText: original,
    result: { name: form.name, questions },
    form,
    payload,
    questions,
    computed,
    matched: null,
    needsUnitWeight: shouldAskWeight,
  };
};

const parsePurchaseLinesLocally = (parts = [], fullText = "") => parts
  .map((part) => parsePurchaseLineLocally(part, fullText || part))
  .filter(Boolean);


const extractPriceForProduct = (fullText, productName) => {
  const t = lower(fullText);
  const pattern = productNamePattern(productName);
  if (!pattern) return 0;
  const money = "(\\d+(?:\\.\\d+)?\\s*(?:к|тыс|тысяч)?)(?=\\s*(?:₽|руб\\w*|р\\b))";
  const checks = [
    new RegExp(`${pattern}[^.;!?]{0,80}?(?:за|цена|стоимость|сумма)\\s*${money}`, "i"),
    new RegExp(`${pattern}[^.;!?]{0,80}?${money}`, "i"),
    new RegExp(`(?:за|цена|стоимость|сумма)\\s*${money}[^.;!?]{0,80}?${pattern}`, "i"),
    new RegExp(`${money}[^.;!?]{0,80}?${pattern}`, "i"),
  ];
  for (const re of checks) {
    const match = t.match(re);
    if (match) {
      const pricePart = [...match].find((x) => /\d/.test(String(x || "")) && !String(x).includes(productName));
      const price = parseMoneyNumber(pricePart || match[1]);
      if (price > 0) return price;
    }
  }
  return 0;
};

const isWarehouseListQuestionText = (text) => {
  const t = lower(text);
  if (/(не\s+покажи|не\s+показывай|убери|скрой|скрыть|закрой|спрячь)/i.test(t)) return false;
  return /(покажи|показать|список|какие|что есть|все|остатк)/i.test(t) && /(склад|товар|сырье|сырьё|остатк)/i.test(t);
};

const isPurchaseHistoryQuestionText = (text) => {
  const t = lower(text);
  return /(за\s+сколько|почем|по\s+чем|цена|стоимость|сколько\s+стоил|сколько\s+обош)/i.test(t)
    && /(купил|купила|купили|закуп|брал|взял|приход|товар|склад|сырье|сырьё)/i.test(t);
};

const needsPieceWeightForRecipe = (form) => {
  const name = normalizeProductEntityName(form?.name || "");
  if (!name) return false;
  if ((form.purchaseUnit || form.unit) !== "pcs") return false;
  if (num(form.basePerUnit || form.packagingQuantity) > 1 && ["g", "ml"].includes(form.unit)) return false;
  if (/(стакан|тарел|пакет|пакетик|салфет|крышк|ложк|вилк|трубоч|упаков|короб|бутыл|банка)/i.test(name)) return false;
  return /(ананас|банан|апельсин|гранат|яблок|груш|лимон|лайм|персик|манго|киви|авокадо|арбуз|дыня|клубник|малина|ягод|овощ|помидор|огур|кинза|мята|зелень)/i.test(name);
};

const applyLocalPurchaseOverrides = (parsed, text) => {
  const local = localPurchaseOverrides(text);
  const form = { ...(parsed.form || {}) };

  form.name = normalizeProductEntityName(form.name || "");

  if (local.name && local.name.length >= 2) {
    const current = normalizeName(form.name);
    const currentLooksBad =
      !current ||
      current.length < 3 ||
      /^(товар|сырье|сырьё)$/i.test(current) ||
      /(купил|купила|купили|купи|купить|докупил|закупил|взял|взяла|руб|лей|также|так\s+же|^с\s+анчики|^кин$)/i.test(current);

    const localLooksClean =
      !/(купил|купила|купили|купи|купить|докупил|закупил|взял|взяла|руб|рублей|лей|также|так\s+же|сколько|почем)/i.test(local.name);

    // Для закупок локально вытащенное имя из части строки всегда безопаснее:
    // "так же купил апельсины 3кг за 200р" => "апельсин",
    // а не "купил так же купил апельсин".
    if (localLooksClean && (currentLooksBad || local.name.split(" ").length <= Math.max(3, current.split(" ").length + 1))) {
      form.name = local.name;
    }
  }

  form.name = normalizeProductEntityName(form.name || local.name || "");
  if (/(купил|купила|купили|купи|купить|докупил|закупил|взял|взяла|также|так\s+же|руб|рублей|лей)/i.test(form.name) && local.name) {
    form.name = normalizeProductEntityName(local.name);
  }
  if (local.qty) {
    form.purchaseQuantity = local.qty.purchaseQuantity;
    form.quantity = local.qty.quantity;
    form.purchaseUnit = local.qty.purchaseUnit;
    form.unit = local.qty.unit;
  }
  if (local.size?.basePerUnit && !textMentionsProduct(form.name, "стаканчики")) {
    form.basePerUnit = local.size.basePerUnit;
    form.packagingQuantity = local.size.packagingQuantity;
    form.unit = local.size.unit;
  }
  if (local.price > 0) form.price = String(local.price);

  const payload = payloadFromForm(form);
  const computed = computeWarehouseAmount(form);
  const questions = [];
  if (!form.name) questions.push("Как называется товар?");
  if (!form.purchaseQuantity && !form.quantity) questions.push(`Сколько купили товара «${form.name || "товар"}»?`);
  if (!form.price || num(form.price) <= 0) questions.push(`За сколько купили «${form.name || "товар"}»?`);
  if (needsPieceWeightForRecipe(form)) questions.push(`Сколько примерно грамм в 1 шт товара «${form.name}»? Например: “1 шт примерно 900г”.`);

  return {
    ...parsed,
    form,
    payload,
    computed,
    questions,
    result: { ...(parsed.result || {}), name: form.name, questions },
  };
};

const extractRelevantClarification = (reply, pending, pendingCount) => {
  const raw = normalizeText(reply);
  const name = pending?.result?.name || pending?.payload?.name || pending?.form?.name || "";
  if (pendingCount <= 1) return raw;

  const aliases = productAliases(name);
  const chunks = raw
    .replace(/\s*,\s*/g, " | ")
    .replace(/\s*;\s*/g, " | ")
    .replace(/\s+(а\s+)?(еще|ещё|так\s*же|также)\s+/gi, " | ")
    .replace(/\s+а\s+(?=[а-яa-z])/gi, " | ")
    .replace(/\s+и\s+(?=[а-яa-z])/gi, " | ")
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean);
  const found = chunks.find((chunk) => aliases.some((alias) => normalizeName(chunk).includes(alias)));
  return found || "";
};

const mergeClarificationLocally = (pending, clarification) => {
  const form = { ...(pending.form || {}) };
  const raw = normalizeText(clarification);
  if (!raw) return { changed: false, parsed: { ...pending, form } };

  const productName = pending?.result?.name || pending?.payload?.name || form.name || "товар";
  if (textMentionsProduct(raw, "стаканчики") || textMentionsProduct(productName, "стаканчики")) {
    const size = extractSize(raw, "pcs");
    const price = extractPrice(raw);
    form.name = /кофе/i.test(raw) || /кофе/i.test(form.name || "") ? "стаканчики для кофе 250мл" : (form.name || "стаканчики");
    if (size?.basePerUnit) {
      const ml = Number(size.basePerUnit);
      form.name = /кофе/i.test(raw) ? `стаканчики для кофе ${ml}мл` : `стаканчики ${ml}мл`;
    }
    form.unit = "pcs";
    form.purchaseUnit = "pcs";
    form.basePerUnit = "1";
    form.packagingQuantity = "1";
    if (price) form.price = String(price);
  }

  const size = extractSize(raw, form.unit);
  const isPieceWeightClarification = form.purchaseUnit === "pcs" && size && ["g", "ml"].includes(size.unit) && !/(купил|купила|купили|взял|взяла|добавил)/i.test(raw);
  const qty = isPieceWeightClarification ? null : extractQuantityAndUnit(raw);
  if (qty) {
    form.purchaseQuantity = qty.purchaseQuantity;
    form.quantity = qty.quantity;
    form.purchaseUnit = qty.purchaseUnit;
    form.unit = qty.unit;
  }

  if (size && !textMentionsProduct(productName, "стаканчики")) {
    form.basePerUnit = size.basePerUnit;
    form.packagingQuantity = size.packagingQuantity;
    form.unit = size.unit;
  }

  const price = extractPrice(raw);
  if (price) form.price = String(price);

  // Если пользователь написал просто “за 200”, оставляем старое количество/размер и закрываем только цену.
  const payload = payloadFromForm(form);
  const computed = computeWarehouseAmount(form);
  const questions = [];
  if (!form.purchaseQuantity && !form.quantity) questions.push(`Сколько купили товара «${productName}»?`);
  if (!form.price || num(form.price) <= 0) questions.push(`За сколько купили «${productName}»?`);
  if (["pack", "box", "bottle"].includes(form.purchaseUnit) && (!form.basePerUnit || num(form.basePerUnit) <= 1)) {
    questions.push(`Какой размер одной упаковки товара «${productName}»?`);
  }

  return {
    changed: raw.length > 0,
    parsed: {
      ...pending,
      form,
      payload,
      computed,
      questions,
      result: { ...(pending.result || {}), name: form.name || productName, questions },
    },
  };
};

const shortQuestionForPending = (pending) => {
  const name = pending?.result?.name || pending?.name || "товар";
  const questions = normalizeQuestionText(pending?.questions || pending?.result?.questions);
  if (questions) return questions;
  const form = pending?.form || {};
  if (!form.purchaseQuantity) return `Сколько купили товара «${name}»?`;
  if (!form.price) return `За сколько купили «${name}»?`;
  return `Уточни данные по товару «${name}».`;
};

function Message({ msg }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex gap-2 sm:gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && <div className="mt-1 hidden h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-sm shadow-lg shadow-blue-600/30 sm:flex">🤖</div>}
      <div className={`max-w-[90%] rounded-3xl px-4 py-3 text-[13px] font-bold leading-6 shadow-lg sm:max-w-[78%] ${isUser ? "bg-gradient-to-br from-blue-600 to-violet-600 text-white" : "bg-white text-slate-900"}`}>
        <p className="whitespace-pre-line">{msg.text}</p>
        {msg.cards?.length > 0 && (
          <div className="mt-3 space-y-2">
            {msg.cards.map((card, i) => (
              <div key={i} className="rounded-2xl bg-slate-100 p-3 text-slate-900">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-black">{card.name}</p>
                    <p className="text-xs font-bold text-slate-500">{card.detail}</p>
                  </div>
                  <span className="shrink-0 rounded-2xl bg-emerald-100 px-3 py-2 text-xs font-black text-emerald-700">+{card.qty}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AIWarehousePage() {
  const [items, setItems] = useState([]);
  const [movements, setMovements] = useState([]);
  const [menuProducts, setMenuProducts] = useState([]);
  const [productTypes, setProductTypes] = useState([]);
  const [productCategories, setProductCategories] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const storageKey = useMemo(() => getAIChatStorageKey(), []);
  const restoredChat = useMemo(() => loadAIChatState(storageKey), [storageKey]);
  const [pendingItems, setPendingItems] = useState(restoredChat.pendingItems);
  const [lastEntity, setLastEntity] = useState(restoredChat.lastEntity);
  const [pendingVisibility, setPendingVisibility] = useState(restoredChat.pendingVisibility);
  const [pendingMenuTypeCreation, setPendingMenuTypeCreation] = useState(restoredChat.pendingMenuTypeCreation);
  const [pendingPurchaseConfirmation, setPendingPurchaseConfirmation] = useState(restoredChat.pendingPurchaseConfirmation);
  const [sidePanels, setSidePanels] = useState(normalizeSidePanels(restoredChat.sidePanels));
  const [lastUIPanel, setLastUIPanel] = useState(restoredChat.lastUIPanel || "");
  const [messages, setMessages] = useState(restoredChat.messages);
  const [aiBrain, setAIBrain] = useState({
    currentTopic: "",
    lastIntent: "",
    lastEntities: [],
    mood: "normal",
    interrupted: false,
    lastAction: "",
    recentContext: [],
  });

  // Safe array guards
  const safe_items = Array.isArray(items) ? items : [];
  const safe_movements = Array.isArray(movements) ? movements : [];
  const safe_menuProducts = Array.isArray(menuProducts) ? menuProducts : [];
  const safe_productTypes = Array.isArray(productTypes) ? productTypes : [];
  const safe_productCategories = Array.isArray(productCategories) ? productCategories : [];
  const bottomRef = useRef(null);
  const messagesRef = useRef(null);

  const load = async () => {
    // Не запускаем 5 запросов к SQLite одновременно.
    // В dev/docker режиме это иногда давало net::ERR_CONNECTION_RESET,
    // потому что backend закрывал соединение при резком параллельном чтении.
    const safeGet = async (url) => {
      try {
        const result = await get(url);
        return Array.isArray(result) ? result : [];
      } catch {
        return [];
      }
    };

    const warehouseList = await safeGet("/warehouse/items");
    const movementList = await safeGet("/warehouse/movements");
    const products = await safeGet("/menu-products");
    const types = await safeGet("/product-types");
    const categories = await safeGet("/product-categories");

    setItems(warehouseList);
    setMovements(movementList);
    setMenuProducts(products);
    setProductTypes(types);
    setProductCategories(categories);
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        messages: messages.slice(-80),
        pendingItems,
        lastEntity,
        pendingVisibility,
        pendingMenuTypeCreation,
        pendingPurchaseConfirmation,
        sidePanels,
        lastUIPanel,
        aiBrain,
        savedAt: new Date().toISOString(),
      }));
    } catch {
      // localStorage может быть недоступен в приватном режиме — чат всё равно работает в памяти страницы.
    }
  }, [storageKey, messages, pendingItems, lastEntity, pendingVisibility, pendingMenuTypeCreation, pendingPurchaseConfirmation, sidePanels, lastUIPanel]);

  useEffect(() => {
    const box = messagesRef.current;
    if (!box) return;
    box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const recentAdded = useMemo(() => safe_movements.filter((m) => String(m.movementType || m.movement_type) === "in").slice(0, 5), [movements]);
  const topItems = useMemo(() => [...items].filter((x) => !(x.hidden || x.isHidden || x.is_hidden)).sort((a, b) => num(b.quantity) - num(a.quantity)).slice(0, 7), [items]);
  const activeRightPanels = useMemo(() => Object.values(sidePanels).filter(Boolean).length, [sidePanels]);
  const rightPanelRows = useMemo(() => [
    sidePanels.recent ? "minmax(0,1fr)" : null,
    sidePanels.stocks ? "auto" : null,
    sidePanels.suggestions ? "auto" : null,
  ].filter(Boolean).join(" ") || "auto", [sidePanels]);

  const itemRefs = (list = items) => list.map((item) => ({
    id: item.id,
    name: item.name,
    unit: item.unit,
    quantity: item.quantity,
    unitCost: item.unitCost ?? item.unit_cost ?? 0,
    packagingQuantity: item.packagingQuantity ?? item.packaging_quantity ?? 0,
    note: item.note || "",
  }));

  const parsePurchase = async (textPart, currentItems, fullText = textPart) => {
    const result = await post("/ai/warehouse/parse", { text: textPart, items: itemRefs(currentItems) });
    const form = formFromAIResult(result);
    const payload = payloadFromForm(form);
    const questions = result.questions || [];
    const computed = computeWarehouseAmount(form);
    const matched = result.matchedItemId
      ? currentItems.find((item) => Number(item.id) === Number(result.matchedItemId))
      : currentItems.find((item) => normalizeName(item.name) === normalizeName(payload.name));

    let parsed = applyLocalPurchaseOverrides({ originalText: textPart, result, form, payload, questions, computed, matched }, textPart);
    const cleanPayloadName = normalizeProductEntityName(parsed.payload?.name || parsed.form?.name || parsed.result?.name || "");
    const exactMatched = currentItems.find((item) => normalizeProductEntityName(item.name || "") === cleanPayloadName);
    const currentMatchedName = normalizeProductEntityName(parsed.matched?.name || "");
    const matchedLooksDirty = /(купил|купи|руб|лей|также|так же|^с\s+анчики|^кин$)/i.test(parsed.matched?.name || "");
    if (exactMatched) parsed = { ...parsed, matched: exactMatched };
    else if (parsed.matched && (matchedLooksDirty || (cleanPayloadName && currentMatchedName !== cleanPayloadName && !currentMatchedName.includes(cleanPayloadName)))) parsed = { ...parsed, matched: null };
    const name = parsed.payload?.name || parsed.form?.name || parsed.result?.name || "";
    const delayedPrice = extractPriceForProduct(fullText, name);
    if ((!parsed.form.price || num(parsed.form.price) <= 0 || num(parsed.form.price) === num(parsed.form.purchaseQuantity || parsed.form.quantity)) && delayedPrice > 0) {
      const fixedForm = { ...parsed.form, price: String(delayedPrice) };
      return {
        ...parsed,
        form: fixedForm,
        payload: payloadFromForm(fixedForm),
        computed: computeWarehouseAmount(fixedForm),
        questions: (parsed.questions || []).filter((q) => !/за сколько|цен|стоим/i.test(q)),
        result: { ...(parsed.result || {}), questions: (parsed.questions || []).filter((q) => !/за сколько|цен|стоим/i.test(q)) },
      };
    }
    return parsed;
  };

  const parseLocalPurchaseParts = (parts, currentItems = items, fullText = "") => parsePurchaseLinesLocally(parts, fullText).map((parsed) => {
    const matched = currentItems.find((item) => normalizeProductEntityName(item.name || "") === normalizeProductEntityName(parsed.payload.name || ""));
    return { ...parsed, matched };
  });

  const saveParsedPurchasesBatch = async (parsedList = []) => {
    const saved = [];
    let workingItems = [...items];

    for (const parsed of parsedList) {
      const matched = parsed.matched || workingItems.find((item) => normalizeName(item.name) === normalizeName(parsed.payload.name));
      const prepared = { ...parsed, matched };
      const one = await saveParsedPurchase(prepared);
      saved.push(one);
      workingItems = await get("/warehouse/items").catch(() => workingItems) || workingItems;
    }

    const expense = await savePurchaseExpense(saved);
    const lines = saved.map((x) => `${x.matched ? "прибавила к" : "создала"} “${normalizeProductEntityName(x.matched?.name || x.payload.name)}” — ${x.computed.quantity} ${unitLabel(x.computed.unit)} за ${formatMoney(x.payload.price)}`).join("\n");
    setMessages((p) => [...p, {
      role: "bot",
      text: `Готово.\n${lines}${expense ? `\n\nВ расходы записала закупку сырья: ${formatMoney(expense.total)}.` : ""}`,
      cards: saved.map((x) => x.card),
    }]);
    await load();
  };

  const handleLocalPurchaseParts = async (parts, currentItems = items, fullText = "") => {
    const parsedList = parseLocalPurchaseParts(parts, currentItems, fullText || parts.join("\n"));
    if (!parsedList.length) {
      await handlePurchaseParts(parts, currentItems, [], fullText);
      return;
    }

    const ready = [];
    const waiting = [];
    for (const parsed of parsedList) {
      if (canSavePurchase(parsed)) ready.push(parsed);
      else waiting.push(parsed);
    }

    if (waiting.length) {
      const saved = [];
      let workingItems = [...currentItems];
      for (const parsed of ready) {
        const matched = parsed.matched || workingItems.find((item) => normalizeProductEntityName(item.name || "") === normalizeProductEntityName(parsed.payload.name || ""));
        const one = await saveParsedPurchase({ ...parsed, matched });
        saved.push(one);
        workingItems = await get("/warehouse/items").catch(() => workingItems) || workingItems;
      }
      if (saved.length) await savePurchaseExpense(saved);

      setPendingItems(waiting.map((x) => ({
        ...x,
        form: { ...x.form, name: normalizeProductEntityName(x.form?.name || x.payload?.name || x.result?.name || "") },
        payload: payloadFromForm({ ...x.form, name: normalizeProductEntityName(x.form?.name || x.payload?.name || x.result?.name || "") }),
        result: { ...(x.result || {}), name: normalizeProductEntityName(x.form?.name || x.payload?.name || x.result?.name || "") },
      })));

      const savedText = saved.length
        ? `Сохранила понятные позиции:\n${saved.map((x) => `• ${x.matched?.name || x.payload.name} — ${x.computed.quantity} ${unitLabel(x.computed.unit)} за ${formatMoney(x.payload.price)}`).join("\n")}\n\n`
        : "";
      const questions = waiting.map((p, i) => `${i + 1}) ${shortQuestionForPending({ ...p, result: { ...(p.result || {}), name: normalizeProductEntityName(p.form?.name || p.payload?.name || p.result?.name || "") } })}`).join("\n");
      setMessages((p) => [...p, {
        role: "bot",
        text: `${savedText}Нужно уточнить только это:\n${questions}`,
      }]);
      await load();
      return;
    }

    await saveParsedPurchasesBatch(ready);
  };

  const canSavePurchase = (parsed) => {
    if (normalizeQuestionText(parsed.questions)) return false;
    if (!parsed.payload.name || num(parsed.payload.quantity) <= 0) return false;
    if (num(parsed.payload.price) <= 0) return false;
    return true;
  };

  const saveParsedPurchase = async (parsed) => {
    const safeName = normalizeProductEntityName(parsed.payload?.name || parsed.form?.name || parsed.result?.name || "");
    const safePayload = { ...(parsed.payload || {}), name: safeName };
    const safeMatched = parsed.matched && !/(^|\s)(купил|купила|купили|купи|купить)(\s|$)/i.test(parsed.matched.name || "")
      ? parsed.matched
      : null;
    let savedItem = safeMatched;
    if (safeMatched) await post(`/warehouse/items/${safeMatched.id}/purchase`, safePayload);
    else savedItem = await post("/warehouse/items", safePayload);
    if (savedItem?.id) setLastEntity({ type: "warehouse_item", id: savedItem.id, name: normalizeProductEntityName(savedItem.name || safePayload.name), item: savedItem });
    return {
      ...parsed,
      payload: safePayload,
      matched: safeMatched,
      card: {
        name: normalizeProductEntityName(safeMatched?.name || safePayload.name),
        detail: `${parsed.computed.detail}${num(safePayload.price) > 0 ? ` · ${formatMoney(safePayload.price)}` : ""}`,
        qty: `${parsed.computed.quantity} ${unitLabel(parsed.computed.unit)}`,
      },
    };
  };

  const savePurchaseExpense = async (savedPurchases) => {
    const priced = (savedPurchases || []).filter((x) => num(x?.payload?.price) > 0);
    if (!priced.length) return null;
    const total = priced.reduce((sum, x) => sum + num(x.payload.price), 0);
    if (total <= 0) return null;
    const comment = priced
      .map((x) => `${normalizeProductEntityName(x.matched?.name || x.payload.name)}: ${formatMoney(x.payload.price)}; ${x.computed.quantity} ${unitLabel(x.computed.unit)}${x.computed.detail ? ` (${x.computed.detail})` : ""}`)
      .join(" | ");
    await post("/global-expenses", {
      category: "products",
      type: "Закупка сырья",
      name: priced.length === 1 ? `Закупка: ${normalizeProductEntityName(priced[0].matched?.name || priced[0].payload.name)}` : "Закупка сырья",
      amount: total,
      comment,
    });
    return { total, comment };
  };

  const handlePurchaseParts = async (parts, currentItems = items, alreadySaved = [], fullText = "") => {
    const saved = [...alreadySaved];
    const waiting = [];
    let workingItems = [...currentItems];

    for (const part of parts) {
      const parsed = await parsePurchase(part, workingItems, fullText || parts.join(" и "));
      if (canSavePurchase(parsed)) {
        const one = await saveParsedPurchase(parsed);
        saved.push(one);
        workingItems = await get("/warehouse/items").catch(() => workingItems) || workingItems;
      } else {
        waiting.push(parsed);
      }
    }

    if (waiting.length) {
      setPendingItems(waiting);
      const savedText = saved.length
        ? `Сохранила понятные позиции:\n${saved.map((x) => `• ${x.matched?.name || x.payload.name} — ${x.computed.quantity} ${unitLabel(x.computed.unit)}${num(x.payload?.price) > 0 ? ` за ${formatMoney(x.payload.price)}` : ""}`).join("\n")}\n\n`
        : "";
      const questions = waiting.map((p, i) => `${i + 1}) ${shortQuestionForPending(p)}`).join("\n");
      setMessages((p) => [...p, {
        role: "bot",
        text: `${savedText}Нужно уточнить только эти позиции:\n${questions}\n\nОтветь одним сообщением, можно сразу по всем: “стаканчики 250мл за 200, яблоки за 200”.`,
      }]);
      await load();
      return;
    }

    setPendingItems([]);
    const expense = await savePurchaseExpense(saved);
    const lines = saved.map((x) => `${x.matched ? "прибавила к" : "создала"} “${normalizeProductEntityName(x.matched?.name || x.payload.name)}” — ${x.computed.quantity} ${unitLabel(x.computed.unit)} за ${formatMoney(x.payload.price)}`).join("\n");
    setMessages((p) => [...p, {
      role: "bot",
      text: `Готово.\n${lines}${expense ? `\n\nВ расходы записала закупку сырья: ${formatMoney(expense.total)}.` : ""}`,
      cards: saved.map((x) => x.card),
    }]);
    await load();
  };

  const updatePendingPurchases = async (replyText) => {
    const waiting = [...pendingItems];
    const saved = [];
    const stillWaiting = [];
    let workingItems = [...items];

    for (const pending of waiting) {
      const relevant = extractRelevantClarification(replyText, pending, waiting.length);

      if (pending.needsUnitWeight) {
        const raw = relevant || replyText;
        const size = extractSize(raw, "g");
        if (size?.basePerUnit && num(size.basePerUnit) > 0) {
          const fixedForm = {
            ...(pending.form || {}),
            unit: "g",
            purchaseUnit: "pcs",
            basePerUnit: String(size.basePerUnit),
            packagingQuantity: String(size.basePerUnit),
          };
          const candidate = {
            ...pending,
            needsUnitWeight: false,
            form: fixedForm,
            payload: payloadFromForm(fixedForm),
            computed: computeWarehouseAmount(fixedForm),
            questions: [],
            result: { ...(pending.result || {}), questions: [] },
          };
          if (canSavePurchase(candidate)) {
            const one = await saveParsedPurchase(candidate);
            saved.push(one);
            workingItems = await get("/warehouse/items").catch(() => workingItems) || workingItems;
          } else {
            stillWaiting.push(candidate);
          }
          continue;
        }
      }

      // Сначала пробуем закрыть уточнение локально: цена, кг/л/шт, размер стаканов и т.д.
      const local = mergeClarificationLocally(pending, relevant);
      let candidate = local.parsed;

      // Если локально не нашли полезных данных, только тогда зовём AI для этого конкретного товара.
      if (!local.changed && relevant) {
        const combined = `${pending.originalText}. Уточнение пользователя: ${relevant}. ВАЖНО: это уточнение относится только к товару “${pending.result?.name || pending.payload?.name || "товар"}”. Не создавай другие товары из уточнения.`;
        const parsed = await parsePurchase(combined, workingItems);
        candidate = {
          ...parsed,
          originalText: pending.originalText,
          form: { ...pending.form, ...parsed.form },
        };
        candidate.payload = payloadFromForm(candidate.form);
        candidate.computed = computeWarehouseAmount(candidate.form);
      }

      const cleanCandidateName = normalizeProductEntityName(candidate.form?.name || candidate.payload?.name || candidate.result?.name || "");
      if (cleanCandidateName) {
        candidate.form = { ...(candidate.form || {}), name: cleanCandidateName };
        candidate.payload = payloadFromForm(candidate.form);
        candidate.computed = computeWarehouseAmount(candidate.form);
        candidate.result = { ...(candidate.result || {}), name: cleanCandidateName };
      }

      if (canSavePurchase(candidate)) {
        const one = await saveParsedPurchase(candidate);
        saved.push(one);
        workingItems = await get("/warehouse/items").catch(() => workingItems) || workingItems;
      } else {
        stillWaiting.push(candidate);
      }
    }

    if (stillWaiting.length) {
      setPendingItems(stillWaiting);
      const savedText = saved.length
        ? `Сохранила:\n${saved.map((x) => `• ${x.matched?.name || x.payload.name} — ${x.computed.quantity} ${unitLabel(x.computed.unit)}${num(x.payload?.price) > 0 ? ` за ${formatMoney(x.payload.price)}` : ""}`).join("\n")}\n\n`
        : "";
      const questions = stillWaiting.map((x, i) => `${i + 1}) ${shortQuestionForPending(x)}`).join("\n");
      setMessages((p) => [...p, {
        role: "bot",
        text: `${savedText}Осталось уточнить:\n${questions}\n\nОтвечай только по этим позициям. Например: “стаканчики 250мл для кофе за 200, яблоки за 200”.`,
      }]);
      await load();
      return;
    }

    setPendingItems([]);
    const expense = await savePurchaseExpense(saved);
    setMessages((p) => [...p, {
      role: "bot",
      text: `Готово, закрыла все уточнения.\n${saved.map((x) => `• ${x.matched ? "прибавила к" : "создала"} “${x.matched?.name || x.payload.name}” — ${x.computed.quantity} ${unitLabel(x.computed.unit)}${num(x.payload?.price) > 0 ? ` за ${formatMoney(x.payload.price)}` : ""}`).join("\n")}${expense ? `\n\nВ расходы записала закупку сырья: ${formatMoney(expense.total)}.` : ""}`,
      cards: saved.map((x) => x.card),
    }]);
    await load();
  };

  const handleWarehouseVisibilityCommand = async (text, forcedMode = "") => {
    const mode = forcedMode || getVisibilityCommandMode(text);
    const wantHidden = mode === "hide";
    let target = findBestWarehouseItem(text, items);

    if (!target && isPronounOnlyVisibilityCommand(text) && lastEntity?.type === "warehouse_item") {
      target = safe_items.find((item) => Number(item.id) === Number(lastEntity.id)) || lastEntity.item || null;
    }

    if (!target) {
      const activeNames = items
        .filter((item) => !(item.hidden || item.isHidden || item.is_hidden))
        .slice(0, 8)
        .map((item) => `«${item.name}»`)
        .join(", ");
      setPendingVisibility({ mode });
      setMessages((p) => [...p, {
        role: "bot",
        text: activeNames
          ? `Какой товар склада сделать ${wantHidden ? "неактивным" : "активным"}? Напиши только название. Сейчас вижу: ${activeNames}.`
          : "Какой товар склада изменить? Напиши точное название товара.",
      }]);
      return true;
    }

    await post(`/warehouse/items/${target.id}/hide`, { hidden: wantHidden });
    setPendingVisibility(null);
    setLastEntity({ type: "warehouse_item", id: target.id, name: target.name, item: { ...target, hidden: wantHidden } });
    await load();

    setMessages((p) => [...p, {
      role: "bot",
      text: wantHidden
        ? `Готово, сделал товар склада «${target.name}» неактивным. Он не будет мешаться в активных остатках.`
        : `Готово, вернул товар склада «${target.name}» в активные.`,
    }]);
    return true;
  };

  const handleSidePanelCommand = async (text) => {
    const command = resolveSidePanelCommand(text, lastUIPanel);
    if (!command) return false;

    setSidePanels((prev) => ({ ...prev, [command.panel]: command.visible }));
    setLastUIPanel(command.panel);
    setPendingItems([]);
    setPendingVisibility(null);
    setPendingMenuTypeCreation(false);
    setPendingPurchaseConfirmation(null);

    const panelName = SIDE_PANEL_NAMES[command.panel] || "Блок";
    const extra = command.panel === "stocks" && command.visible ? `\n\n${answerWarehouseItems()}` : "";
    setMessages((p) => [...p, {
      role: "bot",
      text: command.visible
        ? `Показал блок «${panelName}» справа.${extra}`
        : `Убрал блок «${panelName}» справа.`,
    }]);
    return true;
  };

  const saveExpense = async (text) => {
    const result = await post("/ai/expense/parse", { text });
    const questionText = normalizeQuestionText(result.questions);
    if (questionText) throw new Error(questionText);
    if (!result.name || num(result.amount) <= 0) throw new Error("Не понял расход. Напиши что оплатили и сумму.");
    await post("/global-expenses", {
      category: result.category || "Общие",
      type: result.type || "Расход",
      name: result.name,
      amount: num(result.amount),
      comment: result.comment || result.explanation || "AI расход",
    });
    return result;
  };

  const ensureMenuTypeAndCategory = async (typeName, categoryName) => {
    const cleanType = String(typeName || "Без типа").trim() || "Без типа";
    const cleanCategory = String(categoryName || "Без категории").trim() || "Без категории";
    let types = productTypes;
    let categories = productCategories;
    let type = types.find((x) => normalizeName(x.name) === normalizeName(cleanType));
    if (!type) {
      type = await post("/product-types", { name: cleanType });
      types = [...types, type];
      setProductTypes(types);
    }
    let category = categories.find((x) => normalizeName(x.name) === normalizeName(cleanCategory) && Number(x.typeId || x.type_id || 0) === Number(type.id));
    if (!category) {
      category = await post("/product-categories", { name: cleanCategory, typeId: type.id, type_id: type.id, type: type.name });
      categories = [...categories, category];
      setProductCategories(categories);
    }
    return { type, category };
  };


  const createMenuTypesFromText = async (text) => {
    const names = extractMenuTypeNames(text);
    if (!names.length) throw new Error("Какие типы меню создать? Например: «Еда» и «Напитки».");

    const created = [];
    const existed = [];
    let types = [...productTypes];

    for (const name of names) {
      const exists = types.find((x) => normalizeName(x.name) === normalizeName(name));
      if (exists) {
        existed.push(exists.name);
        continue;
      }
      const saved = await post("/product-types", { name });
      created.push(saved?.name || name);
      types = [...types, saved || { name }];
    }

    setProductTypes(types);
    return { created, existed, all: types };
  };

  const answerMenuTypes = () => {
    if (!safe_productTypes.length) return "В меню пока нет типов. Можешь написать: «создай типы Еда и Напитки» — я создам.";
    return `Типы меню (${safe_productTypes.length}):\n${safe_productTypes.map((x) => `• ${x.name}`).join("\n")}`;
  };

  const answerMenuCategories = () => {
    if (!safe_productCategories.length) return "В меню пока нет папок/категорий.";
    return `Категории меню (${safe_productCategories.length}):\n${safe_productCategories.map((x) => `• ${x.name}${x.typeName || x.type ? ` — ${x.typeName || x.type}` : ""}`).join("\n")}`;
  };


  const answerWarehouseItems = () => {
    const active = safe_items.filter((item) => !(item.hidden || item.isHidden || item.is_hidden));
    if (!active.length) return "Сейчас на складе нет активных товаров. Можно написать: «купил молоко 5 шт за 500» — я добавлю.";
    return `Товары склада (${active.length}):\n${active.map((item) => {
      const price = num(item.price);
      const unitCost = num(item.unitCost ?? item.unit_cost);
      const priceText = price > 0 ? ` · последняя закупка ${formatMoney(price)}` : unitCost > 0 ? ` · себестоимость ${formatMoney(unitCost)} за ${unitLabel(item.unit)}` : "";
      return `• ${item.name} — ${num(item.quantity)} ${unitLabel(item.unit)}${priceText}`;
    }).join("\n")}`;
  };

  const answerPurchaseHistoryQuestion = (text) => {
    let entity = normalizeProductEntityName(extractPurchaseName(text) || stripCommandWords(text));
    if (!entity || /скольк|почем|цен|стоим/i.test(entity)) {
      const t = lower(text).replace(/\b(за|сколько|почем|по|чем|я|мы|купил[аи]?|купили|закупил[аи]?|закупили|взял[аи]?|взяли|цена|стоимость|товар|склад|сырье|сырьё)\b/gi, " ");
      entity = normalizeProductEntityName(t);
    }
    const pattern = productNamePattern(entity);
    if (!pattern) return "По какому товару посмотреть цену закупки?";
    const re = new RegExp(pattern, "i");

    const item = safe_items.find((x) => re.test(normalizeProductEntityName(x.name || "")));
    if (item) {
      const price = num(item.price);
      const unitCost = num(item.unitCost ?? item.unit_cost);
      if (price > 0) return `Последняя закупка «${item.name}» была на ${formatMoney(price)}. Сейчас на складе ${num(item.quantity)} ${unitLabel(item.unit)}.`;
      if (unitCost > 0) return `По «${item.name}» вижу себестоимость ${formatMoney(unitCost)} за ${unitLabel(item.unit)}. Точной суммы последней закупки в карточке нет.`;
    }

    const allMessagesText = messages.map((m) => m.text || "").join("\n");
    const priceFromChat = extractPriceForProduct(allMessagesText, entity);
    if (priceFromChat > 0) return `По истории чата: «${entity}» покупали за ${formatMoney(priceFromChat)}.`;

    return `Не нашла цену закупки для «${entity}». Могу показать остаток или последние приходы по складу.`;
  };

  const createMenuCategoryFromText = async (text) => {
    const req = extractCategoryRequest(text);
    if (!req.category) throw new Error("Как назвать папку/категорию? Например: «создай папку Кофе в Напитки». ");

    let typeName = req.typeName;
    if (!typeName) {
      if (/кофе|чай|напит/i.test(req.category)) typeName = "Напитки";
      else typeName = productTypes[0]?.name || "Без типа";
    }

    const { type, category } = await ensureMenuTypeAndCategory(typeName, req.category);
    return { type, category };
  };

  const saveMenuProduct = async (text) => {
    const result = await post("/ai/menu/parse", {
      text,
      items: itemRefs(items),
      menuProducts: safe_menuProducts.map((p) => ({ id: p.id, name: p.name, category: p.category, type: p.type || p.typeName, price: p.price, cost: p.cost })),
    });
    const questionText = normalizeQuestionText(result.questions);
    if (questionText) throw new Error(questionText);
    const recipe = (result.recipe || []).map((r) => ({
      warehouseItemId: r.warehouseItemId,
      warehouse_item_id: r.warehouseItemId,
      quantity: num(r.quantity),
      quantityUnit: r.unit,
      quantity_unit: r.unit,
    })).filter((r) => r.warehouseItemId > 0 && r.quantity > 0);
    const { type, category } = await ensureMenuTypeAndCategory(result.type || "Без типа", result.category || "Без категории");
    await post("/menu-products", {
      name: result.name,
      price: num(result.price),
      type: type.name,
      typeId: type.id,
      type_id: type.id,
      category: category.name,
      categoryId: category.id,
      category_id: category.id,
      recipe,
    });
    return result;
  };

  // ─────────────────────────────────────────────────────────────────────────
  // send() — Claude определяет намерение, фронт выполняет действие
  // ─────────────────────────────────────────────────────────────────────────
  const send = async () => {
    const rawText = input.trim();
    if (!rawText || loading) return;

    setInput("");
    setLoading(true);
    setMessages((p) => [...p, { role: "user", text: rawText }]);

    try {
      // 1. Отмена — локально, мгновенно
      if (isCancelContextText(rawText)) {
        clearPendingAssistantState({ setPendingItems, setPendingVisibility, setPendingMenuTypeCreation, setPendingPurchaseConfirmation });
        setMessages((p) => [...p, { role: "bot", text: "Ок, сменили тему. Что дальше?" }]);
        return;
      }

      // 2. Уточнение к незакрытым закупкам
      if (pendingItems.length > 0) {
        await updatePendingPurchases(rawText);
        return;
      }

      // 3. Уточнение к visibility команде
      if (pendingVisibility) {
        await handleWarehouseVisibilityCommand(rawText, pendingVisibility.mode);
        return;
      }

      // 4. Всё остальное → Claude определяет намерение за 1 вызов
      const intentRes = await post("/ai/intent", {
        text: rawText,
        items: itemRefs(items),
        menuTypes: safe_productTypes.map((x) => x.name),
        menuCats: safe_productCategories.map((x) => x.name),
        hasPending: pendingItems.length > 0 || !!pendingVisibility || pendingMenuTypeCreation,
      });

      switch (intentRes.intent) {

        case "purchase": {
          const parsedItems = intentRes.items || [];
          if (!parsedItems.length) {
            setMessages((p) => [...p, { role: "bot", text: "Не понял что купили. Напиши например: «апельсин 3кг за 400р»" }]);
            break;
          }
          const waiting = parsedItems.filter((p) => (p.questions || []).length > 0);
          const ready = parsedItems.filter((p) => !(p.questions || []).length && p.name && num(p.price) > 0);
          const saved = [];
          for (const p of ready) {
            const form = formFromAIResult(p);
            const payload = payloadFromForm(form);
            const computed = computeWarehouseAmount(form);
            const matched = p.matchedItemId
              ? safe_items.find((i) => Number(i.id) === Number(p.matchedItemId))
              : safe_items.find((i) => normalizeProductEntityName(i.name || "") === normalizeProductEntityName(p.name || ""));
            const one = await saveParsedPurchase({ originalText: rawText, result: p, form, payload, computed, matched, questions: [] });
            saved.push(one);
          }
          if (waiting.length > 0) {
            setPendingItems(waiting.map((p) => ({
              originalText: rawText, result: p,
              form: formFromAIResult(p), payload: payloadFromForm(formFromAIResult(p)),
              computed: computeWarehouseAmount(formFromAIResult(p)),
              matched: null, questions: p.questions || [],
            })));
            const savedText = saved.length ? `Сохранила:
${saved.map((x) => `• ${normalizeProductEntityName(x.matched?.name || x.payload.name)} — ${x.computed.quantity} ${unitLabel(x.computed.unit)} за ${formatMoney(x.payload.price)}`).join("\n")}

` : "";
            const qs = waiting.map((p, i) => `${i + 1}) ${(p.questions || []).join("; ")}`).join("\n");
            setMessages((prev) => [...prev, { role: "bot", text: `${savedText}Нужно уточнить:\n${qs}` }]);
          } else if (saved.length > 0) {
            const expense = await savePurchaseExpense(saved);
            const lines = saved.map((x) => `${x.matched ? "прибавила к" : "создала"} «${normalizeProductEntityName(x.matched?.name || x.payload.name)}» — ${x.computed.quantity} ${unitLabel(x.computed.unit)} за ${formatMoney(x.payload.price)}`).join("\n");
            setMessages((prev) => [...prev, {
              role: "bot",
              text: `Готово.
${lines}${expense ? `

Закупка записана в расходы: ${formatMoney(expense.total)}.` : ""}`,
              cards: saved.map((x) => x.card),
            }]);
          }
          await load();
          break;
        }

        case "expense": {
          const exp = intentRes.expense;
          if (!exp) { setMessages((p) => [...p, { role: "bot", text: "Не понял расход." }]); break; }
          const qs = (exp.questions || []).join("\n");
          if (qs) { setMessages((p) => [...p, { role: "bot", text: qs }]); break; }
          if (!exp.name || num(exp.amount) <= 0) { setMessages((p) => [...p, { role: "bot", text: "Не понял расход. Напиши что и сколько." }]); break; }
          await post("/global-expenses", { category: exp.category || "household", type: exp.type || "Прочее", name: exp.name, amount: num(exp.amount), comment: exp.comment || "" });
          setMessages((p) => [...p, { role: "bot", text: `Записала расход: ${exp.name} — ${formatMoney(exp.amount)}.` }]);
          await load();
          break;
        }

        case "menu_create": {
          const menu = intentRes.menu;
          if (!menu) { setMessages((p) => [...p, { role: "bot", text: "Не понял что добавить в меню." }]); break; }
          const qs = (menu.questions || []).join("\n");
          if (qs) { setMessages((p) => [...p, { role: "bot", text: qs }]); break; }
          const { type, category } = await ensureMenuTypeAndCategory(menu.type || "Без типа", menu.category || "Без категории");
          const recipe = (menu.recipe || []).map((r) => ({
            warehouseItemId: r.warehouseItemId, warehouse_item_id: r.warehouseItemId,
            quantity: num(r.quantity), quantityUnit: r.unit, quantity_unit: r.unit,
          })).filter((r) => r.warehouseItemId > 0 && r.quantity > 0);
          await post("/menu-products", { name: menu.name, price: num(menu.price), type: type.name, typeId: type.id, type_id: type.id, category: category.name, categoryId: category.id, category_id: category.id, recipe });
          setMessages((p) => [...p, { role: "bot", text: `Добавила в меню: «${menu.name}» за ${formatMoney(menu.price)}.` }]);
          await load();
          break;
        }

        case "menu_type_create": {
          const names = intentRes.names || [];
          if (!names.length) { setMessages((p) => [...p, { role: "bot", text: "Как назвать тип меню?" }]); break; }
          const res = await createMenuTypesFromText(names.join(" и "));
          setMessages((p) => [...p, { role: "bot", text: res.created.length ? `Создала типы:\n${res.created.map((x) => `• ${x}`).join("\n")}` : `Уже есть: ${res.existed.join(", ")}.` }]);
          await load();
          break;
        }

        case "menu_cat_create": {
          const catName = intentRes.catName || "";
          const typeName = intentRes.typeName || (productTypes[0]?.name || "Без типа");
          if (!catName) { setMessages((p) => [...p, { role: "bot", text: "Как назвать папку?" }]); break; }
          const { type, category } = await ensureMenuTypeAndCategory(typeName, catName);
          setMessages((p) => [...p, { role: "bot", text: `Создала папку «${category.name}» в типе «${type.name}».` }]);
          await load();
          break;
        }

        case "cancel": {
          clearPendingAssistantState({ setPendingItems, setPendingVisibility, setPendingMenuTypeCreation, setPendingPurchaseConfirmation });
          setMessages((p) => [...p, { role: "bot", text: "Ок, сменили тему." }]);
          break;
        }

        case "question":
        case "clarify":
        default: {
          const res = await post("/ai/warehouse/ask", {
            text: rawText,
            history: makeAIHistory(messages, rawText),
            memory: {
              lastEntity,
              warehouseItems: itemRefs(items).slice(0, 50),
              menuTypes: safe_productTypes.map((x) => x.name),
              menuCategories: safe_productCategories.map((x) => x.name),
            },
          });
          const answer = sanitizeAssistantAnswer(res.answer || "Готово.");
          setMessages((p) => [...p, { role: "bot", text: answer }]);
          break;
        }
      }

    } catch (e) {
      setMessages((p) => [...p, { role: "bot", text: e?.message || "Произошла ошибка. Попробуй ещё раз." }]);
    } finally {
      setLoading(false);
    }
  };

    return (
    <div className="flex h-full w-full flex-col overflow-hidden text-white" style={{height:"100%"}}>
      <div className="mx-auto flex h-full w-full max-w-[1500px] flex-col overflow-hidden">
        <div
          className={`grid min-h-0 flex-1 w-full min-w-0 ${
            activeRightPanels ? "xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-4 xl:px-4 xl:py-4" : "xl:grid-cols-1"
          }`}
        >
          <section className="flex min-h-0 flex-1 min-w-0 flex-col overflow-hidden xl:rounded-2xl xl:border xl:border-white/10 bg-gradient-to-b from-white/[0.08] to-white/[0.03] xl:shadow-2xl xl:shadow-black/20">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-sm shadow-lg shadow-blue-600/30">
                  🤖
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-black">AI-ассистент</p>
                  <div className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    <p className="truncate text-[11px] text-emerald-300 font-bold">Онлайн</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden rounded-full bg-emerald-400/10 px-2 py-1 text-[10px] font-black text-emerald-300 sm:inline">
                  AUTO SAVE
                </span>
                <button onClick={load} className="rounded-xl bg-white/10 px-3 py-1.5 text-xs font-black text-white hover:bg-white/15">⟳</button>
                <Link to="/warehouse" className="rounded-xl bg-white/10 px-3 py-1.5 text-xs font-black text-white hover:bg-white/15">Склад →</Link>
              </div>
            </div>

            <div
              ref={messagesRef}
              className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3 sm:p-4"
            >
              <div className="mx-auto w-fit rounded-full bg-white/5 px-4 py-2 text-xs font-black text-slate-400">
                Сегодня
              </div>
              {messages.map((msg, i) => (
                <Message key={i} msg={msg} />
              ))}
              {loading && <Message msg={{ role: "bot", text: "Думаю и проверяю данные..." }} />}
              <div ref={bottomRef} />
            </div>

            <div className="shrink-0 border-t border-white/10 bg-slate-950/50 px-3 py-2">
              <div className="mb-2 flex justify-end lg:hidden">
                <Link to="/work" className="text-xs font-bold text-slate-500 hover:text-slate-300 transition">
                  ✕ Завершить чат
                </Link>
              </div>
              <div className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none" style={{scrollbarWidth:"none"}}>
                {[
                  "что заканчивается?",
                  "продажи сегодня",
                  "молоко 4 пачки по 1л за 420",
                  "расход такси 1200",
                  "какие типы меню?",
                  "кто должен деньги?",
                ].map((x) => (
                  <button
                    key={x}
                    onClick={() => setInput(x)}
                    className="shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-bold text-slate-300 active:bg-white/15"
                  >
                    {x}
                  </button>
                ))}
              </div>
              <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-slate-900 px-3 py-2">
                <textarea
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder="Напиши закупку, расход или вопрос..."
                  rows={1}
                  className="flex-1 resize-none bg-transparent text-sm font-medium leading-5 text-white outline-none placeholder:text-slate-500"
                  style={{minHeight: "24px", maxHeight: "120px"}}
                />
                <button
                  onClick={send}
                  disabled={loading}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-lg font-black shadow-lg transition active:scale-95 disabled:opacity-50"
                >
                  {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : "↑"}
                </button>
              </div>
            </div>
          </section>

          {activeRightPanels > 0 && (
            <aside
              className="hidden min-w-0 gap-4 overflow-hidden xl:grid xl:self-start" style={{height:"calc(100dvh - 245px)"}}
              style={{ gridTemplateRows: rightPanelRows }}
            >
              {sidePanels.recent && (
                <div className="flex min-h-[220px] flex-col overflow-hidden rounded-[1.25rem] border border-white/10 bg-white/[0.06] p-4">
                  <div className="mb-4 flex shrink-0 items-center justify-between">
                    <h3 className="text-lg font-black">Последние добавления</h3>
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  </div>
                  <div className="max-h-[240px] space-y-3 overflow-y-auto overscroll-contain pr-1">
                    {recentAdded.map((m, i) => (
                      <div key={i} className="rounded-[1.2rem] bg-white/5 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black">
                              {m.itemName || m.item_name || "Сырьё"}
                            </p>
                            <p className="text-[11px] font-bold text-slate-500">
                              {String(m.createdAt || m.created_at || "").slice(0, 16) || "сейчас"}
                            </p>
                          </div>
                          <p className="shrink-0 text-sm font-black text-emerald-300">
                            +{num(m.quantity)} {unitLabel(m.unit)}
                          </p>
                        </div>
                      </div>
                    ))}
                    {!recentAdded.length && (
                      <div className="rounded-[1.2rem] border border-dashed border-white/10 p-5 text-center text-sm font-bold text-slate-500">
                        Пока нет приходов
                      </div>
                    )}
                  </div>
                </div>
              )}

              {sidePanels.stocks && (
                <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.06] p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-lg font-black">Остатки</h3>
                    <button
                      type="button"
                      onClick={() => {
                        setSidePanels((prev) => ({ ...prev, stocks: false }));
                        setLastUIPanel("stocks");
                      }}
                      className="rounded-full bg-white/5 px-2 py-1 text-[11px] font-black text-slate-400 hover:bg-white/10 hover:text-white"
                    >
                      убрать
                    </button>
                  </div>
                  <div className="max-h-[240px] space-y-2 overflow-y-auto">
                    {topItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between rounded-2xl bg-white/5 px-3 py-2"
                      >
                        <span className="truncate text-sm font-bold text-slate-200">{item.name}</span>
                        <span className="ml-3 shrink-0 text-sm font-black text-blue-200">
                          {num(item.quantity)} {unitLabel(item.unit)}
                        </span>
                      </div>
                    ))}
                    {!topItems.length && <p className="text-sm font-bold text-slate-500">Склад пустой</p>}
                  </div>
                </div>
              )}

              {sidePanels.suggestions && (
                <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.06] p-4">
                  <p className="text-xs font-black uppercase text-slate-500">Можно спросить</p>
                  <div className="mt-3 space-y-2 text-sm font-bold text-slate-300">
                    <p>• что заканчивается?</p>
                    <p>• продажи сегодня</p>
                    <p>• себестоимость меню</p>
                    <p>• кто должен деньги?</p>
                    <p>• сколько калорий в эспрессо</p>
                    <p>• дай совет по меню</p>
                  </div>
                </div>
              )}
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

