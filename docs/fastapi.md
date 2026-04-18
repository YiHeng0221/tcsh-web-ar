# FastAPI 學習筆記

帶你走過 `apps/api` 的結構、FastAPI 背後的設計思想、以及之後怎麼擴充。

---

## 1. FastAPI 是什麼

FastAPI 是一個 Python web 框架，建立在兩個核心想法上：

1. **型別註解就是資料契約。** 你用 Pydantic model 來註解 function 參數，
   FastAPI 會自動驗證進來的 request、序列化出去的 response。
2. **OpenAPI 白送。** 每個 endpoint 自動出現在 `/docs` 的 Swagger UI，
   型別正確、有範例、可以直接在網頁上測試。

底層 server 是 **Uvicorn**，一個 ASGI（async）server。FastAPI 的 route
可以是 `def`（同步）或 `async def`（非同步）；我們用 async，這樣 DB、
HTTP、Supabase 之類的 I/O 才不會擋住其他請求。

---

## 2. 程式碼導覽

### 2.1 進入點 — `src/tcsh_ar_api/main.py`

```python
app = FastAPI(title="tcsh-web-ar API", version=__version__, ...)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, ...)
app.include_router(health.router)
app.include_router(artworks.router)
```

- `FastAPI(...)` 建立 app。title 跟 version 會顯示在 OpenAPI spec 跟
  Swagger UI 上。
- `CORSMiddleware` 允許前端在 dev 環境從 `http://localhost:5173` 打我們。
  上 prod 的時候要鎖死成真正的 domain。
- 每個 route 群組住在自己的檔案（`routes/` 底下），透過 `include_router`
  掛進來。

### 2.2 設定 — `src/tcsh_ar_api/config.py`

```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", ...)
    database_url: str = ...
    supabase_url: str = ...
```

我們用 `pydantic-settings` 把 `.env` + process 環境變數讀進一個有型別
的 `Settings` 物件。`get_settings()` 用 `lru_cache` 記憶化，所以每個
process 只會讀一次檔。

**規則：** app 程式碼**絕對不要直接 `os.getenv`**。永遠透過
`Settings`——這樣每個環境變數都有型別檢查，而且集中在一個地方記錄。

### 2.3 Routes — `src/tcsh_ar_api/routes/`

每個檔案定義一個 `APIRouter`：

```python
router = APIRouter(prefix="/artworks", tags=["artworks"])

@router.get("", response_model=list[Artwork])
async def list_artworks() -> list[Artwork]:
    return []
```

- `prefix` 是 path 的 base——這個 endpoint 服務於 `GET /artworks`。
- `tags` 會在 Swagger 裡把 endpoint 分組。
- `response_model` 告訴 FastAPI 要驗證跟序列化回傳值。它也會進 OpenAPI
  spec，所以前端可以從它產生 TS 型別。

---

## 3. 加新 endpoint — 實戰範例

假設我們要加 `POST /artworks/{artwork_id}/objects` 來在某個 artwork 下
建立新物件。步驟：

### 3.1 定義 Pydantic model

寫在 `routes/artworks.py`（或是拆到 `models/artwork.py`，等它變大的話）：

```python
from pydantic import BaseModel, Field

class CreateObjectRequest(BaseModel):
    label: str = Field(min_length=1, max_length=128)
    anchor_transform: dict  # 之後再細化

class ArtworkObject(BaseModel):
    id: str
    artwork_id: str
    label: str
```

### 3.2 加 route

```python
@router.post("/{artwork_id}/objects", response_model=ArtworkObject, status_code=201)
async def create_object(
    artwork_id: str,
    payload: CreateObjectRequest,
) -> ArtworkObject:
    # TODO: 透過 SQLAlchemy 寫進 DB
    return ArtworkObject(id="stub", artwork_id=artwork_id, label=payload.label)
```

FastAPI 會解析 URL、用 `CreateObjectRequest` 驗證 JSON body——如果驗證
失敗會直接回 422 附上詳細錯誤資訊，**根本不會跑到你的 function**。

