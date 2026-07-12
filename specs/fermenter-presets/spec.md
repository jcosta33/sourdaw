---
type: spec
id: SPEC-fermenter-presets
title: Fermenter presets and browser
status: in-progress
owner: The Sourdaw team
sources:
  - ../fermenter/research.md
  - ../../intake/full-spec.md
---

# Fermenter presets and browser

## Intent

Fermenter presets serialize the full synth state as versioned JSON with stable
parameter paths, migrate forward on load, and surface through a browser with
tags, search, audio preview, and similarity — including classic-synth starter
templates. The JSON format and load path exist; the browser and templates are the
remaining work.

## Non-goals

- AI preset generation and auto-tagging (`../fermenter-ai-presets/spec.md`).
- The shared parameter and patch round-trip contract (`../fermenter/spec.md`).

## Requirements

### AC-001 — A preset serializes the full synth state as versioned JSON

When a preset is saved, it must serialize layers, generators, filters, FX, and
modulation as JSON carrying a format version and stable parameter paths.

Verify with: `pnpm test:run -- fermenterPresetSerialize`

### AC-002 — Loading an older preset runs forward migration

When a preset with a version below current loads, the loader must run the upgrade
transforms (rename paths, add defaults) to bring it current.

Verify with: `pnpm test:run -- fermenterPresetMigration`

### AC-003 — The browser filters by tag and search text

When tags or search text are entered, the browser must list only matching
presets.

Verify with: `pnpm test:run -- fermenterPresetBrowserFilter`

### AC-004 — A preset offers a short audio preview

When a preset is auditioned, the browser must play a short rendered snippet
captured at save time.

Verify with: `manual` — open the browser, audition a preset, and confirm the preview snippet plays

### AC-005 — Classic-synth templates load as valid starting patches

When a classic-synth template (e.g. Minimoog, DX7, TB-303) is loaded, it must
produce a valid, playable patch matching that template's defined modules.

Verify with: `pnpm test:run -- fermenterPresetTemplates`

### AC-006 — No cross-module internal imports

This change must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

## Open questions

- [ ] (non-blocking) Should similarity ranking use parameter-distance,
  spectral-feature distance, or a blend?

## Affected areas

- `crates/daw-dsp/src/fermenter/` (preset (de)serialization, migration)
- `src/modules/Fermenter/` (preset browser, template catalog)

## Dropped from sources

- Spectral-feature similarity scoring — deferred behind parameter-distance for
  the first browser cut.
