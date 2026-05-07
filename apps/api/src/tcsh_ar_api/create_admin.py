"""Bcrypt-hash an admin password and print the .env lines to paste in.

Usage:

    uv run python -m tcsh_ar_api.create_admin <email> <password>

Prints the generated bcrypt hash and a ready-to-paste block for
``apps/api/.env``. Stateless — no DB writes, no side effects.
"""

from __future__ import annotations

import secrets
import sys

from tcsh_ar_api.auth.service import hash_password


def _print_env_block(email: str, password_hash: str, jwt_secret: str | None) -> None:
    print("# ─── paste into apps/api/.env ──────────────────────────")
    print(f"ADMIN_EMAIL={email}")
    print(f"ADMIN_PASSWORD_HASH={password_hash}")
    if jwt_secret is not None:
        print(f"JWT_SECRET={jwt_secret}")
    print("JWT_EXPIRES_SECONDS=86400")
    print("# ───────────────────────────────────────────────────────")


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(
            "Usage: uv run python -m tcsh_ar_api.create_admin <email> <password> "
            "[--with-jwt-secret]",
            file=sys.stderr,
        )
        return 2
    email = argv[1]
    password = argv[2]
    with_jwt = "--with-jwt-secret" in argv[3:]

    if len(password) < 8:
        print(
            "warning: password is shorter than 8 chars — bcrypt will still "
            "hash it but consider using something longer.",
            file=sys.stderr,
        )

    password_hash = hash_password(password)
    jwt_secret = secrets.token_hex(32) if with_jwt else None
    _print_env_block(email, password_hash, jwt_secret)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
