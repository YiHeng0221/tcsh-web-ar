# Docker 從零開始

給初學者的 Docker 說明：它是什麼、為什麼要用、我們的 `Dockerfile`
跟 `docker-compose.yml` 每一行到底在做什麼。

如果你已經玩過 Docker，可以快速瀏覽 1-2 節，直接跳到第 4 節。

---

## 1. Docker 到底在解決什麼問題？

> 「在我電腦上是好的啊。」

軟體需要特定的 runtime（Python 3.12、Bun 1.1）、特定的 library
（libssl、libpq）、特定的設定（環境變數、檔案路徑）。當你部署到 server
或是同事要跑的時候，**他們電腦上的這些版本都不一樣**。bug 就出現在
只有 prod 才有的地方。

Docker 把 app 連同它需要的**確切 runtime、lib、設定**打包成一個
**image**。image 跑起來就是 **container**，行為像一個迷你的獨立 Linux
機器。同一個 image，同樣的行為，不管在哪裡都一樣。

---

## 2. 核心詞彙

| 詞彙              | 可以想成是…                                                     |
| ----------------- | --------------------------------------------------------------- |
| **Image**         | 食譜 + 凍結的 snapshot：「Python 3.12 + 這些 lib + 我的程式碼」 |
| **Container**     | image 跑起來的實例                                              |
| **Dockerfile**    | 描述怎麼 build image 的食譜                                     |
| **Layer**         | Dockerfile 裡每個指令都會產生一個可快取的 layer                 |
| **Registry**      | 存放/分享 image 的地方（Docker Hub、ghcr.io、ECR）             |
| **Volume**        | 持久化儲存，container 重啟後還在                                |
| **Network**       | container 之間怎麼溝通                                          |
| **Compose**       | 用 YAML 定義一組 container + 網路 + volume                     |

心智模型：**image = class**，**container = instance**。

---

## 3. 我們的 stack 怎麼用 Docker

我們有兩個 Dockerfile 跟一個 `docker-compose.yml`：

- `apps/api/Dockerfile` — 打包 FastAPI 後端的 image。
- `apps/web/Dockerfile` — build React app，然後把 static output 打包
  進 Nginx image。
- `docker-compose.yml` — 把兩個 service 串起來，`make docker-up`
  一口氣把整個 stack 起來。

兩個 Dockerfile 都用**多階段 build（multi-stage build）**。多階段 build
有兩段：一段「builder」帶開發工具跟原始碼，一段精簡的「runtime」只
複製需要的產物。這樣最終 image 會很小（小 = pull 快、attack surface
小）。

---

## 4. `apps/api/Dockerfile` 逐行解釋

```dockerfile
FROM python:3.12-slim AS builder
```
從官方 Python 3.12 image（Debian-slim base）開始。`AS builder` 幫這一
階段命名，這樣後面可以 reference。

```dockerfile
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
```
把 uv 的 binary 從 Astral 官方 image 直接複製進來。不需要 `pip install uv`，
就是一個 static binary。

```dockerfile
ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/app/.venv
```
- `UV_LINK_MODE=copy` — container 裡不要用 hardlink（不同 layer 會有
  檔案系統邊界，用 copy 比較可靠）。
- `UV_COMPILE_BYTECODE=1` — 預編譯 `.pyc`，container 啟動更快。
- `UV_PROJECT_ENVIRONMENT=/app/.venv` — 指定 venv 位置。

```dockerfile
WORKDIR /app
COPY pyproject.toml uv.lock ./
```
設定工作目錄，**只**複製依賴清單檔。在複製原始碼前先做這步是一個
**快取技巧**：如果你改原始碼但沒改依賴，Docker 可以重用這層快取。

```dockerfile
RUN uv sync --frozen --no-dev --no-install-project
```
- `--frozen` — 如果 `uv.lock` 落後 `pyproject.toml` 就直接錯，不自動更新
  （確保 image 一定用被 lock 的版本）。
- `--no-dev` — 不裝 dev dependencies（runtime 不需要 pytest/ruff）。
- `--no-install-project` — 先不把本專案裝進去，等第二階段才複製原始碼。

```dockerfile
FROM python:3.12-slim AS runtime
```
開啟第二個全新的 image。這個才是真的會出貨的。

```dockerfile
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"
```
- `PYTHONDONTWRITEBYTECODE=1` — 不要產生 `.pyc` 檔（減少 image 雜訊）。
- `PYTHONUNBUFFERED=1` — stdout 不要 buffer，這樣 `docker logs` 可以
  即時看到 log。
- `PATH=/app/.venv/bin:$PATH` — 把 venv 的 bin 放在 PATH 最前面，這樣
  `uvicorn` 會直接指到 venv 裡的那支。

```dockerfile
COPY --from=builder /app/.venv /app/.venv
```
把 builder 階段裝好的整個 venv 複製到 runtime image。一個完整的 venv
目錄比 site-packages 複製乾淨很多。

