from typing import NoReturn
from uuid import UUID

from sqlalchemy.exc import IntegrityError

from tcsh_ar_api.anchors.repository import AnchorRepository
from tcsh_ar_api.db.integrity import IntegrityCause, classify_integrity_error
from tcsh_ar_api.objects.exceptions import (
    ARObjectAnchorFilterError,
    ARObjectConflictError,
    ARObjectInUseError,
    ARObjectNotFoundError,
)
from tcsh_ar_api.objects.models import ARObject
from tcsh_ar_api.objects.repository import ARObjectRepository
from tcsh_ar_api.objects.schemas import ARObjectCreate, ARObjectUpdate


class ARObjectService:
    """Business logic and transaction boundary for the ar_objects domain."""

    def __init__(
        self,
        repo: ARObjectRepository,
        anchor_repo: AnchorRepository,
    ) -> None:
        self.repo = repo
        self.anchor_repo = anchor_repo

    async def list_all(self, anchor_id: UUID | None = None) -> list[ARObject]:
        if anchor_id is not None:
            anchor = await self.anchor_repo.get(anchor_id)
            if anchor is None:
                # Fail loud so Mode A's frontend learns early that it's filtering
                # on a stale / wrong UUID instead of silently rendering nothing.
                raise ARObjectAnchorFilterError()
        return await self.repo.list_all(anchor_id=anchor_id)

    async def get(self, object_id: UUID) -> ARObject:
        ar_object = await self.repo.get(object_id)
        if ar_object is None:
            raise ARObjectNotFoundError()
        return ar_object

    async def create(self, data: ARObjectCreate) -> ARObject:
        try:
            ar_object = await self.repo.create(data)
            await self.repo.session.commit()
        except IntegrityError as exc:
            await self.repo.session.rollback()
            _classify_mutation_integrity_error(exc)
        await self.repo.session.refresh(ar_object)
        return ar_object

    async def update(self, object_id: UUID, data: ARObjectUpdate) -> ARObject:
        ar_object = await self.get(object_id)
        try:
            ar_object = await self.repo.update(ar_object, data)
            await self.repo.session.commit()
        except IntegrityError as exc:
            await self.repo.session.rollback()
            _classify_mutation_integrity_error(exc)
        await self.repo.session.refresh(ar_object)
        return ar_object

    async def delete(self, object_id: UUID) -> None:
        ar_object = await self.get(object_id)
        try:
            await self.repo.delete(ar_object)
            await self.repo.session.commit()
        except IntegrityError as exc:
            await self.repo.session.rollback()
            # Placements FK-reference ar_objects; attempting to delete a
            # still-referenced object surfaces as a FK violation. Anything
            # else is unexpected and should not be masked behind a 409.
            if classify_integrity_error(exc) is IntegrityCause.FOREIGN_KEY_VIOLATION:
                raise ARObjectInUseError() from exc
            raise


def _classify_mutation_integrity_error(exc: IntegrityError) -> NoReturn:
    """Only unique violations map to 409; everything else re-raises unchanged.

    ar_objects has no unique constraint today, but the conflict class is
    reserved so future unique fields surface as 409 rather than 500. Keeping
    the classifier dialect-aware prevents NOT NULL / CHECK / deferred FK
    failures from being misreported.
    """
    if classify_integrity_error(exc) is IntegrityCause.UNIQUE_VIOLATION:
        raise ARObjectConflictError() from exc
    raise exc
