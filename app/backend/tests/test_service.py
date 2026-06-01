from __future__ import annotations

import json
import zipfile
from pathlib import Path

import pytest

from app.backend.service import BankWorkspaceError, BankWorkspaceService


def test_open_bank_lists_and_filters_questions(
    bank_service: BankWorkspaceService,
    demo_bok: Path,
) -> None:
    summary = bank_service.open_bank(str(demo_bok))

    assert summary.manifest.title == "Demo Physics Bank"
    assert summary.bank.question_ids == [
        "q_fr_0001",
        "q_mc_0001",
        "q_mc_0002",
        "q_num_0001",
        "q_sa_0001",
    ]

    result = bank_service.list_questions(
        search="cart",
        topic="Mechanics",
        question_type="multiple_choice",
    )

    assert [item.id for item in result.items] == ["q_mc_0001"]
    assert result.available_topics == ["Electricity", "Mechanics", "Waves"]
    assert result.available_types == [
        "free_response",
        "multiple_choice",
        "numeric_response",
        "short_answer",
    ]


def test_update_question_from_json_model_refreshes_index_and_save(
    bank_service: BankWorkspaceService,
    demo_bok: Path,
    tmp_path: Path,
) -> None:
    bank_service.open_bank(str(demo_bok))
    question = bank_service.get_question("q_mc_0001")
    updated = question.model_copy(
        update={
            "id": "q_json_new",
            "topic": "Testability",
            "prompt": "A raw JSON edit can replace an existing question body.",
            "tags": ["json-edit"],
        }
    )

    bank_service.update_question("q_mc_0001", updated)
    summary = bank_service.get_summary()

    assert "q_json_new" in summary.bank.question_ids
    assert "q_mc_0001" not in summary.bank.question_ids
    assert "Testability" in summary.bank.topics

    destination = tmp_path / "saved-bank.bok"
    saved_path = bank_service.save_bank(str(destination))

    assert saved_path == str(destination.resolve())
    with zipfile.ZipFile(destination) as archive:
        names = set(archive.namelist())
        assert "questions/q_json_new.json" in names
        assert "questions/q_mc_0001.json" not in names
        saved_question = json.loads(archive.read("questions/q_json_new.json"))

    assert saved_question["prompt"] == "A raw JSON edit can replace an existing question body."
    assert saved_question["tags"] == ["json-edit"]


def test_create_question_from_json_assigns_unique_id(
    bank_service: BankWorkspaceService,
    demo_bok: Path,
) -> None:
    bank_service.open_bank(str(demo_bok))
    source = bank_service.get_question("q_mc_0001").model_dump()

    created = bank_service.create_question_from_json(source)
    summary = bank_service.get_summary()

    assert created.id == "q_mc_0003"
    assert created.prompt == source["prompt"]
    assert "q_mc_0001" in summary.bank.question_ids
    assert "q_mc_0003" in summary.bank.question_ids


def test_create_question_from_json_adds_missing_id(
    bank_service: BankWorkspaceService,
    demo_bok: Path,
) -> None:
    bank_service.open_bank(str(demo_bok))
    source = bank_service.get_question("q_sa_0001").model_dump()
    source.pop("id")

    created = bank_service.create_question_from_json(source)

    assert created.id == "q_sa_0002"
    assert created.type == "short_answer"


def test_stage_question_import_accepts_json_array_without_writing_questions(
    bank_service: BankWorkspaceService,
    demo_bok: Path,
) -> None:
    bank_service.open_bank(str(demo_bok))
    source = bank_service.get_question("q_sa_0001").model_dump()
    source.pop("id")
    source["prompt"] = "Imported short answer JSON is staged before promotion."

    stage = bank_service.stage_question_import(
        filename="questions.json",
        content=json.dumps([source]).encode("utf-8"),
    )
    summary = bank_service.get_summary()

    assert stage.source_filename == "questions.json"
    assert stage.source_path.startswith(f"imports/{stage.id}/")
    assert len(stage.rows) == 1
    assert stage.rows[0].status == "valid"
    assert stage.rows[0].selected is True
    assert stage.rows[0].imported_id is None
    assert stage.rows[0].proposed_id == "q_sa_0002"
    assert "q_sa_0002" not in summary.bank.question_ids

    listed = bank_service.list_question_imports()
    fetched = bank_service.get_question_import(stage.id)

    assert [item.id for item in listed.items] == [stage.id]
    assert fetched.rows[0].question["prompt"] == "Imported short answer JSON is staged before promotion."


