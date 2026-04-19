"""Regression tests for `auth.service.JWTService` security behavior.

Focus is the `alg` allow-list (JWT `alg` confusion) and the throttled
force-refresh (DoS amplification). Network is never touched — these tests
reject tokens before `_fetch_jwks` runs, or assert throttle timing without
fetching.
"""

from __future__ import annotations

import asyncio
import base64
import json

import pytest

from tcsh_ar_api.auth.exceptions import InvalidTokenError
from tcsh_ar_api.auth.service import JWTService


def _b64(payload: dict[str, str]) -> str:
    return base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()


def _make_token(
    *, alg: str | None = "ES256", kid: str | None = "k1", sub: str = "x"
) -> str:
    headers: dict[str, str] = {}
    if alg is not None:
        headers["alg"] = alg
    if kid is not None:
        headers["kid"] = kid
    # Signature part must still be valid base64url so python-jose's header
    # parser doesn't reject the token before we hit the alg check.
    sig = base64.urlsafe_b64encode(b"fake-signature" * 8).rstrip(b"=").decode()
    return f"{_b64(headers)}.{_b64({'sub': sub})}.{sig}"


@pytest.fixture
def service() -> JWTService:
    # URL doesn't need to resolve — all tests below fail before any network.
    return JWTService(
        "https://example.test/auth/v1/.well-known/jwks.json",
        issuer="https://example.test/auth/v1",
    )


async def test_rejects_hs256_alg_confusion(service: JWTService) -> None:
    """An attacker cannot downgrade the alg via the token header."""
    token = _make_token(alg="HS256", kid="any")
    with pytest.raises(InvalidTokenError, match="unsupported alg"):
        await service.verify(token)


async def test_rejects_missing_alg(service: JWTService) -> None:
    token = _make_token(alg=None, kid="any")
    with pytest.raises(InvalidTokenError, match="unsupported alg"):
        await service.verify(token)


async def test_rejects_missing_kid(service: JWTService) -> None:
    token = _make_token(alg="ES256", kid=None)
    with pytest.raises(InvalidTokenError, match="missing kid"):
        await service.verify(token)


async def test_rejects_malformed_token(service: JWTService) -> None:
    with pytest.raises(InvalidTokenError, match="malformed token header"):
        await service.verify("not-a-jwt-at-all")


async def test_malformed_claims_surface_as_invalid_token(
    service: JWTService, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Pydantic ValidationError on claims must become 401, not bubble up as 500."""

    async def _fake_find_key(_kid: str) -> dict[str, object]:
        return {"kid": "k1"}

    def _fake_decode(
        _token: str,
        _key: dict[str, object],
        **_kwargs: object,
    ) -> dict[str, object]:
        # `sub` is required by TokenClaims; a payload without it forces
        # pydantic to raise ValidationError from inside verify().
        return {
            "email": "x@example.test",
            "aud": "authenticated",
            "exp": 9999999999,
        }

    monkeypatch.setattr(service, "_find_key", _fake_find_key)
    monkeypatch.setattr("tcsh_ar_api.auth.service.jwt.decode", _fake_decode)

    with pytest.raises(InvalidTokenError, match="malformed token claims"):
        await service.verify(_make_token())


async def test_parallel_unknown_kids_share_one_force_refresh(
    service: JWTService, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Concurrent unknown-kid verify() calls must collapse into a single JWKS force-refresh.

    Regression for a race in the previous implementation: the throttle check
    lived in _find_key outside _fetch_lock, so N coroutines could each pass
    the check and each issue a force=True fetch — the lock serialized them
    but every one still hit upstream.
    """
    fetch_count = 0

    class _FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, list[dict[str, str]]]:
            return {"keys": []}

    class _CountingClient:
        def __init__(self, *_: object, **__: object) -> None:
            pass

        async def __aenter__(self) -> _CountingClient:
            return self

        async def __aexit__(self, *_: object) -> None:
            return None

        async def get(self, _url: str) -> _FakeResponse:
            nonlocal fetch_count
            fetch_count += 1
            await asyncio.sleep(0.01)
            return _FakeResponse()

    monkeypatch.setattr("tcsh_ar_api.auth.service.httpx.AsyncClient", _CountingClient)

    tokens = [_make_token(kid=f"unknown-{i}") for i in range(5)]
    results = await asyncio.gather(
        *(service.verify(t) for t in tokens),
        return_exceptions=True,
    )

    assert all(isinstance(r, InvalidTokenError) for r in results)
    # One warm fetch + exactly one force-refresh = 2 upstream calls, no matter
    # how many parallel unknown-kid callers piled up.
    assert fetch_count == 2, (
        f"expected 2 upstream fetches (warm + single force-refresh), got {fetch_count}"
    )


async def test_fetch_serialized_by_real_lock(
    service: JWTService, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Concurrent verify() calls must go through the production lock exactly once."""
    in_flight = 0
    peak = 0

    class _FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, list[dict[str, str]]]:
            return {"keys": []}

    class _SlowClient:
        def __init__(self, *_: object, **__: object) -> None:
            pass

        async def __aenter__(self) -> _SlowClient:
            return self

        async def __aexit__(self, *_: object) -> None:
            return None

        async def get(self, _url: str) -> _FakeResponse:
            nonlocal in_flight, peak
            in_flight += 1
            peak = max(peak, in_flight)
            await asyncio.sleep(0.01)
            in_flight -= 1
            return _FakeResponse()

    # Patch only the httpx client — the real `_fetch_lock` around it must
    # serialize concurrent callers. If the lock is removed or misplaced, peak
    # in-flight will exceed 1.
    monkeypatch.setattr("tcsh_ar_api.auth.service.httpx.AsyncClient", _SlowClient)

    await asyncio.gather(
        *(asyncio.create_task(service._fetch_jwks(force=True)) for _ in range(5)),
        return_exceptions=True,
    )
    assert peak == 1, f"expected serialized fetch (peak=1), got peak={peak}"
