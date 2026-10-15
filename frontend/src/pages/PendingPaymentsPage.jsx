import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, ArrowUp, Banknote, CheckCircle2, Clock, ListChecks, Loader2, MoreHorizontal, Package, RefreshCw, Timer, Trash2, Wallet } from "lucide-react";
import { del, get, post } from "../api";
import Modal from "../components/Modal";
import { formatMoney, num } from "../utils/format";

// ── чистые хелперы (new Date с аргументом — безопасно для react-hooks/purity) ──
const ageMs = (iso, nowMs) => (iso ? Math.max(0, nowMs - new Date(iso).getTime()) : 0);
const fmtAge = (ms) => {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  return `${h} ч ${String(m % 60).padStart(2, "0")} мин`;
};
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "—");
const tierOf = (ms) => (ms >= 30 * 60000 ? "urgent" : ms >= 15 * 60000 ? "hot" : ms >= 5 * 60000 ? "warm" : "fresh");
const plural = (n, forms) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return forms[1];
  return forms[2];
};

const TIER = {
  fresh: { bl: "border-l-slate-500/50", badge: "border-white/10 bg-white/5 text-slate-300", dot: "bg-slate-500", text: "text-slate-300" },
  warm: { bl: "border-l-amber-400/70", badge: "border-amber-400/30 bg-amber-400/10 text-amber-300", dot: "bg-amber-400", text: "text-amber-300" },
  hot: { bl: "border-l-orange-400/80", badge: "border-orange-400/30 bg-orange-500/10 text-orange-300", dot: "bg-orange-400", text: "text-orange-300" },
  urgent: { bl: "border-l-red-500/80", badge: "border-red-500/30 bg-red-500/15 text-red-300", dot: "bg-red-500", text: "text-red-300" },
};

