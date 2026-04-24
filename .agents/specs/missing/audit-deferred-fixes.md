---
name: consolidated-audit-deferred-fixes
description: Implementation spec for the deferred items in `.agents/audits/consolidated-issues.md`. Each section is independently implementable with verifiable acceptance criteria.
type: spec
status: open
related-audit: .agents/audits/consolidated-issues.md
---

# Consolidated audit — deferred fixes

## Context

The audit at `.agents/audits/consolidated-issues.md` was partially addressed in the 2026-04-16 fix pass. 13 issues are fixed in code and the audit is annotated. The remaining issues are deferred either because they are architectural (require a contract/interface), require performance work that needs care (Rust DSP, RT paths), require a UX or product decision, or require a small spec to specify behaviour beyond a one-line code change.

This spec is the contract a future agent will execute against. It is grouped by theme so that work in one group does not stall on unrelated questions in another. Each item carries its own scope, requirements, design decisions, and acceptance criteria. Agents may pick up groups in parallel; intra-group items have ordering noted where it matters.

This spec does **not** revisit fixed items — it begins from the audit's `Session status` block. The audit remains the source of truth for the current state; this spec is the source of truth for what "done" looks like for the remaining work.

Reference docs and skills (load before working in any group):

- `docs/architecture/01-system.md`, `docs/architecture/03-typescript-module.md`, `docs/architecture/02-rust-backend.md`
- `.agents/skills/web-audio-engine/SKILL.md`, `.agents/skills/plugin-hosting/SKILL.md`
- `.agents/skills/state-and-write-paths/SKILL.md`, `.agents/skills/ui-patterns/SKILL.md`
- `.agents/skills/tauri-platform/SKILL.md`, `.agents/skills/architecture-violations/SKILL.md`
- `.agents/skills/llm-action-bridge/SKILL.md` (for AI-runtime work in Group C)

---

## Goal

Close every deferred issue from the consolidated audit with code that compiles cleanly (`cargo check --workspace`, `pnpm typecheck`, `pnpm deps:validate` zero violations), test coverage where the audit asks for it, and audit-file annotations bumped to `FIXED` for each item. After this spec is fully implemented the audit moves to `status: resolved` (or only `## Resolved` items remain).

---

## User-visible behavior

The user-visible end state, by group:

- **Timeline / MIDI editing** — every clip-time operation (move, nudge, split, duplicate, insert-time, delete-time, ripple-delete, stretch) keeps MIDI notes, CC, pitch-bend, and automation in correspondence with their owning clip. Drag previews show notes moving with the clip; stretch previews scale notes and waveforms live; trimmed/looped/stretched clips draw the correct slice and not the whole buffer.
- **DSP correctness & cost** — the four-band crossover sums flat to within 0.5 dB across the audio band; the limiter has constant per-sample cost regardless of lookahead; pitched-up Crumbs voices do not alias.
- **Audio engine architecture** — adding a new plugin does not require editing `TrackNode`; bypass on a generic device does not rebuild the graph; native plugins run audio through SAB rings rather than per-block IPC.
- **AI runtime** — there is one entry point for an LLM call. Schema-constrained, tool-calling, and freeform chat all funnel through it. Backend selection, status transitions, and grammar fallback live in one place.
- **Persistence** — Knead pitch edits and action history survive reload. AI undo touches only the documents the AI plan changed.
- **Plugin instances** — Levain, Toaster, and Fermenter hold per-instance state. Two instances of the same plugin on different tracks have independent UI state and telemetry.
- **Telemetry** — Fermenter meters/scope flow through a SAB ring sampled at UI rate, not through React store updates per audio tick.
- **UI** — `ChatPanel` and `PianoRoll` only re-render the message/clip that actually changed. `ReasoningBlock` accessibility is unchanged from the 2026-04-16 fix.
- **Recording** — stereo tracks record stereo without being downmixed; the input picker exposes channel count.
- **Plugin host PDC** — recorded audio, MIDI, and automation align in time with the played-back signal regardless of plugin latency.

---

## Scope

### In scope

All deferred items from `consolidated-issues.md` and its `# Audit: Timeline and MIDI Editing Behavior` section that have not been re-classified as out-of-scope below:

- Timeline §1 (completion), §4, §6, §7, §8.
- I-01, I-02, I-03, I-04, I-05, I-06, I-08, I-12, I-14, I-15, I-16, I-19 (subsumed by I-05), I-21, I-22, I-26, I-27, I-29.

### Non-goals (explicitly out of scope)

- **I-25** (Proof vs `Plugin/ProofChamber` duplication) — product decision; surface as a question to the maintainer, do not delete code.
- **I-28** (`LocalStorageKeys` legacy keys) — file header requires legal review; out of scope for an agent.
- **I-30** (per-plugin DSP claims carried over) — must move into per-plugin audits before any code work; this spec does not implement those.
- **Pre-existing breaks** that the 2026-04-16 fix pass surfaced but did not introduce:
    - `crates/daw-dsp/src/grand_boule/voice.rs` missing `envelope` field.
    - `src/modules/AiRuntime/repositories/webMidi/messageHandlers.ts:224` missing `getCompensationDelay`.

    These are tracked separately. They are not gating for this spec but should be fixed before the workspace is declared clean.

- Migrating MIDI notes from absolute to relative positioning. The audit lists this as a "Suggested approach"; this spec preserves the absolute model and fixes the operations that desync. A relative-MIDI migration is a separate, larger spec.
- Building new flagship features described in `implementation-gaps.md` (drum-machine flagship, ZDF filters, ghost playheads, etc.). That spec is forward-looking; this one is corrective.

---

## Constraints

