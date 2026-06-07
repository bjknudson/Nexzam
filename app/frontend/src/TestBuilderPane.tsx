import type {
  QuestionType,
  TestDraftDetailModel,
  TestItemModel,
  TestDraftModel,
  TestInstructionSectionOptionsModel,
  TestInstructionSectionModel,
  TestPrintSettingsModel,
  TestTemplateBlockModel,
} from "./types";

interface TestBuilderPaneProps {
  open: boolean;
  hasBank: boolean;
  loading: boolean;
  selectedQuestionId: string | null;
  selectedTestId: string | null;
  tests: TestDraftDetailModel[];
  pageMode?: boolean;
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

function isQuestionItem(item: TestItemModel) {
  return (item.item_type ?? "question") === "question";
}

function isSectionItem(item: TestItemModel) {
  return item.item_type === "section";
}

function parseStandardText(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((standard) => standard.trim())
        .filter(Boolean),
    ),
  );
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

const QUESTION_TYPE_ORDER: QuestionType[] = [
  "multiple_choice",
  "numeric_response",
  "short_answer",
  "free_response",
];

const DEFAULT_INSTRUCTION_SECTIONS: Record<QuestionType, TestInstructionSectionModel> = {
  multiple_choice: {
    question_type: "multiple_choice",
    title: "Multiple Choice",
    instructions: "Select the best answer.",
    header_template: "{{section_title}}\n{{instructions}}\n{{topic}}\n{{standards}}\n{{time}}",
    show_topic: false,
    show_standards: false,
    show_suggested_time: true,
    suggested_time_mode: "calculated",
    suggested_time_sec: null,
  },
  numeric_response: {
    question_type: "numeric_response",
    title: "Numeric Response",
    instructions: "Enter a numeric answer.",
    header_template: "{{section_title}}\n{{instructions}}\n{{topic}}\n{{standards}}\n{{time}}",
    show_topic: false,
    show_standards: false,
    show_suggested_time: true,
    suggested_time_mode: "calculated",
    suggested_time_sec: null,
  },
  short_answer: {
    question_type: "short_answer",
    title: "Short Answer",
    instructions: "Write a concise response.",
    header_template: "{{section_title}}\n{{instructions}}\n{{topic}}\n{{standards}}\n{{time}}",
    show_topic: false,
    show_standards: false,
    show_suggested_time: true,
    suggested_time_mode: "calculated",
    suggested_time_sec: null,
  },
  free_response: {
    question_type: "free_response",
    title: "Free Response",
    instructions: "Show your work and justify your answer.",
    header_template: "{{section_title}}\n{{instructions}}\n{{topic}}\n{{standards}}\n{{time}}",
    show_topic: false,
    show_standards: false,
    show_suggested_time: true,
    suggested_time_mode: "calculated",
    suggested_time_sec: null,
  },
};

const DEFAULT_PAGE_HEADER: TestTemplateBlockModel = {
  template: "{{title}}\nVersion {{version}}    {{date}}",
  alignment: "center",
  horizontal_line: true,
  spacing_after_lines: 1,
};

const DEFAULT_NAME_FIELD: TestTemplateBlockModel = {
  template: "Name: ______________________________",
  alignment: "left",
  horizontal_line: false,
  spacing_after_lines: 1,
};

const DEFAULT_INSTRUCTION_OPTIONS: TestInstructionSectionOptionsModel = {
  show_topic: false,
  show_standards: false,
  show_suggested_time: true,
  alignment: "left",
  horizontal_line: true,
  spacing_after_lines: 1,
};

function getInstructionSections(settings: TestPrintSettingsModel): TestInstructionSectionModel[] {
  const byType = Object.fromEntries(
    (settings.instruction_sections ?? []).map((section) => [section.question_type, section]),
  ) as Partial<Record<QuestionType, TestInstructionSectionModel>>;
  return QUESTION_TYPE_ORDER.map((questionType) => ({
    ...DEFAULT_INSTRUCTION_SECTIONS[questionType],
    ...byType[questionType],
  }));
}

function updateInstructionSection(
  test: TestDraftModel,
  questionType: QuestionType,
  patch: Partial<TestInstructionSectionModel>,
): TestDraftModel {
  const sections = getInstructionSections(test.print_settings).map((section) =>
    section.question_type === questionType ? { ...section, ...patch } : section,
  );
  return updatePrintSettings(test, { instruction_sections: sections });
}

function getPageHeader(settings: TestPrintSettingsModel): TestTemplateBlockModel {
  return { ...DEFAULT_PAGE_HEADER, ...settings.page_header };
}

function getNameField(settings: TestPrintSettingsModel): TestTemplateBlockModel {
  return { ...DEFAULT_NAME_FIELD, ...settings.name_field };
}

