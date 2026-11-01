import DebtsPage from './pages/DebtsPage';
import NavigationPreview from './components/NavigationPreview';
import EntryPreview from './components/EntryPreview';
import EmployeeAnalyticsPage from './pages/EmployeeAnalyticsPage';
import { teamPreviewWorkspace, teamPreviewOtherWorkspace, teamPreviewResponse, setTeamPreviewScenario } from './team-preview-data';
import ProfilePage from './pages/ProfilePage';
import { profilePreviewPoints, profilePreviewSession, profilePreviewResponse, setProfilePreviewScenario } from './profile-preview-data';
import AppearancePage from './pages/AppearancePage';
import FinanceReportPage from './pages/FinanceReportPage';
import { financePreviewResponse, financePreviewWorkspace, setFinancePreviewScenario } from './finance-preview-data';
import AnalyticsPage from './pages/AnalyticsPage';
import { analyticsPreviewResponse, analyticsPreviewWorkspace, setAnalyticsPreviewScenario } from './analytics-preview-data';
import SalesAnalyticsPage from './pages/SalesAnalyticsPage';
import { salesPreviewResponse, setSalesPreviewScenario } from './sales-preview-data';
import WarehousePage from './pages/WarehousePage';
import { setWarehousePreviewScenario, warehousePreviewResponse } from './warehouse-preview-data';
import AIWarehousePage from './pages/AIWarehousePage';
import { assistantPreviewChat, assistantPreviewResponse, assistantPreviewWorkspace, setAssistantPreviewScenario } from './assistant-preview-data';
import ExpensesPage from './pages/ExpensesPage';
import { expensesPreviewResponse, setExpensesPreviewScenario } from './expenses-preview-data';
import { debtsPreviewResponse, setDebtsPreviewScenario } from './debts-preview-data';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom';
import HomePage from './pages/HomePage';
import WorkPage from './pages/WorkPage';
import POSPage from './pages/POSPage';
import PendingPaymentsPage from './pages/PendingPaymentsPage';
import { posPreviewResponse, setPendingPreviewScenario } from './pos-preview-data';
import { workPreviewResponse } from './work-preview-data';
import { initAppearance, buildCss, getAppearance, PRESETS } from './theme/engine';
import { applyTheme, getTheme } from './theme';
import './index.css';

