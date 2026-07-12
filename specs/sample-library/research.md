---
type: research
id: RESEARCH-sample-library
title: Sample library — source content, packaging, and CC0 libraries
status: restored
sources:
  - research/factory/bakery.md
  - research/factory/samples-slicer.md
---

# Sample library research

This file restores migration-lost research sections that informed the sample-library
spec. Sections below are restored verbatim (or near-verbatim) from the original
research files, with the originating file noted under each heading.

## Offline CC0 source libraries

_Restored from `research/factory/samples-slicer.md` — Section 1 ("Sample Library
Browser Integration"). The spec generalizes these to "curated CC0 packs"; the named
sources and their architecture notes are recorded here so the original record
survives._

### Sample Library Browser Integration

**Codebase Finding:** **Completely missing.** There is no implementation of the Sample Library Browser in the current codebase. The Rust data models (`PackIndex`, `SampleEntry`), Tauri commands (`search_samples`, etc.), and frontend components have not been built.

#### Missing Features & Architecture:

- **Freesound Integration:** OAuth2 authentication, advanced search API integration, and metadata extraction.
- **Offline CC0 Libraries:** Integration with GitHub-hosted libraries (VCSL, LMMS Assets, etc.) and academic sources (University of Iowa MIS).
- **Storage Model:** `index.json` per pack, deterministic sample ID generation (using `blake3`).
- **In-Memory Engine:** Fuzzy search using `nucleo-matcher` across 50k+ items, `BTreeMap` category trees.
- **Audio Preview:** macOS thread-safe `rodio` implementation with `symphonia` for waveform peak decoding and caching.
- **Filesystem Watching:** Debounced hot-reloading of the library using `notify-debouncer-full`.
- **Downloader:** Future implementation to fetch, extract, and index ZIP packs.

## Free instrument sources, workarounds, and packaging strategy

_Restored from `research/factory/bakery.md` — Section "Free Resources & Instruments
(Sfizz & Samples)". Two named workarounds (Mellotron, SATB choir) and the
FLAC-based packaging/delivery strategy were lost in migration; restored verbatim
below._

### The technology stack and its constraints

**sfizz WASM opcode support is excellent.** The engine supports **96% of SFZ v1** and 44% of SFZ v2 opcodes. All critical professional instrument opcodes work: `seq_length`/`seq_position` for round-robin, `sw_last`/`sw_lokey`/`sw_hikey` for keyswitches, `xfin_locc` for CC crossfading, `group`/`off_by` for choke groups, flex EGs, filters, and loop controls. FLAC decoding is built-in.
**Memory is the primary WASM constraint.** With no disk streaming available in the browser sandbox, all samples must reside in memory (limit ~1.5–2.5 GB). The recommended architecture uses Tauri's Rust backend to decode FLAC via the symphonia crate and transfer decoded PCM buffers to the WASM virtual filesystem via IPC.

### Acoustic piano: the strongest sampled instrument category

**Salamander Grand Piano** (CC-BY-3.0) provides **16 velocity layers** of a Yamaha C5 Grand sampled at minor-third intervals, with hammer noise, string resonance, and pedal noise. (394 MB in SFZ+WAV).
**Sofia MZ Pianos** (CC-BY) are the premium option, including a Hamburg Steinway D with **20 velocity layers** (4.3 GB).
**Splendid Grand Piano** (Public Domain) offers 4 velocity layers in 77 MB as a fallback.
_(SFZ structure requires layered regions, pedal-up/down states, release triggers, and sympathetic resonance)._

### Drums and percussion: surprisingly strong free options

**Virtuosity Drums (CC0)**: Contemporary jazz kit with **6 mic positions** and up to **36 dynamic levels** (~1.5 GB).
**Naked Drums (CC-BY-4.0)**: **10 round-robins** per instrument with 5 velocity layers (1.3 GB).
_(SFZ structure requires cymbal choke groups, hi-hat CC4 pedal control, round-robin sequencing, and room mic blending)._

### Guitar and bass

**Karoryfer Emilyguitar (CC0)** (99 MB, DI recording) and **Karoryfer Growlybass (CC0)** (159 MB, 4 velocity layers, 4 round-robins) are strong choices, particularly for bass. Guitar requires Faust amp simulation and is limited to basic textures rather than realistic strumming.

### Mellotron and vintage tape: a creative workaround needed

**No CC0 Mellotron sample library exists.** The workaround: Use clean CC0 flute, strings, brass, and choir-like sounds from VCSL, then process through a Faust tape effect chain that adds Wow, Flutter, Saturation, and Hiss.

### Choir and vocal textures

**No CC0 SATB choir library exists.** Use Faust formant synthesis (`pm.SFFormantModelBP`) to produce "ooh/aah" vocal pads.

### Sample library packaging and delivery strategy

Distribute as FLAC. Decode to PCM at load time using Rust/symphonia in the Tauri backend, then transfer to WASM virtual filesystem.

- **Bundled:** Faust synthesis, Splendid Grand Piano (77 MB), Gogodze Phu drum kit.
- **First-run download:** Salamander Grand Piano, Virtuosity Drums.
- **On-demand download:** Naked Drums, Sofia MZ piano upgrade.
