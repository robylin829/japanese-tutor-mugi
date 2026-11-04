// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ServerControlSection } from '../ServerControlSection';
import { PhoneSpeechStatus } from '../VoiceSettings';
import { ENGINE_CHOICES } from '../../game/tts';
function render(node: React.ReactElement) {
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  act(() => root.render(node)); return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ''; });
describe('server control in settings', () => {
  it('requests actual stop and explains desktop restart; never offers a fake web start switch', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => Response.json(init?.method === 'POST' ? { stopping: true } : { running: true, canStop: true })); vi.stubGlobal('fetch', fetcher);
    const r = render(<ServerControlSection />); await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const stop = r.host.querySelector('button')!; expect(stop.disabled).toBe(false);
    await act(async () => { stop.click(); await Promise.resolve(); });
    expect(fetcher).toHaveBeenCalledWith('/api/settings/server', expect.objectContaining({ method: 'POST', body: JSON.stringify({ action: 'stop' }) }));
    expect(r.host.textContent).toContain('桌面'); expect(r.host.textContent).toContain('正在關閉'); expect(stop.disabled).toBe(true); r.unmount();
  });
  it('disables web stop when the service cannot be managed from this connection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ running: true, canStop: false })));
    const r = render(<ServerControlSection />); await act(async () => { await Promise.resolve(); await Promise.resolve(); }); expect(r.host.querySelector('button')!.disabled).toBe(true); r.unmount();
  });
});
describe('Galaxy S24 speech guidance', () => {
  it('uses device-neutral labels for both language engines', () => { for (const lang of ['ja','zh'] as const) expect(ENGINE_CHOICES[lang][0]).toMatchObject({ engine: 'browser', label: '裝置內建' }); });
  it('shows HTTPS and keyboard fallback when speech recognition is unavailable', () => {
    vi.stubGlobal('isSecureContext', false); const r = render(<PhoneSpeechStatus />);
    expect(r.host.textContent).toContain('Galaxy S24／Android 16'); expect(r.host.textContent).toContain('私人 Tailscale HTTPS'); expect(r.host.textContent).toContain('鍵盤'); expect(r.host.textContent).not.toContain('iPhone'); r.unmount();
  });
  it('reports runtime recognition availability without claiming microphone permission is granted', () => {
    vi.stubGlobal('SpeechRecognition', class {}); vi.stubGlobal('isSecureContext', true); const r = render(<PhoneSpeechStatus />);
    expect(r.host.textContent).toContain('目前頁面為安全連線'); expect(r.host.textContent).toContain('使用時需允許麥克風'); r.unmount();
  });
});
