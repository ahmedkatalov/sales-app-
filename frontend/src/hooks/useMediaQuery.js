import { useEffect, useState } from "react";

// Возвращает true/false по CSS media-query и обновляется при изменении ширины.
// Нужен, чтобы рендерить ЛИБО таблицу, ЛИБО карточки (а не обе сразу в DOM) —
// вдвое меньше узлов и реконсиляции, особенно заметно на планшете.
export function useMediaQuery(query) {
  const get = () => typeof window !== "undefined" && window.matchMedia(query).matches;
  const [match, setMatch] = useState(get);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const on = () => setMatch(mql.matches);
    on();
    mql.addEventListener("change", on);
    return () => mql.removeEventListener("change", on);
  }, [query]);
  return match;
}
