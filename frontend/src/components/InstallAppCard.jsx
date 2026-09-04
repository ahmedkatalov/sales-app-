import { useEffect, useState } from "react";
import { Download, Check } from "lucide-react";
import { isStandalone, isIOS, canPromptInstall, promptInstall } from "../pwa";

// Постоянная точка установки приложения (в Настройках) — доступна всегда,
// в отличие от всплывающего баннера. На Android — реальная установка,
// на iOS — инструкция «Поделиться → На экран Домой».
function ShareGlyph({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block align-[-2px]">
      <path d="M12 3v13M8 7l4-4 4 4M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}

export default function InstallAppCard() {
  const [standalone] = useState(isStandalone());
  const [available, setAvailable] = useState(canPromptInstall());
  const [installing, setInstalling] = useState(false);
  const ios = isIOS();

  useEffect(() => {
    const onInstallable = (e) => setAvailable(!!e.detail?.available);
    const onInstalled = () => setAvailable(false);
    window.addEventListener("pwa:installable", onInstallable);
    window.addEventListener("pwa:installed", onInstalled);
    return () => {
      window.removeEventListener("pwa:installable", onInstallable);
      window.removeEventListener("pwa:installed", onInstalled);
    };
  }, []);

  const install = async () => {
    setInstalling(true);
    try { await promptInstall(); } finally { setInstalling(false); }
  };

  // Уже установлено — показываем спокойный статус.
  if (standalone) {
    return (
      <div className="rounded-3xl border border-emerald-400/25 bg-emerald-500/[0.07] p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-300">
            <Check size={22} strokeWidth={2.6} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-black text-white">Приложение установлено</p>
            <p className="text-xs font-bold text-slate-400">Вы открыли Okvion Sales как приложение.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4 shadow-xl sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-lg shadow-blue-600/30">
          <Download size={22} strokeWidth={2.4} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black text-white">Установить приложение</p>
          {ios ? (
            <p className="mt-1 text-xs leading-snug text-slate-400">
              Нажмите <ShareGlyph /> «Поделиться» в браузере, затем «На&nbsp;экран „Домой“» — Okvion Sales появится как обычное приложение.
            </p>
          ) : (
            <p className="mt-1 text-xs leading-snug text-slate-400">
              Открывайте кассу с домашнего экрана, на весь экран, без адресной строки — как обычное приложение.
            </p>
          )}

          {!ios && available && (
            <button
              type="button"
              onClick={install}
              disabled={installing}
              className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-2.5 text-sm font-black text-white shadow-lg shadow-blue-900/30 transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            >
              <Download size={16} strokeWidth={2.6} /> {installing ? "Устанавливаю…" : "Установить"}
            </button>
          )}

          {!ios && !available && (
            <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] font-bold text-slate-400">
              Откройте сайт в Chrome и выберите «Установить приложение» в меню браузера (⋮). Если кнопка не появляется — попользуйтесь приложением минуту и вернитесь сюда.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
