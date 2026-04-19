class AnchorError(Exception):
    """Base class for anchor-domain errors."""

    status_code: int = 400
    detail: str = "anchor error"

    def __init__(self, detail: str | None = None) -> None:
        if detail is not None:
            self.detail = detail
        super().__init__(self.detail)


class AnchorNotFoundError(AnchorError):
    status_code = 404
    detail = "anchor not found"


class AnchorLabelConflictError(AnchorError):
    status_code = 409
    detail = "anchor label already in use"


class AnchorInUseError(AnchorError):
    status_code = 409
    detail = "anchor is referenced by placements"
