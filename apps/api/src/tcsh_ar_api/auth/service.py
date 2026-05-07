"""Local single-admin auth: bcrypt password hashing + HS256 JWT mint/verify.

There is no user table. The one admin's email + bcrypt password hash live in
environment variables (`ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`); login compares
against those, then mints a JWT signed with `JWT_SECRET`.

This module is the single place that touches `bcrypt` and `pyjwt` — keep
auth surface thin so swapping algorithms later only edits this file.

(Why not passlib? passlib 1.7.x predates the bcrypt 5.0 module rename and
crashes on import — easier to call the canonical bcrypt module directly.)
"""

from __future__ import annotations

import time
from typing import Any

import bcrypt
import jwt
from jwt.exceptions import InvalidTokenError as PyJWTInvalidTokenError
from pydantic import ValidationError

from tcsh_ar_api.auth.exceptions import InvalidTokenError
from tcsh_ar_api.auth.schemas import LocalUser
from tcsh_ar_api.config import Settings, get_settings

# Hardcoded allow-list — never trust the `alg` declared in the token header.
# HS256 is fine for a single-process deployment with one admin; if we ever
# deploy multiple workers or want key rotation, swap to RS256 + a key file.
_ALG = "HS256"
_ALLOWED_ALGS: tuple[str, ...] = (_ALG,)

# bcrypt's binary protocol caps secrets at 72 bytes. Truncate explicitly so a
# longer password hashes deterministically rather than crashing or comparing
# unequally between hash and verify.
_BCRYPT_MAX_BYTES = 72


def _coerce_secret(password: str) -> bytes:
    raw = password.encode("utf-8")
    return raw[:_BCRYPT_MAX_BYTES]


def hash_password(password: str) -> str:
    """Bcrypt-hash a plaintext password. Used by the create-admin CLI helper."""
    return bcrypt.hashpw(_coerce_secret(password), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    """Constant-time bcrypt verification. Returns False on any error so a
    malformed stored hash surfaces as 401, not 500."""
    if not password_hash:
        return False
    try:
        return bcrypt.checkpw(_coerce_secret(password), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        # Malformed hash in env — treat as "no admin configured", reject login.
        return False


def mint_token(email: str, *, settings: Settings | None = None) -> str:
    """Issue an HS256 JWT for the given email. Expiry from settings."""
    s = settings or get_settings()
    now = int(time.time())
    payload: dict[str, Any] = {
        "sub": email,
        "email": email,
        "is_admin": True,
        "iat": now,
        "exp": now + s.jwt_expires_seconds,
    }
    return jwt.encode(payload, s.jwt_secret.get_secret_value(), algorithm=_ALG)


def verify_token(token: str, *, settings: Settings | None = None) -> LocalUser:
    """Verify a JWT and return the resolved admin user.

    Raises `InvalidTokenError` for any failure (bad signature, expired,
    malformed claims, alg mismatch). The route layer maps that to HTTP 401.
    """
    s = settings or get_settings()
    try:
        claims = jwt.decode(
            token,
            s.jwt_secret.get_secret_value(),
            algorithms=list(_ALLOWED_ALGS),
            options={"verify_exp": True, "require": ["exp", "sub"]},
        )
    except PyJWTInvalidTokenError as exc:
        raise InvalidTokenError(str(exc) or "invalid or expired token") from exc

    try:
        return LocalUser(
            email=claims.get("email") or claims["sub"],
            is_admin=bool(claims.get("is_admin", True)),
        )
    except (KeyError, ValidationError) as exc:
        raise InvalidTokenError("malformed token claims") from exc
