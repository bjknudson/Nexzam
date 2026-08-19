from __future__ import annotations

import json
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
    assert create_response.json()["id"] == "q_sa_0011"

    list_response = client.get("/api/questions", params={"search": "AI-generated"})
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()["items"]] == ["q_sa_0011"]


def test_api_returns_next_question_id_for_type(client: TestClient, demo_bok: Path) -> None:
    open_response = client.post("/api/banks/open", json={"path": str(demo_bok)})
    assert open_response.status_code == 200

    response = client.get("/api/questions/next-id", params={"type": "numeric_response"})

    assert response.status_code == 200
    assert response.json() == {"id": "q_num_0008"}


def test_api_rejects_invalid_question_json(client: TestClient, demo_bok: Path) -> None:
    open_response = client.post("/api/banks/open", json={"path": str(demo_bok)})
    assert open_response.status_code == 200

    question_response = client.get("/api/questions/q_sa_0001")
    payload = question_response.json()
    payload["sample_solution"] = ""

    update_response = client.put("/api/questions/q_sa_0001", json=payload)

    assert update_response.status_code == 422
    assert "short_answer questions need a sample_solution" in str(update_response.json()["detail"])


def test_api_stages_question_json_import(client: TestClient, demo_bok: Path) -> None:
    open_response = client.post("/api/banks/open", json={"path": str(demo_bok)})
    assert open_response.status_code == 200

    question_response = client.get("/api/questions/q_num_0001")
    payload = question_response.json()
    payload.pop("id")
    payload["prompt"] = "Question import JSON can be staged before promotion."

    stage_response = client.post(
        "/api/question-imports/stage",
        files={
            "file": (
                "questions.json",
                json.dumps({"questions": [payload]}),
                "application/json",
            )
        },
    )

    assert stage_response.status_code == 200
    stage = stage_response.json()
    assert stage["rows"][0]["status"] == "valid"
    assert stage["rows"][0]["proposed_id"] == "q_num_0008"

    list_response = client.get("/api/question-imports")
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()["items"]] == [stage["id"]]


def test_api_stages_question_csv_import(client: TestClient, demo_bok: Path) -> None:
    open_response = client.post("/api/banks/open", json={"path": str(demo_bok)})
    assert open_response.status_code == 200

    csv_content = "\n".join(
        [
            "id,type,topic,difficulty,prompt,sample_solution",
            ",short_answer,Waves,2,Define amplitude.,Amplitude is maximum displacement.",
        ]
    )

    stage_response = client.post(
        "/api/question-imports/stage",
        files={
            "file": (
                "questions.csv",
                csv_content,
                "text/csv",
            )
        },
    )

    assert stage_response.status_code == 200
    stage = stage_response.json()
    assert stage["source_filename"] == "questions.csv"
    assert stage["rows"][0]["status"] == "valid"
    assert stage["rows"][0]["proposed_id"] == "q_sa_0011"


def test_api_promotes_staged_question_import(client: TestClient, demo_bok: Path) -> None:
    open_response = client.post("/api/banks/open", json={"path": str(demo_bok)})
    assert open_response.status_code == 200

    question_response = client.get("/api/questions/q_sa_0001")
    payload = question_response.json()
    payload.pop("id")
    payload["prompt"] = "API promotion writes staged rows to questions."

    stage_response = client.post(
        "/api/question-imports/stage",
        files={
            "file": (
                "questions.json",
                json.dumps([payload]),
                "application/json",
            )
        },
    )
    assert stage_response.status_code == 200
    stage = stage_response.json()

    promote_response = client.post(
        f"/api/question-imports/{stage['id']}/promote",
        json={"row_ids": [stage["rows"][0]["row_id"]], "id_policy": "auto"},
    )

    assert promote_response.status_code == 200
    promoted = promote_response.json()
    assert promoted["promoted_question_ids"] == ["q_sa_0011"]
    assert promoted["stage"]["rows"][0]["status"] == "promoted"

    question_after_response = client.get("/api/questions/q_sa_0011")
    assert question_after_response.status_code == 200
    assert question_after_response.json()["prompt"] == "API promotion writes staged rows to questions."


def test_api_updates_staged_question_import_row(client: TestClient, demo_bok: Path) -> None:
    open_response = client.post("/api/banks/open", json={"path": str(demo_bok)})
    assert open_response.status_code == 200

    question_response = client.get("/api/questions/q_sa_0001")
    payload = question_response.json()
    payload.pop("id")
    payload["sample_solution"] = ""

    stage_response = client.post(
        "/api/question-imports/stage",
        files={
            "file": (
                "invalid.json",
                json.dumps([payload]),
                "application/json",
            )
        },
    )
    stage = stage_response.json()
    assert stage["rows"][0]["status"] == "invalid"

    payload["sample_solution"] = "Ohm's law is V = IR."
    update_response = client.put(
        f"/api/question-imports/{stage['id']}/rows/{stage['rows'][0]['row_id']}",
        json={"question": payload},
    )

    assert update_response.status_code == 200
    updated_stage = update_response.json()
    assert updated_stage["rows"][0]["status"] == "valid"
    assert updated_stage["rows"][0]["selected"] is True
    assert updated_stage["rows"][0]["issues"] == []


def test_api_creates_standards_manually(client: TestClient, demo_bok: Path) -> None:
    open_response = client.post("/api/banks/open", json={"path": str(demo_bok)})
    assert open_response.status_code == 200

    create_response = client.post(
        "/api/standards/manual",
        json={
            "source_list_id": "hand-entered-2026",
            "title": "Hand Entered Standards",
            "issuer": "Classroom Teacher",
            "subject": "Physics",
            "standards": [
                {
                    "id": "HAND-01",
                    "statement": "Describe the relationship between force and acceleration.",
                    "tags": ["forces"],
                },
                {
                    "id": "HAND-02",
                    "code": "HAND-2",
                    "statement": "Interpret a position versus time graph.",
                    "grade_band": "9-12",
                    "tags": [],
                },
            ],
        },
    )

    assert create_response.status_code == 200
    created = create_response.json()
    assert created["imported_count"] == 2
    assert created["source_list"]["id"] == "hand-entered-2026"

    list_response = client.get("/api/standards", params={"source_list_id": "hand-entered-2026"})
    assert list_response.status_code == 200
    items = {item["id"]: item for item in list_response.json()["items"]}
    assert set(items) == {"HAND-01", "HAND-02"}
    assert items["HAND-01"]["code"] == "HAND-01"
    assert items["HAND-01"]["subject"] == "Physics"
    assert items["HAND-02"]["code"] == "HAND-2"


def test_api_rejects_manual_standards_with_duplicate_id(client: TestClient, demo_bok: Path) -> None:
    open_response = client.post("/api/banks/open", json={"path": str(demo_bok)})
    assert open_response.status_code == 200

    response = client.post(
        "/api/standards/manual",
        json={
            "source_list_id": "physics-core-2026",
            "standards": [
                {"id": "PHY-KIN-01", "statement": "Duplicate of a saved standard.", "tags": []}
            ],
        },
    )

    assert response.status_code == 409
    assert "PHY-KIN-01" in response.json()["detail"]
