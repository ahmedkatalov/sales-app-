export default function TableShell({ title, subtitle, children, action }) {
  return (
    <div className="bg-white rounded-3xl shadow-xl overflow-hidden border border-slate-200 flex flex-col min-h-[760px] scroll-mt-6">
      <div className="shrink-0 px-6 py-4 border-b bg-white flex items-center justify-between gap-4">
        <div>
          <h3 className="text-2xl font-black">{title}</h3>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </div>
  );
}
