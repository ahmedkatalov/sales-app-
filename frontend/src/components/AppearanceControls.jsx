import { Check, RotateCcw, Sun, Moon } from 'lucide-react';

export function AppearanceChoices({ label, value, onChange, options }) {
  return <div className="ap-choices" role="group" aria-label={label}>{options.map(({ value: key, label: text, icon: Icon }) => <button key={key} type="button" aria-pressed={value === key} onClick={() => onChange(key)}>{Icon && <Icon size={15} />}{text}</button>)}</div>;
}
export function AppearanceSection({ number, title, desc, children, right }) {
  return <section className="ap-section"><header><div><span className="ap-eyebrow">{number}</span><h2>{title}</h2>{desc && <p>{desc}</p>}</div>{right}</header>{children}</section>;
}
export function AppearanceRow({ label, hint, children }) {
  return <div className="ap-setting-row"><div><h3>{label}</h3>{hint && <p>{hint}</p>}</div><div>{children}</div></div>;
}
export function AppearanceToggle({ label, checked, onChange }) {
  return <button type="button" className="ap-toggle" role="switch" aria-label={label} aria-checked={!!checked} onClick={() => onChange(!checked)}><span>{checked && <Check size={12} />}</span></button>;
}
export function AppearanceSlider({ label, value, min, max, step, onChange, disabled }) {
  return <label className="ap-slider"><span className="sr-only">{label}</span><input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} disabled={disabled} /><output>{Math.round(value * 100)}%</output></label>;
}
export function AppearanceColor({ label, value, fallback, onChange, hint, nullable = true }) {
  const hex = value || fallback;
  return <div className="ap-color-row"><div><h3>{label}</h3>{hint && <p>{hint}</p>}</div><div><label className="ap-color-picker"><input type="color" aria-label={label} value={/^#[0-9a-f]{3}$/i.test(hex) ? `#${hex.slice(1).split('').map(c => c + c).join('')}` : hex} onChange={e => onChange(e.target.value)} /><span>{value ? hex.toUpperCase() : 'Авто'}</span></label>{nullable && <button type="button" className="ap-color-reset" disabled={!value} aria-label={`Сбросить: ${label}`} title="Вернуть стандартный цвет" onClick={() => onChange(null)}><RotateCcw size={14} /></button>}</div></div>;
}
export function AppearanceThemeCard({ theme, active, onApply, action }) {
  const a = theme.appearance || {}, light = theme.mode === 'light';
  return <article className={`ap-theme-card ${active ? 'is-active' : ''}`}><button type="button" className="ap-theme-apply" aria-label={`Применить тему «${theme.name}»`} aria-pressed={active} onClick={onApply}>
    <div className={`ap-theme-thumbnail ${light ? 'is-light' : ''}`} style={{ '--thumb-accent': a.accent || '#3b82f6', '--thumb-accent2': a.accent2 || '#8b5cf6', '--thumb-radius': `${(a.radius ?? 1) * 5}px` }} aria-hidden="true"><div><i /><i /><i /></div><section><aside><i /><i /><i /></aside><div><span /><div><i /><i /></div><svg viewBox="0 0 100 28"><path d="M0 25 L12 20 L25 23 L39 9 L52 14 L66 7 L80 12 L100 2" fill="none" stroke="var(--thumb-accent)" strokeWidth="2" /></svg></div></section><b style={{ background: a.accent2 || '#8b5cf6' }} /></div>
    <span className="ap-theme-caption"><span><strong>{theme.name}</strong><small>{light ? <Sun size={11} /> : <Moon size={11} />}{theme.mode ? light ? 'Светлая' : 'Тёмная' : 'Текущий режим'}</small></span><span className="ap-theme-check">{active && <Check size={13} />}</span></span>
  </button>{action}</article>;
}
