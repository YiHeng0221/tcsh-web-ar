from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from tcsh_ar_api.common.schemas import Quat, Vec3


class WorldPose(BaseModel):
    """Anchor's pose relative to the venue origin, if configured.

    `rotation` is a unit quaternion in (x, y, z, w) order; the same
    convention used by three.js / R3F on the frontend, so values pass
    through without transformation.
    """

    position: Vec3
    rotation: Quat


class AnchorBase(BaseModel):
    label: str = Field(min_length=1, max_length=64)
    size_mm: int = Field(gt=0, le=10000)
    world_pos: WorldPose | None = None


class AnchorCreate(AnchorBase):
    pass


class AnchorUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=64)
    size_mm: int | None = Field(default=None, gt=0, le=10000)
    world_pos: WorldPose | None = None


class AnchorOut(AnchorBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: datetime
