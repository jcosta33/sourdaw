---
type: spec
id: SPEC-dependency-boundary-validation
title: Dependency boundary validation
status: draft
owner: The Sourdaw team
sources:
    - research.md
    - ../../decisions/README.md
    - ../hardware-controller-ecosystem/spec.md
    - ../push-integration/spec.md
    - ../rave-timbre-transfer/spec.md
    - ../../../.dependency-cruiser.cjs
    - ../../../.dependency-cruiser.reachability.cjs
    - ../../../scripts/check-dependency-boundaries.mjs
    - ../../../.dependency-cruiser.types.cjs
    - ../../../.dependency-cruiser.tests.cjs
    - ../../../.dependency-cruiser-known-violations.json
    - ../../../.dependency-cruiser-known-violations-reachability.json
    - ../../../.dependency-cruiser-known-violations-types.json
    - ../../../.dependency-cruiser-known-violations-tests.json
    - ../../../package.json
    - ../../../tsconfig.json
    - ../../../tsconfig.test.json
---

# Dependency boundary validation

## Intent

Keep dependency validation honest as the project decides how to classify dormant
modules. This spec governs validator behavior and the no-orphans roadmap; current
checked-in authority and reproducible commands are recorded in [research.md](research.md),
without restating the project's architecture rules.

## Current state

`no-orphans` is a warning-level signal for a module that has no incoming import
and is not a recognized entrypoint. The current five warnings remain visible:

- `src/modules/MIDI/workers/controllerScriptingWorker.ts`
- `src/modules/AudioEngine/useCases/rave/timbreTransfer.ts`
- `src/modules/AudioEngine/useCases/rave/interpolateLatent.ts`
- `src/modules/AudioEngine/useCases/rave/encodeAudio.ts`
- `src/modules/AudioEngine/useCases/rave/decodeLatent.ts`

The warning ownership and disposition map is intentionally a cross-reference; the
linked owning requirement remains authoritative.

