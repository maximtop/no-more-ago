# Telegram fixtures

These hand-minimized fixtures represent public Telegram channel and Telegram
Web K timestamp shapes inspected on 2026-08-29. Tests load them only from disk;
they never contact Telegram.

All channel names, routes, labels, counts, timestamps, and surrounding content
are fictional. The fixtures contain no copied message text, author names, chat
or message identifiers, credentials, or authenticated URLs.

| Fixture | Observed surface | Expected behavior |
| --- | --- | --- |
| `public-channel.html` | Public `https://t.me/s/*` markup | Process only the complete zoned standard `time[datetime]` source through the generic rule. |
| `web-k-chat.html` | Telegram Web K ordinary message footers | Process the ordinary direct clock in place while preserving edited, count, and status nodes. |
| `web-k-eligibility-matrix.html` | Synthetic Web K trust boundaries | Process only the one structurally proven send-time clock and leave ambiguous or malformed shapes unchanged. |

Telegram owns this third-party markup and may change it independently. These
fixtures document the currently supported best-effort contract; they are not a
promise of compatibility with future markup.
