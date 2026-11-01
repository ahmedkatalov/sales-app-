import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3, Bot, Briefcase, Building2, Check, ChevronRight, Clock, CreditCard, FileText, KeyRound, LayoutDashboard, LockKeyhole, LogOut, Package, Palette, Plus, RefreshCw, Settings2, Share2, ShieldCheck, ShoppingCart, Store, Trash2, TrendingUp, UserRound, Users, Wallet } from 'lucide-react';
import { del, getSession, post, put, setCurrentProfile, setCurrentWorkspace, setSession } from '../api';
import InstallAppCard from '../components/InstallAppCard';
import ProfileSettings from '../components/ProfileSettings';
import AISettings from '../components/AISettings';
import { ProfileEditDialog, ProfileManagedProfiles } from '../components/ProfileDialogs';
import { ProfileEmpty as Empty, ProfilePanel as Panel, ProfileResource as Resource, ProfileSearch as Search, ProfileSuccess } from '../components/ProfileUI';
import { profileInitials, profileMatches, profilePages, profileRole } from '../utils/profile';
import useProfileResource from '../utils/useProfileResource';
import './ProfilePage.css';

const PAGES = [
  ['/pos', 'Касса', ShoppingCart], ['/pending-payments', 'К оплате', Clock], ['/debts', 'Долги', FileText], ['/expenses', 'Расходы', Wallet], ['/work', 'Товары', Briefcase], ['/warehouse', 'Склад', Package], ['/ai-warehouse', 'Помощник', Bot], ['/sales-analytics', 'Продажи', BarChart3], ['/analytics', 'Аналитика', TrendingUp],
].map(([path, label, icon]) => ({ path, label, icon }));
const TABS = [
  ['overview', 'Обзор', LayoutDashboard, 'Аккаунт и рабочее пространство'], ['settings', 'Настройки точки', Settings2, 'Рабочий день и подключения'], ['ai', 'ИИ и модели', Bot, 'Провайдер, модель и API-ключ'], ['branches', 'Точки', Building2, 'Магазины и филиалы'], ['accounts', 'Логины', KeyRound, 'Вход в приложение'], ['employees', 'Продавцы', Users, 'Кто работает за кассой'], ['access', 'Доступ к точкам', Share2, 'Несколько точек для логина'], ['permissions', 'Права на страницы', ShieldCheck, 'Возможности кассиров'], ['cards', 'Карты', CreditCard, 'Учёт переводов и расходов'],
];
const idEqual = (a, b) => String(a) === String(b);
const titleFor = id => TABS.find(t => t[0] === id)?.[1] || 'Обзор';

export default function ProfilePage(props) {
  const key = `${props.session?.ownerAccountId || props.session?.accountId}-${props.session?.role}-${props.workspace?.id}-${props.workspace?.dataAccountId}`;
  return <ProfileWorkspace key={key} {...props} />;
}

