import type { TestDraftDetailModel, TestDraftModel, TestPrintSettingsModel } from "./types";

interface TestBuilderPaneProps {
  open: boolean;
  hasBank: boolean;
  loading: boolean;
  selectedQuestionId: string | null;
  selectedTestId: string | null;
  tests: TestDraftDetailModel[];
  onOpen: () => void;
  onClose: () => void;
  onCreateTest: () => void;
  onSelectTest: (testId: string) => void;
  onAddSelectedQuestion: () => void;
  onOpenPrintPreview: () => void;
  onUpdateTest: (test: TestDraftModel) => void;
}

function formatMinutes(seconds: number) {
  if (seconds <= 0) return "0 min";
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}

function updatePrintSettings(
  test: TestDraftModel,
  patch: Partial<TestPrintSettingsModel>,
): TestDraftModel {
  return {
    ...test,
    print_settings: {
      ...test.print_settings,
      ...patch,
    },
  };
}

function TestBuilderPane({
  open,
  hasBank,
  loading,
  selectedQuestionId,
  selectedTestId,
  tests,
  onOpen,
  onClose,
  onCreateTest,
  onSelectTest,
  onAddSelectedQuestion,
  onOpenPrintPreview,
  onUpdateTest,
}: TestBuilderPaneProps) {
  if (!open) {
    return (
      <section className="test-builder-collapsed">
        <button type="button" onClick={onOpen} disabled={!hasBank}>
          Test Builder
        </button>
      </section>
    );
  }

  const selectedTest = tests.find((item) => item.test.id === selectedTestId) ?? tests[0] ?? null;
  const selectedQuestionIsInTest =
    !!selectedQuestionId &&
    !!selectedTest?.test.items.some((item) => item.question_id === selectedQuestionId);
  const questionById = Object.fromEntries(
    (selectedTest?.questions ?? []).map((question) => [question.id, question]),
  );

  const updateItem = (index: number, patch: Partial<TestDraftModel["items"][number]>) => {
    if (!selectedTest) return;
    onUpdateTest({
      ...selectedTest.test,
      items: selectedTest.test.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    });
  };

  const removeItem = (index: number) => {
    if (!selectedTest) return;
    onUpdateTest({
      ...selectedTest.test,
      items: selectedTest.test.items.filter((_, itemIndex) => itemIndex !== index),
    });
  };

  const moveItem = (index: number, direction: -1 | 1) => {
    if (!selectedTest) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= selectedTest.test.items.length) return;
    const items = [...selectedTest.test.items];
    const [item] = items.splice(index, 1);
    items.splice(nextIndex, 0, item);
    onUpdateTest({ ...selectedTest.test, items });
  };

  return (
    <section className="test-builder-pane">
      <div className="test-builder-header">
        <div>
          <h2>Test Builder</h2>
          <p>{selectedTest ? `${selectedTest.test.title} ${selectedTest.test.version}` : "No test draft"}</p>
        </div>
        <div className="test-builder-actions">
          <button type="button" onClick={onCreateTest} disabled={loading || !hasBank}>
            New Test
          </button>
          <button type="button" onClick={onClose}>
            Hide
          </button>
        </div>
      </div>

      {!hasBank ? (
        <p className="test-builder-empty">Open a bank to build tests.</p>
      ) : tests.length === 0 || !selectedTest ? (
        <div className="test-builder-empty-row">
          <p>No test drafts yet.</p>
          <button type="button" onClick={onCreateTest} disabled={loading}>
            Create Test Draft
          </button>
        </div>
      ) : (
        <div className="test-builder-layout">
          <aside className="test-builder-list">
            {tests.map((detail) => (
              <button
                key={detail.test.id}
                type="button"
                className={detail.test.id === selectedTest.test.id ? "selected" : ""}
                onClick={() => onSelectTest(detail.test.id)}
              >
                <strong>{detail.test.title}</strong>
                <span>Version {detail.test.version}</span>
                <span>{detail.test.items.length} items</span>
              </button>
            ))}
          </aside>

          <div className="test-builder-detail">
            <section className="test-builder-meta">
              <label>
                Title
                <input
                  value={selectedTest.test.title}
                  onChange={(event) =>
                    onUpdateTest({ ...selectedTest.test, title: event.target.value })
                  }
                />
              </label>
              <label>
                Version
                <input
                  value={selectedTest.test.version}
                  onChange={(event) =>
                    onUpdateTest({ ...selectedTest.test, version: event.target.value })
                  }
                />
              </label>
              <button
                type="button"
                onClick={onAddSelectedQuestion}
                disabled={!selectedQuestionId || selectedQuestionIsInTest || loading}
              >
                {selectedQuestionIsInTest ? "Selected Added" : "Add Selected Question"}
              </button>
              <button
                type="button"
                onClick={onOpenPrintPreview}
                disabled={selectedTest.test.items.length === 0}
              >
                Preview Print
              </button>
            </section>

            <section className="test-summary-grid">
              <div>
                <span>Items</span>
                <strong>{selectedTest.test.items.length}</strong>
              </div>
              <div>
                <span>Avg Difficulty</span>
                <strong>{selectedTest.summary.average_difficulty ?? "n/a"}</strong>
              </div>
              <div>
                <span>Total Time</span>
                <strong>{formatMinutes(selectedTest.summary.total_time_estimate_sec)}</strong>
              </div>
              <div>
                <span>Standards</span>
                <strong>{selectedTest.summary.standard_ids.length}</strong>
              </div>
            </section>

            <details className="test-builder-settings">
              <summary>Page Settings</summary>
              <div className="test-builder-settings-grid">
                <label>
                  Page Size
                  <select
                    value={selectedTest.test.print_settings.page_size}
                    onChange={(event) =>
                      onUpdateTest(
                        updatePrintSettings(selectedTest.test, {
                          page_size: event.target.value as TestPrintSettingsModel["page_size"],
                        }),
                      )
                    }
                  >
                    <option value="letter">Letter</option>
                    <option value="legal">Legal</option>
                    <option value="a4">A4</option>
                  </select>
                </label>
                <label>
                  Columns
                  <select
                    value={selectedTest.test.print_settings.columns}
                    onChange={(event) =>
                      onUpdateTest(
                        updatePrintSettings(selectedTest.test, {
                          columns: Number(event.target.value) as TestPrintSettingsModel["columns"],
                        }),
                      )
                    }
                  >
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                  </select>
                </label>
                <label>
                  Font Size
                  <input
                    type="number"
                    min={8}
                    max={18}
                    value={selectedTest.test.print_settings.font_size_pt}
                    onChange={(event) =>
                      onUpdateTest(
                        updatePrintSettings(selectedTest.test, {
                          font_size_pt: Number(event.target.value),
                        }),
                      )
                    }
                  />
                </label>
                <label>
                  Margin
                  <input
                    type="number"
                    min={0.25}
                    max={1.5}
                    step={0.25}
                    value={selectedTest.test.print_settings.margin_in}
                    onChange={(event) =>
                      onUpdateTest(
                        updatePrintSettings(selectedTest.test, {
                          margin_in: Number(event.target.value),
                        }),
                      )
                    }
                  />
                </label>
                <label className="test-builder-toggle">
                  <input
                    type="checkbox"
                    checked={selectedTest.test.print_settings.name_field_enabled}
                    onChange={(event) =>
                      onUpdateTest(
                        updatePrintSettings(selectedTest.test, {
                          name_field_enabled: event.target.checked,
                        }),
                      )
                    }
                  />
                  Name field
                </label>
                <label className="test-builder-toggle">
                  <input
                    type="checkbox"
                    checked={selectedTest.test.print_settings.page_numbers_enabled}
                    onChange={(event) =>
                      onUpdateTest(
                        updatePrintSettings(selectedTest.test, {
                          page_numbers_enabled: event.target.checked,
                        }),
                      )
                    }
                  />
                  Page numbers
                </label>
              </div>
            </details>

            <section className="test-balance-panel">
              <h3>Balance</h3>
              <div className="test-balance-columns">
                <div>
                  <strong>Type</strong>
                  {Object.entries(selectedTest.summary.question_type_counts).map(([type, count]) => (
                    <span key={type}>{type}: {count}</span>
                  ))}
                </div>
                <div>
                  <strong>Difficulty</strong>
                  {Object.entries(selectedTest.summary.difficulty_counts).map(([difficulty, count]) => (
                    <span key={difficulty}>D{difficulty}: {count}</span>
                  ))}
                </div>
                <div>
                  <strong>Standards</strong>
                  {selectedTest.summary.standard_balance.map((standard) => (
                    <span key={standard.standard_id}>
                      {standard.standard_id}: {standard.question_count}, {formatMinutes(standard.total_time_estimate_sec)}
                    </span>
                  ))}
                </div>
              </div>
            </section>

            <section className="test-item-list">
              <h3>Items</h3>
              {selectedTest.test.items.length === 0 ? (
                <p className="test-builder-empty">Add questions from the question list.</p>
              ) : (
                selectedTest.test.items.map((item, index) => {
                  const question = questionById[item.question_id];
                  return (
                    <article key={`${item.question_id}-${index}`} className="test-item-row">
                      <div>
                        <strong>{index + 1}. {item.question_id}</strong>
                        <span>
                          {question
                            ? `${question.type} / Difficulty ${question.difficulty} / ${question.topic}`
                            : "Question not found"}
                        </span>
                      </div>
                      <label className="test-builder-toggle">
                        <input
                          type="checkbox"
                          checked={item.experimental}
                          onChange={(event) =>
                            updateItem(index, { experimental: event.target.checked })
                          }
                        />
                        Experimental
                      </label>
                      <div className="test-item-actions">
                        <button type="button" onClick={() => moveItem(index, -1)} disabled={index === 0}>
                          Up
                        </button>
                        <button
                          type="button"
                          onClick={() => moveItem(index, 1)}
                          disabled={index === selectedTest.test.items.length - 1}
                        >
                          Down
                        </button>
                        <button type="button" onClick={() => removeItem(index)}>
                          Remove
                        </button>
                      </div>
                    </article>
                  );
                })
              )}
            </section>
          </div>
        </div>
      )}
    </section>
  );
}

export default TestBuilderPane;
