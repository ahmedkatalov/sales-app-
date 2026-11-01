import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, Copy, Download, Eye, EyeOff, Laptop, Monitor, Moon, Palette, Plus, RotateCcw, Search, Settings2, Shuffle, Smartphone, Sparkles, Sun, Trash2, Undo2, Upload, Users, X } from 'lucide-react';
import { DEFAULT_APPEARANCE, DENSITY_LABELS, FONT_LABELS, PRESETS, SHADOW_LABELS, applyAppearance, clearHiddenPresets, deleteTheme, duplicateTheme, exportTheme, getAppearance, importTheme, listHiddenPresets, listThemes, randomAppearance, renameTheme, resetAppearance, saveTheme, setAppearance, setPresetHidden } from '../theme/engine';
import { applyTheme, getTheme, setTheme } from '../theme';
import { getSession, put } from '../api';
import AppearancePreview from '../components/AppearancePreview';
import { AppearanceChoices as Choices, AppearanceColor as Color, AppearanceRow as Row, AppearanceSection as Section, AppearanceSlider as Slider, AppearanceThemeCard as ThemeCard, AppearanceToggle as Toggle } from '../components/AppearanceControls';
import './AppearancePage.css';

const ACCENTS = [['Синий', '#3b82f6'], ['Индиго', '#6366f1'], ['Фиолетовый', '#8b5cf6'], ['Пурпурный', '#d946ef'], ['Розовый', '#ec4899'], ['Красный', '#ef4444'], ['Оранжевый', '#f97316'], ['Золотой', '#d4af37'], ['Зелёный', '#10b981'], ['Бирюзовый', '#14b8a6'], ['Голубой', '#06b6d4'], ['Графитовый', '#64748b']];
const TABS = [['themes', 'Готовые темы', Sparkles], ['colors', 'Цвета', Palette], ['interface', 'Интерфейс', Settings2], ['library', 'Мои темы', Copy]];
const normalized = a => ({ ...DEFAULT_APPEARANCE, bg: null, surface: null, ...a });
const sameAppearance = (a, b) => Object.keys(DEFAULT_APPEARANCE).every(k => a[k] === b[k]);
const options = labels => Object.entries(labels).map(([value, label]) => ({ value, label }));

