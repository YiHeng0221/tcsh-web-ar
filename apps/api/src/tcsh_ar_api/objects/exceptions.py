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


class ARObjectConflictError(ARObjectError):
    """Raised when a DB integrity constraint refuses an object write.

    Currently `ar_objects` has no unique constraint, but keeping a dedicated
    conflict class means future constraints (e.g. if we ever make labels
    unique) surface as 409 instead of an internal 500.
    """

    status_code = 409
    detail = "object conflicts with an existing record"


class ARObjectAnchorFilterError(ARObjectError):
    """Raised when `?anchor_id=` refers to an anchor that doesn't exist.

    Separate from `ARObjectNotFoundError` so the router can tell them apart
    and the API consumer can distinguish "no objects for this anchor" from
    "you filtered by a bogus anchor".
    """

    status_code = 404
    detail = "anchor not found"


class ARObjectInUseError(ARObjectError):
    status_code = 409
    detail = "object is referenced by placements"
