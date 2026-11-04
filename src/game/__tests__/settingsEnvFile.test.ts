import { testCleanup } from '../../testCleanup.ts';
// .env.local writer (server/envFile.ts), all in a temp folder: replace in place, append, remove, keep comments / order /
// line endings, create from nothing, refuse bad names and values (without echoing them), and the atomic write leaves no temp file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyEnvUpdates, cleanValue, readEnvValue, updateEnvFile } from '../../../server/envFile.ts';

let dir = '';
let file = '';
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mugi-envfile-'));
  file = path.join(dir, '.env.local');
});
afterEach(() => {
  testCleanup(dir, { recursive: true, force: true });
});

const SAMPLE = [
  '# Claude: needed for the chat.',
  'ANTHROPIC_API_KEY=',
  'ANTHROPIC_MODEL=claude-haiku-5-5',
  '',
  '# Google',
  'GOOGLE_TTS_API_KEY=oldgoogle1234',
  '# a comment that mentions GOOGLE_TTS_API_KEY=not-a-key',
  'MUGI_LAN=',
].join('\r\n');

describe('applyEnvUpdates (pure)', () => {
  it('replaces a key in place and keeps every other line, comment and order', () => {
    const out = applyEnvUpdates(SAMPLE, { GOOGLE_TTS_API_KEY: 'newgoogle9876' });
    expect(out).toBe(SAMPLE.replace('GOOGLE_TTS_API_KEY=oldgoogle1234', 'GOOGLE_TTS_API_KEY=newgoogle9876'));
  });

  it('appends a missing key at the end, after the last line', () => {
    const out = applyEnvUpdates(SAMPLE, { AZURE_SPEECH_KEY: 'azure-key-1' });
    expect(out).toBe(`${SAMPLE}\r\nAZURE_SPEECH_KEY=azure-key-1\r\n`);
  });

  it('removes a key (null) and its line, nothing else', () => {
    const out = applyEnvUpdates(SAMPLE, { GOOGLE_TTS_API_KEY: null });
    expect(out).toBe(SAMPLE.replace('GOOGLE_TTS_API_KEY=oldgoogle1234\r\n', ''));
    expect(out).toContain('# a comment that mentions GOOGLE_TTS_API_KEY=not-a-key');
  });

  it('keeps LF line endings when the file has them', () => {
    const lf = SAMPLE.replace(/\r\n/g, '\n');
    const out = applyEnvUpdates(lf, { MUGI_DAILY_USD: '2' });
    expect(out.includes('\r')).toBe(false);
    expect(out.endsWith('MUGI_DAILY_USD=2\n')).toBe(true);
  });

  it('a file without a final line ending gets one before the appended line', () => {
    const out = applyEnvUpdates('MUGI_LAN=', { MUGI_DAILY_USD: '1.5' });
    expect(out).toBe('MUGI_LAN=\r\nMUGI_DAILY_USD=1.5\r\n');
  });

  it('a new file (empty text) gets only the written key, with CRLF', () => {
    expect(applyEnvUpdates('', { ANTHROPIC_API_KEY: 'sk-ant-1234' })).toBe('ANTHROPIC_API_KEY=sk-ant-1234\r\n');
  });

  it('keeps a byte order mark at the start of the file', () => {
    const out = applyEnvUpdates(`﻿${SAMPLE}`, { GOOGLE_TTS_API_KEY: null });
    expect(out.startsWith('﻿# Claude')).toBe(true);
  });

  it('replaces every line that sets the key, so a duplicate cannot keep the old value', () => {
    const dup = 'GOOGLE_TTS_API_KEY=first1111\r\nGOOGLE_TTS_API_KEY=second2222\r\n';
    expect(applyEnvUpdates(dup, { GOOGLE_TTS_API_KEY: 'third33333' })).toBe('GOOGLE_TTS_API_KEY=third33333\r\nGOOGLE_TTS_API_KEY=third33333\r\n');
  });

  it('a value is trimmed before it is checked and written', () => {
    expect(applyEnvUpdates('', { ANTHROPIC_API_KEY: '  sk-ant-x1  ' })).toBe('ANTHROPIC_API_KEY=sk-ant-x1\r\n');
  });

  it('refuses a name that is not one of the six allowed keys', () => {
    expect(() => applyEnvUpdates(SAMPLE, { MUGI_LAN: '1' } as never)).toThrow('這個設定不能用這個方式寫入');
    expect(() => applyEnvUpdates(SAMPLE, { ANTHROPIC_MODEL: 'x' } as never)).toThrow();
    expect(() => applyEnvUpdates(SAMPLE, { PATH: 'x' } as never)).toThrow();
  });

  it('refuses a value with spaces, quotes, =, #, newlines or control characters, and never echoes it', () => {
    const bad = ['has space', 'quo"te', "sin'gle", 'a=b', 'x#y', 'line\nbreak', 'ctl\u0001x', '', '   ', 'a'.repeat(301)];
    for (const v of bad) {
      let msg = '';
      try {
        applyEnvUpdates(SAMPLE, { ANTHROPIC_API_KEY: v });
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).toMatch(/[一-鿿]/);
      if (v.trim()) expect(msg).not.toContain(v.trim());
    }
  });

  it('the allowed value alphabet is letters, digits, dot, underscore and dash, up to 300 characters', () => {
    expect(cleanValue('ANTHROPIC_API_KEY', 'sk-ant_v1.2')).toBe('sk-ant_v1.2');
    expect(cleanValue('ANTHROPIC_API_KEY', 'a'.repeat(300))).toHaveLength(300);
    expect(() => cleanValue('ANTHROPIC_API_KEY', 'a'.repeat(301))).toThrow();
  });

  it('the Azure region must be lower-case letters and digits, 2 to 30 characters', () => {
    expect(cleanValue('AZURE_SPEECH_REGION', 'eastasia')).toBe('eastasia');
    expect(() => cleanValue('AZURE_SPEECH_REGION', 'East-Asia')).toThrow();
    expect(() => cleanValue('AZURE_SPEECH_REGION', 'a')).toThrow();
  });

  it('readEnvValue returns the last line that sets the key, without the comment or the other keys', () => {
    expect(readEnvValue(SAMPLE, 'GOOGLE_TTS_API_KEY')).toBe('oldgoogle1234');
    expect(readEnvValue(SAMPLE, 'ANTHROPIC_API_KEY')).toBe('');
    expect(readEnvValue('AZURE_SPEECH_REGION=eastasia', 'AZURE_SPEECH_REGION')).toBe('eastasia');
    expect(readEnvValue('', 'ANTHROPIC_API_KEY')).toBe('');
  });
});

