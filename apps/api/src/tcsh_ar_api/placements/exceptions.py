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
    """Object already has a placement at this anchor (unique constraint hit)."""

    status_code = 409
    detail = "object already has a placement at this anchor"


class PlacementDependencyMissingError(PlacementError):
    """`ar_object_id`, `anchor_id`, or `texture_id` points at a nonexistent row."""

    status_code = 422
    detail = "referenced object, anchor, or texture does not exist"
