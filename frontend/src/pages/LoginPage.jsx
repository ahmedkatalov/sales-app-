import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Eye, EyeOff, KeyRound, LoaderCircle, Mail, ShieldCheck } from 'lucide-react';
import { post } from '../api';
import EntryLayout from '../components/EntryLayout';
import { authErrorMessage, otpDigits, otpPendingStore, otpSecondsLeft, validOtpPending } from '../utils/auth';

export default function LoginPage({ onAuth, request = post, pendingStore = otpPendingStore, themeControl }) {
  const [initialPending] = useState(() => validOtpPending(pendingStore.read()));
  const [step, setStep] = useState(initialPending ? 'otp' : 'credentials');
  const [username, setUsername] = useState(initialPending?.username || '');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [maskedEmail, setMaskedEmail] = useState(initialPending?.maskedEmail || '');
  const [sentAt, setSentAt] = useState(initialPending?.sentAt || 0);
  const [now, setNow] = useState(Date.now);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const codeRef = useRef(null), usernameRef = useRef(null), passwordRef = useRef(null);
  const inFlight = useRef(false), mounted = useRef(true);
  const secondsLeft = otpSecondsLeft(sentAt, now);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (step !== 'otp') return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    const onVisible = () => setNow(Date.now());
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [step, sentAt]);
  useEffect(() => {
    if (step === 'otp') codeRef.current?.focus();
    else if (username) passwordRef.current?.focus();
    else usernameRef.current?.focus();
  // Focus on the new step only, without stealing focus during typing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const sendCode = async event => {
    event?.preventDefault();
    if (inFlight.current) return;
    const login = username.trim(), secret = password.trim();
    const errors = {};
    if (!login) errors.username = 'Введите логин или email.';
    if (!secret) errors.password = 'Введите пароль.';
    setError(''); setFieldErrors(errors);
    if (Object.keys(errors).length) { (errors.username ? usernameRef : passwordRef).current?.focus(); return; }
    inFlight.current = true; setBusy(true);
    try {
      const result = await request('/auth/login-otp/request', { username: login, password: secret });
      if (!mounted.current) return;
      const pending = { username: login, maskedEmail: result?.maskedEmail || '', sentAt: Date.now() };
      pendingStore.save(pending);
      setMaskedEmail(pending.maskedEmail); setSentAt(pending.sentAt); setNow(Date.now());
      setCode(''); setStep('otp'); codeRef.current?.focus();
    } catch (e) { if (mounted.current) setError(authErrorMessage(e)); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };

  const confirmCode = async event => {
    event.preventDefault();
    if (inFlight.current || !/^\d{6}$/.test(code)) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const user = await request('/auth/login-otp/confirm', { username: username.trim(), code });
      if (!mounted.current) return;
      if (!user?.accountId) throw new Error('Не получены данные аккаунта. Попробуйте подтвердить вход ещё раз.');
      pendingStore.clear();
      onAuth(user);
    } catch (e) {
      if (mounted.current) { setError(authErrorMessage(e, true)); setCode(''); codeRef.current?.focus(); }
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };

  const resendCode = () => {
    if (inFlight.current || otpSecondsLeft(sentAt) > 0) return;
    if (!password.trim()) {
      setStep('credentials'); setError('Введите пароль ещё раз, чтобы отправить новый код.');
      return;
    }
    sendCode();
  };

  const changeCredentials = () => {
    if (inFlight.current) return;
    pendingStore.clear(); setStep('credentials'); setCode(''); setError(''); setFieldErrors({});
  };

  return <EntryLayout stage={step === 'otp' ? 2 : 1} themeControl={themeControl}>
    <section className="entry-card backdrop-blur-xl" aria-labelledby="entry-title">
      <div className="entry-step"><span>{step === 'otp' ? <Mail size={21} /> : <KeyRound size={21} />}</span><span>ШАГ {step === 'otp' ? '02' : '01'} / 03</span></div>
      <h1 id="entry-title">{step === 'otp' ? 'Проверьте почту' : 'Войти в работу'}</h1>
      <p className="entry-copy">{step === 'otp' ? <>Отправили код на <strong>{maskedEmail || 'ваш email'}</strong>. Введите шесть цифр из письма.</> : 'Введите данные вашего аккаунта. Затем подтвердите вход кодом из почты.'}</p>
      {error && <div className="entry-feedback" role="alert"><AlertCircle size={18} /><span>{error}</span></div>}
      {step === 'credentials' ? <form className="entry-form" onSubmit={sendCode} aria-busy={busy} noValidate>
        <div className="entry-field"><label htmlFor="entry-username" className="entry-code-label">Логин или email</label>
          <input ref={usernameRef} id="entry-username" className="entry-input" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Ваш логин" value={username} readOnly={busy} aria-invalid={!!fieldErrors.username} aria-describedby={fieldErrors.username ? 'entry-login-error' : undefined} onChange={e => { setUsername(e.target.value); setFieldErrors(p => ({ ...p, username: '' })); setError(''); }} />
          {fieldErrors.username && <small id="entry-login-error" className="entry-field-error">{fieldErrors.username}</small>}
        </div>
        <div className="entry-field"><label htmlFor="entry-password"><span className="entry-code-label">Пароль</span></label><div className="entry-password">
          <input ref={passwordRef} id="entry-password" className="entry-input" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Введите пароль" value={password} readOnly={busy} aria-invalid={!!fieldErrors.password} aria-describedby={fieldErrors.password ? 'entry-password-error' : undefined} onChange={e => { setPassword(e.target.value); setFieldErrors(p => ({ ...p, password: '' })); setError(''); }} />
          <button type="button" aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'} aria-pressed={showPassword} onClick={() => setShowPassword(v => !v)}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button>
        </div>{fieldErrors.password && <small id="entry-password-error" className="entry-field-error">{fieldErrors.password}</small>}</div>
        <button className="entry-primary" type="submit" disabled={busy}>{busy && <LoaderCircle size={18} className="entry-spin" />}<span>{busy ? 'Отправляем код…' : 'Получить код'}</span>{!busy && <ArrowRight size={18} />}</button>
        <p className="entry-note"><ShieldCheck size={15} />Вход в два шага: данные аккаунта и одноразовый код.</p>
      </form> : <form className="entry-form" onSubmit={confirmCode} aria-busy={busy} noValidate>
        <label htmlFor="entry-code" className="entry-code-label">Код из письма</label>
        <input ref={codeRef} id="entry-code" className="entry-input entry-code-input" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="000000" value={code} readOnly={busy} aria-describedby="entry-code-help" aria-invalid={!!error} onChange={e => { setCode(otpDigits(e.target.value)); setError(''); }} onPaste={e => { if (busy) return; e.preventDefault(); setCode(otpDigits(e.clipboardData.getData('text'))); setError(''); }} />
        <p id="entry-code-help" className="entry-code-help">Код действует 10 минут. Можно вставить его целиком.</p>
        <button className="entry-primary" type="submit" disabled={code.length !== 6 || busy}>{busy && <LoaderCircle size={18} className="entry-spin" />}<span>{busy ? 'Проверяем код…' : 'Подтвердить вход'}</span>{!busy && <ArrowRight size={18} />}</button>
        <div className="entry-resend">{secondsLeft > 0 ? <span>Новый код через {secondsLeft} сек.</span> : <button type="button" className="entry-text-button" onClick={resendCode} disabled={busy}>Отправить код ещё раз</button>}</div>
        <button type="button" className="entry-text-button entry-back" disabled={busy} onClick={changeCredentials}><ArrowLeft size={15} />Изменить данные входа</button>
      </form>}
      <div className="entry-help"><strong>{step === 'otp' ? 'Письмо не пришло?' : 'Нужен доступ или забыли пароль?'}</strong>{step === 'otp' ? 'Проверьте папку «Спам» и адрес почты, привязанный к логину. Если доступа к почте нет, обратитесь к владельцу.' : 'Обратитесь к владельцу аккаунта — он управляет логинами и доступом к точкам.'}</div>
    </section>
  </EntryLayout>;
}
