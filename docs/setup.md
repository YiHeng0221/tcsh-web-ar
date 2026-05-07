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

### 3.1 資料庫（SQLite，零設定）

關聯式資料用 **SQLite**（透過 `aiosqlite` async driver）。`.env.example`
裡的預設值會把資料寫進 `apps/api/tcsh.db`——你**完全不用安裝
PostgreSQL**，第一次跑 `alembic upgrade head` 時 SQLAlchemy 會自動把
DB 檔案建出來。

```
DATABASE_URL=sqlite+aiosqlite:///./tcsh.db
DATABASE_URL_DIRECT=sqlite+aiosqlite:///./tcsh.db
```

兩個 URL 同檔案、同設定；保留兩個欄位是為了未來如果換 host（或
swap 回 Postgres）時，runtime 跟 migrations 可以指向不同位置。

要砍掉重練：

```bash
rm apps/api/tcsh.db
cd apps/api && uv run alembic upgrade head
```

> Auth 跟 Storage 已經 **完全本地化**（見 3.2），不再需要 Supabase 帳號。
> 如果之後要把資料 DB 換回 Postgres / Supabase Postgres，把上面兩個
> URL 換成 `postgresql+asyncpg://...` 即可，model / migration / 業務
> 邏輯都不用改（type 都是 dialect-portable 的）。

### 3.2 本地單一 Admin（取代 Supabase Auth）

從 2026-04-25 起，後端 **不再依賴 Supabase**——登入跟貼圖儲存都改成
本地化：

- **登入**：環境變數裡放一組 admin email + bcrypt 密碼 hash，後端用
  HS256 自己簽 / 自己驗 JWT。沒有 user table、沒有外部 auth provider。
- **貼圖儲存**：上傳的圖直接寫進 `apps/api/storage/textures/`，前端
  透過 `GET /textures/{id}/file` 拉檔。

**產生 admin 密碼 hash：**

```bash
cd apps/api
uv run python -m tcsh_ar_api.create_admin admin@example.com 'your-strong-password' --with-jwt-secret
```

它會印出可以直接貼進 `.env` 的區塊：

```
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD_HASH=$2b$12$...
JWT_SECRET=64-hex-chars-of-randomness
JWT_EXPIRES_SECONDS=86400
```

**最後的填值：**

- `apps/api/.env`
  - `DATABASE_URL=sqlite+aiosqlite:///./tcsh.db`
  - `DATABASE_URL_DIRECT=sqlite+aiosqlite:///./tcsh.db`
  - `JWT_SECRET=...`（剛剛產生的 hex）
  - `ADMIN_EMAIL=admin@example.com`
  - `ADMIN_PASSWORD_HASH=$2b$12$...`（剛剛產生的 hash）
  - `JWT_EXPIRES_SECONDS=86400`
  - `TEXTURE_STORAGE_DIR=./storage/textures`
- `apps/web/.env`
  - `VITE_API_BASE_URL=http://localhost:8000`（前端用相對路徑時可省略）

> repo 提供的 `.env` 預設是 `admin@example.com / admin1234`，方便第一次
> 跑起來。**部署前務必換掉**：重跑 create_admin 拿新 hash + 新 JWT_SECRET。

### 3.3 套用 schema、灌測試資料

```bash
cd apps/api
uv run alembic upgrade head      # 建表
uv run python -m tcsh_ar_api.seed  # 灌 5 anchors / 7 objects / 2 placements
```

砍掉重練：`rm tcsh.db && uv run alembic upgrade head`。

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

跑 `make`（不帶參數）或 `make help` 會印出當下所有可用 target 的分組清單。
速查最常用：

| 想要…                          | 指令                       |
| ------------------------------ | -------------------------- |
| 開始寫 code，不要容器          | `make dev`                 |
| 用瀏覽器互動測試 API           | http://localhost:8000/docs |
| 手機在同網段測前端              | `make dev-https`           |
| 確認整個 app 端對端能跑        | `make docker-up`           |
| 加一個 Python 依賴              | `cd apps/api && uv add <pkg>` |
| 加一個 JS 依賴                  | `cd apps/web && bun add <pkg>`    |
| commit 前：lint + typecheck     | `make lint && make typecheck`     |
| commit 前：跑測試               | `make test`                       |
| 自動 format                     | `make format`                     |
| Build production artifacts      | `make build`                      |
| 套用最新 DB migrations          | `make db-upgrade`                 |
| 產生新的 alembic revision       | `make db-revision MSG="describe"` |
| 快取怪怪的，全部重來            | `make clean && make setup`        |

### 7.1 Makefile 分組

- **Setup** — `setup` / `setup-api` / `setup-web`（`install` 是別名）
- **Dev** — `dev`、`dev-api`、`dev-web`、`dev-https`、`docker-up/down/build`
- **Test** — `test`、`test-api`、`test-web`
- **Lint / Format / Typecheck** — `lint*`、`format*`、`typecheck*`
- **Build** — `build`、`build-api`、`build-web`
- **Database (Alembic)** — `db-upgrade`、`db-downgrade`、`db-revision`、
  `db-current`、`db-history`
- **Clean** — `clean`、`clean-api`、`clean-web`

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
  跑 `make web-dev-https` 啟動 mkcert 簽好的 dev server，並按
  `docs/dev/https-local.md` 把 root CA 裝到 iPhone 上。

---

## 9. 下一步

Stack 跑起來之後，照這個順序讀：

1. **`docs/fastapi.md`** — 後端怎麼組織的、怎麼加新 endpoint。
2. **`docs/docker.md`** — Dockerfile / compose 檔每一行在做什麼、
   build 失敗怎麼 debug。
3. **`docs/dev-journal/`** — 決策的時間序列記錄。想理解「為什麼現在
   長這樣」就看這裡。

祝開發愉快。
