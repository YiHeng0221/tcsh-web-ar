from typing import NoReturn
from uuid import UUID

from sqlalchemy.exc import IntegrityError

from tcsh_ar_api.anchors.repository import AnchorRepository
from tcsh_ar_api.placements.exceptions import (
    PlacementAnchorFilterError,
    PlacementConflictError,
    PlacementDependencyMissingError,
    PlacementInUseError,
    PlacementNotFoundError,
)
from tcsh_ar_api.placements.models import Placement
from tcsh_ar_api.placements.repository import PlacementRepository
from tcsh_ar_api.placements.schemas import PlacementCreate, PlacementUpdate

# PostgreSQL SQLSTATE codes — see
# https://www.postgresql.org/docs/current/errcodes-appendix.html
_SQLSTATE_FOREIGN_KEY_VIOLATION = "23503"
_SQLSTATE_UNIQUE_VIOLATION = "23505"


class PlacementService:
    """Business logic and transaction boundary for the placements domain."""

    def __init__(
        self,
        repo: PlacementRepository,
        anchor_repo: AnchorRepository,
    ) -> None:
        self.repo = repo
        self.anchor_repo = anchor_repo

    async def list_all(self, anchor_id: UUID | None = None) -> list[Placement]:
        if anchor_id is not None:
            anchor = await self.anchor_repo.get(anchor_id)
            if anchor is None:
                # Match the objects endpoint: filtering by a nonexistent
                # anchor is a client-detectable mistake, not an empty result.
                raise PlacementAnchorFilterError()
        return await self.repo.list_all(anchor_id=anchor_id)

    async def get(self, placement_id: UUID) -> Placement:
        placement = await self.repo.get(placement_id)
        if placement is None:
            raise PlacementNotFoundError()
        return placement

    async def create(self, data: PlacementCreate) -> Placement:
        try:
            placement = await self.repo.create(data)
            await self.repo.session.commit()
        except IntegrityError as exc:
            await self.repo.session.rollback()
            _classify_mutation_integrity_error(exc)
        await self.repo.session.refresh(placement)
        return placement

    async def update(self, placement_id: UUID, data: PlacementUpdate) -> Placement:
        placement = await self.get(placement_id)
        try:
            placement = await self.repo.update(placement, data)
            await self.repo.session.commit()
        except IntegrityError as exc:
            await self.repo.session.rollback()
            _classify_mutation_integrity_error(exc)
        await self.repo.session.refresh(placement)
        return placement

    async def delete(self, placement_id: UUID) -> None:
        placement = await self.get(placement_id)
        try:
            await self.repo.delete(placement)
            await self.repo.session.commit()
        except IntegrityError as exc:
            await self.repo.session.rollback()
            # placements is a leaf today, so this is forward-looking. When
            # the first table FK-references placements.id, a delete hitting
            # 23503 should land as 409 via the domain exception — not leak
            # raw asyncpg IntegrityError past the router's PlacementError
            # handler (which would surface as 500).
            if _sqlstate(exc) == _SQLSTATE_FOREIGN_KEY_VIOLATION:
                raise PlacementInUseError() from exc
            raise


def _sqlstate(exc: IntegrityError) -> str | None:
    # asyncpg-specific: IntegrityConstraintViolationError exposes `sqlstate`
    # on the wrapped `orig`. psycopg / psycopg2 would use `pgcode` instead,
    # so this helper silently falls back to 500 if the driver ever changes.
    # Sibling domains (anchors / objects) mirror this assumption.
    return getattr(getattr(exc, "orig", None), "sqlstate", None)


def _classify_mutation_integrity_error(exc: IntegrityError) -> NoReturn:
    """Split the integrity failure modes so each one gets the correct status.

    - 23503 (FK violation): the body's ar_object_id / anchor_id / texture_id
      points at a nonexistent row — surface as 422 (unprocessable).
    - 23505 (unique violation): (ar_object_id, anchor_id) pair already has
      a placement — surface as 409 (conflict).
    - Anything else (NOT NULL, CHECK, deferred constraints, unexpected
      dialect errors): re-raise so FastAPI returns 500. Collapsing every
      IntegrityError into 409 hid real bugs behind a misleading code.
    """
    sqlstate = _sqlstate(exc)
    if sqlstate == _SQLSTATE_FOREIGN_KEY_VIOLATION:
        raise PlacementDependencyMissingError() from exc
    if sqlstate == _SQLSTATE_UNIQUE_VIOLATION:
        raise PlacementConflictError() from exc
    raise exc
