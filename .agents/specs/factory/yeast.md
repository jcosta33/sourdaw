# Yeast — MIDI FX Rack: Visual Feedback & Advanced Processing

## Reference research

- `.agents/research/factory/special-effects.md` §1 — Yeast gap analysis against current implementation. Enumerates the two concrete missing surfaces (Piano Roll Preview, Groove Template Extraction) and calls out the processors already in the tree.

All implementation-level details on MIDI processor semantics, RT-safe dispatch, and the existing rack architecture live under `src/modules/Yeast/`. This spec does not re-describe how individual processors (Arpeggiator, MarkovChain, EuclideanGenerator, GrooveModule, ChordGenerator, Humanizer, MutationEngine, NoteRepeater, NoteFilter, ScaleQuantizer, Transposer, VelocityProcessor, ChordMemory, Harmonizer, CCGenerator) work — it specifies the user-visible and engine-visible gaps on top of them.

---

## Context

Yeast is the MIDI FX rack that sits between a track's MIDI input (controller, clip, or upstream processor) and the instrument. Its rack architecture, the unified `YeastPanel.tsx` multi-block UI, and 15+ serial MIDI processors are already implemented in `src/modules/Yeast/`:

- `src/modules/Yeast/useCases/MidiRack.ts` — the serial processor chain.
- `src/modules/Yeast/useCases/processors/*.ts` — all 15 concrete processors, each with unit tests under `__tests__/`.
- `src/modules/Yeast/useCases/yeastSchedulingBridge/processRealtimeMidiInput.ts` — realtime ingress.
- `src/modules/Yeast/engine/YeastWorkletNode.ts` — AudioWorklet transport for the rack.
- `src/modules/Yeast/stores/yeastStore.ts` — rack state for the UI.

The research identifies **two** concrete features missing today that keep Yeast below the perceptual bar of comparable rack-style MIDI FX tools (Logic Scripter / Live MIDI Tools / Cubase MIDI Modifier):

1. **No forward visibility into scheduled events.** Users cannot see what the rack is *about to* play. For procedural processors (Arpeggiator, Markov, Euclidean, NoteRepeater, MutationEngine), this breaks the feedback loop between parameter changes and audible outcome.
2. **No way to capture or transfer groove from a performance.** The `GrooveModule` exists with six built-in templates (Straight, MPC Swing, Triplet Shuffle, Late Backbeat, Dilla Pocket, Push) but cannot ingest a user's own timing feel. Producers expect the standard "drag a clip onto the groove slot" workflow.

Those are the gaps this spec closes.

The companion spec `yeast.md` does **not** overlap with `active/articulation-maps.md` (articulation keyswitches) nor with `active/clip-pitch-editing.md` (audio pitch editing). It is strictly about MIDI rack visualization and groove capture.

---

## Goal

Add a real-time piano-roll preview surface and a groove-template extraction pipeline to the existing Yeast rack, so users can see what is about to play and capture the rhythmic feel of any MIDI performance and reuse it across processors — without modifying the semantics of any existing processor.

---

## User-visible behavior

- **Piano-roll preview.** Opening the Yeast panel on any track with procedural processors (Arpeggiator, Markov, Euclidean, NoteRepeater, ChordGenerator, MutationEngine) shows a horizontally scrolling mini piano-roll docked to the rack. Upcoming scheduled events appear as colored rectangles moving right-to-left toward a "now" playhead. Rectangle vertical position encodes pitch, horizontal position encodes scheduled time, width encodes note duration, brightness encodes velocity, and opacity encodes probability (for Markov / MutationEngine / probabilistic Euclidean outputs). Events that never fire (probability-gated off) visibly fade as they approach the playhead and disappear at it.
- **Groove capture.** Dragging a MIDI clip from the arrangement (or a currently-armed recorded phrase) onto a "groove slot" on `GrooveModule` (or a new stand-alone "Groove Template Library" panel in the Yeast UI) extracts a groove template from that clip's note timing and stores it. The extracted template appears in the same dropdown as the built-in templates (MPC Swing, Dilla Pocket, …) and can be applied to any processor that consumes timing offsets: `GrooveModule`, `Arpeggiator` (step timing), `NoteRepeater` (repeat timing), `ChordGenerator` (strum timing), and MIDI note lanes at the clip level when played back.
- **Template management.** Extracted templates persist across sessions, are named (auto-named from the source clip; user-renameable), can be deleted, and survive project reload.
- **No behavioral change to existing processors.** Processors already shipping do not gain, lose, or change parameters. Groove application reuses each processor's existing timing-offset interpretation (currently a scalar swing/shuffle amount); the template replaces the static table `GROOVE_TEMPLATES` as the source of offsets, behind a new "Template Source" control.

