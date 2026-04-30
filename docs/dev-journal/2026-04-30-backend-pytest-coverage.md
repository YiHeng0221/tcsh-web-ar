# 2026-04-30 — Backend pytest 覆蓋（anchors / objects / placements / textures / auth）

**背景：** repo 之前只有 7 個 JWT service 測試（`tests/auth/test_jwt_service.py`），
四個 domain CRUD（anchors / objects / placements / textures）+ FastAPI auth
dependency 完全沒測試。這份 PR 把覆蓋率拉到 89 個 test，整體 4 秒內跑完。

對應 GitHub issue：#48。對應 PR：#60。

---

## 0. 為什麼測試比想像中麻煩

寫 backend test 的「教科書答案」是：開個 in-memory SQLite + mock 一些
依賴 → done。這份 PR 走了一條更繞的路（**真的開 Postgres container**），
不是因為要刁難自己，是因為 service 層真的不能 mock。下面一條條解釋。

---

## 1. 為什麼是真實 Postgres、不 mock、不 SQLite

### Service 層依賴 Postgres-only 行為

`apps/api/src/tcsh_ar_api/anchors/service.py` / `placements/service.py` 都
有這種程式碼：

```python
except IntegrityError as e:
    sqlstate = getattr(e.orig, "sqlstate", None)
    if sqlstate == "23505":
        raise AnchorAlreadyExistsError(...)
    if sqlstate == "23503":
        raise AnchorInUseError(...)
    raise
```

`23505` / `23503` 是 **Postgres 的 SQLSTATE 錯誤碼**。SQLite 拋的
`IntegrityError` 沒有 sqlstate，連 `UNIQUE constraint failed: ...` 字串
都跟 Postgres 完全不同。如果用 SQLite 測，這個分類器永遠不會被驗證——
prod 上才發現「咦怎麼 405 不是 409」。

### JSONB 行為也不一樣

`placements.transform_translate / rotate / scale` 是 JSON 欄位，Postgres
用 native `JSONB`、SQLite 是字串。round-trip 後型別不同（dict vs str），
serialize 行為也不同。要驗 wire contract 必須 Postgres。

### Mock service / mock DB 的代價

如果 mock 掉 `AsyncSession` 或 service，等於只測「router 把 service 的
return 包成 JSON」這個 trivial 行為——分類器、JSONB serialize、FK 行為
全部沒被測，CI 通過時你還是不知道 prod 會不會炸。

> 記憶裡的 feedback 也呼應：tcsh-web-ar 的測試守則是「不 mock DB」。

### 解：testcontainers

```python
# conftest.py
@pytest.fixture(scope="session")
async def postgres_container():
    with PostgresContainer("postgres:16-alpine") as pg:
        yield pg
```

整個 test session 共用一台 ephemeral Postgres container，每個 test
function 用 TRUNCATE 洗資料（下一節）。dev dep 加了 `testcontainers[postgres]>=4.14.2`，
CI 上要 Docker 但 GitHub runner 本來就有。

---

## 2. TRUNCATE vs SAVEPOINT — 為什麼選 TRUNCATE

理想做法是「每個 test 包在一個 transaction，結束時 rollback」——零
side effect、最快。實作上有兩種：

| 做法 | 觀念 | 為什麼這次不行 |
| --- | --- | --- |
| **Top-level transaction + nested SAVEPOINT** | session 開一個外 transaction，test 跑時包 SAVEPOINT，結束 rollback to savepoint | service 內每呼叫一次 `commit()`、SAVEPOINT 就被釋放，下一次操作會在沒有 active tx 的狀態下發出。asyncpg dialect 看到 implicit reopen 會丟 `MissingGreenlet` |
| **每個 test 後 TRUNCATE** | 不開外 tx，每個 test 跑完手動清四張 mutable table | 樸素到無聊，但穩。 4 秒跑 89 個 test |

```python
# conftest.py
@pytest.fixture
async def db_session(postgres_engine):
    async with async_sessionmaker(postgres_engine, expire_on_commit=False)() as s:
        yield s
    async with postgres_engine.begin() as conn:
        await conn.execute(text(
            "TRUNCATE placements, ar_objects, textures, anchors RESTART IDENTITY"
        ))
```

