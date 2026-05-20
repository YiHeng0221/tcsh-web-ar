from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from tcsh_ar_api.auth.dependencies import get_current_admin
from tcsh_ar_api.auth.exceptions import InvalidCredentialsError
from tcsh_ar_api.auth.schemas import LocalUser, LoginRequest, MeResponse, TokenResponse
from tcsh_ar_api.auth.service import mint_token, verify_password
from tcsh_ar_api.config import Settings, get_settings

router = APIRouter(prefix="/auth", tags=["auth"])


_BEARER_CHALLENGE = {"WWW-Authenticate": "Bearer"}


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    settings: Annotated[Settings, Depends(get_settings)],
) -> TokenResponse:
    """Single-admin login. Compare email + password against env-configured
    values and mint an HS256 JWT.

    Returns the spec-shaped 401 ({"detail": "Invalid credentials"}) on any
    mismatch — never leaks which of the two fields was wrong.
    """
    email_ok = body.email.strip().lower() == settings.admin_email.strip().lower()
    password_ok = verify_password(body.password, settings.admin_password_hash)
    # Always run verify_password even on email-mismatch to keep timing roughly
    # constant — bcrypt's cost is ~100ms so an early-return on email would let
    # an attacker enumerate the admin email by clocking responses.
    if not (email_ok and password_ok):
        raise HTTPException(
            status_code=InvalidCredentialsError.status_code,
            detail=InvalidCredentialsError.detail,
            headers=_BEARER_CHALLENGE,
        )

    token = mint_token(settings.admin_email, settings=settings)
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_in=settings.jwt_expires_seconds,
    )


@router.get("/me", response_model=MeResponse)
async def me(
    user: Annotated[LocalUser, Depends(get_current_admin)],
) -> MeResponse:
    return MeResponse(email=user.email, is_admin=user.is_admin)
