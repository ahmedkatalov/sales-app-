import { useEffect, useMemo, useRef, useState } from "react";
import { Info, Printer, Download, User, Wallet } from "lucide-react";
import { get, put } from "../api";
import { formatMoney, num, businessISO } from "../utils/format";
import { csvCell, downloadCsv } from "../utils/csv";
import { escHtml, printHtmlDocument } from "../utils/print";
import Modal from "../components/Modal";
import DatePicker from "../components/DatePicker";

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clampPct = (v) => Math.max(0, Math.min(100, num(v)));
const rub = (v) => `${formatMoney(v)} ₽`;

function periodBounds(preset) {
  const now = new Date();
  const mStart = new Date(now.getFullYear(), now.getMonth(), 1);
  // Верхняя граница «по сегодня» — рабочий день точки (учёт ночной работы).
  if (preset === "this") return { from: iso(mStart), to: businessISO(now) };
  if (preset === "prev") {
    const pStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const pEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: iso(pStart), to: iso(pEnd) };
  }
  if (preset === "today") return { from: businessISO(now), to: businessISO(now) };
  return { from: "", to: "" }; // all
}

// ── презентационные компоненты ───────────────────────────────────────

// Карточка-«стекло».
function Card({ children, className = "" }) {
  return (
    <section className={`rounded-3xl border border-white/10 bg-white/[0.04] p-4 shadow-lg backdrop-blur sm:p-5 ${className}`}>
      {children}
    </section>
  );
}

// Заголовок секции с опциональным ⓘ-пояснением (lucide, раскрытие инлайн под строкой).
function SectionHead({ title, subtitle, hint, accent = "text-white" }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-3">
      <div className="flex items-start gap-2">
        <h3 className={`text-base font-black leading-tight sm:text-lg ${accent}`}>{title}</h3>
        {hint ? (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Пояснение"
            className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-slate-500 transition hover:bg-white/5 hover:text-slate-300">
            <Info size={15} />
          </button>
        ) : null}
      </div>
      {subtitle ? <p className="mt-0.5 text-[12px] font-semibold text-slate-400">{subtitle}</p> : null}
      {open && hint ? (
        <p className="mt-1.5 rounded-xl bg-white/[0.04] px-3 py-2 text-xs font-medium leading-snug text-slate-400">{hint}</p>
      ) : null}
    </div>
  );
}

function MiniMetric({ label, value, tone = "text-white" }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-0.5 truncate text-sm font-black tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

function KpiTile({ label, value, sub, tone = "slate" }) {
  const tones = {
    emerald: "border-emerald-400/25 bg-emerald-500/[0.07]",
    blue: "border-blue-400/25 bg-blue-500/[0.07]",
    amber: "border-amber-400/25 bg-amber-500/[0.07]",
    red: "border-red-400/25 bg-red-500/[0.07]",
    slate: "border-white/10 bg-white/[0.05]",
  };
  const labelTone = {
    emerald: "text-emerald-300/80", blue: "text-blue-300/80", amber: "text-amber-300/80",
    red: "text-red-300/80", slate: "text-slate-300/80",
  };
  return (
    <div className={`min-w-0 rounded-2xl border px-4 py-3 ${tones[tone]}`}>
      <p className={`text-[10px] font-black uppercase tracking-wide sm:text-[11px] ${labelTone[tone]}`}>{label}</p>
      <p className="mt-1 truncate text-xl font-black tabular-nums text-white sm:text-2xl">{value}</p>
      {sub ? <p className="truncate text-[11px] font-bold text-slate-500">{sub}</p> : null}
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-white/12 bg-white/[0.02] px-6 py-10 text-center">
      <p className="text-sm font-bold text-slate-400">{text}</p>
    </div>
  );
}

// Двойное кольцо маржи (внешнее — валовая, внутреннее — чистая). Чистый SVG.
function MarginRing({ grossPct, netPct, size = 132 }) {
  const g = clampPct(grossPct), n = clampPct(netPct);
  const RO = 52, RI = 36, CO = 2 * Math.PI * RO, CI = 2 * Math.PI * RI;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" width={size} height={size} className="-rotate-90">
        <circle cx="60" cy="60" r={RO} fill="none" stroke="currentColor" strokeWidth="12" className="text-white/10" />
        <circle cx="60" cy="60" r={RO} fill="none" stroke="#60a5fa" strokeWidth="12" strokeLinecap="round"
          strokeDasharray={CO} strokeDashoffset={CO * (1 - g / 100)} className="transition-[stroke-dashoffset] duration-700" />
        <circle cx="60" cy="60" r={RI} fill="none" stroke="currentColor" strokeWidth="10" className="text-white/10" />
        <circle cx="60" cy="60" r={RI} fill="none" stroke="#34d399" strokeWidth="10" strokeLinecap="round"
          strokeDasharray={CI} strokeDashoffset={CI * (1 - n / 100)} className="transition-[stroke-dashoffset] duration-700" />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className={`text-2xl font-black tabular-nums ${netPct < 0 ? "text-red-300" : "text-white"}`}>{Math.round(num(netPct))}%</p>
          <p className="text-[9px] font-black uppercase tracking-wide text-slate-500">чистая маржа</p>
        </div>
      </div>
    </div>
  );
}

