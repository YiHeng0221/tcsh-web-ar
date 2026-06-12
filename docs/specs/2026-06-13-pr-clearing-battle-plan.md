# PR Clearing Battle Plan — 實作說明書

> **讀者：** 負責 rebase / 衝突解決的 implementation agent（sonnet/opus）。
> **作者：** fable（主迴圈）。
> **狀態源頭：** `YiHeng0221/tcsh-web-ar`（個人 repo，AI review harness 已上線）。
> 原始 PR 在 `2enter/tcsh-web-ar`（#56-#63），分支已全數鏡像到個人 repo。
>
> 每個 agent 處理**一個分支**。完成定義：rebase 後分支推上 `yiheng` remote、
> PR 開好、CI 綠燈。AI review 的 findings 由 fable（主迴圈）處理，agent 不用管。

---

## 目前戰況（2026-06-13）

`main` = `4bf6ceb`（已含 AI review harness + gitleaks allowlist + mktemp fix）。

| 原 PR | 分支 | 狀態 | 處置 |
|-------|------|------|------|
| #57 | `chore/https-local-dev` | 乾淨 | ✅ 已開 PR #2，走自動 review |
| #58 | `chore/makefile-cleanup` | 乾淨 | ✅ 已開 PR #3 |
| #60 | `feature/backend-pytest-coverage` | 乾淨 | ✅ 已開 PR #4 |
| #59 | `chore/github-actions-ci` | 衝突 | ❌ **跳過——已被取代**。main 的 `ci.yml` 就是以這個分支為基底強化的（多了 size-guard / gitleaks / label job）。不要合、不要 rebase。 |
| #61 | `feature/sqlite-migration` | 衝突 | 🔧 Wave 2-A（最優先——它是 Mode C auth 的地基） |
| #56 | `feature/mode-b-b2-3d-viewer` | 衝突 | 🔧 Wave 2-B |
| #62 | `feature/mode-b-b3-b4` | 衝突 | 🔧 Wave 2-C（基於 B2，必須在 B2 之後） |
| #63 | `feature/mode-c-admin` | 衝突 | 🔧 Wave 2-D（基於 SQLite auth，必須在 sqlite 之後） |

**合併順序鐵則：** Wave 1（#2/#3/#4 全合）→ sqlite-migration → B2 → B3+B4 → Mode C。
每一步合併後，下一個分支要 rebase 到**最新的 main**。

---

## 通用規則（所有 agent）

1. **不改既有 commit 的語意。** Rebase 時解衝突，不順手重構、不加新功能。
2. **解衝突的原則：** 分支帶來的「新功能內容」優先；main 帶來的「harness /
   設定檔」優先。兩者重疊（如 `.gitignore`）→ 兩邊都保留。
3. 每個分支 rebase 完跑：`make typecheck && make lint`（或對應 app 的單獨
   命令）。api 動過就跑 `uv run pytest`。過不了不准開 PR——先修。
4. PR body 沿用原 PR（`gh pr view <N> --repo 2enter/tcsh-web-ar --json body`），
   末尾加 `_Ported from 2enter/tcsh-web-ar#<N>_`。
5. Push 到 `yiheng` remote（`https://github.com/YiHeng0221/tcsh-web-ar.git`）。
   分支名沿用原名。需要 force push 就 `--force-with-lease`。
6. **不要合併 PR**——開好 PR 讓 harness review，merge 由主迴圈決定。
7. 遇到無法判斷的衝突（例如兩邊都大改同一個 function），**停下來**，在最終
   報告裡標註 `BLOCKED: <file> <原因>`，不要瞎猜。

---

## Wave 2-A：`feature/sqlite-migration`（原 #61）

**這個分支做什麼：** Supabase（Postgres + Auth + Storage）→ SQLite（aiosqlite）
+ 本地單管理員 JWT auth + 檔案系統 texture 儲存。3 個 commit。

**已知衝突點：**

- `.gitignore` — main 加了 claude-code 區段（`.claude/worktrees/`）；分支加了
  sqlite 區段（`*.db` / `*.db-shm` / `*.db-wal`）跟 models 區段。**兩邊都留**，
  區段順序照分支版（env → python → node → editors → docker → project →
  sqlite → binary assets → claude code）。