function Stat({ icon: Icon, label, value, sub, tone = "blue" }) {
  const tones = {
    blue: "border-blue-500/25 bg-blue-500/[0.08] text-blue-300",
    emerald: "border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-300",
    violet: "border-violet-500/25 bg-violet-500/[0.08] text-violet-300",
    amber: "border-amber-500/25 bg-amber-500/[0.08] text-amber-300",
    orange: "border-orange-500/25 bg-orange-500/[0.08] text-orange-300",
    red: "border-red-500/30 bg-red-500/[0.1] text-red-300",
    slate: "border-white/10 bg-white/[0.04] text-slate-300",
  };
  return (
    <div className={`min-w-0 rounded-2xl border p-3 sm:p-4 ${tones[tone]}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[11px] font-black uppercase tracking-wide opacity-90">{label}</p>
        <Icon size={16} className="shrink-0 opacity-70" />
      </div>
      <p className="mt-1.5 truncate text-xl font-black tabular-nums text-white sm:text-2xl">{value}</p>
      {sub && <p className="truncate text-[11px] font-semibold text-slate-500">{sub}</p>}
    </div>
  );
}

export default function PendingPaymentsPage() {
  const [list, setList] = useState([]);
  const [cards, setCards] = useState([]);
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);           // чек, по которому идёт быстрый приём
  const [transferOpenId, setTransferOpenId] = useState(null); // раскрытый инлайн-выбор карты
  const [expanded, setExpanded] = useState(() => new Set()); // раскрытые полные списки позиций

  const [selected, setSelected] = useState(null);
  const [paymentType, setPaymentType] = useState("cash");
  const [cardId, setCardId] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [error, setError] = useState("");
  const [modalError, setModalError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const confirmingRef = useRef(false);

  const safe_list = Array.isArray(list) ? list : [];
  const safe_cards = Array.isArray(cards) ? cards : [];

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [pending, crds] = await Promise.all([
        get("/pending-sales").catch(() => []),
        get("/cards").catch(() => []),
      ]);
      setList(pending || []);
      setCards(crds || []);
      setNow(Date.now());
      window.dispatchEvent(new Event("sales-pending-change"));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(() => setNow(Date.now()), 30000); // живой счётчик возраста
    return () => clearInterval(t);
  }, []);

  // Очередь: старейший сверху (бэкенд отдаёт id DESC).
  const queue = useMemo(() => {
    const arr = Array.isArray(list) ? list : [];
    return [...arr].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  }, [list]);
  const oldest = queue[0];
  const oldestAge = oldest ? ageMs(oldest.createdAt, now) : 0;
  const oldestTier = TIER[tierOf(oldestAge)];

  const totalWaiting = safe_list.reduce((sum, sale) => sum + num(sale.total), 0);
  const totalItems = safe_list.reduce(
    (sum, sale) => sum + (sale.items || []).reduce((s, i) => s + num(i.qty || 1), 0),
    0
  );

  const toggleExpand = (id) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  // Быстрый приём (ровная сумма наличными / перевод на карту) — тот же confirm-эндпоинт.
  const quickConfirm = async (sale, type, cId = 0) => {
    if (busyId || confirmingRef.current) return;
    confirmingRef.current = true;
    setBusyId(sale.id);
    try {
      await post(`/pending-sales/${sale.id}/confirm`, {
        paymentType: type,
        cardId: type === "transfer" ? Number(cId) : 0,
        cashGiven: type === "cash" ? num(sale.total) : 0,
      });
      setTransferOpenId(null);
      await load();
    } catch (e) {
      setError(e?.message || "Не удалось принять оплату");
      await load().catch(() => {});
    } finally {
      confirmingRef.current = false;
      setBusyId(null);
    }
  };

  const onTransfer = (s) => {
    if (!safe_cards.length) { openModal(s, "transfer"); return; }
    if (safe_cards.length === 1) { quickConfirm(s, "transfer", safe_cards[0].id); return; }
    setTransferOpenId((id) => (id === s.id ? null : s.id));
  };

  const openModal = (s, type = "cash") => {
    setModalError("");
    setPaymentType(type);
    setCardId("");
    setPaidAmount("");
    setSelected(s);
  };

  const confirmPayment = async () => {
    if (!selected) return;
    if (paymentType === "transfer" && !cardId) return setModalError("Выберите карту");
    if (confirmingRef.current) return;
    confirmingRef.current = true;
    setConfirming(true);
    try {
      await post(`/pending-sales/${selected.id}/confirm`, {
        paymentType,
        cardId: paymentType === "transfer" ? Number(cardId) : 0,
        cashGiven: paymentType === "cash" ? num(paidAmount || selected.total) : 0,
      });
      setSelected(null);
      setCardId("");
      setPaidAmount("");
      setModalError("");
      await load();
    } catch (e) {
      setModalError(e?.message || "Не удалось подтвердить чек");
      await load().catch(() => {});
    } finally {
      confirmingRef.current = false;
      setConfirming(false);
    }
  };

  const cancel = async (id) => {
    if (!window.confirm("Отменить этот чек?")) return;
    await del(`/pending-sales/${id}`);
    await load();
  };

  const change = num(paidAmount) - num(selected?.total);
  const billChips = selected ? [500, 1000, 2000, 5000].filter((v) => v > num(selected.total)) : [];

  return (
    <div className="mx-auto w-full max-w-[1100px] pb-nav sm:pb-10">
      {/* ── Шапка ── */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-blue-400">Касса</p>
          <h2 className="text-2xl font-black leading-none text-white sm:text-3xl">Ожидают оплаты</h2>
          {queue.length > 0 ? (
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-slate-400">
              <span><b className="text-white">{queue.length}</b> {plural(queue.length, ["чек", "чека", "чеков"])} на <b className="tabular-nums text-emerald-300">{formatMoney(totalWaiting)}</b></span>
              <span className="text-slate-600">·</span>
              <span className={`inline-flex items-center gap-1 ${oldestTier.text}`}><Clock size={14} /> старейший ждёт <b>{fmtAge(oldestAge)}</b></span>
            </p>
          ) : (
            <p className="mt-2 text-sm leading-6 text-slate-400">Чеки собраны в кассе, но ещё не оплачены наличными или переводом.</p>
          )}
        </div>

        <button
          onClick={load}
          aria-label="Обновить"
          className="flex h-11 shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 font-bold text-slate-200 transition hover:bg-white/10"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          <span className="hidden sm:inline">Обновить</span>
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 font-bold text-red-300">{error}</div>
      )}

      {/* ── Статы (скрыты на пустой очереди) ── */}
      {queue.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
          <Stat icon={ListChecks} label="Чеки" value={queue.length} sub="в очереди" tone="blue" />
          <Stat icon={Wallet} label="Сумма" value={formatMoney(totalWaiting)} sub="к оплате" tone="emerald" />
          <Stat icon={Package} label="Товаров" value={totalItems} sub="единиц всего" tone="violet" />
          <Stat icon={Timer} label="Старейший" value={fmtAge(oldestAge)} sub={`собран в ${fmtTime(oldest?.createdAt)}`} tone={tierOf(oldestAge) === "fresh" ? "slate" : tierOf(oldestAge) === "warm" ? "amber" : tierOf(oldestAge) === "hot" ? "orange" : "red"} />
        </div>
      )}

      <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] shadow-xl backdrop-blur">
        <div className="border-b border-white/10 p-4 sm:p-5">
          <h3 className="text-xl font-black text-white sm:text-2xl">Список чеков</h3>
          <p className="mt-1 text-sm text-slate-400">Примите оплату в один тап — «Наличные» или «Перевод». «⋯» — приём со сдачей или выбором карты.</p>
        </div>

        {queue.length > 0 ? (
          <div className="grid gap-3 p-3 sm:p-5">
            {queue.map((s, idx) => {
              const age = ageMs(s.createdAt, now);
              const t = TIER[tierOf(age)];
              const items = s.items || [];
              const isOpen = expanded.has(s.id);
              const shown = isOpen ? items : items.slice(0, 3);
              const busy = busyId === s.id;
              const isOldest = idx === 0 && queue.length > 1;
              return (
                <div
                  key={s.id}
                  className={`rounded-2xl border border-l-4 border-white/10 bg-white/[0.03] p-4 transition ${t.bl} ${busy ? "pointer-events-none opacity-60" : ""} ${tierOf(age) === "urgent" ? "ring-1 ring-red-500/30" : ""}`}
                >
                  {isOldest && (
                    <p className={`mb-1.5 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider ${t.text}`}>
                      <ArrowUp size={12} /> Раньше всех
                    </p>
                  )}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-black ${t.badge} ${tierOf(age) === "urgent" ? "animate-pulse" : ""}`}>
                        <Clock size={13} /> ждёт {fmtAge(age)}
                      </span>
                      <span className="ml-2 text-xs font-semibold text-slate-500">в {fmtTime(s.createdAt)}</span>
                    </div>
                    <h4 className="shrink-0 text-2xl font-black tabular-nums text-white sm:text-3xl">{formatMoney(s.total)}</h4>
                  </div>

                  <div className="mt-3 space-y-1.5 rounded-xl border border-white/10 bg-slate-950/40 p-3 text-sm">
                    {shown.map((i, k) => (
                      <div key={`${s.id}-${k}-${i.name}`} className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate font-bold text-slate-200">{i.name} × {i.qty}</span>
                        <b className="shrink-0 tabular-nums text-white">{formatMoney(i.total || num(i.price) * num(i.qty))}</b>
                      </div>
                    ))}
                    {!items.length && <div className="text-slate-500">В чеке нет позиций</div>}
                    {items.length > 3 && (
                      <button onClick={() => toggleExpand(s.id)} className="pt-0.5 text-xs font-black text-blue-300 hover:text-blue-200">
                        {isOpen ? "Свернуть" : `+${items.length - 3} ещё · показать`}
                      </button>
                    )}
                  </div>

                  {transferOpenId === s.id && safe_cards.length > 1 && (
                    <div className="no-scrollbar mt-2.5 flex gap-2 overflow-x-auto">
                      <span className="shrink-0 self-center text-xs font-bold text-slate-500">На карту:</span>
                      {safe_cards.map((c) => (
                        <button key={c.id} onClick={() => quickConfirm(s, "transfer", c.id)} className="shrink-0 rounded-xl border border-blue-400/30 bg-blue-500/10 px-3 py-2.5 text-sm font-black text-blue-200 transition hover:bg-blue-500/20">
                          {c.name}{c.owner ? ` · ${c.owner}` : ""}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2">
                    <button
                      onClick={() => quickConfirm(s, "cash")}
                      disabled={busy}
                      className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-3 py-3 font-black text-white shadow-lg shadow-emerald-900/30 transition hover:brightness-110 active:scale-[0.98]"
                    >
                      {busy ? <Loader2 size={16} className="animate-spin" /> : <Banknote size={16} />} Наличные
                    </button>
                    <button
                      onClick={() => onTransfer(s)}
                      disabled={busy}
                      className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-3 py-3 font-black text-white shadow-lg shadow-blue-900/30 transition hover:brightness-110 active:scale-[0.98]"
                    >
                      <ArrowLeftRight size={16} /> Перевод
                    </button>
                    <button
                      onClick={() => openModal(s)}
                      aria-label="Приём со сдачей или выбором карты"
                      title="Приём со сдачей / выбор карты"
                      className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10"
                    >
                      <MoreHorizontal size={18} />
                    </button>
                  </div>

                  <div className="mt-2.5 flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-600">Чек #{s.id}</span>
                    <button
                      onClick={() => cancel(s.id)}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-500 transition hover:bg-red-500/10 hover:text-red-300"
                    >
                      <Trash2 size={13} /> Отменить чек
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-6 py-14 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300 shadow-[0_0_40px_rgba(16,185,129,0.15)]"><CheckCircle2 size={30} strokeWidth={2.4} /></div>
            <p className="text-lg font-black text-white">Все чеки оплачены</p>
            <p className="mt-1 text-sm text-slate-400">Очередь пуста — новые чеки появятся здесь, как только их соберут в кассе.</p>
          </div>
        )}
      </div>

      {/* ── Модалка: приём со сдачей / выбором карты ── */}
      {selected && (
        <Modal title="Принять оплату" legacyLight={false} onClose={() => { setSelected(null); setModalError(""); }}>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm font-bold text-slate-400">Итого к оплате</p>
            <p className="mt-1 text-3xl font-black tabular-nums text-white">{formatMoney(selected.total)}</p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              onClick={() => { setPaymentType("cash"); setModalError(""); }}
              className={paymentType === "cash"
                ? "inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 font-black text-white"
                : "inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-4 py-3 font-black text-slate-200"}
            ><Banknote size={16} /> Наличные</button>
            <button
              onClick={() => { setPaymentType("transfer"); setModalError(""); }}
              className={paymentType === "transfer"
                ? "inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 font-black text-white"
                : "inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-4 py-3 font-black text-slate-200"}
            ><ArrowLeftRight size={16} /> Перевод</button>
          </div>

          {paymentType === "cash" ? (
            <div className="mt-4">
              <div className="no-scrollbar mb-2 flex gap-2 overflow-x-auto">
                <button onClick={() => setPaidAmount(String(num(selected.total)))} className="shrink-0 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm font-black text-emerald-200">Под расчёт</button>
                {billChips.map((v) => (
                  <button key={v} onClick={() => setPaidAmount(String(v))} className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-black text-slate-200">{formatMoney(v)}</button>
                ))}
              </div>
              <label className="block">
                <span className="mb-2 block text-sm font-black text-slate-400">Получено наличными</span>
                <input
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value)}
                  type="number"
                  inputMode="decimal"
                  placeholder="Сумма, ₽"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500"
                />
              </label>
              {paidAmount !== "" && (
                <p className="mt-2 text-sm font-bold">
                  {change < 0
                    ? <span className="text-red-400">Не хватает {formatMoney(-change)}</span>
                    : <span className="text-slate-400">Сдача: <b className="text-emerald-300">{formatMoney(change)}</b></span>}
                </p>
              )}
            </div>
          ) : (
            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-black text-slate-400">Карта для перевода</span>
              <select
                value={cardId}
                onChange={(e) => { setCardId(e.target.value); setModalError(""); }}
                className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 font-bold text-white outline-none"
              >
                <option value="">Выберите карту</option>
                {safe_cards.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.owner ? ` · ${c.owner}` : ""}</option>
                ))}
              </select>
              {!safe_cards.length && <p className="mt-2 text-xs font-bold text-amber-300">Сначала добавьте карту в «Настройки → Счета».</p>}
            </label>
          )}

          {modalError && <p className="mt-2 text-sm font-bold text-red-400">{modalError}</p>}

          <div className="mt-6 grid grid-cols-2 gap-2">
            <button
              onClick={() => { setSelected(null); setModalError(""); }}
              className="min-h-[48px] rounded-xl border border-white/10 bg-white/5 px-4 py-3 font-black text-slate-200 transition hover:bg-white/10"
            >Отмена</button>
            <button
              onClick={confirmPayment}
              disabled={confirming || (paymentType === "cash" && paidAmount !== "" && change < 0)}
              className="min-h-[48px] rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 font-black text-white shadow-lg shadow-blue-900/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >{confirming ? "Подтверждаю…" : "Подтвердить"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