// Водопад P&L: выручка → −себестоимость → валовая → −расходы → чистая.
// Абсолютное позиционирование от общей нулевой линии — корректно и для убытка.
function Waterfall({ revenue, cogs, grossProfit, expenses, netProfit }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 40);
    return () => clearTimeout(t);
  }, []);
  if (!(num(revenue) > 0)) return <EmptyState text="За период нет продаж" />;

  const H = 200;
  const base = Math.max(num(revenue), 1);
  const unit = H / base;
  const px = (v) => Math.round(num(v) * unit);
  const minVal = Math.min(0, num(netProfit), num(grossProfit));
  const belowH = px(-minVal); // запас под нулевой линией для убытка
  const level = (v) => belowH + px(v); // пикселей от низа контейнера до уровня значения
  const total = H + belowH;

  // колонка: {верхний уровень, нижний уровень, цвет, скругление}
  const cols = [
    { key: "rev", label: "Выручка", value: num(revenue), lo: 0, hi: num(revenue),
      color: "bg-gradient-to-t from-blue-600 to-violet-500", round: "rounded-t-lg" },
    { key: "cogs", label: "Себест.", value: num(cogs), sign: "−", lo: num(grossProfit), hi: num(revenue),
      color: "bg-red-500/80", round: "rounded-t-sm" },
    { key: "gross", label: "Валовая", value: num(grossProfit), lo: 0, hi: num(grossProfit),
      color: "bg-emerald-600/55", round: "rounded-t-lg" },
    { key: "exp", label: "Расходы", value: num(expenses), sign: "−", lo: num(netProfit), hi: num(grossProfit),
      color: "bg-red-500/80", round: "rounded-t-sm" },
    { key: "net", label: "Чистая", value: num(netProfit), lo: Math.min(0, num(netProfit)), hi: Math.max(0, num(netProfit)),
      color: num(netProfit) < 0 ? "bg-red-500" : "bg-gradient-to-t from-emerald-600 to-emerald-400",
      round: num(netProfit) < 0 ? "rounded-b-lg" : "rounded-t-lg",
      glow: num(netProfit) >= 0 },
  ];

  return (
    <div>
      <div className="relative flex items-end gap-2 sm:gap-3" style={{ height: total }}>
        {/* нулевая линия */}
        <div className="pointer-events-none absolute inset-x-0 border-t border-white/15" style={{ bottom: belowH }} />
        {/* коннекторы (desktop) */}
        <div className="pointer-events-none absolute hidden border-t border-dashed border-white/20 sm:block"
          style={{ bottom: level(num(revenue)), left: "10%", width: "30%" }} />
        <div className="pointer-events-none absolute hidden border-t border-dashed border-white/20 sm:block"
          style={{ bottom: level(num(grossProfit)), left: "50%", width: "30%" }} />

        {cols.map((c) => {
          const barH = Math.max(2, px(c.hi - c.lo));
          const barBottom = level(c.lo);
          const valueTop = barBottom + barH;
          const belowBaseline = c.hi <= 0 && c.lo < 0;
          return (
            <div key={c.key} className="relative h-full flex-1 min-w-0">
              <div
                className={`absolute inset-x-0 ${c.color} ${c.round} ${c.glow ? "shadow-[0_0_24px_-4px] shadow-emerald-500/50" : ""} transition-[height,bottom] duration-700 ease-out`}
                style={{ bottom: mounted ? barBottom : belowH, height: mounted ? barH : 0 }}
              />
              <span
                className={`absolute inset-x-0 text-center text-[11px] font-black tabular-nums sm:text-sm ${c.sign === "−" ? "text-red-300" : c.value < 0 ? "text-red-300" : "text-white"}`}
                style={belowBaseline ? { bottom: Math.max(0, barBottom - 18) } : { bottom: Math.min(total - 14, valueTop + 3) }}
              >
                {c.sign || (c.value < 0 ? "−" : "")}{formatMoney(Math.abs(c.value))}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-2 sm:gap-3">
        {cols.map((c) => (
          <p key={c.key} className="flex-1 text-center text-[10px] font-black uppercase leading-tight tracking-wide text-slate-400">{c.label}</p>
        ))}
      </div>
    </div>
  );
}

// Горизонтальная сегментная полоса (микс выручки / расходов).
function SplitBar({ segments, caption }) {
  const total = segments.reduce((s, x) => s + Math.max(0, num(x.value)), 0) || 1;
  return (
    <div>
      <div className="flex h-5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        {segments.map((s, i) => {
          const pct = (Math.max(0, num(s.value)) / total) * 100;
          if (pct <= 0) return null;
          return (
            <div key={i} className="h-full" title={`${s.label}: ${rub(s.value)}`}
              style={{
                width: `${pct}%`, minWidth: 4, background: s.color,
                ...(s.dim ? { opacity: 0.5, backgroundImage: "repeating-linear-gradient(45deg, transparent 0 4px, rgba(255,255,255,0.16) 4px 8px)" } : {}),
              }} />
          );
        })}
      </div>
      <div className="mt-2.5 flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:gap-x-4">
        {segments.map((s, i) => {
          const pct = Math.round((Math.max(0, num(s.value)) / total) * 100);
          return (
            <span key={i} className="flex items-center gap-1.5 text-[11px] font-bold text-slate-300">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
              <span>{s.label}</span>
              <b className="whitespace-nowrap tabular-nums text-white">{formatMoney(s.value)}</b>
              <span className="whitespace-nowrap text-slate-500">{pct}%</span>
              {s.tag ? <span className="whitespace-nowrap rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-black text-amber-300">{s.tag}</span> : null}
            </span>
          );
        })}
      </div>
      {caption ? <p className="mt-2.5 text-xs font-semibold leading-snug text-slate-400">{caption}</p> : null}
    </div>
  );
}