applyTheme(getTheme());
initAppearance();
const stats = {
  totalRevenue: 48750, cleanProfit: 18240, salesCount: 76, cashTotal: 19250, transferTotal: 29500, totalDiscount: 1250,
  topProducts: [
    { name: 'Капучино', qty: 324, revenue: 81000 },
    { name: 'Латте', qty: 248, revenue: 69440 },
    { name: 'Круассан с миндалём', qty: 186, revenue: 53940 },
    { name: 'Флэт уайт', qty: 172, revenue: 44720 },
    { name: 'Американо', qty: 210, revenue: 37800 },
  ],
};
window.fetch = async (url, options = {}) => {
  const teamData = teamPreviewResponse(url, options);
  if (teamData !== null) return teamData;
  const profileData = profilePreviewResponse(url, options);
  if (profileData !== null) return profileData;
  if ((new URLSearchParams(window.location.search).get('page') === 'appearance' || window.location.pathname === '/appearance') && String(url).includes('/settings/appearance')) {
    return new Response(JSON.stringify(new URLSearchParams(window.location.search).get('appearanceError') === '1' ? { error: 'Демо: не удалось сохранить оформление команды' } : { ok: true }), { status: new URLSearchParams(window.location.search).get('appearanceError') === '1' ? 500 : 200 });
  }
  const financeData = financePreviewResponse(url, options);
  if (financeData !== null) return financeData;
  const analyticsData = analyticsPreviewResponse(url, options);
  if (analyticsData !== null) return analyticsData;
  const salesData = salesPreviewResponse(url, options);
  if (salesData !== null) return salesData;
  const warehouseData = warehousePreviewResponse(url, options);
  if (warehouseData !== null) return warehouseData;
  const assistantData = assistantPreviewResponse(url, options);
  if (assistantData !== null) return assistantData;
  const expenseData = expensesPreviewResponse(url, options);
  if (expenseData !== null) return expenseData;
  const debtData = debtsPreviewResponse(url, options);
  if (debtData !== null) return debtData;
  const posData = posPreviewResponse(url, options);
  if (posData !== null) return posData;
  if (options.method && options.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Это предпросмотр дизайна. Изменения здесь не сохраняются.' }), { status: 400 });
  }
  const previewData = workPreviewResponse(url);
  if (previewData !== null) return new Response(JSON.stringify(previewData), { status: 200 });
  let data = [];
  if (url.includes('/sales/stats')) data = stats;
  if (url.includes('/sales/daily')) {
    data = { days: Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - 6 + index);
      return { date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`, revenue: [28500, 36700, 31200, 42100, 39800, 44500, 48750][index] };
    }) };
  }
  if (url.includes('/finance/opening')) data = { isSet: true };
  if (url.includes('/debts')) data = [{ status: 'open', amount: 6200 }];
  return new Response(JSON.stringify(data), { status: 200 });
};

const PREVIEW_ROUTES = { '/home': 'home', '/work': 'work', '/pos': 'pos', '/pending-payments': 'pending', '/debts': 'debts', '/expenses': 'expenses', '/ai-warehouse': 'assistant', '/warehouse': 'warehouse', '/sales-analytics': 'sales', '/analytics': 'analytics', '/finance': 'finance', '/appearance': 'appearance', '/profile': 'profile', '/team': 'team' };

function PreviewApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const routes = PREVIEW_ROUTES;
  const page = routes[location.pathname] || new URLSearchParams(location.search).get('page') || 'home';
  const [mode, setMode] = useState(getTheme());
  const [shellPreview] = useState(() => new URLSearchParams(location.search).get('shell') === '1');
  const [entryScenario, setEntryScenario] = useState('normal');
  const entryPage = page === 'login' || page === 'workspace';
  const [navRole, setNavRole] = useState('owner');
  const [navScenario, setNavScenario] = useState('normal');
  const [navMode, setNavMode] = useState('sidebar');
  useEffect(() => {
    const routedPage = PREVIEW_ROUTES[location.pathname];
    if (!routedPage) return;
    const params = new URLSearchParams(location.search);
    params.set('page', routedPage);
    if (shellPreview) params.set('shell', '1');
    navigate(`/design-preview.html?${params}`, { replace: true });
  }, [location.pathname, location.search, navigate, shellPreview]);
  const previewHref = key => `/design-preview.html?page=${key}${shellPreview ? '&shell=1' : ''}`;
  const [scenario, setScenario] = useState('normal');
  const [debtsScenario, setDebtsScenario] = useState('normal');
  const [expensesScenario, setExpensesScenario] = useState('normal');
  const [assistantScenario, setAssistantScenario] = useState('normal');
  const [warehouseScenario, setWarehouseScenario] = useState('normal');
  const [salesScenario, setSalesScenario] = useState('normal');
  const [analyticsScenario, setAnalyticsScenario] = useState('normal');
  const [financeScenario, setFinanceScenario] = useState('normal');
  const [profileScenario, setProfileScenario] = useState('normal');
  const [teamScenario, setTeamScenario] = useState('normal');
  const [teamPoint, setTeamPoint] = useState('center');
  const immersive = page === 'pos' || page === 'assistant';
  let previewPage = <HomePage />;
  if (page === 'team') previewPage = <EmployeeAnalyticsPage key={`${teamScenario}-${teamPoint}`} initialWorkspace={teamPoint === 'park' ? teamPreviewOtherWorkspace : teamPreviewWorkspace} />;
  else if (page === 'profile') previewPage = <ProfilePreview key={profileScenario} scenario={profileScenario} />;
  else if (page === 'appearance') previewPage = <AppearancePage preview roleOverride={new URLSearchParams(location.search).get('role') === 'admin' ? 'branch_admin' : 'owner'} />;
  else if (page === 'finance') previewPage = <FinanceReportPage key={financeScenario} initialWorkspace={financePreviewWorkspace} />;
  else if (page === 'analytics') previewPage = <AnalyticsPage key={analyticsScenario} initialWorkspace={analyticsPreviewWorkspace} roleOverride={analyticsScenario === 'worker' ? 'branch_admin' : 'owner'} />;
  else if (page === 'sales') previewPage = <SalesAnalyticsPage key={salesScenario} workspaceName="Noor Coffee" />;
  else if (page === 'warehouse') previewPage = <WarehousePage key={warehouseScenario} workspaceName="Noor Coffee" />;
  else if (page === 'assistant') previewPage = <AIWarehousePage key={assistantScenario} initialWorkspace={assistantPreviewWorkspace} initialChat={assistantPreviewChat(assistantScenario)} persistHistory={false} roleOverride="owner" />;
  else if (page === 'expenses') previewPage = <ExpensesPage key={expensesScenario} currentProfile={{ id: 1, name: 'Анна' }} workerMode={expensesScenario === 'worker'} />;
  else if (page === 'debts') previewPage = <DebtsPage key={debtsScenario} />;
  else if (page === 'pending') previewPage = <PendingPaymentsPage key={scenario} />;
  else if (page === 'work') previewPage = <WorkPage />;
  return (
    <div style={immersive || shellPreview ? { height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' } : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', padding: '12px 24px', color: 'var(--text-muted)', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
        <span style={{ marginRight: 'auto' }}>{shellPreview ? 'Навигация · демонстрационные данные' : 'Предпросмотр · демонстрационные данные'}</span>
        {shellPreview && <><select aria-label="Роль навигации (демо)" value={navRole} style={{background:'var(--surface)',color:'var(--text)',padding:'.4rem'}} onChange={e => { const role=e.target.value;setNavRole(role);navigate(previewHref(role === 'worker' ? 'pending' : role === 'limited' ? 'warehouse' : 'home')); }}><option value="owner">Владелец</option><option value="admin">Администратор</option><option value="worker">Кассир</option><option value="limited">Ограниченный доступ</option><option value="empty">Нет разделов</option></select><select aria-label="Точки навигации (демо)" value={navScenario} style={{background:'var(--surface)',color:'var(--text)',padding:'.4rem'}} onChange={e => setNavScenario(e.target.value)}><option value="normal">Доступные точки</option><option value="error">Ошибка точек</option><option value="empty">Нет точек</option></select></>}
        {!shellPreview && !entryPage && Object.entries({ home: 'Главная', work: 'Товары', pos: 'Касса', pending: 'К оплате', debts: 'Долги', expenses: 'Расходы', assistant: 'Помощник', warehouse: 'Склад', sales: 'Продажи', analytics: 'Аналитика', finance: 'Отчёт', appearance: 'Оформление', profile: 'Настройки', team: 'Сотрудники', login: 'Вход', workspace: 'Выбор точки' }).map(([key, label]) => (
          <button key={key} onClick={() => navigate(previewHref(key))}>{label}</button>
        ))}
        {page !== 'appearance' && <select aria-label="Проверить оформление" defaultValue="saved" style={{ background: 'var(--surface)', color: 'var(--text)', padding: '.4rem' }} onChange={(event) => {
          const preset = PRESETS.find(preset => preset.id === event.target.value);
          document.getElementById('appearance-style').textContent = buildCss(event.target.value === 'large' ? { ...getAppearance(), fontScale:1.2, density:'comfortable', radius:1.8 } : preset ? { ...preset.appearance, bg: preset.appearance.bg ?? null, surface: preset.appearance.surface ?? null } : getAppearance());
        }}>
          <option value="saved">Ваше оформление</option>
          <option value="large">Крупный текст · 120%</option>
          {PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
        </select>}
        {page !== 'appearance' && !shellPreview && !entryPage && <button onClick={() => { const next = mode === 'dark' ? 'light' : 'dark'; applyTheme(next); setMode(next); }}>{mode === 'dark' ? 'Светлая тема' : 'Тёмная тема'}</button>}
        {entryPage && <><button onClick={() => {setEntryScenario('normal');navigate(previewHref('login'));}}>Вход</button><button onClick={() => {setEntryScenario('normal');navigate(previewHref('workspace'));}}>Выбор точки</button><span style={{fontSize:11}}>Демо: любые вымышленные логин и пароль · код 123456 · данные аккаунта не меняются</span><select aria-label="Сценарий входа (демо)" value={entryScenario} style={{background:'var(--surface)',color:'var(--text)',padding:'.4rem'}} onChange={e => setEntryScenario(e.target.value)}>{Object.entries(page === 'login' ? {normal:'Ввод данных',otp:'Код отправлен',restored:'Возврат после перезагрузки','request-error':'Нет сети','rate-limit':'Слишком много попыток','expired-code':'Код истёк','invalid-response':'Неполный ответ входа'} : {normal:'Доступные точки','load-error':'Ошибка и повтор загрузки',empty:'Нет доступа',single:'Одна точка','invalid-points':'Неполные данные','long-name':'Длинное название','select-error':'Ошибка открытия'}).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></>}
        {page === 'team' && <><select aria-label="Состояние сотрудников (демо)" value={teamScenario} style={{ background:'var(--surface)',color:'var(--text)',padding:'.4rem' }} onChange={e => { setTeamPreviewScenario(e.target.value); setTeamScenario(e.target.value); }}>{Object.entries({normal:'Продажи команды',empty:'Нет продаж',zero:'Чеки с нулевой суммой',negative:'Отрицательные суммы',unassigned:'Без продавца',other:'Другие способы оплаты','load-error':'Ошибка загрузки','refresh-error':'Ошибка обновления',invalid:'Неполный отчёт',denied:'Нет доступа'}).map(([value,label]) => <option key={value} value={value}>Демо · {label}</option>)}</select><select aria-label="Точка сотрудников (демо)" value={teamPoint} style={{ background:'var(--surface)',color:'var(--text)',padding:'.4rem' }} onChange={e => setTeamPoint(e.target.value)}><option value="center">Центр</option><option value="park">Парк</option></select></>}
        {page === 'profile' && <select aria-label="Состояние настроек (демо)" value={profileScenario} style={{ background: 'var(--surface)', color: 'var(--text)', padding: '.4rem' }} onChange={event => { setProfilePreviewScenario(event.target.value); setProfileScenario(event.target.value); }}>{Object.entries({normal:'Настройки владельца',empty:'Пустые списки','load-error':'Ошибка загрузки','save-error':'Ошибка сохранения','refresh-error':'Сбой после сохранения','settings-error':'Настройки недоступны','managed-error':'Профили логина недоступны',invalid:'Неполные права',admin:'Администратор'}).map(([value,label]) => <option key={value} value={value}>Демо · {label}</option>)}</select>}
        {page === 'finance' && (
          <select aria-label="Состояние отчёта (демо)" value={financeScenario} style={{ background: 'var(--surface)', color: 'var(--text)', padding: '.4rem' }} onChange={(event) => { setFinancePreviewScenario(event.target.value); setFinanceScenario(event.target.value); }}>
            <option value="normal">Демо · финансовый отчёт</option>
            <option value="empty">Демо · нулевой отчёт</option>
            <option value="load-error">Демо · ошибка загрузки</option>
            <option value="refresh-error">Демо · ошибка обновления</option>
            <option value="opening-error">Демо · не загружены балансы</option>
            <option value="save-error">Демо · ошибка сохранения</option>
            <option value="after-save-error">Демо · сбой после сохранения</option>
            <option value="loss">Демо · убыток</option>
            <option value="overdrawn">Демо · отрицательная касса</option>
            <option value="invalid">Демо · неполный отчёт</option>
            <option value="denied">Демо · нет доступа</option>
          </select>
        )}
        {page === 'analytics' && (
          <select aria-label="Состояние аналитики (демо)" value={analyticsScenario} style={{ background: 'var(--surface)', color: 'var(--text)', padding: '.4rem' }} onChange={(event) => { setAnalyticsPreviewScenario(event.target.value); setAnalyticsScenario(event.target.value); }}>
            <option value="normal">Демо · аналитика</option>
            <option value="empty">Демо · нет записей</option>
            <option value="load-error">Демо · ошибка загрузки</option>
            <option value="refresh-error">Демо · ошибка обновления</option>
            <option value="point-error">Демо · недоступен филиал</option>
            <option value="loss">Демо · убыток</option>
            <option value="zero">Демо · нулевые записи</option>
            <option value="invalid">Демо · неполные данные</option>
            <option value="worker">Демо · только своя точка</option>
          </select>
        )}
        {page === 'sales' && (
          <select aria-label="Состояние продаж (демо)" value={salesScenario} style={{ background: 'var(--surface)', color: 'var(--text)', padding: '.4rem' }} onChange={(event) => { setSalesPreviewScenario(event.target.value); setSalesScenario(event.target.value); }}>
            <option value="normal">Демо · продажи</option>
            <option value="empty">Демо · без продаж</option>
            <option value="load-error">Демо · ошибка загрузки</option>
            <option value="refresh-error">Демо · ошибка обновления</option>
            <option value="loss">Демо · убыток</option>
            <option value="zero-cost">Демо · нулевая себестоимость</option>
            <option value="zero-revenue">Демо · скидки 100%</option>
          </select>
        )}
        {page === 'warehouse' && (
          <select aria-label="Состояние склада (демо)" value={warehouseScenario} style={{ background: 'var(--surface)', color: 'var(--text)', padding: '.4rem' }} onChange={(event) => { setWarehousePreviewScenario(event.target.value); setWarehouseScenario(event.target.value); }}>
            <option value="normal">Демо · склад</option>
            <option value="empty">Демо · пустой склад</option>
            <option value="load-error">Демо · ошибка загрузки</option>
            <option value="save-error">Демо · ошибка сохранения</option>
            <option value="refresh-error">Демо · ошибка обновления после записи</option>
            <option value="history-error">Демо · ошибка истории</option>
            <option value="duplicate-error">Демо · проверка дублей недоступна</option>
          </select>
        )}
        {page === 'assistant' && (
          <select aria-label="Состояние помощника (демо)" value={assistantScenario} style={{ background: 'var(--surface)', color: 'var(--text)', padding: '.4rem' }} onChange={(event) => { setAssistantPreviewScenario(event.target.value); setAssistantScenario(event.target.value); }}>
            <option value="normal">Демо · начало диалога</option>
            <option value="history">Демо · переписка</option>
            <option value="purchase">Демо · закупка</option>
            <option value="many-purchase">Демо · большая закупка</option>
            <option value="clarification">Демо · уточнение</option>
            <option value="context-error">Демо · ошибка данных</option>
            <option value="response-error">Демо · ошибка ответа</option>
            <option value="empty-stock">Демо · пустой склад</option>
          </select>
        )}
        {page === 'expenses' && (
          <select aria-label="Состояние расходов (демо)" value={expensesScenario} style={{ background: 'var(--surface)', color: 'var(--text)', padding: '.4rem' }} onChange={(event) => { setExpensesPreviewScenario(event.target.value); setExpensesScenario(event.target.value); }}>
            <option value="normal">Демо · расходы</option>
            <option value="empty">Демо · пусто</option>
            <option value="load-error">Демо · ошибка загрузки</option>
            <option value="save-error">Демо · ошибка сохранения</option>
            <option value="refresh-error">Демо · ошибка обновления после сохранения</option>
            <option value="photo-error">Демо · ошибка фото</option>
            <option value="finance-error">Демо · расчёты недоступны</option>
            <option value="worker">Демо · сотрудник</option>
          </select>
        )}
        {page === 'debts' && (
          <select aria-label="Состояние долгов (демо)" value={debtsScenario} style={{ background: 'var(--surface)', color: 'var(--text)', padding: '.4rem' }} onChange={(event) => { setDebtsPreviewScenario(event.target.value); setDebtsScenario(event.target.value); }}>
            <option value="normal">Демо · клиенты</option>
            <option value="empty">Демо · пусто</option>
            <option value="load-error">Демо · ошибка загрузки</option>
            <option value="payment-error">Демо · ошибка погашения</option>
            <option value="refresh-error">Демо · ошибка обновления после оплаты</option>
          </select>
        )}
        {page === 'pending' && (
          <select aria-label="Состояние очереди (демо)" value={scenario} style={{ background: 'var(--surface)', color: 'var(--text)', padding: '.4rem' }} onChange={(event) => { setPendingPreviewScenario(event.target.value); setScenario(event.target.value); }}>
            <option value="normal">Демо · очередь</option>
            <option value="empty">Демо · пусто</option>
            <option value="load-error">Демо · ошибка загрузки</option>
            <option value="cards-error">Демо · счета недоступны</option>
            <option value="payment-error">Демо · ошибка оплаты</option>
          </select>
        )}
      </div>
      {entryPage ? <EntryPreview key={`${page}-${entryScenario}`} page={page} scenario={entryScenario} themeControl={<button className="entry-secondary" type="button" onClick={() => {const next=mode === 'dark' ? 'light' : 'dark';applyTheme(next);setMode(next);}}>{mode === 'dark' ? 'Светлая тема' : 'Тёмная тема'}</button>} /> : shellPreview ? <NavigationPreview role={navRole} scenario={navScenario} mode={navMode} setMode={setNavMode} theme={mode} onThemeChange={next => { applyTheme(next); setMode(next); }} immersive={immersive} currentPath={Object.keys(routes).find(path => routes[path] === page) || '/home'} resolvePath={path => previewHref(routes[path] || 'home')}>
        {page === 'pos' ? <POSPage currentProfile={{ id:1,name:'Анна' }} ownerName="Анна" onExit={() => navigate(previewHref('home'))} /> : previewPage}
      </NavigationPreview> : page === 'pos' ? (
        <POSPage currentProfile={{ id: 1, name: 'Анна' }} ownerName="Анна" onExit={() => navigate('/design-preview.html?page=work')} />
      ) : page === 'assistant' ? previewPage : (
        <div style={{ padding: 'clamp(16px, 3vw, 40px)', maxWidth: 1600, margin: 'auto' }}>
          {previewPage}
        </div>
      )}
    </div>
  );
}

function ProfilePreview({ scenario }) {
  const [workspace, setWorkspace] = useState(profilePreviewPoints[0]);
  const [profile, setProfile] = useState({ id:21, name:'Алина', hasPassword:false });
  const [loggedOut, setLoggedOut] = useState(false);
  return loggedOut ? <div role="status">Демонстрационный сеанс завершён. Выберите сценарий настроек для продолжения.</div> : <ProfilePage preview session={{ ...profilePreviewSession, role:scenario === 'admin' ? 'branch_admin' : 'owner', username:scenario === 'admin' ? 'center.admin' : profilePreviewSession.username }} workspace={workspace} profile={profile} setProfile={setProfile} setWorkspaceState={setWorkspace} logout={() => setLoggedOut(true)} />;
}

export default function DesignPreview() {
  return <BrowserRouter><PreviewApp /></BrowserRouter>;
}
const previewRoot = import.meta.hot?.data.previewRoot || createRoot(document.getElementById('root'));
if (import.meta.hot) import.meta.hot.data.previewRoot = previewRoot;
previewRoot.render(<DesignPreview />);
