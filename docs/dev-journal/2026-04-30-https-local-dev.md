# 2026-04-30 — 本地 HTTPS dev server（vite-plugin-mkcert）

**背景：** Mode A 需要在 iPhone 上實機測試相機掃 QR 與 IMU 角度追蹤。
這兩個 API（`getUserMedia` 和 `DeviceOrientationEvent.requestPermission`）
都被 iOS Safari 強制鎖在 secure context（HTTPS 或 localhost）下，
所以**本地 dev server 必須能跑 HTTPS**，否則永遠只能桌機 mock 不能上實機。

對應 GitHub issue：#32。對應 PR：#57。

---

## 0. 為什麼一定要 HTTPS

| API | 需要 secure context？ | iOS Safari 行為（HTTP 下） |
| --- | --- | --- |
| `navigator.mediaDevices.getUserMedia` | 是 | `mediaDevices` 直接是 `undefined`，連權限對話框都跳不出來 |
| `DeviceOrientationEvent.requestPermission()` | 是 | 函式不存在，沒辦法請求 IMU 權限 |
| `Permissions API` | 是 | 行為退化、查詢結果不準 |

`localhost` 算 secure context，但**用 IP 連（例如 iPhone 透過
`192.168.1.x:5173` 連到 mac）就不算**。要嘛走 HTTPS、要嘛架反向代理，
沒有第三條路。所以 dev server 一定要能簽出 LAN IP 走得到的憑證。

---

## 1. 方案比較

| 方案 | 優點 | 缺點 |
| --- | --- | --- |
| **`vite-plugin-mkcert`** ✅ | 走系統 trust store，iPhone 安裝過 mkcert root CA 之後就跟正式憑證一樣，零警告，所有 device API 行為跟 prod 一致 | 第一次要在 mac 上裝 `mkcert` + `nss`，並在 iPhone 上手動 trust root CA |
| `@vitejs/plugin-basic-ssl` | 零設定，加進去就跑 | iPhone 每次連線都要點過警告；iOS 對未信任憑證下的 `DeviceOrientationEvent.requestPermission()` 行為不穩，有時候會直接 reject |
| 反向代理（Caddy / ngrok） | 不用管前端設定 | 多一層 process、ngrok 免費版 URL 會變、設定麻煩 |

選 **`vite-plugin-mkcert`**：一次性 10 分鐘設定換到完全乾淨、跟 prod
一致的測試體驗。Mode A 的 iOS 行為差一點點都會 debug 一整天，不能省。

---

## 2. 改了哪些檔

### `apps/web/package.json` + `bun.lock`
加 `vite-plugin-mkcert@2.0.0` 到 `devDependencies`。

### `apps/web/vite.config.ts`
HTTPS 走 **opt-in env flag**（`VITE_HTTPS=1`），預設 `bun run dev` 仍是
HTTP，避免每個 contributor 第一次都要先裝 mkcert。

```ts
import mkcert from 'vite-plugin-mkcert'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // loadEnv reads .env files; process.env catches shell-level VITE_HTTPS=1
  const useHttps = env.VITE_HTTPS === '1' || process.env.VITE_HTTPS === '1'

  return {
    plugins: [
      react(),
      ...(useHttps ? [mkcert()] : []),
    ],
    server: {
      // Only bind 0.0.0.0 in HTTPS mode; HTTP mode stays localhost-only
      host: useHttps ? true : undefined,
      port: 5173,
    },
  }
})
```

`host: useHttps ? true : undefined`：Vite 預設只 bind `localhost`，手機從 LAN 連會
打不到。設成 `true` 才會在 console 印出 `Network: https://192.168.x.x:5173/`。
**注意：** 只有 HTTPS 模式才開放 LAN，避免 HTTP dev server（含 `/api` proxy）
在共用網路（公司、校園、咖啡廳 Wi-Fi）上暴露。

### `apps/web/.env.example`
加上：
```
# 開啟本地 HTTPS dev server（iPhone 實機測試 Mode A 相機 / IMU 必要）
# 第一次使用前先按 docs/dev/https-local.md 安裝 mkcert
VITE_HTTPS=
```

