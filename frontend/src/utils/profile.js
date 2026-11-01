export const DEFAULT_WORKER_PAGES = ['/pos', '/pending-payments', '/debts', '/expenses'];
export function profileRole(role) { return role === 'owner' ? 'Владелец' : role === 'branch_admin' || role === 'admin' ? 'Администратор' : 'Кассир'; }
export function profileInitials(name) { return String(name || '?').trim().split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase(); }
export function profilePages(records, user) {
  const record = records.find(p => String(p.userId) === String(user.id || user.userId) && String(p.workspaceId) === String(user.workspaceId || 0));
  if (!record) return [...DEFAULT_WORKER_PAGES];
  let pages = record.pages;
  if (typeof pages === 'string') { try { pages = JSON.parse(pages); } catch { return null; } }
  return Array.isArray(pages) && pages.every(p => typeof p === 'string') ? [...new Set(pages)] : null;
}
export function profileMatches(search, ...values) { return values.join(' ').toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru')); }
export function validateProfileList(value) {
  if (!Array.isArray(value) || value.some(row => !row || !row.id)) throw new Error('Сервер вернул неполный список. Обновите данные.');
  return value;
}
export function validateProfileSetting(path, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Настройки не удалось прочитать.');
  if (path === '/settings/business-day' && (!Number.isInteger(value.dayStartHour) || value.dayStartHour < 0 || value.dayStartHour > 23)) throw new Error('Не удалось прочитать начало рабочего дня.');
  if (path === '/online-orders/key' && (typeof value.key !== 'string' || !value.key)) throw new Error('Ключ не получен. Повторите загрузку.');
  if (path === '/settings/ai' && (typeof value.model !== 'string' || typeof value.baseUrl !== 'string' || typeof value.hasKey !== 'boolean')) throw new Error('Получены неполные настройки ИИ.');
  return value;
}
