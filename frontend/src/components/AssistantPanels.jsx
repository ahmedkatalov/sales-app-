import { Link } from "react-router-dom";
import { useRef } from "react";
import { ArrowRight, Banknote, Bot, Boxes, ChevronDown, Clock, FileText, MapPin, Plus, Sparkles, TrendingUp, Warehouse, X } from "lucide-react";
import { formatMoney, num } from "../utils/format";
import { unitLabel } from "../utils/menu";
import useDialogFocus from "../utils/useDialogFocus";

const ASSISTANT_STARTERS = [
  { title: "Проверить остатки", description: "Что заканчивается и пора заказать", prompt: "Что заканчивается на складе?", icon: Boxes },
  { title: "Посмотреть продажи", description: "Выручка и результаты за сегодня", prompt: "Покажи продажи за сегодня", icon: TrendingUp },
  { title: "Добавить закупку", description: "Продукты, количество и стоимость", prompt: "Купили молоко 4 пачки по 1 л за 420 ₽", icon: Plus },
  { title: "Записать расход", description: "За что заплатили и какую сумму", prompt: "Запиши расход: доставка продуктов, 650 ₽", icon: Banknote },
];

export function AssistantWelcome({ targetName, onDraft }) {
  return (
    <div className="assistant-welcome">
      <span className="assistant-welcome-icon"><Bot size={30} strokeWidth={1.7} /></span>
      <p className="assistant-eyebrow">Помощник вашей точки</p>
      <h2>С чего начнём?</h2>
      <p>Помогу разобраться с остатками, продажами и расходами{targetName ? ` в «${targetName}»` : ""}. Опишите задачу или выберите пример.</p>
      <div className="assistant-starters">
        {ASSISTANT_STARTERS.map(({ title, description, prompt, icon: Icon }) => (
          <button type="button" key={title} onClick={() => onDraft(prompt)} className="bg-white/[0.02] shadow-sm backdrop-blur-xl">
            <span><Icon size={20} strokeWidth={1.7} /><ArrowRight size={15} /></span>
            <strong>{title}</strong><small>{description}</small>
          </button>
        ))}
      </div>
      <div className="assistant-welcome-photo"><FileText size={16} /><span>Есть накладная? Прикрепите фото в поле сообщения.</span></div>
    </div>
  );
}

const movementDate = (value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Дата не указана";
};

function PanelHeading({ name, count, icon: Icon, open, onToggle }) {
  return (
    <button type="button" className="assistant-panel-heading" aria-expanded={open} onClick={onToggle}>
      <Icon size={16} /><span>{name}</span>{count !== undefined && <small>{count}</small>}<ChevronDown size={14} />
    </button>
  );
}

export function AssistantContext({ targetName, contextOpen, onClose, sidePanels, onToggle, items, recent, loading, error, ready, onDraft }) {
  const panelRef = useRef(null);
  useDialogFocus(panelRef, contextOpen);
  const emptyText = loading ? "Загружаем данные…" : error || !ready ? "Обновите данные точки" : "На складе пока нет позиций";
  return (
    <>
      {contextOpen && <button type="button" className="assistant-context-backdrop" aria-label="Закрыть данные точки" onClick={onClose} />}
      <aside ref={panelRef} className={`assistant-context ${contextOpen ? "is-open" : ""}`} aria-label="Данные точки" role={contextOpen ? "dialog" : undefined} aria-modal={contextOpen || undefined}>
        <div className="assistant-context-title"><div><p className="assistant-eyebrow">Рабочая точка</p><h2><MapPin size={15} />{targetName || "Текущая точка"}</h2></div><button type="button" className="assistant-icon-button assistant-context-close" aria-label="Свернуть данные точки" onClick={onClose}><X size={18} /></button></div>
        <div className="assistant-context-section">
          <PanelHeading name="Остатки" count={ready ? items.length : undefined} icon={Boxes} open={sidePanels.stocks} onToggle={() => onToggle("stocks")} />
          {sidePanels.stocks && (
            <div className="assistant-stock-list">
              {items.length ? items.map((item) => {
                const minimum = num(item.minQuantity ?? item.min_quantity);
                const low = minimum > 0 && num(item.quantity) <= minimum;
                return <div className={low ? "is-low" : ""} key={item.id}><span><strong>{item.name}</strong>{low && <small>Пора пополнить</small>}</span><span>{formatMoney(item.quantity)}<small>{unitLabel(item.unit)}</small></span></div>;
              }) : <p className="assistant-context-empty">{emptyText}</p>}
            </div>
          )}
        </div>
        <div className="assistant-context-section">
          <PanelHeading name="Последние приходы" count={ready ? recent.length : undefined} icon={Clock} open={sidePanels.recent} onToggle={() => onToggle("recent")} />
          {sidePanels.recent && (
            <div className="assistant-recent-list">
              {recent.length ? recent.map((movement, index) => (
                <div key={movement.id || index}><span className="assistant-recent-dot" /><div><strong>{movement.itemName || movement.item_name || "Сырьё"}</strong><small>{movementDate(movement.createdAt || movement.created_at)}</small></div><span>+{formatMoney(movement.quantity)}<small>{unitLabel(movement.unit)}</small></span></div>
              )) : <p className="assistant-context-empty">{loading ? "Загружаем приходы…" : error || !ready ? "Данные недоступны" : "Приходов пока нет"}</p>}
            </div>
          )}
        </div>
        <div className="assistant-context-section">
          <PanelHeading name="Идеи для диалога" icon={Sparkles} open={sidePanels.suggestions} onToggle={() => onToggle("suggestions")} />
          {sidePanels.suggestions && (
            <div className="assistant-context-suggestions">
              {["Какие товары самые прибыльные?", "Кто должен деньги?", "Как снизить себестоимость меню?"].map((prompt) => <button type="button" key={prompt} onClick={() => { onDraft(prompt); onClose(); }}>{prompt}<ArrowRight size={13} /></button>)}
            </div>
          )}
        </div>
        <Link to="/warehouse" className="assistant-warehouse-link"><Warehouse size={16} />Открыть склад<ArrowRight size={14} /></Link>
      </aside>
    </>
  );
}
