import { useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost } from "../api";

export default function CardsPage() {
  const [cards, setCards] = useState([]);
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [search, setSearch] = useState("");

  const load = async () => {
    const data = await apiGet("/cards");
    setCards(data || []);
  };

  useEffect(() => {
    load();
  }, []);

  const createCard = async () => {
    if (!name.trim()) return;

    await apiPost("/cards", {
      name: name.trim(),
      owner: owner.trim(),
    });

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

    return cards.filter((card) => {
      const text = `${card.name || ""} ${card.owner || ""}`.toLowerCase();
      return !q || text.includes(q);
    });
  }, [cards, search]);

  return (
    <div className="pb-24 sm:pb-10">
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="text-sm font-bold text-blue-400">Финансы</p>

          <h2 className="text-4xl font-black leading-none text-white sm:text-5xl">
            Карты
          </h2>

          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">
            Карты и направления переводов для оплаты заказов.
          </p>
        </div>

        <button
          onClick={load}
          className="w-full rounded-2xl border border-white/10 bg-white/10 px-5 py-3 font-black text-white shadow-xl transition hover:bg-white/15 sm:w-auto"
        >
          ⟳ Обновить
        </button>
      </div>

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <div className="rounded-[28px] border border-blue-500/30 bg-blue-500/10 p-5 shadow-2xl">
          <p className="text-xs font-black uppercase tracking-wide text-blue-200">
            Всего карт
          </p>

          <p className="mt-3 text-4xl font-black text-white">
            {cards.length}
          </p>

          <p className="mt-1 text-sm font-bold text-slate-400">
            подключено к кассе
          </p>
        </div>

        <div className="rounded-[28px] border border-emerald-500/30 bg-emerald-500/10 p-5 shadow-2xl">
          <p className="text-xs font-black uppercase tracking-wide text-emerald-200">
            Найдено
          </p>

          <p className="mt-3 text-4xl font-black text-white">
            {visibleCards.length}
          </p>

          <p className="mt-1 text-sm font-bold text-slate-400">
            по текущему поиску
          </p>
        </div>

        <div className="rounded-[28px] border border-violet-500/30 bg-violet-500/10 p-5 shadow-2xl">
          <p className="text-xs font-black uppercase tracking-wide text-violet-200">
            Статус
          </p>

          <p className="mt-3 text-2xl font-black text-white">
            ONLINE
          </p>

          <p className="mt-1 text-sm font-bold text-slate-400">
            приём переводов
          </p>
        </div>
      </div>

      <div className="mb-5 rounded-[32px] border border-white/10 bg-[#0f172a]/80 p-5 shadow-2xl backdrop-blur sm:p-6">
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_240px]">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название банка"
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500"
          />

          <input
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="Владелец"
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500"
          />

          <button
            onClick={createCard}
            className="rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-3 font-black text-white shadow-lg shadow-blue-900/30 transition hover:scale-[1.01]"
          >
            + Добавить карту
          </button>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по банку или владельцу"
          className="mt-3 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none placeholder:text-slate-500"
        />
      </div>

      <div className="rounded-[32px] border border-white/10 bg-[#0f172a]/80 shadow-2xl backdrop-blur">
        <div className="flex flex-col gap-2 border-b border-white/10 p-5 sm:p-6">
          <p className="text-sm font-bold text-blue-400">
            Список
          </p>

          <h3 className="text-2xl font-black text-white sm:text-3xl">
            Карты для переводов
          </h3>

          <p className="text-sm text-slate-400">
            Эти карты можно выбирать при оплате переводом.
          </p>
        </div>

        {visibleCards.length ? (
          <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-6 xl:grid-cols-3">
            {visibleCards.map((card) => (
              <div
                key={card.id}
                className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[#111827] p-5 shadow-xl"
              >
                <div className="absolute right-[-40px] top-[-40px] h-32 w-32 rounded-full bg-blue-500/20 blur-2xl" />
                <div className="absolute bottom-[-50px] left-[-50px] h-32 w-32 rounded-full bg-violet-500/20 blur-2xl" />

                <div className="relative">
                  <div className="mb-6 flex items-start justify-between gap-3">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 text-2xl font-black text-white">
                      💳
                    </div>

                    <button
                      onClick={() => remove(card.id)}
                      className="rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm font-black text-red-300 transition hover:bg-red-500/15"
                    >
                      Удалить
                    </button>
                  </div>

                  <p className="text-2xl font-black text-white">
                    {card.name}
                  </p>

                  <p className="mt-2 text-sm font-bold text-slate-400">
                    {card.owner || "Владелец не указан"}
                  </p>

                  <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-xs font-black uppercase tracking-wide text-slate-500">
                      Статус
                    </p>

                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />

                      <p className="font-bold text-emerald-300">
                        Активна для переводов
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-10 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-white/10 text-3xl">
              💳
            </div>

            <p className="text-xl font-black text-white">
              Карт пока нет
            </p>

            <p className="mt-2 text-sm text-slate-400">
              Добавь первую карту для переводов.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}