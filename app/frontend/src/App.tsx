import { useEffect, useRef, useState } from "react";

import {
  getCurrentBank,
  getQuestion,
  listQuestions,
  openBank,
  openDemoBank,
  saveBank,
  updateQuestion,
} from "./api";
import type {
  BankSummaryModel,
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
  const [statusMessage, setStatusMessage] = useState("Open a .bok file or load the demo bank.");
  const [errorMessage, setErrorMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [autosaveState, setAutosaveState] = useState<AutosaveState>("idle");
  const [workspaceDirty, setWorkspaceDirty] = useState(false);
  const [jsonError, setJsonError] = useState(false);

  const saveTimerRef = useRef<number | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const draftQuestionRef = useRef<QuestionModel | null>(null);
  const rawJsonRef = useRef("");
  const editorModeRef = useRef<EditorMode>("form");
  const draftDirtyRef = useRef(false);
  const isHydratingRef = useRef(false);
  const persistInFlightRef = useRef<Promise<boolean> | null>(null);

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
    void refreshCurrentBank();
  }, []);

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

  async function refreshCurrentBank() {
    try {
      const summary = await getCurrentBank();
      setBank(summary);
      setStatusMessage(`Opened ${summary.manifest.title}`);
      setWorkspaceDirty(false);
    } catch {
      setBank(null);
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
      const parsed = JSON.parse(rawJsonRef.current) as QuestionModel;
      return parsed;
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

        if (reason === "autosave") {
          setStatusMessage(
            `Saved ${savedQuestion.id} to the working copy. Save Bank writes the .bok archive.`,
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
      setErrorMessage("");
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleOpenByPath() {
    if (!openPath.trim()) {
      setErrorMessage("Enter a .bok path to open.");
      return;
    }

    if (!(await persistDraft("open-bank"))) return;

    setLoading(true);
    try {
      const summary = await openBank(openPath.trim());
      setBank(summary);
      setSelectedId(null);
      setWorkspaceDirty(false);
      setAutosaveState("idle");
      setStatusMessage(`Opened ${summary.manifest.title}`);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveBank() {
    setLoading(true);
    try {
      const questionSaved = await persistDraft("save-bank");
      if (!questionSaved) return;

      const response = await saveBank(savePath.trim() || undefined);
      setStatusMessage(`Saved bank to ${response.saved_to}`);
      const summary = await getCurrentBank();
      setBank(summary);
      setWorkspaceDirty(false);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectQuestion(nextId: string) {
    if (nextId === selectedIdRef.current) return;
    if (!(await persistDraft("switch"))) return;
    setSelectedId(nextId);
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
          ? "Working copy saved"
          : autosaveState === "error"
            ? "Working copy save failed"
            : "Working copy up to date";

  const archiveLabel = workspaceDirty
    ? "Bank archive needs Save Bank"
    : "Bank archive up to date";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>Nexzam</h1>
          <p>{bank ? bank.manifest.title : "No bank open"}</p>
        </div>
        <div className="topbar-controls">
          <button onClick={handleOpenDemo} disabled={loading}>
            Open Demo Bank
          </button>
          <input
            value={openPath}
            onChange={(event) => setOpenPath(event.target.value)}
            placeholder="/absolute/path/to/demo-bank.bok"
          />
          <button onClick={handleOpenByPath} disabled={loading}>
            Open .bok Path
          </button>
          <input
            value={savePath}
            onChange={(event) => setSavePath(event.target.value)}
            placeholder="Optional save-as path"
          />
          <button onClick={handleSaveBank} disabled={loading || !bank}>
            Save Bank
          </button>
        </div>
      </header>

      <div className="status-strip">
        <span>{statusMessage}</span>
        <div className="status-pills">
          <span className={`status-pill ${autosaveState}`}>{workingCopyLabel}</span>
          <span className={`status-pill ${workspaceDirty ? "dirty" : "saved"}`}>{archiveLabel}</span>
        </div>
        {errorMessage ? <span className="error-text">{errorMessage}</span> : null}
      </div>

      <div className="workspace">
        <aside className="sidebar">
          <div className="filters">
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
                <span className="editor-note">
                  Question edits autosave to the working copy. Use Save Bank to write the `.bok`.
                </span>
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
