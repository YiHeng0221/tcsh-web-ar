# 2026-04-30 — GitHub Actions CI（api + web）

**背景：** repo 之前沒有 CI，每個 PR 都得 reviewer 手動 pull 下來
跑一遍 typecheck/lint/test 才知道綠不綠。這份 PR 加上 `.github/workflows/ci.yml`，
把那條人肉迴路自動化。

對應 GitHub issue：#35。對應 PR：#59。

---

## 0. 為什麼這版只跑這幾個 step

理想 CI：`api` 跑 ruff + mypy + pytest；`web` 跑 eslint + tsc + vitest
+ build；外加 openapi-types-check。

實際這份 PR 跑：`api` ruff + mypy + pytest；`web` tsc + build。差異：

| 預期 | 為什麼這次跳過 | 後續 |
| --- | --- | --- |
| ESLint | `apps/web` 沒有 `eslint.config.*`。ESLint 9 廢掉了 `.eslintrc.*` 預設值，`bun run lint` 直接 explode | 補 flat config 一條 follow-up PR |
| openapi-types-check | `main` 上的 `apps/web/src/lib/api/types.ts` 是 stale 的（`f59cc98 fix(api): drop double /api/ prefix` 改了 path 但沒重 gen types），`gen:types && git diff --exit-code` 一定炸 | 先補一個 regen commit，再加這個 job |
| Vitest | `apps/web` 還沒裝 vitest，沒測試可跑 | 等到第一個前端單元測試出現再加 |

把這三個一起塞進這份 PR 會變成 3 個獨立判斷題（用什麼 ESLint 規則 /
要不要強制 strict / 怎麼處理 stale types），scope 失控。本 PR 只
做「能綠的 CI 先綠」，技術債在 PR description 標 follow-up。

---

## 1. workflow 結構

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  api:
    runs-on: ubuntu-latest
    steps: ...
  web:
    runs-on: ubuntu-latest
    steps: ...
```

幾個重點：

### `concurrency`
推一個 commit 就 cancel 同 branch 上前一個還沒跑完的 run。force-push
頻繁的 review 流程下，省 GitHub Actions 分鐘數很有感。

### `permissions: contents: read`
最小權限——這個 workflow 不該有 write 任何東西的能力。GitHub Actions
預設給的 `GITHUB_TOKEN` 是 read+write，在 workflow 層降到 read 就好。

### Action 全部 pin tag
`actions/checkout@v4`、`actions/setup-python@v5`、`actions/cache@v4`、
`astral-sh/setup-uv@v3`、`oven-sh/setup-bun@v2`。不用 `@main` 是
因為 third-party action 漂走會無預警 break；不用 SHA pin 是因為這個
專案目前還不夠大、tag 已經夠安全。

---

## 2. api job 細節

```yaml
- uses: actions/checkout@v4
- uses: astral-sh/setup-uv@v3
  with:
    version: "0.8.22"
    enable-cache: true
    cache-dependency-glob: apps/api/uv.lock
- uses: actions/setup-python@v5
  with:
    python-version: "3.12"
- run: cd apps/api && uv sync --frozen
- run: cd apps/api && uv run ruff check src tests
- run: cd apps/api && uv run mypy  # target defined in pyproject.toml [tool.mypy]
- run: cd apps/api && uv run pytest
```

### `uv sync --frozen`（不是 `uv sync`）
`--frozen` 強制使用 `uv.lock` 鎖定的版本、**禁止自動更新 lockfile**。
CI 上這個 flag 是必須的，否則 lockfile drift（pyproject 改了但忘記
同步 lock）不會被擋下來——你會在 prod 跑到跟本機不同的版本。

### Python 版本來源
`pyproject.toml` 寫 `requires-python = ">=3.12,<3.13"`，CI 對應 pin
`python-version: "3.12"`。**不要寫 `"3.x"` 或讓 setup-python 自己挑**
——你會在某次升級 minor 時莫名其妙被拖去新版。

### 快取策略：`setup-uv` 內建 download cache
目前用 `astral-sh/setup-uv` 的 `enable-cache: true`，它快取的是
`~/.cache/uv`（uv 的 download cache），key 由 `cache-dependency-glob`
綁定到 `apps/api/uv.lock`——lock 不變就命中。

實際執行時 `uv sync --frozen` 仍需完成 link/install 步驟（把 wheel 從
cache link 進 `.venv`），所以跟「零 I/O noop」還有段差距。

若想進一步加速，可在 `uv sync` 前另加 `actions/cache@v4` step 直接快取
`apps/api/.venv`，重 hit 時 `uv sync --frozen` 幾乎是 noop（whl 已就位）：

```yaml
- name: Cache uv venv
  uses: actions/cache@v4
  with:
    path: apps/api/.venv
    key: uv-venv-${{ runner.os }}-${{ hashFiles('apps/api/uv.lock') }}
