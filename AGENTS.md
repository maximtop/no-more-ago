# Project instructions

## Shared contract values

- Do not inline magic values that form a shared contract, including runtime message types,
  storage keys, adapter identifiers, artifact filenames, and operational limits.
- Declare each shared value once as a named constant in the module that owns the contract, then
  import and reuse that constant in production code and tests.
- Keep related finite value sets in readonly `as const` collections and derive their TypeScript
  unions and validators from those collections when practical.
- Keep self-explanatory discriminants inline when they make union narrowing or control flow
  clearer; the canonical union or finite value set must still own the allowed values.
- One-off user-facing copy, self-explanatory local test data, and a literal whose serialized value
  is itself under test may remain inline.

## Module boundaries

- Keep source modules focused on one responsibility. Do not place an entire application surface
  in one file.
- Extract independently renderable UI sections, feature-specific state coordination, and domain
  transformations into focused modules as they grow.
- Prefer cohesive feature boundaries over moving a large implementation unchanged into a generic
  helper or controller file.
