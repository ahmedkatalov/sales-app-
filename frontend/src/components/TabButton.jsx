export default function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-5 py-3 rounded-2xl font-bold transition ${
        active
          ? "bg-slate-950 text-white shadow"
          : "bg-white text-slate-900 border hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}