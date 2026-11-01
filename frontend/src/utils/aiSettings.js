export const AI_PROVIDERS = [
  { id: 'odirouter', name: 'OdiRouter', baseUrl: 'https://api.odirouter.ai/v1', docs: 'https://odirouter.ai/docs/integrations/overview' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', docs: 'https://openrouter.ai/docs' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { id: 'custom', name: 'Другой совместимый API', baseUrl: '' },
];
export function normalizeAIBase(value) {
  let url;
  try { url = new URL(value.trim().replace(/\/+$/, '')); } catch { throw new Error('Укажите корректный API-адрес.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Укажите API-адрес http:// или https:// без ключа и параметров.');
  if (/\/(chat\/completions|models|responses)$/.test(url.pathname)) throw new Error('Нужен базовый API-адрес, без /chat/completions, /models или /responses.');
  return url.toString().replace(/\/+$/, '');
}
export const inferAIProvider = base => AI_PROVIDERS.find(p => p.baseUrl === (base || '').replace(/\/+$/, ''))?.id || 'custom';
export function aiDraft(settings) {
  const baseUrl = settings.baseUrl || AI_PROVIDERS.find(p => p.id === settings.provider)?.baseUrl || AI_PROVIDERS.find(p => p.id === 'openai').baseUrl;
  return { provider: inferAIProvider(baseUrl), baseUrl, model: settings.model || '', apiKey: '' };
}
export function aiSettingsPayload(fields, saved, needModel = true) {
  const payload = { provider: fields.provider, baseUrl: normalizeAIBase(fields.baseUrl), model: fields.model.trim(), apiKey: fields.apiKey.trim() };
  if (needModel && (!payload.model || /\s/.test(payload.model) || payload.model.length > 250)) throw new Error('Укажите точный ID модели из каталога.');
  if (!payload.apiKey && (!saved?.hasKey || payload.baseUrl !== normalizeAIBase(saved.baseUrl))) throw new Error('Введите API-ключ выбранного провайдера.');
  if (/[\r\n…]|••/.test(payload.apiKey)) throw new Error('Введите полный API-ключ, а не маску.');
  return payload;
}
