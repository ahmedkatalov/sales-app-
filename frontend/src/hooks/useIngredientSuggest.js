import { useEffect, useRef, useState } from "react";
import { post } from "../api";

// Общий хук AI-подсказок ингредиента/названия. Один источник правды для всех
// трёх полей (состав в «Товарах», состав в «Кассе», название на «Складе»),
// чтобы поведение было одинаковым и без «кривости»:
//   • защита от гонок — применяется ТОЛЬКО ответ на самый свежий ввод
//     (медленный старый ответ больше не перетирает новый);
//   • кэш результатов — повтор/бэкспейс не бьёт в ИИ заново (мгновенно);
//   • стабильная зависимость по складу (по сигнатуре, а не по ссылке массива),
//     чтобы эффект не перезапускался на каждый ре-рендер родителя.

const cache = new Map(); // key -> { suggestions, t }
const TTL = 5 * 60 * 1000; // 5 минут
const MAX_CACHE = 200;

function warehouseSignature(items) {
  const arr = Array.isArray(items) ? items : [];
  // Длина + id первых/последних достаточно, чтобы поймать добавление/удаление
  // позиции и инвалидировать кэш, не гоняя длинную строку.
  if (arr.length === 0) return "0";
  return `${arr.length}:${arr[0]?.id ?? ""}:${arr[arr.length - 1]?.id ?? ""}`;
}

export function useIngredientSuggest(text, warehouseItems, { minLen = 2, debounce = 450 } = {}) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const reqSeq = useRef(0);
  const timer = useRef(null);

  const norm = (text || "").trim();
  const whSig = warehouseSignature(warehouseItems);

  useEffect(() => {
    clearTimeout(timer.current);

    if (norm.length < minLen) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    const key = `${whSig}|${norm.toLowerCase()}`;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.t < TTL) {
      setSuggestions(cached.suggestions);
      setLoading(false);
      return;
    }

    // Не мигаем спиннером на каждую букву: loading включаем ТОЛЬКО когда запрос
    // реально уходит (после дебаунса). Старые подсказки держим видимыми до нового
    // ответа (stale-while-revalidate), не обнуляя список резко.
    const myId = ++reqSeq.current;

    timer.current = setTimeout(async () => {
      setLoading(true);
      let list = [];
      try {
        const r = await post("/ai/ingredient/suggest", {
          text: norm,
          warehouseItems: (Array.isArray(warehouseItems) ? warehouseItems : []).map((w) => ({
            id: w.id,
            name: w.name,
            unit: w.unit,
          })),
        });
        list = Array.isArray(r?.suggestions) ? r.suggestions : [];
        cache.set(key, { suggestions: list, t: Date.now() });
        if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
      } catch {
        list = [];
      }
      // Применяем результат только если это ответ на самый свежий ввод
      if (myId === reqSeq.current) {
        setSuggestions(list);
        setLoading(false);
      }
    }, debounce);

    return () => clearTimeout(timer.current);
    // norm + whSig — стабильные примитивы, эффект не дёргается на каждый ре-рендер
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [norm, whSig, minLen, debounce]);

  return { suggestions, loading };
}