// Якорь моста (прибыль / движение налом).
function BridgeAnchor({ label, value, tone }) {
  const cls = tone === "red"
    ? "border-red-400/30 from-red-600/25 to-red-500/5 text-red-200"
    : "border-emerald-400/30 from-emerald-600/25 to-emerald-500/5 text-emerald-100";
  return (
    <div className={`flex items-center justify-between gap-3 rounded-2xl border bg-gradient-to-r px-4 py-3 ${cls}`}>
      <span className="text-sm font-black">{label}</span>
      <span className="text-xl font-black tabular-nums">{formatMoney(value)}</span>
    </div>
  );
}

function BridgeRow({ label, reason, value, sign, tone, owner, widthPct }) {
  const barCol = tone === "red" ? "bg-red-500/70" : tone === "amber" ? "bg-amber-500/70" : tone === "emerald" ? "bg-emerald-500/70" : "bg-slate-400/50";
  const txtCol = tone === "red" ? "text-red-300" : tone === "amber" ? "text-amber-300" : tone === "emerald" ? "text-emerald-300" : "text-slate-300";
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[13px] font-bold text-slate-200">
          {owner ? <User size={12} className="shrink-0 text-amber-400" /> : null}
          <span className="truncate">{label}</span>
        </p>
        {reason ? <p className="text-[11px] font-medium leading-tight text-slate-500">{reason}</p> : null}
      </div>
      <div className="hidden w-16 shrink-0 sm:block lg:w-24">
        <div className={`h-2 rounded-full ${barCol}`} style={{ width: `${widthPct}%` }} />
      </div>
      <span className={`w-24 shrink-0 text-right text-sm font-black tabular-nums ${txtCol}`}>{sign}{formatMoney(value)}</span>
    </div>
  );
}

function CashBridge({ netProfit, rows, net }) {
  const shown = rows.filter((r) => Math.abs(num(r.value)) > 0);
  const maxAbs = Math.max(1, ...shown.map((r) => Math.abs(num(r.value))));
  return (
    <div className="space-y-2">
      <BridgeAnchor label="Чистая прибыль" value={netProfit} tone={num(netProfit) < 0 ? "red" : "emerald"} />
      <div className="space-y-0.5 border-l-2 border-dashed border-white/15 pl-3">
        {shown.map((r, i) => (
          <BridgeRow key={i} {...r} widthPct={Math.max(8, (Math.abs(num(r.value)) / maxAbs) * 100)} />
        ))}
      </div>
      <BridgeAnchor label="Чистое движение налом" value={net} tone={num(net) < 0 ? "red" : "emerald"} />
    </div>
  );
}

