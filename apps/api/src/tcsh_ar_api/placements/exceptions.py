class PlacementError(Exception):
    """Base class for placement-domain errors."""

    status_code: int = 400
    detail: str = "placement error"

    def __init__(self, detail: str | None = None) -> None:
        if detail is not None:
            self.detail = detail
        super().__init__(self.detail)


class PlacementNotFoundError(PlacementError):
    status_code = 404
    detail = "placement not found"


class PlacementConflictError(PlacementError):
    status_code = 409
    detail = "object already has a placement at this anchor"
