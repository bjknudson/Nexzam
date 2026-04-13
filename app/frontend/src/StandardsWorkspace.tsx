import { useEffect, useMemo, useRef, useState } from "react";

import {
  attachStandardToCourse,
  detachStandardFromCourse,
  importStandards,
  listCourses,
  listSourceStandardLists,
  listStandards,
  upsertCourse,
} from "./api";
import type { CourseModel, SourceStandardListModel, StandardRecordModel } from "./types";

const PANE_SYNC_CHANNEL = "nexzam-pane-sync";

type StandardsWorkspaceMode = "workspace" | "picker";

interface QuestionStandardsSnapshot {
  questionId: string | null;
  attachedStandardIds: string[];
}

function normalizeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface StandardsWorkspaceProps {
  showCloseHint?: boolean;
}

export default function StandardsWorkspace({
  showCloseHint = false,
}: StandardsWorkspaceProps) {
  const mode =
    (new URLSearchParams(window.location.search).get("mode") as StandardsWorkspaceMode | null) ??
    "workspace";
  const pickerMode = mode === "picker";
  const [sourceLists, setSourceLists] = useState<SourceStandardListModel[]>([]);
  const [standards, setStandards] = useState<StandardRecordModel[]>([]);
  const [courses, setCourses] = useState<CourseModel[]>([]);
  const [selectedSourceListId, setSelectedSourceListId] = useState("");
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [sourceSearch, setSourceSearch] = useState("");
  const [courseSearch, setCourseSearch] = useState("");
  const [courseDraftId, setCourseDraftId] = useState("");
  const [courseDraftTitle, setCourseDraftTitle] = useState("");
  const [courseDraftDescription, setCourseDraftDescription] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importSourceListId, setImportSourceListId] = useState("");
  const [importTitle, setImportTitle] = useState("");
  const [importIssuer, setImportIssuer] = useState("");
  const [importSubject, setImportSubject] = useState("");
  const [importVersion, setImportVersion] = useState("");
  const [importDescription, setImportDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Load or import standards to begin.");
  const [errorMessage, setErrorMessage] = useState("");
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [showSourceDrawer, setShowSourceDrawer] = useState(false);
  const [showSourceListsPanel, setShowSourceListsPanel] = useState(false);
  const [questionStandardsState, setQuestionStandardsState] = useState<QuestionStandardsSnapshot>({
    questionId: null,
    attachedStandardIds: [],
  });

  const channelRef = useRef<BroadcastChannel | null>(null);

  async function refreshData() {
    setLoading(true);
    try {
      const [sourceListResponse, standardsResponse, coursesResponse] = await Promise.all([
        listSourceStandardLists(),
        listStandards(),
        listCourses(),
      ]);
      setSourceLists(sourceListResponse.items);
      setStandards(standardsResponse.items);
      setCourses(coursesResponse.items);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshData();
  }, []);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    if (!channelRef.current) {
      channelRef.current = new BroadcastChannel(PANE_SYNC_CHANNEL);
    }

    const channel = channelRef.current;
    channel.onmessage = (
      event: MessageEvent<
        | { type?: string }
        | { type: "question-standards-state"; state: QuestionStandardsSnapshot }
      >,
    ) => {
      if (event.data?.type === "standards-data-changed") {
        void refreshData();
        return;
      }

      if (event.data?.type === "question-standards-state" && "state" in event.data) {
        setQuestionStandardsState(event.data.state);
      }
    };

    return () => {
      channel.onmessage = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      channelRef.current?.close();
      channelRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!pickerMode) return;
    channelRef.current?.postMessage({ type: "request-question-standards-state" });
  }, [pickerMode]);

  useEffect(() => {
    if (!selectedCourseId) {
      setCourseDraftId("");
      setCourseDraftTitle("");
      setCourseDraftDescription("");
      return;
    }

    const course = courses.find((item) => item.id === selectedCourseId);
    if (!course) return;
    setCourseDraftId(course.id);
    setCourseDraftTitle(course.title);
    setCourseDraftDescription(course.description ?? "");
  }, [courses, selectedCourseId]);

  useEffect(() => {
    if (pickerMode) return;
    if (selectedCourseId) return;
    if (courses.length === 0) return;
    setSelectedCourseId(courses[0].id);
  }, [courses, pickerMode, selectedCourseId]);

  useEffect(() => {
    if (!importTitle.trim()) return;
    if (importSourceListId.trim()) return;
    setImportSourceListId(normalizeId(importTitle));
  }, [importTitle, importSourceListId]);

  const selectedCourse = courses.find((course) => course.id === selectedCourseId) ?? null;
  const selectedCourseStandardIds = new Set(
    selectedCourse?.standard_refs.map((reference) => reference.standard_id) ?? [],
  );
  const selectedQuestionStandardIds = new Set(questionStandardsState.attachedStandardIds);
  const standardsById = useMemo(
    () => Object.fromEntries(standards.map((standard) => [standard.id, standard])),
    [standards],
  );

  const filteredSourceStandards = useMemo(() => {
    const needle = sourceSearch.trim().toLowerCase();
    return standards.filter((standard) => {
      if (selectedSourceListId && standard.source_list_id !== selectedSourceListId) {
        return false;
      }
      if (!needle) return true;
      const haystack = [
        standard.id,
        standard.code,
        standard.statement,
        standard.subject ?? "",
        standard.grade_band ?? "",
        standard.tags.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [selectedSourceListId, sourceSearch, standards]);

  const curatedStandards = useMemo(() => {
    if (!selectedCourse) return [];

    const needle = courseSearch.trim().toLowerCase();
    return selectedCourse.standard_refs
      .map((reference) => standardsById[reference.standard_id])
      .filter((standard): standard is StandardRecordModel => Boolean(standard))
      .filter((standard) => {
        if (!needle) return true;
        const haystack = [
          standard.id,
          standard.code,
          standard.statement,
          standard.subject ?? "",
          standard.grade_band ?? "",
          standard.tags.join(" "),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(needle);
      });
  }, [courseSearch, selectedCourse, standardsById]);

  async function handleSaveCourse() {
    const nextCourseId = courseDraftId.trim();
    if (!nextCourseId || !courseDraftTitle.trim()) {
      setErrorMessage("Course id and title are required.");
      return;
    }

    setBusy(true);
    try {
      const saved = await upsertCourse(nextCourseId, {
        title: courseDraftTitle,
        description: courseDraftDescription || null,
        standard_refs: selectedCourse?.standard_refs ?? [],
      });
      setSelectedCourseId(saved.id);
      setStatusMessage(`Saved course ${saved.id}.`);
      channelRef.current?.postMessage({ type: "standards-data-changed" });
      await refreshData();
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleCourseStandard(standardId: string) {
    if (!selectedCourse) {
      setErrorMessage("Select or create a course before curating standards.");
      return;
    }

    setBusy(true);
    try {
      if (selectedCourseStandardIds.has(standardId)) {
        await detachStandardFromCourse(selectedCourse.id, standardId);
        setStatusMessage(`Removed ${standardId} from ${selectedCourse.id}.`);
      } else {
        await attachStandardToCourse(selectedCourse.id, standardId);
        setStatusMessage(`Added ${standardId} to ${selectedCourse.id}.`);
      }
      channelRef.current?.postMessage({ type: "standards-data-changed" });
      await refreshData();
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleImportStandards() {
    if (!importFile) {
      setErrorMessage("Choose a JSON or CSV file to import.");
      return;
    }

    setBusy(true);
    try {
      const response = await importStandards({
        file: importFile,
        source_list_id: importSourceListId || undefined,
        title: importTitle || undefined,
        issuer: importIssuer || undefined,
        subject: importSubject || undefined,
        version: importVersion || undefined,
        description: importDescription || undefined,
      });
      setStatusMessage(
        `Imported ${response.imported_count} standards into ${response.source_list.title}.`,
      );
      setSelectedSourceListId(response.source_list.id);
      setImportFile(null);
      setImportSourceListId("");
      setImportTitle("");
      setImportIssuer("");
      setImportSubject("");
      setImportVersion("");
      setImportDescription("");
      channelRef.current?.postMessage({ type: "standards-data-changed" });
      await refreshData();
    } catch (error) {
      setErrorMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function handleQuestionStandardToggle(standardId: string) {
    if (!questionStandardsState.questionId) {
      setErrorMessage("Select a question in the main window before attaching standards.");
      return;
    }

    channelRef.current?.postMessage(
      selectedQuestionStandardIds.has(standardId)
        ? { type: "question-remove-standard", standardId }
        : { type: "question-attach-standard", standardId },
    );
  }

  return (
    <div className={`standards-workspace ${pickerMode ? "picker" : ""}`}>
      <header className="standards-header">
        <div>
          <h1>{pickerMode ? "Question Standards" : "Standards"}</h1>
          <p>
            {pickerMode
              ? "Attach standards to the currently selected question without crowding the main editor."
              : "Manage imported source lists, curate course standards, and prepare standards for questions."}
          </p>
        </div>
        <div className="standards-header-actions">
          <button type="button" onClick={() => void refreshData()} disabled={loading || busy}>
            Refresh
          </button>
          {!pickerMode ? (
            <>
              <button
                type="button"
                onClick={() => setShowSourceListsPanel((current) => !current)}
              >
                {showSourceListsPanel ? "Hide Source Lists" : "Manage Source Lists"}
              </button>
              <button type="button" onClick={() => setShowImportPanel((current) => !current)}>
                {showImportPanel ? "Close Import" : "Import Standards"}
              </button>
              <button type="button" onClick={() => setShowSourceDrawer((current) => !current)}>
                {showSourceDrawer ? "Hide Source Drawer" : "Pull From Sources"}
              </button>
            </>
          ) : null}
        </div>
      </header>

      <div className="standards-status-row">
        <span>{statusMessage}</span>
        {errorMessage ? <span className="error-text">{errorMessage}</span> : null}
      </div>

      {!pickerMode ? (
      <section className="standards-course-toolbar standards-panel">
        <div>
          <h2>Current Course Library</h2>
          <p>
            {selectedCourse
              ? `${selectedCourse.title} (${selectedCourse.id})`
              : "Create or select a course library to begin curating standards."}
          </p>
        </div>
        <div className="standards-course-toolbar-actions">
          <label>
            Course Library
            <select
              value={selectedCourseId}
              onChange={(event) => setSelectedCourseId(event.target.value)}
            >
              <option value="">Select a course library</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => setSelectedCourseId("")}>
            New Course Library
          </button>
        </div>
      </section>
      ) : null}

      {!pickerMode && showImportPanel ? (
      <section className="standards-import-panel">
        <div className="standards-import-copy">
          <h2>Import Standards</h2>
          <p>
            CSV headers: <code>id</code> or <code>standard_id</code>, <code>code</code>,{" "}
            <code>statement</code>, optional <code>subject</code>, <code>grade_band</code>,{" "}
            <code>tags</code>.
          </p>
          <p>
            JSON may be an array of standards, an <code>{"{ items: [...] }"}</code> object, or
            an object with <code>source_list</code> and <code>standards</code>.
          </p>
          {showCloseHint ? <p>Close this window when finished. The main editor can keep working separately.</p> : null}
        </div>

        <div className="standards-import-grid">
          <label>
            Source List ID
            <input
              value={importSourceListId}
              onChange={(event) => setImportSourceListId(normalizeId(event.target.value))}
              placeholder="physics-core-2026"
            />
          </label>
          <label>
            Title
            <input
              value={importTitle}
              onChange={(event) => setImportTitle(event.target.value)}
              placeholder="Physics Core Standards"
            />
          </label>
          <label>
            Issuer
            <input
              value={importIssuer}
              onChange={(event) => setImportIssuer(event.target.value)}
              placeholder="State Curriculum Office"
            />
          </label>
          <label>
            Subject
            <input
              value={importSubject}
              onChange={(event) => setImportSubject(event.target.value)}
              placeholder="Physics"
            />
          </label>
          <label>
            Version
            <input
              value={importVersion}
              onChange={(event) => setImportVersion(event.target.value)}
              placeholder="2026.1"
            />
          </label>
          <label className="metadata-span-full">
            Description
            <input
              value={importDescription}
              onChange={(event) => setImportDescription(event.target.value)}
              placeholder="Complete imported standards reference set"
            />
          </label>
          <label className="metadata-span-full">
            Import File
            <input
              type="file"
              accept=".json,.csv,application/json,text/csv"
              onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        <div className="standards-import-actions">
          <button type="button" onClick={() => void handleImportStandards()} disabled={busy}>
            {busy ? "Importing..." : "Import Standards"}
          </button>
          {importFile ? <span>{importFile.name}</span> : null}
        </div>
      </section>
      ) : null}

      <div className={`standards-layout ${pickerMode ? "picker" : ""}`}>
        {!pickerMode ? (
        <aside className={`standards-sidebar-column standards-source-drawer ${showSourceDrawer ? "open" : "closed"}`}>
          {showSourceDrawer ? (
            <>
              {showSourceListsPanel ? (
                <section className="standards-panel">
                  <div className="standards-panel-header">
                    <h2>Source Lists</h2>
                    <span className="bank-assets-count">{sourceLists.length}</span>
                  </div>
                  <div className="standards-source-list">
                    <button
                      type="button"
                      className={`standards-list-row ${selectedSourceListId === "" ? "selected" : ""}`}
                      onClick={() => setSelectedSourceListId("")}
                    >
                      <strong>All Sources</strong>
                      <span>{standards.length} standards</span>
                    </button>
                    {sourceLists.map((sourceList) => {
                      const count = standards.filter(
                        (standard) => standard.source_list_id === sourceList.id,
                      ).length;
                      return (
                        <button
                          key={sourceList.id}
                          type="button"
                          className={`standards-list-row ${
                            selectedSourceListId === sourceList.id ? "selected" : ""
                          }`}
                          onClick={() => setSelectedSourceListId(sourceList.id)}
                        >
                          <strong>{sourceList.title}</strong>
                          <span>{sourceList.issuer}</span>
                          <span>{count} standards</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              <section className="standards-panel standards-results-panel">
                <div className="standards-panel-header">
                  <div>
                    <h2>Source Standards</h2>
                    <p>Browse imported source lists and add standards into the current course library.</p>
                  </div>
                  <span className="bank-assets-count">{filteredSourceStandards.length}</span>
                </div>

                <div className="standards-filter-row source-drawer">
                  <input
                    value={sourceSearch}
                    onChange={(event) => setSourceSearch(event.target.value)}
                    placeholder="Search imported standards"
                  />
                  <select
                    value={selectedSourceListId}
                    onChange={(event) => setSelectedSourceListId(event.target.value)}
                  >
                    <option value="">Current or all sources</option>
                    {sourceLists.map((sourceList) => (
                      <option key={sourceList.id} value={sourceList.id}>
                        {sourceList.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="standards-record-list">
                  {filteredSourceStandards.map((standard) => {
                    const inCourse = selectedCourseStandardIds.has(standard.id);
                    return (
                      <article key={standard.id} className="standards-record-card">
                        <div className="standards-record-top">
                          <div>
                            <strong>{standard.code}</strong>
                            <p>{standard.statement}</p>
                          </div>
                          {selectedCourse ? (
                            <button
                              type="button"
                              onClick={() => void handleToggleCourseStandard(standard.id)}
                              disabled={busy}
                            >
                              {inCourse ? "Remove" : "Add"}
                            </button>
                          ) : null}
                        </div>
                        <div className="bank-asset-badges">
                          <span className="asset-badge">{standard.id}</span>
                          <span className="asset-badge">
                            {sourceLists.find((item) => item.id === standard.source_list_id)?.title ??
                              standard.source_list_id}
                          </span>
                          {standard.subject ? (
                            <span className="asset-badge">{standard.subject}</span>
                          ) : null}
                          {standard.grade_band ? (
                            <span className="asset-badge">{standard.grade_band}</span>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            </>
          ) : (
            <div className="standards-panel standards-drawer-placeholder">
              <strong>Source Drawer Closed</strong>
              <p>Open Pull From Sources to browse imported source standards and add them into the current course library.</p>
            </div>
          )}
        </aside>
        ) : null}

        <section className="standards-panel standards-results-panel">
          <div className="standards-panel-header">
            <div>
              <h2>{pickerMode ? "Standards Picker" : "Current Course Standards"}</h2>
              <p>
                {pickerMode
                  ? questionStandardsState.questionId
                    ? `Attaching standards for ${questionStandardsState.questionId}.`
                    : "Select a question in the main window to attach standards."
                  : selectedCourse
                    ? `Showing the curated standards in ${selectedCourse.title}.`
                    : "Create or select a course library to see curated standards here."}
              </p>
            </div>
            <span className="bank-assets-count">
              {pickerMode
                ? filteredSourceStandards.length
                : selectedCourse
                  ? curatedStandards.length
                  : 0}
            </span>
          </div>

          {!pickerMode ? (
            <div className="standards-filter-row course-library">
              <input
                value={courseSearch}
                onChange={(event) => setCourseSearch(event.target.value)}
                placeholder="Search current course library"
              />
            </div>
          ) : (
            <div className="standards-filter-row">
              <input
                value={sourceSearch}
                onChange={(event) => setSourceSearch(event.target.value)}
                placeholder="Search standards"
              />
              <select
                value={selectedSourceListId}
                onChange={(event) => setSelectedSourceListId(event.target.value)}
              >
                <option value="">All sources</option>
                {sourceLists.map((sourceList) => (
                  <option key={sourceList.id} value={sourceList.id}>
                    {sourceList.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="standards-record-list">
            {(pickerMode ? filteredSourceStandards : curatedStandards).map((standard) => {
              const inCourse = selectedCourseStandardIds.has(standard.id);
              return (
                <article key={standard.id} className="standards-record-card">
                  <div className="standards-record-top">
                    <div>
                      <strong>{standard.code}</strong>
                      <p>{standard.statement}</p>
                    </div>
                    {pickerMode ? (
                      <button
                        type="button"
                        onClick={() => handleQuestionStandardToggle(standard.id)}
                        disabled={!questionStandardsState.questionId}
                      >
                        {selectedQuestionStandardIds.has(standard.id) ? "Remove" : "Attach"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleToggleCourseStandard(standard.id)}
                        disabled={busy}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="bank-asset-badges">
                    <span className="asset-badge">{standard.id}</span>
                    {standard.subject ? <span className="asset-badge">{standard.subject}</span> : null}
                    {standard.grade_band ? (
                      <span className="asset-badge">{standard.grade_band}</span>
                    ) : null}
                    {standard.tags.map((tag) => (
                      <span key={tag} className="asset-badge">
                        {tag}
                      </span>
                    ))}
                  </div>
                </article>
              );
            })}
            {!pickerMode && selectedCourse && curatedStandards.length === 0 ? (
              <p className="asset-empty">
                This course library has no curated standards yet. Open Pull From Sources to add some.
              </p>
            ) : null}
          </div>
        </section>

        {!pickerMode ? (
        <aside className="standards-sidebar-column">
          <section className="standards-panel">
            <div className="standards-panel-header">
              <h2>{selectedCourse ? "Course Library Details" : "New Course Library"}</h2>
            </div>
            <div className="standards-course-form">
              <label>
                Course ID
                <input
                  value={courseDraftId}
                  onChange={(event) => setCourseDraftId(normalizeId(event.target.value))}
                  placeholder="physics-1"
                />
              </label>
              <label>
                Title
                <input
                  value={courseDraftTitle}
                  onChange={(event) => setCourseDraftTitle(event.target.value)}
                  placeholder="Physics 1"
                />
              </label>
              <label>
                Description
                <textarea
                  value={courseDraftDescription}
                  onChange={(event) => setCourseDraftDescription(event.target.value)}
                />
              </label>
              <button type="button" onClick={() => void handleSaveCourse()} disabled={busy}>
                {busy ? "Saving..." : "Save Course"}
              </button>
            </div>
          </section>

          <section className="standards-panel">
            <div className="standards-panel-header">
              <h2>Course Summary</h2>
              <span className="bank-assets-count">
                {selectedCourse?.standard_refs.length ?? 0}
              </span>
            </div>
            {selectedCourse ? (
              <div className="standards-source-list">
                <div className="standards-curated-summary">
                  <strong>{selectedCourse.title}</strong>
                  <span>{selectedCourse.id}</span>
                  <span>{selectedCourse.description || "No course description yet."}</span>
                </div>
                {selectedCourse.standard_refs.map((reference) => {
                  const standard = standardsById[reference.standard_id];
                  return (
                    <div key={reference.standard_id} className="standards-curated-row">
                      <div>
                        <strong>{standard?.code ?? reference.standard_id}</strong>
                        <span>{standard?.statement ?? "Standard not found."}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleToggleCourseStandard(reference.standard_id)}
                        disabled={busy}
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="asset-empty">Select or create a course to curate standards.</p>
            )}
          </section>
        </aside>
        ) : (
        <aside className="standards-sidebar-column">
          <section className="standards-panel">
            <div className="standards-panel-header">
              <h2>Attached To Question</h2>
              <span className="bank-assets-count">{questionStandardsState.attachedStandardIds.length}</span>
            </div>
            {questionStandardsState.questionId ? (
              <div className="standards-source-list">
                {questionStandardsState.attachedStandardIds.map((standardId) => {
                  const standard = standardsById[standardId];
                  return (
                    <div key={standardId} className="standards-curated-row">
                      <div>
                        <strong>{standard?.code ?? standardId}</strong>
                        <span>{standard?.statement ?? "Standard not found."}</span>
                      </div>
                      <button type="button" onClick={() => handleQuestionStandardToggle(standardId)}>
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="asset-empty">No question selected in the main window.</p>
            )}
          </section>
        </aside>
        )}
      </div>
    </div>
  );
}
