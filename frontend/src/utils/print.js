// Печать / сохранение в PDF через окно печати браузера. Без внешних библиотек.
export const escHtml = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// html — полный HTML-документ (<!doctype html>…). Возвращает false, если всплывающие окна заблокированы.
export const printHtmlDocument = (html) => {
  const w = window.open("", "_blank");
  if (!w) {
    window.notify?.("Разрешите всплывающие окна, чтобы распечатать / сохранить PDF", "error");
    return false;
  }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 350);
  return true;
};
