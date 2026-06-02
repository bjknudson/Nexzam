import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { listTestDrafts } from "./api";
import { MathTextPreview } from "./MathPreview";
import type { QuestionModel, TestDraftDetailModel, TestPrintSettingsModel } from "./types";

interface TestPrintPreviewProps {
  testId: string | null;
  onClose: () => void;
}

const CHOICE_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function formatDate(value = new Date()) {
  return value.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function getQuestionInstruction(question: QuestionModel) {
  if (question.type === "multiple_choice") {
    const answer = question.answer ?? {};
    const correctIndices = Array.isArray(answer.correct_choice_indices)
      ? answer.correct_choice_indices
      : [];
    if (correctIndices.length > 1) {
      return `Select the ${correctIndices.length} choices.`;
    }
    return "Select the best answer.";
  }

  if (question.type === "numeric_response") return "Enter a numeric answer.";
  if (question.type === "short_answer") return "Write a concise response.";
  return "Show your work and justify your answer.";
}

function getPageSizeLabel(settings: TestPrintSettingsModel) {
  if (settings.page_size === "a4") return "A4";
  return settings.page_size === "legal" ? "Legal" : "Letter";
}

function questionById(test: TestDraftDetailModel) {
  return Object.fromEntries(test.questions.map((question) => [question.id, question]));
}

function getChoices(question: QuestionModel): string[] {
  const choices = question.answer?.choices;
  return Array.isArray(choices) ? choices.map(String) : [];
}

function TestPrintPreview({ testId, onClose }: TestPrintPreviewProps) {
  const [tests, setTests] = useState<TestDraftDetailModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const response = await listTestDrafts();
        if (cancelled) return;
        setTests(response.items);
        setErrorMessage("");
      } catch (error) {
        if (cancelled) return;
        setErrorMessage((error as Error).message);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedTest = tests.find((item) => item.test.id === testId) ?? tests[0] ?? null;
  const questionsById = useMemo(
    () => (selectedTest ? questionById(selectedTest) : {}),
    [selectedTest],
  );

  if (loading) {
    return (
      <div className="print-preview-shell">
        <div className="print-preview-empty">Loading printable preview...</div>
      </div>
    );
  }

  if (errorMessage || !selectedTest) {
    return (
      <div className="print-preview-shell">
        <div className="print-preview-toolbar">
          <button type="button" onClick={onClose}>Close</button>
        </div>
        <div className="print-preview-empty">
          {errorMessage || "No test draft is available to preview."}
        </div>
      </div>
    );
  }

  const settings = selectedTest.test.print_settings;
  const pageSizeForPrint = settings.page_size === "a4" ? "A4" : settings.page_size;
  const printStyle = {
    "--print-font-size": `${settings.font_size_pt}pt`,
    "--print-margin": `${settings.margin_in}in`,
    "--print-columns": settings.columns,
  } as CSSProperties;

  return (
    <div className="print-preview-shell" style={printStyle}>
      <style>{`@page { size: ${pageSizeForPrint}; margin: 0; }`}</style>
      <div className="print-preview-toolbar">
        <div>
          <strong>{selectedTest.test.title}</strong>
          <span>
            Version {selectedTest.test.version} / {getPageSizeLabel(settings)} / {settings.columns} column
            {settings.columns === 1 ? "" : "s"}
          </span>
        </div>
        <div className="print-preview-actions">
          <button type="button" onClick={() => window.print()}>
            Print
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <main className={`print-page page-${settings.page_size}`}>
        {settings.cover_sheet_enabled ? (
          <section className="print-cover-sheet">
            <h1>{selectedTest.test.title}</h1>
            <div className="print-cover-meta">
              <span>Version {selectedTest.test.version}</span>
              <span>{formatDate()}</span>
            </div>
            {settings.name_field_enabled ? (
              <div className="print-name-line">
                <span>Name</span>
                <i />
              </div>
            ) : null}
          </section>
        ) : settings.name_field_enabled ? (
          <section className="print-name-line compact">
            <span>Name</span>
            <i />
          </section>
        ) : null}

        <section className="print-question-flow">
          {selectedTest.test.items.map((item, index) => {
            const question = questionsById[item.question_id];
            const choices = question ? getChoices(question) : [];
            const responseLines =
              item.response_space_lines ?? settings.default_response_space_lines;

            return (
              <article key={`${item.question_id}-${index}`} className="print-question-item">
                <div className="print-question-header">
                  <strong>{index + 1}.</strong>
                  {question ? <span>{getQuestionInstruction(question)}</span> : null}
                </div>

                {question ? (
                  <>
                    <MathTextPreview text={question.prompt} className="print-question-prompt" />
                    {choices.length > 0 ? (
                      <ol className="print-choice-list">
                        {choices.map((choice, choiceIndex) => (
                          <li key={`${choice}-${choiceIndex}`}>
                            <span>{CHOICE_LABELS[choiceIndex] ?? `${choiceIndex + 1}`}</span>
                            <MathTextPreview text={choice} preferWholeExpression />
                          </li>
                        ))}
                      </ol>
                    ) : null}
                    {responseLines > 0 ? (
                      <div className="print-response-space">
                        {Array.from({ length: responseLines }).map((_, lineIndex) => (
                          <i key={lineIndex} />
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="print-missing-question">Question not found: {item.question_id}</p>
                )}
              </article>
            );
          })}
        </section>
      </main>
    </div>
  );
}

export default TestPrintPreview;