def test_stage_question_import_accepts_question_wrapper(
    bank_service: BankWorkspaceService,
    demo_bok: Path,
) -> None:
    bank_service.open_bank(str(demo_bok))
    source = bank_service.get_question("q_num_0001").model_dump()
    source.pop("id")

    stage = bank_service.stage_question_import(
        filename="wrapped.json",
        content=json.dumps({"question": source}).encode("utf-8"),
    )

    assert len(stage.rows) == 1
    assert stage.rows[0].status == "valid"
    assert stage.rows[0].proposed_id == "q_num_0002"


def test_stage_question_import_reports_validation_errors(
    bank_service: BankWorkspaceService,
    demo_bok: Path,
) -> None:
    bank_service.open_bank(str(demo_bok))
    source = bank_service.get_question("q_sa_0001").model_dump()
    source.pop("id")
    source["sample_solution"] = ""

    stage = bank_service.stage_question_import(
        filename="invalid.json",
        content=json.dumps({"items": [source]}).encode("utf-8"),
    )

    assert stage.rows[0].status == "invalid"
    assert stage.rows[0].selected is False
    assert any(
        "short_answer questions need a sample_solution" in issue.message
        for issue in stage.rows[0].issues
    )


def test_stage_question_import_reports_duplicate_existing_ids(
    bank_service: BankWorkspaceService,
    demo_bok: Path,
) -> None:
    bank_service.open_bank(str(demo_bok))
    source = bank_service.get_question("q_mc_0001").model_dump()

    stage = bank_service.stage_question_import(
        filename="duplicate.json",
        content=json.dumps(source).encode("utf-8"),
    )

    assert stage.rows[0].status == "invalid"
    assert any(issue.code == "duplicate_existing_id" for issue in stage.rows[0].issues)


def test_stage_question_import_accepts_csv_rows(
    bank_service: BankWorkspaceService,
    demo_bok: Path,
) -> None:
    bank_service.open_bank(str(demo_bok))
    csv_content = "\n".join(
        [
            "id,type,topic,difficulty,prompt,tags,standards,sample_solution,status,points",
            ",short_answer,Electricity,2,Explain Ohm's law.,circuits;ohm,PHY-ELE-01,Voltage equals current times resistance.,draft,2",
        ]
    )

    stage = bank_service.stage_question_import(
        filename="questions.csv",
        content=csv_content.encode("utf-8"),
    )

    row = stage.rows[0]
    assert row.status == "valid"
    assert row.selected is True
    assert row.source["tags"] == "circuits;ohm"
    assert row.question["tags"] == ["circuits", "ohm"]
    assert row.question["standards"] == [{"standard_id": "PHY-ELE-01"}]
    assert row.question["points"] == 2.0
    assert row.proposed_id == "q_sa_0002"


def test_stage_question_import_keeps_malformed_csv_rows_visible(
    bank_service: BankWorkspaceService,
    demo_bok: Path,
) -> None:
    bank_service.open_bank(str(demo_bok))
    csv_content = "\n".join(
        [
            "id,type,topic,difficulty,prompt,answer_json",
            ',numeric_response,Waves,two,Find the frequency.,"{bad json"',
        ]
    )

    stage = bank_service.stage_question_import(
        filename="bad-questions.csv",
        content=csv_content.encode("utf-8"),
    )

    row = stage.rows[0]
    assert row.status == "invalid"
    assert row.selected is False
    assert row.source["answer_json"] == "{bad json"
    assert any(issue.code == "malformed_json" for issue in row.issues)
    assert any(issue.location == ["difficulty"] for issue in row.issues)


def test_promote_question_import_rows_uses_proposed_ids_and_refreshes_index(
    bank_service: BankWorkspaceService,
    demo_bok: Path,
) -> None:
    bank_service.open_bank(str(demo_bok))
    source = bank_service.get_question("q_sa_0001").model_dump()
    source.pop("id")
    source["prompt"] = "Promoted staged short answer."

    stage = bank_service.stage_question_import(
        filename="questions.json",
        content=json.dumps([source]).encode("utf-8"),
    )

    response = bank_service.promote_question_import_rows(stage.id)
    summary = bank_service.get_summary()
    promoted = bank_service.get_question("q_sa_0002")
    updated_stage = bank_service.get_question_import(stage.id)

    assert response.promoted_count == 1
    assert response.promoted_question_ids == ["q_sa_0002"]
    assert promoted.prompt == "Promoted staged short answer."
    assert "q_sa_0002" in summary.bank.question_ids
    assert updated_stage.rows[0].status == "promoted"
    assert updated_stage.rows[0].selected is False
    assert updated_stage.rows[0].promoted_question_id == "q_sa_0002"


