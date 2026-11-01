import { useEffect, useRef, useState } from 'react';
import { Bot, Check, ExternalLink, Eye, EyeOff, Image, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { post, put } from '../api';
import useProfileResource from '../utils/useProfileResource';
import { AI_PROVIDERS, aiDraft, aiSettingsPayload } from '../utils/aiSettings';
import { ProfilePanel as Panel, ProfileResource as Resource, ProfileSuccess } from './ProfileUI';
import './AISettings.css';

export default function AISettings({ dataAccountId }) {
  const resource = useProfileResource('/settings/ai', dataAccountId, true, false);
  const [fields, setFields] = useState({ provider: 'odirouter', baseUrl: AI_PROVIDERS[0].baseUrl, model: '', apiKey: '' });
  const [showKey, setShowKey] = useState(false), [query, setQuery] = useState('');
  const [catalog, setCatalog] = useState(null), [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState(null), [catalogError, setCatalogError] = useState('');
  const busyRef = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (resource.data) { setFields(aiDraft(resource.data)); setShowKey(false); } }, [resource.data]);
  const saved = resource.data, preset = AI_PROVIDERS.find(p => p.id === fields.provider);
  const savedDraft = saved ? aiDraft(saved) : null;
  const dirty = !!fields.apiKey || fields.baseUrl !== savedDraft?.baseUrl || fields.model !== savedDraft?.model;
  const sameEndpoint = fields.baseUrl.replace(/\/+$/, '') === savedDraft?.baseUrl.replace(/\/+$/, '');
  const selected = catalog?.models.find(m => m.id === fields.model);
  const update = changes => { setFields(f => ({ ...f, ...changes })); setFeedback(null); };
  const changeProvider = id => {
    const provider = AI_PROVIDERS.find(p => p.id === id);
    const baseUrl = provider.baseUrl || (fields.provider === 'custom' ? fields.baseUrl : '');
    setFields({ provider: id, baseUrl, model: baseUrl === savedDraft?.baseUrl ? savedDraft.model : '', apiKey: '' });
    setShowKey(false); setFeedback(null); setCatalog(null); setCatalogError(''); setQuery('');
  };
  const run = async (action, task) => {
    if (busyRef.current || !resource.ready) return;
    busyRef.current = true; setBusy(action); setFeedback(null);
    try { await task(); } catch (error) { if (mounted.current) { if (action === 'catalog') setCatalogError(error.message); else setFeedback({ ok: false, text: error.message || 'Не удалось выполнить действие.' }); } }
    finally { busyRef.current = false; if (mounted.current) setBusy(''); }
  };
  const loadModels = (more = false) => run('catalog', async () => {
    setCatalogError('');
    const payload = aiSettingsPayload(fields, saved, false);
    const result = await post('/settings/ai/models', { ...payload, query: more ? catalog.query : query.trim(), page: more ? catalog.page + 1 : 1 }, { dataAccountId, timeoutMs: 35000 });
    if (!Array.isArray(result?.models) || result.models.some(m => typeof m.id !== 'string' || !m.id)) throw new Error('Не удалось прочитать каталог. Укажите ID модели вручную.');
    if (mounted.current) setCatalog(previous => ({ models: [...new Map([...(more ? previous.models : []), ...result.models].map(m => [m.id, m])).values()], page: result.page || 1, hasMore: !!result.hasMore, total: result.total, query: more ? previous.query : query.trim() }));
  });
  const save = event => { event.preventDefault(); run('save', async () => {
    const payload = aiSettingsPayload(fields, saved);
    const result = await put('/settings/ai', payload, { dataAccountId });
    if (!result?.ok) throw new Error('Сохранение не подтверждено сервером.');
    if (!mounted.current) return;
    setFields(f => ({ ...f, apiKey: '' })); setShowKey(false);
    setFeedback({ ok: true, text: 'Подключение сохранено. Новые запросы ИИ используют выбранного провайдера и модель.' });
    await resource.reload();
  }); };
  const check = () => run('test', async () => {
    const result = await post('/settings/ai/test', aiSettingsPayload(fields, saved), { dataAccountId, timeoutMs: 35000 });
    if (mounted.current) setFeedback(result?.ok ? { ok: true, text: `Модель отвечает: ${result.model || fields.model}.${dirty ? ' Для применения сохраните подключение.' : ''}` } : { ok: false, text: result?.error || 'Модель не ответила.' });
  });
  const matching = catalog?.models.filter(m => `${m.name} ${m.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) || [];
  return <Panel title="ИИ и модели" eyebrow="ПОДКЛЮЧЕНИЕ ПОМОЩНИКА" icon={Bot} className="pr-ai-settings" desc="Выберите сервис, подключите свой ключ и назначьте модель для помощника, распознавания и подсказок.">
    <Resource resource={resource}>
      {saved && <div className="pr-ai-current"><ShieldCheck size={20} /><div><small>СОХРАНЁННОЕ ПОДКЛЮЧЕНИЕ</small><strong>{AI_PROVIDERS.find(p => p.id === savedDraft.provider)?.name} · {saved.model || 'Модель не выбрана'}</strong><span>{saved.hasKey ? `Ключ сохранён · ${saved.keyMasked || '••••'}` : 'API-ключ пока не задан'}</span></div><span className="pr-badge">{dirty ? 'Есть изменения' : 'Сохранено'}</span></div>}
      <form onSubmit={save}><fieldset disabled={!resource.ready || !!busy}>
        <div className="pr-form-grid"><label className="pr-label">Провайдер ИИ<select aria-label="Провайдер ИИ" value={fields.provider} onChange={e => changeProvider(e.target.value)}>{AI_PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="pr-label">Базовый API-адрес<input value={fields.baseUrl} readOnly={fields.provider !== 'custom'} onChange={e => { update({ baseUrl: e.target.value, apiKey: '' }); setCatalog(null); }} placeholder="https://provider.example/v1" autoComplete="off" inputMode="url" /></label></div>
        {preset?.docs && <a className="pr-ai-docs" href={preset.docs} target="_blank" rel="noreferrer">Инструкция {preset.name}<ExternalLink size={13} /></a>}
        <label className="pr-label">API-ключ провайдера<div className="pr-secret"><input aria-label="API-ключ провайдера" type={showKey ? 'text' : 'password'} value={fields.apiKey} onChange={e => { update({ apiKey: e.target.value }); setCatalog(null); }} placeholder={sameEndpoint && saved?.hasKey ? `Сохранён ${saved.keyMasked || '••••'} · пусто = не менять` : 'Вставьте ключ выбранного сервиса'} autoComplete="new-password" spellCheck={false} /><button type="button" className="pr-icon-button" aria-label={showKey ? 'Скрыть API-ключ' : 'Показать API-ключ'} onClick={() => setShowKey(v => !v)}>{showKey ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
        <p className="pr-inline-note">{sameEndpoint && saved?.hasKey ? 'Оставьте поле пустым, чтобы использовать сохранённый ключ.' : 'Для нового провайдера нужен его API-ключ. Ключ предыдущего сервиса не переносится.'} Ключ хранится на сервере и не возвращается в браузер целиком.</p>
        <div className="pr-ai-catalog"><div className="pr-ai-catalog-heading"><div><h3>Каталог моделей</h3><p>Загрузите доступные модели или укажите ID вручную ниже.</p></div></div><div className="pr-ai-catalog-tools"><label className="pr-search"><Search size={16} /><input aria-label="Поиск модели в каталоге" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); loadModels(); } }} placeholder="Название или ID модели" /></label><button type="button" className="pr-button" onClick={() => loadModels()}><RefreshCw size={15} className={busy === 'catalog' ? 'pr-spin' : ''} />{busy === 'catalog' ? 'Загружаю…' : catalog ? 'Обновить каталог' : 'Загрузить модели'}</button></div>
        {catalogError && <p className="pr-field-error" role="alert">{catalogError} Можно указать ID модели вручную.</p>}
        {catalog && <><p className="pr-inline-note">Загружено: {catalog.models.length}{Number.isFinite(catalog.total) ? ` · найдено у провайдера: ${catalog.total}` : ''}</p><div className="pr-ai-models" aria-label="Модели провайдера">{matching.map(model => <button key={model.id} type="button" aria-label={`Выбрать модель ${model.id}`} aria-pressed={fields.model === model.id} onClick={() => update({ model: model.id })}><span><strong>{model.name || model.id}</strong><code>{model.id}</code></span><span>{model.vision && <small><Image size={12} />Фото</small>}{model.contextLength > 0 && <small>Контекст {model.contextLength.toLocaleString('ru-RU')}</small>}{fields.model === model.id && <Check size={17} />}</span></button>)}</div>{!matching.length && <p className="pr-inline-note">Нет совпадений в загруженных моделях. Измените запрос и обновите каталог либо введите ID вручную.</p>}{catalog.hasMore && <button type="button" className="pr-button" onClick={() => loadModels(true)}>Загрузить ещё модели</button>}</>}
        </div>
        <label className="pr-label">ID выбранной модели<input value={fields.model} onChange={e => update({ model: e.target.value })} placeholder="Точный ID из каталога вашего провайдера" autoComplete="off" spellCheck={false} /></label>
        <p className="pr-inline-note">{selected?.vision ? 'Выбранная модель поддерживает изображения.' : 'Для распознавания фото и накладных выбирайте модель с поддержкой изображений.'} ID у разных сервисов могут отличаться.</p>
        <div className="pr-actions"><button type="button" className="pr-button" onClick={check}>{busy === 'test' ? 'Проверяю…' : 'Проверить подключение'}</button><button type="submit" className="pr-primary" disabled={!dirty}><Check size={15} />{busy === 'save' ? 'Сохраняю…' : 'Сохранить подключение'}</button></div>
      </fieldset></form>
      <p className="pr-inline-note">Проверка отправляет короткий запрос выбранной модели без данных бизнеса и не сохраняет изменения. Подключение общее для этой установки приложения и используется всеми её точками.</p>
      {feedback && (feedback.ok ? <ProfileSuccess text={feedback.text} /> : <p className="pr-field-error" role="alert">{feedback.text}</p>)}
    </Resource>
  </Panel>;
}
