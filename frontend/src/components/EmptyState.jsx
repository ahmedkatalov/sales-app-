export default function EmptyState({ title, text }) {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="bg-white/90 rounded-3xl shadow-xl p-10 text-center max-w-md border border-white">
        <h2 className="text-3xl font-black mb-3">{title}</h2>
        <p className="text-slate-500">{text}</p>
      </div>
    </div>
  );
}