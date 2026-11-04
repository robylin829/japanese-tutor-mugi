import { testCleanup } from '../../testCleanup.ts';
// The trusted rule (server/settingsAccess.ts) and the settings routes (server/settingsRoutes.ts) with a temp .env.local:
// the keys status shows last four characters only, the full key never appears in any response, the budget is validated and
// formatted, and a request that is not trusted is refused (403) and changes nothing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { trustedForSettings, SETTINGS_REFUSED_MESSAGE } from '../../../server/settingsAccess.ts';
import { BUDGET_ZERO_REMOTE_MESSAGE, KEYS_LOCAL_ONLY_MESSAGE, formatUsd, handleSettingsApi, keysStatus, parseBudget, type SettingsDeps } from '../../../server/settingsRoutes.ts';
import type { GuardOptions } from '../../../server/apiGuard.ts';

// ---------------------------------------------------------------- helpers

// the connection's address: a loopback address is this PC (or the Tailscale Serve proxy on it); a LAN device has its own address
const PC_SOCKET = { remoteAddress: '127.0.0.1' };
const LAN_SOCKET = { remoteAddress: '192.168.1.20' };

function fakeReq(url: string, method: string, headers: Record<string, string>, body?: unknown, remote: string = PC_SOCKET.remoteAddress): IncomingMessage {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]) as unknown as IncomingMessage;
  Object.assign(req, { url, method, headers: { 'content-type': 'application/json', ...headers }, socket: { remoteAddress: remote } });
  return req;
}

/** the trusted rule with the PC's socket (a test that needs a LAN socket calls trustedForSettings directly) */
const trusted = (headers: Record<string, string>, opts?: GuardOptions) => trustedForSettings({ headers, socket: PC_SOCKET }, opts);

function fakeRes() {
  const out = { status: 0, headers: {} as Record<string, string>, body: '' };
  const res = {
    writeHead(status: number, h?: Record<string, string>) { out.status = status; Object.assign(out.headers, h ?? {}); return res; },
    end(d?: string) { out.body = d ?? ''; return res; },
  };
  return { res: res as unknown as ServerResponse, out, json: () => JSON.parse(out.body) as Record<string, unknown> };
}

let dir = '';
let envPath = '';
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mugi-settings-'));
  envPath = path.join(dir, '.env.local');
});
afterEach(() => {
  testCleanup(dir, { recursive: true, force: true });
});

const LOCAL = { host: '127.0.0.1:3004' };
const TAILSCALE = { host: 'mypc.tailnet.ts.net' };
const LAN_IP = { host: '192.168.1.20:3004' };

function deps(over: Partial<SettingsDeps> = {}): SettingsDeps {
  return {
    envPath,
    guard: { allowedHosts: ['mypc.tailnet.ts.net'], lan: true },
    readUsd: () => 2,
    spentTodayUsd: () => 0.31,
    ...over,
  };
}

async function call(method: string, url: string, headers: Record<string, string>, body: unknown, d: SettingsDeps = deps(), remote: string = PC_SOCKET.remoteAddress) {
  const r = fakeRes();
  const handled = await handleSettingsApi(fakeReq(url, method, headers, body, remote), r.res, d);
  return { handled, status: r.out.status, body: r.out.body, json: r.json };
}

// ---------------------------------------------------------------- the trusted rule

