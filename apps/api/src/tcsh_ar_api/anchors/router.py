from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from tcsh_ar_api.anchors.exceptions import (
    AnchorLabelConflictError,
    AnchorNotFoundError,
)
from tcsh_ar_api.anchors.repository import AnchorRepository
from tcsh_ar_api.anchors.schemas import AnchorCreate, AnchorOut, AnchorUpdate
from tcsh_ar_api.anchors.service import AnchorService
from tcsh_ar_api.auth.dependencies import require_admin
from tcsh_ar_api.db.session import get_db

router = APIRouter(prefix="/anchors", tags=["anchors"])


def _get_service(db: Annotated[AsyncSession, Depends(get_db)]) -> AnchorService:
    return AnchorService(AnchorRepository(db))


@router.get("", response_model=list[AnchorOut])
async def list_anchors(
    svc: Annotated[AnchorService, Depends(_get_service)],
) -> list[AnchorOut]:
    anchors = await svc.list_all()
    return [AnchorOut.model_validate(a) for a in anchors]


@router.get("/{anchor_id}", response_model=AnchorOut)
async def get_anchor(
    anchor_id: UUID,
    svc: Annotated[AnchorService, Depends(_get_service)],
) -> AnchorOut:
    try:
        anchor = await svc.get(anchor_id)
    except AnchorNotFoundError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return AnchorOut.model_validate(anchor)


@router.post(
    "",
    response_model=AnchorOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin)],
)
async def create_anchor(
    data: AnchorCreate,
    svc: Annotated[AnchorService, Depends(_get_service)],
) -> AnchorOut:
    try:
        anchor = await svc.create(data)
    except AnchorLabelConflictError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return AnchorOut.model_validate(anchor)


@router.patch(
    "/{anchor_id}",
    response_model=AnchorOut,
    dependencies=[Depends(require_admin)],
)
async def update_anchor(
    anchor_id: UUID,
    data: AnchorUpdate,
    svc: Annotated[AnchorService, Depends(_get_service)],
) -> AnchorOut:
    try:
        anchor = await svc.update(anchor_id, data)
    except AnchorNotFoundError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    except AnchorLabelConflictError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return AnchorOut.model_validate(anchor)


@router.delete(
    "/{anchor_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_admin)],
)
async def delete_anchor(
    anchor_id: UUID,
    svc: Annotated[AnchorService, Depends(_get_service)],
) -> None:
    try:
        await svc.delete(anchor_id)
    except AnchorNotFoundError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
