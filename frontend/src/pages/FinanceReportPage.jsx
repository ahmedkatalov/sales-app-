import { useEffect, useMemo, useRef, useState } from "react";
import { get, put } from "../api";
import { formatMoney, num } from "../utils/format";
import { csvCell, downloadCsv } from "../utils/csv";
import { escHtml, printHtmlDocument } from "../utils/print";
import Modal from "../components/Modal";
import DatePicker from "../components/DatePicker";

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function periodBounds(preset) {
  const now = new Date();
  const mStart = new Date(now.getFullYear(), now.getMonth(), 1);
  if (preset === "this") return { from: iso(mStart), to: iso(now) };
  if (preset === "prev") {
    const pStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const pEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: iso(pStart), to: iso(pEnd) };
  }
  if (preset === "today") return { from: iso(now), to: iso(now) };
  return { from: "", to: "" }; // all
}

// Строка бухгалтерской «выписки».
function Row({ label, value, hint, tone = "", strong = false, indent = false, prefix = "" }) {
  const [open, setOpen] = useState(false);
  const toneCls =
    tone === "plus" ? "text-emerald-300" : tone === "minus" ? "text-red-300" : "text-white";
  return (
    <>
      <div
        className={`flex items-baseline justify-between gap-3 py-2 ${strong ? "border-t border-white/10 pt-3" : ""}`}
      >
        <span className={`${indent ? "pl-4 text-slate-400" : "text-slate-300"} ${strong ? "font-black text-white" : "font-bold"} text-sm`}>
          {label}
          {hint ? (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="ml-1 align-middle text-[11px] text-slate-500 hover:text-slate-300"
            >
              ⓘ
            </button>
          ) : null}
        </span>
        <span className={`shrink-0 tabular-nums ${strong ? "text-lg font-black" : "font-black"} ${toneCls}`}>
          {prefix}{formatMoney(value)}
        </span>
      </div>
      {open && hint ? (
        <p className="pb-2 pl-4 text-xs font-medium leading-snug text-slate-500">{hint}</p>
      ) : null}
    </>
  );
}

function Card({ title, subtitle, children }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur sm:p-5">
      <p className="text-sm font-black text-white">{title}</p>
      {subtitle ? <p className="mb-1 mt-0.5 text-xs font-bold text-slate-500">{subtitle}</p> : null}
      <div className="mt-2 divide-y divide-white/5">{children}</div>
    </div>
  );
}

