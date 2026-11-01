import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from '../api';
import { validateProfileList, validateProfileSetting } from './profile';

export default function useProfileResource(path, dataAccountId, enabled = true, list = true) {
  const [state, setState] = useState({ data: null, loading: enabled, error: '' });
  const sequence = useRef(0);
  const reload = useCallback(async () => {
    if (!enabled) return false;
    const seq = ++sequence.current;
    setState(s => ({ ...s, loading: true, error: '' }));
    try {
      const response = await get(path, { dataAccountId });
      const data = list ? validateProfileList(response) : validateProfileSetting(path, response);
      if (seq !== sequence.current) return false;
      setState({ data, loading: false, error: '' }); return true;
    } catch (e) {
      if (seq === sequence.current) setState(s => ({ ...s, loading: false, error: e.message || 'Не удалось загрузить данные.' }));
      return false;
    }
  }, [path, dataAccountId, enabled, list]);
  const invalidate = useCallback(() => { sequence.current += 1; }, []);
  useEffect(() => { reload(); return invalidate; }, [reload, invalidate]);
  return { ...state, reload, ready: state.data !== null && !state.error && !state.loading };
}
