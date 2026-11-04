import { testCleanup } from '../testCleanup.ts';
// QA: .env.local writes and budget/keys validation (server/envFile.ts, server/settingsRoutes.ts), in temp folders only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyEnvUpdates, readEnvValue, updateEnvFile } from '../../server/envFile';
import { handleSettingsApi, keysStatus, parseBudget, formatUsd, type SettingsDeps } from '../../server/settingsRoutes';
import { trustedForSettings } from '../../server/settingsAccess';
import type { GuardOptions } from '../../server/apiGuard';
import { parseDailyUsd, parseChatPerMinute } from '../../server/claudeChat';

/** the trusted rule for a request that comes over a loopback socket (this PC) */
const trusted = (headers: Record<string, string>, opts: GuardOptions) => trustedForSettings({ headers, socket: { remoteAddress: '127.0.0.1' } }, opts);

let dir: string;
let envPath: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mugi-qa-env-')); envPath = path.join(dir, '.env.local'); });
afterEach(() => testCleanup(dir, { recursive: true, force: true }));

const KEY = 'sk-ant-FAKE-TEST-abcd1234';

describe('applyEnvUpdates keeps the rest of the file', () => {
  it('LF file: other lines, comments and order are kept; the key is replaced in place', () => {
    const src = '# top\nFOO=1\nANTHROPIC_API_KEY=old1234\n# end\n';
    expect(applyEnvUpdates(src, { ANTHROPIC_API_KEY: 'new5678' })).toBe('# top\nFOO=1\nANTHROPIC_API_KEY=new5678\n# end\n');
  });
  it('CRLF file stays CRLF, and a new key is appended with CRLF', () => {
    expect(applyEnvUpdates('FOO=1\r\nBAR=2\r\n', { MUGI_DAILY_USD: '2' })).toBe('FOO=1\r\nBAR=2\r\nMUGI_DAILY_USD=2\r\n');
  });
  it('a last line without a newline gets one before the appended key', () => {
    expect(applyEnvUpdates('FOO=1', { MUGI_DAILY_USD: '3' })).toBe('FOO=1\r\nMUGI_DAILY_USD=3\r\n');
  });
  it('a BOM at the start is kept', () => {
    const out = applyEnvUpdates('﻿FOO=1\n', { MUGI_DAILY_USD: '3' });
    expect(out.startsWith('﻿FOO=1')).toBe(true);
    expect(out).toContain('MUGI_DAILY_USD=3');
  });
  it('null removes every line that sets the key', () => {
    expect(applyEnvUpdates('A=1\nANTHROPIC_API_KEY=x\nANTHROPIC_API_KEY=y\n', { ANTHROPIC_API_KEY: null })).toBe('A=1\n');
  });
  it('a key written with spaces around = is replaced, not duplicated', () => {
    const out = applyEnvUpdates('ANTHROPIC_API_KEY = oldvalue1234\n', { ANTHROPIC_API_KEY: KEY });
    const lines = out.split(/\r?\n/).filter((l) => l.includes('ANTHROPIC_API_KEY'));
    expect(lines).toEqual([`ANTHROPIC_API_KEY=${KEY}`]);
  });
  it('a quoted value (KEY="...") shows its last four key characters, not the quote', () => {
    expect(keysStatus('ANTHROPIC_API_KEY="sk-ant-xx-QWER"\n').anthropicKey.last4).toBe('QWER');
  });
  it('a value with = or # or a space is refused', () => {
    expect(() => applyEnvUpdates('', { ANTHROPIC_API_KEY: 'a=b' })).toThrow();
    expect(() => applyEnvUpdates('', { ANTHROPIC_API_KEY: 'a#b' })).toThrow();
    expect(() => applyEnvUpdates('', { ANTHROPIC_API_KEY: 'a b' })).toThrow();
  });
  it('a name outside the six keys is refused', () => {
    expect(() => applyEnvUpdates('', { VOICEVOX_URL: 'http://x' } as never)).toThrow();
  });
  it('the region is lower-case letters and digits only', () => {
    expect(() => applyEnvUpdates('', { AZURE_SPEECH_REGION: 'East-Asia' })).toThrow();
    expect(applyEnvUpdates('', { AZURE_SPEECH_REGION: 'eastasia' })).toContain('AZURE_SPEECH_REGION=eastasia');
  });
});

