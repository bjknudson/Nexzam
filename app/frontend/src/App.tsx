import { useEffect, useRef, useState } from "react";

import {
  createQuestion,
  deleteQuestion,
  getCurrentBank,
  getAssetFileUrl,
  getQuestion,
  inspectAsset,
  listAssets,
  listQuestions,
  openBank,
  openDemoBank,
  saveBank,
  setApiBaseUrl,
  uploadAsset,
  updateQuestion,
} from "./api";
import {
  getDesktopContext,
  isDesktopShell,
  openBankDialog,
  saveBankDialog,
  setArchiveDirtyInShell,
} from "./desktop";
import type {
  AssetInspectionResponseModel,
  AssetListItemModel,
  AssetModel,
  BankSummaryModel,
  DesktopContext,
  QuestionListItemModel,
  QuestionModel,
  QuestionType,
  RubricRowModel,
} from "./types";

type EditorMode = "form" | "json";
type AutosaveState = "idle" | "dirty" | "saving" | "saved" | "error";
type PersistReason = "autosave" | "switch" | "save-bank" | "open-bank";

const AUTOSAVE_DELAY_MS = 700;

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

function App() {
  const desktopMode = isDesktopShell();

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
  const [assetInspections, setAssetInspections] = useState<AssetInspectionResponseModel[]>([]);
  const [bankAssets, setBankAssets] = useState<AssetListItemModel[]>([]);
  const [assetBusy, setAssetBusy] = useState(false);

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
      void refreshCurrentBank();
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
        await refreshCurrentBank();
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
  }, [desktopMode]);

  useEffect(() => {
    if (!bank) return;
    void refreshQuestionList();
  }, [bank, search, topicFilter, typeFilter]);

  useEffect(() => {
    if (!selectedId) {
      isHydratingRef.current = true;
      setDraftQuestion(null);
      setRawJson("");
      draftDirtyRef.current = false;
      setAutosaveState("idle");
      isHydratingRef.current = false;
      return;
    }

    void loadQuestion(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (
      !selectedId ||
      !draftQuestion ||
      !draftDirtyRef.current ||
      isHydratingRef.current ||
      (editorMode === "json" && jsonError)
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
  }, [selectedId, draftQuestion, rawJson, editorMode, jsonError]);

  useEffect(() => {
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
  }, [draftQuestion]);

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
    } catch {
      setBank(null);
      setBankAssets([]);
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

  async function loadQuestion(questionId: string) {
    try {
      isHydratingRef.current = true;
      const question = await getQuestion(questionId);
      draftDirtyRef.current = false;
      setDraftQuestion(question);
      setRawJson(JSON.stringify(question, null, 2));
      setAutosaveState("idle");
      setJsonError(false);
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
    isHydratingRef.current = false;
  }

  function getPersistPayload(): QuestionModel | null {
    if (!selectedIdRef.current) return null;
    if (editorModeRef.current === "json") {
      if (jsonError) {
        throw new Error("Raw JSON is invalid. Fix it before switching questions or saving the bank.");
      }
      return JSON.parse(rawJsonRef.current) as QuestionModel;
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

        if (reason === "autosave") {
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
      setWorkspaceDirty(false);
      setAutosaveState("idle");
      setStatusMessage(`Opened ${summary.manifest.title}`);
      await refreshAssetList();
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
      setWorkspaceDirty(false);
      setAutosaveState("idle");
      setStatusMessage(`Opened demo bank from ${summary.source_path}`);
      await refreshAssetList();
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

  async function handleSelectQuestion(nextId: string) {
    if (nextId === selectedIdRef.current) return;
    if (!(await persistDraft("switch"))) return;
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
      const parsed = JSON.parse(value) as QuestionModel;
      setJsonError(false);
      draftQuestionRef.current = parsed;
      setDraftQuestion(parsed);
      setErrorMessage("");
    } catch {
      setJsonError(true);
      setErrorMessage("Raw JSON is invalid. Fix it before switching questions or saving the bank.");
    }
  }

  function updateQuestionType(nextType: QuestionType) {
    const base = draftQuestionRef.current ?? emptyQuestion();
    const next: QuestionModel = {
      ...base,
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
    const answer = (draftQuestionRef.current?.answer as {
      choices?: string[];
      correct_choice_index?: number;
    }) ?? { choices: ["", ""], correct_choice_index: 0 };
    const choices = [...(answer.choices ?? ["", ""])];
    choices[index] = value;
    updateDraft("answer", {
      ...answer,
      choices,
      correct_choice_index: answer.correct_choice_index ?? 0,
    });
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

      <div className="workspace">
        <aside className="sidebar">
          <div className="filters">
            <div className="question-actions">
              <button onClick={() => void handleCreateQuestion()} disabled={loading || !bank}>
                New Blank
              </button>
              <button
                onClick={() => void handleCreateQuestion(selectedIdRef.current ?? undefined)}
                disabled={loading || !selectedId}
              >
                Duplicate
              </button>
              <button
                className="danger-button"
                onClick={() => void handleDeleteQuestion()}
                disabled={loading || !selectedId}
              >
                Delete
              </button>
            </div>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search text"
            />
            <select value={topicFilter} onChange={(event) => setTopicFilter(event.target.value)}>
              <option value="">All topics</option>
              {availableTopics.map((topic) => (
                <option key={topic} value={topic}>
                  {topic}
                </option>
              ))}
            </select>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="">All types</option>
              {availableTypes.map((questionType) => (
                <option key={questionType} value={questionType}>
                  {questionType}
                </option>
              ))}
            </select>
          </div>

          <div className="question-list">
            {questionItems.map((item) => (
              <button
                key={item.id}
                className={`question-row ${selectedId === item.id ? "selected" : ""}`}
                onClick={() => void handleSelectQuestion(item.id)}
              >
                <strong>{item.id}</strong>
                <span>{item.topic}</span>
                <span>{item.type}</span>
                <span>Difficulty {item.difficulty}</span>
                <span>{item.status}</span>
              </button>
            ))}
          </div>
        </aside>

        <main className="editor-pane">
          {bank ? (
            <section className="bank-assets-panel">
              <div className="bank-assets-header">
                <div>
                  <h2>Bank Assets</h2>
                  <p>Browse uploaded SVGs and images across the open bank.</p>
                </div>
                <span className="bank-assets-count">
                  {bankAssets.length} asset{bankAssets.length === 1 ? "" : "s"}
                </span>
              </div>

              {bankAssets.length === 0 ? (
                <p className="asset-empty">No assets are stored in this bank yet.</p>
              ) : (
                <div className="bank-asset-grid">
                  {bankAssets.map((asset) => {
                    const attachedToCurrent = !!draftQuestion?.assets.some(
                      (attached) => attached.path === asset.path,
                    );

                    return (
                      <article key={asset.path} className="bank-asset-tile">
                        <div className="bank-asset-thumb">
                          {asset.kind === "svg" ? (
                            <img src={getAssetFileUrl(asset.path)} alt={asset.path} />
                          ) : (
                            <img src={getAssetFileUrl(asset.path)} alt={asset.path} />
                          )}
                        </div>
                        <div className="bank-asset-body">
                          <strong>{asset.path.split("/").slice(-1)[0] ?? asset.path}</strong>
                          <p>{asset.path}</p>
                          <div className="bank-asset-badges">
                            <span className="asset-badge">{asset.kind}</span>
                            <span className="asset-badge">
                              Used by {asset.referenced_by.length} question
                              {asset.referenced_by.length === 1 ? "" : "s"}
                            </span>
                            {asset.kind === "svg" ? (
                              <span className="asset-badge">
                                {asset.svg_placeholders.length} variable
                                {asset.svg_placeholders.length === 1 ? "" : "s"}
                              </span>
                            ) : null}
                          </div>
                          {asset.referenced_by.length > 0 ? (
                            <p className="bank-asset-refs">
                              {asset.referenced_by.join(", ")}
                            </p>
                          ) : (
                            <p className="bank-asset-refs">Unused</p>
                          )}
                          {draftQuestion ? (
                            <button
                              type="button"
                              onClick={() => handleAttachExistingAsset(asset)}
                              disabled={attachedToCurrent}
                            >
                              {attachedToCurrent ? "Attached" : "Attach to Question"}
                            </button>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          ) : null}

          {draftQuestion ? (
            <>
              <div className="editor-toolbar">
                <div className="editor-mode-toggle">
                  <button
                    className={editorMode === "form" ? "active" : ""}
                    onClick={() => setEditorMode("form")}
                  >
                    Form
                  </button>
                  <button
                    className={editorMode === "json" ? "active" : ""}
                    onClick={() => setEditorMode("json")}
                  >
                    Raw JSON
                  </button>
                </div>
                <div className="editor-toolbar-meta">
                  <span className="editor-note">
                    Question edits autosave to the working copy. Save Bank writes the `.bok` archive.
                  </span>
                  <button
                    className="danger-button"
                    onClick={() => void handleDeleteQuestion()}
                    disabled={loading}
                  >
                    Delete Question
                  </button>
                </div>
              </div>

              {editorMode === "json" ? (
                <textarea
                  className="json-editor"
                  value={rawJson}
                  onChange={(event) => handleRawJsonChange(event.target.value)}
                />
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
                        onChange={(event) => updateQuestionType(event.target.value as QuestionType)}
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
                    <label>
                      Difficulty
                      <input
                        type="number"
                        min={1}
                        max={5}
                        value={draftQuestion.difficulty}
                        onChange={(event) => updateDraft("difficulty", Number(event.target.value))}
                      />
                    </label>
                    <label>
                      Status
                      <input
                        value={draftQuestion.status}
                        onChange={(event) => updateDraft("status", event.target.value)}
                      />
                    </label>
                    <label>
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
                    <label>
                      Standards
                      <input
                        value={draftQuestion.standards.join(", ")}
                        onChange={(event) =>
                          updateDraft(
                            "standards",
                            event.target.value
                              .split(",")
                              .map((part) => part.trim())
                              .filter(Boolean),
                          )
                        }
                      />
                    </label>
                    <label>
                      Estimated Time (sec)
                      <input
                        type="number"
                        value={draftQuestion.estimated_time_sec ?? 0}
                        onChange={(event) =>
                          updateDraft("estimated_time_sec", Number(event.target.value))
                        }
                      />
                    </label>
                    <label>
                      Points
                      <input
                        type="number"
                        step="0.5"
                        value={draftQuestion.points ?? 0}
                        onChange={(event) => updateDraft("points", Number(event.target.value))}
                      />
                    </label>
                  </section>

                  <label>
                    Prompt
                    <textarea
                      value={draftQuestion.prompt}
                      onChange={(event) => updateDraft("prompt", event.target.value)}
                    />
                  </label>

                  <label>
                    Teacher Notes
                    <textarea
                      value={draftQuestion.teacher_notes ?? ""}
                      onChange={(event) => updateDraft("teacher_notes", event.target.value)}
                    />
                  </label>

                  <section className="asset-section">
                    <div className="asset-section-header">
                      <div>
                        <h2>Attached Assets</h2>
                        <p>Attach one or more SVG or image files to this question.</p>
                      </div>
                      <div className="asset-section-actions">
                        <input
                          ref={assetInputRef}
                          className="visually-hidden"
                          type="file"
                          accept=".svg,image/*"
                          multiple
                          onChange={(event) => void handleAssetUpload(event.target.files)}
                        />
                        <button
                          type="button"
                          onClick={() => assetInputRef.current?.click()}
                          disabled={assetBusy}
                        >
                          {assetBusy ? "Uploading..." : "Attach Asset"}
                        </button>
                      </div>
                    </div>

                    {draftQuestion.assets.length === 0 ? (
                      <p className="asset-empty">
                        No assets attached. SVG templates expose editable controls automatically.
                      </p>
                    ) : (
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
                    )}
                  </section>

                  {draftQuestion.type === "multiple_choice" ? (
                    <section className="question-specific">
                      <h2>Multiple Choice</h2>
                      {(((draftQuestion.answer as { choices?: string[] })?.choices ?? ["", ""]) as string[]).map(
                        (choice, index) => (
                          <label key={index}>
                            Choice {index + 1}
                            <input
                              value={choice}
                              onChange={(event) =>
                                updateMultipleChoiceChoice(index, event.target.value)
                              }
                            />
                          </label>
                        ),
                      )}
                      <label>
                        Correct Choice Index
                        <input
                          type="number"
                          min={0}
                          value={
                            ((draftQuestion.answer as { correct_choice_index?: number })
                              ?.correct_choice_index ?? 0)
                          }
                          onChange={(event) =>
                            updateDraft("answer", {
                              ...(draftQuestion.answer as Record<string, unknown>),
                              correct_choice_index: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label>
                        Explanation
                        <textarea
                          value={draftQuestion.explanation ?? ""}
                          onChange={(event) => updateDraft("explanation", event.target.value)}
                        />
                      </label>
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
                      <label>
                        Unit
                        <input
                          value={String((draftQuestion.answer as Record<string, unknown>)?.unit ?? "")}
                          onChange={(event) => updateNumericAnswer("unit", event.target.value)}
                        />
                      </label>
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
                      <label>
                        Explanation
                        <textarea
                          value={draftQuestion.explanation ?? ""}
                          onChange={(event) => updateDraft("explanation", event.target.value)}
                        />
                      </label>
                    </section>
                  ) : null}

                  {draftQuestion.type === "short_answer" ? (
                    <section className="question-specific">
                      <h2>Short Answer</h2>
                      <label>
                        Sample Solution
                        <textarea
                          value={draftQuestion.sample_solution ?? ""}
                          onChange={(event) =>
                            updateDraft("sample_solution", event.target.value)
                          }
                        />
                      </label>
                    </section>
                  ) : null}

                  {draftQuestion.type === "free_response" ? (
                    <section className="question-specific">
                      <h2>Free Response</h2>
                      <label>
                        Sample Solution
                        <textarea
                          value={draftQuestion.sample_solution ?? ""}
                          onChange={(event) =>
                            updateDraft("sample_solution", event.target.value)
                          }
                        />
                      </label>
                      <label>
                        Exemplar Answer
                        <textarea
                          value={draftQuestion.exemplar_answer ?? ""}
                          onChange={(event) =>
                            updateDraft("exemplar_answer", event.target.value)
                          }
                        />
                      </label>
                      <div className="rubric-list">
                        {draftQuestion.rubric.map((row, index) => (
                          <div key={index} className="rubric-row">
                            <input
                              value={row.criterion}
                              onChange={(event) =>
                                updateRubricRow(index, "criterion", event.target.value)
                              }
                              placeholder="Criterion"
                            />
                            <input
                              type="number"
                              step="0.5"
                              value={row.points}
                              onChange={(event) =>
                                updateRubricRow(index, "points", event.target.value)
                              }
                              placeholder="Points"
                            />
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
            </>
          ) : (
            <div className="empty-state">
              <p>Open a bank and select a question to start editing.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
