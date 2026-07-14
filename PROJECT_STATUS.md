# Project Status: Remote Kindle Dashboard Settings

更新時間：2026-07-14（Asia/Taipei）

## 結論

2026-07-13 完成的遠端 Dashboard 設定功能與證據保留在下方，作為可驗證的歷史
紀錄。Production View Protection PR1 仍在施工；最終 local gate、GitHub CI/PR、
Vercel deployment SHA/READY、production smoke 與 Kindle post-deploy acceptance
證據均待收集。PR1 完成前，不得以歷史 deployment 或測試結果宣稱新保護已部署。

## Production View Protection PR1 狀態

- implementation：in progress
- final local and GitHub test evidence：pending
- Vercel preview/production deployment evidence：pending
- authenticated production and Kindle acceptance evidence：pending
- 本檔不保存 deployment host；需要時以 `vercel inspect` 動態取得 origin。

## Canonical Source

```text
repository: https://github.com/pcedison/kindle-LLM-token-display
branch: main
feature merge PR: https://github.com/pcedison/kindle-LLM-token-display/pull/16
feature baseline SHA: 2b44aa6e4d7205facea4f480dcb0c45afa09adf3
handoff PR: https://github.com/pcedison/kindle-LLM-token-display/pull/17
production origin: resolve dynamically with vercel inspect (not tracked)
```

`main` SHA 與 production deployment ID 會在每次文件或程式 merge 後改變，因此不在
本檔硬編。交接時已用 Vercel deployment metadata 確認 production alias 為
`READY`，且 `githubCommitSha` 與當時 GitHub/local `main` 完全相同。後續 Agent 必須
重新動態查詢，不應把 feature baseline SHA 當成目前 `main`。

## Historical Remote Settings Baseline（2026-07-13，pre-PR1）

### Vercel 設定編輯器

- 根頁提供經 `DASHBOARD_ADMIN_TOKEN` 保護的設定 editor。
- admin token 僅透過 Bearer header 傳送，React 只保留於記憶體，不寫入 URL、
  localStorage、Git 或 Kindle。
- 支援 `dp75sdi`、`kpw3`、`voyage`、`basic` 四個 profile。
- 可控制 Claude、Codex、Gemini provider card 是否顯示。
- Claude Code 與 Codex 可分別上傳不同圖片。
- 來源只接受 PNG、JPEG、WebP，最大 5 MiB。
- 瀏覽器把圖片 contain-fit 到白底、不裁切、不拉伸的 `104 x 96` opaque PNG。
- Server 會再次驗證 PNG 結構、尺寸、解碼結果、不透明度與 100 KiB 上限。
- 可選 10、20、30、40、50 秒，以及 1 至 15 分鐘整分鐘間隔。
- 12 分鐘仍是長時間顯示的建議值；10 至 50 秒是高耗電測試模式。
- 設定以完整、profile-scoped private Blob document 原子覆寫。

### Managed Dashboard 與 Device Config

- `managed=true` 會從 private Blob 讀取 provider visibility 與兩張圖片。
- 舊的 query-driven Dashboard URL 仍相容，不會被破壞。
- 新增 `/api/device-config`，只回傳：

```text
version=1
refresh_interval_seconds=<allowlisted value>
```

- 當時 Dashboard PNG 與 device-config 共用 optional `DASHBOARD_VIEW_TOKEN`；
  此為 pre-PR1 歷史契約。
- device-config 是 `text/plain`、`no-store`，不含圖片、provider、quota 或 secret。

### Kindle Runtime

- 每次下載 PNG 前先讀取遠端 device-config。
- 遠端值只接受 exact allowlist，不會 `source`、`eval` 或執行 server response。
- 無效、離線或逾時時保留上一次有效 interval；第一次失敗則使用本機 720 秒。
- HTTP client 有 20 秒硬逾時。
- Response 經 FIFO 與 `head -c 4097` bounded reader；暫存內容無法無限增長，
  且完成後拒絕超過 4096 bytes 的內容。
- Watchdog 會清理 downloader、reader、FIFO、guard 與 temporary file。
- `fetch-remote-config.sh` 已以 Git mode `100755` 追蹤。
- 原有 chrome hide/restore、power-button exit、RTC opt-in、full refresh 與 cached PNG
  行為維持不變。

