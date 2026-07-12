# Architecture Decision Records

This directory contains durable project decisions that belong with the source
repository.

## Rules

- **Numbered.** Use `NNNN-short-title.md` with monotonically increasing
  numbers. Never reuse a number, including one assigned to a retired or
  superseded ADR.
- **Immutable.** Once accepted, an ADR is never rewritten into a different
  decision. To change course, add a new ADR that supersedes the accepted ADR and
  mark the old ADR `superseded by NNNN`.

Workspace-methodology ADRs 0001 and 0002 were retired as obsolete during this
migration. Their numbers remain reserved.

| ADR                                               | Decision                                                        |
| ------------------------------------------------- | --------------------------------------------------------------- |
| 0001                                              | Retired obsolete workspace-methodology decision                 |
| 0002                                              | Retired obsolete workspace-methodology decision                 |
| [0003](0003-engine-owned-plugin-runtime-owner.md) | Give engine-owned native plugins a non-RT runtime owner         |
| [0004](0004-plugin-hosting-security-policy.md)    | Make native plugin-hosting security policy explicit             |
| [0005](0005-public-sample-asset-distribution.md)  | Treat large public samples as an explicit distribution artifact |
