import { useEffect, useMemo, useState } from "react";
import { del, get, post } from "../api";
import Modal from "../components/Modal";
import { formatMoney, money, num } from "../utils/format";

const UNIT_LABELS = {
  g: "г",
  kg: "кг",
  ml: "мл",
  l: "л",
  pcs: "шт",
  bottle: "бут",
  pack: "упак",
  box: "кор",
};

const SMART_UNIT_SETTINGS = {
  g: { controlMode: "approximate", lossPercent: "3", inventoryMethod: "average", packagingQuantity: "1", hint: "Для граммов система считает расход приблизительно и добавляет небольшой запас на потери." },
  kg: { controlMode: "approximate", lossPercent: "3", inventoryMethod: "average", packagingQuantity: "1000", hint: "1 кг = 1000 г. Удобно закупать килограммами, а списывать по граммам." },
  ml: { controlMode: "approximate", lossPercent: "5", inventoryMethod: "average", packagingQuantity: "1", hint: "Для жидкостей система учитывает проливы и перерасход кухни." },
  l: { controlMode: "approximate", lossPercent: "5", inventoryMethod: "average", packagingQuantity: "1000", hint: "1 литр = 1000 мл. Удобно для молока, сиропов и соусов." },
  pcs: { controlMode: "piece", lossPercent: "0", inventoryMethod: "fifo", packagingQuantity: "1", hint: "Штучный товар: стаканы, десерты, бутылки, упаковки. Списывается по штукам." },
  bottle: { controlMode: "piece", lossPercent: "0", inventoryMethod: "fifo", packagingQuantity: "1", hint: "Бутылочный учёт: удобно для сиропов, воды и напитков." },
  pack: { controlMode: "piece", lossPercent: "0", inventoryMethod: "fifo", packagingQuantity: "1", hint: "Упаковочный учёт: удобно для пачек, пакетов и коробок." },
  box: { controlMode: "piece", lossPercent: "0", inventoryMethod: "fifo", packagingQuantity: "1", hint: "Коробочный учёт: удобно для закупок коробками и пересчёта остатков." },
};

const getSmartSettings = (unit) =>
  SMART_UNIT_SETTINGS[unit] || SMART_UNIT_SETTINGS.pcs;

