// Локальная дата в формате YYYY-MM-DD (НЕ UTC). new Date(...).toISOString()
// на «локальной полуночи» уезжает на день назад в поясах UTC+, из-за чего
// пресет «Этот месяц» терял последний день месяца. Здесь вычитаем смещение,
// чтобы срез .slice(0,10) давал именно локальную календарную дату.
export const localISO = (d = new Date()) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

// Час начала рабочего дня точки (во сколько открывается кофейня). Гидратируется в
// App.jsx из /settings/business-day и хранится в модульной переменной, чтобы все
// пресеты дат («сегодня», «этот месяц») считали день так же, как бэкенд (сдвиг -N ч).
let _dayStartHour = 0;
export const setDayStartHour = (h) => {
  const n = Number(h);
  _dayStartHour = Number.isFinite(n) && n >= 0 && n <= 23 ? Math.trunc(n) : 0;
};
export const getDayStartHour = () => _dayStartHour;

// Дата РАБОЧЕГО дня в формате YYYY-MM-DD: сдвигаем момент на -N часов, тогда
// продажа в 00:30 у кофейни с началом дня 09:00 попадёт во вчерашний рабочий день —
// ровно как date(created_at,'localtime','-N hours') на бэкенде.
export const businessISO = (d = new Date()) =>
  localISO(new Date(d.getTime() - _dayStartHour * 3600000));

export const num = (value) => {
  if (value === null || value === undefined || value === "") return 0;
  return Number(String(value).replace(/\s/g, "").replace(",", ".")) || 0;
};

export const money = (value) => Number(value || 0);

// Безопасный массив: избавляет от повторяющегося `Array.isArray(x) ? x : []` перед .map/.reduce.
export const asArray = (v) => (Array.isArray(v) ? v : []);

// Целые числа показываем без копеек (300, а не 300,00),
// дробные — до 2 знаков без хвостовых нулей (0,06; 120,5).
export const formatMoney = (value) =>
  money(value).toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });