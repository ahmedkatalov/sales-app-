import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, LayoutPanelTop, LogOut, Menu, PanelLeft, PanelLeftClose, PanelLeftOpen, Search, Settings, UserRound } from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import WorkspaceSwitcher from './WorkspaceSwitcher';
import NavigationDialog from './NavigationDialog';
import DesktopNavigation, { NavigationGroups, NavigationItem } from './DesktopNavigation';
import { mobileNavigation, navigationGroups, navigationRole } from '../utils/navigation';
import './AppShell.css';

const identity = path => path;
export default function AppShell({ children, links = [], session, workspace, profile, employees = [], employeeLoading = false, employeeError = '', onRetryEmployees, onProfileChange, onLogout, mode = 'sidebar', onToggleMode, sidebarOpen = true, onToggleSidebar, immersive = false, keyboardVisible = false, pendingCount = null, debtCount = null, currentPath: pathOverride, resolvePath = identity, loadWorkspaces, onSwitchWorkspace, themeControl, accessLoading = false }) {
  const location = useLocation(), currentPath = pathOverride || location.pathname;
  const worker = ['worker', 'workspace'].includes(session?.role);
  const [dialog, setDialog] = useState(null), [search, setSearch] = useState('');
  const contentRef = useRef(null);
  useLayoutEffect(() => { if (contentRef.current) { contentRef.current.scrollTop = 0; contentRef.current.scrollLeft = 0; } }, [currentPath, workspace?.dataAccountId]);
  const mobile = mobileNavigation(links, worker);
  const active = links.find(([path]) => path === currentPath);
  const navProps = { currentPath, resolvePath, pendingCount, debtCount };
  const theme = themeControl || <ThemeToggle className="sh-theme" />;
  const openMenu = () => { setSearch(''); setDialog('menu'); };
  useEffect(() => { setDialog(null); }, [currentPath, workspace?.dataAccountId, mode, immersive]);
  useEffect(() => {
    if (immersive) return;
    const onKey = e => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k' || e.altKey || document.body.classList.contains('modal-open')) return;
      const target = e.target;
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName)) return;
      e.preventDefault(); setSearch(''); setDialog('menu');
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [immersive]);
  const employeePicker = <label className="sh-profile-picker"><span><UserRound size={13} />Сейчас за кассой</span><select aria-label="Продавец за кассой" value={profile?.id || ''} onChange={e => { setDialog(null); onProfileChange?.(e.target.value); }} disabled={employeeLoading || !!employeeError || !employees.length}><option value="">{employeeLoading ? 'Загружаю продавцов…' : employeeError ? 'Продавцы недоступны' : employees.length ? 'Выберите продавца' : 'Нет доступных профилей'}</option>{employees.map(e => <option key={e.id} value={e.id}>{e.name}{e.hasPassword ? ' · с паролем' : ''}</option>)}</select>{employeeError && <small className="sh-profile-error" role="alert">{employeeError}<button type="button" onClick={onRetryEmployees}>Повторить</button></small>}</label>;
  const switcher = compact => <WorkspaceSwitcher key={workspace?.dataAccountId || 'current'} workspace={workspace} accountLabel={navigationRole(session?.role)} compact={compact} loadWorkspaces={loadWorkspaces} onSwitch={onSwitchWorkspace} />;
  return <div className={`app-shell sh-layout-${mode} ${sidebarOpen ? '' : 'sh-collapsed'} ${immersive ? 'sh-immersive' : ''}`}>
    {!immersive && <a className="sh-skip" href="#app-content" onClick={e => { e.preventDefault(); contentRef.current?.focus({ preventScroll: true }); }}>К содержимому</a>}
    {!immersive && <aside className="sh-sidebar"><div className="sh-sidebar-head">{switcher(!sidebarOpen)}<button type="button" className="sh-icon-button sh-collapse-button" aria-label={sidebarOpen ? 'Свернуть боковое меню' : 'Развернуть боковое меню'} onClick={onToggleSidebar}>{sidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}</button></div>{sidebarOpen && worker && <div className="sh-sidebar-profile">{employeePicker}</div>}<button type="button" className="sh-menu-search" aria-label="Найти раздел" onClick={openMenu}><Search size={17} /><span>Найти раздел</span><kbd>⌘ K</kbd></button><nav className="sh-sidebar-links" aria-label="Главное меню">{accessLoading ? <p className="sh-note">Загружаю доступы…</p> : <NavigationGroups links={links} compact={!sidebarOpen} {...navProps} />}</nav><footer className="sh-sidebar-footer"><div>{theme}<button type="button" className="sh-icon-button" aria-label="Перенести меню наверх" title="Перенести меню наверх" onClick={onToggleMode}><LayoutPanelTop size={18} /></button><button type="button" className="sh-icon-button sh-logout" aria-label="Выйти из аккаунта" title="Выйти из аккаунта" onClick={() => setDialog('logout')}><LogOut size={18} /></button></div>{sidebarOpen && <p>{profile?.name || session?.ownerName || session?.username || 'Рабочее пространство'}</p>}</footer></aside>}
    <div className="sh-stage">{!immersive && <header className="sh-header backdrop-blur-xl"><div className="sh-header-workspace">{switcher(false)}</div><div className="sh-page-context"><span>{workspace?.name || 'Рабочее пространство'}</span><ChevronRight size={13} /><strong>{active?.[1] || 'Раздел'}</strong></div><div className="sh-header-navigation"><DesktopNavigation links={links} {...navProps} worker={worker} onOpenMenu={openMenu} /></div><div className="sh-header-actions">{theme}<button type="button" className="sh-icon-button sh-layout-button" aria-label={mode === 'header' ? 'Перенести меню сбоку' : 'Перенести меню наверх'} title={mode === 'header' ? 'Меню сбоку' : 'Меню сверху'} onClick={onToggleMode}>{mode === 'header' ? <PanelLeft size={18} /> : <LayoutPanelTop size={18} />}</button>{links.some(([path]) => path === '/profile') && <Link className="sh-icon-button sh-settings-link" to={resolvePath('/profile')} aria-label="Настройки аккаунта"><Settings size={18} /></Link>}<button type="button" className="sh-icon-button sh-header-menu" onClick={openMenu} aria-label="Открыть все разделы" aria-haspopup="dialog"><Menu size={20} /></button></div></header>}
      {!immersive && worker && <div className="sh-mobile-profile">{employeePicker}</div>}
      <main ref={contentRef} tabIndex={-1} className="sh-content" id="app-content" key={workspace?.dataAccountId || 'current'}>{children}</main>
    </div>
    {!immersive && <nav className={`sh-mobile-dock hide-on-modal ${keyboardVisible ? 'is-keyboard-visible' : ''}`} aria-label="Нижняя навигация">{mobile.primary.map(item => <NavigationItem key={item[0]} item={item} {...navProps} />)}<button type="button" className={mobile.more.some(([path]) => path === currentPath) ? 'is-active' : ''} onClick={openMenu} aria-label="Ещё разделы" aria-haspopup="dialog"><Menu size={21} /><span>Ещё</span></button></nav>}
    {!immersive && dialog === 'menu' && <NavigationDialog title="Все разделы" onClose={() => setDialog(null)}><label className="sh-search"><Search size={17} /><input aria-label="Поиск по разделам" placeholder="Название раздела…" value={search} onChange={e => setSearch(e.target.value)} /></label>{worker && <div className="sh-dialog-profile">{employeePicker}</div>}<nav className="sh-menu-groups" aria-label="Все разделы приложения"><NavigationGroups links={links} query={search} {...navProps} onNavigate={() => setDialog(null)} /></nav>{!navigationGroups(links, search).length && <div className="sh-empty"><Search size={27} /><strong>{accessLoading ? 'Загружаю доступы…' : search.trim() ? 'Раздел не найден' : 'Нет доступных разделов'}</strong><p>{search.trim() ? 'Попробуйте другое название.' : accessLoading ? 'Доступные разделы появятся после загрузки прав.' : 'Доступ к разделам настраивает владелец аккаунта.'}</p></div>}<footer className="sh-dialog-footer"><span>{session?.username}<small>{navigationRole(session?.role)} · {workspace?.name}</small></span><button type="button" className="sh-button sh-logout" onClick={() => setDialog('logout')}><LogOut size={16} />Выйти</button></footer></NavigationDialog>}
    {!immersive && dialog === 'logout' && <NavigationDialog title="Выйти из аккаунта?" onClose={() => setDialog(null)}><p className="sh-dialog-copy">Сеанс на этом устройстве завершится. Для продолжения работы потребуется войти снова.</p><div className="sh-dialog-actions"><button type="button" className="sh-button" onClick={() => setDialog(null)}>Остаться</button><button type="button" className="sh-button sh-danger" onClick={() => { setDialog(null); onLogout(); }}><LogOut size={16} />Выйти из аккаунта</button></div></NavigationDialog>}
  </div>;
}
