from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class Vec3(BaseModel):
    x: float
    y: float
    z: float


class Quat(BaseModel):
    x: float
    y: float
    z: float
    w: float


class Transform(BaseModel):
    """3D pose of the object relative to its anchor's local frame."""

    position: Vec3
    rotation: Quat
    scale: Vec3


class UVTransform(BaseModel):
    """2D adjustment applied to a texture as it maps onto the object's UVs."""

    scale_x: float = 1.0
    scale_y: float = 1.0
    rotate: float = 0.0
    offset_x: float = 0.0
    offset_y: float = 0.0


class PlacementBase(BaseModel):
    ar_object_id: UUID
    anchor_id: UUID
    texture_id: UUID | None = None
    transform: Transform
    uv_transform: UVTransform | None = None


class PlacementCreate(PlacementBase):
    pass


class PlacementUpdate(BaseModel):
    texture_id: UUID | None = Field(default=None)
    transform: Transform | None = None
    uv_transform: UVTransform | None = None


class PlacementOut(PlacementBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: datetime
