class TextureError(Exception):
    """Base class for texture-domain errors."""

    status_code: int = 400
    detail: str = "texture error"

    def __init__(self, detail: str | None = None) -> None:
        if detail is not None:
            self.detail = detail
        super().__init__(self.detail)


class InvalidMimeError(TextureError):
    # 415 Unsupported Media Type — HTTP-semantic match for an out-of-allowlist mime.
    status_code = 415
    detail = "mime type not allowed"


class EmptyFileError(TextureError):
    # 400 Bad Request — the upload contained zero bytes, which is a distinct
    # error from an unsupported mime type.  Separating the two lets the UI
    # show a meaningful message ("please select a non-empty file") rather than
    # "mime invalid".
    status_code = 400
    detail = "empty file"


class FileTooLargeError(TextureError):
    # 413 Payload Too Large — same spirit.
    status_code = 413
    detail = "file too large"


class TextureNotFoundError(TextureError):
    status_code = 404
    detail = "texture not found"


class StorageError(TextureError):
    """Filesystem-level failure (disk full, permission denied, …)."""

    status_code = 500
    detail = "storage error"
