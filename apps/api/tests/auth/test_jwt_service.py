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
        return {"email": "x@example.test"}

    monkeypatch.setattr(service, "_find_key", _fake_find_key)
    monkeypatch.setattr("tcsh_ar_api.auth.service.jwt.decode", _fake_decode)

    with pytest.raises(InvalidTokenError, match="malformed token claims"):
        await service.verify(_make_token())


async def test_unknown_kid_throttle_prevents_jwks_amplification(
    service: JWTService, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Two quick hits with an unknown `kid` should force-refresh JWKS at most once."""
    import time as _time

    force_refresh_calls: list[bool] = []

    async def fake_fetch(*, force: bool = False) -> dict[str, object]:
        force_refresh_calls.append(force)
        # Mimic what the real fetch mutates so throttle state is accurate.
        service._jwks = {"keys": []}
        service._fetched_at = _time.monotonic()
        if force:
            service._last_force_refresh = _time.monotonic()
        return {"keys": []}

    monkeypatch.setattr(service, "_fetch_jwks", fake_fetch)

    token = _make_token(alg="ES256", kid="unknown-kid-xyz")
    with pytest.raises(InvalidTokenError):
        await service.verify(token)
    with pytest.raises(InvalidTokenError):
        await service.verify(token)

    # Across both verify calls: exactly one force=True refresh should fire.
    # The second unknown-kid lookup must be blocked by the throttle and raise
    # without touching the network again.
    forces = [f for f in force_refresh_calls if f]
    assert len(forces) == 1, (
        f"expected 1 force-refresh across 2 verify calls, got {len(forces)} "
        f"(all calls: {force_refresh_calls})"
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
