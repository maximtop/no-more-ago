# YouTube source fixtures

The structural paths represented by these fixtures were observed in an
unauthenticated public YouTube watch response on 2026-08-29. They retain only
the approved `ytInitialPlayerResponse` assignment, `datePublished` metadata,
and watch publication label needed by the source contract. Unrelated markup,
identifiers, and payload fields were removed.

`watch-calendar-date.html` isolates metadata fallback behavior.
`watch-local-sources.html` deliberately contains a loaded zoned instant and a
different valid metadata calendar date so tests can prove source precedence.
The retained video ID, timestamps, and visible labels are synthetic values,
not copied publication data.

The loaded assignment is intentionally far below the production parser's
2,000,000-character bound. Tests read both fixtures only from the repository,
replace the global fetch boundary with a synchronously throwing fake, and
assert that it has zero calls after every case. Fixture maintenance must remain
strictly offline; do not refresh these documents from YouTube during tests.

## Modern Home negative qualification

The `3-AFK` evidence ledger records one sanitized capture at
`2026-08-29T20:04:02.900Z` on canonical desktop Home
(`https://www.youtube.com/`). The loaded page contained 22 video lockup
records. Six rendered cards were inspected, and each card's watch-link
identity and visible relative label matched the corresponding loaded record.
None of those records contained an approved explicit calendar date or zoned
instant.

`home-modern-relative-only.html` is a minimized derivative of that ledger. It
retains the `ytd-rich-item-renderer` and nested `yt-lockup-view-model` card
shells, watch links, observed relative-label class, and the loaded path:

~~~text
contents.twoColumnBrowseResultsRenderer.tabs[]
  .tabRenderer.content.richGridRenderer.contents[]
  .richItemRenderer.content.lockupViewModel
~~~

Only aliases `testVID0001` through `testVID0006`, their matching synthetic
relative labels, `contentId`, `LOCKUP_CONTENT_TYPE_VIDEO`, and the loaded text
and accessibility-label relationships remain. Titles, creators, thumbnails,
views, recommendations, tracking values, cookies, tokens, headers, account
data, the other 16 records, and every unrelated response branch are omitted.

The fixture documents only the captured modern lockup's
`unsupported-local` result. Synthetic adversarial fields and watch-only
sources are test mutations, not observations and not trusted provenance. The
result does not qualify other Home experiments, routes, or future markup.

## Legacy Search negative qualification

The `4-AFK` evidence ledger records one sanitized capture at
`2026-08-29T21:55:22.748Z` on canonical desktop Search with the real query
redacted:

~~~text
https://www.youtube.com/results?search_query=<redacted>
~~~

The capture joined records at this exact loaded main-result path:

~~~text
contents.twoColumnSearchResultsRenderer.primaryContents
  .sectionListRenderer.contents[]
  .itemSectionRenderer.contents[].videoRenderer
~~~

Each admitted DOM relationship was established by identity and label, never
by array position:

~~~text
ytd-video-renderer
  a#video-title[href*="/watch?v="] -> videoRenderer.videoId
  #metadata-line > span:nth-of-type(2).inline-metadata-item.ytd-video-meta-block
    -> videoRenderer.publishedTimeText.simpleText
~~~

The captured loaded set contained 16 direct `videoRenderer` records. The DOM
contained 19 `ytd-video-renderer` identities: 16 had exact identity and label
joins to that loaded set, while three were excluded because they were outside
the admitted main-record relationship. All 16 joined publication values were
relative. A complete scan found no strict calendar date, explicitly zoned
instant, or other approved publication value.

`search-legacy-relative-only.html` is a minimized derivative retaining these
six synthetic pairs:

- `testVID0001` -> `3 days ago`
- `testVID0002` -> `2 weeks ago`
- `testVID0003` -> `4 months ago`
- `testVID0004` -> `1 year ago`
- `testVID0005` -> `5 years ago`
- `testVID0006` -> `8 hours ago`

The fixture also retains two empty `gridShelfViewModel` outer shapes, one
empty loaded `shelfRenderer`, and one empty DOM `ytd-shelf-renderer`. Empty
mixed shells carry no nested identity or eligibility. The three excluded DOM
identities are not copied or invented.

Titles, creators, thumbnails, view counts, recommendations, tracking values,
the raw query, source URLs, cookies, tokens, authorization or other headers,
account data, executable page assignments, and every unrelated response
branch are omitted. The fixture and its tests must remain offline. Synthetic
absolute-looking values, nested identities, and other adversarial mutations
are tests rather than observations and do not establish source trust. This
fixture qualifies only the captured legacy main-result shape as
`unsupported-local`; it does not qualify shelves, other Search experiments,
future markup, or all list surfaces.

## Modern Channel Videos negative qualification

The `5-AFK` evidence ledger records one sanitized capture at
`2026-08-30T08:44:55.960Z` on canonical desktop Channel Videos:

~~~text
https://www.youtube.com/@<redacted>/videos
~~~

The selected Videos tab contained 31 direct loaded outer entries below this
path:

~~~text
contents.twoColumnBrowseResultsRenderer.tabs[]
  .tabRenderer.content.richGridRenderer.contents[]
~~~

Thirty entries ended in
`richItemRenderer.content.lockupViewModel`; one was an outer
`continuationItemRenderer`. The document contained 30
`yt-lockup-view-model` cards. Every loaded `contentId` joined exactly one DOM
watch identity, and every visible publication label joined exactly one loaded
relative `text.content` value in that identity-matched record.

The visible publication was a `span` inside
`.ytContentMetadataViewModelMetadataRow` with this complete class set:

~~~text
ytAttributedStringHost
ytAttributedStringLinkInheritColor
ytAttributedStringWhiteSpacePreWrap
ytContentMetadataViewModelMetadataText
ytContentMetadataViewModelMetadataTextLastPart
~~~

The loaded `text` object contained only `content`. Six captured records placed
that part at `metadataRows[0].metadataParts[1]`; 24 placed it at
`metadataRows[1].metadataParts[1]`. The minimized fixture retains three
examples of each evidenced variant:

- `chanVID0001` -> `4 hours ago` at row 0
- `chanVID0002` -> `2 days ago` at row 0
- `chanVID0003` -> `3 weeks ago` at row 0
- `chanVID0004` -> `5 months ago` at row 1
- `chanVID0005` -> `1 year ago` at row 1
- `chanVID0006` -> `6 years ago` at row 1

`channel-videos-modern-relative-only.html` also retains one empty loaded
`continuationItemRenderer` and one empty DOM
`ytd-continuation-item-renderer`. No endpoint or trigger value is retained.
The fixture's minimal relative anchors encode the already-established
sanitized identity equality; they are not a captured production selector and
do not authorize one.

All 30 publication values were relative. A complete scan found no strict
calendar date, explicitly zoned instant, or other approved absolute
publication value. The unrelated boolean overlay key
`replicateAsTimestamp` is omitted because it is not publication provenance.

The other 24 lockups, raw channel and video identities, titles, creators,
avatars, thumbnails, counts, recommendations, tracking and continuation
values, source URLs, headers, page-body values, cookies, tokens, storage,
account data, executable assignments, and unrelated branches are omitted.
Maintenance must remain offline. Synthetic absolute-looking values, moved or
duplicated rows, continuation values, and other adversarial mutations are
tests rather than observations. The fixture qualifies only the captured
Channel Videos modern grid lockup as `unsupported-local`; it does not qualify
other tabs, routes, shelves, Shorts, experiments, future markup, or all
Channel pages.
