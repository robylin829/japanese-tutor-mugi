import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleServerControl, managedServer } from '../../../server/serverControl.ts';
function http(method = 'GET', host = '127.0.0.1:3004', body: unknown = { action: 'stop' }, remoteAddress = '127.0.0.1', more: Record<string, string> = {}) {
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { method, headers: { host, 'content-type': 'application/json', ...more }, socket: { remoteAddress } }) as unknown as IncomingMessage;
  const out = { status: 0, text: '' }; const res = { writeHead(n: number) { out.status = n; }, end(s: string) { out.text = s; } } as unknown as ServerResponse;
  return { req, res, out };
}
afterEach(() => vi.unstubAllEnvs());
describe('actual server shutdown controls', () => {
  it('only marks a Start-Mugi process with this PID and root as managed; handles UTF-8 BOM', () => {
    const root = mkdtempSync(join(tmpdir(), 'mugi-managed-')); mkdirSync(join(root, '.local-run'));
    const file = join(root, '.local-run/server.json'); writeFileSync(file, '\uFEFF' + JSON.stringify({ pid: process.pid, root }));
    vi.stubEnv('MUGI_MANAGED_SERVER', '1'); expect(managedServer(root)).toBe(true);
    writeFileSync(file, JSON.stringify({ pid: process.pid + 1, root })); expect(managedServer(root)).toBe(false);
    writeFileSync(file, JSON.stringify({ pid: process.pid, root: join(root, 'other') })); expect(managedServer(root)).toBe(false);
    vi.stubEnv('MUGI_MANAGED_SERVER', ''); expect(managedServer(root)).toBe(false);
  });
  it('responds before scheduling shutdown; reading status never shuts down', async () => {
    const stop = vi.fn(async () => {}); let run: (() => void) | undefined;
    const deps = { canStop: () => true, stop, schedule: (callback: () => void) => { run = callback; } };
    const get = http(); await handleServerControl(get.req, get.res, {}, deps); expect(JSON.parse(get.out.text)).toEqual({ running: true, canStop: true }); expect(stop).not.toHaveBeenCalled();
    const post = http('POST'); await handleServerControl(post.req, post.res, {}, deps); expect(post.out.status).toBe(200); expect(JSON.parse(post.out.text).stopping).toBe(true); expect(stop).not.toHaveBeenCalled();
    run!(); await Promise.resolve(); expect(stop).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['pc.tail.ts.net', '127.0.0.1', {}],
    ['127.0.0.1:3004', '192.168.1.2', {}],
    ['127.0.0.1:3004', '127.0.0.1', { 'sec-fetch-site': 'cross-site' }],
  ] as const)('refuses a phone, remote socket or cross-site shutdown', async (host, remote, headers) => {
    const stop = vi.fn(async () => {}); const post = http('POST', host, { action: 'stop' }, remote, headers);
    await handleServerControl(post.req, post.res, { allowedHosts: ['pc.tail.ts.net'] }, { canStop: () => true, stop });
    expect(post.out.status).toBe(403); expect(stop).not.toHaveBeenCalled();
  });
  it('refuses unmanaged servers and malformed commands', async () => {
    const stop = vi.fn(async () => {}); const unmanaged = http('POST');
    await handleServerControl(unmanaged.req, unmanaged.res, {}, { canStop: () => false, stop }); expect(unmanaged.out.status).toBe(409);
    const invalid = http('POST', '127.0.0.1:3004', { action: 'delete' }); await handleServerControl(invalid.req, invalid.res, {}, { canStop: () => true, stop }); expect(invalid.out.status).toBe(400); expect(stop).not.toHaveBeenCalled();
  });
});