- All code must follow the domain-driven module architecture (`docs/architecture/03-typescript-module.md`). New use cases are one-function-per-file. Cross-module imports go through `<module>/{useCases,events,stores,presentations/views}/index.ts`. No deep imports across module boundaries.
- `pnpm deps:validate` must report **0 violations** after each group is complete.
- `pnpm typecheck` must pass cleanly. Resolve any new errors introduced; pre-existing unrelated errors remain unrelated unless they are explicitly listed in scope.
- Rust changes must keep `cargo check --workspace` clean. Pre-existing crate breaks listed under "Non-goals" remain pre-existing — they are not introduced or worsened.
- Real-time safety (`AGENTS.md` → audio thread): no allocations, no locks, no blocking, no React state, no Tauri calls on the audio thread or in any worklet `process()`. Any new RT-adjacent code must be reviewed against `.agents/skills/web-audio-engine/SKILL.md` § Real-time safety rules.
- React 19 / React Compiler rules (`AGENTS.md` → React 19 & Coding Conventions). No `useMemo`, `useCallback`, `React.memo`, `forwardRef`, or `&&` rendering. `type` over `interface`. `as const` over `enum`. Soundness rules apply (no `any` escapes, no lazy assertions).
- Telemetry stays read-oriented (`.agents/skills/state-and-write-paths/SKILL.md`). It must not flow back into project truth without an explicit application action.
- AI changes must respect `.agents/skills/llm-action-bridge/SKILL.md` — structured-output failure modes, action registries, dispatch.
- Plugin-hosting changes must respect `.agents/skills/plugin-hosting/SKILL.md` — separation of project-side and runtime-side plugin state, fast/slow paths.

---

## Design decisions

The following decisions are made now so implementation does not relitigate them. Each "Considered and rejected" is a one-line note on why an alternative was not picked.

### Decision: MIDI keeps absolute beats; clip operations call explicit shift/split/scale use cases

**Chosen:** MIDI notes stay stored on `midiStore` keyed by clip id with absolute `startBeat` (matches current behaviour). Every clip-time operation that moves, splits, deletes-in-range, or scales a clip calls a corresponding MIDI use case. New use cases this spec adds: `deleteMidiNotesInRange`, `scaleClipMidiNotes`. Existing use cases (`shiftClipMidiNotes`, `splitMidiNotesAtBeat`, `shiftMidiNotesAfterBeat`) are reused.

**Considered and rejected:**

- _Migrate MIDI to relative positioning._ Larger surface area, requires migrating `midiStore`, every read/write site, the scheduler, and existing project files. Out of scope; surface as a follow-up spec.
- _Make every arrangement use case re-emit a generic `clip.timeChanged` event consumed by MIDI._ Hides ownership; bus-coupled writes are harder to reason about than explicit calls. The MIDI use cases are cheap to call directly.

### Decision: `EngineDeviceNode` interface in `AudioEngine`; per-plugin nodes implement it

**Chosen:** Add `src/modules/AudioEngine/engine/contracts/EngineDeviceNode.ts` defining a structural type:

```ts
export type EngineDeviceNode = {
    readonly id: string;
    readonly inputNode: AudioNode;
    readonly outputNode: AudioNode;
    setParam(input: { param: string; value: number; sampleFrame?: number }): void;
    setBypass(bypassed: boolean): void;
    getLatencySamples(): number;
    dispose(): void;
};
```

Each plugin module that owns an engine node (`Fermenter`, `Toaster`, `Levain`, `Proof`, `Grinder`, `GrandBoule`, native bridge, WAM bridge, factory builtins, Faust) exports a constructor function `create<Plugin>EngineNode(input)` from its own module. `TrackNode` keeps a `EngineDeviceNode[]` chain and iterates that list. Per-plugin branches in `TrackNode.updateParam`, `updateBypass`, `removeDevice`, and `dispose` are removed.

**Considered and rejected:**

- _Class hierarchy with abstract `BaseDeviceNode`._ Adds inheritance ceremony; a structural type matches React-19/composition style and lets each plugin pick its own implementation shape.
- _Keep TrackNode branching but extract per-plugin helpers._ Doesn't fix the cross-module imports (`unregisterLevainDevice`, `unregisterProofDevice`); doesn't unify bypass behaviour; leaves `TrackNode` as the place new plugins must edit.

### Decision: bypass is a parallel dry/wet sum on every device node

**Chosen:** Each `EngineDeviceNode` constructs a small two-`GainNode` parallel topology internally: device output × `wet`, original input × `dry`. `setBypass(true)` schedules `wet=0, dry=1`; `setBypass(false)` schedules `wet=1, dry=0`. Transitions use `setTargetAtTime` over ~5 ms to avoid clicks. `TrackNode` does not call `rebuildChain()` on bypass any more — `setBypass` is a parameter change.

**Considered and rejected:**

- _Disconnect/reconnect on bypass._ This is the current behaviour. It triggers a graph rebuild for any non-special-cased device (I-19) and audibly clicks on insert plugins.

### Decision: one `invokeLlm` use case owns backend dispatch

**Chosen:** Create `src/modules/AiRuntime/useCases/llm/invokeLlm.ts`. Single signature:

```ts
export type InvokeLlmInput = {
    messages: ChatMessage[];
    mode: 'chat' | 'tools' | 'schema';
    tools?: ToolDefinition[];
    schema?: JsonSchema;
    onToken?: (token: string) => void;
    abortSignal?: AbortSignal;
};
```

`invokeLlm` resolves the backend chain (`getBackendChain`), iterates with the same fallback policy across the three modes, owns `llmStatusStore` transitions, and standardises grammar/schema-failure fallback behaviour. The three current dispatch sites (`sendChatMessage`, `executeDsoEdit.invokeLlm`, `inference.generateToolCalls`) are rewritten to call `invokeLlm` with the appropriate `mode` and pass-through callbacks.

**Considered and rejected:**

- _Three thin façades over the same chain._ Already attempted in fragmented form; drift is the failure mode the audit calls out.
- _Strategy pattern with one class per backend that handles every mode._ Backends are functions, not stateful objects; strategy is overkill.

