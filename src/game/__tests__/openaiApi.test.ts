import { createChatGpt } from '../../../server/openai/service.ts';
import { PLAN_SCOPE, type OAuth } from '../../../server/openai/oauth.ts';
import type { CredentialStore } from '../../../server/openai/credentials.ts';
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { API_MODEL, ApiLedger, apiCost, apiProvider, apiSettings, taipeiDay } from '../../../server/openai/api.ts';
import { handleApiSettings } from '../../../server/openai/apiRoutes.ts';
import { handleSettingsApi } from '../../../server/settingsRoutes.ts';
import { parseRouting } from '../../../server/aiChain.ts';
import { servicesFor, CHAT_REPLY_SCHEMA, JUDGE_SCHEMA, TIP_FIX_SCHEMA, LOOKUP_SCHEMA } from '../../../server/claudeChat.ts';
import { collectStream } from '../../../server/llm/openaiProvider.ts';
import type { LlmCompleteRequest } from '../../../server/llm/provider.ts';
import { DEFAULT_TUTOR, aiServicesOf, migrateTutor } from '../tutor';

// All fixtures are fake and their temporary folders are intentionally retained for inspection.
const folder = () => mkdtempSync(join(tmpdir(), 'mugi-api-test-'));
const request = (schema = CHAT_REPLY_SCHEMA, name = 'mugi_reply'): LlmCompleteRequest => ({ model: API_MODEL, max_tokens: 2000, system: '日語家教', messages: [{ role: 'user', content: 'こんにちは' }], output_config: { format: { type: 'json_schema', schema } }, schemaName: name });
const usage = { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 500 } };
function reply(text = '{"ok":true}', withUsage = true) {
  const list = [{ type: 'response.output_text.delta', delta: text }, { type: 'response.completed', response: { model: API_MODEL, status: 'completed', ...(withUsage ? { usage } : {}) } }];
  const bytes = new TextEncoder().encode(list.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''));
  return new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 3) c.enqueue(bytes.slice(i, i + 3)); c.close(); } }));
}
function fakeHttp(path: string, method = 'GET', host = '127.0.0.1:3004', body?: unknown) {
  const req = Object.assign(Readable.from(body === undefined ? [] : [JSON.stringify(body)]), { url: path, method, headers: { host, 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' } }) as unknown as IncomingMessage;
  const out = { status: 0, text: '' };
  const res = { writeHead(n: number) { out.status = n; }, end(s: string) { out.text = s; } } as unknown as ServerResponse;
  return { req, res, out };
}
describe('durable API budget', () => {
  it('charges cached input separately', () => { expect(apiCost(usage)).toBeCloseTo((500 * .75 + 500 * .075 + 100 * 4.5) / 1e6, 12); });
  it('reserves before a second request; settlement is idempotent and survives restart', () => {
    const file = join(folder(), 'usage.json'); const ledger = new ApiLedger(file);
    const finish = ledger.reserve(request(), 2); const held = ledger.status().spentTodayUsd;
    expect(() => ledger.reserve(request(), held * 1.5)).toThrow('預算不足');
    expect(new ApiLedger(file).status().spentTodayUsd).toBe(held);
    finish({ text: '{}', openaiUsage: usage }); finish({ text: '{}', openaiUsage: usage });
    expect(new ApiLedger(file).status()).toMatchObject({ requests: 1, estimatedRequests: 0, spentTodayUsd: apiCost(usage), cachedInputTokens: 500 });
  });
  it('retains reservation when a stream ends without usage, including after restart', () => {
    const file = join(folder(), 'usage.json'); const ledger = new ApiLedger(file); const finish = ledger.reserve(request(), 2); const held = ledger.status().spentTodayUsd;
    finish(undefined, new Error('dropped')); expect(new ApiLedger(file).status()).toMatchObject({ errors: 1, estimatedRequests: 1, spentTodayUsd: held });
  });
  it('uses Taipei midnight and attributes settlement to the request day', () => {
    let now = new Date('2026-11-04T15:59:59Z'); const ledger = new ApiLedger(join(folder(), 'usage.json'), () => now);
    const finish = ledger.reserve(request(), 2); now = new Date('2026-11-04T16:00:00Z'); finish({ text: '{}', openaiUsage: usage });
    expect(taipeiDay(now)).toBe('2026-11-05'); expect(ledger.status().spentTodayUsd).toBe(0);
  });
  it.each(['not json', '{"version":1,"entries":[{"costUsd":-1}]}', '{"version":2,"entries":[]}'])('refuses a broken ledger without overwriting it: %s', (content) => {
    const file = join(folder(), 'usage.json'); writeFileSync(file, content); const ledger = new ApiLedger(file);
    expect(() => ledger.reserve(request(), 2)).toThrow('用量紀錄損壞'); expect(readFileSync(file, 'utf8')).toBe(content);
  });
  it('refuses unpriced models and paused budgets before fetch', async () => {
    const fetcher = vi.fn(async () => reply()); const ledger = new ApiLedger(join(folder(), 'usage.json')); const p = apiProvider('FAKE-KEY', ledger, 0, fetcher);
    await expect(p.complete(request())).rejects.toThrow('預算不足'); expect(fetcher).not.toHaveBeenCalled();
    expect(() => ledger.reserve({ ...request(), model: 'unpriced' }, 2)).toThrow('支援與計價');
  });
});
describe('API transport and four AI jobs', () => {
  it.each([[CHAT_REPLY_SCHEMA, 'mugi_reply'], [JUDGE_SCHEMA, 'mugi_judge'], [TIP_FIX_SCHEMA, 'mugi_tip'], [LOOKUP_SCHEMA, 'mugi_lookup']] as const)('sends a strict schema and records usage: %s', async (schema, name) => {
    const fetcher = vi.fn(async () => reply()); const ledger = new ApiLedger(join(folder(), 'usage.json')); const p = apiProvider('FAKE-API-KEY', ledger, 2, fetcher);
    await expect(p.complete(request(schema, name))).resolves.toMatchObject({ text: '{"ok":true}' });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]; const body = JSON.parse(init.body as string);
    expect(url).toBe('https://api.openai.com/v1/responses'); expect(init.headers).toMatchObject({ Authorization: 'Bearer FAKE-API-KEY' });
    expect(body).toMatchObject({ store: false, stream: true, reasoning: { effort: 'none' }, text: { format: { strict: true, name, schema } } });
    expect(JSON.stringify(body)).not.toContain('FAKE-API-KEY'); expect(ledger.status().spentTodayUsd).toBe(apiCost(usage));
  });
  it.each([400, 401, 403, 404, 429, 500])('sanitizes HTTP %s and never retries', async (status) => {
    const fetcher = vi.fn(async () => new Response('SECRET key echoed by upstream', { status })); const ledger = new ApiLedger(join(folder(), 'usage.json')); const p = apiProvider('SECRET', ledger, 2, fetcher);
    const error = await p.complete(request()).catch((e: unknown) => e); const described = p.describeError(error);
    expect(described.message).not.toContain('SECRET'); expect(described.message).not.toContain('重新登入 ChatGPT'); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(ledger.status().errors).toBe(1); if (status < 500) expect(ledger.status().spentTodayUsd).toBe(0);
  });
  it('handles UTF-8 split bytes and delivers stream deltas', async () => {
    const ledger = new ApiLedger(join(folder(), 'usage.json')); const p = apiProvider('FAKE', ledger, 2, async () => reply('{"ja":"日本語你好"}'));
    const delta = vi.fn(); await expect(p.streamChat(request(), delta).done).resolves.toMatchObject({ text: '{"ja":"日本語你好"}' }); expect(delta).toHaveBeenCalledWith('{"ja":"日本語你好"}');
  });
  it('does not treat invalid JSON or refusals as successful completion', async () => {
    const p = apiProvider('FAKE', new ApiLedger(join(folder(), 'usage.json')), 2, async () => reply('bad json'));
    await expect(p.complete(request())).rejects.toThrow('格式');
    const refused = new Response('data: {"type":"response.refusal.delta","delta":"no"}\n\n');
    await expect(collectStream(refused.body, () => {})).rejects.toThrow('拒絕');
  });
  it('cancels upstream on abort and keeps a conservative reservation', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))); }));
    const ledger = new ApiLedger(join(folder(), 'usage.json')); const p = apiProvider('FAKE', ledger, 2, fetcher); const s = p.streamChat(request(), () => {}); s.abort();
    await expect(s.done).rejects.toThrow(); expect(ledger.status().estimatedRequests).toBe(1);
  });
});
describe('routing, settings and migration', () => {
  it('API is opt-in and never part of a mixed fallback list', () => {
    expect(parseRouting({}).providers).toEqual(['openai']);
    expect(() => parseRouting({ providers: ['openai', 'openai-api'] })).toThrow();
    expect(aiServicesOf({ ...DEFAULT_TUTOR, providers: ['openai', 'anthropic'] }).providers).toEqual(['openai']);
  });
  it('needs an API key but no OAuth account; an OAuth failure never creates an API service', async () => {
    const root = folder(); writeFileSync(join(root, '.env.local'), 'OPENAI_API_KEY=FAKE-KEY\n');
    const api = await servicesFor({ providers: ['openai-api'] }, { root, mode: 'test', chatgpt: null }); expect(api.services.map((s) => s.id)).toEqual(['openai-api']);
    expect((await servicesFor({ providers: ['openai'] }, { root, mode: 'test', chatgpt: null })).services).toEqual([]);
    expect((await servicesFor({ providers: ['openai-api'] }, { root: folder(), mode: 'test', chatgpt: null })).services).toEqual([]);
  });
  it('preserves learning settings while migrating Claude defaults; keeps new API choice and separate model', () => {
    const old = migrateTutor({ ...DEFAULT_TUTOR, aiModeVersion: undefined, providers: ['anthropic'], sttLang: 'zh-TW' });
    expect(old).toMatchObject({ providers: ['openai'], sttLang: 'zh-TW', characters: DEFAULT_TUTOR.characters });
    const saved = migrateTutor({ ...old, providers: ['openai-api'], openaiModel: 'oauth-model', openaiApiModel: API_MODEL });
    expect(saved).toMatchObject({ providers: ['openai-api'], openaiModel: 'oauth-model', openaiApiModel: API_MODEL });
  });
  it('reads default $2 and API model without OAuth data', () => { expect(apiSettings(folder(), 'test')).toMatchObject({ key: '', model: API_MODEL, usd: 2 }); });
  it('local key writes return only last4; a phone key write is rejected', async () => {
    const root = folder(); const deps = { envPath: join(root, '.env.local'), guard: { allowedHosts: ['pc.tail.ts.net'] }, readUsd: () => 2, spentTodayUsd: () => 0 };
    const local = fakeHttp('/keys', 'POST', '127.0.0.1:3004', { openaiApiKey: 'FAKE-KEY-1234' }); await handleSettingsApi(local.req, local.res, deps);
    expect(local.out.status).toBe(200); expect(local.out.text).not.toContain('FAKE-KEY'); expect(JSON.parse(local.out.text).status.openaiApiKey).toEqual({ set: true, last4: '1234' });
    const remote = fakeHttp('/keys', 'POST', 'pc.tail.ts.net', { openaiApiKey: null }); await handleSettingsApi(remote.req, remote.res, deps); expect(remote.out.status).toBe(403);
    expect(readFileSync(deps.envPath, 'utf8')).toContain('FAKE-KEY-1234');
  });
  it('phone can read API usage but cannot change its budget', async () => {
    const root = folder(); const remote = fakeHttp('/openai-api', 'POST', 'pc.tail.ts.net', { usd: 0 }); await handleApiSettings(remote.req, remote.res, root, 'test', { allowedHosts: ['pc.tail.ts.net'] }); expect(remote.out.status).toBe(403);
    const get = fakeHttp('/openai-api', 'GET', 'pc.tail.ts.net'); await handleApiSettings(get.req, get.res, root, 'test', {}); expect(JSON.parse(get.out.text)).toMatchObject({ configured: false, usd: 2, spentTodayUsd: 0 });
  });
});

