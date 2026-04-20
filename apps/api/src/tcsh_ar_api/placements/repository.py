from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from tcsh_ar_api.placements.models import Placement
from tcsh_ar_api.placements.schemas import PlacementCreate, PlacementUpdate


class PlacementRepository:
    """Pure data-access for the `placements` table."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_all(self, anchor_id: UUID | None = None) -> list[Placement]:
        stmt = select(Placement)
        if anchor_id is not None:
            stmt = stmt.where(Placement.anchor_id == anchor_id)
        # id as tie-breaker: bulk-imported rows frequently share created_at
        # at the microsecond level; without a stable secondary key, clients
        # paging or diffing would see rows shuffle between requests.
        stmt = stmt.order_by(Placement.created_at, Placement.id)
        result = await self.session.execute(stmt)
        return list(result.scalars())

    async def get(self, placement_id: UUID) -> Placement | None:
        return await self.session.get(Placement, placement_id)

    async def create(self, data: PlacementCreate) -> Placement:
        placement = Placement(**data.model_dump())
        self.session.add(placement)
        await self.session.flush()
        return placement

    async def update(self, placement: Placement, data: PlacementUpdate) -> Placement:
        for key, value in data.model_dump(exclude_unset=True).items():
            setattr(placement, key, value)
        await self.session.flush()
        return placement

    async def delete(self, placement: Placement) -> None:
        await self.session.delete(placement)
        await self.session.flush()
