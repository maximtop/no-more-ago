# LinkedIn Fixtures

These offline fixtures are reduced, synthetic representations of the LinkedIn
DOM relationships observed during the 2026-08-30 feasibility investigation.
They contain no copied profile names, post text, authentication data, tracking
payloads, or real account identifiers.

Each 19-digit ID is synthetic. Its upper bits encode the documented UTC instant
used by the tests, and its lower 22 bits contain a small non-zero sequence:

| Kind | ID | Decoded UTC instant |
| --- | --- | --- |
| activity | `7147784590025818113` | `2024-01-02T03:04:05.678Z` |
| ugcPost | `7159396357537529858` | `2024-02-03T04:05:06.789Z` |
| share | `7170283349280292867` | `2024-03-04T05:06:07.891Z` |
| comment | `7181895116414517252` | `2024-04-05T06:07:08.912Z` |
| comment reply | `7193144492285755397` | `2024-05-06T07:08:09.123Z` |

Relative labels are presentation-only test values. No test derives an instant
from them. The fixtures are intentionally offline because LinkedIn markup and
ID encoding are undocumented best-effort compatibility surfaces.
