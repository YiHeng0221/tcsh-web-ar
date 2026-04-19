from __future__ import annotations

import asyncio
import time
from functools import lru_cache
from typing import Any

import httpx
from jose import jwt
from jose.exceptions import JWTError
from pydantic import ValidationError

from tcsh_ar_api.auth.exceptions import InvalidTokenError
from tcsh_ar_api.auth.schemas import TokenClaims
from tcsh_ar_api.config import get_settings

# Supabase caches the JWKS discovery endpoint for 10 minutes on their side,
# so we match that TTL locally. A shorter TTL would just hit the network more
# often for no benefit; a longer TTL would delay key rotation.
_JWKS_TTL_SECONDS: float = 600.0

# Minimum gap between forced JWKS refreshes. Prevents an attacker who sends
# tokens with random `kid` values from amplifying into unbounded network
# calls to Supabase.
_FORCE_REFRESH_THROTTLE_SECONDS: float = 30.0

# Hardcoded allow-list — NEVER trust the `alg` from the token header. If
# Supabase ever changes its default signing algorithm this must be updated
# in lockstep (and in the JWKS key schema check below).
_ALLOWED_ALGS: tuple[str, ...] = ("ES256",)


class JWTService:
    """Verifies Supabase-issued JWTs against the project's JWKS.

    A single instance is shared across the process (created via
    `get_jwt_service()`). The JWKS is fetched lazily on first use and
    cached for `_JWKS_TTL_SECONDS`. On `kid` miss, the cache is forced to
    refresh at most once per `_FORCE_REFRESH_THROTTLE_SECONDS` — enough to
    recover from a genuine key rotation, not enough to be a DoS amplifier.
    """

    def __init__(
        self,
        jwks_url: str,
        *,
        issuer: str,
        audience: str = "authenticated",
    ) -> None:
        self._jwks_url = jwks_url
        self._issuer = issuer
        self._audience = audience
        self._jwks: dict[str, Any] | None = None
        self._fetched_at: float = 0.0
        # `None` means "never force-refreshed" — safer than 0.0 because
        # time.monotonic()'s origin isn't defined by the spec.
        self._last_force_refresh: float | None = None
        self._fetch_lock = asyncio.Lock()

    async def _fetch_jwks(self, *, force: bool = False) -> dict[str, Any]:
        async with self._fetch_lock:
            now = time.monotonic()
            # Re-check the throttle window *inside* the lock so concurrent
            # unknown-kid callers collapse into a single upstream fetch.
            # Without this, N coroutines can each pass the outer check in
            # _find_key and each queue up a force=True fetch — the lock
            # serializes them but every one still hits Supabase.
            if force and self._last_force_refresh is not None and (
                now - self._last_force_refresh
            ) < _FORCE_REFRESH_THROTTLE_SECONDS and self._jwks is not None:
                return self._jwks
            if (
                not force
                and self._jwks is not None
                and (now - self._fetched_at) < _JWKS_TTL_SECONDS
            ):
                return self._jwks
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(self._jwks_url)
                response.raise_for_status()
                self._jwks = response.json()
                self._fetched_at = now
                if force:
                    self._last_force_refresh = now
            if self._jwks is None:
                # Defensive: response.json() could only return None if the
                # upstream returned `null`, which isn't a valid JWKS.
                raise InvalidTokenError("JWKS upstream returned no body")
            return self._jwks

    async def _find_key(self, kid: str) -> dict[str, Any]:
        jwks = await self._fetch_jwks()
        for key in jwks.get("keys", []):
            if key.get("kid") == kid:
                return key  # type: ignore[no-any-return]
        # Miss. Try a force-refresh once; the throttle inside _fetch_jwks
        # guarantees at most one upstream fetch per throttle window even
        # under parallel unknown-kid load.
        jwks = await self._fetch_jwks(force=True)
        for key in jwks.get("keys", []):
            if key.get("kid") == kid:
                return key  # type: ignore[no-any-return]
        raise InvalidTokenError(f"no JWKS key matches kid={kid}")

    async def verify(self, token: str) -> TokenClaims:
        try:
            headers = jwt.get_unverified_header(token)
        except JWTError as exc:
            raise InvalidTokenError("malformed token header") from exc
        kid = headers.get("kid")
        if not kid:
            raise InvalidTokenError("token header is missing kid")

        header_alg = headers.get("alg")
        if header_alg not in _ALLOWED_ALGS:
            # Reject before touching the key. Prevents JWT `alg` confusion:
            # attacker header-declares `HS256`, forcing us to treat the RSA/EC
            # public key as a symmetric secret and validating forgeries.
            raise InvalidTokenError(f"unsupported alg: {header_alg!r}")

        key = await self._find_key(kid)

        try:
            claims = jwt.decode(
                token,
                key,
                algorithms=list(_ALLOWED_ALGS),
                audience=self._audience,
                issuer=self._issuer,
                options={
                    "verify_aud": True,
                    "verify_exp": True,
                    "verify_iss": True,
                },
            )
        except JWTError as exc:
            raise InvalidTokenError(str(exc)) from exc

        # Pin claims to our schema inside the same failure mode: a malformed
        # or unexpected payload must surface as 401, not leak as a 500 with
        # pydantic's stacktrace.
        try:
            return TokenClaims(**claims)
        except ValidationError as exc:
            raise InvalidTokenError("malformed token claims") from exc


@lru_cache(maxsize=1)
def get_jwt_service() -> JWTService:
    """Returns the process-wide JWTService, configured from settings.

    Called eagerly at app startup (see `main.lifespan`) so a missing JWKS
    URL or Supabase URL blows up on boot instead of on the first
    protected request.
    """
    settings = get_settings()
    if not settings.supabase_jwks_url:
        raise RuntimeError(
            "SUPABASE_JWKS_URL is not configured; cannot verify JWTs. "
            "Set it in apps/api/.env."
        )
    if not settings.supabase_url:
        raise RuntimeError(
            "SUPABASE_URL is not configured; cannot pin JWT issuer. "
            "Set it in apps/api/.env."
        )
    issuer = f"{settings.supabase_url.rstrip('/')}/auth/v1"
    return JWTService(settings.supabase_jwks_url, issuer=issuer)
