import { useEffect, useMemo, useRef, useState } from "react";

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const WEEK = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const pad = (n) => String(n).padStart(2, "0");
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = (s) => {
  if (!s) return null;
  const [y, m, d] = String(s).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
};
const fmtRu = (s) => {
  const d = fromISO(s);
  return d ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}` : "";
};
const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// Кастомный выбор даты в стиле приложения (вместо нативного type="date").
export default function DatePicker({ value, onChange, placeholder = "дд.мм.гггг", align = "left", className = "" }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => fromISO(value) || new Date());
  const wrapRef = useRef(null);

  useEffect(() => {
    if (value) setView(fromISO(value) || new Date());
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const grid = useMemo(() => {
    const y = view.getFullYear();
    const m = view.getMonth();
    const startOffset = (new Date(y, m, 1).getDay() + 6) % 7; // неделя с понедельника
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(y, m, d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [view]);

  const selected = fromISO(value);
  const today = new Date();
  const pick = (d) => { onChange?.(toISO(d)); setOpen(false); };
  const shiftMonth = (delta) => setView((v) => new Date(v.getFullYear(), v.getMonth() + delta, 1));

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2 rounded-xl border bg-slate-950/60 px-3 py-2.5 text-left text-sm font-bold outline-none transition ${open ? "border-blue-400/60 ring-4 ring-blue-500/10" : "border-white/10 hover:border-white/20"} ${value ? "text-white" : "text-slate-500"}`}
      >
        <span className="truncate">{value ? fmtRu(value) : placeholder}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-400">
          <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      </button>

      {open && (
        <div className={`absolute top-full z-50 mt-2 w-[280px] rounded-2xl border border-white/10 bg-[#0d1424] p-3 shadow-2xl shadow-black/60 ${align === "right" ? "right-0" : "left-0"}`}>
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => shiftMonth(-1)} aria-label="Предыдущий месяц" className="flex h-8 w-8 items-center justify-center rounded-lg text-lg font-black text-slate-300 transition hover:bg-white/10 active:scale-90">‹</button>
            <span className="text-sm font-black text-white">{MONTHS[view.getMonth()]} {view.getFullYear()}</span>
            <button type="button" onClick={() => shiftMonth(1)} aria-label="Следующий месяц" className="flex h-8 w-8 items-center justify-center rounded-lg text-lg font-black text-slate-300 transition hover:bg-white/10 active:scale-90">›</button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-1">
            {WEEK.map((w) => <div key={w} className="text-center text-[11px] font-black uppercase text-slate-500">{w}</div>)}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {grid.map((d, i) => d ? (
              <button
                key={i}
                type="button"
                onClick={() => pick(d)}
                className={`flex h-9 items-center justify-center rounded-lg text-sm font-bold transition active:scale-90 ${
                  sameDay(d, selected)
                    ? "bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-lg shadow-blue-900/40"
                    : sameDay(d, today)
                    ? "border border-blue-400/40 text-blue-200 hover:bg-white/10"
                    : "text-slate-200 hover:bg-white/10"
                }`}
              >
                {d.getDate()}
              </button>
            ) : <div key={i} />)}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-2">
            <button type="button" onClick={() => { onChange?.(""); setOpen(false); }} className="rounded-lg px-2.5 py-1.5 text-xs font-black text-slate-400 transition hover:bg-white/10 hover:text-white">Очистить</button>
            <button type="button" onClick={() => pick(new Date())} className="rounded-lg px-2.5 py-1.5 text-xs font-black text-blue-300 transition hover:bg-white/10">Сегодня</button>
          </div>
        </div>
      )}
    </div>
  );
}
