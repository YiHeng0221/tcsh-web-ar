from typing import Annotated

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from tcsh_ar_api.auth.exceptions import InvalidTokenError
from tcsh_ar_api.auth.schemas import CurrentUser
from tcsh_ar_api.auth.service import JWTService, get_jwt_service

_bearer = HTTPBearer(auto_error=False)

_ADMIN_ROLE = "admin"
_APP_METADATA_ROLE_KEY = "role"

# RFC 6750 §3 — a 401 rejecting a bearer token must advertise the scheme
# so clients (and the generated OpenAPI clients downstream) can parse the
# challenge instead of guessing.
_BEARER_CHALLENGE = {"WWW-Authenticate": "Bearer"}


async def get_current_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    jwt_service: Annotated[JWTService, Depends(get_jwt_service)],
) -> CurrentUser:
    """Dependency that resolves the JWT in the Authorization header into a CurrentUser.

    Raises 401 if the bearer token is absent, malformed, expired, or signed
    by a key not in the project's JWKS.
    """
    if creds is None or not creds.credentials:
        raise HTTPException(
            status_code=401,
            detail="missing bearer token",
            headers=_BEARER_CHALLENGE,
        )
    try:
        claims = await jwt_service.verify(creds.credentials)
    except InvalidTokenError as exc:
        raise HTTPException(
            status_code=401,
            detail=exc.detail,
            headers=_BEARER_CHALLENGE,
        ) from exc

    # App-level role lives in app_metadata (set by admin tooling, not by users).
    app_meta_role = claims.app_metadata.get(_APP_METADATA_ROLE_KEY)
    is_admin = app_meta_role == _ADMIN_ROLE

    return CurrentUser(
        id=claims.sub,
        email=claims.email,
        is_admin=is_admin,
    )


async def require_admin(
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> CurrentUser:
    """Dependency for admin-only endpoints. Raises 403 for non-admins."""
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="admin required")
    return user
