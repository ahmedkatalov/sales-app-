import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Info, LoaderCircle, LogOut, RefreshCw, Search, ShieldCheck, Star, Store, UserRound } from 'lucide-react';
import { get, setCurrentWorkspace } from '../api';
import EntryLayout from '../components/EntryLayout';
import { navigationRole, validateNavigationWorkspaces } from '../utils/navigation';

const loadDefault = () => get('/my-workspaces');
const persistDefault = ws => setCurrentWorkspace(ws);

export default function WorkspaceSelectPage({ session, onSelect, onLogout, loadWorkspaces = loadDefault, persistWorkspace = persistDefault, autoSelectSingle = true, themeControl }) {
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [query, setQuery] = useState(''), [revision, setRevision] = useState(0);
  const [selecting, setSelecting] = useState(null);
  const callbacks = useRef({ onSelect, persistWorkspace });
  const selectingRef = useRef(false);
  useEffect(() => { callbacks.current = { onSelect, persistWorkspace }; }, [onSelect, persistWorkspace]);

  useEffect(() => {
    let alive = true;
    selectingRef.current = false; setSelecting(null); setError(''); setLoading(true); setWorkspaces([]); setQuery('');
    const open = async () => {
      try {
        const list = validateNavigationWorkspaces(await loadWorkspaces());
        if (!alive) return;
        setWorkspaces(list);
        if (autoSelectSingle && list.length === 1) {
          selectingRef.current = true; setSelecting(`${list[0].id}:${list[0].dataAccountId}`);
          await callbacks.current.persistWorkspace(list[0]);
          if (alive) await callbacks.current.onSelect(list[0]);
        }
      } catch (e) { if (alive) { selectingRef.current = false; setSelecting(null); setError(e?.message || 'Не удалось загрузить рабочие точки. Попробуйте ещё раз.'); } }
      finally { if (alive) setLoading(false); }
    };
    open();
    return () => { alive = false; };
  }, [loadWorkspaces, autoSelectSingle, revision, session?.accountId, session?.username]);

  const handleSelect = async ws => {
    if (selectingRef.current || loading || error) return;
    selectingRef.current = true; setSelecting(`${ws.id}:${ws.dataAccountId}`);
    try { await persistWorkspace(ws); await onSelect(ws); }
    catch (e) { selectingRef.current = false; setSelecting(null); setError(e?.message || 'Не удалось открыть точку. Попробуйте ещё раз.'); }
  };
  const filtered = workspaces.filter(ws => ws.name.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')));

  return <EntryLayout stage={3} workspace themeControl={themeControl}>
    <div className="entry-workspace-heading">
      <div><p className="entry-eyebrow">ШАГ 03 / 03 · РАБОЧЕЕ ПРОСТРАНСТВО</p><h1>Где работаем сегодня?</h1><p className="entry-copy">Выберите точку. Её товары, склад и продажи откроются вместе.</p></div>
      <div className="entry-account"><UserRound size={20} /><div><small>ВЫ ВОШЛИ КАК</small>{session?.username || 'Пользователь'}</div></div>
    </div>
    {!loading && !error && workspaces.length > 0 && <div className="entry-workspace-tools"><span>Доступные точки · {workspaces.length}</span><label className="entry-search"><Search size={18} /><input aria-label="Найти рабочую точку" placeholder="Найти точку по названию" value={query} onChange={e => setQuery(e.target.value)} /></label></div>}
    {loading ? <div className="entry-empty" role="status" aria-live="polite"><LoaderCircle size={28} className="entry-spin" /><h2>Загружаем ваши точки</h2><p>Проверяем доступ к рабочим пространствам.</p></div>
    : error ? <div className="entry-empty" role="alert"><RefreshCw size={28} /><h2>Не удалось открыть точки</h2><p>{error}</p><button type="button" className="entry-secondary" onClick={() => setRevision(v => v + 1)}><RefreshCw size={16} />Попробовать снова</button></div>
    : !workspaces.length ? <div className="entry-empty"><Store size={30} /><h2>Пока нет доступных точек</h2><p>Попросите владельца предоставить вашему логину доступ к рабочей точке. После этого обновите список.</p><button type="button" className="entry-secondary" onClick={() => setRevision(v => v + 1)}><RefreshCw size={16} />Обновить список</button></div>
    : !filtered.length ? <div className="entry-empty"><Search size={28} /><h2>Точка не найдена</h2><p>Проверьте название или посмотрите все доступные точки.</p><button className="entry-secondary" type="button" onClick={() => setQuery('')}>Сбросить поиск</button></div>
    : <div className="entry-workspace-grid" aria-label="Доступные рабочие точки" aria-busy={!!selecting}>
      {filtered.map(ws => {
        const key = `${ws.id}:${ws.dataAccountId}`, active = selecting === key;
        return <button type="button" key={key} className="entry-workspace-card" disabled={!!selecting} onClick={() => handleSelect(ws)} aria-label={`Открыть точку ${ws.name}`}>
          <div><span className="entry-workspace-icon">{ws.isMain ? <Star size={23} /> : <Store size={23} />}</span>{ws.isMain && <span className="entry-main-badge">ОСНОВНАЯ</span>}</div>
          <strong>{ws.name}</strong><small>{navigationRole(ws.role || session?.role)}</small>
          <span className="entry-workspace-open">{active ? 'Открываем точку…' : 'Начать работу'}{active ? <LoaderCircle size={18} className="entry-spin" /> : <ArrowRight size={18} />}</span>
        </button>;
      })}
    </div>}
    <div className="entry-workspace-bottom"><p className="entry-workspace-note">{error || !workspaces.length ? <Info size={17} /> : <ShieldCheck size={17} />}Доступные разделы зависят от ваших прав в выбранной точке.</p>{onLogout && <button className="entry-text-button" type="button" onClick={onLogout} disabled={!!selecting}><LogOut size={16} />Другой аккаунт</button>}</div>
  </EntryLayout>;
}