## Historical Vercel Environment 狀態（2026-07-13，pre-PR1）

以下僅保留交接當時是否存在的歷史紀錄，不代表目前 deployment 狀態，也不得作為
PR1 deployment evidence：

```text
BLOB_READ_WRITE_TOKEN: present
DASHBOARD_INGEST_TOKEN: present
DASHBOARD_ADMIN_TOKEN: present in Production, Preview, Development
DASHBOARD_VIEW_TOKEN: not configured
```

2026-07-13 handoff 曾透過 stdin provision admin token，值未記錄於本檔。該次
clipboard 狀態不是現行憑證來源，也不得用於 PR1；新的 rotation、deployment 與
驗證證據仍為 pending。

## Historical Production Smoke Test（2026-07-13，pre-PR1）

以下是 PR1 之前的可驗證歷史結果，不證明 Production View Protection 已部署：

```text
GET /: 200, admin field present
GET /api/config without Bearer: 401
GET /api/device-config?profile=dp75sdi: 200
device config content type: text/plain; charset=utf-8
device config lines: exactly 2
device config interval at handoff: 720
managed PNG: HTTP 200 image/png
managed PNG cache: no-store, max-age=0, must-revalidate
managed PNG signature: valid
managed PNG dimensions: 758 x 1024
managed PNG bit depth: 8
managed PNG color type: 0 (grayscale)
managed PNG interlace: 0
```

## Historical Test 與 Review 證據（2026-07-13，pre-PR1）

以下結果屬於先前功能基線；PR1 的最終 local/GitHub/Vercel gate 仍為 pending：

```text
npm.cmd test: 226 passed, 0 failed
npm.cmd run build: passed
Git Bash sh -n for changed Kindle scripts: passed
git diff --check main...feature-head: passed
GitHub windows-test-build: passed
GitHub macos-test-build: passed
GitHub kindle-shell-syntax: passed
Vercel preview: passed
independent final review: APPROVED, no Critical or Important findings
```

Playwright 使用獨立 Chrome headless process，不使用會造成 Codex Desktop 關閉的
內建 Browser 路徑：

```text
desktop viewport: 1440 x 1000
mobile viewport: 390 x 844
horizontal overflow: none
file upload inputs: 2
refresh options: 20
loaded preview natural size: 758 x 1024
mobile rendered preview: 344 x 464.015625
```

本機視覺 artifacts 位於 ignored `artifacts/`，不屬於 release source。

## D: Kindle 遷移狀態

驗證裝置：

```text
drive: D:
label: Kindle
filesystem: FAT32
extension root: D:\extensions\kindle-dash
profile: dp75sdi
production origin: omitted from tracked status; resolve with `vercel inspect`
```

備份：

```text
D:\extensions\kindle-dash\backups\pre-remote-settings-20260713-001647
```

已更新並驗證 SHA-256 一致：

```text
dash.sh
local/fetch-dashboard.sh
local/fetch-remote-config.sh
```

`local/env.sh` 沒有以 generic template 覆蓋，而是只修改兩個 URL：

```text
DASHBOARD_URL -> /api/dashboard?profile=dp75sdi&managed=true
REMOTE_CONFIG_URL -> /api/device-config?profile=dp75sdi
```

既有 profile、RTC、低功耗與 optional view key 狀態均保留。`env.sh` shell syntax
通過，兩個 URL 各只有一行，新 helper 在掛載檔案系統上可執行。

D: 保存的兩個 URL 在 2026-07-13 pre-PR1 handoff 曾留下 device-config 720 與
`758 x 1024` grayscale PNG cache 紀錄；這只是歷史資料，不是現行 production 或
PR1 acceptance evidence。

## PR1 release gates 完成前禁止執行的 handoff actions

下列流程只保留為歷史 handoff 參考。PR1 尚未完成 merge、deployment SHA/READY、
environment、authenticated smoke 與 Kindle acceptance evidence 前，不得執行：

1. release gate 明確放行後，才安全退出 Kindle USB。
2. 確認 deployed PR1 SHA 與 READY 狀態後，才以 `vercel inspect` 取得 origin。
3. Profile 選擇 `DP75SDI / Paperwhite 2`。
4. 僅使用 PR1 維護窗口新 provision 或 rotation 的 admin credential 解鎖；不得重用
   2026-07-13 clipboard 狀態。
