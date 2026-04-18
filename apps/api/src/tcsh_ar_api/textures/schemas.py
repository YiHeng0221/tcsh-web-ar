from pydantic import BaseModel, Field

ALLOWED_MIMES: frozenset[str] = frozenset(
    {"image/jpeg", "image/png", "image/webp", "image/ktx2"}
)
MAX_SIZE_BYTES: int = 10 * 1024 * 1024  # 10 MB


class UploadURLRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=256)
    mime: str
    size_bytes: int = Field(gt=0)


class UploadURLResponse(BaseModel):
    upload_url: str
    storage_path: str
    token: str
    expires_at: int  # unix seconds
