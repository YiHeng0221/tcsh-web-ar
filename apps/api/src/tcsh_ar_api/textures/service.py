import base64
import json
import logging
import time

from tcsh_ar_api.config import Settings
from tcsh_ar_api.textures.exceptions import FileTooLargeError, InvalidMimeError
from tcsh_ar_api.textures.schemas import UploadURLRequest, UploadURLResponse
from tcsh_ar_api.textures.storage import SignedUpload, SupabaseStorage

logger = logging.getLogger(__name__)

# Supabase's signed upload tokens default to a 2-hour expiry. If we can't
# parse the token for some reason, prefer the Supabase default over a short
# value so admin UIs don't spin requesting a fresh URL every minute.
_FALLBACK_EXPIRES_IN_SECONDS = 7200


class TextureService:
    """Validates upload requests and brokers signed URLs from storage."""

    def __init__(self, storage: SupabaseStorage, settings: Settings) -> None:
        self.storage = storage
        self._settings = settings

    async def create_upload_url(self, req: UploadURLRequest) -> UploadURLResponse:
        allowed_mimes = set(self._settings.texture_allowed_mimes)
        if req.mime not in allowed_mimes:
            raise InvalidMimeError(
                f"mime '{req.mime}' not allowed; allowed: {sorted(allowed_mimes)}"
            )
        max_size = self._settings.texture_max_size_bytes
        if req.size_bytes > max_size:
            raise FileTooLargeError(
                f"size {req.size_bytes} bytes exceeds {max_size} byte limit"
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

    Falls back to `now + _FALLBACK_EXPIRES_IN_SECONDS` if the token isn't a
    JWT or doesn't carry an `exp`. Supabase itself is still the source of
    truth on expiry; this value is only for client-side countdown UIs.
    """
    try:
        _, payload_b64, _ = token.split(".")
        padded = payload_b64 + "=" * (-len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded))
        return int(payload["exp"])
    except (ValueError, KeyError, TypeError):
        logger.warning("could not parse exp from storage token, using fallback")
        return int(time.time()) + _FALLBACK_EXPIRES_IN_SECONDS