### 3.3 測試

打開 http://localhost:8000/docs，找到新的 endpoint，按「Try it out」，
填表單，按 Execute。你會即時看到 request 跟 response。

### 3.4 重新產生前端型別（之後接上的時候）

```bash
cd apps/web
bun run generate-api-types   # 之後會加：用 openapi-typescript 打 /openapi.json
```

---

## 4. Async 的基本原則

- **預設全部用 `async def`**，除非有明確理由不要。FastAPI 的同步 handler
  會在 thread pool 上跑，小 app 還 OK 但會失去 async 的 scaling 優勢。
- **不要在 `async def` 裡呼叫 blocking library。** async route 裡不能寫
  `requests.get(...)`——要用 `httpx.AsyncClient`。不能用
  `time.sleep(...)`——要用 `await asyncio.sleep(...)`。
- **DB query：用 async SQLAlchemy session。** 我們特地裝了 `asyncpg` +
  `AsyncSession` 就是為了這個。

---

## 5. 資料庫存取（等之後接上時）

計劃的結構：

```
src/tcsh_ar_api/db/
  __init__.py
  session.py      # engine + session factory
  models/
    __init__.py
    artwork.py    # SQLAlchemy model
    object.py
```

`session.py` 大概長這樣：

```python
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from tcsh_ar_api.config import get_settings

settings = get_settings()
engine = create_async_engine(settings.database_url, pool_pre_ping=True)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
```

在 route 裡：

```python
from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from tcsh_ar_api.db.session import get_db

@router.get("/artworks")
async def list_artworks(db: AsyncSession = Depends(get_db)) -> list[Artwork]:
    result = await db.execute(select(ArtworkRow))
    return [Artwork.model_validate(r) for r in result.scalars()]
```

Migration 走 **Alembic**：

```bash
cd apps/api
uv run alembic init -t async alembic      # 一次性初始化
uv run alembic revision --autogenerate -m "create artworks table"
uv run alembic upgrade head
```

---

## 6. Supabase Auth（規劃中）

Supabase 會發 JWT。我們的後端不需要來回打 Supabase 就能驗證：

- 對稱（HS256）：用 `SUPABASE_JWT_SECRET` 解碼。
- 或非對稱：打 Supabase 的 JWKS endpoint 拿公鑰。

Dependency 會長這樣：

```python
from fastapi import Header, HTTPException
from jose import jwt

async def current_user(authorization: str = Header(...)):
    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = jwt.decode(token, settings.supabase_jwt_secret, algorithms=["HS256"])
    except jwt.JWTError as e:
        raise HTTPException(401, "Invalid token") from e
    return payload  # 內含 sub（user id）、role、email

```

然後任何要保護的 route 就加上 `user = Depends(current_user)`。

---

## 7. 用 pytest 寫測試

資料夾：`tests/`。冒煙測試範例：

```python
from httpx import AsyncClient
from tcsh_ar_api.main import app

async def test_health():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        r = await ac.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
```

用 `make test` 或 `uv run pytest` 跑。

---

## 8. 常見地雷

- **忘記 `response_model`。** 沒寫的話，FastAPI 會直接回傳你 return 的
  東西，跳過驗證，OpenAPI spec 也會不清楚。
- **Pydantic 的 mutable default 參數。** 用 `Field(default_factory=list)`
  而不是 `= []`。
- **在非 route function 裡用 `Depends`。** `Depends(...)` 只能當 route
  handler（或其他 dep）的預設值。不要 inline 呼叫它。
- **Import 時有 side effect。** 不要在 module import 時開 DB 連線——
  包到啟動 hook 或 dependency 裡。

---

## 9. 延伸閱讀

- 官方文件：https://fastapi.tiangolo.com/ （寫得非常好）
- SQLAlchemy 2.0 async：https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html
- Pydantic v2：https://docs.pydantic.dev/latest/
- Alembic：https://alembic.sqlalchemy.org/
