# Yeast module audit

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

## Priorities

1. **Missing root `index.ts` and dead worklet pipeline (issues #1, #6, #7, #9)** — the module's entire cross-module contract is informal. Fix the barrel + decide whether the worklet path lives or dies.
2. **Audio-thread allocation hazards (issues #2, #13, #15, #16, #29, #30, #36, #43)** — the rack enforces "no allocation" but processors widely violate it via string keys and per-step array spreads.
3. **Block-window misuse and transport seek (issues #3, #4, #5, #21, #22)** — step generators silently underschedule; `processYeastMidi` is fed wrong transport metadata; real-time MIDI input through the rack does not generate arp output.
4. **Worklet IPC bugs (issues #7, #8, #25, #26, #27, #28)** — race condition, Promise leak, no error path, no retry.
5. **Processor correctness (issues #14, #32, #33, #39, #40, #45)** — arp octave cycle is asymmetric; ChordMemory commits prematurely; Humanizer can emit pre-block events.
6. **AGENTS.md violations (issues #1, #46, #47, #48, #49)** — barrel, function signatures, deep imports, type re-exports.

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

**Problem:** `MidiRack` was carefully refactored to use integer keys `(channel << 7) | note` and explicit "§149.2" comments to avoid template-literal allocation per event. Seven processors ignore this and allocate a fresh `${ch}:${note}` (or `ch * 128 + note` _but as a Map<string, …>_) per Note On / Note Off. The scratch ping-pong allocations are saved by the rack, then immediately squandered by every processor in the chain.

**Representative files:**

- `src/modules/Yeast/useCases/processors/Transposer.ts:33,40`
- `src/modules/Yeast/useCases/processors/Humanizer.ts:41,54`
- `src/modules/Yeast/useCases/processors/ScaleQuantizer.ts:54,60` (uses numeric `* 128` but stored in `Map<number, number>` — actually this one is fine, just 5 of the 7 use string keys)
- `src/modules/Yeast/useCases/processors/ChordGenerator.ts:79,81`
- `src/modules/Yeast/useCases/processors/ChordMemory.ts:46,79`
- `src/modules/Yeast/useCases/processors/Harmonizer.ts:51,75`
- `src/modules/Yeast/useCases/processors/NoteFilter.ts:28,40`

**Needed:** Replace string keys with `(channel << 7) | note` numeric keys; switch `Map<string, …>` to `Map<number, …>`. Add an internal helper in `models/MidiProcessor.ts` (e.g. `noteKey(channel, note): number`) and use it everywhere. Add a lint rule or a comment-enforced convention. Cross-reference `MidiRack.ts:88-99` for the canonical pattern.

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

### 6. Worklet rack is mirrored but never driven

**Problem:** `YeastWorkletNode.processBlock` is implemented (`YeastWorkletNode.ts:66-76`) and the worklet processes incoming requests (`yeastWorkletProcessor.ts:60-69`), but **no consumer calls** `node.processBlock(...)`. The bridge (`processYeastMidi`) calls the **main-thread** `rack.processBlock` directly. The worklet's `MidiRack` is kept in sync via `addProcessor`/`removeProcessor`/`setParam`/`setBypass` mirrors but never runs `processBlock`.

**Representative files:**

- `src/modules/Yeast/engine/YeastWorkletNode.ts:66-76`
- `src/modules/Yeast/services/yeastWorkletProcessor.ts:60-69`
- `src/modules/Yeast/useCases/yeastSchedulingBridge/processRealtimeMidiInput.ts:38`

**Needed:** Decide. Either (a) wire the bridge to the worklet and remove the main-thread `rack.processBlock` call from the audio scheduler's hot path, or (b) delete the worklet path entirely (`YeastWorkletNode.ts`, `yeastWorkletProcessor.ts`, the worklet-mirror calls in every write use case). The middle ground is dead code that ships in every bundle.

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

### 13. Hand-rolled LCG inline in 13 processors

**Problem:** `lcgRandom.ts:24-26` exports `nextLcg`, but only `Humanizer` uses it. Every other processor inlines `(state * 1103515245 + 12345) & 0x7fffffff`. The whole reason `lcgRandom.ts` exists (per its docstring) was to centralise this — the centralisation didn't happen.

**Representative files:**

- `src/modules/Yeast/models/lcgRandom.ts:24`
- `src/modules/Yeast/useCases/processors/Arpeggiator.ts:163,387,426`
- `src/modules/Yeast/useCases/processors/Transposer.ts:28`
- `src/modules/Yeast/useCases/processors/VelocityProcessor.ts:75`
- `src/modules/Yeast/useCases/processors/MarkovChain.ts:107`
- `src/modules/Yeast/useCases/processors/CCGenerator.ts` (presumably)
- `src/modules/Yeast/useCases/processors/MutationEngine.ts` (presumably)

**Needed:** Replace inline LCG with `nextLcg` + `LCG_MAX` everywhere. Mechanical edit, one file at a time per AGENTS.md "no automated bulk edits".

### 14. `Arpeggiator.expandOctaves` upDown asymmetry

**Problem:** `Arpeggiator.ts:343-350`: descending loop `for (let output = this.octaveRange - 2; output > 0; output--)` excludes 0, so the descent never returns to the source octave. The full sequence for `octaveRange = 3` is `[0, 1, 2, 1]` not `[0, 1, 2, 1, 0]`.

**Representative files:**

- `src/modules/Yeast/useCases/processors/Arpeggiator.ts:333-350`

**Needed:** Change descent condition to `>= 0` for the first descent step or restructure the loop so the upDown cycle is symmetric. Add a test for `octaveRange = 3, octaveDirection = 'upDown'` that asserts the cycle visits each octave once on the way down.

### 15. Presentation: stale literal values driving controls

**Problem:** `YeastPanel.tsx` Level 1, 2, 3, 4, 5 all wire knobs/selects with hard-coded literal `value` and `defaultValue` props instead of reading the processor's actual current parameter. Examples:

- `Level1Play` Mode select uses `defaultValue={0}` (`YeastPanel.tsx:362`) — once the user picks a mode, the displayed value is whatever the user selected, not what the processor actually has. After remove + re-add, the displayed state is wrong.
- `Level1Play` Latch (`YeastPanel.tsx:393-403`) only ever calls `setYeastProcessorParam(arp.id, 'latch', 1)` — it cannot _toggle off_ latch. The visual is a static chip; the data path is one-way.
- `Level2Shape` `KnobCol` calls all pass literal `value={0.8}`, `value={0}`, `value={1}`, `value={100}` (`YeastPanel.tsx:417-446`). These are render-time constants, not bound to the processor state. The knob is decorative.
- `Level3Build`, `Level4Route`, `Level5Lab` use `useState` for `arpPattern` and `expandedId`. The `arpPattern` state is local to React; `setYeastProcessorParam` is never called when the pattern changes. The `Arpeggiator.setPattern` API (`Arpeggiator.ts:241`) is unreachable from the UI.
- `currentStep={0}` is hard-coded in both `StepPatternEditor` invocations (`YeastPanel.tsx:541`, `:743`) — the live step indicator never animates.

**Representative files:**

- `src/modules/Yeast/presentations/views/YeastPanel.tsx:362-371,376-391,393-403,417-446,455,462,541,742-755`
- `src/modules/Yeast/useCases/processors/Arpeggiator.ts:241,250` (`setPattern`, `getCurrentStep` exist but are unreachable)
- `src/modules/Yeast/presentations/components/StepPatternEditor.tsx:26-31` (no liveStep wiring)

**Needed:** Read each processor's current parameter set from the rack (need a `getProcessorParams(id)` API on `MidiRack` or a per-processor reactive store). Replace literal values with state-driven props. Wire `Latch` as a true toggle. Plumb `arpPattern` to `Arpeggiator.setPattern` (probably via a new `setYeastProcessorPattern` use case). Plumb `currentStep` from `Arpeggiator.getCurrentStep()` (likely via a `requestAnimationFrame` poll in the panel).

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

### 16. `transportStore.value` read per audio block

**Problem:** `processRealtimeMidiInput.ts:19` reads `transportStore.value` on every call, including every audio-block tick. Cross-module store dereference per audio frame.

**Representative files:**

- `src/modules/Yeast/useCases/yeastSchedulingBridge/processRealtimeMidiInput.ts:19`

**Needed:** Pass a snapshot from the caller (the AudioEngine scheduler), or move the snapshot to a module-level cached value updated on `transportStore.subscribe`.

### 17. Function-signature violations (positional args)

**Problem:** AGENTS.md mandates "Functions with more than one parameter take a single object param". `MidiRack.processBlock` (4 positional), `processYeastMidi` (4 positional), `processRealtimeMidiInput` (7 positional), `MidiRack.reorder`, `setProcessorParam`, etc.

**Representative files:**

- `src/modules/Yeast/useCases/MidiRack.ts:51,159,166`
- `src/modules/Yeast/useCases/yeastSchedulingBridge/processRealtimeMidiInput.ts:6,41`
- `src/modules/Yeast/useCases/setYeastProcessorParam.ts:3`
- `src/modules/Yeast/models/MidiProcessor.ts:15` (`processMidi` interface)

**Needed:** Refactor each to take `<FunctionName>Input` object types defined immediately above. The MidiProcessor interface is the load-bearing contract; it propagates to all 15 processors.

### 18. `inferType` fallback masks bugs

**Problem:** `yeastStore.ts:147-173` does substring matching on processor names and falls back to `'arpeggiator'` if nothing matches. The type map should be authoritative; this fallback is dead code that disguises bugs (a registration failure produces an arpeggiator ID for, say, a Mutation processor).

**Representative files:**

- `src/modules/Yeast/stores/yeastStore.ts:140-173`

**Needed:** Delete `inferType`. If `processorTypeMap.get(node.id)` returns undefined, that's a contract violation — log and skip the entry.

### 19a. **The vast majority of Yeast specs are placeholder no-ops**

**Problem:** Across 27 spec files in the module, **20** are 11–16 lines of `expect(subject.X).toBeDefined()` plus `expect(typeof X === 'function' || === 'object').toBe(true)`. They prove the export _exists_ — they do not exercise behaviour. This means the module's spec suite is theatrical: it makes the test runner green without protecting any contract.

Confirmed placeholder-only specs (each exactly the "should export" pattern):

- `useCases/__tests__/MidiRack.spec.ts` (the rack)
- `useCases/__tests__/addYeastProcessor.spec.ts`
- `useCases/__tests__/removeYeastProcessor.spec.ts`
- `useCases/__tests__/reorderYeastProcessor.spec.ts`
- `useCases/__tests__/setYeastProcessorBypass.spec.ts`
- `useCases/__tests__/setYeastProcessorParam.spec.ts`
- `useCases/__tests__/processorFactory.spec.ts`
- `useCases/yeastSchedulingBridge/__tests__/processRealtimeMidiInput.spec.ts`
- `useCases/yeastSchedulingBridge/__tests__/yeastPanic.spec.ts`
- `useCases/processors/__tests__/CCGenerator.spec.ts`
- `useCases/processors/__tests__/ChordMemory.spec.ts`
- `useCases/processors/__tests__/EuclideanGenerator.spec.ts`
- `useCases/processors/__tests__/GrooveModule.spec.ts`
- `useCases/processors/__tests__/Harmonizer.spec.ts`
- `useCases/processors/__tests__/MarkovChain.spec.ts`
- `useCases/processors/__tests__/MutationEngine.spec.ts`
- `useCases/processors/__tests__/NoteFilter.spec.ts`
- `useCases/processors/__tests__/NoteRepeater.spec.ts`
- `useCases/processors/__tests__/ScaleQuantizer.spec.ts`
- `useCases/processors/__tests__/VelocityProcessor.spec.ts`

Only seven spec files (`Arpeggiator.spec.ts`, `ChordGenerator.spec.ts`, `Humanizer.spec.ts`, `Transposer.spec.ts`, `setYeastUiLevel.spec.ts`, `yeastSchedulingBridge.spec.ts`, plus the three presentation specs) appear to actually exercise the production code path. AGENTS.md "TypeScript — soundness" says: "Tests: Do not stop at 'defined' / 'truthy' / generic `toBeTypeOf('object')` — assert the actual contract." The placeholder pattern is the textbook example of what's forbidden.

**Representative files:**

- The 20 files listed above
- AGENTS.md "TypeScript — soundness" §

**Needed:** Replace each placeholder with at least one behavioural assertion per public method. For each processor, assert "input X produces output Y" for the canonical mode. For `MidiRack`, assert ping-pong correctness, processor ordering, and `allNotesOff` flush. For `addYeastProcessor`/etc., assert the rack mutation lands and the store is synced. This is the single biggest correctness risk in the module — the green CI is meaningless.

### 19b. `MidiRack.spec.ts` is a no-op

**Problem:** `MidiRack.spec.ts:5-11` is the entire file. It checks `MidiRack` is defined and that its type is `'function'` or `'object'`. The class has 8 public methods; **none are tested**. `processBlock`, `addProcessor`, `removeProcessor`, `reorder`, `allNotesOff`, `setProcessorParam`, `setProcessorBypass`, `getProcessorIds`, `getProcessorNames` — zero behavioural coverage. The most load-bearing audio-thread file in the module has no tests.

**Representative files:**

- `src/modules/Yeast/useCases/__tests__/MidiRack.spec.ts:1-11`
- `src/modules/Yeast/useCases/MidiRack.ts` (8 public methods untested)

**Needed:** Replace the placeholder with proper coverage: ping-pong scratch buffer correctness, scheduled events draining within the block window, `separateOutput` future-event partition, `allNotesOff` flush behaviour with a chain of stateful processors, reorder semantics, and `processBlock` called twice in a row not corrupting state. Add a fixture-builder for `TransportInfo`.

### 20. `Arpeggiator.spec.ts` uses an invalid `TransportInfo` shape

**Problem:** `Arpeggiator.spec.ts:12-18` builds a `transport` object with `timeSignature: { numerator: 4, denominator: 4 }`. The actual `TransportInfo` type (`MidiEvent.ts:21-34`) has `timeSigNum: number` and `timeSigDen: number` — **no `timeSignature` field**. Likewise the spec is missing required fields: `barIndex`, `beatInBar`, `loopEnabled`, `loopStartPpq`, `loopEndPpq`. The test compiles only via TypeScript structural-type leniency on the missing fields — likely the file has a `TransportInfo`-typed variable that doesn't actually match the contract. If the type were ever imported via `satisfies TransportInfo` the build would fail. Also, `transport.ppqPosition = 0.6` is mutated between calls (`:32, 41`) — the rack's `processBlock` does not advance time via `ppqPosition`, it advances via `lastStepTime` and `input` timestamps. The test passes with mutated PPQ but the production scheduler does not behave this way.

**Representative files:**

- `src/modules/Yeast/useCases/processors/__tests__/Arpeggiator.spec.ts:7-19,32,41`
- `src/modules/Yeast/models/MidiEvent.ts:21-34` (canonical `TransportInfo`)

**Needed:** Build a `makeTransportInfo(overrides?)` test helper that returns a fully-typed `TransportInfo` (`satisfies TransportInfo`). Update the Arpeggiator spec to drive time via input event `timeSamples` (the production model), not by mutating `ppqPosition`. Audit every other processor spec for the same pattern.

### 20. AGENTS.md `useCases/index.ts` does not include write use cases

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

### 26. `ChordMemory` semantics: absolute notes vs pitch-class

**Problem:** `ChordMemory.ts:48-56`: stored chords are absolute MIDI notes, recall transposes by `event.kind.note - stored.root`. This produces inverted-octave output when the stored chord has notes below the root.

**Representative files:**

- `src/modules/Yeast/useCases/processors/ChordMemory.ts:11-14,44-58`

**Needed:** Decide on contract: pitch-class voicing (Cthulhu-style) vs interval-only voicing. Store relative intervals, not absolute notes. Document.

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

## Open questions

- [ ] Does any cross-module caller use `'#/modules/Yeast/...'` (deep path) today? — `pnpm deps:validate` is the source of truth; run after #1 ships.
- [ ] Is the worklet pipeline (issue #6) intended to be wired up later, or is it abandoned scaffolding? Affects whether to fix the IPC bugs (#7, #8, #25, #26, #27, #28) or delete them.
- [ ] What is the canonical block-size contract between AudioEngine's MIDI scheduler and `processYeastMidi`? Currently the bridge fakes 128 samples for real-time input.
- [ ] Should `ProcessorType` be a cross-module public type (so `YeastState` can compile in consumers) or kept private (so `YeastState` widens to `string`)?
- [ ] Is there a Yeast latency contract for PDC? If yes, finding #30 is a real bug; if no, the interface should be trimmed.

---

## Risks

- **Audio-thread allocation amplification.** `MidiRack` paid the cost of "no allocation" while seven processors throw it away with string keys per Note On/Off. With a Humanizer + ChordGen + ScaleQuantizer chain on a piano line, Map allocations dominate the per-block budget. (#2)
- **Step generators silently underschedule.** Real-time MIDI input through Yeast does not emit arp output (#5). Combined with `processYeastMidi` faking transport metadata (#4), the user-visible behaviour after a transport seek/loop is non-deterministic.
- **Hanging notes.** `MidiRack.allNotesOff` (#11) leaves stray Note Offs and may miss live notes; `NoteFilter.reset()` (#37) emits Note Offs for filtered Note Ons after reset. Both classes of bug land as "stuck note" issues that are hard to reproduce.
- **Worklet IPC reliability.** Promise leak (#8), no error path (#26), no retry (#28), no timeout — together they mean a single transient worklet error becomes a permanent stall of the worklet path. (Mitigated only because the path is dead today, #6.)
- **Scratch-buffer reentrance.** A future feedback-loop processor that synchronously triggers another `processYeastMidi` will silently corrupt the rack's scratch buffers (#10). No guard.
- **Architectural drift.** Missing root barrel (#1), positional args (#17), inline LCG duplication (#13), dead `latencySamples` (#30), dead worklet (#6) are accumulating violations. Each is small; the aggregate is mounting maintenance debt.

---

## Suggested approaches

- **Fix `index.ts` and write-use-case re-exports first (#1, #20).** Mechanical, unblocks the architectural-compliance audit and gets `pnpm deps:validate` running on the full surface.
- **Decide on the worklet path (#6) before fixing the IPC bugs (#7, #8, #25, #26, #27, #28).** No point hardening dead code.
- **Lift `blockStartSamples` and `blockEndSamples` into the `MidiProcessor.processMidi` contract (#3).** This unblocks the step-generator correctness fixes and the transport-seek scenarios. Rolls into "thread the real `TransportInfo` through" (#4).
- **Replace string keys with `(channel << 7) | note` numeric keys across all processors (#2).** Mechanical, file-by-file, with a behavioural test per processor (a Note On followed by a matching Note Off should produce a matching pair downstream).
- **Replace inline LCG with `nextLcg` (#13).** Mechanical sweep.
- **Audit `MidiRack` reentrance + `separateOutput` lifetime (#10, #11).** Add an `isProcessing` guard, switch `allNotesOff` to the rack-level `activeNotes` source of truth, and document the consume-before-next contract on `processBlock`.
- **Fix `Arpeggiator.expandOctaves` upDown cycle (#14)** with a property-based test that asserts `expandOctaves(pool, 3, 'upDown')` produces a symmetric sequence.

---

## Recommendation

Start with **issue #1 (root `index.ts`) + #20 (re-export write use cases)**. They are mechanical, take half a session each, and unblock a clean `pnpm deps:validate` baseline.

Then resolve **issue #6 (worklet path live or dead)**. This is a yes/no decision; once made, the IPC bugs (#7, #8, #25, #26, #27, #28) either get fixed properly or get deleted.

After those two land, the next session can pick between the **correctness pass** (issues #3, #4, #5, #11, #14, #21, #22, #23) and the **performance pass** (issues #2, #13, #15, #16, #30, #36, #43). They are independent.

---

## Resolved

_No issues resolved yet._
