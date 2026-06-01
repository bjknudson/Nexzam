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
