import "./WorkPage.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronRight, LayoutGrid, List, Plus, RotateCcw, Boxes, Check, Copy, EyeOff, FileUp, Lightbulb, MoreHorizontal, Package, PackageX, Pencil, Search, Settings, SlidersHorizontal, Sparkles, Trash2, TrendingDown, TrendingUp, Wallet, X, Zap } from "lucide-react";
import { del, get, post, put, getSession } from "../api";
import Modal from "../components/Modal";
import MenuTransferModal from "../components/MenuTransferModal";
import MenuPdfImportModal from "../components/MenuPdfImportModal";
import EmptyState from "../components/EmptyState";
import { TrendSparkline } from "../components/Metrics";
import { formatMoney, money, num, businessISO, prettyName } from "../utils/format";
import { getWarehouseUnitCost } from "../utils/menu";
import { csvCell, csvNum, downloadCsv } from "../utils/csv";
import { useIngredientSuggest } from "../hooks/useIngredientSuggest";


// ─── Поиск ингредиента по складу ─────────────────────────────────────────────
// Выпадающий список рендерится в портал с fixed-позиционированием, чтобы его
// не обрезал overflow-y-auto тела модалки и он не пропадал. Закрытие — по клику
// вне поля (а не по onBlur, который закрывал список слишком резко).
function SmartIngredientInput({ value, onChange, warehouseItems = [], onSelectItem }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  // AI-подсказки: общий хук (защита от гонок + кэш).
  const { suggestions: aiSuggestions, loading: aiLoading } = useIngredientSuggest(value, warehouseItems);

  const q = (value || "").trim().toLowerCase();
  const localMatches = q.length >= 1
    ? warehouseItems.filter((i) => (i.name || "").toLowerCase().includes(q)).slice(0, 6)
    : [];

  // Объединяем: склад (точное совпадение) + AI-подсказки, без дублей по имени и id
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
    const vv = window.visualViewport;
    const vh = vv ? vv.height : window.innerHeight;
    const offsetTop = vv ? vv.offsetTop : 0;
    const spaceBelow = (offsetTop + vh) - r.bottom - 8;
    const spaceAbove = r.top - offsetTop - 8;
    const dropUp = spaceBelow < 220 && spaceAbove > spaceBelow;
    const maxH = Math.max(140, Math.min(320, dropUp ? spaceAbove : spaceBelow));
    setRect({
      left: r.left,
      width: r.width,
      dropUp,
      maxHeight: maxH,
      top: dropUp ? undefined : r.bottom + 6,
      bottom: dropUp ? (offsetTop + vh - r.top + 6) : undefined,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updateRect();
    // Коалесим reposition через один кадр rAF — иначе getBoundingClientRect+setState
    // дёргаются на КАЖДЫЙ пиксель скролла (джанк). Слушатели passive.
    let raf = 0;
    const reposition = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; updateRect(); });
    };
    const onDown = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      if (e.target.closest?.("[data-ingredient-dropdown]")) return;
      setOpen(false);
    };
    window.addEventListener("scroll", reposition, { capture: true, passive: true });
    window.addEventListener("resize", reposition, { passive: true });
    document.addEventListener("mousedown", onDown);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", reposition, { passive: true });
      window.visualViewport.addEventListener("scroll", reposition, { passive: true });
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("mousedown", onDown);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", reposition);
        window.visualViewport.removeEventListener("scroll", reposition);
      }
    };
  }, [open, updateRect]);

  const pick = (s) => {
    onChange(s.name);             // всегда подставляем правильное название
    if (s.warehouseId) onSelectItem(s.warehouseId); // и привязываем к складу, если есть
    setOpen(false);
  };

  return (
    <div className="relative" ref={wrapRef}>
      <input
        ref={inputRef}
        type="text" value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Введите название — AI исправит и привяжет к складу..."
        className="w-full rounded-2xl border border-violet-400/30 bg-violet-500/8 py-2.5 px-4 text-sm font-bold text-white outline-none placeholder:text-slate-500 focus:border-violet-400/60 focus:ring-2 focus:ring-violet-500/20"
      />
      {aiLoading && <span className="absolute right-3 top-3"><span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-violet-400/30 border-t-violet-400" /></span>}
      {open && merged.length > 0 && rect && createPortal(
        <div
          data-ingredient-dropdown
          style={{ position: "fixed", left: rect.left, width: rect.width, zIndex: 80, maxHeight: rect.maxHeight, overflowY: "auto", ...(rect.dropUp ? { bottom: rect.bottom } : { top: rect.top }) }}
          className="overflow-hidden rounded-2xl border border-white/[0.08] bg-slate-900 shadow-lg shadow-black/50"
        >
          {merged.map((s) => (
            <button key={s.key} type="button"
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/8">
              <span className={`shrink-0 rounded-lg px-2 py-0.5 text-[10px] font-semibold ${s.source === "warehouse" ? "bg-emerald-500/20 text-emerald-300" : "bg-violet-500/20 text-violet-300"}`}>
                {s.source === "warehouse" ? "склад" : "AI"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{s.name}</p>
                <p className="truncate text-xs text-slate-400">{s.sub}</p>
              </div>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

const UNIT_OPTIONS = [
  { value: "g", label: "г" },
  { value: "ml", label: "мл" },
  { value: "pcs", label: "шт" },
  { value: "kg", label: "кг" },
  { value: "l", label: "л" },
];

// Приводим количество ингредиента в рецепте к единице хранения склада — ТОЧНО как бэкенд
// (convertRecipeToStorage): конвертация кг/л → г/мл, штучная упаковка (packagingQuantity)
// и запас на потери (lossPercent). Раньше предпросмотр себестоимости на кассе/в товарах
// не учитывал потери и упаковку и занижал реальную себестоимость.
const toStorageQty = (qty, inputUnit, storageUnit, packagingQuantity = 0, lossPercent = 0) => {
  const pack = Number(packagingQuantity) || 0;
  const loss = Number(lossPercent) || 0;
  const piece = ["pcs", "bottle", "pack", "box"];

  let from = inputUnit || storageUnit;
  let converted = qty;

  // нормализация кг→г, л→мл (единица хранения на складе — базовая: г/мл/шт)
  if (from === "kg") { converted = qty * 1000; from = "g"; }
  else if (from === "l") { converted = qty * 1000; from = "ml"; }
  else if (from === "g" && storageUnit === "kg") { converted = qty / 1000; from = "kg"; }
  else if (from === "ml" && storageUnit === "l") { converted = qty / 1000; from = "l"; }

  const perOne = pack > 1 ? pack : 1; // если упаковка не задана — бэкенд угадывает; тут оставляем 1
  if (from === storageUnit) {
    // единицы совпадают
  } else if (piece.includes(from) && (storageUnit === "g" || storageUnit === "ml")) {
    converted = converted * perOne;
  } else if (piece.includes(storageUnit) && (from === "g" || from === "ml")) {
    converted = perOne > 0 ? converted / perOne : converted;
  }

  if (loss > 0) converted = converted * (1 + loss / 100); // запас на потери
  return converted;
};

// Штучная конвертация (шт↔г/мл) без заданной упаковки: фронт точно посчитать не может —
// бэкенд угадывает грамм/мл по имени (guessOnePieceToBase). В таких строках не показываем
// числовое превью себестоимости и не подставляем заниженное авто-значение в поле cost.
const needsBackendGuess = (inputUnit, storageUnit, packagingQuantity = 0) => {
  const piece = ["pcs", "bottle", "pack", "box"];
  const pack = Number(packagingQuantity) || 0;
  let from = inputUnit || storageUnit;
  if (from === "kg") from = "g";
  else if (from === "l") from = "ml";
  const su = storageUnit === "kg" ? "g" : storageUnit === "l" ? "ml" : storageUnit;
  const cross = (piece.includes(from) && (su === "g" || su === "ml")) || (piece.includes(su) && (from === "g" || from === "ml"));
  return cross && pack <= 1;
};
// ─────────────────────────────────────────────────────────────────────────────

// ── P&L-пороги и тон прибыльности ─────────────────────────────────────
const MARGIN_GOOD = 55;
const MARGIN_LOW = 30;

const marginToneCls = (m) =>
  m < 0 ? "text-rose-300" : m >= MARGIN_GOOD ? "text-emerald-300" : m >= MARGIN_LOW ? "text-amber-300" : "text-orange-300";

const initialsOf = (name) => {
  const w = String(name || "?").trim().split(/\s+/).filter(Boolean);
  const s = w.length >= 2 ? w[0][0] + w[1][0] : String(name || "?").slice(0, 2);
  return s.toUpperCase();
};

function CategoryAvatar({ name }) {
  return <span className="catalog-avatar" aria-hidden="true">{initialsOf(name)}</span>;
}

// Current cost can be incomplete even when historical sales have recorded costs.
function ProductCard({ p, onEdit, onDuplicate, onDelete }) {
  const uncertainCost = p.incompleteCost || (p.noRecipe && money(p.cost) <= 0);
  const status = p.hidden ? "hidden"
    : uncertainCost ? "warning"
    : p.lossmaking ? "loss"
    : "ready";
  const statusLabel = p.hidden ? "Скрыт в кассе"
    : p.incompleteCost ? "Уточнить состав"
    : uncertainCost ? "Нет себестоимости"
    : p.lossmaking ? "Без прибыли"
    : "Готов к продаже";

  return (
    <article className={`catalog-product catalog-product-${status} bg-white/[0.02] shadow-sm backdrop-blur-xl`}>
      <div className="catalog-product-heading">
        <CategoryAvatar name={p.name} />
        <div className="catalog-product-title">
          <button type="button" onClick={() => onEdit(p)}>{p.name}</button>
          <p>
            {prettyName(p.typeName || p.type)}
            <span> / </span>
            {prettyName(p.category) || "Без категории"}
          </p>
        </div>
        {p.hidden && <EyeOff size={16} aria-label="Скрыт в кассе" />}
      </div>
      <div className={`catalog-product-status catalog-status-${status}`}>
        {uncertainCost ? <AlertTriangle size={13} />
          : p.hidden ? <EyeOff size={13} />
          : p.lossmaking ? <TrendingDown size={13} />
          : <Check size={13} />}
        {statusLabel}
        {p.isExtra && <span className="catalog-extra">Дополнение</span>}
      </div>
      <div className="catalog-product-pricing">
        <div>
          <span>Цена продажи</span>
          <strong>{formatMoney(p.price)}</strong>
        </div>
        <div>
          <span>Себестоимость</span>
          <strong className={uncertainCost ? "catalog-warning-text" : ""}>
            {p.noRecipe && money(p.cost) <= 0 ? "Не задана" : `${formatMoney(p.cost)}${p.incompleteCost ? " +" : ""}`}
          </strong>
        </div>
      </div>
      <div className="catalog-product-results">
        <div>
          <span>Продано / мес.</span>
          <strong>{num(p.quantity).toLocaleString("ru-RU")} <small>шт.</small></strong>
        </div>
        <div>
          <span>Прибыль / мес.</span>
          <strong className={p.cleanProfit < 0 ? "catalog-loss-text" : ""}>
            {p.notSelling ? "—" : formatMoney(p.cleanProfit)}
          </strong>
        </div>
        <div>
          <span>{p.marginIsPotential ? "Расч. маржа" : "Маржа"}</span>
          <strong className={!uncertainCost ? marginToneCls(p.marginPct) : "catalog-muted"}>
            {uncertainCost ? "—" : `${Math.round(num(p.marginPct))}%`}
          </strong>
        </div>
      </div>
      <div className="catalog-product-footer">
        <span>{p.noRecipe ? "Состав не задан" : `${p.recipe.length} ингр. в составе`}</span>
        <div className="catalog-product-actions">
          <button type="button" onClick={() => onDuplicate(p)} aria-label={`Дублировать ${p.name}`} title="Дублировать">
            <Copy size={15} />
          </button>
          <button type="button" onClick={() => onDelete(p.id)} aria-label={`Удалить ${p.name}`} title="Удалить" className="catalog-delete">
            <Trash2 size={15} />
          </button>
          <button type="button" onClick={() => onEdit(p)} aria-label={`Изменить ${p.name}`} className="catalog-edit">
            <Pencil size={14} /><span>Изменить</span>
          </button>
        </div>
      </div>
    </article>
  );
}

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
  // Переименование типа/папки: { kind: "type"|"folder", id, name }.
  const [renaming, setRenaming] = useState(null);
  const [renameBusy, setRenameBusy] = useState(false);
  const [productModal, setProductModal] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [aiSuggestionLoading, setAiSuggestionLoading] = useState(false);
  const [aiAdvisorEnabled, setAiAdvisorEnabled] = useState(true);
  const aiDebounceRef = useRef(null);
  const [importModal, setImportModal] = useState(false);
  const [pdfImportModal, setPdfImportModal] = useState(false);
  const [transferModal, setTransferModal] = useState(false);
  const isOwner = (getSession()?.role || "") === "owner";
  const [editModal, setEditModal] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [editRecipe, setEditRecipe] = useState([]);
  const [editCostMode, setEditCostMode] = useState("auto"); // auto | manual

  // Сортировка и быстрые фильтры-проблемы (P&L-редизайн списка).
  const [sortKey, setSortKey] = useState("profit"); // profit | margin | qty | revenue | name
  const [sortDir, setSortDir] = useState("desc");    // desc | asc
  const [problemFilter, setProblemFilter] = useState("all"); // all|top|noRecipe|incomplete|notSelling|loss|hidden
  const [catalogView, setCatalogView] = useState("cards");
  const [initialLoading, setInitialLoading] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);   // меню «Ещё» (вторичные действия)

  const [newTypeName, setNewTypeName] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  // Быстрое создание тип/папки прямо в форме товара (не выходя из неё)
  const [showNewType, setShowNewType] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [productForm, setProductForm] = useState({
    name: "",
    cost: "",
    price: "",
    isExtra: false,
    hidden: false,
  });
  const [recipe, setRecipe] = useState([]);
  const [error, setError] = useState("");

  // Safe array guards
  const safe_recipe = Array.isArray(recipe) ? recipe : [];

  const fileInputRef = useRef(null);

  const loadingRef = useRef(false); // идёт ли загрузка (чтобы не наслаивать тики)
  const loadSeqRef = useRef(0);     // защита от гонки: устаревший ответ не затирает свежий
  const modalOpenRef = useRef(false); // открыта ли модалка — тогда поллинг паузим (замыкание видит актуальное через ref)
  const sigRef = useRef({}); // подписи слайсов: setState только если данные реально изменились

  // Ставим состояние ТОЛЬКО когда данные реально поменялись. Иначе ссылка массива
  // остаётся прежней → React бейлит рендер, а цепочка useMemo (salesStatsByProduct →
  // productRows) не пересчитывается. Это убирает периодический фриз тика.
  const setIfChanged = (key, next, setter) => {
    const arr = Array.isArray(next) ? next : [];
    let sig;
    if (key === "sales") {
      const last = arr[0]; // /sales отсортирован по id DESC — хватает первого + длины
      sig = arr.length + "|" + (last ? `${last.id}:${last.total}` : "");
    } else {
      sig = arr.length + "|" + arr.map((x) => `${x.id}:${x.price ?? ""}:${x.cost ?? ""}:${x.hidden ? 1 : 0}:${x.name ?? ""}`).join(",");
    }
    if (sigRef.current[key] !== sig) {
      sigRef.current[key] = sig;
      setter(arr);
    }
  };

  const load = async () => {
    const seq = ++loadSeqRef.current;
    loadingRef.current = true;
    try {
      const [typeList, folderList, productList, salesList, warehouseList] =
        await Promise.all([
          get("/product-types"),
          get("/product-categories"),
          get("/menu-products"),
          get("/sales").catch(() => []),
          get("/warehouse/items").catch(() => []),
        ]);

      if (seq !== loadSeqRef.current) return; // пришёл более свежий запрос

      setIfChanged("types", typeList, setTypes);
      setIfChanged("folders", folderList, setFolders);
      setIfChanged("products", productList, setProducts);
      setIfChanged("sales", salesList, setSales);
      setIfChanged("warehouse", warehouseList, setWarehouseItems);
      setError("");
    } finally {
      loadingRef.current = false;
      setInitialLoading(false);
    }
  };

  // Лёгкий тик поллинга: обновляем ТОЛЬКО продажи (единственное, что часто меняется).
  const loadSales = async () => {
    if (loadingRef.current) return;
    const seq = ++loadSeqRef.current;
    loadingRef.current = true;
    try {
      const salesList = await get("/sales").catch(() => null);
      if (salesList == null || seq !== loadSeqRef.current) return;
      setIfChanged("sales", salesList, setSales);
    } finally {
      loadingRef.current = false;
    }
  };

  useEffect(() => {
    load().catch((e) => setError(e.message));

    // Каждые 20с обновляем ТОЛЬКО продажи — меню/склад/категории меняются редко и
    // уже перезагружаются после правок (createType/save/delete → load()). Это вместо
    // прежнего 5-секундного перезапроса всех 5 эндпоинтов, который подвешивал планшет.
    const timer = setInterval(() => {
      if (document.hidden || modalOpenRef.current) return;
      loadSales().catch(() => {});
    }, 20000);

    // Возврат на вкладку — разово подтягиваем всё (вдруг меняли с другого устройства).
    const onVisible = () => {
      if (!document.hidden && !modalOpenRef.current) load().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Держим modalOpenRef в актуальном состоянии — замыкание интервала читает его через ref.
  useEffect(() => {
    modalOpenRef.current = productModal || editModal;
  }, [productModal, editModal]);

  const safeTypes = Array.isArray(types) ? types : [];
  const safeFolders = Array.isArray(folders) ? folders : [];
  const safeWarehouseItems = Array.isArray(warehouseItems) ? warehouseItems : [];

  const selectedType = safeTypes.find(
    (t) => String(t.id) === String(selectedTypeId)
  );

  const typeFolders = safeFolders.filter(
    (f) => String(f.typeId || "") === String(selectedTypeId)
  );

  // Папки выбранного в модалке «Редактировать» типа (отдельно от фильтра страницы)
  const editTypeFolders = editProduct
    ? safeFolders.filter((f) => String(f.typeId || "") === String(editProduct.typeId || ""))
    : [];
  // Если товар уже лежал в папке (и это не доп. товар) — папку нельзя «обнулить»:
  // при смене типа нужно выбрать папку нового типа.
  const editFolderRequired =
    !!editProduct &&
    !editProduct.isExtra &&
    Number((Array.isArray(products) ? products : []).find((x) => String(x.id) === String(editProduct.id))?.categoryId) > 0;

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTypeId, folders, selectedFolderId]);

  // Продажи считаем за ТЕКУЩИЙ рабочий месяц (карточки называются «/ мес») —
  // так «Выручка/Продано» на этой странице совпадают с «Аналитикой», а не берут
  // всю историю. Рабочий месяц (businessISO) — как во всех «сегодня/за месяц».
  const currentSalesMonth = businessISO().slice(0, 7);
  const monthSales = useMemo(
    () => (Array.isArray(sales) ? sales : []).filter((s) => {
      const created = s.createdAt || s.created_at;
      return created && businessISO(new Date(created)).slice(0, 7) === currentSalesMonth;
    }),
    [sales, currentSalesMonth]
  );

  // Считаем продажи по СТАБИЛЬНОМУ id товара и по ЗАПИСАННЫМ в чеке суммам
  // (price/cost/total на момент продажи), а не по текущей цене — иначе смена
  // цены задним числом переписывала выручку, а одинаковые имена склеивались.
  // Имя оставляем как запасной ключ для старых записей без id.
  const salesStatsByProduct = useMemo(() => {
    const byId = {};
    const byName = {};

    const addItem = (item) => {
      const id = Number(item.productId || item.product_id || 0);
      const name = item.productName || item.name || item.product_name || item.title || "";
      const qty = Number(item.qty || item.quantity || item.count || 1) || 0;
      if (qty <= 0) return;
      const revenue = money(item.total != null ? item.total : money(item.price) * qty);
      const cost = money(item.cost) * qty;

      let bucket;
      if (id > 0) {
        bucket = byId[id] || (byId[id] = { quantity: 0, revenue: 0, cost: 0 });
      } else if (name) {
        const key = String(name).trim().toLowerCase();
        bucket = byName[key] || (byName[key] = { quantity: 0, revenue: 0, cost: 0 });
      } else {
        return;
      }
      bucket.quantity += qty;
      bucket.revenue += revenue;
      bucket.cost += cost;
    };

    monthSales.forEach((sale) => {
      if (Array.isArray(sale.items)) {
        sale.items.forEach(addItem);
      } else if (sale.productName || sale.name || sale.product_name) {
        addItem(sale);
      }
    });

    return { byId, byName };
  }, [monthSales]);

  // Итоги для верхних карточек — ВСЕ продажи за месяц (а не только по товарам из
  // текущего меню), чтобы «Выручка/Продано/Прибыль» отражали реальную кассу и
  // совпадали с «Аналитикой». Продажи снятых из меню/доп. позиций тоже учтены.
  const monthTotals = useMemo(() => {
    let quantity = 0, revenue = 0, cost = 0;
    const addOne = (item) => {
      const qty = Number(item.qty || item.quantity || item.count || 1) || 0;
      if (qty <= 0) return;
      quantity += qty;
      revenue += money(item.total != null ? item.total : money(item.price) * qty);
      cost += money(item.cost) * qty;
    };
    monthSales.forEach((sale) => {
      if (Array.isArray(sale.items) && sale.items.length) sale.items.forEach(addOne);
      else if (sale.productName || sale.name || sale.product_name) addOne(sale);
    });
    return { quantity, revenue, cost, cleanProfit: revenue - cost };
  }, [monthSales]);

  // Тренд чистой прибыли по дням периода — для мини-графика в герое.
  const dailyProfit = useMemo(() => {
    const byDay = new Map();
    monthSales.forEach((sale) => {
      const created = sale.createdAt || sale.created_at;
      if (!created) return;
      const day = businessISO(new Date(created)).slice(0, 10);
      let rev = 0, cost = 0;
      const addOne = (item) => {
        const qty = Number(item.qty || item.quantity || item.count || 1) || 0;
        if (qty <= 0) return;
        rev += money(item.total != null ? item.total : money(item.price) * qty);
        cost += money(item.cost) * qty;
      };
      if (Array.isArray(sale.items) && sale.items.length) sale.items.forEach(addOne);
      else if (sale.productName || sale.name || sale.product_name) addOne(sale);
      const prev = byDay.get(day) || { rev: 0, cost: 0 };
      byDay.set(day, { rev: prev.rev + rev, cost: prev.cost + cost });
    });
    return [...byDay.keys()].sort().map((d) => {
      const { rev, cost } = byDay.get(d);
      return { day: d, profit: rev - cost };
    });
  }, [monthSales]);

  const heroLoss = monthTotals.cleanProfit < 0;
  const heroTrendColor = heroLoss ? "var(--color-rose-400)" : "var(--color-emerald-400)";
  const monthMargin = monthTotals.revenue > 0 ? (monthTotals.cleanProfit / monthTotals.revenue) * 100 : null;

  const visibleProducts = useMemo(() => {
    const q = search.trim().toLowerCase();

    return (Array.isArray(products) ? products : []).filter((p) => {
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
      const stat =
        salesStatsByProduct.byId[p.id] ||
        salesStatsByProduct.byName[String(p.name || "").trim().toLowerCase()] ||
        null;

      const quantity = stat?.quantity || 0;
      // Выручка/себестоимость — из записанных сумм чека; если их нет (старые
      // данные) — падаем на текущую цену × количество, как было раньше.
      const revenue = stat && stat.revenue ? stat.revenue : money(p.price) * quantity;
      const totalCost = stat && stat.cost ? stat.cost : money(p.cost) * quantity;
      const cleanProfit = revenue - totalCost;

      return {
        ...p,
        quantity,
        totalCost,
        revenue,
        cleanProfit,
      };
    });
  }, [visibleProducts, salesStatsByProduct]);

  // Маржа и состояние состава для каталога.
  const enriched = useMemo(() => {
    return productRows.map((p) => {
      const price = money(p.price);
      const cost = money(p.cost);
      const hasRecipe = Array.isArray(p.recipe) && p.recipe.length > 0;
      const incompleteCost = hasRecipe && p.recipe.some((r) => r.unlinked);
      const noRecipe = !hasRecipe;
      const notSelling = num(p.quantity) === 0;
      const lossmaking = (price > 0 && price <= cost) || num(p.cleanProfit) < 0;
      const marginPct = num(p.revenue) > 0
        ? (p.cleanProfit / p.revenue) * 100
        : (price > 0 ? ((price - cost) / price) * 100 : 0);
      const marginIsPotential = num(p.revenue) <= 0;
      return { ...p, hasRecipe, incompleteCost, noRecipe, notSelling, lossmaking, marginPct, marginIsPotential };
    });
  }, [productRows]);

  const menuHealth = useMemo(() => {
    const counts = { noRecipe: 0, incompleteCost: 0, notSelling: 0, lossmaking: 0, hidden: 0 };
    enriched.forEach((product) => {
      if (product.noRecipe) counts.noRecipe++;
      if (product.incompleteCost) counts.incompleteCost++;
      if (product.notSelling) counts.notSelling++;
      if (product.lossmaking) counts.lossmaking++;
      if (product.hidden) counts.hidden++;
    });
    return { counts };
  }, [enriched]);

  const displayRows = useMemo(() => {
    let rows = enriched;
    if (problemFilter === "top") rows = rows.filter((p) => num(p.cleanProfit) > 0);
    else if (problemFilter === "noRecipe") rows = rows.filter((p) => p.noRecipe);
    else if (problemFilter === "incomplete") rows = rows.filter((p) => p.incompleteCost);
    else if (problemFilter === "notSelling") rows = rows.filter((p) => p.notSelling);
    else if (problemFilter === "loss") rows = rows.filter((p) => p.lossmaking);
    else if (problemFilter === "hidden") rows = rows.filter((p) => p.hidden);
    const key = problemFilter === "top" ? "profit" : sortKey;
    const dir = sortDir === "asc" ? 1 : -1;
    const metric = (p) =>
      key === "margin" ? p.marginPct :
      key === "qty" ? num(p.quantity) :
      key === "revenue" ? num(p.revenue) :
      num(p.cleanProfit);
    return [...rows].sort((a, b) =>
      key === "name"
        ? dir * String(a.name || "").localeCompare(String(b.name || ""), "ru")
        : dir * (metric(a) - metric(b))
    );
  }, [enriched, problemFilter, sortKey, sortDir]);

  const displayTotals = useMemo(() =>
    displayRows.reduce((acc, p) => {
      acc.quantity += num(p.quantity);
      acc.cost += num(p.totalCost);
      acc.revenue += num(p.revenue);
      acc.cleanProfit += num(p.cleanProfit);
      return acc;
    }, { quantity: 0, cost: 0, revenue: 0, cleanProfit: 0 }),
  [displayRows]);

  const createType = async () => {
    setError("");

    if (!newTypeName.trim()) {
      return setError("Введите раздел: например Бар или Кухня");
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

  // Переименовать раздел или папку (inline в «Разделы и категории»).
  const startRename = (kind, item) => setRenaming({ kind, id: item.id, name: item.name });
  const saveRename = async () => {
    if (!renaming) return;
    const name = String(renaming.name || "").trim();
    if (!name) { window.notify?.("Введите название", "error"); return; }
    setRenameBusy(true);
    try {
      const url = renaming.kind === "type" ? `/product-types/${renaming.id}` : `/product-categories/${renaming.id}`;
      await put(url, { name });
      setRenaming(null);
      await load();
      window.notify?.(renaming.kind === "type" ? "Раздел переименован" : "Категория переименована", "success");
    } catch (e) {
      window.notify?.(e?.message || "Не удалось переименовать", "error");
    } finally {
      setRenameBusy(false);
    }
  };

  const createFolder = async () => {
    setError("");

    if (!selectedTypeId) return setError("Сначала создайте и выберите раздел");
    if (!newFolderName.trim()) return setError("Введите название категории");

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
      // Штучную конвертацию без упаковки фронт точно не посчитает — не занижаем авто-cost,
      // бэкенд досчитает после сохранения (превью строки покажет пометку).
      if (needsBackendGuess(row.quantityUnit || warehouseItem.unit, warehouseItem.unit, num(warehouseItem.packagingQuantity))) return sum;
      const storageQty = toStorageQty(num(row.quantity), row.quantityUnit || warehouseItem.unit, warehouseItem.unit, num(warehouseItem.packagingQuantity), num(warehouseItem.lossPercent));
      return sum + storageQty * getWarehouseUnitCost(warehouseItem);
    }, 0);
  }, [recipe, warehouseItems]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Перезаписываем cost только когда есть реальная посчитанная себестоимость (>0).
    // Иначе состав, целиком набранный вручную (AI, ещё не на складе), даёт recipeCost=0 —
    // и обнулять/блокировать ручной ввод нельзя.
    if (recipeCost > 0) {
      setProductForm((p) => ({
        ...p,
        cost: String(recipeCost.toFixed(2)),
      }));
    }
  }, [recipeCost]);

  const analyzeProductNameWork = useCallback(async (name) => {
    if (!name || name.trim().length < 3) { setAiSuggestion(null); return; }
    if (!aiAdvisorEnabled) return;
    setAiSuggestionLoading(true);
    try {
      const data = await post("/ai/menu/suggest", {
        name,
        warehouseItems: (Array.isArray(warehouseItems) ? warehouseItems : []).map(w => ({ id: w.id, name: w.name, unit: w.unit }))
      });
      if (data && data.displayName) setAiSuggestion(data);
    } catch { setAiSuggestion(null); }
    finally { setAiSuggestionLoading(false); }
  }, [warehouseItems, aiAdvisorEnabled]);

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
        String(w.name || "").toLowerCase().includes(String(ing.name || "").toLowerCase()) ||
        String(ing.name || "").toLowerCase().includes(String(w.name || "").toLowerCase())
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
    setProductForm({ name: "", cost: "", price: "", isExtra: false, hidden: false });
    setRecipe([]);
    setShowNewType(false);
    setShowNewFolder(false);
    setQuickName("");
    setProductModal(true);
  };

  // Создать тип прямо в форме товара — без выхода в «Разделы и категории»
  const quickCreateType = async () => {
    const name = quickName.trim();
    if (!name) return;
    try {
      const created = await post("/product-types", { name });
      await load();
      setSelectedTypeId(String(created.id));
      setSelectedFolderId("");
      setShowNewType(false);
      setQuickName("");
      setError("");
    } catch (e) { setError(e?.message || "Не удалось создать раздел"); }
  };

  // Создать папку прямо в форме товара
  const quickCreateFolder = async () => {
    if (!selectedTypeId) { setError("Сначала выберите раздел"); return; }
    const name = quickName.trim();
    if (!name) return;
    try {
      const created = await post("/product-categories", { name, typeId: Number(selectedTypeId) });
      await load();
      setSelectedFolderId(String(created.id));
      setShowNewFolder(false);
      setQuickName("");
      setError("");
    } catch (e) { setError(e?.message || "Не удалось создать категорию"); }
  };

  // Дублировать товар: открыть форму создания, заполненную данными существующего
  const duplicateProduct = (p) => {
    setAiSuggestion(null);
    setError("");
    setShowNewType(false);
    setShowNewFolder(false);
    setQuickName("");
    if (p.typeId) setSelectedTypeId(String(p.typeId));
    if (p.categoryId) setSelectedFolderId(String(p.categoryId));
    setProductForm({
      name: p.name ? `${p.name} (копия)` : "",
      cost: String(p.cost || ""),
      price: String(p.price || ""),
      isExtra: !!p.isExtra,
      hidden: false,
    });
    const rows = (Array.isArray(p.recipe) ? p.recipe : []).map((r) => ({
      warehouseItemId: r.warehouseItemId || r.warehouse_item_id || "",
      ingredientName: r.ingredientName || r.itemName || r.item_name || "",
      quantity: String(r.quantity || ""),
      quantityUnit: r.quantityUnit || r.quantity_unit || r.unit || "g",
      mode: (r.warehouseItemId || r.warehouse_item_id) ? "warehouse" : "manual",
    }));
    setRecipe(rows);
    setProductModal(true);
  };

  const addRecipeRow = (mode = "warehouse") => {
    setRecipe((rows) => [
      ...rows,
      { warehouseItemId: "", ingredientName: "", quantity: "", quantityUnit: "g", mode },
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

  // Защита сохранения позиции меню: не даём двойной запрос (дубли) + показываем ошибку.
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const guardedSave = async (fn) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try { await fn(); }
    catch (e) { setError(e?.message || "Не удалось сохранить. Попробуйте снова."); }
    finally { savingRef.current = false; setSaving(false); }
  };

  const createProduct = async () => {
    setError("");

    if (!selectedFolderId && !productForm.isExtra) return setError("Сначала выберите папку/раздел");
    if (!productForm.name.trim()) return setError("Введите название товара");

    // Строка с выбранным ингредиентом, но без валидного количества, тихо выпадала при
    // фильтрации ниже — блокируем сохранение с адресным сообщением.
    const badRows = recipe.filter((row) => (row.warehouseItemId || row.ingredientName) && num(row.quantity) <= 0);
    if (badRows.length) {
      const nm = badRows[0].ingredientName || safeWarehouseItems.find(w => String(w.id) === String(badRows[0].warehouseItemId))?.name || "ингредиент";
      return setError(`У «${nm}» не указано количество (или ≤ 0) — заполните или удалите строку`);
    }

    const cleanRecipe = recipe
      .filter((row) => (row.warehouseItemId || row.ingredientName) && num(row.quantity) > 0)
      .map((row) => {
        const wItem = safeWarehouseItems.find(w => String(w.id) === String(row.warehouseItemId));
        const unit = row.quantityUnit || wItem?.unit || "g";
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

    await guardedSave(async () => {
      await post("/menu-products", {
        categoryId: Number(selectedFolderId) || 0,
        name: productForm.name.trim(),
        cost: recipeCost > 0 ? recipeCost : num(productForm.cost),
        price: num(productForm.price),
        isExtra: !!productForm.isExtra,
        hidden: !!productForm.hidden,
        recipe: cleanRecipe,
      });
      setProductModal(false);
      setProductForm({ name: "", cost: "", price: "", isExtra: false, hidden: false });
      setRecipe([]);
      await load();
    });
  };

  const deleteProduct = async (id) => {
    if (!confirm("Удалить товар?")) return;
    // Через guardedSave — как остальные мутации: ловим ошибку del/load в баннер и
    // блокируем повторные тапы. Иначе провал удаления был молчаливым, а 5-секундный
    // поллинг возвращал «удалённый» товар обратно.
    await guardedSave(async () => {
      await del(`/menu-products/${id}`);
      await load();
      window.notify?.("Товар удалён");
    });
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
    setError("");
    if (editFolderRequired && !Number(editProduct.categoryId)) {
      setError("Выберите категорию для товара");
      return;
    }
    // Строка с ингредиентом, но без валидного количества, тихо выпадала при фильтрации —
    // тогда сырьё не списывалось со склада, а себестоимость занижалась. Блокируем сохранение.
    const badRows = editRecipe.filter(r => (r.warehouseItemId || r.ingredientName) && num(r.quantity) <= 0);
    if (badRows.length) {
      const nm = badRows[0].ingredientName || safeWarehouseItems.find(w => String(w.id) === String(badRows[0].warehouseItemId))?.name || "ингредиент";
      setError(`У «${nm}» не указано количество (или ≤ 0) — заполните или удалите строку`);
      return;
    }
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
          if (!item) return sum;
          const storageQty = toStorageQty(num(r.quantity), r.quantityUnit || item.unit, item.unit, num(item.packagingQuantity), num(item.lossPercent));
          return sum + storageQty * getWarehouseUnitCost(item);
        }, 0)
      : null;
    await guardedSave(async () => {
      await put(`/menu-products/${editProduct.id}`, {
        ...editProduct,
        cost: autoCost !== null && autoCost > 0 ? autoCost : num(editProduct.cost),
        price: num(editProduct.price),
        categoryId: Number(editProduct.categoryId) || 0,
        costMode: editCostMode,
        recipe: cleanRecipe,
      });
      setEditModal(false);
      await load();
    });
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

  const exportExcel = () => {
    const rows = [
      ["Название", "Тип", "Папка", "Себестоимость", "Цена продажи", "Кол-во", "Выручка", "Чистая прибыль"].map(csvCell),
      ...productRows.map((p) => [
        csvCell(p.name),
        csvCell(p.typeName || p.type || ""),
        csvCell(p.category || ""),
        csvNum(p.cost),
        csvNum(p.price),
        csvNum(p.quantity),
        csvNum(p.revenue),
        csvNum(p.cleanProfit),
      ]),
    ];

    downloadCsv(`menu-products-${selectedType?.name || "all"}.csv`, rows);
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

  // Разбор колонки «Состав»: ингредиенты через «|», у каждого имя + количество и
  // единица в конце. Напр. «Тесто пшеничное 220 г | Моцарелла 120 г | Томатный соус 40 г».
  // Отдаём в рецепт по ИМЕНИ — бэкенд сам привяжет к складу при точном совпадении,
  // иначе позиция ляжет как «требует привязки» (без списания — безопасно).
  const parseComposition = (cell) => {
    const raw = String(cell || "").trim();
    if (!raw) return [];
    const unitMap = { "г": "g", "гр": "g", "g": "g", "мл": "ml", "ml": "ml", "шт": "pcs", "pcs": "pcs", "кг": "kg", "kg": "kg", "л": "l", "l": "l" };
    return raw
      .split("|")
      .map((part) => {
        const p = part.trim();
        if (!p) return null;
        const m = p.match(/([\d]+(?:[.,][\d]+)?)\s*(кг|гр|г|мл|шт|л|kg|g|ml|pcs|l)?\.?\s*$/i);
        if (!m) return null;
        const quantity = Number(m[1].replace(",", "."));
        const unit = unitMap[(m[2] || "г").toLowerCase()] || "g";
        const nm = p.slice(0, m.index).trim().replace(/[–—:-]\s*$/, "").trim();
        if (!nm || !(quantity > 0)) return null;
        return { ingredientName: nm, quantity, quantityUnit: unit };
      })
      .filter(Boolean);
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

      // Берём СВЕЖИЕ типы/папки/товары с сервера — чтобы повторный импорт (или
      // устаревший стейт) не плодил дубли папок и товаров.
      const norm = (s) => String(s || "").trim().toLowerCase();
      const [freshTypes, freshCats, freshProducts] = await Promise.all([
        get("/product-types").catch(() => []),
        get("/product-categories").catch(() => []),
        get("/menu-products").catch(() => []),
      ]);
      const localTypes = Array.isArray(freshTypes) ? [...freshTypes] : [];
      const localFolders = Array.isArray(freshCats) ? [...freshCats] : [];
      const productKey = (folderName, name) => `${norm(folderName)}|${norm(name)}`;
      const existingByKey = new Map(
        (Array.isArray(freshProducts) ? freshProducts : []).map((p) => [productKey(p.category, p.name), p])
      );

      const findType = async (nm) => {
        const clean = String(nm || "").trim();
        if (!clean) throw new Error("В Excel не заполнен тип");
        const ex = localTypes.find((t) => norm(t.name) === norm(clean));
        if (ex) return ex;
        const created = await post("/product-types", { name: clean });
        localTypes.push(created);
        return created;
      };
      const findFolder = async (nm, typeId) => {
        const clean = String(nm || "").trim();
        if (!clean) throw new Error("В Excel не заполнена папка");
        const ex = localFolders.find(
          (f) => String(f.typeId ?? f.type_id ?? "") === String(typeId) && norm(f.name) === norm(clean)
        );
        if (ex) return ex;
        const created = await post("/product-categories", { name: clean, typeId: Number(typeId) });
        localFolders.push({ ...created, typeId: created.typeId ?? created.type_id ?? Number(typeId) });
        return created;
      };

      let imported = 0;
      let filled = 0;
      let skipped = 0;
      for (const line of dataLines) {
        const [name, typeName, folderName, cost, price, composition] = parseCsvLine(line);
        if (!name?.trim()) continue;

        const fName = folderName || selectedFolder?.name || "";
        const key = productKey(fName, name);
        const recipe = parseComposition(composition);

        const existing = existingByKey.get(key);
        if (existing) {
          // Товар уже есть. Если у него НЕТ состава, а в файле состав указан —
          // дозаполняем (PUT с recipe меняет только состав, цену/имя не трогает).
          // Если состав уже есть — не перезаписываем.
          const hasRecipe = Array.isArray(existing.recipe) && existing.recipe.length > 0;
          if (recipe.length && !hasRecipe) {
            await put(`/menu-products/${existing.id}`, { recipe });
            existing.recipe = recipe; // чтобы повторный запуск не трогал
            filled += 1;
          } else {
            skipped += 1;
          }
          continue;
        }

        const type = await findType(typeName || selectedType?.name);
        const folder = await findFolder(fName, type.id);

        const created = await post("/menu-products", {
          categoryId: Number(folder.id),
          name: name.trim(),
          cost: num(cost),
          price: num(price),
          recipe,
        });
        existingByKey.set(key, { ...(created || {}), recipe });
        imported += 1;
      }

      setImportModal(false);
      if (fileInputRef.current) fileInputRef.current.value = "";

      await load();
      alert(`Импортировано новых: ${imported}${filled ? `\nДозаполнено составов: ${filled}` : ""}${skipped ? `\nПропущено (уже были): ${skipped}` : ""}`);
    } catch (e) {
      setError(e.message || "Ошибка импорта");
    }
  };

  // Убрать дубли меню (после того, как импорт запускали несколько раз):
  // оставляем по одному товару на «папка+название», удаляем лишние, затем чистим
  // пустые папки-дубли. Папки с товарами не трогаем — удаление папки НЕ удаляет
  // товары (сервер их просто открепляет), поэтому чистим только опустевшие дубли.
  const removeMenuDuplicates = async () => {
    const norm = (s) => String(s || "").trim().toLowerCase();
    try {
      const [prods, cats] = await Promise.all([
        get("/menu-products").catch(() => []),
        get("/product-categories").catch(() => []),
      ]);
      const products = Array.isArray(prods) ? prods : [];
      const catList = Array.isArray(cats) ? cats : [];

      const groups = {};
      for (const p of products) {
        (groups[`${norm(p.category)}|${norm(p.name)}`] ||= []).push(p);
      }
      const toDelete = [];
      for (const k of Object.keys(groups)) {
        const arr = groups[k];
        if (arr.length <= 1) continue;
        arr.sort((a, b) => (Number(a.categoryId) - Number(b.categoryId)) || (Number(a.id) - Number(b.id)));
        toDelete.push(...arr.slice(1)); // оставляем самый старый экземпляр
      }
      const delIds = new Set(toDelete.map((p) => p.id));
      const keptCatIds = new Set(products.filter((p) => !delIds.has(p.id)).map((p) => Number(p.categoryId)));

      const catGroups = {};
      for (const c of catList) (catGroups[`${c.typeId}|${norm(c.name)}`] ||= []).push(c);
      const foldersToDelete = [];
      for (const k of Object.keys(catGroups)) {
        const arr = catGroups[k];
        if (arr.length <= 1) continue;
        for (const c of arr) if (!keptCatIds.has(Number(c.id))) foldersToDelete.push(c);
      }

      if (!toDelete.length && !foldersToDelete.length) {
        alert("Дублей не найдено 👍");
        return;
      }
      if (!window.confirm(`Убрать дубли?\n\nТоваров-дублей: ${toDelete.length}\nПустых папок-дублей: ${foldersToDelete.length}\n\nОстанется по одному экземпляру каждого. Отменить нельзя.`)) return;

      for (const p of toDelete) { try { await del(`/menu-products/${p.id}`); } catch { /* пропускаем сбойные */ } }
      for (const c of foldersToDelete) { try { await del(`/product-categories/${c.id}`); } catch { /* пропускаем */ } }

      await load();
      alert(`Готово ✅\nУдалено дублей: товаров ${toDelete.length}, папок ${foldersToDelete.length}.`);
    } catch (e) {
      setError(e.message || "Не удалось убрать дубли");
    }
  };

  const SORT_LABELS = { profit: "По прибыли", margin: "По марже", qty: "По продажам", revenue: "По выручке", name: "По названию" };
  const categoryCounts = new Map();
  const typeCounts = new Map();
  (Array.isArray(products) ? products : []).forEach((product) => {
    const categoryId = String(product.categoryId);
    const typeId = String(product.typeId || "");
    categoryCounts.set(categoryId, (categoryCounts.get(categoryId) || 0) + 1);
    typeCounts.set(typeId, (typeCounts.get(typeId) || 0) + 1);
  });
  const hasFilters = !!(search || selectedTypeId || selectedFolderId || problemFilter !== "all");
  const resetCatalogFilters = () => {
    setSearch("");
    setSelectedTypeId("");
    setSelectedFolderId("");
    setProblemFilter("all");
  };
  const healthFilters = [
    { key: "loss", label: "Без прибыли", count: menuHealth.counts.lossmaking, icon: TrendingDown, tone: "loss" },
    { key: "incomplete", label: "Уточнить состав", count: menuHealth.counts.incompleteCost, icon: AlertTriangle, tone: "warning" },
    { key: "noRecipe", label: "Без состава", count: menuHealth.counts.noRecipe, icon: PackageX, tone: "muted" },
    { key: "notSelling", label: "Без продаж", count: menuHealth.counts.notSelling, icon: Package, tone: "muted" },
    { key: "hidden", label: "Скрытые", count: menuHealth.counts.hidden, icon: EyeOff, tone: "muted" },
  ];
  const avgMarginShown = displayTotals.revenue > 0 ? (displayTotals.cleanProfit / displayTotals.revenue) * 100 : null;

  return (
    <div className="work-page pb-nav sm:pb-10">
      <div className="catalog-page-inner">
        <header className="catalog-header">
          <div>
            <p className="catalog-eyebrow">Управление ассортиментом</p>
            <h1>Товары и меню</h1>
            <p className="catalog-subtitle">Цены, состав и результаты продаж — в одном месте.</p>
          </div>
          <div className="catalog-header-actions">
            <div className="relative">
              <button type="button" className="catalog-button" aria-expanded={moreOpen} aria-label="Действия с меню" onClick={() => setMoreOpen((v) => !v)}>
                <MoreHorizontal size={18} /><span>Действия</span>
              </button>
              {moreOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
                  <div className="catalog-more-menu bg-white/[0.02] shadow-lg" onKeyDown={(e) => { if (e.key === "Escape") setMoreOpen(false); }}>
                    {[
                      { icon: Settings, label: "Разделы и категории", action: () => setStructureModal(true) },
                      isOwner && { icon: Copy, label: "Перенос в другую точку", action: () => setTransferModal(true) },
                      { icon: FileUp, label: "Импорт из PDF", action: () => setPdfImportModal(true) },
                      { icon: FileUp, label: "Импорт Excel", action: () => setImportModal(true) },
                      { icon: FileUp, label: "Экспорт Excel", action: exportExcel },
                    ].filter(Boolean).map(({ icon: Icon, label, action }) => (
                      <button type="button" key={label} onClick={() => { setMoreOpen(false); action(); }}><Icon size={16} />{label}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <button type="button" onClick={openProductModal} className="catalog-button catalog-button-primary"><Plus size={18} />Добавить товар</button>
          </div>
        </header>

        <section className="catalog-overview" aria-label="Продажи за текущий месяц" aria-busy={initialLoading}>
          <div className="catalog-period"><span className="catalog-eyebrow">Результаты меню</span><span>{new Date(`${currentSalesMonth}-01T12:00:00`).toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}</span></div>
          <div className="catalog-metrics">
            <div className="catalog-metric bg-white/[0.02] shadow-sm backdrop-blur-xl">
              <div className="catalog-metric-label"><Wallet size={16} />Выручка</div>
              <strong>{initialLoading ? "—" : formatMoney(monthTotals.revenue)}</strong>
              <span>По продажам за месяц</span>
            </div>
            <div className="catalog-metric bg-white/[0.02] shadow-sm backdrop-blur-xl">
              <div className="catalog-metric-label"><PackageX size={16} />Себестоимость</div>
              <strong>{initialLoading ? "—" : formatMoney(monthTotals.cost)}</strong>
              <span>Зафиксирована в чеках</span>
            </div>
            <div className={`catalog-metric catalog-metric-profit bg-white/[0.02] shadow-sm backdrop-blur-xl ${heroLoss ? "is-loss" : ""}`}>
              <div className="catalog-metric-label">{heroLoss ? <TrendingDown size={16} /> : <TrendingUp size={16} />}Валовая прибыль</div>
              <strong>{initialLoading ? "—" : formatMoney(monthTotals.cleanProfit)}</strong>
              <div className="catalog-profit-caption"><span>{monthMargin === null ? "Нет продаж за месяц" : `Маржа ${Math.round(monthMargin)}%`}</span><TrendSparkline values={dailyProfit.map((d) => d.profit)} color={heroTrendColor} className="h-6 w-24" /></div>
            </div>
            <div className="catalog-metric bg-white/[0.02] shadow-sm backdrop-blur-xl">
              <div className="catalog-metric-label"><Boxes size={16} />Продано товаров</div>
              <strong>{initialLoading ? "—" : num(monthTotals.quantity).toLocaleString("ru-RU")}<small>шт.</small></strong>
              <span>Позиций в меню · {products.length}</span>
            </div>
          </div>
          <p className="catalog-metrics-note">Прибыль рассчитана как выручка минус себестоимость по чекам, без расходов точки. Сводка включает все продажи месяца.</p>
        </section>

        {error && <div className="catalog-error" role="alert"><AlertTriangle size={18} /><p>{error}</p><button type="button" onClick={() => load().catch((e) => setError(e.message))}>Повторить</button></div>}

        <div className="catalog-workspace">
          <aside className="catalog-sidebar bg-white/[0.02] shadow-sm backdrop-blur-xl" aria-label="Разделы меню">
            <div className="catalog-sidebar-heading"><span>Каталог</span><button type="button" onClick={() => setStructureModal(true)} aria-label="Управление разделами и категориями" title="Разделы и категории"><Settings size={16} /></button></div>
            <nav className="catalog-category-nav" aria-label="Категории товаров">
              <button type="button" className={!selectedTypeId ? "is-selected" : ""} aria-pressed={!selectedTypeId} onClick={() => { setSelectedTypeId(""); setSelectedFolderId(""); }}><LayoutGrid size={16} /><span>Все товары</span><b>{products.length}</b></button>
              {safeTypes.map((type) => (
                <div key={type.id} className="catalog-type-group">
                  <button type="button" className={String(selectedTypeId) === String(type.id) && !selectedFolderId ? "is-selected" : ""} aria-pressed={String(selectedTypeId) === String(type.id) && !selectedFolderId} onClick={() => { setSelectedTypeId(String(type.id)); setSelectedFolderId(""); }}>
                    <ChevronRight size={15} className={String(selectedTypeId) === String(type.id) ? "is-expanded" : ""} /><span>{type.name}</span><b>{typeCounts.get(String(type.id)) || 0}</b>
                  </button>
                  {String(selectedTypeId) === String(type.id) && <div className="catalog-subcategories">{typeFolders.map((folder) => (
                    <button type="button" key={folder.id} className={String(selectedFolderId) === String(folder.id) ? "is-selected" : ""} aria-pressed={String(selectedFolderId) === String(folder.id)} onClick={() => setSelectedFolderId(String(folder.id))}><span>{folder.name}</span><b>{categoryCounts.get(String(folder.id)) || 0}</b></button>
                  ))}</div>}
                </div>
              ))}
            </nav>
            <button type="button" className="catalog-manage-link" onClick={() => setStructureModal(true)}><Plus size={15} />Разделы и категории</button>
            <div className="catalog-sidebar-note"><Package size={22} /><p>Меню связано с кассой</p><span>Цена и состав товара используются при оформлении новых продаж.</span></div>
          </aside>

          <section className="catalog-content" aria-label="Список товаров">
            <div className="catalog-toolbar">
              <label className="catalog-search">
                <Search size={18} />
                <input
                  aria-label="Найти товар"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Поиск по названию товара…"
                />
                {search && (
                  <button type="button" onClick={() => setSearch("")} aria-label="Очистить поиск">
                    <X size={16} />
                  </button>
                )}
              </label>
              <button
                type="button"
                className={`catalog-button ${selectedFolderId ? "is-active" : ""}`}
                aria-label="Фильтры товаров"
                onClick={() => setFilterModal(true)}
              >
                <SlidersHorizontal size={17} /><span>Фильтры</span>
              </button>
              <div className="catalog-view-switch" role="group" aria-label="Вид каталога">
                <button type="button" aria-label="Карточки" aria-pressed={catalogView === "cards"} onClick={() => setCatalogView("cards")}>
                  <LayoutGrid size={17} />
                </button>
                <button type="button" aria-label="Список" aria-pressed={catalogView === "list"} onClick={() => setCatalogView("list")}>
                  <List size={18} />
                </button>
              </div>
            </div>
            <div className="catalog-mobile-categories">
              <label>
                Раздел
                <select
                  aria-label="Раздел меню"
                  value={selectedTypeId}
                  onChange={(e) => { setSelectedTypeId(e.target.value); setSelectedFolderId(""); }}
                >
                  <option value="">Все товары</option>
                  {safeTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                </select>
              </label>
              {selectedTypeId && (
                <label>
                  Категория
                  <select aria-label="Категория меню" value={selectedFolderId} onChange={(e) => setSelectedFolderId(e.target.value)}>
                    <option value="">Все категории</option>
                    {typeFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                  </select>
                </label>
              )}
            </div>
            <div className="catalog-health-filters" role="group" aria-label="Быстрые фильтры товаров">
              <button type="button" aria-pressed={problemFilter === "all"} onClick={() => setProblemFilter("all")}>
                Все<span>{enriched.length}</span>
              </button>
              {healthFilters.map(({ key, label, count, icon: Icon, tone }) => (
                <button
                  type="button"
                  key={key}
                  className={`catalog-health-${tone}`}
                  aria-pressed={problemFilter === key}
                  onClick={() => setProblemFilter((value) => value === key ? "all" : key)}
                >
                  <Icon size={14} />{label}<span>{count}</span>
                </button>
              ))}
            </div>
            <div className="catalog-results-heading">
              <div>
                <h2>{selectedFolder?.name || selectedType?.name || "Все товары"}<span>{displayRows.length}</span></h2>
                <p>{search ? `Результаты поиска «${search}»` : "Показатели продаж за текущий месяц"}</p>
              </div>
              <div className="catalog-sort">
                <label className="sr-only" htmlFor="catalog-sort">Сортировка товаров</label>
                <select id="catalog-sort" value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
                  {Object.entries(SORT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
                <button
                  type="button"
                  aria-label={sortDir === "asc" ? "По возрастанию. Изменить направление" : "По убыванию. Изменить направление"}
                  onClick={() => setSortDir((value) => value === "asc" ? "desc" : "asc")}
                >
                  {sortDir === "asc" ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
                </button>
              </div>
            </div>
            {hasFilters && (
              <div className="catalog-active-filters">
                <span>Показано {displayRows.length} из {products.length}</span>
                <button type="button" onClick={resetCatalogFilters}><RotateCcw size={13} />Сбросить фильтры</button>
              </div>
            )}
            {initialLoading ? (
              <div className="catalog-products" role="status" aria-label="Загрузка товаров">
                {Array.from({ length: 6 }, (_, index) => <div key={index} className="catalog-skeleton animate-pulse bg-white/[0.02]" />)}
              </div>
            ) : displayRows.length ? (
              <div className={`catalog-products catalog-view-${catalogView}`}>
                {displayRows.map((product) => (
                  <ProductCard key={product.id} p={product} onEdit={openEditProduct} onDuplicate={duplicateProduct} onDelete={deleteProduct} />
                ))}
              </div>
            ) : (
              <div className="catalog-empty bg-white/[0.02]">
                <EmptyState
                  title={hasFilters ? "Товары не найдены" : "Создайте ваше меню"}
                  text={hasFilters ? "Измените запрос или сбросьте фильтры, чтобы увидеть остальные товары." : "Добавьте первый товар, укажите цену и состав. Он появится в кассе."}
                  actionLabel={hasFilters ? "Сбросить фильтры" : "Добавить товар"}
                  onAction={hasFilters ? resetCatalogFilters : openProductModal}
                />
              </div>
            )}
            {!initialLoading && displayRows.length > 0 && (
              <footer className="catalog-totals bg-white/[0.02]">
                <p>Итоги выборки<span>Всего {displayRows.length}</span></p>
                <div>
                  <span>Продано</span>
                  <strong>{displayTotals.quantity.toLocaleString("ru-RU")} шт.</strong>
                </div>
                <div>
                  <span>Выручка</span>
                  <strong>{formatMoney(displayTotals.revenue)}</strong>
                </div>
                <div>
                  <span>Валовая прибыль</span>
                  <strong className={displayTotals.cleanProfit < 0 ? "catalog-loss-text" : ""}>{formatMoney(displayTotals.cleanProfit)}</strong>
                </div>
                {avgMarginShown !== null && <div><span>Маржа</span><strong>{Math.round(avgMarginShown)}%</strong></div>}
              </footer>
            )}
          </section>
        </div>

        {transferModal && <MenuTransferModal onClose={() => setTransferModal(false)} />}
        {pdfImportModal && <MenuPdfImportModal onClose={() => setPdfImportModal(false)} onImported={() => load()} />}

      {filterModal && (
        <Modal title="Фильтр товаров" onClose={() => setFilterModal(false)}>
          <div className="space-y-3">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-400">
                Тип
              </span>
              <select
                value={selectedTypeId}
                onChange={(e) => setSelectedTypeId(e.target.value)}
                className="rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 shadow-inner shadow-black/10 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10 w-full"
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
              <span className="mb-2 block text-sm font-semibold text-slate-400">
                Папка / раздел
              </span>
              <select
                value={selectedFolderId}
                onChange={(e) => setSelectedFolderId(e.target.value)}
                className="rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 shadow-inner shadow-black/10 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10 w-full"
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
                setProblemFilter("all");
              }}
              className="rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-semibold text-slate-100 shadow-lg shadow-black/10 transition hover:bg-white/10 flex-1"
            >
              Сбросить
            </button>

            <button
              onClick={() => setFilterModal(false)}
              className="rounded-2xl bg-indigo-600 px-4 py-3 font-semibold text-white  transition hover:scale-[1.01] flex-1"
            >
              Показать
            </button>
          </div>
        </Modal>
      )}

      {structureModal && (
        <Modal title="Разделы и категории" wide onClose={() => setStructureModal(false)}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-3xl border border-white/[0.08] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-xl font-semibold">Разделы</h3>
                <button
                  onClick={() => {
                    setStructureModal(false);
                    setTypeModal(true);
                  }}
                  className="font-semibold text-blue-400"
                >
                  + раздел
                </button>
              </div>

              <div className="space-y-2">
                {safeTypes.map((t) => {
                  const isEditing = renaming?.kind === "type" && renaming.id === t.id;
                  const active = String(selectedTypeId) === String(t.id);
                  return (
                    <div key={t.id} className={`flex items-center gap-1.5 rounded-2xl px-2 ${active ? "bg-[#070b1a]" : "bg-white/5"}`}>
                      {isEditing ? (
                        <>
                          <input autoFocus value={renaming.name}
                            onChange={(e) => setRenaming((p) => ({ ...p, name: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") setRenaming(null); }}
                            className="min-w-0 flex-1 rounded-xl border border-blue-400/50 bg-slate-950/60 px-3 py-3 font-semibold text-white outline-none" />
                          <button onClick={saveRename} disabled={renameBusy} aria-label="Сохранить" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white disabled:opacity-50"><Check size={18} strokeWidth={2.6} /></button>
                          <button onClick={() => setRenaming(null)} aria-label="Отмена" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5 text-slate-300"><X size={18} strokeWidth={2.6} /></button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => setSelectedTypeId(String(t.id))} className={`min-w-0 flex-1 truncate rounded-xl px-2 py-3 text-left font-semibold ${active ? "text-white" : "text-slate-100"}`}>{t.name}</button>
                          <button onClick={() => startRename("type", t)} aria-label="Переименовать раздел" title="Переименовать" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-white/10 hover:text-blue-300"><Pencil size={16} strokeWidth={2.4} /></button>
                        </>
                      )}
                    </div>
                  );
                })}

                {!safeTypes.length && (
                  <p className="text-slate-400">
                    Пока нет разделов. Создайте «Бар» или «Кухня».
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-white/[0.08] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-xl font-semibold">Категории</h3>
                  <p className="text-sm text-slate-400">
                    для раздела: {selectedType?.name || "не выбран"}
                  </p>
                </div>

                <button
                  onClick={() => {
                    setStructureModal(false);
                    setFolderModal(true);
                  }}
                  className="font-semibold text-blue-400"
                >
                  + категория
                </button>
              </div>

              <div className="space-y-2">
                {typeFolders.map((f) => {
                  const isEditing = renaming?.kind === "folder" && renaming.id === f.id;
                  const active = String(selectedFolderId) === String(f.id);
                  return (
                    <div key={f.id} className={`flex items-center gap-1.5 rounded-2xl px-2 ${active ? "bg-[#070b1a]" : "bg-white/5"}`}>
                      {isEditing ? (
                        <>
                          <input autoFocus value={renaming.name}
                            onChange={(e) => setRenaming((p) => ({ ...p, name: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") setRenaming(null); }}
                            className="min-w-0 flex-1 rounded-xl border border-blue-400/50 bg-slate-950/60 px-3 py-3 font-semibold text-white outline-none" />
                          <button onClick={saveRename} disabled={renameBusy} aria-label="Сохранить" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white disabled:opacity-50"><Check size={18} strokeWidth={2.6} /></button>
                          <button onClick={() => setRenaming(null)} aria-label="Отмена" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5 text-slate-300"><X size={18} strokeWidth={2.6} /></button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => setSelectedFolderId(String(f.id))} className={`min-w-0 flex-1 truncate rounded-xl px-2 py-3 text-left font-semibold ${active ? "text-white" : "text-slate-100"}`}>{f.name}</button>
                          <button onClick={() => startRename("folder", f)} aria-label="Переименовать категорию" title="Переименовать" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-white/10 hover:text-blue-300"><Pencil size={16} strokeWidth={2.4} /></button>
                        </>
                      )}
                    </div>
                  );
                })}

                {selectedTypeId && !typeFolders.length && (
                  <p className="text-slate-400">В этом разделе ещё нет категорий.</p>
                )}

                {!selectedTypeId && (
                  <p className="text-slate-400">Сначала выберите раздел слева.</p>
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 flex gap-3">
            <button
              onClick={() => setStructureModal(false)}
              className="rounded-2xl bg-indigo-600 px-4 py-3 font-semibold text-white  transition hover:scale-[1.01] flex-1"
            >
              Готово
            </button>

            <button
              onClick={() => {
                setStructureModal(false);
                openProductModal();
              }}
              className="rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-semibold text-slate-100 shadow-lg shadow-black/10 transition hover:bg-white/10 flex-1"
            >
              + Товар
            </button>
          </div>
        </Modal>
      )}

      {importModal && (
        <Modal title="Импорт Excel" onClose={() => setImportModal(false)}>
          <div className="space-y-4">
            <p className="text-sm text-slate-400">
              Загрузите CSV-файл, который открывается в Excel. Колонки:
              Название, Тип, Папка, Себестоимость, Цена продажи, Состав.
            </p>
            <p className="text-xs text-slate-500">
              Колонка «Состав» необязательна — ингредиенты через «|», у каждого
              количество в конце, напр.: <span className="text-slate-300">Куриное филе 90 г | Булочка 80 г | Соус 20 г</span>.
              Ингредиенты, совпавшие по названию со складом, свяжутся и посчитают
              себестоимость; остальные останутся «без привязки».
            </p>

            <button onClick={exportExcel} className="rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-semibold text-slate-100 shadow-lg shadow-black/10 transition hover:bg-white/10 w-full">
              Выгрузить текущие товары в файл
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt"
              onChange={importExcel}
              className="rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 shadow-inner shadow-black/10 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10 w-full"
            />
          </div>

          {/* Обслуживание меню — необратимое действие, отделено от загрузки файла */}
          <div className="mt-6 border-t border-white/[0.08] pt-4">
            <p className="mb-3 text-sm font-semibold text-slate-300">Обслуживание меню</p>
            <button onClick={removeMenuDuplicates} className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 font-semibold text-amber-200 transition hover:bg-amber-500/20 w-full">
              Убрать дубли (если импорт запускали несколько раз)
            </button>
          </div>

          <div className="mt-6 flex gap-3">
            <button
              onClick={() => setImportModal(false)}
              className="rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-semibold text-slate-100 shadow-lg shadow-black/10 transition hover:bg-white/10 flex-1"
            >
              Закрыть
            </button>
          </div>
        </Modal>
      )}

      {typeModal && (
        <Modal title="Новый раздел" onClose={() => { setTypeModal(false); setStructureModal(true); }}>
          <input
            value={newTypeName}
            onChange={(e) => setNewTypeName(e.target.value)}
            placeholder="Например: Бар, Кухня"
            className="rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 shadow-inner shadow-black/10 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10 w-full"
          />

          <div className="mt-6 flex gap-3">
            <button
              onClick={() => {
                setTypeModal(false);
                setStructureModal(true);
              }}
              className="rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-semibold text-slate-100 shadow-lg shadow-black/10 transition hover:bg-white/10 flex-1"
            >
              Отмена
            </button>

            <button onClick={createType} className="rounded-2xl bg-indigo-600 px-4 py-3 font-semibold text-white  transition hover:scale-[1.01] flex-1">
              Создать
            </button>
          </div>
        </Modal>
      )}

      {folderModal && (
        <Modal title="Новая категория" onClose={() => { setFolderModal(false); setStructureModal(true); }}>
          <select
            value={selectedTypeId}
            onChange={(e) => setSelectedTypeId(e.target.value)}
            className="rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 shadow-inner shadow-black/10 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10 mb-3 w-full"
          >
            <option value="">Выберите раздел</option>
            {safeTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          <input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Например: Коктейли, Чаи"
            className="rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 shadow-inner shadow-black/10 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10 w-full"
          />

          <div className="mt-6 flex gap-3">
            <button
              onClick={() => {
                setFolderModal(false);
                setStructureModal(true);
              }}
              className="rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-semibold text-slate-100 shadow-lg shadow-black/10 transition hover:bg-white/10 flex-1"
            >
              Отмена
            </button>

            <button onClick={createFolder} className="rounded-2xl bg-indigo-600 px-4 py-3 font-semibold text-white  transition hover:scale-[1.01] flex-1">
              Создать
            </button>
          </div>
        </Modal>
      )}

      {productModal && (
        <Modal title="Новый товар" wide onClose={() => { setProductModal(false); setRecipe([]); setProductForm({ name: "", cost: "", price: "", isExtra: false, hidden: false }); }}>
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            <div className="sm:col-span-2">
              <div className="flex flex-col gap-2 sm:flex-row">
                <select
                  value={selectedTypeId}
                  onChange={(e) => { setSelectedTypeId(e.target.value); setSelectedFolderId(""); setShowNewType(false); }}
                  className="min-w-0 flex-1 rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none shadow-inner shadow-black/10 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10"
                >
                  <option value="">Выберите раздел</option>
                  {safeTypes.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
                </select>
                <button type="button"
                  onClick={() => { setShowNewType((v) => !v); setShowNewFolder(false); setQuickName(""); }}
                  className="shrink-0 whitespace-nowrap rounded-2xl border border-white/[0.08] bg-white/[0.06] px-3.5 py-3 text-sm font-semibold text-blue-300 transition hover:bg-white/10 sm:py-0">
                  {showNewType ? "Отмена" : "+ Новый раздел"}
                </button>
              </div>
              {showNewType && (
                <div className="mt-2 flex gap-2">
                  <input autoFocus value={quickName} onChange={(e) => setQuickName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); quickCreateType(); } }}
                    placeholder="Название раздела (напр. Бар)"
                    className="min-w-0 flex-1 rounded-2xl border border-blue-400/40 bg-slate-950/60 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500" />
                  <button type="button" onClick={quickCreateType}
                    className="shrink-0 rounded-2xl bg-indigo-600 px-4 font-semibold text-white transition hover:brightness-110">Создать</button>
                </div>
              )}
            </div>

            <div className="sm:col-span-2">
              <div className="flex flex-col gap-2 sm:flex-row">
                <select
                  value={selectedFolderId}
                  onChange={(e) => { setSelectedFolderId(e.target.value); setShowNewFolder(false); }}
                  className="min-w-0 flex-1 rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none shadow-inner shadow-black/10 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10"
                >
                  <option value="">Выберите категорию</option>
                  {typeFolders.map((f) => (<option key={f.id} value={f.id}>{f.name}</option>))}
                </select>
                <button type="button"
                  onClick={() => { if (!selectedTypeId) { setError("Сначала выберите раздел"); return; } setShowNewFolder((v) => !v); setShowNewType(false); setQuickName(""); }}
                  className="shrink-0 whitespace-nowrap rounded-2xl border border-white/[0.08] bg-white/[0.06] px-3.5 py-3 text-sm font-semibold text-blue-300 transition hover:bg-white/10 sm:py-0">
                  {showNewFolder ? "Отмена" : "+ Новая категория"}
                </button>
              </div>
              {showNewFolder && (
                <div className="mt-2 flex gap-2">
                  <input autoFocus value={quickName} onChange={(e) => setQuickName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); quickCreateFolder(); } }}
                    placeholder="Название категории (напр. Кофе)"
                    className="min-w-0 flex-1 rounded-2xl border border-blue-400/40 bg-slate-950/60 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500" />
                  <button type="button" onClick={quickCreateFolder}
                    className="shrink-0 rounded-2xl bg-indigo-600 px-4 font-semibold text-white transition hover:brightness-110">Создать</button>
                </div>
              )}
            </div>

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
                className="w-full rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 pr-32 font-bold text-white outline-none placeholder:text-slate-500 shadow-inner focus:border-blue-400/60"
              />
              <button type="button"
                onClick={() => {
                  const next = !aiAdvisorEnabled;
                  setAiAdvisorEnabled(next);
                  if (!next) setAiSuggestion(null);
                  else if (productForm.name?.trim().length >= 3) analyzeProductNameWork(productForm.name);
                }}
                className={`absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-semibold transition ${
                  aiAdvisorEnabled ? "bg-violet-500/20 text-violet-300 border border-violet-400/30" : "bg-white/5 text-slate-500 border border-white/[0.08]"
                }`}>
                {aiSuggestionLoading
                  ? <><span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-violet-400/30 border-t-violet-400"/>Думаю...</>
                  : <><Sparkles size={14}/>{aiAdvisorEnabled ? "AI вкл" : "AI выкл"}</>}
              </button>
            </div>

            {aiSuggestion && (
              <div className="sm:col-span-2 rounded-2xl border border-violet-400/20 bg-violet-500/[0.06] p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-violet-300"><Sparkles size={14}/> AI предлагает</p>
                    <p className="mt-1 font-semibold text-white">{aiSuggestion.displayName}</p>
                    <p className="text-xs text-slate-400">{aiSuggestion.description}</p>
                  </div>
                  <button type="button" onClick={() => setAiSuggestion(null)} aria-label="Закрыть" title="Закрыть" className="text-slate-500 hover:text-white"><X size={16} /></button>
                </div>
                <div className="flex gap-3 mb-3 text-sm">
                  <div className="rounded-xl bg-emerald-500/10 border border-emerald-400/20 px-3 py-2">
                    <p className="text-[10px] text-slate-400">Цена</p>
                    <p className="font-semibold text-emerald-300">{aiSuggestion.typicalPrice} ₽</p>
                  </div>
                  <div className="rounded-xl bg-orange-500/10 border border-orange-400/20 px-3 py-2">
                    <p className="text-[10px] text-slate-400">Себест.</p>
                    <p className="font-semibold text-orange-300">{aiSuggestion.estimatedCost} ₽</p>
                  </div>
                </div>
                <div className="mb-3 space-y-1">
                  {(aiSuggestion.ingredients || []).map((ing, i) => {
                    const found = safeWarehouseItems.find(w => String(w.name || "").toLowerCase().includes(String(ing.name || "").toLowerCase()));
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
                {aiSuggestion.tip && <p className="flex items-start gap-1.5 text-xs text-slate-400 italic mb-3"><Lightbulb size={14} className="mt-0.5 shrink-0" /> {aiSuggestion.tip}</p>}
                <button type="button" onClick={applyAiSuggestionWork}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-2 font-semibold text-white text-xs hover:opacity-90">
                  <Sparkles size={14}/> Применить — заполнить состав и цены
                </button>
              </div>
            )}

            <div>
              <input
                type="number"
                inputMode="decimal"
                value={productForm.cost}
                onChange={(e) =>
                  setProductForm((p) => ({ ...p, cost: e.target.value }))
                }
                placeholder="Себестоимость"
                className={`w-full rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 shadow-inner shadow-black/10 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10 ${safe_recipe.length > 0 ? "opacity-60 cursor-not-allowed" : ""}`}
                readOnly={safe_recipe.length > 0}
              />
              {safe_recipe.length > 0 && (
                <p className="mt-1.5 px-1 text-xs text-slate-400">
                  {recipeCost > 0
                    ? "Считается из состава автоматически"
                    : "Появится, когда ингредиенты из состава будут на складе"}
                </p>
              )}
            </div>

            <input
              type="number"
              inputMode="decimal"
              value={productForm.price}
              onChange={(e) =>
                setProductForm((p) => ({ ...p, price: e.target.value }))
              }
              placeholder="Цена продажи"
              className="w-full self-start rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 shadow-inner shadow-black/10 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10"
            />

            <button
              type="button"
              onClick={() => setProductForm((p) => ({ ...p, isExtra: !p.isExtra }))}
              className={`sm:col-span-2 flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                productForm.isExtra
                  ? "border-amber-400/40 bg-amber-500/10"
                  : "border-white/[0.08] bg-white/5 hover:bg-white/10"
              }`}
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-white">Доп. товар</span>
                <span className="block text-xs text-slate-400">Стаканчик, лёд и т.п. — в доходах считается отдельно</span>
              </span>
              <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${productForm.isExtra ? "bg-amber-500" : "bg-white/15"}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${productForm.isExtra ? "left-[22px]" : "left-0.5"}`} />
              </span>
            </button>

            <button
              type="button"
              onClick={() => setProductForm((p) => ({ ...p, hidden: !p.hidden }))}
              className={`sm:col-span-2 flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                productForm.hidden
                  ? "border-white/[0.08] bg-white/5 hover:bg-white/10"
                  : "border-emerald-400/40 bg-emerald-500/10"
              }`}
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-white">Доступен в кассе</span>
                <span className="block text-xs text-slate-400">{productForm.hidden ? "Скрыт из витрины кассы (стоп-лист) — остаётся в меню" : "Показывается в кассе для продажи"}</span>
              </span>
              <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${productForm.hidden ? "bg-white/15" : "bg-emerald-500"}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${productForm.hidden ? "left-0.5" : "left-[22px]"}`} />
              </span>
            </button>
          </div>

          <div className="mt-6 rounded-[1.5rem] border border-white/[0.08] bg-[#0f172a]/90 p-4">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-xl font-semibold">Состав / рецепт</h3>
                <p className="text-sm text-slate-400">
                  Укажите, сколько сырья уходит на 1 товар. Например: эспрессо —
                  зерно 20 г, капучино — зерно 18 г и молоко 180 мл.
                </p>
              </div>

              <div className="rounded-2xl bg-[#0f172a]/90 px-4 py-3 text-right shadow-sm">
                <p className="text-xs font-bold text-slate-400">
                  Авто себестоимость
                </p>
                <p className="font-semibold text-blue-400">
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
                  <div key={index} className="flex flex-col gap-1.5 rounded-2xl border border-white/8 bg-white/[0.02] p-3">
                    {/* Переключатель режима */}
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <button type="button"
                        onClick={() => updateRecipeRow(index, "mode", "warehouse")}
                        className={`inline-flex min-h-[44px] items-center justify-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${!isManual ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/30" : "bg-white/5 text-slate-400 border border-white/[0.08] hover:bg-white/10"}`}>
                        <Package size={14} /> Со склада
                      </button>
                      <button type="button"
                        onClick={() => { updateRecipeRow(index, "mode", "manual"); updateRecipeRow(index, "warehouseItemId", ""); }}
                        className={`inline-flex min-h-[44px] items-center justify-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${isManual ? "bg-violet-500/20 text-violet-300 border border-violet-400/30" : "bg-white/5 text-slate-400 border border-white/[0.08] hover:bg-white/10"}`}>
                        <PackageX size={14} /> Нет на складе
                      </button>
                      <button type="button" onClick={() => removeRecipeRow(index)}
                        className="ml-auto inline-flex min-h-[44px] items-center justify-center rounded-xl bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/20">
                        удалить
                      </button>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-[1fr_90px_72px]">
                      {isManual ? (
                        <SmartIngredientInput
                          value={row.ingredientName || ""}
                          onChange={(val) => updateRecipeRow(index, "ingredientName", val)}
                          warehouseItems={safeWarehouseItems}
                          onSelectItem={(id) => {
                            const item = safeWarehouseItems.find(w => String(w.id) === String(id));
                            updateRecipeRow(index, "warehouseItemId", id);
                            updateRecipeRow(index, "mode", "warehouse");
                            if (item) updateRecipeRow(index, "quantityUnit", item.unit);
                          }}
                        />
                      ) : (
                        <select
                          value={row.warehouseItemId || ""}
                          onChange={(e) => {
                            const item = safeWarehouseItems.find(w => String(w.id) === String(e.target.value));
                            updateRecipeRow(index, "warehouseItemId", e.target.value);
                            if (item) updateRecipeRow(index, "quantityUnit", item.unit);
                          }}
                          className="w-full rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10"
                        >
                          <option value="">Выберите сырьё со склада</option>
                          {safeWarehouseItems.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} ({item.unit}) — {item.quantity}
                            </option>
                          ))}
                        </select>
                      )}

                      <input type="number" inputMode="decimal" min="0" step="any" value={row.quantity}
                        onChange={(e) => updateRecipeRow(index, "quantity", e.target.value)}
                        placeholder="Кол-во"
                        className={`rounded-2xl border bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 focus:border-blue-400/60 ${num(row.quantity) <= 0 && (row.warehouseItemId || row.ingredientName) ? "border-red-500/60" : "border-white/[0.08]"}`}
                      />

                      <select
                        value={row.quantityUnit || selected?.unit || "g"}
                        onChange={(e) => updateRecipeRow(index, "quantityUnit", e.target.value)}
                        className="rounded-2xl border border-white/[0.08] bg-white/5 px-3 py-3 font-bold text-white outline-none focus:border-blue-400/60"
                      >
                        {UNIT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>

                    {isUnlinked && (
                      <p className="flex items-start gap-1 text-xs font-bold text-yellow-500">
                        <AlertTriangle size={12} className="mt-0.5 shrink-0" /> «{row.ingredientName}» — добавь на склад, тогда привяжется и себестоимость посчитается
                      </p>
                    )}
                    {!isUnlinked && selected && (
                      needsBackendGuess(row.quantityUnit || selected.unit, selected.unit, num(selected.packagingQuantity)) ? (
                        <p className="flex items-start gap-1 text-xs text-slate-400">
                          <Check size={12} className="mt-0.5 shrink-0" /> {selected.name} · себестоимость посчитается после сохранения
                        </p>
                      ) : (
                        <p className="flex items-start gap-1 text-xs text-emerald-400">
                          <Check size={12} className="mt-0.5 shrink-0" /> {selected.name} · себест. {formatMoney(toStorageQty(num(row.quantity), row.quantityUnit || selected.unit, selected.unit, num(selected.packagingQuantity), num(selected.lossPercent)) * getWarehouseUnitCost(selected))}
                        </p>
                      )
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
                className="flex-1 rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-semibold text-slate-100 transition hover:bg-white/10">
                + Со склада
              </button>
              <button type="button" onClick={() => addRecipeRow("manual")}
                className="flex-1 rounded-2xl border border-violet-400/20 bg-violet-500/8 px-4 py-3 font-semibold text-violet-200 transition hover:bg-violet-500/15">
                + Нет на складе
              </button>
            </div>
          </div>

          <div className="mt-6 flex gap-3">
            <button
              onClick={() => {
                setProductModal(false);
                setRecipe([]);
                setProductForm({ name: "", cost: "", price: "", isExtra: false, hidden: false });
              }}
              className="rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-semibold text-slate-100 shadow-lg shadow-black/10 transition hover:bg-white/10 flex-1"
            >
              Отмена
            </button>

            <button onClick={createProduct} disabled={saving} className="rounded-2xl bg-indigo-600 px-4 py-3 font-semibold text-white  transition hover:scale-[1.01] flex-1 disabled:cursor-not-allowed disabled:opacity-60">
              {saving ? "Сохраняю…" : "Создать"}
            </button>
          </div>
        </Modal>
      )}

      {editModal && editProduct && (
        <Modal title={`Редактировать: ${editProduct.name}`} wide onClose={() => setEditModal(false)}>
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            <input value={editProduct.name}
              onChange={e => setEditProduct(p => ({...p, name: e.target.value}))}
              placeholder="Название" className="w-full rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 shadow-inner focus:border-blue-400/60 sm:col-span-2"/>

            <select
              value={String(editProduct.typeId || "")}
              onChange={e => setEditProduct(p => ({...p, typeId: Number(e.target.value) || 0, categoryId: 0}))}
              aria-label="Тип"
              className="w-full min-w-0 rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 shadow-inner focus:border-blue-400/60"
            >
              <option value="">Выберите раздел</option>
              {safeTypes.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
            </select>

            <div className="min-w-0">
              <select
                value={String(editProduct.categoryId || "")}
                onChange={e => setEditProduct(p => ({...p, categoryId: Number(e.target.value) || 0}))}
                aria-label="Папка"
                className="w-full min-w-0 rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 shadow-inner focus:border-blue-400/60"
              >
                <option value="">Выберите категорию</option>
                {editTypeFolders.map((f) => (<option key={f.id} value={f.id}>{f.name}</option>))}
              </select>
              {editFolderRequired && !Number(editProduct.categoryId) && (
                <p className="mt-1.5 px-1 text-xs font-bold text-amber-300">Выберите категорию, иначе товар нельзя сохранить</p>
              )}
            </div>

            <input value={editProduct.price}
              onChange={e => setEditProduct(p => ({...p, price: e.target.value}))}
              placeholder="Цена продажи" type="number" inputMode="decimal" className="w-full self-start rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 shadow-inner focus:border-blue-400/60"/>

            {/* Переключатель себестоимости */}
            <div className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3">
              <span className="text-sm font-semibold text-slate-300">Себестоимость:</span>
              <button type="button" onClick={() => setEditCostMode("auto")}
                className={`inline-flex min-h-[40px] items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${editCostMode === "auto" ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/30" : "bg-white/5 text-slate-400 border border-white/[0.08]"}`}>
                <Zap size={14} /> Авто
              </button>
              <button type="button" onClick={() => setEditCostMode("manual")}
                className={`inline-flex min-h-[40px] items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${editCostMode === "manual" ? "bg-orange-500/20 text-orange-300 border border-orange-400/30" : "bg-white/5 text-slate-400 border border-white/[0.08]"}`}>
                <Pencil size={14} /> Вручную
              </button>
            </div>

            {editCostMode === "manual" && (
              <input value={editProduct.cost}
                onChange={e => setEditProduct(p => ({...p, cost: e.target.value}))}
                placeholder="Себестоимость (вручную)" type="number" inputMode="decimal" className="w-full rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 shadow-inner focus:border-blue-400/60 sm:col-span-2"/>
            )}

            {editCostMode === "auto" && (
              <div className="flex items-center gap-2 rounded-2xl border border-blue-400/20 bg-blue-500/10 px-4 py-3 text-sm font-bold text-blue-300 sm:col-span-2">
                <Zap size={14} className="shrink-0" /> Авто-себестоимость считается из состава ниже
              </div>
            )}

            <button
              type="button"
              onClick={() => setEditProduct(p => ({ ...p, hidden: !p.hidden }))}
              className={`sm:col-span-2 flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                editProduct.hidden
                  ? "border-white/[0.08] bg-white/5 hover:bg-white/10"
                  : "border-emerald-400/40 bg-emerald-500/10"
              }`}
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-white">Доступен в кассе</span>
                <span className="block text-xs text-slate-400">{editProduct.hidden ? "Скрыт из витрины кассы (стоп-лист) — остаётся в меню и истории" : "Показывается в кассе для продажи"}</span>
              </span>
              <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${editProduct.hidden ? "bg-white/15" : "bg-emerald-500"}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${editProduct.hidden ? "left-0.5" : "left-[22px]"}`} />
              </span>
            </button>
          </div>

          {/* Состав / рецепт */}
          <div className="mt-4 rounded-[24px] border border-white/[0.08] bg-white/[0.02] p-4">
            <h3 className="mb-3 text-lg font-semibold text-white">Состав / рецепт</h3>
            <div className="space-y-3">
              {editRecipe.map((row, index) => {
                const selected = safeWarehouseItems.find(i => String(i.id) === String(row.warehouseItemId));
                const isManual = row.mode === "manual";
                return (
                  <div key={index} className="flex flex-col gap-2 rounded-2xl border border-white/8 bg-white/[0.02] p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => updateEditRecipeRow(index, "mode", "warehouse")}
                        className={`inline-flex min-h-[44px] items-center justify-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${!isManual ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/30" : "bg-white/5 text-slate-400 border border-white/[0.08]"}`}>
                        <Package size={14} /> Со склада
                      </button>
                      <button type="button" onClick={() => { updateEditRecipeRow(index, "mode", "manual"); updateEditRecipeRow(index, "warehouseItemId", ""); }}
                        className={`inline-flex min-h-[44px] items-center justify-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${isManual ? "bg-violet-500/20 text-violet-300 border border-violet-400/30" : "bg-white/5 text-slate-400 border border-white/[0.08]"}`}>
                        <PackageX size={14} /> Нет на складе
                      </button>
                      <button type="button" onClick={() => removeEditRecipeRow(index)}
                        className="ml-auto inline-flex min-h-[44px] items-center justify-center rounded-xl bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-400">удалить</button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[1fr_90px_72px]">
                      {isManual ? (
                        <SmartIngredientInput
                          value={row.ingredientName || ""}
                          onChange={val => updateEditRecipeRow(index, "ingredientName", val)}
                          warehouseItems={safeWarehouseItems}
                          onSelectItem={id => {
                            const item = safeWarehouseItems.find(w => String(w.id) === String(id));
                            updateEditRecipeRow(index, "warehouseItemId", id);
                            updateEditRecipeRow(index, "mode", "warehouse");
                            if (item) updateEditRecipeRow(index, "quantityUnit", item.unit);
                          }}
                        />
                      ) : (
                        <select value={row.warehouseItemId || ""} onChange={e => {
                          const item = safeWarehouseItems.find(w => String(w.id) === String(e.target.value));
                          updateEditRecipeRow(index, "warehouseItemId", e.target.value);
                          if (item) updateEditRecipeRow(index, "quantityUnit", item.unit);
                        }} className="rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-bold text-white outline-none">
                          <option value="">Выберите со склада</option>
                          {safeWarehouseItems.map(item => (
                            <option key={item.id} value={item.id}>{item.name} ({item.unit}) — {item.quantity}</option>
                          ))}
                        </select>
                      )}
                      <input type="number" inputMode="decimal" min="0" step="any" value={row.quantity} onChange={e => updateEditRecipeRow(index, "quantity", e.target.value)}
                        placeholder="Кол-во"
                        className={`rounded-2xl border bg-white/5 px-4 py-3 font-bold text-white outline-none ${num(row.quantity) <= 0 && (row.warehouseItemId || row.ingredientName) ? "border-red-500/60" : "border-white/[0.08]"}`}/>
                      <select value={row.quantityUnit || selected?.unit || "g"}
                        onChange={e => updateEditRecipeRow(index, "quantityUnit", e.target.value)}
                        className="rounded-2xl border border-white/[0.08] bg-white/5 px-3 py-3 font-bold text-white outline-none">
                        {UNIT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                    {isManual && row.ingredientName && !row.warehouseItemId && (
                      <p className="flex items-center gap-1 text-xs font-bold text-yellow-500"><AlertTriangle size={12} strokeWidth={2.4} /> Добавьте на склад — привяжется автоматически</p>
                    )}
                    {selected && !isManual && (
                      needsBackendGuess(row.quantityUnit || selected.unit, selected.unit, num(selected.packagingQuantity)) ? (
                        <p className="flex items-center gap-1 text-xs text-slate-400">
                          <Check size={12} strokeWidth={2.4} /> себестоимость посчитается после сохранения
                        </p>
                      ) : (
                        <p className="flex items-center gap-1 text-xs text-emerald-400">
                          <Check size={12} strokeWidth={2.4} /> себест. {formatMoney(toStorageQty(num(row.quantity), row.quantityUnit || selected.unit, selected.unit, num(selected.packagingQuantity), num(selected.lossPercent)) * getWarehouseUnitCost(selected))}
                        </p>
                      )
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => addEditRecipeRow("warehouse")}
                className="flex-1 rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/10">
                + Со склада
              </button>
              <button type="button" onClick={() => addEditRecipeRow("manual")}
                className="flex-1 rounded-2xl border border-violet-400/20 bg-violet-500/8 px-4 py-2.5 text-sm font-semibold text-violet-200 hover:bg-violet-500/15">
                + Нет на складе
              </button>
            </div>
          </div>

          <div className="mt-6 flex gap-3">
            <button type="button" onClick={() => setEditModal(false)}
              className="rounded-2xl border border-white/[0.08] bg-white/5 px-4 py-3 font-semibold text-slate-100 shadow-lg shadow-black/10 transition hover:bg-white/10 flex-1">Отмена</button>
            <button type="button" onClick={saveEditProduct} disabled={saving}
              className="rounded-2xl bg-indigo-600 px-4 py-3 font-semibold text-white  transition hover:scale-[1.01] flex-1 disabled:cursor-not-allowed disabled:opacity-60">{saving ? "Сохраняю…" : "Сохранить"}</button>
          </div>
        </Modal>
      )}
      </div>
    </div>
  );
}
