from typing import Any

from pydantic import BaseModel, Field


class TokenClaims(BaseModel):
    """Subset of Supabase JWT claims that we rely on.

    Supabase JWT payload contains more fields (iat, aud, session_id, …); we
    only model the ones we use so mypy catches typos.
    """

    sub: str
    # `verify_aud=True` / `verify_exp=True` in jwt.decode guarantee these
    # are present and non-expired before we build this model; narrowing the
    # types so downstream code doesn't need to paper over theoretical Nones.
    aud: str
    exp: int
    email: str | None = None
    role: str | None = None  # Supabase RLS role, e.g. "authenticated"
    iat: int | None = None
    app_metadata: dict[str, Any] = Field(default_factory=dict)
    user_metadata: dict[str, Any] = Field(default_factory=dict)


class CurrentUser(BaseModel):
    """Resolved user identity for use inside request handlers."""

    id: str
    email: str | None
    is_admin: bool
