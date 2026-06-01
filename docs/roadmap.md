# Nexzam Roadmap

## Phase 0 — Foundation

- Initialize repository shape.
- Add architecture/schema docs and sample bank files.
- Prepare frontend/backend/Tauri directories.

## Phase 1 — Package + Schema

- Implement create/open/save `.bok`.
- Unpack/repack workflow.
- Manifest + question validation.
- Initial question types (MCQ, numeric, short, free response).

## Phase 2 — Browser + Editor — Complete

- Question browser with filters/search.
- Editor with form + raw JSON tabs.
- Edit an existing question directly as raw JSON in the question editor.
- Create or replace a question by pasting entirely new JSON into the question editor.
- Provide explicit question-level Save, Save as New with automatic type-based id assignment, Revert, and JSON formatting actions.
- Make AI-generated question JSON easy to paste, validate, and add as new questions.
- Asset attach/copy workflow.
- Bank asset browser with usage visibility.
- KaTeX preview for question text, answers, sample solutions, explanations, and free-response rubric criteria.
- SVG token replacement preview.

## Current milestone snapshot

- Milestone 2: desktop-native open/edit/save `.bok` flow is in place.
- Milestone 3: authoring basics are in place, including form editing, raw JSON editing, explicit question saves, Save as New, Revert, JSON formatting, type-based new ids, and backend test coverage for core question workflows.
- Milestone 4: asset management is in place for attach/copy, preview, bank-wide browsing, usage visibility, and SVG token replacement preview.
- Phase 2 evaluation: complete for the current browser/editor scope. Remaining work should move into Phase 3 import, Phase 4 print prep, or a later SVG authoring milestone rather than expanding Phase 2.
- Next planning track: JSON/CSV import staging, followed by print-prep test drafts and later native SVG authoring with simple shapes, style controls, placeholders, and reusable teaching elements.

## Phase 3 — Import

- JSON import.
- CSV staging + validation flow.
- Promote staged items to real questions.

## Phase 4 — Print Prep

- Test draft model.
- Manual question selection.
- HTML-to-PDF output.

## Phase 5 — Builder

- Auto-builder with constraints.
- Topic/type/difficulty balancing.
- Swap and regenerate suggestions.
