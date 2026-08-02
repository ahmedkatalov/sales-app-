import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { get, getSession, post } from "../api";
import Modal from "../components/Modal";
import { formatMoney, money, num } from "../utils/format";
import { useIngredientSuggest } from "../hooks/useIngredientSuggest";

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

const RECIPE_UNITS = [
  ["g", "г"],
  ["kg", "кг"],
  ["ml", "мл"],
  ["l", "л"],
  ["pcs", "шт"],
  ["bottle", "бут"],
  ["pack", "упак"],
  ["box", "кор"],
];

const normalizeUnitPreview = (unit, quantity) => {
  const q = num(quantity);
  switch (String(unit || "").toLowerCase()) {
    case "kg":
      return ["g", q * 1000];
    case "l":
      return ["ml", q * 1000];
    case "g":
    case "ml":
    case "pcs":
    case "bottle":
    case "pack":
    case "box":
      return [unit, q];
    default:
      return ["pcs", q];
  }
};

const guessOnePieceToBasePreview = (name, storageUnit) => {
  const n = String(name || "").toLowerCase();
  if (storageUnit === "g") {
    if (n.includes("апельсин")) return 180;
    if (n.includes("лимон")) return 100;
    if (n.includes("яблок")) return 180;
    if (n.includes("банан")) return 120;
    if (n.includes("лайм")) return 70;
    if (n.includes("яйц")) return 60;
    return 100;
  }
  if (storageUnit === "ml") {
    if (n.includes("сироп")) return 700;
    return 1000;
  }
  return 1;
};

const convertRecipePreview = (item, quantity, unit) => {
  if (!item) return { storageQty: 0, note: "" };
  const [fromUnit, fromQty] = normalizeUnitPreview(unit || item.unit, quantity);
  const storageUnit = item.unit;
  let storageQty = fromQty;
  let note = "";

  if (fromUnit === storageUnit) {
    storageQty = fromQty;
    note = "единицы совпадают";
  } else if (["pcs", "bottle", "pack", "box"].includes(fromUnit) && ["g", "ml"].includes(storageUnit)) {
    const perOne = Number(item.packagingQuantity ?? item.packaging_quantity) || guessOnePieceToBasePreview(item.name, storageUnit);
    storageQty = num(quantity) * perOne;
    note = `1 ${UNIT_LABELS[fromUnit] || fromUnit} ≈ ${perOne} ${UNIT_LABELS[storageUnit] || storageUnit}`;
  } else if (["pcs", "bottle", "pack", "box"].includes(storageUnit) && ["g", "ml"].includes(fromUnit)) {
    const perOne = Number(item.packagingQuantity ?? item.packaging_quantity) || guessOnePieceToBasePreview(item.name, fromUnit);
    storageQty = fromQty / perOne;
    note = `${perOne} ${UNIT_LABELS[fromUnit] || fromUnit} ≈ 1 ${UNIT_LABELS[storageUnit] || storageUnit}`;
  }

  const loss = Number(item.lossPercent ?? item.loss_percent) || 0;
  if (loss > 0) {
    storageQty *= 1 + loss / 100;
    note += `${note ? "; " : ""}потери +${loss}%`;
  }

  return { storageQty, note };
};


