import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleChat, handleLookup } from '../../../server/claudeChat.ts';
const usage = { input_tokens: 100, output_tokens: 50, input_tokens_details: { cached_tokens: 0 } };
function response(text: string) { return new Response([{ type: 'response.output_text.delta', delta: text }, { type: 'response.completed', response: { status: 'completed', usage } }].map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')); }
function http(url: string, data: unknown) {
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(data))]), { method: 'POST', url, headers: { 'content-type': 'application/json' } }) as IncomingMessage;
  const out = { status: 0, text: '' }; const emitter = new EventEmitter();
  const res = Object.assign(emitter, { writableEnded: false, writeHead(n: number) { out.status = n; }, flushHeaders() {}, write(s: string) { out.text += s; }, end(s = '') { out.text += s; res.writableEnded = true; } }) as unknown as ServerResponse;
  return { req, res, out };
}
afterEach(() => vi.unstubAllGlobals());
describe('HTTP-level API integration, offline upstream', () => {
  it('all four routes reach the key transport, return usable results and record independent costs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mugi-api-http-')); writeFileSync(join(root, '.env.local'), 'OPENAI_API_KEY=FAKE-API-HTTP\n');
    const samples: Record<string, unknown> = {
      mugi_reply: { segments: [{ lang: 'ja', text: 'こんにちは。', gloss: '你好。' }], tip: '', tipLevel: 'N5', tone: 'greet' },
      mugi_judge: { ok: true, feedback: '回答正確。' },
      mugi_tip: { tip: '表達想做某事可用 <ja>〜たい</ja>。' },
      mugi_lookup: { items: [{ ja: 'こんにちは', zh: '你好', level: 'N5', note: '' }], grammar: [], examples: [{ ja: 'こんにちは。', zh: '你好。' }], message: '' },
    };
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => { expect(init.headers).toMatchObject({ Authorization: 'Bearer FAKE-API-HTTP' }); const b = JSON.parse(init.body as string); return response(JSON.stringify(samples[b.text.format.name])); });
    vi.stubGlobal('fetch', fetcher);
    const routing = { providers: ['openai-api'] };
    const chat = http('/', { ...routing, messages: [{ role: 'user', content: '你好' }], role: 'Mugi', mode: 'teacher', context: {} });
    await handleChat(chat.req, chat.res, root, 'test'); expect(chat.out.status).toBe(200); expect(chat.out.text).toContain('"type":"done"'); expect(chat.out.text).toContain('こんにちは'); expect(chat.out.text).toContain('"provider":"openai-api"');
    const judge = http('/judge', { ...routing, target: 'こんにちは', said: 'こんにちは' }); await handleChat(judge.req, judge.res, root, 'test'); expect(judge.out.status).toBe(200); expect(JSON.parse(judge.out.text)).toMatchObject({ ok: true });
    const tip = http('/fix-tip', { ...routing, tip: '希望はたいを使います。' }); await handleChat(tip.req, tip.res, root, 'test'); expect(tip.out.status).toBe(200); expect(JSON.parse(tip.out.text)).toMatchObject({ ok: true, provider: 'openai-api' });
    const lookup = http('/', { ...routing, q: 'こんにちは' }); await handleLookup(lookup.req, lookup.res, root, 'test'); expect(lookup.out.status).toBe(200); expect(JSON.parse(lookup.out.text)).toMatchObject({ ok: true, provider: 'openai-api', answer: { items: [{ zh: '你好' }] } });
    expect(fetcher).toHaveBeenCalledTimes(4);
    const ledger = JSON.parse(readFileSync(join(root, '.usage/openai-api.json'), 'utf8')); expect(ledger.entries).toHaveLength(4); expect(ledger.entries.every((e: { estimated: boolean; costUsd: number }) => !e.estimated && e.costUsd > 0)).toBe(true);
    expect(JSON.stringify(ledger)).not.toContain('FAKE-API-HTTP');
  });
  it('a mixed API fallback list is rejected before upstream is called', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); const req = http('/', { providers: ['openai', 'openai-api'], messages: [{ role: 'user', content: 'hi' }], role: 'Mugi', mode: 'teacher', context: {} });
    await handleChat(req.req, req.res, tmpdir(), 'test'); expect(req.out.status).toBe(400); expect(fetcher).not.toHaveBeenCalled();
  });
});
