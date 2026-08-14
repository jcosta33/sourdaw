---
type: spec
id: SPEC-export-encoders-integrity
title: Offline export encoders and signal integrity
status: draft
owner: The Sourdaw team
sources:
  - intake/implementation-gaps.md
  - intake/full-spec.md
---

# Offline export encoders and signal integrity

## Intent

Broaden export format coverage (FLAC, MP3, Vorbis, Opus on top of WAV) and guarantee
signal integrity during offline render: stream output chunks rather than buffering the
whole project, apply TPDF dithering on any bit-depth reduction, and apply
sample-accurate plugin delay compensation so delay-bearing plugins do not shift against
the master timeline.

## Non-goals

- Delivery-target presets and loudness normalization (see `delivery-export-targets`).
- The mastering workspace (see `mastering-page`).
- Game-middleware export (see `game-audio-export`).
- DAWproject/.sourdaw interchange (see `dawproject-interchange`).

## Requirements

### AC-001 — FLAC/MP3/Vorbis/Opus encode

Offline export must support FLAC (lossless, bit-exact), MP3, Vorbis, and Opus on both
native and browser builds, with each lossy format within ≤0.5 dB RMS of source at
nominal bitrate.

Verify with: `pnpm cargo:test -- -p daw-io encode_formats_roundtrip`

### AC-002 — Streamed output, bounded memory

Export must stream output chunks so a 64-track project uses peak working memory ≤2× the
largest single-track render buffer, not the whole-project buffer.

Verify with: `pnpm cargo:test -- -p daw-io export_streaming_memory`

### AC-003 — TPDF dithering on bit-depth reduction

Reducing bit depth (float → 16/24-bit PCM) must apply TPDF dither by default unless the
user explicitly disables it.

Verify with: `pnpm cargo:test -- -p daw-io tpdf_dither_default`

### AC-004 — Plugin delay compensation during offline render

Stem export of a project containing a look-ahead limiter and a linear-phase EQ must
align every stem with the master bounce within ≤1 sample (PDC applied offline).

Verify with: `pnpm cargo:test -- -p daw-io offline_pdc_alignment`

### AC-005 — Sidechain-aware stem export

Stem export of a track whose sidechain compressor is keyed from another track (e.g. a
kick-sidechained bass) must render the target stem with its sidechain input fed from the
source track's rendered output — not silence — so the audible pumping is preserved in the
exported stem rather than rendering each track in isolation.

Verify with: `pnpm cargo:test -- -p daw-io sidechain_aware_stem_export`

## Open questions

- [ ] (non-blocking) Browser lossy path: `wasm-media-encoders` vs `libflacjs` where the
  native path is not applicable — resolve per format during implementation.
- [ ] (deferred-gap from intake/full-spec.md) Inter-track dependency rendering for stem
  export beyond sidechain: the current `src/modules/AudioEngine/useCases/exportStems.ts` renders each track in isolation
  via `renderOffline.ts`, which also breaks send effects and bus processing. Build a
  dependency-aware render sequence: (a) build a dependency graph from sidechain routes
  queried from the Routing store (`src/modules/Routing/`, `addSidechainRoute`/
  `removeSidechainRoute`), topologically sort so sidechain sources render before their
  targets (render independent sources concurrently); (b) render send effects by rendering
  the send bus with its effect chain, then mix the wet signal back into each stem at the
  correct wet/dry ratio per stem; (c) apply bus processing correctly per stem. The
  existing `src/modules/Arrangement/services/getUpstreamSubgraph.ts` already computes the
  upstream subgraph (takes a `trackId`, all tracks, all sidechain routes; returns the
  `Set<string>` of upstream track IDs by traversing output routing, sends, and sidechain
  relationships) and `buildDeviceChain` already constructs the graph including sidechain
  connections — the offline renderer must honor these connections instead of rendering in
  isolation. (Non-blocking: send/bus fidelity is broader scope; the kick→bass sidechain
  case is captured as AC-005.)

## Affected areas

- `crates/daw-io/` (encoders, streaming export, dither, offline PDC)
- existing WAV/SRC export path

## Dropped from sources

- None — this spec scopes the §8.3c items directly.