### Decision: per-instance plugin state via `Record<DeviceId, State>`

**Chosen:** `levainStore` and `toasterStore` change from `createStore<X>` to `createStore<Record<DeviceId, X>>` with per-device helpers (`getLevainState(deviceId)`, `setLevainPatch({ deviceId, patch })`, etc.). All call sites pass an explicit device id; the "find the first toaster" lookup in `loadToasterKit.ts` is replaced by a deviceId argument plumbed from the caller. `fermenterStore` is already keyed by device id (used by the per-instance telemetry path) — confirm and keep.

**Considered and rejected:**

- _Module-instance pattern (one store factory per device)._ Heavier; doesn't fit the existing `createStore` infra; harder for selectors to subscribe to "any instance's loading state".
- _Move state into the engine node and read it via telemetry only._ Loses persistence and undo for parameters that are project truth.

### Decision: Fermenter telemetry rides a SAB ring sampled at UI rate

**Chosen:** Replace the per-tick `setFermenterTelemetry` store push with the existing SAB pattern (`telemetryAllocator.ts`, used by Grand Boule and recording). Worklet writes peak L/R + scope into a per-instance SAB; a single rAF loop samples the SAB and dispatches a `fermenterTelemetryStore` update **per frame** (not per audio block). Components subscribe via `useStoreSelector` keyed by device id.

**Considered and rejected:**

- _EventEmitter with per-component subscription._ Reproduces the same fan-out problem; selectors over a store are simpler.
- _MessagePort per component._ N×N coupling; doesn't scale to multiple Fermenter instances.

### Decision: AI snapshots use Automerge heads + per-doc binary diffs

**Chosen:** `executeDsoEdit.commitDsos` records each touched doc's heads via `Automerge.getHeads(doc)` before mutation and again after. The undo entry stores `{ docId, headsBefore, headsAfter }` — not a full project snapshot. Undo applies `Automerge.change` with the inverse to restore. Untouched documents are not recorded.

**Considered and rejected:**

- _Keep full project snapshot but compress._ Cost grows with project size, not with edit size — the audit's complaint stands.
- _Replace Automerge undo with a custom command-log._ Reinvents what Automerge already supports.

### Decision: persistence — `kneadStore` adopts `createAutomergeStorage`; `actionHistoryStore` adopts `createLocalStorage`

**Chosen:**

- `kneadStore` is project-shaped (per-clip pitch edits) → `createAutomergeStorage<KneadStoreState>('project', 'sourdaw-knead', { toCrdt })`. `toCrdt` strips `isAnalyzing` and `analysisProgress`.
- `actionHistoryStore` is per-device (local history; not collaboration-relevant) → `createLocalStorage<ActionHistoryState>('sourdaw-action-history')`. Trim entries to a bounded ring (default: 200).

**Considered and rejected:**

- _Both into Automerge._ Action history is local-device; replicating it across collaborators creates noise and ordering questions.
- _Both into LocalStorage._ Knead pitch edits are project truth and must travel with the project.

### Decision: PDC is a host concern; each `EngineDeviceNode` reports `getLatencySamples()`

**Chosen:** PDC sums the per-node latencies across each `TrackNode`'s device chain. Recording offsets the writer pointer by the chain latency. Automation events apply the inverse offset. Latency lives entirely on the runtime side — project truth records "this plugin was inserted", not "the latency is N samples".

**Considered and rejected:**

- _Per-plugin latency persisted in project truth._ Plugin latency is plugin-implementation state, not user data.
- _Static per-plugin latency table._ Some plugins (lookahead-equipped limiters, oversamplers) have variable latency.

### Decision: limiter uses Lemire monotonic deque; per-sample loop preserved

**Chosen:** Replace the linear scan in `limiter.rs` with a `VecDeque<(usize, f32)>` monotonic deque. Push the new sample; pop from the back while the back's value is `<= current`; pop from the front while the front's index is outside the window; the front is the window max. O(1) amortised per sample.

### Decision: LR4 four-band uses parallel splits + allpass compensation

**Chosen:** Replace the cascaded-highpass topology with the standard 4-band LR4: split at `f1` to `LP1/HP1`, split `HP1` at `f2` to `LP2_high/HP2_high`, split `HP2_high` at `f3` to `LP3/HP3`. Apply allpass compensation on the lower bands so phase aligns at each split (an LR4 sums to allpass at the split frequency; the allpass is then applied to the **other** band so the sum across the chain is flat). Concrete topology is documented inline in the implementation file.

**Considered and rejected:**

- _Phase-linear FIR bank._ Higher CPU and adds latency; LR4 is the standard for live multiband.
- _Single-pass LR4 (no compensation)._ Status quo; doesn't sum flat.

### Decision: Crumbs anti-aliasing — pre-resample LPF reusing `TptSvf`

**Chosen:** When `speed > 1.0`, set the existing per-channel `filter_l/_r` (`TptSvf`) to lowpass at `Nyquist / speed` regardless of whether user filtering is enabled. When `speed <= 1.0` no AA filter is needed. The user filter and AA filter share the SVF instance; if both are needed, a pragmatic approach is to set the cutoff to `min(user_cutoff, nyquist/speed)`. The filter is updated at note-on and on `set_tune`.

### Decision: Grinder AudioParam policy

**Chosen:** Promote the 11 most-automation-relevant params to `parameterDescriptors`: `gain`, `bass`, `mid`, `treble`, `presence`, `resonance`, `master`, `inputGain`, `outputGain`, `tubeDrive`, `feedback`. Read per-sample inside the inner loop for these. All other params remain control-rate via `port.postMessage` (for now).

### Decision: `PianoRoll` uses `useStoreSelector` with active-clip selector

**Chosen:** Replace `useStore(midiStore, ...)` and `useStore(trackStore, ...)` with `useStoreSelector` calls that subscribe only to the active clip's notes/CC/pitch-bend and to the selected track. Add a stable `equalityFn` that does shallow-equal on the selected slice.

