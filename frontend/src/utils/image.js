// Сжатие фото перед загрузкой: телефонные снимки по 3–8 МБ не пролезут через
// nginx (лимит ~1 МБ) и раздуют диск. Ужимаем по большей стороне и пере-кодируем
// в JPEG. Возвращаем data URL (base64) — его принимает POST /global-expenses/:id/photo.
export async function compressImageToDataURL(file, { maxEdge = 1400, quality = 0.7 } = {}) {
  if (!file) throw new Error("Файл не выбран");
  if (!/^image\//.test(file.type)) throw new Error("Это не изображение");

  const dataUrl = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error("Не удалось прочитать файл"));
    fr.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("Не удалось открыть изображение"));
    im.src = dataUrl;
  });

  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const scale = Math.min(1, maxEdge / Math.max(w, h || 1));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // фон для прозрачных PNG, чтобы JPEG не стал чёрным
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(img, 0, 0, cw, ch);

  let out = canvas.toDataURL("image/jpeg", quality);
  // Подстраховка под лимит nginx (~1 МБ): если всё ещё крупно — жмём сильнее.
  if (out.length > 900_000) out = canvas.toDataURL("image/jpeg", 0.5);
  return out;
}

// Мини-превью из УЖЕ готового data URL: чтобы показать отправленное фото прямо в
// чате и сохранить его в localStorage (тяжёлый оригинал туда не влезет — забьёт
// квоту и чат перестанет сохраняться). Возвращает компактный JPEG data URL.
export async function shrinkDataURL(dataUrl, { maxEdge = 480, quality = 0.6 } = {}) {
  if (!dataUrl || typeof dataUrl !== "string") throw new Error("Нет изображения");

  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("Не удалось открыть изображение"));
    im.src = dataUrl;
  });

  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const scale = Math.min(1, maxEdge / Math.max(w, h || 1));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(img, 0, 0, cw, ch);

  return canvas.toDataURL("image/jpeg", quality);
}
