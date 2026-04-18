# 2026-04-17 — 初始 Scaffold

> **📝 Addendum 2026-04-18：** 本日初稿採用 Poetry 管理 Python 依賴，
> 2026-04-18 已全面遷移到 uv。下文歷史紀錄保留 Poetry 相關描述，實際
> 現況與指令請以 `docs/dev-journal/2026-04-18-poetry-to-uv-migration.md` 為準。

**目標：** 把空的 `2enter/tcsh-web-ar` repo 建成一個可跑的 monorepo，
含 FastAPI 後端、React + Vite + Bun 前端、完整的 Docker 支援、以及
教學品質的文件。

**今天鎖定的 stack：**

- 前端：React 19 + Vite，跑在 Bun 上
- 後端：Python 3.12 + FastAPI + Poetry
- 資料：Supabase（託管 Postgres + Auth + Storage）
- 容器化：Docker + Compose，用 Makefile 協調

之前的探索（SvelteKit、Hono、Cloudflare R2、Better Auth）都保留在 git
歷史裡，有需要對照可以翻。

---

## 改了什麼

### Repository 結構

```
tcsh-web-ar/
├── apps/
│   ├── api/                    # FastAPI + Poetry
│   │   ├── src/tcsh_ar_api/
│   │   │   ├── main.py
│   │   │   ├── config.py
│   │   │   └── routes/
│   │   │       ├── health.py
│   │   │       └── artworks.py
│   │   ├── pyproject.toml
│   │   ├── Dockerfile
│   │   ├── .dockerignore
│   │   ├── .env.example
│   │   └── README.md
│   └── web/                    # React + Vite + Bun
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   └── index.css
│       ├── index.html
│       ├── package.json
│       ├── vite.config.ts
│       ├── tsconfig.json
│       ├── Dockerfile
│       ├── nginx.conf
│       ├── .dockerignore
│       ├── .env.example
│       └── README.md
├── docs/
│   ├── setup.md
│   ├── docker.md
│   ├── fastapi.md
│   └── dev-journal/
│       ├── README.md
│       └── 2026-04-17-initial-scaffold.md
├── docker-compose.yml
├── Makefile
├── .gitignore
├── README.md
└── CLAUDE.md
```

### 後端

- `pyproject.toml` 設好 Poetry、runtime 依賴（FastAPI、Uvicorn、
  Pydantic、SQLAlchemy async、asyncpg、Alembic、Supabase client、
  python-jose）、dev 依賴（Ruff、mypy、pytest）。
- `main.py` 是 minimal FastAPI app，有 CORS middleware 跟兩個 route：
  - `GET /health` — 回傳 `{ status, version }`
  - `GET /artworks` — 先回 `[]` 當 placeholder
- `config.py` 用 `pydantic-settings` 把 `.env` 讀進一個有型別的
  `Settings` 物件（+ `lru_cache` 這樣只會 parse 一次）。
- Multi-stage `Dockerfile`，builder 跟 runtime 都用 `python:3.12-slim`。
  builder 裡 Poetry 裝好 runtime 依賴；runtime 階段只把 site-packages
  複製過來。

### 前端

- `package.json` 含 React 19、@react-three/fiber + drei、TanStack
  Query、Vite。
- Vite 設定了 dev proxy：`/api/*` → `http://localhost:8000`。這樣瀏覽
  器在本地 dev 不會遇到 CORS。
- Minimal `App.tsx` 用 TanStack Query 打 `/api/health` 顯示回應，
  開啟專案就能立刻知道整條鏈路是通的。
- 兩階段 Dockerfile：`oven/bun:1.1` 做 build，`nginx:1.27-alpine`
  做 serve。自訂 `nginx.conf` 處理 SPA fallback（`try_files ... /index.html`）
  跟把 `/api/*` proxy 到 `api` container。

### 基礎建設 / DX

- `docker-compose.yml` 定義 `api`（port 8000）跟 `web`（port 8080），
  API 有 healthcheck，這樣 web container 會等 API 健康再啟動。
- `Makefile` 附 `help` target，提供這些指令：
  - `make install` — 裝 Python（Poetry）跟 JS（Bun）依賴
  - `make dev` — 同時跑兩個 app（原生，不用 Docker）
  - `make dev-api` / `make dev-web` — 單一服務版
  - `make docker-up` / `make docker-down` / `make docker-build`
  - `make lint` / `make format` / `make typecheck` / `make test`
  - `make clean` — 清掉快取跟依賴
- `.gitignore` 涵蓋 Python、Node/Bun、macOS、編輯器、Docker。

### 文件

- `README.md` — 產品概述、A/B/C 三個 mode、資料模型、技術棧、repo
  結構、指令。
- `CLAUDE.md` — 給 agent/協作者的指南：規範、東西放哪、安全規則、
  不要做什麼。
- `docs/setup.md` — 一步一步的首次執行教學，寫給還沒用過 Poetry /
  Bun / Docker 的人。
- `docs/docker.md` — Docker 從零講起、Dockerfile 逐行解釋、compose
  檔導覽、debug 指南。
- `docs/fastapi.md` — FastAPI 學習筆記：程式碼導覽、加 endpoint 實戰
  範例、async 原則、DB / auth 計劃、pytest 基本用法。

---

## 怎麼驗證能跑

從 clean repo 開始：

```bash
# 1. 依 docs/setup.md 裝 prereq（Python 3.12、Poetry、Bun、Docker）。

# 2. 複製 env 檔（之後填 Supabase 憑證）。
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

# 3. 裝依賴。
make install

# 4. 本地跑（最快）。
make dev
# 打開 http://localhost:5173 — 應該會看到 API health 回應。

# 5. 或用 Docker 跑（可重現）。
make docker-up
# 打開 http://localhost:8080 — 一樣的東西，由 nginx serve。
```

---

## 值得記住的決策

### 為什麼選 Vite + React 而不是 Next.js？

這是一個 SPA，有三個相機 / WebGL 模式。Next 的強項（SSR、App Router、
server components）跟這專案不搭，還會加上儀式感。Vite + 單純 React
對這種形狀的專案比較好理解。

### 為什麼用 Poetry 而不是 uv？

使用者偏好。uv 更快也很有潛力——等之後依賴變多再考慮。

### 為什麼 Supabase 一條龍（DB + Auth + Storage）？

- 一個 dashboard、一個帳單。
- 後台登入（Mode C）需要真的 login flow——Supabase Auth 久經考驗，
  省去自己寫密碼 / session 的工作。
- 貼圖上傳需要 signed URL——Supabase Storage 原生支援。
- 如果之後長大（這專案規模不太可能）可以換成自架 Postgres，Python
  那邊改動不大。

### 為什麼用 Nginx serve 前端（在 Docker 裡）？

dev server（`bun run dev`）是開發用的——沒 hardened 也沒做效能優化。
要做出 production-style container，就一次 build 好 static 檔，用
Nginx serve，又快又無聊（穩定）。Nginx 也乾淨地處理 SPA fallback
跟 `/api/*` proxy。

### 為什麼用 Makefile？

因為這專案跨了兩種語言、工具完全不同。Makefile 給我們**一個好記的指令
介面**，把 Poetry / Bun / Docker 的細節藏起來。`make help` 會列出全部。

### compose 檔裡 API service 的 healthcheck

沒有它的話，web container 會在 API 還沒 boot 完就開始打它，第一個
`/api/*` request 會 502。`depends_on: condition: service_healthy`
會等 `/health` 回 200 才啟動 web。

---

## 下一步候選

按哪個最有趣或最擋路挑：

1. **資料庫接線** — 幫 artworks / objects / placements 加 SQLAlchemy
   model，設定 Alembic，寫第一個 migration，接到 `GET /artworks` 讓
   它回傳真資料。
2. **Supabase Auth 驗證** — 在 `auth/` 實作 `current_user` dependency，
   並用它保護 `POST /artworks`。
3. **Mode B 原型** — 載入 glTF 模型，用 `@react-three/fiber` 做旋轉。
   三個 mode 裡最簡單，可以先建立 3D 工具鏈信心。
4. **Mode A POC** — 整合 MindAR 搭配單張測試 marker + 單一測試貼圖。
   把最困難的部分先驗證掉、降低專案風險。
5. **Mode C 骨架** — 把後台 route stub 在 `/_studio/<token>`，接
   Supabase 登入，顯示一個佔位用的貼圖列表。

最小可行的下一步應該是 (1)：低風險、解鎖其他一切、可以餵真資料給 UI
render。

---

## Scaffold 過程遇到的地雷

目前沒有——這篇日誌是邊搭邊寫的。之後的日誌要記錄**真的遇到的問題**
跟怎麼解掉的，這樣未來碰到類似問題時可以對照。
