import { useEffect, useMemo, useState } from "react";
import { get } from "../api";
import { formatMoney } from "../utils/format";

function saleDateParts(createdAt) {
  if (!createdAt) return { date: "", time: "" };
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) {
    return { date: String(createdAt).slice(0, 10), time: "" };
  }

  return {
    date: d.toLocaleDateString("ru-RU"),
    time: d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
  };
}

const moneyValue = (value) => formatMoney(Number(value || 0));

function StatCard({ title, value, subtitle, icon, tone = "blue" }) {
  const tones = {
    blue: "from-blue-600/25 to-indigo-700/10 border-blue-400/25 text-blue-200",
    green: "from-emerald-600/25 to-teal-700/10 border-emerald-400/25 text-emerald-200",
    red: "from-red-600/25 to-rose-700/10 border-red-400/25 text-red-200",
    purple: "from-violet-600/25 to-fuchsia-700/10 border-violet-400/25 text-violet-200",
    amber: "from-amber-600/25 to-orange-700/10 border-amber-400/25 text-amber-200",
  };

  return (
    <div className={`relative overflow-hidden rounded-[1.75rem] border bg-gradient-to-br ${tones[tone] || tones.blue} p-5 shadow-[0_24px_80px_rgba(0,0,0,0.22)]`}>
      <div className="absolute -right-10 -top-10 h-28 w-28 rounded-full bg-white/10 blur-2xl" />
      <div className="absolute bottom-0 right-0 h-px w-32 bg-gradient-to-l from-white/30 to-transparent" />
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{title}</p>
          <p className="mt-3 text-3xl font-black text-white sm:text-4xl">{value}</p>
          {subtitle && <p className="mt-2 text-xs font-bold text-slate-400">{subtitle}</p>}
        </div>
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/10 text-xl shadow-inner shadow-white/10">
          {icon}
        </div>
      </div>
    </div>
  );
}