describe('trustedForSettings: which requests may change settings', () => {
  const guard = { allowedHosts: ['mypc.tailnet.ts.net', '.example.test'], lan: true };

  it('loopback names are trusted: localhost, 127.0.0.1, [::1] and ::1, with or without a port', () => {
    for (const host of ['localhost:3004', 'LOCALHOST', '127.0.0.1:3004', '[::1]:3004', '[::1]', '::1']) {
      expect(trusted({ host }, guard)).toBe(true);
    }
  });

  it('a name in server.allowedHosts is trusted (the Tailscale Serve name), and a leading-dot entry covers its subdomains', () => {
    expect(trusted({ host: 'mypc.tailnet.ts.net' }, guard)).toBe(true);
    expect(trusted({ host: 'mypc.tailnet.ts.net:443' }, guard)).toBe(true);
    expect(trusted({ host: 'pc.example.test' }, guard)).toBe(true);
    expect(trusted({ host: 'example.test' }, guard)).toBe(true);
  });

  it('an IP address is refused, even when it is in the list or MUGI_LAN is on', () => {
    expect(trusted({ host: '192.168.1.20:3004' }, { lan: true })).toBe(false);
    expect(trusted({ host: '100.64.0.5:3004' }, { lan: true, allowedHosts: ['100.64.0.5'] })).toBe(false);
    expect(trusted({ host: '[2001:db8::1]:3004' }, { lan: true })).toBe(false);
  });

  it('a foreign name, a name that only looks like loopback, and a missing or bad Host are refused', () => {
    expect(trusted({ host: 'rebind.example' }, guard)).toBe(false);
    expect(trusted({ host: 'localhost.evil.example' }, guard)).toBe(false);
    expect(trusted({ host: 'evil-localhost' }, guard)).toBe(false);
    expect(trusted({ host: 'other.tailnet.ts.net' }, guard)).toBe(false);
    expect(trusted({}, guard)).toBe(false);
    expect(trusted({ host: ':3004' }, guard)).toBe(false);
    expect(trusted({ host: '' }, guard)).toBe(false);
  });

  it('a list with no entries trusts only the loopback names', () => {
    expect(trusted({ host: 'mypc.tailnet.ts.net' }, {})).toBe(false);
    expect(trusted({ host: '127.0.0.1:3004' }, {})).toBe(true);
  });

  it('the first Host header wins when the header comes as an array', () => {
    expect(trusted({ host: ['127.0.0.1:3004', 'evil.example'] }, guard)).toBe(true);
  });
});

// ---------------------------------------------------------------- keys status

describe('keysStatus: what is set, never the whole value', () => {
  it('shows the last four characters of a key, the region in full, and nothing for an empty key', () => {
    const s = keysStatus('ANTHROPIC_API_KEY=sk-ant-FAKE-TEST-ab12\r\nAZURE_SPEECH_REGION=eastasia\r\nGOOGLE_TTS_API_KEY=\r\n');
    expect(s.anthropicKey).toEqual({ set: true, last4: 'ab12' });
    expect(s.azureRegion).toEqual({ set: true, value: 'eastasia' });
    expect(s.googleKey).toEqual({ set: false });
    expect(s.azureKey).toEqual({ set: false });
    expect(s.anthropicWorkspace).toEqual({ set: false });
    expect(JSON.stringify(s)).not.toContain('FAKE-TEST');
  });

  it('a value of four characters or fewer has no last four (it would be the whole value)', () => {
    expect(keysStatus('GOOGLE_TTS_API_KEY=abcd\r\n').googleKey).toEqual({ set: true });
    expect(keysStatus('GOOGLE_TTS_API_KEY=abcde\r\n').googleKey).toEqual({ set: true, last4: 'bcde' });
  });
});

describe('GET /api/settings/keys', () => {
  it('returns the status of the file, last four only', async () => {
    fs.writeFileSync(envPath, 'ANTHROPIC_API_KEY=sk-ant-FAKE-TEST-ab12\r\n', 'utf8');
    const r = await call('GET', '/keys', LOCAL, undefined);
    expect(r.status).toBe(200);
    expect(r.json()).toEqual({ status: expect.objectContaining({ anthropicKey: { set: true, last4: 'ab12' } }) });
    expect(r.body).not.toContain('FAKE-TEST');
  });

  it('a missing file reads as nothing set', async () => {
    const r = await call('GET', '/keys', LOCAL, undefined);
    expect(r.status).toBe(200);
    expect((r.json().status as Record<string, unknown>).anthropicKey).toEqual({ set: false });
  });
});