### Decision: Recording — track-level `inputChannelCount`

**Chosen:** Add `inputChannelCount: 1 | 2` to `Track` (default `1`). UI input picker exposes a mono/stereo selector. `startAudioRecording` reads the value from the track and constructs the worklet with `channelCount: <count>, channelInterpretation: 'discrete'` and SAB ring sized `count × ringFrames`.

### Decision: Sequencer sample-accurate `fire()`

**Chosen:** `sequencerPlayback.fire()` computes `sampleFrame = Math.round((targetTime - ctx.currentTime) * ctx.sampleRate) + currentBlockStartFrame` and passes it through `triggerToasterPad({ padIndex, velocity, sampleFrame })`. The worklet already honours `sampleFrame` queuing.

### Decision: Native plugin SAB transport (I-01)

**Chosen:** Replace the per-block `tauriInvoke('process_plugin_audio', …)` with a SAB-based double-buffer ring (input audio worklet → Rust plugin host → output audio worklet). Param updates ride a separate lock-free SPSC queue. Block size matches the worklet's `process()` frame size. Latency: 2 × block size (one block in each direction). Mirror the existing recording-pipeline SAB pattern.

**Considered and rejected:**

- _MessagePort with structured cloning._ Allocates per block; blocked by the RT no-alloc rule.
- _One SAB per block, allocated on demand._ Same allocation problem.

### Decision: ChatPanel per-message component split

**Chosen:** Extract `MessageItem({ messageId })` as its own component. `MessageItem` uses `useStoreSelector(chatStore, (s) => s.messages.find(m => m.id === messageId))` so only the streaming message re-renders per token. Markdown parsing is cached by `messageId + content.length` via a small module-level `Map`.

---

## Requirements

Requirements are grouped to match the design decisions. Each requirement is independently verifiable.

### Group A — Timeline / MIDI editing

**A1. `deleteTimeRange` partitions MIDI notes (Timeline §1 completion).**
For every clip touched by `deleteTimeRange(startBeat, endBeat, trackIds)`:

- Notes whose `[startBeat, startBeat+duration)` lies fully outside `[startBeat, endBeat]` are unchanged.
- Notes fully inside `[startBeat, endBeat]` are deleted.
- Notes that straddle the start of the deleted range are truncated so they end at `startBeat`.
- Notes that straddle the end of the deleted range are split: the portion inside is deleted, the portion after is kept and shifted left by `(endBeat - startBeat)`.
- Notes after the deleted range are shifted left by `(endBeat - startBeat)` (after the partition).
- The same partition rule applies to MIDI CC and pitch-bend events (point events: events at exactly `startBeat` are kept; events in `(startBeat, endBeat]` are deleted; events after `endBeat` are shifted left).

Implementation note: introduce `deleteMidiNotesInRange({ trackIds, startBeat, endBeat })` in `src/modules/MIDI/useCases/midiNoteCrud/`. `deleteTimeRange` calls it before computing `shiftMidiNotesAfterBeat({ atBeat: endBeat, delta: -(endBeat - startBeat) })`.

**A2. `rippleDeleteClips` shifts MIDI notes for the deleted clips and following clips on the same track.**
For each clip in `clipIds`:

- All notes for that clip id are deleted from `midiStore`.
- All notes whose owning clip starts after the deleted clip's `endBeat` (on the same track) shift left by the deleted clip's duration.

Reuse `shiftMidiNotesAfterBeat` scoped per-track, or extend it to accept a `trackId` filter — choose whichever keeps the function single-purpose.

**A3. `ClipRenderModel` carries preview transforms.**
Add three optional fields (all default `undefined` meaning "no preview"):

- `visualShiftBeats?: number` — translation applied during a move drag.
- `visualStretchRatio?: number` — multiplicative scale applied during a stretch/trim drag.
- `visualOriginBeat?: number` — anchor for the stretch (defaults to clip `startBeat`).

`buildTimelineRenderModel` populates these fields from the active drag preview state. `clipDrawing.ts` consumes them in both `drawWaveformPeaks` and `drawMidiNotePreview`. Audio waveforms use the same window selection as the static path (Decision: window selection now respects `visualStretchRatio`).

**A4. MIDI drag preview moves with the clip (Timeline §4).**
`drawMidiNotePreview` adds `clip.visualShiftBeats ?? 0` to each note's start before mapping to x. Acceptance: dragging a MIDI clip horizontally shows notes following the rectangle in the same frame.

**A5. MIDI looping renders as repeats not stretches (Timeline §7).**
`drawMidiNotePreview` computes x as `(relStartBeat * pixelsPerBeat) % loopWidth`, then offsets to the clip's left edge. When the clip is longer than `loopLength`, notes wrap and repeat instead of stretching. Notes that cross a loop boundary are split visually (two draw calls per wrapped note).

**A6. Stretch/trim preview updates renderers in real time (Timeline §8).**
During a stretch/trim drag the preview sets `visualStretchRatio` on the affected clips. `drawWaveformPeaks` recomputes the sample window using the previewed ratio (no audio buffer changes). `drawMidiNotePreview` scales note x and width by the previewed ratio anchored on `visualOriginBeat`. Releasing the drag commits the ratio via the existing handler chain.

**A7. MIDI stretching commits to data (Timeline §6).**
Add `scaleClipMidiNotes({ clipId, anchorBeat, ratio })` in `src/modules/MIDI/useCases/midiNoteCrud/`. For each note in the clip:

- `note.startBeat = anchorBeat + (note.startBeat - anchorBeat) * ratio`
- `note.duration = note.duration * ratio`

CC and pitch-bend `beat` values are scaled by the same anchor + ratio. The audio `stretchRatio` and the MIDI ratio are independent properties on the clip — committing a MIDI stretch does not touch the audio stretch.

