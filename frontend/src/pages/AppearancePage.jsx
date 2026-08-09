import { useEffect, useState } from "react";
import {
  Check, Copy, Download, Moon, Palette, Plus, RotateCcw, Sparkles, Sun, Trash2, Upload, Users,
} from "lucide-react";
import {
  DEFAULT_APPEARANCE, DENSITY_LABELS, FONT_LABELS, PRESETS, RADIUS_LABELS, RADIUS_PRESETS, SHADOW_LABELS,
  deleteTheme, duplicateTheme, exportTheme, getAppearance, importTheme, listThemes, renameTheme,
  resetAppearance, saveTheme, setAppearance,
} from "../theme/engine";
import { getTheme, setTheme } from "../theme";
import { getSession, put } from "../api";

const ACCENTS = ["#3b82f6", "#6366f1", "#8b5cf6", "#d946ef", "#ec4899", "#f43f5e", "#ef4444", "#f97316", "#f59e0b", "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9", "#d4af37", "#64748b"];
const notify = (m, t) => window.notify?.(m, t);

// ── маленькие переиспользуемые контролы ──────────────────────────────
function Segmented({ value, onChange, options, size = "md" }) {
  return (
    <div className="no-scrollbar flex gap-1.5 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03] p-1">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={`shrink-0 rounded-xl font-black transition ${size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm"} ${
            value === o.value ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-lg" : "text-slate-300 hover:bg-white/10 hover:text-white"
          }`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition ${checked ? "bg-blue-600" : "bg-white/15"}`}>
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? "left-6" : "left-1"}`} />
    </button>
  );
}

function Slider({ value, min, max, step, onChange, format, disabled }) {
  return (
    <div className={`flex items-center gap-3 ${disabled ? "pointer-events-none opacity-40" : ""}`}>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-white/15 accent-blue-500" />
      <span className="w-16 shrink-0 text-right text-sm font-black tabular-nums text-slate-300">{format ? format(value) : value}</span>
    </div>
  );
}

