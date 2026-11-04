# 本機＋手機私用版

程式放在 `C:\Users\scott\Desktop\japanese-tutor-mugi`。分支 `feat/openai-api-mode`。
Node 建議 24.15 以上（部分鎖定依賴的最低要求）；使用 `npm install` 安裝依賴。

## 啟動與停止

在專案目錄執行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-Mugi.ps1 -OpenBrowser
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Stop-Mugi.ps1
```

瀏覽器網址 http://127.0.0.1:3004 。電腦必須開機，服務只監聽 loopback。
這是私人使用的 Vite 服務；`npm run build` 只檢查／產生前端，不包含可獨立部署的後端。
腳本核對 PID、程序建立時間與指令路徑，拒絕停止其他程式；重複啟動不會佔用新的埠。
`.local-run/` 保存啟停狀態及日誌，不進 Git，也不可經 Vite 檔案服務讀取。

## 設定服務

設定 → AI 服務，選擇「ChatGPT 帳號」或「OpenAI API」。一次只使用一個；所有 AI 功能共用選擇。
Claude 預設不使用。OAuth 限制不會觸發付費 API 備援。

- ChatGPT 帳號：在電腦上按「用 ChatGPT 登入」，自行完成官方登入及方案用量授權。登入／登出與 API key 互不影響。啟動腳本預設把 OAuth 憑證放在 `.local-run/oauth/`，除非你已設定 `MUGI_DATA_DIR`；不會自動搬動既有帳號資料。
- OpenAI API：在電腦設定頁貼上 API key，按儲存。金鑰只保存在 `.env.local`，不進瀏覽器 localStorage、bundle、Git 或日誌。不要在聊天、issue 或 PR 貼上金鑰。
- API 預設模型 `gpt-5.4-mini`，也支援已計價的 `gpt-5.4-mini-2026-03-17`；`OPENAI_API_MODEL` 可設定伺服器預設。無模型權限會報錯，不會換模型。
- API 每日預算預設 US$2；`MUGI_OPENAI_DAILY_USD=0` 表示暫停 API，與 Claude 的 0=不限不同。
- API 用量以 Asia/Taipei 換日，儲存在 `.usage/openai-api.json`。請求開始前保守預留，完成依 usage 結算。中斷無 usage 或程序崩潰保留估算，重啟不歸零。紀錄損壞／寫入失敗會停止付費請求；保留檔案供檢查，修復後重啟。
- 計價只是應用程式估算；以 OpenAI 帳單為準。每個模型／功能／日期獨立記錄，ChatGPT 方案用量不納入 API 美元預算。
- 語音使用瀏覽器內建功能；第一版不需要 Claude、Google、Azure 等其他 key。聊天紀錄仍存在各裝置，沒有跨裝置同步。

## 手機 HTTPS

1. 電腦與手機安裝 Tailscale，登入自己的帳號，啟用裝置連線。
2. 取得電腦完整 DNS 名稱，例如 `mypc.tail123.ts.net`。
3. 停止 App，重新啟動並設定精確主機名稱（不接受萬用字元）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-Mugi.ps1 -TailscaleHost mypc.tail123.ts.net
tailscale serve --https=443 --bg http://127.0.0.1:3004
tailscale serve status
```

若 tailscale 不在 PATH，可用 `C:\Program Files\Tailscale\tailscale.exe`。首次 Serve 可能需依官方連結啟用 HTTPS。
手機打開 status 顯示的 HTTPS 位址，允許麥克風。登入與 key 設定仍在電腦本機做。
不用開放 LAN、不使用 Funnel 或公開代理。關閉手機入口：`tailscale serve --https=443 off`。

## 驗證與費用

`npm test`：Vitest＋jsdom，預設 fetch 禁止外網，測試自行提供假的 transport、OAuth 與時鐘。
`npm run build`：TypeScript 與 Vite 建置。保留原建置產物，不直接永久刪檔。
測試暫存目錄保留供檢查；需要模擬移除的檔案移入 Windows 垃圾桶。無法移入時停止清理，不永久刪除。

真實驗收需要你在電腦設定 API key、完成 OAuth 登入，並提供 Tailscale 主機名及手機系統／瀏覽器版本。
真實 API 冒煙測試（設定 key 後）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Smoke-OpenAI.ps1 -RunPaidChecks
```

這會真的呼叫四項 AI 功能並產生費用。腳本暫時把每日預算降到「目前花費＋最多 US$0.10」（且不超過原預算），串行執行、不自動重試，最後恢復原預算；測試期間避免其他裝置使用。換日或任一驗收失敗會停止。預算未成功恢復時會顯示錯誤，請到本機設定頁檢查。
另需檢查 OAuth 回覆、手機 HTTPS、麥克風／朗讀、服務手動切換、重新啟動後設定與用量保留。
離線 mock 測試不代表真實帳號、語音相容性或所有日文教學答案已驗收。

## 回退

以 Git 切回修改前 commit（見交付測試報告），先停止服務。不要刪除 `.env.local`、`.usage`、OAuth 憑證或瀏覽器資料。
舊程式不認得 OpenAI API，回退後需在設定中選 ChatGPT 帳號。任何需清理的檔案先移到垃圾桶；做不到就保留並詢問。