`handleSetClipStretchRatio` (and any other stretch handler) calls `scaleClipMidiNotes` for MIDI clips. Anchor defaults to `clip.startBeat`.

**A8. Each timeline use case has a Vitest spec.**
`deleteTimeRange`, `rippleDeleteClips`, `scaleClipMidiNotes`, `deleteMidiNotesInRange` each get a `__tests__/<name>.spec.ts` file covering: notes fully inside, notes straddling each edge, notes fully outside, CC+pitch-bend events.

### Group B — DSP correctness and performance

**B1. LR4 four-band sums flat (I-08).**
`FourBandSplitter::process` uses parallel-with-compensation topology (see Decision). Acceptance:

- A new `crossover.rs` test sweeps a sine sweep through the 4-band splitter, sums all four bands, and asserts magnitude is within ±0.5 dB of the dry signal across 20 Hz – 20 kHz.
- Phase response: the summed signal lags by an LR4 group delay (documented), but magnitude is flat.

**B2. Limiter is O(1) per sample (I-22).**
`Limiter::process` uses a Lemire monotonic deque. Acceptance:

- A `criterion` micro-benchmark (or, if criterion is not in the workspace, a documented `cargo test --release` timing test gated behind `#[ignore]`) confirms per-sample work is independent of `lookahead_ms` for at least the range 1–50 ms. Specifically: doubling lookahead does not more than double total processing time on a 48 kHz buffer.
- A unit test confirms output of the new implementation matches the old implementation sample-by-sample on a representative buffer (within `f32::EPSILON × 8`) for the same inputs.

**B3. Crumbs has anti-aliasing on pitch-up (I-12).**
`CrumbsVoice::trigger` and `CrumbsVoice::set_tune` set `filter_l` and `filter_r` cutoff to `min(user_cutoff_or_nyquist, nyquist / speed)` whenever `speed > 1.0`. When `filter_enabled` is false but AA is needed, the filter still runs (gated on `speed > 1.0`). Acceptance:

- A unit test pitches a 2 kHz sine up by an octave (`speed = 2.0`) and asserts no significant energy in 12–22 kHz above the noise floor (use existing FFT helpers if available; otherwise, a hand-rolled DFT bin check is fine).

**B4. Grinder declares automatable AudioParams (I-26).**
`grinderProcessor.ts` declares 11 `parameterDescriptors`: `gain, bass, mid, treble, presence, resonance, master, inputGain, outputGain, tubeDrive, feedback`. The inner loop reads these via `values[i]` per sample (not `values[frames - 1]`). All other params remain control-rate.

### Group C — AI runtime architecture

**C1. `invokeLlm` use case exists and owns dispatch (I-02).**
`src/modules/AiRuntime/useCases/llm/invokeLlm.ts` exports a single `invokeLlm` function matching the signature in the Design decisions. It:

- Calls `getBackendChain()` to determine order.
- Iterates backends; on failure logs and falls through.
- For `mode: 'schema'`, attempts schema-constrained generation first, then retries the same backend without `response_format` if the constrained call throws (existing I-18 behaviour, generalised).
- For `mode: 'tools'`, calls the appropriate per-backend tool-call function.
- For `mode: 'chat'`, streams tokens via `onToken`.
- Owns `llmStatusStore` transitions (`loading` → `ready`/`generating` → `ready` or `error`).
- Honours `abortSignal`.
- Throws a single `LlmInvocationError` with the chain of underlying messages if every backend fails.

**C2. `sendChatMessage`, `executeDsoEdit.invokeLlm`, `inference.generateToolCalls` call `invokeLlm`.**
The three sites no longer iterate backends themselves. Each call site selects the right `mode` and passes through its specific schema/tools/onToken. The previous private `invokeLlm` helper inside `executeDsoEdit` is deleted.

**C3. AI undo snapshots only touched documents (I-04).**
`executeDsoEdit.commitDsos`:

- Captures `Automerge.getHeads(doc)` for each touched doc id before mutation.
- Records `{ docId, headsBefore, headsAfter }` per doc in the undo entry.
- Does **not** call `saveSnapshot()` of the whole bundle.
- Undo replays the inverse to restore each touched doc to `headsBefore`.

