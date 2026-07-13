---
type: research
id: RESEARCH-orchestra-lod-governor
title: Orchestra memory and quality governor — research
status: draft
owner: The Sourdaw team
sources:
  - research/factory/advanced-instruments.md
---

# Orchestra memory and quality governor — research

This note holds the source research behind `SPEC-orchestra-lod-governor`,
restored from the migration-lost original. The spec's AC-001 (native disk
streaming with a preloaded attack buffer) traces directly to the DFD
disk-streaming research below, including the specific initial-load figure
(64-240KB) that was dropped during migration.

## Restored from research/factory/advanced-instruments.md — Orchestral Engine & Sampling

> Restored verbatim from `research/factory/advanced-instruments.md` (commit
> `bb84b0e`). The disk-streaming initial-load figure ("the initial 64-240KB of a
> sample into RAM") is the specific datum lost in migration; the surrounding DFD
> streaming behavior (attack buffer + background thread, no audio-thread I/O) is
> reflected in the spec's AC-001.

### Missing/Changed Features:

- **Disk Streaming (Native Only):** DFD-style streaming loading only the initial 64-240KB of a sample into RAM and streaming the rest from disk via a background thread. [ANNOTATION: The `creek` crate or equivalent async file reading is missing. Currently, samples must be fully loaded in memory. **SUPERIOR METHOD:** Original Research - Direct-from-disk (DFD) streaming is critical for large orchestral sample libraries to prevent RAM exhaustion and long load times, whereas fully loading samples limits scalability.]
- **Microphone Positions & Phase Alignment:** [ANNOTATION: The `zone_lut` handles mic IDs, but time-delay compensation and phase alignment are missing.] Use GCC-PHAT offline to estimate sample delay for mic alignment. Room mics should remain physically delayed to preserve depth.
- **Score Import & Tempo Mapping:** Parse SMF files (via `midly`) to build piecewise tempo maps and extract articulation metadata. [ANNOTATION: The `midly` crate is not present in the dependency graph.]
