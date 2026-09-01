# X/Twitter public-surface fixtures

These hand-authored fixtures are deterministic, minimal representations of
the public light-DOM shapes named by the feature brief. They use fictional
accounts, paths, post IDs, text, and dates. They contain no live response,
authentication data, direct-message content, tracking data, scripts, or
network requests.

| Surface | Fixture | Eligible sources | Expected path |
| --- | --- | --- | --- |
| Feed | `feed.html` | `feed-post` | `generic-time` |
| Individual post | `individual-post.html` | — | No-op (absolute label) |
| Thread | `thread.html` | `thread-root`, `thread-reply-one`, `thread-reply-two` | `generic-time` |
| Quoted post | `quoted-post.html` | `quoted-outer`, `quoted-inner` | `generic-time` |
| Nested public card | `nested-card.html` | `card-outer`, `card-inner-offset` | `generic-time` |

The fixture test replays every surface under final `x.com` and `twitter.com`
URLs. Redirect transport is not simulated; after a redirect, the runtime uses
the URL of the final loaded document, which is represented by the `x.com`
case.

## Support verdict

The eligible sources in four fixtures are standard `time[datetime]` elements
with relative labels and pass through the production universal source. The
individual-post fixture carries a standard timestamp with an absolute label and
remains unchanged. The deterministic matrix therefore requires no
X/Twitter-specific source rule. A future specialized rule is justified only by
a preserved failing fixture that exposes an explicit, unambiguous timestamp
unavailable to the universal source.

This is best-effort compatibility evidence for the named public light-DOM
surfaces. It does not cover direct messages, private content, Shadow DOM,
third-party clients, future markup, or the supplemental current-site smoke
check.