5. 分別為 Claude artwork 與 Codex artwork 上傳圖片；兩張可不同。
6. 選擇刷新頻率；長期使用建議 12 分鐘。
7. 按 `Save Settings`，等待 `Saved` 與完整 PNG preview 更新。
8. Kindle 進入 KUAL，執行 `Start LLM Token Dashboard`。
9. 下一輪 Wi-Fi refresh 會自動取得圖片、provider visibility 與 interval，之後修改
   網頁設定不再需要 USB。

## PR1 release 後尚待使用者驗收

- 尚未由使用者上傳最終 Claude/Codex 自訂圖片並按 Save。
- 尚未在拔線後由真機完成第一次新 runtime Wi-Fi refresh。
- 尚未實際觀察使用者選定 interval 的兩個連續週期。
- 尚未由使用者確認長期運作時背面溫度與耗電；12 分鐘應作為基準。
- PR1 admin credential 的 provision/rotation 與安全交付證據尚待建立；不得依賴
  2026-07-13 clipboard 狀態。

## 刻意未實作

- Vercel 直接登入 consumer Claude/ChatGPT subscription。
- 把 provider OAuth、browser cookie 或官方客戶端 credential 放入 Vercel。
- API key 取代 consumer subscription 的 5-hour/7-day quota surface。
- 每台 Kindle 保存不同的 managed configuration；目前每 profile 一份設定。
- 任意秒數輸入；目前只允許固定 allowlist。
- SVG 或 remote image URL upload。
- 讓 Windows 或 Mac 為 dashboard 長時間保持開機。

## 已知限制

- Claude/Codex consumer quota 仍是 event-driven eventually consistent；所有 desktop
  關機時，手機活動要等下一次可觀察的 desktop event 才會收斂。
- 10 至 50 秒會讓 Wi-Fi 與 e-ink refresh 更頻繁，耗電與溫度明顯高於 12 分鐘。
- Kindle 每輪會先讀小型 device-config，再讀 PNG；遠端設定失敗不會覆蓋 last-known
  interval 或 cached PNG。
- FAT32 不保存 Git executable mode，但 Kindle 掛載權限與實機既有 shell 執行方式已驗證。

## Codex Desktop 中斷調查

2026-07-12 的三次 Codex Desktop 無預警關閉均發生在內建 Browser hidden WebView
attach 後；日誌出現 `mcp_app_sandbox.attach_unmatched` 與 invalid/undefined URL，之後
AppX container 被銷毀。Windows 沒有 OOM、WER 或 crash dump。Chrome extension 的
舊 `extension-host` 也曾在 Codex App restart 後保持 stale WebSocket state。

後續工作避免使用 Codex 內建 Browser；視覺驗證優先使用獨立 Playwright/Chrome
process。這是工具層問題，不是 Kindle、Vercel 或本 repo runtime crash。

## 下一個 Agent 快速接手

1. 先讀本檔、`README.md`、`docs/ARCHITECTURE.md`、`docs/SECURITY.md`。
2. 執行 `git status --short --branch`，只允許歷史 `.recovery/` 保持 untracked。
3. 執行 `git fetch origin main` 並確認 local/remote `main` SHA 相同。
4. 用 Vercel metadata 確認 production deployment 仍是 READY，不要只看 Git push。
5. 不要輸出 `.env.local`、Vercel env value、Kindle `env.sh`、Bearer header 或 clipboard。
6. 若使用者完成圖片 Save，驗證 config version、interval 與 PNG metadata，不要回傳
   base64 artwork。
7. 若 Kindle 真機刷新失敗，先查看 credential-free `logs/dash.log` 尾端，再比較
   tracked runtime SHA；不要先覆蓋 private `env.sh`。

## 後續可優化

- 增加 metadata-only installation health endpoint，不暴露 quota 或設定內容。
- 提供 signed Kindle extension release artifact，降低手動 copy 需求。
- 對 settings editor 新增 client-side crop-position preview，但維持 contain-fit 預設。
- 增加正式 demo deployment 的無 secret production PNG smoke workflow。
- 研究 old Kindle BusyBox 上更細粒度且低成本的 HTTP deadline primitive。
- 補 personal Mac Keychain/LaunchAgent 的實機 enrollment acceptance。