```

目前 CI 時間尚在可接受範圍，暫不加；若 `api` job 超過 60 秒再補。

### Postgres service 沒加
原本想用 `services: postgres`，但 `apps/api/tests/auth/test_jwt_service.py`
（目前唯一測試檔）每個外部呼叫都被 monkeypatch 掉，零 DB 零網路。
加 service 只會浪費 30 秒啟動。等真的有 DB 整合測時再補（伴隨
issue #48 backend pytest 覆蓋）。

---

## 3. web job 細節

```yaml
- uses: actions/checkout@v4
- uses: oven-sh/setup-bun@v2
  with:
    bun-version: "1.2.15"
- name: Cache bun
  uses: actions/cache@v4
  with:
    path: ~/.bun/install/cache
    key: bun-${{ runner.os }}-${{ hashFiles('apps/web/bun.lock') }}
- run: cd apps/web && bun install --frozen-lockfile
- run: cd apps/web && bun run typecheck
- run: cd apps/web && bun run build
```

### Bun 版本 pin 1.2.15
`apps/web/package.json` 沒有 `packageManager` 欄位（npm corepack 慣例），
所以只能照本機 dev 環境 pin。理想做法是補 `packageManager` 欄位，
讓 dev / CI 都從同一個 source of truth 取版本——這留作 follow-up。

### `bun install --frozen-lockfile`
跟 uv `--frozen` 同義：lockfile 必須跟 `package.json` 同步，drift 直
接 fail。CI 環境必加。

### 沒跑 lint 的原因見 §0
不是忘記，是故意。

---

## 4. 跑出來的數字

第一次推上去就全綠：
- `api`: 35 秒（含 cache miss 第一次跑）
- `web`: ~50 秒（含 build）

之後 cache 命中時應該 <20 秒。

---

## 5. 常見地雷

### `uv: command not found`
忘記 `astral-sh/setup-uv@v3` 那一步，或 step 順序顛倒。
`setup-uv` 要在所有 `uv ...` step 之前。

### Cache hit 但 `.venv` 是壞的
通常是上次跑到一半被 cancel、寫了不完整的 venv 進 cache。解法：
push 一個改 `uv.lock` 的 commit（即使只改空白、改回來），cache key
變、強制重 build。

### `bun install --frozen-lockfile` 在 fork PR 會炸
fork 的人沒辦法重 gen lockfile（沒 push 權限），如果他們 PR 改了
`package.json` 沒同步 `bun.lock` 就會 fail。這是 feature 不是 bug
——禁止 lockfile drift 進 main。

### 在 `uses:` action 後 `with:` 裡用 `${{ secrets.X }}` 但 secret 沒設
GitHub 不會在 fork PR 上注入 secret。如果 CI 真的需要 secret（例如
未來上 Codecov），要走 `pull_request_target` + 嚴格的 manifest 檢查，
不能直接用 `pull_request`。本 workflow 沒用任何 secret，不踩這雷。

### Action 升 major
`actions/checkout@v4` 哪天升 v5 時、`@v4` 不會自動跟，要手動改。
這是 trade-off：穩定 vs 自動更新。穩定派比較保守，本 workflow 站
在這邊。

---

## 6. 延伸閱讀

- [astral-sh/setup-uv](https://github.com/astral-sh/setup-uv) — uv 官方 action
- [oven-sh/setup-bun](https://github.com/oven-sh/setup-bun) — bun 官方 action
- [GitHub Actions concurrency docs](https://docs.github.com/en/actions/using-jobs/using-concurrency)
- [GITHUB_TOKEN permissions](https://docs.github.com/en/actions/security-guides/automatic-token-authentication#modifying-the-permissions-for-the-github_token) — 為什麼 `permissions: contents: read` 該是預設

---

## 7. 決策 trade-offs

**做的取捨：**
- 兩 jobs 不用 matrix：兩棧步驟差太多（Python+uv vs JS+bun），matrix
  反而 debug 困難。獨立 job 比較直觀。
- 不接 Codecov / coverage report：先讓 CI 綠，coverage 是下個議題。
- 不跑 docker build：build api docker image 要 BuildKit、可能要 push
  registry，scope 太大；單純跑 `uv sync` + `pytest` 就涵蓋程式正確性。

**沒做（但可以做）的事：**
- Dependabot / Renovate：依賴更新自動 PR。等 issue #48 把測試補齊後
  再加，否則自動更新一炸 CI 沒人能 review。
- `paths` 過濾（只在 `apps/api/**` 改動跑 api job）：repo 還小，全跑
  也才 1 分鐘，現在做提早最佳化沒意義。
- Job summaries（用 `$GITHUB_STEP_SUMMARY` 印 ruff/pytest 結果到 PR
  頁面）：是錦上添花，等 CI 真的常用後再加。
- Required status check：等這個 workflow 在 main 上跑穩定一陣子之後，
  在 GitHub repo settings 把 `api` / `web` 設成 required。先別硬綁。
