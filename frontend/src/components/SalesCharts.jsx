import { useId, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowLeftRight, Banknote, Clock3, CreditCard, Package, Trophy } from "lucide-react";
import { formatMoney } from "../utils/format";
import { salesNumber, salesPercent, salesQuantity } from "../utils/sales";

const metrics = { revenue: { label: "Выручка", unit: "₽" }, count: { label: "Чеки", unit: "" }, average: { label: "Средний чек", unit: "₽" } };
const chartNumber = (value) => Math.abs(value) >= 1000000 ? `${salesPercent(value / 1000000)} млн` : Math.abs(value) >= 1000 ? `${salesPercent(value / 1000)} тыс.` : formatMoney(value);

function SalesTooltip({ active, payload }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return <div className="sls-chart-tooltip backdrop-blur-xl"><strong>{row.label}</strong><dl><div><dt>Выручка</dt><dd>{formatMoney(row.revenue)} ₽</dd></div><div><dt>Чеки</dt><dd>{row.count}</dd></div><div><dt>Средний чек</dt><dd>{row.count ? `${formatMoney(row.average)} ₽` : "—"}</dd></div></dl></div>;
}

export function SalesTrend({ series, revenue, count, average }) {
  const [metric, setMetric] = useState("revenue");
  const id = useId().replace(/:/g, "");
  const gradient = `sales-gradient-${id}`;
  const selected = metrics[metric];
  const total = { revenue, count, average }[metric];
  return (
    <section className="sls-panel sls-trend bg-white/[0.02] shadow-sm backdrop-blur-xl" aria-label="График продаж">
      <div className="sls-section-heading"><div><p className="sls-eyebrow">Динамика продаж</p><h2>{selected.label} за период</h2></div><span className="sls-badge">{series.label}</span></div>
      <div className="sls-trend-top"><strong>{formatMoney(total)}<small>{selected.unit}</small></strong><div className="sls-segmented" role="group" aria-label="Показатель графика">{Object.entries(metrics).map(([key, item]) => <button type="button" key={key} aria-pressed={metric === key} onClick={() => setMetric(key)}>{item.label}</button>)}</div></div>
      <div className="sls-chart" role="img" aria-label={`${selected.label}: ${series.label.toLowerCase()}. Точные значения доступны в таблице под графиком.`}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 640, height: 280 }}>
          <AreaChart data={series.rows} margin={{ top: 15, right: 8, bottom: 0, left: 0 }} accessibilityLayer>
            <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--brand)" stopOpacity={.38} /><stop offset="95%" stopColor="var(--brand)" stopOpacity={.015} /></linearGradient></defs>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 6" />
            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "var(--text-muted)", fontSize: 10 }} minTickGap={36} tickMargin={13} />
            <YAxis width={52} axisLine={false} tickLine={false} tick={{ fill: "var(--text-muted)", fontSize: 10 }} tickFormatter={chartNumber} allowDecimals={metric !== "count"} tickMargin={8} />
            <Tooltip content={<SalesTooltip />} cursor={{ stroke: "var(--brand)", strokeWidth: 1, strokeDasharray: "4 4" }} />
            <Area type="linear" dataKey={metric} name={selected.label} stroke="var(--brand)" strokeWidth={2.5} fill={`url(#${gradient})`} activeDot={{ r: 5, fill: "var(--brand)", stroke: "var(--surface)", strokeWidth: 3 }} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="sls-chart-footer"><span><i />{selected.label}{selected.unit ? `, ${selected.unit}` : ""}</span><small>{metric === "average" ? "Для периодов без чеков средний чек не рассчитывается" : "По рабочей дате точки · дни без продаж учтены"}</small></div>
      <details className="sls-chart-data"><summary>Данные графика</summary><div className="sls-data-scroll"><table><caption className="sr-only">Продажи за выбранный период</caption><thead><tr><th>Период</th><th>Выручка, ₽</th><th>Чеки</th><th>Средний чек, ₽</th></tr></thead><tbody>{series.rows.map((row) => <tr key={row.key}><th scope="row">{row.label}</th><td>{formatMoney(row.revenue)}</td><td>{row.count}</td><td>{row.count ? formatMoney(row.average) : "—"}</td></tr>)}</tbody></table></div></details>
    </section>
  );
}