describe('POST /api/settings/keys', () => {
  const FULL = 'sk-ant-FAKE-TEST-zz99';

  it('sets a key from a trusted request, writes it to the file and answers with last four only', async () => {
    const r = await call('POST', '/keys', LOCAL, { anthropicKey: FULL });
    expect(r.status).toBe(200);
    expect(fs.readFileSync(envPath, 'utf8')).toBe(`ANTHROPIC_API_KEY=${FULL}\r\n`);
    expect(r.json()).toEqual({ status: expect.objectContaining({ anthropicKey: { set: true, last4: 'zz99' } }) });
    // the full key is in no response, whichever route answers
    expect(r.body).not.toContain(FULL);
    expect(r.body).not.toContain('FAKE-TEST');
    const g = await call('GET', '/keys', LOCAL, undefined);
    expect(g.body).not.toContain(FULL);
  });

  it('several keys are written from this PC in one request', async () => {
    const r = await call('POST', '/keys', LOCAL, { googleKey: 'goog-key-5555', azureKey: 'azure-key-6666', azureRegion: 'eastasia' });
    expect(r.status).toBe(200);
    const text = fs.readFileSync(envPath, 'utf8');
    expect(text).toContain('GOOGLE_TTS_API_KEY=goog-key-5555');
    expect(text).toContain('AZURE_SPEECH_KEY=azure-key-6666');
    expect(text).toContain('AZURE_SPEECH_REGION=eastasia');
    expect(r.body).not.toContain('goog-key-5555');
    expect(r.body).not.toContain('azure-key-6666');
  });

  it('null clears a key; an absent field is left unchanged', async () => {
    fs.writeFileSync(envPath, 'ANTHROPIC_API_KEY=sk-ant-keep1111\r\nGOOGLE_TTS_API_KEY=goog-clear2222\r\n', 'utf8');
    const r = await call('POST', '/keys', LOCAL, { googleKey: null });
    expect(r.status).toBe(200);
    const text = fs.readFileSync(envPath, 'utf8');
    expect(text).toBe('ANTHROPIC_API_KEY=sk-ant-keep1111\r\n');
    expect(r.json().status).toMatchObject({ googleKey: { set: false }, anthropicKey: { set: true, last4: '1111' } });
  });

  it('a bad value is a 400 with a Chinese message that does not repeat the value; the file is untouched', async () => {
    fs.writeFileSync(envPath, 'ANTHROPIC_API_KEY=sk-ant-keep1111\r\n', 'utf8');
    const r = await call('POST', '/keys', LOCAL, { anthropicKey: 'has space FAKE-TEST-VALUE' });
    expect(r.status).toBe(400);
    expect(r.json()).toMatchObject({ error: 'bad_request' });
    expect(r.body).toMatch(/[一-鿿]/);
    expect(r.body).not.toContain('FAKE-TEST-VALUE');
    expect(fs.readFileSync(envPath, 'utf8')).toBe('ANTHROPIC_API_KEY=sk-ant-keep1111\r\n');
  });

  it('a bad Azure region is a 400 (lower-case letters and digits only)', async () => {
    const r = await call('POST', '/keys', LOCAL, { azureRegion: 'East Asia' });
    expect(r.status).toBe(400);
    expect(fs.existsSync(envPath)).toBe(false);
  });

  it('a field of the wrong type is a 400', async () => {
    expect((await call('POST', '/keys', LOCAL, { anthropicKey: 12345 })).status).toBe(400);
    expect((await call('POST', '/keys', LOCAL, '[1,2]')).status).toBe(400);
    expect((await call('POST', '/keys', LOCAL, 'not json{')).status).toBe(400);
  });

  it('a Tailscale name (a phone) is refused with 403 and writes nothing, though that name may change the budget', async () => {
    const r = await call('POST', '/keys', TAILSCALE, { googleKey: 'goog-key-5555' });
    expect(r.status).toBe(403);
    expect(r.json()).toEqual({ error: 'forbidden', message: KEYS_LOCAL_ONLY_MESSAGE });
    expect(r.body).toContain('金鑰只能在電腦上設定');
    expect(r.body).not.toContain('goog-key-5555');
    expect(fs.existsSync(envPath)).toBe(false);
  });

  it('a request from a raw IP (MUGI_LAN) is refused with 403 and writes nothing', async () => {
    const r = await call('POST', '/keys', LAN_IP, { anthropicKey: 'sk-ant-FAKE-TEST-1234' });
    expect(r.status).toBe(403);
    expect(r.json()).toEqual({ error: 'forbidden', message: KEYS_LOCAL_ONLY_MESSAGE });
    expect(fs.existsSync(envPath)).toBe(false);
  });

  it('an unrelated name is refused too', async () => {
    const r = await call('POST', '/keys', { host: 'attacker.example' }, { anthropicKey: 'sk-ant-x1' });
    expect(r.status).toBe(403);
    expect(fs.existsSync(envPath)).toBe(false);
  });

  it('the status GET of a refused host still works (it shows last four only)', async () => {
    fs.writeFileSync(envPath, 'ANTHROPIC_API_KEY=sk-ant-FAKE-TEST-ab12\r\n', 'utf8');
    const r = await call('GET', '/keys', LAN_IP, undefined);
    expect(r.status).toBe(200);
    expect(r.body).not.toContain('FAKE-TEST');
  });

  it('an unknown path under /api/settings is not handled here', async () => {
    const r = await call('GET', '/nothing', LOCAL, undefined);
    expect(r.handled).toBe(false);
  });
});

