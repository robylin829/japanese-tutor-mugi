Mugi 本機私用版：實作與驗證報告
日期：2026-11-04（Asia/Taipei）
專案：C:\Users\scott\Desktop\japanese-tutor-mugi
來源：https://github.com/robylin829/japanese-tutor-mugi
分支：feat/openai-api-mode
回退基準：2fa81ba519c200e36663daf6f239039d5a62b938

已實作
- ChatGPT 帳號 OAuth 與 OpenAI API key 獨立，手動選擇單一服務。
- API key 模式不需要 OAuth；清除 key 與 OAuth 登出互不影響。
- 新裝及舊 Claude 預設遷移為 ChatGPT 帳號，Claude 預設不使用。
- 四項 AI 工作共用所選服務：對話、速查、答案判斷、小提醒改寫。
- API 使用 gpt-5.4-mini，reasoning none；模型權限錯誤不換模型。
- API 預算預設 US$2，台北午夜換日；預留費用持久保存，重啟及中斷不歸零。
- 完成依 input/cached/output tokens 結算；缺 usage 時保留估算；損壞或無法寫入紀錄時停止付費。
- 本機金鑰設定只顯示末四碼；手機不能寫入 key 或 API 預算。
- Windows 啟動／停止腳本、私人 Tailscale 操作指南及受 US$0.10 批次上限保護的真實冒煙腳本。

驗證結果
- npm test：1435 項，1433 通過，0 失敗，2 條件式略過。
- 2 項略過：Windows 符號連結權限探測不通過的既有測試，以及未提供本機 VOICEVOX 引擎的選用整合測試。沒有新增 skip。
- npm run build：通過，正式來源 TypeScript＋Vite 前端產物。
- 真實 HTTP 路由＋假上游：四項工作均回傳可供前端解析的結果，並記錄獨立 API 用量。
- 單元測試涵蓋：schema、UTF-8 串流切塊、拒答、壞 JSON、HTTP 400/401/403/404/429/500、取消、逾時、憑證獨立、預算、並發預留、換日、重啟與損壞紀錄。
- 瀏覽器實測：設定頁分開顯示 ChatGPT 帳號與 OpenAI API；可相互手動切換，只有一項被選取；已恢復 ChatGPT 帳號選擇。
- 本機狀態端點回報 configured=false、usd=2、spentTodayUsd=0。
- Windows Start-Mugi / Stop-Mugi：啟動、停止、重啟均成功；預算 2 重啟後保留。
- TCP 監聽確認：127.0.0.1:3004，未開放其他網路介面。
- 服務 stderr 日誌無錯誤；前端產物不含 API 測試 key 或 OAuth 測試 token。
- git diff --check 通過；.env.local、.local-run、.usage、測試輸出未加入 Git。

基準與修復說明
- 起始安全清理調整後 1,400 測試通過，1 項因清理函式替換遺漏失敗，已修復。
- 舊 Claude 預設與多服務 UI 測試改成新規格的明確斷言，原 OAuth 測試保留執行。
- 原本 __qa__/__redteam__ 測試被前端建置納入造成型別錯誤，已與既有 __tests__ 同樣排除於正式來源編譯；仍全部由 Vitest 執行。
- 測試預設禁止外部 fetch，假資料沒有真實 API 呼叫或費用。
- 清理目錄刻意保留於系統暫存目錄以供檢查；需模擬移除的檔案及應用程式快取清理先送 Windows 垃圾桶。
- 不支援垃圾桶或失敗時保留檔案，禁止永久刪除。

尚未驗收／需要你的資料
- 真實 OpenAI API：未設定 key，未執行付費測試；測試費用為 0。
- 真實 OAuth：需你在電腦上完成登入及方案用量授權。
- 手機為 Android 16；尚未提供瀏覽器版本。
- 電腦尚未安裝 Tailscale，手機／電腦的 tailnet 尚未設定，未提供 *.ts.net 精確主機名稱。
- 因此手機 HTTPS、實際麥克風辨識與朗讀仍待實機測試。
- Node 實測為 24.14.1，測試及建置均成功；部分鎖定依賴宣告需要 >=24.15.0，建議後續使用相容 Node。未變更系統 Node。
- US$2 為應用程式估算上限，實際費用仍以 OpenAI 帳單為準；沒有把 mock 測試視為教學內容品質保證。

下一步
1. 開啟 http://127.0.0.1:3004 ，在設定頁自行填 API key 或登入 ChatGPT；不要把金鑰貼在聊天。
2. 真實 API 驗收：powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Smoke-OpenAI.ps1 -RunPaidChecks
   腳本會限制批次估算花費最多 US$0.10、無自動重試，最後恢復原每日預算；目前因沒有 key 只驗證了安全退出。
3. 電腦與手機安裝／登入 Tailscale，依 local-setup.txt 設定精確主機名稱及私人 Serve；提供瀏覽器版本後驗收 Android 16。


2026-11-04 更新：真正的服務總開關、API key 入口與 Galaxy S24 語音

本次交付
- 桌面專案資料夾新增「Mugi 服務控制」捷徑，開啟獨立 Windows 控制面板。
- 面板的總開關會啟動或停止真正的 Node/Vite 伺服器程序；不是暫停 AI。關閉面板不會關閉服務。
- 面板另有「開啟服務網頁／新增 API key」按鈕；服務關閉時不可開網頁，需用面板重新啟動。
- 網頁設定最上方新增「關閉本機服務」，限電腦本機並核對由啟動腳本管理的 PID／專案。
- 服務回覆關閉確認後才關閉；手機、遠端 socket、跨站請求及未受管理的程序不能使用此端點關閉。
- OpenAI API key 設定移到較前方，補上新增／更新提示及儲存成功訊息；不自動切換為付費 API。
- Galaxy S24 / Android 16 的語音介面顯示「裝置內建」，中文與日文各有聲音及試聽。
- 新增安全連線、SpeechRecognition 介面偵測及鍵盤語音輸入替代方式；不把介面可用誤當作已授予麥克風權限。
- 最初理解為「暫停 AI」的未提交變更已撤回；被取代的臨時模組已移入 Windows 垃圾桶。

最新驗證
- npm test：1447 項，1445 通過、0 失敗、2 既有條件式略過。
- npm run build：通過。
- Windows 內建 .NET Framework csc 編譯控制面板成功，原始碼 scripts/MugiControl.cs；產物與捷徑不進 Git。
- 已實際操作面板完成「啟動 → 關閉 → 再啟動」；關閉後 HTTP 網址離線，恢復後 GET /api/settings/server 回報 running=true、canStop=true。
- 已實際從網頁按「關閉本機服務」，收到停止提示且 HTTP 端點離線；再由啟動腳本恢復服務。
- 新增的停止權限、回應後排程關閉、設定 UI 及 Galaxy S24 能力提示測試全部通過。
- 瀏覽器確認 API key 空白欄位可輸入；未代填任何金鑰、未執行付費 AI 請求。
- 截圖：mugi-service-control.png、mugi-api-entry.png、mugi-s24-voice.png。

目前狀態與操作
- 本機服務保留執行中：http://127.0.0.1:3004
- 開關服務：雙擊桌面 japanese-tutor-mugi 資料夾中的「Mugi 服務控制」捷徑。
- 新增金鑰：啟動服務 → 開啟服務網頁 → 設定 → OpenAI API key → 儲存 → 手動選擇 OpenAI API。
- 金鑰、OAuth 與既有紀錄在關閉／重啟後保留。
- S24 實際麥克風及朗讀仍待私人 Tailscale HTTPS 連線與手機瀏覽器版本；未聲稱已在實體手機驗收。
