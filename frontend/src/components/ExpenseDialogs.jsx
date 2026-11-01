import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Banknote, Camera, CreditCard, Loader2, Paperclip, User, X } from "lucide-react";
import Modal from "./Modal";
import { fetchBlobUrl } from "../api";
import { compressImageToDataURL } from "../utils/image";
import { formatMoney, num } from "../utils/format";
import { BASE_PRODUCT_TYPE, HOUSEHOLD_TYPES, OPENING_FIELDS, OWNER_KINDS, parseExpenseAmount, SOURCE_LABELS } from "../utils/expenses";

export function ExpenseError({ children }) {
  return children ? <div className="expense-error" role="alert"><AlertTriangle size={17} /><span>{children}</span></div> : null;
}

function FormActions({ busy, invalid, onClose, label = "Сохранить" }) {
  return (
    <div className="expense-form-actions">
      <button className="expense-button" type="button" disabled={busy} onClick={onClose}>Отмена</button>
      <button className="expense-primary" type="submit" disabled={busy || invalid}>
        {busy ? <><Loader2 size={16} className="animate-spin" />Сохраняем…</> : label}
      </button>
    </div>
  );
}

export function ExpenseForm({ productTypes, busy, error, onSave, onClose }) {
  const [form, setForm] = useState({ category: "household", type: "Уборка", name: "", amount: "", paymentSource: "cash", comment: "" });
  const [photo, setPhoto] = useState(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const change = (key, value) => setForm((old) => ({ ...old, [key]: value }));
  const options = form.category === "household" ? HOUSEHOLD_TYPES : productTypes;
  const amount = parseExpenseAmount(form.amount);
  const validAmount = Number.isFinite(amount) && amount > 0;
  const locked = busy || photoBusy;
  const close = () => { if (!locked) onClose(); };
  const pickPhoto = async (file) => {
    if (!file || locked) return;
    setPhotoBusy(true);
    setPhotoError("");
    try {
      const result = await compressImageToDataURL(file);
      if (alive.current) setPhoto(result);
    } catch (failure) {
      if (alive.current) setPhotoError(failure.message || "Не удалось обработать фото");
    } finally {
      if (alive.current) setPhotoBusy(false);
    }
  };
  return (
    <Modal title="Новый расход" section="Журнал расходов" legacyLight={false} onClose={close}>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!locked && validAmount && form.name.trim() && form.type) onSave({ ...form, amount, name: form.name.trim(), comment: form.comment.trim() }, photo);
      }}>
        <fieldset disabled={locked}>
          <div className="expense-segments" role="group" aria-label="Категория нового расхода">
            {[["household", "Бытовые"], ["products", "Продукты"]].map(([value, label]) => (
              <button type="button" key={value} aria-pressed={form.category === value} onClick={() => setForm((old) => ({ ...old, category: value, type: value === "household" ? HOUSEHOLD_TYPES[0] : productTypes[0] || BASE_PRODUCT_TYPE }))}>{label}</button>
            ))}
          </div>
          <label className="expense-field">Статья расхода
            <select value={form.type} onChange={(event) => change("type", event.target.value)}>{options.map((type) => <option key={type}>{type}</option>)}</select>
          </label>
          <label className="expense-field">За что заплатили
            <input value={form.name} onChange={(event) => change("name", event.target.value)} placeholder="Например, молоко для кофейни" autoFocus required />
          </label>
          <label className="expense-field">Сумма, ₽
            <input className="expense-large-input" value={form.amount} onChange={(event) => change("amount", event.target.value)} placeholder="0" inputMode="decimal" required />
          </label>
          {form.amount.trim() && !validAmount && <p className="expense-invalid" role="alert">Введите сумму больше нуля</p>}
          <p className="expense-field-title">Источник оплаты</p>
          <div className="expense-payment-methods" role="group" aria-label="Источник оплаты нового расхода">
            {[["cash", Banknote], ["card", CreditCard], ["owner", User]].map(([value, Icon]) => (
              <button type="button" key={value} aria-pressed={form.paymentSource === value} onClick={() => change("paymentSource", value)}><Icon size={19} />{SOURCE_LABELS[value]}</button>
            ))}
          </div>
          <p className="expense-help">{form.paymentSource === "cash" ? "Расход уменьшит наличные в кассе." : form.paymentSource === "card" ? "Оплата с карты или переводом. Наличные в кассе не изменятся." : "Наличные в кассе не изменятся. Бизнес будет должен владельцу эту сумму."}</p>
          <label className="expense-field">Комментарий <small>Необязательно</small>
            <textarea value={form.comment} onChange={(event) => change("comment", event.target.value)} placeholder="Поставщик, назначение или другие детали" rows={2} />
          </label>
          <div className="expense-photo-upload">
            {photo ? (
              <><img src={photo} alt="Выбранный чек" /><span>Фото готово к загрузке</span><button type="button" className="expense-icon-button" aria-label="Убрать фото" onClick={() => setPhoto(null)}><X size={17} /></button></>
            ) : (
              <label><Camera size={18} /><span>{photoBusy ? "Обрабатываем фото…" : "Прикрепить чек или накладную"}<small>Фото · необязательно</small></span><input aria-label="Фото чека или накладной" type="file" accept="image/*" onChange={(event) => { pickPhoto(event.target.files?.[0]); event.target.value = ""; }} /></label>
            )}
          </div>
        </fieldset>
        <ExpenseError>{photoError || error}</ExpenseError>
        <FormActions busy={locked} invalid={!validAmount || !form.name.trim() || !form.type} onClose={close} label="Добавить расход" />
        <p className="expense-help expense-center">Расход будет записан текущей датой.</p>
      </form>
    </Modal>
  );
}

