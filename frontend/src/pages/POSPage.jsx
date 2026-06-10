import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { get, getSession, post } from "../api";
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
function SmartIngredientInputPOS({ value, onChange, warehouseItems = [], onSelectItem }) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef(null);

  const searchSuggestions = useCallback(async (text) => {
    if (!text || text.length < 2) { setSuggestions([]); setOpen(false); return; }
    setLoading(true);
    const lower = text.toLowerCase();

    const localMatches = warehouseItems
      .filter(i => i.name.toLowerCase().includes(lower))
      .slice(0, 4)
      .map(i => ({ id: i.id, name: i.name, source: "warehouse", unit: i.unit, qty: i.quantity, hint: `остаток: ${i.quantity} ${i.unit}` }));

    if (localMatches.length >= 3) {
      setSuggestions(localMatches); setOpen(true); setLoading(false); return;
    }

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 600,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages: [{ role: "user", content: `Пользователь кофейни вводит ингредиент: "${text}"

Используй web_search чтобы найти правильное русское название этого ингредиента и популярные аналоги в кофейнях России.

На складе уже есть: ${warehouseItems.slice(0, 40).map(i => `${i.name}(id:${i.id})`).join(", ")}

После поиска верни ТОЛЬКО JSON массив (без markdown):
[{"name": "правильное название", "source": "warehouse|ai", "warehouseId": null, "hint": "пояснение"}]

- Исправь опечатки, найди правильное написание
- Если есть на складе — source=warehouse, укажи warehouseId
- Максимум 5 вариантов` }]
        })
      });
      const data = await res.json();
      const raw = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("") || "[]";
      const clean = raw.replace(/```json|```/g, "").trim();
      const match = clean.match(/\[[\s\S]*\]/);
      const aiItems = match ? JSON.parse(match[0]) : [];
      const merged = [...localMatches];
      for (const s of aiItems) {
        if (merged.find(m => m.name.toLowerCase() === s.name.toLowerCase())) continue;
        const wItem = warehouseItems.find(i => i.id === s.warehouseId);
        merged.push({ id: wItem?.id || null, name: s.name, source: wItem ? "warehouse" : "ai", unit: wItem?.unit || "", qty: wItem?.quantity ?? null, hint: s.hint || "" });
      }
      setSuggestions(merged.slice(0, 6)); setOpen(true);
    } catch {
      setSuggestions(localMatches); setOpen(localMatches.length > 0);
    } finally { setLoading(false); }
  }, [warehouseItems]);

  const handleChange = (e) => {
    const val = e.target.value;
    onChange(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchSuggestions(val), 400);
  };

  const handleSelect = (s) => {
    onChange(s.name);
    if (s.id) onSelectItem(s.id);
    setSuggestions([]); setOpen(false);
  };

  return (
    <div className="relative sm:col-span-4">
      <div className="relative flex items-center">
        <span className="absolute left-3 text-sm">✨</span>
        <input type="text" value={value} onChange={handleChange}
          onFocus={() => value.length >= 2 && suggestions.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Введи название — AI найдёт правильное..."
          className="w-full rounded-2xl border border-violet-400/30 bg-violet-500/8 py-2.5 pl-8 pr-8 text-sm font-bold text-white outline-none placeholder:text-slate-500 focus:border-violet-400/60 focus:ring-2 focus:ring-violet-500/20"
        />
        {loading && <span className="absolute right-3"><span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-violet-400/30 border-t-violet-400" /></span>}
      </div>
      {open && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
          {suggestions.map((s, i) => (
            <button key={i} type="button" onMouseDown={() => handleSelect(s)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/8">
              <span className={`shrink-0 rounded-lg px-2 py-0.5 text-[10px] font-black ${s.source === "warehouse" ? "bg-emerald-500/20 text-emerald-300" : "bg-violet-500/20 text-violet-300"}`}>
                {s.source === "warehouse" ? "склад" : "AI"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black text-white">{s.name}</p>
                {s.hint && <p className="text-xs text-slate-400">{s.hint}</p>}
              </div>
              {s.source === "warehouse" && <span className="text-xs text-emerald-400">{s.qty} {s.unit}</span>}
            </button>
          ))}
        </div>
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
  const [paymentType, setPaymentType] = useState("cash");
  const [paidAmount, setPaidAmount] = useState("");
  const [cardId, setCardId] = useState("");
  const [debtName, setDebtName] = useState("");
  const [debtCustomers, setDebtCustomers] = useState([]);

  const [sectionModal, setSectionModal] = useState(false);
  const [categoryModal, setCategoryModal] = useState(false);
  const [productModal, setProductModal] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [aiSuggestionLoading, setAiSuggestionLoading] = useState(false);
  const aiDebounceRef = useRef(null);

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
  const safe_products = Array.isArray(products) ? products : [];
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
    if (selectedSectionId === "all") return safe_categories;

    return safe_categories.filter(
      (c) => String(c.typeId) === String(selectedSectionId)
    );
  }, [categories, selectedSectionId]);

  const productsInsideCategory = useMemo(() => {
    if (!openedCategory) return [];

    const q = search.trim().toLowerCase();

    return safe_products.filter((p) => {
      const okCategory = String(p.categoryId) === String(openedCategory.id);
      const okSearch = !q || String(p.name || "").toLowerCase().includes(q);
      return okCategory && okSearch;
    });
  }, [products, openedCategory, search]);

  const subtotal = safe_cart.reduce((s, i) => s + money(i.price) * money(i.qty), 0);
  const discountAmount = (subtotal * num(discount)) / 100;
  const total = Math.max(0, subtotal - discountAmount);
  const change =
    paymentType === "cash" && paidAmount !== "" ? num(paidAmount) - total : 0;

  const debtSuggestions = useMemo(() => {
    const q = debtName.trim().toLowerCase();
    if (!q) return safe_debtCustomers.slice(0, 5);
    return safe_debtCustomers
      .filter((c) => String(c.name || "").toLowerCase().includes(q))
      .slice(0, 5);
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
    return safe_recipe.reduce((sum, row) => {
      const warehouseItem = safe_warehouseItems.find(
        (item) => String(item.id) === String(row.warehouseItemId)
      );

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
    setAiSuggestionLoading(true);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 800,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages: [{ role: "user", content: 'Меню кофейни/кафе. Позиция: "' + name + '". Найди стандартный рецепт и типичную себестоимость в кофейне России. Верни ТОЛЬКО JSON без markdown: {"displayName":"правильное название","description":"что это (1 предложение)","typicalPrice":250,"estimatedCost":80,"ingredients":[{"name":"зерно кофе","quantity":18,"unit":"г","hint":"двойной эспрессо"}],"tip":"короткий совет"}' }]
        })
      });
      const data = await res.json();
      const raw = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) setAiSuggestion(JSON.parse(match[0]));
    } catch { setAiSuggestion(null); }
    finally { setAiSuggestionLoading(false); }
  }, []);

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

    const cleanRecipe = recipe
      .filter((row) => row.warehouseItemId && num(row.quantity) > 0)
      .map((row) => ({
        warehouseItemId: Number(row.warehouseItemId),
        warehouse_item_id: Number(row.warehouseItemId),
        quantity: num(row.quantity),
        quantityUnit: row.quantityUnit || "",
        quantity_unit: row.quantityUnit || "",
      }));

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
    setError("");

    if (mode === "transfer" && !cardId) return setError("Выбери карту");
    if (mode === "debt" && !debtName.trim()) return setError("Введите имя клиента");

    if (mode === "pending") {
      await post("/pending-sales", salePayload());
      await resetSale();
      alert("Чек отправлен в ожидание оплаты");
      return;
    }

    await post("/sales", salePayload({
      cardId: mode === "transfer" ? Number(cardId) : 0,
      paymentType: mode,
      cashGiven: mode === "cash" ? num(paidAmount) : 0,
      customerName: mode === "debt" ? debtName.trim() : "",
    }));

    await resetSale();
    alert(mode === "debt" ? "Долг сохранён" : "Продажа сохранена");
  };

  return (
    <div
      className="relative min-h-screen pb-nav text-white sm:pb-10"
      style={{ WebkitTapHighlightColor: "transparent" }}
    >
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-[-120px] top-[-120px] h-[360px] w-[360px] rounded-full bg-blue-600/20 blur-3xl" />
        <div className="absolute right-[-140px] bottom-[-140px] h-[360px] w-[360px] rounded-full bg-violet-600/20 blur-3xl" />
      </div>
      <div className="relative z-10">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-bold text-blue-400">Касса</p>
          <h2 className="text-4xl font-black leading-none text-white sm:text-5xl">
            Магазин
          </h2>
        </div>

        <div className="rounded-[32px] border border-white/10 bg-[#0f172a]/80 px-4 py-3 shadow-2xl backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 text-lg font-black text-white">
              {String(activeWorkerName || "A").slice(0, 1).toUpperCase()}
            </div>
            <div>
              <p className="text-xs font-black uppercase text-slate-400">
                Сейчас работает
              </p>
              <p className="text-lg font-black text-white">
                {activeWorkerName}
              </p>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-2xl bg-red-500/10 px-4 py-3 font-bold text-red-300">
          {error}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_420px] xl:items-start">
        <div className="space-y-5">
          <div className="rounded-[32px] border border-white/10 bg-[#0f172a]/80 p-4 shadow-2xl backdrop-blur sm:p-5">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-bold text-slate-400">Меню</p>
                <h3 className="text-2xl font-black">
                  {openedCategory ? openedCategory.name : "Категории"}
                </h3>
              </div>

              {openedCategory && (
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Найти позицию"
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full lg:w-80"
                />
              )}
            </div>

            {!openedCategory && (
              <div>
                <p className="mb-2 text-sm font-black text-slate-400">
                  Разделы меню
                </p>

                <div className="flex gap-2 overflow-x-auto pb-1">
                  <button
                    onClick={() => {
                      setSelectedSectionId("all");
                      setOpenedCategory(null);
                    }}
                    className={
                      selectedSectionId === "all"
                        ? "btn-dark shrink-0"
                        : "btn-white shrink-0"
                    }
                  >
                    Все
                  </button>

                  {safe_sections.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        setSelectedSectionId(String(s.id));
                        setOpenedCategory(null);
                      }}
                      className={
                        String(selectedSectionId) === String(s.id)
                          ? "btn-dark shrink-0"
                          : "btn-white shrink-0"
                      }
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {openedCategory && (
              <div className="flex flex-col gap-3 rounded-[1.5rem] bg-slate-950 p-4 text-white sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-slate-400">Открытая категория</p>
                  <p className="text-2xl font-black">{openedCategory.name}</p>
                </div>

                <button
                  onClick={() => {
                    setOpenedCategory(null);
                    setSearch("");
                  }}
                  className="rounded-2xl bg-[#111827] px-4 py-3 font-black text-white"
                >
                  ← Назад к категориям
                </button>
              </div>
            )}
          </div>

          {!isWorkspaceUser && (
            <div className="grid grid-cols-3 gap-2 sm:flex">
              <button
                onClick={() => setSectionModal(true)}
                className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 font-black text-slate-200 transition hover:bg-white/10"
              >
                + Раздел
              </button>

              <button
                onClick={() => {
                  setNewCategory((p) => ({
                    ...p,
                    sectionId:
                      selectedSectionId !== "all" ? selectedSectionId : "",
                  }));
                  setCategoryModal(true);
                }}
                className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 font-black text-slate-200 transition hover:bg-white/10"
              >
                + Категория
              </button>

              <button
                onClick={openProductModal}
                disabled={!openedCategory}
                className={`rounded-2xl px-5 py-3 font-black shadow-sm ${
                  openedCategory
                    ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-blue-900/30"
                    : "bg-white/5 text-slate-500"
                }`}
              >
                + Позиция
              </button>
            </div>
          )}

          {!openedCategory ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4">
              {visibleCategories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => {
                    setOpenedCategory(cat);
                    setSearch("");
                  }}
                  className="group relative overflow-hidden rounded-[32px] border border-white/10 bg-[#111827] p-5 text-left shadow-xl transition hover:-translate-y-1 hover:border-blue-500/40 hover:shadow-blue-900/20 focus:outline-none focus:ring-4 focus:ring-blue-500/30"
                >
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/100/10 text-2xl">
                    📁
                  </div>

                  <p className="text-xs font-bold text-blue-400">
                    {cat.typeName || cat.type || "Раздел"}
                  </p>

                  <h3 className="mt-1 text-xl font-black text-white">
                    {cat.name}
                  </h3>

              
                </button>
              ))}

              {!visibleCategories.length && (
                <div className="col-span-full rounded-[32px] border border-white/10 bg-[#0f172a]/80 p-10 text-center shadow-2xl backdrop-blur">
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
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {productsInsideCategory.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  className="group relative overflow-hidden rounded-[32px] border border-white/10 bg-[#111827] p-4 text-left shadow-xl transition hover:-translate-y-1 hover:border-blue-500/40 hover:shadow-blue-900/20 focus:outline-none focus:ring-4 focus:ring-blue-500/30"
                >
                  <div className="text-xs font-bold text-blue-400">
                    {p.category}
                  </div>

                  <div className="mt-1 text-lg font-black sm:text-xl">
                    {p.name}
                  </div>

                  <div className="mt-3 text-lg font-black text-slate-200">
                    {formatMoney(p.price)}
                  </div>
                </button>
              ))}

              {!productsInsideCategory.length && (
                <div className="col-span-full rounded-[32px] border border-white/10 bg-[#0f172a]/80 p-10 text-center shadow-2xl backdrop-blur">
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

        <div className="rounded-[32px] border border-white/10 bg-[#0f172a]/90 p-4 shadow-2xl backdrop-blur xl:sticky xl:top-6 xl:self-start sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-2xl font-black">Корзина</h3>

            {safe_cart.length > 0 && (
              <button
                onClick={() => setCart([])}
                className="rounded-2xl bg-red-500/10 px-3 py-2 text-sm font-black text-red-300"
              >
                Очистить
              </button>
            )}
          </div>

          <div className="max-h-72 space-y-2 overflow-auto">
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

                <div className="flex gap-2">
                  <button
                    onClick={() => decreaseCartItem(i.productId)}
                    className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2 font-black text-white transition hover:bg-white/20"
                  >
                    −
                  </button>

                  <button
                    onClick={() => increaseCartItem(i.productId)}
                    className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2 font-black text-white transition hover:bg-white/20"
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

          <div className="mt-4">
            <input
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              placeholder="Скидка %"
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 w-full"
            />
          </div>

          <div className="mt-4 rounded-[32px] border border-white/10 bg-gradient-to-br from-blue-600/10 to-violet-600/10 p-5">
            <div className="flex justify-between">
              <span>Сумма</span>
              <b>{formatMoney(subtotal)}</b>
            </div>

            <div className="mt-2 flex justify-between text-red-300">
              <span>Скидка</span>
              <b>{formatMoney(discountAmount)}</b>
            </div>

            <div className="mt-3 flex justify-between text-2xl">
              <span>Итого</span>
              <b>{formatMoney(total)}</b>
            </div>


          </div>

          <button onClick={confirmSale} className="mt-5 w-full rounded-3xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-5 text-xl font-black text-white shadow-2xl shadow-blue-900/30 transition hover:scale-[1.01]">
            Подтвердить покупку
          </button>
        </div>
      </div>

      <button
        onClick={confirmSale}
        className="fixed bottom-4 left-4 right-4 z-50 rounded-3xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-5 text-lg font-black text-white shadow-2xl shadow-blue-900/40 xl:hidden"
      >
        Подтвердить · {formatMoney(total)}
      </button>

      {paymentModal && (
        <Modal title="Способ оплаты" wide>
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
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
            <button onClick={() => submitSale(paymentType)} className="flex-1 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-3 font-black text-white shadow-lg shadow-blue-900/30">
              {paymentType === "pending" ? "В ожидание" : "Подтвердить"}
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

            <button onClick={createSection} className="flex-1 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-3 font-black text-white shadow-lg shadow-blue-900/30">
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

            <button onClick={createCategory} className="flex-1 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-3 font-black text-white shadow-lg shadow-blue-900/30">
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

            <div className="relative sm:col-span-2">
              <input
                value={newProduct.name}
                onChange={(e) => {
                  setNewProduct((p) => ({ ...p, name: e.target.value }));
                  clearTimeout(aiDebounceRef.current);
                  aiDebounceRef.current = setTimeout(() => analyzeProductName(e.target.value), 800);
                }}
                placeholder="Название позиции (AI подскажет состав...)"
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500"
              />
              {aiSuggestionLoading && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2 text-xs font-bold text-violet-300">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-violet-400/30 border-t-violet-400" />
                  AI анализирует...
                </div>
              )}
            </div>

            {/* AI предложение */}
            {aiSuggestion && (
              <div className="sm:col-span-2 rounded-2xl border border-violet-400/20 bg-gradient-to-br from-violet-500/10 to-blue-500/5 p-4">
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
                  className="w-full rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 py-2.5 font-black text-white text-sm hover:opacity-90 transition">
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

          <div className="mt-6 rounded-[32px] border border-white/10 bg-white/[0.04] p-4">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-xl font-black">Состав / рецепт</h3>
                <p className="text-sm text-slate-400">
                  Опционально. Укажи сколько сырья уходит на 1 позицию. Например: эспрессо — зерно 20 г, капучино — зерно 18 г и молоко 180 мл.
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-right shadow-sm">
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

            <button onClick={createProduct} className="flex-1 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-3 font-black text-white shadow-lg shadow-blue-900/30">
              Создать
            </button>
          </div>
        </Modal>
      )}
      </div>
    </div>
  );
}