trade-off：
- TRUNCATE 雖然「重」，但 4 張小表跑下來毫秒級
- service 不用為了測試而改架構（commit() 該怎麼用就怎麼用）
- code-level mental model 跟 prod 一致

---

## 3. Auth dependency override

router 用 FastAPI 的 `Depends(get_current_user)` / `Depends(require_admin)`
拿登入身份。測試要切換「匿名 / 一般使用者 / admin」三種角色，不需要每次
重簽 JWT，用 FastAPI 的 `dependency_overrides` 蓋掉就好：

```python
# conftest.py
auth_state = {"role": None}

async def fake_current_user():
    if auth_state["role"] is None:
        raise HTTPException(401)
    return {"sub": "test-user", "role": auth_state["role"]}

@pytest.fixture(autouse=True)
def override_auth(app):
    app.dependency_overrides[get_current_user] = fake_current_user
    app.dependency_overrides[require_admin] = fake_require_admin
    yield
    app.dependency_overrides.clear()

@pytest.fixture
def as_admin():
    auth_state["role"] = "admin"
    yield
    auth_state["role"] = None

@pytest.fixture
def as_regular():
    ...

@pytest.fixture
def as_anonymous():
    ...
```

test 寫起來就是：

```python
async def test_create_anchor_requires_admin(client, as_regular):
    r = await client.post("/api/anchors", json={...})
    assert r.status_code == 403
```

**為什麼不直接簽真的 JWT？** 簽 JWT 要載 jwks / 鑄 token，無關 router
語意，又比較慢。JWT 本身的正確性留給 `test_jwt_service.py`（已存在）。

---

## 4. pytest-asyncio 升到 0.25 + session-scoped loop

這個是地雷集中區。如果你看到：

```
attached to a different loop
```

99% 是 fixture scope 跟 event loop scope 沒對齊。預設 pytest-asyncio
給每個 test function 開一個新的 loop——這跟 `scope="session"` 的
`postgres_engine` fixture 不相容（DB 連線池綁在 session loop 上，
test loop 看不到）。

解法：升級到 pytest-asyncio 0.25+，在 `pyproject.toml` 加：

```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
asyncio_default_test_loop_scope = "session"
```

這樣整個 session 共用一個 loop，session-scoped fixture 跟 function-scoped
test 跑在同一 loop 裡。

---

## 5. 找到的 finding：`AnchorInUseError` 是 dead code

寫到 anchors 刪除測試時發現一件事：

- service 的 `delete_anchor` 有處理 `IntegrityError(sqlstate=23503)` →
  raise `AnchorInUseError`
- **但** `placements.anchor_id` 的 FK 設成 `ON DELETE CASCADE`
- 也就是：刪 anchor 時 placements 會被自動 cascade 刪掉，**永遠不會
  丟 FK 錯誤**

所以那段 23503 處理是**永遠跑不到的死程式碼**。

兩種處理選項：

| 選項 | 結果 |
| --- | --- |
| FK 改成 `ON DELETE RESTRICT` | 刪 anchor 時若有 placements 會 raise FK error，分類器 catch 住變成 409 — UX 好（提示先刪 placements 才能刪 anchor），但 placement 不會自動清乾淨 |
| 拿掉那段 catch | 程式碼乾淨，CASCADE 行為依舊（admin UI 上要顯示「會連帶刪 N 個 placements」warning） |

這 PR 沒做決定，只用 `unittest.mock.patch` 注入假的 23503 錯誤，把
**分類器的 contract** 釘住——未來不管選 RESTRICT 還是拿掉 catch，
這個 test 至少守住「sqlstate=23503 → 409」這個合約。**值得開 follow-up
issue 討論。**

---

## 6. 沒 cover 的範圍

- **End-to-end Mode A/B/C flow**：照 issue #48 "Out of scope" 說明，
  留給 UI PR。
- **`AsyncClient` 不會把 server exception 包成 500**：這是 `httpx +
  ASGITransport` 預設行為（重拋）。所以 unhandled `IntegrityError` 的
  test 寫成 `pytest.raises(IntegrityError)` 而不是 `assert status == 500`。
  prod 端 FastAPI default handler 還是會回 500。reviewer 看到不要嚇到。
