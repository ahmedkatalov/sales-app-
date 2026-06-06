export default function ChartCard({ title, children }) {
  return (
    <div className="bg-white rounded-3xl shadow-xl border border-slate-200 p-5">
      <h3 className="text-xl font-black mb-4">{title}</h3>
      {children}
    </div>
  );
}