import { money, num } from "./format";

// Единицы измерения и себестоимость — общие для Кассы, Склада, Товаров, AI-помощника.
export const UNIT_LABELS = { g: "г", kg: "кг", ml: "мл", l: "л", pcs: "шт", bottle: "бут", pack: "упак", box: "кор" };
export const CONTAINER_UNITS = ["box", "pack", "bottle"];
export const unitLabel = (unit) => UNIT_LABELS[unit] || unit || "";

// Себестоимость единицы хранения склада: прямой unit_cost, иначе цена/количество.
export const getWarehouseUnitCost = (item) => {
  const direct = item?.unitCost ?? item?.unit_cost ?? item?.costPerUnit ?? item?.cost_per_unit;
  if (direct !== undefined && direct !== null && Number(direct) > 0) {
    return money(direct);
  }
  const totalPrice = money(item?.price || item?.purchasePrice || 0);
  const quantity = num(item?.initialQuantity || item?.quantity || 0);
  if (!quantity) return 0;
  return totalPrice / quantity;
};
