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

## Repo layout

```text
nexzam/
├── README.md
├── AGENTS.md
├── app/
│   ├── frontend/
│   └── backend/
├── src-tauri/
├── docs/
├── samples/
└── scripts/
```


## Sample package artifact

To avoid binary-file PR limitations, `samples/demo-bank.bok` is generated locally and is not committed.

Build it with:

```bash
python scripts/build_demo_bok.py
```

## Current status

This repository currently provides project scaffolding, format/schema documentation, and sample data for milestone 1 planning.
