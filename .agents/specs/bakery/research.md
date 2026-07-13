---
type: research
id: RESEARCH-bakery
title: Modular synthesis environments — compile-to-native patching
status: open
owner: The Sourdaw team
sources:
  - Bitwig The Grid, Native Instruments Reaktor, Cycling '74 Max/MSP, VCV Rack
  - Rust audio-graph scheduling and lock-free swap literature
---

# Research: Modular synthesis environments — compile-to-native patching

## Question

How should a node-based modular environment be architected so that visually
authored patches run at native speed inside an existing Rust real-time engine,
without an interpreter on the audio thread?

## Findings

### R-001 — Compile-to-flat-schedule beats graph interpretation

- **Claim:** Topologically sorting the patch graph into a flat ordered task list
  (the same `Vec<ProcessTask>` the DAW already uses) gives cache-local iteration
  and removes pointer-chasing on the audio thread.
- **Evidence:** Bitwig's Grid and modern engines compile rather than interpret;
  graph-walking per sample is the classic modular performance trap.
- **Confidence:** high
- **Bears on:** compilation (AC-004) and RT-safety (AC-005).

### R-002 — Reusing the host engine's primitives avoids a second runtime

- **Claim:** The Bakery should emit the same `ProcessTask` primitives as native
  devices so there is one scheduler, one buffer model, and one swap mechanism.
- **Evidence:** Reaktor maintains a separate engine and pays integration cost;
  a single-engine design keeps latency and feature parity aligned.
- **Confidence:** high
- **Bears on:** device integration (AC-011), architecture alignment.

### R-003 — A typed visual layer prevents invalid patches at edit time

- **Claim:** Distinct port types (audio, CV/control, MIDI/event, gate) with
  edit-time compatibility checks stop users from making nonsensical or
  silently-broken connections.
- **Evidence:** Max/MSP's signal vs control cord distinction and VCV's typed
  ports both rely on this; untyped patching is a common source of confusion.
- **Confidence:** high
- **Bears on:** port type system (AC-003).

### R-004 — Glitch-free topology changes require atomic schedule swap

- **Claim:** Recompiling on edit and publishing via `ArcSwap` lets the audio
  thread adopt the new schedule at a buffer boundary with no dropout, while the
  old schedule frees on a non-audio thread.
- **Evidence:** `arc_swap::ArcSwap` is the established lock-free pointer swap;
  matches the DAW's existing schedule-swap path.
- **Confidence:** high
- **Bears on:** hot reload (AC-006).

### R-005 — Feedback loops are the hard compiler case

- **Claim:** Cycles in the graph cannot be topologically ordered without
  breaking an edge; a one-block delay is the standard resolution, but whether it
  is automatic or user-placed is a design decision with UX consequences.
- **Evidence:** Reaktor and the Grid both insert implicit single-sample/block
  delays; some environments force an explicit delay node for clarity.
- **Confidence:** medium
- **Bears on:** the blocking open question on feedback handling (AC-004).

### R-006 — Fixed voice pools are mandatory for polyphony

- **Claim:** Per-note allocation on the audio thread is forbidden; a Poly device
  must pre-size a voice pool and steal the oldest voice on exhaustion.
- **Evidence:** Standard real-time synth design; matches the engine's no-alloc
  rule.
- **Confidence:** high
- **Bears on:** voice allocation (AC-007).

## Open questions

- [ ] Q-001 — Feedback resolution policy: automatic one-block delay insertion
  vs an explicit user-placed delay node. (Blocking — drives the compiler.)
- [ ] Q-002 — Single device container in v1 vs nested containers; how deep does
  sub-patch nesting go before compilation cost matters?
- [ ] Q-003 — Module catalog versioning: how do patches survive a module's port
  set changing across releases?

## Recommendation

Adopt R-001 + R-002: the Bakery is a compiler front-end onto the existing engine,
not a new runtime. Lock in typed ports (R-003) and `ArcSwap` hot-swap (R-004)
early, decide the feedback policy (Q-001) before writing the compiler, and ship
a single-container v1 (Q-002 deferred). Fixed voice pools (R-006) are
non-negotiable for RT-safety.

## Competitive baseline — keep/improve detail (restored from research/factory/bakery.md §3)

