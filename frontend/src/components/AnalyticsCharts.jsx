import { useId, useMemo, useState } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowRight, ChartNoAxesCombined, PackageSearch, Search } from "lucide-react";
import { formatMoney } from "../utils/format";
import { analyticsMonth, analyticsPercent, analyticsProductSeries, analyticsQuantity } from "../utils/analytics";

const SERIES = [
  { key: "revenue", label: "Выручка", color: "var(--brand)" },
  { key: "gross", label: "До расходов", color: "var(--brand-2)" },
  { key: "expenses", label: "Расходы", color: "var(--color-amber-400)" },
  { key: "net", label: "После расходов", color: "var(--color-emerald-400)" },
];
const compact = (value) => Math.abs(value) >= 1e6 ? `${analyticsPercent(value / 1e6)} млн` : Math.abs(value) >= 1000 ? `${analyticsPercent(value / 1000)} тыс.` : formatMoney(value);
function MoneyAxisTick({ x, y, payload, textAnchor = "end" }) {
  return <text x={x} y={y} dy={3} textAnchor={textAnchor} fill="var(--text-muted)" fontSize=".625rem">{compact(payload.value)}</text>;
}
function ChartTooltip({ active, payload, fields = SERIES }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return <div className="anl-tooltip backdrop-blur-xl"><strong>{analyticsMonth(row.month)}</strong><dl>{fields.map(({ key, label, color, quantity }) => <div key={key}><dt><i style={{ background: color }} />{label}</dt><dd className={row[key] < 0 ? "anl-negative" : ""}>{row[key] == null ? "—" : quantity ? `${analyticsQuantity(row[key])} шт.` : `${formatMoney(row[key])} ₽`}</dd></div>)}</dl></div>;
}
function ChartFrame({ children, label, small = false }) {
  return <div className={`anl-chart ${small ? "is-small" : ""}`} role="img" aria-label={label}><ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 620, height: 290 }}>{children}</ResponsiveContainer></div>;
}
const axisTick = { fill: "var(--text-muted)", fontSize: 10, style: { fontSize: ".625rem" } };

