"""Service-layer coverage for anchors.

The router tests already touch these paths via HTTP. These tests pin the
contract directly: that `IntegrityError` rolls the session back, that the
correct domain exception is raised for each `sqlstate`, and that the
session is left clean (re-usable) after a conflict.
"""

from __future__ import annotations

from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from tcsh_ar_api.anchors.exceptions import (
    AnchorInUseError,
    AnchorLabelConflictError,
    AnchorNotFoundError,
)
from tcsh_ar_api.anchors.repository import AnchorRepository
from tcsh_ar_api.anchors.schemas import AnchorCreate, AnchorUpdate
from tcsh_ar_api.anchors.service import AnchorService


def _make_service(session: AsyncSession) -> AnchorService:
    return AnchorService(AnchorRepository(session))


async def test_create_persists_and_commits(db_session: AsyncSession) -> None:
    svc = _make_service(db_session)
    anchor = await svc.create(AnchorCreate(label="svc-1", size_mm=200, world_pos=None))
    assert anchor.id is not None
    fetched = await svc.get(anchor.id)
    assert fetched.label == "svc-1"


async def test_get_raises_not_found(db_session: AsyncSession) -> None:
    svc = _make_service(db_session)
    with pytest.raises(AnchorNotFoundError):
        await svc.get(uuid4())


async def test_create_duplicate_label_raises_conflict_and_rolls_back(
    db_session: AsyncSession,
) -> None:
    """Hitting the unique constraint must surface as 409 with a clean session."""
    svc = _make_service(db_session)
    await svc.create(AnchorCreate(label="dupe", size_mm=200, world_pos=None))
    with pytest.raises(AnchorLabelConflictError):
        await svc.create(AnchorCreate(label="dupe", size_mm=200, world_pos=None))

    # Session must be usable after rollback — a stuck "transaction is aborted"
    # state would prevent the next test query from running.
    survivor = await svc.create(AnchorCreate(label="post-dupe", size_mm=200, world_pos=None))
    assert survivor.id is not None


async def test_update_duplicate_label_raises_conflict(db_session: AsyncSession) -> None:
    svc = _make_service(db_session)
    a = await svc.create(AnchorCreate(label="upd-a", size_mm=200, world_pos=None))
    b = await svc.create(AnchorCreate(label="upd-b", size_mm=200, world_pos=None))
    # Capture ids before triggering rollback — SQLAlchemy expires attributes on
    # rollback, so reading `b.id` after the conflict would trigger a lazy-load
    # outside the async greenlet and surface as MissingGreenlet.
    a_id, b_id = a.id, b.id
    with pytest.raises(AnchorLabelConflictError):
        await svc.update(b_id, AnchorUpdate(label="upd-a"))
    # Confirm the partial update was rolled back.
    refreshed = await svc.get(b_id)
    assert refreshed.label == "upd-b"
    assert a_id != b_id


async def test_update_not_found(db_session: AsyncSession) -> None:
    svc = _make_service(db_session)
    with pytest.raises(AnchorNotFoundError):
        await svc.update(uuid4(), AnchorUpdate(label="anything"))


async def test_delete_in_use_translates_fk_violation(
    db_session: AsyncSession,
) -> None:
    """If a placement-FK ever loses ON DELETE CASCADE, deletion must surface as 409.

    The current schema ON DELETE CASCADEs placements when an anchor is
    deleted, so the in-use 23503 path is unreachable in production. We
    pin the classifier behavior anyway by simulating the IntegrityError
    directly: the service must convert a 23503 into AnchorInUseError and
    leave the session usable for the next caller.
    """
    svc = _make_service(db_session)
    anchor = await svc.create(AnchorCreate(label="busy", size_mm=200, world_pos=None))
    anchor_id = anchor.id

    class _FakeFKOrig:
        sqlstate = "23503"

    fake_fk_error = IntegrityError(
        "synthetic FK violation", params=None, orig=_FakeFKOrig()
    )

    with (
        patch.object(AnchorRepository, "delete", side_effect=fake_fk_error),
        pytest.raises(AnchorInUseError),
    ):
        await svc.delete(anchor_id)

    # Session still usable after rollback.
    after = await svc.get(anchor_id)
    assert after.id == anchor_id


async def test_delete_not_found(db_session: AsyncSession) -> None:
    svc = _make_service(db_session)
    with pytest.raises(AnchorNotFoundError):
        await svc.delete(uuid4())


async def test_unexpected_integrity_error_is_re_raised(db_session: AsyncSession) -> None:
    """A non-unique-violation IntegrityError must NOT be silently downgraded to 409.

    This guards the comment in `_classify_integrity_error_for_mutation`:
    "create/update previously treated any IntegrityError as a label conflict,
    which would hide NOT NULL / CHECK / deferred-FK failures behind a 409"
    """
    svc = _make_service(db_session)

    class _FakeOrig:
        sqlstate = "23502"  # not_null_violation, unrelated to label conflict

    fake_exc = IntegrityError("synthetic NOT NULL", params=None, orig=_FakeOrig())

    with (
        patch.object(AnchorRepository, "create", side_effect=fake_exc),
        pytest.raises(IntegrityError),
    ):
        await svc.create(AnchorCreate(label="x", size_mm=200, world_pos=None))

    # Session must still work after rollback.
    after = await svc.create(AnchorCreate(label="post-fake", size_mm=200, world_pos=None))
    assert after.id is not None