describe('updateEnvFile on disk', () => {
  it('a missing file is created with the key only', () => {
    updateEnvFile(envPath, { MUGI_DAILY_USD: '2' });
    expect(fs.readFileSync(envPath, 'utf8')).toBe('MUGI_DAILY_USD=2\r\n');
  });
  it('a failed write (folder missing) throws a Chinese message and leaves no temp file', () => {
    const missing = path.join(dir, 'nope', '.env.local');
    expect(() => updateEnvFile(missing, { MUGI_DAILY_USD: '2' })).toThrow(/無法寫入/);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

describe('budget (MUGI_DAILY_USD)', () => {
  it.each([[0, 0], [100, 100], [2, 2], [1.5, 1.5], [0.25, 0.25]])('accepts %s', (input, expected) => {
    expect(parseBudget(input)).toBe(expected);
  });
  it.each([[100.01], [-0.01], [-1], [2.555], ['2'], ['2.555'], [null], [NaN], [Infinity], [undefined]])('refuses %s', (input) => {
    expect(() => parseBudget(input)).toThrow();
  });
  it('the value written has no trailing zeros', () => {
    expect(formatUsd(parseBudget(2.5))).toBe('2.5');
    expect(formatUsd(0)).toBe('0');
  });
  it('the server reads a hand-edited budget above 100 as is (the route refuses it)', () => {
    expect(parseDailyUsd('100.01')).toBe(100.01);
  });
  it('the server reads a hand-edited "2.555" as is (the route refuses it)', () => {
    expect(parseDailyUsd('2.555')).toBe(2.555);
  });
  it('parseChatPerMinute: decimals and negatives fall back to the default', () => {
    expect(parseChatPerMinute('2.5')).toBe(20);
    expect(parseChatPerMinute('-1')).toBe(20);
    expect(parseChatPerMinute('0')).toBe(0);
  });
});

describe('settings routes (temp .env.local)', () => {
  const deps = (): SettingsDeps => ({ envPath, guard: { allowedHosts: [] }, readUsd: () => 2, spentTodayUsd: () => 0 });
  const req = (url: string, method: string, body?: unknown, host = 'localhost:3110'): IncomingMessage => {
    const r = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage;
    Object.assign(r, { url, method, headers: { host, 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' } });
    return r;
  };
  const res = () => {
    const out = { status: 0, body: '' };
    const r = { writeHead: (s: number) => { out.status = s; }, end: (b: string) => { out.body = b; } } as unknown as ServerResponse;
    return { r, out };
  };

  it('POST keys writes and answers last4 only; the full key is in no response', async () => {
    const { r, out } = res();
    await handleSettingsApi(req('/keys', 'POST', { anthropicKey: KEY }), r, deps());
    expect(out.status).toBe(200);
    expect(out.body).not.toContain('FAKE-TEST-abcd');
    expect(out.body).toContain('1234');
    expect(readEnvValue(fs.readFileSync(envPath, 'utf8'), 'ANTHROPIC_API_KEY')).toBe(KEY);
  });
  it('a key of 4 characters or fewer shows set with no last4', () => {
    expect(keysStatus('ANTHROPIC_API_KEY=abcd\n').anthropicKey).toEqual({ set: true });
  });
  it('an empty key string is refused (400); null clears it', async () => {
    fs.writeFileSync(envPath, `ANTHROPIC_API_KEY=${KEY}\n`);
    const a = res();
    await handleSettingsApi(req('/keys', 'POST', { anthropicKey: '' }), a.r, deps());
    expect(a.out.status).toBe(400);
    const b = res();
    await handleSettingsApi(req('/keys', 'POST', { anthropicKey: null }), b.r, deps());
    expect(b.out.status).toBe(200);
    expect(fs.readFileSync(envPath, 'utf8')).not.toContain('ANTHROPIC_API_KEY');
  });
  it('POST budget with a string is a 400 and writes nothing', async () => {
    const { r, out } = res();
    await handleSettingsApi(req('/budget', 'POST', { usd: '2.555' }), r, deps());
    expect(out.status).toBe(400);
    expect(fs.existsSync(envPath)).toBe(false);
  });
  it('POST budget from a LAN IP host is refused 403 and writes nothing', async () => {
    const { r, out } = res();
    await handleSettingsApi(req('/budget', 'POST', { usd: 3 }, '192.168.1.20:3110'), r, deps());
    expect(out.status).toBe(403);
    expect(fs.existsSync(envPath)).toBe(false);
  });
  it('a body larger than 8 KB is refused', async () => {
    const { r, out } = res();
    await handleSettingsApi(req('/keys', 'POST', { anthropicKey: 'a'.repeat(9000) }), r, deps());
    expect(out.status).toBe(400);
  });
});

describe('trusted host rule for settings', () => {
  it.each([
    ['localhost:3110', true], ['127.0.0.1:3110', true], ['[::1]:3110', true], ['192.168.1.5:3110', false],
    ['evil.example:3110', false], ['', false],
  ])('host %s -> %s', (host, ok) => {
    expect(trusted({ host }, { allowedHosts: [] })).toBe(ok);
  });
  it('a Tailscale name in allowedHosts is trusted; a LAN IP stays refused even with MUGI_LAN', () => {
    expect(trusted({ host: 'pc.tailnet.ts.net' }, { allowedHosts: ['pc.tailnet.ts.net'] })).toBe(true);
    expect(trusted({ host: '192.168.1.5:3110' }, { allowedHosts: [], lan: true })).toBe(false);
  });
});