// ─── AI-компонент ввода ингредиента вручную ──────────────────────────────────
// Использует бэкенд /ai/ingredient/suggest: исправляет название из знаний модели
// (даже если позиции нет на складе) и привязывает к складу для верной связки.
// Список рендерится в портал (fixed), чтобы его не обрезала прокручиваемая модалка.
function SmartIngredientInputPOS({ value, onChange, warehouseItems = [], onSelectItem }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  // AI-подсказки: общий хук (защита от гонок + кэш).
  const { suggestions: aiSuggestions, loading: aiLoading } = useIngredientSuggest(value, warehouseItems);

  const q = (value || "").trim().toLowerCase();
  const localMatches = q.length >= 1
    ? warehouseItems.filter((i) => (i.name || "").toLowerCase().includes(q)).slice(0, 5)
    : [];

  const norm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const seen = new Set(localMatches.map((m) => norm(m.name)));
  const seenIds = new Set(localMatches.map((m) => String(m.id)));
  const merged = [
    ...localMatches.map((m) => ({ key: "w" + m.id, name: m.name, warehouseId: m.id, sub: `остаток: ${m.quantity} ${m.unit}`, source: "warehouse" })),
    ...aiSuggestions
      .filter((s) => {
        if (!s?.name || seen.has(norm(s.name))) return false;
        if (s.warehouseId && seenIds.has(String(s.warehouseId))) return false;
        seen.add(norm(s.name));
        return true;
      })
      .map((s) => ({ key: "ai-" + (s.warehouseId ?? norm(s.name)), name: s.name, warehouseId: s.warehouseId || null, sub: s.hint || (s.warehouseId ? "есть на складе" : "новый ингредиент"), source: s.warehouseId ? "warehouse" : "ai" })),
  ].slice(0, 7);

  const updateRect = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ left: r.left, top: r.bottom + 6, width: r.width });
  }, []);

  useEffect(() => {
    if (!open) return;
    updateRect();
    const reposition = () => updateRect();
    const onDown = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      if (e.target.closest?.("[data-pos-ingredient-dropdown]")) return;
      setOpen(false);
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, updateRect]);

  const handleSelect = (s) => {
    onChange(s.name);
    if (s.warehouseId) onSelectItem(s.warehouseId);
    setOpen(false);
  };

  return (
    <div className="relative sm:col-span-4" ref={wrapRef}>
      <div className="relative flex items-center">
        <span className="pointer-events-none absolute left-3 text-sm">✨</span>
        <input ref={inputRef} type="text" value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Введи название — AI найдёт правильное..."
          className="w-full rounded-2xl border border-violet-400/30 bg-violet-500/8 py-2.5 pl-8 pr-8 text-sm font-bold text-white outline-none placeholder:text-slate-500 focus:border-violet-400/60 focus:ring-2 focus:ring-violet-500/20"
        />
        {aiLoading && <span className="absolute right-3"><span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-violet-400/30 border-t-violet-400" /></span>}
      </div>
      {open && merged.length > 0 && rect && createPortal(
        <div data-pos-ingredient-dropdown
          style={{ position: "fixed", left: rect.left, top: rect.top, width: rect.width, zIndex: 80 }}
          className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl shadow-black/50">
          {merged.map((s) => (
            <button key={s.key} type="button" onMouseDown={(e) => { e.preventDefault(); handleSelect(s); }}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/8">
              <span className={`shrink-0 rounded-lg px-2 py-0.5 text-[10px] font-black ${s.source === "warehouse" ? "bg-emerald-500/20 text-emerald-300" : "bg-violet-500/20 text-violet-300"}`}>
                {s.source === "warehouse" ? "склад" : "AI"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black text-white">{s.name}</p>
                {s.sub && <p className="text-xs text-slate-400">{s.sub}</p>}
              </div>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

export default function POSPage({ currentProfile, ownerName, openProfile }) {
  const session = getSession();
  const isWorkspaceUser =
    session?.role === "worker" || session?.role === "workspace";

  const [sections, setSections] = useState([]);
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [cards, setCards] = useState([]);
  const [warehouseItems, setWarehouseItems] = useState([]);

  const [selectedSectionId, setSelectedSectionId] = useState("all");
  const [openedCategory, setOpenedCategory] = useState(null);
  const [search, setSearch] = useState("");

  const [cart, setCart] = useState([]);
  const [discount, setDiscount] = useState("");
  const [paymentModal, setPaymentModal] = useState(false);
  const [submitting, setSubmitting] = useState(false); // защита от двойного проведения продажи
  const [paymentType, setPaymentType] = useState("cash");
  const [paidAmount, setPaidAmount] = useState("");
  const [cardId, setCardId] = useState("");
  const [debtName, setDebtName] = useState("");
  const [debtCustomers, setDebtCustomers] = useState([]);

  const [sectionModal, setSectionModal] = useState(false);
  const [categoryModal, setCategoryModal] = useState(false);
  const [productModal, setProductModal] = useState(false);
  const [inlineSection, setInlineSection] = useState(false);
  const [inlineCategory, setInlineCategory] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [aiSuggestionLoading, setAiSuggestionLoading] = useState(false);
  const [aiAdvisorEnabled, setAiAdvisorEnabled] = useState(true);
  const aiDebounceRef = useRef(null);

  // Денежная смена (касса)
  const [cashShift, setCashShift] = useState(null); // объект смены или null
  const [shiftModal, setShiftModal] = useState(null); // 'open' | 'close' | 'in' | 'out'
  const [shiftInput, setShiftInput] = useState("");
  const [shiftNote, setShiftNote] = useState("");
  const [shiftResult, setShiftResult] = useState(null); // итог закрытия

  const loadCashShift = async () => {
    try {
      const r = await get("/cash/shift/current");
      setCashShift(r?.open ? r.shift : null);
    } catch { /* ignore */ }
  };
  useEffect(() => { loadCashShift(); }, []);

  const openShift = async () => {
    try {
      const r = await post("/cash/shift/open", { openingCash: num(shiftInput), openedBy: currentProfile?.name || "" });
      setCashShift(r?.shift || null);
      setShiftModal(null); setShiftInput(""); setShiftNote("");
    } catch (e) { setError(e.message); }
  };
  const addShiftMovement = async (type) => {
    try {
      const r = await post("/cash/movement", { type, amount: num(shiftInput), note: shiftNote, by: currentProfile?.name || "" });
      setCashShift(r?.shift || null);
      setShiftModal(null); setShiftInput(""); setShiftNote("");
    } catch (e) { setError(e.message); }
  };
  const closeShift = async () => {
    try {
      const r = await post("/cash/shift/close", { countedCash: num(shiftInput), closedBy: currentProfile?.name || "", note: shiftNote });
      setShiftResult(r);
      setCashShift(null);
      setShiftModal(null); setShiftInput(""); setShiftNote("");
      await loadCashShift();
    } catch (e) { setError(e.message); }
  };

  const [newSectionName, setNewSectionName] = useState("");
  const [newCategory, setNewCategory] = useState({ name: "", sectionId: "" });
  const [newProduct, setNewProduct] = useState({
    categoryId: "",
    name: "",
    price: "",
    cost: "",
  });
  const [recipe, setRecipe] = useState([]);

  const [error, setError] = useState("");

  // Safe array guards
  const safe_sections = Array.isArray(sections) ? sections : [];
  const safe_categories = Array.isArray(categories) ? categories : [];
  const safe_cards = Array.isArray(cards) ? cards : [];
  const safe_warehouseItems = Array.isArray(warehouseItems) ? warehouseItems : [];
  const safe_cart = Array.isArray(cart) ? cart : [];
  const safe_debtCustomers = Array.isArray(debtCustomers) ? debtCustomers : [];
  const safe_recipe = Array.isArray(recipe) ? recipe : [];

  const activeWorkerName =
    currentProfile?.name ||
    ownerName ||
    session?.ownerName ||
    session?.username ||
    "Владелец";

  const load = async () => {
    const [sectionList, categoryList, productList, crds, warehouseList, debtCustomerList] = await Promise.all([
      get("/product-types"),
      get("/product-categories"),
      get("/menu-products"),
      get("/cards"),
      get("/warehouse/items").catch(() => []),
      get("/debt-customers").catch(() => []),
    ]);

    setSections(sectionList || []);
    setCategories(categoryList || []);
    setProducts(productList || []);
    setCards(crds || []);
    setWarehouseItems(warehouseList || []);
    setDebtCustomers(debtCustomerList || []);
  };

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  const visibleCategories = useMemo(() => {
    const cats = Array.isArray(categories) ? categories : [];
    if (selectedSectionId === "all") return cats;
    return cats.filter((c) => String(c.typeId) === String(selectedSectionId));
  }, [categories, selectedSectionId]);

  const productsInsideCategory = useMemo(() => {
    if (!openedCategory) return [];
    const prods = Array.isArray(products) ? products : [];
    const q = search.trim().toLowerCase();
    return prods.filter((p) => {
      if (p.isExtra) return false; // доп. товары — в отдельной секции
      const okCategory = String(p.categoryId) === String(openedCategory.id);
      const okSearch = !q || String(p.name || "").toLowerCase().includes(q);
      return okCategory && okSearch;
    });
  }, [products, openedCategory, search]);

  // Доп. товары (стаканчик, лёд и т.п.) — быстрая отдельная секция
  const extraProducts = useMemo(
    () => (Array.isArray(products) ? products : []).filter((p) => p.isExtra),
    [products]
  );

  const subtotal = safe_cart.reduce((s, i) => s + money(i.price) * money(i.qty), 0);
  const discountAmount = (subtotal * num(discount)) / 100;
  const total = Math.max(0, subtotal - discountAmount);
  const change =
    paymentType === "cash" && paidAmount !== "" ? num(paidAmount) - total : 0;

  const debtSuggestions = useMemo(() => {
    const custs = Array.isArray(debtCustomers) ? debtCustomers : [];
    const q = debtName.trim().toLowerCase();
    if (!q) return custs.slice(0, 5);
    return custs.filter((c) => String(c.name || "").toLowerCase().includes(q)).slice(0, 5);
  }, [debtCustomers, debtName]);

  const getWarehouseUnitCost = (item) => {
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

  const recipeCost = useMemo(() => {
    const rcp = Array.isArray(recipe) ? recipe : [];
    const wItems = Array.isArray(warehouseItems) ? warehouseItems : [];
    return rcp.reduce((sum, row) => {
      const warehouseItem = wItems.find((item) => String(item.id) === String(row.warehouseItemId));
      if (!warehouseItem) return sum;
      const converted = convertRecipePreview(warehouseItem, row.quantity, row.quantityUnit || warehouseItem.unit);
      return sum + converted.storageQty * getWarehouseUnitCost(warehouseItem);
    }, 0);
  }, [recipe, warehouseItems]);

  useEffect(() => {
    if (safe_recipe.length) {
      setNewProduct((p) => ({
        ...p,
        cost: recipeCost ? String(recipeCost.toFixed(2)) : "",
      }));
    }
  }, [recipeCost, safe_recipe.length]);

  const addRecipeRow = (mode = "warehouse") => {
    setRecipe((rows) => [
      ...rows,
      { warehouseItemId: "", ingredientName: "", quantity: "", quantityUnit: "pcs", mode },
    ]);
  };

  const analyzeProductName = useCallback(async (name) => {
    if (!name || name.trim().length < 3) { setAiSuggestion(null); return; }
    if (!aiAdvisorEnabled) { setAiSuggestion(null); return; }
    setAiSuggestionLoading(true);
    const wItems = Array.isArray(warehouseItems) ? warehouseItems : [];
    try {
      const data = await post("/ai/menu/suggest", {
        name,
        warehouseItems: wItems.map(w => ({ id: w.id, name: w.name, unit: w.unit }))
      });
      if (data && data.displayName) setAiSuggestion(data);
    } catch { setAiSuggestion(null); }
    finally { setAiSuggestionLoading(false); }
  }, [warehouseItems, aiAdvisorEnabled]);

  const applyAiSuggestion = () => {
    if (!aiSuggestion) return;
    setNewProduct(p => ({
      ...p,
      name: aiSuggestion.displayName || p.name,
      price: p.price || String(aiSuggestion.typicalPrice || ""),
      cost: p.cost || String(aiSuggestion.estimatedCost || ""),
    }));
    const rows = (aiSuggestion.ingredients || []).map(ing => {
      const found = safe_warehouseItems.find(w =>
        w.name.toLowerCase().includes(ing.name.toLowerCase()) ||
        ing.name.toLowerCase().includes(w.name.toLowerCase())
      );
      return {
        warehouseItemId: found ? String(found.id) : "",
        ingredientName: ing.name,
        quantity: String(ing.quantity),
        quantityUnit: ing.unit === "мл" ? "ml" : ing.unit === "г" ? "g" : "pcs",
        mode: found ? "warehouse" : "manual",
      };
    });
    if (rows.length) setRecipe(rows);
    setAiSuggestion(null);
  };

  const updateRecipeRow = (index, key, value) => {
    setRecipe((rows) =>
      rows.map((row, i) => (i === index ? { ...row, [key]: value } : row))
    );
  };

  const removeRecipeRow = (index) => {
    setRecipe((rows) => rows.filter((_, i) => i !== index));
  };

  const addToCart = (p) => {
    setCart((prev) => {
      const exists = prev.find((i) => i.productId === p.id);

      if (exists) {
        return prev.map((i) =>
          i.productId === p.id ? { ...i, qty: i.qty + 1 } : i
        );
      }

      return [
        ...prev,
        {
          productId: p.id,
          name: p.name,
          type: p.typeName || p.type,
          qty: 1,
          price: p.price,
          cost: p.cost,
        },
      ];
    });
  };

  const decreaseCartItem = (id) => {
    setCart((prev) =>
      prev
        .map((x) => (x.productId === id ? { ...x, qty: x.qty - 1 } : x))
        .filter((x) => x.qty > 0)
    );
  };

  const increaseCartItem = (id) => {
    setCart((prev) =>
      prev.map((x) => (x.productId === id ? { ...x, qty: x.qty + 1 } : x))
    );
  };

  const createSection = async () => {
    setError("");

    if (!newSectionName.trim()) {
      return setError("Введите название раздела");
    }

    const created = await post("/product-types", {
      name: newSectionName.trim(),
    });

    setSectionModal(false);
    setNewSectionName("");
    setSelectedSectionId(String(created.id));
    setOpenedCategory(null);
    await load();
  };

  const createCategory = async () => {
    setError("");

    if (!newCategory.sectionId) return setError("Выбери раздел меню");
    if (!newCategory.name.trim()) return setError("Введите название категории");

    const created = await post("/product-categories", {
      name: newCategory.name.trim(),
      typeId: Number(newCategory.sectionId),
    });

    setCategoryModal(false);
    setNewCategory({ name: "", sectionId: "" });
    setSelectedSectionId(String(created.typeId));
    setOpenedCategory(created);
    await load();
  };

  const openProductModal = () => {
    setError("");
    setRecipe([]);
    setNewProduct((p) => ({
      categoryId: openedCategory?.id ? String(openedCategory.id) : p.categoryId,
      name: "",
      price: "",
      cost: "",
    }));
    setProductModal(true);
  };

  const createProduct = async () => {
    setError("");

    if (!newProduct.categoryId) return setError("Выбери категорию");
    if (!newProduct.name.trim()) return setError("Введите название позиции");

    const wItems = Array.isArray(warehouseItems) ? warehouseItems : [];
    const cleanRecipe = recipe
      .filter((row) => (row.warehouseItemId || row.ingredientName) && num(row.quantity) > 0)
      .map((row) => {
        const wItem = wItems.find((w) => String(w.id) === String(row.warehouseItemId));
        const unit = row.quantityUnit || wItem?.unit || "";
        return {
          warehouseItemId: Number(row.warehouseItemId) || 0,
          warehouse_item_id: Number(row.warehouseItemId) || 0,
          ingredientName: row.ingredientName || wItem?.name || "",
          itemName: row.ingredientName || wItem?.name || "",
          quantity: num(row.quantity),
          quantityUnit: unit,
          quantity_unit: unit,
        };
      });

    await post("/menu-products", {
      categoryId: Number(newProduct.categoryId),
      name: newProduct.name.trim(),
      price: num(newProduct.price),
      cost: cleanRecipe.length ? recipeCost : num(newProduct.cost),
      recipe: cleanRecipe,
    });

    setProductModal(false);
    setRecipe([]);
    setNewProduct({
      categoryId: openedCategory?.id ? String(openedCategory.id) : "",
      name: "",
      price: "",
      cost: "",
    });

    await load();
  };

  const salePayload = (override = {}) => ({
    employeeId: currentProfile?.id ? Number(currentProfile.id) : 0,
    employeeName: activeWorkerName,
    sellerName: activeWorkerName,
    discountPercent: num(discount),
    items: safe_cart.map((item) => ({
      productId: Number(item.productId || item.id || 0),
      name: item.name,
      type: item.type,
      qty: num(item.qty),
      price: num(item.price),
      cost: num(item.cost),
    })),
    ...override,
  });

  const resetSale = async () => {
    setCart([]);
    setDiscount("");
    setPaidAmount("");
    setCardId("");
    setDebtName("");
    setPaymentType("cash");
    setPaymentModal(false);
    await load();
    await loadCashShift();
    window.dispatchEvent(new Event("sales-pending-change"));
  };

  const confirmSale = () => {
    setError("");

    if (isWorkspaceUser && !currentProfile?.id) {
      openProfile?.();
      return setError("Выбери сотрудника смены");
    }

    if (!safe_cart.length) return setError("Корзина пустая");

    setPaymentType("cash");
    setPaymentModal(true);
  };

  const submitSale = async (mode) => {
    if (submitting) return; // не даём двойной тап отправить продажу дважды
    setError("");

    if (mode === "transfer" && !cardId) return setError("Выберите карту");
    if (mode === "debt" && !debtName.trim()) return setError("Введите имя клиента");

    setSubmitting(true);
    try {
      if (mode === "pending") {
        await post("/pending-sales", salePayload());
        await resetSale();
        window.notify?.("Чек отправлен в ожидание оплаты", "success");
        return;
      }

      await post("/sales", salePayload({
        cardId: mode === "transfer" ? Number(cardId) : 0,
        paymentType: mode,
        cashGiven: mode === "cash" ? num(paidAmount) : 0,
        customerName: mode === "debt" ? debtName.trim() : "",
      }));

      await resetSale();
      window.notify?.(mode === "debt" ? "Долг сохранён" : "Продажа сохранена", "success");
    } catch (e) {
      setError(e?.message || "Не удалось провести продажу. Попробуйте снова.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="relative flex flex-col pb-nav text-white sm:pb-10 lg:h-[calc(100vh-190px)] lg:overflow-hidden lg:pb-0"
      style={{ WebkitTapHighlightColor: "transparent" }}
    >
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-[-120px] top-[-120px] h-[360px] w-[360px] rounded-full bg-blue-600/20 blur-3xl" />
        <div className="absolute right-[-140px] bottom-[-140px] h-[360px] w-[360px] rounded-full bg-violet-600/20 blur-3xl" />
      </div>
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex shrink-0 items-center justify-between gap-3 lg:mb-4">
        <div className="min-w-0">
          <p className="text-xs font-bold text-blue-400 sm:text-sm">Касса</p>
          <h2 className="text-2xl font-black leading-none text-white sm:text-3xl">
            Магазин
          </h2>
        </div>

        <div className="flex shrink-0 items-center gap-2.5 rounded-2xl border border-white/10 bg-[#0f172a]/80 px-2.5 py-2 shadow-lg backdrop-blur sm:px-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-blue-600 to-violet-600 text-sm font-black text-white">
            {String(activeWorkerName || "A").slice(0, 1).toUpperCase()}
          </div>
          <div className="hidden min-w-0 pr-1 sm:block">
            <p className="text-[11px] font-black uppercase leading-none text-slate-400">
              Сейчас работает
            </p>
            <p className="truncate text-sm font-black leading-tight text-white">
              {activeWorkerName}
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-3 shrink-0 rounded-2xl bg-red-500/10 px-4 py-3 font-bold text-red-300">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <div className="flex min-h-0 flex-col gap-3 lg:flex-1">
          <div className="shrink-0 rounded-3xl border border-white/10 bg-[#0f172a]/80 p-3 shadow-xl backdrop-blur sm:p-4">
            <div className="flex items-center gap-3">
              {openedCategory && (
                <button
                  type="button"
                  onClick={() => { setOpenedCategory(null); setSearch(""); }}
                  aria-label="Назад к категориям"
                  title="Назад к категориям"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] text-lg text-slate-200 transition hover:bg-white/10"
                >←</button>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                  {openedCategory ? (openedCategory.typeName || openedCategory.type || "Категория") : "Меню"}
                </p>
                <h3 className="truncate text-xl font-black sm:text-2xl">
                  {openedCategory ? openedCategory.name : "Категории"}
                </h3>
              </div>
              {openedCategory && (
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Найти позицию"
                  className="hidden rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 lg:block lg:w-72"
                />
              )}
            </div>

            {openedCategory && (
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Найти позицию"
                className="mt-3 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 lg:hidden"
              />
            )}

            {!openedCategory && (
              <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto pb-0.5">
                <button
                  onClick={() => { setSelectedSectionId("all"); setOpenedCategory(null); }}
                  className={`shrink-0 rounded-full px-4 py-2.5 text-sm font-black transition ${selectedSectionId === "all" ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white" : "border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"}`}
                >
                  Все
                </button>
                {safe_sections.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => { setSelectedSectionId(String(s.id)); setOpenedCategory(null); }}
                    className={`shrink-0 rounded-full px-4 py-2.5 text-sm font-black transition ${String(selectedSectionId) === String(s.id) ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white" : "border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"}`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {!isWorkspaceUser && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {/* ── Создать раздел inline ── */}
              {inlineSection ? (
                <div className="flex flex-1 items-center gap-2 rounded-2xl border border-blue-400/30 bg-blue-500/10 px-3 py-2">
                  <span className="text-sm font-black text-blue-300 shrink-0">Раздел:</span>
                  <input
                    value={newSectionName}
                    onChange={(e) => setNewSectionName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { createSection(); setInlineSection(false); } if (e.key === "Escape") setInlineSection(false); }}
                    placeholder="Напитки, Еда, Десерты..."
                    autoFocus
                    className="flex-1 bg-transparent text-sm font-bold text-white outline-none placeholder:text-blue-400/50"
                  />
                  <button onClick={() => { createSection(); setInlineSection(false); }} className="shrink-0 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-black text-white hover:bg-blue-500">Добавить</button>
                  <button onClick={() => setInlineSection(false)} className="shrink-0 text-slate-500 hover:text-white text-lg leading-none">×</button>
                </div>
              ) : (
                <button onClick={() => setInlineSection(true)}
                  className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-black text-slate-300 transition hover:border-blue-400/40 hover:bg-blue-500/10 hover:text-blue-300">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/10 text-xs">＋</span>
                  Раздел
                </button>
              )}

              {/* ── Создать категорию inline ── */}
              {inlineCategory ? (
                <div className="flex flex-1 items-center gap-2 rounded-2xl border border-violet-400/30 bg-violet-500/10 px-3 py-2">
                  <span className="text-sm font-black text-violet-300 shrink-0">Категория:</span>
                  {safe_sections.length > 0 && (
                    <select
                      value={newCategory.sectionId}
                      onChange={(e) => setNewCategory(p => ({ ...p, sectionId: e.target.value }))}
                      className="rounded-xl border border-white/10 bg-slate-900 px-2 py-1 text-xs font-bold text-white outline-none shrink-0">
                      <option value="">Раздел...</option>
                      {safe_sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  )}
                  <input
                    value={newCategory.name}
                    onChange={(e) => setNewCategory(p => ({ ...p, name: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") { createCategory(); setInlineCategory(false); } if (e.key === "Escape") setInlineCategory(false); }}
                    placeholder="Холодные напитки..."
                    autoFocus
                    className="flex-1 bg-transparent text-sm font-bold text-white outline-none placeholder:text-violet-400/50"
                  />
                  <button onClick={() => { createCategory(); setInlineCategory(false); }} className="shrink-0 rounded-xl bg-violet-600 px-3 py-1.5 text-xs font-black text-white hover:bg-violet-500">Добавить</button>
                  <button onClick={() => setInlineCategory(false)} className="shrink-0 text-slate-500 hover:text-white text-lg leading-none">×</button>
                </div>
              ) : (
                <button onClick={() => { setNewCategory(p => ({ ...p, sectionId: selectedSectionId !== "all" ? selectedSectionId : "" })); setInlineCategory(true); }}
                  className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-black text-slate-300 transition hover:border-violet-400/40 hover:bg-violet-500/10 hover:text-violet-300">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/10 text-xs">＋</span>
                  Категория
                </button>
              )}

              {/* ── Добавить позицию ── */}
              <button onClick={openProductModal} disabled={!openedCategory}
                className={`flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-black transition ${
                  openedCategory
                    ? "bg-linear-to-r from-blue-600 to-violet-600 text-white shadow-lg shadow-blue-900/30 hover:opacity-90"
                    : "border border-white/10 bg-white/5 text-slate-500 cursor-not-allowed"
                }`}>
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/20 text-xs">＋</span>
                {openedCategory ? `Позиция в «${openedCategory.name}»` : "Сначала выбери категорию"}
              </button>
            </div>
          )}

          <div className="no-scrollbar lg:-mr-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1 lg:pb-1">
          {!openedCategory ? (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 xl:grid-cols-4">
              {visibleCategories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => {
                    setOpenedCategory(cat);
                    setSearch("");
                  }}
                  className="group flex items-center gap-3 overflow-hidden rounded-2xl border border-white/10 bg-[#111827] p-3.5 text-left shadow-lg transition hover:-translate-y-0.5 hover:border-blue-500/40 focus:outline-none focus:ring-4 focus:ring-blue-500/30"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-xl">📁</span>
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-bold text-blue-400">{cat.typeName || cat.type || "Раздел"}</p>
                    <h3 className="truncate text-base font-black text-white sm:text-lg">{cat.name}</h3>
                  </div>
                </button>
              ))}

              {!visibleCategories.length && (
                <div className="col-span-full rounded-4xl border border-white/10 bg-[#0f172a]/80 p-10 text-center shadow-2xl backdrop-blur">
                  <p className="text-xl font-black text-white">
                    Категорий пока нет
                  </p>
                  <p className="mt-2 text-slate-400">
                    Создай категорию, например “Холодные напитки”.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {productsInsideCategory.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  className="group flex flex-col justify-between overflow-hidden rounded-2xl border border-white/10 bg-[#111827] p-3.5 text-left shadow-lg transition hover:-translate-y-0.5 hover:border-blue-500/40 active:scale-[0.98] focus:outline-none focus:ring-4 focus:ring-blue-500/30 sm:p-4"
                >
                  <div className="text-base font-black leading-tight text-white sm:text-lg">
                    {p.name}
                  </div>
                  <div className="mt-3 inline-flex w-fit items-baseline gap-1 rounded-lg bg-blue-500/15 px-2.5 py-1 text-base font-black text-blue-200 tabular-nums">
                    {formatMoney(p.price)} <span className="text-xs font-bold text-blue-300/70">₽</span>
                  </div>
                </button>
              ))}

              {!productsInsideCategory.length && (
                <div className="col-span-full rounded-4xl border border-white/10 bg-[#0f172a]/80 p-10 text-center shadow-2xl backdrop-blur">
                  <p className="text-xl font-black text-white">
                    В этой категории пока нет товаров
                  </p>
                  <p className="mt-2 text-slate-400">
                    Добавь позицию внутрь категории “{openedCategory.name}”.
                  </p>
                </div>
              )}
            </div>
          )}
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-3 lg:w-[360px] lg:shrink-0 xl:w-[400px]">
        {/* Денежная смена (касса) */}
        {cashShift ? (
          <div className="rounded-4xl border border-emerald-400/25 bg-emerald-500/[0.06] p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-wide text-emerald-300/80">Смена открыта</p>
                <p className="text-sm font-bold text-slate-300">Размен {formatMoney(cashShift.openingCash)}{cashShift.openedBy ? ` · ${cashShift.openedBy}` : ""}</p>
              </div>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300">●</span>
            </div>
            <div className="rounded-2xl bg-white/[0.04] p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-slate-400">В кассе должно быть</span>
                <b className="text-2xl font-black text-white">{formatMoney(cashShift.expectedCash)}</b>
              </div>
              <div className="mt-1 text-[11px] text-slate-500">размен {formatMoney(cashShift.openingCash)} + налом {formatMoney(cashShift.cashSales)} + внесено {formatMoney(cashShift.cashIn)} − изъято {formatMoney(cashShift.cashOut)}</div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button type="button" onClick={() => { setShiftInput(""); setShiftNote(""); setShiftModal("in"); }} className="rounded-2xl border border-white/10 bg-white/5 px-2 py-2.5 text-sm font-black text-emerald-300 transition hover:bg-white/10">+ Внести</button>
              <button type="button" onClick={() => { setShiftInput(""); setShiftNote(""); setShiftModal("out"); }} className="rounded-2xl border border-white/10 bg-white/5 px-2 py-2.5 text-sm font-black text-red-300 transition hover:bg-white/10">− Изъять</button>
              <button type="button" onClick={() => { setShiftInput(""); setShiftNote(""); setShiftModal("close"); }} className="rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-2 py-2.5 text-sm font-black text-white transition hover:brightness-110">Закрыть</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => { setShiftInput(""); setShiftResult(null); setShiftModal("open"); }}
            className="flex w-full shrink-0 items-center justify-between gap-3 rounded-3xl border border-white/10 bg-white/[0.04] p-3.5 text-left transition hover:bg-white/[0.07]">
            <div className="min-w-0">
              <p className="text-sm font-black text-white">Открыть смену</p>
              <p className="truncate text-xs text-slate-400">Внесите размен — касса начнёт считать наличные</p>
            </div>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-lg text-blue-300">₽</span>
          </button>
        )}

        {extraProducts.length > 0 && (
          <div className="rounded-4xl border border-amber-400/25 bg-amber-500/[0.06] p-4 sm:p-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/20 text-amber-300 text-sm">＋</span>
              <div>
                <p className="text-sm font-black text-white leading-tight">Доп. товары</p>
                <p className="text-[11px] text-slate-400 leading-tight">Стаканчик, лёд и т.п. — в доходах отдельно</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {extraProducts.map((p) => (
                <button key={p.id} type="button" onClick={() => addToCart(p)}
                  className="flex items-center gap-2 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm font-black text-white transition hover:bg-amber-500/20 active:scale-95">
                  <span className="truncate">{p.name}</span>
                  <span className="shrink-0 text-amber-300">{formatMoney(p.price)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col rounded-3xl border border-white/10 bg-[#0f172a]/90 p-3.5 shadow-2xl backdrop-blur sm:p-4">
          <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
            <h3 className="text-xl font-black sm:text-2xl">Корзина</h3>

            {safe_cart.length > 0 && (
              <button
                onClick={() => setCart([])}
                className="rounded-2xl bg-red-500/10 px-3 py-2 text-sm font-black text-red-300"
              >
                Очистить
              </button>
            )}
          </div>

          <div className="no-scrollbar max-h-72 space-y-2 overflow-auto lg:max-h-none lg:min-h-[96px] lg:flex-1">
            {safe_cart.map((i) => (
              <div
                key={i.productId}
                className="flex items-center justify-between gap-3 rounded-3xl border border-white/10 bg-white/[0.03] p-3"
              >
                <div>
                  <div className="font-bold">{i.name}</div>
                  <div className="text-sm text-slate-400">
                    {formatMoney(i.price)} × {i.qty}
                  </div>
                </div>

                <div className="flex gap-1.5">
                  <button
                    onClick={() => decreaseCartItem(i.productId)}
                    className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/8 text-lg font-black text-white transition active:scale-95 hover:bg-white/15"
                  >
                    −
                  </button>
                  <button
                    onClick={() => increaseCartItem(i.productId)}
                    className="flex h-10 w-10 items-center justify-center rounded-2xl border border-blue-500/20 bg-blue-500/12 text-lg font-black text-blue-300 transition active:scale-95 hover:bg-blue-500/20"
                  >
                    +
                  </button>
                </div>
              </div>
            ))}

            {!safe_cart.length && (
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 text-center text-slate-400">
                Корзина пустая
              </div>
            )}
          </div>

          {safe_cart.length > 0 && (
            <>
              <div className="mt-2 shrink-0">
                <input
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  placeholder="Скидка %"
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 font-bold text-white outline-none placeholder:text-slate-500"
                />
              </div>

              <div className="mt-2 shrink-0 rounded-2xl border border-white/10 bg-linear-to-br from-blue-600/10 to-violet-600/10 p-3">
                {discountAmount > 0 && (
                  <>
                    <div className="flex justify-between text-sm text-slate-300">
                      <span>Сумма</span>
                      <b className="text-white">{formatMoney(subtotal)}</b>
                    </div>
                    <div className="mt-1 flex justify-between text-sm text-red-300">
                      <span>Скидка</span>
                      <b>−{formatMoney(discountAmount)}</b>
                    </div>
                  </>
                )}
                <div className={`flex items-baseline justify-between ${discountAmount > 0 ? "mt-2 border-t border-white/10 pt-2" : ""}`}>
                  <span className="text-lg font-black">Итого</span>
                  <b className="text-2xl font-black">{formatMoney(total)}</b>
                </div>
              </div>
            </>
          )}

          <button
            onClick={confirmSale}
            disabled={!safe_cart.length}
            className="mt-2 w-full shrink-0 rounded-2xl bg-linear-to-r from-blue-600 to-violet-600 px-5 py-3 text-base font-black text-white shadow-xl shadow-blue-900/30 transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:scale-100 sm:py-3.5 sm:text-lg"
          >
            {safe_cart.length ? `Подтвердить покупку · ${formatMoney(total)}` : "Подтвердить покупку"}
          </button>
        </div>
        </div>
      </div>

      {shiftModal === "open" && (
        <Modal title="Открыть смену">
          <p className="mb-4 text-sm text-slate-400">Сколько наличных в кассе сейчас (размен на сдачу)?</p>
          <input type="number" value={shiftInput} autoFocus onChange={(e) => setShiftInput(e.target.value)}
            placeholder="Размен, ₽" className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500" />
          <div className="mt-6 flex gap-3">
            <button type="button" onClick={() => setShiftModal(null)} className="btn-white flex-1">Отмена</button>
            <button type="button" onClick={openShift} className="btn-blue flex-1">Открыть</button>
          </div>
        </Modal>
      )}

      {(shiftModal === "in" || shiftModal === "out") && (
        <Modal title={shiftModal === "in" ? "Внести в кассу" : "Изъять из кассы"}>
          <p className="mb-4 text-sm text-slate-400">
            {shiftModal === "in" ? "Деньги, которые кладёшь в кассу (не продажа)." : "Деньги, которые забираешь из кассы (выплата, инкассация, такси и т.п.)."}
          </p>
          <input type="number" value={shiftInput} autoFocus onChange={(e) => setShiftInput(e.target.value)}
            placeholder="Сумма, ₽" className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500" />
          <input type="text" value={shiftNote} onChange={(e) => setShiftNote(e.target.value)}
            placeholder="Комментарий (за что)" className="mt-3 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500" />
          <div className="mt-6 flex gap-3">
            <button type="button" onClick={() => setShiftModal(null)} className="btn-white flex-1">Отмена</button>
            <button type="button" onClick={() => addShiftMovement(shiftModal)} className="btn-blue flex-1">{shiftModal === "in" ? "Внести" : "Изъять"}</button>
          </div>
        </Modal>
      )}

      {shiftModal === "close" && cashShift && (
        <Modal title="Закрыть смену">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-slate-400">По программе должно быть</span>
              <b className="text-xl font-black text-white">{formatMoney(cashShift.expectedCash)}</b>
            </div>
            <div className="mt-1 text-[11px] text-slate-500">размен {formatMoney(cashShift.openingCash)} + налом {formatMoney(cashShift.cashSales)} + внесено {formatMoney(cashShift.cashIn)} − изъято {formatMoney(cashShift.cashOut)}</div>
          </div>
          <p className="mb-2 mt-4 text-sm font-bold text-slate-300">Пересчитай деньги в кассе и впиши фактическую сумму:</p>
          <input type="number" value={shiftInput} autoFocus onChange={(e) => setShiftInput(e.target.value)}
            placeholder="Фактически в кассе, ₽" className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500" />
          {shiftInput !== "" && (
            <p className={`mt-2 text-sm font-black ${num(shiftInput) - cashShift.expectedCash < -0.005 ? "text-red-400" : num(shiftInput) - cashShift.expectedCash > 0.005 ? "text-amber-400" : "text-emerald-400"}`}>
              {(() => { const d = num(shiftInput) - cashShift.expectedCash; if (Math.abs(d) < 0.005) return "✓ Сходится"; return d < 0 ? `Недостача ${formatMoney(-d)}` : `Излишек ${formatMoney(d)}`; })()}
            </p>
          )}
          <div className="mt-6 flex gap-3">
            <button type="button" onClick={() => setShiftModal(null)} className="btn-white flex-1">Отмена</button>
            <button type="button" onClick={closeShift} className="btn-blue flex-1">Закрыть смену</button>
          </div>
        </Modal>
      )}

      {shiftResult && (
        <Modal title="Смена закрыта">
          <div className="space-y-2">
            <div className="flex justify-between text-slate-300"><span>Размен</span><b className="text-white">{formatMoney(shiftResult.openingCash)}</b></div>
            <div className="flex justify-between text-slate-300"><span>Продажи налом</span><b className="text-white">{formatMoney(shiftResult.cashSales)}</b></div>
            <div className="flex justify-between text-slate-300"><span>Внесено</span><b className="text-white">{formatMoney(shiftResult.cashIn)}</b></div>
            <div className="flex justify-between text-slate-300"><span>Изъято</span><b className="text-white">−{formatMoney(shiftResult.cashOut)}</b></div>
            <div className="flex justify-between border-t border-white/10 pt-2 text-lg"><span className="font-black">Должно быть</span><b className="font-black text-white">{formatMoney(shiftResult.expectedCash)}</b></div>
            <div className="flex justify-between text-lg"><span className="font-black">По факту</span><b className="font-black text-white">{formatMoney(shiftResult.countedCash)}</b></div>
          </div>
          <div className={`mt-4 rounded-2xl p-4 text-center font-black ${Math.abs(shiftResult.difference) < 0.005 ? "bg-emerald-500/15 text-emerald-300" : shiftResult.difference < 0 ? "bg-red-500/15 text-red-300" : "bg-amber-500/15 text-amber-300"}`}>
            {Math.abs(shiftResult.difference) < 0.005 ? "✓ Касса сошлась" : shiftResult.difference < 0 ? `Недостача ${formatMoney(-shiftResult.difference)}` : `Излишек ${formatMoney(shiftResult.difference)}`}
          </div>
          <button type="button" onClick={() => setShiftResult(null)} className="btn-blue mt-6 w-full">Готово</button>
        </Modal>
      )}

      {paymentModal && (
        <Modal title="Способ оплаты" wide>
          <div className="rounded-3xl border border-white/10 bg-white/4 p-4">
            <div className="flex justify-between text-lg">
              <span>К оплате</span>
              <b>{formatMoney(total)}</b>
            </div>
          </div>

          {error && (
            <div className="mt-3 rounded-2xl bg-red-500/10 px-4 py-3 font-bold text-red-300">
              {error}
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              onClick={() => setPaymentType("cash")}
              className={paymentType === "cash" ? "btn-blue" : "btn-white"}
            >
              Наличные
            </button>
            <button
              onClick={() => setPaymentType("transfer")}
              className={paymentType === "transfer" ? "btn-blue" : "btn-white"}
            >
              Перевод
            </button>
            <button
              onClick={() => setPaymentType("pending")}
              className={paymentType === "pending" ? "btn-blue" : "btn-white"}
            >
              Ожидание оплаты
            </button>
            <button
              onClick={() => setPaymentType("debt")}
              className={paymentType === "debt" ? "btn-blue" : "btn-white"}
            >
              В долг
            </button>
          </div>

          {paymentType === "cash" && (
            <div className="mt-4 space-y-3">
              <input
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                placeholder="Сколько дал клиент, необязательно"
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full"
              />
              {paidAmount !== "" && (
                <div className="rounded-2xl bg-blue-500/10 px-4 py-3 font-black text-blue-300">
                  Сдача: {formatMoney(change)}
                </div>
              )}
            </div>
          )}

          {paymentType === "transfer" && (
            <select
              value={cardId}
              onChange={(e) => setCardId(e.target.value)}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 mt-4 w-full"
            >
              <option value="">Выбери карту</option>
              {safe_cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.owner ? ` · ${c.owner}` : ""}
                </option>
              ))}
            </select>
          )}

          {paymentType === "debt" && (
            <div className="mt-4 space-y-3">
              <input
                value={debtName}
                onChange={(e) => setDebtName(e.target.value)}
                placeholder="Имя клиента"
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full"
                list="debt-customers"
              />
              <datalist id="debt-customers">
                {safe_debtCustomers.map((c) => (
                  <option key={c.id} value={c.name} />
                ))}
              </datalist>
              {!!debtSuggestions.length && (
                <div className="flex flex-wrap gap-2">
                  {debtSuggestions.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setDebtName(c.name)}
                      className="rounded-2xl bg-white/[0.07] px-3 py-2 text-sm font-black text-slate-200"
                    >
                      {c.name} · {formatMoney(c.debtTotal || 0)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="mt-6 flex gap-3">
            <button onClick={() => setPaymentModal(false)} className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 font-black text-slate-200 transition hover:bg-white/10">
              Назад
            </button>
            <button onClick={() => submitSale(paymentType)} disabled={submitting}
              className="flex-1 rounded-2xl bg-linear-to-r from-blue-600 to-violet-600 px-5 py-3 font-black text-white shadow-lg shadow-blue-900/30 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60">
              {submitting ? "Проводим…" : paymentType === "pending" ? "В ожидание" : "Подтвердить"}
            </button>
          </div>
        </Modal>
      )}

      {sectionModal && (
        <Modal title="Новый раздел меню">
          <input
            value={newSectionName}
            onChange={(e) => setNewSectionName(e.target.value)}
            placeholder="Например: Напитки, Еда, Десерты"
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full"
          />

          <div className="mt-6 flex gap-3">
            <button
              onClick={() => setSectionModal(false)}
              className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 font-black text-slate-200 transition hover:bg-white/10"
            >
              Отмена
            </button>

            <button onClick={createSection} className="flex-1 rounded-2xl bg-linear-to-r from-blue-600 to-violet-600 px-5 py-3 font-black text-white shadow-lg shadow-blue-900/30">
              Создать
            </button>
          </div>
        </Modal>
      )}

      {categoryModal && (
        <Modal title="Новая категория">
          <select
            value={newCategory.sectionId}
            onChange={(e) =>
              setNewCategory((p) => ({ ...p, sectionId: e.target.value }))
            }
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full"
          >
            <option value="">Выбери раздел меню</option>
            {safe_sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <input
            value={newCategory.name}
            onChange={(e) =>
              setNewCategory((p) => ({ ...p, name: e.target.value }))
            }
            placeholder="Например: Холодные напитки"
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 mt-3 w-full"
          />

          <div className="mt-6 flex gap-3">
            <button
              onClick={() => setCategoryModal(false)}
              className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 font-black text-slate-200 transition hover:bg-white/10"
            >
              Отмена
            </button>

            <button onClick={createCategory} className="flex-1 rounded-2xl bg-linear-to-r from-blue-600 to-violet-600 px-5 py-3 font-black text-white shadow-lg shadow-blue-900/30">
              Создать
            </button>
          </div>
        </Modal>
      )}

      {productModal && (
        <Modal title="Новая позиция меню" wide>
          <div className="grid gap-3 sm:grid-cols-2">
            <select
              value={newProduct.categoryId}
              onChange={(e) =>
                setNewProduct((p) => ({
                  ...p,
                  categoryId: e.target.value,
                }))
              }
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 sm:col-span-2"
            >
              <option value="">Выбери категорию</option>
              {safe_categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.typeName || c.type} / {c.name}
                </option>
              ))}
            </select>

            <div className="sm:col-span-2 flex flex-col gap-2">
              <div className="relative">
                <input
                  value={newProduct.name}
                  onChange={(e) => {
                    setNewProduct((p) => ({ ...p, name: e.target.value }));
                    if (aiAdvisorEnabled) {
                      clearTimeout(aiDebounceRef.current);
                      aiDebounceRef.current = setTimeout(() => analyzeProductName(e.target.value), 800);
                    }
                  }}
                  placeholder="Название позиции..."
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 pr-36 font-bold text-white outline-none placeholder:text-slate-500"
                />
                {/* AI советник — переключатель */}
                <button
                  type="button"
                  onClick={() => {
                    const next = !aiAdvisorEnabled;
                    setAiAdvisorEnabled(next);
                    if (!next) setAiSuggestion(null);
                    else if (newProduct.name?.trim().length >= 3) analyzeProductName(newProduct.name);
                  }}
                  className={`absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-black transition ${
                    aiAdvisorEnabled
                      ? "bg-violet-500/20 text-violet-300 border border-violet-400/30"
                      : "bg-white/5 text-slate-500 border border-white/10"
                  }`}
                >
                  {aiSuggestionLoading
                    ? <><span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-violet-400/30 border-t-violet-400" /> Думаю...</>
                    : <>{aiAdvisorEnabled ? "✨ AI вкл" : "✨ AI выкл"}</>
                  }
                </button>
              </div>
            </div>

            {/* AI предложение */}
            {aiSuggestion && (
              <div className="sm:col-span-2 rounded-2xl border border-violet-400/20 bg-linear-to-br from-violet-500/10 to-blue-500/5 p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-violet-300">✨ AI предлагает</p>
                    <p className="mt-1 text-base font-black text-white">{aiSuggestion.displayName}</p>
                    <p className="text-sm text-slate-400">{aiSuggestion.description}</p>
                  </div>
                  <button type="button" onClick={() => setAiSuggestion(null)}
                    className="text-slate-500 hover:text-white text-lg">×</button>
                </div>

                <div className="flex gap-3 mb-3 text-sm">
                  <div className="rounded-xl bg-emerald-500/10 border border-emerald-400/20 px-3 py-2">
                    <p className="text-xs text-slate-400">Типичная цена</p>
                    <p className="font-black text-emerald-300">{aiSuggestion.typicalPrice} ₽</p>
                  </div>
                  <div className="rounded-xl bg-orange-500/10 border border-orange-400/20 px-3 py-2">
                    <p className="text-xs text-slate-400">Себестоимость</p>
                    <p className="font-black text-orange-300">{aiSuggestion.estimatedCost} ₽</p>
                  </div>
                </div>

                <div className="mb-3 space-y-1.5">
                  <p className="text-xs font-black text-slate-400 uppercase tracking-wide">Состав:</p>
                  {(aiSuggestion.ingredients || []).map((ing, i) => {
                    const found = safe_warehouseItems.find(w =>
                      w.name.toLowerCase().includes(ing.name.toLowerCase()) ||
                      ing.name.toLowerCase().includes(w.name.toLowerCase())
                    );
                    return (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <span className={`h-2 w-2 rounded-full shrink-0 ${found ? "bg-emerald-400" : "bg-yellow-400"}`} />
                        <span className="font-bold text-white">{ing.name}</span>
                        <span className="text-slate-400">{ing.quantity} {ing.unit}</span>
                        {ing.hint && <span className="text-slate-500 text-xs">— {ing.hint}</span>}
                        {found
                          ? <span className="ml-auto text-xs text-emerald-400">есть на складе</span>
                          : <span className="ml-auto text-xs text-yellow-500">нет на складе</span>}
                      </div>
                    );
                  })}
                </div>

                {aiSuggestion.tip && (
                  <p className="text-xs text-slate-400 italic mb-3">💡 {aiSuggestion.tip}</p>
                )}

                <button type="button" onClick={applyAiSuggestion}
                  className="w-full rounded-xl bg-linear-to-r from-violet-600 to-blue-600 py-2.5 font-black text-white text-sm hover:opacity-90 transition">
                  ✨ Применить всё — заполнить состав и цены
                </button>
              </div>
            )}

            <input
              value={newProduct.cost}
              onChange={(e) =>
                setNewProduct((p) => ({ ...p, cost: e.target.value }))
              }
              placeholder="Себестоимость"
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500"
              readOnly={safe_recipe.length > 0}
            />

            <input
              value={newProduct.price}
              onChange={(e) =>
                setNewProduct((p) => ({ ...p, price: e.target.value }))
              }
              placeholder="Цена продажи"
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500"
            />
          </div>

          <div className="mt-6 rounded-4xl border border-white/10 bg-white/4 p-4">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-xl font-black">Состав / рецепт</h3>
                <p className="text-sm text-slate-400">
                  Опционально. Укажи сколько сырья уходит на 1 позицию. Например: эспрессо — зерно 20 г, капучино — зерно 18 г и молоко 180 мл.
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/4 px-4 py-3 text-right shadow-sm">
                <p className="text-xs font-bold text-slate-400">
                  Авто себестоимость
                </p>
                <p className="font-black text-blue-400">
                  {formatMoney(recipeCost)}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {safe_recipe.map((row, index) => {
                const selected = safe_warehouseItems.find(
                  (item) => String(item.id) === String(row.warehouseItemId)
                );
                const isManual = row.mode === "manual";

                return (
                  <div key={index} className="flex flex-col gap-2 rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                    {/* Переключатель режима */}
                    <div className="flex items-center gap-2">
                      <button type="button"
                        onClick={() => updateRecipeRow(index, "mode", "warehouse")}
                        className={`rounded-xl px-3 py-1 text-xs font-black transition ${!isManual ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/30" : "bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10"}`}>
                        📦 Со склада
                      </button>
                      <button type="button"
                        onClick={() => { updateRecipeRow(index, "mode", "manual"); updateRecipeRow(index, "warehouseItemId", ""); }}
                        className={`rounded-xl px-3 py-1 text-xs font-black transition ${isManual ? "bg-violet-500/20 text-violet-300 border border-violet-400/30" : "bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10"}`}>
                        ✨ Вручную (AI)
                      </button>
                      <button type="button" onClick={() => removeRecipeRow(index)}
                        className="ml-auto rounded-xl bg-red-500/10 px-3 py-1 text-xs font-black text-red-400 hover:bg-red-500/20">
                        удалить
                      </button>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-[1fr_130px_120px]">
                      {isManual ? (
                        <SmartIngredientInputPOS
                          value={row.ingredientName || ""}
                          onChange={(val) => updateRecipeRow(index, "ingredientName", val)}
                          warehouseItems={safe_warehouseItems}
                          onSelectItem={(id) => {
                            const item = safe_warehouseItems.find(w => String(w.id) === String(id));
                            updateRecipeRow(index, "warehouseItemId", id);
                            updateRecipeRow(index, "mode", "warehouse");
                            if (item) updateRecipeRow(index, "quantityUnit", item.unit);
                          }}
                        />
                      ) : (
                        <select
                          value={row.warehouseItemId}
                          onChange={(e) => {
                            const item = safe_warehouseItems.find((w) => String(w.id) === String(e.target.value));
                            updateRecipeRow(index, "warehouseItemId", e.target.value);
                            if (item) updateRecipeRow(index, "quantityUnit", item.unit);
                          }}
                          className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none"
                        >
                          <option value="">Выбери сырьё со склада</option>
                          {safe_warehouseItems.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} — остаток {item.quantity} {UNIT_LABELS[item.unit] || item.unit}
                            </option>
                          ))}
                        </select>
                      )}

                      <input type="number" value={row.quantity}
                        onChange={(e) => updateRecipeRow(index, "quantity", e.target.value)}
                        placeholder="Кол-во"
                        className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500"
                      />

                      <select value={row.quantityUnit || selected?.unit || "pcs"}
                        onChange={(e) => updateRecipeRow(index, "quantityUnit", e.target.value)}
                        className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none">
                        {RECIPE_UNITS.map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </div>

                    {isManual && row.ingredientName && !row.warehouseItemId && (
                      <p className="text-xs font-bold text-yellow-500">⚠ Добавь на склад — привяжется автоматически</p>
                    )}
                    {isManual && row.warehouseItemId && (
                      <p className="text-xs font-bold text-emerald-400">✓ Найден и привязан к складу</p>
                    )}
                    {selected && num(row.quantity) > 0 && (
                      <p className="rounded-2xl border border-blue-400/20 bg-blue-400/10 px-4 py-2 text-xs font-bold text-blue-300">
                        {row.quantity} {UNIT_LABELS[row.quantityUnit || selected.unit] || row.quantityUnit} → {convertRecipePreview(selected, row.quantity, row.quantityUnit || selected.unit).storageQty.toFixed(2)} {UNIT_LABELS[selected.unit] || selected.unit}
                      </p>
                    )}
                  </div>
                );
              })}

              {!safe_recipe.length && (
                <p className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-400">
                  Состав можно не указывать. Без состава позиция будет продаваться без списания со склада.
                </p>
              )}

              {!safe_warehouseItems.length && (
                <p className="rounded-2xl border border-yellow-400/20 bg-yellow-400/10 px-4 py-3 text-sm font-bold text-yellow-300">
                  На складе пока нет сырья. Сначала добавь зерно, молоко, курицу, рис и т.д. на странице “Склад”.
                </p>
              )}
            </div>

            <div className="mt-3 flex gap-2">
              <button type="button"
                onClick={() => addRecipeRow("warehouse")}
                className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-black text-slate-100 transition hover:bg-white/10">
                + Со склада
              </button>
              <button type="button"
                onClick={() => addRecipeRow("manual")}
                className="flex-1 rounded-2xl border border-violet-400/20 bg-violet-500/8 px-4 py-3 font-black text-violet-200 transition hover:bg-violet-500/15">
                ✨ Вручную (AI)
              </button>
            </div>
          </div>

          <div className="mt-6 flex gap-3">
            <button
              onClick={() => {
                setProductModal(false);
                setRecipe([]);
              }}
              className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 font-black text-slate-200 transition hover:bg-white/10"
            >
              Отмена
            </button>

            <button onClick={createProduct} className="flex-1 rounded-2xl bg-linear-to-r from-blue-600 to-violet-600 px-5 py-3 font-black text-white shadow-lg shadow-blue-900/30">
              Создать
            </button>
          </div>
        </Modal>
      )}
      </div>
    </div>
  );
}