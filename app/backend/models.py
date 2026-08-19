from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationInfo, field_validator, model_validator


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


class AssetInspectionBatchRequest(BaseModel):
    assets: list[AssetInspectionRequest] = Field(default_factory=list)


class AssetInspectionBatchResponseModel(BaseModel):
    items: list[AssetInspectionResponseModel] = Field(default_factory=list)


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


class CreateStandardPlaceholdersRequest(BaseModel):
    standard_ids: list[str]


class ManualStandardRowModel(BaseModel):
    id: str
    code: str | None = None
    statement: str
    subject: str | None = None
    grade_band: str | None = None
    tags: list[str] = Field(default_factory=list)


class CreateStandardsManuallyRequest(BaseModel):
    source_list_id: str | None = None
    title: str | None = None
    issuer: str | None = None
    subject: str | None = None
    version: str | None = None
    description: str | None = None
    standards: list[ManualStandardRowModel] = Field(default_factory=list)


class QuestionImportValidationIssueModel(BaseModel):
    code: str
    message: str
    location: list[str | int] = Field(default_factory=list)
    severity: Literal["error", "warning"] = "error"


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


class TestQuestionItemModel(BaseModel):
    question_id: str
    experimental: bool = False
    response_space_lines: int | None = None
    teacher_notes: str | None = None

    @field_validator("question_id")
    @classmethod
    def validate_question_id(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("question test items require question_id")
        return text


class TestSectionItemModel(BaseModel):
    item_type: Literal["section"] = "section"
    section_id: str | None = None
    question_type: QuestionType | None = None
    title: str
    instructions: str = ""
    header_template: str | None = None
    topic: str | None = None
    standards: list[str] = Field(default_factory=list)
    suggested_time_mode: Literal["calculated", "override"] = "calculated"
    suggested_time_sec: int | None = None

    @model_validator(mode="after")
    def validate_section_shape(self) -> "TestSectionItemModel":
        if not (self.title or "").strip():
            raise ValueError("section test items require title")
        self.section_id = (self.section_id or self.title).strip()
        self.instructions = self.instructions or ""
        self.header_template = self.header_template if self.header_template is not None else None
        self.topic = self.topic if self.topic and self.topic.strip() else None
        self.standards = [standard.strip() for standard in self.standards if standard.strip()]
        return self


TestItemModel = TestQuestionItemModel | TestSectionItemModel


class TestInstructionSectionModel(BaseModel):
    question_type: QuestionType
    title: str
    instructions: str
    header_template: str | None = None
    show_topic: bool = False
    show_standards: bool = False
    show_suggested_time: bool = True
    suggested_time_mode: Literal["calculated", "override"] = "calculated"
    suggested_time_sec: int | None = None


class TestTemplateBlockModel(BaseModel):
    template: str
    alignment: Literal["left", "center", "right"] = "left"
    horizontal_line: bool = False
    spacing_after_lines: int = 1


class TestInstructionSectionOptionsModel(BaseModel):
    show_topic: bool = False
    show_standards: bool = False
    show_suggested_time: bool = True
    alignment: Literal["left", "center", "right"] = "left"
    horizontal_line: bool = True
    spacing_after_lines: int = 1


def default_test_instruction_sections() -> list[TestInstructionSectionModel]:
    return [
        TestInstructionSectionModel(
            question_type="multiple_choice",
            title="Multiple Choice",
            instructions="Select the best answer.",
            header_template="{{section_title}}\n{{instructions}}\n{{topic}}\n{{standards}}\n{{time}}",
        ),
        TestInstructionSectionModel(
            question_type="numeric_response",
            title="Numeric Response",
            instructions="Enter a numeric answer.",
            header_template="{{section_title}}\n{{instructions}}\n{{topic}}\n{{standards}}\n{{time}}",
        ),
        TestInstructionSectionModel(
            question_type="short_answer",
            title="Short Answer",
            instructions="Write a concise response.",
            header_template="{{section_title}}\n{{instructions}}\n{{topic}}\n{{standards}}\n{{time}}",
        ),
        TestInstructionSectionModel(
            question_type="free_response",
            title="Free Response",
            instructions="Show your work and justify your answer.",
            header_template="{{section_title}}\n{{instructions}}\n{{topic}}\n{{standards}}\n{{time}}",
        ),
    ]


def default_test_page_header() -> TestTemplateBlockModel:
    return TestTemplateBlockModel(
        template="{{title}}\nVersion {{version}}    {{date}}",
        alignment="center",
        horizontal_line=True,
        spacing_after_lines=1,
    )


def default_test_name_field() -> TestTemplateBlockModel:
    return TestTemplateBlockModel(
        template="Name: ______________________________",
        alignment="left",
        horizontal_line=False,
        spacing_after_lines=1,
    )


class TestPrintSettingsModel(BaseModel):
    cover_sheet_enabled: bool = True
    cover_sheet_template: str | None = None
    page_header: TestTemplateBlockModel = Field(default_factory=default_test_page_header)
    name_field: TestTemplateBlockModel = Field(default_factory=default_test_name_field)
    typeface: str = "system"
    font_size_pt: int = 11
    margin_in: float = 0.75
    page_size: Literal["letter", "legal", "a4"] = "letter"
    columns: Literal[1, 2, 3] = 1
    name_field_enabled: bool = True
    page_numbers_enabled: bool = True
    default_response_space_lines: int = 0
    instruction_section_options: TestInstructionSectionOptionsModel = Field(
        default_factory=TestInstructionSectionOptionsModel
    )
    instruction_sections: list[TestInstructionSectionModel] = Field(
        default_factory=default_test_instruction_sections
    )


class TestPerformanceItemModel(BaseModel):
    question_id: str
    attempts: int = 0
    correct: int | None = None
    average_score: float | None = None
    observed_difficulty: float | None = None
    tricky: bool = False
    notes: str | None = None


class TestPerformanceRunModel(BaseModel):
    id: str
    administered_at: datetime
    cohort_label: str | None = None
    notes: str | None = None
    item_results: list[TestPerformanceItemModel] = Field(default_factory=list)


class TestDraftModel(BaseModel):
    id: str
    title: str
    version: str = "A"
    items: list[TestItemModel] = Field(default_factory=list)
    print_settings: TestPrintSettingsModel = Field(default_factory=TestPrintSettingsModel)
    performance_runs: list[TestPerformanceRunModel] = Field(default_factory=list)

    @field_validator("id", "title", "version")
    @classmethod
    def validate_required_text(cls, value: str, info: ValidationInfo) -> str:
        if not value.strip():
            raise ValueError("field must not be empty")
        return value.strip() if info.field_name == "id" else value


class TestDraftCollectionModel(BaseModel):
    items: list[TestDraftModel] = Field(default_factory=list)


class CreateTestDraftRequest(BaseModel):
    title: str
    version: str = "A"


class AddQuestionToTestRequest(BaseModel):
    question_id: str
    experimental: bool = False


class TestStandardBalanceModel(BaseModel):
    standard_id: str
    question_count: int
    average_difficulty: float | None = None
    total_time_estimate_sec: int
    difficulty_counts: dict[str, int] = Field(default_factory=dict)


class TestDraftSummaryModel(BaseModel):
    id: str
    title: str
    version: str
    standard_ids: list[str] = Field(default_factory=list)
    question_type_counts: dict[str, int] = Field(default_factory=dict)
    difficulty_counts: dict[str, int] = Field(default_factory=dict)
    average_difficulty: float | None = None
    total_time_estimate_sec: int = 0
    standard_balance: list[TestStandardBalanceModel] = Field(default_factory=list)


class TestDraftDetailModel(BaseModel):
    test: TestDraftModel
    summary: TestDraftSummaryModel
    questions: list["QuestionModel"] = Field(default_factory=list)


class TestDraftListResponseModel(BaseModel):
    items: list[TestDraftDetailModel] = Field(default_factory=list)


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
    description: str | None = None
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
            correct_indices = answer.get("correct_choice_indices")
            correct_index = answer.get("correct_choice_index")
            if correct_indices is not None:
                if (
                    not isinstance(correct_indices, list)
                    or len(correct_indices) < 2
                    or not all(type(index) is int for index in correct_indices)
                ):
                    raise ValueError(
                        "multiple_choice correct_choice_indices must contain at least two indices"
                    )
                if len(set(correct_indices)) != len(correct_indices):
                    raise ValueError("multiple_choice correct_choice_indices must be unique")
                if any(index < 0 or index >= len(choices) for index in correct_indices):
                    raise ValueError("multiple_choice correct_choice_indices must reference choices")
            elif type(correct_index) is not int:
                raise ValueError(
                    "multiple_choice questions need a correct_choice_index or correct_choice_indices"
                )
            elif correct_index < 0 or correct_index >= len(choices):
                raise ValueError("multiple_choice correct_choice_index must reference a choice")
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


class CreateBankRequest(BaseModel):
    title: str
    description: str | None = None
    destination_path: str


class UpdateBankDetailsRequest(BaseModel):
    title: str
    description: str | None = None


class CreateQuestionRequest(BaseModel):
    template_question_id: str | None = None


class CreateQuestionsFromJsonRequest(BaseModel):
    questions: list[dict[str, Any]] = Field(default_factory=list)


class CreateQuestionsFromJsonResponse(BaseModel):
    items: list["QuestionModel"] = Field(default_factory=list)


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
    choice_preview: list[str] = Field(default_factory=list)
    subtopic: str | None = None
    standards: list[StandardReferenceModel] = Field(default_factory=list)


class QuestionListResponseModel(BaseModel):
    items: list[QuestionListItemModel]
    available_topics: list[str]
    available_types: list[str]
