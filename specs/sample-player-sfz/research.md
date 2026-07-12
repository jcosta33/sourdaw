---
type: research
id: RESEARCH-sample-player-sfz
title: SFZ sample-player instrument
status: open
owner: The Sourdaw team
sources:
  - "Question: how should an SFZ sample-player be parsed, voiced, and run RT-safely in a Web Audio / Tauri DAW?"
---

# Research: SFZ sample-player instrument

## Question

How should an SFZ-based sample-player instrument parse the SFZ format, allocate and steal
voices, and execute envelopes and looping RT-safely in a Web Audio / Tauri engine?

## Findings

### R-001 — SFZ is the open, text-based instrument format to target

- **Claim:** SFZ (open, text-based opcode format) is the right interchange for a sampler instrument; a parser maps `<region>`/`<group>`/`<global>` opcodes to playback parameters.
- **Evidence:** SFZ format spec (sfzformat.com); existing parsers (`sfz-parser`, sforzando/sfizz behaviour).
- **Confidence:** high
- **Bears on:** AC-001 (parsing), AC-002 (sample resolution).

### R-002 — AudioWorklet with a shared voice state buffer

- **Claim:** Voice rendering belongs in an `AudioWorkletNode`; voice state shared via `SharedArrayBuffer` lets the main thread observe/control voices without blocking the audio render quantum.
- **Evidence:** Web Audio AudioWorklet design; SAB usage for cross-thread state; COOP/COEP requirement.
- **Confidence:** medium
- **Bears on:** AC-003 (voice stealing), AC-005 (loop continuity).

### R-003 — Bounded polyphony needs a deterministic steal policy

- **Claim:** With a fixed voice pool, exceeding polyphony must steal the oldest/quietest voice by a deterministic policy so behaviour is reproducible.
- **Evidence:** standard sampler voice-allocation literature; MPC/Kontakt steal modes.
- **Confidence:** high
- **Bears on:** AC-003.

### R-004 — ADSR + loop modes are the core playback engine

- **Claim:** Per-region ADSR envelopes and loop modes (no-loop, loop-continuous, loop-sustain) cover the dominant SFZ playback cases; loop crossfades avoid seam clicks.
- **Evidence:** SFZ `loop_mode`/`ampeg_*` opcodes; sampler loop-crossfade practice.
- **Confidence:** high
- **Bears on:** AC-004 (envelopes), AC-005 (loop continuity).

### R-005 — Missing samples must degrade gracefully

- **Claim:** When a referenced sample file is missing, the instrument must load with that region silent and surfaced, not fail the whole instrument load.
- **Evidence:** robustness pattern from sample-library loaders; source design notes.
- **Confidence:** medium
- **Bears on:** AC-006 (missing-sample handling).

## Open questions

- [ ] Q-001 — Which SFZ opcode subset is v1 (full sfizz coverage is large)?
- [ ] Q-002 — Disk-streaming vs full RAM load threshold for large multisample libraries.
- [ ] Q-003 — Round-robin / random sample selection support in v1?

## Recommendation

Parse SFZ to a region model (R-001), render voices in an AudioWorklet with SAB-shared
state (R-002), enforce a deterministic voice-steal policy under bounded polyphony (R-003),
and implement ADSR plus the three core loop modes with crossfades (R-004). Degrade
gracefully on missing samples (R-005). Define the v1 opcode subset (Q-001) before
committing the parser surface.

## Restored from sources — Free Resources & Instruments (Sfizz & Samples)

> Provenance: restored verbatim from `research/factory/bakery.md`, Section 4 (commit
> `bb84b0e`). This primary-source survey of the sfizz WASM engine and CC-licensed sample
> libraries had no home in the suspec after the migration; it is recovered here because it
> directly informs the SFZ opcode subset, the WASM/decode architecture, and the candidate
> factory instruments for this feature. Codebase annotations are the original author's.

## 4. Free Resources & Instruments (Sfizz & Samples)

> **Codebase Annotation:** Faust synthesis is **fully implemented** (`src/modules/Plugin/useCases/faustEngine`, `faustwasm` integration, and numerous Faust presets like `factory-faust-minimoog-lead`). The Faust sections have been DELETED from this document. However, `sfizz` (SFZ player via WebAssembly) and the specific sample library integrations (Salamander Grand, VSCO 2 CE, etc.) are **missing** from the codebase.

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
