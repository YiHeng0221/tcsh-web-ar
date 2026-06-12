from typing import Annotated

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from tcsh_ar_api.auth.exceptions import InvalidTokenError
from tcsh_ar_api.auth.schemas import LocalUser
from tcsh_ar_api.auth.service import verify_token
from tcsh_ar_api.config import Settings, get_settings

_bearer = HTTPBearer(auto_error=False)

# RFC 6750 §3 — a 401 rejecting a bearer token must advertise the scheme
# so clients (and the generated OpenAPI clients downstream) can parse the
# challenge instead of guessing.
BEARER_CHALLENGE = {"WWW-Authenticate": "Bearer"}


async def get_current_admin(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> LocalUser:
    """Dependency that resolves the JWT in the Authorization header into a LocalUser.

    Raises 401 if the bearer token is absent, malformed, expired, or signed
    with the wrong key. Single-admin model: every valid token represents the
    admin, so there is no separate role check.
    """
    if creds is None or not creds.credentials:
        raise HTTPException(
            status_code=401,
            detail="missing bearer token",
            headers=BEARER_CHALLENGE,
        )
    try:
        return verify_token(creds.credentials, settings=settings)
    except InvalidTokenError as exc:
        raise HTTPException(
            status_code=401,
            detail=exc.detail,
            headers=BEARER_CHALLENGE,
        ) from exc


# Alias kept for backward compatibility — every existing route imports
# `require_admin` from this module. Single-admin model means
# `get_current_admin` already implies admin.
require_admin = get_current_admin