function Section({ icon: Icon, title, desc, children, right }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-4 shadow-lg backdrop-blur sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {Icon && <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-500/15 text-blue-300"><Icon size={16} strokeWidth={2.6} /></span>}
          <div>
            <h3 className="text-base font-black text-white">{title}</h3>
            {desc && <p className="mt-0.5 text-[13px] text-slate-400">{desc}</p>}
          </div>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function ColorField({ label, value, fallback, onChange }) {
  const val = value || fallback;
  return (
    <label className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <span className="text-sm font-bold text-slate-300">{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-mono text-xs text-slate-500">{val}</span>
        <input type="color" value={val} onChange={(e) => onChange(e.target.value)}
          aria-label={label} className="h-8 w-10 cursor-pointer rounded-lg border border-white/10 bg-transparent p-0" />
      </span>
    </label>
  );
}

function Row({ label, hint, children }) {
  return (
    <div className="flex flex-col gap-2 border-b border-white/[0.06] py-3 last:border-0 last:pb-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="text-sm font-bold text-slate-200">{label}</p>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
      <div className="w-full sm:max-w-[62%]">{children}</div>
    </div>
  );
}

// ── страница ─────────────────────────────────────────────────────────
export default function AppearancePage() {
  const [ap, setAp] = useState(getAppearance());
  const [mode, setMode] = useState(getTheme());
  const [themes, setThemes] = useState(listThemes());
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [newName, setNewName] = useState("");
  const [savingAll, setSavingAll] = useState(false);
  const isOwner = getSession()?.role === "owner";

  useEffect(() => {
    const onAp = (e) => setAp(e.detail || getAppearance());
    const onTheme = () => setMode(getTheme());
    const onThemes = () => setThemes(listThemes());
    window.addEventListener("sales-appearance-change", onAp);
    window.addEventListener("sales-theme-change", onTheme);
    window.addEventListener("sales-themes-change", onThemes);
    return () => {
      window.removeEventListener("sales-appearance-change", onAp);
      window.removeEventListener("sales-theme-change", onTheme);
      window.removeEventListener("sales-themes-change", onThemes);
    };
  }, []);

  const update = (partial) => setAp(setAppearance(partial));

  const applyPreset = (p) => {
    setAp(setAppearance({ ...DEFAULT_APPEARANCE, ...p.appearance }));
    if (p.mode) { setTheme(p.mode); }
    notify(`Тема «${p.name}» применена`, "success");
  };

  const applyCustom = (t) => { setAp(setAppearance({ ...DEFAULT_APPEARANCE, ...t.appearance })); notify(`Тема «${t.name}» применена`, "success"); };

  const onSave = () => {
    const name = newName.trim() || "Моя тема";
    saveTheme(name, ap);
    setNewName("");
    notify(`Тема «${name}» сохранена`, "success");
  };

  const onExport = async () => {
    const text = exportTheme(ap, "Моя тема");
    try { await navigator.clipboard.writeText(text); notify("Тема скопирована в буфер обмена", "success"); }
    catch { setImportOpen(true); setImportText(text); }
  };

  const onImport = () => {
    try {
      const { name, appearance } = importTheme(importText);
      setAp(setAppearance(appearance));
      saveTheme(name, appearance);
      setImportOpen(false); setImportText("");
      notify(`Тема «${name}» импортирована`, "success");
    } catch { notify("Не удалось прочитать тему. Проверьте формат.", "error"); }
  };

  const onReset = () => { setAp(resetAppearance()); notify("Оформление сброшено", "success"); };

  // Применить текущее оформление на весь аккаунт — у всех сотрудников.
  // Тему (светлую/тёмную) не трогаем: она у каждого своя.
  const onApplyForAll = async () => {
    setSavingAll(true);
    try {
      await put("/settings/appearance", { appearance: ap });
      notify("Оформление применено для всех сотрудников", "success");
    } catch (e) {
      notify(e?.message || "Не удалось сохранить оформление", "error");
    } finally {
      setSavingAll(false);
    }
  };

  return (
    <div className="relative pb-nav text-white sm:pb-10">
      <div className="pointer-events-none absolute -top-24 right-1/4 h-72 w-72 rounded-full bg-violet-600/20 blur-3xl" />

      <div className="relative mx-auto w-full max-w-[1100px]">
        {/* Заголовок */}
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-bold text-blue-400">Оформление</p>
            <h1 className="text-3xl font-black leading-tight tracking-[-0.02em] text-white sm:text-4xl">Тема</h1>
            <p className="mt-1.5 text-sm text-slate-400">Настройте вид приложения под себя. Изменения применяются сразу.</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={onExport} className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm font-black text-slate-200 transition hover:bg-white/10">
              <Download size={16} /> Экспорт
            </button>
            <button type="button" onClick={() => setImportOpen((v) => !v)} className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm font-black text-slate-200 transition hover:bg-white/10">
              <Upload size={16} /> Импорт
            </button>
            <button type="button" onClick={onReset} aria-label="Сбросить оформление" className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm font-black text-slate-200 transition hover:bg-white/10" title="Сбросить оформление">
              <RotateCcw size={16} />
            </button>
          </div>
        </header>

        {/* Оформление — общее для команды */}
        {isOwner ? (
          <div className="mb-6 flex flex-col gap-3 rounded-3xl border border-blue-400/25 bg-blue-500/[0.07] p-4 shadow-lg sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-blue-500/20 text-blue-300"><Users size={18} strokeWidth={2.4} /></span>
              <div>
                <p className="text-sm font-black text-white">Оформление для всей команды</p>
                <p className="mt-0.5 text-[13px] text-slate-400">Настройте вид ниже и примените его на устройствах всех сотрудников. Светлую/тёмную тему каждый выбирает сам.</p>
              </div>
            </div>
            <button type="button" onClick={onApplyForAll} disabled={savingAll}
              className="flex shrink-0 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-3 font-black text-white shadow-lg transition hover:brightness-110 active:scale-[0.98] disabled:opacity-60">
              <Check size={16} strokeWidth={2.6} /> {savingAll ? "Применяю…" : "Применить для всех"}
            </button>
          </div>
        ) : (
          <div className="mb-6 flex items-start gap-3 rounded-3xl border border-white/10 bg-white/[0.03] p-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/8 text-slate-400"><Palette size={16} /></span>
            <p className="text-[13px] text-slate-400">Общее оформление задаёт владелец. Изменения здесь останутся только на этом устройстве.</p>
          </div>
        )}

        {importOpen && (
          <div className="mb-6 rounded-3xl border border-white/10 bg-white/[0.04] p-4 sm:p-5">
            <p className="mb-2 text-sm font-black text-white">Импорт темы</p>
            <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={5} placeholder="Вставьте JSON темы сюда…"
              className="w-full rounded-2xl border border-white/10 bg-slate-950/60 p-3 font-mono text-xs text-white outline-none focus:border-blue-400/60" />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setImportOpen(false)} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-black text-slate-200 hover:bg-white/10">Отмена</button>
              <button type="button" onClick={onImport} className="rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2.5 text-sm font-black text-white">Применить</button>
            </div>
          </div>
        )}

        {/* Живой предпросмотр */}
        <div className="mb-6 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-lg backdrop-blur">
          <p className="mb-3 text-[11px] font-black uppercase tracking-wider text-slate-400">Предпросмотр</p>
          <div className="flex flex-wrap items-center gap-3">
            <button className="rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2.5 text-sm font-black text-white shadow-lg">Основная кнопка</button>
            <button className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-black text-slate-200">Вторичная</button>
            <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 py-1.5 text-xs font-black text-emerald-300">Успех</span>
            <span className="rounded-full border border-amber-400/25 bg-amber-500/10 px-3 py-1.5 text-xs font-black text-amber-300">Внимание</span>
            <span className="rounded-full border border-red-400/25 bg-red-500/10 px-3 py-1.5 text-xs font-black text-red-300">Ошибка</span>
            <span className="rounded-full border border-blue-400/25 bg-blue-500/10 px-3 py-1.5 text-xs font-black text-blue-300">Инфо</span>
            <div className="grid h-11 min-w-[120px] flex-1 place-items-center rounded-2xl border border-white/10 bg-white/[0.03] text-sm font-bold text-slate-400">Поле ввода</div>
          </div>
        </div>

        {/* Готовые темы */}
        <Section icon={Sparkles} title="Готовые темы" desc="Начните с профессиональной темы — потом настройте детали">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {PRESETS.map((p) => {
              const a = p.appearance;
              const dots = [a.accent || "#3b82f6", a.accent2 || "#8b5cf6", a.success || "#10b981", a.error || "#ef4444"];
              return (
                <button key={p.id} type="button" onClick={() => applyPreset(p)}
                  className="group flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-left transition hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.06]">
                  <span className="flex -space-x-1.5">
                    {dots.map((c, i) => <span key={i} className="h-6 w-6 rounded-full border-2 border-slate-900" style={{ background: c }} />)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-black text-white">{p.name}</span>
                    <span className="block text-[11px] font-semibold text-slate-500">{p.mode === "light" ? "Светлая" : "Тёмная"}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Section>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {/* Базовая тема + акценты */}
          <Section icon={Palette} title="Цвета" desc="Акцент и статусные цвета перекрашивают всё приложение">
            <Row label="Базовая тема">
              <Segmented value={mode} onChange={(v) => setTheme(v)} options={[
                { value: "dark", label: (<span className="flex items-center gap-1.5"><Moon size={13} /> Тёмная</span>) },
                { value: "light", label: (<span className="flex items-center gap-1.5"><Sun size={13} /> Светлая</span>) },
              ]} />
            </Row>
            <Row label="Основной цвет" hint="Кнопки, ссылки, выделение">
              <div className="flex flex-col items-end gap-2">
                <div className="flex flex-wrap justify-end gap-1.5">
                  {ACCENTS.map((c) => (
                    <button key={c} type="button" onClick={() => update({ accent: c })} title={c}
                      className={`h-7 w-7 rounded-full border-2 transition ${(ap.accent || "").toLowerCase() === c ? "scale-110 border-white" : "border-white/20 hover:scale-105"}`}
                      style={{ background: c }} />
                  ))}
                </div>
                <input type="color" value={ap.accent || "#3b82f6"} onChange={(e) => update({ accent: e.target.value })} aria-label="Основной цвет"
                  className="h-8 w-full cursor-pointer rounded-lg border border-white/10 bg-transparent p-0" />
              </div>
            </Row>
            <Row label="Второй цвет" hint="Второй край градиента">
              <input type="color" value={ap.accent2 || "#8b5cf6"} onChange={(e) => update({ accent2: e.target.value })} aria-label="Второй цвет"
                className="h-9 w-full cursor-pointer rounded-lg border border-white/10 bg-transparent p-0" />
            </Row>
            <div className="mt-3 grid gap-2">
              <ColorField label="Успех" value={ap.success} fallback="#10b981" onChange={(v) => update({ success: v })} />
              <ColorField label="Внимание" value={ap.warning} fallback="#f59e0b" onChange={(v) => update({ warning: v })} />
              <ColorField label="Ошибка" value={ap.error} fallback="#ef4444" onChange={(v) => update({ error: v })} />
              <ColorField label="Инфо" value={ap.info} fallback="#0ea5e9" onChange={(v) => update({ info: v })} />
            </div>
          </Section>

          {/* Форма и материал */}
          <div className="grid gap-4">
            <Section title="Скругление" desc="Форма кнопок, карточек и полей">
              <Segmented value={pickRadiusPreset(ap.radius)} onChange={(k) => update({ radius: RADIUS_PRESETS[k] })} size="sm"
                options={Object.keys(RADIUS_PRESETS).map((k) => ({ value: k, label: RADIUS_LABELS[k] }))} />
              <div className="mt-3">
                <Slider value={ap.radius} min={0} max={1.8} step={0.05} onChange={(v) => update({ radius: v })} format={(v) => `${Math.round(v * 100)}%`} />
              </div>
            </Section>

            <Section title="Стекло и тени" desc="Эффект матового стекла и глубина">
              <Row label="Матовое стекло">
                <div className="flex justify-end"><Toggle checked={ap.glass} onChange={(v) => update({ glass: v })} /></div>
              </Row>
              <Row label="Сила размытия">
                <Slider value={ap.blur} min={0.2} max={1.8} step={0.05} onChange={(v) => update({ blur: v })} format={(v) => `${Math.round(v * 100)}%`} disabled={!ap.glass} />
              </Row>
              <Row label="Тени">
                <Segmented value={ap.shadow} onChange={(v) => update({ shadow: v })} size="sm"
                  options={Object.keys(SHADOW_LABELS).map((k) => ({ value: k, label: SHADOW_LABELS[k] }))} />
              </Row>
            </Section>
          </div>

          {/* Типографика */}
          <Section title="Шрифт" desc="Гарнитура и размер текста">
            <Row label="Гарнитура">
              <Segmented value={ap.font} onChange={(v) => update({ font: v })} size="sm"
                options={Object.keys(FONT_LABELS).map((k) => ({ value: k, label: FONT_LABELS[k] }))} />
            </Row>
            <Row label="Размер текста">
              <Slider value={ap.fontScale} min={0.85} max={1.2} step={0.01} onChange={(v) => update({ fontScale: v })} format={(v) => `${Math.round(v * 100)}%`} />
            </Row>
          </Section>

          {/* Пространство и движение */}
          <Section title="Пространство и движение" desc="Плотность интерфейса и анимации">
            <Row label="Плотность">
              <Segmented value={ap.density} onChange={(v) => update({ density: v })} size="sm"
                options={Object.keys(DENSITY_LABELS).map((k) => ({ value: k, label: DENSITY_LABELS[k] }))} />
            </Row>
            <Row label="Анимации" hint="Плавные переходы и эффекты">
              <div className="flex justify-end"><Toggle checked={ap.motion} onChange={(v) => update({ motion: v })} /></div>
            </Row>
          </Section>
        </div>

        {/* Мои темы */}
        <Section icon={Plus} title="Мои темы" desc="Сохраните текущие настройки как свою тему">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Название темы…" onKeyDown={(e) => e.key === "Enter" && onSave()}
              className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2.5 font-bold text-white outline-none placeholder:text-slate-500 focus:border-blue-400/60" />
            <button type="button" onClick={onSave} className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-2.5 font-black text-white shadow-lg transition hover:brightness-110">
              <Plus size={16} /> Сохранить
            </button>
          </div>
          {themes.length ? (
            <div className="grid gap-2">
              {themes.map((t) => {
                const a = t.appearance || {};
                const dots = [a.accent || "#3b82f6", a.accent2 || "#8b5cf6", a.success || "#10b981"];
                return (
                  <div key={t.id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-2.5">
                    <span className="flex -space-x-1.5">
                      {dots.map((c, i) => <span key={i} className="h-6 w-6 rounded-full border-2 border-slate-900" style={{ background: c }} />)}
                    </span>
                    <input defaultValue={t.name} onBlur={(e) => e.target.value.trim() && e.target.value !== t.name && renameTheme(t.id, e.target.value)}
                      className="min-w-0 flex-1 rounded-lg bg-transparent px-1 py-1 text-sm font-black text-white outline-none focus:bg-white/5" />
                    <button type="button" onClick={() => applyCustom(t)} className="rounded-xl bg-blue-500/15 px-3 py-1.5 text-xs font-black text-blue-300 transition hover:bg-blue-500/25">
                      <Check size={14} className="inline" /> Применить
                    </button>
                    <button type="button" onClick={() => duplicateTheme(t.id)} aria-label="Дублировать тему" title="Дублировать" className="grid h-8 w-8 place-items-center rounded-xl bg-white/5 text-slate-400 transition hover:bg-white/10 hover:text-white"><Copy size={14} /></button>
                    <button type="button" onClick={() => { if (confirm(`Удалить тему «${t.name}»?`)) deleteTheme(t.id); }} aria-label="Удалить тему" title="Удалить" className="grid h-8 w-8 place-items-center rounded-xl bg-red-500/10 text-red-300 transition hover:bg-red-500/20"><Trash2 size={14} /></button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 py-8 text-center text-sm font-bold text-slate-500">Сохранённых тем пока нет</div>
          )}
        </Section>
      </div>
    </div>
  );
}

function pickRadiusPreset(value) {
  let best = "modern", diff = Infinity;
  for (const [k, v] of Object.entries(RADIUS_PRESETS)) {
    const d = Math.abs(v - value);
    if (d < diff) { diff = d; best = k; }
  }
  return diff <= 0.08 ? best : "modern";
}
