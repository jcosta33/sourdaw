---
type: spec
id: SPEC-yeast
title: Yeast MIDI FX rack — preview and groove capture
status: draft
owner: The Sourdaw team
sources:
  - self
---

# Yeast MIDI FX rack — preview and groove capture

## Intent

Add a real-time piano-roll preview and a groove-template extraction pipeline to the Yeast
MIDI FX rack, so users can see what is about to play and capture the rhythmic feel of any
MIDI performance and reuse it across processors — without changing the semantics of any
existing processor.

## Non-goals

- Rewriting or changing the semantics of any existing processor.
- Groove extraction from audio clips (MIDI-source only).
- A note-by-note editor for extracted templates.
- Cross-track "master groove track" application.
- Exporting groove templates to file or between projects.
- Piano-roll preview of audio stems (the preview shows scheduled MIDI events only).
- Groove quantization of already-recorded audio (this is Knead territory).
- Replacing the AudioWorklet transport for MIDI events — the preview is a read-only tap on
  the existing scheduling bridge.

## Requirements

### AC-001 — Preview renders upcoming scheduled events

The Yeast panel must render a scrolling mini piano-roll of upcoming scheduled MIDI events
read from the rack's scheduling bridge.

Verify with: `pnpm test:run -- YeastPanel`

### AC-002 — Preview encoding maps to fixed geometry

Each preview event must encode pitch as vertical position, scheduled time as horizontal
position, duration as width, velocity as brightness, and probability as opacity.

Verify with: `pnpm test:run -- YeastPanel`

### AC-003 — Preview lag stays bounded

Emit-to-paint lag from the audio thread to the React render must stay at or below 100 ms at
the 95th percentile over a 60-second run.

Verify with: `pnpm test:run -- YeastPanel`

### AC-004 — Groove extraction round-trips a clip's feel

`extractGrooveTemplateFromClip` must produce offsets that, reapplied via `GrooveModule` to a
quantized pattern, reproduce the source clip's note times within ±5 ticks at 960 PPQN.

Verify with: `pnpm test:run -- extractGrooveTemplateFromClip`

### AC-005 — A quantized clip yields a straight template

Extracting from a perfectly quantized clip must produce an all-zero offsets array.

Verify with: `pnpm test:run -- extractGrooveTemplateFromClip`

### AC-006 — An empty clip fails with a typed error

Extracting from an empty clip must throw `ExtractGrooveTemplateEmptyClipError` without
mutating the store.

Verify with: `pnpm test:run -- extractGrooveTemplateFromClip`

### AC-007 — Groove consumers apply template offsets

`GrooveModule`, `Arpeggiator`, `NoteRepeater`, `ChordGenerator`, and clip-level playback must
shift emitted note timing by `offsets[i] * stepDuration` within ±1 sample of expectation.

Verify with: `pnpm test:run -- processors`

### AC-008 — The Straight template is a no-op

With the Straight template selected, each consumer's timing must match its no-template
behavior bit-identically.

Verify with: `pnpm test:run -- processors`

### AC-009 — Templates persist across reload

An extracted template must survive project save and reload with byte-identical offsets.

Verify with: `pnpm test:run -- yeastStore`

### AC-010 — Existing processor shapes are unchanged

No existing processor's serialized parameter shape must change; groove consumption is an
additive optional `grooveTemplateId` field.

Verify with: `pnpm test:run -- processors`

### AC-011 — Rack surfaces activity and latency feedback

The panel must surface a per-processor activity indicator while a processor emits output and
a read-only summed rack-latency readout in samples and milliseconds.

Verify with: `pnpm test:run -- YeastPanel`

### AC-012 — No cross-module internal imports

The extraction pipeline must reach `Arrangement` only through its module-root barrel.

Verify with: `pnpm deps:validate`

### AC-013 — Extraction subdivision is user-selectable

`extractGrooveTemplateFromClip` must accept a `subdivision` argument the user selects from
8th, 16th, 32nd, or 16T (triplet) — defaulting to 16th.