| Warning path                                                 | Owning requirement and disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/modules/MIDI/workers/controllerScriptingWorker.ts`      | [Hardware-controller-ecosystem AC-002](../hardware-controller-ecosystem/spec.md#ac-002--scripts-require-an-accepted-runtime-adr), [AC-004](../hardware-controller-ecosystem/spec.md#ac-004--script-grants-are-trusted-and-finite), [AC-005](../hardware-controller-ecosystem/spec.md#ac-005--script-effect-intents-have-exact-schemas), [AC-006](../hardware-controller-ecosystem/spec.md#ac-006--script-parameter-intents-use-command), [AC-007](../hardware-controller-ecosystem/spec.md#ac-007--script-midi-intents-use-one-bound-output), [AC-008](../hardware-controller-ecosystem/spec.md#ac-008--current-worker-warning-has-one-exact-disposition), [AC-009](../hardware-controller-ecosystem/spec.md#ac-009--script-source-loading-is-closed), [AC-010](../hardware-controller-ecosystem/spec.md#ac-010--script-results-use-one-closed-protocol), [AC-011](../hardware-controller-ecosystem/spec.md#ac-011--selected-runtime-confinement-is-observed), and [Push AC-028](../push-integration/spec.md#ac-028--separate-capability-secure-script-artifact): retain the warning until this exact file becomes the distinct script-bundle worker satisfying every linked requirement, or the same change satisfies the canonical accepted-ADR retirement condition in AC-008 below. Worker presence, a launcher, `new Function`, CSP alone, product reachability, a declarative-profile role, or an orphan exception does not close it. |
| `src/modules/AudioEngine/useCases/rave/encodeAudio.ts`       | [RAVE AC-024](../rave-timbre-transfer/spec.md#ac-024--direct-encode-helper-remains-test-only): retain as a direct deterministic helper until the exact-path relocation and direct-test gate is completed, or the same change satisfies AC-008 below. Product reachability and green helper tests do not close this warning.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `src/modules/AudioEngine/useCases/rave/decodeLatent.ts`      | [RAVE AC-032](../rave-timbre-transfer/spec.md#ac-032--direct-decode-helper-remains-test-only): retain as a direct deterministic helper until the exact-path relocation and direct-test gate is completed, or the same change satisfies AC-008 below. Product reachability and green helper tests do not close this warning.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `src/modules/AudioEngine/useCases/rave/timbreTransfer.ts`    | [RAVE AC-033](../rave-timbre-transfer/spec.md#ac-033--direct-timbre-helper-needs-behavioral-evidence): retain as a direct deterministic helper until the exact-path relocation and missing direct-behavior test gate is completed, or the same change satisfies AC-008 below. Product reachability and its current export-only test do not close this warning.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `src/modules/AudioEngine/useCases/rave/interpolateLatent.ts` | [RAVE AC-026](../rave-timbre-transfer/spec.md#ac-026--direct-pure-latent-interpolation-helper): retain as a direct deterministic helper until the exact-path relocation and missing endpoint/immutability test gate is completed, or the same change satisfies AC-008 below. Product reachability and its current partial test do not close this warning.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

Each warning remains visible until its exact path-specific disposition is met. Direct helper
availability, passing checks, product reachability, synthetic imports, and new registry entries do
not clear the four RAVE warnings. An ADR retirement is valid only under AC-008; the
controller-worker warning likewise requires exact compliant activation or that same canonical
retirement condition, not Worker presence or wiring alone.

## Requirements

### AC-001 — Exact validator baselines

`pnpm deps:validate` MUST run the main, reachability, type, and test cruises with
fresh graphs, compare current error rows against exact baselines, and reject both
novel and stale error rows while keeping warning rows visible.

Verify with: `pnpm deps:validate`

### AC-002 — No-orphans remains visible debt

The `no-orphans` rule MUST remain a warning until the real dormant-module cleanup
and product-owner decisions are complete; a passing baseline is not presented as
zero orphan debt while these five warnings remain.

Verify with: `pnpm deps:validate` and the `no-orphans` rule in `.dependency-cruiser.cjs`

### AC-003 — Type-aware orphan classification

Before narrowing orphan exclusions or promoting `no-orphans`, the project MUST
classify incoming runtime, type-only, and test-only references with a type-aware
analysis and triage its false positives instead of applying a blanket exclusion
change.

Verify with: a checked-in reproducible type-aware probe command and result recorded in
[research.md](research.md), plus `pnpm deps:validate`

### AC-004 — Evidence-based dynamic entrypoints

An intentional dynamic-entrypoint exception MUST be an exact file path backed by
direct launcher evidence such as `new Worker(new URL(..., import.meta.url))`; a
worker-shaped file without a launcher remains a visible warning.

Verify with: focused source-reference search and `pnpm deps:validate`

### AC-005 — Exact exceptions only

New intentional orphan exceptions MUST match one exact path and an evidenced
classification such as a dynamic entrypoint, shared test fixture, or runtime-used
type/helper; directory-wide orphan exceptions are prohibited. The existing
blanket shape exclusions are legacy classification debt documented in [research.md](research.md);
they are not broadened, and any narrowing is governed by AC-003.

Verify with: `.dependency-cruiser.cjs` review and `pnpm deps:validate`

### AC-006 — No fake reachability

No warning is cleared by a synthetic import, empty barrel export, artificial
registration, or other cosmetic wiring; product wiring or deletion MUST be
justified by its owning spec and verified by behavior coverage or AC-008's
accepted exact-path retirement condition.

Verify with: focused reference search, owning-spec review, and `pnpm deps:validate`

### AC-007 — Durable warning ownership

The five current warning paths MUST remain covered by the path-specific ownership and
disposition map above before source remediation; each row points to an exact owning
requirement and, where applicable, AC-008's exact-path retirement condition.

Verify with: the table and cross-links in this spec, the linked hardware-controller, Push, and RAVE
requirements, and
`rg -n "controllerScriptingWorker|timbreTransfer|interpolateLatent|encodeAudio|decodeLatent" .agents/specs`

### AC-008 — Accepted exact-path retirement

Any ADR-based retirement of a warning path in this map MUST be one atomic change that uses an
accepted ADR listed in `.agents/decisions/README.md`; names the exact path, its removal or relocation
disposition, its replacement or explicit no-replacement decision, the behavioral contract preserved
or ended, and direct evidence for that disposition; removes or relocates the exact path; updates its
owning cross-links and preservation tests; and records `pnpm deps:validate` evidence that the exact
warning is absent without a synthetic import or new orphan exception. A draft, unlisted,
prose-only, or future-intent ADR is not retirement authority.

Verify with: the accepted ADR and ledger entry, the same-change source/test/spec diff, focused
exact-path search, and `pnpm deps:validate`

### AC-009 — Static typecheck scope is explicit

The repository MUST describe the current static typecheck scope exactly, without
presenting app typechecking as evidence for excluded specs.

| Surface          | Current static coverage                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| App source       | `pnpm typecheck` includes `src` and `vite-env.d.ts`, excluding `src/**/*.spec.ts` and `src/**/*.spec.tsx`. |
| Yeast processors | `pnpm typecheck:test` includes `src/modules/Yeast/workers/processors` and `vite-env.d.ts`.                 |
| Other specs      | Outside static test typing.                                                                                |

Verify with: compare this table with the `include` and `exclude` entries in `tsconfig.json` and `tsconfig.test.json`, then run `pnpm typecheck` and `pnpm typecheck:test`

## Open questions

- [ ] Q-001 — Which type-aware orphan implementation supplies the required runtime,
      type-only, and test-only classification without weakening the current exact
      baseline gates?

## Affected areas

- `.dependency-cruiser.cjs` and the four `pnpm deps:validate` cruise gates
- The five current `no-orphans` paths and their linked product specs
