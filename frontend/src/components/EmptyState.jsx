// Премиальное «пустое состояние» — тёмная тема, единый вид на всё приложение.
// Вместо тупика «данных нет» показывает понятный следующий шаг с кнопкой.
//
// props:
//   icon        — ReactNode (SVG/emoji). Если не передан — рисуется дефолтный.
//   title       — заголовок (что тут будет)
//   text        — подсказка (1–2 строки)
//   actionLabel + onAction — основное действие (кнопка). Необязательно.
//   secondaryLabel + onSecondary — второстепенное действие (кнопка). Необязательно.
//   className   — доп. классы контейнера.
export default function EmptyState({
  icon,
  title,
  text,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  className = "",
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-3xl border border-dashed border-white/12 bg-white/[0.02] px-6 py-12 text-center ${className}`}
    >
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-white/[0.06] text-slate-300 shadow-inner shadow-white/5">
        {icon || (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8l9-5 9 5-9 5-9-5z" />
            <path d="M3 8v8l9 5 9-5V8" />
            <path d="M12 13v8" />
          </svg>
        )}
      </div>

      {title && <h3 className="text-lg font-black text-white">{title}</h3>}
      {text && <p className="mt-1.5 max-w-sm text-sm leading-6 text-slate-400">{text}</p>}

      {(actionLabel || secondaryLabel) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          {actionLabel && onAction && (
            <button
              type="button"
              onClick={onAction}
              className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-3 font-black text-white shadow-lg shadow-blue-900/30 transition hover:brightness-110 active:scale-[0.98]"
            >
              {actionLabel}
            </button>
          )}
          {secondaryLabel && onSecondary && (
            <button
              type="button"
              onClick={onSecondary}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 font-black text-slate-200 transition hover:bg-white/10 active:scale-[0.98]"
            >
              {secondaryLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