export function SalesPayments({ metrics: m }) {
  const parts = [
    { key: "cash", name: "Наличные", value: m.cash, Icon: Banknote, color: "var(--brand)" },
    { key: "transfer", name: "Переводы", value: m.transfer, Icon: ArrowLeftRight, color: "var(--sls-secondary)" },
    ...(m.other > .005 ? [{ key: "other", name: "Другие", value: m.other, Icon: CreditCard, color: "var(--text-muted)" }] : []),
  ];
  let angle = 0;
  const slices = parts.map((part) => { const start = angle; angle += m.paid ? part.value / m.paid * 360 : 0; return `${part.color} ${start}deg ${angle}deg`; }).join(", ");
  return (
    <section className="sls-panel sls-payments bg-white/[0.02] shadow-sm backdrop-blur-xl" aria-label="Способы оплаты">
      <div className="sls-section-heading"><div><p className="sls-eyebrow">Структура выручки</p><h2>Как платят гости</h2></div><CreditCard size={19} /></div>
      <div className="sls-donut" role="img" aria-label={m.paid ? parts.map((part) => `${part.name}: ${formatMoney(part.value)} ₽, ${salesPercent(part.value / m.paid * 100)}%`).join("; ") : "Оплат на положительную сумму нет"} style={{ "--sls-ring": m.paid ? `conic-gradient(${slices})` : "var(--border)" }}><div><span>Оплачено</span><strong>{formatMoney(m.paid)}<small>₽</small></strong></div></div>
      <div className="sls-payment-legend">{parts.map(({ key, name, value, Icon, color }) => <div key={key}><span className="sls-legend-icon" style={{ color }}><Icon size={16} /></span><span>{name}<small>{salesPercent(m.paid ? value / m.paid * 100 : 0)}% от суммы оплат</small></span><strong>{formatMoney(value)}<small> ₽</small></strong></div>)}</div>
      <div className="sls-payment-discount"><span>Скидки гостям<strong>{formatMoney(m.discount)} ₽</strong></span><div><i style={{ width: `${Math.max(0, Math.min(100, m.discountPercent))}%` }} /></div><small>{salesPercent(m.discountPercent)}% от суммы до скидок</small></div>
    </section>
  );
}

export function SalesHours({ rows }) {
  const best = rows.reduce((top, row) => row.count > (top?.count || 0) ? row : top, null);
  return (
    <section className="sls-panel sls-hours bg-white/[0.02] shadow-sm backdrop-blur-xl" aria-label="Продажи по часам">
      <div className="sls-section-heading"><div><p className="sls-eyebrow">Ритм кофейни</p><h2>В какое время покупают</h2></div><Clock3 size={19} /></div>
      <div className="sls-hours-summary"><strong>{best?.label || "—"}</strong><span>{best ? `${best.count} чеков · самый загруженный час` : "Продажи с указанным временем появятся здесь"}</span></div>
      <div className="sls-hour-chart" role="img" aria-label="Количество чеков по часам за весь выбранный период">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 440, height: 190 }}>
          <BarChart data={rows} margin={{ top: 12, right: 0, bottom: 0, left: 0 }} accessibilityLayer>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 6" />
            <XAxis dataKey="hour" axisLine={false} tickLine={false} tick={{ fill: "var(--text-muted)", fontSize: 10 }} interval={3} tickFormatter={(hour) => `${String(hour).padStart(2, "0")}`} tickMargin={10} />
            <YAxis hide allowDecimals={false} />
            <Tooltip content={<SalesTooltip />} cursor={{ fill: "var(--brand-soft)" }} />
            <Bar dataKey="count" fill="var(--brand)" fillOpacity={.75} maxBarSize={17} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="sls-note">Чеки суммируются по местному часу за весь период.</p>
      <details className="sls-chart-data"><summary>Значения по часам</summary><div className="sls-hour-values">{rows.map((row) => <span key={row.key}>{row.label}<b>{row.count}</b></span>)}</div></details>
    </section>
  );
}

export function SalesProducts({ products, extras }) {
  const [sort, setSort] = useState("qty");
  const rows = useMemo(() => [...products].sort((a, b) => salesNumber(b[sort]) - salesNumber(a[sort])), [products, sort]);
  const max = Math.max(0, ...rows.map((row) => salesNumber(row[sort])));
  return (
    <section className="sls-panel sls-products bg-white/[0.02] shadow-sm backdrop-blur-xl" aria-label="Популярные товары">
      <div className="sls-section-heading"><div><p className="sls-eyebrow">Что выбирают гости</p><h2>Популярные товары</h2></div><Trophy size={19} /></div>
      <div className="sls-products-toolbar"><p>До 10 лидеров по количеству</p><select aria-label="Порядок популярных товаров" value={sort} onChange={(event) => setSort(event.target.value)}><option value="qty">По количеству</option><option value="revenue">По сумме</option></select></div>
      {rows.length ? <ol className="sls-product-list">{rows.map((product, index) => <li key={`${product.name}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div><div><strong>{product.name}</strong><span>{salesQuantity(product.qty)} шт.<b>{formatMoney(salesNumber(product.revenue))} ₽</b></span></div><div className="sls-product-track"><i style={{ width: `${max ? Math.max(0, salesNumber(product[sort]) / max * 100) : 0}%` }} /></div></div></li>)}</ol> : <p className="sls-inline-empty"><Package size={20} />Нет данных по товарам</p>}
      <p className="sls-note">Суммы позиций — до скидок на чек.</p>
      {extras.length > 0 && <details className="sls-extras"><summary>Дополнительные товары <span>{extras.length}</span></summary><div>{extras.map((item, index) => <p key={`${item.name}-${index}`}><span>{item.name}<small>{salesQuantity(item.qty)} шт.</small></span><strong>{formatMoney(salesNumber(item.revenue))} ₽</strong></p>)}</div></details>}
    </section>
  );
}
