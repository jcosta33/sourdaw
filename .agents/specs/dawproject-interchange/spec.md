---
type: spec
id: SPEC-dawproject-interchange
title: DAWproject import/export and .sourdaw bundle
status: draft
owner: The Sourdaw team
sources:
  - intake/implementation-gaps.md
---

# DAWproject import/export and .sourdaw bundle

## Intent

Add Bitwig DAWproject (XML-in-ZIP) import/export mapping Sourdaw's project model to the
DAWproject 1.0 schema, and a single-file `.sourdaw` bundle (Automerge doc + assets +
manifest) that opens cross-machine without external asset paths.

## Non-goals

- Audio encoders and signal integrity (see `export-encoders-integrity`).
- Delivery-target export presets (see `delivery-export-targets`).
- Provenance reporting (see `export-provenance`), though the bundle may carry it.

## Requirements

### AC-001 — DAWproject export imports into Bitwig

A project exported to DAWproject must import into Bitwig with tracks, clip positions and
lengths, tempo events, and mixer sends preserved within ±1 sample position accuracy.

Verify with: `manual` — export the reference project, import into Bitwig 5, confirm positions within ±1 sample

### AC-002 — Round-trip is lossless for user-visible fields

Round-tripping the reference project export → import into a fresh Sourdaw instance must
yield byte-identical user-visible fields (track names, clip ids, notes, automation points).

Verify with: `pnpm cargo:test -- -p daw-interchange dawproject_roundtrip`

### AC-003 — .sourdaw bundle is self-contained

`.sourdaw` export must produce a single ZIP whose manifest lists every referenced asset
by content hash; opening it on a machine with an empty asset cache reconstructs the
project with no missing-asset warnings.

Verify with: `pnpm cargo:test -- -p daw-interchange sourdaw_bundle_selfcontained`

### AC-004 — Unsupported constructs warn, never fail silently

Importing a DAWproject referencing unsupported constructs must emit a structured warning
list (one entry per dropped element) rather than failing silently.

Verify with: `pnpm cargo:test -- -p daw-interchange dawproject_unsupported_warnings`

### AC-005 — Both surfaced in File menu

DAWproject and `.sourdaw` must appear in both File → Export and File → Import.

Verify with: `pnpm test:run -- fileMenuInterchange`

## Open questions

- [ ] (non-blocking) New `daw-interchange` crate vs inside `daw-io` — default: new crate.

## Known risks

Present-state findings from the legacy Project-module persistence/interchange code
(`src/modules/Project/`). They bound what a faithful import/export must not inherit.

- `versionControlStore` subscribes to every store change and synchronously
  re-stringifies the full lightweight history to localStorage on each set
  (`versionControlStore.ts:41-46`); `versions[]` is uncapped, so each snapshot
  creation triggers an O(N) `JSON.stringify` of the entire history — O(N) per
  change at ~100k versions.
- `ProjectData.audioBuffers` round-trips base-64 PCM as `channelData[]` carrying
  only `sampleRate` / `numberOfChannels` (`models/ProjectData.ts:349`) — no
  bit-depth/encoding tag, no length prefix, no checksum (sha256/CRC-32), so a
  truncated or corrupted base-64 string decodes to a different-length buffer and
  silently plays.
- `exportProjectFile.ts:127` reads marker text through an inline
  `(message as { label?: string }).label` cast — an AGENTS.md as-escape reaching
  into an undeclared field rather than typing it.
- `helpers/autoSaveHandle.ts:10` uses module-level mutable state (`let stopAutoSave`),
  HMR-unsafe — a hot reload of `loadProject.ts` orphans the previous auto-save closure.
- `ProjectArrangementSnapshot.tracks` is typed `unknown` (`models/ProjectData.ts:388`),
  so the buffer-collection walker (`exportProjectFile.ts:65`) does no runtime guard and
  silently fails on differently-shaped snapshots; take-lane buffer references are not
  collected at all.

## Affected areas

- `crates/daw-interchange/` (or `daw-io`)
- File menu import/export entries

## Dropped from sources

- None — this spec scopes the §7.5 items directly.