Verify with: `pnpm test:run -- extractGrooveTemplateFromClip`

### AC-014 — Extracted templates are auto-named, renameable, and deletable

An extracted template must be auto-named from its source clip (`"<clipName> groove"`),
renameable by the user, and deletable.

Verify with: `pnpm test:run -- yeastStore`

### AC-015 — Cross-bar collisions store the mean offset

When multiple source notes quantize to the same step across bars, the extraction must store
their mean offset for that step.

Verify with: `pnpm test:run -- extractGrooveTemplateFromClip`

### AC-016 — Clip-level groove application does not mutate the clip

Applying a groove template at the clip level must not mutate the underlying `MidiClip`,
verified by reading the clip back after playback and asserting deep equality with the
pre-playback snapshot.

Verify with: `pnpm test:run -- processors`

### AC-017 — Preview tap is allocation-free and GPU/Canvas-rendered

The preview tap must not allocate inside the scheduling-bridge hot path — buffering must use
a pre-allocated fixed-capacity ring of 512 events.

Verify with: `pnpm test:run -- yeastSchedulingBridge`

### AC-018 — Preview pitch auto-ranges and stays untorn; bypassed processors stay dark

The preview must auto-range its pitch axis to the scheduled notes padded by ±3 semitones,
render without visual tearing at ≥ 32 events/sec at 180 BPM, and keep a bypassed processor's
activity indicator dark even while pass-through events flow.

Verify with: `pnpm test:run -- YeastPanel`

### AC-019 — Finer-than-supported subdivisions are rejected

`extractGrooveTemplateFromClip` must reject any subdivision finer than the supported set as
out of scope.

Verify with: `pnpm test:run -- extractGrooveTemplateFromClip`

### AC-020 — Deleting a template falls referencing processors back to Straight

On deletion of a template, any processor referencing it must fall back to `Straight`.

Verify with: `pnpm test:run -- yeastStore`

### AC-021 — Preview rendering uses Canvas or WebGL

Preview rendering must use Canvas or WebGL rather than one DOM node per event.

Verify with: `pnpm test:run -- yeastSchedulingBridge`

### AC-022 — Lookahead window is configurable in beats

The rack must expose, per block, an ordered list of scheduled events up to a configurable
lookahead window that defaults to 2 beats and accepts values in `[0.5, 8]` beats via a rack
setting. The 512-event ring (AC-017) is the fixed-capacity buffer backing this window.

Verify with: `pnpm test:run -- yeastSchedulingBridge`

### AC-023 — Preview reflects a parameter change within one animation frame

The preview must update within one animation frame (≤ 16 ms at 60 Hz) of a parameter change,
distinct from the steady-state emit-to-paint p95 bound in AC-003.

Verify with: `pnpm test:run -- YeastPanel`

### AC-024 — Probability-gated events fade out and vanish at the playhead

A scheduled event that will not fire (probability-gated off) must visibly fade as it
approaches the playhead and disappear at it, rather than crossing the playhead at full
opacity.

Verify with: `pnpm test:run -- YeastPanel`

### AC-025 — Activity indicator turns off after sustained silence

A per-processor activity indicator must turn off within one UI frame after that processor's
output rate has been zero for ≥ 500 ms.

Verify with: `pnpm test:run -- YeastPanel`

### AC-026 — Dragging a MIDI clip onto a groove slot extracts a template

Dragging a MIDI clip from the arrangement (or an armed recorded phrase) onto a groove slot on
`GrooveModule` (or the Groove Template Library panel) must invoke `extractGrooveTemplateFromClip`
for that clip and store the resulting template, which then appears in the same dropdown as the
built-in templates.

Verify with: `pnpm test:run -- YeastPanel`

### AC-027 — New preview/groove components avoid memoization and JSX `&&`

New components added for the preview and groove-library surfaces must not use `useMemo`,
`useCallback`, `React.memo`, or `forwardRef`, and must not use `&&` in JSX rendering paths
(per repo-wide `AGENTS.md` conventions), asserted by a component test.

Verify with: `pnpm test:run -- YeastPanel`

