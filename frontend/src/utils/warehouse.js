import { num } from "./format.js";

export const STOCK_EPSILON = .000001;
export const STOCK_STATUSES = { neg: "В минусе", out: "Закончилось", low: "Низкий остаток", norm: "В норме" };
const STATUS_ORDER = { neg: 0, out: 1, low: 2, norm: 3 };
export const warehouseNumber = (value) => Number(String(value ?? "").trim().replace(/\s/g, "").replace(",", "."));
export const warehouseQuantity = (value) => num(value).toLocaleString("ru-RU", { maximumFractionDigits: 3 });
export const warehouseUnitPrice = (value) => num(value).toLocaleString("ru-RU", { maximumFractionDigits: 4 });
export const warehouseHidden = (item) => Boolean(item.hidden || item.isHidden || item.is_hidden);
export function warehouseCost(item) {
  const direct = item.unitCost ?? item.unit_cost ?? item.costPerUnit ?? item.cost_per_unit;
  if (direct !== undefined && direct !== null && Number(direct) > 0) return num(direct);
  const quantity = num(item.initialQuantity || item.quantity);
  return quantity ? num(item.price || item.purchasePrice) / quantity : 0;
}
export function enrichWarehouseItem(item) {
  const quantity = num(item.quantity), minimum = num(item.minQuantity ?? item.min_quantity);
  const status = quantity < -STOCK_EPSILON ? "neg" : quantity <= STOCK_EPSILON ? "out" : minimum > 0 && quantity <= minimum ? "low" : "norm";
  const unitCost = warehouseCost(item);
  return { ...item, quantity, minimum, status, unitCost, value: quantity * unitCost, deficit: minimum > 0 ? Math.max(0, minimum - quantity) : Math.max(0, -quantity), hidden: warehouseHidden(item) };
}
export function summarizeWarehouse(items) {
  const active = items.filter((item) => !item.hidden);
  const counts = { neg: 0, out: 0, low: 0, norm: 0 };
  active.forEach((item) => counts[item.status]++);
  return { counts, count: active.length, hidden: items.length - active.length, attention: counts.neg + counts.out + counts.low, value: active.reduce((sum, item) => sum + item.value, 0) };
}
export function sortWarehouse(items, sort = "priority") {
  return [...items].sort((a, b) => {
    if (sort === "value") return b.value - a.value || a.name.localeCompare(b.name, "ru");
    if (sort === "deficit") return b.deficit * b.unitCost - a.deficit * a.unitCost || a.name.localeCompare(b.name, "ru");
    if (sort === "name") return a.name.localeCompare(b.name, "ru");
    return STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.deficit * b.unitCost - a.deficit * a.unitCost || a.name.localeCompare(b.name, "ru");
  });
}
export function computeWarehousePurchase(form) {
  const quantity = warehouseNumber(form.quantity);
  const price = form.price.trim() ? warehouseNumber(form.price) : 0;
  const purchaseUnit = form.purchaseUnit;
  const unit = purchaseUnit === "kg" ? "g" : purchaseUnit === "l" ? "ml" : ["g", "ml", "pcs"].includes(purchaseUnit) ? purchaseUnit : form.unit;
  const packaged = ["box", "pack", "bottle"].includes(purchaseUnit) && purchaseUnit !== unit;
  const perPackage = warehouseNumber(form.unitsPerPackage), perPiece = warehouseNumber(form.basePerUnit);
  const multiplier = purchaseUnit === "kg" || purchaseUnit === "l" ? 1000 : packaged ? perPackage * perPiece : 1;
  const amount = quantity * multiplier;
  const minimum = form.minimum.trim() ? warehouseNumber(form.minimum) : 0;
  const error = !form.name.trim() ? "Введите название сырья" : !Number.isFinite(quantity) || quantity <= 0 ? "Введите количество закупки больше нуля" : packaged && (!Number.isFinite(perPackage) || perPackage <= 0 || !Number.isFinite(perPiece) || perPiece <= 0) ? "Проверьте количество в упаковке и вес или объём одной штуки" : !Number.isFinite(amount) || amount <= 0 ? "Проверьте количество закупки" : !Number.isFinite(price) || price < 0 ? "Введите неотрицательную стоимость закупки" : !Number.isFinite(minimum) || minimum < 0 ? "Минимальный остаток не может быть отрицательным" : "";
  return { quantity: amount, unit, unitCost: amount > 0 ? price / amount : 0, price, minimum, multiplier, packaged, error };
}
export const warehouseDate = (value, withTime = false) => {
  if (!value) return "Дата не указана";
  const raw = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("ru-RU", { day: "numeric", month: "short", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }) : "Дата не указана";
};
export function warehouseMovement(movement) {
  const type = movement.movementType || movement.movement_type || "";
  const reason = String(movement.reason || "");
  const quantity = Math.abs(num(movement.quantity));
  // Inventory gains and shortages are both stored as positive quantities.
  const direction = !quantity ? 0 : type === "in" || type === "inventory" && /излиш/i.test(reason) ? 1 : ["out", "writeoff", "sale"].includes(type) || type === "inventory" && /недост/i.test(reason) ? -1 : 0;
  const label = { in: "Приход", out: "Расход", writeoff: "Списание", sale: "Продажа", inventory: "Пересчёт", delete: "Удаление" }[type] || type || "Движение";
  return { type, direction, quantity, label };
}
