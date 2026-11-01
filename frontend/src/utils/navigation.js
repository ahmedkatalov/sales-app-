import { BarChart3, Bot, Briefcase, Clock3, FileText, Landmark, LayoutDashboard, Package, Palette, ReceiptText, Settings, ShoppingCart, Users, Wallet } from 'lucide-react';
export const OWNER_LINKS = [
  ['/home', 'Сводка', LayoutDashboard], ['/work', 'Товары', Briefcase], ['/pos', 'Касса', ShoppingCart], ['/pending-payments', 'К оплате', Clock3, 'pending'], ['/debts', 'Долги', FileText, 'debt'], ['/expenses', 'Расходы', Wallet], ['/ai-warehouse', 'Помощник', Bot], ['/warehouse', 'Склад', Package], ['/sales-analytics', 'Продажи', ReceiptText], ['/team', 'Сотрудники', Users], ['/analytics', 'Аналитика', BarChart3], ['/finance', 'Отчёт', Landmark], ['/appearance', 'Оформление', Palette], ['/profile', 'Настройки', Settings],
];
export const WORKER_LINKS = OWNER_LINKS.filter(([path]) => ['/pos', '/pending-payments', '/debts', '/expenses'].includes(path));
export const RESTRICTED_LINKS = OWNER_LINKS.filter(([path]) => ['/pos', '/pending-payments', '/debts', '/expenses', '/work', '/ai-warehouse', '/warehouse', '/sales-analytics', '/analytics'].includes(path));
const GROUPS = [
  { id: 'work', title: 'Работа', paths: ['/home', '/work', '/pos', '/pending-payments', '/debts', '/expenses', '/ai-warehouse', '/warehouse'] },
  { id: 'reports', title: 'Отчёты', paths: ['/sales-analytics', '/team', '/analytics', '/finance'] },
  { id: 'account', title: 'Управление', paths: ['/appearance', '/profile'] },
];
export function navigationGroups(links, query = '') {
  const search = query.trim().toLocaleLowerCase('ru');
  const matching = links.filter(([, label]) => label.toLocaleLowerCase('ru').includes(search));
  const groups = GROUPS.map(group => ({ ...group, links: matching.filter(([path]) => group.paths.includes(path)) })).filter(group => group.links.length);
  const extra = matching.filter(([path]) => !GROUPS.some(g => g.paths.includes(path)));
  return extra.length ? [...groups, { id: 'other', title: 'Другие разделы', links: extra }] : groups;
}
export function mobileNavigation(links, worker = false) {
  const paths = worker ? ['/pos', '/pending-payments', '/expenses'] : ['/home', '/pos', '/pending-payments'];
  const preferred = paths.flatMap(path => links.filter(([to]) => to === path));
  const primary = [...preferred, ...links.filter(([to]) => !paths.includes(to))].slice(0, 3);
  return { primary, more: links.filter(([to]) => !primary.some(([path]) => path === to)) };
}
export const navigationRole = role => role === 'owner' ? 'Владелец' : ['branch_admin', 'admin'].includes(role) ? 'Администратор' : 'Кассир';
export const navigationCount = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : 0;
export const sameWorkspace = (a, b) => !!a && !!b && String(a.id) === String(b.id) && String(a.dataAccountId) === String(b.dataAccountId);
export function validateNavigationWorkspaces(list) {
  if (!Array.isArray(list) || list.some(w => !w || !w.id || !w.dataAccountId || typeof w.name !== 'string')) throw new Error('Не удалось прочитать список точек. Повторите загрузку.');
  if (new Set(list.map(w => `${w.id}:${w.dataAccountId}`)).size !== list.length) throw new Error('Список точек содержит повторяющиеся записи. Обновите его.');
  return list;
}

export function navigationDebtCount(customers) {
  if (!Array.isArray(customers) || customers.some(c => c?.debtTotal === null || c?.debtTotal === undefined || !Number.isFinite(Number(c.debtTotal)))) throw new Error('Не получены остатки долгов.');
  return customers.filter(c => Number(c.debtTotal) > .005).length;
}
