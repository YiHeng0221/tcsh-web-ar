from uuid import UUID

from tcsh_ar_api.objects.exceptions import ARObjectNotFoundError
from tcsh_ar_api.objects.models import ARObject
from tcsh_ar_api.objects.repository import ARObjectRepository
from tcsh_ar_api.objects.schemas import ARObjectCreate, ARObjectUpdate


class ARObjectService:
    """Business logic and transaction boundary for the ar_objects domain."""

    def __init__(self, repo: ARObjectRepository) -> None:
        self.repo = repo

    async def list_all(self, anchor_id: UUID | None = None) -> list[ARObject]:
        return await self.repo.list_all(anchor_id=anchor_id)

    async def get(self, object_id: UUID) -> ARObject:
        ar_object = await self.repo.get(object_id)
        if ar_object is None:
            raise ARObjectNotFoundError()
        return ar_object

    async def create(self, data: ARObjectCreate) -> ARObject:
        ar_object = await self.repo.create(data)
        await self.repo.session.commit()
        await self.repo.session.refresh(ar_object)
        return ar_object

    async def update(self, object_id: UUID, data: ARObjectUpdate) -> ARObject:
        ar_object = await self.get(object_id)
        ar_object = await self.repo.update(ar_object, data)
        await self.repo.session.commit()
        await self.repo.session.refresh(ar_object)
        return ar_object

    async def delete(self, object_id: UUID) -> None:
        ar_object = await self.get(object_id)
        await self.repo.delete(ar_object)
        await self.repo.session.commit()
