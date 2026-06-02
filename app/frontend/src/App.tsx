import { useEffect, useRef, useState } from "react";

import {
  addQuestionToTest,
  createQuestion,
  createQuestionFromJson,
  createTestDraft,
  deleteQuestion,
  getCurrentBank,
  getAssetFileUrl,
  getQuestion,
  getNextQuestionId,
  inspectAsset,
  listCourses,
  listSourceStandardLists,
  listStandards,
  listAssets,
  listQuestions,
  listTestDrafts,
  openBank,
  openDemoBank,
  saveBank,
  setApiBaseUrl,
  uploadAsset,
  updateQuestion,
  updateTestDraft as updateTestDraftApi,
} from "./api";
import {
  closeCurrentPaneWindow,
  getDesktopContext,
  isDesktopShell,
  openBankDialog,
  openPaneWindow,
  saveBankDialog,
  setArchiveDirtyInShell,
  watchPaneWindowClose,
} from "./desktop";
import {
  escapeLikelyLatexBackslashesInJson,
  looksLikeUnescapedLatexInJson,
  MathPreviewField,
  QuestionMathSummaryPreview,
} from "./MathPreview";
import QuestionImportWorkspace from "./QuestionImportWorkspace";
import StandardsWorkspace from "./StandardsWorkspace";
import TestBuilderPane from "./TestBuilderPane";
import TestPrintPreview from "./TestPrintPreview";
import type {
  AssetInspectionResponseModel,
  AssetListItemModel,
  AssetModel,
  BankSummaryModel,
  CourseModel,
  DesktopContext,
  QuestionListItemModel,
  QuestionModel,
  QuestionType,
  RubricRowModel,
  SourceStandardListModel,
  StandardRecordModel,
  StandardReferenceModel,
  TestDraftDetailModel,
  TestDraftModel,
} from "./types";

type EditorMode = "form" | "json";
type AutosaveState = "idle" | "dirty" | "saving" | "saved" | "error";
type PersistReason = "autosave" | "manual" | "switch" | "save-bank" | "open-bank";
type PaneKind = "questions" | "assets" | "standards" | "test-preview";

interface QuestionPaneSnapshot {
  hasBank: boolean;
  loading: boolean;
  search: string;
  topicFilter: string;
  typeFilter: string;
  availableTopics: string[];
  availableTypes: string[];
  questionItems: QuestionListItemModel[];
  selectedId: string | null;
  promptPreview: string;
}

interface AssetPaneSnapshot {
  hasBank: boolean;
  search: string;
  assets: AssetListItemModel[];
  selectedQuestionId: string | null;
  attachedAssetPaths: string[];
}

interface QuestionStandardsSnapshot {
  questionId: string | null;
  attachedStandardIds: string[];
}

type PaneMessage =
  | { type: "request-state"; pane: PaneKind }
  | { type: "questions-state"; state: QuestionPaneSnapshot }
  | { type: "assets-state"; state: AssetPaneSnapshot }
  | { type: "questions-search"; value: string }
  | { type: "questions-topic-filter"; value: string }
  | { type: "questions-type-filter"; value: string }
  | { type: "questions-select"; id: string }
  | { type: "questions-create" }
  | { type: "questions-duplicate" }
  | { type: "questions-delete" }
  | { type: "assets-search"; value: string }
  | { type: "assets-attach"; path: string }
  | { type: "standards-data-changed" }
  | { type: "request-question-standards-state" }
  | { type: "question-standards-state"; state: QuestionStandardsSnapshot }
  | { type: "question-attach-standard"; standardId: string }
  | { type: "question-remove-standard"; standardId: string }
  | { type: "dock-pane"; pane: PaneKind }
  | { type: "pane-closed"; pane: PaneKind };

const AUTOSAVE_DELAY_MS = 700;
const PANE_SYNC_CHANNEL = "nexzam-pane-sync";

const emptyQuestion = (): QuestionModel => ({
  id: "",
  type: "multiple_choice",
  topic: "",
  difficulty: 1,
  prompt: "",
  subtopic: "",
  tags: [],
  standards: [],
  estimated_time_sec: 60,
  points: 1,
  status: "draft",
  teacher_notes: "",
  answer: {
    choices: ["", ""],
    correct_choice_index: 0,
  },
  explanation: "",
  rubric: [],
  sample_solution: "",
  exemplar_answer: "",
  assets: [],
});

const QUESTION_TYPES: QuestionType[] = [
  "multiple_choice",
  "numeric_response",
  "short_answer",
  "free_response",
];

type MultipleChoiceAnswer = {
  choices?: string[];
  correct_choice_index?: number;
  correct_choice_indices?: number[];
} & Record<string, unknown>;

function isQuestionType(value: unknown): value is QuestionType {
  return typeof value === "string" && QUESTION_TYPES.includes(value as QuestionType);
}

function getCorrectChoiceIndices(answer: MultipleChoiceAnswer, choiceCount: number) {
  const indices = Array.isArray(answer.correct_choice_indices)
    ? answer.correct_choice_indices
    : typeof answer.correct_choice_index === "number"
      ? [answer.correct_choice_index]
      : [];

  return Array.from(
    new Set(
      indices.filter((index) => Number.isInteger(index) && index >= 0 && index < choiceCount),
    ),
  ).sort((left, right) => left - right);
}

function buildMultipleChoiceAnswer(
  answer: MultipleChoiceAnswer,
  choices: string[],
  correctChoiceIndices: number[],
) {
  const nextAnswer: MultipleChoiceAnswer = {
    ...answer,
    choices,
  };
  const normalizedIndices = Array.from(
    new Set(
      correctChoiceIndices.filter(
        (index) => Number.isInteger(index) && index >= 0 && index < choices.length,
      ),
    ),
  ).sort((left, right) => left - right);

  delete nextAnswer.correct_choice_index;
  delete nextAnswer.correct_choice_indices;

  if (normalizedIndices.length === 1) {
    nextAnswer.correct_choice_index = normalizedIndices[0];
  } else {
    nextAnswer.correct_choice_indices = normalizedIndices;
  }

  return nextAnswer;
}

function normalizeQuestionForView(payload: Record<string, unknown>): QuestionModel {
  const base = emptyQuestion();
  return {
    ...base,
    ...payload,
    id: typeof payload.id === "string" ? payload.id : base.id,
    type: isQuestionType(payload.type) ? payload.type : base.type,
    topic: typeof payload.topic === "string" ? payload.topic : base.topic,
    difficulty: typeof payload.difficulty === "number" ? payload.difficulty : base.difficulty,
    prompt: typeof payload.prompt === "string" ? payload.prompt : base.prompt,
    subtopic:
      typeof payload.subtopic === "string" || payload.subtopic === null
        ? payload.subtopic
        : base.subtopic,
    tags: Array.isArray(payload.tags) ? payload.tags.map(String) : base.tags,
    standards: Array.isArray(payload.standards)
      ? (payload.standards as StandardReferenceModel[])
      : base.standards,
    estimated_time_sec:
      typeof payload.estimated_time_sec === "number"
        ? payload.estimated_time_sec
        : base.estimated_time_sec,
    points: typeof payload.points === "number" ? payload.points : base.points,
    status: typeof payload.status === "string" ? payload.status : base.status,
    teacher_notes:
      typeof payload.teacher_notes === "string" || payload.teacher_notes === null
        ? payload.teacher_notes
        : base.teacher_notes,
    answer: isRecord(payload.answer) || payload.answer === null ? payload.answer : base.answer,
    explanation:
      typeof payload.explanation === "string" || payload.explanation === null
        ? payload.explanation
        : base.explanation,
    rubric: Array.isArray(payload.rubric) ? (payload.rubric as RubricRowModel[]) : base.rubric,
    sample_solution:
      typeof payload.sample_solution === "string" || payload.sample_solution === null
        ? payload.sample_solution
        : base.sample_solution,
    exemplar_answer:
      typeof payload.exemplar_answer === "string" || payload.exemplar_answer === null
        ? payload.exemplar_answer
        : base.exemplar_answer,
    assets: Array.isArray(payload.assets) ? (payload.assets as AssetModel[]) : base.assets,
  };
}

function getPaneMode(): PaneKind | null {
  const pane = new URLSearchParams(window.location.search).get("pane");
  return pane === "questions" || pane === "assets" || pane === "standards" || pane === "test-preview"
    ? pane
    : null;
}

