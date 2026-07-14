# Project Status: Scope Reset

更新時間：2026-07-14（Asia/Taipei）

## 結論

Scope reset 的產品變更已由 PR #23 合併至 `main`。目前 release 狀態是：

```text
server deployed, device pending
```

伺服器、collector、Kindle runtime 邊界與 portable macOS Beta 已完成可自動驗證的交付；
Kindle 真機與 personal Mac acceptance 仍須在實體環境完成。不要重啟已退役的
2026-07-13/14 hardening execution plans，也不要把外部裝置未出現誤判成需要更多模擬框架。

## Canonical Source

```text
repository: https://github.com/pcedison/kindle-LLM-token-display
deployment branch: main
product release PR: https://github.com/pcedison/kindle-LLM-token-display/pull/23
product merge SHA: b0892988228664e662359266806a3c09ba0cc784
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
- Production anonymous smoke：首頁 200；未授權 dashboard/device-config 皆為 401 且
  `no-store`。
- Production authenticated view smoke：dashboard 回傳 200、758 x 1024、8-bit grayscale
  PNG 且 `no-store`；device config 回傳 200、固定有界格式且 `no-store`。驗證過程未輸出
  token、holder path 或含 key URL。

## 外部 blocker

- Kindle volume 目前未掛載，無法同步 runtime、以真機驗證壞 PNG 的 `eips` exit status，
  或觀察兩個連續 refresh cycle。
- 沒有可用的 personal Mac acceptance session；在真實 Keychain、LaunchAgent、rollback、
  reinstall、uninstall 全流程驗收前，macOS 必須維持 Beta。
- Production authenticated admin smoke 需要操作員當場提供 SecureString；不得從文件、
  argv、log 或 clipboard 歷史重建。這不推翻已完成的 view path 與 server deployment。

## Stop Rules

- 不重啟已退役 execution plans，也不以增加測試數或 coverage 百分比作為工作目標。
- 不為 theoretical flexibility 建新 framework、transaction engine、protocol layer 或 release
  bureaucracy；只處理可重現的 runtime failure。
- 裝置或 personal Mac 不存在時，直接標為 external blocker，不建立替代模擬流程假裝驗收。
- 沒有新的失敗證據時，不再修改已通過的 server/collector/Kindle 邊界。

## 下一步

1. Kindle 掛載後，只做 runtime hash、valid/corrupt fixture 的 `eips` status 與兩個 refresh
   cycle 驗收。
2. 有 personal Mac session 後，只做固定的 install/rollback/reinstall/uninstall acceptance；
   通過前維持 Beta。
3. 若需要 admin production smoke，由操作員當場提供 SecureString；不要新增 credential
   recovery 流程。

詳細邊界與停止條件見 [Scope Reset Runbook](docs/SCOPE-RESET.md)。
