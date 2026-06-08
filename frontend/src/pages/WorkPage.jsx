import { useEffect, useMemo, useRef, useState } from "react";
import { del, get, post } from "../api";
import Modal from "../components/Modal";
import { formatMoney, money, num } from "../utils/format";

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
  const [importModal, setImportModal] = useState(false);

  const [newTypeName, setNewTypeName] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [productForm, setProductForm] = useState({
    name: "",
    cost: "",
    price: "",
  });
  const [recipe, setRecipe] = useState([]);
  const [error, setError] = useState("");

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

  const selectedType = types.find(
    (t) => String(t.id) === String(selectedTypeId)
  );

  const typeFolders = folders.filter(
    (f) => String(f.typeId || "") === String(selectedTypeId)
  );

  const selectedFolder = folders.find(
    (f) => String(f.id) === String(selectedFolderId)
  );

  useEffect(() => {
    if (!selectedTypeId) {
      setSelectedFolderId("");
      return;
    }

    const list = folders.filter(
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

    sales.forEach((sale) => {
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

    return products.filter((p) => {
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
    return recipe.reduce((sum, row) => {
      const warehouseItem = warehouseItems.find(
        (item) => String(item.id) === String(row.warehouseItemId)
      );

      if (!warehouseItem) return sum;

      return sum + num(row.quantity) * getWarehouseUnitCost(warehouseItem);
    }, 0);
  }, [recipe, warehouseItems]);

  useEffect(() => {
    if (recipe.length) {
      setProductForm((p) => ({
        ...p,
        cost: recipeCost ? String(recipeCost.toFixed(2)) : "",
      }));
    }
  }, [recipeCost, recipe.length]);

  const openProductModal = () => {
    setError("");
    setProductForm({ name: "", cost: "", price: "" });
    setRecipe([]);
    setProductModal(true);
  };

  const addRecipeRow = () => {
    setRecipe((rows) => [
      ...rows,
      {
        warehouseItemId: "",
        quantity: "",
      },
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
      .filter((row) => row.warehouseItemId && num(row.quantity) > 0)
      .map((row) => ({
        warehouseItemId: Number(row.warehouseItemId),
        warehouse_item_id: Number(row.warehouseItemId),
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

    const existing = types.find(
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
    <div className="relative -m-4 min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_right,rgba(124,58,237,0.25),transparent_35%),linear-gradient(135deg,#020617,#0f172a_45%,#111827)] p-4 pb-nav text-slate-100 sm:-m-6 sm:p-6 sm:pb-10">
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
                    <button
                      onClick={() => deleteProduct(p.id)}
                      className="rounded-xl bg-red-500/10 px-3 py-2 font-black text-red-400"
                    >
                      ×
                    </button>
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

                <button
                  onClick={() => deleteProduct(p.id)}
                  className="rounded-xl bg-red-500/10 px-3 py-2 font-black text-red-400"
                >
                  ×
                </button>
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
                {types.map((t) => (
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
                {types.map((t) => (
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

                {!types.length && (
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
            {types.map((t) => (
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
              {types.map((t) => (
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

            <input
              value={productForm.name}
              onChange={(e) =>
                setProductForm((p) => ({ ...p, name: e.target.value }))
              }
              placeholder="Эспрессо, Капучино, Боул с курицей..."
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 shadow-inner shadow-black/10 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10 sm:col-span-2"
            />

            <input
              type="number"
              value={productForm.cost}
              onChange={(e) =>
                setProductForm((p) => ({ ...p, cost: e.target.value }))
              }
              placeholder="Себестоимость"
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 shadow-inner shadow-black/10 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10"
              readOnly={recipe.length > 0}
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
              {recipe.map((row, index) => {
                const selected = warehouseItems.find(
                  (item) => String(item.id) === String(row.warehouseItemId)
                );

                return (
                  <div
                    key={index}
                    className="grid gap-2 sm:grid-cols-[1fr_170px_44px]"
                  >
                    <select
                      value={row.warehouseItemId}
                      onChange={(e) =>
                        updateRecipeRow(
                          index,
                          "warehouseItemId",
                          e.target.value
                        )
                      }
                      className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 shadow-inner shadow-black/10 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10"
                    >
                      <option value="">Выбери сырьё со склада</option>
                      {warehouseItems.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} — остаток {item.quantity} {item.unit}
                        </option>
                      ))}
                    </select>

                    <input
                      type="number"
                      value={row.quantity}
                      onChange={(e) =>
                        updateRecipeRow(index, "quantity", e.target.value)
                      }
                      placeholder={selected ? `Кол-во, ${selected.unit}` : "Кол-во"}
                      className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 shadow-inner shadow-black/10 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10"
                    />

                    <button
                      type="button"
                      onClick={() => removeRecipeRow(index)}
                      className="rounded-2xl bg-red-500/10 font-black text-red-400"
                    >
                      ×
                    </button>
                  </div>
                );
              })}

              {!recipe.length && (
                <p className="rounded-2xl bg-[#0f172a]/90 px-4 py-3 text-sm text-slate-400">
                  Состав пока не добавлен. Без состава товар будет продаваться
                  без списания со склада.
                </p>
              )}

              {!warehouseItems.length && (
                <p className="rounded-2xl bg-amber-500/10 px-4 py-3 text-sm font-bold text-amber-300">
                  На складе пока нет сырья. Сначала добавь зерно, молоко,
                  курицу, рис и т.д. на странице “Склад”.
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={addRecipeRow}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-black text-slate-100 shadow-lg shadow-black/10 backdrop-blur transition hover:bg-white/10 mt-3"
            >
              + Добавить ингредиент
            </button>
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
      </div>
    </div>
  );
}
