import { apiFetch } from './apiFetch';
export type OpenaiApiStatus = { configured: boolean; model: string; models: string[]; usd: number; spentTodayUsd?: number; day?: string; requests?: number; errors?: number; estimatedRequests?: number; inputTokens?: number; cachedInputTokens?: number; outputTokens?: number; error?: string };
export async function fetchOpenaiApiStatus(): Promise<OpenaiApiStatus | null> {
  try { const r = await apiFetch('/api/settings/openai-api'); if (!r.ok) return null; const s = await r.json(); return typeof s.configured === 'boolean' && typeof s.usd === 'number' && Array.isArray(s.models) ? s : null; } catch { return null; }
}
export async function saveOpenaiApiBudget(usd: number): Promise<{ ok: boolean; message: string }> {
  try { const r = await apiFetch('/api/settings/openai-api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usd }) }); const s = await r.json(); return { ok: r.ok, message: r.ok ? '已儲存' : s.message || '無法儲存' }; } catch { return { ok: false, message: '連不上伺服器' }; }
}
