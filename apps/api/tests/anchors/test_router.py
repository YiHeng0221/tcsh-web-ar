"""Router-level coverage for the anchors domain.

DB-backed: every test runs against the testcontainer Postgres, isolated by a
per-test TRUNCATE of mutable tables (see `tests/conftest.py`). Auth is
overridden via `auth_state` so we exercise the role gate without minting JWTs.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any
from uuid import uuid4

from httpx import AsyncClient


async def test_create_lists_and_gets_anchor(
    client: AsyncClient,
    make_anchor_payload: Callable[..., dict[str, Any]],
) -> None:
    payload = make_anchor_payload(label="Station A", size_mm=200)

    create = await client.post("/anchors", json=payload)
    assert create.status_code == 201, create.text
    body = create.json()
    assert body["label"] == "Station A"
    assert body["size_mm"] == 200
    assert "id" in body and "created_at" in body
    anchor_id = body["id"]

    listed = await client.get("/anchors")
    assert listed.status_code == 200
    labels = [a["label"] for a in listed.json()]
    assert "Station A" in labels

    fetched = await client.get(f"/anchors/{anchor_id}")
    assert fetched.status_code == 200
    assert fetched.json()["id"] == anchor_id


async def test_get_returns_404_for_unknown_anchor(client: AsyncClient) -> None:
    response = await client.get(f"/anchors/{uuid4()}")
    assert response.status_code == 404
    assert response.json()["detail"] == "anchor not found"


async def test_update_changes_fields(
    client: AsyncClient,
    make_anchor_payload: Callable[..., dict[str, Any]],
) -> None:
    created = (await client.post("/anchors", json=make_anchor_payload(label="Pre"))).json()
    response = await client.patch(
        f"/anchors/{created['id']}",
        json={"label": "Post", "size_mm": 300},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["label"] == "Post"
    assert body["size_mm"] == 300


async def test_update_404_for_unknown_anchor(client: AsyncClient) -> None:
    response = await client.patch(f"/anchors/{uuid4()}", json={"label": "X"})
    assert response.status_code == 404


async def test_create_duplicate_label_returns_409(
    client: AsyncClient,
    make_anchor_payload: Callable[..., dict[str, Any]],
) -> None:
    payload = make_anchor_payload(label="Unique-Label")
    first = await client.post("/anchors", json=payload)
    assert first.status_code == 201

    duplicate = await client.post("/anchors", json=payload)
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "anchor label already in use"


async def test_update_to_existing_label_returns_409(
    client: AsyncClient,
    make_anchor_payload: Callable[..., dict[str, Any]],
) -> None:
    await client.post("/anchors", json=make_anchor_payload(label="A1"))
    b = (await client.post("/anchors", json=make_anchor_payload(label="A2"))).json()

    response = await client.patch(f"/anchors/{b['id']}", json={"label": "A1"})
    assert response.status_code == 409


async def test_delete_anchor(
    client: AsyncClient,
    make_anchor_payload: Callable[..., dict[str, Any]],
) -> None:
    created = (await client.post("/anchors", json=make_anchor_payload(label="Doomed"))).json()
    response = await client.delete(f"/anchors/{created['id']}")
    assert response.status_code == 204

    follow_up = await client.get(f"/anchors/{created['id']}")
    assert follow_up.status_code == 404


async def test_delete_404_for_unknown_anchor(client: AsyncClient) -> None:
    response = await client.delete(f"/anchors/{uuid4()}")
    assert response.status_code == 404


async def test_create_rejects_non_admin_token(
    client: AsyncClient,
    make_anchor_payload: Callable[..., dict[str, Any]],
    as_regular: Callable[[], None],
) -> None:
    """A caller whose token doesn't resolve to the admin is rejected.

    Single-admin model: there is no authenticated non-admin identity, so a
    token that isn't the admin's fails verification (401) rather than passing
    auth and tripping a separate 403 role gate.
    """
    as_regular()
    response = await client.post("/anchors", json=make_anchor_payload(label="Forbidden"))
    assert response.status_code == 401
    assert response.headers.get("www-authenticate", "").lower().startswith("bearer")


async def test_create_requires_token(
    client: AsyncClient,
    make_anchor_payload: Callable[..., dict[str, Any]],
    as_anonymous: Callable[[], None],
) -> None:
    as_anonymous()
    response = await client.post("/anchors", json=make_anchor_payload(label="NoAuth"))
    assert response.status_code == 401
    assert response.headers.get("www-authenticate", "").lower().startswith("bearer")


async def test_list_is_publicly_readable(
    client: AsyncClient,
    as_anonymous: Callable[[], None],
) -> None:
    """list/get aren't behind require_admin — anonymous reads are fine."""
    as_anonymous()
    response = await client.get("/anchors")
    assert response.status_code == 200


async def test_create_validation_rejects_empty_label(client: AsyncClient) -> None:
    response = await client.post("/anchors", json={"label": "", "size_mm": 200})
    assert response.status_code == 422


async def test_create_validation_rejects_nonpositive_size(
    client: AsyncClient,
    make_anchor_payload: Callable[..., dict[str, Any]],
) -> None:
    response = await client.post("/anchors", json=make_anchor_payload(size_mm=0))
    assert response.status_code == 422


async def test_world_pos_round_trip(
    client: AsyncClient,
    make_anchor_payload: Callable[..., dict[str, Any]],
) -> None:
    """`world_pos` is a JSONB blob; verify it round-trips byte-equal."""
    pose = {
        "position": {"x": 1.5, "y": 2.0, "z": -3.25},
        "rotation": {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0},
    }
    payload = make_anchor_payload(label="With-Pose", world_pos=pose)
    created = await client.post("/anchors", json=payload)
    assert created.status_code == 201

    fetched = await client.get(f"/anchors/{created.json()['id']}")
    assert fetched.json()["world_pos"] == pose
