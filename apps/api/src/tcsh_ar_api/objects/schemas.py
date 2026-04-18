from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ARObjectBase(BaseModel):
    label: str = Field(min_length=1, max_length=128)
    description: str | None = None


class ARObjectCreate(ARObjectBase):
    pass


class ARObjectUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = None


class ARObjectOut(ARObjectBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: datetime
