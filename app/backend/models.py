from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


QuestionType = Literal[
    "multiple_choice",
    "numeric_response",
    "short_answer",
    "free_response",
]


class AssetModel(BaseModel):
    path: str
    kind: str
    svg_variables: dict[str, str] = Field(default_factory=dict)


class AssetUploadResponseModel(BaseModel):
    path: str
    kind: str


class AssetInspectionRequest(BaseModel):
    path: str
    kind: str
    svg_variables: dict[str, str] = Field(default_factory=dict)


class AssetInspectionResponseModel(BaseModel):
    path: str
    kind: str
    svg_placeholders: list[str] = Field(default_factory=list)
    rendered_svg: str | None = None


class AssetListItemModel(BaseModel):
    path: str
    kind: str
    referenced_by: list[str] = Field(default_factory=list)
    svg_placeholders: list[str] = Field(default_factory=list)


class AssetListResponseModel(BaseModel):
    items: list[AssetListItemModel] = Field(default_factory=list)


class StandardReferenceModel(BaseModel):
    standard_id: str


class SourceStandardListModel(BaseModel):
    id: str
    title: str
    issuer: str
    subject: str | None = None
    version: str | None = None
    description: str | None = None
    imported_at: datetime


class StandardRecordModel(BaseModel):
    id: str
    source_list_id: str
    code: str
    statement: str
    subject: str | None = None
    grade_band: str | None = None
    tags: list[str] = Field(default_factory=list)


class SourceStandardListCollectionModel(BaseModel):
    items: list[SourceStandardListModel] = Field(default_factory=list)


class StandardRecordCollectionModel(BaseModel):
    items: list[StandardRecordModel] = Field(default_factory=list)


class CourseModel(BaseModel):
    id: str
    title: str
    description: str | None = None
    standard_refs: list[StandardReferenceModel] = Field(default_factory=list)


class CourseCollectionModel(BaseModel):
    items: list[CourseModel] = Field(default_factory=list)


class StandardListResponseModel(BaseModel):
    items: list[SourceStandardListModel] = Field(default_factory=list)


class StandardSearchResponseModel(BaseModel):
    items: list[StandardRecordModel] = Field(default_factory=list)


class CourseListResponseModel(BaseModel):
    items: list[CourseModel] = Field(default_factory=list)


class StandardImportResponseModel(BaseModel):
    source_list: SourceStandardListModel
    imported_count: int
    imported_path: str | None = None


class QuestionImportValidationIssueModel(BaseModel):
    code: str
    message: str
    location: list[str | int] = Field(default_factory=list)


class QuestionImportRowModel(BaseModel):
    row_id: str
    source_index: int
    source: dict[str, Any] = Field(default_factory=dict)
    question: dict[str, Any] = Field(default_factory=dict)
    proposed_id: str | None = None
    imported_id: str | None = None
    promoted_question_id: str | None = None
    status: Literal["valid", "invalid", "promoted"]
    selected: bool = False
    issues: list[QuestionImportValidationIssueModel] = Field(default_factory=list)


class QuestionImportStageModel(BaseModel):
    id: str
    source_filename: str
    source_path: str
    created_at: datetime
    rows: list[QuestionImportRowModel] = Field(default_factory=list)


class QuestionImportListResponseModel(BaseModel):
    items: list[QuestionImportStageModel] = Field(default_factory=list)


class QuestionImportPromoteRequest(BaseModel):
    row_ids: list[str] | None = None
    id_policy: Literal["auto", "keep_imported"] = "auto"


class QuestionImportRowUpdateRequest(BaseModel):
    question: dict[str, Any]
    selected: bool | None = None


class QuestionImportPromoteResponseModel(BaseModel):
    import_id: str
    promoted_count: int
    promoted_question_ids: list[str] = Field(default_factory=list)
    stage: QuestionImportStageModel


class UpsertCourseRequest(BaseModel):
    title: str
    description: str | None = None
    standard_refs: list[StandardReferenceModel] = Field(default_factory=list)


class RubricRowModel(BaseModel):
    criterion: str
    points: float


class ManifestModel(BaseModel):
    schema_version: str
    bank_id: str
    title: str
    created_at: datetime
    updated_at: datetime
    difficulty_labels: dict[str, str] = Field(default_factory=dict)


class BankIndexModel(BaseModel):
    question_ids: list[str] = Field(default_factory=list)
    topics: list[str] = Field(default_factory=list)
    updated_at: datetime


class QuestionModel(BaseModel):
    id: str
    type: QuestionType
    topic: str
    difficulty: int
    prompt: str
    subtopic: str | None = None
    tags: list[str] = Field(default_factory=list)
    standards: list[StandardReferenceModel] = Field(default_factory=list)
    estimated_time_sec: int | None = None
    points: float | None = None
    status: str = "draft"
    teacher_notes: str | None = None
    answer: dict[str, Any] | None = None
    explanation: str | None = None
    rubric: list[RubricRowModel] = Field(default_factory=list)
    sample_solution: str | None = None
    exemplar_answer: str | None = None
    assets: list[AssetModel] = Field(default_factory=list)

    @field_validator("difficulty")
    @classmethod
    def validate_difficulty(cls, value: int) -> int:
        if value < 1 or value > 5:
            raise ValueError("difficulty must be between 1 and 5")
        return value

    @field_validator("id", "topic", "prompt", "status")
    @classmethod
    def validate_required_text(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("field must not be empty")
        return text

    @field_validator("standards", mode="before")
    @classmethod
    def normalize_standard_references(cls, value: Any) -> list[dict[str, str]]:
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError("standards must be a list")

        normalized: list[dict[str, str]] = []
        for item in value:
            if isinstance(item, str):
                normalized.append({"standard_id": item})
            elif isinstance(item, dict) and isinstance(item.get("standard_id"), str):
                normalized.append({"standard_id": item["standard_id"]})
            else:
                raise ValueError("standards entries must be standard references")
        return normalized

    @model_validator(mode="after")
    def validate_question_shape(self) -> "QuestionModel":
        if self.type == "multiple_choice":
            answer = self.answer or {}
            choices = answer.get("choices")
            if not isinstance(choices, list) or len(choices) < 2:
                raise ValueError("multiple_choice questions need at least two choices")
            if not isinstance(answer.get("correct_choice_index"), int):
                raise ValueError("multiple_choice questions need a correct_choice_index")
        elif self.type == "numeric_response":
            answer = self.answer or {}
            if "value" not in answer:
                raise ValueError("numeric_response questions need an answer value")
            if "tolerance" not in answer:
                raise ValueError("numeric_response questions need an answer tolerance")
        elif self.type == "short_answer":
            if not (self.sample_solution or "").strip():
                raise ValueError("short_answer questions need a sample_solution")
        elif self.type == "free_response":
            if not self.rubric:
                raise ValueError("free_response questions need at least one rubric row")
        return self


class OpenBankRequest(BaseModel):
    path: str


class SaveBankRequest(BaseModel):
    destination_path: str | None = None


class CreateQuestionRequest(BaseModel):
    template_question_id: str | None = None


class NextQuestionIdResponse(BaseModel):
    id: str


class BankSummaryModel(BaseModel):
    source_path: str
    workspace_path: str
    manifest: ManifestModel
    bank: BankIndexModel


class QuestionListItemModel(BaseModel):
    id: str
    topic: str
    type: QuestionType
    difficulty: int
    status: str
    prompt: str


class QuestionListResponseModel(BaseModel):
    items: list[QuestionListItemModel]
    available_topics: list[str]
    available_types: list[str]
