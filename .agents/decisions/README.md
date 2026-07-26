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

ADR numbers 0001 and 0002 are reserved and must not be reused.

| ADR                                               | Decision                                                        |
| ------------------------------------------------- | --------------------------------------------------------------- |
| [0003](0003-engine-owned-plugin-runtime-owner.md) | Give engine-owned native plugins a non-RT runtime owner         |
| [0004](0004-plugin-hosting-security-policy.md)    | Make native plugin-hosting security policy explicit             |
| [0005](0005-public-sample-asset-distribution.md)  | Treat large public samples as an explicit distribution artifact |
| [0006](0006-contract-folder-barrels-no-module-root-index.md) | Contract-folder barrels are the only cross-module surface; no module-root index.ts |
| [0007](0007-command-definitions-out-of-models.md) | Command definitions live in useCases/commands, not models/      |
| [0008](0008-recent-projects-load-backend.md)      | Recent-projects load uses flat-JSON snapshots (Option A)        |
| [0009](0009-toaster-pattern-morph-determinism.md) | Toaster pattern-morph is deterministic at a 0.5 activation threshold |
| [0010](0010-product-restraint-principles.md)      | Product restraint principles (candidate canon) — **status: proposed**, pending product-owner ratification |
| [0011](0011-ddd-module-boundary-redraw.md)        | DDD module boundary redraw — decompose 7 god-modules into a 54 bounded-context set |
| [0012](0012-agent-command-registry-packaging.md) | Agent command registry packaging and authoritative write boundary |
| [0013](0013-agent-pure-transactions-and-sagas.md) | Agent pure transactions and external-effect sagas |
| [0014](0014-agent-provider-credentials-and-endpoint-admission.md) | Agent provider credentials and endpoint admission |
| [0015](0015-agent-run-retention-policy.md) | Agent run retention policy |

Genuinely open decisions that are not yet ADRs live in the
[open-decision docket](open-decision-docket.md).
