/*
 * PWA: регистрация сервис-воркера + перехват системного предложения установки.
 * Регистрируем воркер только на https (требование PWA и чтобы не мешать локальной
 * dev-разработке по http и HMR).
 */
let deferredPrompt = null;

export function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    window.navigator.standalone === true // iOS Safari
  );
}

export function isIOS() {
  const ua = window.navigator.userAgent || '';
  const iOSDevice = /iphone|ipad|ipod/i.test(ua);
  // iPadOS 13+ маскируется под Mac — ловим по тач-точкам
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return iOSDevice || iPadOS;
}

// Safari на iOS (не Chrome/Firefox внутри iOS) — только тут работает «На экран Домой»
export function isIOSSafari() {
  const ua = window.navigator.userAgent || '';
  return isIOS() && /safari/i.test(ua) && !/crios|fxios|edgios|opios/i.test(ua);
}

export function canPromptInstall() {
  return !!deferredPrompt;
}

export async function promptInstall() {
  if (!deferredPrompt) return { outcome: 'unavailable' };
  const evt = deferredPrompt;
  deferredPrompt = null;
  evt.prompt();
  let choice = { outcome: 'dismissed' };
  try { choice = await evt.userChoice; } catch { /* пользователь закрыл */ }
  window.dispatchEvent(new CustomEvent('pwa:installable', { detail: { available: false } }));
  return choice;
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // не показываем стандартную мини-плашку — покажем свою
    deferredPrompt = e;
    window.dispatchEvent(new CustomEvent('pwa:installable', { detail: { available: true } }));
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    window.dispatchEvent(new CustomEvent('pwa:installed'));
  });

  if ('serviceWorker' in navigator && window.location.protocol === 'https:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* тихо игнорируем */ });
    });
  }
}