export default function SalesAnalyticsPage() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const monthStartStr = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); })();
  const monthEndStr = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10); })();
  const formatDateRu = (s) => { if (!s) return ""; const [y,m,d] = s.split("-"); return `${d}.${m}.${y}`; };
  const [from, setFrom] = useState(monthStartStr);
  const [to, setTo] = useState(monthEndStr);
  const [filterOpen, setFilterOpen] = useState(false);
  const [stats, setStats] = useState({ topProducts: [] });
  const [sales, setSales] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Safe array guards
  const safe_sales = Array.isArray(sales) ? sales : [];

  const load = async () => {
    setError("");
    setLoading(true);
    const query = `from=${from}&to=${to}`;

    try {
      const [s, list] = await Promise.all([
        get(`/sales/stats?${query}`),
        get(`/sales?${query}`),
      ]);
      setStats(s || { topProducts: [] });
      setSales(list || []);
    } catch (e) {
      setError(e.message || "Не удалось загрузить продажи");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [from, to]);

  const normalizedSales = useMemo(() => {
    return safe_sales.map((sale) => ({ ...sale, ...saleDateParts(sale.createdAt) }));
  }, [sales]);

  const avgCheck = Number(stats.salesCount || 0) > 0 ? Number(stats.totalRevenue || 0) / Number(stats.salesCount || 1) : 0;

  return (
    <div className="relative pb-nav text-white sm:pb-10">
      <div className="pointer-events-none absolute -top-28 left-1/4 h-72 w-72 rounded-full bg-blue-600/20 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-24 h-80 w-80 rounded-full bg-violet-700/20 blur-3xl" />

      <div className="relative mx-auto w-full max-w-[1500px] px-3 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-500/10 px-3 py-1 text-xs font-black text-blue-300 shadow-[0_0_30px_rgba(37,99,235,0.18)]">
              <span className="h-2 w-2 rounded-full bg-blue-400 shadow-[0_0_14px_rgba(96,165,250,1)]" />
              Отчёт продаж
            </div>
            <h2 className="text-4xl font-black leading-none tracking-[-0.05em] text-white sm:text-6xl">
              Продажи
            </h2>
            <p className="mt-4 max-w-2xl text-sm font-medium leading-6 text-slate-400 sm:text-base">
              Продажи по датам, скидки, наличка, переводы, популярные товары и последние чеки.
            </p>
          </div>

          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-slate-950/70 px-5 py-4 text-sm font-black text-white shadow-[0_20px_60px_rgba(0,0,0,0.25)] transition hover:border-blue-400/40 hover:bg-blue-600/20 disabled:opacity-60"
          >
            <span className={loading ? "inline-block animate-spin" : ""}>⟳</span>
            {loading ? "Загрузка" : "Обновить"}
          </button>
        </div>

        {error && (
          <div className="mb-5 rounded-[1.5rem] border border-red-400/25 bg-red-500/10 px-5 py-4 text-sm font-black text-red-200 shadow-[0_18px_60px_rgba(127,29,29,0.2)]">
            {error}
          </div>
        )}

        <div className="mb-5 rounded-[2rem] border border-white/10 bg-white/[0.04] shadow-[0_24px_90px_rgba(0,0,0,0.25)] backdrop-blur-xl overflow-hidden">
          {/* Компактная шапка */}
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
            <div className="flex flex-1 flex-wrap items-center gap-2">
              {[
                ["month", "Этот месяц", () => { setFrom(monthStartStr); setTo(monthEndStr); }],
                ["today", "Сегодня",    () => { setFrom(todayStr); setTo(todayStr); }],
                ["all",   "Всё время",  () => { setFrom(""); setTo(""); }],
              ].map(([key, label, action]) => {
                const active =
                  (key === "month" && from === monthStartStr && to === monthEndStr) ||
                  (key === "today" && from === todayStr && to === todayStr) ||
                  (key === "all"   && !from && !to);
                return (
                  <button key={key} type="button" onClick={action}
                    className={active
                      ? "rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2 text-sm font-black text-white shadow-lg"
                      : "rounded-xl border border-white/10 bg-white/8 px-4 py-2 text-sm font-black text-slate-300 transition hover:bg-white/15"}>
                    {label}
                  </button>
                );
              })}
              {from && to && !(from === monthStartStr && to === monthEndStr) && !(from === todayStr && to === todayStr) && (
                <span className="rounded-xl border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-sm font-black text-blue-200">
                  {formatDateRu(from)} — {formatDateRu(to)}
                </span>
              )}
            </div>
            <button type="button" onClick={() => setFilterOpen((v) => !v)}
              className={`flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-black transition ${
                filterOpen ? "border-blue-400/40 bg-blue-500/15 text-blue-200" : "border-white/10 bg-white/8 text-slate-300 hover:bg-white/15"
              }`}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
              Фильтр
            </button>
          </div>

          {/* Раскрытый фильтр */}
          {filterOpen && (
            <div className="border-t border-white/10 px-4 py-4 sm:px-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-400">От даты</span>
                  <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                    className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 font-bold text-white outline-none transition [color-scheme:dark] focus:border-blue-400/70 focus:ring-4 focus:ring-blue-500/10"/>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-400">До даты</span>
                  <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                    className="h-12 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 font-bold text-white outline-none transition [color-scheme:dark] focus:border-blue-400/70 focus:ring-4 focus:ring-blue-500/10"/>
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard title="Выручка" value={moneyValue(stats.totalRevenue)} subtitle="общая сумма" icon="₽" tone="blue" />
          <StatCard title="Скидки" value={moneyValue(stats.totalDiscount)} subtitle="скидки за период" icon="%" tone="red" />
          <StatCard title="Продаж" value={Number(stats.salesCount || 0)} subtitle="количество чеков" icon="🧾" tone="purple" />
          <StatCard title="Наличные" value={moneyValue(stats.cashTotal)} subtitle="оплата наличкой" icon="💵" tone="green" />
          <StatCard title="Переводы" value={moneyValue(stats.transferTotal)} subtitle={`средний чек ${moneyValue(avgCheck)}`} icon="↗" tone="amber" />
        </div>

        <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
          <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.04] shadow-[0_24px_90px_rgba(0,0,0,0.25)] backdrop-blur-xl">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 p-5 sm:p-6">
              <div>
                <h3 className="text-2xl font-black tracking-[-0.03em] text-white">Самые продаваемые товары</h3>
                <p className="mt-1 text-sm font-medium text-slate-400">Топ по количеству и сумме продаж.</p>
              </div>
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-500/15 text-xl">🏆</div>
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="border-b border-white/10 bg-slate-950/40 text-xs uppercase tracking-[0.16em] text-slate-400">
                  <tr>
                    <th className="p-4">Товар</th>
                    <th className="p-4 text-center">Кол-во</th>
                    <th className="p-4 text-right">Сумма</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {(stats.topProducts || []).map((p, index) => (
                    <tr key={`${p.name}-${index}`} className="transition hover:bg-white/[0.04]">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <span className="grid h-9 w-9 place-items-center rounded-2xl bg-blue-500/15 text-xs font-black text-blue-200">#{index + 1}</span>
                          <span className="font-black text-white">{p.name}</span>
                        </div>
                      </td>
                      <td className="p-4 text-center font-black text-blue-200">{p.qty}</td>
                      <td className="p-4 text-right font-black text-emerald-300">{moneyValue(p.revenue)}</td>
                    </tr>
                  ))}

                  {!(stats.topProducts || []).length && (
                    <tr>
                      <td colSpan="3" className="p-10 text-center font-bold text-slate-500">За этот период продаж пока нет</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-white/10 md:hidden">
              {(stats.topProducts || []).map((p, index) => (
                <div key={`${p.name}-${index}`} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="grid h-10 w-10 place-items-center rounded-2xl bg-blue-500/15 text-xs font-black text-blue-200">#{index + 1}</span>
                      <div>
                        <p className="font-black text-white">{p.name}</p>
                        <p className="text-sm font-bold text-slate-400">Кол-во: {p.qty}</p>
                      </div>
                    </div>
                    <p className="font-black text-emerald-300">{moneyValue(p.revenue)}</p>
                  </div>
                </div>
              ))}
              {!(stats.topProducts || []).length && <div className="p-8 text-center font-bold text-slate-500">За этот период продаж пока нет</div>}
            </div>
          </section>

          <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.04] shadow-[0_24px_90px_rgba(0,0,0,0.25)] backdrop-blur-xl">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 p-5 sm:p-6">
              <div>
                <h3 className="text-2xl font-black tracking-[-0.03em] text-white">Последние чеки</h3>
                <p className="mt-1 text-sm font-medium text-slate-400">Недавние продажи и способ оплаты.</p>
              </div>
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-violet-500/15 text-xl">🧾</div>
            </div>

            <div className="max-h-[560px] divide-y divide-white/10 overflow-auto">
              {normalizedSales.map((s) => (
                <div key={s.id} className="p-4 transition hover:bg-white/[0.04] sm:p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-black text-white">Чек #{s.id}</p>
                      <p className="mt-1 text-sm font-bold text-slate-400">{s.date} {s.time}</p>
                    </div>
                    <p className="shrink-0 rounded-2xl bg-emerald-500/10 px-3 py-2 text-sm font-black text-emerald-300">{moneyValue(s.total)}</p>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-black">
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-slate-300">
                      {s.paymentType === "cash" ? "Наличные" : `Перевод ${s.cardName || ""}`}
                    </span>
                    <span className="rounded-full border border-red-400/20 bg-red-500/10 px-3 py-1.5 text-red-200">
                      скидка {s.discountPercent || 0}%
                    </span>
                  </div>

                  <p className="mt-3 text-sm leading-6 text-slate-300">
                    {(s.items || []).map((i) => `${i.name} × ${i.qty}`).join(", ") || "Товары не указаны"}
                  </p>
                </div>
              ))}

              {!normalizedSales.length && (
                <div className="p-10 text-center font-bold text-slate-500">Чеков за этот период пока нет</div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
