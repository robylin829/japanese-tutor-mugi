// API-key transport and durable budget ledger, independent of ChatGPT account credentials.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadEnv } from 'vite';
import { OpenAIError, openaiProvider } from '../llm/openaiProvider.ts';
import type { LlmChatRequest, LlmCompleteRequest, LlmProvider, LlmResult } from '../llm/provider.ts';

export const API_MODEL = 'gpt-5.4-mini';
export const API_MODELS = [API_MODEL, 'gpt-5.4-mini-2026-03-17'];
type Usage = NonNullable<LlmResult['openaiUsage']>;
type RecordEntry = { day: string; model: string; feature: string; costUsd: number; estimated: boolean; error: boolean; usage?: Usage };
type Ledger = { version: 1; entries: RecordEntry[] };
export const taipeiDay = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
export function validUsage(u: unknown): u is Usage {
  if (!u || typeof u !== 'object') return false;
  const x = u as Usage; const cached = x.input_tokens_details?.cached_tokens ?? 0;
  return finite(x.input_tokens) && finite(x.output_tokens) && finite(cached) && cached <= x.input_tokens;
}
// USD / 1M tokens. Source: official gpt-5.4-mini model page, verified 2026-11-04.
export function apiCost(u: Usage): number {
  const cached = u.input_tokens_details?.cached_tokens ?? 0;
  return ((u.input_tokens - cached) * 0.75 + cached * 0.075 + u.output_tokens * 4.5) / 1e6;
}
export class ApiLedger {
  private data: Ledger = { version: 1, entries: [] };
  private broken = false;
  readonly file: string;
  private now: () => Date;
  constructor(file: string, now: () => Date = () => new Date()) {
    this.file = file; this.now = now;
    if (!existsSync(file)) return;
    try {
      const d = JSON.parse(readFileSync(file, 'utf8')) as Ledger;
      if (d.version !== 1 || !Array.isArray(d.entries) || !d.entries.every((e) => e && /^\d{4}-\d{2}-\d{2}$/.test(e.day) && typeof e.model === 'string' && typeof e.feature === 'string' && finite(e.costUsd) && typeof e.estimated === 'boolean' && typeof e.error === 'boolean' && (e.usage === undefined || validUsage(e.usage)))) throw new Error();
      this.data = d;
    } catch { this.broken = true; }
  }
  private check() { if (this.broken) throw new OpenAIError('OpenAI API 用量紀錄損壞或無法寫入，已停止付費請求。請在電腦上修復 .usage/openai-api.json 後重啟。', { status: 503 }); }
  private save() {
    this.check();
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch { this.broken = true; this.check(); }
  }
  status() {
    this.check();
    const day = taipeiDay(this.now()); const entries = this.data.entries.filter((e) => e.day === day);
    return { day, spentTodayUsd: entries.reduce((n, e) => n + e.costUsd, 0), requests: entries.length, errors: entries.filter((e) => e.error).length, estimatedRequests: entries.filter((e) => e.estimated).length,
      inputTokens: entries.reduce((n, e) => n + (e.usage?.input_tokens ?? 0), 0), cachedInputTokens: entries.reduce((n, e) => n + (e.usage?.input_tokens_details?.cached_tokens ?? 0), 0), outputTokens: entries.reduce((n, e) => n + (e.usage?.output_tokens ?? 0), 0) };
  }
  reserve(req: LlmChatRequest | LlmCompleteRequest, cap: number) {
    this.check();
    if (!API_MODELS.includes(req.model)) throw new OpenAIError('OpenAI API 模型未列入支援與計價清單。', { status: 400 });
    // UTF-8 bytes bound input tokens conservatively; full output allocation is reserved, including reasoning.
    const reserved = apiCost({ input_tokens: Buffer.byteLength(JSON.stringify(req), 'utf8') + 1024, output_tokens: req.max_tokens });
    if (this.status().spentTodayUsd + reserved > cap + 1e-12) throw new OpenAIError('OpenAI API 今日預算不足（含進行中的預留額度），請至設定查看或手動切換服務。', { status: 429 });
    const entry: RecordEntry = { day: taipeiDay(this.now()), model: req.model, feature: req.schemaName ?? 'mugi_reply', costUsd: reserved, estimated: true, error: false };
    this.data.entries.push(entry); this.save();
    let done = false;
    return (result?: LlmResult, error?: unknown) => {
      if (done) return; done = true;
      entry.error = !!error;
      if (validUsage(result?.openaiUsage)) { entry.usage = result.openaiUsage; entry.costUsd = apiCost(result.openaiUsage); entry.estimated = false; }
      else if (error instanceof OpenAIError && [400, 401, 403, 404, 429].includes(error.status ?? 0)) { entry.costUsd = 0; entry.estimated = false; }
      this.save();
    };
  }
}
const stores = new Map<string, ApiLedger>();
export function apiLedger(root: string): ApiLedger {
  const file = join(root, '.usage', 'openai-api.json');
  if (!stores.has(file)) stores.set(file, new ApiLedger(file));
  return stores.get(file)!;
}
export function apiSettings(root: string, mode: string) {
  const env = loadEnv(mode, root, '');
  const raw = env.MUGI_OPENAI_DAILY_USD;
  const usd = raw === undefined || raw.trim() === '' ? 2 : Number(raw);
  return { key: env.OPENAI_API_KEY || '', model: env.OPENAI_API_MODEL || API_MODEL, usd: Number.isFinite(usd) && usd >= 0 && usd <= 100 ? usd : 2 };
}
export function apiStatus(root: string, mode: string) {
  const s = apiSettings(root, mode);
  try { return { configured: !!s.key, model: s.model, usd: s.usd, models: API_MODELS, ...apiLedger(root).status() }; }
  catch { return { configured: !!s.key, model: s.model, usd: s.usd, models: API_MODELS, error: 'OpenAI API 用量紀錄損壞或無法寫入，請修復後重啟。' }; }
}
export function describeApiError(e: unknown) {
  if (e instanceof OpenAIError) {
    const status = e.timeout ? 504 : e.status ?? 502;
    const message = status === 401 || status === 403 ? 'OpenAI API 驗證失敗，請在電腦上檢查 API key 與權限。'
      : status === 429 ? 'OpenAI API 額度、速率或今日預算不足，請查看設定；不會自動切換服務。'
      : status === 400 || status === 404 ? 'OpenAI API 模型或請求不受支援，請檢查 API 模型設定。'
      : status === 503 && e.message.includes('用量紀錄') ? e.message : 'OpenAI API 回覆失敗或未完成，請稍後重試；可手動切換服務。';
    return { status, message };
  }
  return { status: 502, message: 'OpenAI API 連線失敗，請稍後重試；可手動切換服務。' };
}
export function apiProvider(key: string, ledger: ApiLedger, cap: number, fetcher: typeof fetch = fetch): LlmProvider {
  const raw = openaiProvider(async (path, init) => {
    const res = await fetcher(`https://api.openai.com/v1${path}`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' }, ...init });
    if (!res.ok) throw new OpenAIError('OpenAI API request failed', { status: res.status });
    return res;
  }, true);
  return {
    id: 'openai-api', describeError: describeApiError,
    streamChat(req, onDelta) {
      // An async boundary keeps reservation failures in stream.done, where the route catches them.
      let stream: ReturnType<LlmProvider['streamChat']> | undefined; let aborted = false;
      const done = (async () => {
        const finish = ledger.reserve(req, cap);
        try { stream = raw.streamChat(req, onDelta); if (aborted) stream.abort(); const result = await stream.done; finish(result); return result; }
        catch (e) { finish(undefined, e); throw e; }
      })();
      return { done, abort: () => { aborted = true; stream?.abort(); }, usageSoFar: () => undefined };
    },
    async complete(req, opts) {
      const finish = ledger.reserve(req, cap);
      try { const result = await raw.complete(req, opts); finish(result); return result; }
      catch (e) { finish(undefined, e); throw e; }
    },
  };
}
