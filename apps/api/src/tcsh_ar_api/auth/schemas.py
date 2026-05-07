from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    """POST /auth/login body."""

    email: str = Field(min_length=1)
    password: str = Field(min_length=1)


class TokenResponse(BaseModel):
    """POST /auth/login 200 response."""

    access_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds


class LocalUser(BaseModel):
    """Resolved admin identity carried inside request handlers.

    There is exactly one admin, configured from settings. `is_admin` stays in
    the model so existing route deps that read `user.is_admin` keep working.
    """

    email: str
    is_admin: bool = True


class MeResponse(BaseModel):
    """GET /auth/me response."""

    email: str
    is_admin: bool
