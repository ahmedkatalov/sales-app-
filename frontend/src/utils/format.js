export const num = (value) => {
  if (value === null || value === undefined || value === "") return 0;
  return Number(String(value).replace(/\s/g, "").replace(",", ".")) || 0;
};

export const money = (value) => Number(value || 0);

export const formatMoney = (value) =>
  money(value).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });