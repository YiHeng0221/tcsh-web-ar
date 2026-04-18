# 安裝設定指南

這份文件帶你一步一步在全新機器上把 `tcsh-web-ar` 跑起來。針對**有寫過
程式，但還沒用過 uv、Bun、Docker** 的讀者寫的。

如果你只要快速版，看根目錄 `README.md` 最前面就好。

---

## 0. 接下來要裝的東西

- **Python 3.12** — 後端語言。
- **uv** — Python 的套件管理工具。可以把它想成「更快版的 pip + venv + poetry
  三合一」：它讀 `pyproject.toml`、寫 `uv.lock` 鎖定版本、幫你管理
  virtual environment，底層是 Rust 寫的，速度比 Poetry 快一個數量級。
  從 2026-04-18 起本專案改用 uv；遷移過程與原因看
  `docs/dev-journal/2026-04-18-poetry-to-uv-migration.md`。
- **Bun** — 一個超快的 JavaScript runtime + 套件管理 + bundler。
  我們用它取代 `npm`，因為比較快、安裝比較乾淨。
- **Docker Desktop** — 用來跑容器的。你會用它來一鍵啟動整個 stack。
  Docker 附帶 `docker compose`，可以用一個 YAML 檔同時管理多個容器。

不一定每個都要裝——如果只改前端，可以暫時跳過 Python/uv。但要跑
完整 stack 就四個都要。

---

## 1. 安裝前置需求

### 1.1 Python 3.12

**macOS（Homebrew）：**

```bash
brew install python@3.12
python3.12 --version  # → Python 3.12.x
```

**驗證：**

```bash
which python3.12
```

### 1.2 uv

uv 是 Astral 團隊寫的 Rust-based Python 工具。用官方安裝 script 或 Homebrew
擇一：

```bash
# 方式 A：官方 install script（最萬用）
curl -LsSf https://astral.sh/uv/install.sh | sh
# 重新開 terminal 或依指示 source 對應的 shell rc

# 方式 B：Homebrew（macOS）
brew install uv

uv --version  # → uv 0.4.x 或更新
```

uv 不需要先有 Python——它可以幫你自動下載對應版本的 Python（`uv python install 3.12`）。
但如果前一步已經裝了 `python3.12`，uv 會偵測到並直接用。

### 1.3 Bun

```bash
curl -fsSL https://bun.sh/install | bash
# 重新開 terminal
bun --version  # → 1.1.x 或更新
```

### 1.4 Docker Desktop

到 https://www.docker.com/products/docker-desktop/ 下載、安裝、啟動，
等到鯨魚 icon 變成綠色就好了。

```bash
docker --version        # → Docker version 27.x 或更新
docker compose version  # → Docker Compose version v2.x
```

### 1.5 Make（macOS 通常已經內建）

```bash
make --version
```

如果沒有：`xcode-select --install`（macOS）或 `sudo apt install make`
（Debian/Ubuntu）。

---

## 2. Clone 下來、環顧四周

```bash
git clone https://github.com/2enter/tcsh-web-ar.git
cd tcsh-web-ar
```

先摸熟檔案結構：

```bash
ls
# apps/        docs/        docker-compose.yml   Makefile
# README.md    CLAUDE.md    .gitignore
```

兩個 app 都放在 `apps/` 底下：

- `apps/api` — Python FastAPI 後端
- `apps/web` — React + Vite + Bun 前端

---

## 3. 設定環境變數

每個 app 都有 `.env.example`。把它 copy 成 `.env` 然後填入真實的值。
**絕對不要把 `.env` commit 進去**——已經在 `.gitignore` 裡了。

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

### 3.1 Supabase 憑證

你需要一個 Supabase 專案（免費方案就夠了）。本專案採用 **2025 後的新
Supabase 系統**（publishable/secret keys、非對稱 JWKS、Supavisor pooler
兩條 URL）。如果你是從舊教學過來的請注意這幾個已不是 `anon` /
`service_role` / 靜態 `JWT_SECRET` 了。

**從 Supabase dashboard 抓以下內容：**

1. **Project Settings → API Keys**（新 tab，不是舊的「API」分頁）
   → 若尚未啟用新制，點 `Create new API Keys`。會拿到：
   - `sb_publishable_...`（前端可用）
   - `sb_secret_...`（**機密**，只能後端，取代舊的 `service_role`）
2. **Project Settings → Database → Connection string** — 會看到幾個頁籤
   （**Direct / Session pooler / Transaction pooler**）。本專案兩條都要：
   - **Transaction pooler**（port **6543**）→ 後端 runtime 用，塞進
     `DATABASE_URL`
   - **Session pooler**（port **5432**）→ Alembic migration 用，塞進
     `DATABASE_URL_DIRECT`
   - 兩個都要把開頭 `postgresql://` 換成 `postgresql+asyncpg://`
3. **JWKS endpoint** — 不用特別去 dashboard 複製，URL 格式固定：
   `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`。
   後端透過這個 URL 拿公鑰驗 JWT，**不需要再存任何 secret**，而且
   Supabase 要 rotate key 時你不用重新部署。

**最後的填值：**

