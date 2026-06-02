import { useEffect, useRef, useState } from "react";

import {
  listQuestionImports,
  promoteQuestionImport,
  stageQuestionImport,
  updateQuestionImportRow,
} from "./api";
import type { QuestionImportRowModel, QuestionImportStageModel } from "./types";

type RowFilter = "all" | "valid" | "invalid" | "selected" | "promoted";

const QUESTION_IMPORT_JSON_TEMPLATE = JSON.stringify(
  [
    {
      id: "q_mc_example_001",
      type: "multiple_choice",
      topic: "Algebra",
      difficulty: 1,
      prompt: "Which expression is equivalent to $2(x + 3)$?",
      subtopic: "Distributive property",
      tags: ["algebra", "expressions"],
      standards: [{ standard_id: "STANDARD-ID-1" }],
      estimated_time_sec: 45,
      points: 1,
      status: "draft",
      teacher_notes: "Replace the example standard id or remove standards if not needed.",
      answer: {
        choices: ["2x + 3", "2x + 6", "x + 6", "2x - 6"],
        correct_choice_index: 1,
      },
      explanation: "Distribute 2 to both terms inside the parentheses.",
      rubric: [],
      sample_solution: null,
      exemplar_answer: null,
      assets: [],
    },
    {
      id: "q_ms_example_001",
      type: "multiple_choice",
      topic: "Algebra",
      difficulty: 2,
      prompt: "Which two expressions are equivalent to $x + x + 4$?",
      tags: ["algebra", "equivalent expressions"],
      standards: [],
      estimated_time_sec: 60,
      points: 1,
      status: "draft",
      teacher_notes: null,
      answer: {
        choices: ["2x + 4", "x + 4", "4 + 2x", "2x"],
        correct_choice_indices: [0, 2],
      },
      explanation: "Combining like terms gives $2x + 4$, and addition is commutative.",
      rubric: [],
      sample_solution: null,
      exemplar_answer: null,
      assets: [],
    },
  ],
  null,
  2,
);

const QUESTION_IMPORT_CSV_TEMPLATE = [
  "id,type,topic,difficulty,prompt,tags,standards,estimated_time_sec,points,status,teacher_notes,explanation,sample_solution,answer_json,rubric_json,assets_json",
  'q_mc_example_001,multiple_choice,Algebra,1,"Which expression is equivalent to $2(x + 3)$?","algebra;expressions",STANDARD-ID-1,45,1,draft,"Replace or remove the example standard id.","Distribute 2 to both terms.",,"{""choices"":[""2x + 3"",""2x + 6"",""x + 6"",""2x - 6""],""correct_choice_index"":1}",[],[]',
  'q_num_example_001,numeric_response,Geometry,1,"What is the area of a rectangle with width 3 and height 4?",area,,45,1,draft,,,"12 square units","{""value"":12,""unit"":""square units"",""tolerance"":0}",[],[]',
].join("\n");

interface QuestionImportWorkspaceProps {
  open: boolean;
  hasBank: boolean;
  onClose: () => void;
  onWorkspaceChanged: (message: string, promotedQuestionIds?: string[]) => void;
}

