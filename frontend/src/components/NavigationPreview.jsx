import { useCallback, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import AppShell from './AppShell';
import NavigationDialog from './NavigationDialog';
import { OWNER_LINKS, WORKER_LINKS } from '../utils/navigation';
import { profilePreviewPoints } from '../profile-preview-data';

const EMPLOYEES = [{ id: 21, name: 'Алина', hasPassword: false }, { id: 22, name: 'Михаил', hasPassword: true }];
export default function NavigationPreview({ children, currentPath, resolvePath, role, scenario, mode, setMode, theme, onThemeChange, immersive }) {
  const [workspace, setWorkspace] = useState(profilePreviewPoints[0]);
  const [profile, setProfile] = useState(EMPLOYEES[0]);
  const [expanded, setExpanded] = useState(true), [loggedOut, setLoggedOut] = useState(false);
  const [prompt, setPrompt] = useState(null), [password, setPassword] = useState(''), [error, setError] = useState('');
  const worker = role === 'worker' || role === 'limited' || role === 'empty';
  const links = role === 'empty' ? [] : role === 'limited' ? OWNER_LINKS.filter(([path]) => ['/warehouse', '/debts'].includes(path)) : worker ? WORKER_LINKS : OWNER_LINKS;
  const loadWorkspaces = useCallback(async () => {
    if (scenario === 'error') throw new Error('Демо: точки не загрузились. Попробуйте ещё раз.');
    if (scenario === 'empty') return [];
    return profilePreviewPoints.map(point => ({ ...point, role: worker ? 'worker' : role === 'admin' ? 'branch_admin' : 'owner' }));
  }, [scenario, worker, role]);
  const pickProfile = value => { const person = EMPLOYEES.find(e => String(e.id) === value); if (person?.hasPassword) { setPrompt(person); setPassword(''); setError(''); } else setProfile(person || null); };
  if (loggedOut) return <div className="sh-empty" role="status"><strong>Демонстрационный сеанс завершён</strong><p>Настоящий аккаунт не изменён.</p><button type="button" className="sh-button" onClick={() => setLoggedOut(false)}>Вернуться к предпросмотру</button></div>;
  const Icon = theme === 'dark' ? Sun : Moon;
  return <div className="navigation-preview-root"><AppShell links={links} session={{ role: worker ? 'worker' : role === 'admin' ? 'branch_admin' : 'owner', username: worker ? 'demo.cashier' : 'demo.owner', ownerName: 'Анна' }} workspace={workspace} profile={profile} employees={EMPLOYEES} onProfileChange={pickProfile} onLogout={() => setLoggedOut(true)} mode={mode} onToggleMode={() => setMode(v => v === 'header' ? 'sidebar' : 'header')} sidebarOpen={expanded} onToggleSidebar={() => setExpanded(v => !v)} immersive={immersive} currentPath={currentPath} resolvePath={resolvePath} pendingCount={workspace.id === 1 ? 7 : 2} debtCount={workspace.id === 1 ? 12 : 1} loadWorkspaces={loadWorkspaces} onSwitchWorkspace={async point => { setWorkspace(point); setProfile(null); }} themeControl={<button type="button" className="sh-theme" aria-label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'} onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}><Icon size={18} /></button>}>{children}</AppShell>{prompt && <NavigationDialog title="Пароль продавца" onClose={() => setPrompt(null)}><p className="sh-note">Демо-профиль «{prompt.name}». Для проверки используйте пароль demo.</p><form onSubmit={e => { e.preventDefault(); if (password !== 'demo') { setError('Неверный пароль'); return; } setProfile(prompt); setPrompt(null); }}><input className="sh-password-input" aria-label="Пароль продавца" type="password" value={password} onChange={e => setPassword(e.target.value)} />{error && <p className="sh-profile-error" role="alert">{error}</p>}<div className="sh-dialog-actions"><button type="button" className="sh-button" onClick={() => setPrompt(null)}>Отмена</button><button type="submit" className="sh-button">Выбрать продавца</button></div></form></NavigationDialog>}</div>;
}