// KPI-плитка: пояснение раскрывается по тапу на ⓘ (mobile-first, hover не нужен).
function Kpi({ label, value, note, hint, cardClass = "border-white/10 bg-white/[0.05]", labelClass = "text-slate-300/80", valueClass = "text-white" }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`relative rounded-2xl border px-4 py-3 ${cardClass}`}>
      {hint ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label="Пояснение"
          className="absolute right-2 top-2 text-[11px] text-slate-500 hover:text-slate-300"
        >
          ⓘ
        </button>
      ) : null}
      <p className={`text-[11px] font-black uppercase tracking-wide ${labelClass}`}>{label}</p>
      <p className={`mt-1 text-2xl font-black ${valueClass}`}>{value}</p>
      {open && hint ? (
        <p className="mt-1 text-[11px] font-medium leading-snug text-slate-500">{hint}</p>
      ) : note ? (
        <p className="text-[11px] font-bold text-slate-500">{note}</p>
      ) : null}
    </div>
  );
}

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
        ["Продажи налом", cash.inSales], ["Вклады владельца", cash.inOwner], ["Расходы из кассы", cash.outExpenses],
        ["Возвраты владельцу", cash.outReimburse], ["Изъятия прибыли", cash.outWithdraw], ["Чистое движение налом", cash.net, true],
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

  return (
    <div className="relative pb-nav text-white sm:pb-10">
      <div className="pointer-events-none absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-blue-600/20 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-16 h-80 w-80 rounded-full bg-emerald-700/15 blur-3xl" />

      <div className="relative mx-auto w-full max-w-[1200px]">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-xs font-black text-emerald-300">
          <span className="h-2 w-2 rounded-full bg-emerald-400" /> Финансы
        </div>
        <h1 className="text-3xl font-black tracking-tight sm:text-5xl">Финансовый отчёт</h1>
        <p className="mt-2 max-w-2xl text-sm font-medium text-slate-400">
          Откуда пришли деньги, куда ушли, и почему касса не равна прибыли. Нажмите ⓘ рядом со строкой — там пояснение.
        </p>

        {/* Период */}
        <div className="mt-5 space-y-2.5">
          {/* Пресеты — на телефоне горизонтальный скролл, на десктопе перенос */}
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

          {/* Диапазон дат + действия — на телефоне столбиком во всю ширину */}
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <div className="flex flex-1 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-1.5">
              <DatePicker value={custom.from} onChange={(v) => { setCustom((c) => ({ ...c, from: v })); setPreset("custom"); }} placeholder="Дата с" className="min-w-0 flex-1" />
              <span className="shrink-0 text-slate-500">—</span>
              <DatePicker value={custom.to} onChange={(v) => { setCustom((c) => ({ ...c, to: v })); setPreset("custom"); }} placeholder="Дата по" align="right" className="min-w-0 flex-1" />
            </div>
            <div className="flex gap-2 sm:ml-auto sm:shrink-0">
              <button onClick={printReport} disabled={!rep}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-black text-slate-200 transition hover:bg-white/10 disabled:opacity-50 sm:flex-none">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z" /></svg>
                Печать / PDF
              </button>
              <button onClick={exportCSV} disabled={!rep}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-black text-slate-200 transition hover:bg-white/10 disabled:opacity-50 sm:flex-none">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
                Экспорт CSV
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 font-bold text-red-200">{error}</div>
        )}

        {loading && !rep ? (
          <div className="mt-10 text-center font-bold text-slate-400">Загрузка…</div>
        ) : rep ? (
          <>
            {/* KPI */}
            <div className="mt-5 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
              <Kpi
                label="Чистая прибыль"
                value={formatMoney(p.netProfit)}
                note="за период"
                hint="Выручка минус себестоимость минус все расходы за период. Не зависит от того, чем платили."
                cardClass="border-emerald-400/20 bg-emerald-500/[0.08]"
                labelClass="text-emerald-300/80"
                valueClass={p.netProfit < 0 ? "text-red-300" : "text-white"}
              />
              <Kpi
                label="Выручка"
                value={formatMoney(p.revenue)}
                note="за период"
                hint="Все продажи за период (наличные + карта + в долг), уже за вычетом скидок."
                cardClass="border-blue-400/20 bg-blue-500/[0.08]"
                labelClass="text-blue-300/80"
              />
              <Kpi
                label="Остаток кассы"
                value={formatMoney(pos.cashNow)}
                note="расчётный"
                hint="Расчётный остаток наличных: стартовые + приходы налом − расходы налом. Фактический остаток сверяется в смене."
                cardClass="border-white/10 bg-white/[0.05]"
                labelClass="text-slate-300/80"
              />
              <Kpi
                label="Должны владельцу"
                value={formatMoney(pos.owedToOwner)}
                note="всего"
                hint="Сколько бизнес должен вернуть владельцу за его личные вложения (расходы + вклады − возвраты, с учётом стартового)."
                cardClass="border-amber-400/25 bg-amber-500/[0.08]"
                labelClass="text-amber-300/80"
                valueClass="text-amber-100"
              />
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {/* Прибыль (P&L) */}
              <Card title="Прибыль за период" subtitle="Заработал бизнес — независимо от того, чем платили">
                <Row label="Выручка налом" value={p.revenueCash} indent hint="Продажи за наличные." />
                <Row label="Выручка картой" value={p.revenueCard} indent hint="Продажи переводом/картой." />
                <Row label="Выручка в долг" value={p.revenueDebt} indent hint="Продажи в долг — выручка есть, но деньги ещё не получены." />
                <Row label="Итого выручка" value={p.revenue} strong hint="Сумма всех продаж за вычетом скидок." />
                <Row label="Себестоимость" value={p.cogs} tone="minus" prefix="−" hint="Себестоимость проданных товаров (по рецептам/закупке)." />
                <Row label="Валовая прибыль" value={p.grossProfit} strong hint="Выручка минус себестоимость." />
                <Row label="Расходы из кассы" value={p.expenseCash} indent tone="minus" prefix="−" hint="Расходы, оплаченные наличными из кассы." />
                <Row label="Расходы с карты" value={p.expenseCard} indent tone="minus" prefix="−" hint="Расходы, оплаченные картой/переводом." />
                <Row label="Расходы из личных владельца" value={p.expenseOwner} indent tone="minus" prefix="−" hint="Оплачены личными деньгами владельца — прибыль уменьшают, но кассу не трогают." />
                <Row label="Чистая прибыль" value={p.netProfit} strong tone={p.netProfit < 0 ? "minus" : "plus"} hint="Валовая прибыль минус все расходы. Главная цифра заработка." />
              </Card>

              {/* Движение налом */}
              <Card title="Движение наличных за период" subtitle="Почему касса меняется не так, как прибыль">
                <Row label="Продажи налом" value={cash.inSales} tone="plus" prefix="+" hint="Пришло в кассу от продаж за наличные." />
                <Row label="Вклады владельца" value={cash.inOwner} tone="plus" prefix="+" hint="Владелец внёс личные деньги в кассу." />
                <Row label="Расходы из кассы" value={cash.outExpenses} tone="minus" prefix="−" hint="Оплачено наличными из кассы." />
                <Row label="Возвраты владельцу" value={cash.outReimburse} tone="minus" prefix="−" hint="Вернули владельцу из кассы (уменьшает долг перед ним)." />
                <Row label="Изъятия прибыли" value={cash.outWithdraw} tone="minus" prefix="−" hint="Владелец забрал прибыль из кассы." />
                <Row label="Чистое движение налом" value={cash.net} strong tone={cash.net < 0 ? "minus" : "plus"} hint="Насколько выросли/уменьшились наличные за период." />
                <p className="pt-3 text-xs font-bold leading-snug text-slate-500">
                  Карта и продажи в долг сюда не входят — они не меняют наличные. Поэтому касса ≠ прибыль.
                </p>
              </Card>

              {/* Позиция */}
              <Card title="Финансовая позиция" subtitle="Чем владеет и кому должен бизнес (на конец периода)">
                <Row label="Наличные (расчётные)" value={pos.cashNow} tone="plus" prefix="+" hint="Стартовые + все приходы налом − все расходы налом." />
                <Row label="На карте / счёте" value={pos.bank} tone="plus" prefix="+" hint="Безналичный остаток (из стартовых балансов)." />
                <Row label="Склад (по себестоимости)" value={pos.inventory} tone="plus" prefix="+" hint="Стоимость текущих остатков товара." />
                <Row label="Клиенты должны нам" value={pos.receivables} tone="plus" prefix="+" hint="Открытые долги клиентов." />
                <Row label="Должны поставщикам" value={pos.payables} tone="minus" prefix="−" hint="Долги перед поставщиками (из стартовых балансов)." />
                <Row label="Должны владельцу" value={pos.owedToOwner} tone="minus" prefix="−" hint="Долг перед владельцем за его вложения." />
                <Row label="Чистая позиция" value={pos.netPosition} strong tone={pos.netPosition < 0 ? "minus" : "plus"} hint="Активы минус обязательства. Сколько реально стоит бизнес по деньгам." />
              </Card>

              {/* Стартовые балансы */}
              <Card title="Стартовые балансы" subtitle={op.isSet ? (op.asOfDate ? `Точка отсчёта на ${op.asOfDate}` : "Точка отсчёта") : "Не заданы"}>
                {op.isSet ? (
                  <>
                    <Row label="Наличные на старте" value={op.cash} indent />
                    <Row label="На карте на старте" value={op.bank} indent />
                    <Row label="Долг перед владельцем на старте" value={op.owedToOwner} indent />
                    <Row label="Склад на старте" value={op.inventoryValue} indent />
                    <Row label="Клиенты должны (старт)" value={op.customerDebts} indent />
                    <Row label="Поставщикам должны (старт)" value={op.supplierDebts} indent />
                  </>
                ) : (
                  <p className="py-2 text-sm font-bold text-slate-400">
                    Начали вести учёт не с нуля? Задайте остаток кассы, банка, долги и склад на дату старта — тогда позиция и долг перед владельцем будут точными.
                  </p>
                )}
                <button onClick={openOpeningEditor}
                  className="mt-3 w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-black text-white transition hover:bg-white/10">
                  {op.isSet ? "Изменить стартовые балансы" : "Задать стартовые балансы"}
                </button>
              </Card>
            </div>
          </>
        ) : null}
      </div>

      {openingModal && openingForm && (
        <Modal title="Стартовые балансы" wide onClose={() => setOpeningModal(false)}>
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
