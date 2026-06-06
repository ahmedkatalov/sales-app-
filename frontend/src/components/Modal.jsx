export default function Modal({ title, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#030816]/80 px-3 py-3 backdrop-blur-xl sm:px-6 sm:py-8">
      <style>{`
        .smart-modal-panel {
          background:
            radial-gradient(circle at 10% 0%, rgba(37, 99, 235, 0.18), transparent 32%),
            radial-gradient(circle at 90% 0%, rgba(124, 58, 237, 0.18), transparent 34%),
            linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(2, 6, 23, 0.98));
          border: 1px solid rgba(148, 163, 184, 0.18);
          box-shadow: 0 30px 90px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.06);
        }
        .smart-modal-panel .bg-white,
        .smart-modal-panel .bg-slate-50,
        .smart-modal-panel .bg-slate-100 {
          background: rgba(15, 23, 42, 0.58) !important;
        }
        .smart-modal-panel .bg-blue-50 {
          background: rgba(37, 99, 235, 0.13) !important;
        }
        .smart-modal-panel .bg-emerald-50 {
          background: rgba(16, 185, 129, 0.13) !important;
        }
        .smart-modal-panel .bg-red-50 {
          background: rgba(239, 68, 68, 0.13) !important;
        }
        .smart-modal-panel .bg-yellow-50 {
          background: rgba(245, 158, 11, 0.14) !important;
        }
        .smart-modal-panel .border,
        .smart-modal-panel .border-t,
        .smart-modal-panel .border-b,
        .smart-modal-panel .border-y,
        .smart-modal-panel .border-slate-100,
        .smart-modal-panel .border-slate-200 {
          border-color: rgba(148, 163, 184, 0.16) !important;
        }
        .smart-modal-panel .divide-y > :not([hidden]) ~ :not([hidden]) {
          border-color: rgba(148, 163, 184, 0.14) !important;
        }
        .smart-modal-panel .text-slate-950,
        .smart-modal-panel .text-slate-900,
        .smart-modal-panel .text-slate-800 {
          color: #f8fafc !important;
        }
        .smart-modal-panel .text-slate-700,
        .smart-modal-panel .text-slate-600 {
          color: #cbd5e1 !important;
        }
        .smart-modal-panel .text-slate-500,
        .smart-modal-panel .text-slate-400 {
          color: #94a3b8 !important;
        }
        .smart-modal-panel .text-blue-700,
        .smart-modal-panel .text-blue-600 {
          color: #60a5fa !important;
        }
        .smart-modal-panel .text-blue-900\/70 {
          color: rgba(191, 219, 254, 0.78) !important;
        }
        .smart-modal-panel .text-red-800,
        .smart-modal-panel .text-red-600 {
          color: #fca5a5 !important;
        }
        .smart-modal-panel .text-yellow-800 {
          color: #fde68a !important;
        }
        .smart-modal-panel table thead,
        .smart-modal-panel thead.bg-slate-100 {
          background: rgba(30, 41, 59, 0.75) !important;
        }
        .smart-modal-panel table tbody tr {
          background: rgba(2, 6, 23, 0.2) !important;
        }
        .smart-modal-panel .input,
        .smart-modal-panel input,
        .smart-modal-panel select,
        .smart-modal-panel textarea {
          background: rgba(15, 23, 42, 0.8) !important;
          border: 1px solid rgba(148, 163, 184, 0.22) !important;
          color: #f8fafc !important;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04) !important;
        }
        .smart-modal-panel .input::placeholder,
        .smart-modal-panel input::placeholder,
        .smart-modal-panel textarea::placeholder {
          color: #64748b !important;
        }
        .smart-modal-panel .input:focus,
        .smart-modal-panel input:focus,
        .smart-modal-panel select:focus,
        .smart-modal-panel textarea:focus {
          outline: none !important;
          border-color: rgba(96, 165, 250, 0.65) !important;
          box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.14) !important;
        }
        .smart-modal-panel .btn-white {
          background: rgba(15, 23, 42, 0.72) !important;
          color: #e2e8f0 !important;
          border: 1px solid rgba(148, 163, 184, 0.18) !important;
          box-shadow: none !important;
        }
        .smart-modal-panel .btn-white:hover {
          background: rgba(30, 41, 59, 0.85) !important;
        }
        .smart-modal-panel .btn-blue {
          background: linear-gradient(135deg, #2563eb, #7c3aed) !important;
          color: #fff !important;
          box-shadow: 0 16px 35px rgba(37, 99, 235, 0.28) !important;
        }
      `}</style>

      <div className="flex min-h-full items-end justify-center sm:items-center">
        <div
          className={`smart-modal-panel max-h-[calc(100vh-1.5rem)] w-full overflow-hidden rounded-[1.75rem] sm:rounded-[2rem] ${
            wide ? "max-w-[920px]" : "max-w-[520px]"
          }`}
        >
          <div className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/60 px-5 py-4 backdrop-blur-xl sm:px-6 sm:py-5">
            <div className="mb-3 h-1 w-12 rounded-full bg-gradient-to-r from-blue-500 to-violet-500 sm:hidden" />
            <p className="text-xs font-black uppercase tracking-[0.24em] text-blue-300/80">Склад</p>
            <h2 className="mt-1 text-2xl font-black leading-tight text-white sm:text-3xl">{title}</h2>
          </div>

          <div className="max-h-[calc(100vh-8rem)] overflow-y-auto px-5 py-5 text-slate-200 sm:max-h-[calc(100vh-10rem)] sm:px-6 sm:py-6">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