function ProfileWorkspace({ session, workspace, profile, setProfile, setWorkspaceState, logout, preview = false }) {
  const isOwner = session?.role === 'owner', isManager = isOwner || ['branch_admin', 'admin'].includes(session?.role);
  const dataAccountId = workspace?.dataAccountId || session?.dataAccountId || session?.accountId;
  const tabs = TABS.filter(t => isOwner || (isManager ? ['overview', 'settings', 'ai', 'accounts', 'employees', 'cards'].includes(t[0]) : ['overview', 'employees'].includes(t[0])));
  const [active, setActive] = useState(() => { const section = new URLSearchParams(window.location.search).get('section'); return tabs.some(t => t[0] === section) ? section : 'overview'; });
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [pointFilter, setPointFilter] = useState('all');
  const [dialog, setDialog] = useState(null);
  const [success, setSuccess] = useState('');
  const [ownerName, setOwnerName] = useState(session?.ownerName || '');
  const [savedOwnerName, setSavedOwnerName] = useState(session?.ownerName || '');
  const [ownerBusy, setOwnerBusy] = useState(false), [ownerError, setOwnerError] = useState('');
  const savingOwner = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const employees = useProfileResource('/employees', dataAccountId);
  const users = useProfileResource('/workspace-users', dataAccountId, isManager);
  const cards = useProfileResource('/cards', dataAccountId, isManager);
  const points = useProfileResource('/workspaces', dataAccountId, isOwner);
  const access = useProfileResource('/workspace-access', dataAccountId, isOwner);
  const permissions = useProfileResource('/user-permissions', dataAccountId, isOwner);
  const currentUsers = useMemo(() => (users.data || []).filter(u => isOwner || idEqual(u.workspaceId, workspace?.id)), [users.data, isOwner, workspace?.id]);
  const allResources = [employees, ...(isManager ? [users, cards] : []), ...(isOwner ? [points, access, permissions] : [])];
  const loading = allResources.some(r => r.loading);
  const changeTab = id => { setActive(id); setQuery(''); setRoleFilter('all'); setPointFilter('all'); };
  const open = next => { setSuccess(''); setDialog(next); };
  const refresh = () => { allResources.forEach(r => r.reload()); };
  const chooseProfile = employee => { if (!preview) setCurrentProfile(employee); setProfile(employee); };
  const switchPoint = point => { if (!isOwner || idEqual(point.id, workspace?.id)) return; if (!preview) { setCurrentWorkspace(point); setCurrentProfile(null); } setProfile(null); setWorkspaceState(point); };
  const listReady = (...rs) => rs.every(r => r.ready);
  const filteredUsers = currentUsers.filter(u => profileMatches(query, u.username, u.workspaceName) && (roleFilter === 'all' || (roleFilter === 'worker' ? ['worker', 'workspace'].includes(u.role) : u.role === roleFilter)) && (pointFilter === 'all' || idEqual(u.workspaceId, pointFilter)));
  const filteredEmployees = (employees.data || []).filter(e => profileMatches(query, e.name));
  const filteredPoints = (points.data || []).filter(w => profileMatches(query, w.name));
  const filteredCards = (cards.data || []).filter(c => profileMatches(query, c.name, c.owner));
  const assignableUsers = filteredUsers.filter(u => ['worker', 'workspace'].includes(u.role));
  const userCount = id => (users.data || []).filter(u => idEqual(u.workspaceId, id)).length;
  const actions = (text, kind, enabled = true) => <button type="button" className="pr-primary" disabled={!enabled} onClick={() => open({ kind })}><Plus size={16} />{text}</button>;
  const noResults = <Empty title="Ничего не найдено" desc="Измените запрос или фильтр." />;

  const submitDialog = async form => {
    const d = dialog, target = d.target, opts = { dataAccountId };
    let refreshResource, text = 'Изменения сохранены.';
    if (d.kind === 'workspace') {
      if (!isOwner) throw new Error('Создавать точки может только владелец.');
      if (!form.name.trim()) throw new Error('Введите название точки.');
      const created = await post('/workspaces', { name: form.name.trim() }, opts);
      if (!created?.id || !created?.dataAccountId) throw new Error('Создание точки не подтверждено.');
      if (!mounted.current) return;
      setDialog(null); switchPoint(created); return;
    } else if (d.kind === 'account') {
      if (!isManager || !users.ready) throw new Error('Обновите список логинов.');
      if (!form.username.trim() || !form.password.trim() || !form.workspaceId) throw new Error('Заполните логин, пароль и точку.');
      await post('/workspace-users', { workspaceId: Number(isOwner ? form.workspaceId : workspace.id), username: form.username.trim(), password: form.password, role: form.role }, opts);
      refreshResource = users; text = 'Логин создан.';
    } else if (d.kind === 'employee') {
      if (!isManager || !employees.ready) throw new Error('Обновите список продавцов.');
      if (!form.name.trim()) throw new Error('Введите имя продавца.');
      const employee = await post('/employees', { name: form.name.trim(), password: form.password.trim() }, opts);
      if (!employee?.id) throw new Error('Создание продавца не подтверждено.');
      if (!mounted.current) return;
      chooseProfile(employee); refreshResource = employees; text = 'Продавец добавлен и выбран за кассу.';
    } else if (d.kind === 'card') {
      if (!isManager || !cards.ready) throw new Error('Обновите список карт.');
      if (!form.name.trim()) throw new Error('Введите название карты.');
      const result = await post('/cards', { name: form.name.trim(), owner: form.owner.trim() }, opts);
      if (!result?.id) throw new Error('Создание карты не подтверждено.');
      refreshResource = cards; text = 'Карта добавлена.';
    } else if (d.kind === 'access') {
      if (!isOwner || !listReady(users, points, access)) throw new Error('Обновите логины, точки и доступы.');
      if (!form.userId || !form.workspaceId) throw new Error('Выберите пользователя и точку.');
      await post('/workspace-access', { userId: Number(form.userId), workspaceId: Number(form.workspaceId), role: form.role }, opts);
      refreshResource = access; text = 'Доступ к точке сохранён.';
    } else if (d.kind === 'permissions') {
      if (!isOwner || !permissions.ready) throw new Error('Обновите права доступа.');
      const result = await put(`/user-permissions/${target.id}`, { workspaceId: target.workspaceId || 0, pages: form.pages }, opts);
      if (!result?.pages) throw new Error('Сохранение прав не подтверждено.');
      refreshResource = permissions; text = 'Права на страницы сохранены. Они применятся у пользователя после обновления доступа.';
    } else if (d.kind === 'verify') {
      const result = await post(`/employees/${target.id}/verify`, { password: form.password.trim() }, opts);
      if (!result?.ok) throw new Error(result?.error || 'Неверный пароль продавца.');
      if (!mounted.current) return;
      chooseProfile(target); text = `За кассой: ${target.name}.`;
    } else if (d.kind === 'delete') {
      if (!isManager || (!isOwner && d.entity === 'access')) throw new Error('Недостаточно прав.');
      const map = { account: ['/workspace-users', users], employee: ['/employees', employees], card: ['/cards', cards], access: ['/workspace-access', access] };
      const [path, resource] = map[d.entity];
      if (!resource.ready) throw new Error('Обновите список перед удалением.');
      await del(`${path}/${target.id}`, undefined, opts);
      if (!mounted.current) return;
      if (d.entity === 'employee' && idEqual(profile?.id, target.id)) chooseProfile(null);
      refreshResource = resource; text = d.entity === 'access' ? 'Доступ к точке убран.' : d.entity === 'card' ? 'Карта скрыта из выбора. В прошлых операциях её название сохранится.' : 'Запись удалена.';
    } else if (d.kind === 'rotate') {
      if (!isManager) throw new Error('Недостаточно прав.');
      await d.run(); text = 'Новый ключ создан. Обновите ключ в настройках сайта меню.';
    } else if (d.kind === 'logout') { logout(); return; }
    if (!mounted.current) return;
    setDialog(null); setSuccess(text);
    if (refreshResource) await refreshResource.reload();
  };
  const deleteDialog = (entity, target) => open({ kind: 'delete', entity, target, description: entity === 'account' ? 'Логин будет удалён. Пользователь больше не сможет войти с этим логином.' : entity === 'employee' ? 'Профиль исчезнет из списка продавцов. Для новых продаж его больше нельзя будет выбрать.' : entity === 'card' ? 'Карта исчезнет из выбора для новых операций. Название карты в прошлых операциях сохранится.' : 'Дополнительный доступ пользователя к этой точке будет убран.' });

  return <main className="profile-page">
    <header className="pr-heading"><div><p className="pr-eyebrow">УПРАВЛЕНИЕ / {profileRole(session?.role).toUpperCase()}</p><h1>Настройки</h1><p>Команда, рабочие точки и всё, что связывает их вместе.</p></div><div className="pr-heading-actions"><button type="button" className="pr-button" disabled={loading} onClick={refresh}><RefreshCw size={16} className={loading ? 'pr-spin' : ''} />Обновить</button><button type="button" className="pr-button" onClick={() => open({ kind: 'logout' })}><LogOut size={16} />Выйти</button></div></header>
    <div className="pr-context"><span className="pr-avatar"><Store size={20} /></span><div><small>ТЕКУЩЕЕ ПРОСТРАНСТВО</small><strong>{workspace?.name || 'Основная точка'}</strong></div><span className="pr-badge"><ShieldCheck size={13} />{profileRole(session?.role)}</span><span className="pr-context-profile"><UserRound size={15} />{profile?.name || 'Продавец не выбран'}</span></div>
    <div className="pr-layout"><aside className="pr-sidebar"><nav aria-label="Разделы настроек">{tabs.map(([id, label, Icon, desc]) => <button key={id} type="button" aria-pressed={active === id} onClick={() => changeTab(id)}><span><Icon size={18} /></span><span><strong>{label}</strong><small>{desc}</small></span><ChevronRight size={14} /></button>)}</nav><Link className="pr-appearance-link" to={preview ? '/design-preview.html?page=appearance' : '/appearance'}><Palette size={18} /><span><strong>Оформление</strong><small>Тема, цвета и удобство</small></span><ArrowRight size={15} /></Link><p className="pr-sidebar-note">Данные продавцов и карт относятся к выбранной точке.</p></aside>
      <div className="pr-content" key={active}>{success && <ProfileSuccess text={success} />}
        {active === 'overview' && <>
          <section className="pr-overview-hero app-aurora backdrop-blur-xl"><div className="pr-identity"><span className="pr-identity-avatar">{profileInitials(isOwner ? savedOwnerName || session?.username : session?.username)}</span><div><p className="pr-eyebrow">ВАШ АККАУНТ</p><h2>{(isOwner ? savedOwnerName : '') || session?.username || 'Аккаунт'}</h2><p>{session?.username}</p><span className="pr-badge"><ShieldCheck size={12} />{profileRole(session?.role)}</span></div></div><div className="pr-identity-detail"><span>Рабочая точка</span><strong>{workspace?.name || 'Основная точка'}</strong><small>{workspace?.isMain ? 'Основная точка' : 'Филиал'} · отдельные товары, склад и продажи</small></div></section>
          <div className="pr-metrics">{[...(isOwner ? [[points, 'Точек', Building2, 'branches']] : []), [users, 'Логинов', KeyRound, 'accounts'], [employees, 'Продавцов в точке', Users, 'employees'], [cards, 'Карт в точке', CreditCard, 'cards']].filter(([, , , id]) => tabs.some(t => t[0] === id)).map(([r, label, Icon, id]) => <button key={label} type="button" onClick={() => changeTab(id)}><span>{label}<Icon size={16} /></span><strong>{r.error ? '—' : r.data ? id === 'accounts' ? currentUsers.length : r.data.length : '…'}</strong><small>{r.error ? 'Не удалось загрузить' : 'Открыть раздел'}<ArrowRight size={12} /></small></button>)}</div>
          <div className="pr-overview-grid"><Panel title="Быстрый доступ" eyebrow="РАБОЧЕЕ ПРОСТРАНСТВО" desc="Основные действия для ежедневной работы."><div className="pr-shortcuts">{tabs.filter(t => ['settings', 'employees', 'accounts', 'permissions'].includes(t[0])).map(([id, label, Icon, desc]) => <button type="button" key={id} onClick={() => changeTab(id)}><span className="pr-avatar"><Icon size={18} /></span><span><strong>{label}</strong><small>{desc}</small></span><ChevronRight size={16} /></button>)}</div></Panel><Panel title={isOwner ? 'Профиль владельца' : 'Ваш профиль'} eyebrow="ЛИЧНЫЕ ДАННЫЕ" icon={UserRound} desc={isOwner ? 'Это имя отображается в вашем рабочем пространстве.' : 'Ваш вход и роль в приложении.'}>{isOwner ? <form onSubmit={async e => { e.preventDefault(); if (savingOwner.current || !ownerName.trim()) return; savingOwner.current = true; setOwnerBusy(true); setOwnerError(''); try { const result = await put('/account', { name: ownerName.trim() }, { dataAccountId }); if (!result?.ok) throw new Error('Сервер не подтвердил сохранение.'); if (!mounted.current) return; if (!preview) { const s = getSession(); if (s) { setSession({ ...s, ownerName: ownerName.trim() }); } } setSavedOwnerName(ownerName.trim()); setSuccess('Имя владельца сохранено.'); } catch (err) { if (mounted.current) setOwnerError(err.message || 'Не удалось сохранить имя.'); } finally { savingOwner.current = false; if (mounted.current) setOwnerBusy(false); } }}><fieldset disabled={ownerBusy}><label className="pr-label">Имя владельца<input value={ownerName} onChange={e => setOwnerName(e.target.value)} maxLength={60} required placeholder="Как к вам обращаться" /></label><button type="submit" className="pr-primary" disabled={!ownerName.trim() || ownerName.trim() === savedOwnerName}>{ownerBusy ? 'Сохраняю…' : 'Сохранить имя'}</button></fieldset>{ownerError && <p className="pr-field-error" role="alert">{ownerError}</p>}</form> : <dl className="pr-account-info"><div><dt>Логин</dt><dd>{session?.username}</dd></div><div><dt>Роль</dt><dd>{profileRole(session?.role)}</dd></div></dl>}</Panel></div>
          <div className="pr-install"><InstallAppCard /></div>
        </>}
        {active === 'settings' && isManager && <ProfileSettings dataAccountId={dataAccountId} preview={preview} onRotate={run => open({ kind: 'rotate', run })} />}
        {active === 'ai' && isManager && <AISettings dataAccountId={dataAccountId} />}
        {active === 'branches' && isOwner && <Panel title="Точки и филиалы" eyebrow="ВАШ БИЗНЕС" desc="У каждой точки свои товары, склад, продавцы и продажи. Выберите точку для работы." action={actions('Новая точка', 'workspace', points.ready)}><Resource resource={points}><Search value={query} onChange={setQuery} label="Найти точку" /><div className="pr-points-grid">{filteredPoints.map(w => <button type="button" key={w.id} className={`pr-point-card ${idEqual(w.id, workspace?.id) ? 'is-active' : ''}`} aria-pressed={idEqual(w.id, workspace?.id)} onClick={() => switchPoint(w)}><header><span className="pr-avatar"><Building2 size={20} /></span><span className="pr-badge">{idEqual(w.id, workspace?.id) ? <><Check size={12} />Выбрана</> : w.isMain ? 'Основная' : 'Филиал'}</span></header><strong>{w.name}</strong><footer><span>{users.error ? 'Логины недоступны' : users.data ? `Логинов: ${userCount(w.id)}` : 'Загрузка логинов…'}</span><ArrowRight size={16} /></footer></button>)}</div>{!filteredPoints.length && noResults}</Resource></Panel>}
        {active === 'accounts' && isManager && <Panel title="Логины для входа" eyebrow="КОМАНДА" desc="Логин определяет точку и роль. Под ним можно создать несколько профилей продавцов." action={actions('Создать логин', 'account', users.ready && (!isOwner || points.ready))}><Resource resource={users}><div className="pr-list-toolbar"><Search value={query} onChange={setQuery} label="Найти логин" /><select aria-label="Роль логина" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}><option value="all">Все роли</option><option value="worker">Кассиры</option><option value="branch_admin">Администраторы</option></select>{isOwner && <select aria-label="Точка логина" value={pointFilter} onChange={e => setPointFilter(e.target.value)}><option value="all">Все точки</option>{points.data?.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>}</div><div className="pr-entity-list">{filteredUsers.map(u => <article key={u.id}><span className="pr-avatar"><KeyRound size={19} /></span><div className="pr-entity-info"><h3>{u.username}</h3><p>{u.workspaceName}<span className="pr-badge">{profileRole(u.role)}</span></p></div><div className="pr-entity-actions"><button type="button" className="pr-button" disabled={!users.ready || !u.dataAccountId} onClick={() => open({ kind: 'manage', target: u })}><Users size={14} />Продавцы</button><button type="button" className="pr-icon-button pr-delete" disabled={!users.ready} aria-label={`Удалить логин «${u.username}»`} onClick={() => deleteDialog('account', u)}><Trash2 size={15} /></button></div></article>)}</div>{!filteredUsers.length && (currentUsers.length ? noResults : <Empty icon={KeyRound} title="Логинов пока нет" desc="Создайте отдельный вход для сотрудника и выберите его роль." />)}</Resource></Panel>}
        {active === 'employees' && <Panel title="Продавцы" eyebrow="РАБОТА ЗА КАССОЙ" desc="Выберите, чьё имя попадёт в новые чеки. Профиль продавца и логин для входа — разные настройки." action={isManager && actions('Добавить продавца', 'employee', employees.ready)}><Resource resource={employees}><Search value={query} onChange={setQuery} label="Найти продавца" /><div className="pr-employees-grid">{filteredEmployees.map(e => { const selected = idEqual(e.id, profile?.id); return <article key={e.id} className={`pr-employee-card ${selected ? 'is-active' : ''}`}><header><span className="pr-avatar">{profileInitials(e.name)}</span>{selected ? <span className="pr-badge"><Check size={12} />За кассой</span> : e.hasPassword ? <LockKeyhole size={15} /> : <UserRound size={15} />}</header><h3>{e.name}</h3><p>{e.hasPassword ? 'Вход с паролем' : 'Без пароля продавца'}</p><footer><button type="button" className="pr-button" disabled={selected || !employees.ready} onClick={() => e.hasPassword ? open({ kind: 'verify', target: e }) : chooseProfile(e)}>{selected ? 'Выбран' : 'Выбрать за кассу'}<ArrowRight size={14} /></button>{isManager && <button type="button" className="pr-icon-button pr-delete" disabled={!employees.ready} aria-label={`Удалить продавца «${e.name}»`} onClick={() => deleteDialog('employee', e)}><Trash2 size={15} /></button>}</footer></article>; })}</div>{!filteredEmployees.length && (employees.data?.length ? noResults : <Empty icon={Users} title="Добавьте первого продавца" desc="Его имя будет отображаться в чеках и отчётах по продажам." />)}</Resource></Panel>}
        {active === 'access' && isOwner && <Panel title="Доступ к нескольким точкам" eyebrow="КОМАНДА И ФИЛИАЛЫ" desc="Дополнительная точка для существующего логина. Роль настраивается отдельно для каждого доступа." action={actions('Добавить доступ', 'access', listReady(access, users, points) && !!users.data?.length && !!points.data?.length)}><Resource resource={access}><Search value={query} onChange={setQuery} label="Найти доступ" /><div className="pr-entity-list">{access.data?.filter(a => profileMatches(query, a.username, a.workspaceName)).map(a => <article key={a.id}><span className="pr-avatar"><Share2 size={19} /></span><div className="pr-entity-info"><h3>{a.username}</h3><p>{a.workspaceName}<span className="pr-badge">{profileRole(a.role)}</span></p></div><button type="button" className="pr-button pr-delete" disabled={!access.ready} onClick={() => deleteDialog('access', a)}>Убрать доступ</button></article>)}</div>{!access.data?.length && <Empty icon={Share2} title="Дополнительных доступов нет" desc="Дайте одному логину возможность работать в нескольких точках." />}{!!access.data?.length && !access.data.some(a => profileMatches(query, a.username, a.workspaceName)) && noResults}</Resource></Panel>}
        {active === 'permissions' && isOwner && <Panel title="Права на страницы" eyebrow="ВОЗМОЖНОСТИ КАССИРОВ" desc="Настройте доступ к разделам для каждого логина. У владельца и администраторов полный доступ к страницам в рамках их роли."><Resource resource={users}><Resource resource={permissions}><Search value={query} onChange={setQuery} label="Найти кассира" /><div className="pr-permissions-list">{assignableUsers.map(u => { const selected = profilePages(permissions.data || [], u); return <article key={u.id}><header><span className="pr-avatar"><ShieldCheck size={19} /></span><div><h3>{u.username}</h3><p>{u.workspaceName}</p></div><button type="button" className="pr-button" disabled={!selected || !listReady(users, permissions)} onClick={() => open({ kind: 'permissions', target: u, pages: selected })}>Настроить</button></header><div className="pr-page-tags">{selected === null ? <span className="pr-field-error">Не удалось прочитать права. Обновите данные.</span> : selected.includes('*') ? <span className="pr-badge"><Check size={12} />Полный доступ к страницам</span> : selected.length ? selected.map(path => { const p = PAGES.find(p => p.path === path); return <span key={path} className="pr-badge">{p && <p.icon size={12} />}{p?.label || path}</span>; }) : <span className="pr-inline-note">Ни одной страницы не выбрано</span>}</div></article>; })}</div>{!assignableUsers.length && <Empty icon={ShieldCheck} title="Кассиры не найдены" desc="Создайте логин кассира в разделе «Логины» или измените поиск." />}</Resource></Resource></Panel>}
        {active === 'cards' && isManager && <Panel title="Карты для учёта" eyebrow="БЕЗНАЛИЧНЫЕ ОПЕРАЦИИ" desc="Названия карт используются при записи переводов и расходов. Банковские реквизиты здесь не требуются." action={actions('Добавить карту', 'card', cards.ready)}><Resource resource={cards}><Search value={query} onChange={setQuery} label="Найти карту или владельца" /><div className="pr-cards-grid">{filteredCards.map(c => <article key={c.id} className="pr-bank-card"><header><CreditCard size={24} /><span className="pr-eyebrow">КАРТА ДЛЯ УЧЁТА</span></header><h3>{c.name}</h3><p>{c.owner || 'Владелец не указан'}</p><footer><span>Переводы и расходы</span><button type="button" className="pr-icon-button pr-delete" disabled={!cards.ready} aria-label={`Удалить карту «${c.name}»`} onClick={() => deleteDialog('card', c)}><Trash2 size={15} /></button></footer></article>)}</div>{!filteredCards.length && (cards.data?.length ? noResults : <Empty icon={CreditCard} title="Карт пока нет" desc="Добавьте название карты для учёта безналичных операций." />)}</Resource></Panel>}
        <footer className="pr-content-footer"><span>{titleFor(active)}</span><span>{workspace?.name || 'Основная точка'}</span></footer>
      </div>
    </div>
    {dialog?.kind === 'manage' ? <ProfileManagedProfiles key={dialog.target.id} account={dialog.target} onClose={() => setDialog(null)} onChanged={(id, removedId) => { if (idEqual(id, dataAccountId)) { employees.reload(); if (removedId && idEqual(removedId, profile?.id)) chooseProfile(null); } }} /> : dialog && <ProfileEditDialog key={`${dialog.kind}-${dialog.target?.id || ''}`} dialog={dialog} onClose={() => setDialog(null)} onSubmit={submitDialog} workspaces={points.data || []} users={currentUsers} workspaceId={workspace?.id} isOwner={isOwner} pages={PAGES} />}
  </main>;
}
