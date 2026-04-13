from __future__ import annotations
import ast
import csv
import json
import shutil
import tempfile
import uuid
import zipfile
from datetime import UTC, datetime
from mimetypes import guess_type
from pathlib import Path
import re

from .models import (
    AssetInspectionRequest,
    AssetInspectionResponseModel,
    AssetListItemModel,
    AssetListResponseModel,
    AssetUploadResponseModel,
    BankIndexModel,
    BankSummaryModel,
    CourseCollectionModel,
    CourseListResponseModel,
    CourseModel,
    ManifestModel,
    QuestionListItemModel,
    QuestionListResponseModel,
    QuestionModel,
    SourceStandardListCollectionModel,
    SourceStandardListModel,
    StandardImportResponseModel,
    StandardListResponseModel,
    StandardRecordCollectionModel,
    StandardRecordModel,
    StandardReferenceModel,
    StandardSearchResponseModel,
)


class BankWorkspaceError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class BankWorkspaceService:
    SVG_PLACEHOLDER_PATTERN = re.compile(r"{{\s*([a-zA-Z0-9_.-]+)\s*}}")
    SVG_CALC_PATTERN = re.compile(r"{{\s*calc:\s*([^{}]+?)\s*}}")
    SVG_EXPR_VARIABLE_PATTERN = re.compile(r"\b([A-Za-z_][A-Za-z0-9_.-]*)\b")
    ALLOWED_ASSET_EXTENSIONS = {
        ".svg": "svg",
        ".png": "image",
        ".jpg": "image",
        ".jpeg": "image",
        ".gif": "image",
        ".webp": "image",
    }

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
        self._ensure_support_files(normalized_path)
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

    def list_source_standard_lists(self) -> StandardListResponseModel:
        return StandardListResponseModel(items=self._read_source_standard_lists().items)

    def list_standards(
        self,
        source_list_id: str | None = None,
        search: str | None = None,
        course_id: str | None = None,
    ) -> StandardSearchResponseModel:
        standards = self._read_standard_records().items
        lowered_search = (search or "").strip().lower()
        allowed_standard_ids: set[str] | None = None

        if course_id:
            course = next((item for item in self._read_courses().items if item.id == course_id), None)
            if course is None:
                raise BankWorkspaceError(f"Course not found: {course_id}", status_code=404)
            allowed_standard_ids = {reference.standard_id for reference in course.standard_refs}

        filtered: list[StandardRecordModel] = []
        for standard in standards:
            if source_list_id and standard.source_list_id != source_list_id:
                continue
            if allowed_standard_ids is not None and standard.id not in allowed_standard_ids:
                continue
            if lowered_search:
                haystack = " ".join(
                    [
                        standard.id,
                        standard.code,
                        standard.statement,
                        standard.subject or "",
                        standard.grade_band or "",
                        " ".join(standard.tags),
                    ]
                ).lower()
                if lowered_search not in haystack:
                    continue
            filtered.append(standard)

        return StandardSearchResponseModel(items=filtered)

    def list_courses(self) -> CourseListResponseModel:
        return CourseListResponseModel(items=self._read_courses().items)

    def upsert_course(self, course_id: str, title: str, description: str | None, standard_refs: list[StandardReferenceModel]) -> CourseModel:
        course_id = course_id.strip()
        if not course_id:
            raise BankWorkspaceError("Course id must not be empty.", status_code=400)
        if not title.strip():
            raise BankWorkspaceError("Course title must not be empty.", status_code=400)

        standards_by_id = {item.id for item in self._read_standard_records().items}
        for reference in standard_refs:
            if reference.standard_id not in standards_by_id:
                raise BankWorkspaceError(
                    f"Unknown standard reference: {reference.standard_id}",
                    status_code=422,
                )

        courses = self._read_courses()
        course = CourseModel(
            id=course_id,
            title=title.strip(),
            description=description,
            standard_refs=self._dedupe_standard_refs(standard_refs),
        )

        existing_index = next((index for index, item in enumerate(courses.items) if item.id == course_id), None)
        if existing_index is None:
            courses.items.append(course)
        else:
            courses.items[existing_index] = course

        courses.items.sort(key=lambda item: item.id)
        self._write_courses(courses)
        return course

    def import_standards(
        self,
        *,
        filename: str,
        content: bytes,
        source_list_id: str | None = None,
        title: str | None = None,
        issuer: str | None = None,
        subject: str | None = None,
        version: str | None = None,
        description: str | None = None,
    ) -> StandardImportResponseModel:
        _, workspace_path = self.ensure_open()
        safe_name = Path(filename or "").name
        suffix = Path(safe_name).suffix.lower()
        if suffix not in {".json", ".csv"}:
            raise BankWorkspaceError(
                "Standards imports must be JSON or CSV files.",
                status_code=400,
            )

        try:
            raw_text = content.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise BankWorkspaceError(f"Could not decode import file as UTF-8: {exc}", status_code=400)

        embedded_source_list: dict[str, object] | None = None
        imported_rows: list[dict[str, object]]
        if suffix == ".json":
            embedded_source_list, imported_rows = self._parse_json_standard_import(raw_text)
        else:
            imported_rows = self._parse_csv_standard_import(raw_text)

        source_list = self._build_source_list_for_import(
            embedded_source_list=embedded_source_list,
            source_list_id=source_list_id,
            title=title,
            issuer=issuer,
            subject=subject,
            version=version,
            description=description,
        )

        source_lists = self._read_source_standard_lists()
        if any(item.id == source_list.id for item in source_lists.items):
            raise BankWorkspaceError(
                f"A standards source list with id {source_list.id} already exists.",
                status_code=409,
            )

        records = self._read_standard_records()
        existing_standard_ids = {item.id for item in records.items}
        imported_standard_ids: set[str] = set()
        imported_standards: list[StandardRecordModel] = []
        for row in imported_rows:
            standard_id = str(row.get("id") or row.get("standard_id") or "").strip()
            code = str(row.get("code") or standard_id).strip()
            statement = str(row.get("statement") or "").strip()
            if not standard_id or not code or not statement:
                raise BankWorkspaceError(
                    "Imported standards must include id, code, and statement values.",
                    status_code=422,
                )
            if standard_id in existing_standard_ids or standard_id in imported_standard_ids:
                raise BankWorkspaceError(
                    f"Duplicate standard id in import: {standard_id}",
                    status_code=409,
                )

            imported_standard_ids.add(standard_id)
            imported_standards.append(
                StandardRecordModel(
                    id=standard_id,
                    source_list_id=source_list.id,
                    code=code,
                    statement=statement,
                    subject=self._normalize_optional_text(row.get("subject")) or source_list.subject,
                    grade_band=self._normalize_optional_text(row.get("grade_band")),
                    tags=self._normalize_tags(row.get("tags")),
                )
            )

        source_lists.items.append(source_list)
        source_lists.items.sort(key=lambda item: item.id)
        records.items.extend(imported_standards)
        records.items.sort(key=lambda item: item.id)
        self._write_source_standard_lists(source_lists)
        self._write_standard_records(records)

        imported_path = self._store_import_file(workspace_path, source_list.id, safe_name, content)
        return StandardImportResponseModel(
            source_list=source_list,
            imported_count=len(imported_standards),
            imported_path=imported_path,
        )

    def attach_standard_to_course(self, course_id: str, standard_id: str) -> CourseModel:
        course = self._require_course(course_id)
        if standard_id not in {item.id for item in self._read_standard_records().items}:
            raise BankWorkspaceError(f"Unknown standard reference: {standard_id}", status_code=422)
        refs = self._dedupe_standard_refs([*course.standard_refs, StandardReferenceModel(standard_id=standard_id)])
        return self.upsert_course(course.id, course.title, course.description, refs)

    def detach_standard_from_course(self, course_id: str, standard_id: str) -> CourseModel:
        course = self._require_course(course_id)
        refs = [reference for reference in course.standard_refs if reference.standard_id != standard_id]
        return self.upsert_course(course.id, course.title, course.description, refs)

    def list_assets(self) -> AssetListResponseModel:
        _, workspace_path = self.ensure_open()
        questions = self._load_questions()
        referenced_by_path: dict[str, list[str]] = {}
        for question in questions:
            for asset in question.assets:
                referenced_by_path.setdefault(asset.path, []).append(question.id)

        assets_dir = workspace_path / "assets"
        if not assets_dir.exists():
            return AssetListResponseModel(items=[])

        items: list[AssetListItemModel] = []
        for file_path in sorted(path for path in assets_dir.rglob("*") if path.is_file()):
            relative_path = f"assets/{file_path.relative_to(assets_dir).as_posix()}"
            kind = self.ALLOWED_ASSET_EXTENSIONS.get(file_path.suffix.lower(), "file")
            svg_placeholders: list[str] = []
            if kind == "svg":
                svg_placeholders = self.extract_svg_placeholders(file_path.read_text())

            items.append(
                AssetListItemModel(
                    path=relative_path,
                    kind=kind,
                    referenced_by=sorted(referenced_by_path.get(relative_path, [])),
                    svg_placeholders=svg_placeholders,
                )
            )

        return AssetListResponseModel(items=items)

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

    def create_question(self, template_question_id: str | None = None) -> QuestionModel:
        _, workspace_path = self.ensure_open()

        if template_question_id:
            template = self.get_question(template_question_id)
            payload = template.model_copy(deep=True)
            payload.id = self._next_duplicate_question_id(template.id)
        else:
            payload = self._build_blank_question()

        question_path = workspace_path / "questions" / f"{payload.id}.json"
        question_path.write_text(payload.model_dump_json(indent=2) + "\n")
        self._refresh_bank_index()
        return payload

    def delete_question(self, question_id: str) -> None:
        question_path = self._question_path(question_id)
        if not question_path.exists():
            raise BankWorkspaceError(f"Question not found: {question_id}", status_code=404)
        question_path.unlink()
        self._refresh_bank_index()

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

    def upload_asset(self, filename: str, content: bytes) -> AssetUploadResponseModel:
        _, workspace_path = self.ensure_open()
        safe_name = Path(filename or "").name
        if not safe_name:
            raise BankWorkspaceError("Uploaded asset must include a filename.", status_code=400)

        suffix = Path(safe_name).suffix.lower()
        kind = self.ALLOWED_ASSET_EXTENSIONS.get(suffix)
        if kind is None:
            allowed = ", ".join(sorted(self.ALLOWED_ASSET_EXTENSIONS))
            raise BankWorkspaceError(
                f"Unsupported asset type {suffix or '[no extension]'}. Allowed types: {allowed}",
                status_code=400,
            )

        assets_dir = workspace_path / "assets"
        assets_dir.mkdir(parents=True, exist_ok=True)
        target_name = self._dedupe_asset_name(assets_dir, safe_name)
        target_path = assets_dir / target_name
        target_path.write_bytes(content)

        return AssetUploadResponseModel(path=f"assets/{target_name}", kind=kind)

    def inspect_asset(self, payload: AssetInspectionRequest) -> AssetInspectionResponseModel:
        asset_path = self.resolve_asset_path(payload.path)
        if payload.kind != "svg":
            return AssetInspectionResponseModel(path=payload.path, kind=payload.kind)

        source = asset_path.read_text()
        placeholders = self.extract_svg_placeholders(source)
        rendered_svg = self.render_svg(source, payload.svg_variables)
        return AssetInspectionResponseModel(
            path=payload.path,
            kind=payload.kind,
            svg_placeholders=placeholders,
            rendered_svg=rendered_svg,
        )

    def resolve_asset_path(self, relative_path: str) -> Path:
        _, workspace_path = self.ensure_open()
        workspace_path = workspace_path.resolve()
        if not relative_path.startswith("assets/"):
            raise BankWorkspaceError("Asset path must live under the assets/ directory.", status_code=400)
        asset_path = (workspace_path / relative_path).resolve()
        try:
            asset_path.relative_to(workspace_path)
        except ValueError:
            raise BankWorkspaceError("Asset path must stay inside the open workspace.", status_code=400)
        if not asset_path.exists() or not asset_path.is_file():
            raise BankWorkspaceError(f"Asset not found: {relative_path}", status_code=404)
        return asset_path

    def get_asset_media_type(self, relative_path: str) -> str:
        asset_path = self.resolve_asset_path(relative_path)
        guessed, _ = guess_type(asset_path.name)
        return guessed or "application/octet-stream"

    def _read_manifest(self) -> ManifestModel:
        _, workspace_path = self.ensure_open()
        return ManifestModel.model_validate_json((workspace_path / "manifest.json").read_text())

    def _read_bank_index(self) -> BankIndexModel:
        _, workspace_path = self.ensure_open()
        return BankIndexModel.model_validate_json((workspace_path / "bank.json").read_text())

    def _read_source_standard_lists(self) -> SourceStandardListCollectionModel:
        _, workspace_path = self.ensure_open()
        return SourceStandardListCollectionModel.model_validate_json(
            (workspace_path / "standards" / "source_lists.json").read_text()
        )

    def _read_standard_records(self) -> StandardRecordCollectionModel:
        _, workspace_path = self.ensure_open()
        return StandardRecordCollectionModel.model_validate_json(
            (workspace_path / "standards" / "records.json").read_text()
        )

    def _write_source_standard_lists(self, payload: SourceStandardListCollectionModel) -> None:
        _, workspace_path = self.ensure_open()
        (workspace_path / "standards" / "source_lists.json").write_text(
            payload.model_dump_json(indent=2) + "\n"
        )

    def _write_standard_records(self, payload: StandardRecordCollectionModel) -> None:
        _, workspace_path = self.ensure_open()
        (workspace_path / "standards" / "records.json").write_text(
            payload.model_dump_json(indent=2) + "\n"
        )

    def _read_courses(self) -> CourseCollectionModel:
        _, workspace_path = self.ensure_open()
        return CourseCollectionModel.model_validate_json(
            (workspace_path / "courses" / "courses.json").read_text()
        )

    def _write_courses(self, payload: CourseCollectionModel) -> None:
        _, workspace_path = self.ensure_open()
        (workspace_path / "courses" / "courses.json").write_text(payload.model_dump_json(indent=2) + "\n")

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
        SourceStandardListCollectionModel.model_validate_json(
            (workspace_path / "standards" / "source_lists.json").read_text()
        )
        standards = StandardRecordCollectionModel.model_validate_json(
            (workspace_path / "standards" / "records.json").read_text()
        )
        courses = CourseCollectionModel.model_validate_json(
            (workspace_path / "courses" / "courses.json").read_text()
        )

        standards_by_id = {item.id for item in standards.items}
        for path in sorted((workspace_path / "questions").glob("*.json")):
            question = QuestionModel.model_validate_json(path.read_text())
            for reference in question.standards:
                if reference.standard_id not in standards_by_id:
                    raise BankWorkspaceError(
                        f"Question {question.id} references unknown standard {reference.standard_id}",
                        status_code=422,
                    )

        for course in courses.items:
            for reference in course.standard_refs:
                if reference.standard_id not in standards_by_id:
                    raise BankWorkspaceError(
                        f"Course {course.id} references unknown standard {reference.standard_id}",
                        status_code=422,
                    )

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

    def _ensure_support_files(self, workspace_path: Path) -> None:
        standards_dir = workspace_path / "standards"
        courses_dir = workspace_path / "courses"
        imports_dir = workspace_path / "imports"
        standards_dir.mkdir(parents=True, exist_ok=True)
        courses_dir.mkdir(parents=True, exist_ok=True)
        imports_dir.mkdir(parents=True, exist_ok=True)

        source_lists_path = standards_dir / "source_lists.json"
        if not source_lists_path.exists():
            source_lists_path.write_text(SourceStandardListCollectionModel().model_dump_json(indent=2) + "\n")

        records_path = standards_dir / "records.json"
        if not records_path.exists():
            records_path.write_text(StandardRecordCollectionModel().model_dump_json(indent=2) + "\n")

        courses_path = courses_dir / "courses.json"
        if not courses_path.exists():
            courses_path.write_text(CourseCollectionModel().model_dump_json(indent=2) + "\n")

    def _build_blank_question(self) -> QuestionModel:
        return QuestionModel(
            id=self._next_blank_question_id(),
            type="multiple_choice",
            topic="Unsorted",
            difficulty=1,
            prompt="New question prompt",
            subtopic="",
            tags=[],
            standards=[],
            estimated_time_sec=60,
            points=1,
            status="draft",
            teacher_notes="",
            answer={
                "choices": ["", ""],
                "correct_choice_index": 0,
            },
            explanation="",
            rubric=[],
            sample_solution="",
            exemplar_answer="",
            assets=[],
        )

    def _require_course(self, course_id: str) -> CourseModel:
        for course in self._read_courses().items:
            if course.id == course_id:
                return course
        raise BankWorkspaceError(f"Course not found: {course_id}", status_code=404)

    def _dedupe_standard_refs(self, refs: list[StandardReferenceModel]) -> list[StandardReferenceModel]:
        seen: set[str] = set()
        deduped: list[StandardReferenceModel] = []
        for reference in refs:
            if reference.standard_id in seen:
                continue
            seen.add(reference.standard_id)
            deduped.append(reference)
        return deduped

    def _next_blank_question_id(self) -> str:
        _, workspace_path = self.ensure_open()
        questions_dir = workspace_path / "questions"
        counter = 1
        while True:
            candidate = f"q_new_{counter:04d}"
            if not (questions_dir / f"{candidate}.json").exists():
                return candidate
            counter += 1

    def _next_duplicate_question_id(self, source_id: str) -> str:
        _, workspace_path = self.ensure_open()
        questions_dir = workspace_path / "questions"
        counter = 1
        while True:
            suffix = "_copy" if counter == 1 else f"_copy_{counter}"
            candidate = f"{source_id}{suffix}"
            if not (questions_dir / f"{candidate}.json").exists():
                return candidate
            counter += 1

    def _dedupe_asset_name(self, assets_dir: Path, filename: str) -> str:
        candidate = filename
        stem = Path(filename).stem
        suffix = Path(filename).suffix
        counter = 1
        while (assets_dir / candidate).exists():
            candidate = f"{stem}-{counter}{suffix}"
            counter += 1
        return candidate

    def _store_import_file(
        self,
        workspace_path: Path,
        source_list_id: str,
        filename: str,
        content: bytes,
    ) -> str:
        imports_dir = workspace_path / "imports"
        imports_dir.mkdir(parents=True, exist_ok=True)
        target_name = self._dedupe_asset_name(imports_dir, f"{source_list_id}-{filename}")
        target_path = imports_dir / target_name
        target_path.write_bytes(content)
        return f"imports/{target_name}"

    def _parse_json_standard_import(
        self, raw_text: str
    ) -> tuple[dict[str, object] | None, list[dict[str, object]]]:
        try:
            payload = json.loads(raw_text)
        except json.JSONDecodeError as exc:
            raise BankWorkspaceError(f"Invalid standards JSON: {exc}", status_code=400)

        if isinstance(payload, list):
            items = payload
            source_list = None
        elif isinstance(payload, dict):
            source_list = payload.get("source_list")
            if "standards" in payload:
                items = payload["standards"]
            elif "items" in payload:
                items = payload["items"]
            else:
                raise BankWorkspaceError(
                    "Standards JSON must include an items or standards array.",
                    status_code=400,
                )
        else:
            raise BankWorkspaceError("Standards JSON must be an object or array.", status_code=400)

        if not isinstance(items, list):
            raise BankWorkspaceError("Standards JSON items must be an array.", status_code=400)

        normalized_items = []
        for item in items:
            if not isinstance(item, dict):
                raise BankWorkspaceError("Each imported standard must be an object.", status_code=400)
            normalized_items.append(item)

        if source_list is not None and not isinstance(source_list, dict):
            raise BankWorkspaceError("source_list must be an object when provided.", status_code=400)

        return source_list, normalized_items

    def _parse_csv_standard_import(self, raw_text: str) -> list[dict[str, object]]:
        reader = csv.DictReader(raw_text.splitlines())
        if reader.fieldnames is None:
            raise BankWorkspaceError("Standards CSV is missing a header row.", status_code=400)

        rows: list[dict[str, object]] = []
        for row in reader:
            if not any((value or "").strip() for value in row.values()):
                continue
            rows.append(
                {
                    "id": row.get("id") or row.get("standard_id") or "",
                    "code": row.get("code") or "",
                    "statement": row.get("statement") or "",
                    "subject": row.get("subject") or "",
                    "grade_band": row.get("grade_band") or "",
                    "tags": row.get("tags") or "",
                }
            )
        return rows

    def _build_source_list_for_import(
        self,
        *,
        embedded_source_list: dict[str, object] | None,
        source_list_id: str | None,
        title: str | None,
        issuer: str | None,
        subject: str | None,
        version: str | None,
        description: str | None,
    ) -> SourceStandardListModel:
        source_list_payload = embedded_source_list or {}
        resolved_id = self._normalize_optional_text(source_list_id) or self._normalize_optional_text(
            source_list_payload.get("id")
        )
        resolved_title = self._normalize_optional_text(title) or self._normalize_optional_text(
            source_list_payload.get("title")
        )
        resolved_issuer = self._normalize_optional_text(issuer) or self._normalize_optional_text(
            source_list_payload.get("issuer")
        )
        resolved_subject = self._normalize_optional_text(subject) or self._normalize_optional_text(
            source_list_payload.get("subject")
        )
        resolved_version = self._normalize_optional_text(version) or self._normalize_optional_text(
            source_list_payload.get("version")
        )
        resolved_description = self._normalize_optional_text(description) or self._normalize_optional_text(
            source_list_payload.get("description")
        )

        if not resolved_id or not resolved_title or not resolved_issuer:
            raise BankWorkspaceError(
                "Standards imports require source_list_id, title, and issuer metadata.",
                status_code=422,
            )

        return SourceStandardListModel(
            id=resolved_id,
            title=resolved_title,
            issuer=resolved_issuer,
            subject=resolved_subject,
            version=resolved_version,
            description=resolved_description,
            imported_at=datetime.now(UTC),
        )

    def _normalize_optional_text(self, value: object) -> str | None:
        text = str(value or "").strip()
        return text or None

    def _normalize_tags(self, value: object) -> list[str]:
        if isinstance(value, list):
            parts = [str(item).strip() for item in value]
        else:
            parts = re.split(r"[;,]", str(value or ""))
        return [part for part in (item.strip() for item in parts) if part]

    def render_svg(self, source: str, variables: dict[str, str]) -> str:
        source = self.SVG_CALC_PATTERN.sub(
            lambda match: self._evaluate_svg_expression(match.group(1), variables),
            source,
        )

        def replace(match: re.Match[str]) -> str:
            key = match.group(1)
            return variables.get(key, "")

        return self.SVG_PLACEHOLDER_PATTERN.sub(replace, source)

    def extract_svg_placeholders(self, source: str) -> list[str]:
        placeholders = set(self.SVG_PLACEHOLDER_PATTERN.findall(source))
        for expression in self.SVG_CALC_PATTERN.findall(source):
            placeholders.update(self.SVG_EXPR_VARIABLE_PATTERN.findall(expression))
        return sorted(placeholders)

    def _evaluate_svg_expression(self, expression: str, variables: dict[str, str]) -> str:
        try:
            parsed = ast.parse(expression, mode="eval")
            value = self._eval_svg_ast(parsed.body, variables)
        except Exception:
            return "0"

        if float(value).is_integer():
            return str(int(value))
        return f"{value:.4f}".rstrip("0").rstrip(".")

    def _eval_svg_ast(self, node: ast.AST, variables: dict[str, str]) -> float:
        if isinstance(node, ast.BinOp):
            left = self._eval_svg_ast(node.left, variables)
            right = self._eval_svg_ast(node.right, variables)
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.Mult):
                return left * right
            if isinstance(node.op, ast.Div):
                return left / right if right != 0 else 0
            raise ValueError("unsupported binary operator")

        if isinstance(node, ast.UnaryOp):
            value = self._eval_svg_ast(node.operand, variables)
            if isinstance(node.op, ast.UAdd):
                return value
            if isinstance(node.op, ast.USub):
                return -value
            raise ValueError("unsupported unary operator")

        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return float(node.value)

        if isinstance(node, ast.Name):
            raw_value = variables.get(node.id, "0").strip()
            try:
                return float(raw_value)
            except ValueError:
                return 0

        raise ValueError("unsupported expression node")