If Automerge does not expose a clean inverse-replay primitive in the current version, store binary patches via `Automerge.save` over a clone limited to those docs. Implementation choice is open within this constraint; the **observable** acceptance criterion is: an AI edit that touches one MIDI note in one document must not write more than O(size of that note's document) of undo data.

### Group D — Audio engine architecture

**D1. `EngineDeviceNode` interface defined and adopted (I-05).**
`src/modules/AudioEngine/engine/contracts/EngineDeviceNode.ts` defines the interface from the Design decisions. Each plugin module exports a constructor for its own engine node:

- `Fermenter/useCases/createFermenterEngineNode.ts`
- `Toaster/useCases/createToasterEngineNode.ts`
- `Levain/useCases/createLevainEngineNode.ts`
- `Proof/useCases/createProofEngineNode.ts`
- `Grinder/useCases/createGrinderEngineNode.ts`
- `GrandBoule/useCases/createGrandBouleEngineNode.ts`
- existing `NativePluginBridgeNode` and WAM/Faust/factory paths refactored to implement the same interface and exported via `AudioEngine` use cases (since they live in `AudioEngine`).

`TrackNode` keeps `private devices: EngineDeviceNode[]`. `TrackNode.updateParam`, `updateBypass`, `addDevice`, `removeDevice`, and `dispose` iterate the list and call interface methods only. The `unregisterLevainDevice` and `unregisterProofDevice` cross-module imports are removed (per-plugin lifecycle is owned inside each plugin module's `dispose`).

**D2. Bypass is parameter-only (I-19).**
Every `EngineDeviceNode` implementation exposes the parallel dry/wet topology described in Decision. `setBypass(true|false)` schedules `wet`/`dry` AudioParams over ~5 ms. `TrackNode.updateBypass` calls `setBypass` only — no `rebuildChain()`.

**D3. PDC chain is summed and applied (I-06).**
`TrackNode` exposes `getCompensationDelaySamples()` returning the sum of `getLatencySamples()` across its device chain. `audioRecorder/recording.ts` offsets writer pointer by this amount per track. Automation scheduling subtracts this offset for params bound to tracks with non-zero PDC.

A new use case `getProjectPdcMap()` in `AudioEngine/useCases/` returns `Record<TrackId, number>` for upstream consumers (mostly recording and the scheduler). It does not write to project truth.

**D4. Native plugin bridge runs on SAB (I-01).**
`NativePluginBridgeNode` no longer calls `tauriInvoke('process_plugin_audio', …)` from `process()`. Instead:

- One SAB per direction (input frames, output frames), sized to `4 × blockSize` per channel.
- A separate SPSC param queue (small SAB or `Atomics`-managed Int32 ring) for control-rate updates.
- Rust side runs a cpal-driven loop reading the input SAB and writing the output SAB.
- The worklet `process()` reads the latest output frames from the SAB and writes new input frames in. If output is not ready, fills with zero (and increments a glitch counter exposed via telemetry).
- Initial implementation latency: `2 × blockSize` is acceptable; document it.

If the Rust side does not yet support the cpal loop, this requirement is partially completed: the worklet is converted to SAB read/write, and the Rust side is a follow-up gated by a Rust spec. Acceptance for the partial path: zero `tauriInvoke` calls inside `process()`.

### Group E — State, persistence, and telemetry

**E1. Plugin stores are per-instance (I-03).**

- `levainStore.ts` becomes `createStore<Record<DeviceId, LevainState>>({ initialData: {} })` with helpers: `getLevainState(deviceId)`, `setLevainState({ deviceId, state })`, `setLevainParam({ deviceId, param, value })`, `removeLevainState(deviceId)`. All param bridges and presentation hooks pass a deviceId.
- `toasterStore.ts` becomes `createStore<Record<DeviceId, ToasterState>>({ initialData: {} })` with the same shape of helpers.
- `getToasterControls(deviceId)` (renamed) takes an explicit deviceId argument. `loadToasterKitPreset` plumbs the deviceId from its caller. The `tracks.find(...).devices.find(...)` lookup is removed.
- `fermenterStore` is already keyed by deviceId — no schema change, but confirm hooks read by deviceId.
- All call sites are updated. No `// TODO: assumes single instance` comments remain.

**E2. `kneadStore` persists via Automerge (I-14).**
`kneadStore.ts` uses `createAutomergeStorage<KneadStoreState>({ docId: 'project', key: 'sourdaw-knead', toCrdt: (s) => ({ activeClipId: s.activeClipId, clips: s.clips }) })`. The adapter strips `isAnalyzing` and `analysisProgress`. Reload restores `activeClipId` and `clips`.

**E3. `actionHistoryStore` persists via LocalStorage (I-14).**
`actionHistoryStore.ts` uses `createLocalStorage<ActionHistoryState>('sourdaw-action-history')`. Bound the entries array to the most recent 200 entries; the store helper that adds an entry trims the array.

A new key `'sourdaw-action-history'` is added to `LocalStorageKeys.ts` (this is a key add, not a key removal — does not require legal review).

**E4. Fermenter telemetry rides a SAB (I-15).**
`fermenterProcessor.ts` writes peak L/R + scope into a per-instance SAB allocated via `telemetryAllocator`. The instance registry hands the SAB descriptor to a presentation-layer rAF sampler that calls `setFermenterTelemetry(deviceId, …)` once per frame. Per-tick `port.postMessage` for telemetry is removed.

Component subscriptions use `useStoreSelector(fermenterStore, (s) => s[deviceId])` with a shallow-equal `equalityFn` so non-changing instances do not re-render.

### Group F — UI

**F1. `ChatPanel` splits into per-message components (I-16).**
Extract `MessageItem({ messageId })`. `MessageItem` uses `useStoreSelector(chatStore, (s) => s.messages.find((m) => m.id === messageId), (a, b) => a === b)`. `ChatPanel` only subscribes to the message **list** (id order); individual content updates do not re-render the panel.

Markdown parsing is cached: a module-level `Map<string, ReactElement>` keyed by `${messageId}:${content.length}` returns the parsed element. Cache eviction: simple LRU bounded to ~200 entries.

**F2. `PianoRoll` uses selectors (I-27).**
`PianoRoll` replaces the two `useStore` calls with three `useStoreSelector` calls:

- Active clip's notes: `(s) => s.notesByClipId[activeClipId] ?? EMPTY_NOTES` (with a stable empty-array sentinel).
- Active clip's CC: same shape.
- Selected track: `(s) => s.tracks.find((t) => t.id === selectedTrackId) ?? null`.

Each selector uses a shallow-equal `equalityFn`. Editing a note on a different clip does not re-render `PianoRoll`.

### Group G — Recording and sequencer

**G1. Recording supports stereo (I-29).**
`Track` model gains `inputChannelCount: 1 | 2` (default `1`). The input picker (`Workspace/presentations/views/Inspector/TrackInputSelector` or wherever) exposes a mono/stereo toggle bound to the new field via the appropriate use case.

`startAudioRecording` reads `track.inputChannelCount`, constructs the worklet with `channelCount: count, channelInterpretation: 'discrete'`, and sizes the SAB ring as `count × ringFrames`. The recording worker writes `count` interleaved channels.

**G2. Sequencer fires sample-accurately (I-21).**
`sequencerPlayback.fire(targetTime, padIndex, vel)`:

- Computes `delaySamples = Math.max(0, Math.round((targetTime - ctx.currentTime) * ctx.sampleRate))`.
- Calls `triggerToasterPad({ deviceId, padIndex, velocity: vel, sampleFrame: currentBlockStartFrame + delaySamples })`.

`currentBlockStartFrame` is the worklet's most recently posted block start (already exposed via existing transport telemetry, or added to it if not).

The worklet's `noteOn({ padIndex, velocity, sampleFrame })` queue path is unchanged (already supports `sampleFrame`).

---

## Acceptance criteria

These are the gates a reviewer (or an agent's self-review) checks. Every box must be checked.

### Cross-cutting

- [ ] `pnpm deps:validate` reports **0 errors** and **0 warnings** introduced by this work.
- [ ] `pnpm typecheck` passes; any remaining errors are pre-existing and listed in this spec's "Non-goals".
- [ ] `cargo check --workspace` is no worse than baseline (pre-existing `grand_boule/voice.rs` break may remain; nothing else regresses).
- [ ] `pnpm vitest run` (full suite) passes; no test in scope is `.skip`'d.
- [ ] `pnpm vitest run` for each new use case spec passes (Group A8, plus B unit tests).
- [ ] `cargo test -p daw-dsp` passes including the new B1, B2, B3 tests.
- [ ] The audit file `.agents/audits/consolidated-issues.md` is updated: every item this spec addresses is bumped from `Deferred` to `FIXED (date)` with a one-sentence note. Items explicitly out of scope (I-25, I-28, I-30, pre-existing breaks) remain annotated as such.
- [ ] `## Session status` block in the audit is regenerated to reflect the new fixed-count.

### Group A (Timeline / MIDI)

- [ ] A1: `deleteTimeRange.spec.ts` covers the five note-position cases; passes.
- [ ] A2: `rippleDeleteClips.spec.ts` covers in-clip notes deleted + following-clip notes shifted; passes.
- [ ] A3: `ClipRenderModel` exposes the three preview fields; tests in `buildTimelineRenderModel.spec.ts` populate them from preview state.
- [ ] A4: Manual: dragging a MIDI clip shows notes following the rectangle within one frame.
- [ ] A5: Manual: a 1-bar MIDI clip with `loopLength = 1` extended to 4 bars shows 4 repetitions, not 1 stretch.
- [ ] A6: Manual: stretch-drag handle shows notes scaling and waveform window resizing live.
- [ ] A7: `scaleClipMidiNotes.spec.ts` passes; manual stretch on a MIDI clip moves and scales notes; the audio `stretchRatio` is unaffected.
- [ ] A8: All four new specs exist and pass.

### Group B (DSP)

- [ ] B1: `crossover.rs` test asserts ±0.5 dB summing flatness across 20 Hz – 20 kHz; passes.
- [ ] B2: Limiter unit test confirms output equivalence against the old implementation on the existing test fixtures (within `f32::EPSILON * 8`); benchmark or timing test confirms doubled lookahead does not more than double per-block runtime.
- [ ] B3: Crumbs AA test confirms aliased spectrum below noise floor on 2 kHz × 2.0 ratio.
- [ ] B4: Grinder processor tests (or a new spec) confirm the 11 declared params are read per-sample.

### Group C (AI runtime)

- [ ] C1: `invokeLlm.spec.ts` covers all three modes (chat/tools/schema), backend fallback, schema-failure retry, abort signal, status store transitions; passes.
- [ ] C2: `sendChatMessage.ts`, `executeDsoEdit.ts`, `inference.ts` no longer contain backend iteration loops; existing specs for these files updated and passing.
- [ ] C3: An integration-style spec on `executeDsoEdit` confirms an AI edit that mutates one MIDI note records undo data sized to that document only (not to the whole project bundle).

### Group D (Audio engine architecture)

- [ ] D1: `EngineDeviceNode` interface file exists; `TrackNode.ts` does not contain a single `if (dn.type === '…')` branch in `updateParam`/`updateBypass`/`removeDevice`/`dispose`; cross-module use-case imports (`unregisterLevainDevice`, `unregisterProofDevice`) are gone.
- [ ] D2: `TrackNode.updateBypass` does not call `rebuildChain()` for any device; manual: bypass-toggling a Faust insert does not produce an audible click.
- [ ] D3: Recording test confirms a recorded sample taken while a known-latency plugin is inserted aligns within `±1 sample` of the ungated reference take.
- [ ] D4: `NativePluginBridgeNode.ts` does not call `tauriInvoke` from `process()`. If the Rust SAB consumer is not yet implemented, the worklet path is otherwise complete, the partial state is documented in `Findings` of the implementing task file, and a follow-up Rust task file is opened.

### Group E (State / persistence / telemetry)

- [ ] E1: Adding two Levain devices on two tracks produces independent `levainStore` entries keyed by deviceId; same for Toaster. Manual: open both, change a macro on one, the other does not change.
- [ ] E2: Manual: edit Knead pitch on a clip; reload the page; the edit is restored.
- [ ] E3: Manual: perform 5 actions; reload; action history shows them. Perform 250 actions; history is bounded at 200.
- [ ] E4: Profiling: with two Fermenter instances active, opening React DevTools profiler shows `<FermenterPanel>` re-rendering at ≤60 Hz under audio load (was per-audio-block).

### Group F (UI)

- [ ] F1: Profiling: streaming a 50-message chat causes only the streaming `MessageItem` to re-render per token; `ChatPanel` does not.
- [ ] F2: Profiling: editing notes on Clip A while Clip B is the active piano-roll clip does not re-render `PianoRoll`.

### Group G (Recording / sequencer)

- [ ] G1: Manual: a stereo input recorded into a stereo-armed track produces a stereo file (channels independent, not duplicated).
- [ ] G2: Manual: triggering the sequencer at 120 BPM with sub-block resolution shows hits aligned to the AudioContext sample grid; jitter inspection (e.g. recording the worklet output and measuring zero-crossings) shows ≤1 sample deviation.

---

## Implementation notes

- Order suggestion across groups: **A → C → D → E → F → G → B**. Group A is small and independent; Group C unblocks any future AI work and is well-scoped. Group D (especially D1) is the largest refactor; do it after A and C are merged so review attention can focus. Group B (Rust DSP) can run in parallel with the rest.
- Within Group D, do D1 first, then D2 (D2 builds on the per-node bypass topology). D3 and D4 can land after D1 since they consume the interface.
- For D1, migrate one plugin at a time. After each migration, `pnpm deps:validate` and `pnpm typecheck` must pass. `TrackNode` can keep legacy branches alongside the interface during migration; it must be empty by the time D1 is marked done.
- For E1, when migrating `levainStore` to keyed shape, pay attention to existing reset paths (`projectPersistence/resetModuleStoresToDefault`) — they must clear all instances, not assume one.
- For B2 (limiter monotonic deque), preserve the existing param surface (`lim_lookahead`, `ceiling`, attack/release). The deque length tracks `lookahead_samples`; resizing on param change must repopulate from the existing delay-line state.
- For C1, the `mode: 'tools'` path needs to thread `ToolDefinition[]` through to each backend's tool-call function. Inspect the three existing `generate*ToolCalls` for shape compatibility before fixing the input type.
- For D4, the SAB ring layout should use the same conventions as `recording.ts` so that future platform-host work has one pattern, not two. Reuse `telemetryAllocator` for the param queue if its semantics fit.
- Pre-existing breaks (`grand_boule/voice.rs`, `getCompensationDelay`) are not gating, but if they are still broken when this spec is otherwise complete, surface them in the implementing task's Findings — they belong to the next session.

---

## Test plan

### Automated

- [ ] New Vitest specs (Group A8, C1, C3, F1 if feasible).
- [ ] New Rust tests in `crates/daw-dsp/src/proof/crossover.rs`, `crates/daw-dsp/src/proof/limiter.rs`, `crates/daw-dsp/src/crumbs/voice.rs`.
- [ ] `pnpm vitest run` full pass.
- [ ] `cargo test --workspace` full pass (modulo pre-existing breaks).
- [ ] `pnpm deps:validate` zero violations.
- [ ] `pnpm typecheck` clean.

### Manual

- [ ] Project with two Levain instances on two tracks: change one, the other stays put.
- [ ] Same with Toaster.
- [ ] MIDI clip drag: notes follow the rectangle.
- [ ] MIDI clip stretch: notes scale live; release commits.
- [ ] MIDI clip looped to 4×: visible repetitions, not stretching.
- [ ] Audio clip with offset/stretch: waveform shows the correct slice, not the whole buffer.
- [ ] Reload: Knead pitch edits and action history both restore.
- [ ] Insert a Faust device, toggle bypass repeatedly: no audible click, no graph rebuild logs.
- [ ] Insert a high-latency plugin, record a click track: alignment within ±1 sample.
- [ ] Native plugin host: audio plays without per-block IPC (verify with a perf trace; `tauriInvoke` does not appear in the audio-thread flame graph).
- [ ] Stream a long AI chat: only the streaming bubble re-renders.

---

## Open questions

- [ ] **[MINOR]** Group D / D4: should the Rust-side cpal loop (consumer of the input SAB) ship in the same change as the worklet-side change, or is a worklet-only landing acceptable as Step 1 with the Rust side as Step 2? Default this spec assumes Step-2 is acceptable; the implementing agent may revise if the partial state is unsafe to ship.
- [ ] **[MINOR]** Group A / A6: when a stretch preview overlaps a snap grid, should the preview snap or stay free? Default: preview is free; snap applies on commit. Confirm with the original drag implementer before merging.
- [ ] **[MINOR]** Group C / C1: for `mode: 'tools'`, do all three backends (native, cloud, webllm) currently accept a uniform `ToolDefinition[]` shape, or do they use slightly different schemas? If they diverge, `invokeLlm` may need a per-backend adapter step. Resolve while implementing — not a blocker.
- [ ] **[MINOR]** Group E / E2: `kneadStore` persistence under Automerge — does the existing `'project'` doc id have room, or does Knead need its own doc? Default: reuse `'project'`. Revisit if it inflates project-doc size noticeably.

No `[CRITICAL]` open questions. Implementation may proceed.

---

## Tradeoffs and risks

- **D1 is a large refactor.** Done piecewise, with `pnpm deps:validate` after each plugin migration, the risk is bounded. Done as one big-bang change, regressions in any one plugin are hard to isolate. The implementation note above prescribes piecewise.
- **B1 (LR4 redesign)** changes the audible character of the multiband chain. Existing presets that were tuned against the broken topology will sound subtly different. Document this in the change; if presets need adjustment, that is a follow-up task.
- **D4 (native plugin SAB)** is the highest-risk item. Misaligned SAB sizes, bad pointer arithmetic, or a stuck producer can produce silence or glitches. Bound the change: deliver the worklet side first; add the Rust consumer in a separate, reviewable change.
- **E2/E3** introduce new Automerge writes and new LocalStorage usage. Verify storage size budgets do not blow out (Automerge doc grows incrementally; LocalStorage is bounded at 200 entries). Watch for collaboration noise — Knead persistence is collaborative; action history is not (by design).
- **C3 (snapshot strategy)** depends on Automerge's API surface for partial snapshots. If the version in use does not expose what's needed, fall back to per-doc binary save and document the choice.
- **F1 (markdown cache)** can leak memory if the LRU bound is misimplemented. Keep the bound explicit and small.

If any of these risks materialise during implementation, surface them as a Finding in the task file and pause for review rather than papering over.

---

## Implementation Status

**What is implemented:**

- None of the specific fixes defined in this spec (e.g., `deleteMidiNotesInRange`, `EngineDeviceNode`, `invokeLlm` refactor) are present in the codebase.

**What is not implemented:**

- All features and fixes described in the spec across MIDI, Audio Engine, AI Runtime, and UI State.

**What is done well:**

- N/A

**What needs refactoring:**

- This spec remains the primary backlog for critical architectural fixes.
