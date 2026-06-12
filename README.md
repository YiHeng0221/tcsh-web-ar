# tcsh-web-ar

一個大型互動藝術裝置的 Web AR 體驗。觀展者在現場掃 marker，透過手機
鏡頭將貼圖「塗」到實體物件上，也能在同一個網站瀏覽整件作品的完整
3D 模型。創作者透過受保護的後台管理貼圖與定位。

---

## 目錄

- [概述](#概述)
- [使用者模式](#使用者模式)
- [整體架構](#整體架構)
- [Repo 結構](#repo-結構)
- [資料模型](#資料模型)
- [素材策略](#素材策略)
- [身分驗證與後台存取](#身分驗證與後台存取)
- [效能考量](#效能考量)
- [環境與部署](#環境與部署)
- [技術棧](#技術棧)
- [快速開始](#快速開始)
- [Scripts](#scripts)
- [Roadmap](#roadmap)

---

## 概述

`tcsh-web-ar` 是一個 monorepo，用**單一 web origin** 提供三種不同的
體驗（mode A / B / C）。三種 mode 共用素材、身分驗證狀態與單一後端
API。目標是：觀展者走進展場、用手機打開網站、掃 marker、**立刻開始
互動**——不用裝 app、不用註冊。

專案分成兩個 app：

- **`apps/web`** — 面向公眾的單頁應用。同時承載 mode A（AR 塗鴉）、
  mode B（3D 模型檢視）、mode C（創作者後台）。
- **`apps/api`** — REST/JSON 後端。負責 artwork metadata、貼圖記錄、
  placement 座標、auth session 以及檔案上傳簽 URL。

---

## 使用者模式

### Mode A — 現場 AR 塗鴉

1. 觀展者從展場入口的 QR code 進入網站。
2. 啟動鏡頭。現場**一至兩個實體錨點 marker** 用來校準觀展者相對於
   作品的位置。
3. 實體作品上有 **200–300 個獨立物件**（面板、雕塑元件等）。每個
   物件在作品的局部座標系中都有已知位置。
4. 當觀展者把鏡頭對準某個物件時，網站會把貼圖疊加上去，並與物件的
   真實位置對齊。
5. 因為物件數量到達數百個，**貼圖資源採用 lazy load**，依照鏡頭可視
   範圍的接近度優先載入。

**追蹤策略：** 基於 marker 的影像追蹤（MindAR / AR.js 類）是基線。
入口 QR code 編碼的是 session/展覽 ID；真正的 pose 追蹤來自放在作品
上已知位置的影像 marker。

### Mode B — 手持 3D 檢視

1. 使用者從同一個網站切換到 Mode B。
2. 完整作品以**加上貼圖的 3D 模型**（glTF / GLB）載入。
3. 手勢可以縮放、旋轉、調整大小。
4. 使用的是跟後端同一份 texture records，所以 Mode B 永遠會反映
   Mode A / Mode C 當下的設定。

### Mode C — 創作者後台

1. 透過**經過 hash 混淆的 base path** 存取（例如
   `/_studio/<random-token>`），並且要登入。
2. 創作者可以：
   - 上傳新的貼圖。
   - 把貼圖指派給作品上的某個物件。
   - 微調 UV offset、scale、rotation 做精細定位。
   - 在 Mode A / Mode B 預覽尚未存檔的變更。
3. 在概念上跟公開 app **共用 route**，但後台介面只能透過密徑 + 登入
   進入——公開 app 的 UI **完全沒有**可以讓觀展者切換到 Mode C 的
   入口。

---

## 整體架構

```
           ┌─────────────────────────────────────────┐
           │               apps/web                  │
           │  ┌────────┐  ┌────────┐  ┌───────────┐ │
           │  │ Mode A │  │ Mode B │  │ Mode C    │ │
           │  │ AR     │  │ 3D     │  │ Admin     │ │
           │  │ paint  │  │ viewer │  │ (gated)   │ │
           │  └────┬───┘  └────┬───┘  └─────┬─────┘ │
           │       │           │            │       │
           │       └─────┬─────┴────────────┘       │
           │             │ shared state / API client │
           └─────────────┼─────────────────────────┘
                         │  HTTPS (JSON)
                         ▼
           ┌─────────────────────────────────────────┐
           │               apps/api                  │
           │  auth · artworks · objects · textures · │
           │  placements · upload-signing            │
           └──────┬────────────────────────┬─────────┘
                  │                        │
                  ▼                        ▼
           ┌────────────┐          ┌──────────────────┐
           │ PostgreSQL │          │ Object Storage   │
           │ (metadata) │          │ (textures, GLB)  │
           └────────────┘          └──────────────────┘
```

**核心原則：** 後端握有*定位真理*（哪張貼圖貼到哪個物件、以什麼
transform 貼）。前端負責*渲染*跟*輸入*。二進位素材放在物件儲存，經
CDN 遞送。

---

## Repo 結構

```
tcsh-web-ar/
├── apps/
│   ├── web/                # React + Vite + Bun
│   │   ├── src/
│   │   │   ├── modes/
│   │   │   │   ├── a-ar/         # AR 塗鴉 mode
│   │   │   │   ├── b-viewer/     # 3D 檢視 mode
│   │   │   │   └── c-admin/      # 創作者後台
│   │   │   ├── lib/              # AR 追蹤、3D helper、api client
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── vite.config.ts
│   └── api/                # FastAPI + uv
│       ├── src/
│       │   └── tcsh_ar_api/
│       │       ├── main.py           # FastAPI app 進入點
│       │       ├── config.py         # pydantic-settings 讀設定
│       │       ├── db/               # SQLAlchemy base + async session
│       │       ├── health/           # health check router
│       │       ├── auth/             # Supabase JWT 驗證
│       │       ├── anchors/          # 站點 domain (router/schemas/repo/service/models)
│       │       ├── objects/          # 物件 domain（同上結構）
│       │       ├── placements/       # 物件 placement（同上結構）
│       │       └── textures/         # 貼圖 domain + Supabase Storage helper
│       ├── tests/
│       ├── Dockerfile
│       ├── pyproject.toml
│       └── uv.lock
├── docs/
│   ├── setup.md                      # 逐步安裝設定
│   ├── docker.md                     # Docker 初學指南
│   ├── fastapi.md                    # FastAPI 學習筆記
│   └── dev-journal/                  # append-only 開發日誌
├── docker-compose.yml                # dev 環境
├── Makefile                          # 指令協調
├── CLAUDE.md
├── README.md
└── .gitignore
```

---

## 資料模型

MVP schema（名稱暫定，非最終）。使用者與 auth 由 Supabase Auth 內建
的 table 負責——下面只列我們要建立的應用 table。

- **`artworks`** — 一個展品一筆。`id`、`slug`、`title`、`model_url`
  （glTF）、`coordinate_system_notes`。
- **`ar_objects`** — 作品上 200–300 個獨立物件。`id`、`label`、
  `description`。物件本身不帶 transform；位置與姿態交給 `placements`
  （見下一行），因為同一物件可能在不同 station 有不同 placement。
  表名用 `ar_objects` 避開 Python `object` / `objects` 模組命名衝突。
- **`textures`** — 上傳的貼圖資源。`id`、`artwork_id`、`uploader_id`、
  `storage_key`、`width`、`height`、`mime`、`created_at`。
- **`placements`** — 把一個物件擺在一個 anchor 上、可選地貼上貼圖。
  `id`、`ar_object_id`、`anchor_id`、`texture_id`（nullable）、
  `transform` JSONB（position / rotation 四元數 / scale）、
  `uv_transform` JSONB（scale_x / scale_y / rotate / offset_x / offset_y，
  nullable）、`created_at`、`updated_at`。
  `(ar_object_id, anchor_id)` unique——同一物件在同一 anchor 只能有一筆。
- **`markers`** — 現場影像 marker 給 Mode A 追蹤用。`id`、
  `artwork_id`、`marker_image_url`、`pose_in_artwork_frame`。

---

## 素材策略

**貼圖該放前端還是後端？**

- **貼圖二進位 → 物件儲存（Supabase Storage / S3 / R2 等），透過
  CDN 遞送。** 絕對不要 bundle 進 web app——貼圖可能有幾百張，而且
  創作者會在 runtime 再上傳新的。
- **貼圖 metadata 跟 placement → Postgres，透過 API 提供。** 後台要
  能不 redeploy 就更改 placement。
- **3D 模型檔（`.glb`）→ 物件儲存。** 第一次進 Mode B 才 lazy load、
  並積極快取。
- **Marker 圖片 → 物件儲存 + bundle fingerprint**，這樣追蹤 library
  在網路不穩時還能以近似離線方式初始化。

**Mode A 的 lazy load 原則：** 啟動時只抓輕量的
`GET /artworks/:slug/objects` 索引（只有 id + anchor transform），
然後等物件進入鏡頭可視範圍或臨近門檻才抓它的貼圖。記憶體內用一個
LRU cache 限制手機的記憶體占用。

---

## 身分驗證與後台存取

- Mode C 住在**部署時才配的 hash 混淆 base path**（例如
  `/_studio/<token>`）。這個 token 只是遮蔽層，**不是**安全機制。
- 真正的存取控制是 **server-side session + 登入**（一開始用 email +
  密碼；之後可以擴充成 magic link / OAuth）。
- 觀展者在 UI 上完全看不到任何可以切到 Mode C 的入口。公開 app 沒有
  任何連結指向這條路徑。
- 會變更 placement/textures 的 API endpoint 一定要有 role 為 `creator`
  或 `admin` 的有效 session cookie。

---

## 效能考量

- **Mobile-first 預算。** 以中階 Android 在戶外光線下為目標裝置。
- **依 mode 做 code-split。** Mode A 只下載 AR / camera library，
  Mode B 只下載 3D library，Mode C 只下載後台編輯器。觀展者只下載
  他用得到的部分。
- **貼圖格式。** 優先用 `.ktx2`（Basis Universal），對 GPU 友善、頻寬
  也友善。不支援時 fallback 到 `.webp`。
- **Draw call。** 如果 200–300 個物件分別貼貼圖變成瓶頸，改用
  texture atlas 策略。
- **首次繪製。** 立刻顯示「請將鏡頭對準 marker」的提示，**不要**
  等素材預載完才渲染任何東西。

---

## 環境與部署

- `dev` — 本地；全部在一台機器上跑，用 `make dev`。
- `preview` — PR 範圍的預覽部署，讓創作者可以 review WIP placement。
- `prod` — 正式上線的展場部署。

部署目標是 stack 決策（見下方），但有個硬限制：**必須是 HTTPS 附有效
憑證**，因為 `getUserMedia` 跟 device sensor 需要 secure context。

---

## 技術棧

多語言 monorepo：React/TypeScript 前端、Python 後端、Supabase 負責
DB / storage / auth。Docker 化以確保 dev 與部署可重現。

| 層面               | 選擇                                                |
| ------------------ | --------------------------------------------------- |
| 前端框架           | **React 19 + Vite**（跑在 **Bun** 上）              |
| 3D 渲染            | `@react-three/fiber` + `@react-three/drei`（Three.js） |
| WebAR 追蹤         | MindAR（image tracking）                            |
| QR 掃描            | `@zxing/browser`                                    |
| 樣式               | Tailwind CSS 4 + shadcn/ui                          |
| 資料取得           | TanStack Query                                      |
| 表單 / 驗證        | React Hook Form + Zod                               |
| 後端語言           | **Python 3.12**                                     |
| 後端框架           | **FastAPI**                                         |
| Python 依賴管理    | **uv**（Rust-based、PEP 621）                       |
| ORM / DB client    | SQLAlchemy 2.0 + `asyncpg`（async）                 |
| Schema / model     | Pydantic v2                                         |
| 資料庫             | **Supabase（託管 Postgres）**                       |
| 身分驗證           | Supabase Auth（FastAPI 驗證 JWT）                   |
| 物件儲存           | Supabase Storage                                    |
| 容器化             | **Docker + Docker Compose**                         |
| 指令協調           | Repo 根目錄的 Makefile                              |
| Hosting（web）     | Vercel 或 Cloudflare Pages                          |
| Hosting（api）     | Fly.io 或 Railway（容器化）                         |

**為什麼選 React 不選 SvelteKit：** 團隊熟 React、不熟 Svelte——可維護
性贏過 bundle 大小的理想主義。

**為什麼選 FastAPI：** 團隊偏好的後端語言是 Python；FastAPI 內建
自動 OpenAPI 文件、Pydantic 驗證、async 支援。

**為什麼選 Supabase：** 用單一託管產品取代「自架 Postgres + S3 + auth
service」。減少小團隊的 ops 維運面。

---

## 快速開始

完整的初學者版走訪看 **[`docs/setup.md`](docs/setup.md)**。速覽版：

```bash
# 前置：Python 3.12+、uv 0.4+、Bun 1.1+、Docker Desktop

# 一次性安裝
make install

# 本地同時跑 web + api
make dev

# 或用完整容器化 stack 跑
make docker-up
```

每個 app 都有自己的 `.env.example`——複製成 `.env` 再填入值
（Supabase URL、anon key、service role key 等等）。

---

## Scripts（Makefile targets）

| 指令                | 做什麼                                                |
| ------------------- | ----------------------------------------------------- |
| `make install`      | 安裝 Python（uv）與 JS（Bun）依賴                     |
| `make dev`          | 本地同時啟動 api 與 web dev server                    |
| `make dev-api`      | 只跑 FastAPI server                                   |
| `make dev-web`      | 只跑 Vite dev server                                  |
| `make docker-up`    | 用 docker-compose build 並啟動所有 service            |
| `make docker-down`  | 停止並移除 container                                  |
| `make lint`         | 對兩個 app 執行 linter                                |
| `make test`         | 跑測試                                                 |
| `make typecheck`    | Python 跑 `mypy`、TS 跑 `tsc --noEmit`                |

---

## Roadmap

- [x] 鎖定前端框架 → **React 19 + Vite**
- [x] Scaffold monorepo（Makefile + Docker）
- [x] 最小 FastAPI app（`/health` + `/artworks` stub）
- [x] 最小 React app（打 `/api/health` 顯示結果）
- [ ] 接上資料庫：SQLAlchemy model + Alembic + 第一條遷移
- [ ] Supabase Auth 驗證 → 保護後台 endpoint
- [ ] Mode B 原型：載入 glTF、旋轉檢視
- [ ] Mode A 原型：marker 追蹤（技術棧待定——見 dev journal）
- [ ] Mode C 後台：貼圖上傳 + placement 編輯器
- [ ] 300 物件場景效能驗證
- [ ] 上線部署 + 展場實測

---

## License

TBD.

## AI Review Pipeline

Every PR runs through `ci.yml` (size guard / gitleaks / api / web). On green,
the PR is tagged `ai-review` and `review.yml` chains an AI code review using
the rubric in `REVIEW.md`. Verdict labels: `review/pass` or `ai-fix`.
See `docs/REVIEWS.md` for the audit log.
