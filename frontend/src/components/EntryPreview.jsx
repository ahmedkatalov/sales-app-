import { useCallback, useState } from 'react';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import LoginPage from '../pages/LoginPage';
import WorkspaceSelectPage from '../pages/WorkspaceSelectPage';
import EntryLayout from './EntryLayout';
import { profilePreviewPoints } from '../profile-preview-data';

const demoSession = { accountId: 900100, username: 'noor.demo', role: 'worker' };
const noPersist = () => {};

export default function EntryPreview({ page, scenario, themeControl }) {
  const [stage, setStage] = useState(page === 'workspace' ? 'workspace' : 'login');
  const [selected, setSelected] = useState(null);
  const [pendingStore] = useState(() => {
    let pending = ['otp', 'restored', 'expired-code', 'invalid-response'].includes(scenario) ? { username: 'noor.demo', maskedEmail: 'n***@example.com', sentAt: Date.now() - (scenario === 'restored' ? 70000 : 0) } : null;
    return { read: () => pending, save: value => { pending = value; }, clear: () => { pending = null; } };
  });
  const request = useCallback(async (path, body) => {
    if (path.endsWith('/request')) {
      if (scenario === 'request-error') throw new Error('Failed to fetch');
      if (scenario === 'rate-limit') throw new Error('429 too many requests');
      return { maskedEmail: 'n***@example.com' };
    }
    if (scenario === 'expired-code') throw new Error('Код истёк');
    if (body.code !== '123456') throw new Error('Неверный код');
    return scenario === 'invalid-response' ? {} : demoSession;
  }, [scenario]);
  const [loadWorkspaces] = useState(() => {
    let reads = 0;
    return async () => {
      reads += 1;
      if (scenario === 'load-error' && reads === 1) throw new Error('Не удалось соединиться с сервером. Повторите загрузку.');
      if (scenario === 'empty') return [];
      if (scenario === 'invalid-points') return [{ id: 1, name: 'Неполные данные' }];
      const points = profilePreviewPoints.map((p, i) => ({ ...p, role: i === 1 ? 'branch_admin' : 'worker' }));
      if (scenario === 'single') return [points[0]];
      if (scenario === 'long-name') points[0].name = 'Кофейня на набережной · Большое рабочее пространство с очень длинным названием';
      return points;
    };
  });
  const choose = useCallback(point => {
    if (scenario === 'select-error') throw new Error('Не удалось открыть точку. Повторите попытку.');
    setSelected(point); setStage('done');
  }, [scenario]);
  if (stage === 'done') return <EntryLayout workspace stage={3} themeControl={themeControl}><section className="entry-card entry-complete backdrop-blur-xl" role="status"><CheckCircle2 size={30} /><h1>Точка готова к работе</h1><p className="entry-copy">{selected?.name}</p><p className="entry-note">Это демонстрация: вход и выбор точки не изменили ваш аккаунт.</p><button type="button" className="entry-text-button" onClick={() => setStage('workspace')}><ArrowLeft size={16} />Вернуться к выбору</button></section></EntryLayout>;
  if (stage === 'workspace') return <WorkspaceSelectPage session={demoSession} loadWorkspaces={loadWorkspaces} persistWorkspace={noPersist} onSelect={choose} onLogout={() => setStage('login')} themeControl={themeControl} />;
  return <LoginPage onAuth={() => setStage('workspace')} request={request} pendingStore={pendingStore} themeControl={themeControl} />;
}
