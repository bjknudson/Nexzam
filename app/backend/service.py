from __future__ import annotations

import shutil
import tempfile
import uuid
import zipfile
from datetime import UTC, datetime
from pathlib import Path

from .models import (
    BankIndexModel,
    BankSummaryModel,
    ManifestModel,
    QuestionListItemModel,
    QuestionListResponseModel,
    QuestionModel,
)


class BankWorkspaceError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class BankWorkspaceService:
    def __init__(self) -> None:
        self._source_path: Path | None = None
        self._workspace_path: Path | None = None

    def ensure_open(self) -> tuple[Path, Path]:
        if self._source_path is None or self._workspace_path is None:
            raise BankWorkspaceError("No bank is currently open.", status_code=400)
        return self._source_path, self._workspace_path

    def open_bank(self, bok_path: str) -> BankSummaryModel:
        source_path = Path(bok_path).expanduser().resolve()
        if not source_path.exists():
            raise BankWorkspaceError(f"Bank file not found: {source_path}", status_code=404)
        if not zipfile.is_zipfile(source_path):
            raise BankWorkspaceError("Selected file is not a valid .bok zip archive.", status_code=400)

        workspace_root = Path(tempfile.gettempdir()) / "nexzam-workspaces"
        workspace_root.mkdir(parents=True, exist_ok=True)
        workspace_path = workspace_root / f"{source_path.stem}-{uuid.uuid4().hex[:8]}"
        workspace_path.mkdir(parents=True, exist_ok=False)

        with zipfile.ZipFile(source_path) as archive:
            archive.extractall(workspace_path)

        normalized_path = self._normalize_workspace_root(workspace_path)
        self._validate_workspace(normalized_path)

        self._source_path = source_path
        self._workspace_path = normalized_path

        self._refresh_bank_index()
        return self.get_summary()

    def get_summary(self) -> BankSummaryModel:
        source_path, workspace_path = self.ensure_open()
        return BankSummaryModel(
            source_path=str(source_path),
            workspace_path=str(workspace_path),
            manifest=self._read_manifest(),
            bank=self._read_bank_index(),
        )

    def list_questions(
        self,
        search: str | None = None,
        topic: str | None = None,
        question_type: str | None = None,
    ) -> QuestionListResponseModel:
        questions = self._load_questions()
        filtered: list[QuestionModel] = []
        lowered_search = (search or "").strip().lower()

        for question in questions:
            if topic and question.topic != topic:
                continue
            if question_type and question.type != question_type:
                continue
            if lowered_search:
                haystack = " ".join(
                    [
                        question.id,
                        question.topic,
                        question.subtopic or "",
                        question.prompt,
                        " ".join(question.tags),
                    ]
                ).lower()
                if lowered_search not in haystack:
                    continue
            filtered.append(question)

        items = [
            QuestionListItemModel(
                id=question.id,
                topic=question.topic,
                type=question.type,
                difficulty=question.difficulty,
                status=question.status,
                prompt=question.prompt,
            )
            for question in filtered
        ]
        available_topics = sorted({question.topic for question in questions})
        available_types = sorted({question.type for question in questions})
        return QuestionListResponseModel(
            items=items,
            available_topics=available_topics,
            available_types=available_types,
        )

    def get_question(self, question_id: str) -> QuestionModel:
        question_path = self._question_path(question_id)
        if not question_path.exists():
            raise BankWorkspaceError(f"Question not found: {question_id}", status_code=404)
        return QuestionModel.model_validate_json(question_path.read_text())

    def update_question(self, current_id: str, payload: QuestionModel) -> QuestionModel:
        _, workspace_path = self.ensure_open()
        current_path = self._question_path(current_id)
        if not current_path.exists():
            raise BankWorkspaceError(f"Question not found: {current_id}", status_code=404)

        next_path = workspace_path / "questions" / f"{payload.id}.json"
        if payload.id != current_id and next_path.exists():
            raise BankWorkspaceError(
                f"A question with id {payload.id} already exists.",
                status_code=409,
            )

        current_path.write_text(payload.model_dump_json(indent=2) + "\n")

        if payload.id != current_id:
            current_path.rename(next_path)

        self._refresh_bank_index()
        return payload

    def save_bank(self, destination_path: str | None = None) -> str:
        source_path, workspace_path = self.ensure_open()
        target_path = Path(destination_path).expanduser().resolve() if destination_path else source_path
        if target_path.suffix != ".bok":
            raise BankWorkspaceError("Destination path must end with .bok", status_code=400)

        self._refresh_manifest_timestamp()
        self._refresh_bank_index()

        target_path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(target_path, "w", zipfile.ZIP_DEFLATED) as archive:
            for file_path in sorted(workspace_path.rglob("*")):
                if file_path.is_file():
                    archive.write(file_path, file_path.relative_to(workspace_path))
        self._source_path = target_path
        return str(target_path)

    def _read_manifest(self) -> ManifestModel:
        _, workspace_path = self.ensure_open()
        return ManifestModel.model_validate_json((workspace_path / "manifest.json").read_text())

    def _read_bank_index(self) -> BankIndexModel:
        _, workspace_path = self.ensure_open()
        return BankIndexModel.model_validate_json((workspace_path / "bank.json").read_text())

    def _load_questions(self) -> list[QuestionModel]:
        _, workspace_path = self.ensure_open()
        questions_dir = workspace_path / "questions"
        questions = [
            QuestionModel.model_validate_json(path.read_text())
            for path in sorted(questions_dir.glob("*.json"))
        ]
        return sorted(questions, key=lambda item: item.id)

    def _refresh_manifest_timestamp(self) -> None:
        _, workspace_path = self.ensure_open()
        manifest = self._read_manifest()
        manifest.updated_at = datetime.now(UTC)
        (workspace_path / "manifest.json").write_text(manifest.model_dump_json(indent=2) + "\n")

    def _refresh_bank_index(self) -> None:
        _, workspace_path = self.ensure_open()
        questions = self._load_questions_from_disk(workspace_path)
        bank = BankIndexModel(
            question_ids=[question.id for question in questions],
            topics=sorted({question.topic for question in questions}),
            updated_at=datetime.now(UTC),
        )
        (workspace_path / "bank.json").write_text(bank.model_dump_json(indent=2) + "\n")

    def _load_questions_from_disk(self, workspace_path: Path) -> list[QuestionModel]:
        return [
            QuestionModel.model_validate_json(path.read_text())
            for path in sorted((workspace_path / "questions").glob("*.json"))
        ]

    def _question_path(self, question_id: str) -> Path:
        _, workspace_path = self.ensure_open()
        return workspace_path / "questions" / f"{question_id}.json"

    def _validate_workspace(self, workspace_path: Path) -> None:
        required_paths = [
            workspace_path / "manifest.json",
            workspace_path / "bank.json",
            workspace_path / "questions",
        ]
        missing = [str(path.name) for path in required_paths if not path.exists()]
        if missing:
            shutil.rmtree(workspace_path, ignore_errors=True)
            raise BankWorkspaceError(
                f"Bank is missing required files or folders: {', '.join(missing)}",
                status_code=400,
            )

        ManifestModel.model_validate_json((workspace_path / "manifest.json").read_text())
        BankIndexModel.model_validate_json((workspace_path / "bank.json").read_text())
        for path in sorted((workspace_path / "questions").glob("*.json")):
            QuestionModel.model_validate_json(path.read_text())

    def _normalize_workspace_root(self, workspace_path: Path) -> Path:
        manifest_path = workspace_path / "manifest.json"
        if manifest_path.exists():
            return workspace_path

        child_dirs = [child for child in workspace_path.iterdir() if child.is_dir()]
        if len(child_dirs) == 1 and (child_dirs[0] / "manifest.json").exists():
            nested_root = child_dirs[0]
            for item in nested_root.iterdir():
                shutil.move(str(item), workspace_path / item.name)
            nested_root.rmdir()
            return workspace_path

        return workspace_path
