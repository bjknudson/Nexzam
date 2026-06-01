from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient


def test_healthcheck(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_api_accepts_question_json_updates(client: TestClient, demo_bok: Path) -> None:
    open_response = client.post("/api/banks/open", json={"path": str(demo_bok)})
    assert open_response.status_code == 200

    question_response = client.get("/api/questions/q_sa_0001")
    assert question_response.status_code == 200
    payload = question_response.json()
    payload["prompt"] = "State Ohm's law using one sentence and one equation."
    payload["tags"] = ["circuits", "raw-json"]

    update_response = client.put("/api/questions/q_sa_0001", json=payload)

    assert update_response.status_code == 200
    assert update_response.json()["prompt"] == "State Ohm's law using one sentence and one equation."

    list_response = client.get("/api/questions", params={"search": "raw-json"})
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()["items"]] == ["q_sa_0001"]


def test_api_creates_question_from_json_with_automatic_id(
    client: TestClient,
    demo_bok: Path,
) -> None:
    open_response = client.post("/api/banks/open", json={"path": str(demo_bok)})
    assert open_response.status_code == 200

    question_response = client.get("/api/questions/q_sa_0001")
    payload = question_response.json()
    payload.pop("id")
    payload["prompt"] = "AI-generated short answer JSON can be added as a new question."

    create_response = client.post("/api/questions/from-json", json=payload)

    assert create_response.status_code == 200
    assert create_response.json()["id"] == "q_sa_0002"

    list_response = client.get("/api/questions", params={"search": "AI-generated"})
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()["items"]] == ["q_sa_0002"]


def test_api_returns_next_question_id_for_type(client: TestClient, demo_bok: Path) -> None:
    open_response = client.post("/api/banks/open", json={"path": str(demo_bok)})
    assert open_response.status_code == 200

    response = client.get("/api/questions/next-id", params={"type": "numeric_response"})

    assert response.status_code == 200
    assert response.json() == {"id": "q_num_0002"}


def test_api_rejects_invalid_question_json(client: TestClient, demo_bok: Path) -> None:
    open_response = client.post("/api/banks/open", json={"path": str(demo_bok)})
    assert open_response.status_code == 200

    question_response = client.get("/api/questions/q_sa_0001")
    payload = question_response.json()
    payload["sample_solution"] = ""

    update_response = client.put("/api/questions/q_sa_0001", json=payload)

    assert update_response.status_code == 422
    assert "short_answer questions need a sample_solution" in str(update_response.json()["detail"])
