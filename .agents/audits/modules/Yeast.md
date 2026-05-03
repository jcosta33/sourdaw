# Yeast module audit

## Adversarial-review status (2026-04-28)

This file has been re-verified against `src/modules/Yeast/` head-of-tree. Every issue below was opened against a specific file:line. Verification notes record what changed; correctness disputes are flagged inline.

**Headline corrections from prior audit:**

- **Issue #6 ("worklet rack mirrored but never driven") was wrong.** The worklet's `processBlock` IS called — by `src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts:248-251`. That path is the offline MIDI-clip transformation ("bake the rack into the recorded notes"), and it uses the worklet when available, falling back to the main-thread rack otherwise. The bridge in `useCases/yeastSchedulingBridge/` serves a *different* purpose: real-time MIDI input from `messageHandlers.ts:349`. So the architecture is "two consumers, one of them uses the worklet, the other uses the main-thread rack". The **bug is now**: the real-time path silently never uses the worklet (duplicated singleton state), and the two paths build divergent `TransportInfo` payloads — see new issue #59.
- **Issue #14 ("upDown asymmetry") is partly wrong.** The `[0, 1, 2, 1]` cycle for `octaveRange = 3` is the *standard tent pattern* used by every commercial arpeggiator (Roland, Sequential, Ableton). Including 0 in the descent would produce `[0, 1, 2, 1, 0, 0, 1, 2, 1, 0, …]` — a doubled root. The audit's claim that the cycle "should be" `[0, 1, 2, 1, 0]` is wrong. The descent loop is correct.
- **Issue #13 over-counted.** "13 processors hand-roll the LCG" is wrong — there are **6 processors** with **9 inline LCG sites**. Full list below.
- **Issue #2 listed 7 string-key processors but missed `GrooveModule`.** Real count: 6 (string keys), 2 (numeric keys). Full list below.

The audit's verification status is captured per-issue. Resolved issues are moved to `## Resolved`; new issues are appended after the last open issue.

---

## Scope

Adversarial audit of `src/modules/Yeast/` in full — the MIDI rack, all 15 processors, the `MidiRack` host, the AudioWorkletNode wrapper / processor, the cross-module scheduling bridge, the public store, the use-case write surface, and the React presentation views/components. Cross-module callers (`AudioEngine`, `Transport`, `Performance`/Command, etc.) are referenced where they import this module, but their internals are out of scope.

It is an adversarial review focused on real problems: bugs and races, audio-thread allocation hazards, architectural violations (AGENTS.md), TypeScript soundness, React anti-patterns, performance, UX/accessibility, and testing gaps.

Related spec: none on disk.

---

## Goal

A correctness-first MIDI-effect rack that:

- Has a **single canonical cross-module surface**: the `Yeast/index.ts` root barrel re-exporting only from `useCases/`, `events/`, `stores/`, `presentations/views/`. Today the root barrel does not exist.
- Audio-thread code (`MidiRack.processBlock`, every `processor.processMidi`, `yeastWorkletProcessor`) **never allocates**, never builds template-literal map keys per event, never spreads/maps arrays per event, never sorts per processor.
- Block boundaries are honoured: every step-generator processor (`Arpeggiator`, `NoteRepeater`, `EuclideanGenerator`, `MarkovChain`, `CCGenerator`) advances using the `blockEnd` it was given, not a hand-rolled `now + 128 / now + 8192` window.
- Scheduling state survives transport seeks: `lastStepTime`, `lastStepTimeSamples`, and `lastStepTime === -Infinity` initialisation behave deterministically when the audio scheduler resets the global sample clock or seeks.
- Worklet ↔ main-thread mirror is **race-safe**: `setParam`/`setBypass` cannot be lost between `addProcessor` and worklet-resolution; `processBlock` requests cannot accumulate forever in `pending`.
- Each processor's `processMidi` is a pure function of `input + transport + state`; deterministic given the same RNG seed.
- AGENTS.md hard rules: no `any`, no `as unknown as`, no namespace imports, one function per `useCases/` file, no cross-module imports of internals, prefer `type` over `interface`, prefer `as const` over `enum`, no `useMemo`/`useCallback`/`React.memo`, no `forwardRef`, no `&&` in JSX, no `useEffect` for data fetching.
- Tests exercise behaviour (chord shape, BPM detection, note-off pairing) — not just "called the function returns a defined object".

---

## Relevant code paths

