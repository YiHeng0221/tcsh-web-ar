# 2026-04-18 — Poetry → uv 遷移

**背景：** 本專案 2026-04-17 初建時用 Poetry 管理 Python 依賴，2026-04-18
遷移到 uv。這份文件記錄「為什麼」、「怎麼遷」、「以後怎麼用」。

對應 GitHub issue：#37。

---

## 0. uv 是什麼

**[uv](https://github.com/astral-sh/uv)** 是 Astral 團隊（也是做 Ruff 的
那群人）用 Rust 寫的 Python 專案管理工具。一支 static binary，裝進去
就能用。它一次取代了 `pip`、`pip-tools`、`virtualenv`、`poetry`、
`pyenv` 的功能。

### 和 Poetry 的關鍵差異

| 面向 | Poetry | uv |
| --- | --- | --- |
| 實作語言 | Python | Rust |
| 依賴解析速度 | 幾秒 ~ 幾十秒 | 通常 <1 秒（10-100× 快） |
| 安裝速度 | pip 等級 | 顯著更快（平行下載 + link-mode） |
| pyproject 格式 | `[tool.poetry]`（專屬） | `[project]`（PEP 621 標準） |
| Lockfile | `poetry.lock` | `uv.lock` |
| Python 版本管理 | 仰賴外部 pyenv 等 | 內建（`uv python install`） |
| 虛擬環境 | 要記 `poetry shell` | `uv run` 自動用 venv，不用手動 activate |
| 安裝 | `curl` 官方 script 或 pipx | 單支 binary，可 Homebrew / curl |

### 為什麼值得換

- **速度是體感差異**：CI / Docker build / 新機器 onboard 全部明顯變快
- **標準格式**：`[project]` 表屬於 PEP 621，未來換其他工具不用再遷一次
- **單一 binary**：不用另外裝 Python 就能裝 uv

### 為什麼不繼續用 Poetry

- Poetry 的解析器在複雜依賴時會慢到很有感
- Poetry 1.x 升到 2.x 的 breaking change 讓人累
- 社群越來越多新 Python 專案用 uv 做範本（FastAPI 官方 template、Airbyte、
  Home Assistant 之類）

---

## 1. pyproject.toml 對照

### Poetry 版本

```toml
[tool.poetry]
name = "tcsh-ar-api"
version = "0.1.0"
description = "..."
authors = ["tcsh-web-ar contributors"]
readme = "README.md"
package-mode = true
packages = [{ include = "tcsh_ar_api", from = "src" }]

[tool.poetry.dependencies]
python = "^3.12"
fastapi = "^0.115.0"
uvicorn = { extras = ["standard"], version = "^0.32.0" }
# ...

[tool.poetry.group.dev.dependencies]
ruff = "^0.7.0"
# ...

[build-system]
requires = ["poetry-core"]
build-backend = "poetry.core.masonry.api"
```

### uv 版本（PEP 621）

```toml
[project]
name = "tcsh-ar-api"
version = "0.1.0"
description = "..."
readme = "README.md"
requires-python = ">=3.12,<3.13"
authors = [
    { name = "tcsh-web-ar contributors" },
]
dependencies = [
    "fastapi>=0.115.0,<0.116.0",
    "uvicorn[standard]>=0.32.0,<0.33.0",
    # ...
]

[dependency-groups]
dev = [
    "ruff>=0.7.0,<0.8.0",
    # ...
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/tcsh_ar_api"]
```

### 重點變化

1. **`[tool.poetry]` → `[project]`**：PEP 621 標準，其他工具都認得。
2. **Version 語法**：Poetry 的 `^0.115.0` 寫法換成 PEP 440 的 `>=0.115.0,<0.116.0`
   （Poetry `^` 對 0.x 版本的 semver 規則就是這個意思）。
3. **Extras 語法**：Poetry 的 `{ extras = ["standard"], version = "^0.32.0" }`
   改成標準的 `"uvicorn[standard]>=0.32.0,<0.33.0"`。
4. **Dev deps**：從 `[tool.poetry.group.dev.dependencies]` 換到
   `[dependency-groups.dev]`（PEP 735）。uv 0.4+ 支援這個新 spec。
5. **Build backend**：Poetry 用它自己的 `poetry-core`；uv 不綁 backend，
   隨便選一個。我們用 [Hatchling](https://hatch.pypa.io/)——Hatch 這個
   工具的 build 部分，輕量、廣用。
6. **Python 版本**：`python = "^3.12"` → `requires-python = ">=3.12,<3.13"`，
   意思一樣（鎖 3.12.x）。

---

## 2. 常用指令對照

| 操作 | Poetry | uv |
| --- | --- | --- |
| 裝所有依賴 | `poetry install` | `uv sync` |
| 只裝 runtime（不含 dev） | `poetry install --only main` | `uv sync --no-dev` |
| 新增 runtime 依賴 | `poetry add fastapi` | `uv add fastapi` |
| 新增 dev 依賴 | `poetry add --group dev pytest` | `uv add --dev pytest` |
| 移除依賴 | `poetry remove fastapi` | `uv remove fastapi` |
| 升級單一依賴 | `poetry update fastapi` | `uv lock --upgrade-package fastapi` |
| 升級全部 | `poetry update` | `uv lock --upgrade` |
| 跑命令（進 venv） | `poetry run pytest` | `uv run pytest` |
| 進 shell / venv | `poetry shell` | `source .venv/bin/activate`（手動） |
| 看 lockfile | `poetry.lock` | `uv.lock` |
| 看 venv 位置 | `poetry env info` | 固定在 `.venv/`（或由 `UV_PROJECT_ENVIRONMENT` 覆蓋） |

---

## 3. 本次遷移改了哪些檔

### `apps/api/pyproject.toml`（整個重寫）
Poetry 的 `[tool.poetry]` 系列段落全部換成 PEP 621 的 `[project]`；
build backend 從 `poetry-core` 換到 `hatchling`。

### `apps/api/Dockerfile`（多階段 build 全改）
從「`RUN pip install poetry` → `poetry install`」換成：

```dockerfile
# 用 Astral 官方 image 的 binary，不用 pip install
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/app/.venv

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
```

Runtime stage 從「複製 site-packages」改成「複製整個 `.venv/`」，更乾淨。

### `Makefile`（指令全換）

```diff
- cd apps/api && poetry install
+ cd apps/api && uv sync

- cd apps/api && poetry run uvicorn ...
+ cd apps/api && uv run uvicorn ...

- cd apps/api && poetry run pytest
+ cd apps/api && uv run pytest
```

### 文件一批更新

- `CLAUDE.md` — backend 依賴從 Poetry 改 uv，刪除「why poetry over uv」段落
- `README.md` — stack 表、安裝指令、Makefile 說明
- `docs/setup.md` — 第 1.2 節整個改寫成 uv 安裝教學
- `docs/fastapi.md` — Alembic 指令改 `uv run alembic ...`
- `docs/docker.md` — 第 3 節 Dockerfile 逐行解析改成 uv 版本
- `apps/api/README.md` — 安裝 / run / lint 指令全換
- `docker-compose.yml` — 註解從「native Poetry + Bun」改「native uv + Bun」
- `docs/dev-journal/2026-04-17-initial-scaffold.md` — 加 addendum 指向本文
- `docs/project-report-2026-04-18.md` — 依賴管理欄位更新

---

## 4. 日常使用流程

### 初次 onboard 新機器

```bash
# 1. 裝 uv
curl -LsSf https://astral.sh/uv/install.sh | sh   # 或 brew install uv

# 2. clone repo
git clone https://github.com/2enter/tcsh-web-ar.git
cd tcsh-web-ar

# 3. 裝依賴
make install
# 等同：cd apps/api && uv sync
```

uv 會自動做的事：
- 偵測 `pyproject.toml` 要求的 Python 版本，沒有就下載（或使用
  `.python-version` 檔指定的版本）
- 在 `apps/api/.venv/` 建虛擬環境
- 依 `uv.lock` 裝套件到 venv

### 新增依賴

```bash
cd apps/api
uv add httpx-oauth          # runtime 依賴
uv add --dev pytest-cov     # dev 依賴
```

這會：
- 更新 `pyproject.toml`
- 更新 `uv.lock`
- 裝到 `.venv`

**記得 commit `pyproject.toml` 和 `uv.lock` 兩個檔。**

### 跑東西

```bash
cd apps/api
uv run uvicorn tcsh_ar_api.main:app --reload
uv run pytest
uv run ruff check src
uv run mypy
```

或在 repo 根目錄：

```bash
make dev-api
make test
make lint
make typecheck
```

### 升級套件

```bash
uv lock --upgrade-package fastapi    # 升級 fastapi 一個
uv lock --upgrade                    # 升級所有
uv sync                              # 套用到 venv
```

---

## 5. Dockerfile 細節

### 為什麼把 uv 當 binary 複製進來，而不是 `pip install uv`？

```dockerfile
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
```

這一行等於：「從 Astral 發的 uv image 抓出 /uv 這個 binary，塞到我 image
裡的 /usr/local/bin/」。比起 `RUN pip install uv`，好處是：

- 少一層 image layer
- 不用先跑 pip、不用解決 pip 版本對應問題
- 官方 image 本來就有簽名、信得過

### 為什麼分 `--no-install-project`？

`uv sync --frozen --no-dev --no-install-project` 的意思：
- `--frozen`：lockfile 不能自動更新，強制用現有的 `uv.lock`
- `--no-dev`：runtime image 不要 pytest/ruff
- `--no-install-project`：**只裝依賴，不裝本專案 code**

這讓 Docker layer cache 可以重用——改 source 但沒改依賴時，這一層
cache 有效、build 很快。只有改 `pyproject.toml` 或 `uv.lock` 才會重跑。

Runtime stage 才複製 `src/` 進去。

---

## 6. 常見地雷

### `uv: command not found`
裝完之後要重新開 terminal，或加到 PATH：
```bash
export PATH="$HOME/.local/bin:$PATH"  # 寫進 ~/.zshrc 或 ~/.bashrc
```

### Docker build 報 `uv.lock` 不存在
第一次用 uv 時還沒有 lockfile。解法：在本地先跑一次 `uv sync`，它會
產生 `uv.lock`，commit 進去。之後 Dockerfile 才能 `COPY ... uv.lock ./`。

### `--frozen` 錯誤：lockfile 落後
意思是 `pyproject.toml` 有改、但 `uv.lock` 還沒同步。解法：
```bash
cd apps/api && uv sync   # 更新 lockfile
git add uv.lock && git commit
```

### `poetry.lock` 還在 repo 裡
遷移完之後可以直接刪：
```bash
rm apps/api/poetry.lock
```
lockfile 真理現在在 `uv.lock`。

### IDE 找不到 interpreter
VS Code / PyCharm 預設可能還指著舊的 Poetry venv。把 Python interpreter
手動切到 `apps/api/.venv/bin/python`。

### CI runner 沒 uv
Actions 有官方 setup：
```yaml
- uses: astral-sh/setup-uv@v3
  with:
    version: "latest"
- run: uv sync --frozen
```

---

## 7. 延伸閱讀

- [uv 官方文件](https://docs.astral.sh/uv/)
- [PEP 621](https://peps.python.org/pep-0621/) — `[project]` 表規格
- [PEP 735](https://peps.python.org/pep-0735/) — `[dependency-groups]` 規格
- [Hatchling build backend](https://hatch.pypa.io/latest/config/build/)
- [Astral's uv announcement blog post](https://astral.sh/blog/uv)

---

## 8. 決策 trade-offs

**做的取捨：**
- 選 `hatchling` 當 build backend：uv 其實不關心 backend 是哪個，
  `setuptools`、`hatchling`、`flit` 都可以。`hatchling` 設定最少、
  broadly supported。
- 版本範圍保留 `<X+1.0.0` 上界：避免 major 版自動升級帶來 breaking
  change；升 major 版時人工 review。
- `python = ">=3.12,<3.13"`：鎖 3.12.x，和原本 `^3.12` 意義相同。

**沒做（但可以做）的事：**
- 把 `.python-version` 檔放進 repo：讓 uv 自動選 Python 版本。目前靠
  `pyproject.toml` 的 `requires-python` 也夠；之後有多版本測試需求再加。
- `uv tool` 用來裝全域工具（例如 `uv tool install ruff`）：目前 ruff
  當 dev 依賴裝在 venv 內，不需要全域。