function countRows(stage: QuestionImportStageModel, status: "valid" | "invalid" | "promoted") {
  return stage.rows.filter((row) => row.status === status).length;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getRowLabel(row: QuestionImportRowModel) {
  return [
    row.row_id,
    String(row.question.type ?? "unknown"),
    String(row.question.topic ?? "missing topic"),
    row.proposed_id ?? row.imported_id ?? "no id",
    row.status,
  ].join(" ");
}

function downloadTemplateFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function QuestionImportWorkspace({
  open,
  hasBank,
  onClose,
  onWorkspaceChanged,
}: QuestionImportWorkspaceProps) {
  const [imports, setImports] = useState<QuestionImportStageModel[]>([]);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [rowFilter, setRowFilter] = useState<RowFilter>("all");
  const [rowSearch, setRowSearch] = useState("");
  const [rowJson, setRowJson] = useState("");
  const [rowJsonError, setRowJsonError] = useState("");
  const [idPolicy, setIdPolicy] = useState<"auto" | "keep_imported">("auto");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedImport = imports.find((item) => item.id === selectedImportId) ?? imports[0] ?? null;
  const selectedRow = selectedImport?.rows.find((row) => row.row_id === selectedRowId) ?? null;
  const selectedValidRows = (selectedImport?.rows ?? []).filter(
    (row) => row.status === "valid" && row.selected,
  );
  const filteredRows = (selectedImport?.rows ?? []).filter((row) => {
    if (rowFilter === "valid" && row.status !== "valid") return false;
    if (rowFilter === "invalid" && row.status !== "invalid") return false;
    if (rowFilter === "promoted" && row.status !== "promoted") return false;
    if (rowFilter === "selected" && !row.selected) return false;

    const needle = rowSearch.trim().toLowerCase();
    return !needle || getRowLabel(row).toLowerCase().includes(needle);
  });

  async function refreshImports() {
    if (!open || !hasBank) return;

    setBusy(true);
    try {
      const response = await listQuestionImports();
      setImports(response.items);
      if (!selectedImportId && response.items.length > 0) {
        setSelectedImportId(response.items[0].id);
      }
      setErrorMessage("");
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refreshImports();
  }, [open, hasBank]);

  useEffect(() => {
    if (!selectedImport) {
      setSelectedImportId(null);
      setSelectedRowId(null);
      return;
    }

    if (!selectedImportId) {
      setSelectedImportId(selectedImport.id);
    }

    if (!selectedRowId || !selectedImport.rows.some((row) => row.row_id === selectedRowId)) {
      setSelectedRowId(selectedImport.rows[0]?.row_id ?? null);
    }
  }, [selectedImport, selectedImportId, selectedRowId]);

  useEffect(() => {
    if (!selectedRow) {
      setRowJson("");
      setRowJsonError("");
      return;
    }

    setRowJson(JSON.stringify(selectedRow.question, null, 2));
    setRowJsonError("");
  }, [selectedRow]);

  async function handleStageImport() {
    if (!importFile) {
      setErrorMessage("Choose a JSON or CSV file.");
      return;
    }

    setBusy(true);
    try {
      const stage = await stageQuestionImport(importFile);
      setImports((current) => [stage, ...current.filter((item) => item.id !== stage.id)]);
      setSelectedImportId(stage.id);
      setSelectedRowId(stage.rows[0]?.row_id ?? null);
      setImportFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      const validCount = countRows(stage, "valid");
      const invalidCount = countRows(stage, "invalid");
      const message = `Staged ${stage.rows.length} rows from ${stage.source_filename}. ${validCount} valid, ${invalidCount} invalid.`;
      setStatusMessage(message);
      setErrorMessage("");
      onWorkspaceChanged(message);
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveRowJson() {
    if (!selectedImport || !selectedRow) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(rowJson);
    } catch (error) {
      setRowJsonError((error as Error).message);
      return;
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      setRowJsonError("Staged row JSON must be one question object.");
      return;
    }

    setBusy(true);
    try {
      const updatedStage = await updateQuestionImportRow({
        importId: selectedImport.id,
        rowId: selectedRow.row_id,
        question: parsed as Record<string, unknown>,
      });
      setImports((current) =>
        current.map((stage) => (stage.id === updatedStage.id ? updatedStage : stage)),
      );
      const updatedRow = updatedStage.rows.find((row) => row.row_id === selectedRow.row_id);
      setRowJson(JSON.stringify(updatedRow?.question ?? parsed, null, 2));
      const message = `Updated ${selectedRow.row_id} in ${updatedStage.source_filename}.`;
      setStatusMessage(message);
      setErrorMessage("");
      setRowJsonError("");
      onWorkspaceChanged(message);
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleRowSelected(row: QuestionImportRowModel) {
    if (!selectedImport || row.status === "promoted") return;

    setBusy(true);
    try {
      const updatedStage = await updateQuestionImportRow({
        importId: selectedImport.id,
        rowId: row.row_id,
        question: row.question,
        selected: !row.selected,
      });
      setImports((current) =>
        current.map((stage) => (stage.id === updatedStage.id ? updatedStage : stage)),
      );
      setErrorMessage("");
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handlePromoteSelectedRows() {
    if (!selectedImport) return;
    if (selectedValidRows.length === 0) {
      setErrorMessage("Select at least one valid staged row to promote.");
      return;
    }

    setBusy(true);
    try {
      const response = await promoteQuestionImport({
        importId: selectedImport.id,
        row_ids: selectedValidRows.map((row) => row.row_id),
        id_policy: idPolicy,
      });
      setImports((current) =>
        current.map((stage) => (stage.id === response.stage.id ? response.stage : stage)),
      );
      setSelectedRowId(response.stage.rows.find((row) => row.status === "valid")?.row_id ?? null);
      const message = `Promoted ${response.promoted_count} questions from ${response.stage.source_filename}.`;
      setStatusMessage(message);
      setErrorMessage("");
      onWorkspaceChanged(message, response.promoted_question_ids);
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <section className="question-import-workspace">
      <header className="question-import-header">
        <div>
          <h2>Question Imports</h2>
          <div className="question-import-summary">
            <span className="status-pill">{imports.length} staged imports</span>
            <span className="status-pill">
              {imports.reduce((total, item) => total + item.rows.length, 0)} staged rows
            </span>
          </div>
        </div>
        <div className="question-import-actions">
          <button type="button" onClick={() => void refreshImports()} disabled={busy || !hasBank}>
            Refresh
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </header>

      <div className="question-import-stage-panel">
        <label>
          Import File
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.csv,application/json,text/csv"
            disabled={busy || !hasBank}
            onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <div className="question-import-template-actions">
          <button
            type="button"
            onClick={() =>
              downloadTemplateFile(
                "nexzam-question-import-template.json",
                `${QUESTION_IMPORT_JSON_TEMPLATE}\n`,
                "application/json",
              )
            }
          >
            Download JSON Template
          </button>
          <button
            type="button"
            onClick={() =>
              downloadTemplateFile(
                "nexzam-question-import-template.csv",
                `${QUESTION_IMPORT_CSV_TEMPLATE}\n`,
                "text/csv",
              )
            }
          >
            Download CSV Template
          </button>
        </div>
        <button type="button" onClick={() => void handleStageImport()} disabled={busy || !hasBank}>
          {busy ? "Working..." : "Stage Import"}
        </button>
      </div>

      {statusMessage ? <div className="question-import-status">{statusMessage}</div> : null}
      {errorMessage ? <div className="json-error-banner">{errorMessage}</div> : null}

      <div className="question-import-list">
        {imports.map((stage) => {
          const validCount = countRows(stage, "valid");
          const invalidCount = countRows(stage, "invalid");
          const promotedCount = countRows(stage, "promoted");

          return (
            <article
              key={stage.id}
              className={`question-import-card ${selectedImport?.id === stage.id ? "selected" : ""}`}
            >
              <div className="question-import-card-header">
                <div>
                  <strong>{stage.source_filename}</strong>
                  <span>{formatDate(stage.created_at)}</span>
                </div>
                <span>{stage.rows.length} rows</span>
              </div>

              <div className="question-import-badges">
                <span className="status-pill saved">{validCount} valid</span>
                <span className={`status-pill ${invalidCount > 0 ? "error" : ""}`}>
                  {invalidCount} invalid
                </span>
                <span className="status-pill">{promotedCount} promoted</span>
              </div>

              <button type="button" onClick={() => setSelectedImportId(stage.id)}>
                Review Rows
              </button>
            </article>
          );
        })}
      </div>

      {selectedImport ? (
        <div className="question-import-review">
          <section className="question-import-table-panel">
            <div className="question-import-review-header">
              <div>
                <h3>{selectedImport.source_filename}</h3>
                <span>{filteredRows.length} visible rows</span>
              </div>
              <div className="question-import-filter-row">
                <select
                  value={idPolicy}
                  onChange={(event) =>
                    setIdPolicy(event.target.value as "auto" | "keep_imported")
                  }
                >
                  <option value="auto">Auto IDs</option>
                  <option value="keep_imported">Keep Imported IDs</option>
                </select>
                <select
                  value={rowFilter}
                  onChange={(event) => setRowFilter(event.target.value as RowFilter)}
                >
                  <option value="all">All rows</option>
                  <option value="valid">Valid</option>
                  <option value="invalid">Invalid</option>
                  <option value="selected">Selected</option>
                  <option value="promoted">Promoted</option>
                </select>
                <input
                  value={rowSearch}
                  onChange={(event) => setRowSearch(event.target.value)}
                  placeholder="Search staged rows"
                />
                <button
                  type="button"
                  onClick={() => void handlePromoteSelectedRows()}
                  disabled={busy || selectedValidRows.length === 0}
                >
                  Promote Selected
                </button>
              </div>
            </div>

            <div className="question-import-row-list">
              {filteredRows.map((row) => (
                <div
                  key={row.row_id}
                  className={`question-import-row ${row.status} ${
                    selectedRowId === row.row_id ? "selected" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void handleToggleRowSelected(row)}
                    disabled={busy || row.status !== "valid"}
                  >
                    {row.selected ? "Selected" : "Select"}
                  </button>
                  <button type="button" onClick={() => setSelectedRowId(row.row_id)}>
                    {row.row_id}
                  </button>
                  <span>{String(row.question.type ?? "unknown")}</span>
                  <span>{String(row.question.topic ?? "missing topic")}</span>
                  <span>{row.proposed_id ?? row.imported_id ?? "no id"}</span>
                  <span>{row.status}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="question-import-detail-panel">
            {selectedRow ? (
              <>
                <div className="question-import-review-header">
                  <div>
                    <h3>{selectedRow.row_id}</h3>
                    <span>{selectedRow.status}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleSaveRowJson()}
                    disabled={busy || selectedRow.status === "promoted"}
                  >
                    Save Row JSON
                  </button>
                </div>

                {selectedRow.issues.length > 0 ? (
                  <div className="question-import-issues">
                    {selectedRow.issues.map((issue, index) => (
                      <div
                        key={`${issue.code}-${index}`}
                        className={issue.severity === "warning" ? "warning" : ""}
                      >
                        <strong>
                          {issue.severity === "warning" ? "warning" : "error"}: {issue.code}
                        </strong>
                        <span>{issue.message}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {rowJsonError ? <div className="json-error-banner">{rowJsonError}</div> : null}
                <textarea
                  className="question-import-json-editor"
                  value={rowJson}
                  spellCheck={false}
                  disabled={selectedRow.status === "promoted"}
                  onChange={(event) => setRowJson(event.target.value)}
                />
              </>
            ) : (
              <div className="question-import-empty">Select a staged row to review.</div>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}
