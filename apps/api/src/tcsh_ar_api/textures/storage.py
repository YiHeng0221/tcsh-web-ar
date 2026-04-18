"""Thin async wrapper around Supabase Storage's signed-upload-URL endpoint.

The official `supabase` Python SDK is synchronous, so we offload its calls to
a thread to avoid blocking the asyncio event loop. The service role key lives
only in this module (never returned to clients).
"""

from __future__ import annotations

import asyncio
import logging
import re
import uuid
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from supabase import Client, create_client

from tcsh_ar_api.config import get_settings
from tcsh_ar_api.textures.exceptions import StorageError

logger = logging.getLogger(__name__)

_BUCKET = "textures"
_SAFE_FILENAME = re.compile(r"[^a-zA-Z0-9._-]")


@dataclass(frozen=True)
class SignedUpload:
    upload_url: str
    storage_path: str
    token: str


def _sanitize_filename(name: str) -> str:
    """Keep just alphanumerics, dot, dash, underscore. Everything else → _."""
    return _SAFE_FILENAME.sub("_", name).strip("._") or "file"


class SupabaseStorage:
    def __init__(self, client: Client, bucket: str = _BUCKET) -> None:
        self._client = client
        self._bucket = bucket

    async def create_upload_url(self, filename: str) -> SignedUpload:
        storage_path = f"{uuid.uuid4()}/{_sanitize_filename(filename)}"
        bucket = self._client.storage.from_(self._bucket)

        def _call() -> dict[str, Any]:
            return dict(bucket.create_signed_upload_url(storage_path))

        try:
            result = await asyncio.to_thread(_call)
        except Exception as exc:  # pragma: no cover — SDK raises many shapes
            # Log at exception level so stack + type land in ops telemetry,
            # but don't leak the SDK message into the client-facing detail:
            # upstream errors sometimes include request IDs or paths we'd
            # rather not expose.
            logger.exception(
                "supabase signed upload URL request failed",
                extra={"storage_path": storage_path},
            )
            raise StorageError() from exc

        # supabase-py returns snake_case `signed_url` alongside camelCase; take either.
        signed_url = result.get("signed_url") or result.get("signedUrl")
        token = result.get("token")
        if not signed_url or not token:
            raise StorageError("storage SDK returned an incomplete signed URL")
        return SignedUpload(upload_url=signed_url, storage_path=storage_path, token=token)


@lru_cache(maxsize=1)
def get_storage() -> SupabaseStorage:
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_secret_key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SECRET_KEY must be set to use texture storage."
        )
    client = create_client(settings.supabase_url, settings.supabase_secret_key)
    return SupabaseStorage(client)
