---
type: spec
id: SPEC-grinder-neural-library-management-phase-14
title: Grinder neural library management — phase 14 (raw-source retention, export, removal)
status: done
owner: The Sourdaw team
sources:
  - ../grinder-stabilization-phase-1/audit.md
  - ../grinder-neural-builtins-phase-7/research.md
---

# Grinder neural library management — phase 14 (raw-source retention, export, removal)

## Intent

Make Grinder's imported Neural library behave like a real reusable asset library:
preserve the original imported NAM payload, support export and removal in the Neural
modal, and keep patch-embedded playback portability intact when a reusable library entry
is removed.

## Non-goals

- Full NAM runtime parity.
- AIDA-X import.
- DSP retuning.
- Native plugin hosting or Tauri-native asset management.
- Changing the patch-embedded compact-profile transport contract.

## Requirements

### AC-001 — Imported captures preserve original source data

Importing a NAM file must store the original file name and original source text alongside
the derived Grinder profile in the reusable imported-model library entry.

Verify with: `pnpm test:run -- parseGrinderNamFile`

### AC-002 — Patch portability remains intact

Removing an imported library entry must not break a patch that already embeds the
imported profile; if the current patch uses that profile, the UI must still surface the
selected imported voice through the existing patch-fallback path.

Verify with: `pnpm test:run -- GrinderPanel`

### AC-003 — Removal updates the reusable library cleanly

Removing an imported library entry must update in-memory store state and persisted
IndexedDB state so the removed entry does not reappear on reload.

Verify with: `pnpm test:run -- removeGrinderNeuralModel`

### AC-004 — Export returns the preserved payload

Exporting an imported library entry must write the original preserved payload text with a
sensible filename, not a regenerated pseudo-NAM file from the compact profile.

Verify with: `pnpm test:run -- exportGrinderNeuralModel`

### AC-005 — Error handling stays explicit

Export and remove actions must fail gracefully and surface a user-visible error via the
existing Neural library state when an operation cannot complete.

Verify with: `pnpm test:run -- GrinderPanel`

### AC-006 — No cross-module internal imports

This change must stay inside Grinder-local repositories/use cases and not deep-import
helpers from other modules.

Verify with: `pnpm deps:validate`

### AC-007 — UI distinguishes selected imported model from reusable library asset

Because removing a library entry while keeping patch-level fallback behavior creates two
concepts — the "selected imported model" embedded in the current patch versus a "reusable
library asset" — the Neural modal must clearly communicate that distinction so a
patch-only fallback voice is not mistaken for a still-present reusable library entry.

Verify with: `pnpm test:run -- GrinderPanel`

## Open questions

- None.

## Affected areas

- `src/modules/Grinder/models/GrinderPatch.ts`
- `src/modules/Grinder/useCases/parseGrinderNamFile.ts`
- `src/modules/Grinder/repositories/neuralLibraryPersistence/`
- `src/modules/Grinder/repositories/` (export/download plumbing)
- `src/modules/Grinder/presentations/views/GrinderPanel.tsx`

## Dropped from sources

- Moving audible truth back into the reusable library — rejected; the patch keeps the
  compact profile for portability and the library keeps the raw source for asset
  management.
- Treating export/remove as patch actions — rejected; removing a library entry must
  never silently mutate the current patch away from its embedded imported profile.
- A new platform-specific save dependency — rejected; reuse existing Blob/download
  patterns for browser compatibility.

## Tradeoffs and risks

Restored verbatim from the original source spec
(`specs/grinder-neural-library-management-phase-14.md`); these were lost in migration.

- Preserving original payload text increases IndexedDB storage usage for imported
  captures, but it is the cleanest way to support faithful export and future
  higher-fidelity workflows.
- Removing a library entry while keeping patch-level fallback behavior creates two
  concepts of "selected imported model" versus "reusable library asset," so the UI needs
  to communicate that distinction clearly. (The UI-distinction requirement is captured as
  AC-007 above.)
