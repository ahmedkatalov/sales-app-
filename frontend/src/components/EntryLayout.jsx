import { ArrowUpRight, Check, Layers3, Mail, Store, UserRound } from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import './EntryLayout.css';

const STEPS = [{ label: 'Войти', note: 'Логин и пароль', Icon: UserRound }, { label: 'Подтвердить', note: 'Код из почты', Icon: Mail }, { label: 'Начать работу', note: 'Ваша рабочая точка', Icon: Store }];

export default function EntryLayout({ children, stage = 1, workspace = false, themeControl }) {
  return <div className={`entry-page${workspace ? ' entry-workspaces' : ''}`}>
    <header className="entry-header">
      <div className="entry-brand"><span><Layers3 size={24} strokeWidth={1.7} /></span><div>okvion<small>SALES / РАБОЧЕЕ ПРОСТРАНСТВО</small></div></div>
      {themeControl || <ThemeToggle />}
    </header>
    <main className="entry-main">
      {!workspace && <section className="entry-intro" aria-label="Вход в Okvion Sales">
        <p className="entry-eyebrow">КАССА · СКЛАД · АНАЛИТИКА</p>
        <h2>Всё готово<br />к новому<br /><span>рабочему дню.</span></h2>
        <p className="entry-intro-copy">Продажи, команда и дела вашей точки —<br className="entry-desktop-break" /> в одном рабочем пространстве.</p>
        <div className="entry-journey" aria-label="Этапы входа">
          {STEPS.map(({ label, note, Icon }, index) => <div key={label} className={stage === index + 1 ? 'is-current' : stage > index + 1 ? 'is-done' : ''} aria-current={stage === index + 1 ? 'step' : undefined}>
            <span>{stage > index + 1 ? <Check size={18} /> : <Icon size={18} />}</span><div><strong>{label}</strong><small>{note}</small></div><b>{String(index + 1).padStart(2, '0')}</b>
          </div>)}
        </div>
        <div className="entry-intro-footer"><span>Ваш бизнес. Ваш порядок.</span><ArrowUpRight size={20} /></div>
      </section>}
      <div className="entry-content">{children}</div>
    </main>
    <footer className="entry-footer"><span>Okvion Sales</span><span>Пространство для ежедневной работы</span></footer>
  </div>;
}
