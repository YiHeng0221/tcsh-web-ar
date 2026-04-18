class ARObjectError(Exception):
    """Base class for ar_object-domain errors."""

    status_code: int = 400
    detail: str = "object error"

    def __init__(self, detail: str | None = None) -> None:
        if detail is not None:
            self.detail = detail
        super().__init__(self.detail)


class ARObjectNotFoundError(ARObjectError):
    status_code = 404
    detail = "object not found"
