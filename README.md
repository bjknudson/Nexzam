# Nexzam

Nexzam is a **desktop-first, local-first** question bank and test-building app.

## Core stack

- **Tauri** desktop shell
- **React + TypeScript + Vite** frontend
- **Python + FastAPI + Pydantic** backend
- **`.bok`** as the source-of-truth package format from day one

## Product goals

### v1
1. Create/open/save `.bok`
2. Browse and filter questions
3. Edit questions and metadata
4. Attach and manage SVG/image assets

### v2
1. JSON + CSV import workflows
2. Test assembly
3. Auto-builder by topic/type/difficulty
4. Printable PDF export

## `.bok` package layout

`.bok` files are zip packages with this internal structure:

```text
mybank.bok
├── manifest.json
├── bank.json
├── standards/
│   ├── source_lists.json
│   └── records.json
├── courses/
│   └── courses.json
├── questions/
│   ├── q_mc_0001.json
│   ├── q_num_0001.json
│   └── q_fr_0001.json
├── assets/
│   ├── fig_shm_01.svg
│   ├── graph_kin_01.svg
│   └── photo_01.jpg
├── imports/
│   └── source_questions.csv
└── meta/
    └── audit_log.json
```

## Required question fields (v1)

- `id`
- `type`
- `topic`
- `difficulty`
- `prompt`

## Vertical slice status

This repo now includes a first working vertical slice for:

- opening a `.bok` archive
- unpacking it to a managed working directory
- browsing and filtering questions
- editing one question in form mode or raw JSON mode
- saving raw JSON edits explicitly, formatting JSON, reverting edits, and saving pasted JSON as a new question
- assigning new question ids by question type and next serial number
- previewing LaTeX/math with KaTeX without changing stored question JSON
- attaching multiple SVG/image assets to a question
- previewing attached SVGs with live placeholder controls
- browsing bank-wide assets with previews and usage counts
- saving form edits back to the unpacked working copy
- repacking the bank into `.bok`
- launching the backend automatically from the Tauri shell
- using native desktop open/save dialogs for `.bok` files
- showing working-copy vs archive-save state in the UI
- running backend workflow tests with pytest

## Updated repo layout

```text
nexzam/
├── README.md
├── AGENTS.md
├── app/
│   ├── backend/
│   │   ├── main.py
│   │   ├── models.py
│   │   ├── requirements-dev.txt
│   │   ├── requirements.txt
│   │   ├── service.py
│   │   └── tests/
│   └── frontend/
│       ├── package.json
│       ├── src/
│       │   ├── App.tsx
│       │   ├── MathPreview.tsx
│       │   ├── api.ts
│       │   ├── main.tsx
│       │   ├── react-katex.d.ts
│       │   ├── styles.css
│       │   └── types.ts
│       └── vite.config.ts
├── src-tauri/
│   ├── Cargo.toml
│   ├── src/main.rs
│   └── tauri.conf.json
├── docs/
├── samples/
│   ├── demo-bank/
│   └── demo-bank.bok
└── scripts/
```

## Sample package artifact

Build the sample archive with:

```bash
python3 scripts/build_demo_bok.py
```

The generated archive is written to `samples/demo-bank.bok`.

## Demo content

The demo bank includes five questions across:

- `multiple_choice`
- `numeric_response`
- `short_answer`
- `free_response`

## Backend setup

