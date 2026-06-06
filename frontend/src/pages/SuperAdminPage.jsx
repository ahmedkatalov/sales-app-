import { useState, useEffect, useCallback } from "react";

const API = import.meta.env.VITE_API_URL || "/api";

// ---------------------------------------------------------------------------
// Super Admin страница — только для тебя.
// Доступ через /super-admin в браузере.
// Требует SUPER_ADMIN_TOKEN из .env.
// ---------------------------------------------------------------------------

function useSuperApi(token) {
  const headers = {
    "Content-Type": "application/json",
    "X-Super-Token": token,
  };

  const request = async (method, path, body) => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
    if (!res.ok) throw new Error(data?.error || `Ошибка ${res.status}`);
    return data;
  };

  return {
    getAccounts: () => request("GET", "/super/accounts"),
    createAccount: (body) => request("POST", "/super/accounts", body),
    deleteAccount: (id) => request("DELETE", `/super/accounts/${id}`),
  };
}

export default function SuperAdminPage() {
  const [token, setToken] = useState(() => sessionStorage.getItem("super_token") || "");
  const [tokenInput, setTokenInput] = useState("");
  const [authed, setAuthed] = useState(false);

  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [form, setForm] = useState({ companyName: "", username: "", password: "" });
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showPasswords, setShowPasswords] = useState({});

  const api = useSuperApi(token);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const list = await api.getAccounts();
      setAccounts(list || []);
      setAuthed(true);
    } catch (e) {
      setError(e.message);
      if (/Неверный|Unauthorized|403|401/i.test(e.message)) {
        setAuthed(false);
        sessionStorage.removeItem("super_token");
      }
    } finally {
      setLoading(false);
    }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (token) load();
  }, [token, load]);

  const handleAuth = async (e) => {
    e?.preventDefault?.();
    const t = tokenInput.trim();
    if (!t) return;
    sessionStorage.setItem("super_token", t);
    setToken(t);
  };

  const handleCreate = async (e) => {
    e?.preventDefault?.();
    setError("");
    setSuccess("");

    if (!form.companyName.trim()) return setError("Введи название компании");
    if (!form.username.trim()) return setError("Введи логин");
    if (!form.password.trim()) return setError("Введи пароль");

    setCreating(true);
    try {
      const res = await api.createAccount({
        companyName: form.companyName.trim(),
        username: form.username.trim(),
        password: form.password.trim(),
      });
      setSuccess(`Компания «${res.companyName}» создана. Логин: ${res.username}`);
      setForm({ companyName: "", username: "", password: "" });
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (acc) => {
    if (!confirm(`Удалить компанию «${acc.name}»?\n\nБудут удалены ВСЕ данные: пользователи, продажи, склад, расходы. Это необратимо!`)) return;
    setError("");
    setSuccess("");
    try {
      await api.deleteAccount(acc.id);
      setSuccess(`Компания «${acc.name}» удалена`);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  const togglePassword = (id) => setShowPasswords((p) => ({ ...p, [id]: !p[id] }));

  const inputClass = "w-full rounded-2xl border-2 border-white/10 bg-slate-950/60 px-4 py-3 text-sm font-bold text-white placeholder:text-slate-500 outline-none focus:border-blue-500/70 focus:ring-2 focus:ring-blue-500/20 transition";

  // Экран авторизации
  if (!authed) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 p-4">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-40 -top-40 h-[500px] w-[500px] rounded-full bg-violet-600/10 blur-[120px]" />
          <div className="absolute -bottom-40 -right-40 h-[500px] w-[500px] rounded-full bg-blue-600/10 blur-[120px]" />
        </div>

        <div className="relative z-10 w-full max-w-[400px]">
          <div className="rounded-[2rem] border border-white/10 bg-slate-900/80 p-7 shadow-2xl backdrop-blur-xl">
            <div className="mb-6">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-violet-700 shadow-lg shadow-violet-600/30">
                <span className="text-xl font-black text-white">⚙</span>
              </div>
              <p className="text-xs font-black uppercase tracking-widest text-violet-400">Super Admin</p>
              <h1 className="mt-1 text-2xl font-black text-white">Панель управления</h1>
              <p className="mt-1 text-sm text-slate-400">Введи SUPER_ADMIN_TOKEN из .env</p>
            </div>

            {error && (
              <div className="mb-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3">
                <p className="text-sm font-bold text-red-300">{error}</p>
              </div>
            )}

            <div className="space-y-3">
              <input
                type="password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAuth(e)}
                placeholder="Super Admin Token"
                className={inputClass}
                autoFocus
              />
              <button
                onClick={handleAuth}
                className="w-full rounded-2xl bg-gradient-to-r from-violet-600 to-violet-500 py-3.5 text-sm font-black text-white shadow-lg shadow-violet-600/30 transition hover:from-violet-500 hover:to-violet-400"
              >
                Войти
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-4 text-white sm:p-6">
      <div className="mx-auto max-w-5xl">

        {/* Header */}
        <header className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-violet-400">Super Admin</p>
            <h1 className="text-3xl font-black text-white">Компании</h1>
            <p className="mt-1 text-sm text-slate-400">
              Создавай аккаунты компаний и передавай им логин/пароль owner-аккаунта
            </p>
          </div>
          <button
            onClick={() => { sessionStorage.removeItem("super_token"); setAuthed(false); setToken(""); }}
            className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-2 text-sm font-black text-slate-300 transition hover:bg-red-600 hover:text-white"
          >
            Выйти
          </button>
        </header>

        {/* Alerts */}
        {error && (
          <div className="mb-4 flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500 text-[11px] font-black text-white">!</span>
            <p className="text-sm font-bold text-red-300">{error}</p>
          </div>
        )}
        {success && (
          <div className="mb-4 flex items-start gap-3 rounded-2xl border border-green-500/20 bg-green-500/10 px-4 py-3.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-500 text-[11px] font-black text-white">✓</span>
            <p className="text-sm font-bold text-green-300">{success}</p>
          </div>
        )}

        {/* Кнопка создания / форма */}
        {!showForm ? (
          <button
            onClick={() => { setShowForm(true); setError(""); setSuccess(""); }}
            className="mb-6 rounded-2xl bg-gradient-to-r from-violet-600 to-blue-600 px-6 py-3.5 font-black text-white shadow-lg transition hover:opacity-90"
          >
            + Создать компанию
          </button>
        ) : (
          <div className="mb-6 rounded-[2rem] border border-white/10 bg-slate-900/80 p-6 shadow-2xl backdrop-blur">
            <h2 className="mb-4 text-xl font-black">Новая компания</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-400">Название компании</label>
                <input
                  value={form.companyName}
                  onChange={(e) => setForm((p) => ({ ...p, companyName: e.target.value }))}
                  placeholder="Кофейня «Лира»"
                  className={inputClass}
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-400">Логин owner</label>
                <input
                  value={form.username}
                  onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))}
                  placeholder="lira@coffee.com"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-400">Пароль owner</label>
                <input
                  value={form.password}
                  onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                  placeholder="Надёжный пароль"
                  type="text"
                  className={inputClass}
                />
              </div>
            </div>
            <div className="mt-4 flex gap-3">
              <button
                onClick={() => { setShowForm(false); setForm({ companyName: "", username: "", password: "" }); }}
                className="rounded-2xl border border-white/10 bg-slate-950 px-5 py-3 font-black text-slate-300 transition hover:bg-slate-800"
              >
                Отмена
              </button>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="rounded-2xl bg-gradient-to-r from-violet-600 to-blue-600 px-6 py-3 font-black text-white shadow-lg transition disabled:opacity-60 hover:opacity-90"
              >
                {creating ? "Создаю..." : "Создать"}
              </button>
            </div>
          </div>
        )}

        {/* Список компаний */}
        {loading ? (
          <div className="rounded-3xl border border-white/10 bg-slate-900 p-8 text-center text-slate-400 font-black">
            Загрузка...
          </div>
        ) : accounts.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-slate-900 p-10 text-center">
            <p className="text-xl font-black text-white">Компаний пока нет</p>
            <p className="mt-1 text-slate-400">Создай первую компанию выше</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {accounts.map((acc) => (
              <article key={acc.id} className="rounded-[1.5rem] border border-white/10 bg-slate-900 p-5">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-violet-400">#{acc.id}</p>
                    <h3 className="mt-0.5 text-xl font-black text-white">{acc.name}</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {acc.createdAt ? new Date(acc.createdAt).toLocaleDateString("ru-RU") : "—"}
                    </p>
                  </div>
                  <span className="rounded-xl border border-white/10 bg-slate-950 px-3 py-1.5 text-xs font-black text-slate-300">
                    {acc.userCount} owner
                  </span>
                </div>

                <button
                  onClick={() => handleDelete(acc)}
                  className="mt-2 w-full rounded-2xl bg-red-500/10 px-4 py-2.5 text-sm font-black text-red-400 transition hover:bg-red-500/20 hover:text-red-300"
                >
                  Удалить компанию
                </button>
              </article>
            ))}
          </div>
        )}

        <div className="mt-8 rounded-2xl border border-white/5 bg-slate-900/40 p-5">
          <p className="text-xs font-black uppercase tracking-wide text-slate-500 mb-2">Инструкция</p>
          <ol className="space-y-1.5 text-sm text-slate-400 list-decimal list-inside">
            <li>Создай компанию с логином и паролем — это будет owner-аккаунт клиента</li>
            <li>Передай клиенту логин и пароль (безопасным способом)</li>
            <li>Клиент входит на основном сайте и сам создаёт точки, аккаунты сотрудников</li>
            <li>Ты никогда больше не касаешься их аккаунта, если они не просят</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
