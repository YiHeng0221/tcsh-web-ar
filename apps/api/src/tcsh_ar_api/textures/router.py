from typing import Annotated, NoReturn
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from tcsh_ar_api.auth.dependencies import require_admin
from tcsh_ar_api.config import Settings, get_settings
from tcsh_ar_api.db.session import get_db
from tcsh_ar_api.textures.exceptions import TextureError
from tcsh_ar_api.textures.schemas import TextureOut
from tcsh_ar_api.textures.service import TextureService

router = APIRouter(prefix="/textures", tags=["textures"])


def _get_service(
    db: Annotated[AsyncSession, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> TextureService:
    return TextureService(db, settings)


def _raise_http(exc: TextureError) -> NoReturn:
    raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("", response_model=list[TextureOut])
async def list_textures(
    svc: Annotated[TextureService, Depends(_get_service)],
) -> list[TextureOut]:
    rows = await svc.list_all()
    return [TextureOut.model_validate(t) for t in rows]


@router.get("/{texture_id}", response_model=TextureOut)
async def get_texture(
    texture_id: UUID,
    svc: Annotated[TextureService, Depends(_get_service)],
) -> TextureOut:
    try:
        texture = await svc.get(texture_id)
    except TextureError as exc:
        _raise_http(exc)
    return TextureOut.model_validate(texture)


@router.get("/{texture_id}/file")
async def get_texture_file(
    texture_id: UUID,
    svc: Annotated[TextureService, Depends(_get_service)],
) -> FileResponse:
    try:
        texture, path = await svc.get_with_path(texture_id)
    except TextureError as exc:
        _raise_http(exc)
    if not path.exists():
        # Row points at a missing file — surface as 404 rather than a 500
        # leaking the disk path. Catalog should self-heal on next upload.
        raise HTTPException(status_code=404, detail="texture file missing on disk")
    return FileResponse(
        path=path,
        media_type=texture.mime_type,
        filename=texture.filename,
    )


@router.post(
    "",
    response_model=TextureOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin)],
)
async def upload_texture(
    svc: Annotated[TextureService, Depends(_get_service)],
    file: Annotated[UploadFile, File(...)],
    label: Annotated[str | None, Form()] = None,
) -> TextureOut:
    # Read the bytes once — we need both the size (for validation) and the
    # payload (for disk write). FastAPI / Starlette buffers small uploads in
    # memory and spills larger ones to a SpooledTemporaryFile, so this
    # `.read()` is fine for the 10 MB cap we enforce.
    data = await file.read()
    try:
        texture = await svc.create(
            data=data,
            filename=file.filename or "upload",
            mime_type=file.content_type or "",
            label=label,
        )
    except TextureError as exc:
        _raise_http(exc)
    return TextureOut.model_validate(texture)


@router.delete(
    "/{texture_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_admin)],
)
async def delete_texture(
    texture_id: UUID,
    svc: Annotated[TextureService, Depends(_get_service)],
) -> None:
    try:
        await svc.delete(texture_id)
    except TextureError as exc:
        _raise_http(exc)
