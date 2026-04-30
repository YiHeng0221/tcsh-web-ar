# 2026-04-30 — Makefile 重整與 `make help` 自動目錄

**背景：** 原本 Makefile 是隨手加 target 的狀態，沒分組、沒說明文字、
新人想找指令只能 grep 或翻 README。這份 PR 把 Makefile 改成「分組 +
自動 help」結構，讓 `make` 或 `make help` 直接印出可讀的指令表。

對應 GitHub issue：#31。對應 PR：#58。

---

## 0. 為什麼這件事值得做

Makefile 是這個 repo 的**指令入口**——CLAUDE.md、README、setup.md 全
都引用 `make XXX`。當指令清單長到一定程度（這次重整後 27 個 target），
沒有結構就是維護災難：
- 新人不知道有什麼可以用，只好問或猜
- 加新 target 的人不確定該放哪、要不要新命名
- 改 target 行為時容易漏改文件
- 一致性低（`dev-api` vs `apiserver` vs `run-api` 都可能出現）

`make help` 是 Unix 老把戲：用 `##` 註解標記每個 target 的描述，
default goal 跑一段 awk 把它們整理成表格輸出。這樣 target list 跟
描述「同一份檔案、同一個地方」，不會 drift。

---

## 1. 新的分組

```text
Setup    setup, setup-api, setup-web (alias: install)
Dev      dev, dev-api, dev-web, dev-https, docker-up/down/build
Test     test, test-api, test-web
Lint     lint, lint-api, lint-web
Format   format, format-api, format-web
Type     typecheck, typecheck-api, typecheck-web
Build    build, build-api, build-web                ← 新增
DB       db-upgrade, db-downgrade, db-revision MSG="…",
         db-current, db-history                     ← 新增
Clean    clean, clean-api, clean-web
```

**設計取捨：**
- 每個分組都有「總 target」+「`-api` / `-web` 細分」。寫 PR 時通常
  只想跑某一邊的 lint，不必把另一邊也跑一次。
- `setup` 是新名字，`install` 保留為 alias——之前 README 跟 CI 都寫
  `make install`，要保持向後相容（rename without breaking 是 Makefile
  該守的契約）。
- `build` / `db` 兩組是這次新加的——之前散落在 docs 裡，現在收進來
  方便 reviewer 一次看完。
- `db-revision` 透過 `MSG="..."` 變數帶 Alembic message：
  ```bash
  make db-revision MSG="add anchors world_pos"
  ```
  漏 `MSG` 就 print usage 並 exit 2，不會傻傻地建一條 message 為空
  的 revision。

---

## 2. `make help` 怎麼自動產生

每個 target 後面接 `## description`：

```makefile
test-api:  ## 跑 api pytest（uv 環境）
	cd $(API_DIR) && uv run pytest
```

每個分組前面用一行 banner 註解：

```makefile
# ===== Test =====
```

預設 target 就是 help：

```makefile
.DEFAULT_GOAL := help

help:  ## 印出所有 target（這份 help 本身也會列）
	@awk 'BEGIN{FS=":.*##"; printf "..."} \
	      /^# ===== / {section=$$0; ...} \
	      /^[a-zA-Z0-9_-]+:.*?##/ { ... }' $(MAKEFILE_LIST)
```

效果：

```
$ make help

Setup
  setup           install Python + JS deps for both apps
  setup-api       install Python deps via uv
  setup-web       install JS deps via bun

Dev
  dev             run api + web together
  ...
```

**好處：** 加 target 的人只要記得加 `## desc`，help 自動有他的目錄；
不加就不會出現在 help（合理——沒描述的 target 通常是內部用）。

---

## 3. 變數降低重複

```makefile
API_DIR := apps/api
WEB_DIR := apps/web
```

之後所有指令都引用 `$(API_DIR)` / `$(WEB_DIR)`，目錄路徑要改一次到位。
這是基本功，但原本的 Makefile 沒做，多處硬寫 `cd apps/api`，要 rename
就很煩。

---

## 4. 與其他 PR 的衝突警告

