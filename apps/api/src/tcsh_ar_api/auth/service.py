from __future__ import annotations

import time
from functools import lru_cache
from typing import Any

import httpx
from jose import jwt
from jose.exceptions import JWTError

from tcsh_ar_api.auth.exceptions import InvalidTokenError
from tcsh_ar_api.auth.schemas import TokenClaims
from tcsh_ar_api.config import get_settings

# Supabase caches the JWKS discovery endpoint for 10 minutes on their side,
# so we match that TTL locally. A shorter TTL would just hit the network more
# often for no benefit; a longer TTL would delay key rotation.
_JWKS_TTL_SECONDS: float = 600.0


class JWTService:
    """Verifies Supabase-issued JWTs against the project's JWKS.

    A single instance is shared across the process (created via
    `get_jwt_service()`). The JWKS is fetched lazily on first use and
    cached for `_JWKS_TTL_SECONDS`. On `kid` miss, the cache is forced to
    refresh once — this covers Supabase key rotations without a restart.
    """

    def __init__(self, jwks_url: str, audience: str = "authenticated") -> None:
        self._jwks_url = jwks_url
        self._audience = audience
        self._jwks: dict[str, Any] | None = None
        self._fetched_at: float = 0.0

    async def _fetch_jwks(self, *, force: bool = False) -> dict[str, Any]:
        now = time.monotonic()
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
        assert self._jwks is not None
        return self._jwks

    async def _find_key(self, kid: str) -> dict[str, Any]:
        jwks = await self._fetch_jwks()
        for key in jwks.get("keys", []):
            if key.get("kid") == kid:
                return key  # type: ignore[no-any-return]
        # Miss — force a refresh in case Supabase rotated keys.
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
        alg = headers.get("alg")
        if not alg:
            raise InvalidTokenError("token header is missing alg")

        key = await self._find_key(kid)

        try:
            claims = jwt.decode(
                token,
                key,
                algorithms=[alg],
                audience=self._audience,
                options={"verify_aud": True},
            )
        except JWTError as exc:
            raise InvalidTokenError(str(exc)) from exc

        return TokenClaims(**claims)


@lru_cache(maxsize=1)
def get_jwt_service() -> JWTService:
    """Returns the process-wide JWTService, configured from settings."""
    settings = get_settings()
    if not settings.supabase_jwks_url:
        raise RuntimeError(
            "SUPABASE_JWKS_URL is not configured; cannot verify JWTs. "
            "Set it in apps/api/.env."
        )
    return JWTService(settings.supabase_jwks_url)