---

## Scope

### In scope

- A new React view under `src/modules/Yeast/presentations/views/` for the piano-roll preview.
- An event-preview window: the rack exposes, per block, an ordered list of scheduled events up to a configurable lookahead (default 2 beats).
- A groove-extraction use case that ingests a `MidiClip` (`src/modules/Arrangement/models/`) and produces a `GrooveTemplate` compatible with the existing `GrooveModule` shape.
- A groove template store (slice of `yeastStore` or a new `grooveTemplateStore` — see Design decisions) with persistence.
- Drag-and-drop wiring from the arrangement clip list onto `GrooveModule` and the new groove library panel.
- Extending the processors listed in R4 to optionally consume a `GrooveTemplate` by id rather than only the built-in table.
- Visual feedback: per-processor "active" indicators and rack-level latency readout (R3).

### Non-goals (explicitly out of scope)

- Rewriting, refactoring, or changing the semantics of any existing processor (Arpeggiator, MarkovChain, EuclideanGenerator, etc.).
- Groove extraction from audio clips. Audio-to-MIDI groove extraction would require onset detection and is a separate spec; only MIDI-source extraction is in scope.
- Authoring UI to hand-edit groove templates note-by-note after extraction. Editing is deferred to a later spec; v1 supports extract → use → delete only.
- Cross-track groove application. A template lives at the project level and is referenced by id from individual processors; there is no "master groove track" concept in this spec.
- Groove quantization of already-recorded audio (this is Knead territory).
- Piano-roll preview of audio stems.
- Replacing the AudioWorklet transport for MIDI events; the preview is a *read-only* tap on the existing scheduling bridge.
- Exporting groove templates to file or sharing them between projects.

---

## Requirements

Each requirement has at least one verifiable acceptance criterion.

### R1. Piano Roll Preview — scrolling mini-roll of scheduled upcoming events

The Yeast panel exposes a docked preview view that renders upcoming scheduled MIDI events from the rack's scheduling bridge. The view updates within one animation frame (≤ 16 ms at 60 Hz) of a parameter change and displays events across a configurable lookahead window.

**Display encoding (fixed):**

- **Pitch → vertical position.** Log-linear by MIDI note number across the visible pitch range (auto-ranged to the notes currently scheduled, padded by ±3 semitones).
- **Scheduled time → horizontal position.** Right-to-left scroll; the "now" playhead is a fixed vertical line near the left edge; upcoming events enter from the right.
- **Note duration → rectangle width.**
- **Velocity → rectangle brightness/fill alpha.** Velocity 1 maps to the minimum legible value; velocity 127 to full brightness.
- **Probability → rectangle opacity.** For deterministic processors (Transposer, ScaleQuantizer, NoteFilter, Humanizer, VelocityProcessor) probability is implicitly 1.0. For probabilistic processors (MarkovChain, MutationEngine, probabilistic Euclidean, NoteRepeater with gate<100%) the processor reports its emission probability for each scheduled event and the preview uses that value directly.

**Acceptance criteria:**

