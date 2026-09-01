# Stack Exchange source fixtures

These hand-sanitized snapshots represent timestamp shapes observed on live
Stack Overflow and Super User pages on 2026-08-29. Tests load them offline;
they are not a promise that third-party markup will remain stable.

| Fixture | Source | Expected behavior |
| --- | --- | --- |
| `questions.html` | <https://stackoverflow.com/questions> and <https://superuser.com/questions> | Process recognized relative `span.relativetime[title]` labels in place. |
| `question.html` | <https://stackoverflow.com/questions/11227809/> | Combine question, activity, comment, and user-card title sources with the generic `time[datetime]` fallback. |
| `eligibility-matrix.html` | Synthetic trust boundaries | Process only approved shapes with strict explicit-zone timestamps and recognized relative labels; keep absolute labels unchanged. |
