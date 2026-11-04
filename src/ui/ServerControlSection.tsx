import { useEffect, useState } from 'react';
import { apiFetch } from '../game/apiFetch';
export function ServerControlSection() {
  const [canStop, setCanStop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => {
    let alive = true;
    void apiFetch('/api/settings/server').then(async (r) => { const j = await r.json(); if (alive) setCanStop(r.ok && j.canStop === true); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const stop = async () => {
    setBusy(true); setNote('');
    try {
      const r = await apiFetch('/api/settings/server', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stop' }) });
      const j = await r.json();
      if (r.ok && j.stopping === true) { setStopping(true); setCanStop(false); setNote('服務正在關閉；重新啟動請雙擊桌面專案資料夾的「Mugi 服務控制」捷徑。'); }
      else setNote(j.message || '無法關閉服務，請使用桌面控制面板。');
    } catch { setNote('連不上伺服器，請在桌面控制面板確認狀態。'); }
    finally { setBusy(false); }
  };
  return <div className="as-ai-sec"><h3>本機服務控制</h3>
    <p>服務狀態：{stopping ? '正在關閉' : '執行中'}</p>
    <p><small>真正的啟動／關閉總開關在桌面專案資料夾的「Mugi 服務控制」面板。服務關閉後網頁會離線，請從面板重新啟動。</small></p>
    <button className="as-small" disabled={!canStop || busy || stopping} onClick={() => void stop()}>關閉本機服務</button>
    {!canStop && !stopping && <p><small>此按鈕僅限電腦本機，且服務須由控制面板或啟動腳本開啟。</small></p>}
    <p><small>關閉服務會中止進行中的回覆；設定、API key 與紀錄會保留。</small></p>
    {note && <p role="status">{note}</p>}
  </div>;
}
