import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
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
  const [modalError, setModalError] = useState("");
  const [confirming, setConfirming] = useState(false); // защита от двойного тапа → дубль продажи

  const safe_list = Array.isArray(list) ? list : [];
  const safe_cards = Array.isArray(cards) ? cards : [];

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
    if (!selected || confirming) return; // не даём отправить второй запрос по тому же чеку
    if (paymentType === "transfer" && !cardId) return setModalError("Выберите карту");
    setConfirming(true);
    try {
      await post(`/pending-sales/${selected.id}/confirm`, {
        paymentType,
        cardId: paymentType === "transfer" ? Number(cardId) : 0,
        cashGiven: paymentType === "cash" ? num(paidAmount) : 0,
      });
      setSelected(null);
      setCardId("");
      setPaidAmount("");
      setModalError("");
      await load();
    } catch (e) {
      // напр. 409 «Этот чек уже обработан» (параллельное подтверждение) — обновим список
      setModalError(e?.message || "Не удалось подтвердить чек");
      await load().catch(() => {});
    } finally {
      setConfirming(false);
    }
  };

  const cancel = async (id) => {
    if (!window.confirm("Убрать этот чек из ожидания?")) return;
    await del(`/pending-sales/${id}`);
    await load();
  };

  const totalWaiting = safe_list.reduce((sum, sale) => sum + num(sale.total), 0);
  const totalItems = safe_list.reduce(
    (sum, sale) => sum + (sale.items || []).reduce((s, i) => s + num(i.qty || 1), 0),
    0
  );

  return (
    <div className="pb-nav sm:pb-10">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-blue-400">Касса</p>
          <h2 className="text-3xl font-black leading-none text-white sm:text-4xl">Ожидают оплаты</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            Чеки собраны в кассе, но ещё не оплачены наличными или переводом.
          </p>
        </div>

        <button
          onClick={load}
          aria-label="Обновить"
          className="flex h-11 shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 font-bold text-slate-200 transition hover:bg-white/10"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/></svg>
          <span className="hidden sm:inline">Обновить</span>
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 font-bold text-red-300">
          {error}
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
        <div className="rounded-2xl border border-blue-500/25 bg-blue-500/[0.08] p-3 sm:p-4">
          <p className="text-[11px] font-black uppercase tracking-wide text-blue-200/90 sm:text-[11px]">Ожидают</p>
          <p className="mt-1.5 text-xl font-black text-white sm:text-2xl">{safe_list.length}</p>
          <p className="text-[11px] font-semibold text-slate-500">неоплаченных чеков</p>
        </div>
        <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.08] p-3 sm:p-4">
          <p className="text-[11px] font-black uppercase tracking-wide text-emerald-200/90 sm:text-[11px]">Сумма</p>
          <p className="mt-1.5 text-xl font-black tabular-nums text-white sm:text-2xl">{formatMoney(totalWaiting)}</p>
          <p className="text-[11px] font-semibold text-slate-500">к оплате</p>
        </div>
        <div className="col-span-2 rounded-2xl border border-violet-500/25 bg-violet-500/[0.08] p-3 sm:col-span-1 sm:p-4">
          <p className="text-[11px] font-black uppercase tracking-wide text-violet-200/90 sm:text-[11px]">Товаров</p>
          <p className="mt-1.5 text-xl font-black text-white sm:text-2xl">{totalItems}</p>
          <p className="text-[11px] font-semibold text-slate-500">единиц всего</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] shadow-xl backdrop-blur">
        <div className="border-b border-white/10 p-4 sm:p-5">
          <h3 className="text-xl font-black text-white sm:text-2xl">Список чеков</h3>
          <p className="mt-1 text-sm text-slate-400">Нажмите «Принять оплату», выберите способ и подтвердите.</p>
        </div>

        {safe_list.length > 0 ? (
          <div className="grid gap-3 p-3 sm:p-5 lg:grid-cols-2">
            {safe_list.map((s) => (
              <div key={s.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-500">Чек #{s.id}</p>
                    <h3 className="mt-0.5 text-2xl font-black tabular-nums text-white sm:text-3xl">{formatMoney(s.total)}</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {s.createdAt ? new Date(s.createdAt).toLocaleDateString("ru-RU") : "—"}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-black text-amber-300">
                    Ожидает
                  </span>
                </div>

                <div className="mt-3 space-y-1.5 rounded-xl border border-white/10 bg-slate-950/40 p-3 text-sm">
                  {(s.items || []).map((i) => (
                    <div key={`${s.id}-${i.productId}-${i.name}`} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate font-bold text-slate-200">{i.name} × {i.qty}</span>
                      <b className="shrink-0 tabular-nums text-white">{formatMoney(i.total || num(i.price) * num(i.qty))}</b>
                    </div>
                  ))}
                  {!(s.items || []).length && <div className="text-slate-500">В чеке нет позиций</div>}
                </div>

                <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                  <button
                    onClick={() => { setModalError(""); setSelected(s); }}
                    className="rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 font-black text-white shadow-lg shadow-blue-900/30 transition hover:brightness-110"
                  >
                    Принять оплату
                  </button>
                  <button
                    onClick={() => cancel(s.id)}
                    className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 font-black text-red-300 transition hover:bg-red-500/20"
                  >
                    Убрать
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-10 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300"><CheckCircle2 size={28} strokeWidth={2.4} /></div>
            <p className="text-lg font-black text-white">Всё оплачено</p>
            <p className="mt-1 text-sm text-slate-400">Чеков в ожидании нет.</p>
          </div>
        )}
      </div>

      {selected && (
        <Modal title="Принять оплату">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm font-bold text-slate-400">Итого к оплате</p>
            <p className="mt-1 text-3xl font-black tabular-nums text-white">{formatMoney(selected.total)}</p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              onClick={() => { setPaymentType("cash"); setModalError(""); }}
              className={paymentType === "cash"
                ? "rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 font-black text-white"
                : "rounded-xl border border-white/10 bg-white/5 px-4 py-3 font-black text-slate-200"}
            >Наличные</button>
            <button
              onClick={() => { setPaymentType("transfer"); setModalError(""); }}
              className={paymentType === "transfer"
                ? "rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 font-black text-white"
                : "rounded-xl border border-white/10 bg-white/5 px-4 py-3 font-black text-slate-200"}
            >Перевод</button>
          </div>

          {paymentType === "cash" ? (
            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-black text-slate-400">Получено наличными</span>
              <input
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                type="number"
                placeholder="Сумма, ₽"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500"
              />
            </label>
          ) : (
            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-black text-slate-400">Карта для перевода</span>
              <select
                value={cardId}
                onChange={(e) => { setCardId(e.target.value); setModalError(""); }}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none"
              >
                <option value="">Выберите карту</option>
                {safe_cards.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.owner ? ` · ${c.owner}` : ""}</option>
                ))}
              </select>
            </label>
          )}

          {modalError && <p className="mt-2 text-sm font-bold text-red-400">{modalError}</p>}

          <div className="mt-6 grid grid-cols-2 gap-2">
            <button
              onClick={() => { setSelected(null); setModalError(""); }}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 font-black text-slate-200 transition hover:bg-white/10"
            >Отмена</button>
            <button
              onClick={confirmPayment}
              disabled={confirming}
              className="rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 font-black text-white shadow-lg shadow-blue-900/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >{confirming ? "Подтверждаю…" : "Подтвердить"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
