# Hacker News fixtures

These hand-sanitized snapshots come from unauthenticated Hacker News pages
observed on 2026-08-28. Tests never fetch them; future markup compatibility is
best-effort.

| Fixture | Source | Expected specialized result |
| --- | --- | --- |
| `list.html` | <https://news.ycombinator.com/news> | Linked age eligible |
| `discussion.html` | <https://news.ycombinator.com/item?id=49476604> | Comment age eligible |
| `absolute.html` | Observed `span.age[title]` absolute-label variant | Existing absolute label remains unchanged |
| `profile.html` | <https://news.ycombinator.com/user?id=eterevsky> | Profile prose remains unchanged |
| `eligibility-matrix.html` | Synthetic boundary matrix | Three specialized sources and one generic source eligible |