### `Makefile`
新增一個 target：
```makefile
web-dev-https:  ## 本地 HTTPS dev server（VITE_HTTPS=1）
	cd apps/web && VITE_HTTPS=1 bun run dev
```

### `.gitignore`
加 `*.pem` / `*.crt` / `*.key` / `.cert/` / `certs/` —— mkcert 寫出
的本地憑證**絕對不能** commit 進去（包含 private key，外洩會讓本機
的所有 mkcert 簽出憑證都失信）。

### `CLAUDE.md`
原本的「HTTPS in dev too. mkcert recommended」改成指向新 doc。

### `docs/setup.md`
舊的「getUserMedia 不能用」troubleshooting 段改成「先看 docs/dev/https-local.md」。

### `docs/dev/https-local.md`（新文件）
完整的設定指南——下一節會講內容。

---

## 3. 完整設定流程（給新人讀）

### Step 1 — 在 mac 上裝 mkcert

```bash
brew install mkcert nss   # nss 是 Firefox 用的 cert store
mkcert -install            # 把 root CA 裝進系統 / 各瀏覽器 trust store
```

`mkcert -install` 做的事：
- 產生一張本機 root CA（`~/Library/Application Support/mkcert/`）
- 把這張 CA 加進 macOS keychain、Firefox 的 NSS store
- 之後 mkcert 簽的所有憑證，瀏覽器都會當成「信任的網站」

### Step 2 — 啟動 HTTPS dev server

```bash
cd apps/web
VITE_HTTPS=1 bun run dev
# 或從 repo 根：make web-dev-https
```

第一次啟動時，`vite-plugin-mkcert` 會：
1. 偵測有沒有可用憑證，沒有就跑 mkcert 簽一張涵蓋 `localhost` + 本機 IP 的
2. 把憑證載到 Vite 的 https 設定
3. 開 server，console 印出兩條 URL：
   ```
   Local:   https://localhost:5173/
   Network: https://192.168.1.141:5173/
   ```

### Step 3 — iPhone 安裝 mkcert root CA

Vite + mkcert 在 mac 上 OK 之後，iPhone 還沒信任這張 CA，連上去會看到
「This Connection Is Not Private」警告。要走兩步：

**A. 把 root CA 傳到 iPhone**

```bash
# 找出 mkcert root CA 路徑
mkcert -CAROOT
# 通常是 /Users/you/Library/Application Support/mkcert/rootCA.pem
```

把那個 `rootCA.pem` 用 AirDrop / 雲端硬碟 / 任何方式傳到 iPhone。
iPhone 收到時會跳「下載描述檔」對話框，按下載。

**B. 安裝描述檔 + 手動信任**

iPhone 上：
1. **設定 → 已下載的描述檔**（在最上面，剛下載完才會出現）→ 安裝
2. **設定 → 一般 → 關於本機 → 憑證信任設定**
3. 找到 `mkcert ...` 那條，把它打開（**這一步最容易漏掉**）

打開之後 iPhone 才真正信任這張 CA。沒做這步的話，連線時還是會跳警告，
而且 `DeviceOrientationEvent.requestPermission()` 行為會被鎖。

### Step 4 — 從 iPhone 連

iPhone 跟 mac 接同一個 Wi-Fi，Safari 開 `https://192.168.1.141:5173/`
（IP 換成你 console 印的那個）。應該完全沒警告，鎖頭灰色或綠色。

---

## 4. 為什麼 API 不用一起 HTTPS

短答：**不用**。Vite dev 已經 HTTPS，前端透過 `VITE_API_BASE_URL`
打 `http://192.168.1.141:8000/...` 也沒問題嗎？

⚠ 注意這裡有個 trap——HTTPS 頁面打 HTTP API 會被 mixed-content 擋掉。

實務上分兩種情況：

| 情境 | 解法 |
| --- | --- |
| `localhost` 同源（API 也 `localhost:8000`） | mixed-content 例外，可以用 |
| 跨機（iPhone 連 LAN IP） | 必須 API 也 HTTPS，或 Vite 開 proxy 把 `/api` 轉發到後端 |

