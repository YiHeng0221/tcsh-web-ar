# Backend architecture decision

**Date:** 2026-04-18
**Status:** Accepted
**Context issues:** #3 ~ #10

---

## TL;DR

採用 **layered + domain-modular** 架構。依 domain（`anchors`、`objects`、
`placements`、`textures`、`auth`）組織模組，每個模組內部分層為
**router → service → repository → model**。Schema（Pydantic）與 Model（SQLAlchemy）
嚴格分開。所有 I/O 走 async。

---

## 為什麼不用…

- **完整 DDD / Hexagonal：** 過度工程。專案規模小（~200 物件、單一藝術裝置），
  Aggregate / Value Object / Bounded Context 的概念負擔大於收益。
- **整個 monolith 平鋪 routes/ + models/：** 小專案可以，但 domain 一多就亂
  （CLAUDE.md 已列出 3 個 mode × 多個 entity，domain 邊界夠清楚可以分）。
- **Microservices：** 現階段 1 個 FastAPI 可搞定所有需求，拆服務只會增加
  部署與跨服務 contract 的成本。

---

## 參考資料

- [zhanymkanov/fastapi-best-practices](https://github.com/zhanymkanov/fastapi-best-practices)
  — domain-modular 結構的實戰建議
- [FastAPI + SQLAlchemy 2.0 Modern Async Database Patterns (Medium)](https://dev-faizan.medium.com/fastapi-sqlalchemy-2-0-modern-async-database-patterns-7879d39b6843)
- [Patterns and Practices for using SQLAlchemy 2.0 with FastAPI](https://chaoticengineer.hashnode.dev/fastapi-sqlalchemy)
- [Building a Production-Grade Async Backend with FastAPI, SQLAlchemy, PostgreSQL, and Alembic](https://medium.com/@rosewabere/building-a-production-grade-async-backend-with-fastapi-sqlalchemy-postgresql-and-alembic-062280264d28)
- [FastAPI Project Structure: Production Architecture Guide (2026) — Zestminds](https://www.zestminds.com/blog/fastapi-project-structure/)

---

## 目錄結構

```
apps/api/
├── alembic.ini
├── alembic/
│   ├── env.py                      # async 版
│   ├── script.py.mako
│   └── versions/
│       └── 0001_initial_schema.py
├── pyproject.toml
├── src/tcsh_ar_api/
│   ├── __init__.py                 # __version__
│   ├── main.py                     # FastAPI 實例、CORS、router 註冊
│   ├── config.py                   # Settings、get_settings()
│   │
│   ├── db/                         # 共用資料庫基礎設施
│   │   ├── __init__.py
│   │   ├── base.py                 # DeclarativeBase / Base metadata
│   │   └── session.py              # async engine, SessionLocal, get_db()
│   │
│   ├── core/                       # 跨模組共用的核心工具
│   │   ├── __init__.py
│   │   ├── exceptions.py           # AppException 基底 + handler
│   │   └── logging.py              # 結構化 log 設定（若需要）
│   │
│   ├── health/                     # health check（獨立極小模組）
│   │   ├── __init__.py
│   │   └── router.py
│   │
│   ├── auth/                       # Supabase JWT 驗證
│   │   ├── __init__.py
│   │   ├── dependencies.py         # require_admin, get_current_user
│   │   ├── schemas.py              # TokenClaims, CurrentUser
│   │   ├── service.py              # JWKS fetch + cache, verify_jwt
│   │   └── exceptions.py
│   │
│   ├── anchors/                    # 站點 domain
│   │   ├── __init__.py
│   │   ├── router.py
│   │   ├── schemas.py              # AnchorCreate / Update / Out
│   │   ├── models.py               # SQLAlchemy Anchor
│   │   ├── repository.py           # AnchorRepository
│   │   ├── service.py              # AnchorService
│   │   └── exceptions.py
│   │
│   ├── objects/                    # 同上
│   ├── placements/                 # 同上
│   ├── textures/                   # 同上 + storage.py 包 Supabase Storage
│   │
│   └── seed.py                     # python -m tcsh_ar_api.seed
│
└── tests/
    ├── conftest.py                 # pytest fixtures: test DB, client
    ├── unit/
    │   ├── test_anchors_service.py
    │   └── ...
    └── integration/
        ├── test_anchors_api.py
        └── ...
```

---

## 分層職責

| Layer | 負責 | 不該做 |
| --- | --- | --- |
| **router** | HTTP method/path、decode 請求成 schema、呼叫 service、決定 status code | 直接碰 SQLAlchemy、寫 SQL、處理 JWT 解析 |
| **service** | 協調多個 repository、業務規則、開關 transaction | 碰 HTTP 物件（Request / Response） |
| **repository** | 純資料存取（CRUD、SQL 查詢） | 業務邏輯、跨 entity 的決策 |
| **model** | 定義資料庫表結構 | 業務邏輯、驗證 |
| **schema** | 定義 HTTP 邊界的輸入 / 輸出契約 | 定義資料庫欄位（不要把 ORM model 當 schema 用） |

---

## 關鍵實作決策

### 1. Async session 管理

使用 FastAPI dependency `get_db` 注入 `AsyncSession`：

```python
# db/session.py
engine = create_async_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
```

`expire_on_commit=False` 在 async 環境下是必要設定（避免 commit 後 lazy-load
踩到已 detach 的 instance）。

### 2. Repository 介面

每個 domain module 自己的 `repository.py`，不做 BaseRepository 抽象（等真的
共用邏輯多再抽）。Repository 方法都 take session 作為參數，不在自己裡面
開 session。

```python
# anchors/repository.py
class AnchorRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list(self) -> list[Anchor]:
        result = await self.session.execute(select(Anchor))
        return list(result.scalars())

    async def get(self, anchor_id: UUID) -> Anchor | None:
        return await self.session.get(Anchor, anchor_id)

    async def create(self, data: AnchorCreate) -> Anchor:
        anchor = Anchor(**data.model_dump())
        self.session.add(anchor)
        await self.session.flush()     # flush 拿 id，不 commit（service 決定）
        return anchor
```

### 3. Service 擁有 transaction 邊界

```python
# anchors/service.py
class AnchorService:
    def __init__(self, repo: AnchorRepository) -> None:
        self.repo = repo

    async def create(self, data: AnchorCreate) -> Anchor:
        anchor = await self.repo.create(data)
        await self.repo.session.commit()
        await self.repo.session.refresh(anchor)
        return anchor
```

跨 repository 的操作在 service 層開 transaction，失敗時 rollback。

### 4. Router 只做 HTTP dance

```python
# anchors/router.py
router = APIRouter(prefix="/anchors", tags=["anchors"])

def get_service(db: AsyncSession = Depends(get_db)) -> AnchorService:
    return AnchorService(AnchorRepository(db))

@router.get("", response_model=list[AnchorOut])
async def list_anchors(svc: AnchorService = Depends(get_service)) -> list[AnchorOut]:
    anchors = await svc.list()
    return [AnchorOut.model_validate(a) for a in anchors]
```

### 5. Alembic async env.py

關鍵設定（避免常見踩雷）：

```python
# alembic/env.py 節錄
from sqlalchemy.ext.asyncio import create_async_engine
from tcsh_ar_api.db.base import Base

# 載入所有 model，讓 autogenerate 看得到
from tcsh_ar_api.anchors import models as _a  # noqa
from tcsh_ar_api.objects import models as _o  # noqa
from tcsh_ar_api.placements import models as _p  # noqa
from tcsh_ar_api.textures import models as _t  # noqa

target_metadata = Base.metadata

async def run_migrations_online() -> None:
    connectable = create_async_engine(settings.database_url)
    async with connectable.connect() as conn:
        await conn.run_sync(do_run_migrations)
    await connectable.dispose()
```

### 6. Auth — Supabase JWT verification

`auth/service.py` 抓 JWKS 快取，`auth/dependencies.py` 提供 `require_admin`：

```python
# auth/dependencies.py
async def require_admin(
    token: str = Depends(oauth2_bearer),
    auth: AuthService = Depends(get_auth_service),
) -> CurrentUser:
    claims = await auth.verify_jwt(token)
    if claims.role != "admin":
        raise HTTPException(403, "admin required")
    return CurrentUser(id=claims.sub, role=claims.role)
```

所有寫入 API 的 router 用 `Depends(require_admin)`，讀取公開。

### 7. Textures storage

`textures/storage.py` 包住 Supabase Storage SDK 的簽 URL 呼叫。service 層
透過它產生 signed upload URL、client 直接 PUT。service role key 只在 backend。

---

## 測試策略

- **unit tests**（`tests/unit/`）— 測 service 層，用 mock repository
- **integration tests**（`tests/integration/`）— 測 router，用 httpx
  `AsyncClient` + 測試資料庫（可用 `pytest-postgresql` 或 Docker compose test DB）
- repository 層不直接單測（它只包 SQLAlchemy，和 DB 整合測最有意義）

---

## 從目前 skeleton 過渡

現在 `apps/api/src/tcsh_ar_api/` 下有：
- `routes/health.py` → 移到 `health/router.py`
- `routes/artworks.py` → **刪除**（spec 沒這個 domain，當初 placeholder）

這些過渡會併在 #4 實作裡一起做（#4 本來就是建立基礎結構）。

---

## Trade-offs 列清單

**選擇：** layered + domain-modular
**益處：** 擴充 domain 不用改既有 module、分層讓測試容易寫、職責明確
**成本：** 初期檔案數多（5-7 個 file 才做一個簡單 CRUD）、小改動可能要跨多個 file
**何時要反悔：** 若未來專案縮到只剩 <100 行 business logic，可以扁平化回
`routes/` + `models.py`。目前（預估 ~2k 行 backend）值得保留結構。
