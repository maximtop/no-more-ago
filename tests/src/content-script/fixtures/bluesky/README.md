# Bluesky public-surface fixtures

These hand-authored fixtures are deterministic, minimized representations of
the public `bsky.app` light-DOM contracts observed on 2026-08-31. They use only
fictional handles, DIDs, record keys, labels, post text, and timestamps.

The fixtures contain no live responses, account data, authentication data,
scripts, tracking values, or network requests. Localized `aria-label` and
`data-tooltip` values are presentation-only test data and are never trusted as
timestamp input.

| Surface | Fixture | Expected relative targets |
| --- | --- | --- |
| Feed | `feed.html` | Two placements of one post and one distinct post |
| Profile activity | `profile.html` | One profile post |
| Individual post | `post.html` | Two replies; the expanded root stays exact |
| Thread | `thread.html` | Root metadata and two replies |
| Quoted post | `quoted-post.html` | One outer post and one plain quote label |

These fixtures preserve the observed structural contract for deterministic
testing. They do not promise compatibility with future Bluesky markup, private
content, nested quote chains, third-party clients, native apps, or Shadow DOM.
