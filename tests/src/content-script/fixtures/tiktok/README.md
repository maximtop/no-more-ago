# TikTok fixtures

These hand-minimized fixtures represent the TikTok profile-card, direct video,
direct photo, and universal hydration shapes inspected on 2026-08-30. Tests
load them only from disk and never contact TikTok.

All handles, labels, IDs, media descriptions, routes, and hydration records are
synthetic. The 19-digit IDs are deterministic values constructed from selected
Unix seconds and arbitrary low bits. The fixtures contain no copied media,
captions, authors, credentials, cookies, authenticated URLs, or personal data.

| Fixture | Contract |
| --- | --- |
| `direct-video.html` | Prefer matching `createTime` in the legacy direct metadata shape. |
| `direct-feed-video.html` | Replace only the current publication's simple author-row date in the direct feed shape. |
| `direct-photo.html` | Prefer matching `createTime` across a UTC day boundary. |
| `profile.html` | Append one owned date per unambiguous video/photo link and use ID fallback when the matching hydration record is absent. |
| `eligibility-matrix.html` | Reject ambiguous/complex TikTok shapes while retaining generic `time[datetime]` behavior. |

TikTok owns the production markup and may change it independently. These
fixtures document only the observed best-effort contract and do not promise
future compatibility.