```dockerfile
COPY src ./src
COPY pyproject.toml ./
ENV PYTHONPATH=/app/src
```
複製原始碼，告訴 Python 去哪找。

```dockerfile
EXPOSE 8000
CMD ["uvicorn", "tcsh_ar_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
```
`EXPOSE` 是文件性質（標示這個 container 預計用哪個 port），實際不是
必要的。`CMD` 是 container 啟動時跑的 process。

---

## 5. `apps/web/Dockerfile` 逐行解釋

```dockerfile
FROM oven/bun:1.1 AS builder
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile || bun install
```
用 Bun 官方 image，複製清單，裝依賴。`|| bun install` 是為了應付第一
次 build 還沒 lockfile 的情況。

```dockerfile
COPY . .
RUN bun run build
```
複製剩下的原始碼，build。`bun run build` 會叫 Vite 去 build，輸出
static 檔案到 `dist/`。

```dockerfile
FROM nginx:1.27-alpine AS runtime
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```
換成超小的 Nginx image。把 build 好的 static 檔案複製進去。用我們自
己的 `nginx.conf` 覆蓋預設的（加上了 `/api/*` 轉發到 `api` service）。

```dockerfile
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```
Nginx 預設會 fork 到背景；在 container 裡我們要它留在前景，這樣 Docker
才能追蹤它的生命週期。

---

## 6. `docker-compose.yml` 解說

```yaml
services:
  api:
    build:
      context: ./apps/api
      dockerfile: Dockerfile
```
定義一個叫 `api` 的 service。`context` 是 Docker 要送去 build 的路徑——
我們的 `apps/api/.dockerignore` 會排除 `.venv`、`__pycache__` 等等，
上傳的資料才不會太大。

```yaml
    env_file:
      - ./apps/api/.env
```
container 啟動時，從本地 `.env` 讀環境變數。（`.env` 不會 commit）

```yaml
    ports:
      - "8000:8000"
```
把 host port 8000 → container port 8000 做對應。訪問 `localhost:8000`
就能打到 API。

```yaml
    restart: unless-stopped
```
container 如果 crash 自動重啟，除非你明確停掉它。

```yaml
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/health').read()"]
```
Docker 會定期跑這個指令。如果連續失敗 N 次，這 container 就會被標記
為不健康。`web` service 會用這個來判斷要不要等 API 起來。

```yaml
  web:
    build: { context: ./apps/web, dockerfile: Dockerfile }
    ports: ["8080:80"]
    depends_on:
      api:
        condition: service_healthy
```
`web` service 要等 `api` 報告健康之後才會啟動——這樣瀏覽器第一次打
`/api/health` 就不會收到 502。

---

## 7. 好用的 Docker 指令

```bash
# 看現在跑了什麼
docker ps

# 追某個 service 的 log
docker compose logs -f api

# 進入 container 內部（debug 神器）
docker compose exec api /bin/bash

# 重 build 不用快取（懷疑某層快取壞掉時用）
docker compose build --no-cache

# 列出所有 image（硬碟快爆時用）
docker images

# 全部清掉 — 停掉的 container、沒用的 image、dangling network
docker system prune -a
```

---

## 8. Build 失敗的 debug

**症狀：** `uv sync` 在 build 中途失敗。
試試：`docker compose build --no-cache api`。如果錯誤訊息是缺某個系統
library（例如 `libpq-dev`），用 `RUN apt-get update && apt-get
install -y libpq-dev` 加上去。另一個常見錯誤是 `uv.lock` 落後於
`pyproject.toml`（因為我們加了 `--frozen`）——這時要在本地跑 `uv sync`
更新 lockfile 再 commit。

**症狀：** `bun install` 失敗，訊息是「lockfile out of sync」。
修法：刪掉 `apps/web/bun.lockb` 重 build。然後把新的 lockfile commit 上去。

**症狀：** container 啟動後立刻退出。
跑：`docker compose logs api`（換成你要的 service 名字）。最後幾行通常
會顯示 crash 原因。常見原因：少了某個環境變數 → app 在 import 時炸掉。

**症狀：** 從 web container 連不到 API，但從 host 可以。
web container 設定檔裡，API 的 host 是 `api`（service 名字），**不是
`localhost`**。Docker 內部網路會解析 service 名字；container 裡的
`localhost` 指的是那個 container 自己。

---

## 9. 什麼時候該用 Docker，什麼時候用原生？

**原生（`make dev`）** 拿來日常寫 code——啟動快、hot reload 即時、
debugger 好接。

**Docker（`make docker-up`）** 拿來：

- 在本地重現「prod-like」環境。
- 交付一鍵安裝給別人（「跑 `make docker-up` 就動了」）。
- 準備部署用的 image。
- debug 只有 production build 會出現的 bug。

兩種都 OK。不要跟工具過不去。
