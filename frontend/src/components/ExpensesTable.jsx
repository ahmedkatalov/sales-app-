import { formatMoney, money } from "../utils/format";

export default function ExpensesTable({ expenses = [], deleteExpense }) {
  return (
    <div className="h-[calc(100vh-250px)] min-h-[680px] overflow-auto">
      <table className="w-full min-w-[1000px] text-sm">
        <thead className="bg-slate-100 text-slate-600 sticky top-0 z-20">
          <tr>
            <th className="p-4 text-left">Тип</th>
            <th className="p-4 text-left">Подтип</th>
            <th className="p-4 text-left">Название</th>
            <th className="p-4">Кол-во</th>
            <th className="p-4">Цена</th>
            <th className="p-4">Сумма</th>
            <th className="p-4 text-left">Комментарий</th>
            <th className="p-4"></th>
          </tr>
        </thead>
        <tbody>
          {expenses.map((e) => (
            <tr key={e.id} className="border-t hover:bg-red-50/30">
              <td className="p-4 font-bold">{e.type}</td>
              <td className="p-4">{e.subType || "-"}</td>
              <td className="p-4">{e.name || "-"}</td>
              <td className="p-4 text-center">{e.qty || "-"}</td>
              <td className="p-4 text-center">{e.price || "-"}</td>
              <td className="p-4 text-center font-black text-red-600">{formatMoney(e.amount)}</td>
              <td className="p-4">{e.comment || "-"}</td>
              <td className="p-4 text-center"><button onClick={() => deleteExpense?.(e.id)} className="px-3 py-2 rounded-lg bg-red-50 text-red-600 font-bold hover:bg-red-100">✕</button></td>
            </tr>
          ))}
          {expenses.length === 0 && <tr><td colSpan="8" className="p-12 text-center text-slate-400">Расходов пока нет.</td></tr>}
        </tbody>
        <tfoot className="bg-slate-950 text-white font-black sticky bottom-0 z-20">
          <tr><td className="p-4" colSpan="5">ИТОГО</td><td className="p-4 text-center">{formatMoney(expenses.reduce((s, e) => s + money(e.amount), 0))}</td><td colSpan="2"></td></tr>
        </tfoot>
      </table>
    </div>
  );
}
