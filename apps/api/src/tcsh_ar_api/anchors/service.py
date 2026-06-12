from typing import NoReturn
from uuid import UUID

from sqlalchemy.exc import IntegrityError

from tcsh_ar_api.anchors.exceptions import (
    AnchorInUseError,
    AnchorLabelConflictError,
    AnchorNotFoundError,
)
from tcsh_ar_api.anchors.models import Anchor
from tcsh_ar_api.anchors.repository import AnchorRepository
from tcsh_ar_api.anchors.schemas import AnchorCreate, AnchorUpdate
from tcsh_ar_api.db.integrity import IntegrityCause, classify_integrity_error


class AnchorService:
    """Business logic and transaction boundary for the anchors domain."""

    def __init__(self, repo: AnchorRepository) -> None:
        self.repo = repo

    async def list_all(self) -> list[Anchor]:
        return await self.repo.list_all()

    async def get(self, anchor_id: UUID) -> Anchor:
        anchor = await self.repo.get(anchor_id)
        if anchor is None:
            raise AnchorNotFoundError()
        return anchor

    async def create(self, data: AnchorCreate) -> Anchor:
        try:
            anchor = await self.repo.create(data)
            await self.repo.session.commit()
        except IntegrityError as exc:
            await self.repo.session.rollback()
            _classify_integrity_error_for_mutation(exc)
        await self.repo.session.refresh(anchor)
        return anchor

    async def update(self, anchor_id: UUID, data: AnchorUpdate) -> Anchor:
        anchor = await self.get(anchor_id)
        try:
            anchor = await self.repo.update(anchor, data)
            await self.repo.session.commit()
        except IntegrityError as exc:
            await self.repo.session.rollback()
            _classify_integrity_error_for_mutation(exc)
        await self.repo.session.refresh(anchor)
        return anchor

    async def delete(self, anchor_id: UUID) -> None:
        anchor = await self.get(anchor_id)
        try:
            await self.repo.delete(anchor)
            await self.repo.session.commit()
        except IntegrityError as exc:
            await self.repo.session.rollback()
            # Placements FK-reference anchors; attempting to delete a still-
            # referenced anchor surfaces as a FK violation. Anything else is
            # genuinely unexpected and should not be silently downgraded to
            # 409.
            if classify_integrity_error(exc) is IntegrityCause.FOREIGN_KEY_VIOLATION:
                raise AnchorInUseError() from exc
            raise


def _classify_integrity_error_for_mutation(exc: IntegrityError) -> NoReturn:
    """Only unique violations become the domain 409; everything else re-raises.

    create/update previously treated any IntegrityError as a label conflict,
    which would hide NOT NULL / CHECK / deferred-FK failures behind a 409
    and mislead admin tooling. We only own the unique-on-label case.
    """
    if classify_integrity_error(exc) is IntegrityCause.UNIQUE_VIOLATION:
        raise AnchorLabelConflictError() from exc
    raise exc