// ---------------------------------------------------------------- budget

describe('budget validation and format', () => {
  it('accepts 0 to 100 with at most two decimals, and returns the number rounded to two places', () => {
    expect(parseBudget(0)).toBe(0);
    expect(parseBudget(2)).toBe(2);
    expect(parseBudget(1.5)).toBe(1.5);
    expect(parseBudget(0.25)).toBe(0.25);
    expect(parseBudget(100)).toBe(100);
  });

  it('refuses a number out of range, with decimals beyond two places, or a value that is not a number', () => {
    expect(() => parseBudget(-0.5)).toThrow('0 到 100');
    expect(() => parseBudget(100.5)).toThrow('0 到 100');
    expect(() => parseBudget(1.234)).toThrow('小數點後兩位');
    expect(() => parseBudget('2')).toThrow('請輸入數字');
    expect(() => parseBudget(NaN)).toThrow('請輸入數字');
    expect(() => parseBudget(Infinity)).toThrow('請輸入數字');
    expect(() => parseBudget(undefined)).toThrow('請輸入數字');
  });

  it('formats without trailing zeros: 2, 1.5, 0.25, 0', () => {
    expect(formatUsd(2)).toBe('2');
    expect(formatUsd(1.5)).toBe('1.5');
    expect(formatUsd(0.25)).toBe('0.25');
    expect(formatUsd(0)).toBe('0');
    expect(formatUsd(10)).toBe('10');
  });
});

