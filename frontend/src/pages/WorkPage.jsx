import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { del, get, post, put } from "../api";
import Modal from "../components/Modal";
import { formatMoney, money, num } from "../utils/format";


// ─── AI-компонент ввода ингредиента вручную ──────────────────────────────────
function SmartIngredientInput({ value, onChange, warehouseItems = [], onSelectItem }) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef(null);

  const searchSuggestions = useCallback(async (text) => {
    if (!text || text.length < 2) { setSuggestions([]); setOpen(false); return; }
    setLoading(true);
    const lower = text.toLowerCase();

    // 1. Локальный поиск по складу
    const localMatches = warehouseItems
      .filter(i => i.name.toLowerCase().includes(lower))
      .slice(0, 4)
      .map(i => ({ id: i.id, name: i.name, source: "warehouse", unit: i.unit, qty: i.quantity, hint: `остаток: ${i.quantity} ${i.unit}` }));

    if (localMatches.length >= 3) {
      setSuggestions(localMatches); setOpen(true); setLoading(false); return;
    }

    // 2. AI ищет в интернете и нормализует название
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 600,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages: [{ role: "user", content: `Пользователь кофейни вводит ингредиент: "${text}"

Используй web_search чтобы найти правильное русское название этого ингредиента, стандартные варианты написания, и популярные аналоги используемые в кофейнях/кафе России.

На складе уже есть: ${warehouseItems.slice(0, 40).map(i => `${i.name}(id:${i.id})`).join(", ")}

После поиска верни ТОЛЬКО JSON массив (без markdown, без пояснений):
[{"name": "правильное название", "source": "warehouse|ai", "warehouseId": null, "hint": "короткое пояснение"}]

- Исправь опечатки, найди правильное написание
- Если есть на складе — source=warehouse, укажи warehouseId из списка выше
- Максимум 5 вариантов` }]
        })
      });
      const data = await res.json();
      // Собираем текст из всех блоков (включая после web_search)
      const raw = (data.content || [])
        .filter(b => b.type === "text")
        .map(b => b.text)
        .join("") || "[]";
      const clean = raw.replace(/```json|```/g, "").trim();
      const jsonMatch = clean.match(/\[[\s\S]*\]/);
      const aiItems = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
      const merged = [...localMatches];
      for (const s of aiItems) {
        if (merged.find(m => m.name.toLowerCase() === s.name.toLowerCase())) continue;
        const wItem = warehouseItems.find(i => i.id === s.warehouseId);
        merged.push({ id: wItem?.id || null, name: s.name, source: wItem ? "warehouse" : "ai", unit: wItem?.unit || "", qty: wItem?.quantity ?? null, hint: s.hint || "" });
      }
      setSuggestions(merged.slice(0, 6));
      setOpen(true);
    } catch {
      setSuggestions(localMatches);
      setOpen(localMatches.length > 0);
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
    <div className="relative">
      <div className="relative flex items-center">
        <span className="absolute left-3 text-sm">✨</span>
        <input
          type="text" value={value} onChange={handleChange}
          onFocus={() => value.length >= 2 && suggestions.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Введи название — AI подберёт правильное..."
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

export default function WorkPage() {
  const [types, setTypes] = useState([]);
  const [folders, setFolders] = useState([]);
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [warehouseItems, setWarehouseItems] = useState([]);

  const [selectedTypeId, setSelectedTypeId] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [search, setSearch] = useState("");

  const [filterModal, setFilterModal] = useState(false);
  const [structureModal, setStructureModal] = useState(false);
  const [typeModal, setTypeModal] = useState(false);
  const [folderModal, setFolderModal] = useState(false);
  const [productModal, setProductModal] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [aiSuggestionLoading, setAiSuggestionLoading] = useState(false);
  const [aiAdvisorEnabled, setAiAdvisorEnabled] = useState(true);
  const aiDebounceRef = useRef(null);
  const [importModal, setImportModal] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [editRecipe, setEditRecipe] = useState([]);
  const [editCostMode, setEditCostMode] = useState("auto"); // auto | manual

  const [newTypeName, setNewTypeName] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [productForm, setProductForm] = useState({
    name: "",
    cost: "",
    price: "",
  });
  const [recipe, setRecipe] = useState([]);
  const [error, setError] = useState("");

  // Safe array guards
  const safe_recipe = Array.isArray(recipe) ? recipe : [];

  const fileInputRef = useRef(null);

  const load = async () => {
    const [typeList, folderList, productList, salesList, warehouseList] =
      await Promise.all([
        get("/product-types"),
        get("/product-categories"),
        get("/menu-products"),
        get("/sales").catch(() => []),
        get("/warehouse/items").catch(() => []),
      ]);

    setTypes(typeList || []);
    setFolders(folderList || []);
    setProducts(productList || []);
    setSales(salesList || []);
    setWarehouseItems(warehouseList || []);

    if (!selectedTypeId && typeList?.length) {
      setSelectedTypeId(String(typeList[0].id));
    }
  };

  useEffect(() => {
    load().catch((e) => setError(e.message));

    const timer = setInterval(() => {
      load().catch(() => {});
    }, 5000);

    return () => clearInterval(timer);
  }, []);

  const safeTypes = Array.isArray(types) ? types : [];
  const safeFolders = Array.isArray(folders) ? folders : [];
  const safeSales = Array.isArray(sales) ? sales : [];
  const safeProducts = Array.isArray(products) ? products : [];
  const safeWarehouseItems = Array.isArray(warehouseItems) ? warehouseItems : [];

  const selectedType = safeTypes.find(
    (t) => String(t.id) === String(selectedTypeId)
  );

  const typeFolders = safeFolders.filter(
    (f) => String(f.typeId || "") === String(selectedTypeId)
  );

  const selectedFolder = safeFolders.find(
    (f) => String(f.id) === String(selectedFolderId)
  );

  useEffect(() => {
    if (!selectedTypeId) {
      setSelectedFolderId("");
      return;
    }

    const list = safeFolders.filter(
      (f) => String(f.typeId || "") === String(selectedTypeId)
    );

    if (
      selectedFolderId &&
      !list.some((f) => String(f.id) === String(selectedFolderId))
    ) {
      setSelectedFolderId("");
    }
  }, [selectedTypeId, folders, selectedFolderId]);

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

  const salesStatsByProduct = useMemo(() => {
    const map = {};

    const addItem = (item) => {
      const name =
        item.productName ||
        item.name ||
        item.product_name ||
        item.title ||
        "";

      if (!name) return;

      const key = String(name).trim().toLowerCase();
      const qty = Number(item.qty || item.quantity || item.count || 1);

      if (!map[key]) {
        map[key] = {
          quantity: 0,
        };
      }

      map[key].quantity += qty;
    };

    safeSales.forEach((sale) => {
      if (Array.isArray(sale.items)) {
        sale.items.forEach(addItem);
      }

      if (sale.productName || sale.name || sale.product_name) {
        addItem(sale);
      }
    });

    return map;
  }, [sales]);

  const visibleProducts = useMemo(() => {
    const q = search.trim().toLowerCase();

    return safeProducts.filter((p) => {
      const sameType =
        !selectedTypeId || String(p.typeId || "") === String(selectedTypeId);

      const sameFolder =
        !selectedFolderId || String(p.categoryId) === String(selectedFolderId);

      const bySearch = !q || String(p.name || "").toLowerCase().includes(q);

      return sameType && sameFolder && bySearch;
    });
  }, [products, selectedFolderId, selectedTypeId, search]);

  const productRows = useMemo(() => {
    return visibleProducts.map((p) => {
      const key = String(p.name || "").trim().toLowerCase();
      const quantity = salesStatsByProduct[key]?.quantity || 0;

      const costOne = money(p.cost);
      const priceOne = money(p.price);

      const totalCost = costOne * quantity;
      const revenue = priceOne * quantity;
      const profitOne = priceOne - costOne;
      const cleanProfit = profitOne * quantity;

      return {
        ...p,
        quantity,
        totalCost,
        revenue,
        profitOne,
        cleanProfit,
      };
    });
  }, [visibleProducts, salesStatsByProduct]);

  const totals = useMemo(() => {
    return productRows.reduce(
      (acc, p) => {
        acc.quantity += p.quantity;
        acc.cost += p.totalCost;
        acc.revenue += p.revenue;
        acc.cleanProfit += p.cleanProfit;
        return acc;
      },
      {
        quantity: 0,
        cost: 0,
        revenue: 0,
        cleanProfit: 0,
      }
    );
  }, [productRows]);

  const createType = async () => {
    setError("");

    if (!newTypeName.trim()) {
      return setError("Введите тип: например Напитки или Еда");
    }

    const created = await post("/product-types", {
      name: newTypeName.trim(),
    });

    setTypeModal(false);
    setNewTypeName("");
    await load();
    setSelectedTypeId(String(created.id));
    setStructureModal(true);
  };

  const createFolder = async () => {
    setError("");

    if (!selectedTypeId) return setError("Сначала создай и выбери тип");
    if (!newFolderName.trim()) return setError("Введите название папки");

    const created = await post("/product-categories", {
      name: newFolderName.trim(),
      typeId: Number(selectedTypeId),
    });

    setFolderModal(false);
    setNewFolderName("");
    await load();
    setSelectedFolderId(String(created.id));
    setStructureModal(true);
  };

  const recipeCost = useMemo(() => {
    return safe_recipe.reduce((sum, row) => {
      const warehouseItem = safeWarehouseItems.find(
        (item) => String(item.id) === String(row.warehouseItemId)
      );

      if (!warehouseItem) return sum;

      return sum + num(row.quantity) * getWarehouseUnitCost(warehouseItem);
    }, 0);
  }, [recipe, warehouseItems]);

  useEffect(() => {
    if (safe_recipe.length) {
      setProductForm((p) => ({
        ...p,
        cost: recipeCost ? String(recipeCost.toFixed(2)) : "",
      }));
    }
  }, [recipeCost, safe_recipe.length]);

  const analyzeProductNameWork = useCallback(async (name) => {
    if (!name || name.trim().length < 3) { setAiSuggestion(null); return; }
    if (!aiAdvisorEnabled) return;
    setAiSuggestionLoading(true);
    try {
      const data = await post("/ai/menu/suggest", {
        name,
        warehouseItems: safeWarehouseItems.map(w => ({ id: w.id, name: w.name, unit: w.unit }))
      });
      if (data && data.displayName) setAiSuggestion(data);
    } catch { setAiSuggestion(null); }
    finally { setAiSuggestionLoading(false); }
  }, [safeWarehouseItems, aiAdvisorEnabled]);

  const applyAiSuggestionWork = () => {
    if (!aiSuggestion) return;
    setProductForm(p => ({
      ...p,
      name: aiSuggestion.displayName || p.name,
      price: p.price || String(aiSuggestion.typicalPrice || ""),
      cost: p.cost || String(aiSuggestion.estimatedCost || ""),
    }));
    const rows = (aiSuggestion.ingredients || []).map(ing => {
      const found = safeWarehouseItems.find(w =>
        w.name.toLowerCase().includes(ing.name.toLowerCase()) ||
        ing.name.toLowerCase().includes(w.name.toLowerCase())
      );
      return {
        warehouseItemId: found ? String(found.id) : "",
        ingredientName: ing.name,
        quantity: String(ing.quantity),
        quantityUnit: ing.unit === "мл" ? "ml" : "g",
        mode: found ? "warehouse" : "manual",
      };
    });
    if (rows.length) setRecipe(rows);
    setAiSuggestion(null);
  };

  const openProductModal = () => {
    setAiSuggestion(null);
    setAiSuggestionLoading(false);
    setError("");
    setProductForm({ name: "", cost: "", price: "" });
    setRecipe([]);
    setProductModal(true);
  };

  const addRecipeRow = (mode = "warehouse") => {
    setRecipe((rows) => [
      ...rows,
      { warehouseItemId: "", ingredientName: "", quantity: "", mode },
    ]);
  };

  const updateRecipeRow = (index, key, value) => {
    setRecipe((rows) =>
      rows.map((row, i) => (i === index ? { ...row, [key]: value } : row))
    );
  };

  const removeRecipeRow = (index) => {
    setRecipe((rows) => rows.filter((_, i) => i !== index));
  };

  const createProduct = async () => {
    setError("");

    if (!selectedFolderId) return setError("Сначала выбери папку/раздел");
    if (!productForm.name.trim()) return setError("Введите название товара");

    const cleanRecipe = recipe
      .filter((row) => (row.warehouseItemId || row.ingredientName) && num(row.quantity) > 0)
      .map((row) => ({
        warehouseItemId: Number(row.warehouseItemId) || 0,
        warehouse_item_id: Number(row.warehouseItemId) || 0,
        ingredientName: row.ingredientName || "",
        itemName: row.ingredientName || "",
        quantity: num(row.quantity),
      }));

    await post("/menu-products", {
      categoryId: Number(selectedFolderId),
      name: productForm.name.trim(),
      cost: cleanRecipe.length ? recipeCost : num(productForm.cost),
      price: num(productForm.price),
      recipe: cleanRecipe,
    });

    setProductModal(false);
    setProductForm({ name: "", cost: "", price: "" });
    setRecipe([]);
    await load();
  };

  const deleteProduct = async (id) => {
    if (!confirm("Удалить товар?")) return;
    await del(`/menu-products/${id}`);
    await load();
  };

  const openEditProduct = (p) => {
    setEditProduct({ ...p, cost: String(p.cost || ""), price: String(p.price || "") });
    const recipeRows = (p.recipe || []).map(r => ({
      warehouseItemId: r.warehouseItemId || r.warehouse_item_id || "",
      ingredientName: r.ingredientName || r.itemName || r.item_name || "",
      quantity: String(r.quantity || ""),
      quantityUnit: r.quantityUnit || r.quantity_unit || r.unit || "g",
      mode: (r.warehouseItemId || r.warehouse_item_id) ? "warehouse" : "manual",
    }));
    setEditRecipe(recipeRows);
    setEditCostMode(recipeRows.length > 0 ? "auto" : "manual");
    setEditModal(true);
  };

  const saveEditProduct = async () => {
    if (!editProduct) return;
    const cleanRecipe = editRecipe
      .filter(r => (r.warehouseItemId || r.ingredientName) && num(r.quantity) > 0)
      .map(r => ({
        warehouseItemId: Number(r.warehouseItemId) || 0,
        warehouse_item_id: Number(r.warehouseItemId) || 0,
        ingredientName: r.ingredientName || "",
        itemName: r.ingredientName || "",
        quantity: num(r.quantity),
        quantityUnit: r.quantityUnit || "g",
        quantity_unit: r.quantityUnit || "g",
      }));
    const autoCost = editCostMode === "auto" && cleanRecipe.length > 0
      ? cleanRecipe.reduce((sum, r) => {
          const item = safeWarehouseItems.find(w => String(w.id) === String(r.warehouseItemId));
          return sum + (item ? num(r.quantity) * num(item.unitCost ?? item.unit_cost ?? 0) : 0);
        }, 0)
      : null;
    await put(`/menu-products/${editProduct.id}`, {
      ...editProduct,
      cost: autoCost !== null && autoCost > 0 ? autoCost : num(editProduct.cost),
      price: num(editProduct.price),
      costMode: editCostMode,
      recipe: cleanRecipe,
    });
    setEditModal(false);
    await load();
  };

  const updateEditRecipeRow = (index, key, value) => {
    setEditRecipe(rows => rows.map((r, i) => i === index ? { ...r, [key]: value } : r));
  };
  const removeEditRecipeRow = (index) => {
    setEditRecipe(rows => rows.filter((_, i) => i !== index));
  };
  const addEditRecipeRow = (mode = "warehouse") => {
    setEditRecipe(rows => [...rows, { warehouseItemId: "", ingredientName: "", quantity: "", quantityUnit: "g", mode }]);
  };

  const csvCell = (value) => {
    const text = String(value ?? "");
    return `"${text.replaceAll('"', '""')}"`;
  };

  const exportExcel = () => {
    const rows = [
      [
        "Название",
        "Тип",
        "Папка",
        "Себестоимость",
        "Цена продажи",
        "Кол-во",
        "Выручка",
        "Чистая прибыль",
      ],
      ...productRows.map((p) => [
        p.name,
        p.typeName || p.type || "",
        p.category || "",
        money(p.cost),
        money(p.price),
        p.quantity,
        p.revenue,
        p.cleanProfit,
      ]),
    ];

    const csv =
      "\uFEFF" + rows.map((row) => row.map(csvCell).join(";")).join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = `menu-products-${selectedType?.name || "all"}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const findOrCreateType = async (name) => {
    const clean = String(name || "").trim();

    if (!clean) throw new Error("В Excel не заполнен тип");

    const existing = safeTypes.find(
      (t) => String(t.name).trim().toLowerCase() === clean.toLowerCase()
    );

    if (existing) return existing;

    return await post("/product-types", { name: clean });
  };

  const findOrCreateFolder = async (name, typeId, localFolders) => {
    const clean = String(name || "").trim();

    if (!clean) throw new Error("В Excel не заполнена папка");

    const existing = localFolders.find(
      (f) =>
        String(f.typeId || "") === String(typeId) &&
        String(f.name).trim().toLowerCase() === clean.toLowerCase()
    );

    if (existing) return existing;

    const created = await post("/product-categories", {
      name: clean,
      typeId: Number(typeId),
    });

    localFolders.push(created);
    return created;
  };

  const parseCsvLine = (line) => {
    const result = [];
    let current = "";
    let inQuotes = false;
    const delimiter = line.includes(";") ? ";" : ",";

    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];

      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === delimiter && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }

    result.push(current.trim());
    return result;
  };

  const importExcel = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError("");

    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((line) => line.trim());
      const dataLines = lines[0]?.toLowerCase().includes("название")
        ? lines.slice(1)
        : lines;

      const localFolders = [...folders];
      let imported = 0;

      for (const line of dataLines) {
        const [name, typeName, folderName, cost, price] = parseCsvLine(line);

        if (!name?.trim()) continue;

        const type = await findOrCreateType(typeName || selectedType?.name);
        const folder = await findOrCreateFolder(
          folderName || selectedFolder?.name,
          type.id,
          localFolders
        );

        await post("/menu-products", {
          categoryId: Number(folder.id),
          name: name.trim(),
          cost: num(cost),
          price: num(price),
        });

        imported += 1;
      }

      setImportModal(false);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      await load();
      alert(`Импортировано товаров: ${imported}`);
    } catch (e) {
      setError(e.message || "Ошибка импорта");
    }
  };

  return (
    <div className="relative -m-4 bg-[radial-gradient(circle_at_top_right,rgba(124,58,237,0.25),transparent_35%),linear-gradient(135deg,#020617,#0f172a_45%,#111827)] p-4 pb-nav text-slate-100 sm:-m-6 sm:p-6 sm:pb-10">
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-blue-600/20 blur-3xl" />
      <div className="pointer-events-none absolute left-1/3 top-20 h-64 w-64 rounded-full bg-violet-600/10 blur-3xl" />
      <div className="relative">
      <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="text-sm font-bold text-blue-400">Работа</p>
          <h2 className="text-3xl font-black leading-none text-white sm:text-5xl">
            Меню товаров
          </h2>
          <p className="mt-2 text-sm text-slate-400 sm:text-base">
            Текущие товары, продажи, количество и чистая прибыль
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          <button
            onClick={() => setStructureModal(true)}
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-black text-slate-100 shadow-lg shadow-black/10 backdrop-blur transition hover:bg-white/10 w-full sm:w-auto"
          >
            ⚙️ Типы и папки
          </button>

          <button
            onClick={() => setImportModal(true)}
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-black text-slate-100 shadow-lg shadow-black/10 backdrop-blur transition hover:bg-white/10 w-full sm:w-auto"
          >
            Импорт Excel
          </button>

          <button onClick={exportExcel} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-black text-slate-100 shadow-lg shadow-black/10 backdrop-blur transition hover:bg-white/10 w-full sm:w-auto">
            Экспорт Excel
          </button>

          <button
            onClick={openProductModal}
            className="rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 font-black text-white shadow-xl shadow-blue-950/40 transition hover:scale-[1.01] col-span-2 w-full sm:w-auto"
          >
            + Добавить товар
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-2xl bg-red-500/10 px-4 py-3 font-bold text-red-400">
          {error}
        </div>
      )}

      <div className="rounded-[2rem] border border-white/10 bg-white/[0.045] shadow-2xl shadow-black/20 backdrop-blur-xl overflow-hidden">
        <div className="flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-bold text-blue-400">
              {selectedType?.name || "Все типы"}
            </p>

            <h3 className="text-2xl font-black leading-none sm:text-3xl">
              {selectedFolder?.name ||
                (selectedType ? `Все: ${selectedType.name}` : "Все товары")}
            </h3>

            <p className="mt-2 text-sm text-slate-400 sm:text-base">
              Кол-во берётся из продаж и обновляется автоматически
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Найти товар"
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 shadow-inner shadow-black/10 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10 w-full sm:w-72"
            />

            <button
              onClick={() => setFilterModal(true)}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-black text-slate-100 shadow-lg shadow-black/10 backdrop-blur transition hover:bg-white/10 w-full sm:w-auto"
            >
              Фильтр
            </button>

            <button
              onClick={openProductModal}
              className="rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 font-black text-white shadow-xl shadow-blue-950/40 transition hover:scale-[1.01] w-full sm:w-auto"
            >
              + Товар
            </button>
          </div>
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[1050px] text-left">
            <thead className="bg-[#0f172a]/90/5 text-slate-300">
              <tr>
                <th className="p-4">Название</th>
                <th className="p-4">Тип</th>
                <th className="p-4">Папка</th>
                <th className="p-4">Себестоимость</th>
                <th className="p-4">Цена продажи</th>
                <th className="p-4">Кол-во</th>
                <th className="p-4">Выручка</th>
                <th className="p-4">Чистая прибыль</th>
                <th className="p-4"></th>
              </tr>
            </thead>

            <tbody>
              {productRows.map((p) => (
                <tr key={p.id} className="border-t border-white/10">
                  <td className="p-4 font-black">{p.name}</td>
                  <td className="p-4">{p.typeName || p.type}</td>
                  <td className="p-4">{p.category}</td>
                  <td className="p-4">{formatMoney(p.cost)}</td>
                  <td className="p-4">{formatMoney(p.price)}</td>
                  <td className="p-4 font-black">{p.quantity}</td>
                  <td className="p-4 font-black">{formatMoney(p.revenue)}</td>
                  <td className="p-4 font-black text-emerald-400">
                    {formatMoney(p.cleanProfit)}
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openEditProduct(p)}
                        className="rounded-xl bg-blue-500/10 px-3 py-2 text-xs font-black text-blue-400 hover:bg-blue-500/20"
                      >
                        ✏ Изменить
                      </button>
                      <button
                        onClick={() => deleteProduct(p.id)}
                        className="rounded-xl bg-red-500/10 px-3 py-2 font-black text-red-400"
                      >
                        ×
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {!productRows.length && (
                <tr>
                  <td colSpan="9" className="p-8 text-center text-slate-400">
                    Товаров пока нет
                  </td>
                </tr>
              )}
            </tbody>

            <tfoot className="bg-[#070b1a] font-black text-white">
              <tr>
                <td className="p-4" colSpan="3">
                  ИТОГО
                </td>
                <td className="p-4">{formatMoney(totals.cost)}</td>
                <td className="p-4">{formatMoney(totals.revenue)}</td>
                <td className="p-4">{totals.quantity}</td>
                <td className="p-4">{formatMoney(totals.revenue)}</td>
                <td className="p-4">{formatMoney(totals.cleanProfit)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="divide-y divide-white/10 md:hidden">
          {productRows.map((p) => (
            <div key={p.id} className="p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-black text-white">{p.name}</p>
                  <p className="text-sm text-slate-400">
                    {p.typeName || p.type} • {p.category}
                  </p>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => openEditProduct(p)}
                    className="rounded-xl bg-blue-500/10 px-3 py-2 text-xs font-black text-blue-400"
                  >
                    ✏
                  </button>
                  <button
                    onClick={() => deleteProduct(p.id)}
                    className="rounded-xl bg-red-500/10 px-3 py-2 font-black text-red-400"
                  >
                    ×
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-2xl bg-[#0f172a]/90/5 p-3">
                  <p className="text-slate-400">Себестоимость</p>
                  <p className="font-black">{formatMoney(p.cost)}</p>
                </div>

                <div className="rounded-2xl bg-[#0f172a]/90/5 p-3">
                  <p className="text-slate-400">Цена</p>
                  <p className="font-black">{formatMoney(p.price)}</p>
                </div>

                <div className="rounded-2xl bg-[#0f172a]/90/5 p-3">
                  <p className="text-slate-400">Кол-во</p>
                  <p className="font-black">{p.quantity}</p>
                </div>

                <div className="rounded-2xl bg-emerald-500/10 p-3">
                  <p className="text-slate-400">Чистая прибыль</p>
                  <p className="font-black text-emerald-400">
                    {formatMoney(p.cleanProfit)}
                  </p>
                </div>
              </div>
            </div>
          ))}

          {!productRows.length && (
            <div className="p-8 text-center text-slate-400">
              Товаров пока нет
            </div>
          )}

          <div className="bg-[#070b1a] p-4 font-black text-white">
            <div className="flex justify-between">
              <span>Кол-во</span>
              <span>{totals.quantity}</span>
            </div>
            <div className="flex justify-between">
              <span>Выручка</span>
              <span>{formatMoney(totals.revenue)}</span>
            </div>
            <div className="flex justify-between">
              <span>Чистая прибыль</span>
              <span>{formatMoney(totals.cleanProfit)}</span>
            </div>
          </div>
        </div>
      </div>

      <button
        onClick={openProductModal}
        className="fixed bottom-4 left-4 right-4 z-30 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-4 font-black text-white shadow-2xl shadow-blue-950/50 sm:hidden"
      >
        + Добавить товар
      </button>

      {filterModal && (
        <Modal title="Фильтр товаров">
          <div className="space-y-3">
            <label className="block">
              <span className="mb-2 block text-sm font-black text-slate-400">
                Тип
              </span>
              <select
                value={selectedTypeId}
                onChange={(e) => setSelectedTypeId(e.target.value)}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 shadow-inner shadow-black/10 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10 w-full"
              >
                <option value="">Все типы</option>
                {safeTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-black text-slate-400">
                Папка / раздел
              </span>
              <select
                value={selectedFolderId}
                onChange={(e) => setSelectedFolderId(e.target.value)}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 shadow-inner shadow-black/10 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10 w-full"
              >
                <option value="">Все папки</option>
                {typeFolders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-6 flex gap-3">
            <button
              onClick={() => {
                setSelectedTypeId("");
                setSelectedFolderId("");
                setSearch("");
              }}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-black text-slate-100 shadow-lg shadow-black/10 backdrop-blur transition hover:bg-white/10 flex-1"
            >
              Сбросить
            </button>

            <button
              onClick={() => setFilterModal(false)}
              className="rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 font-black text-white shadow-xl shadow-blue-950/40 transition hover:scale-[1.01] flex-1"
            >
              Показать
            </button>
          </div>
        </Modal>
      )}

      {structureModal && (
        <Modal title="Типы и папки" wide>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-3xl border border-white/10 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-xl font-black">Типы</h3>
                <button
                  onClick={() => {
                    setStructureModal(false);
                    setTypeModal(true);
                  }}
                  className="font-black text-blue-400"
                >
                  + тип
                </button>
              </div>

              <div className="space-y-2">
                {safeTypes.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTypeId(String(t.id))}
                    className={`w-full rounded-2xl px-4 py-4 text-left font-black ${
                      String(selectedTypeId) === String(t.id)
                        ? "bg-[#070b1a] text-white"
                        : "bg-[#0f172a]/90/5 text-slate-100"
                    }`}
                  >
                    {t.name}
                  </button>
                ))}

                {!safeTypes.length && (
                  <p className="text-slate-400">
                    Пока нет типов. Создай “Напитки” или “Еда”.
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-xl font-black">Папки</h3>
                  <p className="text-sm text-slate-400">
                    для типа: {selectedType?.name || "не выбран"}
                  </p>
                </div>

                <button
                  onClick={() => {
                    setStructureModal(false);
                    setFolderModal(true);
                  }}
                  className="font-black text-blue-400"
                >
                  + папка
                </button>
              </div>

              <div className="space-y-2">
                {typeFolders.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setSelectedFolderId(String(f.id))}
                    className={`w-full rounded-2xl px-4 py-4 text-left font-black ${
                      String(selectedFolderId) === String(f.id)
                        ? "bg-[#070b1a] text-white"
                        : "bg-[#0f172a]/90/5 text-slate-100"
                    }`}
                  >
                    {f.name}
                  </button>
                ))}

                {selectedTypeId && !typeFolders.length && (
                  <p className="text-slate-400">В этом типе ещё нет папок.</p>
                )}

                {!selectedTypeId && (
                  <p className="text-slate-400">Сначала выбери тип слева.</p>
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 flex gap-3">
            <button
              onClick={() => setStructureModal(false)}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-black text-slate-100 shadow-lg shadow-black/10 backdrop-blur transition hover:bg-white/10 flex-1"
            >
              Готово
            </button>

            <button
              onClick={() => {
                setStructureModal(false);
                openProductModal();
              }}
              className="rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 font-black text-white shadow-xl shadow-blue-950/40 transition hover:scale-[1.01] flex-1"
            >
              + Товар
            </button>
          </div>
        </Modal>
      )}

      {importModal && (
        <Modal title="Импорт Excel">
          <div className="space-y-4">
            <p className="text-sm text-slate-400">
              Загрузи CSV-файл, который открывается в Excel. Колонки:
              Название, Тип, Папка, Себестоимость, Цена продажи.
            </p>

            <button onClick={exportExcel} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-black text-slate-100 shadow-lg shadow-black/10 backdrop-blur transition hover:bg-white/10 w-full">
              Скачать пример / экспорт текущих товаров
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt"
              onChange={importExcel}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 shadow-inner shadow-black/10 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10 w-full"
            />
          </div>

          <div className="mt-6 flex gap-3">
            <button
              onClick={() => setImportModal(false)}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-black text-slate-100 shadow-lg shadow-black/10 backdrop-blur transition hover:bg-white/10 flex-1"
            >
              Закрыть
            </button>
          </div>
        </Modal>
      )}

      {typeModal && (
        <Modal title="Новый тип">
          <input
            value={newTypeName}
            onChange={(e) => setNewTypeName(e.target.value)}
            placeholder="Например: Напитки, Еда"
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 shadow-inner shadow-black/10 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10 w-full"
          />

          <div className="mt-6 flex gap-3">
            <button
              onClick={() => {
                setTypeModal(false);
                setStructureModal(true);
              }}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-black text-slate-100 shadow-lg shadow-black/10 backdrop-blur transition hover:bg-white/10 flex-1"
            >
              Отмена
            </button>

            <button onClick={createType} className="rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 font-black text-white shadow-xl shadow-blue-950/40 transition hover:scale-[1.01] flex-1">
              Создать
            </button>
          </div>
        </Modal>
      )}

      {folderModal && (
        <Modal title="Новая папка / раздел">
          <select
            value={selectedTypeId}
            onChange={(e) => setSelectedTypeId(e.target.value)}
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 shadow-inner shadow-black/10 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10 mb-3 w-full"
          >
            <option value="">Выбери тип</option>
            {safeTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          <input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Например: Холодные напитки"
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 shadow-inner shadow-black/10 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10 w-full"
          />

          <div className="mt-6 flex gap-3">
            <button
              onClick={() => {
                setFolderModal(false);
                setStructureModal(true);
              }}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-black text-slate-100 shadow-lg shadow-black/10 backdrop-blur transition hover:bg-white/10 flex-1"
            >
              Отмена
            </button>

            <button onClick={createFolder} className="rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 font-black text-white shadow-xl shadow-blue-950/40 transition hover:scale-[1.01] flex-1">
              Создать
            </button>
          </div>
        </Modal>
      )}

      {productModal && (
        <Modal title="Новая позиция меню" wide>
          <div className="grid gap-3 sm:grid-cols-2">
            <select
              value={selectedTypeId}
              onChange={(e) => setSelectedTypeId(e.target.value)}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 shadow-inner shadow-black/10 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10 sm:col-span-2"
            >
              <option value="">Выбери тип</option>
              {safeTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>

            <select
              value={selectedFolderId}
              onChange={(e) => setSelectedFolderId(e.target.value)}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 shadow-inner shadow-black/10 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10 sm:col-span-2"
            >
              <option value="">Выбери папку</option>
              {typeFolders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>

            <div className="relative sm:col-span-2">
              <input
                value={productForm.name}
                onChange={(e) => {
                  setProductForm((p) => ({ ...p, name: e.target.value }));
                  if (aiAdvisorEnabled) {
                    clearTimeout(aiDebounceRef.current);
                    aiDebounceRef.current = setTimeout(() => analyzeProductNameWork(e.target.value), 800);
                  }
                }}
                placeholder="Эспрессо, Капучино, Боул с курицей..."
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 pr-32 font-bold text-white outline-none placeholder:text-slate-500 shadow-inner focus:border-blue-400/60"
              />
              <button type="button"
                onClick={() => {
                  const next = !aiAdvisorEnabled;
                  setAiAdvisorEnabled(next);
                  if (!next) setAiSuggestion(null);
                  else if (productForm.name?.trim().length >= 3) analyzeProductNameWork(productForm.name);
                }}
                className={`absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-black transition ${
                  aiAdvisorEnabled ? "bg-violet-500/20 text-violet-300 border border-violet-400/30" : "bg-white/5 text-slate-500 border border-white/10"
                }`}>
                {aiSuggestionLoading
                  ? <><span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-violet-400/30 border-t-violet-400"/>Думаю...</>
                  : <>{aiAdvisorEnabled ? "✨ AI вкл" : "✨ AI выкл"}</>}
              </button>
            </div>

            {aiSuggestion && (
              <div className="sm:col-span-2 rounded-2xl border border-violet-400/20 bg-gradient-to-br from-violet-500/10 to-blue-500/5 p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-violet-300">✨ AI предлагает</p>
                    <p className="mt-1 font-black text-white">{aiSuggestion.displayName}</p>
                    <p className="text-xs text-slate-400">{aiSuggestion.description}</p>
                  </div>
                  <button type="button" onClick={() => setAiSuggestion(null)} className="text-slate-500 hover:text-white">×</button>
                </div>
                <div className="flex gap-3 mb-3 text-sm">
                  <div className="rounded-xl bg-emerald-500/10 border border-emerald-400/20 px-3 py-2">
                    <p className="text-[10px] text-slate-400">Цена</p>
                    <p className="font-black text-emerald-300">{aiSuggestion.typicalPrice} ₽</p>
                  </div>
                  <div className="rounded-xl bg-orange-500/10 border border-orange-400/20 px-3 py-2">
                    <p className="text-[10px] text-slate-400">Себест.</p>
                    <p className="font-black text-orange-300">{aiSuggestion.estimatedCost} ₽</p>
                  </div>
                </div>
                <div className="mb-3 space-y-1">
                  {(aiSuggestion.ingredients || []).map((ing, i) => {
                    const found = safeWarehouseItems.find(w => w.name.toLowerCase().includes(ing.name.toLowerCase()));
                    return (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${found ? "bg-emerald-400" : "bg-yellow-400"}`}/>
                        <span className="font-bold text-white">{ing.name}</span>
                        <span className="text-slate-400">{ing.quantity} {ing.unit}</span>
                        <span className="ml-auto text-[10px]">{found ? <span className="text-emerald-400">есть на складе</span> : <span className="text-yellow-500">нет на складе</span>}</span>
                      </div>
                    );
                  })}
                </div>
                {aiSuggestion.tip && <p className="text-xs text-slate-400 italic mb-3">💡 {aiSuggestion.tip}</p>}
                <button type="button" onClick={applyAiSuggestionWork}
                  className="w-full rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 py-2 font-black text-white text-xs hover:opacity-90">
                  ✨ Применить — заполнить состав и цены
                </button>
              </div>
            )}

            <input
              type="number"
              value={productForm.cost}
              onChange={(e) =>
                setProductForm((p) => ({ ...p, cost: e.target.value }))
              }
              placeholder="Себестоимость"
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 shadow-inner shadow-black/10 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10"
              readOnly={safe_recipe.length > 0}
            />

            <input
              type="number"
              value={productForm.price}
              onChange={(e) =>
                setProductForm((p) => ({ ...p, price: e.target.value }))
              }
              placeholder="Цена продажи"
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 shadow-inner shadow-black/10 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10"
            />
          </div>

          <div className="mt-6 rounded-[1.5rem] border border-white/10 bg-[#0f172a]/90/5 p-4">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-xl font-black">Состав / рецепт</h3>
                <p className="text-sm text-slate-400">
                  Укажи сколько сырья уходит на 1 товар. Например: эспрессо —
                  зерно 20 г, капучино — зерно 18 г и молоко 180 мл.
                </p>
              </div>

              <div className="rounded-2xl bg-[#0f172a]/90 px-4 py-3 text-right shadow-sm">
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
                const selected = safeWarehouseItems.find(
                  (item) => String(item.id) === String(row.warehouseItemId)
                );
                const isManual = row.mode === "manual";
                const isUnlinked = isManual && row.ingredientName && !row.warehouseItemId;

                return (
                  <div key={index} className="flex flex-col gap-1.5 rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                    {/* Переключатель режима */}
                    <div className="flex items-center gap-2 mb-1">
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

                    <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
                      {isManual ? (
                        <SmartIngredientInput
                          value={row.ingredientName || ""}
                          onChange={(val) => updateRecipeRow(index, "ingredientName", val)}
                          warehouseItems={safeWarehouseItems}
                          onSelectItem={(id) => { updateRecipeRow(index, "warehouseItemId", id); updateRecipeRow(index, "mode", "warehouse"); }}
                        />
                      ) : (
                        <select
                          value={row.warehouseItemId || ""}
                          onChange={(e) => updateRecipeRow(index, "warehouseItemId", e.target.value)}
                          className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10"
                        >
                          <option value="">Выбери сырьё со склада</option>
                          {safeWarehouseItems.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} — остаток {item.quantity} {item.unit}
                            </option>
                          ))}
                        </select>
                      )}

                      <input type="number" value={row.quantity}
                        onChange={(e) => updateRecipeRow(index, "quantity", e.target.value)}
                        placeholder={selected ? `${selected.unit}` : "Кол-во"}
                        className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 focus:border-blue-400/60"
                      />
                    </div>

                    {isUnlinked && (
                      <p className="text-xs font-bold text-yellow-500">
                        ⚠ «{row.ingredientName}» — добавь на склад, тогда привяжется и себестоимость посчитается
                      </p>
                    )}
                    {isManual && row.warehouseItemId && (
                      <p className="text-xs font-bold text-emerald-400">
                        ✓ Найден на складе и привязан автоматически
                      </p>
                    )}
                  </div>
                );
              })}

              {!safe_recipe.length && (
                <p className="rounded-2xl bg-[#0f172a]/90 px-4 py-3 text-sm text-slate-400">
                  Состав пока не добавлен. Без состава товар будет продаваться
                  без списания со склада.
                </p>
              )}

              {!safeWarehouseItems.length && (
                <p className="rounded-2xl bg-amber-500/10 px-4 py-3 text-sm font-bold text-amber-300">
                  На складе пока нет сырья. Сначала добавь зерно, молоко,
                  курицу, рис и т.д. на странице “Склад”.
                </p>
              )}
            </div>

            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => addRecipeRow("warehouse")}
                className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-black text-slate-100 transition hover:bg-white/10">
                + Со склада
              </button>
              <button type="button" onClick={() => addRecipeRow("manual")}
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
                setProductForm({ name: "", cost: "", price: "" });
              }}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-black text-slate-100 shadow-lg shadow-black/10 backdrop-blur transition hover:bg-white/10 flex-1"
            >
              Отмена
            </button>

            <button onClick={createProduct} className="rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 font-black text-white shadow-xl shadow-blue-950/40 transition hover:scale-[1.01] flex-1">
              Создать
            </button>
          </div>
        </Modal>
      )}

      {editModal && editProduct && (
        <Modal title={`Редактировать: ${editProduct.name}`} wide>
          <div className="grid gap-3 sm:grid-cols-2">
            <input value={editProduct.name}
              onChange={e => setEditProduct(p => ({...p, name: e.target.value}))}
              placeholder="Название" className="input sm:col-span-2"/>

            <input value={editProduct.price}
              onChange={e => setEditProduct(p => ({...p, price: e.target.value}))}
              placeholder="Цена продажи" type="number" className="input"/>

            {/* Переключатель себестоимости */}
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <span className="text-sm font-black text-slate-300">Себестоимость:</span>
              <button type="button" onClick={() => setEditCostMode("auto")}
                className={`rounded-xl px-3 py-1 text-xs font-black transition ${editCostMode === "auto" ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/30" : "bg-white/5 text-slate-400 border border-white/10"}`}>
                ⚡ Авто
              </button>
              <button type="button" onClick={() => setEditCostMode("manual")}
                className={`rounded-xl px-3 py-1 text-xs font-black transition ${editCostMode === "manual" ? "bg-orange-500/20 text-orange-300 border border-orange-400/30" : "bg-white/5 text-slate-400 border border-white/10"}`}>
                ✏ Вручную
              </button>
            </div>

            {editCostMode === "manual" && (
              <input value={editProduct.cost}
                onChange={e => setEditProduct(p => ({...p, cost: e.target.value}))}
                placeholder="Себестоимость (вручную)" type="number" className="input sm:col-span-2"/>
            )}
            {editCostMode === "auto" && (
              <div className="rounded-2xl border border-blue-400/20 bg-blue-500/10 px-4 py-3 text-sm font-bold text-blue-300 sm:col-span-2">
                ⚡ Авто-себестоимость считается из состава ниже
              </div>
            )}
          </div>

          {/* Состав / рецепт */}
          <div className="mt-4 rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
            <h3 className="mb-3 text-lg font-black text-white">Состав / рецепт</h3>
            <div className="space-y-3">
              {editRecipe.map((row, index) => {
                const selected = safeWarehouseItems.find(i => String(i.id) === String(row.warehouseItemId));
                const isManual = row.mode === "manual";
                return (
                  <div key={index} className="flex flex-col gap-2 rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => updateEditRecipeRow(index, "mode", "warehouse")}
                        className={`rounded-xl px-3 py-1 text-xs font-black transition ${!isManual ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/30" : "bg-white/5 text-slate-400 border border-white/10"}`}>
                        📦 Со склада
                      </button>
                      <button type="button" onClick={() => { updateEditRecipeRow(index, "mode", "manual"); updateEditRecipeRow(index, "warehouseItemId", ""); }}
                        className={`rounded-xl px-3 py-1 text-xs font-black transition ${isManual ? "bg-violet-500/20 text-violet-300 border border-violet-400/30" : "bg-white/5 text-slate-400 border border-white/10"}`}>
                        ✨ Вручную (AI)
                      </button>
                      <button type="button" onClick={() => removeEditRecipeRow(index)}
                        className="ml-auto rounded-xl bg-red-500/10 px-3 py-1 text-xs font-black text-red-400">удалить</button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
                      {isManual ? (
                        <SmartIngredientInput
                          value={row.ingredientName || ""}
                          onChange={val => updateEditRecipeRow(index, "ingredientName", val)}
                          warehouseItems={safeWarehouseItems}
                          onSelectItem={id => { updateEditRecipeRow(index, "warehouseItemId", id); updateEditRecipeRow(index, "mode", "warehouse"); }}
                        />
                      ) : (
                        <select value={row.warehouseItemId || ""} onChange={e => {
                          const item = safeWarehouseItems.find(w => String(w.id) === String(e.target.value));
                          updateEditRecipeRow(index, "warehouseItemId", e.target.value);
                          if (item) updateEditRecipeRow(index, "quantityUnit", item.unit);
                        }} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none">
                          <option value="">Выбери со склада</option>
                          {safeWarehouseItems.map(item => (
                            <option key={item.id} value={item.id}>{item.name} — {item.quantity} {item.unit}</option>
                          ))}
                        </select>
                      )}
                      <input type="number" value={row.quantity} onChange={e => updateEditRecipeRow(index, "quantity", e.target.value)}
                        placeholder={selected?.unit || "Кол-во"}
                        className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none"/>
                    </div>
                    {isManual && row.ingredientName && !row.warehouseItemId && (
                      <p className="text-xs font-bold text-yellow-500">⚠ Добавь на склад — привяжется автоматически</p>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => addEditRecipeRow("warehouse")}
                className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-black text-slate-200 hover:bg-white/10">
                + Со склада
              </button>
              <button type="button" onClick={() => addEditRecipeRow("manual")}
                className="flex-1 rounded-2xl border border-violet-400/20 bg-violet-500/8 px-4 py-2.5 text-sm font-black text-violet-200 hover:bg-violet-500/15">
                ✨ Вручную (AI)
              </button>
            </div>
          </div>

          <div className="mt-6 flex gap-3">
            <button type="button" onClick={() => setEditModal(false)}
              className="btn-white flex-1">Отмена</button>
            <button type="button" onClick={saveEditProduct}
              className="btn-blue flex-1">Сохранить</button>
          </div>
        </Modal>
      )}
      </div>
    </div>
  );
}