export default function AppearancePage({ preview = false, roleOverride }) {
  const [ap, setAp] = useState(getAppearance);
  const [mode, setMode] = useState(getTheme);
  const [initial] = useState(() => ({ appearance: getAppearance(), mode: getTheme() }));
  const [themes, setThemes] = useState(listThemes);
  const [hidden, setHidden] = useState(listHiddenPresets);
  const [history, setHistory] = useState([]);
  const [tab, setTab] = useState('themes');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [device, setDevice] = useState('desktop');
  const [mobilePreview, setMobilePreview] = useState(false);
  const [message, setMessage] = useState(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [newName, setNewName] = useState('');
  const [transfer, setTransfer] = useState(null);
  const [transferText, setTransferText] = useState('');
  const [transferError, setTransferError] = useState('');
  const [savingAll, setSavingAll] = useState(false);
  const [teamVersion, setTeamVersion] = useState(null);
  const savingRef = useRef(false);
  const mounted = useRef(true);
  const fileRef = useRef(null);
  const isOwner = (roleOverride || getSession()?.role) === 'owner';
  const signature = JSON.stringify(ap);

  useEffect(() => {
    mounted.current = true;
    const onAp = e => setAp(e.detail || getAppearance());
    const onMode = () => setMode(getTheme());
    const onThemes = () => setThemes(listThemes());
    const onHidden = () => setHidden(listHiddenPresets());
    window.addEventListener('sales-appearance-change', onAp);
    window.addEventListener('sales-theme-change', onMode);
    if (!preview) {
      window.addEventListener('sales-themes-change', onThemes);
      window.addEventListener('sales-hidden-presets-change', onHidden);
    }
    return () => {
      mounted.current = false;
      window.removeEventListener('sales-appearance-change', onAp);
      window.removeEventListener('sales-theme-change', onMode);
      window.removeEventListener('sales-themes-change', onThemes);
      window.removeEventListener('sales-hidden-presets-change', onHidden);
      if (preview) { applyAppearance(getAppearance()); applyTheme(getTheme()); }
    };
  }, [preview]);

  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const matching = PRESETS.filter(p => (filter === 'all' || p.mode === filter) && p.name.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru')));
  const visible = matching.filter(p => !hiddenSet.has(p.id));
  const hiddenPresets = matching.filter(p => hiddenSet.has(p.id));
  const activePreset = PRESETS.find(p => mode === p.mode && sameAppearance(ap, normalized(p.appearance)));
  const changed = mode !== initial.mode || !sameAppearance(ap, initial.appearance);
  const status = (text, error = false) => setMessage({ text, error });
  const apply = (appearance, nextMode) => {
    setAp(appearance);
    setMode(nextMode);
    if (preview) { applyAppearance(appearance); applyTheme(nextMode); }
    else { setAppearance(appearance); setTheme(nextMode); }
  };
  const commit = (appearance, nextMode = mode) => {
    if (nextMode === mode && sameAppearance(appearance, ap)) return;
    setHistory(h => [...h.slice(-39), { appearance: { ...ap }, mode }]);
    apply(appearance, nextMode);
    setMessage(null);
  };
  const update = partial => commit({ ...ap, ...partial });
  const applyThemeItem = item => { commit(normalized(item.appearance), item.mode || mode); status(`Тема «${item.name}» применена${preview ? ' в предпросмотре' : ''}.`); };
  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    apply(previous.appearance, previous.mode);
    setHistory(h => h.slice(0, -1));
    status('Последнее изменение отменено.');
  };
  const hidePreset = (id, hide) => {
    if (preview) setHidden(cur => hide ? [...new Set([...cur, id])] : cur.filter(x => x !== id));
    else setPresetHidden(id, hide);
  };
  const saveLocal = (name, appearance, nextMode) => {
    if (preview) { const theme = { id: `demo-${Date.now()}-${Math.random()}`, name, appearance: { ...appearance }, mode: nextMode }; setThemes(cur => [theme, ...cur]); }
    else saveTheme(name, appearance, nextMode);
  };
  const saveCurrent = e => {
    e.preventDefault();
    const name = newName.trim() || 'Моя тема';
    saveLocal(name, ap, mode);
    setNewName('');
    status(`Тема «${name}» сохранена${preview ? ' только в демо' : ' на этом устройстве'}.`);
  };
  const openTransfer = kind => {
    setTab('library'); setTransfer(kind); setTransferError('');
    setTransferText(kind === 'export' ? exportTheme(ap, newName.trim() || activePreset?.name || 'Моя тема', mode) : '');
  };
  const importCurrent = () => {
    try {
      const item = importTheme(transferText);
      commit(item.appearance, item.mode || mode);
      saveLocal(item.name, item.appearance, item.mode || mode);
      setTransfer(null); setTransferText(''); setTransferError('');
      status(`Тема «${item.name}» импортирована и применена.`);
    } catch (e) { setTransferError(e.message || 'Не удалось прочитать тему. Проверьте JSON.'); }
  };
  const readFile = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 16000) throw new Error('Файл темы должен быть не больше 16 КБ.');
      setTransferText(await file.text()); setTransferError('');
    } catch (err) { setTransferError(err.message || 'Не удалось открыть файл.'); }
    e.target.value = '';
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([transferText], { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'okvion-theme.json'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    status('JSON темы подготовлен для скачивания.');
  };
  const applyForAll = async () => {
    if (!isOwner || savingRef.current) return;
    savingRef.current = true; setSavingAll(true); setMessage(null);
    const version = signature;
    try {
      const response = await put('/settings/appearance', { appearance: { ...ap } });
      if (!response?.ok) throw new Error('Сервер не подтвердил сохранение. Попробуйте ещё раз.');
      if (mounted.current) { setTeamVersion(version); status(preview ? 'Демо: оформление команды обновлено. Настоящие настройки не менялись.' : 'Оформление команды сохранено. Сотрудники получат его при следующем входе.'); }
    } catch (e) { if (mounted.current) status(e.message || 'Не удалось сохранить оформление команды.', true); }
    finally { savingRef.current = false; if (mounted.current) setSavingAll(false); }
  };

  return <main className={`appearance-page ${mobilePreview ? 'is-mobile-preview-open' : ''}`}>
    <header className="ap-heading"><div><p className="ap-eyebrow">НАСТРОЙКИ / ВАШЕ ПРОСТРАНСТВО</p><h1>Оформление</h1><p>Интерфейс, в котором удобно работать каждый день.</p></div><div className="ap-heading-actions"><button type="button" className="ap-button" onClick={undo} disabled={!history.length}><Undo2 size={16} />Отменить</button><button type="button" className="ap-icon-button" aria-label="Экспорт темы" title="Экспорт темы" onClick={() => openTransfer('export')}><Download size={17} /></button><button type="button" className="ap-icon-button" aria-label="Импорт темы" title="Импорт темы" onClick={() => openTransfer('import')}><Upload size={17} /></button><button type="button" className="ap-icon-button" aria-label="Сбросить оформление" title="Сбросить оформление" onClick={() => setResetOpen(v => !v)} aria-expanded={resetOpen}><RotateCcw size={17} /></button></div></header>
    {resetOpen && <div className="ap-confirm"><div><strong>Вернуть стандартное оформление?</strong><p>Сохранённые темы останутся. Светлый или тёмный режим сохранится.</p></div><button type="button" className="ap-button" onClick={() => setResetOpen(false)}>Отмена</button><button type="button" className="ap-primary" onClick={() => { commit({ ...DEFAULT_APPEARANCE }); if (!preview) resetAppearance(); setResetOpen(false); status('Стандартное оформление восстановлено.'); }}>Вернуть стандарт</button></div>}
    {message && <div className={`ap-feedback ${message.error ? 'is-error' : ''}`} role={message.error ? 'alert' : 'status'}><span>{message.error ? <X size={16} /> : <Check size={16} />}{message.text}</span><button type="button" aria-label="Закрыть сообщение" onClick={() => setMessage(null)}><X size={15} /></button></div>}
    <div className="ap-studio">
      <div className="ap-editor"><nav className="ap-tabs" aria-label="Разделы оформления">{TABS.map(([key, label, Icon]) => <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}><Icon size={15} />{label}{key === 'library' && !!themes.length && <small>{themes.length}</small>}</button>)}</nav>
        <div className="ap-editor-content">
          {tab === 'themes' && <Section number="01 / КОЛЛЕКЦИЯ" title="Начните с настроения" desc="Выберите готовую тему, затем подстройте детали под себя." right={<button type="button" className="ap-icon-button" aria-label="Случайная тема" title="Случайная тема" onClick={() => { commit(randomAppearance()); status('Случайное оформление применено. Его можно отменить.'); }}><Shuffle size={17} /></button>}>
            <div className="ap-gallery-toolbar"><Choices label="Фильтр готовых тем" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'Все' }, { value: 'dark', label: 'Тёмные', icon: Moon }, { value: 'light', label: 'Светлые', icon: Sun }]} /><label className="ap-search"><Search size={15} /><input aria-label="Найти тему" placeholder="Найти тему" value={search} onChange={e => setSearch(e.target.value)} /></label></div>
            <div className="ap-themes-grid">{visible.map(p => <ThemeCard key={p.id} theme={p} active={activePreset?.id === p.id} onApply={() => applyThemeItem(p)} action={<button type="button" className="ap-theme-hide" aria-label={`Скрыть тему «${p.name}»`} title="Скрыть тему" onClick={() => hidePreset(p.id, true)}><EyeOff size={13} /></button>} />)}</div>
            {!visible.length && <div className="ap-empty"><Search size={23} /><strong>Темы не найдены</strong><p>Попробуйте другое название или верните скрытые темы.</p><button type="button" className="ap-button" onClick={() => { setSearch(''); setFilter('all'); }}>Сбросить поиск</button></div>}
            {!!hidden.length && <div className="ap-hidden"><button type="button" className="ap-text-button" onClick={() => setShowHidden(v => !v)} aria-expanded={showHidden}><EyeOff size={14} />Скрытые темы · {hidden.length}<ChevronRight size={14} /></button>{showHidden && <><div>{hiddenPresets.map(p => <button key={p.id} type="button" className="ap-button" onClick={() => hidePreset(p.id, false)}><Eye size={13} />{p.name}</button>)}</div><button type="button" className="ap-text-button" onClick={() => preview ? setHidden([]) : clearHiddenPresets()}>Вернуть все скрытые темы</button></>}</div>}
          </Section>}
          {tab === 'colors' && <>
            <Section number="02 / ПАЛИТРА" title="Ваши цвета" desc="Кнопки, выделение и графики используют одну палитру.">
              <Row label="Режим интерфейса" hint="Выбор светлой или тёмной темы хранится на устройстве."><Choices label="Режим интерфейса" value={mode} onChange={next => commit({ ...ap }, next)} options={[{ value: 'dark', label: 'Тёмный', icon: Moon }, { value: 'light', label: 'Светлый', icon: Sun }]} /></Row>
              <div className="ap-accent-options" role="group" aria-label="Готовые основные цвета">{ACCENTS.map(([name, hex]) => <button key={hex} type="button" title={name} aria-label={`Основной цвет: ${name}`} aria-pressed={ap.accent?.toLowerCase() === hex} style={{ background: hex }} onClick={() => update({ accent: hex })}>{ap.accent?.toLowerCase() === hex && <Check size={16} />}</button>)}</div>
              <Color label="Основной цвет" hint="Кнопки, активные элементы и графики" value={ap.accent} fallback="#3b82f6" onChange={v => update({ accent: v })} /><Color label="Дополнительный цвет" hint="Второй акцент и градиенты" value={ap.accent2} fallback="#8b5cf6" onChange={v => update({ accent2: v })} />
            </Section>
            <Section number="СИГНАЛЫ И СОСТОЯНИЯ" title="Цвета статусов" desc="Отдельная палитра для результата и важных уведомлений.">{[['success', 'Успех', '#10b981'], ['warning', 'Внимание', '#f59e0b'], ['error', 'Ошибка', '#ef4444'], ['info', 'Информация', '#0ea5e9']].map(([key, label, fallback]) => <Color key={key} label={label} value={ap[key]} fallback={fallback} onChange={v => update({ [key]: v })} />)}</Section>
            <Section number="ПОВЕРХНОСТИ" title="Фон и карточки" desc="Свои цвета фона применяются в тёмном режиме. В светлом используется светлая палитра.">{mode === 'light' && <p className="ap-note">Чтобы увидеть эти два цвета, переключитесь на тёмный режим выше.</p>}<Color label="Фон приложения" value={ap.bg} fallback="#0a0e17" onChange={v => update({ bg: v })} /><Color label="Цвет карточек" value={ap.surface} fallback="#141a28" hint="Сплошной цвет перекрывает прозрачность стекла" onChange={v => update({ surface: v })} /></Section>
          </>}
          {tab === 'interface' && <>
            <Section number="03 / ФОРМА И РИТМ" title="Под ваш стиль работы" desc="От плотной рабочей панели до спокойного просторного экрана.">
              <Row label="Шрифт"><Choices label="Шрифт" value={ap.font} onChange={v => update({ font: v })} options={options(FONT_LABELS)} /></Row><Row label="Размер текста"><Slider label="Размер текста" value={ap.fontScale} min={.85} max={1.2} step={.01} onChange={v => update({ fontScale: v })} /></Row><Row label="Плотность интерфейса" hint="Меняет расстояния между элементами."><Choices label="Плотность интерфейса" value={ap.density} onChange={v => update({ density: v })} options={options(DENSITY_LABELS)} /></Row><Row label="Скругление" hint="Форма карточек, кнопок и полей."><Choices label="Быстрое скругление" value={ap.radius} onChange={v => update({ radius: v })} options={[{ value: 0, label: 'Острые' }, { value: .5, label: 'Строгие' }, { value: 1, label: 'Обычные' }, { value: 1.8, label: 'Мягкие' }]} /><Slider label="Скругление" value={ap.radius} min={0} max={1.8} step={.05} onChange={v => update({ radius: v })} /></Row>
            </Section>
            <Section number="МАТЕРИАЛ И ГЛУБИНА" title="Детали, которые чувствуются"><Row label="Матовое стекло" hint="Полупрозрачные поверхности с размытием фона."><Toggle label="Матовое стекло" checked={ap.glass} onChange={v => update({ glass: v })} /></Row><Row label="Сила размытия"><Slider label="Сила размытия" value={ap.blur} min={.2} max={1.8} step={.05} disabled={!ap.glass} onChange={v => update({ blur: v })} /></Row><Row label="Тени"><Choices label="Тени" value={ap.shadow} onChange={v => update({ shadow: v })} options={options(SHADOW_LABELS)} /></Row><Row label="Фоновое свечение" hint="Декоративные цветные градиенты на фоне."><Toggle label="Фоновое свечение" checked={ap.glow !== false} onChange={v => update({ glow: v })} /></Row><Row label="Анимации" hint="Плавные переходы между состояниями."><Toggle label="Анимации" checked={ap.motion} onChange={v => update({ motion: v })} /></Row></Section>
          </>}
          {tab === 'library' && <>
            <Section number="04 / ВАША КОЛЛЕКЦИЯ" title="Сохраните удачное сочетание" desc="Сохраняются цвета, параметры интерфейса и выбранный режим."><form className="ap-save-form" onSubmit={saveCurrent}><label><span className="sr-only">Название новой темы</span><input aria-label="Название новой темы" value={newName} maxLength={80} onChange={e => setNewName(e.target.value)} placeholder="Например, Вечерняя смена" /></label><button type="submit" className="ap-primary"><Plus size={16} />Сохранить тему</button></form>
              {themes.length ? <div className="ap-saved-list">{themes.map(t => <div className="ap-saved-item" key={t.id}><ThemeCard theme={t} active={(!t.mode || t.mode === mode) && sameAppearance(ap, normalized(t.appearance))} onApply={() => applyThemeItem(t)} /><div className="ap-saved-actions"><label><span>Название темы</span><input key={t.name} aria-label={`Название темы «${t.name}»`} defaultValue={t.name} maxLength={80} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} onBlur={e => { const name = e.target.value.trim(); if (!name) { e.target.value = t.name; return; } if (preview) setThemes(cur => cur.map(x => x.id === t.id ? { ...x, name } : x)); else renameTheme(t.id, name); }} /></label><div><button type="button" className="ap-icon-button" aria-label={`Дублировать тему «${t.name}»`} onClick={() => preview ? saveLocal(`${t.name} (копия)`, t.appearance, t.mode) : duplicateTheme(t.id)}><Copy size={15} /></button><button type="button" className="ap-icon-button" aria-label={`Удалить тему «${t.name}»`} onClick={() => setDeleting(t.id)}><Trash2 size={15} /></button></div>{deleting === t.id && <div className="ap-delete-confirm"><span>Удалить «{t.name}»?</span><button type="button" onClick={() => setDeleting(null)}>Отмена</button><button type="button" onClick={() => { if (preview) setThemes(cur => cur.filter(x => x.id !== t.id)); else deleteTheme(t.id); setDeleting(null); status('Тема удалена из коллекции.'); }}>Удалить</button></div>}</div></div>)}</div> : <div className="ap-empty"><Palette size={26} /><strong>Здесь будут ваши темы</strong><p>Настройте оформление и сохраните его с удобным названием.</p></div>}
            </Section>
            <Section number="ПЕРЕНОС НАСТРОЕК" title="Возьмите тему с собой" desc="Передайте JSON на другое устройство или поделитесь своей палитрой."><div className="ap-transfer-actions"><button type="button" className="ap-button" onClick={() => openTransfer('export')}><Download size={16} />Экспорт JSON</button><button type="button" className="ap-button" onClick={() => openTransfer('import')}><Upload size={16} />Импорт JSON</button></div>{transfer && <div className="ap-transfer"><header><h3>{transfer === 'import' ? 'Импорт темы' : 'Экспорт текущей темы'}</h3><button type="button" className="ap-icon-button" aria-label="Закрыть перенос темы" onClick={() => setTransfer(null)}><X size={16} /></button></header><label><span>{transfer === 'import' ? 'Вставьте JSON или откройте файл' : 'Настройки в формате JSON'}</span><textarea aria-label={transfer === 'import' ? 'JSON для импорта' : 'JSON для экспорта'} value={transferText} readOnly={transfer === 'export'} onChange={e => { setTransferText(e.target.value); setTransferError(''); }} rows={8} spellCheck={false} /></label>{transferError && <p className="ap-error" role="alert">{transferError}</p>}<div className="ap-transfer-actions">{transfer === 'import' ? <><input ref={fileRef} className="sr-only" tabIndex={-1} type="file" accept=".json,application/json" aria-label="Файл темы" onChange={readFile} /><button type="button" className="ap-button" onClick={() => fileRef.current?.click()}><Upload size={15} />Открыть файл</button><button type="button" className="ap-primary" disabled={!transferText.trim()} onClick={importCurrent}><Check size={15} />Импортировать</button></> : <><button type="button" className="ap-button" onClick={async () => { try { await navigator.clipboard.writeText(transferText); status('JSON темы скопирован.'); } catch { setTransferError('Не удалось скопировать. Выделите текст вручную или скачайте файл.'); } }}><Copy size={15} />Копировать</button><button type="button" className="ap-primary" onClick={download}><Download size={15} />Скачать JSON</button></>}</div></div>}</Section>
          </>}
        </div>
      </div>
      <aside className="ap-preview-column"><div className="ap-preview-sticky"><div className="ap-preview-heading"><div><span className="ap-eyebrow">ЖИВОЙ ПРЕДПРОСМОТР</span><h2>Так будет выглядеть приложение</h2></div><button type="button" className="ap-button ap-mobile-preview-toggle" aria-expanded={mobilePreview} onClick={() => setMobilePreview(v => !v)}><Eye size={15} />{mobilePreview ? 'Скрыть' : 'Показать'}</button><Choices label="Размер предпросмотра" value={device} onChange={setDevice} options={[{ value: 'desktop', label: <span className="sr-only">Компьютер</span>, icon: Monitor }, { value: 'phone', label: <span className="sr-only">Телефон</span>, icon: Smartphone }]} /></div><AppearancePreview device={device} /><p className="ap-preview-caption"><span><i />{preview ? 'Изменения только в демо' : 'Изменения применяются сразу'}</span><span>{activePreset?.name || 'Своё оформление'} · {mode === 'light' ? 'Светлый' : 'Тёмный'}</span></p>
        <div className="ap-device-note"><Laptop size={17} /><div><strong>{preview ? 'Безопасный предпросмотр' : 'На этом устройстве'}</strong><p>{preview ? 'Настоящие настройки и сохранённые темы не меняются.' : 'Настройки сохраняются автоматически. Свои темы хранятся в этом браузере.'}</p>{changed && <button type="button" className="ap-text-button" onClick={() => { commit({ ...initial.appearance }, initial.mode); status('Вернул оформление, с которым вы открыли страницу.'); }}>Вернуть вид при открытии<Undo2 size={12} /></button>}</div></div>
        <section className="ap-team"><span className="ap-team-icon"><Users size={19} /></span><div><h2>{isOwner ? 'Единый стиль команды' : 'Оформление команды'}</h2><p>{isOwner ? 'Отправьте цвета и параметры сотрудникам. Светлый или тёмный режим каждый выбирает сам.' : 'Общий стиль задаёт владелец. Ваши изменения здесь действуют на этом устройстве.'}</p>{isOwner && <><button type="button" className="ap-primary" onClick={applyForAll} disabled={savingAll || teamVersion === signature}><Check size={15} />{savingAll ? 'Сохраняю…' : teamVersion === signature ? 'Применено для команды' : 'Применить для команды'}</button><small>{teamVersion && teamVersion !== signature ? 'Есть новые изменения — примените их повторно.' : 'Сотрудники получат оформление при следующем входе.'}</small></>}</div></section>
      </div></aside>
    </div>
  </main>;
}
