class TextureError(Exception):
    """Base class for texture-domain errors."""

    status_code: int = 400
    detail: str = "texture error"

    def __init__(self, detail: str | None = None) -> None:
        if detail is not None:
            self.detail = detail
        super().__init__(self.detail)


class InvalidMimeError(TextureError):
    status_code = 400
    detail = "mime type not allowed"


class FileTooLargeError(TextureError):
    status_code = 400
    detail = "file too large"


class StorageError(TextureError):
    status_code = 502
    detail = "storage backend error"