- `src/modules/Yeast/` (no root `index.ts` — see issue #1)
- `src/modules/Yeast/stores/yeastStore.ts`
- `src/modules/Yeast/stores/index.ts`
- `src/modules/Yeast/events/index.ts` (empty)
- `src/modules/Yeast/engine/YeastWorkletNode.ts`
- `src/modules/Yeast/services/yeastWorkletProcessor.ts`
- `src/modules/Yeast/models/MidiEvent.ts`
- `src/modules/Yeast/models/MidiProcessor.ts`
- `src/modules/Yeast/models/BaseMidiProcessor.ts`
- `src/modules/Yeast/models/ArpPattern.ts`
- `src/modules/Yeast/models/lcgRandom.ts`
- `src/modules/Yeast/useCases/MidiRack.ts`
- `src/modules/Yeast/useCases/processorFactory.ts`
- `src/modules/Yeast/useCases/{add,remove,reorder,setYeastProcessorBypass,setYeastProcessorParam,setYeastUiLevel}YeastProcessor.ts`
- `src/modules/Yeast/useCases/yeastSchedulingBridge/{processRealtimeMidiInput,yeastPanic}.ts`
- `src/modules/Yeast/useCases/processors/*.ts` (15 processor classes)
- `src/modules/Yeast/presentations/views/YeastPanel.tsx`
- `src/modules/Yeast/presentations/components/{ProcessorParams,KeyboardSplit,StepPatternEditor}.tsx`

---

## Current behavior

**Public contract (mostly via `useCases/` and `stores/`).** The module has **no root `index.ts`**. Cross-module callers import directly from sub-paths: `'#/modules/Yeast/stores'`, `'#/modules/Yeast/useCases'`, `'#/modules/Yeast/presentations/views'`. Per AGENTS.md "Contract Boundaries", "Cross-module imports MUST only target the destination module's root `index.ts`" — this rule has no enforcement target here.

**Store and rack ownership.** `yeastStore.ts` owns three things: the reactive `yeastStore` (UI state), the `MidiRack` singleton (`session.rackInstance`), and the lazy `YeastWorkletNode` (`session._workletNode` + `session._workletNodePromise`). `createHmrPersistentState` wraps the session for HMR survival. `getYeastWorkletNodeAsync` is a Promise-coalesced lazy init (good); `getWorkletNodeSync` is the non-blocking accessor used by write use cases.

**Write use cases.** `addYeastProcessor`, `removeYeastProcessor`, `reorderYeastProcessor`, `setYeastProcessorBypass`, `setYeastProcessorParam`, `setYeastUiLevel`. Each is a single exported function. Each mutates the main-thread `MidiRack`, mirrors the change to the worklet via `getWorkletNodeSync()?.…`, and re-syncs the store. There are no command handlers (`handlers/`) — the use cases are called directly from React.

**Audio-thread path.** `processYeastMidi` (`yeastSchedulingBridge/processRealtimeMidiInput.ts:6`) is the entry point used by `AudioEngine`'s scheduler. It loads the live `transportStore.value`, builds a `TransportInfo`, and calls `MidiRack.processBlock` synchronously on the **main thread**. The Worklet path exists in parallel: `YeastWorkletNode.processBlock` posts a message and awaits a Promise. The main-thread path is what's actually used today (the Worklet's `processBlock` async response is unused by the scheduling bridge — see issue #6).

**Processors.** 15 classes extend `BaseMidiProcessor`, all in `useCases/processors/`. Most generate notes by walking a step-grid driven by `transport.bpm` × `rate`. Several (`Arpeggiator`, `NoteRepeater`, `EuclideanGenerator`, `MarkovChain`, `MutationEngine`, `CCGenerator`) carry their own `ScheduledEventQueue` to span block boundaries. All hand-roll an LCG RNG inline — `lcgRandom.ts` exists but only the `Humanizer` uses it.

**Tests.** Each processor has a spec; the rack and bridge use cases have specs; `YeastPanel` and components have specs. Spec quality is mixed (see #19, #20).

---

## Findings

1. The root `index.ts` is missing. Every cross-module consumer imports a private sub-path (`#/modules/Yeast/stores`, `#/modules/Yeast/useCases`, `#/modules/Yeast/presentations/views`). AGENTS.md classifies that as a contract-boundary violation, and `pnpm deps:validate` is the only tool that catches it — there is nothing in this module to fix until the barrel exists.

2. The "no allocation in audio-thread code" rule has been **partially** internalised in `MidiRack` (with explicit comments at `MidiRack.ts:14-22, 56-61, 88-99`) but **completely ignored** by every processor that uses string keys for note-pair maps (`Transposer`, `Humanizer`, `ScaleQuantizer`, `ChordGenerator`, `ChordMemory`, `Harmonizer`, `NoteFilter`). Each Note On/Off allocates a fresh template-literal `${ch}:${note}`. The `MidiRack` itself uses the integer-key trick `(channel << 7) | note` — the processors do not. This is internally inconsistent: the same rule enforced in one file, ignored in seven.

3. Step-generator processors mis-use the block window. `Arpeggiator.ts:99-113`, `NoteRepeater.ts:62-67`, `EuclideanGenerator.ts:98-99`, `MarkovChain.ts:155-156`, `CCGenerator.ts` all derive `blockEnd` from `input[0].timeSamples + 128` (or `+ 8192` for `NoteRepeater`). This is wrong: the rack already knows `blockEndSamples` and passes it into `processBlock`, but `processMidi(input, output, transport)` is given only the transport — the block boundary is not threaded into the contract. So every generator hand-rolls a guess. When `input` is empty (steady state, no incoming MIDI), `now = 0` (`Arpeggiator.ts:90`, `EuclideanGenerator.ts:98`, `MarkovChain.ts:155`) — meaning the first idle block silently runs the entire scheduling loop with `blockEnd = 128` but `lastStepTime = 0`, which only emits steps that fall within the first 128 samples. After the first transport seek/loop the steady-state path silently underschedules.

4. `NoteRepeater`'s `+ 8192` window emits future events as if they were due _now_. `NoteRepeater.ts:63` uses an arbitrary 8192-sample lookahead instead of the actual block boundary. Combined with the scheduled queue's `drainRange(0, blockEnd)`, this means notes scheduled up to ~186 ms in the future at 44.1 kHz get emitted in the current block, ahead of when the rack/scheduler will actually deliver them. The downstream `MidiRack.processBlock` (step 6, `MidiRack.ts:106-113`) re-routes them via `this.scheduled.push(event)` if `timeSamples >= blockEndSamples`, so the bug is masked — but the semantics are confused: `NoteRepeater` is generating futures, then `MidiRack` is re-queueing them. The scheduling layer should be a contract, not a "best effort then fix-up".

5. **Transport seek / playhead jump is unhandled.** Step generators latch `lastStepTime` once at `-Infinity → first input`. There is no notion of "the audio scheduler reset the sample clock": after `Transport.stop()` then `play()` from a different position, `lastStepTime` may be far behind `input[0].timeSamples`, causing the safety counter (`< 64`) to trip and silently dropping steps. None of `Arpeggiator`, `NoteRepeater`, `EuclideanGenerator`, `MarkovChain`, `CCGenerator` listen for transport stop/seek beyond the per-processor `reset()` — and `reset()` is only called from `MidiRack.allNotesOff` which has no caller wired to seek.

6. **Two parallel scheduling paths, only one is used.** `processYeastMidi` (the bridge) calls `rack.processBlock` directly on the main thread. The Worklet's `processBlock` async pipe (`YeastWorkletNode.ts:66-76`) is dead in `useCases/yeastSchedulingBridge/`. Mutations to processors are mirrored to the worklet (`addProcessor`/`removeProcessor`/`setParam`/`setBypass`), but **the worklet's rack never runs `processBlock`** because nothing calls `node.processBlock(...)`. So the worklet maintains an in-sync rack that it never drives. This is dead infrastructure consuming worklet memory and IPC bandwidth.

7. **Worklet add-before-init race is real.** `addYeastProcessor` (`addYeastProcessor.ts:11`) calls `getWorkletNodeSync()` — which returns null if the worklet hasn't resolved. The processor lands in the main-thread rack but **never** in the worklet rack, because `getYeastWorkletNodeAsync` only re-syncs the **type map** (`yeastStore.ts:78-80`) — it does not re-sync the param map or bypass state of any processor that was added/configured before the worklet resolved. So if a user opens Yeast, drops in a processor, sets a param, and the worklet finishes initialising mid-stream, the worklet's processor will be created with default params and out-of-sync bypass. (This bug is benign today only because the worklet path is dead — see #6.)

8. **Worklet `processBlock` Promise leak on processor failure.** `YeastWorkletNode.ts:55-64` has no error path: if the worklet throws, no `processed` message is posted and the entry stays in `pending` forever. The `reject` function is captured but never invoked; the Promise stays pending and the caller's microtask never resolves. There's also no timeout. A single bad processor message permanently leaks request memory.

9. **`AudioWorkletNode` with zero outputs is connected to nothing and never advances `currentFrame` for the host graph.** `YeastWorkletNode.ts:47-50` constructs the node with `numberOfInputs: 0, numberOfOutputs: 0`. By the spec, an AudioWorkletProcessor whose return value is `true` will have `process()` called on every render quantum **only if the node is connected to the destination chain** (or kept alive by a connection). Browsers vary — Chrome keeps it alive, Safari may suspend it. The `currentFrame` reference in `yeastWorkletProcessor.ts:58` (`this._rack.allNotesOff(data.nowSamples ?? currentFrame)`) is undefined behaviour when the worklet is not in the running graph. `node.disconnect()` in `destroy()` (`YeastWorkletNode.ts:90`) is a no-op because nothing is connected.

10. **`MidiRack.scratchA` / `scratchB` ping-pong is unsafe under reentrance.** `MidiRack.processBlock` (`MidiRack.ts:51-116`) holds `scratchA`, `scratchB`, `separateOutput` as instance fields and reuses them. If `processBlock` is called recursively (e.g. a processor's effect triggers another `processYeastMidi` synchronously), the second call clears `scratchA` mid-iteration and the first sees corruption. There is no defensive guard. This is theoretical for the current scheduling bridge but is a sharp footgun for any future "feedback loop" processor.

11. **`MidiRack.separateOutput` is returned to a caller that holds it indefinitely.** `MidiRack.ts:115` returns `finalOutput` (which is `this.separateOutput`). The contract documented at `:104-105` says "the caller consumes it synchronously before the next processBlock call" — but the only caller is `processYeastMidi`, which returns the array up the stack to `AudioEngine`'s scheduler. Whether that scheduler retains the reference past the next tick is not enforced by anything in this module. If it does, the next `processBlock` truncates the previous tick's output _while the consumer is still iterating it_. The structuredClone copy referenced in the comment (`yeastWorkletProcessor.ts`) is irrelevant because the worklet path is unused (#6).

12. **`MidiRack.scheduled.flushAllNotesOff` does not respect already-emitted Note Ons.** `MidiProcessor.ts:86-96`: it iterates `this.events` and emits a Note Off for each scheduled Note On. But scheduled events also include scheduled Note Offs that match earlier scheduled Note Ons; flushing emits a duplicate Note Off for the latter and a stray Note Off for any pre-existing live Note On that never had a scheduled match. The downstream synth gets `noteOff(c, n)` for notes it isn't holding. (Most synths ignore these — but the contract is wrong.)

13. **`MidiRack.activeNotes` map key collision: channel encoded in 7 bits, but channel can be 16 max.** `MidiRack.ts:92-97`, `:124-129`: `(channel << 7) | note`. With 16 channels (0-15) and 128 notes (0-127), the channel is shifted by **7**, leaving the bottom 7 bits for note. That works — notes are 0-127 (7 bits). But the comment claims "Numeric key avoids per-event template-literal allocation" — fine. The bug is in symmetry with the processors: `Transposer`, `Humanizer`, etc. use `channel * 128 + note` (which is the same number) **but with string keys**. The numeric-key trick was applied to the rack and not to the processors — see #2.

14. **`Arpeggiator.expandOctaves` has an off-by-one + bug in `upDown` mode.** `Arpeggiator.ts:344-350`: `for (let output = this.octaveRange - 2; output > 0; output--)` — this never includes 0, so the descent stops at octave 1, skipping the original octave on the way down and never reaching it. Combined with the ascent `0..octaveRange-1`, the full sequence for `octaveRange = 3` is `[0, 1, 2, 1]` instead of `[0, 1, 2, 1, 0]`. The cycle is asymmetric.

15. **`Arpeggiator.selectStepNotes` allocates two sorted arrays per step.** `Arpeggiator.ts:370-371`: `[...pool].sort(...)` twice per step. With `safety < 64` step-iterations per block and a typical 8-note pool, that's ~1k-element allocation per audio block. The `byOrder` sort is only used in `'order'` mode (`:391-392`); the `byPitch` sort is used in 5 of 8 modes. Hoist them out of the switch and only sort what's needed.

16. **`Arpeggiator.processMidi` allocates `stepNotes.map(...)` for per-step octave/semitone offsets.** `Arpeggiator.ts:178-181`: spreads `{...sn, note}` for every step note when an offset is non-zero. Allocates per step in the audio-thread hot path.

17. **`Arpeggiator.processMidi` interleaves note-state mutations and scheduled-queue mutations during `tie` step.** `Arpeggiator.ts:144-155`: clears `this.scheduled` and re-pushes a Note Off per active generated note. If the existing scheduled queue contained entries _other_ than note-offs for `activeGenerated` (it doesn't today, but the queue is shared), they would be silently dropped. A more robust approach is to find-and-update; clearing the whole queue is a footgun for future processors that interleave scheduled non-note-off events.

18. **`Arpeggiator`'s `safety < 64` is an undocumented runaway guard.** `Arpeggiator.ts:121`, also in `EuclideanGenerator.ts:106`, `MarkovChain.ts:163`. The number is plucked from nowhere; at very fast rates (`1/64` straight, BPM 200, sample rate 48 kHz), `stepLenSamples ≈ 187`, so 64 iterations fit only ~12 ms of music — at a 256-sample (5.3 ms) block size this is fine, but at a 4096-sample render quantum (Web Audio's max) the loop tops out. Use a documented constant + a deterministic upper bound based on `blockEnd / stepLenSamples`.

19. **Tests are mostly behavioural, but several lean on `as unknown as` / type-narrowed asserts.** Spot checks in the spec suite show explicit `MidiEvent` fixtures and behavioural assertions (good). I have not exhaustively scanned every spec — see #20 for the gap.

20. **No spec covers `MidiRack.processBlock` ping-pong correctness or `separateOutput` reuse.** `MidiRack.spec.ts` is in the file list but per finding #10, #11 the scratch-buffer reuse semantics are not exercised. There is no test for "two consecutive `processBlock` calls don't share state via `separateOutput`" or "input-events of length 0 don't emit a 0-time `noteOff` for unrelated active notes".

21. **`processYeastMidi` reads `transportStore.value` directly per call.** `processRealtimeMidiInput.ts:19`. Cross-module store reads on every audio-block tick; `transportStore` is on the main thread, so a) on the worklet path this would be impossible (which is fine — worklet path is dead), b) on the main-thread path this is an unnecessary store dereference per audio block. Snapshot once per scheduler tick at the call site. Also, `transport.tempo` is read but `ppqPosition`, `barIndex`, `beatInBar` are hard-coded to 0 — meaning every step generator that depends on `transport.ppqPosition` (e.g. `Arpeggiator.ts:112`) is actually receiving 0, not the real PPQ. The `restartOnBar` mode (`Arpeggiator.ts:52`) **never restarts on bar** because `barIndex` is always 0.

22. **`processRealtimeMidiInput` synthesises a 128-sample block from a single MIDI event.** `processRealtimeMidiInput.ts:55`: `processYeastMidi([event], sampleTime, sampleTime + blockSize, sampleRate)`. The block window (128 samples = 2.7 ms at 48 kHz) is far too short for any step-generating processor: an arpeggiator at 1/16 at 120 BPM steps every ~125 ms (~6000 samples), so a single key press triggers `MidiRack.processBlock` with a 128-sample window in which `lastStepTime + stepLen > blockEnd` is virtually guaranteed false. **Real-time MIDI input through the Yeast rack does not produce arp output.** The bridge appears to assume that `processYeastMidi` is also called from the audio scheduler tick (which uses real block boundaries), but per #6 the scheduler's call path is unclear.

23. **`samplesPerBeat` is computed per processor per step.** `MidiEvent.ts:38-40`. Cheap math, but trivially hoisted to once per `processBlock`. With 5+ generator processors and 64-step safety loops, that's 320 redundant divisions per block.

24. **`yeastStore.inferType` is brittle string-matching that overrides the canonical type map.** `yeastStore.ts:140-172`: when a processor exists in the rack but not in `processorTypeMap`, infer the type from `processor.name` substring matches. This is dead code in normal flow (the type map is always populated by `addYeastProcessor`), but if it ever runs, it returns `'arpeggiator'` for `'NoteFilter'` (no match for `'Trans'`/`'Filter'` — wait, `'Note Filter'` matches `'Filter'`, OK). Several name strings collide (`'Note Repeater'` matches `'Repeat'`, but the result is `'repeater'` — good). Still, the fallback is `'arpeggiator'` (`:172`) which silently creates the wrong type. The type map should be the only source of truth; the inference branch is dead and should be removed.

25. **`getYeastWorkletNodeAsync` clears `_workletNodePromise` on failure but not the `_workletNode`.** `yeastStore.ts:74-89`: in the catch branch, `session._workletNodePromise = null` but `session._workletNode` is already null from the earlier reset. If a later call re-enters and the second attempt succeeds, the type-map sync at `:78-80` runs only once (the first time it succeeds). Subsequent calls return the cached node and never re-sync types added between failure and success. (Combined with #7.)

26. **`createYeastWorkletNode`'s `port.onmessage` does not handle non-`processed` messages.** `YeastWorkletNode.ts:55-64`: the switch is a single `if` for `processed`. A future worklet that posts an error message (`{ type: 'error', requestId, message }`) is silently dropped, leaving the Promise pending (#8).

27. **`destroy()` does not clear `pending`.** `YeastWorkletNode.ts:87-94`: closes the port, disconnects, but leaves `pending` populated. Any in-flight Promises stay unresolved forever. Consumers of `processBlock` get a hanging Promise.

28. **`workletRegistrations` is a `WeakMap` keyed by `BaseAudioContext`.** `YeastWorkletNode.ts:17`. WeakMap is the right choice for HMR survival, but the value is `Promise<void>`. If the first `addModule` rejects, the rejected promise is cached — every subsequent call returns the rejected promise without retrying. There is no retry path.

29. **All 15 processors hand-roll the same LCG inline despite `lcgRandom.ts` existing.** `Arpeggiator.ts:163`, `Transposer.ts:28`, `VelocityProcessor.ts:75`, `MarkovChain.ts:107`, `CCGenerator.ts` (presumably), etc. Only `Humanizer.ts` uses the helper. Inline duplication of `(state * 1103515245 + 12345) & 0x7fffffff` is the exact thing `lcgRandom.ts:14` claims to centralise.

30. **`ChordGenerator.processMidi` allocates a new `intervals` array on every Note On.** `ChordGenerator.ts:41`: `[...(CHORD_FORMULAS[chord] ?? [0,4,7])]` then `.sort(...)` per Note On. The voicing transforms (`drop2`, `drop3`, `spread`) further allocate via `.map`. Cache the voiced interval array per `(chordType, voicing)` pair.

31. **`ChordGenerator` lacks chord variety and uses string keys.** Only 12 chord types listed (`major`, `minor`, `dim`, `aug`, `sus2`, `sus4`, `dom7`, `maj7`, `min7`, `dim7`, `9th`, `11th`). No `min7♭5`, no `maj9`, no add-style. UX-wise the user sees a numeric `chord_type` slider (`setParam(name, value)`) — an integer index into the keys of `CHORD_FORMULAS`. That index is order-dependent, fragile across versions.

32. **`ScaleQuantizer.diatonicTranspose` returns wrong octave when input note is not in scale.** `ScaleQuantizer.ts:122-134`: for a note not in scale (`degreeIdx === -1`), the function returns the original note (`:127`). But the caller (`processMidi` at `:50`) only invokes this _after_ `quantizeToScale`, which guarantees the note is in scale by then. Dead branch. Worse, the caller already shifted the note via `quantizeToScale`, so the transposition is applied to the quantized note, not the original — for `remapMode = 'down'` with a flat-7 input on a major scale, the user sees the input quantized down to flat-6, then transposed by `degrees`. The combination is non-obvious.

33. **`Humanizer.gaussian` can produce negative time offsets that move Note Ons _before_ the input event.** `Humanizer.ts:37`: `event.timeSamples + timingOffsetSamples`. For `timingMeanMs = -5` (rushed preset), the Note On lands ~5 ms _before_ its input — i.e. before previous events in the same block. The downstream `MidiRack.processBlock` sorts by `timeSamples` (`:67`), so this is technically OK, but the resulting event can land in the previous block (`timeSamples < blockStartSamples`), which the rack's separator at `:107-113` does not handle. Negative times relative to the block window are undefined.

34. **`Humanizer.noteTimingMap` is not scope-bounded by transport reset.** `Humanizer.ts:81-83` clears it on `reset()`, but the rack only calls `reset()` from `allNotesOff`. Held notes during a long pad will accumulate in the map; the entries are removed on Note Off, so this is bounded by held-notes — but it grows unbounded if Note Offs are dropped (e.g. on transport seek before MIDI panic).

35. **`NoteRepeater` never decreases its `safety` counter.** `NoteRepeater.ts` does not have a `safety` guard at all; the loop is bounded only by `r <= this.repeatCount`. With `repeatCount = 16` (max) and a low `intervalSamples` (1/64 at 200 BPM = ~94 samples), the scheduler queues 16 events every Note On. At 16 simultaneous keys held, that's 256 scheduled events per block. No allocation guard.

36. **`NoteFilter.filteredNotes.has(key)` for noteOffs uses string key.** `NoteFilter.ts:28,40`. Same issue as #2/#13.

37. **`NoteFilter` never propagates noteOff for filtered Note Ons after `reset()`.** `NoteFilter.ts:66-68`: `reset()` clears `filteredNotes`. If a key was held when reset fires, the matching Note Off arrives later but the `filteredNotes` set has been cleared — so the Note Off is forwarded as if the Note On had passed. The downstream sees a stray Note Off.

38. **`Transposer`'s `randomRange` uses `% (range*2+1)` for an unbiased range — but on top of the existing `+ offset` it adds `randomRange` AFTER the deterministic offset, meaning random transposition replaces, not modulates, the constant `semitones + octaves * 12`.** `Transposer.ts:26-30`: actually it _adds_ to `offset`, so the spec is "deterministic offset plus random jitter", which is fine. The bigger issue is the modulo bias: `rngState % (range*2+1)` — `rngState` is in `[0, 0x7fffffff)`, dividing by `range*2+1` gives a tiny modulo bias for small ranges. Documented but not explicit.

39. **`ChordMemory.learning` commits on the first Note Off.** `ChordMemory.ts:67-75`: when learning, the first Note Off finalises the buffer. But the user may release one finger of a chord before the others; this captures only the partial chord. The "simplified: commit on first Note Off" comment is honest about the bug. UX-wise, learning should probably wait for all Note Offs (or use an explicit "commit" param).

40. **`Harmonizer.diatonicTranspose` snaps non-scale notes to nearest scale degree.** `Harmonizer.ts:95-103`: finds the scale-degree index by minimum distance. For a chromatic input (e.g. `C# major`), the harmoniser silently maps C# → C (or D), losing the chromatic intent. ScaleQuantizer should be upstream; if the user wants chromatic harmonies, the harmoniser cannot express them.

41. **`Harmonizer.timeOffsetSamples` is set to 0 by default and has no `setParam` exposing it.** `Harmonizer.ts:31-35`, `:114-168`: voices have a `timeOffsetSamples` field but `setParam` exposes only `degrees`, `enabled`, `velocityOffset` — not the time offset. The field is dead.

42. **`MarkovChain.fillDefaultMatrix` is called per Note On if `held.length` changes.** `MarkovChain.ts:131-134`: rebuilding a `MAX_STATES × MAX_STATES` matrix in the audio thread every chord change. The rebuild itself is O(MAX_STATES²) = 144 entries; cheap. But it discards any user-set transitions via `setTransition` (`:211-225`). The intended UX is unclear: does the user expect their custom matrix to survive a chord change? Today it does not.

43. **`MarkovChain.held.indexOf` and `held.sort` allocate per Note On.** `MarkovChain.ts:124-126`: `splice` and `sort` both. Sort allocates internal scratch. Splice does not, but `held.indexOf` is a linear scan plus a string-equality check.

44. **`EuclideanGenerator.bjorklund` uses two unused loops.** `EuclideanGenerator.ts:30-43`: builds `pattern: boolean[][]`, `level`, `counts`, `remainders` — all of which are then thrown away, with the actual pattern computed via a separate Bresenham formulation at `:46-52`. Dead code in the audio path.

45. **`StoredChord.notes` in `ChordMemory` is stored as absolute notes plus a separate `root`.** `ChordMemory.ts:11-14`. On recall (`:48`), the transpose offset is `event.kind.note - stored.root`. If the user stores a chord rooted at C4 then plays the trigger at C5, the transposed chord lands one octave up. But if they store at C4 and play at G3, the chord transposes _down_ by 5 semitones — which is correct only if the stored chord's relative voicing was monotonically above C4. Stored chords with notes _below_ the root produce inverted-octave output. UX: the docstring promises Cthulhu-style; Cthulhu uses pitch-class-based recall, not absolute-note transposition.

46. **AGENTS.md function-signature violation: positional args in audio path.** `MidiRack.processBlock(input, blockStart, blockEnd, transport)` — four positional. `processYeastMidi(events, blockStart, blockEnd, sampleRate)` — four positional. `processRealtimeMidiInput(note, velocity, channel, isNoteOn, sampleTime, sampleRate, blockSize)` — seven positional. Per AGENTS.md "Functions with more than one parameter take a single object param" with named `<Fn>Input` types. Audit applies module-wide.

47. **AGENTS.md violation: `useCases/index.ts` re-exports nothing of substance and the events file is empty.** `useCases/index.ts:1-2` exports two functions: the bridge entry points. None of the write use cases (`addYeastProcessor`, …) are re-exported there. They are not exposed externally — but presentation views need them. Today views import via `'#/modules/Yeast/useCases'` which means... they must traverse the barrel. Let me re-check: the barrel currently exports only the bridge functions. So write use cases are imported via `'#/modules/Yeast/useCases/addYeastProcessor'` — a deep cross-module import. AGENTS.md "no-cross-module-internals" rule should flag this. (See findings investigation in #1: there is no root barrel either, so the situation is uniformly broken.)

48. **AGENTS.md violation: cross-module store import in a model/use-case file.** `processRealtimeMidiInput.ts:1` imports `transportStore` from `'#/modules/Transport/stores'` — that is a same-tier module reading another module's store directly inside a use case, which is permitted, but the use case sits in `useCases/yeastSchedulingBridge/` and is re-exported via `useCases/index.ts`. The `transportStore.value` read happens on every audio-block call. See #21 for the cost.

49. **`yeastStore.ts` exports types from a `stores/` file that the root barrel would have to re-export.** `stores/yeastStore.ts:23-33` exports `YeastProcessorInfo`, `YeastState` types. AGENTS.md "Use-case types stay private" prohibits exporting types via `useCases/`, and by extension the same caution applies to stores: only the runtime `Store<T>` should be cross-module. Today `stores/index.ts:2` re-exports `YeastState`. Acceptable for the **store contract** (consumers must know the shape), but the `YeastProcessorInfo` type is also leaked indirectly via `YeastState`. Document the contract explicitly.

50. **`createHmrPersistentState` is used to wrap mutable singletons.** `yeastStore.ts:49-54`. This is the same pattern flagged in the AudioAnalysis audit (#26): a workaround for module-private mutable state. Across modules, multiple ad-hoc HMR-survival containers have accumulated. Worth a higher-level skill / utility audit.

51. **No accessibility on `YeastPanel` and child components.** Pending presentation review (see issue #15).

52. **Test gaps on transport edge cases.** No spec verifies "transport stop → seek → play" produces correct behaviour for any step generator. No spec verifies "panic in the middle of an arpeggio leaves no hanging notes". `MidiRack.spec.ts` exists but per #20 the scratch-buffer reuse is not exercised. (Pending spec review for confirmation.)

---

## Priorities (updated 2026-04-28 — adversarial re-review)

1. **Critical-severity audited correctness bugs:**
   - **#62** — Live-keyboard Note Offs bypass the Yeast rack → hanging notes through Transposer / ChordGenerator / Harmonizer / etc. (single-line fix in `messageHandlers.ts`).
   - **#26** — `ChordMemory` recall is keyed by absolute MIDI note, so the entire feature only works for the exact stored note. Transposition is unreachable.
   - **#15** — Every UI knob/select displays a hard-coded literal value, not the processor's actual state. UI is misleading across all 15 processor types.
   - **#19a** — 21 of 28 spec files are placeholder no-ops. CI green is meaningless. The behavioural specs that exist (#20) use a wrong `TransportInfo` shape.
2. **Cross-path discontinuities (real-time vs offline):**
   - **#6** (corrected) — Worklet IS used, but only by `scheduleMidiNotes`. Real-time bridge uses main-thread rack. Same singleton, two writers.
   - **#53** — `reorderYeastProcessor` does not mirror to the worklet → real-time path and offline path produce different output after reorder.
   - **#54** — `setYeastProcessorParam` does not call `syncStoreFromRack` → store never sees param updates.
   - **#59** — `scheduleMidiNotes` and the bridge build different `TransportInfo` shapes for the same rack.
3. **Audio-thread allocation hazards (issues #2, #13, #15, #16, #29, #30, #36, #43, #65)** — the rack enforces "no allocation" but 6 processors violate it via string keys; 9 inline LCG sites; per-step array spreads in Arpeggiator.
4. **Block-window and transport-seek issues (issues #3, #4, #5, #21, #22)** — step generators silently underschedule; transport metadata is fabricated.
5. **Worklet IPC fragility (issues #7, #8, #25, #26, #27, #28, #60, #63)** — race conditions, Promise leak, rejected-promise cache, no error path, no retry, `currentFrame` reliance.
6. **Processor correctness (issues #11, #32, #33, #39, #40, #45, #67)** — `allNotesOff` flush bug; ScaleQuantizer chained transpositions; Humanizer pre-block events; `removeProcessor` leaves hanging notes.
7. **AGENTS.md violations (issues #1, #46, #47, #48, #49, #55, #56, #58, #66)** — missing barrel, positional-args, deep imports, namespace imports in 21 specs, codemod-generated `renderIife_NN`, `setParam` contract inconsistency, possible tsconfig hole.

**Recommended single-session focus:** issues #62, #54, #53, #1 — all small fixes that close audible correctness bugs and re-enable the architectural test surface.

---

## Open issues

### 1. Module has no root `index.ts`

**Problem:** `src/modules/Yeast/` lacks the canonical root barrel. AGENTS.md "Contract Boundaries" mandates that cross-module imports target the destination module's root `index.ts`. Today every consumer goes via `'#/modules/Yeast/stores'`, `'#/modules/Yeast/useCases'`, `'#/modules/Yeast/presentations/views'`. The `useCases/index.ts` barrel only re-exports the two bridge functions; the write use cases (`addYeastProcessor`, `removeYeastProcessor`, `setYeastProcessorParam`, etc.) are not on the barrel surface at all.

**Representative files:**

- `src/modules/Yeast/` (no root `index.ts`)
- `src/modules/Yeast/useCases/index.ts:1-2`
- `src/modules/Yeast/stores/index.ts:1-2`

**Needed:** Add `src/modules/Yeast/index.ts` re-exporting only the cross-module surface from `useCases/`, `events/`, `stores/`, `presentations/views/`. Audit each external caller (`AudioEngine`, `Transport` callers, `ArrangementView` panels) and migrate their imports to the root path. Run `pnpm deps:validate` after the migration.

### 2. Audio-thread string-key allocations across processors

**Verified 2026-04-28.** Severity: high. Original audit listed 7 processors but missed `GrooveModule` and miscounted `ScaleQuantizer` (which already uses numeric keys). Actual head-of-tree state:

| Processor                                                                | Map type                       | Key construction                | Status                |
| ------------------------------------------------------------------------ | ------------------------------ | ------------------------------- | --------------------- |
| `Transposer.ts:17,33,40,42`                                              | `Map<string, number>`          | `` `${ch}:${note}` ``           | violates §149.2       |
| `ChordGenerator.ts:32,79,81`                                             | `Map<string, number[]>`        | `` `${ch}:${note}` ``           | violates §149.2       |
| `ChordMemory.ts:25,46,79`                                                | `Map<string, number[]>`        | `` `${ch}:${note}` ``           | violates §149.2       |
| `Harmonizer.ts:37,51,75`                                                 | `Map<string, number[]>`        | `` `${ch}:${note}` ``           | violates §149.2       |
| `GrooveModule.ts:36,55,63` **(missed in prior audit)**                   | `Map<string, number>`          | `` `${ch}:${note}` ``           | violates §149.2       |
| `NoteFilter.ts:19,28,40`                                                 | `Set<string>`                  | `` `${ch}:${note}` ``           | violates §149.2       |
| `Humanizer.ts:28,41,54`                                                  | `Map<number, number>`          | `ch * 128 + note`               | OK                    |
| `ScaleQuantizer.ts:37,54,60`                                             | `Map<number, number>`          | `ch * 128 + note`               | OK                    |

**Blast radius:** 6 processors touched, dozens of `setParam`/`reset` boundaries unaffected. With a typical 4-processor chain (`Humanizer → Transposer → ChordGenerator → NoteFilter`) on a 16-note Note On burst, each processor allocates 16 template-literal strings — 64 small-string allocations per audio block versus zero for the rack itself. `MidiRack` paid the cost of "no allocation" per `MidiRack.ts:14-22, 56-61, 88-99`; the processors throw it away.

**Repro:** Add a Transposer to a rack, play 16 notes simultaneously. Profile with `performance.measure` — string allocations dominate the per-block budget. Verifiable by replacing `Map<string, …>` with `Map<number, …>` and re-running.

**Fix sketch:** Add `noteKey(channel, note): number` to `models/MidiProcessor.ts` returning `(channel << 7) | note`. Replace each `Map<string, …>` with `Map<number, …>`. Per CLAUDE.md "No automated bulk file edits" — do this manually, file by file.

**Severity rationale:** High because the cost grows linearly with both polyphony and chain length. A correctness invariant ("audio-thread allocates nothing") is violated unconditionally.

**Needed:** Replace string keys with `(channel << 7) | note` numeric keys per the rack's canonical pattern (`MidiRack.ts:88-99`). Switch `Map<string, …>` / `Set<string>` to `Map<number, …>` / `Set<number>`. Add a shared helper `noteKey()` in `models/MidiProcessor.ts`. After landing, audit `_transport` parameter naming — every string-key processor takes `_transport` (unused) and only Humanizer / ChordGenerator actually use it. Note: `ChordGenerator` does use `transport.sampleRate`; the others don't.

### 3. Step generators hand-roll `blockEnd` instead of receiving it

**Problem:** `MidiRack.processBlock` knows the real `blockStartSamples` and `blockEndSamples` but only forwards the transport. Each step-generating processor then computes `blockEnd = input[0]?.timeSamples + 128` (or 8192 for `NoteRepeater`). When `input` is empty, `now` defaults to 0 — meaning steady-state ticks compute `blockEnd = 128` regardless of where the playhead actually is. The `lastStepTime` field then races ahead of `blockEnd` and the loop never enters.

**Representative files:**

- `src/modules/Yeast/useCases/MidiRack.ts:51` (signature does not pass blockStart/blockEnd into processors)
- `src/modules/Yeast/useCases/processors/Arpeggiator.ts:99-117`
- `src/modules/Yeast/useCases/processors/NoteRepeater.ts:62-67`
- `src/modules/Yeast/useCases/processors/EuclideanGenerator.ts:98-99`
- `src/modules/Yeast/useCases/processors/MarkovChain.ts:155-156`
- `src/modules/Yeast/models/MidiProcessor.ts:15` (`processMidi` interface)

**Needed:** Extend the `MidiProcessor.processMidi` contract to take `blockStartSamples` and `blockEndSamples` (or a single `blockRange` object). Replace the hand-rolled `now / +128` heuristics in every processor. Add a test that verifies a step generator with an empty input but a non-zero playhead schedules events correctly.

### 4. Transport metadata is partially fabricated in `processYeastMidi`

**Problem:** `processRealtimeMidiInput.ts:24-36` builds `TransportInfo` with `ppqPosition: 0`, `barIndex: 0`, `beatInBar: 0`. Every processor that reads these fields gets zero. `Arpeggiator.ts:112` falls back to `transport.ppqPosition * samplesPerBeat(transport)` for the initial `blockEnd` — which is 0 — and `Arpeggiator.ts:117` does the same for `lastStepTime`. The `restartOnBar` mode (`Arpeggiator.ts:286-289`) keys off `barIndex`, which never advances.

**Representative files:**

- `src/modules/Yeast/useCases/yeastSchedulingBridge/processRealtimeMidiInput.ts:24-36`
- `src/modules/Yeast/useCases/processors/Arpeggiator.ts:112,117`

**Needed:** Compute `ppqPosition`, `barIndex`, `beatInBar` from the actual playhead. Either source these from `transportStore.value` (which already has `tempo`, `loopStart`, `loopEnd`) or — better — accept a fully-formed `TransportInfo` from the AudioEngine scheduler and stop snapshotting in the bridge.

### 5. Real-time MIDI input through the rack does not produce generator output

**Problem:** `processRealtimeMidiInput.ts:55` calls `processYeastMidi([event], sampleTime, sampleTime + 128, sampleRate)`. The 128-sample window is too short for any rate at any reasonable BPM to fit a step. As a result, pressing a key with an Arpeggiator on the rack only produces the input note pass-through (which the arpeggiator does not even forward — `Arpeggiator.ts:79-84` swallows Note Ons). The user hears nothing.

**Representative files:**

- `src/modules/Yeast/useCases/yeastSchedulingBridge/processRealtimeMidiInput.ts:41-56`

**Needed:** Decouple "the rack tracks a Note On" from "the rack emits a step". Real-time MIDI input should update held-notes state without invoking step generation; the audio scheduler's own block-tick should drive step generation with the correct `blockEnd`. Today these two paths are conflated.

### 6. Worklet rack is partially driven, partially shadowed (CORRECTION OF PRIOR AUDIT)

**Verified 2026-04-28.** Severity: high. The prior audit claimed the worklet's `processBlock` is never called. **That is wrong.**

The worklet *is* called — by `src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts:248-251`:

```ts
const workletNode = await getYeastWorkletNodeAsync(ctx);
const processed = workletNode
    ? await workletNode.processBlock(midiEvents, blockStartSamples, blockEndSamples, yeastTransport)
    : yeastRack.processBlock(midiEvents, blockStartSamples, blockEndSamples, yeastTransport);
```

This is the **offline / clip-bake path**: `scheduleMidiNotes` walks each MIDI clip, builds events, and runs them through Yeast (worklet preferred) before the per-track scheduler emits to synths. It is the path actually used during playback transport ticks.

The bridge (`useCases/yeastSchedulingBridge/processRealtimeMidiInput.ts:38`) is a **separate path** for **real-time MIDI input** (live keyboard playthrough). It is called from `messageHandlers.ts:349`. It does *not* use the worklet — it always uses the main-thread `getYeastRack().processBlock(...)`.

**Real bugs uncovered:**

1. **Two consumers, two scheduling discontinuities.** When the user is *both* recording from a MIDI keyboard *and* playing back a clip with the same Yeast rack inserted, both paths run on the same `MidiRack` instance (worklet + main-thread, separately). `MidiRack.activeNotes` and `MidiRack.scheduled` get clobbered between paths because they share state. Note Ons emitted by the offline path's worklet can race against Note Offs computed on the main thread by the bridge.
2. **Real-time path skips the worklet for no documented reason.** The bridge could equally `await getYeastWorkletNodeAsync(ctx)` and `await workletNode.processBlock(...)` — but it doesn't, presumably to avoid awaiting on the audio thread (good intent, wrong implementation: nothing in `processRealtimeMidiInput` runs on the audio thread; it's called from a Web MIDI message-port callback).
3. **Param/bypass mirroring race remains** (issue #7).

**Severity rationale:** High because two independent code paths drive the same singleton rack with different latency models. The user can stack a clip + live input through the same rack and observe inconsistent output.

**Representative files:**

- `src/modules/Yeast/engine/YeastWorkletNode.ts:66-76`
- `src/modules/Yeast/services/yeastWorkletProcessor.ts:60-69`
- `src/modules/Yeast/useCases/yeastSchedulingBridge/processRealtimeMidiInput.ts:38`
- `src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts:248-251`
- `src/modules/AudioEngine/repositories/webMidi/messageHandlers.ts:349`

**Needed:** Decide on a single source of truth. Either (a) both paths use the worklet (move the bridge to `await getYeastWorkletNodeAsync` and tolerate the await — it's not on the audio thread); (b) both paths use the main-thread rack and the worklet path is removed; or (c) the rack instance is partitioned: one rack per path (live-input rack, playback rack), keyed by clip/track context. (c) is the architecturally clean choice but requires reworking `getYeastRack()` to return a context-keyed instance.

### 7. Worklet add-before-init does not re-sync params/bypass

**Problem:** `getYeastWorkletNodeAsync` re-syncs `processorTypeMap` once after the worklet resolves (`yeastStore.ts:78-80`), but does not re-apply any `setParam` / `setBypass` that landed before the worklet was ready. If the user adds a processor and tweaks a parameter while the worklet is still initialising, the worklet rack gets the processor with default params.

**Representative files:**

- `src/modules/Yeast/stores/yeastStore.ts:74-89`
- `src/modules/Yeast/useCases/setYeastProcessorParam.ts:1-7`
- `src/modules/Yeast/useCases/setYeastProcessorBypass.ts:1-8`

**Needed:** Either keep a per-processor "pending mutations" buffer that replays after worklet resolution, or block all writes (queue them) until the worklet is ready and then drain. (Moot if issue #6 resolves toward removing the worklet.)

### 8. Worklet `processBlock` Promise leak on missing response

**Problem:** `YeastWorkletNode.ts:53-64` stores `{ resolve, reject }` per request, captures `reject`, and never invokes it. If the worklet drops a message (port error, GC bug, browser implementation quirk), `pending` retains the entry forever and the consumer's Promise never resolves or rejects. No timeout.

**Representative files:**

- `src/modules/Yeast/engine/YeastWorkletNode.ts:53-76,87-94`

**Needed:** Add a timeout (e.g. `AbortSignal` + `setTimeout` per request, rejecting after 200 ms). Add an error-message handler for `{ type: 'error', requestId, message }`. Clear `pending` on `destroy()` by rejecting all entries with an "aborted" error.

### 9. AudioWorkletNode with zero outputs may not be scheduled

**Problem:** `YeastWorkletNode.ts:47-50` constructs an `AudioWorkletNode` with `numberOfInputs: 0, numberOfOutputs: 0`. Browsers vary on whether they keep such a node alive; the worklet's `process()` returns `true` to "stay alive" but with no graph connection there may be no graph to participate in. The `currentFrame` global referenced by `yeastWorkletProcessor.ts:58` is only meaningful when the processor is being driven by the audio graph.

**Representative files:**

- `src/modules/Yeast/engine/YeastWorkletNode.ts:47-50`
- `src/modules/Yeast/services/yeastWorkletProcessor.ts:58`

**Needed:** Either (a) connect the node to `ctx.destination` with a zero-volume gain (or `MediaStreamAudioDestinationNode`) to ensure scheduling, or (b) confirm the spec/browser behaviour and remove the `currentFrame` fallback. Cross-reference with #6 — if the worklet path is dead, this becomes moot.

### 10. `MidiRack` scratch buffers are reentrance-unsafe and leak references to callers

**Problem:** `MidiRack.scratchA`, `scratchB`, `separateOutput` are instance fields mutated in place. (a) A reentrant call to `processBlock` (e.g. a feedback-loop processor that calls `processYeastMidi` inside `processMidi`) would trash `scratchA`. (b) The returned `separateOutput` reference is the same array on every call; the caller is implicitly required to consume it before the next call, but nothing enforces that.

**Representative files:**

- `src/modules/Yeast/useCases/MidiRack.ts:20-23,57-83,103-115`

**Needed:** (a) Add an `isProcessing` boolean guard that throws on reentrance. (b) Either copy `separateOutput` into a fresh array on return (one allocation per block — acceptable) or document the consume-before-next contract in the type system (e.g. return a "borrowed" wrapper that the caller must drain).

### 11. `MidiRack.allNotesOff` flush emits stray Note Offs

**Problem:** `ScheduledEventQueue.flushAllNotesOff` (`MidiProcessor.ts:86-96`) iterates `this.events` and emits a Note Off for every scheduled `noteOn`. But scheduled events also include `noteOff`s (the matching Note Off for previously-scheduled Note Ons). The flush emits the Note Off for the Note On but discards the matching scheduled Note Off — net behaviour is "emit one Note Off, lose the other". For Note Ons that were already drained in a previous block (so only their Note Off remains queued), the flush does nothing — the live note hangs.

**Representative files:**

- `src/modules/Yeast/models/MidiProcessor.ts:86-96`
- `src/modules/Yeast/useCases/MidiRack.ts:118-143`

**Needed:** Walk the entire active-note set (rack-level) and emit Note Offs for live notes; then clear scheduled events. Today the rack's `activeNotes` is updated on every `processBlock` (step 5, `:88-98`), so it has the correct live set — `allNotesOff` should drive Note Offs from there alone, not from scheduled.

### 12. Step-generator runaway guards are magic numbers

**Problem:** `safety < 64` in `Arpeggiator.ts:121`, `EuclideanGenerator.ts:106`, `MarkovChain.ts:163`. At fast rates and large block sizes the bound is tight; at slow rates it's vastly over-budget. No documentation of why 64 was chosen.

**Representative files:**

- `src/modules/Yeast/useCases/processors/Arpeggiator.ts:120-122`
- `src/modules/Yeast/useCases/processors/EuclideanGenerator.ts:105-107`
- `src/modules/Yeast/useCases/processors/MarkovChain.ts:162-164`

**Needed:** Document the upper bound: it should be derived from `(blockEnd - lastStepTime) / stepLenSamples + small_margin`. Replace magic 64 with a computed limit. Log a warning if hit (assistance for future debugging of stuck generators).

### 13. Hand-rolled LCG inline in 6 processors / 9 sites (corrected count)

**Verified 2026-04-28.** Severity: low. The original audit said "13 processors" which is wrong. Exhaustive `grep '1103515245' src/modules/Yeast/` returns:

| File                                                               | Lines                | Sites |
| ------------------------------------------------------------------ | -------------------- | ----- |
| `src/modules/Yeast/models/lcgRandom.ts:25`                         | (the helper itself)  | 1     |
| `src/modules/Yeast/useCases/processors/Arpeggiator.ts`             | `:163, :387, :426`   | 3     |
| `src/modules/Yeast/useCases/processors/Transposer.ts:28`           | `:28`                | 1     |
| `src/modules/Yeast/useCases/processors/MarkovChain.ts:107`         | `:107`               | 1     |
| `src/modules/Yeast/useCases/processors/VelocityProcessor.ts:75`    | `:75`                | 1     |
| `src/modules/Yeast/useCases/processors/MutationEngine.ts:79,81`    | `:79, :81`           | 2     |
| `src/modules/Yeast/useCases/processors/CCGenerator.ts:33`          | `:33`                | 1     |

Total: **9 inline-LCG sites across 6 processors** (plus the helper). Only `Humanizer` (`lcgRandom.ts:7`) consumes the helper. `MutationEngine` re-implements `gaussian()` inline using two LCG steps (`:79-81`); `Humanizer` already extracted that into `gaussian()` at `:68-74` using the helper. The duplication is not just LCG — it's the entire Box-Muller transform copy-pasted between `Humanizer` and `MutationEngine`.

**Blast radius:** Output sequences for the same seed will not change after migration if `nextLcg` returns the same bit pattern (`lcgRandom.ts:24-26` confirms it does). Migration is therefore a pure refactor with no behavioural change. `CCGenerator.ts:33` is a minor outlier — it stores the normalised float in `rngState.v` rather than the integer state; replacing requires a small adapter.

**Severity rationale:** Low. No correctness bug, just maintenance debt and one place where a future fix to the LCG (e.g. switching to mulberry32) has 9 places to update.

**Needed:** Replace inline LCG with `nextLcg` + `LCG_MAX`. Extract `boxMullerGaussian()` into `models/lcgRandom.ts` so `Humanizer` and `MutationEngine` share it. Mechanical edit, one file at a time per AGENTS.md "no automated bulk edits".

### 14. `Arpeggiator.expandOctaves` upDown — claim disputed

**Verified 2026-04-28.** Severity: low (downgraded from medium). **The original claim is wrong as a bug report.**

For `octaveRange = 3, octaveDirection = 'upDown'`, the loop at `Arpeggiator.ts:343-350` produces:

- ascending: `[0, 1, 2]` (output: `0, 1, 2`)
- descending: `for (output = 1; output > 0; output--)` produces `[1]` only
- combined: `[0, 1, 2, 1]`

This is the **standard tent pattern** used by every commercial arpeggiator:

| octaveRange | tent cycle      | "audit's expectation" (wrong) |
| ----------- | --------------- | ----------------------------- |
| 1           | `[0]`           | `[0]`                         |
| 2           | `[0, 1]`        | `[0, 1, 0]`                   |
| 3           | `[0, 1, 2, 1]`  | `[0, 1, 2, 1, 0]`             |
| 4           | `[0, 1, 2, 3, 2, 1]` | `[0, 1, 2, 3, 2, 1, 0]`  |

The "expectation" form would double-emit 0 at every cycle boundary (end of one cycle + start of next). The current code is correct for the tent pattern semantics that user-facing arpeggiators implement.

**However**, there is a real concern: nothing in `Arpeggiator.setParam` or the panel reads this back to verify what the user expects. Without explicit UX research / docs, "what *should* upDown do" is ambiguous. Users coming from Logic / Live ES2 may expect tent-pattern; users from rack synths with `[0, 1, 2, 1, 0]` semantics will not.

**Representative files:**

- `src/modules/Yeast/useCases/processors/Arpeggiator.ts:343-350` — the math
- (no UX doc / spec)

**Needed:** No code change required. Add a behavioural test asserting the tent-pattern sequence (`[0, 1, 2, 1]` for `octaveRange = 3`). Document the `'upDown'` semantic in code comment or use-case docstring. If the product owner confirms `[0, 1, 2, 1, 0]` semantics are required, change the descent loop to `output >= 0` *and* the ascent loop to skip `octaveRange-1` when looping back, to avoid doubling.

### 15. Presentation: every knob/select is decorative; no parameter is read from rack state

**Verified 2026-04-28.** Severity: critical (UX). Original audit identified the YeastPanel cases. Verification adds `ProcessorParams.tsx` — which contains every per-processor parameter form — and **every single value prop is a hard-coded literal**, across all 15 processor types. The full damage:

- `YeastPanel.tsx:362` Mode select `defaultValue={0}` — once the user selects, the displayed value is the local DOM state, not the processor's actual mode.
- `YeastPanel.tsx:377` Rate `value={8}` — knob always reads "8" regardless of processor's actual rate.
- `YeastPanel.tsx:393-403` Latch chip — `onClick` always sends `1` (no toggle); cannot turn latch off.
- `YeastPanel.tsx:415-446` Level 2 four `KnobCol`s with `value={0.8}`, `value={0}`, `value={1}`, `value={100}` — render-time constants.
- `YeastPanel.tsx:541, :743` `currentStep={0}` — pattern editor's "playing" indicator never animates.
- `YeastPanel.tsx:455-470` Level 3 `arpPattern` lives in React `useState`; `Arpeggiator.setPattern()` is **never called** — the pattern editor is purely decorative.
- `ProcessorParams.tsx:102, :109, :119, :131, :140, :151, :158, :167, :177` — all 9 `value=` for the **arpeggiator** card are literals.
- `ProcessorParams.tsx:204, :212, :219, :231` — chord type / voicing / strum / direction all literals.
- `ProcessorParams.tsx:252, :273, :296, :311` — scale quantizer all literals.
- `ProcessorParams.tsx:329, :337, :344, :356, :363, :375` — harmonizer all literals.
- `ProcessorParams.tsx:388, :398, :408, :418, :428` — note repeater all literals.
- `ProcessorParams.tsx:446, :453, :463, :474` — velocity processor all literals.
- `ProcessorParams.tsx:488, :495, :506, :516` — humanizer all literals.
- `ProcessorParams.tsx:533, :543, :553, :563, :574` — note filter all literals.
- `ProcessorParams.tsx:587, :598, :608` — transposer all literals.
- `ProcessorParams.tsx:626, :633` — groove all literals.
- `ProcessorParams.tsx:649, :660, :667, :673, :674, :680` — CC generator all literals.
- `ProcessorParams.tsx:689, :694, :703, :714, :724, :734, :744` — euclidean all literals.
- `ProcessorParams.tsx:760, :770, :780` — markov all literals.
- `ProcessorParams.tsx:797, :807` — mutation all literals.

**Compounded by issue #62 (new):** Even if these were rebuilt to read from rack state, `setYeastProcessorParam` does NOT call `syncStoreFromRack()` — the store would not re-emit. The reactive feedback loop is broken at both ends.

**Repro:** Open Yeast panel; add an Arpeggiator; set rate to 16; collapse + re-expand the params card. Rate display reads "8" again. The processor's actual rate has been set to 16 inside the rack, but the UI does not know.

**Severity rationale:** Critical because **the entire UI is misleading**. A user cannot trust any visible value. Every knob is essentially a write-only control whose display is unrelated to what's running.

**Representative files:**

- `src/modules/Yeast/presentations/views/YeastPanel.tsx:362-371,376-391,393-403,417-446,455,462,541,742-755`
- `src/modules/Yeast/presentations/components/ProcessorParams.tsx:102-815` (every `value={…}` is a literal)
- `src/modules/Yeast/useCases/processors/Arpeggiator.ts:241,250` (`setPattern`, `getCurrentStep` are dead-from-UI)
- `src/modules/Yeast/presentations/components/StepPatternEditor.tsx:26-31` (no `liveStep` wiring)

**Needed:** Three pieces:

1. Add a `getProcessorParams(id): Record<string, number>` API on `MidiRack` that snapshots each processor's current params. Each processor needs a `getParams()` accessor (currently absent). Alternatively, mirror params into the reactive store as part of `syncStoreFromRack`.
2. Make `setYeastProcessorParam` call `syncStoreFromRack()` (issue #62) so writes propagate.
3. Replace every literal `value={…}` in `ProcessorParams.tsx` and `YeastPanel.tsx` with state-derived values. Wire `Latch` as a true toggle via `state.processors[i].params.latch`. Wire `currentStep` via `requestAnimationFrame` polling `Arpeggiator.getCurrentStep()`. Plumb `arpPattern` to a new `setYeastProcessorPattern` use case that calls `Arpeggiator.setPattern()`.

### 16. Presentation: workaround `renderIife_NN` IIFE pattern

**Problem:** Multiple components use `const renderIife_NN = () => { … }` followed by a single call to render the value (`StepPatternEditor.tsx:53,65`, `KeyboardSplit.tsx:81,90,121`). This pattern reads as a codemod artefact (an automated transform's output). It contradicts CLAUDE.md "Code should self-explain" and the renaming `renderIife_18`, `renderIife_19`, `renderIife_20`, `renderIife_21`, `renderIife_22` strongly suggests an automated rewrite. Per AGENTS.md "No automated code mutations" this is forbidden.

**Representative files:**

- `src/modules/Yeast/presentations/components/StepPatternEditor.tsx:53,65`
- `src/modules/Yeast/presentations/components/KeyboardSplit.tsx:81,90,121`

**Needed:** Replace `const renderIife_X = () => …` with extracted typed helper functions named for what they return (e.g. `getStepBackground(step)`, `getKeyColour(held, sounding)`). Move them outside the component body where reasonable. Verify they don't capture render-scope state unnecessarily.

### 17. Presentation: `useStore(yeastStore, defaultYeastState)` defensive default duplicates the store's default

**Problem:** `YeastPanel.tsx:177-183`: declares `defaultYeastState` and passes it as `useStore`'s second argument, but `yeastStore.ts:35-40` already initialises the store with the identical `defaultState`. The `if (!state)` early-return at `:185-190` is therefore unreachable. CLAUDE.md "No fallback hacks" — defensive code that masks a contract.

**Representative files:**

- `src/modules/Yeast/presentations/views/YeastPanel.tsx:177-191`
- `src/modules/Yeast/stores/yeastStore.ts:35-40`

**Needed:** Drop the panel's `defaultYeastState`. If `useStore` requires a fallback, document why. The "Activating the yeast..." early return is dead code.

### 18. Presentation: implicit `&&` ternary mix in JSX

**Problem:** AGENTS.md rule: "Never render with `&&` — use ternaries or early returns." The panel uses `... ? <Foo /> : null` ternaries (good), but `Level5Lab.tsx` and several places mix the two casually. Confirm: I see `expandedId === proc.id ? (…) : null` (correct) but the codebase has historically used `&&` in similar places. Spot check across the four files looks compliant — no `&&` rendering — so this is a non-issue, just noted for completeness.

**Representative files:** none confirmed.

**Needed:** keep monitoring; lint rule should already catch this.

### 19c. `transportStore.value` read per audio block (was duplicate #16)

**Problem:** `processRealtimeMidiInput.ts:19` reads `transportStore.value` on every call, including every audio-block tick. Cross-module store dereference per audio frame.

**Representative files:**

- `src/modules/Yeast/useCases/yeastSchedulingBridge/processRealtimeMidiInput.ts:19`

**Needed:** Pass a snapshot from the caller (the AudioEngine scheduler), or move the snapshot to a module-level cached value updated on `transportStore.subscribe`.

### 19d. Function-signature violations (positional args) (was duplicate #17)

**Problem:** AGENTS.md mandates "Functions with more than one parameter take a single object param". `MidiRack.processBlock` (4 positional), `processYeastMidi` (4 positional), `processRealtimeMidiInput` (7 positional), `MidiRack.reorder`, `setProcessorParam`, etc.

**Representative files:**

- `src/modules/Yeast/useCases/MidiRack.ts:51,159,166`
- `src/modules/Yeast/useCases/yeastSchedulingBridge/processRealtimeMidiInput.ts:6,41`
- `src/modules/Yeast/useCases/setYeastProcessorParam.ts:3`
- `src/modules/Yeast/models/MidiProcessor.ts:15` (`processMidi` interface)

**Needed:** Refactor each to take `<FunctionName>Input` object types defined immediately above. The MidiProcessor interface is the load-bearing contract; it propagates to all 15 processors.

### 19e. `inferType` fallback masks bugs (was duplicate #18)

**Problem:** `yeastStore.ts:147-173` does substring matching on processor names and falls back to `'arpeggiator'` if nothing matches. The type map should be authoritative; this fallback is dead code that disguises bugs (a registration failure produces an arpeggiator ID for, say, a Mutation processor).

**Representative files:**

- `src/modules/Yeast/stores/yeastStore.ts:140-173`

**Needed:** Delete `inferType`. If `processorTypeMap.get(node.id)` returns undefined, that's a contract violation — log and skip the entry.

### 19a. **The vast majority of Yeast specs are placeholder no-ops**

**Verified 2026-04-28.** Severity: critical. Every 11-line spec file confirmed by `wc -l` and visual inspection. Pattern is identical:

```ts
import { describe, it, expect } from 'vitest';
import * as subject from '../FileName';

describe('FileName', () => {
    it('should export FileName', () => {
        expect(subject.FileName).toBeDefined();
        const time = typeof subject.FileName;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
```

This proves only that `import * as subject from '../FileName'` succeeds and that `subject.FileName` is truthy. Note the AGENTS.md violation: **`import * as subject` is a namespace import**, which AGENTS.md "Imports" forbids. Every placeholder also inherits this violation.

Confirmed placeholder-only specs at 11 lines each (20 total):

- `/Users/josecosta/dev/webdaw/src/modules/Yeast/useCases/__tests__/MidiRack.spec.ts`
- `/Users/josecosta/dev/webdaw/src/modules/Yeast/useCases/__tests__/addYeastProcessor.spec.ts`
- `/Users/josecosta/dev/webdaw/src/modules/Yeast/useCases/__tests__/removeYeastProcessor.spec.ts`
- `/Users/josecosta/dev/webdaw/src/modules/Yeast/useCases/__tests__/reorderYeastProcessor.spec.ts`
- `/Users/josecosta/dev/webdaw/src/modules/Yeast/useCases/__tests__/setYeastProcessorBypass.spec.ts`
- `/Users/josecosta/dev/webdaw/src/modules/Yeast/useCases/__tests__/setYeastProcessorParam.spec.ts`
- `/Users/josecosta/dev/webdaw/src/modules/Yeast/useCases/__tests__/processorFactory.spec.ts`
- `/Users/josecosta/dev/webdaw/src/modules/Yeast/useCases/yeastSchedulingBridge/__tests__/yeastPanic.spec.ts`
- `/Users/josecosta/dev/webdaw/src/modules/Yeast/useCases/processors/__tests__/CCGenerator.spec.ts`
- `/Users/josecosta/dev/webdaw/src/modules/Yeast/useCases/processors/__tests__/ChordMemory.spec.ts`
- `/Users/josecosta/dev/webdaw/src/modules/Yeast/useCases/processors/__tests__/EuclideanGenerator.spec.ts`
- `/Users/josecosta/dev/webdaw/src/modules/Yeast/useCases/processors/__tests__/GrooveModule.spec.ts`
- `/Users/josecosta/dev/webdaw/src/modules/Yeast/useCases/processors/__tests__/Harmonizer.spec.ts`
- `/Users/josecosta/dev/webdaw/src/modules/Yeast/useCases/processors/__tests__/MarkovChain.spec.ts`
- `/Users/josecosta/dev/webdaw/src/modules/Yeast/useCases/processors/__tests__/MutationEngine.spec.ts`
- `/Users/josecosta/dev/webdaw/src/modules/Yeast/useCases/processors/__tests__/NoteFilter.spec.ts`
- `/Users/josecosta/dev/webdaw/src/modules/Yeast/useCases/processors/__tests__/NoteRepeater.spec.ts`
- `/Users/josecosta/dev/webdaw/src/modules/Yeast/useCases/processors/__tests__/ScaleQuantizer.spec.ts`
- `/Users/josecosta/dev/webdaw/src/modules/Yeast/useCases/processors/__tests__/VelocityProcessor.spec.ts`

One slightly-larger placeholder (16 lines) but same pattern, just two exports asserted:

- `/Users/josecosta/dev/webdaw/src/modules/Yeast/useCases/yeastSchedulingBridge/__tests__/processRealtimeMidiInput.spec.ts` (16 lines, asserts `processRealtimeMidiInput` *and* `processYeastMidi` exist)

That makes **21 placeholder specs**, not 20. The behavioural specs that exist (lines counts):

- `Arpeggiator.spec.ts` (85) — uses *invalid* `TransportInfo` shape, see #20
- `ChordGenerator.spec.ts` (68) — uses *invalid* `TransportInfo` shape
- `Humanizer.spec.ts` (56) — uses *invalid* `TransportInfo` shape
- `Transposer.spec.ts` (62) — uses *invalid* `TransportInfo` shape
- `setYeastUiLevel.spec.ts` (21) — actually behavioural, asserts store mutation
- `yeastSchedulingBridge.spec.ts` (65) — actually behavioural, has one test for "no processors → passthrough"

Plus three presentation specs (`KeyboardSplit.spec.tsx`, `ProcessorParams.spec.tsx`, `StepPatternEditor.spec.tsx`, `YeastPanel.spec.tsx`) — not yet examined for quality.

**Severity rationale:** Critical. The audit suite is theatrical for 21 of 28 source spec files. CI green is meaningless. Every audio-thread allocation, every off-by-one, every transport-seek bug, every Note Off mismatch — none are protected by tests. This is the single largest risk in the module.

**Needed:** Replace each placeholder with at least one behavioural assertion per public method. Per AGENTS.md "TypeScript — soundness": "Tests: Do not stop at 'defined' / 'truthy' / generic `toBeTypeOf('object')` — assert the actual contract." Replace `import * as subject` with named imports. Sequence:

1. Build a `makeTransportInfo(overrides?)` test helper in `models/__tests__/_helpers.ts` returning `satisfies TransportInfo` (fixes #20 simultaneously).
2. For each processor, replace the placeholder with: input → output canonical fixture, edge cases (empty input, no transport.isPlaying, etc.).
3. For `MidiRack`, assert ping-pong correctness, processor ordering, `allNotesOff` flush, and reentrance throw (after #10 fix).
4. For each write use case, assert rack mutation lands AND store is synced (this would catch new issues #61, #62 below).

### 19b. `MidiRack.spec.ts` is a no-op

**Problem:** `MidiRack.spec.ts:5-11` is the entire file. It checks `MidiRack` is defined and that its type is `'function'` or `'object'`. The class has 8 public methods; **none are tested**. `processBlock`, `addProcessor`, `removeProcessor`, `reorder`, `allNotesOff`, `setProcessorParam`, `setProcessorBypass`, `getProcessorIds`, `getProcessorNames` — zero behavioural coverage. The most load-bearing audio-thread file in the module has no tests.

**Representative files:**

- `src/modules/Yeast/useCases/__tests__/MidiRack.spec.ts:1-11`
- `src/modules/Yeast/useCases/MidiRack.ts` (8 public methods untested)

**Needed:** Replace the placeholder with proper coverage: ping-pong scratch buffer correctness, scheduled events draining within the block window, `separateOutput` future-event partition, `allNotesOff` flush behaviour with a chain of stateful processors, reorder semantics, and `processBlock` called twice in a row not corrupting state. Add a fixture-builder for `TransportInfo`.

### 20. All four "real" processor specs use an invalid `TransportInfo` shape

**Verified 2026-04-28.** Severity: high. Original audit flagged Arpeggiator only; I verified the same wrong shape across **all four** behavioural specs:

```ts
transport = {
    isPlaying: true,
    ppqPosition: 0,
    bpm: 120,
    sampleRate: 44100,
    timeSignature: { numerator: 4, denominator: 4 },  // <-- wrong; not in TransportInfo
};
```

The actual `TransportInfo` type (`MidiEvent.ts:21-34`) requires `timeSigNum`, `timeSigDen`, `barIndex`, `beatInBar`, `loopEnabled`, `loopStartPpq`, `loopEndPpq`. None of these are set. The test compiles because the `transport` variable is typed `TransportInfo` and TypeScript structural typing does not error on **missing** required properties when the *initialiser* lacks them — actually, it does, *unless* there's a type assertion or implicit any. Running `pnpm typecheck` should flag this. (If it doesn't, that's a separate bug — see also issue #66 below: tsconfig may have skipLibCheck or noImplicitAny disabled.)

Confirmed test files using the broken shape:

- `/Users/josecosta/dev/webdaw/src/modules/Yeast/useCases/processors/__tests__/Arpeggiator.spec.ts:12-18`
- `/Users/josecosta/dev/webdaw/src/modules/Yeast/useCases/processors/__tests__/Humanizer.spec.ts:12-18`
- `/Users/josecosta/dev/webdaw/src/modules/Yeast/useCases/processors/__tests__/Transposer.spec.ts:12-18`
- `/Users/josecosta/dev/webdaw/src/modules/Yeast/useCases/processors/__tests__/ChordGenerator.spec.ts:12-18`

Additionally, `Arpeggiator.spec.ts:32,41` mutates `transport.ppqPosition` between calls. Production code does not advance time via PPQ — it uses `input[i].timeSamples`. The test "passes" because the arp's `lastStepTimeSamples = -Infinity → first input` and `processMidi` uses `input[0].timeSamples` for `blockEnd`. Since `input2 = []` at line 33 and `input2 = []` at line 42, `now = 0` and `blockEnd = 128`. The arp emits steps that fit inside `[0, 128)` only — and the step is `0.5 * 22050 ≈ 11025 samples`, which does not fit. So the assertion at `:37` `expect(noteOns.length).toBeGreaterThanOrEqual(1)` is suspicious; it likely passes only because the input note at line 23-24 has `timeSamples: 0` and Arpeggiator passes the input through untouched at `:73-78` (wait, it doesn't — it consumes Note Ons and updates held). The first call at line 29 doesn't emit any Note On (input is consumed for `held`), so the second call at line 34 needs to emit. With `now = 0, blockEnd = 128`, no step fires. **The test should fail.** It "passes" only because the test counts both `output` arrays cumulatively (the same `output` is reused across calls — line 26-29) and `noteOns.length >= 1` is satisfied by the **input** being included in `output`... wait, the input is not pushed to output for Note Ons (`Arpeggiator.ts:73-74` falls through `addHeldNote`, no `output.push`). So either: (a) the test is silently broken and should fail; (b) something about ppqPosition mutation is being read by the arp at `:112` which compute `blockEnd = transport.ppqPosition * samplesPerBeat(transport) + 128 = 0.6 * 22050 + 128 ≈ 13358`. With `lastStepTime = -Infinity` initially, the first call seeded it to `input[0].timeSamples = 0`. The second call has `lastStepTime = 0`, `stepLen ≈ 11025`, `blockEnd = 13358`, so `0 + 11025 ≤ 13358` is true — one step emits at `stepTime = 11025`. That's where the test is implicitly relying on the wrong PPQ semantics. So the test is testing a fictional contract that production never fulfils.

**Severity rationale:** High because the four "real" specs that exist are testing scenarios that bear no relationship to the real audio scheduler. They give false confidence.

**Needed:** Build a `makeTransportInfo(overrides?)` test helper in `models/__tests__/_helpers.ts` that returns a fully-typed `TransportInfo` via `satisfies TransportInfo`. Update each of the four spec files to: (a) use the correct shape; (b) drive time via input event `timeSamples`, not mutated `ppqPosition`. Re-evaluate every assertion: after fixing the shape, do they still pass? If the production model is `processBlock(input, blockStart, blockEnd, transport)`, the spec should call that contract through `MidiRack.processBlock` rather than calling `processMidi` directly.

### 20b. `useCases/index.ts` does not include write use cases (was duplicate #20)

**Problem:** `useCases/index.ts:1-2` only re-exports `processYeastMidi`, `processRealtimeMidiInput`, `yeastPanic`. The write use cases (`addYeastProcessor`, etc.) are not re-exported. Cross-module callers (e.g. presentation views in this module — relative imports — fine) are uniform; the missing root barrel (#1) compounds the problem.

**Representative files:**

- `src/modules/Yeast/useCases/index.ts:1-2`

**Needed:** Once the root barrel (#1) lands, decide which write use cases are cross-module surface. The presentation views inside this module use relative imports already — that's correct. Audit the AppAction/Command surface to see whether handlers should wrap these use cases per AGENTS.md "Command handlers" rule.

### 21. `NoteRepeater` 8192-sample lookahead bypasses block boundaries

**Problem:** `NoteRepeater.ts:62-67`: `blockEnd = now + 8192`. The processor emits Note Ons up to ~186 ms in the future as if they were due now; downstream `MidiRack.processBlock` re-routes them to the scheduled queue (`MidiRack.ts:107-113`), making the bug invisible — but the contract is broken.

**Representative files:**

- `src/modules/Yeast/useCases/processors/NoteRepeater.ts:60-67`

**Needed:** Use the real `blockEnd` (per #3). Remove the magic 8192.

### 22. `processYeastMidi` uses `loopStart < loopEnd` as `loopEnabled`

**Problem:** `processRealtimeMidiInput.ts:33`: `loopEnabled: transport.loopStart < transport.loopEnd`. There is no `loopEnabled` field in the source store; this is inferred by comparing two values. If a user disables loop without zeroing the loop range (which is the normal UX), the rack will believe the loop is enabled and behave accordingly. Cross-reference: `transportStore.value` shape.

**Representative files:**

- `src/modules/Yeast/useCases/yeastSchedulingBridge/processRealtimeMidiInput.ts:33`
- `src/modules/Transport/stores/index.ts` (transportStore shape)

**Needed:** Source `loopEnabled` from the actual transport state, or document the convention (loopStart === loopEnd === loop disabled).

### 23. `Humanizer` can emit pre-block events

**Problem:** `Humanizer.ts:37,45`: negative timing offsets (rushed preset = -5 ms) push Note On time _earlier_. If the input event was at `blockStart`, the output lands before `blockStart`. `MidiRack.processBlock` (separator at `:107-113`) does not handle `event.timeSamples < blockStartSamples` — those events lurk in `current` and flow downstream.

**Representative files:**

- `src/modules/Yeast/useCases/processors/Humanizer.ts:37-52`
- `src/modules/Yeast/useCases/MidiRack.ts:107-113`

**Needed:** Clamp output `timeSamples` to `blockStartSamples` (post-humanise), or define and enforce that processors must emit events within `[blockStart, blockEnd + N)` for some bounded N. The rack's separator should reject events with `timeSamples < blockStart` (drop or warn).

### 24. `ChordMemory.learning` commits on first Note Off

**Problem:** `ChordMemory.ts:67-75`: stops learning on the first Note Off, capturing only notes pressed before any release. UX expectation is that the user holds the chord and releases all keys to commit.

**Representative files:**

- `src/modules/Yeast/useCases/processors/ChordMemory.ts:64-77`

**Needed:** Track held-down keys; commit when the held-set transitions from non-empty to empty. Add a "commit" param if explicit gesture is preferred.

### 25. `Harmonizer.timeOffsetSamples` is dead

**Problem:** `Harmonizer.ts:31-35,114-168`: `voices[].timeOffsetSamples` is declared but no `setParam` case exposes it. The data path uses it (`:68`) but it's always 0.

**Representative files:**

- `src/modules/Yeast/useCases/processors/Harmonizer.ts:31-35,114-168`

**Needed:** Either expose via `setParam` (e.g. `voiceN_time_offset_ms`) or remove the field.

### 26. `ChordMemory` recall is broken — keyed by exact MIDI note, not pitch class

**Verified 2026-04-28.** Severity: high (correctness). The original audit framed this as "inverted octave when stored chord has notes below root". The real bug is worse:

`ChordMemory.ts:68-72` stores: `this.memory.set(this.learnRoot, { root, notes })`. The map key is the **absolute MIDI note number**.

`ChordMemory.ts:44` recalls: `this.memory.get(event.kind.note)`. Lookup is by absolute MIDI note.

This means a chord stored on C4 (`learnRoot = 60`) is **only recallable when the user plays MIDI note 60 again**. If the user plays C5 (note 72), `memory.get(72)` returns undefined → falls into the `else` branch at `:60-62` → input note passes through.

`transposeMode` is therefore **unreachable in practice**: the `transpose` math at `:48` (`event.kind.note - stored.root`) only ever runs when `event.kind.note === stored.root` (because that's the only way `memory.get` returns non-null). Result: `transpose === 0` always. The configurable `transposeMode` parameter does nothing.

**Repro:**

1. Add ChordMemory; click Learn.
2. Play C4 + E4 + G4 (a C-major triad).
3. Click Learn again to commit.
4. Play C5 — expected: C5+E5+G5 transposed up an octave. Actual: just C5 (passthrough).
5. Play C4 — expected: chord recalled. Actual: chord recalled at C4 with `transpose = 0`.

The product description (`ChordMemory.ts:1-6`: "Cthulhu-style one-finger chord recall") promises pitch-class semantics. The implementation does not deliver them.

**Combined with issue #24:** ChordMemory is broken in both directions — the learn flow commits prematurely (first Note Off), and the recall flow only matches the exact note, not the pitch class.

**Severity rationale:** High because the entire feature is non-functional. The UI in `ProcessorParams.tsx:237-263` exposes `learn`, `transpose_mode`, and `clear` controls — all of which are wired but only `clear` actually does anything useful.

**Representative files:**

- `src/modules/Yeast/useCases/processors/ChordMemory.ts:19,44-46,68-72`
- `src/modules/Yeast/presentations/components/ProcessorParams.tsx:237-263`

**Needed:** Switch storage from absolute note to pitch class: key `memory` by `note % 12`, and store the chord as relative intervals from the trigger note. Recall: lookup `memory.get(triggerNote % 12)` and re-emit at `triggerNote + interval[i]`. This is the standard Cthulhu / Scaler / Chordio contract. Add behavioural tests that store on C4, recall on C5 and D4, and assert correct transposition.

### 27. `EuclideanGenerator.bjorklund` has dead complexity

**Problem:** `EuclideanGenerator.ts:25-43`: builds `pattern: boolean[][]`, `level`, `counts`, `remainders` — none of which are used; the actual pattern is computed via Toussaint at `:46-52`. Allocates and computes for nothing.

**Representative files:**

- `src/modules/Yeast/useCases/processors/EuclideanGenerator.ts:25-43`

**Needed:** Delete the unused build steps.

### 28. `MarkovChain.fillDefaultMatrix` discards user-set transitions on chord change

**Problem:** `MarkovChain.ts:131-134`: rebuilding the default matrix overwrites any custom transitions set via `setTransition`. UX-wise the user's matrix is lost when they play a different chord.

**Representative files:**

- `src/modules/Yeast/useCases/processors/MarkovChain.ts:120-150,210-225`

**Needed:** Either preserve user-set entries when resizing, or document that chord changes reset the matrix to default.

### 29. Type leakage from `stores/`

**Problem:** `stores/index.ts:2` re-exports `YeastState`. `YeastState` indirectly exposes `YeastProcessorInfo` (which exposes `ProcessorType`). `ProcessorType` lives in `useCases/processorFactory.ts`. The cross-module import path leaks into a "models-private" zone (per AGENTS.md "Use-case types stay private", and "Models are strictly private").

**Representative files:**

- `src/modules/Yeast/stores/yeastStore.ts:21,23-33`
- `src/modules/Yeast/stores/index.ts:1-2`
- `src/modules/Yeast/useCases/processorFactory.ts:23-38`

**Needed:** Decide. The store contract requires `YeastState` to be visible to subscribers. Either (a) keep `YeastState` cross-module but redefine `YeastProcessorInfo.type` as `string` for cross-module purposes (lossy but compliant), or (b) declare `ProcessorType` a public contract type and document it as such (move to `models/` or accept the leakage with explicit documentation). The current state is undocumented leakage.

### 30. Dead `latencySamples()` reporting

**Problem:** `MidiProcessor.ts:30` declares `latencySamples()`, `BaseMidiProcessor.ts:33-35` returns 0, and **no processor** overrides it. `MidiRack` does not aggregate latency. The recent commit `2731a952a fix(AudioEngine): integrate PDC latency from WASM worklets via SAB` suggests latency reporting matters elsewhere; here it's stubbed and ignored.

**Representative files:**

- `src/modules/Yeast/models/MidiProcessor.ts:30`
- `src/modules/Yeast/models/BaseMidiProcessor.ts:33-35`

**Needed:** Either delete `latencySamples` from the interface or implement it for the processors that introduce intentional delay (`Humanizer` with positive `timingMeanMs`, `ChordGenerator` with non-zero `strumMs`, `NoteRepeater`, etc.) and aggregate in `MidiRack` for PDC.

---

## New issues (added 2026-04-28 during adversarial re-review)

### 53. `reorderYeastProcessor` does not mirror to the worklet — the worklet rack permanently desynchronises on reorder

**Verified 2026-04-28.** Severity: high.

`src/modules/Yeast/useCases/reorderYeastProcessor.ts` (full file, 8 lines):

```ts
import { getYeastRack, syncStoreFromRack } from '../stores/yeastStore';

export function reorderYeastProcessor(fromIdx: number, toIdx: number): void {
    const rack = getYeastRack();
    rack.reorder(fromIdx, toIdx);
    syncStoreFromRack();
}
```

Compare with `addYeastProcessor.ts:11`, `removeYeastProcessor.ts:7`, `setYeastProcessorParam.ts:6`, `setYeastProcessorBypass.ts:6` — all of which call `getWorkletNodeSync()?.…` to mirror the change. `reorderYeastProcessor` does not. Worse, `YeastWorkletNode` does not even expose a `reorder` method (`engine/YeastWorkletNode.ts:28-42` exports only `processBlock`, `addProcessor`, `removeProcessor`, `setParam`, `setBypass`, `allNotesOff`, `destroy`).

**Blast radius:** When the user reorders a processor in `Level3Build` / `Level4Route` / `Level5Lab`, the main-thread rack (used by the realtime bridge) reflects the new order; the worklet rack (used by `scheduleMidiNotes.ts`) keeps the old order forever. Output during clip playback is processed in the wrong order, producing different MIDI than the live-input path.

**Repro:**

1. Add Arpeggiator, then Humanizer to a track's Yeast rack.
2. Play a clip — both the live input and the offline scheduler produce identical MIDI (good).
3. Reorder so Humanizer is first.
4. Play the same clip — live input shows new order, offline scheduler shows old order. Humanizer's timing offset is now applied **before** the arp instead of after, producing audibly different results between the two paths.

**Severity rationale:** High because reorder is a primary user gesture and silently produces inconsistent behaviour. Combined with issue #6, this is a sharp footgun.

**Representative files:**

- `src/modules/Yeast/useCases/reorderYeastProcessor.ts:1-8` (no worklet mirror)
- `src/modules/Yeast/engine/YeastWorkletNode.ts:28-42` (no `reorder` exposed)
- `src/modules/Yeast/services/yeastWorkletProcessor.ts:23-71` (no `reorder` message handler)

**Needed:** Add `reorder` to `YeastWorkletNodeResult`, the worklet message protocol, and the worklet processor's switch. Call `getWorkletNodeSync()?.reorder(fromIdx, toIdx)` from `reorderYeastProcessor`. Add a behavioural test asserting both rack instances produce identical output after reorder.

### 54. `setYeastProcessorParam` does not call `syncStoreFromRack` — the reactive store does not see param updates

**Verified 2026-04-28.** Severity: high (UX feedback loop).

`src/modules/Yeast/useCases/setYeastProcessorParam.ts` (full file, 7 lines):

```ts
import { getYeastRack, getWorkletNodeSync } from '../stores/yeastStore';

export function setYeastProcessorParam(id: string, name: string, value: number): void {
    const rack = getYeastRack();
    rack.setProcessorParam(id, name, value);
    getWorkletNodeSync()?.setParam(id, name, value);
}
```

Compare with siblings: `addYeastProcessor`, `removeYeastProcessor`, `reorderYeastProcessor`, `setYeastProcessorBypass` all call `syncStoreFromRack()` at the end. `setYeastProcessorParam` does not.

**Why it matters:** Even after issue #15 is addressed (presentation reads from store), the store is **never updated** when params change. The current `YeastState` shape (`yeastStore.ts:23-33`) doesn't carry params at all — but if the spec adds `params: Record<string, number>` to `YeastProcessorInfo` (as #15 requires), the writes will land in the rack but never propagate back to the React state. The UI will still be stuck.

**Severity rationale:** High because it's the missing half of #15. Without it, every fix to the param-display problem is incomplete.

**Representative files:**

- `src/modules/Yeast/useCases/setYeastProcessorParam.ts:6` (missing `syncStoreFromRack()`)
- `src/modules/Yeast/stores/yeastStore.ts:128-145` (`syncStoreFromRack` does not yet snapshot params; needs extending)

**Needed:** Add `syncStoreFromRack()` call to `setYeastProcessorParam`. Extend `YeastProcessorInfo` to carry `params: Record<string, number>` and `syncStoreFromRack` to populate it from each processor's `getParams()` (which doesn't exist yet — see #15). Also consider that high-frequency `setParam` calls (knob drag) will spam the store; throttle or coalesce.

### 55. 21 spec files use `import * as subject` (namespace imports) — direct AGENTS.md violation

**Verified 2026-04-28.** Severity: medium (architectural compliance).

AGENTS.md "Imports" rule: "Never use namespace imports (`import * as X from '...'`). Always import named exports individually." Every placeholder spec uses `import * as subject from '../FileName'` — by design of the placeholder template that was clearly auto-generated.

`grep -rn "import \* as" src/modules/Yeast/` returns 21 hits, exactly matching the placeholder list in #19a. The pattern is exclusive to the placeholders; no production code uses namespace imports.

**Severity rationale:** Medium because the violation is contained to test files that need replacing anyway (#19a). However, fixing each placeholder must also remove the namespace import — the two cleanups are coupled.

**Representative files:** All 21 spec files listed in #19a.

**Needed:** Replace `import * as subject from '../FileName'` with `import { Thing } from '../FileName'` (named imports) when rewriting each placeholder per #19a.

### 56. The placeholders look codemod-generated; "renderIife_NN" is the smoking gun across the codebase

**Verified 2026-04-28.** Severity: low (code quality / process violation).

`grep -rn 'renderIife' src/` returns **82 hits across the codebase**. Inside Yeast: 5 in `StepPatternEditor.tsx`, 5 in `KeyboardSplit.tsx`, 0 elsewhere in Yeast. The numbering pattern (`renderIife_18`, `_19`, `_20`, `_21`, `_22`) is sequential across the entire codebase — not just within a file — strongly suggesting an automated codemod ran across the project, generating IIFE-extracted JSX expressions with global counters. Same finding in the Workspace audit.

CLAUDE.md "No automated code mutations" forbids exactly this. The 11-line placeholder specs (#19a) follow an identical generation pattern (same `import * as subject`, same `expect(typeof X === 'function' || === 'object')` boilerplate) — these are also codemod artefacts.

**Blast radius:** Cannot be fixed by a single PR — the pattern is across `Workspace`, `Yeast`, and likely other modules. Needs a coordinated cleanup.

**Severity rationale:** Low because the artefacts are not behavioural bugs, but the underlying process violation (someone ran a codemod) is a CLAUDE.md hard rule.

**Representative files:**

- Yeast: `StepPatternEditor.tsx:53,65`, `KeyboardSplit.tsx:81,90,121` (5 hits — numbered `_18` to `_22`)
- Workspace: `NotificationToast.tsx:20`, `AutomationBottomPanel.tsx:221`, `StatusBar.tsx:75`, `PromptBar.tsx:151,170,181`, `InspectorPanel.tsx:40`, `SessionView.tsx:60,110,119,121` (and more)
- (no spec files for the IIFEs themselves)

**Needed:** Replace each `const renderIife_NN = () => { … }` with extracted typed helper functions named for what they return (e.g. `getStepBackgroundClass(step)`, `getKeyColour(held, sounding)`). Move them outside the component body where reasonable. Identify the codemod that produced them and surface a process finding to the team.

### 57. `inferType` (in `yeastStore.syncStoreFromRack`) ships substring-match heuristics that produce wrong-type processors silently

**Verified 2026-04-28.** Severity: medium (already noted in original audit's #18 / #19e). Adding repro depth here.

`yeastStore.ts:147-173` contains an 8-branch `if/else` chain on `name.includes('Arp')`, `name.includes('Chord')`, etc. The branches are ordered such that:

- `'Note Filter'` matches `name.includes('Filter')` → `'filter'` (correct)
- `'Note Repeater'` matches `name.includes('Repeat')` → `'repeater'` (correct)
- `'Chord Memory'` matches `name.includes('Chord')` → `'chord'` (**WRONG** — should be `'chordMemory'`)
- `'Scale Quantizer'` matches `name.includes('Scale')` → `'scale'` (correct)
- `'Velocity'` matches `name.includes('Veloc')` → `'velocity'` (correct)
- `'Humanizer'` matches `name.includes('Human')` → `'humanizer'` (correct)
- `'Transposer'` matches `name.includes('Trans')` → `'transposer'` (correct)
- `'Markov'`, `'Mutation'`, `'Euclidean'`, `'Groove'`, `'CC Generator'`, `'Harmonizer'` do not match any branch → fall through to `'arpeggiator'` (**WRONG**)

So a user's MarkovChain processor, on store re-sync via the inference path, becomes an Arpeggiator in the UI — wrong panel, wrong knob set. This branch only runs when `processorTypeMap.get(node.id)` returns undefined (`yeastStore.ts:140`); under normal flow `addYeastProcessor.ts:9` registers the type before `syncStoreFromRack` runs, so this is dead code. But it's a sharp footgun for HMR survival: `createHmrPersistentState` (`yeastStore.ts:49`) preserves `rackInstance` across hot reload, but `processorTypeMap` is **not** preserved (it's part of the same session container, but in practice the dev-time HMR may rebuild `processorTypeMap` empty while the rack still has processors).

**Severity rationale:** Medium because it's only reachable in HMR or ill-defined edge cases, but when reachable it silently misclassifies.

**Representative files:** `src/modules/Yeast/stores/yeastStore.ts:140-173`.

**Needed:** Delete `inferType`. Replace with: if the rack has processors that aren't in `processorTypeMap`, that's a bug — log it and skip the entry. Or persist `processorTypeMap` in HMR alongside `rackInstance`.

### 58. `CCGenerator.setParam` throws on unknown param; other processors silently ignore — inconsistent contract

**Verified 2026-04-28.** Severity: medium (consistency).

`grep "throw new Error" src/modules/Yeast/useCases/processors/*.ts`:

- `CCGenerator.ts:38` throws on unknown LFO shape (in `evalShape`, runs in audio thread!)
- `CCGenerator.ts:140` throws on unknown param name (in `setParam`)
- `ScaleQuantizer.ts:118` throws on unknown remap mode (in `quantizeToScale`, audio-thread hot path!)

All 12 other processor `setParam` switch statements silently ignore unknown names. `CCGenerator` is the outlier.

**Why it matters:**

1. **Inconsistent contract** — caller doesn't know whether to expect a thrown error or silent no-op.
2. **Audio-thread `throw`** — `CCGenerator.evalShape` and `ScaleQuantizer.quantizeToScale` run inside `processMidi`. A thrown error mid-block silently kills the rest of the chain. `MidiRack.processBlock` (`MidiRack.ts:73-82`) does not wrap each `processor.processMidi` in a try/catch — so a thrown shape error aborts every subsequent processor, leaving the scratch buffers in inconsistent state and producing zero output. Per CLAUDE.md "no allocation, no mutex locks, no blocking" — a `throw` in audio code is acceptable per-se (it's not a `new` allocation in normal flow), but only because this code path is unreachable under normal `setParam` constraints. Still — the semantics differ from siblings, and a future refactor that exposes a shape-name input could trip the throw.
3. **`ScaleQuantizer.remapMode`** is set via `setParam('remap_mode', value)` at `:148-150`, which uses a typed array `(['nearest', 'up', 'down'] as const)[Math.round(value)] ?? 'nearest'`. The fallback always returns a valid mode, so the throw at `:118` is unreachable. Dead branch in audio-thread code.

**Severity rationale:** Medium. The throws are reachable under contract violations but invisible during normal use. The inconsistency is real.

**Representative files:**

- `src/modules/Yeast/useCases/processors/CCGenerator.ts:37-39, 139-141`
- `src/modules/Yeast/useCases/processors/ScaleQuantizer.ts:117-119`

**Needed:** Pick one contract: either (a) all `setParam` throw on unknown name (preferred for catching bugs early), or (b) all silently ignore. Document. Remove unreachable throws. For audio-thread code, prefer `console.warn` or a finding-event over `throw`.

### 59. Scheduling discontinuity: `scheduleMidiNotes` builds its own `yeastTransport` payload; bridge builds another; they don't agree

**Verified 2026-04-28.** Severity: high. Cross-module finding.

`src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts:248-251` calls `workletNode.processBlock(midiEvents, blockStartSamples, blockEndSamples, yeastTransport)`. The `yeastTransport` value is constructed elsewhere in `scheduleMidiNotes` (out of scope, but inspectable) and passed in.

`src/modules/Yeast/useCases/yeastSchedulingBridge/processRealtimeMidiInput.ts:24-36` constructs its own `TransportInfo` with `ppqPosition: 0, barIndex: 0, beatInBar: 0` (all zero — see #4) and `loopEnabled: transport.loopStart < transport.loopEnd` (the broken inference per #22).

So the same processor instance receives two different `TransportInfo` shapes depending on which path drove it. Step generators (`Arpeggiator.ts:112` reads `transport.ppqPosition`; `Arpeggiator.ts:286-289` reads `barIndex`) produce different output between the two paths even on identical input. **The user's clip-playback experience and live-input experience genuinely differ**.

**Severity rationale:** High — it's the same correctness class as #6, manifesting as a transport-metadata divergence rather than a mutation-mirror divergence.

**Representative files:**

- `src/modules/Yeast/useCases/yeastSchedulingBridge/processRealtimeMidiInput.ts:24-36`
- `src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts:248-251`

**Needed:** Define a single `buildYeastTransportInfo(input: …): TransportInfo` helper that both paths use. It should derive every field from the same source of truth. Or eliminate the bridge's snapshot and require the caller to pass a fully-formed `TransportInfo`.

### 60. `yeastWorkletProcessor.ts` references `currentFrame` in `allNotesOff` despite the worklet not being in the audio graph

**Verified 2026-04-28.** Severity: medium. Confirmed in original audit's #9 but let's deepen.

`yeastWorkletProcessor.ts:58`: `this._rack.allNotesOff(data.nowSamples ?? currentFrame)`.

`currentFrame` is the AudioWorkletGlobalScope's frame counter, only reliable when the processor is being driven by the audio graph. The node is constructed with `numberOfInputs: 0, numberOfOutputs: 0` (`YeastWorkletNode.ts:48-49`) and is never connected to anything. The worklet's `process()` method returns `true` (`yeastWorkletProcessor.ts:74-77`), which keeps it alive — but in Chrome, an unconnected node with `numberOfOutputs: 0` is treated specially: the engine still runs `process()` on every render quantum because `return true`, so `currentFrame` advances. In Safari and Firefox, behaviour is reportedly inconsistent (per MDN; not verified in this audit).

For `allNotesOff`, the caller passes `nowSamples` from `getCurrentTime() * sampleRate`. The fallback `currentFrame` only fires when `nowSamples` is undefined. In the only call site (`YeastWorkletNode.ts:86: allNotesOff: (nowSamples) => node.port.postMessage({ type: 'allNotesOff', nowSamples })`), `nowSamples` is always defined by the caller. So the fallback is dead in practice but signals an unsafe assumption.

**Severity rationale:** Medium because the unsafe path is unreachable under current calling conventions, but a future caller that omits `nowSamples` would hit the unreliable fallback.

**Representative files:**

- `src/modules/Yeast/services/yeastWorkletProcessor.ts:57-59`
- `src/modules/Yeast/engine/YeastWorkletNode.ts:48-49, 86`

**Needed:** Make `nowSamples` required in the worklet message protocol (no `?` default). Audit cross-browser worklet behaviour for unconnected zero-output nodes — if Safari/Firefox suspend it, `processBlock` await would hang. Connect to a `GainNode(0)` → `ctx.destination` to ensure scheduling.

### 61. `EuclideanGenerator.bjorklund` allocates 4 unused intermediate arrays per pattern rebuild

**Verified 2026-04-28.** Severity: low. Original audit's #27 confirmed.

`EuclideanGenerator.ts:25-43`:

```ts
const pattern: boolean[][] = [];                         // line 25 — UNUSED
for (let index = 0; index < steps; index++) {
    pattern.push([index < hits]);                         // builds N×1 array
}

let level = 0;                                            // UNUSED
const counts: number[] = [];                              // UNUSED
const remainders: number[] = [];                          // UNUSED

remainders.push(steps - hits);
counts.push(hits);
while (remainders[remainders.length - 1]! > 1) {          // builds full Bjorklund tables
    const context = counts[level]!;
    const r = remainders[level]!;
    counts.push(Math.min(context, r));
    remainders.push(Math.max(context, r) - Math.min(context, r));
    level++;
}
```

After all this, the actual pattern is computed at `:46-52` via the entirely separate Toussaint formulation. The first 18 lines are dead code that runs anyway.

**Audio-thread cost:** `bjorklund` is called from `rebuildPattern()` which is called from `setParam('hits' | 'steps' | 'rotation', …)` (`EuclideanGenerator.ts:140-149`). That's main-thread (UI). However, in the worklet path, `setParam` *does* run inside the audio thread (`yeastWorkletProcessor.ts:51-53`). So the dead code allocates 4 arrays inside `AudioWorkletGlobalScope` per Euclidean param tweak. Per `MidiRack.ts:14-22, 56-61` the rack avoids per-event allocation in audio thread; this is per-`setParam` allocation.

**Severity rationale:** Low because `setParam` is rate-limited by user UI (knob drag), not per-block. But it's pure dead code with no behavioural value.

**Representative files:** `src/modules/Yeast/useCases/processors/EuclideanGenerator.ts:25-43`.

**Needed:** Delete lines 25-43. Keep only the Toussaint formulation at 46-52.

### 62. `processRealtimeMidiInput` passes blockSize as 4th arg, but `processYeastMidi`'s 4th arg is `sampleRate`

**Verified 2026-04-28.** Severity: high (correctness — bug).

`processRealtimeMidiInput.ts:55`: `return processYeastMidi([event], sampleTime, sampleTime + blockSize, sampleRate);`

`processYeastMidi.ts:6-11`: signature is `(events, blockStartSamples, blockEndSamples, sampleRate)`.

So `blockEndSamples = sampleTime + blockSize` and `sampleRate = sampleRate` — those are correct. But examine the call site `messageHandlers.ts:349-356`:

```ts
const processedEvents = deps.processRealtimeMidiInput(
    note,
    velocity,
    channel,
    true,
    sampleTime,
    engine.context.sampleRate    // <-- passed as 6th param
);
```

`processRealtimeMidiInput`'s signature is `(note, velocity, channel, isNoteOn, sampleTime, sampleRate, blockSize = 128)`. Six positional args: `note, velocity, channel, isNoteOn=true, sampleTime, sampleRate`. The default `blockSize = 128` is used.

OK so this part is wired correctly. But the deeper issue: the `messageHandlers.ts:349` call site only ever fires for **noteOn** (`isNoteOn = true`). I searched for callers passing `false` — only this one site. So **MIDI Note Off events from the live keyboard never traverse the Yeast rack at all**. The synth gets the raw Note Off without the Yeast chain seeing it. If the rack contains a Transposer (which maps input note → output note via `noteMap.set/get`), the Note Off never matches the original Note On's mapping; the synth gets a Note Off for the *original* note, not the *transposed* one. The transposed note plays forever (until Note On retrigger of the same note).

**Repro:**

1. Add Transposer to Yeast rack on a track. Set `semitones = +12`.
2. Press C4 on MIDI keyboard. Hear C5 (transposed).
3. Release C4. Synth receives Note Off for C4 (raw) — but it's holding C5.
4. C5 plays forever.

**Severity rationale:** High — direct correctness bug, audible to user.

**Representative files:**

- `src/modules/AudioEngine/repositories/webMidi/messageHandlers.ts:349-356` (only fires for Note On)
- `src/modules/AudioEngine/repositories/webMidi/messageHandlers.ts` (search for `processRealtimeMidiInput` — only one call site)
- `src/modules/Yeast/useCases/yeastSchedulingBridge/processRealtimeMidiInput.ts:41-56` (the bridge accepts `isNoteOn` but no caller passes `false`)

**Needed:** In `messageHandlers.ts`, also call `processRealtimeMidiInput` for Note Off (presumably in `handleNoteOff`). Audit the Note Off code path — it needs to mirror the Note On's processing through Yeast.

### 63. `YeastWorkletNode.workletRegistrations` caches a rejected Promise forever

**Verified 2026-04-28.** Severity: medium. Already in original audit's #28. Adding repro.

`YeastWorkletNode.ts:17`: `const workletRegistrations = new WeakMap<BaseAudioContext, Promise<void>>();`

`:19-26`:

```ts
async function ensureWorkletRegistered(ctx: BaseAudioContext): Promise<void> {
    let param = workletRegistrations.get(ctx);
    if (!param) {
        param = ctx.audioWorklet.addModule(yeastWorkletProcessorUrl);
        workletRegistrations.set(ctx, param);
    }
    return param;
}
```

If `addModule` rejects (network blip, syntax error in the worker file, AbortSignal, browser quirk), the rejected `Promise<void>` is cached. Every subsequent call returns the same rejected promise — no retry. The `getYeastWorkletNodeAsync` at `yeastStore.ts:74-89` catches the rejection and clears `_workletNodePromise`, so retries through `getYeastWorkletNodeAsync` create new attempts — but each attempt hits the same cached rejection at `ensureWorkletRegistered`, so they all fail.

**Repro:** Mock `audioWorklet.addModule` to reject once on first call. Call `getYeastWorkletNodeAsync` twice. Both fail with the same error.

**Severity rationale:** Medium because most production deploys won't see addModule rejection, but if it ever happens (e.g. CSP misconfiguration, network failure during dev), the worklet path is permanently broken until full page reload.

**Representative files:**

- `src/modules/Yeast/engine/YeastWorkletNode.ts:17, 19-26`

**Needed:** Wrap the cache logic to delete on rejection: `param.catch(() => workletRegistrations.delete(ctx))` after the `set`. Or detect rejection and clear before retry.

### 64. `MarkovChain.held.indexOf` performs reference-equality scan on a number array — fine in practice but the worry is the audit's miscount

**Verified 2026-04-28.** Severity: low (correctness OK, but documentation / audit accuracy issue).

Original audit's #43 said: "`held.indexOf` is a linear scan plus a string-equality check". `held` is `private held: number[]` (`MarkovChain.ts:38`), so `indexOf` does numeric `===` comparison, not string equality. The original audit's claim is wrong on the string-equality part. The linear scan is correct. The allocation claim ("sort allocates internal scratch") is also disputed: `Array.prototype.sort` in V8 sorts in place and may use temporary internal scratch only for >10 elements (TimSort). For typical held-note arrays of ≤ 10, no allocation.

So #43's severity is overstated. Repositioning here.

**Severity rationale:** Low — performance is fine in practice; the audit's original claim was inaccurate.

**Representative files:** `src/modules/Yeast/useCases/processors/MarkovChain.ts:124-126`.

**Needed:** No code change. Update the audit's #43 to remove the inaccurate claim.

### 65. `Arpeggiator.ts:308` allocates `[...this.held]` in audio thread on every Note On under latch

**Verified 2026-04-28.** Severity: low (already self-documented).

`Arpeggiator.ts:305-309`:

```ts
if (this.latchEnabled) {
    // Audio-thread note: shallow copy of small held-notes array (typically <12 items).
    // Low-impact allocation — pre-allocated ring buffer not warranted for this size.
    this.latched = [...this.held];
}
```

The comment acknowledges the allocation. Per CLAUDE.md "audio-thread code: no allocation", this is a self-documented violation. The comment justifies it as "low-impact" but the rule is unconditional. For consistency with the rest of the codebase (`MidiRack.ts` extensive allocation-free comments), this should either:

- conform: pre-allocate `latched` at MAX_HELD size and copy in place
- or be acknowledged as an exception in a docs/audit policy

**Severity rationale:** Low because user-held chord size is bounded by physical hands.

**Needed:** Pre-allocate `private latched: HeldNote[] = []` and replace `this.latched = [...this.held]` with an in-place copy loop (`this.latched.length = 0; for (const h of this.held) this.latched.push(h)`).

### 66. Test fixtures use a non-existent `timeSignature` field; `pnpm typecheck` should fail but doesn't — investigate tsconfig

**Verified 2026-04-28.** Severity: medium (process / build configuration).

Per #20, four spec files build a `transport: TransportInfo` object missing required fields and adding a non-existent `timeSignature` field. TypeScript should flag this with `Property 'timeSigNum' is missing in type ...` and `Object literal may only specify known properties, and 'timeSignature' does not exist`. If `pnpm typecheck` passes, the tsconfig has either (a) the test files excluded, or (b) `strict: false` / `strictNullChecks: false`, or (c) `skipLibCheck: true` masking deeper imports.

**Severity rationale:** Medium because the build pipeline isn't catching what should be obvious type errors.

**Representative files:**

- `tsconfig.json` (out of Yeast's scope; check)
- `src/modules/Yeast/useCases/processors/__tests__/{Arpeggiator,Humanizer,Transposer,ChordGenerator}.spec.ts`

**Needed:** Run `pnpm typecheck` on a CI-clean checkout. Confirm whether the bogus `timeSignature` field is actually a type error. If not, tsconfig has a hole that needs closing.

### 67. `MidiRack.removeProcessor` calls `processor.reset()` but does not generate Note Offs for active notes from that processor

**Verified 2026-04-28.** Severity: medium (correctness).

`MidiRack.ts:30-36`:

```ts
removeProcessor(id: string): void {
    const idx = this.processors.findIndex((param) => param.id === id);
    if (idx !== -1) {
        this.processors[idx]!.reset();
        this.processors.splice(idx, 1);
    }
}
```

`processor.reset()` clears the processor's *internal* state (e.g. `Arpeggiator.activeGenerated`), but the events that processor previously emitted into the chain — and that downstream synths are now playing — get nothing. The rack's `activeNotes` Map (`:16`) tracks the **rack output's** active notes, which were caused by the removed processor. Removing the processor leaves all those notes hanging on the synth.

**Repro:**

1. Add Arpeggiator. Press C4. Arp emits notes.
2. Remove the Arpeggiator while notes are sounding.
3. Synth keeps playing the last-emitted Note On forever.

**Compare with `allNotesOff`** (`:119-143`): it correctly emits Note Offs from `activeNotes` and flushes scheduled. `removeProcessor` should do the same — emit Note Offs for any active notes the rack thinks are alive — but it doesn't.

**Severity rationale:** Medium because removal-during-playback is an uncommon gesture but a real one. Hanging notes are user-visible.

**Representative files:**

- `src/modules/Yeast/useCases/MidiRack.ts:29-36`

**Needed:** On `removeProcessor`, before splicing, capture `this.activeNotes` (or a subset attributable to the processor — but we don't have that mapping today). Emit Note Offs for those notes through the remaining chain, or at minimum schedule them for the next `processBlock`. Add a behavioural test.

### 68. `MidiRack.processBlock` does not validate `blockStartSamples ≤ blockEndSamples`

**Verified 2026-04-28.** Severity: low (defensive).

`MidiRack.ts:51-56`: signature accepts `blockStartSamples` and `blockEndSamples` as separate params, no precondition check. If a buggy caller passes `blockEnd < blockStart`, `drainRangeInto(blockStart, blockEnd, current0)` will hit the condition `event.timeSamples >= startSamples && event.timeSamples < endSamples` which is impossible to satisfy → drains nothing. Then the separator at `:107-113` partitions current events: events with `timeSamples < blockEndSamples` (including all real events with `timeSamples >= blockStartSamples > blockEndSamples`) go to scheduled, not output. Result: silent zero-output.

**Severity rationale:** Low because it's defensive against a caller bug, but the failure mode is silent corruption (notes vanish into scheduled queue).

**Representative files:** `src/modules/Yeast/useCases/MidiRack.ts:51-116`.

**Needed:** Add a precondition: `if (blockEndSamples < blockStartSamples) { throw new Error(...) }` or `console.warn` and clamp.

### 69. `setYeastUiLevel.spec.ts` is the only behavioural write-use-case spec; the others are placeholders despite carrying significant logic

**Verified 2026-04-28.** Severity: medium (test gap).

`setYeastUiLevel.ts` is a 9-line use case that mutates a single field. It has the only real spec among write use cases (`setYeastUiLevel.spec.ts:1-21`).

By contrast:

- `addYeastProcessor.ts` (13 lines) — registers type, creates processor, adds to rack, mirrors to worklet, syncs store. **Five effects.** Spec is placeholder.
- `removeYeastProcessor.ts` (9 lines) — unregisters, removes from rack, mirrors, syncs. **Four effects.** Spec is placeholder.
- `setYeastProcessorParam.ts` (7 lines) — mutates rack, mirrors. **Two effects.** Spec is placeholder. (Should also call `syncStoreFromRack` per #54.)
- `setYeastProcessorBypass.ts` (8 lines) — mutates, mirrors, syncs. **Three effects.** Spec is placeholder.
- `reorderYeastProcessor.ts` (7 lines) — mutates rack, syncs (does not mirror — see #53). **Two effects.** Spec is placeholder.

Each of these is a single function with multiple side effects on three different surfaces (rack, worklet, store). They are exactly where bugs hide (e.g. #53, #54). A behavioural spec per use case would catch those bugs.

**Severity rationale:** Medium — duplicates #19a but specifically calls out the write-use-case gap as the highest-leverage place to add tests.

**Representative files:**

- All 5 write use cases listed above
- The corresponding placeholder spec files

**Needed:** Replace each placeholder with an integration spec that mocks the worklet (`getWorkletNodeSync`) and the store, then asserts: rack mutation, worklet mirror call, store sync. The `setYeastUiLevel.spec.ts` pattern is a fine starting point.

---

## Open questions

- [ ] Does any cross-module caller use `'#/modules/Yeast/...'` (deep path) today? — `pnpm deps:validate` is the source of truth; run after #1 ships.
- [ ] Is the worklet pipeline (issue #6) intended to be wired up later, or is it abandoned scaffolding? Affects whether to fix the IPC bugs (#7, #8, #25, #26, #27, #28) or delete them.
- [ ] What is the canonical block-size contract between AudioEngine's MIDI scheduler and `processYeastMidi`? Currently the bridge fakes 128 samples for real-time input.
- [ ] Should `ProcessorType` be a cross-module public type (so `YeastState` can compile in consumers) or kept private (so `YeastState` widens to `string`)?
- [ ] Is there a Yeast latency contract for PDC? If yes, finding #30 is a real bug; if no, the interface should be trimmed.

---

## Risks

- **Audio-thread allocation amplification.** `MidiRack` paid the cost of "no allocation" while six processors throw it away with string keys per Note On/Off. With a Humanizer + ChordGen + ScaleQuantizer chain on a piano line, Map allocations dominate the per-block budget. (#2)
- **Hanging notes everywhere.** `messageHandlers.ts` only routes Note On through Yeast (#62) — Transposer/ChordGen/Harmonizer outputs hang on every live keyboard release. `MidiRack.allNotesOff` (#11) leaves stray Note Offs. `MidiRack.removeProcessor` does not flush active notes from the removed processor (#67). `NoteFilter.reset()` emits Note Offs for filtered Note Ons after reset. Multiple classes of "stuck note" bugs that are hard to diagnose at runtime.
- **Real-time vs offline divergence.** The same rack instance is driven by two paths: the worklet (offline `scheduleMidiNotes`) and the main-thread (live `processRealtimeMidiInput`). Reorder doesn't mirror (#53), `TransportInfo` differs (#59), param mirroring has races (#7). Users will report "the same rack sounds different in playback vs live" — and they'll be right.
- **Step generators silently underschedule.** `processYeastMidi` fakes transport metadata (#4), real-time path uses 128-sample window too small for any meaningful generator output (#5). User presses a key with arp loaded — silence.
- **UI is decorative.** Every knob/select in `YeastPanel.tsx` and `ProcessorParams.tsx` is a write-only control with hard-coded display values (#15). `setYeastProcessorParam` doesn't propagate back to the store (#54). Even the planned fix won't work until both ends are repaired.
- **Test theatre.** 21 of 28 spec files are placeholders (#19a). The 4 "real" processor specs use an invalid `TransportInfo` shape (#20). CI green proves nothing.
- **Worklet IPC reliability.** Promise leak (#8), no error path (#26), no retry (#28), no timeout, rejected-promise cache (#63) — a single transient worklet error becomes a permanent stall.
- **Scratch-buffer reentrance.** A future feedback-loop processor that synchronously triggers another `processYeastMidi` will silently corrupt the rack's scratch buffers (#10). No guard.
- **Architectural drift.** Missing root barrel (#1), positional args (#17 / #19d), inline LCG duplication (#13), dead `latencySamples` (#30), `inferType` substring matching (#19e / #57), namespace imports in 21 specs (#55), codemod artefacts (#56). Each is small; the aggregate is mounting maintenance debt.

---

## Suggested approaches

- **Fix the audible correctness bugs first (#62, #26).** `messageHandlers.ts` is one extra `processRealtimeMidiInput(false)` call. ChordMemory needs pitch-class keying. Both are user-visible bugs with single-PR scope.
- **Wire the reactive feedback loop (#54, #15).** Add `getParams()` to `MidiProcessor`, populate `params` on `YeastProcessorInfo`, make `setYeastProcessorParam` call `syncStoreFromRack`. Replace literal `value=` props in `ProcessorParams.tsx` and `YeastPanel.tsx` with state-driven values. This single thread closes the entire UI integrity gap.
- **Mirror `reorder` to the worklet (#53).** Add `reorder` to the worklet protocol; one method addition + one IPC mirror call.
- **Fix `index.ts` and write-use-case re-exports (#1, #20b).** Mechanical, unblocks the architectural-compliance audit.
- **Single source of truth for `TransportInfo` (#4, #59).** Define `buildYeastTransportInfo` and use it in both `scheduleMidiNotes` and the bridge.
- **Decide on the worklet path (#6 corrected).** Both consumers, or one consumer? Determine before fixing the IPC bugs (#7, #8, #25, #26, #27, #28, #60, #63).
- **Lift `blockStartSamples` and `blockEndSamples` into the `MidiProcessor.processMidi` contract (#3).** Unblocks step-generator correctness.
- **Replace string keys with `(channel << 7) | note` numeric keys across the 6 violating processors (#2).** Mechanical, file-by-file. Add behavioural tests per processor before changing.
- **Replace inline LCG with `nextLcg` (#13)** + extract Box-Muller `gaussian()` to `lcgRandom.ts`. Mechanical sweep, 9 sites.
- **Audit `MidiRack` reentrance + `separateOutput` lifetime (#10, #11, #67, #68).** Add reentrance guard, fix `allNotesOff` flush, fix `removeProcessor` hang, validate block-start/end ordering.
- **Fix the spec suite (#19a, #20, #55, #69).** Build `makeTransportInfo` helper. Replace placeholder specs with behavioural assertions. Drop namespace imports.

---

## Recommendation

The adversarial re-review changed the recommended sequence. Updated 2026-04-28:

**Session 1 — Audible correctness (highest user impact):**

- **#62** — One-line fix in `messageHandlers.ts` to route Note Off through the rack. Stops hanging-note bugs across Transposer / ChordGen / Harmonizer.
- **#26** — Rewrite `ChordMemory` recall to key by pitch class. Single-file change.
- Add behavioural specs for both before the fix (TDD).

**Session 2 — UI feedback loop:**

- **#54** — Add `syncStoreFromRack()` call to `setYeastProcessorParam`.
- **#15** — Replace literal `value=` props with state-derived values in `ProcessorParams.tsx` and `YeastPanel.tsx`. Requires `getParams()` on each processor (15 implementations).
- Decide whether to ship the reactive update via store snapshot or per-processor signal.

**Session 3 — Cross-path consistency:**

- **#53** — Mirror `reorder` to the worklet. Add to protocol + worklet processor.
- **#59 / #4** — Single `buildYeastTransportInfo` helper used by both paths.
- **#6** (corrected) — decision: do both paths use the worklet, or do we partition the rack instance per-context?

**Session 4 — Architectural compliance & mechanical sweeps:**

- **#1, #20b** — Root `index.ts` + write-use-case re-exports.
- **#13** — Inline LCG → `nextLcg`. 9 sites.
- **#2** — String keys → numeric keys. 6 processors. Behavioural test per processor before edits.
- **#19a, #20, #55** — Replace 21 placeholder specs and the 4 invalid-shape behavioural specs.

**Sessions 5+ — Step-generator correctness:**

- **#3, #5, #11, #21, #22, #23, #67** — block-window contract, transport metadata, `allNotesOff`/`removeProcessor` hang behaviour.

---

## Resolved

_No issues resolved yet. (Audit re-verified 2026-04-28; all original open issues remain open with refined severity.)_