describe('account and API credentials remain independent', () => {
  it('clearing the API key does not log out; account logout does not remove the API key', async () => {
    const root = folder(); const envPath = join(root, '.env.local');
    writeFileSync(envPath, 'OPENAI_API_KEY=FAKE-KEY-1234\n');
    const store: CredentialStore = { data: { v: 1, hostId: 'test', account: { client_id: 'test-client', subject: 'test-user', email: '', name: '', scopes: [PLAN_SCOPE], expiresAt: Date.now() + 3600000, access_token: 'FAKE-OAUTH-TOKEN' } }, save: vi.fn() };
    const oauth = { revoke: async () => true } as unknown as OAuth;
    const account = createChatGpt({ store, oauth });
    const clear = fakeHttp('/keys', 'POST', '127.0.0.1:3004', { openaiApiKey: null });
    await handleSettingsApi(clear.req, clear.res, { envPath, guard: {}, readUsd: () => 2, spentTodayUsd: () => 0 });
    expect(clear.out.status).toBe(200); expect(account.ready()).toBe(true);
    writeFileSync(envPath, 'OPENAI_API_KEY=FAKE-KEY-1234\n');
    await account.logout(); expect(account.ready()).toBe(false); expect(readFileSync(envPath, 'utf8')).toContain('FAKE-KEY-1234');
  });
  it('a nearly exhausted $2 daily budget refuses before the transport is called', async () => {
    const file = join(folder(), 'usage.json');
    writeFileSync(file, JSON.stringify({ version: 1, entries: [{ day: taipeiDay(new Date()), model: API_MODEL, feature: 'mugi_reply', costUsd: 1.999, estimated: false, error: false }] }));
    const fetcher = vi.fn(async () => reply()); const p = apiProvider('FAKE', new ApiLedger(file), 2, fetcher);
    await expect(p.streamChat(request(), () => {}).done).rejects.toThrow('預算不足'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('a timeout cancels an already opened response stream, without losing its reservation', async () => {
    vi.useFakeTimers();
    try {
      const cancel = vi.fn(); const ledger = new ApiLedger(join(folder(), 'usage.json'));
      const p = apiProvider('FAKE', ledger, 2, async () => new Response(new ReadableStream({ cancel })));
      const outcome = p.complete(request(), { timeout: 30000 }).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(30000);
      expect(await outcome).toMatchObject({ timeout: true }); expect(cancel).toHaveBeenCalled(); expect(ledger.status().estimatedRequests).toBe(1);
    } finally { vi.useRealTimers(); }
  });
});
