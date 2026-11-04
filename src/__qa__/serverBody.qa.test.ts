// QA: the chat request body as the server validates it (server/claudeChat.ts parseChatBody and its persona / name parts).
import { describe, expect, it } from 'vitest';
import { parseChatBody, parseModel, parseName, parsePersona, upstreamMessages, chatRequest } from '../../server/claudeChat';
import { PERSONA_MAX_CHARS, NAME_MAX_CHARS, CHAT_MAX_MESSAGES, CHAT_MAX_MESSAGE_CHARS } from '../game/claudeProtocol';
import { cleanPersonaSetting, cleanTutorName } from '../game/tutor';

const base = (over: Record<string, unknown> = {}) => JSON.stringify({
  messages: [{ role: 'user', content: 'hi' }], role: 'Mugi', mode: 'teacher', context: {}, providers: ['anthropic'], ...over,
});

describe('persona limit (400 characters, code points)', () => {
  it('400 characters pass, 401 are refused', () => {
    expect(parsePersona('字'.repeat(PERSONA_MAX_CHARS))).toBe('字'.repeat(PERSONA_MAX_CHARS));
    expect(() => parsePersona('字'.repeat(PERSONA_MAX_CHARS + 1))).toThrow();
  });
  it('400 emoji (800 UTF-16 units) pass the server; the client cut keeps 400 code points', () => {
    const emoji = '😀'.repeat(PERSONA_MAX_CHARS);
    expect(parsePersona(emoji)).toBe(emoji);
    expect(cleanPersonaSetting(emoji)).toBe(emoji);
    expect(cleanPersonaSetting('😀'.repeat(401)).length).toBe(800); // 400 code points = 800 units
  });
  it('a persona of only control characters is refused (the client sends none instead)', () => {
    expect(() => parsePersona('\u0001\u0007')).toThrow();
    expect(cleanPersonaSetting('\u0001\u0007')).toBe('');
  });
  it('< and > are made full-width and do not change the length', () => {
    const t = '<' + 'a'.repeat(398) + '>';
    expect(parsePersona(t)).toBe('＜' + 'a'.repeat(398) + '＞');
  });
});

describe('name limit (16 characters on the server)', () => {
  it('16 characters pass, 17 are refused', () => {
    expect(parseName('名'.repeat(NAME_MAX_CHARS))).toBe('名'.repeat(16));
    expect(() => parseName('名'.repeat(NAME_MAX_CHARS + 1))).toThrow();
  });
  it('<script> in a name is made full-width, so it cannot open a tag', () => {
    expect(parseName('<script>x')).toBe('＜script＞x');
  });
  it('control characters (newlines) are removed from a name', () => {
    expect(parseName('小\n春\u0000')).toBe('小春');
  });
  it('a name of only spaces or control characters is refused by the server', () => {
    expect(() => parseName('  \n ')).toThrow();
  });
  it('the client never sends a name longer than its own cap (8)', () => {
    expect(cleanTutorName('一二三四五六七八九十')).toBe('一二三四五六七八');
  });
});

describe('other body checks', () => {
  it('40 messages pass, 41 are refused', () => {
    const ok = Array.from({ length: CHAT_MAX_MESSAGES }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x' }));
    // the last one must be the user's: 40 messages ending with an assistant line is refused
    ok[CHAT_MAX_MESSAGES - 1] = { role: 'user', content: 'x' };
    ok[CHAT_MAX_MESSAGES - 2] = { role: 'assistant', content: 'x' };
    expect(() => parseChatBody(base({ messages: ok }))).not.toThrow();
    expect(() => parseChatBody(base({ messages: [...ok, { role: 'user', content: 'y' }] }))).toThrow();
  });
  it('2000 characters pass, 2001 are refused', () => {
    expect(() => parseChatBody(base({ messages: [{ role: 'user', content: 'a'.repeat(CHAT_MAX_MESSAGE_CHARS) }] }))).not.toThrow();
    expect(() => parseChatBody(base({ messages: [{ role: 'user', content: 'a'.repeat(CHAT_MAX_MESSAGE_CHARS + 1) }] }))).toThrow();
  });
  it('a trailing assistant line is refused; leading assistant lines are dropped', () => {
    expect(() => parseChatBody(base({ messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] }))).toThrow();
    const b = parseChatBody(base({ messages: [{ role: 'assistant', content: 'opening' }, { role: 'user', content: 'a' }] }));
    expect(b.messages).toEqual([{ role: 'user', content: 'a' }]);
  });
  it('an all-assistant list is refused', () => {
    expect(() => parseChatBody(base({ messages: [{ role: 'assistant', content: 'opening' }] }))).toThrow();
  });
  it('a model outside the list is refused, null is the default', () => {
    expect(() => parseModel('gpt-x')).toThrow();
    expect(parseModel(null)).toBeUndefined();
    expect(parseModel('claude-sonnet-5-5')).toBe('claude-sonnet-5-5');
  });
  it('an unknown provider list is refused (400), an absent one is the ChatGPT account', () => {
    expect(() => parseChatBody(base({ providers: ['anthropic', 'anthropic'] }))).toThrow();
    expect(() => parseChatBody(base({ providers: ['google'] }))).toThrow();
    expect(parseChatBody(base({ providers: undefined })).routing.providers).toEqual(['openai']);
  });
  it('whitespace-only content is refused', () => {
    expect(() => parseChatBody(base({ messages: [{ role: 'user', content: ' \n ' }] }))).toThrow();
  });
  it('the request carries a cache breakpoint on the system block and the message before the newest user turn', () => {
    const body = parseChatBody(base({ messages: [
      { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' },
    ] }));
    const req = chatRequest(body, 'claude-haiku-5-5');
    expect((req.system as Array<{ cache_control?: unknown }>)[0].cache_control).toEqual({ type: 'ephemeral' });
    const msgs = upstreamMessages(body.messages);
    expect(JSON.stringify(msgs[1])).toContain('cache_control');
    expect(JSON.stringify(msgs[2])).not.toContain('cache_control');
    expect(JSON.stringify(msgs[2])).toContain('<reminder>');
    expect(JSON.stringify(msgs[0])).not.toContain('<reminder>');
  });
  it('an empty messages array is refused', () => {
    expect(() => parseChatBody(base({ messages: [] }))).toThrow();
  });
  it('a non-JSON body is refused with 400', () => {
    expect(() => parseChatBody('{nope')).toThrow();
  });
});
