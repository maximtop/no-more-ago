# Facebook fixture matrix

These fixtures model only the minimum observable shapes required by the Facebook
adapter and payload bridge. All names, identifiers, timestamps, tracking tokens,
and content are synthetic; no live account or page data is retained.

- `eligibility-matrix.html` contains recognized initial and dynamic post timestamp
  links, look-alike actor/media/comment/Reel links, malformed evidence, a nested
  Story candidate, and an ordinary HTML `time` fallback.
- `initial-payload.json` contains one typed Story, an equal duplicate association,
  and a nested Story without its own timestamp.
- `dynamic-response.txt` is an XSSI-prefixed, newline-delimited GraphQL response
  with an equal duplicate association.
- `conflicting-response.txt` maps the initial token to a different timestamp so
  the integration must fail closed and restore the page source.

The fixtures are compatibility evidence, not a promise that third-party markup
will remain stable. Live Facebook support is best-effort and still requires the
same Story proof and exact tracking-token correlation.
