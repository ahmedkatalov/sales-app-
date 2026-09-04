import { useEffect, useState } from "react";
import { CheckCircle2, RefreshCw } from "lucide-react";
import { del, get, post } from "../api";
import Modal from "./Modal";
import { formatMoney, num } from "../utils/format";

// «К оплате» прямо из кассы: список отложенных чеков + приём оплаты инлайн,
// без перехода на отдельную страницу. Тот же эндпоинт confirm, что и на странице.
export default function PendingPaymentsModal({ onClose }) {
  const [list, setList] = useState([]);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null); // чек, который сейчас оплачиваем
  const [paymentType, setPaymentType] = useState("cash");
  const [cardId, setCardId] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [rowError, setRowError] = useState("");
  const [confirming, setConfirming] = useState(false);

  const safe_list = Array.isArray(list) ? list : [];
  const safe_cards = Array.isArray(cards) ? cards : [];

  const load = async () => {
    setLoading(true);
    try {
      const [pending, crds] = await Promise.all([
        get("/pending-sales").catch(() => []),
        get("/cards").catch(() => []),
      ]);
      setList(pending || []);
      setCards(crds || []);
      window.dispatchEvent(new Event("sales-pending-change"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const startPay = (s) => {
    setSelectedId(s.id);
    setPaymentType("cash");
    setCardId("");
    setPaidAmount("");
    setRowError("");
  };

  const confirmPayment = async (s) => {
    if (confirming) return;
    if (paymentType === "transfer" && !cardId) { setRowError("Выберите карту"); return; }
    setConfirming(true);
    try {
      await post(`/pending-sales/${s.id}/confirm`, {
        paymentType,
        cardId: paymentType === "transfer" ? Number(cardId) : 0,
        cashGiven: paymentType === "cash" ? num(paidAmount) : 0,
      });
      setSelectedId(null);
      setRowError("");
      window.notify?.("Чек оплачен", "success");
      await load();
    } catch (e) {
      setRowError(e?.message || "Не удалось подтвердить чек");
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

  const totalWaiting = safe_list.reduce((s, x) => s + num(x.total), 0);

  return (
    <Modal title="Ожидают оплаты" section="Касса" wide>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-slate-400">
          <b className="text-white">{safe_list.length}</b> чеков · <b className="text-emerald-300">{formatMoney(totalWaiting)}</b> к оплате
        </p>
        <button type="button" onClick={load} aria-label="Обновить" title="Обновить"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10">
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {loading && safe_list.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-10 text-slate-400"><RefreshCw size={16} className="animate-spin" /> Загрузка…</div>
      ) : safe_list.length === 0 ? (
        <div className="py-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300"><CheckCircle2 size={28} strokeWidth={2.4} /></div>
          <p className="text-lg font-black text-white">Всё оплачено</p>
          <p className="mt-1 text-sm text-slate-400">Чеков в ожидании нет.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {safe_list.map((s) => {
            const paying = selectedId === s.id;
            return (
              <div key={s.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-500">Чек #{s.id}{s.createdAt ? ` · ${new Date(s.createdAt).toLocaleDateString("ru-RU")}` : ""}</p>
                    <h3 className="mt-0.5 text-2xl font-black tabular-nums text-white">{formatMoney(s.total)}</h3>
                  </div>
                  <span className="shrink-0 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-black text-amber-300">Ожидает</span>
                </div>

                <div className="mt-2.5 space-y-1 rounded-xl border border-white/10 bg-slate-950/40 p-2.5 text-sm">
                  {(s.items || []).map((i) => (
                    <div key={`${s.id}-${i.productId}-${i.name}`} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate font-bold text-slate-200">{i.name} × {i.qty}</span>
                      <b className="shrink-0 tabular-nums text-white">{formatMoney(i.total || num(i.price) * num(i.qty))}</b>
                    </div>
                  ))}
                  {!(s.items || []).length && <div className="text-slate-500">В чеке нет позиций</div>}
                </div>

                {!paying ? (
                  <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                    <button type="button" onClick={() => startPay(s)}
                      className="rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 font-black text-white shadow-lg shadow-blue-900/30 transition hover:brightness-110 active:scale-[0.98]">
                      Принять оплату
                    </button>
                    <button type="button" onClick={() => cancel(s.id)}
                      className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 font-black text-red-300 transition hover:bg-red-500/20">
                      Убрать
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/40 p-3">
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => { setPaymentType("cash"); setRowError(""); }}
                        className={paymentType === "cash" ? "rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2.5 font-black text-white" : "rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 font-black text-slate-200"}>Наличные</button>
                      <button type="button" onClick={() => { setPaymentType("transfer"); setRowError(""); }}
                        className={paymentType === "transfer" ? "rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2.5 font-black text-white" : "rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 font-black text-slate-200"}>Перевод</button>
                    </div>

                    {paymentType === "cash" ? (
                      <input value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} type="number" inputMode="decimal"
                        placeholder="Получено наличными, ₽"
                        className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500" />
                    ) : (
                      <select value={cardId} onChange={(e) => { setCardId(e.target.value); setRowError(""); }}
                        className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none">
                        <option value="">Выберите карту</option>
                        {safe_cards.map((c) => (<option key={c.id} value={c.id}>{c.name}{c.owner ? ` · ${c.owner}` : ""}</option>))}
                      </select>
                    )}

                    {rowError && <p className="mt-2 text-sm font-bold text-red-400">{rowError}</p>}

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => { setSelectedId(null); setRowError(""); }}
                        className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 font-black text-slate-200 transition hover:bg-white/10">Отмена</button>
                      <button type="button" onClick={() => confirmPayment(s)} disabled={confirming}
                        className="rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-4 py-3 font-black text-white shadow-lg shadow-emerald-900/30 transition hover:brightness-110 disabled:opacity-60">
                        {confirming ? "Подтверждаю…" : "Оплачено"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-5 flex justify-end">
        <button type="button" onClick={onClose}
          className="rounded-2xl border border-white/10 bg-white/[0.04] px-6 py-3 font-black text-slate-200 transition hover:bg-white/10">
          Закрыть
        </button>
      </div>
    </Modal>
  );
}