## Open questions

- [ ] (non-blocking) Show bypassed-processor events greyed out, or hide them entirely?
- [ ] (non-blocking) Require each probabilistic processor to plumb an explicit probability, or accept a "non-deterministic" flag?
- [ ] (non-blocking) Auto-range the preview pitch axis to the last N seconds, or hold the widest range since transport start?
- [ ] (non-blocking) Name-collision strategy for duplicate default template names; deletion fallback to Straight for referencing processors.
- [ ] (non-blocking) (deferred-gap from intake/spec-of-the-gaps.md) §4.2 Yeast (MIDI FX), source `yeast.md`, names three gaps for this rack: (a) a real-time Piano Roll Preview giving forward visibility into scheduled events; (b) a Groove Template Extraction pipeline from MIDI clips; (c) extending the scheduling bridge with a read-only tap for preview events. All three are already carried as requirements above — (a) by AC-001/002/003/011/017/018/021, (b) by AC-004 through AC-006, AC-009, AC-013 through AC-015, AC-019, AC-020, and (c) by AC-017 (allocation-free tap on the scheduling-bridge hot path) and AC-001 (preview reads from the rack's scheduling bridge). Open only to confirm the umbrella intake's three gaps map cleanly onto this spec's ACs; no unmet behavior remains.
- [ ] (non-blocking) (deferred-gap from intake/implementation-gaps.md) §7.8c "MIDI Effects Pipeline, Probability, MPE Allocator, MIDI Clock" is a broader, mostly engine-level scope that only partly overlaps Yeast. It asks for: (1) a **MIDI FX chain** slot list on every MIDI track, evaluated before the instrument, with v1 modules **Arpeggiator**, **Velocity Scaler**, and **Groove Quantizer** (Zeitgeist-style — research `architecture-performance.md` §4); a chain of Arpeggiator + Velocity Scaler + Groove Quantizer in series must produce bit-for-bit deterministic output for a fixed input sequence given the same seed and parameters. (2) Per-note `probability: f32 (0.0..=1.0)` on the sequencer event model; the RT scheduler skips notes whose roll exceeds probability, and determinism holds when the RNG seed is saved in the arrangement — acceptance: notes at `probability = 0.5` fire ~50% over 1000 runs with different seeds within **±3σ** binomial variance, and a seed-pinned sequence is bit-for-bit reproducible. (3) A ~200-line **MpeAllocator** that assigns per-note channels 2–16 with an LRU policy, supports the MPE "lower zone" convention, and is RT-safe (no allocation, no locks) — acceptance: a fast chromatic run at 200 BPM / 1/16 notes has channel-reuse stalls **≤ 1** across 10 000 events. (4) A sample-accurate **MIDI clock output** generator driven by the audio callback: `0xF8` at 24 PPQN, `0xFA`/`0xFC`/`0xFB` on transport start/stop/continue, routed to enabled MIDI output ports via `midir` — acceptance: a downstream clock slave measures `0xF8` tick jitter **≤ 0.5 ms** stddev over 60 s at 120 BPM. Only the Groove Quantizer / Arpeggiator portion touches this spec's groove-template work (AC-007 already lists Arpeggiator among groove consumers); the per-note probability model, MpeAllocator, MIDI clock output, and the track-wide pre-instrument FX chain slot list are engine/Rust scope outside the Yeast preview-and-groove-capture intent and need their own spec.

## Affected areas

- `src/modules/Yeast/presentations/views/` (preview pane + groove library panel)
- `src/modules/Yeast/useCases/grooveTemplates/extractGrooveTemplateFromClip.ts`
- `src/modules/Yeast/stores/yeastStore.ts` (groove template slice)
- `src/modules/Yeast/useCases/yeastSchedulingBridge/processRealtimeMidiInput.ts` (preview tap)

## Dropped from sources

- Per-processor inline preview rows — a single docked combined preview is the chosen surface.
- A separate `grooveTemplateStore` module — templates live as a slice on `yeastStore`.
- Template export and audio-source groove extraction — deferred to a later spec.
