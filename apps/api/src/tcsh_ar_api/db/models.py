"""Aggregate import for every SQLAlchemy model in the project.

Importing this module once at application startup ensures SQLAlchemy's mapper
sees every `Base`-derived class before it has to resolve string-based
relationship targets (e.g. ``Mapped[list["Placement"]]`` on ``Anchor``).

Alembic's env.py imports each `models` module for the same reason. Any new
domain module should be added here *and* in alembic/env.py.
"""

from tcsh_ar_api.anchors.models import Anchor  # noqa: F401
from tcsh_ar_api.objects.models import ARObject  # noqa: F401
from tcsh_ar_api.placements.models import Placement  # noqa: F401
from tcsh_ar_api.textures.models import Texture  # noqa: F401