- `apps/api/.env`
  - `DATABASE_URL=postgresql+asyncpg://postgres.xxx:PW@aws-0-REGION.pooler.supabase.com:6543/postgres`
  - `DATABASE_URL_DIRECT=postgresql+asyncpg://postgres.xxx:PW@aws-0-REGION.pooler.supabase.com:5432/postgres`
  - `SUPABASE_URL=https://xxxx.supabase.co`
  - `SUPABASE_PUBLISHABLE_KEY=sb_publishable_...`
  - `SUPABASE_SECRET_KEY=sb_secret_...`   # ← 只能在後端！
  - `SUPABASE_JWKS_URL=https://xxxx.supabase.co/auth/v1/.well-known/jwks.json`
- `apps/web/.env`
  - `VITE_SUPABASE_URL=https://xxxx.supabase.co`
  - `VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...`   # ← 可以安全放瀏覽器

---

## 4. 安裝依賴

一個指令搞定：

```bash
make install
```

這會在 `apps/api` 跑 `uv sync`，在 `apps/web` 跑 `bun install`。

### 4.1 剛剛發生了什麼？

- **uv** 幫這個專案建立了一個 virtual environment（獨立的 Python 安裝環境
  在 `apps/api/.venv/`）、按 `uv.lock` 裝好所有套件。第一次沒有 lockfile 時
  uv 會先解析 pyproject.toml 產生 `uv.lock`，把它 commit 進 repo。
- **Bun** 寫出 `bun.lockb` lockfile，並把套件裝進 `apps/web/node_modules/`。

### 4.2 手動使用 virtualenv（參考知識）

你幾乎不會需要手動操作——`uv run <cmd>` 會自動用專案的 venv。但為了
學習：

```bash
cd apps/api
source .venv/bin/activate      # 進入 venv
python -c "import fastapi; print(fastapi.__version__)"
deactivate                     # 退出 venv
```

---

## 5. 本地跑 app（不用 Docker）

```bash
make dev
```

這會在同一個 terminal 裡啟動兩個 process。Ctrl-C 會停掉兩個。

或是用兩個 terminal 分開跑：

```bash
# terminal 1
make dev-api
# → http://localhost:8000/docs （Swagger UI）

# terminal 2
make dev-web
# → http://localhost:5173
```

打開 http://localhost:5173，你應該會看到顯示 API `/health` 回應的訊息。
如果 API 掛掉，頁面會告訴你連不上。

### 5.1 底層發生什麼事

- `make dev-api` 跑的是 `uvicorn tcsh_ar_api.main:app --reload`。
  Uvicorn 是 ASGI server（類似 gunicorn 但原生支援 async）；`--reload`
  會監控檔案變動，存檔後自動重啟 server。
- `make dev-web` 跑 `bun run dev`，它會執行 `vite`。Vite 會 serve
  React app 並提供 hot module replacement（存檔即時更新）。
- 前端的 `vite.config.ts` 把 `/api/*` proxy 到 `localhost:8000`，這樣
  瀏覽器在 dev 環境不會遇到 CORS 問題。

---

## 6. 用 Docker 跑全部

```bash
make docker-up
```

第一次會花幾分鐘——Docker 要下載 base image（Python 跟 Nginx）、裝
依賴、build 前端。之後就很快。

啟動後的 endpoint：

- Frontend: http://localhost:8080
- API:      http://localhost:8000
- Swagger:  http://localhost:8000/docs

停掉全部：

```bash
make docker-down
```

Dockerfile 跟 compose 檔每一段在做什麼，看 `docs/docker.md`。

---

## 7. 日常工作流程速查表

| 想要…                          | 指令                       |
| ------------------------------ | -------------------------- |
| 開始寫 code，不要容器          | `make dev`                 |
| 用瀏覽器互動測試 API           | http://localhost:8000/docs |
| 確認整個 app 端對端能跑        | `make docker-up`           |
| 加一個 Python 依賴              | `cd apps/api && uv add <pkg>` |
| 加一個 JS 依賴                  | `cd apps/web && bun add <pkg>`    |
| commit 前：lint + typecheck     | `make lint && make typecheck`     |
| commit 前：跑測試               | `make test`                       |
| 快取怪怪的，全部重來            | `make clean && make install`      |

---

## 8. 常見地雷

- **`uv: command not found`** 裝完之後——重新開 terminal，或是
  把 `export PATH="$HOME/.local/bin:$PATH"` 加到你的 shell rc 檔。
- **Bun install 錯誤提到 "lockb" 損毀** — 刪掉 `apps/web/bun.lockb`
  跟 `apps/web/node_modules`，再 `bun install` 一次。
- **Port 被占用（8000 / 5173 / 8080）** — 有別的程式在用那個 port。
  找出是誰：`lsof -i :8000`。殺掉它，或改 Makefile / docker-compose
  / vite.config 裡的 port。
- **Docker build 每次都很慢** — 確認每個 app 資料夾都有 `.dockerignore`
  這樣 Docker 才不會把 `node_modules` 或 `.venv` 塞進 build context。
- **手機在 dev 環境 `getUserMedia` 不能用** — 相機 API 需要 HTTPS。
  要嘛部署到 preview URL，要嘛用 Vite 的 HTTPS 模式 + 本機憑證
  （mkcert 最簡單）。

---

## 9. 下一步

Stack 跑起來之後，照這個順序讀：

1. **`docs/fastapi.md`** — 後端怎麼組織的、怎麼加新 endpoint。
2. **`docs/docker.md`** — Dockerfile / compose 檔每一行在做什麼、
   build 失敗怎麼 debug。
3. **`docs/dev-journal/`** — 決策的時間序列記錄。想理解「為什麼現在
   長這樣」就看這裡。

祝開發愉快。
