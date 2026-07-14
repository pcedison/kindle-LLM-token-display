# Project Status: Scope Reset

更新時間：2026-07-14（Asia/Taipei）

## 結論

專案已退役整套 2026-07-13/14 巨型 hardening execution plans（包含已完成的 PR1 與
required-view-key 計畫），改回一條可驗證的最短交付線：
Kindle refresh 必須有界且不得以壞 candidate 覆蓋 cache；collector 只接受精確 upload
acknowledgement；互斥鎖不得搶走仍活著的工作；macOS 明確維持 Beta；release 只以
GitHub、Vercel 與真機證據判定。

目前工作分支為 `codex/scope-reset`。本檔記錄的是工作狀態，不代表尚未 merge 的變更
已部署。

## Canonical Source

```text
repository: https://github.com/pcedison/kindle-LLM-token-display
deployment branch: main
scope-reset branch: codex/scope-reset
production origin: resolve dynamically; never store an authenticated URL here
```

2026-07-14 audit 起點：GitHub `main`、PR #22 merge 與當時 production deployment
metadata 均對齊 `a2130577b013a26cc9de1d7df84cfecdc6f5e908`，checks 5/5 成功。
後續必須重新查詢，不得把這個 SHA 當成 scope-reset release SHA。

## Scope-reset 交付內容

- Kindle：download 最長 60 秒、檔案大小與 envelope 檢查有界、refresh interval 精確
  allowlist。
- Kindle：production 先寫 candidate；只有 `eips` 回傳成功才升格為 cache，失敗時重畫
  舊 cache。
- Collector：只有 HTTP 200、`application/json`、精確
  `{ "ok": true, "collectedAt": <canonical ISO> }` 才記錄 upload success。
- Collector：`/api/usage` 的成功與錯誤回應皆為 `Cache-Control: no-store`。
- Collector：每次執行使用 immutable UUID claim；過期但 PID 仍活著時不得搶鎖。
- macOS：Keychain secret 經有界 stdin 寫入，不再放入 process argv；v2 item 由同一 helper
  讀寫，舊 item 只在 v2 read-back 成功及安裝完成後移除；在 real-Mac 完整
  install/rollback/uninstall 驗收前維持 Beta。
- Repository：移除過期的 test-count/coverage ratchet 與 2026-07-13/14 execution plans。

## 已驗證

- clean worktree audit baseline：`npm.cmd test` 與 `npm.cmd run build` 成功。
- Kindle：`node --test tests/kindleDownload.test.mjs tests/kindleScripts.test.mjs tests/kindleSecurity.test.mjs` 成功。
- Collector：`node --test tests/collectorUpload.test.mjs tests/collectorState.test.mjs tests/usageIngest.test.mjs` 成功。
- macOS portable：`node --test tests/collectorMacos.test.mjs tests/collectorUpload.test.mjs` 成功。
- staged final gate：`npm.cmd run verify`、所有 tracked shell 的 `bash -n` 與
  `git diff --check` 成功；PR CI 仍須在 GitHub 重新執行。

## 尚未完成／外部 blocker

- Scope-reset 已有本地 commits，但尚未 push、PR、merge 或 deploy；不得稱為 production fix。
- Kindle volume 目前未掛載，無法同步 runtime、以真機驗證壞 PNG 的 `eips` exit status，
  或觀察兩個連續 refresh cycle。
- 沒有可用的 personal Mac acceptance session；macOS 只能維持 Beta。
- Production authenticated admin smoke 需要操作員當場提供 SecureString；不得從文件、
  argv、log 或 clipboard 歷史重建。

## Stop Rules

- 不重啟已退役 execution plans，也不以增加測試數或 coverage 百分比作為工作目標。
- 不為 theoretical flexibility 建新 framework、transaction engine、protocol layer 或
  release bureaucracy；先修可重現的 runtime failure。
- 測試只保留能證明行為邊界的案例，不用固定總數阻擋刪除重複測試。
- 沒有 deployment SHA/READY 與真機證據時，明確標為 pending，不以歷史證據代替。

## 下一步

1. 跑完整 `npm run verify`、shell syntax 與 diff checks。
2. 獨立 Reviewer 確認沒有 blocking finding。
3. 小型 commits → push → PR → CI。
4. merge 後核對 production deployment SHA/READY 與安全 smoke。
5. Kindle 掛載後再做 runtime hash、壞圖 fallback 與兩個 refresh cycle；此前不得猜測。

詳細但仍保持短小的邊界見 [Scope Reset Runbook](docs/SCOPE-RESET.md)。
