import { useEffect, useState } from "react";
import { ShoppingCart, X } from "lucide-react";
import { isStandalone, isIOSSafari, canPromptInstall, promptInstall } from "../pwa";

const DISMISS_KEY = "noorcoffe_pwa_dismissed";
const COOLDOWN = 14 * 24 * 60 * 60 * 1000; // не надоедаем: 14 дней после закрытия

function recentlyDismissed() {
  try {
    const t = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return t && Date.now() - t < COOLDOWN;
  } catch {
    return false;
  }
}

// Иконка «Поделиться» (iOS) — рисуем инлайн, чтобы не зависеть от набора lucide.
function ShareGlyph({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block align-[-2px]">
      <path d="M12 3v13M8 7l4-4 4 4M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}

export default function InstallPrompt() {
  const [available, setAvailable] = useState(canPromptInstall());
  const [visible, setVisible] = useState(false);
  const ios = isIOSSafari();

  useEffect(() => {
    if (isStandalone() || recentlyDismissed()) return;
    const onInstallable = (e) => {
      setAvailable(!!e.detail?.available);
      if (e.detail?.available) setVisible(true);
    };
    const onInstalled = () => setVisible(false);
    window.addEventListener("pwa:installable", onInstallable);
    window.addEventListener("pwa:installed", onInstalled);
    // iOS не шлёт beforeinstallprompt — показываем подсказку сами, с задержкой
    const t = ios ? setTimeout(() => setVisible(true), 1500) : null;
    return () => {
      if (t) clearTimeout(t);
      window.removeEventListener("pwa:installable", onInstallable);
      window.removeEventListener("pwa:installed", onInstalled);
    };
  }, [ios]);

  if (isStandalone() || !visible) return null;
  if (!ios && !available) return null; // на Android показываем только когда система готова

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
    setVisible(false);
  };

  const install = async () => {
    const res = await promptInstall();
    if (res.outcome === "dismissed") dismiss();
    else setVisible(false);
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] p-3 sm:p-4"
      style={{ paddingBottom: "calc(var(--nav-h, 0px) + env(safe-area-inset-bottom, 0px) + 12px)" }}>
      <div className="animate-toast pointer-events-auto relative mx-auto max-w-sm rounded-2xl border border-white/12 bg-slate-900/95 p-4 shadow-2xl backdrop-blur-xl">
        <button onClick={dismiss} aria-label="Закрыть" title="Закрыть"
          className="absolute right-1.5 top-1.5 inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white">
          <X size={18} />
        </button>

        <div className="flex items-start gap-3 pr-8">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-lg shadow-blue-600/30">
            <ShoppingCart size={24} strokeWidth={2.6} />
          </div>
          <div className="min-w-0">
            {ios ? (
              <>
                <p className="text-sm font-black text-white">Установить NoorCoffe</p>
                <p className="mt-1 text-xs leading-snug text-slate-400">
                  Нажмите <ShareGlyph /> «Поделиться», затем «На&nbsp;экран „Домой“».
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-black text-white">Установить приложение</p>
                <p className="mt-1 text-xs leading-snug text-slate-400">
                  Открывайте кассу с домашнего экрана — как обычное приложение.
                </p>
              </>
            )}
          </div>
        </div>

        {!ios && (
          <button onClick={install}
            className="mt-3 w-full rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-blue-600/30 transition active:scale-95 hover:from-blue-500 hover:to-blue-400">
            Установить
          </button>
        )}
      </div>
    </div>
  );
}
