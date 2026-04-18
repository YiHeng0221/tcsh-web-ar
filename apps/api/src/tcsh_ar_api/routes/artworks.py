from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/artworks", tags=["artworks"])


class Artwork(BaseModel):
    id: str
    slug: str
    title: str
    model_url: str | None = None


@router.get("", response_model=list[Artwork])
async def list_artworks() -> list[Artwork]:
    return []
