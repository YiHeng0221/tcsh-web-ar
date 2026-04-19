from typing import Annotated, NoReturn
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from tcsh_ar_api.anchors.repository import AnchorRepository
from tcsh_ar_api.auth.dependencies import require_admin
from tcsh_ar_api.db.session import get_db
from tcsh_ar_api.objects.exceptions import ARObjectError
from tcsh_ar_api.objects.repository import ARObjectRepository
from tcsh_ar_api.objects.schemas import ARObjectCreate, ARObjectOut, ARObjectUpdate
from tcsh_ar_api.objects.service import ARObjectService

router = APIRouter(prefix="/objects", tags=["objects"])


def _get_service(db: Annotated[AsyncSession, Depends(get_db)]) -> ARObjectService:
    return ARObjectService(ARObjectRepository(db), AnchorRepository(db))


def _raise_http(exc: ARObjectError) -> NoReturn:
    raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("", response_model=list[ARObjectOut])
async def list_objects(
    svc: Annotated[ARObjectService, Depends(_get_service)],
    anchor_id: Annotated[
        UUID | None,
        Query(
            description=(
                "Filter to objects placed at the given anchor. "
                "404 if the anchor does not exist."
            )
        ),
    ] = None,
) -> list[ARObjectOut]:
    try:
        objects = await svc.list_all(anchor_id=anchor_id)
    except ARObjectError as exc:
        _raise_http(exc)
    return [ARObjectOut.model_validate(o) for o in objects]


@router.get("/{object_id}", response_model=ARObjectOut)
async def get_object(
    object_id: UUID,
    svc: Annotated[ARObjectService, Depends(_get_service)],
) -> ARObjectOut:
    try:
        ar_object = await svc.get(object_id)
    except ARObjectError as exc:
        _raise_http(exc)
    return ARObjectOut.model_validate(ar_object)


@router.post(
    "",
    response_model=ARObjectOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin)],
)
async def create_object(
    data: ARObjectCreate,
    svc: Annotated[ARObjectService, Depends(_get_service)],
) -> ARObjectOut:
    try:
        ar_object = await svc.create(data)
    except ARObjectError as exc:
        _raise_http(exc)
    return ARObjectOut.model_validate(ar_object)


@router.patch(
    "/{object_id}",
    response_model=ARObjectOut,
    dependencies=[Depends(require_admin)],
)
async def update_object(
    object_id: UUID,
    data: ARObjectUpdate,
    svc: Annotated[ARObjectService, Depends(_get_service)],
) -> ARObjectOut:
    try:
        ar_object = await svc.update(object_id, data)
    except ARObjectError as exc:
        _raise_http(exc)
    return ARObjectOut.model_validate(ar_object)


@router.delete(
    "/{object_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_admin)],
)
async def delete_object(
    object_id: UUID,
    svc: Annotated[ARObjectService, Depends(_get_service)],
) -> None:
    try:
        await svc.delete(object_id)
    except ARObjectError as exc:
        _raise_http(exc)
