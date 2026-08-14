---
type: spec
id: SPEC-orchestra-presets
title: Orchestra preset format and versioned loading
status: draft
owner: The Sourdaw team
sources:
  - self
---

# Orchestra preset format and versioned loading

## Intent

Define Orchestra's preset as a versioned JSON document — instrument racks, mic
mixer state, routing, macros, and mapping tables — that migrates forward on load
and is handed to the audio thread as a prevalidated state blob swapped at a block
boundary, never parsed on the hot path.

## Non-goals

- AI-assisted preset generation and classifiers — owned by
  `SPEC-orchestra-ai-pipelines`.
- The preset-browser UI — owned by `SPEC-orchestra-progressive-disclosure-ux`.
- The per-voice expression and MPE behavior — owned by
  `SPEC-orchestra-expression-dynamics`.

## Requirements

### AC-001 — A preset round-trips without field loss

When a preset is saved and reloaded, every stored field (racks, mic mixer,
routing, macros, mapping tables, metadata) must restore identically.

Verify with: `pnpm test:run -- orchestraPresetRoundTrip`

### AC-002 — An older preset version migrates forward on load

When a preset with an older `format_version` is loaded, the loader must migrate
it to the current version and load successfully.

Verify with: `pnpm test:run -- orchestraPresetMigration`

### AC-003 — The audio thread receives a prevalidated blob swapped at a block boundary

When a preset is applied, the audio thread must receive a handle to an
already-validated state blob and swap pointers at a block boundary rather than
parsing or allocating mid-block.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::preset::block_boundary_swap`

### AC-004 — Mapping tables persist keyswitch, CC, and MPE assignments

When a preset stores its keyswitch, CC, and MPE mapping tables, reloading must
restore those assignments so articulation and expression routing is unchanged.

Verify with: `pnpm test:run -- orchestraPresetMappings`

### AC-005 — Preset loading touches no other module's internals

When the preset module loads or saves, it must not import another module's
internals.

Verify with: `pnpm deps:validate`

## Open questions

- [ ] (non-blocking) Are sample-library references stored as content-addressed
  ids or paths, and how are missing references surfaced on load?
- [ ] (non-blocking) Should macro→parameter mappings be part of the preset or a
  separate user-layer document?

## Affected areas

- `src/modules/Levain/` (preset model, save/load, migration; preset UI state)
- `crates/daw-dsp/src/levain/preset/` (prevalidated blob handoff, block-boundary
  swap)

## Dropped from sources

- AI auto-tagging and quality scoring of presets — moved to
  `SPEC-orchestra-ai-pipelines`.
- The exhaustive preset field list — captured as AC-001's round-trip contract,
  not restated field by field.