export function OwnerEntryForm({ kind, owed, busy, error, onSave, onClose }) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const value = parseExpenseAmount(amount);
  const excessive = kind === "reimbursement" && value > Math.max(0, owed);
  const invalid = !Number.isFinite(value) || value <= 0 || excessive;
  const meta = OWNER_KINDS[kind];
  return (
    <Modal title={meta.action} section="Расчёты с владельцем" legacyLight={false} onClose={onClose}>
      <form onSubmit={(event) => { event.preventDefault(); if (!busy && !invalid) onSave({ kind, amount: value, note: note.trim(), date }); }}>
        <p className="expense-form-summary">{meta.hint}</p>
        <fieldset disabled={busy}>
          <label className="expense-field">Сумма, ₽<input autoFocus inputMode="decimal" className="expense-large-input" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" required /></label>
          {amount.trim() && invalid && <p className="expense-invalid" role="alert">{excessive ? `Возврат больше долга перед владельцем (${formatMoney(Math.max(0, owed))} ₽)` : "Введите сумму больше нуля"}</p>}
          {kind === "reimbursement" && <button type="button" className="expense-text-button" onClick={() => setAmount(String(Math.max(0, owed)))}>Весь долг · {formatMoney(Math.max(0, owed))} ₽</button>}
          <label className="expense-field">Дата операции <small>Необязательно</small><input type="date" value={date} onInput={(event) => setDate(event.currentTarget.value)} onChange={(event) => setDate(event.target.value)} /></label>
          <p className="expense-help">Без даты — текущий момент. Выбранная дата определяет день операции в кассе.</p>
          <label className="expense-field">Примечание <small>Необязательно</small><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Назначение операции" /></label>
        </fieldset>
        <ExpenseError>{error}</ExpenseError>
        <FormActions busy={busy} invalid={invalid} onClose={onClose} />
      </form>
    </Modal>
  );
}

export function OpeningBalancesForm({ opening, busy, error, onSave, onClose }) {
  const [form, setForm] = useState(() => Object.fromEntries([
    ["asOfDate", opening?.asOfDate || ""], ["note", opening?.note || ""],
    ...OPENING_FIELDS.map(([key]) => [key, String(opening?.[key] ?? "")]),
  ]));
  const values = Object.fromEntries(OPENING_FIELDS.map(([key]) => [key, form[key].trim() ? parseExpenseAmount(form[key]) : 0]));
  const invalidAmounts = Object.values(values).some((value) => !Number.isFinite(value) || value < 0);
  const change = (key, value) => setForm((old) => ({ ...old, [key]: value }));
  return (
    <Modal title="Остатки на начало учёта" section="Начальное состояние" wide legacyLight={false} onClose={onClose}>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!busy && form.asOfDate && !invalidAmounts) onSave({
          ...values, asOfDate: form.asOfDate, note: form.note.trim(),
          // The endpoint replaces the whole row. Preserve the other balances.
          revenue: num(opening?.revenue), expenses: num(opening?.expenses),
        });
      }}>
        <p className="expense-form-summary">Состояние бизнеса на начало выбранного дня при переходе с другой системы. Эти суммы задают точку отсчёта финансовых отчётов.</p>
        <fieldset disabled={busy}>
          <label className="expense-field">Дата старта учёта<input type="date" value={form.asOfDate} onInput={(event) => change("asOfDate", event.currentTarget.value)} onChange={(event) => change("asOfDate", event.target.value)} required /></label>
          <div className="expense-opening-fields">
            {OPENING_FIELDS.map(([key, label]) => <label className="expense-field" key={key}>{label}, ₽<input inputMode="decimal" value={form[key]} onChange={(event) => change(key, event.target.value)} placeholder="0" /></label>)}
          </div>
          {invalidAmounts && <p className="expense-invalid" role="alert">Введите неотрицательные суммы. Неизвестные остатки можно оставить пустыми.</p>}
          <label className="expense-field">Примечание <small>Необязательно</small><input value={form.note} onChange={(event) => change("note", event.target.value)} /></label>
        </fieldset>
        <ExpenseError>{error}</ExpenseError>
        <FormActions busy={busy} invalid={!form.asOfDate || invalidAmounts} onClose={onClose} />
      </form>
    </Modal>
  );
}

export function ExpensePhotoViewer({ expense, onClose }) {
  const [state, setState] = useState({ url: "", error: "", loading: true });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true, objectUrl = "";
    fetchBlobUrl(`/global-expenses/${expense.id}/photo`).then((url) => {
      objectUrl = url;
      if (active) setState({ url, error: "", loading: false });
      else URL.revokeObjectURL(url);
    }).catch((failure) => {
      if (active) setState({ url: "", error: failure.message || "Не удалось загрузить фото", loading: false });
    });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [expense.id, attempt]);
  return (
    <Modal title="Чек или накладная" section={expense.name} legacyLight={false} onClose={onClose}>
      <div className="expense-photo-viewer">
        {state.loading ? <Loader2 className="animate-spin" size={28} aria-label="Загрузка фото" /> : state.url ? <img src={state.url} alt={`Чек: ${expense.name}`} /> : <><Paperclip size={28} /><ExpenseError>{state.error}</ExpenseError><button className="expense-button" onClick={() => { setState({ url: "", error: "", loading: true }); setAttempt((old) => old + 1); }}>Попробовать снова</button></>}
      </div>
      <button type="button" className="expense-button expense-full" onClick={onClose}>Закрыть фото</button>
    </Modal>
  );
}