- A fixture test drives the rack with a fixed Arpeggiator pattern at 120 BPM and asserts the preview reports the next 8 scheduled events with `timeSamples` matching the rack's internal schedule to the sample.
- A test drives a MarkovChain processor seeded deterministically and asserts each reported preview event has a `probability` value in `[0, 1]` equal to the Markov transition probability that produced it.
- Measured lag between the audio thread emitting an event and the preview component receiving it is **≤ 100 ms** at the 95th percentile over a 60-second run (measured by tagging events with `performance.now()` at emission and comparing with React render time).
- The preview renders without visual tearing when the rack is emitting at ≥ 32 events/sec (verified manually at 180 BPM with a 16th-note Arpeggiator + NoteRepeater at 100% gate).
- The component test (`*.spec.tsx`) asserts rectangle geometry for a fixed fixture: pitch → y-pixel within ±1 px of the log-linear mapping, time → x-pixel within ±1 px of the time mapping, velocity → fill alpha within ±1% of `velocity/127`.

### R2. Groove Template Extraction — round-trip from MIDI clip

The system MUST expose a use case `extractGrooveTemplateFromClip({ clipId, subdivision })` that produces a `GrooveTemplate` whose `offsets` array matches the existing `GROOVE_TEMPLATES` shape (`name: string`, `offsets: number[]` where each entry is in `[-0.5, +0.5]` of step duration). The template MUST be applicable, through the existing `GrooveModule`, back onto a quantized pattern to reproduce the source clip's timing feel.

**Extraction algorithm (normative):**

1. Quantize each source note's `startTime` to the nearest step at the requested subdivision (default 16th notes).
2. Compute the signed offset `Δ = (actualTime - quantizedTime) / stepDuration`, clamped to `[-0.5, +0.5]`.
3. Index by step-within-bar (mod `subdivision`). If multiple notes hit the same step across bars, store their mean offset.
4. Normalize to one bar. If the source clip is longer than one bar, produce `offsets.length = subdivision` (a single-bar template). Longer templates are non-goal in v1.
5. Name the template `"<clipName> groove"` by default.

**Acceptance criteria:**

- **Round-trip fixture test.** Given a source MIDI clip with a known non-straight timing (fixture: `dilla-pocket-reference.mid`), extract a template, apply it via `GrooveModule` to a perfectly quantized 16th-note pattern, and assert the output note times match the source clip's note times within **±5 ticks at 960 PPQN** for all notes that occupy a step present in the source.
- Extracting from a perfectly quantized clip MUST produce an all-zeros offsets array (`Straight`).
- Extracting from an empty clip MUST fail fast with a typed error (`ExtractGrooveTemplateEmptyClipError`) and must not produce an invalid template.
- The extracted template appears in the `GrooveModule` dropdown and the new groove library panel within one React render after extraction completes.
- Persistence: extracting a template, saving the project, reloading, and reading back the template produces byte-identical offsets to the stored value.
- The extraction pipeline imports from `#/modules/Arrangement` only via the module's root barrel (`pnpm deps:validate` passes).

### R3. Additional visual feedback — per-processor activity and rack latency

The rack UI surfaces two additional feedback indicators that already have backing data in the current implementation but are not rendered:

- **Per-processor activity indicator.** Each processor row in the `YeastPanel` lights up an LED-style indicator while its `processMidi` call produces output events in the most recent block. The indicator MUST turn off within one UI frame after the processor's output rate drops to zero for ≥ 500 ms.
- **Rack latency readout.** The panel displays the summed `latencySamples()` across all processors in the chain, expressed in both samples and milliseconds (at the current sample rate). This is a read-only display.

**Acceptance criteria:**

- A component test renders a rack with a bypassed processor and asserts the activity indicator stays dark even when upstream events flow through.
- A component test renders a rack with an Arpeggiator at 120 BPM, confirms the indicator toggles at the expected rate (4 Hz at 16th-notes), and asserts the indicator turns off within 500 ms of stopping the transport.
- Adding or removing a processor with non-zero `latencySamples()` updates the readout to the new sum within one React render.

### R4. Advanced MIDI processing gaps — groove-driven timing consumers

