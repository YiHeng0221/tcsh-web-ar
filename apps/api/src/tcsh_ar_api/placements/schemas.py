from datetime import datetime
from typing import Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from tcsh_ar_api.common.schemas import Quat, Vec3


class Transform(BaseModel):
    """3D pose of the object relative to its anchor's local frame.

    `scale` components must be strictly positive — mirror / flip is not a
    supported admin move for this artwork (spiral metal mesh textures are
    directional) and negative values are almost always a client bug. This
    matches `UVTransform` so a single rule applies to both transforms.
    """

    position: Vec3
    rotation: Quat
    scale: Vec3

    @model_validator(mode="after")
    def _scale_positive(self) -> Self:
        if self.scale.x <= 0 or self.scale.y <= 0 or self.scale.z <= 0:
            raise ValueError("scale components must be strictly positive")
        return self


class UVTransform(BaseModel):
    """2D adjustment applied to a texture as it maps onto the object's UVs.

    `rotate` is in radians (matches three.js Texture.rotation). Mirror /
    flip is not supported — zero or negative scale would squash or invert
    the UVs and is almost always a client bug.
    """

    scale_x: float = Field(default=1.0, gt=0.0, allow_inf_nan=False)
    scale_y: float = Field(default=1.0, gt=0.0, allow_inf_nan=False)
    rotate: float = Field(default=0.0, allow_inf_nan=False)
    offset_x: float = Field(default=0.0, allow_inf_nan=False)
    offset_y: float = Field(default=0.0, allow_inf_nan=False)


class PlacementBase(BaseModel):
    ar_object_id: UUID
    anchor_id: UUID
    texture_id: UUID | None = None
    transform: Transform
    uv_transform: UVTransform | None = None


class PlacementCreate(PlacementBase):
    pass


class PlacementUpdate(BaseModel):
    """PATCH mutates the texture and the local transform only.

    `ar_object_id` / `anchor_id` are intentionally omitted: moving a
    placement across anchors or to a different object is destructive
    enough that it should go through DELETE + POST. Keeps the audit trail
    readable.
    """

    texture_id: UUID | None = Field(default=None)
    transform: Transform | None = None
    uv_transform: UVTransform | None = None


class PlacementOut(PlacementBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: datetime
