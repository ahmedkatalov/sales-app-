import { useEffect, useRef, useState } from 'react';
import { Clock, Copy, Eye, EyeOff, RefreshCw, ShoppingBag } from 'lucide-react';
import { post, put } from '../api';
import { setDayStartHour } from '../utils/format';
import useProfileResource from '../utils/useProfileResource';
import { ProfilePanel as Panel, ProfileResource as Resource, ProfileSuccess } from './ProfileUI';

export default function ProfileSettings({ dataAccountId, preview, onRotate }) {
  const business = useProfileResource('/settings/business-day', dataAccountId, true, false);
  const intake = useProfileResource('/online-orders/key', dataAccountId, true, false);
  const [hour, setHour] = useState(0);
  const [busy, setBusy] = useState('');
  const busyRef = useRef(false), mounted = useRef(true);
  const [feedback, setFeedback] = useState(null);
  const [showKey, setShowKey] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (business.data) setHour(business.data.dayStartHour); }, [business.data]);
  const perform = async (key, task) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(key); setFeedback(null);
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

  </div>;
}
