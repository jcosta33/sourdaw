---
type: spec
id: SPEC-collaboration-asset-transfer
title: Collaboration asset transfer — library policies and resume
status: draft
owner: The Sourdaw team
sources:
  - intake/implementation-gaps.md
---

# Collaboration asset transfer — library policies and resume

## Intent

Stop forcing full transfers of large commercial libraries and stop restarting transfers
on disconnect. Add per-peer library-root mappings that resolve asset hashes locally (zero
network bytes when the library is installed), a prompt-before-transfer policy for
commercial assets, and resumable bitmap-chunked transfer with per-chunk BLAKE3 integrity.

## Non-goals

- Peer discovery / VPN / DHT (see `collaboration-discovery`).
- Voice/monitoring media channels (see `collaboration-discovery`).
- Roles and trust tokens (see `collaboration-roles-trust`).

## Requirements

### AC-001 — Local library mapping skips transfer

Opening a project referencing 10 GB of installed-and-mapped library content must trigger zero
bytes of WebRTC transfer for those assets; mappings are per-peer and never written to the
shared Automerge document.

Verify with: `pnpm test:run -- assetLibraryMappingNoTransfer`

### AC-002 — Missing-library policy prompt

A peer lacking the library and mapping must see a modal listing the missing library, expected
size, and three options (Transfer anyway / Substitute silence / Resolve manually);
substitute-silence keeps editing unblocked and marks affected clips.

Verify with: `pnpm test:run -- assetMissingLibraryPolicy`

### AC-003 — Resume from bitmap, no full restart

Disconnecting a 1 GB transfer at 50% and reconnecting must resume from ≤50% + one chunk, using
a persisted per-asset chunk bitmap.

Verify with: `pnpm test:run -- assetTransferResume`

### AC-004 — Per-chunk integrity

A corrupted chunk (flipped byte) must be detected by BLAKE3 and re-requested without aborting
the whole transfer.

Verify with: `pnpm test:run -- assetChunkIntegrity`

### AC-005 — Bitmap lifecycle

Bitmaps older than 30 days or for unreferenced assets must be garbage-collected; a completed
transfer leaves no bitmap residue.

Verify with: `pnpm test:run -- assetBitmapLifecycle`

## Open questions

- [ ] (non-blocking) Default chunk size and where bitmaps persist (app cache dir assumed).

## Affected areas

- `src/modules/Collaboration/` `assetTransfer.ts`, library-root mapping in app settings
- missing-asset modal, background GC job

## Dropped from sources

- None — scopes §9.6 and §9.7 directly.
