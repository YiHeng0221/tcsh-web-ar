from typing import Annotated, NoReturn
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from tcsh_ar_api.auth.dependencies import require_admin
from tcsh_ar_api.db.session import get_db
from tcsh_ar_api.placements.exceptions import PlacementError
from tcsh_ar_api.placements.repository import PlacementRepository
from tcsh_ar_api.placements.schemas import (
    PlacementCreate,
    PlacementOut,
    PlacementUpdate,
)
from tcsh_ar_api.placements.service import PlacementService

router = APIRouter(prefix="/placements", tags=["placements"])


def _get_service(db: Annotated[AsyncSession, Depends(get_db)]) -> PlacementService:
    return PlacementService(PlacementRepository(db))


def _raise_http(exc: PlacementError) -> NoReturn:
    raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("", response_model=list[PlacementOut])
async def list_placements(
    svc: Annotated[PlacementService, Depends(_get_service)],
    anchor_id: Annotated[
        UUID | None,
        Query(description="Filter to placements at the given anchor"),
    ] = None,
) -> list[PlacementOut]:
    placements = await svc.list_all(anchor_id=anchor_id)
    return [PlacementOut.model_validate(p) for p in placements]


@router.get("/{placement_id}", response_model=PlacementOut)
async def get_placement(
    placement_id: UUID,
    svc: Annotated[PlacementService, Depends(_get_service)],
) -> PlacementOut:
    try:
        placement = await svc.get(placement_id)
    except PlacementError as exc:
        _raise_http(exc)
    return PlacementOut.model_validate(placement)


@router.post(
    "",
    response_model=PlacementOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin)],
)
async def create_placement(
    data: PlacementCreate,
    svc: Annotated[PlacementService, Depends(_get_service)],
) -> PlacementOut:
    try:
        placement = await svc.create(data)
    except PlacementError as exc:
        _raise_http(exc)
    return PlacementOut.model_validate(placement)


@router.patch(
    "/{placement_id}",
    response_model=PlacementOut,
    dependencies=[Depends(require_admin)],
)
async def update_placement(
    placement_id: UUID,
    data: PlacementUpdate,
    svc: Annotated[PlacementService, Depends(_get_service)],
) -> PlacementOut:
    try:
        placement = await svc.update(placement_id, data)
    except PlacementError as exc:
        _raise_http(exc)
    return PlacementOut.model_validate(placement)


@router.delete(
    "/{placement_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_admin)],
)
async def delete_placement(
    placement_id: UUID,
    svc: Annotated[PlacementService, Depends(_get_service)],
) -> None:
    try:
        await svc.delete(placement_id)
    except PlacementError as exc:
        _raise_http(exc)