Install backend dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r app/backend/requirements.txt
```

For backend test development, install the dev requirements:

```bash
python3 -m pip install -r app/backend/requirements-dev.txt
```

Run the API from the repo root:

```bash
python3 -m uvicorn app.backend.main:app --reload
```

API endpoints included in this slice:

- `GET /health`
- `GET /api/health`
- `POST /api/banks/open`
- `POST /api/banks/open-demo`
- `GET /api/banks/current`
- `POST /api/banks/save`
- `GET /api/questions`
- `GET /api/questions/next-id?type={question_type}`
- `POST /api/questions`
- `POST /api/questions/from-json`
- `GET /api/questions/{question_id}`
- `PUT /api/questions/{question_id}`
- `DELETE /api/questions/{question_id}`
- `GET /api/standards/source-lists`
- `GET /api/standards`
- `POST /api/standards/import`
- `GET /api/courses`
- `PUT /api/courses/{course_id}`
- `POST /api/courses/{course_id}/standards/{standard_id}`
- `DELETE /api/courses/{course_id}/standards/{standard_id}`
- `GET /api/assets`
- `POST /api/assets/upload`
- `POST /api/assets/inspect`
- `GET /api/assets/file`

## Testing

Run the backend pytest suite from the repo root:

```bash
source .venv/bin/activate
python3 -m pytest
```

Useful broader verification commands:

```bash
python3 -m compileall app/backend/main.py app/backend/models.py app/backend/service.py
cd app/frontend && npm run build
cd ../../src-tauri && cargo check
cargo test wait_for_healthcheck
```

## Milestone status

- `Phase 2` complete for the current browser/editor scope.
- `Milestone 2` complete: desktop-native open/edit/save `.bok` flow is in place.
- `Milestone 3` complete for authoring basics: form editing, raw JSON editing, explicit question saves, Save as New, Revert, JSON formatting, type-based new ids, and backend workflow tests are in place.
- `Milestone 4` complete for asset management basics: question asset attach/copy, SVG/image preview, live SVG variable controls, bank-wide asset browsing, usage visibility, and SVG token replacement preview are implemented.
- Next planning track: JSON/CSV question import staging, print-prep test drafts, then later native SVG authoring.

## Frontend setup

Prerequisites:

- Node.js 20+
- npm 10+

Install and run the frontend:

```bash
cd app/frontend
npm install
npm run dev
```

The Vite dev server runs on `http://127.0.0.1:5173` and proxies `/api` to the backend on port `8000` in browser-only dev.

## Standards import format

CSV headers:

- required: `id` or `standard_id`, `code`, `statement`
- optional: `subject`, `grade_band`, `tags`

JSON formats accepted:

- an array of standard objects
- `{ "items": [...] }`
- `{ "source_list": { ... }, "standards": [...] }`

CSV imports require source-list metadata alongside the file. JSON imports can provide that metadata either in the file or in the import form.

## Browser dev flow

If you want to run the frontend in a browser without Tauri:

1. Start the backend yourself:

```bash
python3 -m uvicorn app.backend.main:app --reload --port 8000
```

2. Start the frontend:

```bash
cd app/frontend
npm install
npm run dev
```

3. Open `http://localhost:5173`

In browser-only dev, manual path fields remain available as a fallback.

## Tauri dev shell

Prerequisites:

- Rust toolchain
- Tauri CLI
- Xcode command line tools on macOS

Recommended local setup:

- create a repo-root virtualenv at `.venv`
- install backend requirements into that virtualenv
- install frontend dependencies in `app/frontend`

Then start the desktop shell from `app/frontend`:

```bash
npm install
npm run tauri:dev
```
The `tauri:dev` script enters `src-tauri/` before invoking the Tauri CLI, so the CLI, config, and build hooks all resolve paths from the same place.

What the desktop shell now does:

- starts the Python backend automatically
- waits for the backend health check before enabling the UI
- exposes the backend base URL to the frontend
- opens native macOS open/save dialogs for `.bok`
- warns on close if the working copy has changes not yet written to the archive

## Working flow

1. Build `samples/demo-bank.bok`.
2. Launch either the browser dev flow or the Tauri shell.
3. Click `Open Bank` to choose a `.bok`, or `Open Demo Bank`.
4. Select a question and edit it in form mode or raw JSON mode.
5. Form edits autosave to the unpacked working copy.
6. Raw JSON edits use explicit `Save`, `Save as New`, `Revert`, and `Format JSON` actions.
7. Click `Save Bank` to write the `.bok` archive, or `Save As` to write a new archive path.

## Save model

Nexzam now distinguishes two save layers:

- `Working copy`: unpacked files in the managed workspace. Form edits autosave here; raw JSON edits save here only when explicitly requested.
- `Archive`: the `.bok` zip file on disk. `Save Bank` writes this layer.

The top bar shows:

- current archive path
- whether a workspace is open
- whether the working copy is autosaved
- whether the archive still needs `Save Bank`

## Verification run for this milestone

Verified locally in this repo:

- `python3 -m pytest`
- `python3 -m compileall app/backend/main.py app/backend/models.py app/backend/service.py`
- `npx tsc -p tsconfig.json --noEmit` in `app/frontend`
- `npm run build` in `app/frontend`
- `cargo check` in `src-tauri`
- `cargo test wait_for_healthcheck` in `src-tauri`

## Unfinished edges

- The desktop launcher assumes a local development checkout and prefers repo-root `.venv/bin/python3`, falling back to `python3`. Packaged-app Python bundling is not implemented yet.
- Browser-only dev still uses manual path fallback because native dialogs are wired through Tauri commands.
- There is no automated migration layer yet; validation is strict against the current v1 schema.
