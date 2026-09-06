import { useEffect, useMemo, useState } from "react";
import { RefreshCw, CreditCard, Plus, Trash2, Search } from "lucide-react";
import { apiDelete, apiGet, apiPost } from "../api";
import EmptyState from "../components/EmptyState";

export default function CardsPage() {
  const [cards, setCards] = useState([]);
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [search, setSearch] = useState("");

  const safe_cards = Array.isArray(cards) ? cards : [];

  const load = async () => {
    const data = await apiGet("/cards");
    setCards(data || []);
  };

  useEffect(() => { load(); }, []);

  const createCard = async () => {
    if (!name.trim()) return;
    await apiPost("/cards", { name: name.trim(), owner: owner.trim() });
    setName("");
    setOwner("");
    load();
  };

  const remove = async (id) => {
    if (!window.confirm("Удалить карту?")) return;
    await apiDelete(`/cards/${id}`);
    load();
  };

  const visibleCards = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (Array.isArray(cards) ? cards : []).filter((card) => {
      const text = `${card.name || ""} ${card.owner || ""}`.toLowerCase();
      return !q || text.includes(q);
    });
  }, [cards, search]);

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-6 sm:py-8">
      {/* Шапка */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-bold text-blue-400">Финансы</p>
          <h2 className="text-3xl font-black leading-none text-white sm:text-4xl">Карты</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">Карты для приёма переводов — их можно выбирать при оплате заказа.</p>
        </div>
        <button onClick={load}
          className="flex shrink-0 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 font-black text-slate-200 transition hover:bg-white/10 active:scale-95">
          <RefreshCw size={16} strokeWidth={2.4} /> Обновить
        </button>
      </div>

      {/* Мини-статистика */}
      <div className="mb-5 grid grid-cols-2 gap-2.5 sm:gap-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3 backdrop-blur-xl sm:p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/15 text-blue-300 sm:h-9 sm:w-9 sm:rounded-xl"><CreditCard className="h-[18px] w-[18px]" strokeWidth={2.2} /></span>
            <p className="min-w-0 text-[11px] font-black uppercase leading-[1.15] tracking-wide text-slate-400">Всего карт</p>
          </div>
          <p className="mt-2 text-xl font-black text-white sm:text-2xl">{safe_cards.length}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3 backdrop-blur-xl sm:p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-300 sm:h-9 sm:w-9 sm:rounded-xl"><Search className="h-[18px] w-[18px]" strokeWidth={2.2} /></span>
            <p className="min-w-0 text-[11px] font-black uppercase leading-[1.15] tracking-wide text-slate-400">Найдено</p>
          </div>
          <p className="mt-2 text-xl font-black text-white sm:text-2xl">{visibleCards.length}</p>
        </div>
      </div>

      {/* Добавление + поиск */}
      <div className="mb-5 rounded-3xl border border-white/10 bg-white/[0.04] p-4 shadow-xl backdrop-blur sm:p-5">
        <div className="grid gap-2.5 sm:grid-cols-[1fr_1fr_auto]">
          <input value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createCard(); } }}
            placeholder="Название банка"
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10" />
          <input value={owner} onChange={(e) => setOwner(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createCard(); } }}
            placeholder="Владелец"
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10" />
          <button onClick={createCard} disabled={!name.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-3 font-black text-white shadow-lg shadow-blue-900/30 transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">
            <Plus size={16} strokeWidth={2.6} /> Добавить
          </button>
        </div>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по банку или владельцу"
          className="mt-2.5 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500 focus:border-blue-400/60 focus:ring-4 focus:ring-blue-500/10" />
      </div>

      {/* Список карт */}
      {visibleCards.length ? (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {visibleCards.map((card) => (
            <div key={card.id} className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-4 shadow-lg transition hover:border-blue-500/40">
              <div className="pointer-events-none absolute right-[-40px] top-[-40px] h-28 w-28 rounded-full bg-blue-500/15 blur-2xl" />
              <div className="relative">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-lg shadow-blue-900/30">
                    <CreditCard size={22} strokeWidth={2.2} />
                  </span>
                  <button onClick={() => remove(card.id)} aria-label="Удалить карту" title="Удалить"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-300 transition hover:bg-red-500/20">
                    <Trash2 size={16} />
                  </button>
                </div>
                <p className="truncate text-lg font-black text-white">{card.name}</p>
                <p className="mt-0.5 truncate text-sm font-bold text-slate-400">{card.owner || "Владелец не указан"}</p>
                <p className="mt-3 flex items-center gap-1.5 text-xs font-bold text-emerald-300">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" /> Активна для переводов
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<CreditCard size={26} />}
          title={search.trim() ? "Ничего не найдено" : "Карт пока нет"}
          text={search.trim() ? "Измените поисковый запрос." : "Добавьте первую карту для приёма переводов."}
        />
      )}
    </div>
  );
}
