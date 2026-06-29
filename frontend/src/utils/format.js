export const num = (value) => {
  if (value === null || value === undefined || value === "") return 0;
  return Number(String(value).replace(/\s/g, "").replace(",", ".")) || 0;
};

export const money = (value) => Number(value || 0);

// Целые числа показываем без копеек (300, а не 300,00),
// дробные — до 2 знаков без хвостовых нулей (0,06; 120,5).
export const formatMoney = (value) =>
  money(value).toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });