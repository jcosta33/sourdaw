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

| ADR                                                                 | Decision                                                                                                                                |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [0003](0003-engine-owned-plugin-runtime-owner.md)                   | Give engine-owned native plugins a non-RT runtime owner                                                                                 |
| [0004](0004-plugin-hosting-security-policy.md)                      | Make native plugin-hosting security policy explicit                                                                                     |
| [0005](0005-public-sample-asset-distribution.md)                    | Treat large public samples as an explicit distribution artifact                                                                         |
| [0006](0006-contract-folder-barrels-no-module-root-index.md)        | Contract-folder barrels are the only cross-module surface; no module-root index.ts                                                      |
| [0007](0007-command-definitions-out-of-models.md)                   | Command definitions live in useCases/commands, not models/                                                                              |
| [0008](0008-recent-projects-load-backend.md)                        | Recent-projects load uses flat-JSON snapshots (Option A)                                                                                |
| [0009](0009-toaster-pattern-morph-determinism.md)                   | Toaster pattern-morph is deterministic at a 0.5 activation threshold                                                                    |
| [0010](0010-product-restraint-principles.md)                        | Product restraint principles (candidate canon) — **status: proposed**, pending product-owner ratification                               |
| [0011](0011-ddd-module-boundary-redraw.md)                          | DDD module boundary redraw — decompose 7 god-modules into a 54 bounded-context set                                                      |
| [0012](0012-neither-target-degrades-the-other.md)                   | Neither target may be degraded to accommodate the other; share only at full quality                                                     |
| [0013](0013-retire-the-flat-json-project-snapshot.md)               | Retire the flat-JSON project snapshot and its base64 audio — **supersedes 0008**                                                        |
| [0014](0014-project-persistence-architecture.md)                    | Project persistence architecture — project-as-directory (Option C) — accepted 2026-08-04; gates M1–M10 remain implementation milestones |
| [0015](0015-a-guard-must-be-able-to-fail.md)                        | A guard must be able to fail, and a census must enumerate from a registry                                                               |
| [0016](0016-ultracode-session-scope-and-standard.md)                | Ultracode session scope — browser-capable work only, built properly, no compatibility shims                                             |
| [0017](0017-pre-fader-sends-survive-mute.md)                        | Pre-fader sends survive mute; solo-in-place gates them                                                                                  |
| [0018](0018-clip-release-is-not-a-toggle-concern.md)                | Release actions belong to gate-style launches, not to toggle                                                                            |
| [0019](0019-retrospective-capture-bounds.md)                        | Retrospective capture: event-bounded, inactivity-flushed, MIDI first                                                                    |
| [0020](0020-deferred-deallocation-off-the-audio-thread.md)          | Retired allocations leave the audio thread over a return channel                                                                        |
| [0021](0021-plugin-isolation-by-binary-with-per-plugin-override.md) | One helper per plugin binary, with a per-plugin full-isolation override                                                                 |
| [0022](0022-no-comparative-realism-claims.md)                       | Describe mechanisms, not resemblance: no comparative realism claims                                                                     |
| [0023](0023-allpass-fractional-delay-in-the-string-loop.md)         | Allpass fractional delay in the Karplus-Strong loop, offset off zero                                                                    |
| [0024](0024-warp-modes-are-named-by-material.md)                    | Warp modes are named by material, over three closed executors                                                                           |
| [0025](0025-fermenter-fine-tune-is-continuous.md)                   | Fermenter fine tune is continuous; coarse tune remains stepped                                                                          |
| [0026](0026-ownership-by-exception.md)                              | The agent owns the codebase and operates by exception                                                                                   |
| [0027](0027-windows-device-layer-iaudioclient3.md)                  | Windows device layer is IAudioClient3 shared low-latency, with WASAPI Exclusive opt-in and no ASIO                                      |
| [0028](0028-native-provider-credential-sessions.md)                 | Hosted provider credentials stay native behind opaque sessions                                                                          |
| [0029](0029-electron-desktop-shell.md)                              | The desktop shell is Electron over a shell-agnostic native crate — **resolves the packaging deferral in 0012**                          |
| [0030](0030-exact-model-release-admission.md)                       | Exact model artifacts require release admission                                                                                         |
| [0031](0031-native-plugin-format-strategy.md)                       | Sourdaw hosts CLAP and commits to VST3; VST2 and Audio Units are permanently out                                                        |
| [0032](0032-withhold-grand-boule-from-release.md)                   | Preserve Grand Boule but withhold it from released product paths                                                                        |

Genuinely open decisions that are not yet ADRs live in the
[open-decision docket](open-decision-docket.md).
