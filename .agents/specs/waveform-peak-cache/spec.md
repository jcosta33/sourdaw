---
type: spec
id: SPEC-waveform-peak-cache
title: Waveform peak mipmap pre-computation
status: draft
owner: The Sourdaw team
sources:
  - intake/implementation-gaps.md
---

# Waveform peak mipmap pre-computation

## Intent

Stop recomputing waveform min/max peaks on the main thread per zoom level. Generate
peak mipmap pyramids in Rust, persist them next to source audio keyed by content hash,
and ship peak payloads to the frontend as binary buffers so zooming never blocks the
main thread.

## Non-goals

- The arrangement waveform rendering UI itself (it consumes the cached peaks).
- Loudness metering (see `loudness-metering-ebur128`).
- Audio decode/export (see `export-encoders-integrity`).

## Requirements

### AC-001 — Rust mipmap generator

A Rust generator must emit `{min,max}` peak pyramids at standard power-of-two zoom
levels; a 60-minute 48 kHz stereo file completes in ≤3 s and the cache file is ≤2% of
the source WAV size.

Verify with: `pnpm cargo:test -- -p daw-io peak_mipmap_generate`

### AC-002 — Content-addressed persistence and invalidation

Mipmaps must persist next to the source keyed by content hash and regenerate on a hash
mismatch when the source changes.

Verify with: `pnpm cargo:test -- -p daw-io peak_cache_invalidation`

### AC-003 — Binary peak payload to frontend

The peak payload delivered to the frontend must be a binary buffer
(`application/octet-stream`), not a JSON number array.

Verify with: `pnpm cargo:test -- -p daw-io peak_payload_binary`

### AC-004 — Zoom does not block the main thread

Zooming a 32-track project from waveform to arrangement level must not block the main
thread more than ~16 ms per frame, served from the cached mipmap.

Verify with: `pnpm test:run -- waveformZoom`

## Open questions

- [ ] (non-blocking) Cache file format/version naming (`<asset>.peaks.v1`) — confirm and
  document.

## Affected areas

- `crates/daw-io/` (mipmap generator, cache, IPC response)
- waveform renderer (consumes cached peaks)

## Dropped from sources

- None — this spec scopes the §7.4 items directly.
