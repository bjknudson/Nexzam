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
- saving question edits back to disk
- repacking the bank into `.bok`

## Updated repo layout

```text
nexzam/
├── README.md
├── AGENTS.md
├── app/
│   ├── backend/
│   │   ├── main.py
│   │   ├── models.py
│   │   ├── requirements.txt
│   │   └── service.py
│   └── frontend/
│       ├── package.json
│       ├── src/
│       │   ├── App.tsx
│       │   ├── api.ts
│       │   ├── main.tsx
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

Run the API from the repo root:

```bash
python3 -m uvicorn app.backend.main:app --reload
```

API endpoints included in this slice:

- `POST /api/banks/open`
- `POST /api/banks/open-demo`
- `GET /api/banks/current`
- `POST /api/banks/save`
- `GET /api/questions`
- `GET /api/questions/{question_id}`
- `PUT /api/questions/{question_id}`

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

The Vite dev server runs on `http://127.0.0.1:5173` and proxies `/api` to the backend on port `8000`.

## Tauri dev shell

Prerequisites:

- Rust toolchain
- Tauri CLI
- Xcode command line tools on macOS

With the backend running separately, start the desktop shell from `app/frontend`:

```bash
npm install
npm run tauri dev
```

If you prefer, you can also use the browser dev flow with the Vite frontend and FastAPI backend only.

## Working flow

1. Build `samples/demo-bank.bok`.
2. Start the backend.
3. Start the frontend.
4. Click `Open Demo Bank`, or paste an absolute `.bok` path into the top bar and open it.
5. Select a question, edit it in form mode or raw JSON mode, save the question, then save the bank.

## Unfinished edges

- Tauri is scaffolded, but backend process supervision is not yet wired into the Rust shell; run FastAPI separately in this slice.
- The open flow currently uses a demo-bank shortcut or typed file path instead of a native macOS file picker.
- There is no automated migration layer yet; validation is strict against the current v1 schema.