function getInstructionOptions(
  settings: TestPrintSettingsModel,
): TestInstructionSectionOptionsModel {
  return {
    ...DEFAULT_INSTRUCTION_OPTIONS,
    ...settings.instruction_section_options,
  };
}

function updatePageHeader(
  test: TestDraftModel,
  patch: Partial<TestTemplateBlockModel>,
): TestDraftModel {
  return updatePrintSettings(test, {
    page_header: {
      ...getPageHeader(test.print_settings),
      ...patch,
    },
  });
}

function updateNameField(
  test: TestDraftModel,
  patch: Partial<TestTemplateBlockModel>,
): TestDraftModel {
  return updatePrintSettings(test, {
    name_field: {
      ...getNameField(test.print_settings),
      ...patch,
    },
  });
}

function updateInstructionOptions(
  test: TestDraftModel,
  patch: Partial<TestInstructionSectionOptionsModel>,
): TestDraftModel {
  return updatePrintSettings(test, {
    instruction_section_options: {
      ...getInstructionOptions(test.print_settings),
      ...patch,
    },
  });
}

function TestBuilderPane({
  open,
  hasBank,
  loading,
  selectedQuestionId,
  selectedTestId,
  tests,
  pageMode = false,
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
    !!selectedTest?.test.items.some(
      (item) => isQuestionItem(item) && item.question_id === selectedQuestionId,
    );
  const questionById = Object.fromEntries(
    (selectedTest?.questions ?? []).map((question) => [question.id, question]),
  );
  const questionItemCount = selectedTest?.test.items.filter(isQuestionItem).length ?? 0;

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

  const addSectionItem = () => {
    if (!selectedTest) return;
    const nextSectionNumber =
      selectedTest.test.items.filter((item) => item.item_type === "section").length + 1;
    onUpdateTest({
      ...selectedTest.test,
      items: [
        ...selectedTest.test.items,
        {
          item_type: "section",
          section_id: `section_${nextSectionNumber}`,
          title: `Section ${nextSectionNumber}`,
          instructions: "",
          header_template: "{{section_title}}\n{{instructions}}\n{{topic}}\n{{standards}}\n{{time}}",
          question_type: null,
          topic: null,
          standards: [],
          suggested_time_mode: "calculated",
          suggested_time_sec: null,
        },
      ],
    });
  };

  return (
    <section className={`test-builder-pane ${pageMode ? "page-mode" : ""}`}>
      <div className="test-builder-header">
        <div>
          <h2>Test Builder</h2>
          <p>{selectedTest ? `${selectedTest.test.title} ${selectedTest.test.version}` : "No test draft"}</p>
        </div>
        <div className="test-builder-actions">
          <button type="button" onClick={onCreateTest} disabled={loading || !hasBank}>
            New Test
          </button>
          {pageMode ? null : (
            <button type="button" onClick={onClose}>
              Hide
            </button>
          )}
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
                <span>{detail.test.items.filter(isQuestionItem).length} questions</span>
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
              <button type="button" onClick={addSectionItem} disabled={loading}>
                Add Section
              </button>
              <button
                type="button"
                onClick={onOpenPrintPreview}
                disabled={questionItemCount === 0}
              >
                Preview Print
              </button>
            </section>

            <section className="test-summary-grid">
              <div>
                <span>Questions</span>
                <strong>{questionItemCount}</strong>
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
              <div className="test-settings-editor-grid">
                <details className="test-template-editor">
                  <summary>Page Topper</summary>
                  <label>
                    Template
                    <textarea
                      value={getPageHeader(selectedTest.test.print_settings).template}
                      onChange={(event) =>
                        onUpdateTest(updatePageHeader(selectedTest.test, { template: event.target.value }))
                      }
                    />
                  </label>
                  <div className="test-template-editor-row">
                    <label>
                      Justification
                      <select
                        value={getPageHeader(selectedTest.test.print_settings).alignment}
                        onChange={(event) =>
                          onUpdateTest(
                            updatePageHeader(selectedTest.test, {
                              alignment: event.target.value as TestTemplateBlockModel["alignment"],
                            }),
                          )
                        }
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </label>
                    <label>
                      Space After
                      <input
                        type="number"
                        min={0}
                        max={6}
                        value={getPageHeader(selectedTest.test.print_settings).spacing_after_lines}
                        onChange={(event) =>
                          onUpdateTest(
                            updatePageHeader(selectedTest.test, {
                              spacing_after_lines: Number(event.target.value),
                            }),
                          )
                        }
                      />
                    </label>
                    <label className="test-builder-toggle">
                      <input
                        type="checkbox"
                        checked={getPageHeader(selectedTest.test.print_settings).horizontal_line}
                        onChange={(event) =>
                          onUpdateTest(
                            updatePageHeader(selectedTest.test, {
                              horizontal_line: event.target.checked,
                            }),
                          )
                        }
                      />
                      Horizontal line
                    </label>
                  </div>
                  <p className="test-template-help">
                    Placeholders: {"{{title}}"}, {"{{version}}"}, {"{{date}}"}
                  </p>
                </details>

                <details className="test-template-editor">
                  <summary>Name Field</summary>
                  <label>
                    Template
                    <textarea
                      value={getNameField(selectedTest.test.print_settings).template}
                      onChange={(event) =>
                        onUpdateTest(updateNameField(selectedTest.test, { template: event.target.value }))
                      }
                    />
                  </label>
                  <div className="test-template-editor-row">
                    <label>
                      Justification
                      <select
                        value={getNameField(selectedTest.test.print_settings).alignment}
                        onChange={(event) =>
                          onUpdateTest(
                            updateNameField(selectedTest.test, {
                              alignment: event.target.value as TestTemplateBlockModel["alignment"],
                            }),
                          )
                        }
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </label>
                    <label>
                      Space After
                      <input
                        type="number"
                        min={0}
                        max={6}
                        value={getNameField(selectedTest.test.print_settings).spacing_after_lines}
                        onChange={(event) =>
                          onUpdateTest(
                            updateNameField(selectedTest.test, {
                              spacing_after_lines: Number(event.target.value),
                            }),
                          )
                        }
                      />
                    </label>
                    <label className="test-builder-toggle">
                      <input
                        type="checkbox"
                        checked={getNameField(selectedTest.test.print_settings).horizontal_line}
                        onChange={(event) =>
                          onUpdateTest(
                            updateNameField(selectedTest.test, {
                              horizontal_line: event.target.checked,
                            }),
                          )
                        }
                      />
                      Horizontal line
                    </label>
                  </div>
                </details>

                <details className="test-template-editor">
                  <summary>Instruction Display</summary>
                  <div className="test-instruction-section-toggles">
                    <label className="test-builder-toggle">
                      <input
                        type="checkbox"
                        checked={getInstructionOptions(selectedTest.test.print_settings).show_topic}
                        onChange={(event) =>
                          onUpdateTest(
                            updateInstructionOptions(selectedTest.test, {
                              show_topic: event.target.checked,
                            }),
                          )
                        }
                      />
                      Topic
                    </label>
                    <label className="test-builder-toggle">
                      <input
                        type="checkbox"
                        checked={getInstructionOptions(selectedTest.test.print_settings).show_standards}
                        onChange={(event) =>
                          onUpdateTest(
                            updateInstructionOptions(selectedTest.test, {
                              show_standards: event.target.checked,
                            }),
                          )
                        }
                      />
                      Standards
                    </label>
                    <label className="test-builder-toggle">
                      <input
                        type="checkbox"
                        checked={getInstructionOptions(selectedTest.test.print_settings).show_suggested_time}
                        onChange={(event) =>
                          onUpdateTest(
                            updateInstructionOptions(selectedTest.test, {
                              show_suggested_time: event.target.checked,
                            }),
                          )
                        }
                      />
                      Time
                    </label>
                    <label className="test-builder-toggle">
                      <input
                        type="checkbox"
                        checked={getInstructionOptions(selectedTest.test.print_settings).horizontal_line}
                        onChange={(event) =>
                          onUpdateTest(
                            updateInstructionOptions(selectedTest.test, {
                              horizontal_line: event.target.checked,
                            }),
                          )
                        }
                      />
                      Horizontal line
                    </label>
                  </div>
                  <div className="test-template-editor-row">
                    <label>
                      Justification
                      <select
                        value={getInstructionOptions(selectedTest.test.print_settings).alignment}
                        onChange={(event) =>
                          onUpdateTest(
                            updateInstructionOptions(selectedTest.test, {
                              alignment: event.target.value as TestInstructionSectionOptionsModel["alignment"],
                            }),
                          )
                        }
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </label>
                    <label>
                      Space After
                      <input
                        type="number"
                        min={0}
                        max={6}
                        value={getInstructionOptions(selectedTest.test.print_settings).spacing_after_lines}
                        onChange={(event) =>
                          onUpdateTest(
                            updateInstructionOptions(selectedTest.test, {
                              spacing_after_lines: Number(event.target.value),
                            }),
                          )
                        }
                      />
                    </label>
                  </div>
                </details>
              </div>
              <div className="test-instruction-section-editor">
                <h3>Instruction Sections</h3>
                {getInstructionSections(selectedTest.test.print_settings).map((section) => (
                  <article key={section.question_type} className="test-instruction-section-card">
                    <div className="test-instruction-section-fields">
                      <label>
                        Style
                        <input value={section.question_type} readOnly />
                      </label>
                      <label>
                        Header
                        <input
                          value={section.title}
                          onChange={(event) =>
                            onUpdateTest(
                              updateInstructionSection(selectedTest.test, section.question_type, {
                                title: event.target.value,
                              }),
                            )
                          }
                        />
                      </label>
                      <label className="test-instruction-text">
                        Instructions
                        <textarea
                          value={section.instructions}
                          onChange={(event) =>
                            onUpdateTest(
                              updateInstructionSection(selectedTest.test, section.question_type, {
                                instructions: event.target.value,
                              }),
                            )
                          }
                        />
                      </label>
                      <label className="test-instruction-text">
                        Header Template
                        <textarea
                          value={
                            section.header_template ??
                            "{{section_title}}\n{{instructions}}\n{{topic}}\n{{standards}}\n{{time}}"
                          }
                          onChange={(event) =>
                            onUpdateTest(
                              updateInstructionSection(selectedTest.test, section.question_type, {
                                header_template: event.target.value,
                              }),
                            )
                          }
                        />
                      </label>
                      <label>
                        Suggested Time
                        <select
                          value={section.suggested_time_mode ?? "calculated"}
                          onChange={(event) =>
                            onUpdateTest(
                              updateInstructionSection(selectedTest.test, section.question_type, {
                                suggested_time_mode: event.target.value as "calculated" | "override",
                              }),
                            )
                          }
                        >
                          <option value="calculated">Calculated</option>
                          <option value="override">Override</option>
                        </select>
                      </label>
                      {section.suggested_time_mode === "override" ? (
                        <label>
                          Override Minutes
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={Math.round((section.suggested_time_sec ?? 0) / 60)}
                            onChange={(event) =>
                              onUpdateTest(
                                updateInstructionSection(selectedTest.test, section.question_type, {
                                  suggested_time_sec: Number(event.target.value) * 60 || null,
                                }),
                              )
                            }
                          />
                        </label>
                      ) : null}
                    </div>
                  </article>
                ))}
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
                  if (isSectionItem(item)) {
                    const sectionQuestionType = item.question_type ?? "";
                    return (
                      <article
                        key={`${item.section_id ?? item.title ?? "section"}-${index}`}
                        className="test-item-row test-section-item-row"
                      >
                        <div className="test-section-item-header">
                          <strong>Section</strong>
                          <span>{item.title || "Untitled section"}</span>
                        </div>
                        <div className="test-section-item-fields">
                          <label>
                            Header
                            <input
                              value={item.title ?? ""}
                              onChange={(event) => updateItem(index, { title: event.target.value })}
                            />
                          </label>
                          <label>
                            Style Defaults
                            <select
                              value={sectionQuestionType}
                              onChange={(event) =>
                                updateItem(index, {
                                  question_type: (event.target.value || null) as QuestionType | null,
                                })
                              }
                            >
                              <option value="">Manual</option>
                              {QUESTION_TYPE_ORDER.map((questionType) => (
                                <option key={questionType} value={questionType}>
                                  {questionType}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Topic Text
                            <input
                              value={item.topic ?? ""}
                              onChange={(event) =>
                                updateItem(index, { topic: event.target.value || null })
                              }
                            />
                          </label>
                          <label>
                            Standards Text
                            <input
                              value={(item.standards ?? []).join(", ")}
                              onChange={(event) =>
                                updateItem(index, { standards: parseStandardText(event.target.value) })
                              }
                            />
                          </label>
                          <label className="test-instruction-text">
                            Instructions
                            <textarea
                              value={item.instructions ?? ""}
                              onChange={(event) =>
                                updateItem(index, { instructions: event.target.value })
                              }
                            />
                          </label>
                          <label className="test-instruction-text">
                            Header Template
                            <textarea
                              value={
                                item.header_template ??
                                "{{section_title}}\n{{instructions}}\n{{topic}}\n{{standards}}\n{{time}}"
                              }
                              onChange={(event) =>
                                updateItem(index, { header_template: event.target.value })
                              }
                            />
                          </label>
                          <label>
                            Suggested Time
                            <select
                              value={item.suggested_time_mode ?? "calculated"}
                              onChange={(event) =>
                                updateItem(index, {
                                  suggested_time_mode: event.target.value as "calculated" | "override",
                                })
                              }
                            >
                              <option value="calculated">Calculated</option>
                              <option value="override">Override</option>
                            </select>
                          </label>
                          {item.suggested_time_mode === "override" ? (
                            <label>
                              Override Minutes
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={Math.round((item.suggested_time_sec ?? 0) / 60)}
                                onChange={(event) =>
                                  updateItem(index, {
                                    suggested_time_sec: Number(event.target.value) * 60 || null,
                                  })
                                }
                              />
                            </label>
                          ) : null}
                        </div>
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
                  }

                  const question = item.question_id ? questionById[item.question_id] : undefined;
                  return (
                    <article key={`${item.question_id ?? "question"}-${index}`} className="test-item-row">
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
                          checked={item.experimental ?? false}
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