- `apps/api/.env.example` — 分支重寫成 SQLite + 本地 auth 版本。**取分支版**。
- `apps/api/pyproject.toml` / `uv.lock` — 依賴變更（去 supabase、加 aiosqlite
  等）。**取分支版**；若 main 側也動過（不太可能），重跑 `uv lock`。
- `apps/api/src/tcsh_ar_api/auth/` — 分支全面重寫。**取分支版**。
- main 的 `f59cc98 fix(api): drop double /api/ prefix from domain routers` 觸過
  各 domain router——分支若也動了 router 檔，逐檔檢查 prefix 修法有沒有被
  rebase 蓋掉（搜 `prefix="/api/` 不應該再出現雙重前綴）。

**驗證：** `cd apps/api && uv sync && uv run ruff check src tests && uv run mypy
&& uv run pytest`。pytest 若紅，看是不是 #60（pytest-coverage，現在 PR #4）
先合進 main 造成的 Supabase 時代測試 vs SQLite 新 auth 衝突——這正是預期中
最大的雷區：**pytest-coverage 的測試是針對 Supabase auth 寫的，sqlite 分支
重寫了 auth**。如果 PR #4 已合，你要把它新增的 auth 測試改寫成對 SQLite
auth（local JWT）有效的版本；參考分支自己帶的測試。改不動就標 BLOCKED。

---

## Wave 2-B：`feature/mode-b-b2-3d-viewer`（原 #56）

**這個分支做什麼：** Mode B 的 B2 3D viewer（R3F 場景、glTF 載入、auto-fit
camera、pivot recenter、texture disposal）。7 個 commit，**已含兩輪 AI review
修正**（`6086fc1`、`e502b84`）——這是正典，不要從 backup/wip 拿東西。

**已知衝突點：**

- `apps/web/src/modes/b/ModeBRoot.tsx` — main 是 stub，分支是真實作。**取分支版**。
- `apps/web/package.json` + `bun.lock` — 分支可能加了 3D 相關依賴。**取分支版**，
  rebase 後重跑 `bun install` 確認 lockfile 一致。
- `.gitignore` — 分支加了 `apps/web/public/models/*` 區段；經過 Wave 2-A 之後
  main 可能已經有了（sqlite 分支也帶這段）。重複就去重。
- 路由註冊檔（`App.tsx` / router 設定）— main 在 A1/A2 合併後動過。保兩邊：
  Mode A 路由 + Mode B lazy route。

**驗證：** `cd apps/web && bun install && bun run typecheck && bun run build`。

---

## Wave 2-C：`feature/mode-b-b3-b4`（原 #62）

**前置：** Wave 2-B 已合進 main 才動工。

**這個分支做什麼：** B3 Search + B4 List。基於 B2 的場景架構。

**已知衝突點：** 主要跟 B2 的檔案重疊（router、Mode B 目錄）。rebase 到含 B2
的 main 後衝突應大幅減少。Search/List 元件本身是新檔，少衝突。

**驗證：** 同 2-B。

---

## Wave 2-D：`feature/mode-c-admin`（原 #63）

**前置：** Wave 2-A（sqlite + 本地 auth）已合進 main 才動工。

**這個分支做什麼：** Mode C 管理介面全套（C1 login → C5 placement editor）。
Auth 流程對接的是 **SQLite 本地 JWT auth**（#61 的產物）。

**已知衝突點：**

- `ModeCRoot.tsx` — main 是 stub。**取分支版**。
- Auth client（`apps/web/src/lib/api/`）— 分支加了 login / token 處理。確認
  對接的 endpoint 是 sqlite 分支定義的（`/auth/login` 本地版），不是 Supabase。
- Router / lazy loading — 同 2-B 的處理原則。

**驗證：** 同 2-B，外加手動確認 `bun run build` 後 Mode C chunk 是獨立的
（code-split 規則：訪客不下載 admin bundle）。

---

## 收尾（主迴圈做，agent 不用管）

- 全部合完後：`backup/wip-2026-05-07` 裡剩餘的 wip commit（`773a127`）逐檔
  比對 main，撿回任何漏掉的修正，其餘丟棄；刪除 backup 分支。
- 在 origin（2enter）關掉 #56-#63 並留言指向個人 repo 的對應 merge。
- 刪 `chore/github-actions-ci`（已被取代）。
