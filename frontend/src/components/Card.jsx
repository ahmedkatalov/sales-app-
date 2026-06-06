import { formatMoney } from "../utils/format";

export default function Card({ title, value, green, red, blue }) {
  return (
    <div className="bg-white/95 rounded-3xl p-5 shadow border border-slate-200">
      <p className="text-slate-500 text-sm font-semibold">{title}</p>
      <h3
        className={`text-3xl font-black mt-2 ${
          green
            ? "text-emerald-600"
            : red
            ? "text-red-600"
            : blue
            ? "text-blue-600"
            : "text-slate-950"
        }`}
      >
        {formatMoney(value)}
      </h3>
    </div>
  );
}