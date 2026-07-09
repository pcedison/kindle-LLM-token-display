# Kindle LLM Token Dashboard

這個專案在 Vercel 上輸出 Kindle 友善的 PNG dashboard。Kindle 端建議只抓取
`/api/dashboard` 的圖片，再用 `eips` 顯示；不要讓舊 Kindle 瀏覽器直接跑
Next/React 頁面。

## Vercel URL

部署到 Vercel production 後，Kindle 端使用固定 production domain：

```text
https://YOUR-PROJECT.vercel.app/api/dashboard?profile=dp75sdi&claude=true&openai=true&gemini=false
```

如果 Vercel 專案有綁定 GitHub，推送到 production branch（通常是 `main`）後，
Vercel 會自動建立 production deployment。Kindle 下一次抓取同一個 URL 時，就會
取得新的圖片。

## Kindle Profiles

`profile` 會決定輸出圖片解析度與版面縮放：

| Profile | Size | Use case |
| --- | ---: | --- |
| `dp75sdi` | `758x1024` | Kindle Paperwhite 2 / DP75SDI safe default |
| `kpw3` | `1072x1448` | Kindle Paperwhite 3 |
| `voyage` | `1080x1440` | Kindle Voyage |
| `basic` | `600x800` | Kindle Basic |

實機解析度不確定時，可以手動覆寫：

```text
https://YOUR-PROJECT.vercel.app/api/dashboard?profile=dp75sdi&w=758&h=1024
```

## Provider Toggles

可用 query string 控制顯示項目：

```text
claude=true
openai=true
gemini=false
```

## Kindle 端建議流程

抓圖後使用完整 refresh 顯示：

```sh
/usr/sbin/eips -f -g /mnt/us/dashboard/dash.png
```

若 dashboard 腳本會停止 Kindle framework，請準備一個恢復腳本，避免只能長按電源
重啟：

```sh
#!/usr/bin/env sh
pkill -f dash.sh
lipc-set-prop com.lab126.powerd preventScreenSaver 0
/etc/init.d/framework start
initctl start webreader >/dev/null 2>&1
/usr/sbin/eips -c
```

## 實機尺寸排查

用 SSH 進 Kindle 後可查：

```sh
eips -i
for f in virtual_size modes bits_per_pixel stride; do
  echo "$f=$(cat /sys/class/graphics/fb0/$f 2>/dev/null)"
done
free -m
```

不要公開 serial、token、cookie 或完整 Authorization header。

## Local Commands

```sh
npm test
npm run build
```