function filterAssets(items: AssetListItemModel[], searchTerm: string): AssetListItemModel[] {
  const needle = searchTerm.trim().toLowerCase();
  if (!needle) return items;

  return items.filter((asset) => {
    const haystack = [
      asset.path,
      asset.path.split("/").slice(-1)[0] ?? "",
      asset.kind,
      asset.referenced_by.join(" "),
      asset.svg_placeholders.join(" "),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractQuestionJsonPayload(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown;
  const candidate =
    isRecord(parsed) && isRecord(parsed.question)
      ? parsed.question
      : Array.isArray(parsed) && parsed.length === 1
        ? parsed[0]
        : parsed;

  if (!isRecord(candidate)) {
    throw new Error("Question JSON must be one object, a { question } wrapper, or a one-item array.");
  }

  return candidate;
}

interface QuestionPaneProps {
  open: boolean;
  poppedOut: boolean;
  hasBank: boolean;
  loading: boolean;
  search: string;
  topicFilter: string;
  typeFilter: string;
  availableTopics: string[];
  availableTypes: string[];
  questionItems: QuestionListItemModel[];
  selectedId: string | null;
  promptPreview: string;
  showPromptPreview: boolean;
  onOpen: () => void;
  onClose: () => void;
  onPopOut: () => void;
  onDock: () => void;
  onSearchChange: (value: string) => void;
  onTopicFilterChange: (value: string) => void;
  onTypeFilterChange: (value: string) => void;
  onSelectQuestion: (id: string) => void;
  onCreateQuestion: () => void;
  onDuplicateQuestion: () => void;
  onDeleteQuestion: () => void;
}

function QuestionPane({
  open,
  poppedOut,
  hasBank,
  loading,
  search,
  topicFilter,
  typeFilter,
  availableTopics,
  availableTypes,
  questionItems,
  selectedId,
  promptPreview,
  showPromptPreview,
  onOpen,
  onClose,
  onPopOut,
  onDock,
  onSearchChange,
  onTopicFilterChange,
  onTypeFilterChange,
  onSelectQuestion,
  onCreateQuestion,
  onDuplicateQuestion,
  onDeleteQuestion,
}: QuestionPaneProps) {
  if (!open && !poppedOut) {
    return (
      <aside className="dock-pane drawer-closed left">
        <button className="pane-tab-button left" type="button" onClick={onOpen}>
          Questions
        </button>
      </aside>
    );
  }

  return (
    <aside className={`dock-pane question-pane ${poppedOut ? "popout" : "docked"}`}>
      <div className="pane-header">
        <h2>Questions</h2>
        <div className="pane-header-actions">
          <button type="button" onClick={poppedOut ? onDock : onPopOut}>
            {poppedOut ? "Dock" : "Pop Out"}
          </button>
          {!poppedOut ? (
            <button type="button" onClick={onClose}>
              Hide
            </button>
          ) : null}
        </div>
      </div>

      <div className="pane-content">
        <div className="filters">
          <div className="question-actions">
            <button onClick={onCreateQuestion} disabled={loading || !hasBank}>
              New
            </button>
            <button onClick={onDuplicateQuestion} disabled={loading || !selectedId}>
              Duplicate
            </button>
            <button
              className="danger-button"
              onClick={onDeleteQuestion}
              disabled={loading || !selectedId}
            >
              Delete
            </button>
          </div>
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search text"
          />
          <select value={topicFilter} onChange={(event) => onTopicFilterChange(event.target.value)}>
            <option value="">All topics</option>
            {availableTopics.map((topic) => (
              <option key={topic} value={topic}>
                {topic}
              </option>
            ))}
          </select>
          <select value={typeFilter} onChange={(event) => onTypeFilterChange(event.target.value)}>
            <option value="">All types</option>
            {availableTypes.map((questionType) => (
              <option key={questionType} value={questionType}>
                {questionType}
              </option>
            ))}
          </select>
        </div>

        <div className="question-pane-body">
          <div className="question-list">
            {questionItems.map((item) => (
              <button
                key={item.id}
                className={`question-row ${selectedId === item.id ? "selected" : ""}`}
                onClick={() => onSelectQuestion(item.id)}
              >
                <strong>{item.id}</strong>
                <span>{item.topic}</span>
                <span>{item.type}</span>
                <span>Difficulty {item.difficulty}</span>
                <span>{item.status}</span>
              </button>
            ))}
          </div>

          {showPromptPreview ? (
            <section className="question-preview-panel">
              <div className="question-preview-header">
                <h3>Prompt Preview</h3>
              </div>
              <div className="question-preview-copy">
                {promptPreview ? promptPreview : "Select a question to preview its prompt."}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

interface AssetPaneProps {
  open: boolean;
  poppedOut: boolean;
  hasBank: boolean;
  search: string;
  assets: AssetListItemModel[];
  selectedQuestionId: string | null;
  attachedAssetPaths: string[];
  onOpen: () => void;
  onClose: () => void;
  onPopOut: () => void;
  onDock: () => void;
  onSearchChange: (value: string) => void;
  onAttach: (asset: AssetListItemModel) => void;
}

function AssetPane({
  open,
  poppedOut,
  hasBank,
  search,
  assets,
  selectedQuestionId,
  attachedAssetPaths,
  onOpen,
  onClose,
  onPopOut,
  onDock,
  onSearchChange,
  onAttach,
}: AssetPaneProps) {
  if (!open && !poppedOut) {
    return (
      <aside className="dock-pane drawer-closed right">
        <button className="pane-tab-button right" type="button" onClick={onOpen}>
          Assets
        </button>
      </aside>
    );
  }

  const filteredAssets = filterAssets(assets, search);

  return (
    <aside className={`dock-pane asset-pane ${poppedOut ? "popout" : "docked"}`}>
      <div className="pane-header">
        <h2>Bank Assets</h2>
        <div className="pane-header-actions">
          <button type="button" onClick={poppedOut ? onDock : onPopOut}>
            {poppedOut ? "Dock" : "Pop Out"}
          </button>
          {!poppedOut ? (
            <button type="button" onClick={onClose}>
              Hide
            </button>
          ) : null}
        </div>
      </div>

      <div className="pane-content">
        <div className="bank-assets-header">
          <p>Search filenames, kind, labels, placeholders, and usage.</p>
          <span className="bank-assets-count">
            {filteredAssets.length}/{assets.length}
          </span>
        </div>

        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search assets"
        />

        {hasBank ? (
          filteredAssets.length === 0 ? (
            <p className="asset-empty">No assets match this search.</p>
          ) : (
            <div className="bank-asset-list">
              {filteredAssets.map((asset) => {
                const attachedToCurrent = attachedAssetPaths.includes(asset.path);

                return (
                  <article key={asset.path} className="bank-asset-tile compact">
                    <div className="bank-asset-card-top">
                      <strong>{asset.path.split("/").slice(-1)[0] ?? asset.path}</strong>
                      <div className="bank-asset-badges">
                        <span className="asset-badge">{asset.kind}</span>
                        {asset.kind === "svg" ? (
                          <span className="asset-badge">{asset.svg_placeholders.length} vars</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="bank-asset-thumb square">
                      <img src={getAssetFileUrl(asset.path)} alt={asset.path} />
                    </div>
                    <div className="bank-asset-body compact">
                      <span className="asset-badge">
                        Used by {asset.referenced_by.length} question
                        {asset.referenced_by.length === 1 ? "" : "s"}
                      </span>
                      <p className="bank-asset-refs">
                        {asset.referenced_by.length > 0
                          ? asset.referenced_by.join(", ")
                          : "Unused"}
                      </p>
                      {selectedQuestionId ? (
                        <button
                          type="button"
                          onClick={() => onAttach(asset)}
                          disabled={attachedToCurrent}
                        >
                          {attachedToCurrent ? "Attached" : "Attach"}
                        </button>
                      ) : (
                        <p className="asset-empty">Select a question to attach assets.</p>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )
        ) : (
          <p className="asset-empty">Open a bank to browse assets.</p>
        )}
      </div>
    </aside>
  );
}

function App() {
  const desktopMode = isDesktopShell();
  const paneMode = getPaneMode();
  const isPaneWindow = paneMode !== null;
  const isMainWindow = paneMode === null;

  const [desktopContext, setDesktopContext] = useState<DesktopContext | null>(
    desktopMode
      ? {
          isDesktop: true,
          backendBaseUrl: null,
          backendReady: false,
          backendError: null,
          archiveDirty: false,
        }
      : null,
  );
  const [bank, setBank] = useState<BankSummaryModel | null>(null);
  const [questionItems, setQuestionItems] = useState<QuestionListItemModel[]>([]);
  const [availableTopics, setAvailableTopics] = useState<string[]>([]);
  const [availableTypes, setAvailableTypes] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftQuestion, setDraftQuestion] = useState<QuestionModel | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>("form");
  const [rawJson, setRawJson] = useState("");
  const [search, setSearch] = useState("");
  const [topicFilter, setTopicFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [openPath, setOpenPath] = useState("");
  const [savePath, setSavePath] = useState("");
  const [statusMessage, setStatusMessage] = useState(
    desktopMode ? "Starting local backend..." : "Open a .bok file or load the demo bank.",
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [autosaveState, setAutosaveState] = useState<AutosaveState>("idle");
  const [workspaceDirty, setWorkspaceDirty] = useState(false);
  const [jsonError, setJsonError] = useState(false);
  const [jsonErrorMessage, setJsonErrorMessage] = useState("");
  const [assetInspections, setAssetInspections] = useState<AssetInspectionResponseModel[]>([]);
  const [bankAssets, setBankAssets] = useState<AssetListItemModel[]>([]);
  const [sourceStandardLists, setSourceStandardLists] = useState<SourceStandardListModel[]>([]);
  const [standardRecords, setStandardRecords] = useState<StandardRecordModel[]>([]);
  const [courses, setCourses] = useState<CourseModel[]>([]);
  const [assetBusy, setAssetBusy] = useState(false);
  const [questionDrawerOpen, setQuestionDrawerOpen] = useState(true);
  const [assetDrawerOpen, setAssetDrawerOpen] = useState(false);
  const [questionPanePoppedOut, setQuestionPanePoppedOut] = useState(false);
  const [assetPanePoppedOut, setAssetPanePoppedOut] = useState(false);
  const [questionImportOpen, setQuestionImportOpen] = useState(false);
  const [testBuilderOpen, setTestBuilderOpen] = useState(false);
  const [testDrafts, setTestDrafts] = useState<TestDraftDetailModel[]>([]);
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [metadataExpanded, setMetadataExpanded] = useState(false);
  const [mathPreviewEnabled, setMathPreviewEnabled] = useState(false);
  const [assetSearch, setAssetSearch] = useState("");
  const [questionPaneSnapshot, setQuestionPaneSnapshot] = useState<QuestionPaneSnapshot>({
    hasBank: false,
    loading: false,
    search: "",
    topicFilter: "",
    typeFilter: "",
    availableTopics: [],
    availableTypes: [],
    questionItems: [],
    selectedId: null,
    promptPreview: "",
  });
  const [assetPaneSnapshot, setAssetPaneSnapshot] = useState<AssetPaneSnapshot>({
    hasBank: false,
    search: "",
    assets: [],
    selectedQuestionId: null,
    attachedAssetPaths: [],
  });

  const saveTimerRef = useRef<number | null>(null);
  const assetInputRef = useRef<HTMLInputElement | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const draftQuestionRef = useRef<QuestionModel | null>(null);
  const rawJsonRef = useRef("");
  const editorModeRef = useRef<EditorMode>("form");
  const draftDirtyRef = useRef(false);
  const isHydratingRef = useRef(false);
  const persistInFlightRef = useRef<Promise<boolean> | null>(null);
  const assetInspectionRequestRef = useRef(0);
  const paneChannelRef = useRef<BroadcastChannel | null>(null);
  const questionCloseWatchRef = useRef<(() => void) | null>(null);
  const assetCloseWatchRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    draftQuestionRef.current = draftQuestion;
  }, [draftQuestion]);

  useEffect(() => {
    rawJsonRef.current = rawJson;
  }, [rawJson]);

  useEffect(() => {
    editorModeRef.current = editorMode;
  }, [editorMode]);

  useEffect(() => {
    if (!desktopMode) {
      setApiBaseUrl(null);
      if (isMainWindow) {
        void refreshCurrentBank();
      }
      return;
    }

    let cancelled = false;
    let intervalId: number | null = null;

    const syncDesktopContext = async () => {
      const context = await getDesktopContext().catch(() => null);
      if (!context || cancelled) return;

      setDesktopContext(context);
      setApiBaseUrl(context.backendBaseUrl);

      if (context.backendReady) {
        setStatusMessage("Desktop backend ready.");
        if (isMainWindow) {
          await refreshCurrentBank();
        }
        if (intervalId !== null) {
          window.clearInterval(intervalId);
          intervalId = null;
        }
      } else if (context.backendError) {
        setErrorMessage(context.backendError);
        setStatusMessage("Desktop backend failed to start.");
        if (intervalId !== null) {
          window.clearInterval(intervalId);
          intervalId = null;
        }
      }
    };

    void syncDesktopContext();
    intervalId = window.setInterval(() => {
      void syncDesktopContext();
    }, 1000);

    return () => {
      cancelled = true;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [desktopMode, isMainWindow]);

  useEffect(() => {
    if (!isMainWindow) return;
    if (!bank) return;
    void refreshQuestionList();
  }, [bank, search, topicFilter, typeFilter, isMainWindow]);

  useEffect(() => {
    if (!isMainWindow) return;
    if (!selectedId) {
      isHydratingRef.current = true;
      setDraftQuestion(null);
      setRawJson("");
      setJsonError(false);
      setJsonErrorMessage("");
      draftDirtyRef.current = false;
      setAutosaveState("idle");
      isHydratingRef.current = false;
      return;
    }

    void loadQuestion(selectedId);
  }, [selectedId, isMainWindow]);

  useEffect(() => {
    if (!isMainWindow) return;
    if (
      !selectedId ||
      !draftQuestion ||
      !draftDirtyRef.current ||
      isHydratingRef.current ||
      editorMode === "json" ||
      jsonError
    ) {
      return;
    }

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      void persistDraft("autosave");
    }, AUTOSAVE_DELAY_MS);

    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [selectedId, draftQuestion, rawJson, editorMode, jsonError, isMainWindow]);

  useEffect(() => {
    if (!isMainWindow) return;
    if (!draftQuestion) {
      setAssetInspections([]);
      return;
    }

    const requestId = assetInspectionRequestRef.current + 1;
    assetInspectionRequestRef.current = requestId;
    const assets = draftQuestion.assets;

    if (assets.length === 0) {
      setAssetInspections([]);
      return;
    }

    void (async () => {
      const inspections = await Promise.all(
        assets.map(async (asset) => {
          try {
            return await inspectAsset(asset);
          } catch (error) {
            setErrorMessage((error as Error).message);
            return {
              path: asset.path,
              kind: asset.kind,
              svg_placeholders: [],
              rendered_svg: null,
            } satisfies AssetInspectionResponseModel;
          }
        }),
      );

      if (assetInspectionRequestRef.current === requestId) {
        setAssetInspections(inspections);
      }
    })();
  }, [draftQuestion, isMainWindow]);

  useEffect(() => {
    void setArchiveDirtyInShell(workspaceDirty);
  }, [workspaceDirty]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!workspaceDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [workspaceDirty]);

  async function refreshCurrentBank() {
    try {
      const summary = await getCurrentBank();
      setBank(summary);
      setStatusMessage(`Opened ${summary.manifest.title}`);
      setWorkspaceDirty(false);
      await refreshAssetList();
      await refreshStandardsData();
      await refreshTestDrafts();
    } catch {
      setBank(null);
      setBankAssets([]);
      setSourceStandardLists([]);
      setStandardRecords([]);
      setCourses([]);
      setTestDrafts([]);
      setSelectedTestId(null);
    }
  }

  async function refreshStandardsData() {
    try {
      const [sourceListsResponse, standardsResponse, courseResponse] = await Promise.all([
        listSourceStandardLists(),
        listStandards(),
        listCourses(),
      ]);
      setSourceStandardLists(sourceListsResponse.items);
      setStandardRecords(standardsResponse.items);
      setCourses(courseResponse.items);
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  }

  async function refreshAssetList() {
    try {
      const response = await listAssets();
      setBankAssets(response.items);
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  }

  async function refreshQuestionList(preferredId?: string | null) {
    try {
      const response = await listQuestions({
        search,
        topic: topicFilter || undefined,
        type: typeFilter || undefined,
      });
      setQuestionItems(response.items);
      setAvailableTopics(response.available_topics);
      setAvailableTypes(response.available_types);

      const nextId = preferredId ?? selectedIdRef.current;
      if (!nextId && response.items.length > 0) {
        setSelectedId(response.items[0].id);
      } else if (nextId && !response.items.some((item) => item.id === nextId)) {
        setSelectedId(response.items[0]?.id ?? null);
      }
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  }

  async function refreshTestDrafts(preferredId?: string | null) {
    try {
      const response = await listTestDrafts();
      setTestDrafts(response.items);
      const nextId = preferredId ?? selectedTestId;
      if (nextId && response.items.some((item) => item.test.id === nextId)) {
        setSelectedTestId(nextId);
      } else {
        setSelectedTestId(response.items[0]?.test.id ?? null);
      }
    } catch (error) {
      setErrorMessage((error as Error).message);
      setTestDrafts([]);
      setSelectedTestId(null);
    }
  }

  async function loadQuestion(questionId: string) {
    try {
      isHydratingRef.current = true;
      const question = await getQuestion(questionId);
      draftDirtyRef.current = false;
      setDraftQuestion(question);
      setRawJson(JSON.stringify(question, null, 2));
      setAutosaveState("idle");
      setJsonError(false);
      setJsonErrorMessage("");
      setErrorMessage("");
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      isHydratingRef.current = false;
    }
  }

  function markDraftDirty() {
    if (isHydratingRef.current) return;
    draftDirtyRef.current = true;
    setAutosaveState("dirty");
  }

  function replaceDraftLocally(question: QuestionModel) {
    isHydratingRef.current = true;
    draftQuestionRef.current = question;
    setDraftQuestion(question);
    setRawJson(JSON.stringify(question, null, 2));
    setJsonError(false);
    setJsonErrorMessage("");
    isHydratingRef.current = false;
  }

  function getJsonPayload(): Record<string, unknown> {
    try {
      return extractQuestionJsonPayload(rawJsonRef.current);
    } catch (error) {
      setJsonError(true);
      setJsonErrorMessage((error as Error).message);
      throw error;
    }
  }

  function getPersistPayload(): QuestionModel | Record<string, unknown> | null {
    if (!selectedIdRef.current) return null;
    if (editorModeRef.current === "json") {
      if (jsonError) {
        throw new Error(jsonErrorMessage || "Raw JSON is invalid.");
      }
      return getJsonPayload();
    }
    return draftQuestionRef.current;
  }

  async function persistDraft(reason: PersistReason): Promise<boolean> {
    if (!selectedIdRef.current || !draftQuestionRef.current) {
      return true;
    }

    if (!draftDirtyRef.current && reason !== "save-bank") {
      return true;
    }

    if (persistInFlightRef.current) {
      return persistInFlightRef.current;
    }

    const run = (async () => {
      try {
        if (saveTimerRef.current !== null) {
          window.clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }

        setAutosaveState("saving");
        const payload = getPersistPayload();
        if (!payload) return true;

        const previousId = selectedIdRef.current;
        if (!previousId) return true;
        const savedQuestion = await updateQuestion(previousId, payload);

        draftDirtyRef.current = false;
        setWorkspaceDirty(true);
        setAutosaveState("saved");
        setErrorMessage("");
        replaceDraftLocally(savedQuestion);

        if (savedQuestion.id !== previousId) {
          selectedIdRef.current = savedQuestion.id;
          setSelectedId(savedQuestion.id);
        }

        await refreshQuestionList(savedQuestion.id);
        await refreshAssetList();

        if (reason === "autosave" || reason === "manual") {
          setStatusMessage(
            `Saved ${savedQuestion.id} to the working copy. Save Bank writes the archive.`,
          );
        }

        return true;
      } catch (error) {
        setAutosaveState("error");
        setErrorMessage((error as Error).message);
        return false;
      } finally {
        persistInFlightRef.current = null;
      }
    })();

    persistInFlightRef.current = run;
    return run;
  }

  async function openBankAtPath(path: string) {
    setLoading(true);
    try {
      const summary = await openBank(path);
      setBank(summary);
      setSelectedId(null);
      setQuestionImportOpen(false);
      setWorkspaceDirty(false);
      setAutosaveState("idle");
      setStatusMessage(`Opened ${summary.manifest.title}`);
      await refreshAssetList();
      await refreshStandardsData();
      await refreshTestDrafts();
      setErrorMessage("");
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleOpenDialog() {
    if (!(await persistDraft("open-bank"))) return;
    const path = await openBankDialog();
    if (!path) return;
    await openBankAtPath(path);
  }

  async function handleOpenDemo() {
    if (!(await persistDraft("open-bank"))) return;

    setLoading(true);
    try {
      const summary = await openDemoBank();
      setBank(summary);
      setSelectedId(null);
      setQuestionImportOpen(false);
      setWorkspaceDirty(false);
      setAutosaveState("idle");
      setStatusMessage(`Opened demo bank from ${summary.source_path}`);
      await refreshAssetList();
      await refreshStandardsData();
      await refreshTestDrafts();
      setErrorMessage("");
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleManualOpen() {
    if (!openPath.trim()) {
      setErrorMessage("Enter a .bok path to open.");
      return;
    }

    if (!(await persistDraft("open-bank"))) return;
    await openBankAtPath(openPath.trim());
  }

  async function runSave(destinationPath?: string) {
    setLoading(true);
    try {
      const questionSaved = await persistDraft("save-bank");
      if (!questionSaved) return;

      const response = await saveBank(destinationPath);
      setStatusMessage(`Saved bank to ${response.saved_to}`);
      const summary = await getCurrentBank();
      setBank(summary);
      setWorkspaceDirty(false);
      await refreshAssetList();
      await refreshStandardsData();
      await refreshTestDrafts(selectedTestId);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveBank() {
    if (!bank) return;
    await runSave(undefined);
  }

  async function handleSaveAs() {
    let destinationPath = savePath.trim() || undefined;

    if (desktopMode) {
      destinationPath = (await saveBankDialog(bank?.source_path)) ?? undefined;
    }

    if (!destinationPath) {
      setErrorMessage("Choose a destination for Save As.");
      return;
    }

    await runSave(destinationPath);
  }

  async function handleQuestionImportWorkspaceChanged(
    message: string,
    promotedQuestionIds: string[] = [],
  ) {
    setWorkspaceDirty(true);
    setStatusMessage(`${message} Save Bank writes the archive.`);
    if (promotedQuestionIds.length === 0) return;

    const firstPromotedId = promotedQuestionIds[0];
    setSearch("");
    setTopicFilter("");
    setTypeFilter("");

    try {
      const response = await listQuestions({});
      setQuestionItems(response.items);
      setAvailableTopics(response.available_topics);
      setAvailableTypes(response.available_types);
      selectedIdRef.current = firstPromotedId;
      setSelectedId(firstPromotedId);
      await refreshAssetList();
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  }

  function replaceTestDraft(detail: TestDraftDetailModel) {
    setTestDrafts((current) => {
      const existingIndex = current.findIndex((item) => item.test.id === detail.test.id);
      if (existingIndex === -1) {
        return [...current, detail].sort((left, right) =>
          left.test.id.localeCompare(right.test.id),
        );
      }
      return current.map((item, index) => (index === existingIndex ? detail : item));
    });
    setSelectedTestId(detail.test.id);
  }

  async function handleCreateTestDraft() {
    if (!bank) return;

    setLoading(true);
    try {
      const detail = await createTestDraft({
        title: `${bank.manifest.title} Test`,
        version: "A",
      });
      replaceTestDraft(detail);
      setWorkspaceDirty(true);
      setStatusMessage(`Created ${detail.test.id} in the working copy.`);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddSelectedQuestionToTest() {
    if (!selectedTestId || !selectedId) return;

    setLoading(true);
    try {
      const detail = await addQuestionToTest({
        testId: selectedTestId,
        question_id: selectedId,
      });
      replaceTestDraft(detail);
      setWorkspaceDirty(true);
      setStatusMessage(`Added ${selectedId} to ${detail.test.id}.`);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdateTestDraft(test: TestDraftModel) {
    setLoading(true);
    try {
      const previousId = selectedTestId ?? test.id;
      const detail = await updateTestDraftApi(previousId, test);
      replaceTestDraft(detail);
      setWorkspaceDirty(true);
      setStatusMessage(`Saved ${detail.test.id} to the working copy.`);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveQuestion() {
    if (!bank || !selectedIdRef.current) return;
    const saved = await persistDraft("manual");
    if (saved && !draftDirtyRef.current) {
      setStatusMessage(
        `Saved ${selectedIdRef.current} to the working copy. Save Bank writes the archive.`,
      );
    }
  }

  async function handleSaveQuestionAsNew() {
    if (!bank || !draftQuestionRef.current) return;

    setLoading(true);
    try {
      const payload =
        editorModeRef.current === "json"
          ? getJsonPayload()
          : (draftQuestionRef.current as unknown as Record<string, unknown>);
      const createdQuestion = await createQuestionFromJson(payload);

      draftDirtyRef.current = false;
      setWorkspaceDirty(true);
      setAutosaveState("saved");
      replaceDraftLocally(createdQuestion);
      selectedIdRef.current = createdQuestion.id;
      setSelectedId(createdQuestion.id);
      await refreshQuestionList(createdQuestion.id);
      await refreshAssetList();
      setStatusMessage(
        `Saved new question ${createdQuestion.id} to the working copy. Save Bank writes the archive.`,
      );
      setErrorMessage("");
    } catch (error) {
      setAutosaveState("error");
      setErrorMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRevertQuestion() {
    const currentId = selectedIdRef.current;
    if (!currentId) return;

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    await loadQuestion(currentId);
    draftDirtyRef.current = false;
    setAutosaveState("idle");
    setStatusMessage(`Reverted ${currentId} to the working copy version.`);
  }

  function handleFormatRawJson() {
    try {
      const payload = extractQuestionJsonPayload(rawJsonRef.current);
      const formatted = JSON.stringify(payload, null, 2);
      setRawJson(formatted);
      setJsonError(false);
      setJsonErrorMessage("");
      const previewQuestion = normalizeQuestionForView(payload);
      draftQuestionRef.current = previewQuestion;
      setDraftQuestion(previewQuestion);
      markDraftDirty();
      setErrorMessage("");
    } catch (error) {
      setJsonError(true);
      setJsonErrorMessage((error as Error).message);
      setErrorMessage((error as Error).message);
    }
  }

  function handleEscapeLatexBackslashesInRawJson() {
    const repaired = escapeLikelyLatexBackslashesInJson(rawJsonRef.current);
    setRawJson(repaired);
    rawJsonRef.current = repaired;
    markDraftDirty();

    try {
      const payload = extractQuestionJsonPayload(repaired);
      const formatted = JSON.stringify(payload, null, 2);
      setRawJson(formatted);
      rawJsonRef.current = formatted;
      setJsonError(false);
      setJsonErrorMessage("");
      const previewQuestion = normalizeQuestionForView(payload);
      draftQuestionRef.current = previewQuestion;
      setDraftQuestion(previewQuestion);
      setErrorMessage("");
    } catch (error) {
      setJsonError(true);
      setJsonErrorMessage((error as Error).message);
      setErrorMessage((error as Error).message);
    }
  }

  async function handleSelectQuestion(nextId: string) {
    if (nextId === selectedIdRef.current) return;
    if (!(await persistDraft("switch"))) {
      if (
        editorModeRef.current !== "json" ||
        !window.confirm("Discard unsaved JSON edits and switch questions?")
      ) {
        return;
      }
      draftDirtyRef.current = false;
      setAutosaveState("idle");
      setJsonError(false);
      setJsonErrorMessage("");
    }
    setSelectedId(nextId);
  }

  async function handleCreateQuestion(templateQuestionId?: string) {
    if (!(await persistDraft("switch"))) return;

    setLoading(true);
    try {
      const createdQuestion = await createQuestion(templateQuestionId);
      draftDirtyRef.current = false;
      setWorkspaceDirty(true);
      setAutosaveState("idle");
      replaceDraftLocally(createdQuestion);
      selectedIdRef.current = createdQuestion.id;
      setSelectedId(createdQuestion.id);
      await refreshQuestionList(createdQuestion.id);
      await refreshAssetList();
      setStatusMessage(
        templateQuestionId
          ? `Copied ${templateQuestionId} to ${createdQuestion.id} in the working copy.`
          : `Created ${createdQuestion.id} in the working copy.`,
      );
      setErrorMessage("");
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteQuestion() {
    const currentId = selectedIdRef.current;
    if (!currentId) return;

    setLoading(true);
    try {
      await deleteQuestion(currentId);
      draftDirtyRef.current = false;
      isHydratingRef.current = true;
      draftQuestionRef.current = null;
      setDraftQuestion(null);
      setRawJson("");
      setJsonError(false);
      setAutosaveState("idle");
      isHydratingRef.current = false;
      selectedIdRef.current = null;
      setSelectedId(null);
      setWorkspaceDirty(true);
      await refreshQuestionList(null);
      await refreshAssetList();
      setStatusMessage(`Deleted ${currentId} from the working copy.`);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function updateDraft<K extends keyof QuestionModel>(field: K, value: QuestionModel[K]) {
    setDraftQuestion((current) => {
      if (!current) return current;
      const next = { ...current, [field]: value };
      draftQuestionRef.current = next;
      setRawJson(JSON.stringify(next, null, 2));
      return next;
    });
    markDraftDirty();
  }

  function updateAsset(index: number, updater: (asset: AssetModel) => AssetModel) {
    const current = draftQuestionRef.current;
    if (!current) return;
    updateDraft(
      "assets",
      current.assets.map((asset, assetIndex) =>
        assetIndex === index ? updater(asset) : asset,
      ),
    );
  }

  function removeAsset(index: number) {
    const current = draftQuestionRef.current;
    if (!current) return;
    updateDraft(
      "assets",
      current.assets.filter((_, assetIndex) => assetIndex !== index),
    );
  }

  function handleAttachExistingAsset(asset: AssetListItemModel) {
    const current = draftQuestionRef.current;
    if (!current) return;
    if (current.assets.some((attached) => attached.path === asset.path)) {
      setStatusMessage(`${asset.path} is already attached to ${current.id}.`);
      return;
    }

    updateDraft("assets", [
      ...current.assets,
      {
        path: asset.path,
        kind: asset.kind,
        svg_variables: {},
      },
    ]);
    setStatusMessage(`Attached ${asset.path} to ${current.id}.`);
  }

  async function handleAssetUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;

    setAssetBusy(true);
    try {
      const uploadedAssets = await Promise.all(
        Array.from(fileList).map(async (file) => {
          const uploaded = await uploadAsset(file);
          return {
            path: uploaded.path,
            kind: uploaded.kind,
            svg_variables: {},
          } satisfies AssetModel;
        }),
      );

      const current = draftQuestionRef.current;
      if (!current) return;
      updateDraft("assets", [...current.assets, ...uploadedAssets]);
      await refreshAssetList();
      setErrorMessage("");
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setAssetBusy(false);
      if (assetInputRef.current) {
        assetInputRef.current.value = "";
      }
    }
  }

  function handleRawJsonChange(value: string) {
    setRawJson(value);
    markDraftDirty();

    try {
      const parsed = extractQuestionJsonPayload(value);
      const previewQuestion = normalizeQuestionForView(parsed);
      setJsonError(false);
      setJsonErrorMessage("");
      draftQuestionRef.current = previewQuestion;
      setDraftQuestion(previewQuestion);
      setErrorMessage("");
    } catch (error) {
      setJsonError(true);
      setJsonErrorMessage((error as Error).message);
      setErrorMessage((error as Error).message);
    }
  }

  async function updateQuestionType(nextType: QuestionType) {
    const base = draftQuestionRef.current ?? emptyQuestion();
    let nextId = base.id;
    if (base.type !== nextType) {
      try {
        nextId = (await getNextQuestionId(nextType)).id;
      } catch (error) {
        setErrorMessage((error as Error).message);
      }
    }

    const next: QuestionModel = {
      ...base,
      id: nextId,
      type: nextType,
      answer:
        nextType === "multiple_choice"
          ? { choices: ["", ""], correct_choice_index: 0 }
          : nextType === "numeric_response"
            ? { value: 0, unit: "", tolerance: 0 }
            : null,
      rubric: nextType === "free_response" ? base.rubric : [],
      sample_solution:
        nextType === "short_answer" || nextType === "free_response"
          ? base.sample_solution ?? ""
          : "",
      exemplar_answer: nextType === "free_response" ? base.exemplar_answer ?? "" : "",
    };

    draftQuestionRef.current = next;
    setDraftQuestion(next);
    setRawJson(JSON.stringify(next, null, 2));
    markDraftDirty();
  }

  function updateMultipleChoiceChoice(index: number, value: string) {
    const answer =
      (draftQuestionRef.current?.answer as MultipleChoiceAnswer | null) ??
      { choices: ["", ""], correct_choice_index: 0 };
    const choices = [...(answer.choices ?? ["", ""])];
    choices[index] = value;
    updateDraft("answer", buildMultipleChoiceAnswer(answer, choices, getCorrectChoiceIndices(answer, choices.length)));
  }

  function addMultipleChoiceChoice() {
    const answer =
      (draftQuestionRef.current?.answer as MultipleChoiceAnswer | null) ??
      { choices: ["", ""], correct_choice_index: 0 };
    const choices = [...(answer.choices ?? ["", ""]), ""];
    updateDraft("answer", buildMultipleChoiceAnswer(answer, choices, getCorrectChoiceIndices(answer, choices.length)));
  }

  function removeMultipleChoiceChoice(index: number) {
    const answer =
      (draftQuestionRef.current?.answer as MultipleChoiceAnswer | null) ??
      { choices: ["", ""], correct_choice_index: 0 };
    const existingChoices = [...(answer.choices ?? ["", ""])];
    if (existingChoices.length <= 2) {
      return;
    }

    const choices = existingChoices.filter((_, choiceIndex) => choiceIndex !== index);
    let nextCorrectIndices = getCorrectChoiceIndices(answer, existingChoices.length)
      .filter((choiceIndex) => choiceIndex !== index)
      .map((choiceIndex) => (choiceIndex > index ? choiceIndex - 1 : choiceIndex));
    if (nextCorrectIndices.length === 0 && choices.length > 0) {
      nextCorrectIndices = [Math.max(0, Math.min(index, choices.length - 1))];
    }

    updateDraft("answer", buildMultipleChoiceAnswer(answer, choices, nextCorrectIndices));
  }

  function updateMultipleChoiceCorrectChoice(index: number, checked: boolean) {
    const answer =
      (draftQuestionRef.current?.answer as MultipleChoiceAnswer | null) ??
      { choices: ["", ""], correct_choice_index: 0 };
    const choices = [...(answer.choices ?? ["", ""])];
    const currentCorrectIndices = getCorrectChoiceIndices(answer, choices.length);
    const nextCorrectIndices = checked
      ? [...currentCorrectIndices, index]
      : currentCorrectIndices.filter((choiceIndex) => choiceIndex !== index);
    updateDraft("answer", buildMultipleChoiceAnswer(answer, choices, nextCorrectIndices));
  }

  function updateNumericAnswer(field: "value" | "unit" | "tolerance", value: string) {
    const answer = (draftQuestionRef.current?.answer as Record<string, unknown>) ?? {};
    updateDraft("answer", {
      ...answer,
      [field]: field === "unit" ? value : Number(value),
    });
  }

  function updateRubricRow(index: number, field: keyof RubricRowModel, value: string) {
    if (!draftQuestionRef.current) return;
    const rubric = draftQuestionRef.current.rubric.map((row, rowIndex) =>
      rowIndex === index
        ? {
            ...row,
            [field]: field === "points" ? Number(value) : value,
          }
        : row,
    );
    updateDraft("rubric", rubric);
  }

  function attachStandardToQuestion(standardId: string) {
    const current = draftQuestionRef.current;
    if (!current) return;
    if (current.standards.some((reference) => reference.standard_id === standardId)) {
      setStatusMessage(`${standardId} is already attached to ${current.id}.`);
      return;
    }

    updateDraft("standards", [
      ...current.standards,
      {
        standard_id: standardId,
      } satisfies StandardReferenceModel,
    ]);
    setStatusMessage(`Attached ${standardId} to ${current.id}.`);
  }

  function removeStandardFromQuestion(standardId: string) {
    const current = draftQuestionRef.current;
    if (!current) return;
    updateDraft(
      "standards",
      current.standards.filter((reference) => reference.standard_id !== standardId),
    );
  }

  async function handleOpenQuestionStandardsPicker() {
    try {
      await openPaneWindow("standards", "Question Standards", {
        mode: "picker",
        width: 1080,
        height: 860,
      });
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  }

  async function handlePopOutPane(pane: PaneKind) {
    if (!isMainWindow) return;

    try {
      await openPaneWindow(pane, pane === "questions" ? "Questions" : "Bank Assets");

      if (pane === "questions") {
        setQuestionPanePoppedOut(true);
        setQuestionDrawerOpen(false);
      } else {
        setAssetPanePoppedOut(true);
        setAssetDrawerOpen(false);
      }

      setStatusMessage(
        pane === "questions"
          ? "Opened the Questions pane in a separate window."
          : "Opened the Bank Assets pane in a separate window.",
      );
    } catch (error) {
      if (pane === "questions") {
        setQuestionPanePoppedOut(false);
        setQuestionDrawerOpen(true);
      } else {
        setAssetPanePoppedOut(false);
        setAssetDrawerOpen(true);
      }
      setErrorMessage((error as Error).message);
    }
  }

  async function handleOpenStandardsWorkspace() {
    try {
      await openPaneWindow("standards", "Standards", {
        mode: "workspace",
        width: 1280,
        height: 900,
      });
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  }

  async function handleOpenTestPrintPreview() {
    const selectedTest = testDrafts.find((item) => item.test.id === selectedTestId) ?? testDrafts[0];
    if (!selectedTest) return;

    try {
      await openPaneWindow("test-preview", "Printable Test Preview", {
        mode: selectedTest.test.id,
        width: 1180,
        height: 920,
      });
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  }

  async function handleDockPane(pane: PaneKind) {
    if (isMainWindow) {
      if (pane === "questions") {
        setQuestionPanePoppedOut(false);
        setQuestionDrawerOpen(true);
      } else {
        setAssetPanePoppedOut(false);
        setAssetDrawerOpen(true);
      }
      return;
    }

    paneChannelRef.current?.postMessage({ type: "dock-pane", pane });
    await closeCurrentPaneWindow().catch(() => {
      window.close();
    });
  }

  function handlePaneAttach(path: string) {
    const asset = bankAssets.find((item) => item.path === path);
    if (!asset) return;
    handleAttachExistingAsset(asset);
  }

  const promptPreview =
    (selectedId && draftQuestion?.id === selectedId
      ? draftQuestion.prompt
      : questionItems.find((item) => item.id === selectedId)?.prompt) ?? "";

  const questionSnapshot: QuestionPaneSnapshot = {
    hasBank: !!bank,
    loading,
    search,
    topicFilter,
    typeFilter,
    availableTopics,
    availableTypes,
    questionItems,
    selectedId,
    promptPreview,
  };

  const assetSnapshot: AssetPaneSnapshot = {
    hasBank: !!bank,
    search: assetSearch,
    assets: bankAssets,
    selectedQuestionId: selectedId,
    attachedAssetPaths: draftQuestion?.assets.map((asset) => asset.path) ?? [],
  };
  const questionStandardsSnapshot: QuestionStandardsSnapshot = {
    questionId: selectedId,
    attachedStandardIds: draftQuestion?.standards.map((reference) => reference.standard_id) ?? [],
  };

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    if (!paneChannelRef.current) {
      paneChannelRef.current = new BroadcastChannel(PANE_SYNC_CHANNEL);
    }

    const channel = paneChannelRef.current;
    channel.onmessage = (event: MessageEvent<PaneMessage>) => {
      const message = event.data;

      if (isMainWindow) {
        if (message.type === "request-state") {
          channel.postMessage(
            message.pane === "questions"
              ? { type: "questions-state", state: questionSnapshot }
              : { type: "assets-state", state: assetSnapshot },
          );
          return;
        }

        if (message.type === "questions-search") {
          setSearch(message.value);
          return;
        }
        if (message.type === "questions-topic-filter") {
          setTopicFilter(message.value);
          return;
        }
        if (message.type === "questions-type-filter") {
          setTypeFilter(message.value);
          return;
        }
        if (message.type === "questions-select") {
          void handleSelectQuestion(message.id);
          return;
        }
        if (message.type === "questions-create") {
          void handleCreateQuestion();
          return;
        }
        if (message.type === "questions-duplicate") {
          void handleCreateQuestion(selectedIdRef.current ?? undefined);
          return;
        }
        if (message.type === "questions-delete") {
          void handleDeleteQuestion();
          return;
        }
        if (message.type === "assets-search") {
          setAssetSearch(message.value);
          return;
        }
        if (message.type === "assets-attach") {
          handlePaneAttach(message.path);
          return;
        }
        if (message.type === "standards-data-changed") {
          void refreshStandardsData();
          return;
        }
        if (message.type === "request-question-standards-state") {
          channel.postMessage({
            type: "question-standards-state",
            state: questionStandardsSnapshot,
          });
          return;
        }
        if (message.type === "question-attach-standard") {
          attachStandardToQuestion(message.standardId);
          return;
        }
        if (message.type === "question-remove-standard") {
          removeStandardFromQuestion(message.standardId);
          return;
        }
        if (message.type === "dock-pane") {
          if (message.pane === "questions") {
            setQuestionPanePoppedOut(false);
            setQuestionDrawerOpen(true);
          } else {
            setAssetPanePoppedOut(false);
            setAssetDrawerOpen(true);
          }
          return;
        }
        if (message.type === "pane-closed") {
          if (message.pane === "questions") {
            setQuestionPanePoppedOut(false);
          } else {
            setAssetPanePoppedOut(false);
          }
        }
        return;
      }

      if (paneMode === "questions" && message.type === "questions-state") {
        setQuestionPaneSnapshot(message.state);
        return;
      }

      if (paneMode === "assets" && message.type === "assets-state") {
        setAssetPaneSnapshot(message.state);
      }
    };

    return () => {
      channel.onmessage = null;
    };
  }, [assetSnapshot, isMainWindow, paneMode, questionSnapshot, questionStandardsSnapshot]);

  useEffect(() => {
    if (!paneChannelRef.current) return;
    if (isMainWindow) {
      paneChannelRef.current.postMessage({ type: "questions-state", state: questionSnapshot });
      paneChannelRef.current.postMessage({ type: "assets-state", state: assetSnapshot });
      paneChannelRef.current.postMessage({
        type: "question-standards-state",
        state: questionStandardsSnapshot,
      });
    }
  }, [assetSnapshot, isMainWindow, questionSnapshot, questionStandardsSnapshot]);

  useEffect(() => {
    if (!isPaneWindow || !paneChannelRef.current) return;
    paneChannelRef.current.postMessage({ type: "request-state", pane: paneMode });
  }, [isPaneWindow, paneMode]);

  useEffect(() => {
    if (!isPaneWindow || !paneChannelRef.current) return;

    const channel = paneChannelRef.current;
    const notifyClosed = () => {
      channel.postMessage({ type: "pane-closed", pane: paneMode });
    };

    window.addEventListener("beforeunload", notifyClosed);
    return () => window.removeEventListener("beforeunload", notifyClosed);
  }, [isPaneWindow, paneMode]);

  useEffect(() => {
    return () => {
      questionCloseWatchRef.current?.();
      questionCloseWatchRef.current = null;
      assetCloseWatchRef.current?.();
      assetCloseWatchRef.current = null;
      paneChannelRef.current?.close();
      paneChannelRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isMainWindow || !questionPanePoppedOut) {
      questionCloseWatchRef.current?.();
      questionCloseWatchRef.current = null;
      return;
    }

    let cancelled = false;

    void (async () => {
      const unlisten = await watchPaneWindowClose("questions", () => {
        setQuestionPanePoppedOut(false);
        setQuestionDrawerOpen(false);
      }).catch(() => null);

      if (cancelled) {
        unlisten?.();
        return;
      }

      questionCloseWatchRef.current?.();
      questionCloseWatchRef.current = unlisten ?? null;
    })();

    return () => {
      cancelled = true;
      questionCloseWatchRef.current?.();
      questionCloseWatchRef.current = null;
    };
  }, [isMainWindow, questionPanePoppedOut]);

  useEffect(() => {
    if (!isMainWindow || !assetPanePoppedOut) {
      assetCloseWatchRef.current?.();
      assetCloseWatchRef.current = null;
      return;
    }

    let cancelled = false;

    void (async () => {
      const unlisten = await watchPaneWindowClose("assets", () => {
        setAssetPanePoppedOut(false);
        setAssetDrawerOpen(false);
      }).catch(() => null);

      if (cancelled) {
        unlisten?.();
        return;
      }

      assetCloseWatchRef.current?.();
      assetCloseWatchRef.current = unlisten ?? null;
    })();

    return () => {
      cancelled = true;
      assetCloseWatchRef.current?.();
      assetCloseWatchRef.current = null;
    };
  }, [assetPanePoppedOut, isMainWindow]);

  useEffect(() => {
    document.title =
      paneMode === "questions"
        ? "Questions - Nexzam"
        : paneMode === "assets"
          ? "Assets - Nexzam"
          : paneMode === "standards"
            ? "Standards - Nexzam"
            : paneMode === "test-preview"
              ? "Printable Test Preview - Nexzam"
          : "Nexzam";
  }, [paneMode]);

  const workingCopyLabel =
    autosaveState === "saving"
      ? "Saving working copy..."
      : autosaveState === "dirty"
        ? "Working copy has unsaved edits"
        : autosaveState === "saved"
          ? "Autosaved to working copy"
          : autosaveState === "error"
            ? "Working copy save failed"
            : "Working copy up to date";

  const archiveLabel = workspaceDirty
    ? "Archive needs Save Bank"
    : bank
      ? "Archive up to date"
      : "No archive open";

  const archivePathLabel = bank?.source_path ?? "No archive open";
  const workspaceLabel = bank ? `Workspace open at ${bank.workspace_path}` : "No workspace open";
  const desktopBootBlocked = desktopMode && !desktopContext?.backendReady;
  const questionPaneDocked = !questionPanePoppedOut && questionDrawerOpen;
  const assetPaneDocked = !assetPanePoppedOut && assetDrawerOpen;
  const editorShouldFill = !questionPaneDocked && !assetPaneDocked;
  const standardsById = Object.fromEntries(
    standardRecords.map((standard) => [standard.id, standard] satisfies [string, StandardRecordModel]),
  );

  if (desktopBootBlocked) {
    return (
      <div className="startup-screen">
        <div className="startup-card">
          <h1>Nexzam</h1>
          <p>{desktopContext?.backendError ? "Backend startup failed." : "Starting local backend..."}</p>
          <p className="startup-detail">
            {desktopContext?.backendError ??
              "The desktop shell is waiting for the local FastAPI backend to report healthy."}
          </p>
        </div>
      </div>
    );
  }

  if (paneMode === "questions") {
    return (
      <div className="pane-window-shell">
        <QuestionPane
          open
          poppedOut
          hasBank={questionPaneSnapshot.hasBank}
          loading={questionPaneSnapshot.loading}
          search={questionPaneSnapshot.search}
          topicFilter={questionPaneSnapshot.topicFilter}
          typeFilter={questionPaneSnapshot.typeFilter}
          availableTopics={questionPaneSnapshot.availableTopics}
          availableTypes={questionPaneSnapshot.availableTypes}
          questionItems={questionPaneSnapshot.questionItems}
          selectedId={questionPaneSnapshot.selectedId}
          promptPreview={questionPaneSnapshot.promptPreview}
          showPromptPreview
          onOpen={() => undefined}
          onClose={() => undefined}
          onPopOut={() => undefined}
          onDock={() => void handleDockPane("questions")}
          onSearchChange={(value) =>
            paneChannelRef.current?.postMessage({ type: "questions-search", value })
          }
          onTopicFilterChange={(value) =>
            paneChannelRef.current?.postMessage({ type: "questions-topic-filter", value })
          }
          onTypeFilterChange={(value) =>
            paneChannelRef.current?.postMessage({ type: "questions-type-filter", value })
          }
          onSelectQuestion={(id) =>
            paneChannelRef.current?.postMessage({ type: "questions-select", id })
          }
          onCreateQuestion={() => paneChannelRef.current?.postMessage({ type: "questions-create" })}
          onDuplicateQuestion={() =>
            paneChannelRef.current?.postMessage({ type: "questions-duplicate" })
          }
          onDeleteQuestion={() => paneChannelRef.current?.postMessage({ type: "questions-delete" })}
        />
      </div>
    );
  }

  if (paneMode === "assets") {
    return (
      <div className="pane-window-shell">
        <AssetPane
          open
          poppedOut
          hasBank={assetPaneSnapshot.hasBank}
          search={assetPaneSnapshot.search}
          assets={assetPaneSnapshot.assets}
          selectedQuestionId={assetPaneSnapshot.selectedQuestionId}
          attachedAssetPaths={assetPaneSnapshot.attachedAssetPaths}
          onOpen={() => undefined}
          onClose={() => undefined}
          onPopOut={() => undefined}
          onDock={() => void handleDockPane("assets")}
          onSearchChange={(value) =>
            paneChannelRef.current?.postMessage({ type: "assets-search", value })
          }
          onAttach={(asset) =>
            paneChannelRef.current?.postMessage({ type: "assets-attach", path: asset.path })
          }
        />
      </div>
    );
  }

  if (paneMode === "standards") {
    return (
      <div className="pane-window-shell standards-window-shell">
        <StandardsWorkspace showCloseHint />
      </div>
    );
  }

  if (paneMode === "test-preview") {
    const testId = new URLSearchParams(window.location.search).get("mode");
    return (
      <TestPrintPreview
        testId={testId}
        onClose={() => {
          void closeCurrentPaneWindow();
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-title">
          <h1>Nexzam</h1>
          <p>{bank ? bank.manifest.title : "No bank open"}</p>
        </div>

        <div className="topbar-controls">
          <button onClick={() => void handleOpenDialog()} disabled={loading || !desktopMode}>
            Open Bank
          </button>
          <button onClick={() => void handleOpenDemo()} disabled={loading}>
            Open Demo Bank
          </button>
          <button onClick={() => void handleOpenStandardsWorkspace()} disabled={loading || !bank}>
            Standards
          </button>
          <button
            type="button"
            onClick={() => setQuestionImportOpen((current) => !current)}
            disabled={loading || !bank}
          >
            Import Questions
          </button>
          <button
            type="button"
            onClick={() => setTestBuilderOpen((current) => !current)}
            disabled={loading || !bank}
          >
            Test Builder
          </button>
          <button onClick={() => void handleSaveBank()} disabled={loading || !bank}>
            Save Bank
          </button>
          <button onClick={() => void handleSaveAs()} disabled={loading || !bank}>
            Save As
          </button>
        </div>
      </header>

      <div className="archive-strip">
        <div className="archive-meta">
          <span className="meta-label">Archive</span>
          <span className="meta-value">{archivePathLabel}</span>
        </div>
        <div className="archive-meta">
          <span className="meta-label">Workspace</span>
          <span className="meta-value">{workspaceLabel}</span>
        </div>
      </div>

      <div className="status-strip">
        <span>{statusMessage}</span>
        <div className="status-pills">
          <span className={`status-pill ${autosaveState}`}>{workingCopyLabel}</span>
          <span className={`status-pill ${workspaceDirty ? "dirty" : "saved"}`}>{archiveLabel}</span>
        </div>
        {errorMessage ? <span className="error-text">{errorMessage}</span> : null}
      </div>

      <details className="fallback-panel">
        <summary>Manual Path Fallback</summary>
        <div className="fallback-grid">
          <input
            value={openPath}
            onChange={(event) => setOpenPath(event.target.value)}
            placeholder="/absolute/path/to/bank.bok"
          />
          <button onClick={() => void handleManualOpen()} disabled={loading}>
            Open Path
          </button>
          <input
            value={savePath}
            onChange={(event) => setSavePath(event.target.value)}
            placeholder="/absolute/path/to/save-as.bok"
          />
          <button onClick={() => void handleSaveAs()} disabled={loading || !bank}>
            Save As Path
          </button>
        </div>
      </details>

      <QuestionImportWorkspace
        open={questionImportOpen}
        hasBank={!!bank}
        onClose={() => setQuestionImportOpen(false)}
        onWorkspaceChanged={(message, promotedQuestionIds) =>
          void handleQuestionImportWorkspaceChanged(message, promotedQuestionIds)
        }
      />

      <TestBuilderPane
        open={testBuilderOpen}
        hasBank={!!bank}
        loading={loading}
        selectedQuestionId={selectedId}
        selectedTestId={selectedTestId}
        tests={testDrafts}
        onOpen={() => setTestBuilderOpen(true)}
        onClose={() => setTestBuilderOpen(false)}
        onCreateTest={() => void handleCreateTestDraft()}
        onSelectTest={setSelectedTestId}
        onAddSelectedQuestion={() => void handleAddSelectedQuestionToTest()}
        onOpenPrintPreview={() => void handleOpenTestPrintPreview()}
        onUpdateTest={(test) => void handleUpdateTestDraft(test)}
      />

      <div className="workspace">
        {!questionPanePoppedOut ? (
          <QuestionPane
            open={questionDrawerOpen}
            poppedOut={false}
            hasBank={!!bank}
            loading={loading}
            search={search}
            topicFilter={topicFilter}
            typeFilter={typeFilter}
            availableTopics={availableTopics}
            availableTypes={availableTypes}
            questionItems={questionItems}
            selectedId={selectedId}
            promptPreview={promptPreview}
            showPromptPreview={false}
            onOpen={() => setQuestionDrawerOpen(true)}
            onClose={() => setQuestionDrawerOpen(false)}
            onPopOut={() => void handlePopOutPane("questions")}
            onDock={() => undefined}
            onSearchChange={setSearch}
            onTopicFilterChange={setTopicFilter}
            onTypeFilterChange={setTypeFilter}
            onSelectQuestion={(id) => void handleSelectQuestion(id)}
            onCreateQuestion={() => void handleCreateQuestion()}
            onDuplicateQuestion={() =>
              void handleCreateQuestion(selectedIdRef.current ?? undefined)
            }
            onDeleteQuestion={() => void handleDeleteQuestion()}
          />
        ) : null}

        <main className="editor-pane">
          <div className={`editor-main ${editorShouldFill ? "full-width" : ""}`}>
            {draftQuestion ? (
              <>
                <div className="editor-toolbar">
                  <div className="editor-toolbar-primary">
                    <div className="editor-mode-toggle" role="group" aria-label="Editor mode">
                      <button
                        type="button"
                        aria-pressed={editorMode === "form"}
                        className={editorMode === "form" ? "active" : ""}
                        onClick={() => setEditorMode("form")}
                      >
                        Form
                      </button>
                      <button
                        type="button"
                        aria-pressed={editorMode === "json"}
                        className={editorMode === "json" ? "active" : ""}
                        onClick={() => setEditorMode("json")}
                      >
                        Raw JSON
                      </button>
                    </div>
                    <div className="editor-question-actions">
                      {editorMode === "json" ? (
                        <button type="button" onClick={handleFormatRawJson} disabled={loading}>
                          Format JSON
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void handleSaveQuestion()}
                        disabled={loading || !bank || !selectedId || jsonError}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSaveQuestionAsNew()}
                        disabled={loading || !bank || jsonError}
                      >
                        Save as New
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRevertQuestion()}
                        disabled={loading || !selectedId}
                      >
                        Revert
                      </button>
                      <button
                        className="danger-button"
                        onClick={() => void handleDeleteQuestion()}
                        disabled={loading}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="editor-toolbar-meta">
                    <span className="editor-note">
                      {editorMode === "json"
                        ? "Raw JSON edits wait for Save or Save as New. Save Bank writes the `.bok` archive."
                        : "Form edits autosave to the working copy. Save Bank writes the `.bok` archive."}
                    </span>
                    <label className="editor-toggle">
                      <input
                        type="checkbox"
                        checked={mathPreviewEnabled}
                        onChange={(event) => setMathPreviewEnabled(event.target.checked)}
                      />
                      Math Preview
                    </label>
                  </div>
                </div>

                <div className="editor-scroll">
                  {editorMode === "json" ? (
                    <div className="json-editor-shell">
                      {jsonError ? (
                        <div className="json-error-banner">
                          <span>{jsonErrorMessage || "Raw JSON is invalid."}</span>
                          {looksLikeUnescapedLatexInJson(rawJson) ? (
                            <div className="json-latex-helper">
                              <span>
                                This looks like LaTeX pasted into raw JSON with unescaped
                                backslashes. In raw JSON, write \\frac instead of \frac. Form view
                                handles this automatically.
                              </span>
                              <button
                                type="button"
                                onClick={handleEscapeLatexBackslashesInRawJson}
                              >
                                Try escaping LaTeX backslashes
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      <div
                        className={`json-editor-layout ${mathPreviewEnabled ? "with-preview" : ""}`}
                      >
                        <textarea
                          className="json-editor"
                          value={rawJson}
                          spellCheck={false}
                          onChange={(event) => handleRawJsonChange(event.target.value)}
                        />
                        <QuestionMathSummaryPreview
                          question={draftQuestion}
                          previewEnabled={mathPreviewEnabled}
                          invalid={jsonError}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="editor-form">
                  <section className="editor-grid">
                    <label>
                      ID
                      <input
                        value={draftQuestion.id}
                        onChange={(event) => updateDraft("id", event.target.value)}
                      />
                    </label>
                    <label>
                      Type
                      <select
                        value={draftQuestion.type}
                        onChange={(event) =>
                          void updateQuestionType(event.target.value as QuestionType)
                        }
                      >
                        <option value="multiple_choice">multiple_choice</option>
                        <option value="numeric_response">numeric_response</option>
                        <option value="short_answer">short_answer</option>
                        <option value="free_response">free_response</option>
                      </select>
                    </label>
                    <label>
                      Topic
                      <input
                        value={draftQuestion.topic}
                        onChange={(event) => updateDraft("topic", event.target.value)}
                      />
                    </label>
                    <label>
                      Subtopic
                      <input
                        value={draftQuestion.subtopic ?? ""}
                        onChange={(event) => updateDraft("subtopic", event.target.value)}
                      />
                    </label>
                  </section>

                  <details
                    className="metadata-panel"
                    open={metadataExpanded}
                    onToggle={(event) =>
                      setMetadataExpanded((event.currentTarget as HTMLDetailsElement).open)
                    }
                  >
                    <summary>Additional Metadata</summary>
                    <section className="metadata-grid">
                      <label className="compact-stepper">
                        Difficulty
                        <input
                          className="compact-number-input"
                          type="number"
                          min={1}
                          max={5}
                          value={draftQuestion.difficulty}
                          onChange={(event) => updateDraft("difficulty", Number(event.target.value))}
                        />
                      </label>
                      <label className="compact-stepper">
                        Estimated Time
                        <input
                          className="compact-number-input"
                          type="number"
                          min={0}
                          step={5}
                          value={draftQuestion.estimated_time_sec ?? 0}
                          onChange={(event) =>
                            updateDraft("estimated_time_sec", Number(event.target.value))
                          }
                        />
                      </label>
                      <label className="compact-stepper">
                        Points
                        <input
                          className="compact-number-input"
                          type="number"
                          min={0}
                          step="0.5"
                          value={draftQuestion.points ?? 0}
                          onChange={(event) => updateDraft("points", Number(event.target.value))}
                        />
                      </label>
                      <label>
                      Status
                      <input
                        value={draftQuestion.status}
                        onChange={(event) => updateDraft("status", event.target.value)}
                      />
                      </label>
                      <label className="metadata-span-2">
                      Tags
                      <input
                        value={draftQuestion.tags.join(", ")}
                        onChange={(event) =>
                          updateDraft(
                            "tags",
                            event.target.value
                              .split(",")
                              .map((part) => part.trim())
                              .filter(Boolean),
                          )
                        }
                      />
                      </label>
                      <div className="metadata-span-full standards-metadata-field">
                        <div className="standards-metadata-header">
                          <span>Standards</span>
                          <button
                            type="button"
                            onClick={() => void handleOpenQuestionStandardsPicker()}
                          >
                            Edit Standards
                          </button>
                        </div>
                        {draftQuestion.standards.length > 0 ? (
                          <div className="standards-inline-chips">
                            {draftQuestion.standards.map((reference) => {
                              const standard = standardsById[reference.standard_id];
                              return (
                                <span key={reference.standard_id} className="inline-standard-chip">
                                  {standard?.code ?? reference.standard_id}
                                  <button
                                    type="button"
                                    onClick={() => removeStandardFromQuestion(reference.standard_id)}
                                    aria-label={`Remove ${standard?.code ?? reference.standard_id}`}
                                  >
                                    ×
                                  </button>
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="metadata-help-text">
                            No standards attached.
                          </p>
                        )}
                      </div>
                      <label className="metadata-span-full">
                        Teacher Notes
                        <textarea
                          className="teacher-notes-input"
                          value={draftQuestion.teacher_notes ?? ""}
                          onChange={(event) => updateDraft("teacher_notes", event.target.value)}
                        />
                      </label>
                      <label className="metadata-span-full">
                        Uses
                        <input value="Not tracked yet. Exam usage will appear here." readOnly />
                      </label>
                    </section>
                  </details>

                  <MathPreviewField
                    label="Prompt"
                    value={draftQuestion.prompt}
                    previewEnabled={mathPreviewEnabled}
                  >
                    <textarea
                      value={draftQuestion.prompt}
                      onChange={(event) => updateDraft("prompt", event.target.value)}
                    />
                  </MathPreviewField>

                  <section className="asset-section">
                    <input
                      ref={assetInputRef}
                      className="visually-hidden"
                      type="file"
                      accept=".svg,image/*"
                      multiple
                      onChange={(event) => void handleAssetUpload(event.target.files)}
                    />

                    {draftQuestion.assets.length === 0 ? (
                      <div className="asset-empty-row">
                        <div className="asset-empty-copy">
                          <strong>Assets</strong>
                          <p>Add SVG or image assets only when this question needs them.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => assetInputRef.current?.click()}
                          disabled={assetBusy}
                        >
                          {assetBusy ? "Uploading..." : "Add Assets"}
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="asset-section-header">
                          <div>
                            <h2>Attached Assets</h2>
                            <p>Attach one or more SVG or image files to this question.</p>
                          </div>
                          <div className="asset-section-actions">
                            <button
                              type="button"
                              onClick={() => assetInputRef.current?.click()}
                              disabled={assetBusy}
                            >
                              {assetBusy ? "Uploading..." : "Attach Asset"}
                            </button>
                          </div>
                        </div>
                      <div className="asset-list">
                        {draftQuestion.assets.map((asset, index) => {
                          const inspection = assetInspections[index];
                          const svgPlaceholders = inspection?.svg_placeholders ?? [];
                          const svgMarkup = inspection?.rendered_svg;
                          return (
                            <article key={`${asset.path}-${index}`} className="asset-card">
                              <div className="asset-card-header">
                                <div>
                                  <strong>{asset.path.split("/").slice(-1)[0] ?? asset.path}</strong>
                                  <p>{asset.path}</p>
                                </div>
                                <button type="button" onClick={() => removeAsset(index)}>
                                  Remove
                                </button>
                              </div>

                              <div className="asset-meta-row">
                                <label>
                                  Kind
                                  <input value={asset.kind} readOnly />
                                </label>
                                <label>
                                  Stored Path
                                  <input value={asset.path} readOnly />
                                </label>
                              </div>

                              {asset.kind === "svg" ? (
                                <div className="asset-svg-tools">
                                  <div className="asset-variable-list">
                                    <h3>SVG Controls</h3>
                                    {svgPlaceholders.length === 0 ? (
                                      <p className="asset-empty">
                                        No {"{{token}}"} placeholders were found in this SVG.
                                      </p>
                                    ) : (
                                      svgPlaceholders.map((placeholder) => (
                                        <label key={placeholder}>
                                          {placeholder}
                                          <input
                                            value={asset.svg_variables[placeholder] ?? ""}
                                            onChange={(event) =>
                                              updateAsset(index, (currentAsset) => ({
                                                ...currentAsset,
                                                svg_variables: {
                                                  ...currentAsset.svg_variables,
                                                  [placeholder]: event.target.value,
                                                },
                                              }))
                                            }
                                          />
                                        </label>
                                      ))
                                    )}
                                  </div>
                                  <div className="asset-preview-panel">
                                    <h3>Preview</h3>
                                    {svgMarkup ? (
                                      <div
                                        className="asset-svg-preview"
                                        dangerouslySetInnerHTML={{ __html: svgMarkup }}
                                      />
                                    ) : (
                                      <p className="asset-empty">Preview unavailable.</p>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <div className="asset-preview-panel">
                                  <h3>Preview</h3>
                                  <img
                                    className="asset-image-preview"
                                    src={getAssetFileUrl(asset.path)}
                                    alt={asset.path}
                                  />
                                </div>
                              )}
                            </article>
                          );
                        })}
                      </div>
                      </>
                    )}
                  </section>

                  {draftQuestion.type === "multiple_choice" ? (
                    <section className="question-specific">
                      {(() => {
                        const answer =
                          (draftQuestion.answer as MultipleChoiceAnswer | null) ??
                          { choices: ["", ""], correct_choice_index: 0 };
                        const choices = answer.choices ?? ["", ""];
                        const correctChoiceIndices = getCorrectChoiceIndices(answer, choices.length);

                        return (
                          <>
                            <div className="question-section-header">
                              <div>
                                <h2>Multiple Choice</h2>
                                <span className="status-pill">
                                  {correctChoiceIndices.length} correct
                                </span>
                              </div>
                              <button type="button" onClick={() => addMultipleChoiceChoice()}>
                                Add Choice
                              </button>
                            </div>
                            {choices.map((choice, index) => (
                              <div key={index} className="choice-row">
                                <label className="choice-correct-toggle">
                                  <input
                                    type="checkbox"
                                    checked={correctChoiceIndices.includes(index)}
                                    onChange={(event) =>
                                      updateMultipleChoiceCorrectChoice(index, event.target.checked)
                                    }
                                  />
                                  <span>Correct</span>
                                </label>
                                <MathPreviewField
                                  label={`Choice ${index + 1}`}
                                  value={choice}
                                  previewEnabled={mathPreviewEnabled}
                                  preferWholeExpression
                                  className="choice-math-field"
                                >
                                  <input
                                    value={choice}
                                    onChange={(event) =>
                                      updateMultipleChoiceChoice(index, event.target.value)
                                    }
                                  />
                                </MathPreviewField>
                                <button
                                  type="button"
                                  onClick={() => removeMultipleChoiceChoice(index)}
                                  disabled={choices.length <= 2}
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </>
                        );
                      })()}
                      <MathPreviewField
                        label="Explanation"
                        value={draftQuestion.explanation ?? ""}
                        previewEnabled={mathPreviewEnabled}
                        className="longform-math-field"
                      >
                        <textarea
                          value={draftQuestion.explanation ?? ""}
                          onChange={(event) => updateDraft("explanation", event.target.value)}
                        />
                      </MathPreviewField>
                    </section>
                  ) : null}

                  {draftQuestion.type === "numeric_response" ? (
                    <section className="question-specific">
                      <h2>Numeric Response</h2>
                      <label>
                        Answer Value
                        <input
                          type="number"
                          value={Number((draftQuestion.answer as Record<string, unknown>)?.value ?? 0)}
                          onChange={(event) => updateNumericAnswer("value", event.target.value)}
                        />
                      </label>
                      <MathPreviewField
                        label="Unit"
                        value={String((draftQuestion.answer as Record<string, unknown>)?.unit ?? "")}
                        previewEnabled={mathPreviewEnabled}
                      >
                        <input
                          value={String((draftQuestion.answer as Record<string, unknown>)?.unit ?? "")}
                          onChange={(event) => updateNumericAnswer("unit", event.target.value)}
                        />
                      </MathPreviewField>
                      <label>
                        Tolerance
                        <input
                          type="number"
                          step="0.01"
                          value={Number(
                            (draftQuestion.answer as Record<string, unknown>)?.tolerance ?? 0,
                          )}
                          onChange={(event) =>
                            updateNumericAnswer("tolerance", event.target.value)
                          }
                        />
                      </label>
                      <MathPreviewField
                        label="Explanation"
                        value={draftQuestion.explanation ?? ""}
                        previewEnabled={mathPreviewEnabled}
                        className="longform-math-field"
                      >
                        <textarea
                          value={draftQuestion.explanation ?? ""}
                          onChange={(event) => updateDraft("explanation", event.target.value)}
                        />
                      </MathPreviewField>
                    </section>
                  ) : null}

                  {draftQuestion.type === "short_answer" ? (
                    <section className="question-specific">
                      <h2>Short Answer</h2>
                      <MathPreviewField
                        label="Sample Solution"
                        value={draftQuestion.sample_solution ?? ""}
                        previewEnabled={mathPreviewEnabled}
                      >
                        <textarea
                          value={draftQuestion.sample_solution ?? ""}
                          onChange={(event) =>
                            updateDraft("sample_solution", event.target.value)
                          }
                        />
                      </MathPreviewField>
                    </section>
                  ) : null}

                  {draftQuestion.type === "free_response" ? (
                    <section className="question-specific">
                      <h2>Free Response</h2>
                      <MathPreviewField
                        label="Sample Solution"
                        value={draftQuestion.sample_solution ?? ""}
                        previewEnabled={mathPreviewEnabled}
                      >
                        <textarea
                          value={draftQuestion.sample_solution ?? ""}
                          onChange={(event) =>
                            updateDraft("sample_solution", event.target.value)
                          }
                        />
                      </MathPreviewField>
                      <MathPreviewField
                        label="Exemplar Answer"
                        value={draftQuestion.exemplar_answer ?? ""}
                        previewEnabled={mathPreviewEnabled}
                      >
                        <textarea
                          value={draftQuestion.exemplar_answer ?? ""}
                          onChange={(event) =>
                            updateDraft("exemplar_answer", event.target.value)
                          }
                        />
                      </MathPreviewField>
                      <div className="rubric-list">
                        {draftQuestion.rubric.map((row, index) => (
                          <div key={index} className="rubric-row">
                            <MathPreviewField
                              label={`Criterion ${index + 1}`}
                              value={row.criterion}
                              previewEnabled={mathPreviewEnabled}
                              className="rubric-criterion-field"
                            >
                              <input
                                value={row.criterion}
                                onChange={(event) =>
                                  updateRubricRow(index, "criterion", event.target.value)
                                }
                                placeholder="Criterion"
                              />
                            </MathPreviewField>
                            <label className="rubric-points-field">
                              Points
                              <input
                                type="number"
                                step="0.5"
                                value={row.points}
                                onChange={(event) =>
                                  updateRubricRow(index, "points", event.target.value)
                                }
                                placeholder="Points"
                              />
                            </label>
                          </div>
                        ))}
                        <button
                          onClick={() =>
                            updateDraft("rubric", [
                              ...draftQuestion.rubric,
                              { criterion: "", points: 0 },
                            ])
                          }
                        >
                          Add Rubric Row
                        </button>
                      </div>
                    </section>
                  ) : null}
                    </div>
                  )}
                </div>
              </>
          ) : (
            <div className="empty-state">
              <p>Open a bank and select a question to start editing.</p>
            </div>
          )}
          </div>
        </main>

        {!assetPanePoppedOut ? (
          <AssetPane
            open={assetDrawerOpen}
            poppedOut={false}
            hasBank={!!bank}
            search={assetSearch}
            assets={bankAssets}
            selectedQuestionId={selectedId}
            attachedAssetPaths={draftQuestion?.assets.map((asset) => asset.path) ?? []}
            onOpen={() => setAssetDrawerOpen(true)}
            onClose={() => setAssetDrawerOpen(false)}
            onPopOut={() => void handlePopOutPane("assets")}
            onDock={() => undefined}
            onSearchChange={setAssetSearch}
            onAttach={handleAttachExistingAsset}
          />
        ) : null}
      </div>
    </div>
  );
}

export default App;
