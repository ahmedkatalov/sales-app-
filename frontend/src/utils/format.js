// Локальная дата в формате YYYY-MM-DD (НЕ UTC). new Date(...).toISOString()
// на «локальной полуночи» уезжает на день назад в поясах UTC+, из-за чего
// пресет «Этот месяц» терял последний день месяца. Здесь вычитаем смещение,
// чтобы срез .slice(0,10) давал именно локальную календарную дату.
export const localISO = (d = new Date()) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

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