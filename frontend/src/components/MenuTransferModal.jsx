import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Copy, FolderOpen, RefreshCw } from "lucide-react";
import { get, post, getCurrentWorkspace } from "../api";
import Modal from "./Modal";

// Перенос (копирование) меню между точками: выбираем источник, отмечаем категории/разделы,
// выбираем получателя — сервер копирует товары (и по желанию рецепты) без изменения источника.
export default function MenuTransferModal({ onClose }) {
  const currentWs = getCurrentWorkspace?.() || {};
  const [workspaces, setWorkspaces] = useState([]);
  const [sourceId, setSourceId] = useState(Number(currentWs?.dataAccountId) || 0);
  const [targetId, setTargetId] = useState(0);
  const [tree, setTree] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [withRecipes, setWithRecipes] = useState(true);
  const [loadingWs, setLoadingWs] = useState(true);
  const [loadingTree, setLoadingTree] = useState(false);
  const [copying, setCopying] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  // Esc закрывает окно
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Загрузка списка точек
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await get("/workspaces");
        if (!alive) return;
        const ws = Array.isArray(list) ? list : [];
        setWorkspaces(ws);
        const src = Number(currentWs?.dataAccountId) || ws[0]?.dataAccountId || 0;
        setSourceId(src);
        const other = ws.find((w) => w.dataAccountId !== src);
        setTargetId(other?.dataAccountId || 0);
      } catch (e) {
        setError(e?.message || "Не удалось загрузить точки");
      } finally {
        if (alive) setLoadingWs(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Загрузка меню точки-источника
  useEffect(() => {
    if (!sourceId) { setTree([]); return; }
    let alive = true;
    setLoadingTree(true);
    setSelected(new Set());
    setResult(null);
    (async () => {
      try {
        const data = await get(`/menu/overview?dataAccountId=${sourceId}`);
        if (!alive) return;
        setTree(Array.isArray(data?.types) ? data.types : []);
      } catch (e) {
        if (alive) { setTree([]); setError(e?.message || "Не удалось загрузить меню точки"); }
      } finally {
        if (alive) setLoadingTree(false);
      }
    })();
    return () => { alive = false; };
  }, [sourceId]);

  const allCatIds = useMemo(() => tree.flatMap((t) => t.categories.map((c) => c.id)), [tree]);
  const selectedProducts = useMemo(() => {
    let n = 0;
    for (const t of tree) for (const c of t.categories) if (selected.has(c.id)) n += c.productCount || 0;
    return n;
  }, [tree, selected]);

  const toggleCat = (id) =>
    setSelected((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const toggleType = (t) =>
    setSelected((prev) => {
      const s = new Set(prev);
      const ids = t.categories.map((c) => c.id);
      const allOn = ids.length > 0 && ids.every((id) => s.has(id));
      ids.forEach((id) => (allOn ? s.delete(id) : s.add(id)));
      return s;
    });

  const sameId = (a, b) => Number(a) === Number(b);
  const hasTwoPoints = workspaces.length >= 2;
  const canCopy = sourceId && targetId && !sameId(sourceId, targetId) && selected.size > 0 && !copying;

  const doCopy = async () => {
    if (!canCopy) return;
    setError(""); setResult(null); setCopying(true);
    try {
      const res = await post("/menu/copy", {
        sourceDataAccountId: Number(sourceId),
        targetDataAccountId: Number(targetId),
        categoryIds: [...selected],
        withRecipes,
      });
      setResult(res);
      window.notify?.("Меню скопировано в точку", "success");
    } catch (e) {
      setError(e?.message || "Не удалось скопировать меню");
    } finally {
      setCopying(false);
    }
  };

  const wsName = (id) => workspaces.find((w) => w.dataAccountId === Number(id))?.name || "точка";
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  };
  const selectClass = "w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 font-bold text-white outline-none focus:border-blue-400/70";

  return (
    <Modal title="Перенос меню между точками" section="Точки" wide>
      {loadingWs ? (
        <div className="flex items-center justify-center gap-2 py-12 text-slate-400">
          <RefreshCw size={18} className="animate-spin" /> Загрузка точек…
        </div>
      ) : !hasTwoPoints ? (
        <div className="py-8 text-center">
          <p className="text-lg font-black text-white">Нужно минимум две точки</p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-400">
            Создайте вторую точку в настройках, тогда сюда можно будет перенести меню.
          </p>
          <button type="button" onClick={onClose}
            className="mt-5 rounded-2xl border border-white/10 bg-white/[0.06] px-5 py-3 font-black text-slate-200 transition hover:bg-white/10">
            Понятно
          </button>
        </div>
      ) : result ? (
        <div className="py-4">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300">
            <Check size={28} strokeWidth={2.6} />
          </div>
          <p className="text-center text-lg font-black text-white">Готово — меню скопировано</p>
          <p className="mt-1 text-center text-sm text-slate-400">
            В точку «{wsName(targetId)}»
          </p>
          <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <Stat label="Категорий" value={result.copiedCategories} />
            <Stat label="Товаров" value={result.copiedProducts} tone="emerald" />
            <Stat label="Пропущено дублей" value={result.skippedProducts} />
            {withRecipes && <Stat label="Рецептов" value={result.copiedRecipes} />}
            {withRecipes && <Stat label="Создано сырья" value={result.createdWarehouseItems} tone="amber" />}
            <Stat label="Новых разделов" value={result.createdCategories} />
          </div>
          {withRecipes && result.createdWarehouseItems > 0 && (
            <p className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/[0.08] px-4 py-3 text-xs font-bold text-amber-200">
              Новое сырьё создано с нулевым остатком — пополните склад точки «{wsName(targetId)}», иначе товары уйдут «в минус».
            </p>
          )}
          <div className="mt-5 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => { setResult(null); setSelected(new Set()); }}
              className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 font-black text-slate-200 transition hover:bg-white/10">
              Скопировать ещё
            </button>
            <button type="button" onClick={onClose}
              className="rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-3 font-black text-white shadow-lg shadow-blue-900/30 transition hover:brightness-110">
              Готово
            </button>
          </div>
        </div>
      ) : (
        <div>
          {/* Откуда → куда */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
            <label className="block">
              <span className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-400">Откуда (источник)</span>
              <select value={sourceId} onChange={(e) => setSourceId(Number(e.target.value))} className={selectClass}>
                {workspaces.map((w) => (
                  <option key={w.dataAccountId} value={w.dataAccountId}>{w.name}{w.isMain ? " · основная" : ""}</option>
                ))}
              </select>
            </label>
            <div className="hidden shrink-0 pb-3 text-slate-500 sm:block"><ArrowRight size={20} strokeWidth={2.4} /></div>
            <label className="block">
              <span className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-400">Куда (получатель)</span>
              <select value={targetId} onChange={(e) => setTargetId(Number(e.target.value))} className={selectClass}>
                <option value={0}>Выберите точку…</option>
                {workspaces.filter((w) => w.dataAccountId !== Number(sourceId)).map((w) => (
                  <option key={w.dataAccountId} value={w.dataAccountId}>{w.name}{w.isMain ? " · основная" : ""}</option>
                ))}
              </select>
            </label>
          </div>

          {sameId(sourceId, targetId) && (
            <p className="mt-3 rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-200">Выберите две разные точки.</p>
          )}

          {/* Что копировать */}
          <div className="mt-5 flex items-center justify-between gap-3">
            <p className="text-sm font-black text-white">Что скопировать</p>
            <div className="flex items-center gap-2 text-xs font-black">
              <button type="button" onClick={() => setSelected(new Set(allCatIds))} className="rounded-lg bg-white/10 px-2.5 py-1.5 text-slate-200 transition hover:bg-white/15">Выбрать всё</button>
              <button type="button" onClick={() => setSelected(new Set())} className="rounded-lg bg-white/5 px-2.5 py-1.5 text-slate-400 transition hover:bg-white/10">Сбросить</button>
            </div>
          </div>

          <div className="mt-2.5 max-h-[42vh] space-y-2 overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/40 p-2.5">
            {loadingTree ? (
              <div className="flex items-center justify-center gap-2 py-10 text-slate-400"><RefreshCw size={16} className="animate-spin" /> Загрузка меню…</div>
            ) : tree.length === 0 ? (
              <div className="py-10 text-center text-sm font-bold text-slate-500">В этой точке пока нет меню.</div>
            ) : (
              tree.map((t) => {
                const ids = t.categories.map((c) => c.id);
                const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
                const someOn = ids.some((id) => selected.has(id));
                return (
                  <div key={t.name} className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
                    <button type="button" onClick={() => toggleType(t)}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-white/[0.04]">
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${allOn ? "border-blue-400 bg-blue-500" : someOn ? "border-blue-400/60 bg-blue-500/30" : "border-white/20 bg-transparent"}`}>
                        {allOn && <Check size={13} strokeWidth={3} className="text-white" />}
                        {!allOn && someOn && <span className="h-0.5 w-2.5 rounded bg-white" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-black text-white">{t.name}</span>
                      <span className="shrink-0 text-[11px] font-bold text-slate-500">{t.categories.length} {plural(t.categories.length, "папка", "папки", "папок")}</span>
                    </button>
                    {t.categories.length > 0 && (
                      <div className="space-y-1 px-2 pb-2">
                        {t.categories.map((c) => {
                          const on = selected.has(c.id);
                          return (
                            <button key={c.id} type="button" onClick={() => toggleCat(c.id)}
                              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${on ? "bg-blue-500/10" : "hover:bg-white/[0.04]"}`}>
                              <span className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-md border ${on ? "border-blue-400 bg-blue-500" : "border-white/20"}`} style={{ height: 18, width: 18 }}>
                                {on && <Check size={12} strokeWidth={3} className="text-white" />}
                              </span>
                              <FolderOpen size={15} className="shrink-0 text-blue-300" />
                              <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-slate-200">{c.name}</span>
                              <span className="shrink-0 text-[11px] font-bold text-slate-500">{c.productCount} тов.</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Рецепты */}
          <button type="button" onClick={() => setWithRecipes((v) => !v)}
            className="mt-3 flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left transition hover:bg-white/[0.05]">
            <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${withRecipes ? "bg-blue-500" : "bg-white/15"}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${withRecipes ? "left-[22px]" : "left-0.5"}`} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-black text-white">Переносить рецепты (состав)</span>
              <span className="block text-xs font-bold text-slate-400">Недостающее сырьё создастся в складе получателя с нулевым остатком.</span>
            </span>
          </button>

          {error && <p className="mt-3 rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-200">{error}</p>}

          {/* Действия */}
          <div className="mt-5 flex flex-col-reverse gap-2.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-bold text-slate-400">
              Выбрано: <b className="text-slate-200">{selected.size}</b> {plural(selected.size, "категория", "категории", "категорий")} · <b className="text-slate-200">{selectedProducts}</b> {plural(selectedProducts, "товар", "товара", "товаров")}
            </p>
            <div className="flex flex-col-reverse gap-2.5 sm:flex-row">
              <button type="button" onClick={onClose}
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 font-black text-slate-200 transition hover:bg-white/10">
                Отмена
              </button>
              <button type="button" onClick={doCopy} disabled={!canCopy}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-3 font-black text-white shadow-lg shadow-blue-900/30 transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100">
                {copying ? <RefreshCw size={16} className="animate-spin" /> : <Copy size={16} strokeWidth={2.4} />}
                {copying ? "Копирую…" : "Скопировать"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value, tone = "slate" }) {
  const toneCls = tone === "emerald" ? "text-emerald-300" : tone === "amber" ? "text-amber-300" : "text-white";
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
      <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-black tabular-nums ${toneCls}`}>{value ?? 0}</p>
    </div>
  );
}
