class AuthError(Exception):
    """Base class for authentication / authorization errors."""

    status_code: int = 401
    detail: str = "authentication failed"

    def __init__(self, detail: str | None = None) -> None:
        if detail is not None:
            self.detail = detail
        super().__init__(self.detail)


class InvalidCredentialsError(AuthError):
    status_code = 401
    detail = "Invalid credentials"


class InvalidTokenError(AuthError):
    status_code = 401
    detail = "invalid or expired token"


class ForbiddenError(AuthError):
    status_code = 403
    detail = "admin required"
