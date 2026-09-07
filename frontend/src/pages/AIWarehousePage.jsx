import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { RefreshCw, X, Send, FileDown } from "lucide-react";
import { get, getCurrentWorkspace, getSession, post } from "../api";
import { formatMoney, num } from "../utils/format";
import { CONTAINER_UNITS, unitLabel } from "../utils/menu";
import { escHtml, printHtmlDocument } from "../utils/print";


const normalizeText = (text) => String(text || "").replace(/ё/g, "е").replace(/,/g, ".").replace(/\s+/g, " ").trim();
const lower = (text) => normalizeText(text).toLowerCase();


const isCancelContextText = (text) => {
  const t = lower(text);
  return /^(стоп|отмена|отмени|не надо|не нужно|забей|хватит|закрой|сброс|сбрось|другая тема|другое|сменим тему|уходи от этой темы|уйди от этой темы|забудь это|не записывай|не сохраняй)$/i.test(t)
    || /(уходи|уйди|отстань|забей|закрой)\s+(от\s+)?(этой\s+)?тем/i.test(t);
};

const sanitizeAssistantAnswer = (answer) => {
  const text = String(answer || "").trim();
  return text || "Готово.";
};

const MENU_TYPE_ALIASES = [
  { name: "Еда", re: /\b(еда|еду|блюда|кухня)\b/i },
  { name: "Напитки", re: /\b(напитки|напиток|напитков|кофе|чай|бар)\b/i },
  { name: "Десерты", re: /\b(десерты|десерт|сладкое)\b/i },
];


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


const normalizeSidePanels = (value) => ({
  ...DEFAULT_SIDE_PANELS,
  ...(value && typeof value === "object" ? value : {}),
});


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