describe('updateEnvFile (the file)', () => {
  it('creates the file from nothing when it is missing (not from .env.example)', () => {
    updateEnvFile(file, { ANTHROPIC_API_KEY: 'sk-ant-abcd1234' });
    expect(fs.readFileSync(file, 'utf8')).toBe('ANTHROPIC_API_KEY=sk-ant-abcd1234\r\n');
  });

  it('writes the file in place, keeping its other lines', () => {
    fs.writeFileSync(file, SAMPLE, 'utf8');
    updateEnvFile(file, { GOOGLE_TTS_API_KEY: null, AZURE_SPEECH_REGION: 'eastasia' });
    const text = fs.readFileSync(file, 'utf8');
    expect(text).not.toContain('GOOGLE_TTS_API_KEY=oldgoogle1234');
    expect(text.endsWith('AZURE_SPEECH_REGION=eastasia\r\n')).toBe(true);
    expect(text).toContain('ANTHROPIC_MODEL=claude-haiku-5-5');
  });

  it('the atomic write leaves no temp file in the folder', () => {
    fs.writeFileSync(file, SAMPLE, 'utf8');
    updateEnvFile(file, { MUGI_DAILY_USD: '0.25' });
    expect(fs.readdirSync(dir)).toEqual(['.env.local']);
  });

  it('a refused value leaves the file exactly as it was, and no temp file', () => {
    fs.writeFileSync(file, SAMPLE, 'utf8');
    expect(() => updateEnvFile(file, { ANTHROPIC_API_KEY: 'bad value' })).toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe(SAMPLE);
    expect(fs.readdirSync(dir)).toEqual(['.env.local']);
  });

  it('the file is written with mode 0600 where the platform keeps modes', () => {
    updateEnvFile(file, { ANTHROPIC_API_KEY: 'sk-ant-abcd1234' });
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });
});
