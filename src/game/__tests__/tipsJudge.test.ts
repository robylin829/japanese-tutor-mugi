import { afterEach, describe, expect, it, vi } from 'vitest';
import { judgeSaid } from '../tipsJudge';

describe('judgeSaid', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a loose match is decided locally, with no network call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await judgeSaid('学校に行きました。', '学校に行きました！');
    expect(r).toEqual({ ok: true, feedback: '完全正確！', by: 'local' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a different sentence goes to /api/chat/judge and returns its verdict', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: false, feedback: '「に」換成「へ」也可以，但這句要用「に」' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await judgeSaid('学校に行きました', '学校へ行きました');
    expect(r).toEqual({ ok: false, feedback: '「に」換成「へ」也可以，但這句要用「に」', by: 'claude' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/chat/judge');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ target: '学校に行きました', said: '学校へ行きました' });
  });

  it('an accepted answer from Claude is ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, feedback: '很棒！' }), { status: 200 })));
    expect(await judgeSaid('はい、そうです', 'うん、そうです')).toEqual({ ok: true, feedback: '很棒！', by: 'claude' });
  });

  it('network error → not ok, with the unreachable message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const r = await judgeSaid('学校に行きました', '学校へ行きました');
    expect(r).toEqual({ ok: false, feedback: '目前選擇的 AI 服務無法判斷，請檢查設定或手動切換服務。', by: 'none' });
  });

  it('503 (no key) → not ok, unreachable message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"no_key"}', { status: 503 })));
    const r = await judgeSaid('学校に行きました', '学校へ行きました');
    expect(r.ok).toBe(false);
    expect(r.by).toBe('none');
  });

  it('a malformed response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));
    const r = await judgeSaid('学校に行きました', '学校へ行きました');
    expect(r).toEqual({ ok: false, feedback: '目前選擇的 AI 服務無法判斷，請檢查設定或手動切換服務。', by: 'none' });
  });
});
