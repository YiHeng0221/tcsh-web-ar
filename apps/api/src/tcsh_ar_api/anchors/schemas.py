from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class AnchorBase(BaseModel):
    label: str = Field(min_length=1, max_length=64)
    size_mm: int = Field(gt=0, le=10000)
    world_pos: dict[str, Any] | None = None


class AnchorCreate(AnchorBase):
    pass


class AnchorUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=64)
    size_mm: int | None = Field(default=None, gt=0, le=10000)
    world_pos: dict[str, Any] | None = None


class AnchorOut(AnchorBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: datetime
