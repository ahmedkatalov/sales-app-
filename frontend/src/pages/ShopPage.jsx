import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../api";
import { formatMoney } from "../utils/format";

export default function ShopPage() {
  const [products, setProducts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [cards, setCards] = useState([]);

  const [employeeId, setEmployeeId] = useState("");
  const [cart, setCart] = useState([]);
  const [paymentType, setPaymentType] = useState("cash");
  const [cardId, setCardId] = useState("");
  const [cashGiven, setCashGiven] = useState("");
  const [discount, setDiscount] = useState(0);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [cartOpen, setCartOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Safe array guards
  const safe_employees = Array.isArray(employees) ? employees : [];
  const safe_cards = Array.isArray(cards) ? cards : [];
  const safe_cart = Array.isArray(cart) ? cart : [];

  const load = async () => {
    setLoading(true);
    try {
      const [productsData, employeesData, cardsData] = await Promise.all([
        apiGet("/menu-products"),
        apiGet("/employees"),
        apiGet("/cards"),
      ]);

      setProducts(productsData || []);
      setEmployees(employeesData || []);
      setCards(cardsData || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const addToCart = (product) => {
    const existing = safe_cart.find((i) => i.productId === product.id);

    if (existing) {
      setCart((prev) =>
        prev.map((i) =>
          i.productId === product.id ? { ...i, qty: i.qty + 1 } : i
        )
      );
    } else {
      setCart((prev) => [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          type: product.type,
          category: product.category,
          qty: 1,
          price: Number(product.price || 0),
        },
      ]);
    }

    setCartOpen(true);
  };

  const decreaseQty = (productId) => {
    setCart((prev) =>
      prev
        .map((i) => (i.productId === productId ? { ...i, qty: i.qty - 1 } : i))
        .filter((i) => i.qty > 0)
    );
  };

  const increaseQty = (productId) => {
    setCart((prev) =>
      prev.map((i) => (i.productId === productId ? { ...i, qty: i.qty + 1 } : i))
    );
  };

  const removeFromCart = (productId) => {
    setCart((prev) => prev.filter((i) => i.productId !== productId));
  };

  const subtotal = useMemo(
    () => (Array.isArray(cart) ? cart : []).reduce((s, i) => s + Number(i.qty || 0) * Number(i.price || 0), 0),
    [cart]
  );

  const discountAmount = (subtotal * discount) / 100;
  const total = subtotal - discountAmount;
  const changeAmount = Number(cashGiven || 0) - total;

  const categories = useMemo(() => {
    return [
      "all",
      ...new Set(
        (products || [])
          .map((p) => String(p.category || p.type || "Без категории").trim())
          .filter(Boolean)
      ),
    ];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();

    return (Array.isArray(products) ? products : []).filter((p) => {
      const category = String(p.category || p.type || "Без категории").trim();
      const okCategory = activeCategory === "all" || category === activeCategory;
      const okSearch =
        !q ||
        String(p.name || "").toLowerCase().includes(q) ||
        category.toLowerCase().includes(q);

      return okCategory && okSearch;
    });
  }, [products, search, activeCategory]);

  const grouped = useMemo(() => {
    return filteredProducts.reduce((acc, p) => {
      const key = p.category || p.type || "Без категории";
      if (!acc[key]) acc[key] = [];
      acc[key].push(p);
      return acc;
    }, {});
  }, [filteredProducts]);

  const currentEmployee = safe_employees.find((e) => String(e.id) === String(employeeId));

  const confirmSale = async () => {
    if (!employeeId) {
      alert("Выбери сотрудника");
      return;
    }

    if (!safe_cart.length) {
      alert("Корзина пустая");
      return;
    }

    if (paymentType === "transfer" && !cardId) {
      alert("Выбери карту для перевода");
      return;
    }

    await apiPost("/sales", {
      employeeId: Number(employeeId),
      paymentType,
      cardId: paymentType === "transfer" ? Number(cardId) : 0,
      discountPercent: discount,
      cashGiven: Number(cashGiven || 0),
      items: cart,
    });

    alert("Продажа завершена");

    setCart([]);
    setCashGiven("");
    setDiscount(0);
    setCardId("");
    setCartOpen(false);
  };


  const CartPanel = ({ mobile = false }) => (
    <aside
      className={`flex h-full flex-col overflow-hidden border border-white/10 bg-slate-950/90 shadow-2xl shadow-black/30 backdrop-blur-2xl ${
        mobile ? "rounded-t-[2rem]" : "rounded-[2rem]"
      }`}
    >
      <div className="border-b border-white/10 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-300">
              POS корзина
            </p>
            <h2 className="mt-1 text-2xl font-black text-white">Заказ</h2>
            <p className="mt-1 text-sm font-semibold text-slate-400">
              {currentEmployee ? `Сотрудник: ${currentEmployee.name}` : "Сотрудник не выбран"}
            </p>
          </div>

          {mobile && (
            <button
              type="button"
              onClick={() => setCartOpen(false)}
              className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 font-black text-white"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {safe_cart.map((item) => (
          <div
            key={item.productId}
            className="rounded-3xl border border-white/10 bg-white/[0.04] p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-base font-black text-white">{item.name}</p>
                <p className="mt-1 text-xs font-bold text-slate-500">
                  {formatMoney(item.price)} за шт
                </p>
              </div>

              <button
                type="button"
                onClick={() => removeFromCart(item.productId)}
                className="rounded-xl bg-red-500/10 px-3 py-2 font-black text-red-300"
              >
                ×
              </button>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="flex items-center rounded-2xl border border-white/10 bg-black/20 p-1">
                <button
                  type="button"
                  onClick={() => decreaseQty(item.productId)}
                  className="h-9 w-9 rounded-xl bg-white/5 font-black text-white"
                >
                  −
                </button>
                <span className="w-12 text-center font-black text-white">{item.qty}</span>
                <button
                  type="button"
                  onClick={() => increaseQty(item.productId)}
                  className="h-9 w-9 rounded-xl bg-cyan-500 font-black text-slate-950"
                >
                  +
                </button>
              </div>

              <p className="text-lg font-black text-cyan-200">
                {formatMoney(item.qty * item.price)}
              </p>
            </div>
          </div>
        ))}

        {!safe_cart.length && (
          <div className="flex h-full min-h-[220px] flex-col items-center justify-center rounded-3xl border border-dashed border-white/10 bg-white/[0.03] p-8 text-center">
            <div className="mb-4 grid h-16 w-16 place-items-center rounded-3xl bg-cyan-500/10 text-3xl">
              🛒
            </div>
            <p className="text-lg font-black text-white">Корзина пустая</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
              Нажми на товар слева, чтобы добавить его в заказ.
            </p>
          </div>
        )}
      </div>

      <div className="space-y-3 border-t border-white/10 bg-black/20 p-4">
        <select
          value={paymentType}
          onChange={(e) => setPaymentType(e.target.value)}
          className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none focus:border-cyan-400"
        >
          <option value="cash">Наличные</option>
          <option value="transfer">Перевод</option>
        </select>

        {paymentType === "transfer" && (
          <select
            value={cardId}
            onChange={(e) => setCardId(e.target.value)}
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none focus:border-cyan-400"
          >
            <option value="">Карта</option>
            {safe_cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} / {c.owner}
              </option>
            ))}
          </select>
        )}

        {paymentType === "cash" && (
          <input
            value={cashGiven}
            onChange={(e) => setCashGiven(e.target.value)}
            placeholder="Сколько дал клиент"
            type="number"
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white placeholder:text-slate-500 outline-none focus:border-cyan-400"
          />
        )}

        <select
          value={discount}
          onChange={(e) => setDiscount(Number(e.target.value))}
          className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none focus:border-cyan-400"
        >
          <option value={0}>Без скидки</option>
          <option value={5}>Скидка 5%</option>
          <option value={10}>Скидка 10%</option>
          <option value={15}>Скидка 15%</option>
        </select>

        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex justify-between text-sm font-bold text-slate-400">
            <span>Сумма</span>
            <span>{formatMoney(subtotal)}</span>
          </div>

          <div className="mt-2 flex justify-between text-sm font-bold text-red-300">
            <span>Скидка</span>
            <span>-{formatMoney(discountAmount)}</span>
          </div>

          <div className="mt-4 flex items-end justify-between border-t border-white/10 pt-4">
            <span className="font-black text-white">Итого</span>
            <span className="text-3xl font-black text-cyan-200">
              {formatMoney(total)}
            </span>
          </div>

          {paymentType === "cash" && (
            <div className="mt-3 flex justify-between rounded-2xl bg-emerald-500/10 px-3 py-2 font-black text-emerald-300">
              <span>Сдача</span>
              <span>{formatMoney(changeAmount)}</span>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={confirmSale}
          disabled={!safe_cart.length}
          className="w-full rounded-2xl bg-gradient-to-r from-cyan-400 to-blue-500 px-5 py-4 text-lg font-black text-slate-950 shadow-xl shadow-cyan-500/20 transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Подтвердить покупку
        </button>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen  text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-20 -top-24 h-72 w-72 rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="absolute right-0 top-24 h-80 w-80 rounded-full bg-blue-600/20 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-80 w-80 rounded-full bg-violet-500/10 blur-3xl" />
      </div>

      <div className="relative grid min-h-screen gap-5 p-3 sm:p-5 xl:grid-cols-[1fr_430px]">
        <main className="min-w-0 overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.04] shadow-2xl shadow-black/20 backdrop-blur-2xl">
          <div className="border-b border-white/10 p-4 sm:p-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-300">
                  Быстрая продажа
                </p>
                <h1 className="mt-2 text-4xl font-black leading-none sm:text-6xl">
                  Магазин
                </h1>
                <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-slate-400">
                  Выбирай товары, собирай корзину, принимай оплату наличными или переводом.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-[1fr_auto] xl:w-[520px]">
                <select
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-bold text-white outline-none focus:border-cyan-400"
                >
                  <option value="">Сотрудник</option>
                  {safe_employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={load}
                  className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 font-black text-white transition hover:bg-white/10"
                >
                  {loading ? "..." : "Обновить"}
                </button>

                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Поиск товара..."
                  className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 font-bold text-white placeholder:text-slate-500 outline-none focus:border-cyan-400 sm:col-span-2"
                />
              </div>
            </div>

            <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
              {categories.map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => setActiveCategory(category)}
                  className={`shrink-0 rounded-2xl px-4 py-3 text-sm font-black transition ${
                    activeCategory === category
                      ? "bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-500/20"
                      : "border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                  }`}
                >
                  {category === "all" ? "Все" : category}
                </button>
              ))}
            </div>
          </div>

          <div className="h-[calc(100vh-255px)] overflow-y-auto p-4 sm:p-6">
            {Object.entries(grouped).map(([category, items]) => (
              <section key={category} className="mb-8 last:mb-0">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-black text-white">{category}</h2>
                    <p className="text-sm font-bold text-slate-500">
                      Товаров: {items.length}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                  {items.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addToCart(p)}
                      className="group min-h-[142px] rounded-[1.6rem] border border-white/10 bg-white/[0.05] p-4 text-left shadow-xl shadow-black/10 transition hover:-translate-y-1 hover:border-cyan-400/60 hover:bg-cyan-400/10 sm:min-h-[170px] sm:p-5"
                    >
                      <div className="mb-4 grid h-11 w-11 place-items-center rounded-2xl bg-cyan-400/10 text-xl text-cyan-200 group-hover:bg-cyan-400 group-hover:text-slate-950">
                        +
                      </div>

                      <p className="line-clamp-2 text-base font-black leading-tight text-white sm:text-lg">
                        {p.name}
                      </p>

                      <div className="mt-4 flex items-end justify-between gap-2">
                        <p className="text-lg font-black text-cyan-200">
                          {formatMoney(p.price)}
                        </p>
                        <span className="rounded-xl bg-white/5 px-2 py-1 text-[11px] font-black text-slate-400">
                          добавить
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ))}

            {!filteredProducts.length && (
              <div className="grid min-h-[360px] place-items-center rounded-[2rem] border border-dashed border-white/10 bg-white/[0.03] p-8 text-center">
                <div>
                  <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-3xl bg-white/5 text-3xl">
                    🔎
                  </div>
                  <p className="text-xl font-black text-white">Товары не найдены</p>
                  <p className="mt-2 text-sm font-semibold text-slate-500">
                    Попробуй изменить поиск или категорию.
                  </p>
                </div>
              </div>
            )}
          </div>
        </main>

        <div className="hidden xl:block">
          <CartPanel />
        </div>
      </div>

      <button
        type="button"
        onClick={() => setCartOpen(true)}
        className="fixed bottom-4 left-4 right-4 z-40 flex items-center justify-between rounded-3xl bg-gradient-to-r from-cyan-400 to-blue-500 px-5 py-4 font-black text-slate-950 shadow-2xl shadow-cyan-500/30 xl:hidden"
      >
        <span>Корзина · {safe_cart.reduce((s, i) => s + i.qty, 0)} шт</span>
        <span>{formatMoney(total)}</span>
      </button>

      {cartOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/70 p-2 backdrop-blur-sm xl:hidden">
          <div className="h-[88vh] w-full">
            <CartPanel mobile />
          </div>
        </div>
      )}
    </div>
  );
}