- **效能 / 負載測試**：超出 unit/integration 範疇，要做的話另開 issue。

---

## 7. 跟其他平行 PR 的關係

這份 PR 跟 #57 / #58 / #59 同一波平行 agent 派出的，互不相干：
- **沒**改 Makefile（不會撞 PR #58 的 reorg）
- **沒**改 vite config（不會撞 PR #57）
- **沒**改 .github/（不會撞 PR #59 的 CI）
- 加的 dev dep 只動 `apps/api/pyproject.toml` + `uv.lock`

但是要注意——**`apps/api/pyproject.toml` 在 `main` 工作目錄上有未提交
的本地修改**（Supabase → SQLite + 本地 bcrypt 遷移），因此這份 PR
基於 `origin/main`（仍是 Supabase + asyncpg）寫成。如果那批本地遷移
之後合進 main，這些測試需要對應調整：

- `IntegrityError.orig.sqlstate` 在 SQLite 上不存在，分類器邏輯本身要重寫
- `testcontainers[postgres]` 可能換成 in-process SQLite，testcontainers
  整段 conftest 要替換
- Auth dep override 不變（FastAPI 行為一樣）

這部分 reviewer 自己決定 merge 順序：**先合 SQLite 遷移再 rebase 這份 PR**
比較乾淨。

---

## 8. 常見地雷

### `asyncpg.exceptions.NotNullViolationError`
service 拋 `IntegrityError`，asyncpg 會把 underlying error 放到 `.orig`。
不要 catch `asyncpg.NotNullViolationError`——SQLAlchemy 會包一層。
固定 catch SQLAlchemy 的 `IntegrityError` 然後讀 `.orig.sqlstate`。

### testcontainers 第一次跑很慢
`docker pull postgres:16-alpine` 要先載 image。CI runner 已經有快取的話
通常 <2 秒，本機第一次大概 30 秒。

### `RuntimeError: Event loop is closed`
session-scoped fixture 在 teardown 時 loop 已經關掉。確定
`asyncio_default_test_loop_scope = "session"` 有設、且 fixture 用
`async with` 而不是 `await x()` 加手動 close。

### `dependency_overrides` 沒清乾淨
fixture 結束沒 `app.dependency_overrides.clear()`，下一個 test 就會帶
舊的 override 跑。永遠加 `yield` 後 cleanup。

### TRUNCATE 沒包到所有 mutable table
新加一張表卻忘記加進 TRUNCATE list，下個 test 就 leak 進舊資料。建議
寫成：`TRUNCATE TABLE foo, bar, baz RESTART IDENTITY CASCADE`，動 schema
時 conftest 也要更新。

---

## 9. 延伸閱讀

- [pytest-asyncio 0.25 release notes — `asyncio_default_test_loop_scope`](https://github.com/pytest-dev/pytest-asyncio/releases/tag/v0.25.0)
- [testcontainers-python](https://testcontainers-python.readthedocs.io/) — 還可以開 Redis、Kafka 等等
- [Postgres SQLSTATE codes](https://www.postgresql.org/docs/current/errcodes-appendix.html) — 23xxx 是 integrity violation
- [FastAPI testing — `dependency_overrides`](https://fastapi.tiangolo.com/advanced/testing-dependencies/)

---

## 10. 決策 trade-offs

**做的取捨：**
- 真實 Postgres > SQLite：service 層的 contract 不能用 mock 守。
- TRUNCATE > SAVEPOINT：穩定 > 美感，4 秒 89 個 test 已經很快。
- Auth `dependency_overrides` > 真 JWT：減少耦合，JWT 本身另外有測試。
- `unittest.mock.patch` 注入 dead-code 路徑：守 contract，不改 schema。

**沒做（但可以做）的事：**
- 加 coverage report（`pytest-cov`）：值得做，等 CI #59 落地後再加，
  避免一份 PR 動太多。
- factory_boy / faker 的 fixture builder：目前手寫 dict 還算清楚，等
  test 數量翻倍再考慮。
- snapshot test（response shape）：FastAPI 已經有 OpenAPI 校驗，
  這層覆蓋率沒必要拉太高。
- Anchors RESTRICT vs CASCADE 的決策：留 follow-up issue。
