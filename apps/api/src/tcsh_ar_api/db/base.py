from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Declarative base shared by every SQLAlchemy model in this project.

    Keeping a single Base means Alembic's autogenerate sees the full metadata
    after the domain modules import their models.
    """