const clearPendingAssistantState = ({ setPendingItems, setPendingVisibility, setPendingMenuTypeCreation, setPendingPurchaseConfirmation }) => {
  setPendingItems([]);
  setPendingVisibility(null);
  setPendingMenuTypeCreation(false);
  setPendingPurchaseConfirmation(null);
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
  const unitRe = "короб\\w*|упак\\w*|пач\\w*|бутыл\\w*|кг|килограмм\\w*|гр|грамм\\w*|мл|миллилитр\\w*|л\\b|литр\\w*|шт|штук\\w*|шту\\w*";
  const matches = [...t.matchAll(new RegExp(`\\d+(?:[,.]\\d+)?\\s*(?:${unitRe})`, "gi"))];
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

// ── Лёгкий markdown-рендер для ответов ассистента ──────────────────────
// Разбирает **жирный**, *курсив*, `код`, заголовки #/##/###, списки -,*,•,1.
// чтобы ответ выглядел красиво, а не «звёздочками».
function renderInline(text, kp) {
  const nodes = [];
  const re = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_)/g;
  let last = 0, m, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**") || t.startsWith("__"))
      nodes.push(<strong key={`${kp}-${i}`} className="font-black text-white">{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`"))
      nodes.push(<code key={`${kp}-${i}`} className="rounded-md bg-white/10 px-1.5 py-0.5 text-[12px] font-bold text-blue-200">{t.slice(1, -1)}</code>);
    else
      nodes.push(<em key={`${kp}-${i}`} className="text-white/90">{t.slice(1, -1)}</em>);
    last = m.index + t.length;
    i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const RichText = memo(function RichText({ text }) {
  const lines = String(text || "").split("\n");
  const blocks = [];
  let list = null;
  const flush = () => { if (list) { blocks.push(list); list = null; } };
  lines.forEach((raw) => {
    const l = raw.trim();
    if (!l) { flush(); return; }
    const h = l.match(/^(#{1,3})\s+(.*)$/);
    const b = l.match(/^[-*•]\s+(.*)$/);
    const n = l.match(/^(\d+)[.)]\s+(.*)$/);
    if (h) { flush(); blocks.push({ type: "h", level: h[1].length, text: h[2] }); }
    else if (b) { if (!list || list.type !== "ul") { flush(); list = { type: "ul", items: [] }; } list.items.push(b[1]); }
    else if (n) { if (!list || list.type !== "ol") { flush(); list = { type: "ol", items: [] }; } list.items.push(n[2]); }
    else { flush(); blocks.push({ type: "p", text: l }); }
  });
  flush();

  return (
    <div className="space-y-1.5">
      {blocks.map((blk, bi) => {
        if (blk.type === "h") {
          const cls = blk.level === 1 ? "text-[15px]" : blk.level === 2 ? "text-sm" : "text-[13px]";
          return <p key={bi} className={`${cls} font-black text-white ${bi ? "mt-2.5" : ""}`}>{renderInline(blk.text, `h${bi}`)}</p>;
        }
        if (blk.type === "ul" || blk.type === "ol") {
          return (
            <ul key={bi} className="space-y-1">
              {blk.items.map((it, ii) => (
                <li key={ii} className="flex gap-2">
                  {blk.type === "ol"
                    ? <span className="shrink-0 font-black text-blue-300">{ii + 1}.</span>
                    : <span className="mt-[8px] h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />}
                  <span className="min-w-0 leading-6">{renderInline(it, `li${bi}-${ii}`)}</span>
                </li>
              ))}
            </ul>
          );
        }
        return <p key={bi} className="leading-6">{renderInline(blk.text, `p${bi}`)}</p>;
      })}
    </div>
  );
});

// Экспорт ответа ассистента в PDF: собираем чистый светлый документ и печатаем
// (через окно печати браузера → «Сохранить как PDF»). Без внешних библиотек.
function exportTextToPdf(text) {
  const ws = getCurrentWorkspace?.() || {};
  const business = ws.name || ws.companyName || ws.workspaceName || "Okvion Sales";
  const esc = escHtml;
  const inline = (s) => esc(s)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  const lines = String(text || "").split("\n");
  let body = "", list = null;
  const closeList = () => { if (list) { body += list === "ul" ? "</ul>" : "</ol>"; list = null; } };
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) { closeList(); continue; }
    const h = l.match(/^(#{1,3})\s+(.*)$/);
    const b = l.match(/^[-*•]\s+(.*)$/);
    const n = l.match(/^(\d+)[.)]\s+(.*)$/);
    if (h) { closeList(); const lvl = Math.min(h[1].length + 1, 4); body += `<h${lvl}>${inline(h[2])}</h${lvl}>`; }
    else if (b) { if (list !== "ul") { closeList(); body += "<ul>"; list = "ul"; } body += `<li>${inline(b[1])}</li>`; }
    else if (n) { if (list !== "ol") { closeList(); body += "<ol>"; list = "ol"; } body += `<li>${inline(n[2])}</li>`; }
    else { closeList(); body += `<p>${inline(l)}</p>`; }
  }
  closeList();
  const firstH = lines.map((s) => s.trim()).find((s) => /^#{1,3}\s+/.test(s));
  const title = firstH ? firstH.replace(/^#{1,3}\s+/, "").replace(/[*`]/g, "") : "Отчёт";
  const now = new Date();
  const dateStr = now.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" }) +
    ", " + now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    :root{--ink:#0f172a;--muted:#64748b;--line:#e6e8ef;--accent:#4f46e5;--accent2:#7c3aed}
    *{box-sizing:border-box}
    html,body{background:#ffffff}
    body{font-family:'Segoe UI',system-ui,-apple-system,Arial,sans-serif;color:var(--ink);max-width:780px;margin:0 auto;padding:30px 32px;line-height:1.62;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .head{padding-bottom:16px;margin-bottom:22px;border-bottom:1px solid var(--line)}
    .head .row{display:flex;align-items:center;justify-content:space-between;gap:16px}
    .brand{display:flex;align-items:center;gap:10px;font-size:17px;font-weight:800;letter-spacing:-.01em}
    .brand .mark{width:26px;height:26px;border-radius:8px;background:linear-gradient(135deg,var(--accent),var(--accent2))}
    .meta{color:var(--muted);font-size:11.5px;text-align:right;white-space:nowrap;line-height:1.5}
    .accent{height:3px;width:72px;border-radius:3px;background:linear-gradient(90deg,var(--accent),var(--accent2));margin-top:14px}
    h1{font-size:25px;font-weight:800;letter-spacing:-.02em;margin:2px 0 18px}
    h2{font-size:15.5px;font-weight:800;margin:24px 0 8px;padding-left:11px;border-left:3px solid var(--accent)}
    h3{font-size:14px;font-weight:800;color:#1e293b;margin:18px 0 5px}
    h4{font-size:13px;font-weight:700;color:#334155;margin:14px 0 4px}
    p{margin:8px 0;font-size:13.5px}
    ul,ol{margin:8px 0;padding-left:22px}
    li{margin:5px 0;font-size:13.5px}
    ul li::marker{color:var(--accent)}
    strong{font-weight:800}
    em{font-style:italic;color:#334155}
    code{background:#f1f5f9;border:1px solid #e4e8f0;border-radius:5px;padding:1px 6px;font-size:12.5px;font-family:'SF Mono',ui-monospace,Menlo,monospace}
    .foot{margin-top:34px;padding-top:12px;border-top:1px solid var(--line);color:#94a3b8;font-size:11px;display:flex;align-items:center;justify-content:space-between}
    @page{margin:14mm}
    @media print{body{padding:0}h2,h3{break-after:avoid}li,p{break-inside:avoid}}
    </style></head><body>
    <div class="head"><div class="row">
      <div class="brand"><span class="mark"></span>${esc(business)}</div>
      <div class="meta">Отчёт AI-ассистента<br>${esc(dateStr)}</div>
    </div><div class="accent"></div></div>
    <h1>${esc(title)}</h1>
    <div class="content">${body}</div>
    <div class="foot"><span>Сформировано в Okvion Sales · AI-ассистент</span><span>okvionsales.ru</span></div>
    </body></html>`;
  printHtmlDocument(html);
}

const Message = memo(function Message({ msg }) {
  const isUser = msg.role === "user";
  const showPdf = msg.role === "bot" && msg.text && msg.text !== AI_WELCOME_MESSAGE.text && msg.text.length > 120;
  return (
    <div className={`flex gap-2 sm:gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && <div className="mt-1 hidden h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-sm shadow-lg shadow-blue-600/30 sm:flex">🤖</div>}
      <div className={`max-w-[90%] rounded-3xl px-4 py-3 text-[13px] font-bold leading-6 shadow-lg sm:max-w-[78%] ${isUser ? "bg-gradient-to-br from-blue-600 to-violet-600 text-white" : "border border-white/10 bg-white/[0.08] text-slate-100 backdrop-blur"}`}>
        {isUser ? <p className="whitespace-pre-line">{msg.text}</p> : <RichText text={msg.text} />}
        {msg.cards?.length > 0 && (
          <div className="mt-3 space-y-2">
            {msg.cards.map((card, i) => (
              <div key={i} className="rounded-2xl border border-white/10 bg-slate-950/40 p-3 text-slate-100">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-black">{card.name}</p>
                    <p className="text-xs font-bold text-slate-400">{card.detail}</p>
                  </div>
                  <span className="shrink-0 rounded-2xl bg-emerald-500/15 px-3 py-2 text-xs font-black text-emerald-300">+{card.qty}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {showPdf && (
          <div className="mt-2.5 flex justify-start border-t border-white/10 pt-2">
            <button type="button" onClick={() => exportTextToPdf(msg.text)} aria-label="Скачать отчёт в PDF" title="Скачать в PDF"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-[11px] font-black text-slate-200 transition hover:bg-white/15 active:scale-[0.97]">
              <FileDown size={13} strokeWidth={2.4} /> Скачать PDF
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

export default function AIWarehousePage() {
  const [items, setItems] = useState([]);
  const [movements, setMovements] = useState([]);
  const [productTypes, setProductTypes] = useState([]);
  const [productCategories, setProductCategories] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const wsName = getCurrentWorkspace?.()?.name || "";
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
  const [aiBrain] = useState({
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
    const types = await safeGet("/product-types");
    const categories = await safeGet("/product-categories");

    setItems(warehouseList);
    setMovements(movementList);
    setProductTypes(types);
    setProductCategories(categories);
  };

  useEffect(() => { load(); }, []);

  // Выход из полноэкранного помощника: назад / на главную / по Esc — чтобы не «застрять».
  const navigate = useNavigate();
  const exitChat = () => navigate("/home");
  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate("/home"));
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      const tag = document.activeElement?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return; // не мешаем вводу в чат
      navigate("/home");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

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
  }, [storageKey, messages, pendingItems, lastEntity, pendingVisibility, pendingMenuTypeCreation, pendingPurchaseConfirmation, sidePanels, lastUIPanel, aiBrain]);

  useEffect(() => {
    const box = messagesRef.current;
    if (!box) return;
    box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const recentAdded = useMemo(() => (Array.isArray(movements) ? movements : []).filter((m) => String(m.movementType || m.movement_type) === "in").slice(0, 5), [movements]);
  const topItems = useMemo(() => [...items].filter((x) => !(x.hidden || x.isHidden || x.is_hidden)).sort((a, b) => num(b.quantity) - num(a.quantity)).slice(0, 7), [items]);
  const activeRightPanels = useMemo(() => Object.values(sidePanels).filter(Boolean).length, [sidePanels]);

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
      savedItem,
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
            if (one.savedItem?.id) {
              const idx = workingItems.findIndex((w) => Number(w.id) === Number(one.savedItem.id));
              workingItems = idx >= 0 ? workingItems.map((w, i) => (i === idx ? one.savedItem : w)) : [...workingItems, one.savedItem];
            }
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
        if (one.savedItem?.id) {
          const idx = workingItems.findIndex((w) => Number(w.id) === Number(one.savedItem.id));
          workingItems = idx >= 0 ? workingItems.map((w, i) => (i === idx ? one.savedItem : w)) : [...workingItems, one.savedItem];
        }
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
      text: `Готово, закрыла все уточнения${wsName ? ` на точке «${wsName}»` : ""}.\n${saved.map((x) => `• ${x.matched ? "прибавила к" : "создала"} “${x.matched?.name || x.payload.name}” — ${x.computed.quantity} ${unitLabel(x.computed.unit)}${num(x.payload?.price) > 0 ? ` за ${formatMoney(x.payload.price)}` : ""}`).join("\n")}${expense ? `\n\nВ расходы записала закупку сырья: ${formatMoney(expense.total)}.` : ""}`,
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

  // Реальная запись отложенной закупки — только после явного «Да» пользователя.
  const confirmPendingPurchase = async () => {
    const pending = pendingPurchaseConfirmation;
    if (!pending?.items?.length) { setPendingPurchaseConfirmation(null); return; }
    setPendingPurchaseConfirmation(null);
    setLoading(true);
    try {
      const saved = [];
      for (const candidate of pending.items) {
        const one = await saveParsedPurchase(candidate);
        saved.push(one);
      }
      const expense = await savePurchaseExpense(saved);
      const lines = saved.map((x) => `${x.matched ? "прибавила к" : "создала"} «${normalizeProductEntityName(x.matched?.name || x.payload.name)}» — ${x.computed.quantity} ${unitLabel(x.computed.unit)}${num(x.payload?.price) > 0 ? ` за ${formatMoney(x.payload.price)}` : ""}`).join("\n");
      setMessages((prev) => [...prev, {
        role: "bot",
        text: `Готово, записала${pending.wsName || wsName ? ` на точке «${pending.wsName || wsName}»` : ""}.\n${lines}${expense ? `\n\nЗакупка записана в расходы: ${formatMoney(expense.total)}.` : ""}`,
        cards: saved.map((x) => x.card),
      }]);
      await load();
    } catch (e) {
      const cause = e?.cause?.name;
      const friendly = cause === "AbortError"
        ? "Ответ занял слишком долго. Давай попробуем ещё раз через минуту."
        : "Не получилось записать закупку. Попробуй ещё раз.";
      setMessages((prev) => [...prev, { role: "bot", text: friendly }]);
    } finally {
      setLoading(false);
    }
  };

  const cancelPendingPurchase = () => {
    setPendingPurchaseConfirmation(null);
    setMessages((prev) => [...prev, { role: "bot", text: "Ок, отменила закупку — ничего не записала." }]);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // send() — Claude определяет намерение, фронт выполняет действие
  // ─────────────────────────────────────────────────────────────────────────
  const send = async (overrideText) => {
    const rawText = (typeof overrideText === "string" ? overrideText : input).trim();
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

      // 1b. Ждём подтверждения закупки — «да»/«нет» текстом трактуем как кнопки.
      if (pendingPurchaseConfirmation?.items?.length) {
        if (/^(да|ага|верно|подтвержда\w*|записывай|запиши|ок|окей|сохрани|сохраняй|давай)\b/i.test(lower(rawText))) {
          await confirmPendingPurchase();
          return;
        }
        if (/^(нет|отмена|отмени|не\s+надо|не\s+нужно|не\s+записывай|стоп)\b/i.test(lower(rawText))) {
          cancelPendingPurchase();
          return;
        }
      }

      // 2. Уточнение к незакрытым закупкам
      const looksLikeClarification = /\d/.test(rawText) || /(кг|г|л|мл|шт|руб|р\b|₽|за\s)/i.test(rawText);
      if (pendingItems.length > 0) {
        if (!looksLikeClarification && /\?|^(а\s|сколько|что|как|какие|кто|почему|где|когда)\b/i.test(rawText)) {
          setMessages((p) => [...p, { role: "bot", text: `Сейчас жду ответ по закупке (${pendingItems.map((x) => normalizeProductEntityName(x.result?.name || x.payload?.name || x.form?.name || "товар")).join(", ")}). Это ответ по закупке — или новый вопрос? Чтобы задать новый вопрос, нажмите «Отменить уточнения».` }]);
          return;
        }
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

      // На 401 request() возвращает undefined и уже диспатчит "sales-session-expired".
      if (!intentRes) return;

      switch (intentRes.intent) {

        case "purchase": {
          const parsedItems = intentRes.items || [];
          if (!parsedItems.length) {
            setMessages((p) => [...p, { role: "bot", text: "Не понял что купили. Напиши например: «апельсин 3кг за 400р»" }]);
            break;
          }
          const waiting = parsedItems.filter((p) => (p.questions || []).length > 0);
          const ready = parsedItems.filter((p) => !(p.questions || []).length && p.name && num(p.price) > 0);

          // Готовые позиции НЕ коммитим сразу — собираем превью и ждём явного «Да».
          const prepared = ready.map((p) => {
            const form = formFromAIResult(p);
            const matched = p.matchedItemId
              ? safe_items.find((i) => Number(i.id) === Number(p.matchedItemId))
              : safe_items.find((i) => normalizeProductEntityName(i.name || "") === normalizeProductEntityName(p.name || ""));
            return {
              originalText: rawText,
              result: p,
              form,
              payload: payloadFromForm(form),
              computed: computeWarehouseAmount(form),
              matched: matched || null,
              questions: [],
            };
          });

          if (waiting.length > 0) {
            setPendingItems(waiting.map((p) => ({
              originalText: rawText, result: p,
              form: formFromAIResult(p), payload: payloadFromForm(formFromAIResult(p)),
              computed: computeWarehouseAmount(formFromAIResult(p)),
              matched: null, questions: p.questions || [],
            })));
            const qs = waiting.map((p, i) => `${i + 1}) ${(p.questions || []).join("; ")}`).join("\n");
            setMessages((prev) => [...prev, { role: "bot", text: `Нужно уточнить:\n${qs}` }]);
          }

          if (prepared.length > 0) {
            setPendingPurchaseConfirmation({ items: prepared, wsName });
            const lines = prepared.map((x) => {
              const nm = normalizeProductEntityName(x.form?.name || x.payload?.name || x.result?.name || "товар");
              const tgt = x.matched ? `прибавить к «${normalizeProductEntityName(x.matched.name)}»` : "создать новый";
              return `• ${nm} — ${x.computed.quantity} ${unitLabel(x.computed.unit)}${num(x.payload?.price) > 0 ? ` за ${formatMoney(x.payload.price)}` : ""} (${tgt})`;
            }).join("\n");
            setMessages((prev) => [...prev, {
              role: "bot",
              text: `Проверь закупку перед записью${wsName ? ` на точку «${wsName}»` : ""}:\n${lines}\n\nЗаписать? Нажми «Да, записать» или «Отмена».`,
            }]);
          } else if (waiting.length === 0) {
            setMessages((prev) => [...prev, { role: "bot", text: "Не понял что купили. Напиши например: «апельсин 3кг за 400р»" }]);
          }
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
      const cause = e?.cause?.name;
      // Сеть/таймаут — мягкий текст. Ошибку от сервера (напр. «ключ не настроен»,
      // «AI не ответил: …») показываем как есть — это реальная причина для диагностики.
      const friendly =
        cause === "AbortError"
          ? "Ответ занял слишком долго. Давай попробуем ещё раз через минуту."
          : cause === "TypeError" || e instanceof TypeError
          ? "Пропала связь. Проверь интернет и попробуй ещё раз."
          : (e?.message || "Не получилось получить ответ. Попробуй ещё раз через минуту.");
      setMessages((p) => [...p, { role: "bot", text: friendly }]);
    } finally {
      setLoading(false);
    }
  };

    return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden text-white">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1500px] flex-col overflow-hidden">
        <div
          className={`grid min-h-0 flex-1 w-full min-w-0 ${
            activeRightPanels ? "xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-4 xl:px-4 xl:py-4" : "xl:grid-cols-1"
          }`}
        >
          <section className="flex min-h-0 flex-1 min-w-0 flex-col overflow-hidden xl:rounded-2xl xl:border xl:border-white/10 bg-gradient-to-b from-white/[0.08] to-white/[0.03] xl:shadow-2xl xl:shadow-black/20">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <button onClick={goBack} aria-label="Назад" title="Назад"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white transition hover:bg-white/15">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                </button>
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-sm shadow-lg shadow-blue-600/30">
                  🤖
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-black">AI-ассистент</p>
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                    <p className="shrink-0 text-[11px] font-bold text-emerald-300">Онлайн</p>
                    {wsName && (
                      <span className="min-w-0 truncate text-[11px] font-bold text-slate-400">· 📍 {wsName}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {lastUIPanel && !sidePanels[lastUIPanel] && (
                  <button
                    type="button"
                    onClick={() => { setSidePanels((prev) => ({ ...prev, [lastUIPanel]: true })); setLastUIPanel(""); }}
                    title="Вернуть скрытую панель"
                    className="hidden shrink-0 items-center rounded-xl bg-white/10 px-3 py-2 text-xs font-black text-white transition hover:bg-white/15 xl:inline-flex"
                  >
                    {lastUIPanel === "stocks" ? "Вернуть остатки" : lastUIPanel === "recent" ? "Вернуть последние" : lastUIPanel === "suggestions" ? "Вернуть подсказки" : "Вернуть панель"}
                  </button>
                )}
                <span className="hidden rounded-full bg-emerald-400/10 px-2 py-1 text-[10px] font-black text-emerald-300 sm:inline">
                  AUTO SAVE
                </span>
                <button onClick={load} aria-label="Обновить" title="Обновить" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white transition hover:bg-white/15"><RefreshCw size={16} strokeWidth={2.4} /></button>
                <Link to="/warehouse" className="rounded-xl bg-white/10 px-3 py-2 text-xs font-black text-white transition hover:bg-white/15">Склад →</Link>
                <button onClick={exitChat} aria-label="Закрыть помощника" title="Закрыть (Esc)"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-slate-200 transition hover:bg-red-500/20 hover:text-red-300">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
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
                <Link to="/work" className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-300 transition">
                  <X size={13} strokeWidth={2.4} /> Завершить чат
                </Link>
              </div>
              {pendingPurchaseConfirmation?.items?.length > 0 && (
                <div className="mb-2 rounded-2xl border border-blue-400/30 bg-blue-500/10 p-3">
                  <p className="mb-2 text-xs font-black text-blue-200">
                    Проверь закупку{pendingPurchaseConfirmation.wsName || wsName ? ` — запишу на точку «${pendingPurchaseConfirmation.wsName || wsName}»` : ""}
                  </p>
                  <div className="space-y-1.5">
                    {pendingPurchaseConfirmation.items.map((x, i) => {
                      const nm = normalizeProductEntityName(x.form?.name || x.payload?.name || x.result?.name || "товар");
                      const tgt = x.matched ? `прибавить к «${normalizeProductEntityName(x.matched.name)}»` : "создать новый";
                      return (
                        <div key={i} className="rounded-xl bg-white/5 px-3 py-2">
                          <p className="text-[13px] font-black text-white">{nm} — {x.computed.quantity} {unitLabel(x.computed.unit)}</p>
                          <p className="text-[11px] font-bold text-slate-400">{num(x.payload?.price) > 0 ? `${formatMoney(x.payload.price)} · ` : ""}{tgt}</p>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={confirmPendingPurchase}
                      disabled={loading}
                      className="flex-1 rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 px-3 py-2 text-xs font-black text-white shadow-lg transition active:scale-95 disabled:opacity-50"
                    >
                      Да, записать
                    </button>
                    <button
                      onClick={cancelPendingPurchase}
                      disabled={loading}
                      className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-black text-slate-200 transition active:scale-95 hover:bg-white/10 disabled:opacity-50"
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              )}
              {pendingItems.length > 0 && (
                <div className="mb-2 flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2">
                  <span className="text-xs font-bold text-amber-200">
                    Жду ответ по закупке: {pendingItems.map((x) => normalizeProductEntityName(x.result?.name || x.payload?.name || x.form?.name || "товар")).join(", ")}
                  </span>
                  <button
                    onClick={() => { clearPendingAssistantState({ setPendingItems, setPendingVisibility, setPendingMenuTypeCreation, setPendingPurchaseConfirmation }); setMessages((p) => [...p, { role: "bot", text: "Ок, закрыла уточнения. Что дальше?" }]); }}
                    className="ml-auto shrink-0 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-bold text-slate-200 transition active:scale-95 hover:bg-white/10"
                  >
                    Отменить уточнения
                  </button>
                </div>
              )}
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
                    onClick={() => send(x)}
                    className="flex min-h-[40px] shrink-0 items-center rounded-full border border-white/10 bg-white/5 px-3.5 py-2.5 text-xs font-bold text-slate-300 transition active:scale-95 active:bg-white/15 hover:bg-white/10"
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
                  aria-label="Отправить"
                  title="Отправить"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 font-black text-white shadow-lg transition active:scale-95 disabled:opacity-50"
                >
                  {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Send size={18} />}
                </button>
              </div>
            </div>
          </section>

          {activeRightPanels > 0 && (
            <aside
              className="hidden min-w-0 flex-col gap-4 overflow-y-auto xl:flex xl:self-start"
              style={{ maxHeight: "calc(100dvh - 245px)" }}
            >
              {sidePanels.recent && (
                <div className="flex min-h-0 shrink-0 flex-col overflow-hidden rounded-[1.25rem] border border-white/10 bg-white/[0.06] p-4">
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
                <div className="shrink-0 rounded-[1.25rem] border border-white/10 bg-white/[0.06] p-4">
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
                <div className="shrink-0 rounded-[1.25rem] border border-white/10 bg-white/[0.06] p-4">
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

