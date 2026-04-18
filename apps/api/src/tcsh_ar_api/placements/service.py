from uuid import UUID

from sqlalchemy.exc import IntegrityError

from tcsh_ar_api.placements.exceptions import (
    PlacementConflictError,
    PlacementNotFoundError,
)
from tcsh_ar_api.placements.models import Placement
from tcsh_ar_api.placements.repository import PlacementRepository
from tcsh_ar_api.placements.schemas import PlacementCreate, PlacementUpdate


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
            # The only unique constraint on this table is (ar_object_id, anchor_id).
            raise PlacementConflictError() from exc
        await self.repo.session.refresh(placement)
        return placement

    async def update(self, placement_id: UUID, data: PlacementUpdate) -> Placement:
        placement = await self.get(placement_id)
        try:
            placement = await self.repo.update(placement, data)
            await self.repo.session.commit()
        except IntegrityError as exc:
            await self.repo.session.rollback()
            raise PlacementConflictError() from exc
        await self.repo.session.refresh(placement)
        return placement

    async def delete(self, placement_id: UUID) -> None:
        placement = await self.get(placement_id)
        await self.repo.delete(placement)
        await self.repo.session.commit()