最簡單：在 `vite.config.ts` 開 proxy 把 `/api` 轉給後端，前端只打
relative URL `/api/...`，這樣前端 HTTPS、proxy 內部 HTTP 都沒事。
Vite 的 `/api` proxy（`/api` → `http://localhost:8000`）在此 PR 前就已
存在並保留——這個 proxy 已正確處理 LAN → API 的 mixed-content 問題，手機
透過 HTTPS dev server 打 `/api/...` 會走 proxy 轉給後端，不會有 mixed-
content 阻擋。「留給後續」指的是**從手機直接繞過 proxy 打後端 IP** 的罕
見場景（issue #34 API 部署）；常見的開發測試路徑已被 proxy 覆蓋。

---

## 5. 常見地雷

### `mkcert -install` 卡在 sudo
mkcert 寫進 system keychain 要 sudo 授權，跳出來輸入 mac 密碼即可。

### 「Connection is not private」即使裝了描述檔
99% 是漏了 Step 3-B（憑證信任設定那一步）。回去打開那個 toggle。

### iPhone 連不到 LAN IP
- 確認 iPhone 跟 mac 同一個 Wi-Fi（公司 / 校園 Wi-Fi 常常有 client
  isolation，要找 mobile hotspot 或家裡 router）
- mac firewall 擋 5173 port，到 系統設定 → Network → Firewall 把 node
  / bun 加進允許清單

### 憑證過期（90 天）
mkcert 簽的憑證有效期 825 天，但 macOS 14 之後 Safari 會把 root CA
之外簽出來的憑證強制當成 ≤ 825 天有效。日常用沒事，跨年/長期不動
時可能要重簽：刪掉 `apps/web/` 底下的 `.cert/` 或 `*.pem`，重啟
`bun run dev`，plugin 會自動重簽。

### Bundle 模式不走 mkcert
`bun run build` 是 production build，不需要 dev server，自然也不用
mkcert。Mode A 上線時 prod 端的 HTTPS 由部署平台（Cloudflare Pages /
Vercel）給。

### CI 不該裝 mkcert
CI 跑單元測試 / build 時根本沒有 dev server，`vite-plugin-mkcert`
在 build 階段不會被載入（plugin function 只有 dev 模式才被加進
plugin 陣列）。CI 不需要任何額外設定。

---

## 6. 驗證

PR 內的驗證：
- `VITE_HTTPS=1 bun run dev` 啟動成功，印出兩條 https URL
- 預設 `bun run dev` 仍是 HTTP（opt-in 行為正確）
- `bun run typecheck` 通過

待 reviewer 在實機上驗證的：
- [ ] iPhone Safari 開 LAN https URL 沒警告
- [ ] `getUserMedia` 跳出相機權限對話框（Mode A scaffold ready 之後）
- [ ] `DeviceOrientationEvent.requestPermission()` 跳出 IMU 權限對話框

---

## 7. 延伸閱讀

- [vite-plugin-mkcert 官方 README](https://github.com/liuweiGL/vite-plugin-mkcert)
- [mkcert 官方 repo](https://github.com/FiloSottile/mkcert) — 解釋 root CA 怎麼運作
- [MDN — Secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts)
- [Apple — Configure trust for a manually installed certificate profile](https://support.apple.com/en-us/102390)

---

## 8. 決策 trade-offs

**做的取捨：**
- HTTPS 走 opt-in env flag：第一次跑專案的人不需要先裝 mkcert，預設
  `bun run dev` 還是能正常跑（Mode B 桌面 / 桌機 Mode C 都不需要 HTTPS）。
  要做 Mode A iOS 測試的人才付這 10 分鐘設定費。
- 沒一起改 API 也 HTTPS：scope 控制，留給專門處理 API/proxy 的 PR。
- mkcert 沒做成 Makefile 的 install step：mkcert 只裝一次，每個人
  也要在自己 iPhone 上 trust，自動化沒意義。文件講清楚就好。

**沒做（但可以做）的事：**
- Vite proxy `/api` → backend：等 backend dev 設定明確之後再加。
- 寫個 `make ios-cert-help` 之類的指令印 mkcert root CA 路徑：目前
  doc 一行 `mkcert -CAROOT` 解掉了，沒必要包裝。
- 把 mkcert 加進 `make install`：mkcert 是全域工具，repo 不該替
  user 裝全域 brew package（會踩到他電腦設定）。