The following processors MUST accept a `GrooveTemplate` by id (in addition to their existing parameters) and apply its offsets to their emitted note timing. This is additive: when no template is selected, behavior is unchanged.

- `GrooveModule` — already consumes templates; new behavior is reading templates by id from the store rather than only the built-in table.
- `Arpeggiator` — step timing is shifted by `offsets[stepIndex]`.
- `NoteRepeater` — each repeat's emission time is shifted by `offsets[repeatIndex % offsets.length]`.
- `ChordGenerator` — if the generator is in strum mode, per-voice offsets are applied to strum timing.
- Note-lane playback at the clip level (non-processor path) — a per-clip "apply groove" setting shifts quantized note starts at read time, without modifying the underlying clip data.

**Acceptance criteria:**

- For each of the four processors above, a unit test asserts that with `template = Straight` the output timing matches the current behavior bit-identically (no regression).
- For each processor, a unit test asserts that with a non-straight template the per-event timing offsets match `offsets[i] * stepDuration` within ±1 sample.
- Applying groove at the clip level does not mutate the underlying `MidiClip` (verified by reading the clip back after playback and asserting deep equality with the pre-playback snapshot).

### R5. Persistence and contracts

- Groove templates persist as part of the project state and survive save/reload.
- The template store exposes only its module-root barrel for cross-module access (`pnpm deps:validate` passes).
- No existing processor's serialized parameter shape changes. Groove-template consumption is an additive field: `grooveTemplateId?: string`.

---

## Constraints

- Must follow the domain-driven module architecture (`AGENTS.md`).
- The preview must not call into the audio thread; it consumes a read-only tap published by the existing scheduling bridge.
- The preview MUST NOT allocate inside the scheduling bridge's hot path; any buffering uses a pre-allocated ring of fixed capacity (default 512 events).
- Preview rendering uses Canvas or WebGL — not one DOM node per event — at any event density permitted by the lookahead window.
- No use of `useMemo` / `useCallback` / `React.memo` / `forwardRef` per `AGENTS.md`.
- No `&&` in JSX rendering paths; use ternaries or early returns.
- Template storage format uses JSON-serializable primitives only (`name: string`, `offsets: number[]`, `subdivision: number`, `sourceClipId?: string`).
- `pnpm deps:validate` must pass with zero violations after the change.

---

## Design decisions

### Decision: where the piano-roll preview lives in the rack UI

**Chosen:** A docked pane at the bottom of the `YeastPanel`, spanning the full width of the rack, collapsible, default-open.
**Considered and rejected:**

- A per-processor inline preview row. Rejected because the value of the preview is seeing the *combined* output after all processors in the chain; per-processor previews would clutter the rack and duplicate work.
- A floating detachable window. Rejected for v1 because the existing panel already supports a multi-block layout and a dockable pane is consistent with it; detaching can be added later without changing the rendering pipeline.

### Decision: groove template storage

**Chosen:** A dedicated slice on `yeastStore` (`grooveTemplates: Record<string, GrooveTemplate>`) persisted alongside the rest of the Yeast state. Templates are keyed by a content-hash id so that re-extracting the same clip yields the same id.
**Considered and rejected:**

- A separate `grooveTemplateStore` module. Rejected because templates are conceptually part of the Yeast MIDI rack contract and no other module currently consumes them.
- Storing templates on the `trackStore` / clip. Rejected because templates are reused across tracks and are not owned by any single clip after extraction.

### Decision: preview lookahead window

**Chosen:** 2 beats, configurable in `[0.5, 8]` beats via a rack setting; buffer sized at 512 events fixed capacity.
**Considered and rejected:**

- A bar-based lookahead. Rejected because at very slow tempos a bar is too long a visual span and at very fast tempos it collapses events into unreadable density; a beat-based default scales more predictably.
- Unbounded event buffer. Rejected for RT-safety; 512 events at typical densities covers >> 2 beats, and the preview surface has no use for events beyond the visible window.