describe('GET and POST /api/settings/budget', () => {
  it('GET returns the budget and today’s spending from the same reader the cap uses', async () => {
    const r = await call('GET', '/budget', LOCAL, undefined, deps({ readUsd: () => 1.5, spentTodayUsd: () => 0.31 }));
    expect(r.status).toBe(200);
    expect(r.json()).toEqual({ usd: 1.5, spentTodayUsd: 0.31 });
  });

  it('POST writes MUGI_DAILY_USD in the formatted form and answers with the budget', async () => {
    fs.writeFileSync(envPath, 'ANTHROPIC_API_KEY=sk-ant-keep1111\r\n', 'utf8');
    const r = await call('POST', '/budget', LOCAL, { usd: 1.5 });
    expect(r.status).toBe(200);
    expect(fs.readFileSync(envPath, 'utf8')).toBe('ANTHROPIC_API_KEY=sk-ant-keep1111\r\nMUGI_DAILY_USD=1.5\r\n');
    expect(r.json()).toEqual({ usd: 1.5, spentTodayUsd: 0.31 });
  });

  it('POST 0 writes 0 (no cap) and an existing line is replaced in place', async () => {
    fs.writeFileSync(envPath, 'MUGI_DAILY_USD=2\r\nMUGI_LAN=\r\n', 'utf8');
    const r = await call('POST', '/budget', LOCAL, { usd: 0 });
    expect(r.status).toBe(200);
    expect(fs.readFileSync(envPath, 'utf8')).toBe('MUGI_DAILY_USD=0\r\nMUGI_LAN=\r\n');
  });

  it('an invalid budget is a 400 and the file is untouched', async () => {
    fs.writeFileSync(envPath, 'MUGI_DAILY_USD=2\r\n', 'utf8');
    for (const usd of [101, -1, 1.234, '3', null]) {
      const r = await call('POST', '/budget', LOCAL, { usd });
      expect(r.status).toBe(400);
    }
    expect(fs.readFileSync(envPath, 'utf8')).toBe('MUGI_DAILY_USD=2\r\n');
  });

  it('a refused host cannot change the budget (403), and GET still reads it', async () => {
    fs.writeFileSync(envPath, 'MUGI_DAILY_USD=2\r\n', 'utf8');
    const r = await call('POST', '/budget', LAN_IP, { usd: 50 });
    expect(r.status).toBe(403);
    expect(r.json()).toMatchObject({ message: SETTINGS_REFUSED_MESSAGE });
    expect(fs.readFileSync(envPath, 'utf8')).toBe('MUGI_DAILY_USD=2\r\n');
  });
});

// ---------------------------------------------------------------- the budget from a phone (trusted), the keys from a phone (refused)

describe('a phone (Tailscale name) may change the budget but not the keys', () => {
  it('the budget is saved from a trusted Tailscale name, and the file gets MUGI_DAILY_USD', async () => {
    const r = await call('POST', '/budget', TAILSCALE, { usd: 3 });
    expect(r.status).toBe(200);
    expect(r.json()).toEqual({ usd: 3, spentTodayUsd: 0.31 });
    expect(fs.readFileSync(envPath, 'utf8')).toContain('MUGI_DAILY_USD=3');
  });

  it('the keys status is still readable from the phone, with last four only', async () => {
    fs.writeFileSync(envPath, 'ANTHROPIC_API_KEY=sk-ant-FAKE-TEST-ab12\r\n', 'utf8');
    const r = await call('GET', '/keys', TAILSCALE, undefined);
    expect(r.status).toBe(200);
    expect(r.json()).toMatchObject({ status: { anthropicKey: { set: true, last4: 'ab12' } } });
    expect(r.body).not.toContain('FAKE-TEST');
  });

  it('a key written from the phone changes nothing in the file', async () => {
    fs.writeFileSync(envPath, 'ANTHROPIC_API_KEY=sk-ant-keep1111\r\n', 'utf8');
    await call('POST', '/keys', TAILSCALE, { anthropicKey: null });
    expect(fs.readFileSync(envPath, 'utf8')).toBe('ANTHROPIC_API_KEY=sk-ant-keep1111\r\n');
  });
});

// ---------------------------------------------------------------- the connection decides (a LAN device may not change settings)

