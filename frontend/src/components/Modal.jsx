import { useEffect } from "react";
import { X } from "lucide-react";

// legacyLight по умолчанию true: почти все модалки написаны светлыми классами
// (bg-white/text-slate-900/…) и полагаются на этот тёмный оверрайд. Новые модалки,
// целиком собранные на тёмных классах дизайн-системы, могут отключить его legacyLight={false}.
// zIndex — для случая «модалка над модалкой» (напр. добавление карты поверх
// окна оплаты). По умолчанию 50; вложенной передаём больше, чтобы она была сверху.
export default function Modal({ title, section, children, wide, onClose, legacyLight = true, zIndex }) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Пока открыта модалка — прячем нижнюю панель и install-баннер (иначе их кнопки
  // перекрывают кнопки модалки снизу). Счётчик — на случай вложенных модалок.
  useEffect(() => {
    window.__modalOpenCount = (window.__modalOpenCount || 0) + 1;
    document.body.classList.add("modal-open");
    return () => {
      window.__modalOpenCount = Math.max(0, (window.__modalOpenCount || 1) - 1);
      if (window.__modalOpenCount === 0) document.body.classList.remove("modal-open");
    };
  }, []);

  const handleBackdrop = (e) => {
    if (onClose && e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="animate-overlay fixed inset-0 z-50 overflow-y-auto bg-[#030816]/80 px-3 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-xl sm:px-6 sm:py-8"
      style={zIndex ? { zIndex } : undefined}
      onClick={handleBackdrop}
    >
      <style>{`
        .smart-modal-panel {
          background:
            radial-gradient(circle at 10% 0%, rgba(37, 99, 235, 0.18), transparent 32%),
            radial-gradient(circle at 90% 0%, rgba(124, 58, 237, 0.18), transparent 34%),
            linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(2, 6, 23, 0.98));
          border: 1px solid rgba(148, 163, 184, 0.18);
          box-shadow: 0 30px 90px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.06);
        }
        .smart-modal-panel.legacy-light .bg-white,
        .smart-modal-panel.legacy-light .bg-slate-50,
        .smart-modal-panel.legacy-light .bg-slate-100 {
          background: rgba(15, 23, 42, 0.58) !important;
        }
        .smart-modal-panel.legacy-light .bg-blue-50 {
          background: rgba(37, 99, 235, 0.13) !important;
        }
        .smart-modal-panel.legacy-light .bg-emerald-50 {
          background: rgba(16, 185, 129, 0.13) !important;
        }
        .smart-modal-panel.legacy-light .bg-red-50 {
          background: rgba(239, 68, 68, 0.13) !important;
        }
        .smart-modal-panel.legacy-light .bg-yellow-50 {
          background: rgba(245, 158, 11, 0.14) !important;
        }
        .smart-modal-panel.legacy-light .border,
        .smart-modal-panel.legacy-light .border-t,
        .smart-modal-panel.legacy-light .border-b,
        .smart-modal-panel.legacy-light .border-y,
        .smart-modal-panel.legacy-light .border-slate-100,
        .smart-modal-panel.legacy-light .border-slate-200 {
          border-color: rgba(148, 163, 184, 0.16) !important;
        }
        .smart-modal-panel.legacy-light .divide-y > :not([hidden]) ~ :not([hidden]) {
          border-color: rgba(148, 163, 184, 0.14) !important;
        }
        .smart-modal-panel.legacy-light .text-slate-950,
        .smart-modal-panel.legacy-light .text-slate-900,
        .smart-modal-panel.legacy-light .text-slate-800 {
          color: #f8fafc !important;
        }
        .smart-modal-panel.legacy-light .text-slate-700,
        .smart-modal-panel.legacy-light .text-slate-600 {
          color: #cbd5e1 !important;
        }
        .smart-modal-panel.legacy-light .text-slate-500,
        .smart-modal-panel.legacy-light .text-slate-400 {
          color: #94a3b8 !important;
        }
        .smart-modal-panel.legacy-light .text-blue-700,
        .smart-modal-panel.legacy-light .text-blue-600 {
          color: #60a5fa !important;
        }
        .smart-modal-panel.legacy-light .text-blue-900\\/70 {
          color: rgba(191, 219, 254, 0.78) !important;
        }
        .smart-modal-panel.legacy-light .text-red-800,
        .smart-modal-panel.legacy-light .text-red-600 {
          color: #fca5a5 !important;
        }
        .smart-modal-panel.legacy-light .text-yellow-800 {
          color: #fde68a !important;
        }
        .smart-modal-panel.legacy-light table thead,
        .smart-modal-panel.legacy-light thead.bg-slate-100 {
          background: rgba(30, 41, 59, 0.75) !important;
        }
        .smart-modal-panel.legacy-light table tbody tr {
          background: rgba(2, 6, 23, 0.2) !important;
        }
        .smart-modal-panel.legacy-light .input,
        .smart-modal-panel.legacy-light input,
        .smart-modal-panel.legacy-light select,
        .smart-modal-panel.legacy-light textarea {
          background: rgba(15, 23, 42, 0.8) !important;
          border: 1px solid rgba(148, 163, 184, 0.22) !important;
          color: #f8fafc !important;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04) !important;
        }
        .smart-modal-panel.legacy-light .input::placeholder,
        .smart-modal-panel.legacy-light input::placeholder,
        .smart-modal-panel.legacy-light textarea::placeholder {
          color: #64748b !important;
        }
        .smart-modal-panel.legacy-light .input:focus,
        .smart-modal-panel.legacy-light input:focus,
        .smart-modal-panel.legacy-light select:focus,
        .smart-modal-panel.legacy-light textarea:focus {
          outline: none !important;
          border-color: rgba(96, 165, 250, 0.65) !important;
          box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.14) !important;
        }
        .smart-modal-panel.legacy-light .btn-white {
          background: rgba(15, 23, 42, 0.72) !important;
          color: #e2e8f0 !important;
          border: 1px solid rgba(148, 163, 184, 0.18) !important;
          box-shadow: none !important;
        }
        .smart-modal-panel.legacy-light .btn-white:hover {
          background: rgba(30, 41, 59, 0.85) !important;
        }
        .smart-modal-panel.legacy-light .btn-blue {
          background: linear-gradient(135deg, #2563eb, #7c3aed) !important;
          color: #fff !important;
          box-shadow: 0 16px 35px rgba(37, 99, 235, 0.28) !important;
        }
      `}</style>

      <div
        className="flex min-h-full items-end justify-center sm:items-center"
        onClick={handleBackdrop}
      >
        <div
          className={`animate-sheet smart-modal-panel ${legacyLight ? "legacy-light" : ""} flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-[1.75rem] sm:rounded-4xl ${
            wide ? "max-w-[920px]" : "max-w-[520px]"
          }`}
        >
          <div className="flex-none border-b border-white/10 bg-slate-950/60 px-5 py-4 backdrop-blur-xl sm:px-6 sm:py-5">
            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                aria-label="Закрыть"
                className="mx-auto mb-3.5 flex h-6 w-16 items-center justify-center sm:hidden"
              >
                <span className="h-1 w-10 rounded-full bg-white/25" />
              </button>
            ) : (
              <div className="mb-3.5 flex justify-center sm:hidden">
                <div className="h-1 w-10 rounded-full bg-white/25" />
              </div>
            )}
            <div className="flex items-start justify-between gap-3">
              <div>
                {section && <p className="text-[11px] font-black uppercase tracking-[0.22em] text-blue-300/80">{section}</p>}
                <h2 className={`text-2xl font-black leading-tight text-white sm:text-3xl ${section ? "mt-0.5" : ""}`}>{title}</h2>
              </div>
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Закрыть"
                  className="hidden shrink-0 rounded-xl p-2 text-slate-400 transition hover:bg-white/5 hover:text-white sm:block"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 text-slate-200 sm:px-6 sm:py-6">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
