import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { getTheme, toggleTheme } from "../theme";

// Переключатель темы. variant="icon" — компактная кнопка для шапки,
// variant="full" — широкая кнопка с подписью (для профиля).
export default function ThemeToggle({ variant = "icon", className = "" }) {
  const [theme, setThemeState] = useState(getTheme());

  useEffect(() => {
    const onChange = () => setThemeState(getTheme());
    window.addEventListener("sales-theme-change", onChange);
    return () => window.removeEventListener("sales-theme-change", onChange);
  }, []);

  const handleToggle = () => setThemeState(toggleTheme());
  const isDark = theme === "dark";
  const Icon = isDark ? Sun : Moon;
  const label = isDark ? "Светлая тема" : "Тёмная тема";

  if (variant === "full") {
    return (
      <button
        type="button"
        onClick={handleToggle}
        className={`flex items-center justify-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-sm font-bold text-[var(--text)] transition hover:bg-[var(--surface-hover)] ${className}`}
        title={label}
      >
        <Icon size={18} strokeWidth={2.4} />
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label={label}
      title={label}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus:outline-none focus:ring-4 focus:ring-blue-500/20 ${className}`}
    >
      <Icon size={18} strokeWidth={2.4} />
    </button>
  );
}
