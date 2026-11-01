import { useEffect, useRef, useState } from 'react';
import { Bot, Check, Clock, Copy, Eye, EyeOff, RefreshCw, ShoppingBag } from 'lucide-react';
import { post, put } from '../api';
import { setDayStartHour } from '../utils/format';
import useProfileResource from '../utils/useProfileResource';
import { ProfilePanel as Panel, ProfileResource as Resource, ProfileSuccess } from './ProfileUI';

export default function ProfileSettings({ dataAccountId, preview, onRotate }) {
  const business = useProfileResource('/settings/business-day', dataAccountId, true, false);
  const intake = useProfileResource('/online-orders/key', dataAccountId, true, false);
  const ai = useProfileResource('/settings/ai', dataAccountId, true, false);
  const [hour, setHour] = useState(0);
  const [fields, setFields] = useState({ baseUrl: '', model: '', apiKey: '' });
  const [busy, setBusy] = useState('');
  const busyRef = useRef(false), mounted = useRef(true);
  const [feedback, setFeedback] = useState(null);
  const [test, setTest] = useState(null);
  const [showKey, setShowKey] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (business.data) setHour(business.data.dayStartHour); }, [business.data]);
  useEffect(() => { if (ai.data) setFields({ baseUrl: ai.data.baseUrl, model: ai.data.model, apiKey: '' }); }, [ai.data]);
  const aiDirty = !!fields.apiKey || fields.model !== ai.data?.model || fields.baseUrl !== ai.data?.baseUrl;
  const perform = async (key, task) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(key); setFeedback(null); setTest(null);
    try { await task(); } catch (e) { if (mounted.current) setFeedback({ key, error: e.message || 'Не удалось сохранить настройки.' }); }
    finally { busyRef.current = false; if (mounted.current) setBusy(''); }
  };
  const responseOk = result => { if (!result?.ok) throw new Error('Сервер не подтвердил сохранение.'); };
  const message = key => feedback?.key === key && (feedback.error ? <p className="pr-field-error" role="alert">{feedback.error}</p> : <ProfileSuccess text={feedback.text} />);
  const rotate = () => onRotate(async () => { const result = await post('/online-orders/key/rotate', {}, { dataAccountId }); if (!result?.key) throw new Error('Новый ключ не получен.'); return intake.reload(); });
  return <div className="pr-settings-grid">
    <Panel title="Рабочий день" eyebrow="РАСЧЁТЫ И ОТЧЁТЫ" icon={Clock} desc="Определяет, к какой дате относятся продажи после полуночи."><Resource resource={business}><form onSubmit={e => { e.preventDefault(); perform('day', async () => {
      const result = await put('/settings/business-day', { dayStartHour: hour }, { dataAccountId }); responseOk(result);
      if (!mounted.current) return;
      if (!preview) setDayStartHour(hour);
      setFeedback({ key: 'day', text: 'Начало рабочего дня сохранено.' }); await business.reload();
    }); }}><fieldset disabled={!business.ready || !!busy}><label className="pr-label">Начало рабочего дня<select value={hour} onChange={e => setHour(Number(e.target.value))}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00{h === 0 ? ' · по календарю' : ''}</option>)}</select></label><div className="pr-day-example"><Clock size={19} /><div><strong>{hour === 0 ? 'С полуночи до полуночи' : `${String(hour).padStart(2, '0')}:00 → ${String(hour).padStart(2, '0')}:00 следующего дня`}</strong><p>{hour > 0 ? `Продажа в 00:30 попадёт в предыдущий рабочий день, если он начинается в ${String(hour).padStart(2, '0')}:00.` : 'Дата продажи совпадает с календарной датой.'}</p></div></div><button type="submit" className="pr-primary" disabled={hour === business.data?.dayStartHour}>{busy === 'day' ? 'Сохраняю…' : 'Сохранить начало дня'}</button></fieldset></form>{message('day')}</Resource></Panel>
    <Panel title="Заказы с сайта" eyebrow="ПОДКЛЮЧЕНИЯ" icon={ShoppingBag} desc="Ключ связывает сайт меню с заказами в кассе этой точки."><Resource resource={intake}><label className="pr-label">Ключ приёма заказов<div className="pr-secret"><input type={showKey ? 'text' : 'password'} aria-label="Ключ приёма заказов" readOnly value={intake.data?.key || ''} /><button type="button" className="pr-icon-button" aria-label={showKey ? 'Скрыть ключ' : 'Показать ключ'} onClick={() => setShowKey(v => !v)}>{showKey ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label><p className="pr-inline-note">Храните ключ в настройках сайта меню. Он даёт возможность отправлять заказы в эту точку.</p><div className="pr-actions"><button type="button" className="pr-button" disabled={!intake.ready || !!busy} onClick={() => perform('intake', async () => { await navigator.clipboard.writeText(intake.data.key); if (mounted.current) setFeedback({ key: 'intake', text: 'Ключ скопирован.' }); })}><Copy size={15} />Скопировать</button><button type="button" className="pr-button" disabled={!intake.ready || !!busy} onClick={rotate}><RefreshCw size={15} />Перевыпустить</button></div>{message('intake')}<div className="pr-endpoint"><span>Адрес для приёма заказов</span><code>https://okvionsales.ru/api/public/orders</code></div></Resource></Panel>
    <Panel title="Подключение помощника" eyebrow="ИСКУССТВЕННЫЙ ИНТЕЛЛЕКТ" icon={Bot} className="pr-ai-panel" desc="Адрес провайдера, модель и API-ключ. Это подключение используется всем приложением."><Resource resource={ai}><form onSubmit={e => { e.preventDefault(); perform('ai', async () => {
      if (fields.baseUrl.trim()) { let url; try { url = new URL(fields.baseUrl.trim()); } catch { throw new Error('Введите корректный адрес провайдера.'); } if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Адрес должен начинаться с https:// или http://.'); }
      responseOk(await put('/settings/ai', fields, { dataAccountId }));
      if (!mounted.current) return;
      setFields(f => ({ ...f, apiKey: '' })); setFeedback({ key: 'ai', text: 'Подключение сохранено.' }); await ai.reload();
    }); }}><fieldset disabled={!ai.ready || !!busy}><div className="pr-form-grid"><label className="pr-label">Адрес провайдера<input value={fields.baseUrl} onChange={e => { setFields(f => ({ ...f, baseUrl: e.target.value })); setTest(null); }} placeholder="https://provider.example/v1" inputMode="url" autoComplete="off" /></label><label className="pr-label">Модель<input value={fields.model} onChange={e => { setFields(f => ({ ...f, model: e.target.value })); setTest(null); }} placeholder="Название модели у провайдера" autoComplete="off" /></label></div><label className="pr-label">API-ключ<input type="password" value={fields.apiKey} onChange={e => { setFields(f => ({ ...f, apiKey: e.target.value })); setTest(null); }} placeholder={ai.data?.hasKey ? `Сохранён ${ai.data.keyMasked || '••••'} · пусто = не менять` : 'Введите API-ключ провайдера'} autoComplete="new-password" /></label><p className="pr-inline-note">Пустое поле ключа сохраняет прежний ключ. Пустые адрес и модель не очищают действующую конфигурацию провайдера.</p><div className="pr-actions"><button type="submit" className="pr-primary" disabled={!aiDirty}><Check size={15} />{busy === 'ai' ? 'Сохраняю…' : 'Сохранить подключение'}</button><button type="button" className="pr-button" disabled={aiDirty} onClick={() => perform('test', async () => { const result = await post('/settings/ai/test', {}, { dataAccountId, timeoutMs: 35000 }); if (!mounted.current) return; setTest(result?.ok ? { ok: true, text: `Подключение работает · ${result.model || 'модель провайдера'}` } : { ok: false, text: result?.error || 'Провайдер не ответил.' }); })}>{busy === 'test' ? 'Проверяю…' : 'Проверить подключение'}</button></div></fieldset></form><p className="pr-inline-note">Проверяется сохранённое подключение. Проверка отправляет короткий тестовый запрос провайдеру.</p>{message('ai')}{message('test')}{test && <p className={test.ok ? 'pr-field-success' : 'pr-field-error'} role={test.ok ? 'status' : 'alert'}>{test.text}</p>}</Resource></Panel>
  </div>;
}
