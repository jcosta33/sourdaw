---
type: spec
id: SPEC-delivery-export-targets
title: Delivery manager with platform-aware export
status: draft
owner: The Sourdaw team
sources:
  - intake/full-spec.md
---

# Delivery manager with platform-aware export

## Intent

Let the user pick delivery targets (Spotify, Apple Music, YouTube, Podcast, Game
Audio) and auto-generate compliant exports — correct format, sample rate, bit depth,
channel count, and loudness — with the option to export multiple targets at once from
a single render.

## Non-goals

- The encoder/format integrations themselves (FLAC/MP3/Opus/Vorbis, dithering, PDC) —
  see `export-encoders-integrity`.
- Middleware project generation (Wwise/FMOD) — see `game-audio-export`.
- The mastering workspace (see `mastering-page`).
- The loudness measurement engine (see `loudness-metering-ebur128`).

## Requirements

### AC-001 — Factory delivery presets exist

A factory set of delivery presets (target name, format, sample rate, bit depth,
channels, target LUFS, normalize, metadata) must be defined as data.

Verify with: `pnpm test:run -- deliveryPresets`

### AC-002 — Selecting a preset auto-fills export settings

Selecting a delivery preset in the export dialog must auto-fill all format fields.

Verify with: `pnpm test:run -- applyDeliveryPreset`

### AC-003 — Multi-target export from one render

The user must be able to select multiple targets; the project renders once and is
post-processed (resample, per-target loudness normalize) into each target format.

Verify with: `pnpm test:run -- multiTargetExport`

### AC-004 — Per-target loudness normalization

Each exported target must be normalized to its preset's target LUFS.

Verify with: `pnpm test:run -- deliveryLoudnessNormalize`

### AC-005 — Podcast preset carries metadata fields

The podcast preset must expose ID3 metadata fields (title, artist, description)
written into the export.

Verify with: `pnpm test:run -- podcastMetadataExport`

### AC-006 — Auto-filled fields stay user-overridable

After a preset auto-fills the export settings, the user may still override each
format field individually.

Verify with: `pnpm test:run -- applyDeliveryPreset`

## Open questions

- [ ] (non-blocking) Should target presets be user-extensible at v1 or factory-only?
  Default: factory-only, user override of fields per export.

## Affected areas

- `src/modules/Project/models/` (DeliveryPreset)
- `src/modules/Project/presentations/views/ExportDialog.tsx`
- consumes existing resampling and LUFS normalization

## Dropped from sources

- Game Audio per-asset naming/middleware delivery — split into `game-audio-export`.
