# Project Status: Kindle Acceptance Complete

更新時間：2026-07-16（Asia/Taipei）

## 結論

Scope reset 的產品變更已由 PR #23 合併至 `main`；Kindle 修正與真機驗收紀錄已由
PR #26 合併，production server 與 DP75SDI Kindle runtime 均已完成驗收。目前 release
狀態是：

```text
server deployed, Kindle accepted, macOS beta
```

伺服器、collector 與 Kindle runtime 已完成交付；canonical `main` 包含通過自動測試與
DP75SDI 真機驗收的版本。portable macOS collector 仍是 Beta，因為 personal Mac acceptance
依使用者指示暫緩。不要重啟已退役的 2026-07-13/14 hardening execution plans，也不要把
尚未提供的 Mac session 誤判成需要更多模擬框架。

## Canonical Source

```text
repository: https://github.com/pcedison/kindle-LLM-token-display
deployment branch: main
product release PR: https://github.com/pcedison/kindle-LLM-token-display/pull/23
product merge SHA: b0892988228664e662359266806a3c09ba0cc784
Kindle acceptance branch: codex/fix-kual-overlay
Kindle acceptance base: ba346705d81649b97346fa50e506ad35450a4cc0
Kindle acceptance PR: https://github.com/pcedison/kindle-LLM-token-display/pull/26
Kindle acceptance merge SHA: 1d255566f844713ab8817eae8fd1a4e545c5065a
production origin: resolve dynamically; never store an authenticated URL here
```

Scope-reset 驗收時，GitHub `main`、PR #23 merge、GitHub Production deployment 與
Vercel READY metadata 均已對齊上列 product merge SHA。後續文件或維護 commit 可能讓
`main` 前進；每次 release 仍須重新查詢，不得把歷史 deployment ID 當成現況。

## 已交付的邊界

- Kindle：download 最長 60 秒、檔案大小與 envelope 檢查有界、refresh interval 使用精確
  allowlist。
- Kindle：production 先寫 candidate；只有真正的 `eips` 回傳成功才升格為 cache，失敗時
  刪除 candidate 並重畫舊 cache。
- Kindle：KUAL one-shot draw 延後到 KUAL action 返回後執行，避免 KUAL 視窗重新覆畫；
  dashboard daemon 監看 Paperwhite 2 可觀察的 raw `powerd` 實體按鍵紀錄，在
  `preventScreenSaver=1` 阻止一般 sleep event 時仍可安全停止並恢復原生 UI。
- Kindle：start/stop 僅處理 command 與 cwd 都符合的 owned daemon，涵蓋 absolute 與舊版
  `./dash.sh`，使用有界 TERM→KILL 與 final absence gate，避免 PID reuse 或停止失敗後誤報。
- Collector：只有 HTTP 200、`application/json`、精確
  `{ "ok": true, "collectedAt": <canonical ISO> }` 才記錄 upload success。
- Collector：`/api/usage` 的成功與錯誤回應皆為 `Cache-Control: no-store`。
- Collector：每次執行使用 immutable UUID claim；過期但 PID 仍活著時不得搶鎖。
- macOS：Keychain secret 經有界 stdin 寫入，不放入 process argv；v2 item 由同一 helper
  讀寫，舊 item 只在 v2 read-back 與安裝成功後移除。
- Repository：已移除過期的 test-count/coverage ratchet 與 2026-07-13/14 execution plans，
  由短版 [Scope Reset Runbook](docs/SCOPE-RESET.md) 取代。

## 驗證證據

- isolated clean worktree 的 `npm.cmd run verify` 成功：當次完整 suite 全數通過且 Next.js
  production build 成功；test count 只記錄當次證據，不是永久 ratchet。
- 所有 tracked shell 通過 `bash -n`，`git diff --check` 成功。
- 獨立 Reviewer 最終回報無 P0–P3 finding。
- PR #23 的 Windows、macOS、Kindle shell、Vercel 與 Vercel Preview Comments checks 全綠；
  merge 後 `main` push CI 的 Windows、macOS、Kindle shell jobs 也全綠。
- PR #26 的 Windows、macOS、Kindle shell、Vercel 與 Vercel Preview Comments checks 全綠；
  merge SHA `1d25556` 的 `main` push CI 全綠，Vercel production deployment 為 `READY` 且
  metadata 精確對應該 SHA。
- Production anonymous smoke：首頁 200；未授權 dashboard/device-config 皆為 401 且
  `no-store`；未授權 admin config 亦為 401 且 `no-store`。
- Production authenticated view smoke：dashboard 回傳 200、758 x 1024、8-bit grayscale
  PNG 且 `no-store`；device config 回傳 200、固定有界格式且 `no-store`。驗證過程未輸出
  token、holder path 或含 key URL。
- Production authenticated admin smoke：admin token 已依操作員同意旋轉並以受保護方式保存；
  GET/PUT smoke 成功，過程未輸出 token、Authorization header 或私密 URL。
- DP75SDI 真機：Display Test Frame 與 Display Cached Dashboard 均無 KUAL overlay；valid
  dashboard、corrupt candidate rejection、cache preservation 與多個 remote refresh cycle 成功。
- DP75SDI 真機：raw power-button probe 證實 `powerd` 在 `preventScreenSaver=1` 時先忽略按鍵；
  修正版 watcher 隨後捕捉實體短按、停止 daemon、移除 PID 並恢復 Kindle framework。10 秒
  cadence 下停止前競態產生 1 次最後刷新，停止後刷新為 0。
- 裝置同步後 6 個 runtime/menu 檔案 SHA-256 與 reviewed source 一致；私密 `env.sh` 與
  部署前備份一致，production remote refresh 仍為 10 秒。詳細證據見
  [Kindle acceptance record](docs/KINDLE-ACCEPTANCE-2026-07-16.md)。

## 外部 blocker

- 沒有可用的 personal Mac acceptance session；在真實 Keychain、LaunchAgent、rollback、
  reinstall、uninstall 全流程驗收前，macOS 必須維持 Beta。

## Stop Rules

- 不重啟已退役 execution plans，也不以增加測試數或 coverage 百分比作為工作目標。
- 不為 theoretical flexibility 建新 framework、transaction engine、protocol layer 或 release
  bureaucracy；只處理可重現的 runtime failure。
- 裝置或 personal Mac 不存在時，直接標為 external blocker，不建立替代模擬流程假裝驗收。
- 沒有新的失敗證據時，不再修改已通過的 server/collector/Kindle 邊界。

## 下一步

1. DP75SDI 不需再執行 release-blocking 驗收；日常使用若出現新的可重現問題，再以裝置 log
   與對應 source SHA 診斷。
2. 有 personal Mac session 後，只做固定的 install/rollback/reinstall/uninstall acceptance；
   通過前維持 Beta。
3. 其他 Kindle firmware/model 的 sleep/wake 行為屬額外相容性驗證，不阻擋已驗收的
   DP75SDI 路徑。

詳細邊界與停止條件見 [Scope Reset Runbook](docs/SCOPE-RESET.md)。
