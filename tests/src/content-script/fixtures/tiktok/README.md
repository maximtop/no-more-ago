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
| `direct-video.html` | Leave the absolute legacy direct label unchanged even when matching `createTime` exists. |
| `direct-video-relative.html` | Replace the relative legacy direct label with matching `createTime`. |
| `direct-feed-video.html` | Leave the absolute author-row label unchanged. |
| `direct-feed-video-relative.html` | Replace only the current publication's relative author-row label. |
| `direct-photo.html` | Leave the absolute photo label unchanged even when matching `createTime` crosses a UTC day boundary. |
| `profile.html` | Leave profile cards unchanged because they expose no page-owned timestamp label. |
| `eligibility-matrix.html` | Leave profile-card shapes unchanged while retaining relative generic `time[datetime]` behavior. |

TikTok owns the production markup and may change it independently. These
fixtures document only the observed best-effort contract and do not promise
future compatibility.
