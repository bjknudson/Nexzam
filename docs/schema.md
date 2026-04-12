# Nexzam Schema (Milestone 1 Draft)

## Package-level files

- `manifest.json`: package metadata and schema/version info.
- `bank.json`: index and high-level bank metadata.
- `questions/*.json`: one file per question.
- `assets/*`: copied image/SVG assets.
- `imports/*`: imported source files and staging references.
- `meta/*`: audit and maintenance metadata.

## Manifest shape (draft)

```json
{
  "schema_version": "1.0.0",
  "bank_id": "demo-bank",
  "title": "Physics 1",
  "created_at": "2026-04-11T00:00:00Z",
  "updated_at": "2026-04-11T00:00:00Z",
  "difficulty_labels": {
    "1": "easy",
    "2": "easy-medium",
    "3": "medium",
    "4": "medium-hard",
    "5": "hard"
  }
}
```

## Question types (v1)

- `multiple_choice`
- `numeric_response`
- `short_answer`
- `free_response`

## Required question fields

- `id`
- `type`
- `topic`
- `difficulty`
- `prompt`

## Additional supported fields

- `subtopic`
- `tags`
- `standards`
- `estimated_time_sec`
- `points`
- `status`
- `teacher_notes`
- `answer`
- `explanation`
- `rubric`
- `sample_solution`
- `assets`

## Asset metadata (draft)

Support static and parameterized SVG metadata:

```json
{
  "path": "assets/fig_shm_01.svg",
  "kind": "svg",
  "svg_variables": {
    "label": "A",
    "mass": "2kg"
  }
}
```

`svg_variables` keys map to token placeholders like `{{label}}` in source SVG templates.

Questions may attach more than one asset by adding multiple entries to the `assets` array.

## Validation principles

- Validate on open/import/save.
- Keep persisted field names stable.
- Prefer additive schema evolution.
