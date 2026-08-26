# GitHub source fixtures

These are small, hand-sanitized, static snapshots captured on 2026-08-24 from
the unauthenticated HTTP responses listed below. Tests load them offline; they
do not fetch the URLs or treat these snapshots as a promise of future GitHub
markup compatibility. The original responses were saved only in a temporary
task directory and are not repository fixtures.

| Category | Source URL | Sanitization | Expected outcome |
| --- | --- | --- | --- |
| Commits | <https://github.com/github/docs/commit/4f8c3170cea7f72cf41fc976f5dbf4e8a0b8567f> | No approved relative-time element was present in the unauthenticated response; retained a small surrounding commit marker. | No-op |
| Issues/pull requests | <https://github.com/github/docs/pulls> | Retained one observed `relative-time` and its enclosing link; removed page chrome. | Eligible |
| Timelines | <https://github.com/github/docs/issues/45593> | Retained one observed relative-time without `datetime` and its enclosing link; no attribute was added. | No-op |
| Releases/tags | <https://github.com/github/docs/releases> | Retained one observed `relative-time` with an explicit zoned value and its link; omitted unrelated release markup. | Eligible |
| Profiles/activity | <https://github.com/github> | Retained one observed activity `relative-time` and surrounding activity link. | Eligible |
| Search | <https://github.com/search?q=repo%3Agithub%2Fdocs+is%3Aissue+45593&type=issues> | No approved relative-time element was present in the unauthenticated response; retained a small result marker. | No-op |
| Actions | <https://github.com/github/docs/actions/runs/32653376977> | Retained one observed `relative-time` and its enclosing run link. | Eligible |

The synthetic `eligibility-matrix.html` is independent of these source
observations and supplies exhaustive positive and negative eligibility cases.
