from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from tcsh_ar_api.anchors.models import Anchor
from tcsh_ar_api.anchors.schemas import AnchorCreate, AnchorUpdate


class AnchorRepository:
    """Pure data-access for the `anchors` table. Owns no transactions."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_all(self) -> list[Anchor]:
        result = await self.session.execute(select(Anchor).order_by(Anchor.label))
        return list(result.scalars())

    async def get(self, anchor_id: UUID) -> Anchor | None:
        return await self.session.get(Anchor, anchor_id)

    async def create(self, data: AnchorCreate) -> Anchor:
        anchor = Anchor(**data.model_dump())
        self.session.add(anchor)
        await self.session.flush()
        return anchor

    async def update(self, anchor: Anchor, data: AnchorUpdate) -> Anchor:
        for key, value in data.model_dump(exclude_unset=True).items():
            setattr(anchor, key, value)
        await self.session.flush()
        return anchor

    async def delete(self, anchor: Anchor) -> None:
        await self.session.delete(anchor)
        await self.session.flush()