### Decision: probability source for preview opacity

**Chosen:** Processors that emit probabilistic events extend their scheduled-event envelope with an optional `probability: number` in `[0, 1]`. Deterministic processors omit the field; the preview treats missing as `1.0`.
**Considered and rejected:**

- Computing probability in the preview layer from processor-type heuristics. Rejected because it duplicates knowledge of each processor's internal model and would drift from the processor's actual emission decisions.

### Decision: preview data path from scheduling bridge to React

**Chosen:** The existing `processRealtimeMidiInput` path writes preview events into an SPSC ring published by `yeastSchedulingBridge`. A React hook reads the ring on each animation frame (via `requestAnimationFrame`) and pushes the latest window to the preview component's local state.
**Considered and rejected:**

- A `Store<T>`-based push on every event. Rejected because every store write triggers a React render; 30+ events/sec would thrash the renderer.
- Polling the rack directly from React. Rejected because it forces React to know about worklet internals and violates module boundaries.

### Decision: extraction subdivision

**Chosen:** Default 16th notes with user-selectable 8th, 16th, 32nd, or 16T (triplet). Any finer subdivision is rejected as out of scope.
**Rationale:** 16th-note grids cover the overwhelming majority of use cases (MPC-style swing, Dilla pocket, trap hats). Finer grids produce templates that are more artifact than groove.

---

## Acceptance criteria

- [ ] The `YeastPanel` renders a piano-roll preview pane with the encoding specified in R1; component test asserts geometry for a fixed fixture.
- [ ] Preview end-to-end lag from audio thread emission to React paint is ≤ 100 ms at p95 over a 60-second run.
- [ ] Round-trip groove extraction (R2) reproduces a fixture clip's timing within ±5 ticks at 960 PPQN for all active steps.
- [ ] Extracting from a perfectly quantized clip produces an all-zero offsets array.
- [ ] Extracting from an empty clip throws a typed error and does not mutate the store.
- [ ] Saving the project, reloading, and reading back each extracted template yields byte-identical offsets.
- [ ] `GrooveModule`, `Arpeggiator`, `NoteRepeater`, `ChordGenerator`, and clip-level playback apply a selected template's offsets within ±1 sample of the expected offset; each also passes a `Straight` regression test that confirms no timing change.
- [ ] Per-processor activity indicators and rack latency readout render and update per R3.
- [ ] `pnpm deps:validate` passes with zero violations.
- [ ] No existing processor's parameter shape changes (verified by snapshot tests under `src/modules/Yeast/useCases/processors/__tests__/`).
- [ ] Component tests confirm no `&&` JSX patterns and no `useMemo` / `useCallback` / `React.memo` / `forwardRef` usage in new code.

---

## Implementation notes

- **Pattern survey findings:**
    - Reuse `createStore` from `#/infra/store/createStore` for the groove template slice (or extend `yeastStore`).
    - Canvas drawing pattern already exists in `src/modules/Arrangement/presentations/renderers/` — mimic the pixel-snapping and damage-rect approach for preview rendering.
    - The existing `ScheduledEventQueue` in `src/modules/Yeast/models/MidiProcessor.ts` is the natural point to emit preview taps; extend it with a read-only observer interface that publishes into the SPSC ring.
    - `samplesPerBeat(transport)` from `models/MidiEvent.ts` is the canonical time conversion; do not reinvent.
- **Ring buffer:** A plain `Float32Array` + head/tail indices is sufficient for the preview ring; preview events serialize to a fixed-struct-of-scalars (timeSamples, midiNote, velocity, durationSamples, probability, processorIdHash) so the writer is allocation-free.
- **Groove extraction:** Live under `src/modules/Yeast/useCases/grooveTemplates/extractGrooveTemplateFromClip.ts`. Reads MIDI notes via the `#/modules/Arrangement` public barrel only.
- **Activity indicator:** Each processor's `processMidi` already writes to an `output` array; wrap the indicator state on the rack's side by watching the per-processor emit count per block.

