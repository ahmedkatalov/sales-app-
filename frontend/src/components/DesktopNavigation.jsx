import { Link } from 'react-router-dom';
import { ChevronDown, Search } from 'lucide-react';
import { navigationCount, navigationGroups } from '../utils/navigation';
const identity = path => path;
export function NavigationBadge({ kind, pendingCount, debtCount }) {
  const count = navigationCount(kind === 'pending' ? pendingCount : kind === 'debt' ? debtCount : 0);
  return count ? <span className={`sh-badge ${kind === 'debt' ? 'is-debt' : ''}`} aria-label={`${kind === 'pending' ? 'К оплате' : 'Долги'}: ${count}`}>{count > 99 ? '99+' : count}</span> : null;
}
export function NavigationItem({ item, currentPath, resolvePath = identity, onNavigate, pendingCount, debtCount, compact = false }) {
  const [to, label, Icon, badge] = item;
  const count = navigationCount(badge === 'pending' ? pendingCount : badge === 'debt' ? debtCount : 0);
  const description = count ? `${badge === 'debt' ? 'Клиентов с долгом' : 'Чеков к оплате'}: ${count}` : undefined;
  return <Link to={resolvePath(to)} data-nav-path={to} className={`sh-nav-item ${compact ? 'is-compact' : ''}`} aria-current={currentPath === to ? 'page' : undefined} aria-label={label} aria-description={description} title={compact ? label : undefined} onClick={onNavigate}><span className="sh-nav-icon"><Icon size={18} /></span><span className="sh-nav-label">{label}</span><NavigationBadge kind={badge} pendingCount={pendingCount} debtCount={debtCount} /></Link>;
}
export function NavigationGroups({ links, query, compact, ...props }) {
  return <>{navigationGroups(links, query).map(group => <div className="sh-nav-group" data-nav-group={group.id} key={group.id}><p>{group.title}</p>{group.links.map(item => <NavigationItem key={item[0]} item={item} compact={compact} {...props} />)}</div>)}</>;
}
export default function DesktopNavigation({ links, currentPath, resolvePath, onOpenMenu, pendingCount, debtCount, worker }) {
  const order = worker ? ['/pos', '/pending-payments', '/expenses'] : ['/home', '/work', '/pos', '/pending-payments'];
  const primary = order.flatMap(path => links.filter(([to]) => to === path));
  return <nav className="sh-top-links" aria-label="Верхняя навигация">{primary.map(item => <NavigationItem key={item[0]} item={item} currentPath={currentPath} resolvePath={resolvePath} pendingCount={pendingCount} debtCount={debtCount} />)}<button type="button" className={`sh-all-sections ${!primary.some(([path]) => path === currentPath) ? 'is-active' : ''}`} onClick={onOpenMenu} aria-haspopup="dialog"><Search size={16} />Все разделы<ChevronDown size={13} /></button></nav>;
}
