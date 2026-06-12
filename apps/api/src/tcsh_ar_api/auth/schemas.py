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

    Default is ``False`` (fail-closed), matching ``verify_token``'s
    ``claims.get("is_admin", False)`` fallback. Callers that construct a
    ``LocalUser`` directly (e.g. tests) must pass ``is_admin=True``
    explicitly so there's no silent privilege escalation from the default.
    """

    email: str
    is_admin: bool = False


class MeResponse(BaseModel):
    """GET /auth/me response."""

    email: str
    is_admin: bool