---

## Test plan

- **Automated:**
    - Unit tests for `extractGrooveTemplateFromClip` covering: straight input, Dilla fixture, empty clip, partial bar input, cross-bar averaging.
    - Unit tests for each downstream processor's groove consumption: straight regression + non-straight timing accuracy (±1 sample).
    - Component test for the preview pane asserting rectangle geometry for a deterministic Arpeggiator fixture.
    - Component test for activity indicators and latency readout.
    - Latency test driving the rack and measuring emit-to-paint at the 95th percentile.
    - `pnpm deps:validate` in CI after the change.
- **Manual:**
    - Load a drum MIDI clip with known feel, drag onto the groove slot, apply to a straight 16th-note pattern, and confirm the feel transfers audibly.
    - Open Yeast on a track with Arpeggiator + NoteRepeater + MarkovChain, confirm the preview scrolls smoothly at 180 BPM with 32+ events/sec.
    - [ ] Save the project, reload, confirm the extracted template persists and can be reapplied.

    ---

    ## Implementation Status

    - **What is implemented:** The core MIDI FX rack architecture and 15 specific processors (Arpeggiator, MarkovChain, EuclideanGenerator, etc.) are fully implemented in `src/modules/Yeast/` with comprehensive unit tests. The `GrooveModule` exists with built-in templates.
    - **What is not implemented:** The two main features requested by this spec are missing: the real-time Piano Roll Preview (forward visibility into scheduled events) and the Groove Template Extraction pipeline (capture from MIDI clips).
    - **What is done well:** The modular processor architecture and the separation between UI and the worklet engine are excellent. The individual processors are well-tested.
    - **What needs refactoring:** The scheduling bridge needs to be extended with a read-only tap to publish events to the new preview surface.


---

## Open questions

- [ ] **[MAJOR]** Should preview events from bypassed processors still show (greyed out) or be hidden entirely? Bypassed processors technically emit pass-through events; the preview could either show them as normal (consistent with "what you hear") or grey them out to indicate their contribution is inert.
- [ ] **[MAJOR]** Probability reporting contract: for processors that are *effectively* probabilistic (e.g., Humanizer with a non-zero velocity-drop chance, MutationEngine with transformation probabilities), do we require each such processor to plumb an explicit probability through, or is a declared "this processor is non-deterministic; assume variable opacity" flag enough? Affects R1 and R4 consumer surface.
- [ ] **[MINOR]** Preview pitch-range auto-ranging — should it clamp to the last N seconds of scheduled events to avoid pitch-axis jitter, or hold the widest range seen since transport started?
- [ ] **[MINOR]** Should extracted templates survive project deletion / be exportable to `.mid` or a native format? Current spec is "in-project only"; a later spec can add export.
- [ ] **[MINOR]** Name collision strategy when two extracted templates share the default name. Current plan: append a numeric suffix (`"Clip 1 groove (2)"`). Confirm.
- [ ] **[MINOR]** When a template is deleted, any processor currently referencing it should fall back to `Straight`. Confirm this over "refuse deletion while referenced".

---

## Tradeoffs and risks

- **Preview lag vs RT-safety.** The preview is deliberately read-only and frame-paced, so it cannot jitter the audio thread. The cost is that the preview can drift up to 100 ms behind reality under heavy load; this spec accepts that explicitly.
- **Canvas vs DOM rendering.** Canvas is chosen for event density but loses accessibility affordances. This is acceptable because the preview is a read-only visualization, not an editor; ARIA labels on the enclosing pane describe the view's purpose.
- **Template persistence format.** The chosen format is forward-compatible with multi-bar templates (just extend `offsets.length`), at the cost of being locked to a fixed subdivision field; migrating to a richer format later is a single store migration.
- **Probability semantics.** Defining probability per processor means the contract is slightly leaky (each probabilistic processor must plumb a number through), but the alternative (centralizing probability inference) would re-implement each processor's internal logic in the preview layer.