這份 PR 的 `dev-https` 跟 PR #57（HTTPS dev server）的 `web-dev-https`
是**兩個不同名字、做幾乎一樣的事**——因為兩個 PR 都從 `origin/main`
平行分支出來，互相看不到對方。當兩個 PR 都要合進 main 時：

- **先合的那個**沒事
- **後合的那個** Makefile 一定衝突

解法：reviewer 合併時挑其中一個名字保留、另一個刪掉或加 alias。
建議保留 `dev-https`（這份 PR 的命名），語意比 `web-dev-https` 簡潔，
反正 Mode A 才需要 HTTPS、API 不需要、不會有 `api-dev-https`。

這件事的根因是平行 PR 沒有 sync，下次發類似平行任務時要在 prompt
裡明確告知對方在做什麼（避開命名空間 / 共用檔案）。

---

## 5. 驗證

跑過確認可以：
- `make help` — grouped 表格輸出正常
- `make lint-api` — `All checks passed!`
- `make typecheck-api` — `Success: no issues found in 45 source files`
- `make test-api` — 7 passed
- `make db-current` — alembic CLI 正常被呼叫（連線失敗是預期，沒 `.env`）
- `make lint-web` 失敗——但這是 pre-existing 問題（ESLint 9 缺 flat
  config，main 上一樣壞），跟本 PR 無關

文件同步：
- `README.md` 的 Makefile targets 表
- `CLAUDE.md` 的 Commands 區塊
- `docs/setup.md` 第 7 節速查表

---

## 6. 常見地雷

### `make` 沒任何輸出
代表 default goal 沒設或設錯。`.DEFAULT_GOAL := help` 一定要在
Makefile 開頭附近，且 help target 真的存在。

### `awk` 在 macOS / Linux 行為不同
這份 Makefile 用的 awk 語法都是 POSIX 子集，過 macOS 自帶 awk +
Linux gawk 都可以。如果之後想用更花的功能（例如 `gensub`），記得只
有 gawk 有，要 fallback。

### Tab vs space
Makefile 規定 recipe line 必須用 **真 Tab**。VS Code 在 `.editorconfig`
設定 `indent_style = tab` 給 `Makefile`，存檔不會自動轉成空格。

### `make foo MSG="..."` 變數空白
給 Make 傳變數要用 `MSG="..."`（中間沒等號 + 空白），不是 `MSG = "..."`。
Make 會把後者當成 target 名。

### Alias 用 prerequisite 做
```makefile
install: setup  ## (alias) 等同 make setup
```
不是用 shell `alias`、不是 `cp setup install`。Make 的 alias 就是讓
target B 把 A 列為唯一前置條件、自己什麼都不做。

---

## 7. 延伸閱讀

- [GNU Make manual — Special Variables (`.DEFAULT_GOAL`, `MAKEFILE_LIST`)](https://www.gnu.org/software/make/manual/html_node/Special-Variables.html)
- [The "self-documenting Makefile" pattern](https://victoria.dev/blog/how-to-create-a-self-documenting-makefile/) — 這份 awk help 出處
- [POSIX awk reference](https://pubs.opengroup.org/onlinepubs/9699919799/utilities/awk.html)

---

## 8. 決策 trade-offs

**做的取捨：**
- `setup` / `install` 兩個名字並存：寧可冗餘，也不破壞既有 README、
  CI 的 `make install` 寫法。等下次 README/CI 都被改過後再考慮收斂。
- `dev-https` 不接 `make install` 自動裝 mkcert：mkcert 是全域工具，
  Makefile 不該替使用者裝 brew package。doc 講清楚就好。
- 分組順序按「跑開發流程的時序」（setup → dev → test → lint → format
  → typecheck → build → db → clean），不按字母——因為實際使用時的順序
  比字母順序更有意義。

**沒做（但可以做）的事：**
- `make ci` 一個 target 跑「lint + typecheck + test」全套：等 CI workflow
  落地後（PR #59）再加，避免重複定義。
- `make pre-commit`：等專案決定要不要用 pre-commit framework 再說。
- `make doctor`：檢查 brew、bun、uv 是否裝好。目前 setup.md 已 cover，
  之後若新人多再做。