export function AnalyticsTrend({ rows }) {
  const [visible, setVisible] = useState(["revenue", "net", "expenses"]);
  const [style, setStyle] = useState(rows.filter((row) => row.hasData).length > 1 ? "lines" : "bars");
  const gradient = `anl-${useId().replace(/:/g, "")}`;
  const fields = SERIES.filter((entry) => visible.includes(entry.key));
  const toggle = (key) => setVisible((old) => old.includes(key) ? old.length > 1 ? old.filter((value) => value !== key) : old : [...old, key]);
  return (
    <section className="anl-panel anl-trend bg-white/[0.02] shadow-sm backdrop-blur-xl" aria-label="Динамика результатов">
      <div className="anl-section-heading"><div><p className="anl-eyebrow">Финансовая динамика</p><h2>{rows.filter((row) => row.hasData).length === 1 ? "Показатели месяца" : "Как меняется результат"}</h2><p>Сравните выручку, расходы и прибыль по месяцам.</p></div><div className="anl-segmented" role="group" aria-label="Вид графика">{[["lines", "Линии"], ["bars", "Столбцы"]].map(([key, label]) => <button type="button" key={key} aria-pressed={style === key} onClick={() => setStyle(key)}>{label}</button>)}</div></div>
      <div className="anl-chart-legend" role="group" aria-label="Показатели динамики">{SERIES.map(({ key, label, color }) => <button type="button" key={key} aria-pressed={visible.includes(key)} disabled={visible.length === 1 && visible[0] === key} onClick={() => toggle(key)}><i style={{ background: color }} />{label}</button>)}</div>
      <ChartFrame label="Финансовые показатели по месяцам в рублях. Нажмите на легенду, чтобы включить или скрыть показатель.">
        <ComposedChart data={rows} margin={{ top: 15, right: 10, bottom: 0, left: 4 }} accessibilityLayer>
          <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--brand)" stopOpacity={.3} /><stop offset="100%" stopColor="var(--brand)" stopOpacity={.01} /></linearGradient></defs>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 6" />
          <XAxis dataKey="month" tick={axisTick} tickFormatter={(value) => analyticsMonth(value, true)} tickMargin={12} tickLine={false} axisLine={false} minTickGap={28} />
          <YAxis width={62} tick={<MoneyAxisTick />} tickLine={false} axisLine={false} />
          <ReferenceLine y={0} stroke="var(--border)" />
          <Tooltip content={<ChartTooltip fields={fields} />} cursor={style === "bars" ? { fill: "var(--brand-soft)" } : { stroke: "var(--text-muted)", strokeDasharray: "4 4" }} />
          {fields.map(({ key, label, color }) => style === "bars" ? <Bar key={key} dataKey={key} name={label} fill={color} fillOpacity={.8} maxBarSize={48} isAnimationActive={false} /> : key === "revenue" ? <Area key={key} dataKey={key} type="linear" name={label} stroke={color} strokeWidth={2.5} fill={`url(#${gradient})`} dot={{ r: 3, fill: color, stroke: "var(--surface)", strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} /> : <Line key={key} dataKey={key} type="linear" name={label} stroke={color} strokeWidth={2.5} strokeDasharray={key === "expenses" ? "5 5" : undefined} dot={{ r: 3, fill: color, stroke: "var(--surface)", strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />)}
        </ComposedChart>
      </ChartFrame>
      <p className="anl-note">Значения — в рублях. Месяцы без записей не считаются нулевыми.</p>
      <details className="anl-chart-data"><summary>Точные значения графика</summary><div className="anl-table-scroll"><table><caption className="sr-only">Финансовая динамика</caption><thead><tr><th>Месяц</th>{SERIES.map((entry) => <th key={entry.key}>{entry.label}, ₽</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.month}><th scope="row">{analyticsMonth(row.month, true)}</th>{SERIES.map((entry) => <td key={entry.key}>{row[entry.key] == null ? "—" : formatMoney(row[entry.key])}</td>)}</tr>)}</tbody></table></div></details>
    </section>
  );
}

export function AnalyticsResult({ totals: m }) {
  const max = Math.max(Math.abs(m.revenue), Math.abs(m.cost), Math.abs(m.expenses), Math.abs(m.net), 1);
  const rows = [{ label: "Выручка", value: m.revenue, color: "var(--brand)" }, { label: "Себестоимость", value: m.cost, color: "var(--text-muted)", subtract: true }, { label: "Расходы", value: m.expenses, color: "var(--color-amber-400)", subtract: true }];
  return <section className="anl-panel anl-result bg-white/[0.02] shadow-sm backdrop-blur-xl" aria-label="Расчёт результата"><p className="anl-eyebrow">От выручки к прибыли</p><h2>Что осталось после расходов</h2><strong className={`anl-result-value ${m.net < 0 ? "anl-negative" : "anl-positive"}`}>{formatMoney(m.net)}<small>₽</small></strong><span className="anl-margin">{m.margin == null ? "Нет положительной выручки для расчёта доли" : `${analyticsPercent(m.margin)}% от выручки`}</span><div className="anl-result-rows">{rows.map((row) => <div key={row.label}><span>{row.label}<b>{row.subtract ? "− (" : ""}{formatMoney(row.value)}{row.subtract ? ")" : ""} ₽</b></span><div><i style={{ width: `${Math.abs(row.value) / max * 100}%`, background: row.color }} /></div></div>)}</div><footer>Выручка − себестоимость − расходы из выбранных папок.</footer></section>;
}

export function AnalyticsRanking({ products, selected, onSelect }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("revenue");
  const rows = useMemo(() => products.filter((row) => row.name.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => b[sort] - a[sort]).slice(0, 10), [products, query, sort]);
  const max = Math.max(1, ...rows.map((row) => Math.abs(row[sort])));
  return <section className="anl-panel anl-ranking bg-white/[0.02] shadow-sm" aria-label="Рейтинг товаров"><div className="anl-section-heading"><div><p className="anl-eyebrow">Вклад товаров</p><h2>Что приносит результат</h2><p>Выберите товар для подробного разбора.</p></div><PackageSearch size={20} /></div><div className="anl-ranking-toolbar"><label className="anl-search"><Search size={15} /><input aria-label="Поиск товаров в аналитике" value={query} placeholder="Найти товар…" onChange={(event) => setQuery(event.target.value)} /></label><select aria-label="Сортировка рейтинга товаров" value={sort} onChange={(event) => setSort(event.target.value)}><option value="revenue">По выручке</option><option value="profit">По прибыли</option><option value="qty">По количеству</option></select></div>{rows.length ? <ol>{rows.map((row, index) => <li key={row.name}><button type="button" aria-pressed={selected === row.name} onClick={() => onSelect(row.name)}><span className="anl-rank">{String(index + 1).padStart(2, "0")}</span><span className="anl-ranking-name"><strong>{row.name}</strong><span><small>{analyticsQuantity(row.qty)} шт.</small><small className={row.profit < 0 ? "anl-negative" : ""}>Прибыль {formatMoney(row.profit)} ₽</small></span><span className="anl-rank-track"><i style={{ width: `${Math.abs(row[sort]) / max * 100}%`, background: row[sort] < 0 ? "var(--color-rose-400)" : "var(--brand)" }} /></span></span><b className={row[sort] < 0 ? "anl-negative" : ""}>{sort === "qty" ? `${analyticsQuantity(row.qty)} шт.` : `${formatMoney(row[sort])} ₽`}</b><ArrowRight size={14} /></button></li>)}</ol> : <p className="anl-inline-empty">{query ? "Товар не найден" : "Нет данных по товарам"}</p>}<p className="anl-note">До 10 позиций · прибыль до общих расходов папки.</p></section>;
}

export function AnalyticsExpenses({ rows, total }) {
  const max = Math.max(1, ...rows.map((row) => Math.abs(row.amount)));
  return <section className="anl-panel anl-expenses bg-white/[0.02] shadow-sm" aria-label="Структура расходов"><div className="anl-section-heading"><div><p className="anl-eyebrow">Контроль затрат</p><h2>На что уходят деньги</h2><p>Расходы из выбранных папок и месяцев.</p></div><ChartNoAxesCombined size={20} /></div><strong className="anl-expenses-total">{formatMoney(total)}<small>₽</small></strong>{rows.length ? <div className="anl-expense-list">{rows.map((row) => <div key={row.name}><span>{row.name}<strong>{formatMoney(row.amount)} ₽</strong></span><div><i style={{ width: `${Math.abs(row.amount) / max * 100}%`, background: row.amount < 0 ? "var(--color-emerald-400)" : "var(--color-amber-400)" }} /></div><small>{row.count} записей</small></div>)}</div> : <p className="anl-inline-empty">Расходов в этом периоде нет.</p>}</section>;
}

export function AnalyticsProductCharts({ records, months, products, selected, onSelect }) {
  const rows = useMemo(() => analyticsProductSeries(records, months, selected), [records, months, selected]);
  const product = products.find((row) => row.name === selected);
  const pricingFields = [{ key: "price", label: "Цена", color: "var(--brand)" }, { key: "cost", label: "Себестоимость", color: "var(--color-amber-400)" }];
  const volumeFields = [{ key: "qty", label: "Количество", color: "var(--brand)", quantity: true }, { key: "profit", label: "Прибыль до расходов", color: "var(--color-emerald-400)" }];
  return <section className="anl-product-explorer" aria-label="Аналитика товара"><div className="anl-product-heading"><div><p className="anl-eyebrow">Разбор позиции</p><h2>Экономика товара</h2></div><label>Товар<select aria-label="Товар для подробной аналитики" value={selected} onChange={(event) => onSelect(event.target.value)}>{!products.length && <option value="">Нет товаров</option>}{[...products].sort((a, b) => a.name.localeCompare(b.name, "ru")).map((row) => <option key={row.name} value={row.name}>{row.name}</option>)}</select></label></div>{product ? <><div className="anl-product-metrics">{[["Выручка", `${formatMoney(product.revenue)} ₽`], ["До расходов", `${formatMoney(product.profit)} ₽`], ["Количество", `${analyticsQuantity(product.qty)} шт.`]].map(([label, value]) => <div className="anl-panel bg-white/[0.02]" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><div className="anl-product-chart-grid"><section className="anl-panel bg-white/[0.02] shadow-sm"><h3>Цена и себестоимость</h3><div className="anl-static-legend">{pricingFields.map((field) => <span key={field.key}><i style={{ background: field.color }} />{field.label}</span>)}</div><ChartFrame small label="Средняя цена и себестоимость товара по месяцам в рублях"><LineChart data={rows} margin={{ top: 16, right: 12, bottom: 0, left: 2 }} accessibilityLayer><CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 6" /><XAxis dataKey="month" tick={axisTick} tickFormatter={(value) => analyticsMonth(value, true)} tickLine={false} axisLine={false} minTickGap={26} /><YAxis width={54} tick={<MoneyAxisTick />} axisLine={false} tickLine={false} /><Tooltip content={<ChartTooltip fields={pricingFields} />} />{pricingFields.map((field) => <Line type="linear" key={field.key} dataKey={field.key} stroke={field.color} strokeWidth={2.5} dot={{ r: 3, fill: field.color }} connectNulls={false} isAnimationActive={false} />)}</LineChart></ChartFrame><p className="anl-note">Средние за единицу, взвешенные по количеству. При нулевом количестве среднее не рассчитывается.</p></section><section className="anl-panel bg-white/[0.02] shadow-sm"><h3>Объём и прибыль</h3><div className="anl-static-legend">{volumeFields.map((field) => <span key={field.key}><i style={{ background: field.color }} />{field.label}</span>)}</div><div className="anl-axis-labels"><span>Количество, шт.</span><span>Прибыль, ₽</span></div><ChartFrame small label="Количество товара по левой шкале в штуках, прибыль по правой шкале в рублях"><ComposedChart data={rows} margin={{ top: 12, right: 2, bottom: 0, left: 2 }} accessibilityLayer><CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 6" /><XAxis dataKey="month" tick={axisTick} tickFormatter={(value) => analyticsMonth(value, true)} axisLine={false} tickLine={false} minTickGap={26} /><YAxis yAxisId="qty" width={43} tick={axisTick} tickFormatter={compact} axisLine={false} tickLine={false} /><YAxis yAxisId="profit" orientation="right" width={60} tick={<MoneyAxisTick textAnchor="start" />} axisLine={false} tickLine={false} /><ReferenceLine yAxisId="profit" y={0} stroke="var(--border)" /><Tooltip content={<ChartTooltip fields={volumeFields} />} /><Bar yAxisId="qty" dataKey="qty" fill="var(--brand)" fillOpacity={.65} maxBarSize={42} isAnimationActive={false} /><Line yAxisId="profit" dataKey="profit" type="linear" stroke="var(--color-emerald-400)" strokeWidth={2.5} dot={{ r: 3, fill: "var(--color-emerald-400)" }} connectNulls={false} isAnimationActive={false} /></ComposedChart></ChartFrame><p className="anl-note">Две шкалы разделяют количество и деньги. Прибыль — до общих расходов папки.</p></section></div><details className="anl-panel anl-product-data bg-white/[0.02]"><summary>Значения по месяцам для «{selected}»</summary><div className="anl-table-scroll"><table><thead><tr><th>Месяц</th><th>Цена, ₽</th><th>Себестоимость, ₽</th><th>Количество</th><th>Прибыль, ₽</th></tr></thead><tbody>{rows.map((row) => <tr key={row.month}><th scope="row">{row.label}</th>{["price", "cost", "qty", "profit"].map((key) => <td key={key}>{row[key] == null ? "—" : key === "qty" ? analyticsQuantity(row[key]) : formatMoney(row[key])}</td>)}</tr>)}</tbody></table></div></details></> : <div className="anl-panel anl-inline-empty bg-white/[0.02]">В выбранном периоде нет товаров. Измените папку или период.</div>}</section>;
}
