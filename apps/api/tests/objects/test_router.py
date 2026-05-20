"""Router-level coverage for the ar_objects domain."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any
from unittest.mock import patch
from uuid import uuid4

from httpx import AsyncClient
from sqlalchemy.exc import IntegrityError


async def test_create_lists_and_gets_object(
    client: AsyncClient,
    make_object_payload: Callable[..., dict[str, Any]],
) -> None:
    payload = make_object_payload(label="彩繪神像", description="main idol")
    create = await client.post("/objects", json=payload)
    assert create.status_code == 201, create.text
    body = create.json()
    assert body["label"] == "彩繪神像"
    assert body["description"] == "main idol"
    object_id = body["id"]

    listed = await client.get("/objects")
    assert listed.status_code == 200
    assert any(o["id"] == object_id for o in listed.json())

    fetched = await client.get(f"/objects/{object_id}")
    assert fetched.status_code == 200
    assert fetched.json()["id"] == object_id


async def test_get_404_for_unknown_object(client: AsyncClient) -> None:
    response = await client.get(f"/objects/{uuid4()}")
    assert response.status_code == 404
    assert response.json()["detail"] == "object not found"


async def test_update_changes_fields(
    client: AsyncClient,
    make_object_payload: Callable[..., dict[str, Any]],
) -> None:
    created = (await client.post("/objects", json=make_object_payload(label="A"))).json()
    response = await client.patch(
        f"/objects/{created['id']}",
        json={"label": "B", "description": "updated"},
    )
    assert response.status_code == 200
    assert response.json()["label"] == "B"
    assert response.json()["description"] == "updated"


async def test_update_404_for_unknown_object(client: AsyncClient) -> None:
    response = await client.patch(f"/objects/{uuid4()}", json={"label": "X"})
    assert response.status_code == 404


async def test_delete_object(
    client: AsyncClient,
    make_object_payload: Callable[..., dict[str, Any]],
) -> None:
    created = (await client.post("/objects", json=make_object_payload(label="Doomed"))).json()
    response = await client.delete(f"/objects/{created['id']}")
    assert response.status_code == 204
    follow_up = await client.get(f"/objects/{created['id']}")
    assert follow_up.status_code == 404


async def test_delete_404_for_unknown_object(client: AsyncClient) -> None:
    response = await client.delete(f"/objects/{uuid4()}")
    assert response.status_code == 404


async def test_create_requires_admin(
    client: AsyncClient,
    make_object_payload: Callable[..., dict[str, Any]],
    as_regular: Callable[[], None],
) -> None:
    as_regular()
    response = await client.post("/objects", json=make_object_payload(label="X"))
    assert response.status_code == 403


async def test_create_requires_token(
    client: AsyncClient,
    make_object_payload: Callable[..., dict[str, Any]],
    as_anonymous: Callable[[], None],
) -> None:
    as_anonymous()
    response = await client.post("/objects", json=make_object_payload(label="X"))
    assert response.status_code == 401


async def test_list_is_publicly_readable(
    client: AsyncClient,
    as_anonymous: Callable[[], None],
) -> None:
    as_anonymous()
    response = await client.get("/objects")
    assert response.status_code == 200


async def test_create_validation_rejects_empty_label(client: AsyncClient) -> None:
    response = await client.post("/objects", json={"label": ""})
    assert response.status_code == 422


async def test_list_filter_by_anchor_returns_only_objects_at_that_anchor(
    client: AsyncClient,
    make_anchor_payload: Callable[..., dict[str, Any]],
    make_object_payload: Callable[..., dict[str, Any]],
    make_placement_payload: Callable[..., dict[str, Any]],
) -> None:
    a1 = (await client.post("/anchors", json=make_anchor_payload(label="A1"))).json()
    a2 = (await client.post("/anchors", json=make_anchor_payload(label="A2"))).json()
    obj_at_a1 = (await client.post("/objects", json=make_object_payload(label="O1"))).json()
    obj_at_a2 = (await client.post("/objects", json=make_object_payload(label="O2"))).json()

    await client.post(
        "/placements",
        json=make_placement_payload(ar_object_id=obj_at_a1["id"], anchor_id=a1["id"]),
    )
    await client.post(
        "/placements",
        json=make_placement_payload(ar_object_id=obj_at_a2["id"], anchor_id=a2["id"]),
    )

    response = await client.get("/objects", params={"anchor_id": a1["id"]})
    assert response.status_code == 200
    ids = {o["id"] for o in response.json()}
    assert obj_at_a1["id"] in ids
    assert obj_at_a2["id"] not in ids


async def test_list_filter_by_unknown_anchor_returns_404(client: AsyncClient) -> None:
    """A bogus ?anchor_id= must not be silently treated as 'no results'.

    Mode A's frontend uses this to fail-loud on a stale UUID instead of
    rendering an empty viewport.
    """
    response = await client.get("/objects", params={"anchor_id": str(uuid4())})
    assert response.status_code == 404
    assert response.json()["detail"] == "anchor not found"


async def test_unique_violation_translates_to_409(
    client: AsyncClient,
    make_object_payload: Callable[..., dict[str, Any]],
) -> None:
    """`ARObjectConflictError` is reserved for future unique constraints.

    There's no live unique constraint on `ar_objects` today, so the only
    way to exercise the 409 path is to inject a fake unique-violation
    IntegrityError. This pins the contract: a 23505 from create() must
    surface as 409, not 500.
    """
    from tcsh_ar_api.objects.repository import ARObjectRepository

    class _FakeUniqueOrig:
        sqlstate = "23505"

    fake_exc = IntegrityError(
        "synthetic unique violation", params=None, orig=_FakeUniqueOrig()
    )
    with patch.object(ARObjectRepository, "create", side_effect=fake_exc):
        response = await client.post("/objects", json=make_object_payload(label="X"))
    assert response.status_code == 409


async def test_unexpected_integrity_error_is_re_raised_not_409(
    client: AsyncClient,
    make_object_payload: Callable[..., dict[str, Any]],
) -> None:
    """A NOT NULL / CHECK violation must NOT be quietly downgraded to 409.

    The router's classifier only owns 23505 (unique violation). Any other
    sqlstate must propagate unchanged so FastAPI's default handler emits
    a real 500.

    NOTE: this test uses `pytest.raises(IntegrityError)` rather than asserting
    `response.status_code == 500`. This is because httpx's ASGITransport
    re-raises server-side exceptions by default instead of converting them to
    an HTTP 500 response — so we can only assert the exception type here, not
    the HTTP contract. In production, FastAPI's default exception handler
    converts unhandled exceptions to 500 responses. The HTTP 500 contract is
    therefore not exercised by this test; it is covered by FastAPI's own test
    suite and the integration smoke test in CI.
    """
    import pytest

    from tcsh_ar_api.objects.repository import ARObjectRepository

    class _FakeNotNullOrig:
        sqlstate = "23502"

    fake_exc = IntegrityError(
        "synthetic NOT NULL violation", params=None, orig=_FakeNotNullOrig()
    )
    with (
        patch.object(ARObjectRepository, "create", side_effect=fake_exc),
        pytest.raises(IntegrityError),
    ):
        await client.post("/objects", json=make_object_payload(label="X"))
