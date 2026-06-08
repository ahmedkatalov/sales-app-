import { useEffect, useState } from "react";
import { del, get, post } from "../api";
import Modal from "../components/Modal";
import { formatMoney, num } from "../utils/format";

export default function PendingPaymentsPage() {
  const [list, setList] = useState([]);
  const [cards, setCards] = useState([]);
  const [selected, setSelected] = useState(null);
  const [paymentType, setPaymentType] = useState("cash");
  const [cardId, setCardId] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    const [pending, crds] = await Promise.all([
      get("/pending-sales").catch(() => []),
      get("/cards").catch(() => []),
    ]);

    setList(pending || []);
    setCards(crds || []);
    window.dispatchEvent(new Event("sales-pending-change"));
  };

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  const confirmPayment = async () => {
    if (!selected) return;
    if (paymentType === "transfer" && !cardId) return setError("Выбери карту");

    await post(`/pending-sales/${selected.id}/confirm`, {
      paymentType,
      cardId: paymentType === "transfer" ? Number(cardId) : 0,
      cashGiven: paymentType === "cash" ? num(paidAmount) : 0,
    });

    setSelected(null);
    setCardId("");
    setPaidAmount("");
    await load();
  };

  const cancel = async (id) => {
    if (!window.confirm("Отменить этот чек из ожидания?")) return;
    await del(`/pending-sales/${id}`);
    await load();
  };

  const totalWaiting = list.reduce((sum, sale) => sum + num(sale.total), 0);
  const totalItems = list.reduce(
    (sum, sale) => sum + (sale.items || []).reduce((s, i) => s + num(i.qty || 1), 0),
    0
  );

  return (
    <div className="pb-nav sm:pb-10">
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="text-sm font-bold text-blue-400">Касса</p>
          <h2 className="text-4xl font-black leading-none text-white sm:text-5xl">
            Ожидание оплаты
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">
            Чеки, которые уже собраны в кассе, но ещё не подтверждены наличными или переводом.
          </p>
        </div>

        <button
          onClick={load}
          className="w-full rounded-2xl border border-white/10 bg-white/10 px-5 py-3 font-black text-white shadow-xl transition hover:bg-white/15 sm:w-auto"
        >
          ⟳ Обновить
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-3xl border border-red-500/20 bg-red-500/10 px-4 py-3 font-bold text-red-300">
          {error}
        </div>
      )}

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <div className="rounded-[28px] border border-blue-500/30 bg-blue-500/10 p-5 shadow-2xl">
          <p className="text-xs font-black uppercase tracking-wide text-blue-200">
            Чеков ждёт
          </p>
          <p className="mt-3 text-4xl font-black text-white">{list.length}</p>
          <p className="mt-1 text-sm font-bold text-slate-400">неоплаченных</p>
        </div>

        <div className="rounded-[28px] border border-emerald-500/30 bg-emerald-500/10 p-5 shadow-2xl">
          <p className="text-xs font-black uppercase tracking-wide text-emerald-200">
            Сумма ожидания
          </p>
          <p className="mt-3 text-4xl font-black text-white">{formatMoney(totalWaiting)}</p>
          <p className="mt-1 text-sm font-bold text-slate-400">к подтверждению</p>
        </div>

        <div className="rounded-[28px] border border-violet-500/30 bg-violet-500/10 p-5 shadow-2xl">
          <p className="text-xs font-black uppercase tracking-wide text-violet-200">
            Товаров в чеках
          </p>
          <p className="mt-3 text-4xl font-black text-white">{totalItems}</p>
          <p className="mt-1 text-sm font-bold text-slate-400">единиц всего</p>
        </div>
      </div>

      <div className="rounded-[32px] border border-white/10 bg-[#0f172a]/80 shadow-2xl backdrop-blur">
        <div className="flex flex-col gap-2 border-b border-white/10 p-5 sm:p-6">
          <p className="text-sm font-bold text-blue-400">Список чеков</p>
          <h3 className="text-2xl font-black text-white sm:text-3xl">
            Ожидающие оплаты
          </h3>
          <p className="text-sm text-slate-400">
            Нажми “Оплатил”, выбери способ оплаты и подтверди чек.
          </p>
        </div>

        {list.length > 0 ? (
          <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-2">
            {list.map((s) => (
              <div
                key={s.id}
                className="rounded-[28px] border border-white/10 bg-[#111827] p-5 shadow-xl"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-slate-400">Чек #{s.id}</p>
                    <h3 className="mt-1 text-3xl font-black text-white">
                      {formatMoney(s.total)}
                    </h3>
                    <p className="mt-2 text-sm text-slate-500">
                      {s.createdAt ? new Date(s.createdAt).toLocaleString("ru-RU") : "Дата не указана"}
                    </p>
                  </div>

                  <span className="rounded-2xl border border-yellow-400/30 bg-yellow-400/10 px-3 py-2 text-sm font-black text-yellow-300">
                    Ждёт
                  </span>
                </div>

                <div className="mt-4 space-y-2 rounded-3xl border border-white/10 bg-[#0b1120] p-4 text-sm">
                  {(s.items || []).map((i) => (
                    <div
                      key={`${s.id}-${i.productId}-${i.name}`}
                      className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.03] px-3 py-2"
                    >
                      <span className="min-w-0 truncate font-bold text-slate-200">
                        {i.name} × {i.qty}
                      </span>
                      <b className="shrink-0 text-white">
                        {formatMoney(i.total || num(i.price) * num(i.qty))}
                      </b>
                    </div>
                  ))}

                  {!(s.items || []).length && (
                    <div className="rounded-2xl bg-white/[0.03] px-3 py-3 text-slate-500">
                      В чеке нет позиций
                    </div>
                  )}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <button
                    onClick={() => {
                      setError("");
                      setSelected(s);
                    }}
                    className="rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 font-black text-white shadow-lg shadow-blue-900/30 transition hover:scale-[1.01]"
                  >
                    Оплатил
                  </button>

                  <button
                    onClick={() => cancel(s.id)}
                    className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 font-black text-red-300 transition hover:bg-red-500/15"
                  >
                    Отменить
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-10 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-white/10 text-3xl">
              ✓
            </div>
            <p className="text-xl font-black text-white">Ожидающих оплат нет</p>
            <p className="mt-2 text-sm text-slate-400">Все чеки сейчас закрыты.</p>
          </div>
        )}
      </div>

      {selected && (
        <Modal title="Подтвердить оплату">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm font-bold text-slate-400">Итого к оплате</p>
            <p className="mt-1 text-3xl font-black text-white">
              {formatMoney(selected.total)}
            </p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              onClick={() => setPaymentType("cash")}
              className={
                paymentType === "cash"
                  ? "rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 font-black text-white"
                  : "rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-black text-slate-200"
              }
            >
              Наличные
            </button>

            <button
              onClick={() => setPaymentType("transfer")}
              className={
                paymentType === "transfer"
                  ? "rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 font-black text-white"
                  : "rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-black text-slate-200"
              }
            >
              Перевод
            </button>
          </div>

          {paymentType === "cash" ? (
            <input
              value={paidAmount}
              onChange={(e) => setPaidAmount(e.target.value)}
              placeholder="Сколько дал клиент"
              className="mt-4 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500"
            />
          ) : (
            <select
              value={cardId}
              onChange={(e) => setCardId(e.target.value)}
              className="mt-4 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none"
            >
              <option value="">Выбери карту</option>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.owner ? ` · ${c.owner}` : ""}
                </option>
              ))}
            </select>
          )}

          <div className="mt-6 grid grid-cols-2 gap-3">
            <button
              onClick={() => setSelected(null)}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-black text-slate-200"
            >
              Назад
            </button>

            <button
              onClick={confirmPayment}
              className="rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 font-black text-white shadow-lg shadow-blue-900/30"
            >
              Подтвердить
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