// Балансовые полосы: активы vs обязательства, нормированные к большей стороне.
function BalanceSide({ title, titleTone, total, items, scale }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[11px] font-black uppercase tracking-wide">
        <span className={titleTone}>{title}</span>
        <span className="tabular-nums text-white">{formatMoney(total)}</span>
      </div>
      <div style={{ width: `${(total / scale) * 100}%`, minWidth: total > 0 ? "6%" : 0 }}>
        <div className="flex h-5 w-full overflow-hidden rounded-full bg-white/[0.06]">
          {items.map((it, i) => {
            const pct = (Math.max(0, num(it.value)) / Math.max(1, total)) * 100;
            if (pct <= 0) return null;
            return <div key={i} className="h-full" title={`${it.label}: ${rub(it.value)}`} style={{ width: `${pct}%`, minWidth: 4, background: it.color }} />;
          })}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1">
        {items.filter((it) => num(it.value) > 0).map((it, i) => (
          <span key={i} className="flex items-center gap-1.5 text-[11px] font-bold text-slate-300">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: it.color }} />
            {it.owner ? <User size={11} className="-ml-0.5 text-amber-400" /> : null}
            {it.label}
            <b className="tabular-nums text-white">{formatMoney(it.value)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function PositionBars({ assets, liabilities, net }) {
  const aTot = assets.reduce((s, x) => s + Math.max(0, num(x.value)), 0);
  const lTot = liabilities.reduce((s, x) => s + Math.max(0, num(x.value)), 0);
  const scale = Math.max(aTot, lTot, 1);
  return (
    <div className="space-y-4">
      <BalanceSide title="Активы" titleTone="text-emerald-300" total={aTot} items={assets} scale={scale} />
      <BalanceSide title="Обязательства" titleTone="text-red-300" total={lTot} items={liabilities} scale={scale} />
      <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-3">
        <span className="text-sm font-black text-white">
          Чистая позиция <span className="font-bold text-slate-500">активы − обязательства</span>
        </span>
        <span className={`shrink-0 text-2xl font-black tabular-nums ${net < 0 ? "text-red-300" : "text-emerald-300"}`}>{formatMoney(net)}</span>
      </div>
    </div>
  );
}

// ── страница ─────────────────────────────────────────────────────────
export default function FinanceReportPage() {
  const [preset, setPreset] = useState("this");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [rep, setRep] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reqRef = useRef(0);
  const [openingModal, setOpeningModal] = useState(false);
  const [openingForm, setOpeningForm] = useState(null);
  const [savingOpening, setSavingOpening] = useState(false);

  const range = useMemo(() => {
    if (preset === "custom") return custom;
    return periodBounds(preset);
  }, [preset, custom]);

  const load = async () => {
    const seq = ++reqRef.current;
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams();
      if (range.from) qs.set("from", range.from);
      if (range.to) qs.set("to", range.to);
      const data = await get(`/finance/report?${qs.toString()}`);
      if (seq !== reqRef.current) return;
      setRep(data);
    } catch (e) {
      if (seq !== reqRef.current) return;
      setError(e?.message || "Не удалось загрузить отчёт");
    } finally {
      if (seq === reqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to]);

  const openOpeningEditor = async () => {
    const cur = await get("/finance/opening").catch(() => null);
    setOpeningForm({
      asOfDate: cur?.asOfDate || "",
      cash: cur?.cash || "",
      bank: cur?.bank || "",
      owedToOwner: cur?.owedToOwner || "",
      inventoryValue: cur?.inventoryValue || "",
      customerDebts: cur?.customerDebts || "",
      supplierDebts: cur?.supplierDebts || "",
      note: cur?.note || "",
    });
    setOpeningModal(true);
  };

  const saveOpening = async () => {
    if (!openingForm || savingOpening) return;
    setSavingOpening(true);
    try {
      await put("/finance/opening", {
        asOfDate: openingForm.asOfDate,
        cash: num(openingForm.cash),
        bank: num(openingForm.bank),
        owedToOwner: num(openingForm.owedToOwner),
        inventoryValue: num(openingForm.inventoryValue),
        customerDebts: num(openingForm.customerDebts),
        supplierDebts: num(openingForm.supplierDebts),
        note: openingForm.note,
      });
      setOpeningModal(false);
      await load();
      window.notify?.("Стартовые балансы сохранены", "success");
    } catch (e) {
      window.notify?.(e?.message || "Не удалось сохранить", "error");
    } finally {
      setSavingOpening(false);
    }
  };

  // Онбординг: при переходе с ?setup=1 сразу открываем мастер стартовых балансов.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("setup") === "1") {
      openOpeningEditor();
    }
  }, []);

  const p = rep?.pnl || {};
  const cash = rep?.cash || {};
  const pos = rep?.position || {};
  const op = rep?.opening || {};

  const grossMargin = num(p.revenue) > 0 ? (num(p.grossProfit) / num(p.revenue)) * 100 : 0;
  const netMargin = num(p.revenue) > 0 ? (num(p.netProfit) / num(p.revenue)) * 100 : 0;
  const hasData = num(p.revenue) > 0 || num(pos.netPosition) !== 0 || op.isSet;

  const bridgeRows = [
    { label: "Выручка картой", reason: "заработали, но деньги на карте — не в кассе", value: p.revenueCard, sign: "−", tone: "red" },
    { label: "Выручка в долг", reason: "продали в долг — деньги ещё не получены", value: p.revenueDebt, sign: "−", tone: "red" },
    { label: "Себестоимость", reason: "товар списан со склада — это не отток наличных", value: p.cogs, sign: "+", tone: "slate" },
    { label: "Расходы с карты", reason: "оплачено картой — кассу не трогали", value: p.expenseCard, sign: "+", tone: "slate" },
    { label: "Расходы из личных владельца", reason: "оплатил владелец лично — прибыль меньше, касса цела", value: p.expenseOwner, sign: "+", tone: "amber", owner: true },
    { label: "Погашения долгов налом", reason: "клиент вернул долг наличными — деньги пришли, прибыль была раньше", value: cash.inDebt, sign: "+", tone: "emerald" },
    { label: "Вклады владельца", reason: "владелец внёс наличные в кассу", value: cash.inOwner, sign: "+", tone: "amber", owner: true },
    { label: "Возвраты владельцу", reason: "вернули владельцу из кассы", value: cash.outReimburse, sign: "−", tone: "amber", owner: true },
    { label: "Изъятия прибыли", reason: "владелец забрал прибыль из кассы", value: cash.outWithdraw, sign: "−", tone: "amber", owner: true },
  ];

  const exportCSV = () => {
    if (!rep) return;
    const m = (v) => String(num(v)).replace(".", ","); // десятичная запятая для Excel-RU
    const rows = [
      ["Раздел", "Показатель", "Значение"],
      ["Период", "с", range.from || "начало"],
      ["Период", "по", range.to || "сегодня"],
      ["Прибыль", "Выручка налом", m(p.revenueCash)],
      ["Прибыль", "Выручка картой", m(p.revenueCard)],
      ["Прибыль", "Выручка в долг", m(p.revenueDebt)],
      ["Прибыль", "Итого выручка", m(p.revenue)],
      ["Прибыль", "Себестоимость", m(p.cogs)],
      ["Прибыль", "Валовая прибыль", m(p.grossProfit)],
      ["Прибыль", "Расходы из кассы", m(p.expenseCash)],
      ["Прибыль", "Расходы с карты", m(p.expenseCard)],
      ["Прибыль", "Расходы из личных владельца", m(p.expenseOwner)],
      ["Прибыль", "Итого расходы", m(p.expenses)],
      ["Прибыль", "Чистая прибыль", m(p.netProfit)],
      ["Наличные", "Продажи налом", m(cash.inSales)],
      ["Наличные", "Вклады владельца", m(cash.inOwner)],
      ["Наличные", "Погашения долгов налом", m(cash.inDebt)],
      ["Наличные", "Расходы из кассы", m(cash.outExpenses)],
      ["Наличные", "Возвраты владельцу", m(cash.outReimburse)],
      ["Наличные", "Изъятия прибыли", m(cash.outWithdraw)],
      ["Наличные", "Чистое движение налом", m(cash.net)],
      ["Позиция", "Наличные (расчётные)", m(pos.cashNow)],
      ["Позиция", "На карте / счёте", m(pos.bank)],
      ["Позиция", "Склад по себестоимости", m(pos.inventory)],
      ["Позиция", "Клиенты должны нам", m(pos.receivables)],
      ["Позиция", "Должны поставщикам", m(pos.payables)],
      ["Позиция", "Должны владельцу", m(pos.owedToOwner)],
      ["Позиция", "Чистая позиция", m(pos.netPosition)],
    ];
    downloadCsv(`finance_${range.from || "all"}_${range.to || "all"}.csv`, rows.map((r) => r.map(csvCell)));
    window.notify?.("Отчёт выгружен в CSV", "success");
  };

  // Печать / PDF: собираем чистый светлый документ в новом окне (не воюем с тёмной темой).
  const printReport = () => {
    if (!rep) return;
    const esc = escHtml;
    const section = (title, items) =>
      `<h2>${esc(title)}</h2><table>` +
      items.map(([l, v, strong]) => `<tr class="${strong ? "t" : ""}"><td>${esc(l)}</td><td class="n">${esc(formatMoney(v))}</td></tr>`).join("") +
      `</table>`;
    const html =
      `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Финансовый отчёт</title><style>` +
      `body{font-family:system-ui,-apple-system,Arial,sans-serif;color:#111;max-width:760px;margin:24px auto;padding:0 20px}` +
      `h1{font-size:24px;margin:0 0 2px}.period{color:#666;margin:0 0 20px;font-size:14px}` +
      `h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#555;margin:22px 0 6px;border-bottom:2px solid #eee;padding-bottom:5px}` +
      `table{width:100%;border-collapse:collapse}td{padding:6px 0;border-bottom:1px solid #f1f1f1;font-size:14px}` +
      `td.n{text-align:right;font-weight:700;white-space:nowrap}tr.t td{border-top:2px solid #ddd;border-bottom:none;font-weight:800;font-size:15px;padding-top:8px}` +
      `.foot{margin-top:28px;color:#aaa;font-size:11px}@media print{body{margin:8mm auto}}` +
      `</style></head><body>` +
      `<h1>Финансовый отчёт</h1>` +
      `<p class="period">Период: ${esc(range.from || "начало")} — ${esc(range.to || "сегодня")}</p>` +
      section("Прибыль за период", [
        ["Выручка налом", p.revenueCash], ["Выручка картой", p.revenueCard], ["Выручка в долг", p.revenueDebt],
        ["Итого выручка", p.revenue, true], ["Себестоимость", p.cogs], ["Валовая прибыль", p.grossProfit, true],
        ["Расходы из кассы", p.expenseCash], ["Расходы с карты", p.expenseCard], ["Расходы из личных владельца", p.expenseOwner],
        ["Итого расходы", p.expenses, true], ["Чистая прибыль", p.netProfit, true],
      ]) +
      section("Движение наличных за период", [
        ["Продажи налом", cash.inSales], ["Вклады владельца", cash.inOwner], ["Погашения долгов налом", cash.inDebt],
        ["Расходы из кассы", cash.outExpenses], ["Возвраты владельцу", cash.outReimburse], ["Изъятия прибыли", cash.outWithdraw],
        ["Чистое движение налом", cash.net, true],
      ]) +
      section("Финансовая позиция", [
        ["Наличные (расчётные)", pos.cashNow], ["На карте / счёте", pos.bank], ["Склад по себестоимости", pos.inventory],
        ["Клиенты должны нам", pos.receivables], ["Должны поставщикам", pos.payables], ["Должны владельцу", pos.owedToOwner],
        ["Чистая позиция", pos.netPosition, true],
      ]) +
      `<p class="foot">Сформировано в Okvion Sales</p></body></html>`;
    printHtmlDocument(html);
  };

  const PRESETS = [
    ["this", "Этот месяц"],
    ["prev", "Прошлый месяц"],
    ["today", "Сегодня"],
    ["all", "Всё время"],
  ];

  const assets = [
    { label: "Наличные", value: pos.cashNow, color: "#34d399" },
    { label: "Банк", value: pos.bank, color: "#2dd4bf" },
    { label: "Склад", value: pos.inventory, color: "#38bdf8" },
    { label: "Клиенты должны", value: pos.receivables, color: "#818cf8" },
  ];
  const liabilities = [
    { label: "Поставщики", value: pos.payables, color: "#f87171" },
    { label: "Должны владельцу", value: pos.owedToOwner, color: "#f59e0b", owner: true },
  ];

  return (
    <div className="relative pb-nav text-white sm:pb-10">
      <div className="pointer-events-none absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-emerald-600/15 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-16 h-80 w-80 rounded-full bg-blue-700/15 blur-3xl" />

      <div className="relative mx-auto w-full max-w-[1200px]">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-xs font-black text-emerald-300">
          <span className="h-2 w-2 rounded-full bg-emerald-400" /> Финансы
        </div>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Финансовый отчёт</h1>
        <p className="mt-2 max-w-2xl text-sm font-medium text-slate-400">
          История ваших денег за период: сколько заработали, сколько осело в кассе и сколько стоит бизнес.
        </p>

        {/* Период */}
        <div className="mt-5 space-y-2.5">
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0" style={{ scrollbarWidth: "none" }}>
            {PRESETS.map(([key, label]) => (
              <button key={key} onClick={() => setPreset(key)}
                className={`shrink-0 rounded-2xl px-4 py-2.5 text-sm font-black transition ${
                  preset === key ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-lg" : "border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/10"
                }`}>
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <div className="flex flex-1 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-1.5">
              <DatePicker value={custom.from} onChange={(v) => { setCustom((c) => ({ ...c, from: v })); setPreset("custom"); }} placeholder="Дата с" className="min-w-0 flex-1" />
              <span className="shrink-0 text-slate-500">—</span>
              <DatePicker value={custom.to} onChange={(v) => { setCustom((c) => ({ ...c, to: v })); setPreset("custom"); }} placeholder="Дата по" align="right" className="min-w-0 flex-1" />
            </div>
            <div className="flex gap-2 sm:ml-auto sm:shrink-0">
              <button onClick={printReport} disabled={!rep}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-black text-slate-200 transition hover:bg-white/10 disabled:opacity-50 sm:flex-none">
                <Printer size={15} /> Печать / PDF
              </button>
              <button onClick={exportCSV} disabled={!rep}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-black text-slate-200 transition hover:bg-white/10 disabled:opacity-50 sm:flex-none">
                <Download size={15} /> Экспорт CSV
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 font-bold text-red-200">{error}</div>
        )}

        {loading && !rep ? (
          <div className="mt-5 space-y-4">
            <div className="h-40 animate-pulse rounded-[2rem] bg-white/[0.05]" />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-white/[0.05]" />)}</div>
            <div className="h-72 animate-pulse rounded-3xl bg-white/[0.05]" />
          </div>
        ) : !hasData && rep ? (
          <div className="mt-6">
            <EmptyState text="За выбранный период нет данных. Выберите другой период или проведите первую продажу в кассе." />
          </div>
        ) : rep ? (
          <div className="mt-5 space-y-4">
            {/* АКТ 1 — Герой: сколько заработали */}
            <section className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-[0_24px_90px_rgba(0,0,0,0.25)] backdrop-blur-xl sm:p-7">
              <div className="pointer-events-none absolute -left-10 top-0 h-40 w-40 rounded-full bg-emerald-500/15 blur-3xl" />
              <div className="pointer-events-none absolute right-0 top-0 h-40 w-40 rounded-full bg-blue-600/15 blur-3xl" />
              <div className="relative flex flex-col items-center gap-6 sm:flex-row sm:justify-between">
                <div className="min-w-0 text-center sm:text-left">
                  <p className="text-[11px] font-black uppercase tracking-wide text-emerald-300/80">Чистая прибыль за период</p>
                  <p className={`mt-1 break-words text-4xl font-black leading-none tabular-nums sm:text-5xl ${num(p.netProfit) < 0 ? "text-red-300" : "text-white"}`}>
                    {formatMoney(p.netProfit)}
                  </p>
                  <p className="mt-2.5 text-sm font-bold text-slate-400">из выручки <b className="text-white">{rub(p.revenue)}</b></p>
                  <div className="mt-4 flex items-center justify-center gap-5 sm:justify-start sm:gap-6">
                    <MiniMetric label="Валовая маржа" value={`${Math.round(grossMargin)}%`} tone="text-blue-300" />
                    <MiniMetric label="Чистая маржа" value={`${Math.round(netMargin)}%`} tone={netMargin < 0 ? "text-red-300" : "text-emerald-300"} />
                    <div className="hidden sm:block"><MiniMetric label="Себестоимость" value={rub(p.cogs)} tone="text-slate-300" /></div>
                  </div>
                </div>
                <MarginRing grossPct={grossMargin} netPct={netMargin} />
              </div>
            </section>

            {/* Быстрые итоги */}
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
              <KpiTile label="Выручка" value={formatMoney(p.revenue)} sub="за период" tone="blue" />
              <KpiTile label="Остаток кассы" value={formatMoney(pos.cashNow)} sub="расчётный" tone="slate" />
              <KpiTile label="Должны владельцу" value={formatMoney(pos.owedToOwner)} sub="всего" tone="amber" />
              <KpiTile label="Чистая позиция" value={formatMoney(pos.netPosition)} sub="активы − долги" tone={num(pos.netPosition) < 0 ? "red" : "emerald"} />
            </div>

            {/* АКТ 2 — Водопад P&L */}
            <Card>
              <SectionHead title="Как сложилась прибыль" subtitle="Выручка минус себестоимость минус расходы"
                hint="Выручка — все продажи за вычетом скидок. Из неё вычитается себестоимость проданного (валовая прибыль), затем все расходы периода — остаётся чистая прибыль. Источник оплаты здесь не важен." />
              <Waterfall revenue={p.revenue} cogs={p.cogs} grossProfit={p.grossProfit} expenses={p.expenses} netProfit={p.netProfit} />
            </Card>

            {/* АКТ 3 — Касса ≠ прибыль */}
            <Card className="border-amber-400/15">
              <SectionHead title="Почему касса ≠ прибыль" accent="text-amber-200" subtitle="Прибыль есть, а деньги в кассе — не всегда"
                hint="Прибыль считает всю выручку (нал + карта + долг). В кассу же попадает только наличная часть. Карта и долг приносят прибыль, но не наличные. А деньги владельца (личные траты, вклады, возвраты, изъятия) двигают кассу, но это не прибыль бизнеса." />

              <SplitBar
                segments={[
                  { label: "Наличные", value: p.revenueCash, color: "#34d399" },
                  { label: "Карта", value: p.revenueCard, color: "#60a5fa", dim: true, tag: "в кассу не попало" },
                  { label: "В долг", value: p.revenueDebt, color: "#f59e0b", dim: true, tag: "в кассу не попало" },
                ]}
                caption={`До кассы дошла только наличная часть — ${rub(p.revenueCash)} из ${rub(p.revenue)}.`}
              />

              <div className="mt-5">
                <CashBridge netProfit={p.netProfit} rows={bridgeRows} net={cash.net} />
              </div>

              {/* Честная сверка остатка — без ложного равенства для подпериодов */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <span className="flex items-center gap-2 text-sm font-bold text-slate-300"><Wallet size={16} className="text-slate-400" /> Текущий остаток кассы (расчётный)</span>
                <div className="text-right">
                  <p className="text-lg font-black tabular-nums text-white">{formatMoney(pos.cashNow)}</p>
                  <p className="text-[11px] font-semibold text-slate-500">с учётом стартового остатка и прошлых периодов</p>
                </div>
              </div>
            </Card>

            {/* АКТ 4 — Позиция + структура расходов */}
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <SectionHead title="Чем владеем и кому должны" subtitle="Финансовая позиция на конец периода"
                  hint="Активы — наличные, безнал, склад по себестоимости и долги клиентов нам. Обязательства — долги поставщикам и владельцу за его вложения. Разница — чистая позиция, реальная стоимость бизнеса в деньгах." />
                <PositionBars assets={assets} liabilities={liabilities} net={pos.netPosition} />

                {/* Деньги владельца за период */}
                {(num(p.expenseOwner) || num(cash.inOwner) || num(cash.outReimburse) || num(cash.outWithdraw)) ? (
                  <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/[0.05] p-3.5">
                    <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide text-amber-300"><User size={13} /> Деньги владельца за период</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {[
                        ["+ оплатил лично", p.expenseOwner],
                        ["+ внёс в кассу", cash.inOwner],
                        ["− вернули", cash.outReimburse],
                        ["− изъял", cash.outWithdraw],
                      ].filter(([, v]) => num(v) > 0).map(([l, v], i) => (
                        <span key={i} className="rounded-lg bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold text-amber-200">
                          {l} <b className="tabular-nums text-white">{formatMoney(v)}</b>
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 text-[11px] font-semibold leading-snug text-amber-200/70">Итог долга перед владельцем — {rub(pos.owedToOwner)} (с учётом стартового).</p>
                  </div>
                ) : null}
              </Card>

              <Card>
                <SectionHead title="Структура расходов" subtitle="Чем оплачивали расходы периода"
                  hint="Расходы из кассы уменьшают наличные. Расходы с карты платятся безналом. Расходы из личных денег владельца уменьшают прибыль, но кассу не трогают — и увеличивают долг перед владельцем." />
                {num(p.expenses) > 0 ? (
                  <SplitBar
                    segments={[
                      { label: "Из кассы", value: p.expenseCash, color: "#f87171" },
                      { label: "С карты", value: p.expenseCard, color: "#fb923c" },
                      { label: "Личные владельца", value: p.expenseOwner, color: "#f59e0b", tag: "кассу не трогают" },
                    ]}
                  />
                ) : (
                  <EmptyState text="Расходов за период нет" />
                )}
                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/10 pt-4">
                  <MiniMetric label="Итого расходы" value={rub(p.expenses)} tone="text-red-300" />
                  <MiniMetric label="Доля в выручке" value={`${num(p.revenue) > 0 ? Math.round((num(p.expenses) / num(p.revenue)) * 100) : 0}%`} tone="text-slate-300" />
                  <MiniMetric label="Себестоимость" value={rub(p.cogs)} tone="text-slate-300" />
                  <MiniMetric label="Валовая прибыль" value={rub(p.grossProfit)} tone="text-emerald-300" />
                </div>
              </Card>
            </div>

            {/* АКТ 5 — Стартовые балансы (тихий футер) */}
            <Card>
              <SectionHead title="Стартовые балансы" subtitle={op.isSet ? (op.asOfDate ? `Точка отсчёта на ${op.asOfDate}` : "Точка отсчёта задана") : "Не заданы"}
                hint="Состояние бизнеса на дату, с которой вы начали вести учёт в приложении. Это точка отсчёта, а не операции — тогда позиция и долг перед владельцем считаются точно." />
              {op.isSet ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <MiniMetric label="Наличные" value={rub(op.cash)} />
                  <MiniMetric label="На карте / счёте" value={rub(op.bank)} />
                  <MiniMetric label="Долг владельцу" value={rub(op.owedToOwner)} tone="text-amber-300" />
                  <MiniMetric label="Склад" value={rub(op.inventoryValue)} />
                  <MiniMetric label="Клиенты должны" value={rub(op.customerDebts)} />
                  <MiniMetric label="Должны поставщикам" value={rub(op.supplierDebts)} tone="text-red-300" />
                </div>
              ) : (
                <p className="text-sm font-bold text-slate-400">
                  Начали вести учёт не с нуля? Задайте остаток кассы, банка, долги и склад на дату старта — тогда позиция и долг перед владельцем будут точными.
                </p>
              )}
              <button onClick={openOpeningEditor}
                className="mt-4 w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-black text-white transition hover:bg-white/10 sm:w-auto sm:px-6">
                {op.isSet ? "Изменить стартовые балансы" : "Задать стартовые балансы"}
              </button>
            </Card>
          </div>
        ) : null}
      </div>

      {openingModal && openingForm && (
        <Modal title="Стартовые балансы" wide legacyLight={false} onClose={() => setOpeningModal(false)}>
          <div className="grid gap-3">
            <p className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-bold leading-snug text-slate-300">
              Введите состояние бизнеса на дату, с которой начинаете вести учёт в приложении. Это точка отсчёта, а не транзакции — в отчёте они не появятся как операции.
            </p>
            <label className="block">
              <span className="mb-1.5 block text-xs font-black text-slate-400">Дата старта</span>
              <DatePicker value={openingForm.asOfDate} onChange={(v) => setOpeningForm((f) => ({ ...f, asOfDate: v }))} placeholder="Выберите дату" />
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                ["cash", "Наличные в кассе"],
                ["bank", "На карте / счёте"],
                ["owedToOwner", "Долг перед владельцем"],
                ["inventoryValue", "Стоимость склада"],
                ["customerDebts", "Клиенты должны нам"],
                ["supplierDebts", "Мы должны поставщикам"],
              ].map(([key, label]) => (
                <label key={key}>
                  <span className="mb-1.5 block text-xs font-black text-slate-400">{label}</span>
                  <input type="number" inputMode="decimal" value={openingForm[key]} onChange={(e) => setOpeningForm((f) => ({ ...f, [key]: e.target.value }))} placeholder="0"
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-600 focus:border-blue-400/70" />
                </label>
              ))}
            </div>
            <label>
              <span className="mb-1.5 block text-xs font-black text-slate-400">Примечание</span>
              <input value={openingForm.note} onChange={(e) => setOpeningForm((f) => ({ ...f, note: e.target.value }))} placeholder="Необязательно"
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-600 focus:border-blue-400/70" />
            </label>
            <div className="mt-1 flex gap-3">
              <button onClick={() => setOpeningModal(false)} className="btn-white flex-1">Отмена</button>
              <button onClick={saveOpening} disabled={savingOpening}
                className="flex-1 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-3 font-black text-white disabled:cursor-not-allowed disabled:opacity-60">
                {savingOpening ? "Сохраняю…" : "Сохранить"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
