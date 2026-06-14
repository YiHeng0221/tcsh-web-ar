from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, computed_field


class TextureOut(BaseModel):
    """Texture row as returned by the API.

    `file_url` is a relative URL; the frontend prepends `VITE_API_BASE_URL`
    before fetching. Computed from `id` so callers don't construct the
    string themselves.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    label: str
    filename: str
    mime_type: str
    size_bytes: int
    created_at: datetime
    updated_at: datetime

    @computed_field  # type: ignore[prop-decorator]
    @property
    def file_url(self) -> str:
        return f"/textures/{self.id}/file"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def kind(self) -> str:
        """Render-path discriminator for the client: a glTF binary is a 3D
        model placed as-is; everything else is a 2D image drawn on a quad.
        Derived from the mime type so the client never sniffs bytes."""
        return "model" if self.mime_type == "model/gltf-binary" else "image"
