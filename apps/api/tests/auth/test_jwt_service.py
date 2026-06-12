"""Tests for the local single-admin auth service.

Covers:
- bcrypt round-trip (hash → verify pass / fail)
- JWT mint → verify round-trip
- Reject expired tokens
- Reject tokens signed with the wrong secret
- Reject `alg=none` confusion attempts
- Reject malformed tokens
"""

from __future__ import annotations

import time

import jwt as pyjwt
import pytest
from pydantic import SecretStr

from tcsh_ar_api.auth.exceptions import InvalidTokenError
from tcsh_ar_api.auth.service import (
    hash_password,
    mint_token,
    verify_password,
    verify_token,
)
from tcsh_ar_api.config import Settings


def _make_settings(secret: str = "test-secret-32bytes-1234567890ab") -> Settings:
    """Build a Settings instance pinned to a known JWT secret for the test."""
    return Settings(
        jwt_secret=SecretStr(secret),
        admin_email="admin@example.test",
        admin_password_hash="",
        jwt_expires_seconds=60,
    )


def test_hash_then_verify_password_round_trip() -> None:
    h = hash_password("hunter2-correct-horse-battery-staple")
    assert verify_password("hunter2-correct-horse-battery-staple", h) is True
    assert verify_password("hunter3", h) is False


def test_verify_password_returns_false_for_empty_hash() -> None:
    # Configures the "no admin set up" branch — login must reject, not 500.
    assert verify_password("anything", "") is False


def test_verify_password_returns_false_for_garbage_hash() -> None:
    assert verify_password("x", "not-a-bcrypt-hash") is False


def test_mint_then_verify_token_round_trip() -> None:
    s = _make_settings()
    token = mint_token("admin@example.test", settings=s)
    user = verify_token(token, settings=s)
    assert user.email == "admin@example.test"
    assert user.is_admin is True


def test_verify_token_rejects_wrong_secret() -> None:
    minting_settings = _make_settings(secret="secret-A-padding-padding-padding")
    verifying_settings = _make_settings(secret="secret-B-padding-padding-padding")
    token = mint_token("admin@example.test", settings=minting_settings)
    with pytest.raises(InvalidTokenError):
        verify_token(token, settings=verifying_settings)


def test_verify_token_rejects_expired_token() -> None:
    s = _make_settings()
    # Issue a token with an exp in the past — pyjwt rejects on verify.
    payload = {
        "sub": "admin@example.test",
        "email": "admin@example.test",
        "is_admin": True,
        "iat": int(time.time()) - 120,
        "exp": int(time.time()) - 60,
    }
    expired = pyjwt.encode(payload, s.jwt_secret.get_secret_value(), algorithm="HS256")
    with pytest.raises(InvalidTokenError):
        verify_token(expired, settings=s)


def test_verify_token_rejects_alg_none() -> None:
    """An attacker can't downgrade alg to `none` — we explicit-allowlist HS256."""
    s = _make_settings()
    # `alg=none` tokens have no signature; pyjwt's decode with our allowlist
    # rejects them before any signature check.
    payload = {
        "sub": "admin@example.test",
        "email": "admin@example.test",
        "is_admin": True,
        "iat": int(time.time()),
        "exp": int(time.time()) + 60,
    }
    forged = pyjwt.encode(payload, key="", algorithm="none")
    with pytest.raises(InvalidTokenError):
        verify_token(forged, settings=s)


def test_verify_token_rejects_malformed_string() -> None:
    s = _make_settings()
    with pytest.raises(InvalidTokenError):
        verify_token("not-a-jwt-at-all", settings=s)