The original consolidated research (`research/factory/bakery.md` §3 "Competitive
Baseline and Extracted Requirements") enumerated explicit per-tool keep/improve
lists. Restored here verbatim so the spec's competitive framing is recoverable.

### Bitwig The Grid — Keep

- device-chain-native integration
- clear signal/cable semantics
- Poly / FX / Note container split
- phase as a first-class signal domain
- audio-rate modulation as a default capability
- visual immediacy
- strong inspector and remote-control integration

### Bitwig The Grid — Improve

- larger patch canvas
- stronger CPU efficiency
- more advanced granular/spectral modules
- easier copy/paste across patches and sub-patches
- deeper patch ecosystem and sharing model

### Reaktor — Keep

- multiple abstraction layers
- sub-patch / macro hierarchy
- community library effect
- ability to build instruments, effects, sequencers, utilities, and unusual hybrids
- low-level building-block access

### Reaktor — Improve

- modern UI
- clearer module browser and docs
- more direct modulation UX
- better CPU efficiency
- easier learning path
- better integration with DAW automation and preset browsing

### Max / MSP / Gen — Keep

- infinite composability
- graph patching for control and signal
- compiled DSP path for performance
- patch-as-device philosophy

### Max / MSP / Gen — Improve

- remove text-object lookup as the primary interaction
- label everything visually
- make ports explicit and readable
- reduce inlet/outlet ambiguity

### VCV Rack — Keep

- hardware-modular familiarity
- vast module imagination
- beautiful module-centric UI
- patch-sharing mindset

### VCV Rack — Improve

- global graph optimization
- built-in polyphony model
- stronger DAW embedding
- lighter CPU footprint
- better routing and state management inside a DAW session

### Voltage Modular / Phase Plant / Softube Modular — Keep

- polished commercial-grade UI
- explicit polyphony helpers
- semimodular clarity where useful
- audio-rate cross-modulation on oscillator/generator domains

## Free resources & instruments — sfizz, WASM constraints, CC0 libraries (restored from research/factory/bakery.md §4)

The original consolidated research (`research/factory/bakery.md` §4 "Free Resources
& Instruments (Sfizz & Samples)") documented the WASM sample-playback technology
stack, its memory constraint and recommended decode architecture, and a named survey
of CC0/CC-BY instrument libraries with concrete specs. That section was dropped in
migration. Restored here verbatim so the underlying findings are recoverable.

### The technology stack and its constraints

**sfizz WASM opcode support is excellent.** The engine supports **96% of SFZ v1**
and 44% of SFZ v2 opcodes. All critical professional instrument opcodes work:
`seq_length`/`seq_position` for round-robin, `sw_last`/`sw_lokey`/`sw_hikey` for
keyswitches, `xfin_locc` for CC crossfading, `group`/`off_by` for choke groups,
flex EGs, filters, and loop controls. FLAC decoding is built-in.

**Memory is the primary WASM constraint.** With no disk streaming available in the
browser sandbox, all samples must reside in memory (limit ~1.5–2.5 GB). The
recommended architecture uses Tauri's Rust backend to decode FLAC via the symphonia
crate and transfer decoded PCM buffers to the WASM virtual filesystem via IPC.

### Acoustic piano: the strongest sampled instrument category

**Salamander Grand Piano** (CC-BY-3.0) provides **16 velocity layers** of a Yamaha C5
Grand sampled at minor-third intervals, with hammer noise, string resonance, and
pedal noise. (394 MB in SFZ+WAV).
**Sofia MZ Pianos** (CC-BY) are the premium option, including a Hamburg Steinway D
with **20 velocity layers** (4.3 GB).
**Splendid Grand Piano** (Public Domain) offers 4 velocity layers in 77 MB as a
fallback.
_(SFZ structure requires layered regions, pedal-up/down states, release triggers, and
sympathetic resonance)._

### Drums and percussion: surprisingly strong free options

**Virtuosity Drums (CC0)**: Contemporary jazz kit with **6 mic positions** and up to
**36 dynamic levels** (~1.5 GB).
**Naked Drums (CC-BY-4.0)**: **10 round-robins** per instrument with 5 velocity layers
(1.3 GB).
_(SFZ structure requires cymbal choke groups, hi-hat CC4 pedal control, round-robin
sequencing, and room mic blending)._

### Guitar and bass

**Karoryfer Emilyguitar (CC0)** (99 MB, DI recording) and **Karoryfer Growlybass
(CC0)** (159 MB, 4 velocity layers, 4 round-robins) are strong choices, particularly
for bass. Guitar requires Faust amp simulation and is limited to basic textures rather
than realistic strumming.

### Mellotron and vintage tape: a creative workaround needed

**No CC0 Mellotron sample library exists.** The workaround: Use clean CC0 flute,
strings, brass, and choir-like sounds from VCSL, then process through a Faust tape
effect chain that adds Wow, Flutter, Saturation, and Hiss.

### Choir and vocal textures

**No CC0 SATB choir library exists.** Use Faust formant synthesis
(`pm.SFFormantModelBP`) to produce "ooh/aah" vocal pads.

### Sample library packaging and delivery strategy

Distribute as FLAC. Decode to PCM at load time using Rust/symphonia in the Tauri
backend, then transfer to WASM virtual filesystem.

- **Bundled:** Faust synthesis, Splendid Grand Piano (77 MB), Gogodze Phu drum kit.
- **First-run download:** Salamander Grand Piano, Virtuosity Drums.
- **On-demand download:** Naked Drums, Sofia MZ piano upgrade.