const cleanWarehouseProductName = (value = "") => {
  let n = String(value || "").toLowerCase().replace(/ё/g, "е");
  n = n
    .replace(/\b\d{4}[-./]\d{2}[-./]\d{2}t?\d{0,2}:?\d{0,2}:?\d{0,2}\b/gi, " ")
    .replace(/\b(купил|купила|купили|купи|купить|докупил|докупила|докупили|закупил|закупила|закупили|взял|взяла|взяли|добавил|добавила|добавили|приход|поступил|поступила|поступили|мой|закуп|закупка)\b/gi, " ")
    .replace(/\d+(?:[,.]\d+)?\s*(?:кг|килограмм\w*|гр|грамм\w*|мл|миллилитр\w*|л\b|литр\w*|шт|штук\w*|шту\w*|₽|руб\w*|р\b)/gi, " ")
    .replace(/\b(руб|рубль|рублей|рубля|лей|за|ща|по|цена|стоимость|сумма|и|а|я|мы|товар|сырье|сырьё|примерно|граммовк\w*)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const dict = { ганату: "гранат", ганата: "гранат", гранату: "гранат", граната: "гранат", гранаты: "гранат", помидоры: "помидоры", помидор: "помидоры", апельсины: "апельсин", апельсина: "апельсин", ананасы: "ананас", ананаса: "ананас" };
  return dict[n] || n.split(" ").map((w) => dict[w] || w).join(" ").trim();
};

const getSmartModeLabel = (item) => {
  const mode = item?.controlMode || item?.control_mode;
  if (mode === "piece") return "Штучный";
  if (mode === "exact") return "Точный";
  return "Умный";
};



const PURCHASE_UNIT_LABELS = {
  g: "граммами",
  kg: "килограммами",
  ml: "миллилитрами",
  l: "литрами",
  pcs: "штуками",
  bottle: "бутылками",
  pack: "упаковками",
  box: "коробками",
};

const CONTAINER_UNITS = ["box", "pack", "bottle"];

const toNumberText = (value) => String(value || "").replace(",", ".");

const normalizePurchaseUnit = (text) => {
  const t = String(text || "").toLowerCase();
  if (/кг|килограмм/.test(t)) return "kg";
  if (/гр|грамм/.test(t)) return "g";
  if (/мл|миллилитр/.test(t)) return "ml";
  if (/л\b|литр/.test(t)) return "l";
  if (/короб/.test(t)) return "box";
  if (/бутыл/.test(t)) return "bottle";
  if (/упак|пач/.test(t)) return "pack";
  if (/шт|штук|шту/.test(t)) return "pcs";
  return "pcs";
};

const baseUnitForText = (text, fallback = "g") => {
  const t = String(text || "").toLowerCase();
  if (/мл|литр|\bл\b/.test(t)) return "ml";
  if (/шт|штук|шту/.test(t)) return "pcs";
  if (/гр|грамм|кг|килограмм/.test(t)) return "g";
  return fallback;
};

const computeWarehouseAmount = (form) => {
  const purchaseQty = num(form.purchaseQuantity || form.quantity);
  const purchaseUnit = form.purchaseUnit || form.unit || "g";
  const storageUnit = form.unit || "g";
  const unitsPerPackage = Math.max(num(form.unitsPerPackage) || 1, 1);
  const basePerUnit = Math.max(num(form.basePerUnit) || 1, 1);

  if (purchaseQty <= 0) {
    return { quantity: 0, unit: storageUnit, unitCost: 0, text: "На склад попадёт: 0" };
  }

  let total = purchaseQty;
  let unit = storageUnit;
  let detail = "";

  if (purchaseUnit === "kg") {
    unit = "g";
    total = purchaseQty * 1000;
    detail = `${purchaseQty} кг × 1000 = ${total} г`;
  } else if (purchaseUnit === "l") {
    unit = "ml";
    total = purchaseQty * 1000;
    detail = `${purchaseQty} л × 1000 = ${total} мл`;
  } else if (purchaseUnit === "g" || purchaseUnit === "ml" || purchaseUnit === "pcs") {
    unit = purchaseUnit;
    total = purchaseQty;
    detail = `${purchaseQty} ${unitLabelPlain(unit)}`;
  } else if (CONTAINER_UNITS.includes(purchaseUnit)) {
    unit = storageUnit;
    total = purchaseQty * unitsPerPackage * basePerUnit;
    detail = `${purchaseQty} ${unitLabelPlain(purchaseUnit)} × ${unitsPerPackage} шт внутри × ${basePerUnit} ${unitLabelPlain(unit)} = ${total} ${unitLabelPlain(unit)}`;
  }

  const unitCost = total > 0 ? num(form.price) / total : 0;

  return { quantity: total, unit, unitCost, text: `На склад попадёт: ${total} ${unitLabelPlain(unit)}`, detail };
};

const unitLabelPlain = (unit) => UNIT_LABELS[unit] || unit || "";

const parseSmartPurchaseText = (text, currentForm) => {
  const raw = String(text || "").trim();
  const t = raw.toLowerCase().replace(/,/g, ".");
  const next = { ...currentForm };

  const priceMatch = t.match(/(?:за|цена|стоимость|на сумму)\s*(\d+(?:\.\d+)?)/) || t.match(/(\d+(?:\.\d+)?)\s*(?:₽|руб)/);
  if (priceMatch) next.price = priceMatch[1];

  const purchaseMatch = t.match(/(?:купил|купила|закупил|закупила|взял|взяла)?\s*(\d+(?:\.\d+)?)\s*(короб\w*|упак\w*|пач\w*|бутыл\w*|кг|килограмм\w*|гр|грамм\w*|мл|миллилитр\w*|л\b|литр\w*|шт|штук\w*|шту\w*)/);
  if (purchaseMatch) {
    next.purchaseQuantity = purchaseMatch[1];
    next.purchaseUnit = normalizePurchaseUnit(purchaseMatch[2]);
  }

  const insideMatch = t.match(/(?:внутри|в короб\w*|в упаков\w*|в пач\w*|в бутыл\w*)\D{0,20}(\d+(?:\.\d+)?)\s*(?:шт|штук|шту|пач\w*|бутыл\w*)/);
  if (insideMatch) next.unitsPerPackage = insideMatch[1];

  const pieceMatch = t.match(/(?:одна|один|1|в одной|в одном|штука|пачка|бутылка)\D{0,35}(\d+(?:\.\d+)?)\s*(г|гр|грамм\w*|мл|литр\w*|л\b|кг|килограмм\w*)/) ||
    t.match(/по\s*(\d+(?:\.\d+)?)\s*(г|гр|грамм\w*|мл|литр\w*|л\b|кг|килограмм\w*)/);
  if (pieceMatch) {
    let value = num(pieceMatch[1]);
    const u = normalizePurchaseUnit(pieceMatch[2]);
    if (u === "kg") value *= 1000;
    if (u === "l") value *= 1000;
    next.basePerUnit = String(value);
    next.unit = baseUnitForText(pieceMatch[2], next.unit);
    next.packagingQuantity = String(value);
  }

  if ((next.purchaseUnit === "kg" || next.purchaseUnit === "g") && !pieceMatch) next.unit = "g";
  if ((next.purchaseUnit === "l" || next.purchaseUnit === "ml") && !pieceMatch) next.unit = "ml";
  if (next.purchaseUnit === "pcs" && !pieceMatch) {
    next.unit = "pcs";
    next.basePerUnit = "1";
  }

  const nameSource = raw
    .replace(/купил[аи]?|закупил[аи]?|взял[аи]?/gi, "")
    .replace(/\d+(?:[,.]\d+)?\s*(короб\w*|упак\w*|пач\w*|бутыл\w*|кг|килограмм\w*|гр|грамм\w*|мл|миллилитр\w*|л\b|литр\w*|шт|штук\w*|шту\w*)/gi, "")
    .replace(/внутри.*$/i, "")
    .replace(/за\s*\d+.*$/i, "")
    .trim();
  const cleanName = cleanWarehouseProductName(nameSource);
  if (cleanName && cleanName.length <= 40) next.name = cleanName;

  return next;
};

const smartPieceSuggestion = (name, unit) => {
  const n = String(name || "").toLowerCase();
  if (unit === "g") {
    if (n.includes("апельсин")) return "180";
    if (n.includes("лимон")) return "100";
    if (n.includes("яблок")) return "180";
    if (n.includes("банан")) return "120";
    if (n.includes("лайм")) return "70";
    if (n.includes("яйц")) return "60";
    return "100";
  }
  if (unit === "ml") {
    if (n.includes("сироп")) return "700";
    return "1000";
  }
  return "1";
};

export default function WarehousePage() {
  const [items, setItems] = useState([]);
  const [movements, setMovements] = useState([]);

  const [addModal, setAddModal] = useState(false);
  const [writeOffModal, setWriteOffModal] = useState(false);
  const [historyModal, setHistoryModal] = useState(false);
  const [deletedModal, setDeletedModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [duplicateModal, setDuplicateModal] = useState(false);
  const [purchaseTargetItem, setPurchaseTargetItem] = useState(null);

  const [historyItem, setHistoryItem] = useState(null);
  const [historyBatches, setHistoryBatches] = useState([]);
  const [deletedItems, setDeletedItems] = useState([]);
  const [deleteTargetItem, setDeleteTargetItem] = useState(null);
  const [deleteReason, setDeleteReason] = useState("Дубль / ошибочно добавили");
  const [deleteNote, setDeleteNote] = useState("");
  const [duplicateSuggestions, setDuplicateSuggestions] = useState([]);

  const [showHidden, setShowHidden] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [smartInput, setSmartInput] = useState("");
  const [smartLoading, setSmartLoading] = useState(false);
  const [smartResult, setSmartResult] = useState(null);
  const [aiMessages, setAiMessages] = useState([
    {
      role: "bot",
      text: "Напиши закупку как человеку: например ‘купил молоко 6 шт по 10 пачек, каждая по 1 литру, цена 7200’. Я сама найду товар, посчитаю и добавлю на склад.",
    },
  ]);
  const [manualMode, setManualMode] = useState(false);

  const [form, setForm] = useState({
    name: "",
    quantity: "",
    purchaseQuantity: "",
    purchaseUnit: "g",
    unit: "g",
    price: "",
    minQuantity: "",
    supplier: "",
    expiryDate: "",
    note: "",
    controlMode: getSmartSettings("g").controlMode,
    lossPercent: getSmartSettings("g").lossPercent,
    inventoryMethod: getSmartSettings("g").inventoryMethod,
    packagingQuantity: getSmartSettings("g").packagingQuantity,
    unitsPerPackage: "1",
    basePerUnit: "1",
  });

  const [writeOffForm, setWriteOffForm] = useState({
    warehouseItemId: "",
    quantity: "",
    reason: "Утиль",
    note: "",
  });

  const load = async () => {
    const [warehouseList, movementList] = await Promise.all([
      get("/warehouse/items").catch(() => []),
      get("/warehouse/movements").catch(() => []),
    ]);

    setItems(warehouseList || []);
    setMovements(movementList || []);
  };

  useEffect(() => {
    load().catch((e) => setError(e.message || "Ошибка загрузки склада"));
  }, []);

  const isHidden = (item) =>
    Boolean(item.hidden || item.isHidden || item.is_hidden);

  const unitLabel = (unit) => UNIT_LABELS[unit] || unit || "";

  const minQty = (item) => num(item.minQuantity ?? item.min_quantity);

  const getUnitCost = (item) => {
    const direct =
      item?.unitCost ??
      item?.unit_cost ??
      item?.costPerUnit ??
      item?.cost_per_unit;

    if (direct !== undefined && direct !== null && Number(direct) > 0) {
      return money(direct);
    }

    const totalPrice = money(item?.price || item?.purchasePrice || 0);
    const quantity = num(item?.initialQuantity || item?.quantity || 0);

    if (!quantity) return 0;

    return totalPrice / quantity;
  };

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();

    return items.filter((item) => {
      const hidden = isHidden(item);
      const byHidden = showHidden ? true : !hidden;
      const bySearch = !q || String(item.name || "").toLowerCase().includes(q);

      return byHidden && bySearch;
    });
  }, [items, search, showHidden]);

  const activeItems = useMemo(
    () => items.filter((item) => !isHidden(item)),
    [items]
  );

  const stats = useMemo(() => {
    const totalValue = activeItems.reduce(
      (sum, item) => sum + num(item.quantity) * getUnitCost(item),
      0
    );

    const lowItems = activeItems.filter(
      (item) => minQty(item) > 0 && num(item.quantity) <= minQty(item)
    );

    return {
      count: activeItems.length,
      value: totalValue,
      low: lowItems.length,
      hidden: items.length - activeItems.length,
    };
  }, [items, activeItems]);

  const computedPurchase = computeWarehouseAmount(form);

  const resetForm = () => {
    setForm({
      name: "",
      quantity: "",
      purchaseQuantity: "",
      purchaseUnit: "g",
      unit: "g",
      price: "",
      minQuantity: "",
      supplier: "",
      expiryDate: "",
      note: "",
      controlMode: getSmartSettings("g").controlMode,
      lossPercent: getSmartSettings("g").lossPercent,
      inventoryMethod: getSmartSettings("g").inventoryMethod,
      packagingQuantity: getSmartSettings("g").packagingQuantity,
      unitsPerPackage: "1",
      basePerUnit: "1",
    });
    setDuplicateSuggestions([]);
    setPurchaseTargetItem(null);
    setSmartInput("");
    setSmartResult(null);
    setManualMode(false);
    setAiMessages([
      {
        role: "bot",
        text: "Напиши закупку как человеку. После отправки я сама добавлю товар на склад или прибавлю к существующему.",
      },
    ]);
  };

  const validateForm = () => {
    if (!form.name.trim()) {
      setError("Введите название сырья");
      return false;
    }

    const computed = computeWarehouseAmount(form);
    if (computed.quantity <= 0) {
      setError("Введите количество закупки больше 0");
      return false;
    }

    return true;
  };

  const applySmartUnit = (unit) => {
    const smart = getSmartSettings(unit);

    setForm((p) => ({
      ...p,
      unit,
      controlMode: smart.controlMode,
      lossPercent: smart.lossPercent,
      inventoryMethod: smart.inventoryMethod,
      packagingQuantity: unit === "g" || unit === "kg" ? smartPieceSuggestion(p.name, "g") : unit === "ml" || unit === "l" ? smartPieceSuggestion(p.name, "ml") : smart.packagingQuantity,
    }));
  };

  const payloadFromAnyForm = (sourceForm) => {
    const computed = computeWarehouseAmount(sourceForm);
    const noteParts = [];
    if (String(sourceForm.note || "").trim()) noteParts.push(String(sourceForm.note || "").trim());
    if (computed.detail) noteParts.push(`AI расчёт: ${computed.detail}`);

    return {
      name: cleanWarehouseProductName(sourceForm.name),
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

  const payloadFromForm = () => payloadFromAnyForm(form);

  const formFromAIResult = (result) => {
    const nextUnit = result.unit || result.storageUnit || "g";
    const nextPurchaseUnit = result.purchaseUnit || nextUnit;

    return {
      name: cleanWarehouseProductName(result.name || ""),
      purchaseQuantity: String(result.purchaseQuantity || result.quantity || ""),
      quantity: String(result.purchaseQuantity || result.quantity || ""),
      purchaseUnit: nextPurchaseUnit,
      unit: nextUnit,
      price: result.price ? String(result.price) : "",
      minQuantity: result.minQuantity ? String(result.minQuantity) : "",
      supplier: result.supplier || "",
      expiryDate: result.expiryDate || "",
      note: result.note || "",
      unitsPerPackage: String(result.unitsPerPackage || 1),
      basePerUnit: String(result.basePerUnit || result.packagingQuantity || 1),
      packagingQuantity: String(result.basePerUnit || result.packagingQuantity || 1),
      controlMode: getSmartSettings(nextUnit).controlMode,
      lossPercent: getSmartSettings(nextUnit).lossPercent,
      inventoryMethod: getSmartSettings(nextUnit).inventoryMethod,
    };
  };

  const validatePayload = (payload) => {
    if (!payload.name) return "Я не поняла название товара. Напиши, что именно купили.";
    if (num(payload.quantity) <= 0) return "Я не поняла количество. Напиши сколько купили и в какой упаковке.";
    return "";
  };

  const applyAIResultToForm = (result) => {
    const aiForm = formFromAIResult(result);
    setForm((p) => ({ ...p, ...aiForm }));

    if (result.matchedItemId) {
      const matched = items.find((item) => Number(item.id) === Number(result.matchedItemId));
      if (matched) {
        setPurchaseTargetItem(matched);
        setDuplicateSuggestions([]);
      }
    }

    return aiForm;
  };

  const handleSmartParse = async () => {
    const text = smartInput.trim();
    if (!text) {
      setError("Напиши закупку обычным языком");
      return;
    }

    setError("");
    setSmartLoading(true);
    setSmartResult(null);
    setAiMessages((p) => [...p, { role: "user", text }]);
    setSmartInput("");

    try {
      const result = await post("/ai/warehouse/parse", {
        text,
        items: items.map((item) => ({
          id: item.id,
          name: item.name,
          unit: item.unit,
          packagingQuantity: item.packagingQuantity ?? item.packaging_quantity ?? 0,
        })),
      });

      setSmartResult(result);
      const aiForm = applyAIResultToForm(result);
      const payload = payloadFromAnyForm(aiForm);
      const validationError = validatePayload(payload);

      if (validationError || result.questions?.length > 0) {
        setAiMessages((p) => [
          ...p,
          {
            role: "bot",
            text: result.questions?.length > 0 ? result.questions.join(" ") : validationError,
          },
        ]);
        return;
      }

      const matched = result.matchedItemId
        ? items.find((item) => Number(item.id) === Number(result.matchedItemId))
        : null;

      if (matched) {
        await post(`/warehouse/items/${matched.id}/purchase`, payload);
      } else {
        await post("/warehouse/items", payload);
      }

      const computed = computeWarehouseAmount(aiForm);
      setAiMessages((p) => [
        ...p,
        {
          role: "bot",
          text: `${matched ? `Готово, добавила закупку к товару “${matched.name}”.` : `Готово, создала товар “${payload.name}” на складе.`} ${computed.text}. Себестоимость: ${formatMoney(computed.unitCost)} за 1 ${unitLabel(computed.unit)}.`,
        },
      ]);

      await load();
    } catch (e) {
      setAiMessages((p) => [
        ...p,
        { role: "bot", text: e.message || "AI не смог разобрать или сохранить закупку." },
      ]);
      setError(e.message || "AI не смог разобрать закупку");
    } finally {
      setSmartLoading(false);
    }
  };

  const checkDuplicatesAndCreate = async () => {
    setError("");

    if (!validateForm()) return;

    const query = new URLSearchParams({
      name: cleanWarehouseProductName(form.name),
      unit: form.unit,
    }).toString();

    const suggestions = await get(`/warehouse/items/similar?${query}`).catch(
      () => []
    );

    if (suggestions?.length) {
      setDuplicateSuggestions(suggestions);
      setDuplicateModal(true);
      return;
    }

    await createNewItemAnyway();
  };

  const createNewItemAnyway = async () => {
    setError("");

    if (!validateForm()) return;

    await post("/warehouse/items", payloadFromForm());

    resetForm();
    setAddModal(false);
    setDuplicateModal(false);
    await load();
  };

  const addPurchaseToExisting = async (item) => {
    setError("");

    if (!validateForm()) return;

    await post(`/warehouse/items/${item.id}/purchase`, payloadFromForm());

    resetForm();
    setAddModal(false);
    setDuplicateModal(false);
    await load();
  };

  const openPurchaseForItem = (item) => {
    setError("");
    setDuplicateSuggestions([]);
    setPurchaseTargetItem(item);
    setForm({
      name: item.name || "",
      quantity: "",
      purchaseQuantity: "",
      purchaseUnit: item.unit || "g",
      unit: item.unit || "g",
      price: "",
      minQuantity: String(minQty(item) || ""),
      supplier: item.supplier || "",
      expiryDate: "",
      note: "",
      controlMode: item.controlMode || item.control_mode || "exact",
      lossPercent: String(item.lossPercent ?? item.loss_percent ?? "0"),
      inventoryMethod: item.inventoryMethod || item.inventory_method || "fifo",
      packagingQuantity: String(item.packagingQuantity ?? item.packaging_quantity ?? "1"),
      unitsPerPackage: "1",
      basePerUnit: String(item.packagingQuantity ?? item.packaging_quantity ?? "1"),
    });
    setSmartInput("");
    setAddModal(true);
  };

  const openWriteOff = (itemId = "") => {
    setWriteOffForm({
      warehouseItemId: itemId ? String(itemId) : "",
      quantity: "",
      reason: "Утиль",
      note: "",
    });
    setWriteOffModal(true);
  };

  const writeOffItem = async () => {
    setError("");

    if (!writeOffForm.warehouseItemId) {
      return setError("Выбери сырьё для списания");
    }

    if (num(writeOffForm.quantity) <= 0) {
      return setError("Введите количество списания");
    }

    await post(`/warehouse/items/${writeOffForm.warehouseItemId}/writeoff`, {
      quantity: num(writeOffForm.quantity),
      reason: writeOffForm.reason,
      note: writeOffForm.note,
    });

    setWriteOffModal(false);
    await load();
  };

  const toggleHidden = async (item) => {
    setError("");

    await post(`/warehouse/items/${item.id}/hide`, {
      hidden: !isHidden(item),
    });

    await load();
  };

  const openDeleteModal = (item) => {
    setError("");
    setDeleteTargetItem(item);
    setDeleteReason("Дубль / ошибочно добавили");
    setDeleteNote(`Удаляю ${item.name || "сырьё"}. Остаток на момент удаления: ${num(item.quantity)} ${unitLabel(item.unit)}.`);
    setDeleteModal(true);
  };

  const deleteItem = async () => {
    if (!deleteTargetItem) return;

    setError("");
    await del(`/warehouse/items/${deleteTargetItem.id}`, {
      reason: deleteReason,
      note: deleteNote,
    });

    setDeleteModal(false);
    setDeleteTargetItem(null);
    await load();
  };

  const openDeletedHistory = async () => {
    setError("");
    const list = await get("/warehouse/deleted-items").catch(() => []);
    setDeletedItems(list || []);
    setDeletedModal(true);
  };

  const openHistory = async (item) => {
    setError("");
    setHistoryItem(item);
    setHistoryModal(true);

    const list = await get(`/warehouse/items/${item.id}/batches`).catch(
      () => []
    );
    setHistoryBatches(list || []);
  };

  return (
    <div className="relative -m-4 min-h-screen overflow-hidden bg-[#050b1d] px-3 pb-nav pt-3 text-white sm:-m-6 sm:px-4 sm:pb-8 lg:px-5">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-28 -top-28 h-80 w-80 rounded-full bg-blue-600/20 blur-3xl" />
        <div className="absolute right-0 top-20 h-96 w-96 rounded-full bg-violet-600/20 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-96 w-96 rounded-full bg-cyan-500/10 blur-3xl" />
      </div>
      <div className="relative z-10 mx-auto max-w-[1480px]">
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-2xl">
          <p className="inline-flex rounded-full border border-blue-400/20 bg-blue-500/10 px-2.5 py-1 text-xs font-black text-blue-300">Склад</p>

          <h2 className="mt-2 text-3xl font-black leading-none tracking-tight text-white sm:text-4xl">
            Склад сырья
          </h2>

          <p className="mt-2 max-w-xl text-sm font-semibold leading-5 text-slate-300/80">
            Приход, остатки, себестоимость, защита от дублей, партии закупок и
            автоматическое списание при продаже.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap xl:justify-end xl:pt-0">
          <button
            type="button"
            onClick={() => openWriteOff()}
            className="rounded-xl border border-white/10 bg-white/[0.08] px-3 py-2 text-sm font-black text-white shadow-[0_10px_28px_rgba(0,0,0,.22)] transition hover:bg-white/12 flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <span>⊘</span>
            <span>Утиль / списание</span>
          </button>

          <button
            type="button"
            onClick={openDeletedHistory}
            className="rounded-xl border border-white/10 bg-white/[0.08] px-3 py-2 text-sm font-black text-white shadow-[0_10px_28px_rgba(0,0,0,.22)] transition hover:bg-white/12 flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <span>🗑</span>
            <span>История удалений</span>
          </button>

          <button
            type="button"
            onClick={load}
            className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm font-black text-white shadow-[0_10px_28px_rgba(0,0,0,.22)] transition hover:bg-slate-900 flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <span>⟳</span>
            <span>Обновить</span>
          </button>

          <button
            type="button"
            onClick={() => {
              resetForm();
              setPurchaseTargetItem(null);
              setAddModal(true);
            }}
            className="rounded-xl bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-2 text-sm font-black text-white shadow-[0_14px_36px_rgba(37,99,235,.35)] transition hover:scale-[1.01] flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <span className="text-lg leading-none">+</span>
            <span>Добавить закупку</span>
          </button>
        </div>
      </div>

  {error && (
        <div className="mb-4 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 font-bold text-red-200 backdrop-blur">
          {error}
        </div>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] p-4 shadow-[0_14px_45px_rgba(0,0,0,.22)] backdrop-blur-xl">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">
            Позиций сырья
          </p>
          <p className="mt-2 text-2xl font-black text-white">
            {stats.count}
          </p>
          <p className="mt-1 text-xs font-bold text-slate-400/90">
            активных позиций
          </p>
        </div>

        <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] p-4 shadow-[0_14px_45px_rgba(0,0,0,.22)] backdrop-blur-xl">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">
            Стоимость остатков
          </p>
          <p className="mt-2 text-2xl font-black text-white">
            {formatMoney(stats.value)}
          </p>
          <p className="mt-1 text-xs font-bold text-slate-400/90">
            по текущему остатку
          </p>
        </div>

        <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] p-4 shadow-[0_14px_45px_rgba(0,0,0,.22)] backdrop-blur-xl">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">
            Низкий остаток
          </p>
          <p
            className={`mt-2 text-3xl font-black ${
              stats.low > 0 ? "text-red-600" : "text-emerald-600"
            }`}
          >
            {stats.low}
          </p>
          <p className="mt-1 text-xs font-bold text-slate-400/90">
            ниже минимума
          </p>
        </div>

        <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] p-4 shadow-[0_14px_45px_rgba(0,0,0,.22)] backdrop-blur-xl">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">
            Скрытые
          </p>
          <p className="mt-2 text-2xl font-black text-white">
            {stats.hidden}
          </p>
          <p className="mt-1 text-xs font-bold text-slate-400/90">
            не в основном списке
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] shadow-[0_16px_55px_rgba(0,0,0,.30)] backdrop-blur-xl">
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-xl font-black text-white">
              Остатки на складе
            </h3>
            <p className="mt-1 text-xs font-semibold text-slate-400">
              Остаток считается после приходов, продаж и списаний.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по названию..."
              className="w-full rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm font-bold text-white outline-none transition placeholder:text-slate-500 focus:border-blue-400 sm:w-72"
            />

            <button
              type="button"
              onClick={() => setShowHidden((p) => !p)}
              className={
                showHidden
                  ? "rounded-xl border border-blue-400/40 bg-blue-500/20 px-3 py-2.5 text-sm font-black text-blue-100 whitespace-nowrap"
                  : "rounded-xl border border-white/10 bg-white/[0.08] px-3 py-2.5 text-sm font-black text-white whitespace-nowrap"
              }
            >
              {showHidden ? "Скрытые показаны" : "Показать скрытые"}
            </button>
          </div>
        </div>

        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[1180px] table-fixed text-left text-xs">
            <colgroup>
              <col className="w-[20%]" />
              <col className="w-[6%]" />
              <col className="w-[10%]" />
              <col className="w-[8%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[26%]" />
            </colgroup>

            <thead className="border-y border-white/10 bg-slate-950/45 text-[11px] uppercase tracking-[0.14em] text-slate-400">
              <tr>
                <th className="px-3 py-2">Сырьё</th>
                <th className="px-3 py-2">Ед.</th>
                <th className="px-3 py-2">Остаток</th>
                <th className="px-3 py-2">Мин.</th>
                <th className="px-3 py-2">Цена ед.</th>
                <th className="px-3 py-2">Сумма</th>
                <th className="px-3 py-2">Поставщик</th>
                <th className="px-3 py-2 text-center">Действия</th>
              </tr>
            </thead>

            <tbody>
              {visibleItems.map((item) => {
                const hidden = isHidden(item);
                const min = minQty(item);
                const qty = num(item.quantity);
                const unit = unitLabel(item.unit);
                const unitCost = getUnitCost(item);
                const totalValue = qty * unitCost;
                const low = min > 0 && qty <= min;

                return (
                  <tr
                    key={item.id}
                    className={`border-b border-white/[0.08] ${
                      hidden ? "bg-white/[0.03] opacity-55" : "bg-transparent hover:bg-white/[0.03]"
                    }`}
                  >
                    <td className="px-3 py-2 align-middle">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-black text-white">
                            {item.name}
                          </span>

                          <span className="shrink-0 rounded-lg bg-blue-500/15 px-2 py-1 text-[10px] font-black text-blue-300">
                            {getSmartModeLabel(item)}
                          </span>

                          {hidden && (
                            <span className="shrink-0 rounded-lg bg-slate-700 px-2 py-1 text-[10px] font-black text-slate-300">
                              скрыто
                            </span>
                          )}
                        </div>

                        {item.note && (
                          <p className="mt-1 truncate text-xs font-bold text-slate-400">
                            {item.note}
                          </p>
                        )}
                      </div>
                    </td>

                    <td className="px-3 py-2 align-middle font-bold text-slate-300">
                      {unit}
                    </td>

                    <td
                      className={`px-3 py-2 align-middle font-black ${
                        low ? "text-red-600" : "text-emerald-600"
                      }`}
                    >
                      {qty} {unit}
                    </td>

                    <td className="px-3 py-2 align-middle font-bold text-slate-300">
                      {min} {unit}
                    </td>

                    <td className="px-3 py-2 align-middle font-bold text-white">
                      {formatMoney(unitCost)}
                    </td>

                    <td className="px-3 py-2 align-middle font-black text-white">
                      {formatMoney(totalValue)}
                    </td>

                    <td className="px-3 py-2 align-middle text-slate-400">
                      <span className="block truncate">
                        {item.supplier || "—"}
                      </span>
                    </td>

                    <td className="px-3 py-2 align-middle">
                      <div className="grid grid-cols-[92px_40px_74px_68px_72px] items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => openPurchaseForItem(item)}
                          className="h-9 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-2 text-[11px] font-black leading-none text-emerald-300 transition hover:bg-emerald-400/20"
                          title="Добавить новую закупку к этому товару"
                        >
                          + Закупка
                        </button>

                        <button
                          type="button"
                          onClick={() => openHistory(item)}
                          className="flex h-9 items-center justify-center rounded-xl border border-blue-400/20 bg-blue-400/10 text-sm font-black text-blue-300 transition hover:bg-blue-400/20"
                          title="История закупок"
                          aria-label="История закупок"
                        >
                          🕘
                        </button>

                        <button
                          type="button"
                          onClick={() => openWriteOff(item.id)}
                          className="h-9 rounded-xl border border-red-400/20 bg-red-400/10 px-2 text-[11px] font-black text-red-300 transition hover:bg-red-400/20"
                        >
                          Списать
                        </button>

                        <button
                          type="button"
                          onClick={() => toggleHidden(item)}
                          className="h-9 rounded-xl border border-white/10 bg-white/[0.08] px-2 text-[11px] font-black text-slate-200 transition hover:bg-white/12"
                        >
                          {hidden ? "Показать" : "Скрыть"}
                        </button>

                        <button
                          type="button"
                          onClick={() => openDeleteModal(item)}
                          className="h-9 rounded-xl bg-red-500/90 px-2 text-[11px] font-black text-white transition hover:bg-red-500"
                          title="Удалить товар из активного склада с записью в историю"
                        >
                          Удалить
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!visibleItems.length && (
                <tr>
                  <td colSpan="8" className="p-10 text-center text-slate-400">
                    Сырья пока нет
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="divide-y divide-white/10 lg:hidden">
          {visibleItems.map((item) => {
            const hidden = isHidden(item);
            const min = minQty(item);
            const qty = num(item.quantity);
            const unit = unitLabel(item.unit);
            const unitCost = getUnitCost(item);
            const low = min > 0 && qty <= min;

            return (
              <div
                key={item.id}
                className={`p-3 ${hidden ? "bg-white/[0.03] opacity-60" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-black text-white">
                      {item.name}
                    </p>
                    <p className="text-sm text-slate-400">
                      {item.supplier || "Поставщик не указан"}
                    </p>
                    <p className="mt-1 inline-flex rounded-xl bg-blue-500/15 px-2 py-1 text-xs font-black text-blue-300">
                      {getSmartModeLabel(item)} режим
                    </p>
                  </div>

                  <p
                    className={`font-black ${
                      low ? "text-red-600" : "text-emerald-600"
                    }`}
                  >
                    {qty} {unit}
                  </p>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-xl border border-white/10 bg-slate-950/45 p-2.5">
                    <p className="text-slate-400">Мин.</p>
                    <p className="font-black">
                      {min} {unit}
                    </p>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-slate-950/45 p-2.5">
                    <p className="text-slate-400">Цена ед.</p>
                    <p className="font-black">{formatMoney(unitCost)}</p>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-slate-950/45 p-2.5">
                    <p className="text-slate-400">Сумма</p>
                    <p className="font-black">{formatMoney(qty * unitCost)}</p>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-slate-950/45 p-2.5">
                    <p className="text-slate-400">Ед.</p>
                    <p className="font-black">{unit}</p>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <button
                    type="button"
                    onClick={() => openPurchaseForItem(item)}
                    className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-sm font-black text-emerald-300"
                  >
                    + Закупка
                  </button>

                  <button
                    type="button"
                    onClick={() => openHistory(item)}
                    className="rounded-xl border border-blue-400/20 bg-blue-400/10 px-3 py-2 text-sm font-black text-blue-300"
                  >
                    🕘 История
                  </button>

                  <button
                    type="button"
                    onClick={() => openWriteOff(item.id)}
                    className="rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm font-black text-red-300"
                  >
                    Списать
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleHidden(item)}
                    className="rounded-xl border border-white/10 bg-white/[0.08] px-3 py-2 text-sm font-black text-slate-200"
                  >
                    {hidden ? "Показать" : "Скрыть"}
                  </button>

                  <button
                    type="button"
                    onClick={() => openDeleteModal(item)}
                    className="rounded-xl bg-red-600 px-3 py-2 text-sm font-black text-white"
                  >
                    Удалить
                  </button>
                </div>
              </div>
            );
          })}

          {!visibleItems.length && (
            <div className="p-8 text-center text-slate-500">
              Сырья пока нет
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-white/10 px-4 py-3 text-xs font-semibold text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Показано {visibleItems.length} из {items.length}
          </span>

          <span>Движений склада: {movements.length}</span>
        </div>
      </div>

      {movements.length > 0 && (
        <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] shadow-[0_16px_55px_rgba(0,0,0,.30)] backdrop-blur-xl">
          <div className="p-4">
            <h3 className="text-xl font-black text-white">
              Последние движения
            </h3>
            <p className="mt-1 text-xs font-semibold text-slate-400">
              Приходы, продажи и списания по складу.
            </p>
          </div>

          <div className="divide-y divide-white/10">
            {movements.slice(0, 8).map((m) => {
              const type = String(m.movementType || m.movement_type || "");
              const unit = unitLabel(m.unit);

              return (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div>
                    <p className="font-black text-white">
                      {m.itemName || m.item_name || "Сырьё"}
                    </p>
                    <p className="text-sm text-slate-400">
                      {m.reason || type} {m.note ? `· ${m.note}` : ""}
                    </p>
                  </div>

                  <p
                    className={`font-black ${
                      type === "in" ? "text-emerald-600" : "text-red-600"
                    }`}
                  >
                    {type === "in" ? "+" : "-"}
                    {num(m.quantity)} {unit}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      </div>

      {deleteModal && (
        <Modal title={`Удалить товар: ${deleteTargetItem?.name || "сырьё"}`} wide>
          <div className="rounded-3xl bg-red-50 p-4 text-red-800">
            <p className="font-black">Товар уйдёт из активного склада, но останется в истории удалений.</p>
            <p className="mt-1 text-sm font-bold">
              Остаток на момент удаления: {num(deleteTargetItem?.quantity)} {unitLabel(deleteTargetItem?.unit)} · сумма {formatMoney(num(deleteTargetItem?.quantity) * getUnitCost(deleteTargetItem || {}))}
            </p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <select
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              className="input"
            >
              <option>Дубль / ошибочно добавили</option>
              <option>Больше не используем</option>
              <option>Испорчено / списано полностью</option>
              <option>Перенесли в другой товар</option>
              <option>Другая причина</option>
            </select>

            <input
              value={deleteNote}
              onChange={(e) => setDeleteNote(e.target.value)}
              placeholder="Объяснение для истории"
              className="input"
            />
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={() => setDeleteModal(false)} className="btn-white flex-1">
              Отмена
            </button>
            <button type="button" onClick={deleteItem} className="flex-1 rounded-2xl bg-red-600 px-5 py-3 font-black text-white shadow-sm transition hover:bg-red-700">
              Удалить и записать в историю
            </button>
          </div>
        </Modal>
      )}

      {deletedModal && (
        <Modal title="История удалённых товаров" wide>
          <div className="rounded-3xl bg-slate-50 p-4 text-sm font-bold text-slate-600">
            Здесь видно, что удалили, когда, какой был остаток и почему. Это не смешивается со скрытыми товарами.
          </div>

          <div className="mt-4 overflow-x-auto rounded-3xl border border-slate-200">
            <table className="w-full min-w-[840px] text-left text-sm">
              <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Дата удаления</th>
                  <th className="px-3 py-2">Товар</th>
                  <th className="px-3 py-2">Остаток</th>
                  <th className="px-3 py-2">Сумма</th>
                  <th className="px-3 py-2">Причина</th>
                  <th className="px-3 py-2">Объяснение</th>
                </tr>
              </thead>
              <tbody>
                {deletedItems.map((item) => (
                  <tr key={item.id} className="border-t border-slate-100">
                    <td className="p-3 font-bold text-slate-700">{String(item.deletedAt || "").slice(0, 16).replace("T", " ") || "—"}</td>
                    <td className="p-3 font-black text-slate-950">{item.name}</td>
                    <td className="p-3 font-black text-red-600">{num(item.quantity)} {unitLabel(item.unit)}</td>
                    <td className="p-3 font-black">{formatMoney(item.totalValue || num(item.quantity) * num(item.unitCost))}</td>
                    <td className="p-3 font-bold text-slate-700">{item.deleteReason || "—"}</td>
                    <td className="p-3 text-slate-600">{item.deleteNote || item.note || "—"}</td>
                  </tr>
                ))}
                {!deletedItems.length && (
                  <tr>
                    <td colSpan="6" className="p-8 text-center text-slate-500">Удалённых товаров пока нет</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-6 flex justify-end">
            <button type="button" onClick={() => setDeletedModal(false)} className="btn-blue">Закрыть</button>
          </div>
        </Modal>
      )}

      {historyModal && (
        <Modal title={`История закупок: ${historyItem?.name || "сырьё"}`} wide>
          <div className="mb-4 rounded-3xl bg-slate-50 p-4">
            <p className="text-sm font-bold text-slate-500">Текущий остаток</p>
            <p className="mt-1 text-2xl font-black text-slate-950">
              {num(historyItem?.quantity)} {unitLabel(historyItem?.unit)} ·
              средняя цена {formatMoney(getUnitCost(historyItem || {}))}
            </p>
          </div>

          <div className="overflow-x-auto rounded-3xl border border-slate-200">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Дата</th>
                  <th className="px-3 py-2">Купили</th>
                  <th className="px-3 py-2">Осталось</th>
                  <th className="px-3 py-2">Цена закупки</th>
                  <th className="px-3 py-2">Цена ед.</th>
                  <th className="px-3 py-2">Поставщик</th>
                  <th className="px-3 py-2">Комментарий</th>
                </tr>
              </thead>

              <tbody>
                {historyBatches.map((b) => (
                  <tr key={b.id} className="border-t border-slate-100">
                    <td className="p-3 font-bold text-slate-700">
                      {String(b.createdAt || "").slice(0, 10) || "—"}
                    </td>
                    <td className="p-3 font-black">
                      {num(b.quantity)} {unitLabel(historyItem?.unit)}
                    </td>
                    <td className="p-3 font-black text-emerald-600">
                      {num(b.remainingQuantity)}{" "}
                      {unitLabel(historyItem?.unit)}
                    </td>
                    <td className="p-3 font-black">
                      {formatMoney(b.purchasePrice)}
                    </td>
                    <td className="p-3 font-bold">
                      {formatMoney(b.unitCost)}
                    </td>
                    <td className="p-3 text-slate-600">
                      {b.supplier || "—"}
                    </td>
                    <td className="p-3 text-slate-600">{b.note || "—"}</td>
                  </tr>
                ))}

                {!historyBatches.length && (
                  <tr>
                    <td colSpan="7" className="p-8 text-center text-slate-500">
                      Истории закупок пока нет
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={() => setHistoryModal(false)}
              className="btn-blue"
            >
              Закрыть
            </button>
          </div>
        </Modal>
      )}

      {duplicateModal && (
        <Modal title="Похожий товар уже есть" wide>
          <div className="rounded-3xl bg-yellow-50 p-4 text-yellow-800">
            <p className="font-black">Защита от дублей</p>
            <p className="mt-1 text-sm font-bold">
              Ты вводишь “{form.name}”. Возможно, это уже есть на складе.
              Лучше добавить новую закупку к существующему товару, чтобы
              остатки и себестоимость считались правильно.
            </p>
          </div>

          <div className="mt-4 space-y-3">
            {duplicateSuggestions.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-3 rounded-3xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-xl font-black text-slate-950">
                    {item.name}
                  </p>
                  <p className="text-sm font-bold text-slate-500">
                    Остаток: {num(item.quantity)} {unitLabel(item.unit)} ·
                    похожесть {Math.round(num(item.score) * 100)}%
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => addPurchaseToExisting(item)}
                  className="btn-blue"
                >
                  Добавить закупку сюда
                </button>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => setDuplicateModal(false)}
              className="btn-white flex-1"
            >
              Вернуться
            </button>

            <button
              type="button"
              onClick={createNewItemAnyway}
              className="flex-1 rounded-2xl bg-red-600 px-5 py-3 font-black text-white shadow-sm transition hover:bg-red-700"
            >
              Всё равно создать новый
            </button>
          </div>
        </Modal>
      )}

      {addModal && (
        <Modal title={purchaseTargetItem ? `Новая закупка: ${purchaseTargetItem.name}` : "Добавить закупку вручную"} wide>
          <div className="rounded-[2rem] border border-slate-200 bg-white p-4 sm:p-5">
            <div className="mb-4 rounded-3xl bg-blue-50 p-4">
              <p className="text-sm font-black text-blue-700">Ручной режим склада</p>
              <p className="mt-1 text-sm font-bold leading-6 text-blue-900/70">
                AI-чат теперь находится на отдельной странице “AI-склад”. Здесь обычное добавление закупки вручную.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <input
                value={form.name}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    name: e.target.value,
                    packagingQuantity: (p.unit === "g" || p.unit === "ml") ? smartPieceSuggestion(e.target.value, p.unit) : p.packagingQuantity,
                  }))
                }
                placeholder="Зерно, рис, курица, молоко..."
                className="input sm:col-span-2"
              />

              <input
                value={form.purchaseQuantity || form.quantity}
                onChange={(e) =>
                  setForm((p) => ({ ...p, purchaseQuantity: e.target.value, quantity: e.target.value }))
                }
                placeholder="Сколько купили"
                type="number"
                className="input"
              />

              <select
                value={form.purchaseUnit || form.unit}
                onChange={(e) => {
                  const purchaseUnit = e.target.value;
                  setForm((p) => {
                    const storageUnit = purchaseUnit === "kg" ? "g" : purchaseUnit === "l" ? "ml" : purchaseUnit === "g" || purchaseUnit === "ml" || purchaseUnit === "pcs" ? purchaseUnit : p.unit;
                    return {
                      ...p,
                      purchaseUnit,
                      unit: storageUnit,
                      controlMode: getSmartSettings(storageUnit).controlMode,
                      lossPercent: getSmartSettings(storageUnit).lossPercent,
                      inventoryMethod: getSmartSettings(storageUnit).inventoryMethod,
                      basePerUnit: storageUnit === "pcs" ? "1" : p.basePerUnit,
                    };
                  });
                }}
                className="input"
              >
                <option value="g">Закупаю граммами</option>
                <option value="kg">Закупаю килограммами</option>
                <option value="ml">Закупаю миллилитрами</option>
                <option value="l">Закупаю литрами</option>
                <option value="pcs">Закупаю штуками</option>
                <option value="bottle">Закупаю бутылками</option>
                <option value="pack">Закупаю упаковками</option>
                <option value="box">Закупаю коробками</option>
              </select>

              {CONTAINER_UNITS.includes(form.purchaseUnit) && (
                <>
                  <input
                    value={form.unitsPerPackage}
                    onChange={(e) => setForm((p) => ({ ...p, unitsPerPackage: e.target.value }))}
                    placeholder="Сколько шт внутри"
                    type="number"
                    className="input"
                  />

                  <input
                    value={form.basePerUnit}
                    onChange={(e) => setForm((p) => ({ ...p, basePerUnit: e.target.value, packagingQuantity: e.target.value }))}
                    placeholder={`Сколько ${unitLabel(form.unit)} в 1 штуке`}
                    type="number"
                    className="input"
                  />

                  <select
                    value={form.unit}
                    onChange={(e) => applySmartUnit(e.target.value)}
                    className="input sm:col-span-2"
                  >
                    <option value="g">Хранить/списывать граммами</option>
                    <option value="ml">Хранить/списывать миллилитрами</option>
                    <option value="pcs">Хранить/списывать штуками</option>
                  </select>
                </>
              )}

              <input
                value={form.price}
                onChange={(e) => setForm((p) => ({ ...p, price: e.target.value }))}
                placeholder="Общая цена закупки"
                type="number"
                className="input"
              />

              <input
                value={form.minQuantity}
                onChange={(e) => setForm((p) => ({ ...p, minQuantity: e.target.value }))}
                placeholder="Минимальный остаток"
                type="number"
                className="input"
              />

              <input
                value={form.supplier}
                onChange={(e) => setForm((p) => ({ ...p, supplier: e.target.value }))}
                placeholder="Поставщик"
                className="input"
              />

              <input
                value={form.expiryDate}
                onChange={(e) => setForm((p) => ({ ...p, expiryDate: e.target.value }))}
                type="date"
                className="input"
              />

              <input
                value={form.note}
                onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
                placeholder="Комментарий / партия"
                className="input sm:col-span-2"
              />
            </div>

            <div className="mt-4 rounded-3xl bg-slate-50 p-4">
              <p className="text-sm font-bold text-slate-500">Проверка перед сохранением</p>
              <p className="mt-1 text-xl font-black text-slate-950">{computedPurchase.text}</p>
              {computedPurchase.detail && (
                <p className="mt-1 text-sm font-bold text-slate-500">{computedPurchase.detail}</p>
              )}
              <p className="mt-3 text-sm font-bold text-slate-500">Себестоимость 1 {unitLabel(computedPurchase.unit)}</p>
              <p className="text-2xl font-black text-blue-600">{formatMoney(computedPurchase.unitCost)}</p>
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => {
                  setAddModal(false);
                  resetForm();
                }}
                className="btn-white flex-1"
              >
                Закрыть
              </button>

              <button
                type="button"
                onClick={() =>
                  purchaseTargetItem
                    ? addPurchaseToExisting(purchaseTargetItem)
                    : checkDuplicatesAndCreate()
                }
                className="btn-blue flex-1"
              >
                Сохранить закупку
              </button>
            </div>
          </div>
        </Modal>
      )}

      
{writeOffModal && (
        <Modal title="Утиль / списание">
          <div className="space-y-3">
            <select
              value={writeOffForm.warehouseItemId}
              onChange={(e) =>
                setWriteOffForm((p) => ({
                  ...p,
                  warehouseItemId: e.target.value,
                }))
              }
              className="input w-full"
            >
              <option value="">Выбери сырьё</option>
              {items
                .filter((item) => !isHidden(item))
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} — остаток {num(item.quantity)}{" "}
                    {unitLabel(item.unit)}
                  </option>
                ))}
            </select>

            <input
              value={writeOffForm.quantity}
              onChange={(e) =>
                setWriteOffForm((p) => ({
                  ...p,
                  quantity: e.target.value,
                }))
              }
              placeholder="Количество списания"
              type="number"
              className="input w-full"
            />

            <select
              value={writeOffForm.reason}
              onChange={(e) =>
                setWriteOffForm((p) => ({
                  ...p,
                  reason: e.target.value,
                }))
              }
              className="input w-full"
            >
              <option value="Утиль">Утиль</option>
              <option value="Просрочилось">Просрочилось</option>
              <option value="Брак">Брак</option>
              <option value="Потеря">Потеря</option>
              <option value="Другое">Другое</option>
            </select>

            <input
              value={writeOffForm.note}
              onChange={(e) =>
                setWriteOffForm((p) => ({
                  ...p,
                  note: e.target.value,
                }))
              }
              placeholder="Комментарий"
              className="input w-full"
            />
          </div>

          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => setWriteOffModal(false)}
              className="btn-white flex-1"
            >
              Отмена
            </button>

            <button
              type="button"
              onClick={writeOffItem}
              className="flex-1 rounded-2xl bg-red-600 px-5 py-3 font-black text-white shadow-sm transition hover:bg-red-700"
            >
              Списать
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