def test_update_question_import_row_revalidates_invalid_row(
    bank_service: BankWorkspaceService,
    demo_bok: Path,
) -> None:
    bank_service.open_bank(str(demo_bok))
    source = bank_service.get_question("q_sa_0001").model_dump()
    source.pop("id")
    source["sample_solution"] = ""

    stage = bank_service.stage_question_import(
        filename="invalid.json",
        content=json.dumps([source]).encode("utf-8"),
    )
    assert stage.rows[0].status == "invalid"

    source["sample_solution"] = "Ohm's law states V = IR."
    updated_stage = bank_service.update_question_import_row(
        stage.id,
        stage.rows[0].row_id,
        question=source,
    )

    updated_row = updated_stage.rows[0]
    assert updated_row.status == "valid"
    assert updated_row.selected is True
    assert updated_row.issues == []
    assert updated_row.proposed_id == "q_sa_0002"


def test_promote_question_import_rows_can_keep_unique_imported_ids(
    bank_service: BankWorkspaceService,
    demo_bok: Path,
) -> None:
    bank_service.open_bank(str(demo_bok))
    source = bank_service.get_question("q_sa_0001").model_dump()
    source["id"] = "custom_short_answer_001"
    source["prompt"] = "Promoted with imported id."

    stage = bank_service.stage_question_import(
        filename="questions.json",
        content=json.dumps(source).encode("utf-8"),
    )

    response = bank_service.promote_question_import_rows(stage.id, id_policy="keep_imported")

    assert response.promoted_question_ids == ["custom_short_answer_001"]
    assert bank_service.get_question("custom_short_answer_001").prompt == "Promoted with imported id."


def test_promote_question_import_rows_rejects_invalid_rows(
    bank_service: BankWorkspaceService,
    demo_bok: Path,
) -> None:
    bank_service.open_bank(str(demo_bok))
    source = bank_service.get_question("q_sa_0001").model_dump()
    source.pop("id")
    source["sample_solution"] = ""

    stage = bank_service.stage_question_import(
        filename="invalid.json",
        content=json.dumps([source]).encode("utf-8"),
    )

    with pytest.raises(BankWorkspaceError) as exc_info:
        bank_service.promote_question_import_rows(stage.id, row_ids=[stage.rows[0].row_id])

    assert exc_info.value.status_code == 422
    assert "Only valid staged rows can be promoted" in exc_info.value.message


def test_promoted_question_import_rows_are_saved_in_repacked_bank(
    bank_service: BankWorkspaceService,
    demo_bok: Path,
    tmp_path: Path,
) -> None:
    bank_service.open_bank(str(demo_bok))
    source = bank_service.get_question("q_sa_0001").model_dump()
    source.pop("id")
    source["prompt"] = "Promoted imports persist into the archive."

    stage = bank_service.stage_question_import(
        filename="questions.json",
        content=json.dumps([source]).encode("utf-8"),
    )
    bank_service.promote_question_import_rows(stage.id)

    destination = tmp_path / "saved-import-bank.bok"
    bank_service.save_bank(str(destination))

    with zipfile.ZipFile(destination) as archive:
        names = set(archive.namelist())
        promoted_question = json.loads(archive.read("questions/q_sa_0002.json"))

    assert "questions/q_sa_0002.json" in names
    assert f"imports/{stage.id}/questions.json" in names
    assert f"imports/{stage.id}/stage.json" in names
    assert promoted_question["prompt"] == "Promoted imports persist into the archive."


def test_next_question_id_uses_type_prefix_and_serial(
    bank_service: BankWorkspaceService,
    demo_bok: Path,
) -> None:
    bank_service.open_bank(str(demo_bok))

    assert bank_service.next_question_id("multiple_choice") == "q_mc_0003"
    assert bank_service.next_question_id("numeric_response") == "q_num_0002"
    assert bank_service.next_question_id("short_answer") == "q_sa_0002"
    assert bank_service.next_question_id("free_response") == "q_fr_0002"


def test_asset_paths_must_stay_inside_workspace(
    bank_service: BankWorkspaceService,
    demo_bok: Path,
) -> None:
    bank_service.open_bank(str(demo_bok))

    with pytest.raises(BankWorkspaceError) as exc_info:
        bank_service.resolve_asset_path("../manifest.json")

    assert exc_info.value.status_code == 400
    assert "assets/ directory" in exc_info.value.message


def test_svg_placeholders_include_calc_variables() -> None:
    service = BankWorkspaceService()
    source = '<svg><text>{{ label }}</text><line x2="{{ calc: length * scale }}"/></svg>'

    assert service.extract_svg_placeholders(source) == ["label", "length", "scale"]
    assert (
        service.render_svg(source, {"label": "Force", "length": "12", "scale": "2.5"})
        == '<svg><text>Force</text><line x2="30"/></svg>'
    )
