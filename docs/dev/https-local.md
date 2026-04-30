# 本地 HTTPS 開發設定

> **TL;DR：** `brew install mkcert nss && mkcert -install`，然後
> `make web-dev-https`。從 iPhone 開 `https://<你的 LAN IP>:5173` 就能
> 測 Mode A。

---

## 為什麼需要 HTTPS？

Mode A 在手機上需要兩個只在 **secure context** 才能用的瀏覽器 API：

- **`navigator.mediaDevices.getUserMedia`** — 鏡頭串流（用來掃 QR）。
  非 HTTPS 直接抓不到 `mediaDevices`。
- **`DeviceOrientationEvent.requestPermission()`** — iOS 13+ 限定，沒
  HTTPS 連函式都不存在，IMU 旋轉資料拿不到。

`localhost` 算 secure context，但**從手機透過區網 IP 連電腦**就不算了
（手機不是在 `localhost`）。所以要在電腦上開 HTTPS dev server，並讓
iPhone 信任那張本地憑證。

> 為什麼不直接用自簽（`@vitejs/plugin-basic-ssl`）？— 自簽簡單，但
> iPhone 每次都會跳「不安全的網站」警告，而且某些 API（特別是要點
> 過 permission 提示的）在不被信任的憑證上行為怪異。mkcert 產生
> 的憑證走系統 trust store，在 iPhone 安裝過 root CA 之後就跟正式
> 憑證沒區別，測試體驗順得多。

---

## 一次性設定

### 1. 在 Mac 上裝 mkcert

```bash
brew install mkcert nss
mkcert -install
```

- `mkcert` 是 Filippo Valsorda 寫的工具，幫你產生 **本地受信任的**
  TLS 憑證，不用每次按「我了解風險」。
- `nss` 是 Firefox / Chromium 用的 NSS 函式庫；裝了 mkcert 才能把 root
  CA 推進去。如果你不用 Firefox，不裝也行，但裝了沒壞處。
- `mkcert -install` 把 mkcert 自簽的 root CA 安裝到 macOS keychain
  與 Firefox（如果有）。從這刻起，這台 Mac 上由 mkcert 簽出來的
  憑證都被視為合法。

`vite-plugin-mkcert` 會在第一次啟動 dev server 時呼叫 mkcert 產生
`localhost` + LAN IP 的憑證，並 cache 在 `node_modules/.vite-plugin-mkcert/`
底下。憑證檔不會出現在 repo（已 gitignore `*.pem`）。

### 2. 找出你的 LAN IP

iPhone 要連的不是 `localhost`，是 Mac 在區網的 IP。

```bash
# macOS（Wi-Fi）
ipconfig getifaddr en0

# 或全部介面看一遍
ifconfig | grep "inet " | grep -v 127.0.0.1
```

通常會是 `192.168.x.x` 或 `10.0.x.x`。

### 3. 把 mkcert root CA 裝進 iPhone

這是讓 iPhone 信任 mkcert 簽出來的憑證的關鍵。漏掉這步，Safari
會跳「此連線非私人」，雖然你還是能點過去，但 iOS 會把 device API 鎖死。

```bash
# 在 Mac 上找 root CA 的位置
mkcert -CAROOT
# → /Users/<you>/Library/Application Support/mkcert
```

把那個資料夾裡的 `rootCA.pem` 傳到 iPhone：AirDrop 最快，或用 iCloud
雲碟、email 給自己也行。

iPhone 上：

1. 收到 `rootCA.pem`，點開 → 系統會說「描述檔已下載」。
2. **設定 → 一般 → VPN 與裝置管理 → 已下載的描述檔 → mkcert** → 安裝。
3. **設定 → 一般 → 關於 → 憑證信任設定** → 把 `mkcert ...` 那一條
   開啟（Enable Full Trust for Root Certificates）。

裝完一次就好，重開 dev server / 換 Mac 才需要再做。

---

## 日常使用

### 啟動 HTTPS dev server

```bash
# 從 repo 根目錄
make web-dev-https

# 或直接
cd apps/web && VITE_HTTPS=1 bun run dev
```

`bun run dev`（不帶 `VITE_HTTPS=1`）維持原本的 HTTP 行為，HTTPS 是
**opt-in**。

第一次啟動 mkcert 會產出憑證，你會看到類似：

```
  ➜  Local:   https://localhost:5173/
  ➜  Network: https://192.168.1.42:5173/
```

### 從 iPhone 連

1. 確認 iPhone 跟 Mac 在**同一個 Wi-Fi**。
2. Safari 開 `https://<你的 LAN IP>:5173`（用上面 `ipconfig getifaddr en0`
   拿到的 IP）。
3. 沒看到憑證警告 = root CA 裝對了。看到警告 = 回去做「裝進 iPhone」那段。

### API（FastAPI）需要 HTTPS 嗎？

Vite dev server 已經 proxy `/api/*` 到 `http://localhost:8000`，前端
看到的全部請求都是同源、HTTPS 的。**uvicorn 不用另外開 HTTPS**——
proxy 會幫你轉內部那段 plain HTTP，瀏覽器只會跟 Vite 講 HTTPS。

只有當你想**繞過 proxy 直接從手機打 API**（少見）才需要給 uvicorn
本身配 cert。

---

## 常見地雷

- **`mkcert: command not found`** — Homebrew 把它裝在 `/opt/homebrew/bin`
  （Apple silicon）或 `/usr/local/bin`（Intel）。確認那個路徑在你的
  `PATH` 裡。
- **iPhone 還是看到「不安全」** — 99% 是漏了「憑證信任設定」那一步
  （只裝描述檔不夠，還要去把 trust 打開）。
- **`getUserMedia` 還是 reject** — 確認網址列真的是 `https://`，不是
  自動 redirect 到 `http://`。Safari 偶爾會擺爛，把網站從「歷史」清掉
  再試。
- **換 Wi-Fi、IP 變了** — 重啟 dev server，mkcert plugin 會偵測到新的
  hostname / IP 並重簽。憑證 cache 在 `node_modules/.vite-plugin-mkcert/`，
  必要時可以整個刪掉重來。
- **憑證有效期過了（13 個月）** — 刪 cache 重啟即可。

---

## 為什麼選 vite-plugin-mkcert？

| 方案 | 一次性設定 | iPhone 警告 | 自動重簽 LAN IP |
|------|------------|-------------|------------------|
| `vite-plugin-mkcert`（採用） | mkcert + iPhone 信任 root CA 一次 | 沒有（已信任） | 自動 |
| `@vitejs/plugin-basic-ssl` | 零 | 每次都要手動繞過 | N/A（自簽 wildcard） |
| 自己 `mkcert` + `--https` flag | 手動跑指令、手動指路徑 | 沒有 | 手動重簽 |

選 plugin 版本，因為 dev 體驗最順——首次設定大概 10 分鐘，之後完全
自動，iPhone 像連正式網站一樣。
