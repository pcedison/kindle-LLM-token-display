# Scope Reset Runbook

這份 runbook 取代整套 2026-07-13/14 hardening execution plans，包含已完成的 PR1 與
required-view-key 計畫。它只回答三件事：現在要保護什麼、如何證明、何時停止。

## 1. Canonical 與基線

- 只從 `https://github.com/pcedison/kindle-LLM-token-display` 的 `main` 建立乾淨工作區。
- 開工前記錄 remote `main`、production deployment SHA/READY 與 worktree dirty state。
- production URL、Bearer token、Keychain value、Kindle private `env.sh` 不寫入 repo 或 log。

完成條件：來源與部署身份可動態重建；不依賴某個歷史資料夾或 clipboard。

## 2. Kindle refresh 邊界

- remote config 與 PNG 下載都有 1–60 秒 deadline。
- PNG 寫入有 OS file-size 上限與後置精確 4 MiB gate；shell 只讀固定 33-byte envelope，
  沒有依 response chunk 數成長的 parser loop。
- refresh interval 只接受既有 allowlist；無效值回到 720 秒。
- shell parser 只判斷 envelope。production cache promotion 以真正的 `eips` exit status
  為準：candidate decode 成功才 atomic rename，否則刪除 candidate 並重畫舊 cache。

完成條件：stall、oversize、非 PNG、錯 profile、空 IDAT、eips failure 都不能破壞舊
cache；真機仍須驗 valid/corrupt fixture 的 eips status 與兩個連續 refresh cycle。

## 3. Collector 成功與互斥

- upload success 必須是 status 200、JSON media type、最大 4096 bytes、精確兩欄 ACK。
- ACK 驗證前不得更新 `last-upload.json`；任何 failure 只寫既有 backoff。
- `/api/usage` 的 route-owned 200/400/401/413/503 全部 `no-store`。
- lock 使用 `collector.lock.d/<uuid>.json`。活 PID 永遠 blocking；只清除過期且兩次確認
  PID 已不存在的 unique claim；malformed claim fail closed。

完成條件：invalid ACK 不動 last-success、平行 action 不 overlap、活 PID 不因 TTL 被搶。

## 4. macOS Beta

- token 只從 prompt/stdin 進入 bounded Keychain helper，不放入 argv、env、config、plist、
  manifest 或 log；runtime 由同一 helper identity 讀取。
- legacy item 保持不動，直到 v2 item 完成 write/read-back 且安裝成功；migration 失敗即回滾
  v2，不先破壞舊 credential。
- portable tests 與 macOS CI 不是 real-Mac acceptance 的替代品。
- 在 personal Keychain、LaunchAgent、rollback、reinstall、uninstall 全流程實測前，README
  與 runbook 必須保留 Beta 標示。

完成條件：real-Mac acceptance 有固定的 pass/fail 證據且不輸出 secret；否則維持 Beta。

## 5. Repository gate

```text
npm run verify
bash -n <changed shell files>
git diff --check
```

不再維護固定 test count 或 coverage baseline。刪除重複測試、舊 plan 或死 code 不應因
數字下降而失敗；真正的產品行為 gate 必須繼續通過。
歷史 design/spec 中的固定 count 與 coverage 敘述也不再是現行 gate。

## 6. Release 與停止點

- local commit、GitHub PR/CI、merge、Vercel deployment、production smoke、Kindle acceptance
  是六個不同狀態，逐一回報。
- production deployment 必須以 merge SHA 與 READY metadata 核對。
- 裝置未掛載、Mac session 不存在或 admin SecureString 未提供時，標為 external blocker；
  不建立替代性模擬流程來假裝完成。
- merge 後若 production smoke 成功但真機尚未驗收，release 狀態是「server deployed，
  device pending」，不是 fully accepted。
