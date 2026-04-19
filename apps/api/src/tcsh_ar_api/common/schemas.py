"""Cross-domain Pydantic primitives.

Geometry types that show up wherever the API speaks 3D. Kept here so
anchors / placements / future modes share one wire format and one set of
validation rules, instead of defining `Vec3` twice and drifting apart.
"""

from typing import Self

from pydantic import BaseModel, Field, model_validator


class Vec3(BaseModel):
    """Right-handed 3D point / vector.

    NaN / ±Inf rejected at the boundary — they silently pass through
    arithmetic (scale, quaternion magnitude) and leave downstream
    renderers with un-drawable transforms.
    """

    x: float = Field(..., allow_inf_nan=False)
    y: float = Field(..., allow_inf_nan=False)
    z: float = Field(..., allow_inf_nan=False)


class Quat(BaseModel):
    """Unit quaternion in (x, y, z, w) order — matches three.js / R3F."""

    x: float = Field(..., allow_inf_nan=False)
    y: float = Field(..., allow_inf_nan=False)
    z: float = Field(..., allow_inf_nan=False)
    w: float = Field(..., allow_inf_nan=False)

    @model_validator(mode="after")
    def _must_be_unit_length(self) -> Self:
        magnitude_squared = (
            self.x * self.x + self.y * self.y + self.z * self.z + self.w * self.w
        )
        if abs(magnitude_squared - 1.0) > 1e-3:
            raise ValueError(
                f"quaternion must be unit-length, got |q|²={magnitude_squared:.4f}. "
                "Normalize on the client before sending."
            )
        return self
