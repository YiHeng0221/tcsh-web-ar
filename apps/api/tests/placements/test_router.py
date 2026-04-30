"""Router-level coverage for the placements domain.

Placements sit on top of anchors / objects / textures, so most tests here
seed those upstream rows via the public routers and the `seeded_texture`
fixture.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any
from uuid import uuid4

import pytest
from httpx import AsyncClient


@pytest.fixture
async def anchor_id(
    client: AsyncClient,
    make_anchor_payload: Callable[..., dict[str, Any]],
) -> str:
    response = await client.post("/anchors", json=make_anchor_payload(label="P-Anchor"))
    return str(response.json()["id"])


@pytest.fixture
async def object_id(
    client: AsyncClient,
    make_object_payload: Callable[..., dict[str, Any]],
) -> str:
    response = await client.post("/objects", json=make_object_payload(label="P-Obj"))
    return str(response.json()["id"])


async def test_create_lists_and_gets_placement(
    client: AsyncClient,
    object_id: str,
    anchor_id: str,
    seeded_texture: Any,
    make_placement_payload: Callable[..., dict[str, Any]],
) -> None:
    payload = make_placement_payload(
        ar_object_id=object_id,
        anchor_id=anchor_id,
        texture_id=seeded_texture.id,
    )
    create = await client.post("/placements", json=payload)
    assert create.status_code == 201, create.text
    body = create.json()
    assert body["ar_object_id"] == object_id
    assert body["anchor_id"] == anchor_id
    assert body["texture_id"] == str(seeded_texture.id)
    placement_id = body["id"]

    listed = await client.get("/placements")
    assert listed.status_code == 200
    assert any(p["id"] == placement_id for p in listed.json())

    fetched = await client.get(f"/placements/{placement_id}")
    assert fetched.status_code == 200


async def test_get_404_for_unknown_placement(client: AsyncClient) -> None:
    response = await client.get(f"/placements/{uuid4()}")
    assert response.status_code == 404
    assert response.json()["detail"] == "placement not found"


async def test_create_duplicate_object_anchor_pair_returns_409(
    client: AsyncClient,
    object_id: str,
    anchor_id: str,
    make_placement_payload: Callable[..., dict[str, Any]],
) -> None:
    payload = make_placement_payload(ar_object_id=object_id, anchor_id=anchor_id)
    first = await client.post("/placements", json=payload)
    assert first.status_code == 201

    duplicate = await client.post("/placements", json=payload)
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "object already has a placement at this anchor"


async def test_create_with_unknown_object_id_returns_422(
    client: AsyncClient,
    anchor_id: str,
    make_placement_payload: Callable[..., dict[str, Any]],
) -> None:
    payload = make_placement_payload(ar_object_id=str(uuid4()), anchor_id=anchor_id)
    response = await client.post("/placements", json=payload)
    assert response.status_code == 422
    assert "does not exist" in response.json()["detail"].lower()


async def test_create_with_unknown_anchor_id_returns_422(
    client: AsyncClient,
    object_id: str,
    make_placement_payload: Callable[..., dict[str, Any]],
) -> None:
    payload = make_placement_payload(ar_object_id=object_id, anchor_id=str(uuid4()))
    response = await client.post("/placements", json=payload)
    assert response.status_code == 422


async def test_create_with_unknown_texture_id_returns_422(
    client: AsyncClient,
    object_id: str,
    anchor_id: str,
    make_placement_payload: Callable[..., dict[str, Any]],
) -> None:
    payload = make_placement_payload(
        ar_object_id=object_id,
        anchor_id=anchor_id,
        texture_id=str(uuid4()),
    )
    response = await client.post("/placements", json=payload)
    assert response.status_code == 422


async def test_patch_only_updates_uv_transform_leaving_transform_unchanged(
    client: AsyncClient,
    object_id: str,
    anchor_id: str,
    make_placement_payload: Callable[..., dict[str, Any]],
) -> None:
    """PATCH with only uv_transform must NOT clear the original transform.

    The router uses `model_dump(exclude_unset=True)` so omitted fields are
    not pushed to the DB; this guarantee shows up to admin users as "I
    only edited the UV scale, why did the position reset?". Pinning it.
    """
    payload = make_placement_payload(
        ar_object_id=object_id,
        anchor_id=anchor_id,
        transform={
            "position": {"x": 1.0, "y": 2.0, "z": 3.0},
            "rotation": {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0},
            "scale": {"x": 1.0, "y": 1.0, "z": 1.0},
        },
    )
    created = (await client.post("/placements", json=payload)).json()
    placement_id = created["id"]
    original_transform = created["transform"]

    patch_response = await client.patch(
        f"/placements/{placement_id}",
        json={
            "uv_transform": {
                "scale_x": 2.0,
                "scale_y": 2.0,
                "rotate": 0.5,
                "offset_x": 0.0,
                "offset_y": 0.0,
            }
        },
    )
    assert patch_response.status_code == 200
    body = patch_response.json()
    assert body["uv_transform"]["scale_x"] == 2.0
    assert body["transform"] == original_transform


async def test_transform_jsonb_round_trips_byte_equal(
    client: AsyncClient,
    object_id: str,
    anchor_id: str,
    make_placement_payload: Callable[..., dict[str, Any]],
) -> None:
    """JSONB columns serialize to Postgres and back; the float/int round-trip
    matters for clients diffing the transform between requests."""
    transform = {
        "position": {"x": -0.5, "y": 1.25, "z": 3.75},
        "rotation": {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0},
        "scale": {"x": 0.5, "y": 0.75, "z": 1.0},
    }
    uv = {
        "scale_x": 1.5,
        "scale_y": 0.5,
        "rotate": 1.5707963,
        "offset_x": 0.1,
        "offset_y": -0.1,
    }
    payload = make_placement_payload(
        ar_object_id=object_id,
        anchor_id=anchor_id,
        transform=transform,
        uv_transform=uv,
    )
    created = (await client.post("/placements", json=payload)).json()
    fetched = (await client.get(f"/placements/{created['id']}")).json()
    assert fetched["transform"] == transform
    assert fetched["uv_transform"] == uv


async def test_list_filter_by_anchor(
    client: AsyncClient,
    object_id: str,
    anchor_id: str,
    make_anchor_payload: Callable[..., dict[str, Any]],
    make_object_payload: Callable[..., dict[str, Any]],
    make_placement_payload: Callable[..., dict[str, Any]],
) -> None:
    other_anchor = (
        await client.post("/anchors", json=make_anchor_payload(label="Other"))
    ).json()
    other_obj = (
        await client.post("/objects", json=make_object_payload(label="Other-Obj"))
    ).json()

    await client.post(
        "/placements",
        json=make_placement_payload(ar_object_id=object_id, anchor_id=anchor_id),
    )
    await client.post(
        "/placements",
        json=make_placement_payload(
            ar_object_id=other_obj["id"], anchor_id=other_anchor["id"]
        ),
    )

    response = await client.get("/placements", params={"anchor_id": anchor_id})
    assert response.status_code == 200
    rows = response.json()
    assert all(p["anchor_id"] == anchor_id for p in rows)


async def test_list_filter_by_unknown_anchor_returns_404(client: AsyncClient) -> None:
    response = await client.get("/placements", params={"anchor_id": str(uuid4())})
    assert response.status_code == 404
    assert response.json()["detail"] == "anchor not found"


async def test_update_404_for_unknown_placement(client: AsyncClient) -> None:
    response = await client.patch(f"/placements/{uuid4()}", json={"transform": None})
    assert response.status_code == 404


async def test_delete_placement(
    client: AsyncClient,
    object_id: str,
    anchor_id: str,
    make_placement_payload: Callable[..., dict[str, Any]],
) -> None:
    created = (
        await client.post(
            "/placements",
            json=make_placement_payload(ar_object_id=object_id, anchor_id=anchor_id),
        )
    ).json()
    response = await client.delete(f"/placements/{created['id']}")
    assert response.status_code == 204


async def test_delete_404_for_unknown_placement(client: AsyncClient) -> None:
    response = await client.delete(f"/placements/{uuid4()}")
    assert response.status_code == 404


async def test_create_requires_admin(
    client: AsyncClient,
    object_id: str,
    anchor_id: str,
    make_placement_payload: Callable[..., dict[str, Any]],
    as_regular: Callable[[], None],
) -> None:
    as_regular()
    response = await client.post(
        "/placements",
        json=make_placement_payload(ar_object_id=object_id, anchor_id=anchor_id),
    )
    assert response.status_code == 403


async def test_create_requires_token(
    client: AsyncClient,
    object_id: str,
    anchor_id: str,
    make_placement_payload: Callable[..., dict[str, Any]],
    as_anonymous: Callable[[], None],
) -> None:
    as_anonymous()
    response = await client.post(
        "/placements",
        json=make_placement_payload(ar_object_id=object_id, anchor_id=anchor_id),
    )
    assert response.status_code == 401


async def test_list_is_publicly_readable(
    client: AsyncClient,
    as_anonymous: Callable[[], None],
) -> None:
    as_anonymous()
    response = await client.get("/placements")
    assert response.status_code == 200


async def test_validation_rejects_negative_scale(
    client: AsyncClient,
    object_id: str,
    anchor_id: str,
    make_placement_payload: Callable[..., dict[str, Any]],
) -> None:
    """Mirror / flip is forbidden — negative scale is almost always a client bug."""
    payload = make_placement_payload(
        ar_object_id=object_id,
        anchor_id=anchor_id,
        transform={
            "position": {"x": 0.0, "y": 0.0, "z": 0.0},
            "rotation": {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0},
            "scale": {"x": -1.0, "y": 1.0, "z": 1.0},
        },
    )
    response = await client.post("/placements", json=payload)
    assert response.status_code == 422


async def test_validation_rejects_non_unit_quaternion(
    client: AsyncClient,
    object_id: str,
    anchor_id: str,
    make_placement_payload: Callable[..., dict[str, Any]],
) -> None:
    payload = make_placement_payload(
        ar_object_id=object_id,
        anchor_id=anchor_id,
        transform={
            "position": {"x": 0.0, "y": 0.0, "z": 0.0},
            "rotation": {"x": 0.5, "y": 0.5, "z": 0.5, "w": 0.5},  # |q|² = 1.0 OK
            "scale": {"x": 1.0, "y": 1.0, "z": 1.0},
        },
    )
    # Sanity: this one is unit-length, must succeed
    ok = await client.post("/placements", json=payload)
    assert ok.status_code == 201

    # Now an obviously-non-unit quaternion
    payload2 = make_placement_payload(
        ar_object_id=object_id,
        anchor_id=anchor_id,
        transform={
            "position": {"x": 0.0, "y": 0.0, "z": 0.0},
            "rotation": {"x": 1.0, "y": 1.0, "z": 1.0, "w": 1.0},  # |q|² = 4
            "scale": {"x": 1.0, "y": 1.0, "z": 1.0},
        },
    )
    bad = await client.post("/placements", json=payload2)
    assert bad.status_code == 422
