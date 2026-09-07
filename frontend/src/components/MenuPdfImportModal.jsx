import { useMemo, useState } from "react";
import { FileText, Upload, Check, AlertTriangle, Loader2, ChevronDown } from "lucide-react";
import Modal from "./Modal";
import { post } from "../api";
import { extractPdfLines, parseMenuLines } from "../utils/menuPdf";

// Импорт меню кухни из PDF: извлекаем текст (pdf.js) → парсим категории/блюда/состав
// → показываем превью → отправляем на /menu/import. Всё детерминированно, без ИИ.
export default function MenuPdfImportModal({ onClose, onImported }) {
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState("");
  const [createWh, setCreateWh] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [open, setOpen] = useState({});

  const stats = useMemo(() => {
    if (!parsed) return { cats: 0, dishes: 0, ings: 0 };
    let dishes = 0, ings = 0;
    for (const c of parsed.categories) {
      dishes += c.dishes.length;
      for (const d of c.dishes) ings += d.recipe.length;
    }
    return { cats: parsed.categories.length, dishes, ings };
  }, [parsed]);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(""); setResult(null); setParsed(null); setFileName(file.name); setParsing(true);
    try {
      const lines = await extractPdfLines(file);
      const res = parseMenuLines(lines);
      if (!res.categories.length) {
        setError("Не удалось распознать меню в этом PDF. Нужен текстовый PDF (не скан-картинка) в формате «Меню — состав блюд».");
      } else {
        setParsed(res);
      }
    } catch (err) {
      setError(err?.message || "Не удалось прочитать PDF");
    } finally {
      setParsing(false);
    }
  };

  const doImport = async () => {
    if (!parsed || importing) return;
    setImporting(true); setError("");
    try {
      const r = await post("/menu/import", {
        defaultType: "Кухня",
        createWarehouseItems: createWh,
        categories: parsed.categories.map((c) => ({
          name: c.name,
          dishes: c.dishes.map((d) => ({ name: d.name, recipe: d.recipe })),
        })),
      });
      setResult(r);
      onImported?.();
    } catch (err) {
      setError(err?.message || "Не удалось импортировать");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal title="Импорт меню из PDF" section="Меню" wide onClose={onClose} legacyLight={false}>
      <div className="space-y-4">
        {/* Результат импорта */}
        {result ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-300">
                <Check size={22} strokeWidth={2.6} />
              </span>
              <div>
                <p className="text-base font-black text-white">Импорт завершён</p>
                <p className="text-sm font-bold text-slate-400">Меню обновлено</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {[
                ["Категорий создано", result.createdCategories],
                ["Уже было категорий", result.existingCategories],
                ["Блюд добавлено", result.createdDishes],
                ["Пропущено (дубли)", result.skippedDishes],
                ["Строк состава", result.recipeRows],
                ["Сырья на склад", result.createdWarehouseItems],
              ].map(([label, val]) => (
                <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.05] p-3">
                  <p className="text-xl font-black text-white">{val ?? 0}</p>
                  <p className="text-[11px] font-bold leading-tight text-slate-400">{label}</p>
                </div>
              ))}
            </div>
            <button onClick={onClose} className="w-full rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-3 font-black text-white shadow-lg transition hover:brightness-110 active:scale-[0.98]">
              Готово
            </button>
          </div>
        ) : (
          <>
            {/* Загрузка файла */}
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-white/15 bg-white/[0.03] px-4 py-8 text-center transition hover:border-blue-400/50 hover:bg-white/[0.06]">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-300">
                {parsing ? <Loader2 size={24} className="animate-spin" /> : <Upload size={24} strokeWidth={2.2} />}
              </span>
              <span className="text-sm font-black text-white">{parsing ? "Читаю PDF…" : fileName || "Выберите PDF с меню"}</span>
              <span className="max-w-md text-xs font-bold leading-5 text-slate-400">
                Формат «Меню — состав блюд»: категории, блюда и состав в граммах. Всё распознаётся на устройстве, без интернета.
              </span>
              <input type="file" accept="application/pdf,.pdf" onChange={onFile} className="hidden" disabled={parsing} />
            </label>

            {error && (
              <div className="flex items-start gap-2 rounded-2xl border border-red-400/30 bg-red-500/10 p-3">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-300" />
                <p className="text-sm font-bold text-red-200">{error}</p>
              </div>
            )}

            {/* Превью распознанного */}
            {parsed && (
              <>
                <div className="flex flex-wrap gap-2">
                  {[["категорий", stats.cats], ["блюд", stats.dishes], ["ингредиентов", stats.ings]].map(([l, v]) => (
                    <span key={l} className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-black text-white">
                      {v} <span className="font-bold text-slate-400">{l}</span>
                    </span>
                  ))}
                </div>

                <div className="max-h-[38vh] space-y-2 overflow-y-auto pr-1">
                  {parsed.categories.map((c) => (
                    <div key={c.name} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
                      <button
                        type="button"
                        onClick={() => setOpen((o) => ({ ...o, [c.name]: !o[c.name] }))}
                        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition hover:bg-white/[0.04]"
                      >
                        <span className="flex items-center gap-2 font-black text-white">
                          <FileText size={15} className="text-blue-300" /> {c.name}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-400">{c.dishes.length} блюд</span>
                          <ChevronDown size={16} className={`text-slate-400 transition ${open[c.name] ? "rotate-180" : ""}`} />
                        </span>
                      </button>
                      {open[c.name] && (
                        <div className="space-y-1.5 px-4 pb-3">
                          {c.dishes.map((d) => (
                            <div key={d.name} className="rounded-xl bg-white/[0.04] px-3 py-2">
                              <p className="text-sm font-black text-white">{d.name}</p>
                              <p className="mt-0.5 text-[11px] font-bold leading-snug text-slate-400">
                                {d.recipe.map((r) => `${r.name} ${r.quantity}${r.unit}`).join(" · ") || "состав пуст"}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
                  <input type="checkbox" checked={createWh} onChange={(e) => setCreateWh(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-blue-500" />
                  <span>
                    <span className="block text-sm font-black text-white">Завести недостающее сырьё на складе</span>
                    <span className="block text-xs font-bold leading-snug text-slate-400">
                      Создаст ингредиенты на складе с количеством 0 (потом проставите остатки и цены). Без галочки состав всё равно импортируется и свяжется с уже существующим сырьём.
                    </span>
                  </span>
                </label>

                <p className="text-xs font-bold leading-snug text-slate-500">
                  Существующие категории пополнятся, повторные блюда не создаются. Цены блюд проставите вручную в меню.
                </p>

                <div className="flex gap-2.5">
                  <button onClick={onClose} className="rounded-2xl border border-white/10 bg-white/[0.05] px-5 py-3 font-black text-slate-200 transition hover:bg-white/10">
                    Отмена
                  </button>
                  <button
                    onClick={doImport}
                    disabled={importing}
                    className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-3 font-black text-white shadow-lg transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
                  >
                    {importing ? <><Loader2 size={16} className="animate-spin" /> Импортирую…</> : <>Импортировать {stats.dishes} блюд</>}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
