from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from tcsh_ar_api.objects.models import ARObject
from tcsh_ar_api.objects.schemas import ARObjectCreate, ARObjectUpdate
from tcsh_ar_api.placements.models import Placement


class ARObjectRepository:
    """Pure data-access for the `ar_objects` table."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_all(self, anchor_id: UUID | None = None) -> list[ARObject]:
        stmt = select(ARObject)
        if anchor_id is not None:
            stmt = (
                stmt.join(Placement, Placement.ar_object_id == ARObject.id)
                .where(Placement.anchor_id == anchor_id)
                .distinct()
            )
        stmt = stmt.order_by(ARObject.label)
        result = await self.session.execute(stmt)
        return list(result.scalars())

    async def get(self, object_id: UUID) -> ARObject | None:
        return await self.session.get(ARObject, object_id)

    async def create(self, data: ARObjectCreate) -> ARObject:
        ar_object = ARObject(**data.model_dump())
        self.session.add(ar_object)
        await self.session.flush()
        return ar_object

    async def update(self, ar_object: ARObject, data: ARObjectUpdate) -> ARObject:
        for key, value in data.model_dump(exclude_unset=True).items():
            setattr(ar_object, key, value)
        await self.session.flush()
        return ar_object

    async def delete(self, ar_object: ARObject) -> None:
        await self.session.delete(ar_object)
        await self.session.flush()
