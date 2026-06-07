# Nexzam Schema (Milestone 1 Draft)

## Package-level files

- `manifest.json`: package metadata and schema/version info.
- `bank.json`: index and high-level bank metadata.
- `questions/*.json`: one file per question.
- `standards/source_lists.json`: complete imported source standard sets.
- `standards/records.json`: explicit standard records referenced by courses and questions.
- `courses/courses.json`: course-specific standard curation as references.
- `tests/tests.json`: additive test draft collection for print-prep workflows.
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

## Standards collections (draft)

Source standard lists are preserved as complete imported reference sets:

```json
{
  "items": [
    {
      "id": "physics-core-2026",
      "title": "Physics Core Standards",
      "issuer": "Nexzam Sample Curriculum",
      "subject": "Physics",
      "version": "2026.1",
      "description": "Sample complete reference set for introductory physics topics.",
      "imported_at": "2026-04-11T00:00:00Z"
    }
  ]
}
```

Standard records stay explicit and are referenced by id:

```json
{
  "items": [
    {
      "id": "PHY-KIN-01",
      "source_list_id": "physics-core-2026",
      "code": "PHY-KIN-01",
      "statement": "Apply constant-acceleration relationships to one-dimensional motion."
    }
  ]
}
```

Courses store curated references rather than duplicate standard text:

```json
{
  "items": [
    {
      "id": "physics-1",
      "title": "Physics 1",
      "description": "Sample course curation.",
      "standard_refs": [
        {
          "standard_id": "PHY-KIN-01"
        }
      ]
    }
  ]
}
```

## Standards import formats

CSV headers supported:

- required: `id` or `standard_id`, `code`, `statement`
- optional: `subject`, `grade_band`, `tags`

JSON imports may be:

- an array of standards
- an object with `items`
- an object with `source_list` and `standards`

Imported source files may be copied into `imports/` for reference alongside the normalized standards collections.

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
Numeric geometry can also use simple expressions such as `{{calc: 60 - arrow_length}}`, referencing values from the same `svg_variables` map.

Questions may attach more than one asset by adding multiple entries to the `assets` array.

Question standards should be stored as references:

```json
[
  {
    "standard_id": "PHY-KIN-01"
  }
]
```

## Test drafts (Phase 4 draft)

Test drafts are stored separately from question records so questions remain the reusable source of truth:

```json
{
  "items": [
    {
      "id": "test_0001",
      "title": "Unit 1 Mechanics",
      "version": "A",
      "items": [
        {
          "question_id": "q_mc_0001",
          "experimental": false,
          "response_space_lines": null,
          "teacher_notes": null
        },
        {
          "item_type": "section",
          "section_id": "section_1",
          "question_type": "multiple_choice",
          "title": "Multiple Choice",
          "instructions": "Select the best answer.",
          "header_template": "{{section_title}}\n{{instructions}}\n{{topic}}\n{{standards}}\n{{time}}",
          "topic": "Linear motion",
          "standards": ["PHY-KIN-01"],
          "suggested_time_mode": "calculated",
          "suggested_time_sec": null
        }
      ],
      "print_settings": {
        "cover_sheet_enabled": true,
        "cover_sheet_template": null,
        "page_header": {
          "template": "{{title}}\nVersion {{version}}    {{date}}",
          "alignment": "center",
          "horizontal_line": true,
          "spacing_after_lines": 1
        },
        "name_field": {
          "template": "Name: ______________________________",
          "alignment": "left",
          "horizontal_line": false,
          "spacing_after_lines": 1
        },
        "typeface": "system",
        "font_size_pt": 11,
        "margin_in": 0.75,
        "page_size": "letter",
        "columns": 1,
        "name_field_enabled": true,
        "page_numbers_enabled": true,
        "default_response_space_lines": 0,
        "instruction_section_options": {
          "show_topic": false,
          "show_standards": false,
          "show_suggested_time": true,
          "alignment": "left",
          "horizontal_line": true,
          "spacing_after_lines": 1
        },
        "instruction_sections": [
          {
            "question_type": "multiple_choice",
            "title": "Multiple Choice",
            "instructions": "Select the best answer.",
            "header_template": "{{section_title}}\n{{instructions}}\n{{topic}}\n{{standards}}\n{{time}}",
            "show_topic": false,
            "show_standards": false,
            "show_suggested_time": true,
            "suggested_time_mode": "calculated",
            "suggested_time_sec": null
          }
        ]
      },
      "performance_runs": []
    }
  ]
}
```

Test items can be question references or explicit section headers. Older question-only test items remain valid without `item_type`; section items use `item_type: "section"` and can be reordered with questions. If a manual section is linked to a `question_type`, the printable preview can reuse that style's default instructions and suppress the immediately repeated automatic style header.

Template blocks use plain text with placeholders. Current placeholders include `{{title}}`, `{{version}}`, `{{date}}`, `{{section_title}}`, `{{instructions}}`, `{{topic}}`, `{{standards}}`, and `{{time}}`.

Performance runs are kept on the test draft as local post-use records:

```json
{
  "id": "run_20260601_a",
  "administered_at": "2026-06-01T17:00:00Z",
  "cohort_label": "Period 2",
  "notes": "First use after review lesson.",
  "item_results": [
    {
      "question_id": "q_mc_0001",
      "attempts": 28,
      "correct": 19,
      "average_score": null,
      "observed_difficulty": 3.4,
      "tricky": true,
      "notes": "Many students missed the sign convention."
    }
  ]
}
```

## Validation principles

- Validate on open/import/save.
- If a question or course references a standard id that is missing from `standards/records.json`, create a placeholder standard record in the unpacked working copy under `unresolved-question-standards` with `placeholder` and `needs-review` tags. This keeps the bank open and makes the issue visible without dropping the reference.
- Keep persisted field names stable.
- Prefer additive schema evolution.
