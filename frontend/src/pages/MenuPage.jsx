import { useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost } from "../api";
import { formatMoney } from "../utils/format";

export default function MenuPage() {
  const [products, setProducts] = useState([]);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [type, setType] = useState("drink");
  const [price, setPrice] = useState("");

  // Safe array guards
  const safe_products = Array.isArray(products) ? products : [];

  const load = async () => {
    const data = await apiGet("/menu-products");
    setProducts(data || []);
  };

  useEffect(() => {
    load();
  }, []);

  const createProduct = async () => {
    await apiPost("/menu-products", {
      name,
      category,
      type,
      price: Number(price),
    });

    setName("");
    setCategory("");
    setPrice("");
    load();
  };

  const remove = async (id) => {
    await apiDelete(`/menu-products/${id}`);
    load();
  };

  return (
    <div className="min-h-screen  text-white p-4 sm:p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-cyan-400 font-bold">Управление меню</p>
          <h1 className="text-4xl sm:text-5xl font-black">
            Меню магазина
          </h1>
        </div>

        <button
          onClick={createProduct}
          className="rounded-2xl bg-cyan-500 px-5 py-3 font-black text-black shadow-lg"
        >
          + Добавить товар
        </button>
      </div>

      <div className="mb-6 rounded-[28px] border border-white/10 bg-[#111827] p-4 sm:p-6 shadow-2xl">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название"
            className="rounded-2xl border border-white/10 bg-[#1e293b] px-4 py-3 outline-none"
          />

          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Категория"
            className="rounded-2xl border border-white/10 bg-[#1e293b] px-4 py-3 outline-none"
          />

          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="rounded-2xl border border-white/10 bg-[#1e293b] px-4 py-3 outline-none"
          >
            <option value="drink">Напиток</option>
            <option value="food">Еда</option>
          </select>

          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Цена"
            className="rounded-2xl border border-white/10 bg-[#1e293b] px-4 py-3 outline-none"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {safe_products.map((p) => (
          <div
            key={p.id}
            className="rounded-[28px] border border-white/10 bg-[#111827] p-5 shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-2xl font-black">{p.name}</p>
                <p className="text-slate-400">{p.category}</p>
              </div>

              <button
                onClick={() => remove(p.id)}
                className="rounded-xl bg-red-500/20 px-3 py-2 text-sm font-black text-red-400"
              >
                Удалить
              </button>
            </div>

            <div className="flex items-center justify-between rounded-2xl bg-[#1e293b] p-4">
              <span className="text-slate-400">Цена</span>
              <span className="text-xl font-black text-cyan-400">
                {formatMoney(p.price)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
