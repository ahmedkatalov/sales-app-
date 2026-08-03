import { useEffect, useMemo, useRef, useState } from "react";
import { get } from "../api";
import { formatMoney } from "../utils/format";

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
  const toneCls =
    tone === "plus" ? "text-emerald-300" : tone === "minus" ? "text-red-300" : "text-white";
  return (
    <div
      className={`flex items-baseline justify-between gap-3 py-2 ${strong ? "border-t border-white/10 pt-3" : ""}`}
      title={hint || undefined}
    >
      <span className={`${indent ? "pl-4 text-slate-400" : "text-slate-300"} ${strong ? "font-black text-white" : "font-bold"} text-sm`}>
        {label}
        {hint ? <span className="ml-1 text-[10px] text-slate-500">ⓘ</span> : null}
      </span>
      <span className={`shrink-0 tabular-nums ${strong ? "text-lg font-black" : "font-black"} ${toneCls}`}>
        {prefix}{formatMoney(value)}
      </span>
    </div>
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

export default function FinanceReportPage() {
  const [preset, setPreset] = useState("this");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [rep, setRep] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reqRef = useRef(0);

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

  const p = rep?.pnl || {};
  const cash = rep?.cash || {};
  const pos = rep?.position || {};
  const op = rep?.opening || {};

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
          Откуда пришли деньги, куда ушли, и почему касса не равна прибыли. Наведите на строку с ⓘ — там пояснение.
        </p>

        {/* Период */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {PRESETS.map(([key, label]) => (
            <button key={key} onClick={() => setPreset(key)}
              className={`rounded-2xl px-4 py-2.5 text-sm font-black transition ${
                preset === key ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-lg" : "border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/10"
              }`}>
              {label}
            </button>
          ))}
          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-2 py-1.5">
            <input type="date" value={custom.from} onChange={(e) => { setCustom((c) => ({ ...c, from: e.target.value })); setPreset("custom"); }}
              className="rounded-xl bg-slate-950/60 px-2 py-1.5 text-xs font-bold text-white outline-none" />
            <span className="text-slate-500">—</span>
            <input type="date" value={custom.to} onChange={(e) => { setCustom((c) => ({ ...c, to: e.target.value })); setPreset("custom"); }}
              className="rounded-xl bg-slate-950/60 px-2 py-1.5 text-xs font-bold text-white outline-none" />
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
              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.08] px-4 py-3" title="Выручка минус себестоимость минус все расходы за период. Не зависит от того, чем платили.">
                <p className="text-[11px] font-black uppercase tracking-wide text-emerald-300/80">Чистая прибыль</p>
                <p className={`mt-1 text-2xl font-black ${p.netProfit < 0 ? "text-red-300" : "text-white"}`}>{formatMoney(p.netProfit)}</p>
                <p className="text-[11px] font-bold text-slate-500">за период</p>
              </div>
              <div className="rounded-2xl border border-blue-400/20 bg-blue-500/[0.08] px-4 py-3" title="Все продажи за период (наличные + карта + в долг), уже за вычетом скидок.">
                <p className="text-[11px] font-black uppercase tracking-wide text-blue-300/80">Выручка</p>
                <p className="mt-1 text-2xl font-black text-white">{formatMoney(p.revenue)}</p>
                <p className="text-[11px] font-bold text-slate-500">за период</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3" title="Расчётный остаток наличных: стартовые + приходы налом − расходы налом. Фактический остаток сверяется в смене.">
                <p className="text-[11px] font-black uppercase tracking-wide text-slate-300/80">Остаток кассы</p>
                <p className="mt-1 text-2xl font-black text-white">{formatMoney(pos.cashNow)}</p>
                <p className="text-[11px] font-bold text-slate-500">расчётный</p>
              </div>
              <div className="rounded-2xl border border-amber-400/25 bg-amber-500/[0.08] px-4 py-3" title="Сколько бизнес должен вернуть владельцу за его личные вложения (расходы + вклады − возвраты, с учётом стартового).">
                <p className="text-[11px] font-black uppercase tracking-wide text-amber-300/80">Должны владельцу</p>
                <p className="mt-1 text-2xl font-black text-amber-100">{formatMoney(pos.owedToOwner)}</p>
                <p className="text-[11px] font-bold text-slate-500">всего</p>
              </div>
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
              {op.isSet ? (
                <Card title="Стартовые балансы" subtitle={op.asOfDate ? `Точка отсчёта на ${op.asOfDate}` : "Точка отсчёта"}>
                  <Row label="Наличные на старте" value={op.cash} indent />
                  <Row label="На карте на старте" value={op.bank} indent />
                  <Row label="Долг перед владельцем на старте" value={op.owedToOwner} indent />
                  <Row label="Склад на старте" value={op.inventoryValue} indent />
                  <Row label="Клиенты должны (старт)" value={op.customerDebts} indent />
                  <Row label="Поставщикам должны (старт)" value={op.supplierDebts} indent />
                </Card>
              ) : (
                <Card title="Стартовые балансы" subtitle="Не заданы">
                  <p className="py-2 text-sm font-bold text-slate-400">
                    Если начали вести учёт не с нуля — задайте стартовые балансы на странице «Расходы» → «⚙ Стартовые балансы». Тогда позиция будет точной.
                  </p>
                </Card>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
