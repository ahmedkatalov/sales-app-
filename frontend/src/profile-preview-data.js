export const profilePreviewPoints = [
  { id: 1, accountId: 900100, dataAccountId: 900101, name: 'Noor Coffee · Центр', isMain: true },
  { id: 2, accountId: 900100, dataAccountId: 900102, name: 'Noor Coffee · Парк', isMain: false },
  { id: 3, accountId: 900100, dataAccountId: 900103, name: 'Noor Coffee · Набережная', isMain: false },
];
export const profilePreviewSession = { accountId: 900100, ownerAccountId: 900100, username: 'noor.owner', ownerName: 'Анна Миронова', role: 'owner' };
const seedUsers = [
  { id: 11, workspaceId: 1, dataAccountId: 900101, username: 'center.admin', workspaceName: profilePreviewPoints[0].name, role: 'branch_admin' },
  { id: 12, workspaceId: 1, dataAccountId: 900101, username: 'center.cashier', workspaceName: profilePreviewPoints[0].name, role: 'worker' },
  { id: 13, workspaceId: 2, dataAccountId: 900102, username: 'park.cashier', workspaceName: profilePreviewPoints[1].name, role: 'worker' },
  { id: 14, workspaceId: 3, dataAccountId: 900103, username: 'river.admin', workspaceName: profilePreviewPoints[2].name, role: 'branch_admin' },
];
let scenario = 'normal', reads = {}, mutated = false, nextId = 100, points, users, employees, cards, access, permissions, hours, key, ai;
export function setProfilePreviewScenario(value) {
  scenario = value; reads = {}; mutated = false; nextId = 100; points = structuredClone(profilePreviewPoints); users = structuredClone(seedUsers);
  employees = { 900101: [{ id: 21, name: 'Алина', hasPassword: false }, { id: 22, name: 'Михаил', hasPassword: true }, { id: 23, name: 'София', hasPassword: false }], 900102: [{ id: 24, name: 'Продавец парка', hasPassword: false }], 900103: [{ id: 25, name: 'Екатерина', hasPassword: true }] };
  cards = { 900101: [{ id: 31, name: 'Сбер · Основная', owner: 'Анна Миронова' }, { id: 32, name: 'Т-Банк · Закупки', owner: 'Noor Coffee' }], 900102: [], 900103: [] };
  access = [{ id: 41, userId: 11, username: 'center.admin', workspaceId: 2, workspaceName: points[1].name, role: 'branch_admin' }];
  permissions = [{ id: 51, userId: 12, workspaceId: 1, pages: JSON.stringify(['/pos', '/pending-payments', '/debts', '/expenses']) }, { id: 52, userId: 13, workspaceId: 2, pages: JSON.stringify(['/pos', '/pending-payments', '/warehouse']) }];
  hours = { 900101: 6, 900102: 9, 900103: 8 }; key = 'demo_order_key_not_a_real_credential'; ai = { provider: 'odirouter', model: 'demo-vision-model', baseUrl: 'https://api.odirouter.ai/v1', hasKey: true, keyMasked: 'demo…0000', scope: 'server' };
  if (value === 'empty') { users = []; employees = {}; cards = {}; access = []; permissions = []; }
  if (value === 'invalid') permissions[0].pages = '{broken-demo-json';
}
setProfilePreviewScenario('normal');
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
export function profilePreviewResponse(url, options = {}) {
  const location = new URL(window.location.href);
  if (location.searchParams.get('page') !== 'profile' && location.pathname !== '/profile') return null;
  const parsed = new URL(url, location.origin), path = parsed.pathname.replace(/^\/api/, ''), method = options.method || 'GET';
  const dataId = Number(options.headers?.['X-Data-Account-ID'] || parsed.searchParams.get('accountId') || 900101);
  const body = JSON.parse(options.body || '{}');
  if (method === 'GET') {
    reads[path] = (reads[path] || 0) + 1;
    if (scenario === 'load-error' || scenario === 'refresh-error' && mutated || scenario === 'settings-error' && path.startsWith('/settings/') || scenario === 'managed-error' && path === '/employees' && dataId === 900102) return json({ error: 'Демонстрационный сбой загрузки. Попробуйте ещё раз.' }, 503);
    if (path === '/employees') return json(employees[dataId] || []);
    if (path === '/workspace-users') return json(users);
    if (path === '/workspaces') return json(points);
    if (path === '/workspace-access') return json(access);
    if (path === '/user-permissions') return json(permissions);
    if (path === '/cards') return json(cards[dataId] || []);
    if (path === '/settings/business-day') return json({ dayStartHour: hours[dataId] || 0 });
    if (path === '/online-orders/key') return json({ key });
    if (path === '/settings/ai') return json(ai);
  }
  if (scenario === 'save-error') return json({ error: 'Демо: изменения не сохранены. Повторите попытку.' }, 503);
  if (method === 'POST' && /\/employees\/\d+\/verify$/.test(path)) return json({ ok: body.password === 'demo', error: body.password === 'demo' ? '' : 'Неверный пароль' });
  if (method === 'POST' && path === '/settings/ai/test') return body.apiKey === 'demo-invalid-key' ? json({ok:false,error:'Демо: провайдер отклонил API-ключ.'}) : json({ ok: true, model: body.model || ai.model });
  if (method === 'POST' && path === '/settings/ai/models') return body.apiKey === 'demo-invalid-key' ? json({error:'Демо: провайдер отклонил API-ключ.'},502) : json({models:[{id:'demo-vision-model',name:'Модель для текста и фото · демо',contextLength:200000,vision:true},{id:'demo-fast-model',name:'Быстрая текстовая модель · демо',contextLength:128000,vision:false}],total:2,page:1,hasMore:false});
  mutated = true;
  if (method === 'PUT' && path === '/account') return json({ ok: true, name: body.name });
  if (method === 'PUT' && path === '/settings/business-day') { hours[dataId] = body.dayStartHour; return json({ ok: true, dayStartHour: body.dayStartHour }); }
  if (method === 'PUT' && path === '/settings/ai') { ai = { ...ai, provider: body.provider, model: body.model, baseUrl: body.baseUrl, hasKey: ai.hasKey || !!body.apiKey }; return json({ ok: true }); }
  if (method === 'POST' && path === '/online-orders/key/rotate') { key = 'demo_rotated_key_not_a_real_credential'; return json({ key }); }
  if (method === 'POST' && path === '/workspaces') { const point = { id: ++nextId, accountId: 900100, dataAccountId: 900000 + nextId, name: body.name, isMain: false }; points.push(point); return json(point); }
  if (method === 'POST' && path === '/workspace-users') { const point = points.find(p => p.id === body.workspaceId); const user = { id: ++nextId, workspaceId: body.workspaceId, workspaceName: point?.name, dataAccountId: point?.dataAccountId, username: body.username, role: body.role }; users.push(user); return json(user); }
  if (method === 'POST' && path === '/employees') { const employee = { id: ++nextId, name: body.name, hasPassword: !!body.password }; employees[dataId] = [...employees[dataId] || [], employee]; return json(employee); }
  if (method === 'POST' && path === '/cards') { const card = { id: ++nextId, name: body.name, owner: body.owner }; cards[dataId] = [...cards[dataId] || [], card]; return json(card); }
  if (method === 'POST' && path === '/workspace-access') { const point = points.find(p => p.id === body.workspaceId), user = users.find(u => u.id === body.userId); access = access.filter(a => a.userId !== body.userId || a.workspaceId !== body.workspaceId); const row = { ...body, id: ++nextId, username: user?.username, workspaceName: point?.name }; access.push(row); return json(row); }
  if (method === 'PUT' && path.startsWith('/user-permissions/')) { const userId = Number(path.split('/').at(-1)); const row = { id: ++nextId, userId, workspaceId: body.workspaceId, pages: body.pages }; permissions = permissions.filter(p => p.userId !== userId || p.workspaceId !== body.workspaceId); permissions.push(row); return json(row); }
  if (method === 'DELETE') {
    const id = Number(path.split('/').at(-1));
    if (path.startsWith('/employees/')) employees[dataId] = (employees[dataId] || []).filter(e => e.id !== id);
    else if (path.startsWith('/cards/')) cards[dataId] = (cards[dataId] || []).filter(c => c.id !== id);
    else if (path.startsWith('/workspace-users/')) users = users.filter(u => u.id !== id);
    else if (path.startsWith('/workspace-access/')) access = access.filter(a => a.id !== id);
    else return json({ error: 'Недоступно в демо' }, 400);
    return json({ ok: true });
  }
  return json({ error: 'Этот запрос недоступен в демонстрации настроек.' }, 400);
}
