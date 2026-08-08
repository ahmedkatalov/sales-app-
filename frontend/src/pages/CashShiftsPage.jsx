import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Minus, Plus } from "lucide-react";
import { get, post, getCurrentProfile } from "../api";
import { formatMoney, num } from "../utils/format";
import Modal from "../components/Modal";

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtDateTime = (s) => {
  const v = String(s || "");
  if (v.length < 10) return "—";
  const d = v.slice(8, 10) + "." + v.slice(5, 7);
  const t = v.length >= 16 ? " " + v.slice(11, 16) : "";
  return d + t;
};

// Знак/цвет расхождения при закрытии смены.
function diffMeta(d) {
  if (Math.abs(d) < 0.005) return { label: "Сходится", cls: "text-emerald-300" };
  if (d < 0) return { label: `Недостача ${formatMoney(-d)}`, cls: "text-red-300" };
  return { label: `Излишек ${formatMoney(d)}`, cls: "text-amber-300" };
}

export default function CashShiftsPage() {
  const [shift, setShift] = useState(null); // текущая открытая смена или null
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [preset, setPreset] = useState("month"); // month | all
  const [modal, setModal] = useState(null); // 'open' | 'in' | 'out' | 'close'
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const reqRef = useRef(0);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const profile = getCurrentProfile();

  const load = async () => {
    const seq = ++reqRef.current;
    setLoading(true);
    try {
      const [cur, list] = await Promise.all([
        get("/cash/shift/current").catch(() => null),
        get("/cash/shifts").catch(() => []),
      ]);
      if (seq !== reqRef.current) return;
      setShift(cur && cur.open ? cur.shift : null);
      setHistory(Array.isArray(list) ? list : []);
    } catch (e) {
      if (seq === reqRef.current) setError(e?.message || "Не удалось загрузить смены");
    } finally {
      if (seq === reqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openModal = (m) => { setAmount(""); setNote(""); setError(""); setModal(m); };

  // Единая защита: не даём двойной запрос, ловим ошибку.
  const runShift = async (fn) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await fn();
      setModal(null);
      await load();
    } catch (e) {
      const msg = e?.message || "Не удалось выполнить операцию";
      setError(msg);
      window.notify?.(msg, "error");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const doOpen = () => runShift(() => post("/cash/shift/open", { openingCash: num(amount), openedBy: profile?.name || "" }));
  const doMovement = (type) => runShift(() => {
    if (num(amount) <= 0) throw new Error("Введите сумму");
    return post("/cash/movement", { type, amount: num(amount), note: note.trim(), by: profile?.name || "" });
  });
  const doClose = () => runShift(() => post("/cash/shift/close", { countedCash: num(amount), closedBy: profile?.name || "", note: note.trim() }));

  // История за выбранный период (по дате закрытия).
  const visible = useMemo(() => {
    const list = Array.isArray(history) ? history : [];
    if (preset === "all") return list;
    const start = new Date();
    const mStart = iso(new Date(start.getFullYear(), start.getMonth(), 1));
    return list.filter((s) => String(s.closedAt || "").slice(0, 10) >= mStart);
  }, [history, preset]);

  const summary = useMemo(() => {
    const acc = { count: visible.length, sales: 0, shortage: 0, surplus: 0 };
    for (const s of visible) {
      acc.sales += num(s.cashSales);
      const d = num(s.difference);
      if (d < -0.005) acc.shortage += -d;
      else if (d > 0.005) acc.surplus += d;
    }
    return acc;
  }, [visible]);

  const closeDiff = amount !== "" && shift ? num(amount) - num(shift.expectedCash) : null;

  return (
    <div className="relative pb-nav text-white sm:pb-10">
      <div className="pointer-events-none absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-emerald-600/20 blur-3xl" />

      <div className="relative mx-auto w-full max-w-[1200px]">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-xs font-black text-emerald-300">
          <span className="h-2 w-2 rounded-full bg-emerald-400" /> Касса
        </div>
        <h1 className="text-3xl font-black tracking-tight sm:text-5xl">Смены</h1>
        <p className="mt-2 max-w-2xl text-sm font-medium text-slate-400">
          Открытие смены с разменом, движения наличных и сверка при закрытии. Вся история — ниже.
        </p>

        {error && <div className="mt-4 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 font-bold text-red-200">{error}</div>}

        {/* Текущая смена */}
        <div className="mt-5 rounded-3xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur sm:p-5">
          {shift ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Смена открыта</p>
                  <p className="mt-0.5 text-xs font-bold text-slate-400">Размен {formatMoney(shift.openingCash)}{shift.openedBy ? ` · ${shift.openedBy}` : ""} · открыта {fmtDateTime(shift.openedAt)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">Ожидается в кассе</p>
                  <p className="text-2xl font-black text-white sm:text-3xl">{formatMoney(shift.expectedCash)}</p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
                {[
                  ["Размен", shift.openingCash, ""],
                  ["Продажи налом", shift.cashSales, "+"],
                  ["Внесения", shift.cashIn, "+"],
                  ["Изъятия", shift.cashOut, "−"],
                  ["Расходы из кассы", shift.cashExpenses, "−"],
                  ["Владелец", shift.ownerCash, shift.ownerCash >= 0 ? "+" : "−"],
                ].map(([label, val, sign]) => (
                  <div key={label} className="rounded-xl bg-white/[0.04] px-3 py-2">
                    <span className="text-slate-400">{label}</span><br />
                    <b className="text-white">{sign}{formatMoney(Math.abs(num(val)))}</b>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => openModal("in")} className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-black text-white transition hover:bg-white/10"><Plus size={16} strokeWidth={2.4} /> Внести</button>
                <button onClick={() => openModal("out")} className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-black text-white transition hover:bg-white/10"><Minus size={16} strokeWidth={2.4} /> Изъять</button>
                <button onClick={() => openModal("close")} className="rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2.5 text-sm font-black text-white shadow-lg transition hover:brightness-110">Закрыть смену</button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black text-white">Смена закрыта</p>
                <p className="mt-0.5 text-xs font-bold text-slate-400">Откройте смену с разменом, чтобы касса начала считать наличные.</p>
              </div>
              <button onClick={() => openModal("open")} className="rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-5 py-3 font-black text-white shadow-lg transition hover:brightness-110">Открыть смену</button>
            </div>
          )}
        </div>

        {/* Сводка + период */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button onClick={() => setPreset("month")} className={`rounded-2xl px-4 py-2 text-sm font-black transition ${preset === "month" ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-lg" : "border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/10"}`}>Этот месяц</button>
          <button onClick={() => setPreset("all")} className={`rounded-2xl px-4 py-2 text-sm font-black transition ${preset === "all" ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-lg" : "border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/10"}`}>Всё время</button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3"><p className="text-[11px] font-black uppercase tracking-wide text-slate-400">Смен закрыто</p><p className="mt-1 text-xl font-black text-white">{summary.count}</p></div>
          <div className="rounded-2xl border border-emerald-400/15 bg-emerald-500/[0.07] px-4 py-3"><p className="text-[11px] font-black uppercase tracking-wide text-emerald-300/80">Продажи налом</p><p className="mt-1 text-xl font-black text-white">{formatMoney(summary.sales)}</p></div>
          <div className="rounded-2xl border border-red-400/15 bg-red-500/[0.07] px-4 py-3"><p className="text-[11px] font-black uppercase tracking-wide text-red-300/80">Недостачи</p><p className="mt-1 text-xl font-black text-red-200">{formatMoney(summary.shortage)}</p></div>
          <div className="rounded-2xl border border-amber-400/15 bg-amber-500/[0.07] px-4 py-3"><p className="text-[11px] font-black uppercase tracking-wide text-amber-300/80">Излишки</p><p className="mt-1 text-xl font-black text-amber-200">{formatMoney(summary.surplus)}</p></div>
        </div>

        {/* История смен */}
        <div className="mt-4 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-white/10 bg-slate-950/40 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="p-3">Открыта</th><th className="p-3">Закрыта</th><th className="p-3">Размен</th>
                  <th className="p-3">Продажи</th><th className="p-3">Внесено</th><th className="p-3">Изъято</th>
                  <th className="p-3">Расходы</th><th className="p-3">Владелец</th><th className="p-3">Ожидалось</th><th className="p-3">Факт</th><th className="p-3">Разница</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => {
                  const dm = diffMeta(num(s.difference));
                  return (
                    <tr key={s.id} className="border-b border-white/5 hover:bg-white/[0.03]">
                      <td className="p-3 text-slate-400">{fmtDateTime(s.openedAt)}<br /><span className="text-[11px] text-slate-600">{s.openedBy || "—"}</span></td>
                      <td className="p-3 text-slate-400">{fmtDateTime(s.closedAt)}<br /><span className="text-[11px] text-slate-600">{s.closedBy || "—"}</span></td>
                      <td className="p-3 text-slate-300">{formatMoney(s.openingCash)}</td>
                      <td className="p-3 font-bold text-white">{formatMoney(s.cashSales)}</td>
                      <td className="p-3 text-emerald-300">+{formatMoney(s.cashIn)}</td>
                      <td className="p-3 text-red-300">−{formatMoney(s.cashOut)}</td>
                      <td className="p-3 text-red-300">−{formatMoney(s.cashExpenses)}</td>
                      <td className="p-3 text-slate-300">{num(s.ownerCash) ? (num(s.ownerCash) > 0 ? "+" : "−") + formatMoney(Math.abs(num(s.ownerCash))) : "—"}</td>
                      <td className="p-3 text-slate-300">{formatMoney(s.expectedCash)}</td>
                      <td className="p-3 font-bold text-white">{formatMoney(s.countedCash)}</td>
                      <td className={`p-3 font-black ${dm.cls}`}>{dm.label}</td>
                    </tr>
                  );
                })}
                {!visible.length && <tr><td colSpan={11} className="p-10 text-center font-bold text-slate-400">{loading ? "Загрузка…" : "Закрытых смен пока нет"}</td></tr>}
              </tbody>
            </table>
          </div>

          {/* Мобильные карточки */}
          <div className="divide-y divide-white/5 lg:hidden">
            {visible.map((s) => {
              const dm = diffMeta(num(s.difference));
              return (
                <div key={s.id} className="p-3.5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-black text-white">{fmtDateTime(s.openedAt)} → {fmtDateTime(s.closedAt)}</p>
                    <span className={`text-sm font-black ${dm.cls}`}>{dm.label}</span>
                  </div>
                  <div className="mt-1 grid grid-cols-3 gap-1.5 text-[11px] text-slate-400">
                    <div>Размен<br /><b className="text-slate-200">{formatMoney(s.openingCash)}</b></div>
                    <div>Продажи налом<br /><b className="text-slate-200">{formatMoney(s.cashSales)}</b></div>
                    <div>Ожидалось<br /><b className="text-slate-200">{formatMoney(s.expectedCash)}</b></div>
                    <div>Внесено<br /><b className="text-emerald-300">+{formatMoney(s.cashIn)}</b></div>
                    <div>Изъято/расходы<br /><b className="text-red-300">−{formatMoney(num(s.cashOut) + num(s.cashExpenses))}</b></div>
                    <div>Владелец<br /><b className="text-slate-200">{num(s.ownerCash) ? (num(s.ownerCash) > 0 ? "+" : "−") + formatMoney(Math.abs(num(s.ownerCash))) : "0"}</b></div>
                    <div>Факт<br /><b className="text-white">{formatMoney(s.countedCash)}</b></div>
                  </div>
                </div>
              );
            })}
            {!visible.length && <div className="p-10 text-center font-bold text-slate-400">{loading ? "Загрузка…" : "Закрытых смен пока нет"}</div>}
          </div>
        </div>
      </div>

      {/* Модалки */}
      {modal === "open" && (
        <Modal title="Открыть смену">
          <p className="mb-3 text-sm text-slate-400">Сколько наличных в кассе сейчас (размен на сдачу)?</p>
          <input type="number" value={amount} autoFocus onChange={(e) => setAmount(e.target.value)} placeholder="Например: 5000"
            className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-4 font-bold text-white outline-none placeholder:text-slate-500 focus:border-emerald-400/70" />
          <div className="mt-4 flex gap-3">
            <button onClick={() => setModal(null)} className="btn-white flex-1">Отмена</button>
            <button onClick={doOpen} disabled={busy} className="flex-1 rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-5 py-3 font-black text-white disabled:opacity-60">{busy ? "…" : "Открыть"}</button>
          </div>
        </Modal>
      )}

      {(modal === "in" || modal === "out") && (
        <Modal title={modal === "in" ? "Внести в кассу" : "Изъять из кассы"}>
          <p className="mb-3 text-sm text-slate-400">{modal === "in" ? "Деньги, которые кладёте в кассу (не продажа)." : "Деньги, которые забираете из кассы (выплата, инкассация и т.п.)."}</p>
          <input type="number" value={amount} autoFocus onChange={(e) => setAmount(e.target.value)} placeholder="Сумма"
            className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-4 font-bold text-white outline-none placeholder:text-slate-500 focus:border-blue-400/70" />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Примечание (необязательно)"
            className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3.5 font-bold text-white outline-none placeholder:text-slate-500 focus:border-blue-400/70" />
          <div className="mt-4 flex gap-3">
            <button onClick={() => setModal(null)} className="btn-white flex-1">Отмена</button>
            <button onClick={() => doMovement(modal)} disabled={busy} className="btn-blue flex-1 disabled:opacity-60">{busy ? "…" : modal === "in" ? "Внести" : "Изъять"}</button>
          </div>
        </Modal>
      )}

      {modal === "close" && shift && (
        <Modal title="Закрыть смену">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">Должно быть в кассе</p>
            <b className="text-xl font-black text-white">{formatMoney(shift.expectedCash)}</b>
          </div>
          <p className="mb-2 mt-4 text-sm font-black text-slate-300">Сколько наличных фактически пересчитали?</p>
          <input type="number" value={amount} autoFocus onChange={(e) => setAmount(e.target.value)} placeholder="Фактическая сумма"
            className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-4 font-bold text-white outline-none placeholder:text-slate-500 focus:border-blue-400/70" />
          {closeDiff !== null && (
            <p className={`mt-2 flex items-center gap-1.5 text-sm font-black ${diffMeta(closeDiff).cls}`}>{Math.abs(closeDiff) < 0.005 ? (<><Check size={16} strokeWidth={2.4} /> Сходится</>) : diffMeta(closeDiff).label}</p>
          )}
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Примечание (необязательно)"
            className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3.5 font-bold text-white outline-none placeholder:text-slate-500 focus:border-blue-400/70" />
          <div className="mt-4 flex gap-3">
            <button onClick={() => setModal(null)} className="btn-white flex-1">Отмена</button>
            <button onClick={doClose} disabled={busy} className="btn-blue flex-1 disabled:opacity-60">{busy ? "…" : "Закрыть смену"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
