import { testCleanup } from '../../testCleanup.ts';
// The ChatGPT credential store (server/openai/credentials.ts): round trip, encryption at rest, the protector and folder
// injected (no DPAPI, no icacls), and the rule that an unreadable file or key stops the start and is never overwritten.
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CREDENTIALS_FILE, MASTER_KEY_FILE, dataDirectory, openCredentialStore, type Protector } from '../../../server/openai/credentials.ts';

// a stand-in for DPAPI: reversible, and not the same bytes as the input
const xor: Protector = {
  protect: (d) => Buffer.from(d.map((b) => b ^ 0x5a)),
  unprotect: (d) => Buffer.from(d.map((b) => b ^ 0x5a)),
};
const noRestrict = () => {};
const SECRET = 'SECRET-ACCESS-TOKEN-123';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mugi-tutor-cred-'));
});
afterEach(() => {
  testCleanup(dir, { recursive: true, force: true });
});

const account = {
  client_id: 'client_1', subject: 'user_1', email: 'a@example.com', name: 'A', access_token: SECRET, refresh_token: 'REFRESH-XYZ',
  id_token: 'ID-TOKEN', scopes: ['chatgpt.tokens.use.direct'], expiresAt: 1234,
};

describe('credential store (encrypted with a protector)', () => {
  it('round-trips the account through a reopen', () => {
    const first = openCredentialStore({ directory: dir, protector: xor, restrict: noRestrict });
    first.data.account = { ...account };
    first.save();
    const again = openCredentialStore({ directory: dir, protector: xor, restrict: noRestrict });
    expect(again.data.account).toEqual(account);
    expect(again.data.v).toBe(1);
    expect(again.data.hostId).toMatch(/^urn:uuid:/);
  });

  it('the file holds no token text: it is AES-256-GCM, and the key sits in master.key', () => {
    const store = openCredentialStore({ directory: dir, protector: xor, restrict: noRestrict });
    store.data.account = { ...account };
    store.save();
    const file = readFileSync(join(dir, CREDENTIALS_FILE), 'utf8');
    expect(file).not.toContain(SECRET);
    expect(file).not.toContain('REFRESH-XYZ');
    expect(file).not.toContain('a@example.com');
    const parsed = JSON.parse(file) as Record<string, unknown>;
    expect(parsed.enc).toBe('aes-256-gcm');
    expect(parsed.v).toBe(1);
    expect(existsSync(join(dir, MASTER_KEY_FILE))).toBe(true);
  });

  it('a new IV on every save: the same data never gives the same bytes twice', () => {
    const store = openCredentialStore({ directory: dir, protector: xor, restrict: noRestrict });
    store.data.account = { ...account };
    store.save();
    const first = readFileSync(join(dir, CREDENTIALS_FILE), 'utf8');
    store.save();
    expect(readFileSync(join(dir, CREDENTIALS_FILE), 'utf8')).not.toBe(first);
  });

  it('a master key that the protector cannot open stops the start and leaves the files as they were', () => {
    openCredentialStore({ directory: dir, protector: xor, restrict: noRestrict }).save();
    const before = readFileSync(join(dir, CREDENTIALS_FILE), 'utf8');
    const broken: Protector = { protect: xor.protect, unprotect: () => { throw new Error('dpapi failed'); } };
    expect(() => openCredentialStore({ directory: dir, protector: broken, restrict: noRestrict })).toThrow('無法解開登入資料');
    expect(readFileSync(join(dir, CREDENTIALS_FILE), 'utf8')).toBe(before);
  });

  it('a master key of the wrong length is unreadable', () => {
    openCredentialStore({ directory: dir, protector: xor, restrict: noRestrict }).save();
    const short: Protector = { protect: xor.protect, unprotect: () => Buffer.alloc(8) };
    expect(() => openCredentialStore({ directory: dir, protector: short, restrict: noRestrict })).toThrow('無法解開登入資料');
  });

  it('an encrypted file with its key missing is never overwritten', () => {
    const store = openCredentialStore({ directory: dir, protector: xor, restrict: noRestrict });
    store.data.account = { ...account };
    store.save();
    testCleanup(join(dir, MASTER_KEY_FILE));
    const before = readFileSync(join(dir, CREDENTIALS_FILE), 'utf8');
    expect(() => openCredentialStore({ directory: dir, protector: xor, restrict: noRestrict })).toThrow('無法解開登入資料');
    expect(readFileSync(join(dir, CREDENTIALS_FILE), 'utf8')).toBe(before);
  });

  it('tampered ciphertext is refused, not read', () => {
    const store = openCredentialStore({ directory: dir, protector: xor, restrict: noRestrict });
    store.data.account = { ...account };
    store.save();
    const parsed = JSON.parse(readFileSync(join(dir, CREDENTIALS_FILE), 'utf8')) as { data: string };
    const bytes = Buffer.from(parsed.data, 'base64');
    bytes[0] ^= 0xff;
    parsed.data = bytes.toString('base64');
    writeFileSync(join(dir, CREDENTIALS_FILE), JSON.stringify(parsed));
    expect(() => openCredentialStore({ directory: dir, protector: xor, restrict: noRestrict })).toThrow('無法解開登入資料');
  });
});

describe('credential store without a protector (not Windows: plain file, 0600)', () => {
  it('keeps the account as plain JSON and reads it back', () => {
    const store = openCredentialStore({ directory: dir, protector: null, restrict: noRestrict });
    store.data.account = { ...account };
    store.save();
    expect(readFileSync(join(dir, CREDENTIALS_FILE), 'utf8')).toContain(SECRET);
    expect(existsSync(join(dir, MASTER_KEY_FILE))).toBe(false);
    expect(openCredentialStore({ directory: dir, protector: null, restrict: noRestrict }).data.account).toEqual(account);
  });

  it('an encrypted file with no protector to open it stops the start', () => {
    openCredentialStore({ directory: dir, protector: xor, restrict: noRestrict }).save();
    expect(() => openCredentialStore({ directory: dir, protector: null, restrict: noRestrict })).toThrow('無法解開登入資料');
  });

  it('an unreadable credentials file is reported and never replaced', () => {
    writeFileSync(join(dir, CREDENTIALS_FILE), '{not json');
    expect(() => openCredentialStore({ directory: dir, protector: null, restrict: noRestrict })).toThrow('登入資料無法讀取');
    expect(readFileSync(join(dir, CREDENTIALS_FILE), 'utf8')).toBe('{not json');
  });

  it('the folder is restricted through the injected function', () => {
    const restrict = vi.fn();
    openCredentialStore({ directory: dir, protector: null, restrict });
    expect(restrict).toHaveBeenCalledWith(dir);
  });
});

describe('data folder', () => {
  it('MUGI_DATA_DIR overrides ~/.mugi-tutor', () => {
    expect(dataDirectory({ MUGI_DATA_DIR: '  D:/somewhere/else  ' } as NodeJS.ProcessEnv)).toBe('D:/somewhere/else');
    expect(dataDirectory({} as NodeJS.ProcessEnv)).toMatch(/\.mugi-tutor$/);
  });
});
