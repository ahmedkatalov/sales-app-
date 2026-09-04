import { num } from "./format";

// Экспорт CSV для русского Excel: UTF-8 BOM + запятая как десятичный разделитель,
// защита от формул-инъекций (=,+,-,@). Ячейки строим через csvCell/csvNum, затем downloadCsv.
export const csvCell = (value) => {
  let t = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return `"${t.replaceAll('"', '""')}"`;
};

export const csvNum = (value) => `"${String(num(value)).replace(".", ",")}"`;

// rows — массив массивов уже экранированных ячеек (csvCell/csvNum).
// Разделитель полей — «;» (стандарт для русского Excel, где «,» — десятичный знак).
export const downloadCsv = (filename, rows) => {
  const csv = rows.map((r) => r.join(";")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};
