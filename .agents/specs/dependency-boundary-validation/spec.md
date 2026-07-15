---
type: spec
id: SPEC-dependency-boundary-validation
title: Dependency boundary validation
status: draft
owner: The Sourdaw team
sources:
  - research.md
  - code:../../../.dependency-cruiser.cjs
  - code:../../../scripts/check-dependency-boundaries.mjs
  - code:../../../.dependency-cruiser.types.cjs
  - code:../../../.dependency-cruiser.tests.cjs
  - code:../../../package.json
---

# Dependency boundary validation

## Intent

Keep dependency validation honest as the project decides how to classify dormant
modules. This spec governs validator behavior and the no-orphans roadmap; dated
probe evidence is preserved in [research.md](research.md), without restating the
project's architecture rules.

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
| `src/modules/MIDI/workers/controllerScriptingWorker.ts` | [Push integration Q-004](../push-integration/spec.md): retain behind its trust, capability, sandbox, and typed-action boundary; no launcher or action wiring is authorized by this map. |
| `src/modules/AudioEngine/useCases/rave/encodeAudio.ts` | [RAVE AC-024](../rave-timbre-transfer/spec.md): retain as a model-free fallback helper. |
| `src/modules/AudioEngine/useCases/rave/decodeLatent.ts` | [RAVE AC-024](../rave-timbre-transfer/spec.md): retain as a model-free fallback helper. |
| `src/modules/AudioEngine/useCases/rave/timbreTransfer.ts` | [RAVE AC-024](../rave-timbre-transfer/spec.md): retain as a model-free fallback helper. |
| `src/modules/AudioEngine/useCases/rave/interpolateLatent.ts` | [RAVE AC-026](../rave-timbre-transfer/spec.md): retain as the pure latent-interpolation fallback primitive. |

Each warning remains visible until real product wiring/reachability satisfies its
linked owning requirement, or that owning spec records an explicit exact-path
retirement; this map does not itself clear a warning.

## Requirements

### AC-001 — Exact validator baselines

`pnpm deps:validate` MUST run the main, reachability, type, and test cruises with
fresh graphs, compare current error rows against exact baselines, and reject both
novel and stale error rows while keeping warning rows visible.

Verify with: `pnpm deps:validate`

### AC-002 — No-orphans remains visible debt

The `no-orphans` rule MUST remain a warning until the real dormant-module cleanup
and product-owner decisions are complete; a passing baseline MUST NOT be presented
as zero orphan debt while these five warnings remain.

Verify with: `pnpm deps:validate` and the `no-orphans` rule in `.dependency-cruiser.cjs`

### AC-003 — Type-aware orphan classification

Before narrowing orphan exclusions or promoting `no-orphans`, the project MUST
classify incoming runtime, type-only, and test-only references with a type-aware
analysis and triage its false positives instead of applying a blanket exclusion
change.

Verify with: a dated type-aware orphan probe recorded beside this spec and `pnpm deps:validate`

### AC-004 — Evidence-based dynamic entrypoints

An intentional dynamic-entrypoint exception MUST be an exact file path backed by
direct launcher evidence such as `new Worker(new URL(..., import.meta.url))`; a
worker-shaped file without a launcher MUST remain a visible warning.

Verify with: focused source-reference search and `pnpm deps:validate`

### AC-005 — Exact exceptions only

New intentional orphan exceptions MUST match one exact path and an evidenced
classification such as a dynamic entrypoint, shared test fixture, or runtime-used
type/helper; directory-wide orphan exceptions MUST NOT be added. The existing
blanket shape exclusions are legacy classification debt documented in [research.md](research.md);
they MUST NOT be broadened, and any narrowing is governed by AC-003.

Verify with: `.dependency-cruiser.cjs` review and `pnpm deps:validate`

### AC-006 — No fake reachability

No warning MAY be cleared by a synthetic import, empty barrel export, artificial
registration, or other cosmetic wiring; product wiring or deletion MUST be
justified by its owning spec and verified by behavior coverage or explicit
path-named retirement.

Verify with: focused reference search, owning-spec review, and `pnpm deps:validate`

### AC-007 — Durable warning ownership

The five current warning paths MUST remain covered by the path-specific ownership and
disposition map above before source remediation; each path MUST point to an exact
owning requirement or an explicit exact-path retirement condition.

Verify with: the table and cross-links in this spec, the linked Push/RAVE requirements,
and `rg -n "controllerScriptingWorker|timbreTransfer|interpolateLatent|encodeAudio|decodeLatent" .agents/specs`

## Open questions

- [ ] Q-001 — Which type-aware orphan implementation supplies the required runtime,
  type-only, and test-only classification without weakening the current exact
  baseline gates?

## Affected areas

- `.dependency-cruiser.cjs` and the four `pnpm deps:validate` cruise gates
- The five current `no-orphans` paths and their linked product specs
