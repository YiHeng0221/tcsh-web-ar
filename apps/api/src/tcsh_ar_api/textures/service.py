import base64
import json
import time

from tcsh_ar_api.textures.exceptions import FileTooLargeError, InvalidMimeError
from tcsh_ar_api.textures.schemas import (
    ALLOWED_MIMES,
    MAX_SIZE_BYTES,
    UploadURLRequest,
    UploadURLResponse,
)
from tcsh_ar_api.textures.storage import SignedUpload, SupabaseStorage


class TextureService:
    """Validates upload requests and brokers signed URLs from storage."""

    def __init__(self, storage: SupabaseStorage) -> None:
        self.storage = storage

    async def create_upload_url(self, req: UploadURLRequest) -> UploadURLResponse:
        if req.mime not in ALLOWED_MIMES:
            raise InvalidMimeError(
                f"mime '{req.mime}' not allowed; allowed: {sorted(ALLOWED_MIMES)}"
            )
        if req.size_bytes > MAX_SIZE_BYTES:
            raise FileTooLargeError(
                f"size {req.size_bytes} bytes exceeds {MAX_SIZE_BYTES} byte limit"
            )

        signed: SignedUpload = await self.storage.create_upload_url(req.filename)
        return UploadURLResponse(
            upload_url=signed.upload_url,
            storage_path=signed.storage_path,
            token=signed.token,
            expires_at=_parse_token_exp(signed.token),
        )


def _parse_token_exp(token: str) -> int:
    """Pull the `exp` claim out of the Supabase signed URL token.

    Falls back to a conservative 60-second expiry if the token isn't a JWT
    or doesn't carry an `exp`. We only need this for the client's response —
    Supabase itself is the source of truth on expiry.
    """
    try:
        _, payload_b64, _ = token.split(".")
        padded = payload_b64 + "=" * (-len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded))
        exp = int(payload["exp"])
    except (ValueError, KeyError, TypeError):
        return int(time.time()) + 60
    return exp
