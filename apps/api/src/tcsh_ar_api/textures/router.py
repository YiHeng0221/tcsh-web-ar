from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from tcsh_ar_api.auth.dependencies import require_admin
from tcsh_ar_api.config import Settings, get_settings
from tcsh_ar_api.textures.exceptions import TextureError
from tcsh_ar_api.textures.schemas import UploadURLRequest, UploadURLResponse
from tcsh_ar_api.textures.service import TextureService
from tcsh_ar_api.textures.storage import SupabaseStorage, get_storage

router = APIRouter(prefix="/textures", tags=["textures"])


def _get_service(
    storage: Annotated[SupabaseStorage, Depends(get_storage)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> TextureService:
    return TextureService(storage, settings)


def _raise_http(exc: TextureError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post(
    "/upload-url",
    response_model=UploadURLResponse,
    dependencies=[Depends(require_admin)],
)
async def create_upload_url(
    req: UploadURLRequest,
    svc: Annotated[TextureService, Depends(_get_service)],
) -> UploadURLResponse:
    try:
        return await svc.create_upload_url(req)
    except TextureError as exc:
        _raise_http(exc)
    # Unreachable: _raise_http always raises. Return to satisfy the type checker.
    raise RuntimeError("unreachable")
