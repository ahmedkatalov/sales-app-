import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, BarChart3, CalendarDays, ChevronDown, ChevronRight, Clock3, Download, Loader2, MapPin, ReceiptText, RefreshCw, Search, Trophy, Users, Wallet } from 'lucide-react';
import { get, getCurrentWorkspace, getSession } from '../api';
import { formatMoney } from '../utils/format';
import { csvCell, csvNum, downloadCsv } from '../utils/csv';
import { TeamPayments, TeamRhythmChart, TeamTrend } from '../components/TeamCharts';
import TeamRoster from '../components/TeamRoster';
import { teamCsvRows, teamHours, teamInitials, teamLeader, teamPeriodError, teamPeriodLabel, teamPresets, teamQuantity, teamSeries, teamUnknown, teamWeekdays, validateTeamReport } from '../utils/team';
import './EmployeeAnalyticsPage.css';

const periodKey = p => `${p.from}|${p.to}`;
const EMPTY = [];
export default function EmployeeAnalyticsPage({ initialWorkspace }) {
  const [workspace, setWorkspace] = useState(() => initialWorkspace || getCurrentWorkspace());
  useEffect(() => { const change = () => setWorkspace(getCurrentWorkspace()); window.addEventListener('sales-workspace-change', change); return () => window.removeEventListener('sales-workspace-change', change); }, []);
  const dataAccountId = workspace?.dataAccountId || getSession()?.dataAccountId || getSession()?.accountId;
  return <TeamWorkspace key={dataAccountId || 'current'} workspace={workspace} dataAccountId={dataAccountId} />;
}
function TeamWorkspace({ workspace, dataAccountId }) {
  const [period, setPeriod] = useState(() => { const p = teamPresets()[3]; return { from: p.from, to: p.to }; });
  const [draft, setDraft] = useState(period), [dateOpen, setDateOpen] = useState(false);
  const [preset, setPreset] = useState('month');
  const [view, setView] = useState('overview'), [query, setQuery] = useState(''), [sort, setSort] = useState('revenue'), [expanded, setExpanded] = useState(null);
  const [snapshot, setSnapshot] = useState(null), [failure, setFailure] = useState(null), [loading, setLoading] = useState(true);
  const sequence = useRef(0), inFlight = useRef(false);
  const key = periodKey(period), report = snapshot?.key === key ? snapshot.report : null;
  const error = failure?.key === key ? failure.message : '';
  const rows = report?.employees || EMPTY, totals = report?.totals;
  const pointName = workspace?.name || 'Текущая точка';
  const leader = useMemo(() => teamLeader(rows), [rows]);
  const series = useMemo(() => teamSeries(report?.trend || EMPTY, period), [report, period]);
  const hours = useMemo(() => report ? teamHours(report.byHour) : EMPTY, [report]);
  const weekdays = useMemo(() => report ? teamWeekdays(report.byWeekday) : EMPTY, [report]);
  const unknownOrders = rows.filter(teamUnknown).reduce((s, e) => s + e.orders, 0);
  const namedPeople = rows.filter(e => !teamUnknown(e)).length;
  const draftError = teamPeriodError(draft);
  const ready = !!report && !loading && !error;
  const load = useCallback(async () => {
    const seq = ++sequence.current, requestKey = periodKey(period);
    inFlight.current = true; setLoading(true); setFailure(null);
    try {
      const raw = await get(`/analytics/employees?${new URLSearchParams(period)}`, { dataAccountId });
      const report = validateTeamReport(raw, period);
      if (seq === sequence.current) setSnapshot({ key: requestKey, report, updatedAt: new Date() });
    } catch (e) { if (seq === sequence.current) setFailure({ key: requestKey, message: e.message || 'Не удалось загрузить отчёт команды.' }); }
    finally { if (seq === sequence.current) { setLoading(false); inFlight.current = false; } }
  }, [period, dataAccountId]);
  const invalidate = useCallback(() => { sequence.current++; }, []);
  useEffect(() => {
    load();
    const refreshVisible = () => { if (!document.hidden && !inFlight.current) load(); };
    const timer = window.setInterval(refreshVisible, 30000);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => { invalidate(); window.clearInterval(timer); document.removeEventListener('visibilitychange', refreshVisible); };
  }, [load, invalidate]);
  const changeDraft = (field, value) => setDraft(p => ({ ...p, [field]: value }));
  const choosePeriod = next => { setPreset(next.id || 'custom'); setPeriod({ from: next.from, to: next.to }); setDateOpen(false); setExpanded(null); };
  const showPerson = id => { setQuery(''); setSort('revenue'); setExpanded(id); setView('employees'); };
  const exportCsv = () => {
    if (!ready) return;
    const data = teamCsvRows(report, period, pointName);
    const csv = [...data.metadata.map(row => row.map(csvCell)), [], data.header.map(csvCell), ...data.rows.map(row => row.map(v => typeof v === 'number' ? csvNum(v) : csvCell(v)))];
    downloadCsv(`sotrudniki_${period.from || 'all'}_${period.to || 'all'}.csv`, csv);
  };
  const rosterProps = { employees: rows, totals, query, setQuery, sort, setSort, expanded, setExpanded };
  const hasSales = totals?.orders > 0;
  return <main className="team-page">
    <header className="tm-page-heading"><div><p className="tm-eyebrow">АНАЛИТИКА / КОМАНДА</p><h1>Сотрудники</h1><p>Продажи команды — от общей динамики до каждого продавца.</p><span className="tm-workspace"><MapPin size={13} /><span>{pointName}</span></span></div><div className="tm-heading-actions"><button type="button" className="tm-button" onClick={load} disabled={loading} aria-label="Обновить отчёт сотрудников"><RefreshCw size={16} className={loading ? 'tm-spin' : ''} />Обновить</button><button type="button" className="tm-primary" onClick={exportCsv} disabled={!ready}><Download size={16} />Экспорт CSV</button></div></header>
    <section className="tm-period tm-panel" aria-label="Период отчёта сотрудников"><div className="tm-period-toolbar"><div role="group" aria-label="Быстрый выбор периода сотрудников">{teamPresets().map(p => <button key={p.id} type="button" aria-pressed={preset === p.id && periodKey(p) === key} onClick={() => choosePeriod(p)}>{p.label}</button>)}</div><button type="button" className="tm-date-button" onClick={() => { setDraft(period); setDateOpen(v => !v); }} aria-expanded={dateOpen} aria-controls="team-custom-dates"><CalendarDays size={16} />Свой период<ChevronDown size={14} /></button></div>{dateOpen && <form id="team-custom-dates" className="tm-date-form" onSubmit={e => { e.preventDefault(); if (!draftError) choosePeriod(draft); }}><label>С даты<input type="date" aria-label="Начало периода сотрудников" value={draft.from} onInput={e => changeDraft('from', e.currentTarget.value)} onChange={e => changeDraft('from', e.target.value)} /></label><label>По дату<input type="date" aria-label="Конец периода сотрудников" value={draft.to} onInput={e => changeDraft('to', e.currentTarget.value)} onChange={e => changeDraft('to', e.target.value)} /></label><button type="submit" className="tm-primary" disabled={!!draftError}>Применить<ChevronRight size={16} /></button>{draftError && <p role="alert" className="tm-negative">{draftError}</p>}</form>}<footer><span><Clock3 size={12} />{teamPeriodLabel(period)}</span><span>{loading ? 'Обновляю данные…' : report ? `Обновлено в ${snapshot.updatedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} · автообновление 30 с` : 'Отчёт не загружен'}</span></footer></section>
    {error && <div className="tm-feedback" role="alert"><AlertTriangle size={18} /><span>{error}{report && <small>Показан последний загруженный отчёт за этот период. Экспорт доступен после успешного обновления.</small>}</span><button type="button" className="tm-button" onClick={load} disabled={loading}>Повторить</button></div>}
    <section className="tm-metrics" aria-label="Итоги команды">{[[Wallet, 'Выручка', totals?.revenue, '₽', 'После скидок, включая продажи в долг'], [ReceiptText, 'Чеки', totals?.orders, '', 'Завершённые продажи за период'], [BarChart3, 'Средний чек', totals?.aov, '₽', 'Выручка ÷ количество чеков'], [Users, 'Продавцов с продажами', report ? namedPeople : null, '', unknownOrders ? `Чеков без профиля: ${teamQuantity(unknownOrders)}` : 'Профили, на которые записаны продажи']].map(([Icon, label, value, unit, note], i) => <article key={label} className={`tm-panel ${i === 0 ? 'is-accent' : ''}`}><span>{label}<Icon size={17} /></span><strong className={value < 0 ? 'tm-negative' : ''}>{value == null ? '—' : formatMoney(value)}{unit && <small>{unit}</small>}</strong><p>{note}</p></article>)}</section>
    {!report ? <div className="tm-empty tm-panel" role={loading ? 'status' : undefined}>{loading ? <Loader2 size={30} className="tm-spin" /> : <Users size={30} />}<h2>{loading ? 'Собираю отчёт команды' : 'Отчёт пока недоступен'}</h2><p>{loading ? 'Загружаю продажи по профилям, датам и способам оплаты.' : 'Повторите загрузку или выберите другой период.'}</p></div> : !hasSales ? <div className="tm-empty tm-panel"><Search size={30} /><h2>За этот период продаж нет</h2><p>Выберите другие даты. Профили без продаж в этот отчёт не входят.</p></div> : <>
      <nav className="tm-view-tabs" aria-label="Разделы отчёта сотрудников">{[['overview', 'Обзор', BarChart3], ['employees', 'Продавцы', Users], ['rhythm', 'Ритм продаж', Clock3]].map(([id, label, Icon]) => <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}><Icon size={16} />{label}</button>)}</nav>
      {unknownOrders > 0 && <p className="tm-data-note"><AlertTriangle size={15} />Чеки без определённого профиля: {teamQuantity(unknownOrders)}. Они включены в выручку команды.</p>}
      {view === 'overview' && <><div className="tm-overview-grid"><TeamTrend series={series} /><section className="tm-panel tm-leader backdrop-blur-xl"><header className="tm-section-heading"><div><p className="tm-eyebrow">ВКЛАД В ВЫРУЧКУ</p><h2>Лидер за период</h2></div><Trophy size={20} /></header>{leader ? <><span className="tm-leader-avatar">{teamInitials(leader.name)}</span><h3>{leader.name}</h3><p>Наибольшая выручка среди определённых профилей.</p><strong>{formatMoney(leader.revenue)}<small> ₽</small></strong><dl><div><dt>Чеки</dt><dd>{teamQuantity(leader.orders)}</dd></div><div><dt>Средний чек</dt><dd>{formatMoney(leader.aov)} ₽</dd></div></dl><button type="button" className="tm-button" onClick={() => showPerson(leader.id)}>Показатели продавца<ArrowRight size={15} /></button></> : <div className="tm-inline-empty"><Users size={26} /><h3>Лидер не определён</h3><p>Нет определённых профилей с положительной выручкой.</p></div>}<footer>Сравнение сумм продаж не учитывает длительность смен.</footer></section></div><div className="tm-summary-grid"><TeamRoster {...rosterProps} compact onShowAll={() => { setQuery(''); setView('employees'); }} /><TeamPayments totals={totals} compact /></div></>}
      {view === 'employees' && <TeamRoster {...rosterProps} />}
      {view === 'rhythm' && <><div className="tm-rhythm-grid"><TeamRhythmChart type="hour" rows={hours} /><TeamRhythmChart type="weekday" rows={weekdays} /></div><TeamPayments totals={totals} /></>}
      <p className="tm-method-note"><Users size={16} /><span>Источник — продажи выбранной точки. Выручка отражает суммы после скидок и включает продажи в долг. Здесь нет расчёта зарплат, прибыли или выработки за час. В CSV выгружаются все профили за период, независимо от поиска и сортировки.</span></p>
    </>}
  </main>;
}
