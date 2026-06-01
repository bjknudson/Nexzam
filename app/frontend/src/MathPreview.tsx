import type { ReactNode } from "react";
import { BlockMath, InlineMath } from "react-katex";

import type { QuestionModel } from "./types";

type MathToken =
  | { kind: "text"; value: string }
  | { kind: "inline"; value: string }
  | { kind: "block"; value: string };

interface MathPreviewFieldProps {
  label: string;
  value: string;
  previewEnabled: boolean;
  children: ReactNode;
  className?: string;
}

interface MathPreviewSection {
  label: string;
  text: string;
}

const COMMAND_PATTERN =
  /\\(?:frac|sqrt|sum|int|theta|pi|alpha|beta|gamma|delta|Delta|lambda|mu|sigma|omega|cdot|times|leq|geq|neq|sin|cos|tan)\b/;
const NOTATION_PATTERN = /(^|[\s([{=+\-*/])(?:[A-Za-z]\w*)\s*(?:\^\{?[-+]?\w+\}?|_\{?[-+]?\w+\}?)/;
const CURRENCY_PATTERN = /^\s*\$?\d+(?:\.\d{1,2})?\s*$/;
const BARE_MATH_PATTERN =
  /\\(?:frac|sqrt)(?:\{[^{}]*\}){1,2}[A-Za-z0-9_^{}+\-*/=().\\]*|\\(?:sum|int|theta|pi|alpha|beta|gamma|delta|Delta|lambda|mu|sigma|omega|cdot|times|leq|geq|neq|sin|cos|tan)\b[A-Za-z0-9_^{}+\-*/=().\\]*|[A-Za-z]\w*\s*(?:\^\{?[-+]?\w+\}?|_\{?[-+]?\w+\}?)/g;

export function hasMathMarkup(text: string | null | undefined): boolean {
  const value = text ?? "";
  if (!value.trim()) return false;

  if (findDelimitedMath(value, 0)) return true;
  if (COMMAND_PATTERN.test(value)) return true;
  return NOTATION_PATTERN.test(value);
}

export function MathTextPreview({ text, className }: { text: string; className?: string }) {
  const tokens = tokenizeMathText(text);

  return (
    <div className={["math-text-preview", className].filter(Boolean).join(" ")}>
      {tokens.map((token, index) => {
        if (token.kind === "text") {
          return <span key={index}>{token.value}</span>;
        }

        const renderError = () => (
          <span className="math-render-error">{token.value || "Invalid math"}</span>
        );

        return token.kind === "block" ? (
          <BlockMath key={index} math={token.value} renderError={renderError} />
        ) : (
          <InlineMath key={index} math={token.value} renderError={renderError} />
        );
      })}
    </div>
  );
}

export function MathPreviewField({
  label,
  value,
  previewEnabled,
  children,
  className,
}: MathPreviewFieldProps) {
  const showPreview = previewEnabled && hasMathMarkup(value);

  return (
    <div
      className={[
        "math-preview-field",
        showPreview ? "with-preview" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <label>
        {label}
        {children}
      </label>
      {showPreview ? (
        <aside className="math-preview-panel">
          <span className="math-preview-label">Preview</span>
          <MathTextPreview text={value} />
        </aside>
      ) : null}
    </div>
  );
}

export function QuestionMathSummaryPreview({
  question,
  previewEnabled,
  invalid,
}: {
  question: QuestionModel | null;
  previewEnabled: boolean;
  invalid?: boolean;
}) {
  if (!previewEnabled) return null;

  if (invalid) {
    return (
      <section className="math-preview-summary">
        <p className="math-preview-empty">Preview unavailable until JSON is valid.</p>
      </section>
    );
  }

  if (!question) return null;

  const sections = getQuestionMathPreviewSections(question);
  return (
    <section className="math-preview-summary">
      {sections.length > 0 ? (
        sections.map((section) => (
          <article key={section.label} className="math-preview-summary-item">
            <span className="math-preview-label">{section.label}</span>
            <MathTextPreview text={section.text} />
          </article>
        ))
      ) : (
        <p className="math-preview-empty">No math markup found in the parsed question.</p>
      )}
    </section>
  );
}

function getQuestionMathPreviewSections(question: QuestionModel): MathPreviewSection[] {
  const sections: MathPreviewSection[] = [];

  addSection(sections, "Prompt", question.prompt);
  addSection(sections, "Explanation", question.explanation);
  addSection(sections, "Sample Solution", question.sample_solution);
  addSection(sections, "Exemplar Answer", question.exemplar_answer);

  question.rubric.forEach((row, rowIndex) => {
    for (const [key, value] of Object.entries(row)) {
      if (key === "points") continue;
      addSection(sections, `Rubric ${rowIndex + 1} ${formatAnswerLabel(key)}`, value);
    }
  });

  const answer = question.answer ?? {};
  if (Array.isArray(answer.choices)) {
    answer.choices.forEach((choice, index) => addSection(sections, `Choice ${index + 1}`, choice));
  }

  for (const [key, value] of Object.entries(answer)) {
    if (key === "choices") continue;
    if (typeof value === "string") {
      addSection(sections, formatAnswerLabel(key), value);
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item === "string") {
          addSection(sections, `${formatAnswerLabel(key)} ${index + 1}`, item);
        }
      });
    }
  }

  return sections;
}

function addSection(sections: MathPreviewSection[], label: string, value: unknown) {
  if (typeof value !== "string" || !hasMathMarkup(value)) return;
  sections.push({ label, text: value });
}

function formatAnswerLabel(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function tokenizeMathText(text: string): MathToken[] {
  const tokens: MathToken[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const match = findDelimitedMath(text, cursor);
    if (!match) {
      pushTextWithBareMath(tokens, text.slice(cursor));
      break;
    }

    if (match.start > cursor) {
      pushTextWithBareMath(tokens, text.slice(cursor, match.start));
    }
    tokens.push({ kind: match.block ? "block" : "inline", value: match.value });
    cursor = match.end;
  }

  return tokens.length > 0 ? tokens : [{ kind: "text", value: text }];
}

function findDelimitedMath(
  text: string,
  fromIndex: number,
): { start: number; end: number; value: string; block: boolean } | null {
  const candidates = [
    findDelimitedPair(text, fromIndex, "$$", "$$", true),
    findDelimitedPair(text, fromIndex, "\\[", "\\]", true),
    findDelimitedPair(text, fromIndex, "\\(", "\\)", false),
    findDollarMath(text, fromIndex),
  ].filter((candidate): candidate is { start: number; end: number; value: string; block: boolean } =>
    Boolean(candidate),
  );

  if (candidates.length === 0) return null;
  return candidates.sort((left, right) => left.start - right.start)[0];
}

function findDelimitedPair(
  text: string,
  fromIndex: number,
  open: string,
  close: string,
  block: boolean,
): { start: number; end: number; value: string; block: boolean } | null {
  const start = text.indexOf(open, fromIndex);
  if (start === -1) return null;

  const contentStart = start + open.length;
  const closeIndex = text.indexOf(close, contentStart);
  if (closeIndex === -1) return null;

  const value = text.slice(contentStart, closeIndex).trim();
  if (!value) return null;
  return { start, end: closeIndex + close.length, value, block };
}

function findDollarMath(
  text: string,
  fromIndex: number,
): { start: number; end: number; value: string; block: boolean } | null {
  let start = text.indexOf("$", fromIndex);
  while (start !== -1) {
    if (text[start + 1] === "$" || isEscaped(text, start)) {
      start = text.indexOf("$", start + 1);
      continue;
    }

    const end = text.indexOf("$", start + 1);
    if (end === -1) return null;

    const value = text.slice(start + 1, end).trim();
    if (value && !CURRENCY_PATTERN.test(value)) {
      return { start, end: end + 1, value, block: false };
    }
    start = text.indexOf("$", end + 1);
  }

  return null;
}

function isEscaped(text: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function pushTextWithBareMath(tokens: MathToken[], text: string) {
  if (!text) return;

  let cursor = 0;
  for (const match of text.matchAll(BARE_MATH_PATTERN)) {
    const start = match.index ?? 0;
    const value = match[0].trim();
    if (!value) continue;
    if (start > cursor) {
      tokens.push({ kind: "text", value: text.slice(cursor, start) });
    }
    tokens.push({ kind: "inline", value });
    cursor = start + match[0].length;
  }

  if (cursor < text.length) {
    tokens.push({ kind: "text", value: text.slice(cursor) });
  }
}
