// @vitest-environment jsdom
// Settings › AI 服務 (SettingsSections AiServiceSection): the rows in the player's order, 上移／下移, the switches (the last one
// on cannot be turned off), the ChatGPT sign-in (only on the PC), the model choice, and the sign-in's failure message.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AiServiceSection } from '../SettingsSections';
import type { ChatGptStatus } from '../../game/openaiStatus';

function render(node: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

const SIGNED_IN: ChatGptStatus = {
  signedIn: true, planEnabled: true, email: 'me@example.com',
  models: [{ slug: 'gpt-5.5-sol', label: 'GPT 5.5 Sol' }, { slug: 'gpt-5.4', label: 'GPT 5.4' }],
};
const SIGNED_OUT: ChatGptStatus = { signedIn: false, planEnabled: false, models: [] };

const button = (host: HTMLElement, label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement;
const switchOf = (host: HTMLElement, label: string) => host.querySelector(`input[aria-label="${label} 使用"]`) as HTMLInputElement;
const rowLabels = (host: HTMLElement) => [...host.querySelectorAll('.as-ai-item > .as-row > span:first-child')].map((s) => s.childNodes[0]?.textContent);

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AiServiceSection', () => {
  it('clearly lists the account and API as separate services, with no ordering buttons', () => {
    const r = render(<AiServiceSection providers={['openai']} openaiModel="" claudeOk={false} chatgpt={SIGNED_IN} onChange={() => {}} onRefresh={() => {}} localPc />);
    expect(rowLabels(r.host)).toEqual(['ChatGPT 帳號', 'OpenAI API']);
    expect(r.host.querySelector('button[aria-label*="上移"]')).toBeNull();
    expect(r.host.textContent).toContain('不會自動使用付費 API');
    r.unmount();
  });
  it('manually selecting the API replaces the account rather than adding a fallback', () => {
    const onChange = vi.fn();
    const r = render(<AiServiceSection providers={['openai']} openaiModel="" claudeOk={false} chatgpt={SIGNED_IN} onChange={onChange} onRefresh={() => {}} localPc />);
    act(() => switchOf(r.host, 'OpenAI API').click());
    expect(onChange).toHaveBeenCalledWith({ providers: ['openai-api'] });
    r.unmount();
  });
  it('the selected service stays selected when clicked again', () => {
    const onChange = vi.fn();
    const r = render(<AiServiceSection providers={['openai']} openaiModel="" claudeOk={false} chatgpt={SIGNED_OUT} onChange={onChange} onRefresh={() => {}} localPc />);
    act(() => switchOf(r.host, 'ChatGPT 帳號').click());
    expect(switchOf(r.host, 'ChatGPT 帳號').checked).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    r.unmount();
  });
  it('the API key is a password input on the PC; the budget is separately named', () => {
    const r = render(<AiServiceSection providers={['openai-api']} openaiModel="" claudeOk={false} chatgpt={SIGNED_OUT} onChange={() => {}} onRefresh={() => {}} localPc />);
    expect(r.host.querySelector('input[aria-label="OpenAI API key"]')?.getAttribute('type')).toBe('password');
    expect(r.host.querySelector('input[aria-label="OpenAI API 每日預算"]')).not.toBeNull();
    r.unmount();
  });
  it('a phone cannot enter the API key or change its budget', () => {
    const r = render(<AiServiceSection providers={['openai-api']} openaiModel="" claudeOk={false} chatgpt={SIGNED_OUT} onChange={() => {}} onRefresh={() => {}} localPc={false} />);
    expect(r.host.querySelector('input[aria-label="OpenAI API key"]')).toBeNull();
    expect((r.host.querySelector('input[aria-label="OpenAI API 每日預算"]') as HTMLInputElement).disabled).toBe(true);
    r.unmount();
  });
  it('from a phone there is no sign-in button and no paste field: the note says ChatGPT signs in and out only on the PC', () => {
    const r = render(<AiServiceSection providers={['anthropic']} openaiModel="" claudeOk chatgpt={SIGNED_OUT} onChange={() => {}} onRefresh={() => {}} localPc={false} />);
    expect(button(r.host, '用 ChatGPT 登入')).toBeUndefined();
    expect(r.host.querySelector('input[aria-label="登入後的網址"]')).toBeNull();
    expect(r.host.textContent).toContain('ChatGPT 只能在電腦上登入或登出');
    r.unmount();
  });

  it('from a phone, signed in: no 登出 button, but the model select still works', () => {
    const onChange = vi.fn();
    const r = render(<AiServiceSection providers={['openai']} openaiModel="gpt-5.4" claudeOk chatgpt={SIGNED_IN} onChange={onChange} onRefresh={() => {}} localPc={false} />);
    expect(r.host.textContent).toContain('已登入（me@example.com）');
    expect(button(r.host, '登出')).toBeUndefined();
    const select = r.host.querySelector('select[aria-label="ChatGPT 模型"]') as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    act(() => {
      select.value = 'gpt-5.5-sol';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith({ openaiModel: 'gpt-5.5-sol' });
    r.unmount();
  });

  it('from a phone the Claude key is a status line only: no key box and no save button', () => {
    const r = render(<AiServiceSection providers={['anthropic']} openaiModel="" claudeOk chatgpt={SIGNED_OUT} onChange={() => {}} onRefresh={() => {}} localPc={false} />);
    expect(r.host.querySelector('input[aria-label="Claude 金鑰"]')).toBeNull();
    expect(r.host.textContent).toContain('金鑰只能在電腦上設定');
    r.unmount();
  });

  it('signed in: the status shows the account, 登出 is there, and a model select lists the plan’s models', () => {
    const onChange = vi.fn();
    const r = render(<AiServiceSection providers={['openai']} openaiModel="gpt-5.4" claudeOk chatgpt={SIGNED_IN} onChange={onChange} onRefresh={() => {}} localPc />);
    expect(r.host.textContent).toContain('已登入（me@example.com）');
    expect(button(r.host, '用 ChatGPT 登入')).toBeUndefined();
    expect(button(r.host, '登出')).toBeDefined();
    const select = r.host.querySelector('select[aria-label="ChatGPT 模型"]') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['gpt-5.5-sol', 'gpt-5.4']);
    expect(select.value).toBe('gpt-5.4');
    act(() => {
      select.value = 'gpt-5.5-sol';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith({ openaiModel: 'gpt-5.5-sol' });
    r.unmount();
  });

  it('a model that is not listed shows the first listed one', () => {
    const r = render(<AiServiceSection providers={['openai']} openaiModel="gone" claudeOk chatgpt={SIGNED_IN} onChange={() => {}} onRefresh={() => {}} localPc />);
    expect((r.host.querySelector('select[aria-label="ChatGPT 模型"]') as HTMLSelectElement).value).toBe('gpt-5.5-sol');
    r.unmount();
  });

  it('a note says the ChatGPT sign-in uses the plan and is not shared', () => {
    const r = render(<AiServiceSection providers={['anthropic']} openaiModel="" claudeOk chatgpt={SIGNED_OUT} onChange={() => {}} onRefresh={() => {}} localPc />);
    expect(r.host.textContent).toContain('不需要 OpenAI API 金鑰');
    r.unmount();
  });
});
