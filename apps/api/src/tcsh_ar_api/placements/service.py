from uuid import UUID

from sqlalchemy.exc import IntegrityError

from tcsh_ar_api.placements.exceptions import (
    PlacementConflictError,
    PlacementDependencyMissingError,
    PlacementNotFoundError,
)
from tcsh_ar_api.placements.models import Placement
from tcsh_ar_api.placements.repository import PlacementRepository
from tcsh_ar_api.placements.schemas import PlacementCreate, PlacementUpdate

# PostgreSQL SQLSTATE codes — see
# https://www.postgresql.org/docs/current/errcodes-appendix.html
_SQLSTATE_FOREIGN_KEY_VIOLATION = "23503"


class PlacementService:
    """Business logic and transaction boundary for the placements domain."""

    def __init__(self, repo: PlacementRepository) -> None:
        self.repo = repo

    async def list_all(self, anchor_id: UUID | None = None) -> list[Placement]:
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
            raise self._classify_integrity_error(exc) from exc
        await self.repo.session.refresh(placement)
        return placement

    async def update(self, placement_id: UUID, data: PlacementUpdate) -> Placement:
        placement = await self.get(placement_id)
        try:
            placement = await self.repo.update(placement, data)
            await self.repo.session.commit()
        except IntegrityError as exc:
            await self.repo.session.rollback()
            raise self._classify_integrity_error(exc) from exc
        await self.repo.session.refresh(placement)
        return placement

    async def delete(self, placement_id: UUID) -> None:
        placement = await self.get(placement_id)
        await self.repo.delete(placement)
        await self.repo.session.commit()

    @staticmethod
    def _classify_integrity_error(
        exc: IntegrityError,
    ) -> PlacementConflictError | PlacementDependencyMissingError:
        """Tell FK violations apart from unique violations by SQLSTATE.

        Without this the two failure modes (referencing a nonexistent
        object vs. stomping on an existing placement) collapse into one
        409 and mislead admin tooling.
        """
        sqlstate = getattr(getattr(exc, "orig", None), "sqlstate", None)
        if sqlstate == _SQLSTATE_FOREIGN_KEY_VIOLATION:
            return PlacementDependencyMissingError()
        # 23505 unique_violation or any other integrity violation → 409.
        return PlacementConflictError()
