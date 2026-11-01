import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, MapPin, RefreshCw } from "lucide-react";
import { get, put } from "../api";
import Modal from "./Modal";
import useDialogFocus from "../utils/useDialogFocus";
import { FINANCE_OPENING_FIELDS, financeAmount, financeOpeningPayload, validFinanceDate } from "../utils/finance";

export default function FinanceOpeningDialog({ workspace, onClose, onSaved }) {
  const [state, setState] = useState({ loading: true, error: "", original: null });
  const [form, setForm] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const activeRef = useRef(false), savingRef = useRef(false), panelRef = useRef(null);
  useDialogFocus(panelRef, true, ".smart-modal-panel");
  const dataAccountId = workspace.dataAccountId;
  useEffect(() => {
    activeRef.current = true;
    return () => { activeRef.current = false; };
  }, []);
  useEffect(() => {
    let active = true;
    setState({ loading: true, error: "", original: null });
    setForm(null);
    get("/finance/opening", { dataAccountId }).then((opening) => {
      if (!active) return;
      const fields = [...FINANCE_OPENING_FIELDS.map(([key]) => key), "revenue", "expenses"];
      if (!opening || fields.some((key) => opening[key] == null || !Number.isFinite(Number(opening[key])))) throw new Error("Не удалось получить полные стартовые балансы. Обновите данные перед изменением.");
      setForm({ asOfDate: opening.asOfDate || "", note: opening.note || "", ...Object.fromEntries(FINANCE_OPENING_FIELDS.map(([key]) => [key, String(opening[key])])) });
      setState({ loading: false, error: "", original: opening });
    }).catch((error) => { if (active) setState({ loading: false, original: null, error: error.message || "Не удалось загрузить стартовые балансы" }); });
    return () => { active = false; };
  }, [dataAccountId, attempt]);
  const amounts = form ? Object.fromEntries(FINANCE_OPENING_FIELDS.map(([key]) => [key, financeAmount(form[key])])) : {};
  const invalidAmounts = Object.values(amounts).some((amount) => !Number.isFinite(amount));
  const invalid = !form || !validFinanceDate(form.asOfDate) || invalidAmounts;
  const change = (key, value) => setForm((old) => ({ ...old, [key]: value }));
  const close = () => { if (!savingRef.current) onClose(); };
  const submit = async (event) => {
    event.preventDefault();
    if (invalid || savingRef.current || !state.original) return;
    savingRef.current = true; setSaving(true); setState((old) => ({ ...old, error: "" }));
    try {
      // This endpoint replaces the entire row, including fields absent from this form.
      const body = financeOpeningPayload(form, state.original);
      const saved = await put("/finance/opening", body, { dataAccountId });
      if (!saved?.isSet) throw new Error("Сервер не подтвердил сохранение. Проверьте балансы перед повтором.");
      if (activeRef.current) onSaved();
    } catch (error) {
      if (activeRef.current) setState((old) => ({ ...old, error: error.message || "Не удалось сохранить. Проверьте балансы перед повтором." }));
    } finally {
      savingRef.current = false;
      if (activeRef.current) setSaving(false);
    }
  };
  return (
    <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Стартовые балансы точки">
      <Modal title="Стартовые балансы" section={workspace.name} wide legacyLight={false} onClose={close}>
        <p className="fin-form-intro"><MapPin size={15} />Изменения относятся к точке «{workspace.name}».</p>
        {state.error && <div className="fin-error" role="alert"><AlertTriangle size={17} /><span>{state.error}</span></div>}
        {state.loading ? <div className="fin-modal-loading" role="status"><Loader2 size={27} className="animate-spin" />Загружаем сохранённые балансы…</div> : !form ? <div className="fin-modal-loading"><p>Балансы не загружены. Форма станет доступна после успешного обновления.</p><button type="button" className="fin-button" onClick={() => setAttempt((old) => old + 1)}><RefreshCw size={15} />Попробовать снова</button></div> : (
          <form onSubmit={submit}>
            <fieldset className="fin-form-fields" disabled={saving}>
              <p className="fin-note">Введите состояние бизнеса на начало выбранного дня. Сохранение заменит стартовые остатки этой точки; эти суммы не являются операциями периода.</p>
              <label className="fin-field">Дата старта учёта<input type="date" value={form.asOfDate} onInput={(event) => change("asOfDate", event.currentTarget.value)} onChange={(event) => change("asOfDate", event.target.value)} required /></label>
              <div className="fin-opening-fields">
                {FINANCE_OPENING_FIELDS.map(([key, label]) => <label className="fin-field" key={key}>{label}, ₽<input inputMode="decimal" value={form[key]} onChange={(event) => change(key, event.target.value)} placeholder="0" /></label>)}
              </div>
              {invalidAmounts && <p className="fin-invalid" role="alert">Укажите числа, например 1 250,50. Пустое поле считается нулём.</p>}
              <label className="fin-field">Примечание <small>Необязательно</small><textarea rows={2} value={form.note} onChange={(event) => change("note", event.target.value)} /></label>
            </fieldset>
            <div className="fin-form-actions"><button type="button" className="fin-button" disabled={saving} onClick={close}>Отмена</button><button type="submit" className="fin-primary" disabled={saving || invalid}>{saving ? <><Loader2 size={15} className="animate-spin" />Сохраняем…</> : "Сохранить балансы"}</button></div>
          </form>
        )}
      </Modal>
    </div>
  );
}
