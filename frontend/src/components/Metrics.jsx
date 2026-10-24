// Общие премиум-метрики для героев страниц (Товары / Расходы / Долги).
// Держим единый визуальный язык: лёгкий спарклайн-тренд и факт-блок с иконкой.

// Лёгкий инлайн-спарклайн (area + line) без зависимостей. Тянется по ширине
// контейнера (preserveAspectRatio="none"), штрих не искажается (non-scaling-stroke).
// id градиента выводится из цвета — разные цвета не конфликтуют на одной странице.
export function TrendSparkline({ values = [], color = "#fb7185", className = "" }) {
  const pts = (Array.isArray(values) ? values : []).filter((v) => Number.isFinite(v));
  const W = 100, H = 100, pad = 10;
  let line, area;
  if (pts.length >= 2) {
    const min = Math.min(...pts), max = Math.max(...pts);
    const flat = max === min;
    const range = flat ? 1 : max - min;
    const stepX = W / (pts.length - 1);
    const xy = pts.map((v, i) => {
      const x = i * stepX;
      const y = flat ? H / 2 : pad + (H - 2 * pad) * (1 - (v - min) / range);
      return `${x.toFixed(2)} ${y.toFixed(2)}`;
    });
    line = "M" + xy.join(" L");
    area = `${line} L${W} ${H} L0 ${H} Z`;
  } else {
    const y = (H / 2).toFixed(2);
    line = `M0 ${y} L${W} ${y}`;
    area = `${line} L${W} ${H} L0 ${H} Z`;
  }
  const gid = `spark-${String(color).replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.26" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// Факт в герое: иконка + подпись сверху, крупное значение снизу (с опц. суффиксом).
export function HeroStat({ icon: Icon, label, value, sub, tone = "text-white" }) {
  return (
    <div className="min-w-0 px-4 first:pl-0 lg:px-5">
      <div className="flex items-center gap-1.5 text-slate-400">
        {Icon && <Icon size={14} className="shrink-0" />}
        <span className="truncate text-[11px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className={`mt-1.5 truncate text-lg font-semibold tabular-nums ${tone}`}>
        {value}
        {sub != null && <span className="ml-1.5 text-xs font-semibold text-slate-500">{sub}</span>}
      </p>
    </div>
  );
}
