# Grinder Neural Library Management Phase 14

## Context

Phase 8 made documented NAM imports real inside Grinder, but the imported-model library is still mostly one-way: import, derive a compact profile, persist it, and select it. The existing research in `.agents/research/grinder/neural-model-loading.md` explicitly left raw-source retention and later export workflows as open questions.

The current gap is product-level library management. Once a user imports a capture, Grinder should preserve the original imported payload, let the user export it back out, and let the user remove stale library entries without corrupting project playback.

## Goal

Make Grinder's imported Neural library behave like a real reusable asset library: preserve the original imported NAM payload, support export and removal in the Neural modal, and keep patch-embedded playback portability intact when a reusable library entry is removed.

## User-visible behavior

- Imported Neural captures retain their original file payload and filename metadata.
- The Neural modal exposes export and remove actions for reusable imported captures.
- Exporting an imported capture writes back the preserved original payload instead of a lossy regenerated approximation.
- Removing an imported capture deletes it from the reusable library, but a patch that already embeds that profile still keeps sounding correct and remains selectable.

## Scope

**In scope:**

- extend imported Neural library entry data in `src/modules/Grinder/models/GrinderPatch.ts`
- retain original import payload/name during NAM import parsing
- persist and restore the richer imported-library entries
- add Grinder-local export/download plumbing for imported Neural captures
- add Grinder-local removal plumbing for imported Neural captures
- update the Neural modal UI to expose export/remove actions and preserve selected-patch fallback behavior
- add targeted Vitest coverage for import parsing, library management, and modal rendering

**Out of scope:**

- full NAM runtime parity
- AIDA-X import
- DSP retuning
- native plugin hosting or Tauri-native asset management
- changing the patch-embedded compact-profile transport contract

## Requirements

1. **Imported captures preserve original source data**
   Importing a NAM file must store the original file name and original source text alongside the derived Grinder profile in the reusable imported-model library entry.

2. **Export returns the preserved payload**
   Exporting an imported library entry must write the original preserved payload text with a sensible filename, rather than regenerating a pseudo-NAM file from the compact Grinder profile.

3. **Removal updates the reusable library cleanly**
   Removing an imported library entry must update in-memory store state and persisted IndexedDB state so the removed entry does not reappear on reload.

4. **Patch portability remains intact**
   Removing an imported library entry must not break a patch that already embeds the imported profile. If the current patch is using that profile, the UI must still surface the selected imported voice through the existing patch-fallback path.

5. **Error handling stays explicit**
   Export/remove actions must fail gracefully and surface a user-visible error via the existing Neural library state if an operation cannot complete.

## Constraints

- Keep the current patch-embedded compact-profile behavior intact; do not move audible truth back into the reusable library.
- Stay inside Grinder-local repositories/use cases; do not deep-import helpers from other modules.
- Preserve browser compatibility by using existing Blob/download patterns rather than introducing a new platform-specific save dependency.
- Keep the change bounded to library management, not full external-model runtime fidelity.

## Design decisions

- Store original NAM source data only on reusable imported-library entries, not on the persisted patch. The patch should keep the compact profile for portability; the library should keep the raw source for asset management.
- Treat export/remove as library actions, not patch actions. Removing a library entry should never silently mutate the current patch away from its embedded imported profile.
- Reuse the existing "selected in this patch" synthesized-entry fallback for removed library items so current playback truth remains visible even if the reusable library no longer contains that asset.

## Acceptance criteria

- [x] A parser test proves imported NAM entries retain original source filename and source payload text.
- [x] A library-management test proves removing an imported entry updates persisted/store state.
- [x] A UI test proves the Neural modal renders export/remove actions for imported captures.
- [x] A UI or use-case test proves a currently selected imported patch still has a visible fallback entry after the reusable library entry is removed.
- [x] `pnpm test:run src/modules/Grinder` passes.
- [x] `pnpm typecheck` passes.
- [x] `pnpm deps:validate` passes.

## Implementation notes

- Add Grinder-local download plumbing under `src/modules/Grinder/repositories/`.
- Keep the imported-entry type additions small and explicit: filename plus original source text are sufficient for this phase.
- The current imported-entry cards in `GrinderPanel.tsx` will likely need to stop being one giant button so action buttons can be rendered without invalid nested interactive markup.

## Test plan

- [x] Add a failing parser regression for raw-source retention.
- [x] Add a failing library-management regression for removal/export behavior.
- [x] Add or extend Neural modal tests for export/remove controls and selected-entry fallback behavior.
- [x] Run `pnpm test:run src/modules/Grinder`.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm deps:validate`.

## Open questions

- None.

## Tradeoffs and risks

- Preserving original payload text increases IndexedDB storage usage for imported captures, but it is the cleanest way to support faithful export and future higher-fidelity workflows.
- Removing a library entry while keeping patch-level fallback behavior creates two concepts of “selected imported model” versus “reusable library asset,” so the UI needs to communicate that distinction clearly.
