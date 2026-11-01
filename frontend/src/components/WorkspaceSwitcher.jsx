import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AlertCircle, Check, ChevronDown, Loader2, Search, Star, Store } from 'lucide-react';
import { get, getCurrentWorkspace, setCurrentProfile, setCurrentWorkspace } from '../api';
import { navigationRole, sameWorkspace, validateNavigationWorkspaces } from '../utils/navigation';
import NavigationDialog from './NavigationDialog';

const readWorkspaces = () => get('/my-workspaces');
const applyWorkspace = ws => { setCurrentProfile(null); setCurrentWorkspace(ws); window.location.assign('/'); };
export default function WorkspaceSwitcher({ workspace, accountName, accountLabel, compact = false, loadWorkspaces = readWorkspaces, onSwitch = applyWorkspace }) {
  const current = workspace || getCurrentWorkspace();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [location.pathname, location.search]);
  return <><button type="button" className={`sh-workspace ${compact ? 'is-compact' : ''}`} title="Переключить точку" aria-label={`Выбрать точку: ${current?.name || accountName || 'Мой бизнес'}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><span className="sh-workspace-icon"><Store size={21} /></span><span><strong>{current?.name || accountName || 'Мой бизнес'}</strong><small>{accountLabel || 'Рабочая точка'}</small></span><ChevronDown size={14} /></button>{open && <WorkspacePicker key={`${current?.id}-${current?.dataAccountId}`} current={current} loadWorkspaces={loadWorkspaces} onSwitch={onSwitch} onClose={() => setOpen(false)} />}</>;
}
function WorkspacePicker({ current, loadWorkspaces, onSwitch, onClose }) {
  const [list, setList] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [search, setSearch] = useState(''), [switching, setSwitching] = useState(null);
  const sequence = useRef(0), mounted = useRef(true), switchingRef = useRef(false);
  const load = useCallback(async () => {
    const seq = ++sequence.current; setLoading(true); setError('');
    try { const response = validateNavigationWorkspaces(await loadWorkspaces()); if (seq === sequence.current) setList(response); }
    catch (e) { if (seq === sequence.current) setError(e.message || 'Не удалось загрузить точки.'); }
    finally { if (seq === sequence.current) setLoading(false); }
  }, [loadWorkspaces]);
  const cancel = useCallback(() => { mounted.current = false; sequence.current++; }, []);
  useEffect(() => { mounted.current = true; load(); return cancel; }, [load, cancel]);
  const select = async ws => {
    if (switchingRef.current || loading || error) return;
    if (sameWorkspace(ws, current)) { onClose(); return; }
    switchingRef.current = true; setSwitching(ws.id); setError('');
    try { await onSwitch(ws); if (mounted.current) onClose(); }
    catch (e) { if (mounted.current) setError(e.message || 'Не удалось переключить точку.'); }
    finally { switchingRef.current = false; if (mounted.current) setSwitching(null); }
  };
  const rows = (list || []).filter(w => w.name.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru')));
  return <NavigationDialog title="Выберите рабочую точку" busy={switching !== null} onClose={onClose}><p className="sh-note">Товары, склад, продавцы и отчёты откроются для выбранной точки.</p><label className="sh-search"><Search size={17} /><input aria-label="Найти точку" placeholder="Найти точку" value={search} onChange={e => setSearch(e.target.value)} disabled={switching !== null} /></label>{error && <div className="sh-feedback" role="alert"><AlertCircle size={18} /><span>{error}</span><button type="button" className="sh-button" onClick={load} disabled={loading || switching !== null}>Повторить</button></div>}{loading && <div className="sh-loading" role="status"><Loader2 size={23} className="sh-spin" />Загружаю доступные точки…</div>}{!loading && list !== null && <div className="sh-workspace-list">{rows.map(ws => <button key={`${ws.id}:${ws.dataAccountId}`} type="button" aria-pressed={sameWorkspace(ws, current)} disabled={!!error || switching !== null} onClick={() => select(ws)}><span className="sh-workspace-icon">{ws.isMain ? <Star size={20} /> : <Store size={20} />}</span><span><strong>{ws.name}</strong><small>{navigationRole(ws.role)}{ws.isMain ? ' · Основная точка' : ''}</small></span>{switching === ws.id ? <Loader2 size={18} className="sh-spin" /> : sameWorkspace(ws, current) && <span className="sh-selected"><Check size={15} />Выбрана</span>}</button>)}</div>}{!loading && !error && !rows.length && <div className="sh-empty"><Store size={28} /><strong>{list?.length ? 'Точка не найдена' : 'Нет доступных точек'}</strong><p>{list?.length ? 'Попробуйте другое название.' : 'Обратитесь к владельцу аккаунта, чтобы получить доступ.'}</p></div>}{!loading && !error && list?.length === 1 && <p className="sh-note">Вам доступна одна рабочая точка.</p>}</NavigationDialog>;
}
