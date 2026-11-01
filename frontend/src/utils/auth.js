const OTP_PENDING_KEY = 'sales_app_otp_pending';
export const OTP_PENDING_TTL = 10 * 60 * 1000;
export const OTP_RESEND_DELAY = 60 * 1000;

export function validOtpPending(value, now = Date.now()) {
  if (!value || typeof value.username !== 'string' || !value.username.trim() || !Number.isFinite(value.sentAt)) return null;
  const age = now - value.sentAt;
  if (age < 0 || age >= OTP_PENDING_TTL) return null;
  return { username: value.username.trim(), maskedEmail: typeof value.maskedEmail === 'string' ? value.maskedEmail : '', sentAt: value.sentAt };
}

// Only the login, masked email and request time survive a reload; never a password or code.
export const otpPendingStore = {
  read() {
    try { return validOtpPending(JSON.parse(localStorage.getItem(OTP_PENDING_KEY))); }
    catch { return null; }
  },
  save(value) { try { localStorage.setItem(OTP_PENDING_KEY, JSON.stringify(validOtpPending(value))); } catch { /* Storage may be unavailable. */ } },
  clear() { try { localStorage.removeItem(OTP_PENDING_KEY); } catch { /* Storage may be unavailable. */ } },
};

export const otpDigits = value => String(value).replace(/\D/g, '').slice(0, 6);
export const otpSecondsLeft = (sentAt, now = Date.now()) => Math.max(0, Math.ceil((sentAt + OTP_RESEND_DELAY - now) / 1000));

export function authErrorMessage(error, codeStep = false) {
  const message = error?.message || '';
  if (/слишком много|too many|429|rate/i.test(message)) return 'Слишком много попыток. Подождите минуту и попробуйте снова.';
  if (codeStep && /истёк|истек|expired/i.test(message)) return 'Срок действия кода истёк. Запросите новый код.';
  if (/failed to fetch|networkerror|load failed|connect|ERR_CONNECTION|timeout|localhost:3000|сет|network/i.test(message)) return 'Не удаётся подключиться к серверу. Проверьте интернет и попробуйте снова.';
  if (/50\d|server|внутренн/i.test(message)) return 'Ошибка на сервере. Попробуйте чуть позже.';
  if (/неверн|unauthorized|invalid|wrong|not found|не найден|401/i.test(message)) return codeStep ? 'Неверный код. Проверьте письмо и попробуйте снова.' : 'Неверный логин или пароль.';
  return message || (codeStep ? 'Не удалось подтвердить код. Попробуйте снова.' : 'Не удалось отправить код. Попробуйте снова.');
}
