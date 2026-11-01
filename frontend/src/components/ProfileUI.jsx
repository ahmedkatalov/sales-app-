import { useRef } from 'react';
import { AlertCircle, Check, RefreshCw, Search } from 'lucide-react';
import Modal from './Modal';
import useDialogFocus from '../utils/useDialogFocus';

export function ProfilePanel({ title, eyebrow, desc, icon: Icon, action, children, className = '' }) {
  return <section className={`pr-panel backdrop-blur-xl ${className}`}><header className="pr-panel-heading"><div>{eyebrow && <p className="pr-eyebrow">{eyebrow}</p>}<h2>{Icon && <Icon size={18} />}{title}</h2>{desc && <p>{desc}</p>}</div>{action}</header>{children}</section>;
}
export function ProfileSearch({ value, onChange, label = 'Поиск' }) {
  return <label className="pr-search"><Search size={16} /><input aria-label={label} placeholder={label} value={value} onChange={e => onChange(e.target.value)} /></label>;
}
export function ProfileEmpty({ title, desc, icon: Icon = Search }) {
  return <div className="pr-empty"><Icon size={26} /><strong>{title}</strong><p>{desc}</p></div>;
}
export function ProfileResource({ resource, children }) {
  if (!resource.data && resource.loading) return <div className="pr-loading" role="status"><RefreshCw size={17} className="pr-spin" />Загружаю данные…</div>;
  return <>{resource.error && <div className="pr-feedback is-error" role="alert"><AlertCircle size={17} /><span>{resource.error}{resource.data && <small>Показаны последние загруженные данные. Изменения временно недоступны.</small>}</span><button type="button" className="pr-button" onClick={resource.reload} disabled={resource.loading}>Повторить</button></div>}{resource.data !== null && children}{resource.loading && <p className="pr-inline-note" role="status">Обновляю данные…</p>}</>;
}
export function ProfileDialog({ title, onClose, busy, children, error, wide = false }) {
  const root = useRef(null);
  useDialogFocus(root, true, '.smart-modal-panel');
  return <div className="pr-modal-scope" ref={root} role="dialog" aria-modal="true" aria-label={title}><Modal title={title} section="Настройки" legacyLight={false} wide={wide} onClose={busy ? undefined : onClose}>{children}{error && <div role="alert" className="pr-feedback is-error"><AlertCircle size={16} /><span>{error}</span></div>}</Modal></div>;
}
export function ProfileSuccess({ text }) { return <div className="pr-feedback" role="status"><Check size={17} /><span>{text}</span></div>; }