describe('[已修·高] a LAN device with Host 127.0.0.1 is not the PC: it changes no setting', () => {
  it('a LAN socket is never trusted, whatever the Host says', () => {
    expect(trustedForSettings({ socket: LAN_SOCKET, headers: { host: '127.0.0.1:3004' } }, deps().guard)).toBe(false);
    expect(trustedForSettings({ socket: LAN_SOCKET, headers: { host: 'localhost:3004' } }, deps().guard)).toBe(false);
    expect(trustedForSettings({ socket: LAN_SOCKET, headers: { host: 'mypc.tailnet.ts.net' } }, deps().guard)).toBe(false);
    expect(trustedForSettings({ headers: { host: '127.0.0.1:3004' } }, deps().guard)).toBe(false); // no socket: not this PC
  });

  it('the keys and the budget are refused (403) and the file is untouched', async () => {
    fs.writeFileSync(envPath, 'MUGI_DAILY_USD=2\r\n', 'utf8');
    const keys = await call('POST', '/keys', LOCAL, { anthropicKey: 'sk-ant-FAKE-TEST-lan1' }, deps(), LAN_SOCKET.remoteAddress);
    expect(keys.status).toBe(403);
    expect(keys.json()).toEqual({ error: 'forbidden', message: KEYS_LOCAL_ONLY_MESSAGE });
    const budget = await call('POST', '/budget', LOCAL, { usd: 5 }, deps(), LAN_SOCKET.remoteAddress);
    expect(budget.status).toBe(403);
    expect(budget.json()).toMatchObject({ message: SETTINGS_REFUSED_MESSAGE });
    expect(fs.readFileSync(envPath, 'utf8')).toBe('MUGI_DAILY_USD=2\r\n');
  });

  it('the status GET from a LAN socket still answers, with last four only', async () => {
    fs.writeFileSync(envPath, 'ANTHROPIC_API_KEY=sk-ant-FAKE-TEST-ab12\r\n', 'utf8');
    const r = await call('GET', '/keys', LOCAL, undefined, deps(), LAN_SOCKET.remoteAddress);
    expect(r.status).toBe(200);
    expect(r.json()).toMatchObject({ status: { anthropicKey: { set: true, last4: 'ab12' } } });
  });
});

// ---------------------------------------------------------------- budget 0 (no cap) is the PC's to set

describe('[F2] budget 0 (no daily cap) only from this PC', () => {
  it('a trusted request that is not local (a phone through Tailscale) gets 403 for 0 and the file is untouched', async () => {
    fs.writeFileSync(envPath, 'MUGI_DAILY_USD=2\r\n', 'utf8');
    const r = await call('POST', '/budget', TAILSCALE, { usd: 0 });
    expect(r.status).toBe(403);
    expect(r.json()).toEqual({ error: 'forbidden', message: BUDGET_ZERO_REMOTE_MESSAGE });
    expect(r.body).toContain('每日上限設為 0（不限）只能在電腦上操作');
    expect(fs.readFileSync(envPath, 'utf8')).toBe('MUGI_DAILY_USD=2\r\n');
  });

  it('the phone may still set the smallest and the largest capped values (0.01 and 100)', async () => {
    const low = await call('POST', '/budget', TAILSCALE, { usd: 0.01 });
    expect(low.status).toBe(200);
    expect(fs.readFileSync(envPath, 'utf8')).toBe('MUGI_DAILY_USD=0.01\r\n');
    const high = await call('POST', '/budget', TAILSCALE, { usd: 100 });
    expect(high.status).toBe(200);
    expect(fs.readFileSync(envPath, 'utf8')).toBe('MUGI_DAILY_USD=100\r\n');
  });

  it('from this PC, 0 stays allowed', async () => {
    const r = await call('POST', '/budget', LOCAL, { usd: 0 });
    expect(r.status).toBe(200);
    expect(fs.readFileSync(envPath, 'utf8')).toBe('MUGI_DAILY_USD=0\r\n');
  });

  it('an invalid value from the phone is still a 400, not the 0 message', async () => {
    const r = await call('POST', '/budget', TAILSCALE, { usd: 101 });
    expect(r.status).toBe(400);
  });
});
