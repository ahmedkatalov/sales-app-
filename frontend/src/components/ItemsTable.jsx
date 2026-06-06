import { formatMoney } from "../utils/format";

export default function ItemsTable({ items = [], totals = {}, updateItem, deleteItem }) {
  return (
    <div className="h-[calc(100vh-250px)] min-h-[680px] overflow-y-auto overflow-x-auto">
      <table className="w-full min-w-[1050px] text-sm">
        <thead className="bg-slate-100 text-slate-600 sticky top-0 z-20">
          <tr>
            <th className="p-4 text-left">Название</th>
            <th className="p-4">Себестоимость</th>
            <th className="p-4">Цена продажи</th>
            <th className="p-4">Кол-во</th>
            <th className="p-4">Выручка</th>
            <th className="p-4">Чистая прибыль</th>
            <th className="p-4"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const revenue = Number(item.price || 0) * Number(item.qty || 0);
            const profit = (Number(item.price || 0) - Number(item.cost || 0)) * Number(item.qty || 0);
            return (
              <tr key={item.id} className="border-t hover:bg-blue-50/40">
                {["name", "cost", "price", "qty"].map((field) => (
                  <td key={field} className="p-3">
                    <input
                      type="text"
                      inputMode={field === "name" ? "text" : "decimal"}
                      value={item[field] ?? ""}
                      onChange={(e) => updateItem?.(item, field, e.target.value)}
                      className="w-full px-3 py-2 border rounded-xl text-slate-900 text-center outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </td>
                ))}
                <td className="p-3 text-center font-bold">{formatMoney(revenue)}</td>
                <td className="p-3 text-center font-bold text-emerald-600">{formatMoney(profit)}</td>
                <td className="p-3 text-center"><button onClick={() => deleteItem?.(item.id)} className="px-3 py-2 rounded-lg bg-red-50 text-red-600 font-bold hover:bg-red-100">✕</button></td>
              </tr>
            );
          })}
          {items.length === 0 && <tr><td colSpan="7" className="p-12 text-center text-slate-400">Пока товаров нет.</td></tr>}
        </tbody>
        <tfoot className="bg-slate-950 text-white font-black sticky bottom-0 z-20">
          <tr><td className="p-4" colSpan="4">ИТОГО</td><td className="p-4 text-center">{formatMoney(totals.revenue)}</td><td className="p-4 text-center">{formatMoney(totals.cleanProfit)}</td><td></td></tr>
        </tfoot>
      </table>
    </div>
  );
}
