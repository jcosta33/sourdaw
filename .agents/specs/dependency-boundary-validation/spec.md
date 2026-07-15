---
type: spec
id: SPEC-dependency-boundary-validation
title: Dependency boundary validation
status: draft
owner: The Sourdaw team
sources:
  - research.md
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

| Warning path | Owning requirement and disposition |
| --- | --- |
| `src/modules/MIDI/workers/controllerScriptingWorker.ts` | [Hardware-controller-ecosystem AC-002](../hardware-controller-ecosystem/spec.md#ac-002--scripts-run-sandboxed-and-control-parameters) and [Push AC-028](../push-integration/spec.md#ac-028--separate-sandboxed-script-artifact): the current file is an unlaunched, unsandboxed script worker, not a declarative-profile host. Retain the visible warning until this exact path either becomes the distinct product script-bundle worker satisfying both requirements, while Push AC-023 through AC-027 remain on the separate declarative path, or an explicit superseding ADR retires this exact file. Product reachability alone, a declarative-profile role, or an orphan exception does not close it. |
| `src/modules/AudioEngine/useCases/rave/encodeAudio.ts` | [RAVE AC-024](../rave-timbre-transfer/spec.md#ac-024--direct-deterministic-helpers-are-test-only): direct deterministic CI/test helper now; future path is `src/modules/AudioEngine/useCases/rave/__tests__/helpers/encodeAudio.ts`; retire only the exact current file after relocation with tests/contract preserved or an explicit superseding ADR names it. Product reachability and green helper tests do not close this warning. |
| `src/modules/AudioEngine/useCases/rave/decodeLatent.ts` | [RAVE AC-024](../rave-timbre-transfer/spec.md#ac-024--direct-deterministic-helpers-are-test-only): direct deterministic CI/test helper now; future path is `src/modules/AudioEngine/useCases/rave/__tests__/helpers/decodeLatent.ts`; retire only the exact current file after relocation with tests/contract preserved or an explicit superseding ADR names it. Product reachability and green helper tests do not close this warning. |
| `src/modules/AudioEngine/useCases/rave/timbreTransfer.ts` | [RAVE AC-024](../rave-timbre-transfer/spec.md#ac-024--direct-deterministic-helpers-are-test-only): direct deterministic CI/test helper now; future path is `src/modules/AudioEngine/useCases/rave/__tests__/helpers/timbreTransfer.ts`; retire only the exact current file after relocation with tests/contract preserved or an explicit superseding ADR names it. Product reachability and green helper tests do not close this warning. |
| `src/modules/AudioEngine/useCases/rave/interpolateLatent.ts` | [RAVE AC-026](../rave-timbre-transfer/spec.md#ac-026--direct-pure-latent-interpolation-helper): direct deterministic CI/test helper now; future path is `src/modules/AudioEngine/useCases/rave/__tests__/helpers/interpolateLatent.ts`; retire only the exact current file after relocation with tests/contract preserved or an explicit superseding ADR names it. Product reachability and green helper tests do not close this warning. |

Each warning remains visible until its exact path-specific disposition is met. Direct helper
availability, passing CI, product reachability, synthetic imports, and new registry entries do
not clear the four RAVE warnings; only the named relocation plus exact current-path retirement or
an explicit superseding ADR can do so. The controller-worker warning likewise requires its exact
sandboxed-script disposition or exact-path retirement, not wiring alone.

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
justified by its owning spec and verified by behavior coverage or explicit
path-named retirement.

Verify with: focused reference search, owning-spec review, and `pnpm deps:validate`

### AC-007 — Durable warning ownership

The five current warning paths MUST remain covered by the path-specific ownership and
disposition map above before source remediation; each row points to an exact owning
requirement or an explicit exact-path retirement condition.

Verify with: the table and cross-links in this spec, the linked Push/RAVE requirements,
and `rg -n "controllerScriptingWorker|timbreTransfer|interpolateLatent|encodeAudio|decodeLatent" .agents/specs`

## Open questions

- [ ] Q-001 — Which type-aware orphan implementation supplies the required runtime,
  type-only, and test-only classification without weakening the current exact
  baseline gates?

## Affected areas

- `.dependency-cruiser.cjs` and the four `pnpm deps:validate` cruise gates
- The five current `no-orphans` paths and their linked product specs
