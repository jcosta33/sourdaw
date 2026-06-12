# Synth module audit

## Scope

This audit covers `src/modules/Synth/` in full — every file under
`engine/`, `events/`, `models/`, `stores/`, and `useCases/` (including
`builtinSynth.ts`, `proSynthInstruments.ts`, `drumKitSynth.ts`, the
Faust scheduler pair, the CV/Gate sub-tree, and the drum-synth engine
sub-tree). It explicitly excludes:

- The downstream `AudioEngine` device dispatch
  (`scheduleDeviceKeyOn` / `scheduleDeviceKeyOff` / `audition`),
- The Faust DSP runtime in `Plugin/useCases` (`registerFaustDSP` /
  Faust worklet),
- The Transport scheduler that calls `scheduleNote` / `scheduleKitNote`,
- The `.dsp` source files themselves (only inspected for cross-cutting
  contract issues).

It is an adversarial review: bugs, audio-thread allocation, voice
management, envelope / LFO timing, oscillator anti-aliasing, modulation
matrix, type soundness, AGENTS.md violations, testing gaps, UX/
accessibility.

Related spec: none on disk.

---

## Goal

A correctness-first, ergonomic synth surface for the DAW:

- A single, well-typed builtin-synth that schedules a deterministic
  audio graph per note with no per-note sample allocations, with
  envelope and filter envelope timing that matches between the realtime
  and offline render paths.
- Drum scheduling that routes pitch → voice via a flat lookup, with
  velocity scaling that conforms to the same `0..127` contract used
  elsewhere in the engine, and cached noise buffers to avoid GC churn.
- Faust pro-instruments registered exactly once, with parameter
  descriptors that match the `.dsp` `hslider` definitions in name,
  range, and default — drift between the `.ts` registration and `.dsp`
  source must be impossible (or at least lint-flagged).
- A CV/Gate sub-system whose store mutations go through use cases (no
  direct `cvGateStore.set` in handlers), whose pitch / velocity / clock
  conversions are pure and total, and whose voltage clamping is
  applied consistently (`setCvValue` clamps `[0,1]` — but the channel
  has `min/maxVoltage`).
- Tests assert real behaviour: the produced node graph topology, the
  number of nodes per note, envelope timing, pitch tracking, and
  drum-voice routing. No tests that "stop at defined" (AGENTS.md
  TypeScript — soundness § Tests).
- AGENTS.md hard rules: no `any`, no `as any`/`as unknown as`/`as
  never`, no `useMemo`/`useCallback`/`React.memo`, no `forwardRef`,
  no namespace imports, no cross-module imports of internals;
  `useCases/` and `repositories/` are one-function-per-file; functions
  with more than one parameter take a single object param.

---

## Relevant code paths

- `src/modules/Synth/engine/drumSynthVoices.ts` (10 voice schedulers)
- `src/modules/Synth/events/index.ts` (empty — `// no public events`)
- `src/modules/Synth/models/DrumSynthTypes.ts`
- `src/modules/Synth/stores/cvGate.ts`
- `src/modules/Synth/stores/index.ts`
- `src/modules/Synth/useCases/index.ts`
- `src/modules/Synth/useCases/builtinSynth.ts`
- `src/modules/Synth/useCases/drumKitSynth.ts`
- `src/modules/Synth/useCases/proSynthInstruments.ts`
- `src/modules/Synth/useCases/dsp/{additive,morphing,physical-model-string,supersaw-unison}.dsp`
- `src/modules/Synth/useCases/faustInstrumentScheduler/{startFaustNote,scheduleFaustNote}.ts`
- `src/modules/Synth/useCases/cvGate/cvConversion/{midiNoteToCv,velocityToCv,getClockValue}.ts`
- `src/modules/Synth/useCases/cvGate/cvOutputOperations/{add,remove,setCv,setVoltageStandard,setClockDivision}*.ts`
- `src/modules/Synth/useCases/drumSynthEngine/kitDefinitions/{getDrumKitDefByIndex,scheduleDrumKitNote}.ts`
- `src/modules/Synth/useCases/__tests__/*` and nested `__tests__/`
  folders (12 spec files in total).

---

## Current behavior

**Module barrel.** There is no `src/modules/Synth/index.ts`. External
modules import directly from `#/modules/Synth/useCases` and
`#/modules/Synth/stores/cvGate` (the latter is reachable only through
`Synth/stores/index.ts`'s `cvGateStore` export — but the only external
reference to `Synth/stores/cvGate` lives inside this module's own
test). Per AGENTS.md "Cross-module imports MUST only target the
destination module's root **`index.ts`**", every external file
importing from `#/modules/Synth/useCases` (8 call sites) is currently
violating the contract — but the contract cannot be honoured because
no root barrel exists.

**Builtin synth.** `useCases/builtinSynth.ts` exposes three functions:

1. `scheduleNote(ctx, destination, pitch, startTime, duration,
velocity, params, mpe?, clipGain=1)` — builds an ad-hoc graph with
   up to 11 nodes (osc1 + osc1Gain + osc2 + osc2Gain + subOsc + subGain
   + noiseSource + noiseGain + filter + envelope + 2 stereo panners +
   vibrato LFO + vibratoGain), plus an `onended` cleanup closure.
2. `scheduleNoteOffline(ctx, destination, pitch, startTime, duration,
velocity, params)` — explicitly drops osc2/sub/noise/vibrato/stereo
   spread to keep node count low for offline render.
3. `getSynthParamsFromDevices(devices)` — finds the first device whose
   `type === 'synth'` or `'builtin-synth*'` and decodes its
   `parameterValues` into a `SynthParams`.

Both schedulers use `setValueAtTime`, `linearRampToValueAtTime`, and
`exponentialRampToValueAtTime` for envelope shaping; both use the
Web Audio `BiquadFilterNode` (no SIMD/native filter).

**Drum synth.** Two parallel implementations:

1. `useCases/drumKitSynth.ts` defines a `DrumKit` shape with
   `pitchRange: [number, number]` per voice, and `scheduleKitNote`
   delegates to `scheduleNote` with the voice's `SynthParams`.
2. `useCases/drumSynthEngine/kitDefinitions/scheduleDrumKitNote.ts`
   defines a different `DrumKitDef` shape with `midiNote: number` per
   voice, and `scheduleDrumKitNote` delegates to
   `engine/drumSynthVoices.ts:scheduleDrumVoice` (the analog 808
   voices).

Both surfaces are exported from the same `useCases/index.ts` barrel.

**Drum voice engine.** `engine/drumSynthVoices.ts` schedules ten 808
voices (kick / snare / clap / closed-hh / open-hh / tom × 3 / cowbell /
rimshot / conga × 3 / maracas / clave). Noise buffers are cached in
a `WeakMap<BaseAudioContext, Map<durationSec, AudioBuffer>>` keyed by
duration. Most voices use multiple `OscillatorNode`s plus filters and
gain envelopes.

**Pro synth (Faust).** `useCases/proSynthInstruments.ts` registers four
Faust instruments with `registerFaustDSP` (Plugin module). The DSP
sources are bundled via Vite `?raw` imports.

**Faust scheduler.** `faustInstrumentScheduler/{startFaustNote,
scheduleFaustNote}.ts` are two trivially thin wrappers around
`scheduleDeviceKeyOn` / `scheduleDeviceKeyOff` from `AudioEngine`.

**CV/Gate.** `stores/cvGate.ts` exposes a persisted store with
`outputs[]`, `voltageStandard`, `clockDivision`, `triggerPulseMs`,
`gateThreshold`. Five operations live in `cvOutputOperations/` (one
function per file, all mutating the store directly). Three pure
conversions live in `cvConversion/`. `triggerPulseMs` and
`gateThreshold` are persisted but never read by any code in this
module.

**Tests.** All 12 spec files exist; nine of them assert real behaviour
(CV ops, drum kit lookup, Faust scheduling, pro-synth registration).
Three are placeholder tautologies: `builtinSynth.spec.ts` only checks
`typeof === 'function' || 'object'`; `drumKitSynth.spec.ts` only
checks the type compiles via `params: {} as never`;
`proSynthInstruments.spec.ts` covers count and names but not parameter
range coherence with the `.dsp` source.

---

## Findings

### Adversarial review log (2026-04-28)

Re-walked every cited file against current source. Verified all 51 prior findings — none have been resolved. Promoted issue #15 (leaky `OscillatorNode` return) to a load-bearing failure mode after discovering audition's `_env` reach-through (new issue #52). Promoted issue #25 (Faust idempotency) to actively destructive after tracing `registerFaustDSP` (`compilerEngine.ts:116-125`) — second call replaces the compiled module with a fresh `compiled: false, generator: null` object, breaking any in-flight uses. Demoted issue #6 (Hz/V mode) but not by much: function is dead code today (#new 56), so the bug ships but never fires. Added 6 new numbered issues (#52-#57) covering: audition `_env` reach-through, `as CvOutputType` cast in handleAddCvOutput, undoable handler with no undo, full CV/Gate dead-code surface, hard-coded velocity-attack inversion, and offline render parity for drum kits.

1. **Two parallel "drum kit" abstractions ship in the same barrel.**
   `drumKitSynth.scheduleKitNote` and
   `drumSynthEngine/.../scheduleDrumKitNote` solve the same problem
   with incompatible primitives: one uses `pitchRange` + `SynthParams`
   (subtractive synth voices), the other uses `midiNote` +
   `DrumVoiceType` (analog 808 voices). Both are exported. The
   downstream Transport calls both
   (`scheduleMidiNotes.ts:15` imports
   `getDrumKitDefByIndex, scheduleDrumKitNote, scheduleKitNote, scheduleNote`).
   There is no spec-level guidance on which to use.

2. **No module root barrel `index.ts` exists** for Synth, but external
   modules import deep into `#/modules/Synth/useCases` and the
   internal-only test references `#/modules/Synth/stores/cvGate`. The
   absence of a curated root `index.ts` means there is no single
   "external API" surface for this module.

3. **`scheduleNote` has no voice-count limit, no voice stealing, no
   polyphony tracking.** A sequencer that fires 200 notes in 50 ms
   creates 200 graphs of ~7-11 nodes each (~1500-2200 nodes). There is
   no `MAX_VOICES`, no priority queue, no oldest-voice eviction. The
   `onended` closure is the only cleanup hook. AGENTS.md "audio-thread:
   no allocation, no mutex locks, no blocking" — this is technically
   on the JS thread, but the resulting AudioGraph mutations are huge
   and synchronous on the main thread; Web Audio will silently degrade
   under graph pressure.

4. **`scheduleNote` does per-note `AudioBufferSourceNode +
new StereoPannerNode + ctx.createGain` allocations.** Acceptable for
   a few notes; punishing under sequencing density. There is no
   pooling. A noise-rich preset triggers a `getNoiseBuffer(ctx)` lookup
   per note (cheap because cached), but all the gain/filter/envelope
   nodes are minted fresh.

5. **`scheduleNote.cleanupNodes` array allocation per note.**
   `builtinSynth.ts:141` `const cleanupNodes: AudioNode[] = [mixer]`,
   then 7-12 `cleanupNodes.push(...)` calls per note. The array is
   captured in the `osc1.onended` closure (`:322`). Across hundreds of
   simultaneous notes this is hundreds of arrays + closures retained
   for the full envelope duration, then collected.

6. **Vibrato LFO timing math is incorrect and inverts the intended
   envelope.** `builtinSynth.ts:287-289` (verified 2026-04-28):
    ```
    vibratoGain.gain.setValueAtTime(0, startTime);
    vibratoGain.gain.linearRampToValueAtTime(0, attackEnd + vibDelay);
    vibratoGain.gain.linearRampToValueAtTime(params.vibratoDepth, attackEnd + vibDelay + 0.1);
    ```
   The first ramp is mathematically a no-op (`0 → 0`) — but Web Audio
   **does** schedule an automation event at `attackEnd + vibDelay`,
   so the second ramp's interpolation correctly starts from there.
   Functionally correct **by accident**: the audit author who wrote
   "happens to work" should have verified that the dead event isn't
   load-bearing, and it isn't — `linearRampToValueAtTime` always uses
   the previous event's value at its time as the start, so the
   sequence behaves as intended. Cosmetic. The real problem is that
   `attackEnd` here uses the **velocity-modified** `velAttack`
   (`builtinSynth.ts:127, 256`), so the vibrato delay shifts with
   note velocity — a hard hit shortens both `velAttack` *and* the
   vibrato onset point. Whether that is intentional is undocumented.

7. **Vibrato LFO `vibratoDepth` is in **cents** but typed as a plain
   number.** `builtinSynth.ts:289` connects `vibratoGain` to
   `osc.detune` (which is in cents). A user-facing `vibratoDepth: 0..1`
   slider would suggest "depth 0..1 → 0..100 cents" semantics, but no
   such mapping exists — the raw value is wired directly to detune.
   Type-brand or document.

8. **Filter envelope decays past the note's release.**
   `builtinSynth.ts:237-241`: the filter envelope ramps from
   `filterPeak → filterCutoff` over `[attack, decay]`, but the
   amplitude envelope's release is at `releaseStart..releaseEnd`. If
   `decay > duration`, the filter never reaches `filterCutoff`; if
   `duration` is very short, the filter is held at `filterPeak` while
   amplitude is already releasing. There is no `cancelScheduledValues`
   on note-off; the filter ramp continues to schedule events past the
   stop time. Web Audio handles this gracefully (events past `stop()`
   simply don't render) but the implementation is sloppy.

9. **`scheduleNote` uses `linearRampToValueAtTime` to 0 for envelope
   release.** `builtinSynth.ts:270`: a linear release from
   `sustainLevel` to 0 produces a click on quick note-off if
   `sustainLevel` is large, because the slope changes abruptly at
   `releaseEnd`. Standard practice is `setTargetAtTime` (exponential
   tail) to avoid the click.

10. **`scheduleNote` ignores the `mpe.timbre` axis if it exists.**
    `builtinSynth.ts:131-249`: only `mpe.pitchBend`, `mpe.pressure`,
    and `mpe.slide` are handled. If `MpeParams` evolves to include
    `timbre` or other axes, this scheduler silently drops them. There
    is no exhaustiveness check on the discriminated union.

11. **`scheduleNoteOffline` has divergent envelope semantics from
    realtime.** `builtinSynth.ts:399`: offline uses
    `params.attack` for the filter envelope's attack but the realtime
    path also uses `params.attack` — these are consistent — **but**
    offline drops vibrato, stereo spread, sub-osc, osc2, noise. The
    prose comment says "preserves core timbre" but that is a mix of
    DSP truthiness and product opinion. Anyone bouncing a track to
    audio expects the offline render to **match the realtime
    monitoring**; right now exporting drops half the synth. AGENTS.md
    "Holistic Evaluation" — divergent behaviour between realtime and
    render is a correctness regression masquerading as a perf
    optimisation.

12. **Two `Math.max(0, Math.min(127, …))` velocity-clip patterns
    diverge.**
    - `drumSynthEngine/.../scheduleDrumKitNote.ts:24`:
      `Math.max(0, Math.min(127, velocity * clipGain))` — keeps
      velocity as a float (no `Math.floor`).
    - `faustInstrumentScheduler/scheduleFaustNote.ts:12`:
      `Math.max(0, Math.min(127, Math.floor(velocity * clipGain)))` —
      floors.
    - `drumKitSynth.scheduleKitNote` does **not** clamp at all —
      it forwards raw `velocity * clipGain` into `scheduleNote`, which
      then divides by 127 (`builtinSynth.ts:127`), so an over-1
      `clipGain` produces a `peakGain` >`gain` (unintended boost).
      No clamp.
    Same operation, three contracts.

13. **`scheduleKitNote` does not clamp velocity at all when forwarding
    to `scheduleNote`.** `drumKitSynth.ts:47` passes
    `velocity` (not `velocity * clipGain`) into `scheduleNote`; the
    clipGain is forwarded as the eighth argument. Inside `scheduleNote`
    `peakGain = (velocity / 127) * params.gain * clipGain`. So clipGain
    is applied correctly **here**, but in the test
    (`drumKitSynth.spec.ts:14`) `params: {} as never` is used — see
    issue #21.

14. **`engine/drumSynthVoices.ts` is referenced from
    `useCases/drumSynthEngine/kitDefinitions/scheduleDrumKitNote.ts`.**
    `engine/` is allowed to be reached from `useCases/`. But the
    engine in turn does not depend on `repositories/` (none exist),
    which is correct. However `engine/` mutates the **outer**
    AudioGraph by calling `ctx.create*` and `connect()` directly —
    **no contract enforces** that `engine/` cannot allocate or
    perform Web Audio I/O. AGENTS.md "Repositories Touch Metal" — a
    strict reading places `ctx.createOscillator` in `repositories/`,
    not `engine/`. The pattern here mixes the two roles.

15. **`engine/drumSynthVoices.ts` 808 hi-hat schedules **6 oscillators
    per hit** with no pooling.** `drumSynthVoices.ts:161-168`: a busy
    hi-hat pattern (16 hits per bar at 140 BPM = 5.6 hits/sec) builds
    34 oscillator nodes per second, all started, stopped, and garbage
    collected. Acceptable, but the cumulative impact when combined
    with `scheduleNote`'s ~10 nodes per pitched-synth note is the kind
    of thing that surfaces as "unexplained dropouts" on lower-end
    machines. No allocation budget or watchdog.

16. **`engine/drumSynthVoices.ts:schedule808Cowbell` mismatches its own
    waveform list.** `:216` declares `freqs = [560, 845]` (two square
    oscillators) — but the docstring at `:10` says "Cowbell: Two
    detuned square oscillators + bandpass". 560 Hz / 845 Hz are
    the canonical 808 cowbell frequencies; "detuned" is misleading
    because they are ~1.5× apart, not detuned by cents. Doc/code
    mismatch only.

17. **`engine/drumSynthVoices.ts:schedule808Clap.tail` reuses the
    burst noise buffer for the tail.** `:134-141`: the tail noise
    source plays the same `noiseBuffer` as the bursts. Real 808 clap
    has a different tail texture (longer, less filtered). Cosmetic
    DSP issue but mentioned in case fidelity matters.

18. **`engine/drumSynthVoices.ts:schedule808HiHat` filter chain order
    is wrong relative to the 808 schematic.** `:170-181`:
    `oscGain → highpass(7000) → bandpass(10000)`. The 808 actually
    used a low-pass into a high-pass with a long decay envelope; the
    bandpass-after-highpass produces a narrower spectrum than the
    real machine. Cosmetic DSP issue.

19. **`engine/drumSynthVoices.ts` has no `SilentOnZeroVelocity`
    short-circuit.** A `velocity = 0` hit (legal MIDI, often used as
    a no-op) still creates the full graph and starts oscillators with
    `gain = 0`. Cheap but wasteful at sequencer density. The pitched
    synth scheduler has the same problem.

20. **Functions take 5-9 positional parameters in violation of
    AGENTS.md.** AGENTS.md "Functions with more than one parameter
    take a single object param. … For module-level functions, the
    input type is named `FunctionNameInput`."
    Violations:
    - `builtinSynth.scheduleNote` — 9 positional params
      (`ctx, destination, pitch, startTime, duration, velocity, params,
mpe?, clipGain=1`).
    - `builtinSynth.scheduleNoteOffline` — 7 positional params.
    - `drumKitSynth.scheduleKitNote` — 8 positional params.
    - `drumSynthEngine/.../scheduleDrumKitNote.scheduleDrumKitNote` — 7
      positional params.
    - `engine/drumSynthVoices.scheduleDrumVoice` — 5 positional params.
    - All ten internal `schedule808*` voice functions — 4-5 positional.
    - `faustInstrumentScheduler.startFaustNote` — 5 positional.
    - `faustInstrumentScheduler.scheduleFaustNote` — 7 positional.
    - `cvGate/cvConversion/midiNoteToCv` — 1, OK.
    - `cvGate/cvConversion/velocityToCv` — 2 positional.
    - `cvGate/cvConversion/getClockValue` — 3 positional.
    - `cvGate/cvOutputOperations/addCvOutput` — 3 positional.
    - `cvGate/cvOutputOperations/setCvValue` — 2 positional
      (`outputIdVal: string` + `value: number`).
    Multi-positional parameters are pervasive in this module. The
    `clipGain: number = 1.0` defaults at the end of long signatures
    are particularly fragile (wrong-position bugs land silently as
    "the timing is off by 0.5"). AGENTS.md violation.

21. **Tests use `as never` to skip type checking on `SynthParams`.**
    `useCases/__tests__/drumKitSynth.spec.ts:14`:
    `params: {} as never` — explicitly bypasses the type system. User
    memory: "No `as never` escapes — `as never`/`as unknown`/`as any`
    are escape hatches that hide bugs; fix types properly."

22. **Tautological tests.** Three spec files do not assert behaviour:
    - `useCases/__tests__/builtinSynth.spec.ts:1-21` — only checks
      `typeof subject.scheduleNote === 'function' || 'object'`. No
      assertions on the produced graph, the envelope timing, or the
      number of nodes.
    - `useCases/__tests__/drumKitSynth.spec.ts:14` — only checks the
      `DrumKit` type compiles by stuffing `as never`.
    - `useCases/__tests__/proSynthInstruments.spec.ts:25-31` — checks
      `dsp.length > 0` and `params.length > 0`, but never validates
      that the registered parameter `address` strings match the
      `hslider` definitions in the `.dsp` source. A typo in the
      registration (`'/wt/morph'` → `'/wt/morf'`) would pass the
      test and silently break the slider mapping at runtime.

23. **Drum voice tests hit the type system, not the audio graph.**
    `drumSynthEngine/__tests__/kitDefinitions.spec.ts` and
    `drumSynthEngine/kitDefinitions/__tests__/{getDrumKitDefByIndex,
scheduleDrumKitNote}.spec.ts` test lookups, not the produced
    `OscillatorNode` count, frequency sweeps, or velocity scaling.
    The 808 voice schedulers in `engine/drumSynthVoices.ts` (10
    voices, ~150 lines each) ship with **no** behavioural test
    coverage at all. Regressions in the kick pitch sweep or the clap
    multi-tap echo would not be caught.

24. **`registerProSynthInstruments` is not idempotent — second call
    actively destroys the compiled module.** `proSynthInstruments.ts:18`
    plus `Plugin/useCases/faustEngine/compilerEngine.ts:110-138`
    (verified 2026-04-28): `registerFaustDSP` builds a fresh
    `FaustModule` with `compiled: false, generator: null` then runs
    `modules.set(mod.id, mod)`. The second call therefore **erases**
    the compilation state and the cached generator from the first
    call. Any AudioWorkletNodes already created from the first
    `generator` keep working (they hold the WASM module), but the
    next `compileFaustDSP(mod.id)` call sees `compiled: false` and
    re-compiles from scratch — and any caller awaiting the in-flight
    compile via `compilationPromises` will still get the old promise
    while subsequent `createFaustNode` lookups see the replaced
    module. React StrictMode + dev HMR re-mounts `useAppInitialization`
    (`useAppInitialization.ts:31, 50`) and triggers exactly this
    scenario.

25. **Faust DSP `address` strings drift silently from `.dsp` source —
    and the `/wt/`, `/supersaw/`, `/pm/`, `/additive/`, `/synth/`
    prefixes are fabricated.** Verified 2026-04-28 against
    `dsp/morphing-synth.dsp`, `dsp/supersaw-unison.dsp`,
    `dsp/physical-model-string.dsp`, `dsp/additive-synth.dsp`. None
    of the four `.dsp` files declare a `vgroup("wt", …)`,
    `vgroup("supersaw", …)`, `vgroup("pm", …)`, or
    `vgroup("additive", …)` block — every `hslider` is at top level,
    so the actual Faust-generated address is `/<ProcessorName>/<sliderName>`.
    The TS side claims `/wt/morph`, `/supersaw/lfo_rate`, etc.
    Salvaged at runtime by `AudioEngine/repositories/faustDeviceFactory.ts:117-134`
    `buildParamAddressCache` which strips the path with `key.split('/').pop()`
    and matches by **bare name** — meaning the labels would survive
    even if the prefixes were `/totally/wrong/morph` as long as the
    bare slider name matches. The address string is therefore **a
    documentation lie**: developers reading `proSynthInstruments.ts:25`
    believe `/wt/morph` is meaningful, but it is purely advisory;
    only the last path segment is honoured. The lie compounds: if a
    `.dsp` source ever does add a `vgroup`, the bare-name cache
    would silently shadow conflicting names from different groups,
    and the warning at `:128-130` ("Duplicate bare param") would
    surface but not surface anywhere actionable.

26. **`proSynthInstruments.makeSynthParams` typing is loose.**
    `proSynthInstruments.ts:254-291`: `extra` is typed `Array<{
address; label; min; max; defaultValue; step }>`, but the spread
    body adds `type: 'hslider' as const` — so the consumers (who get
    a `FaustParamDescriptor`) see `type` only because of the
    `... as const` widening. If `FaustParamDescriptor` later requires
    `scaling`, this code will compile and silently produce
    descriptors without scaling. `satisfies FaustParamDescriptor[]`
    on the return value would catch this.

27. **`stores/cvGate.ts:VOLTAGE_RANGES` is hard-coded for 808-style
    Eurorack but no validation enforces it.** `:49-56`: `'cv-pitch':
[-2, 8]` is the standard 1V/oct range for 5-octave keyboards. But
    `addCvOutput` does not validate that `outputChannel` is unique,
    or within the device's available channels, or that the same type
    isn't already present. Two `addCvOutput('Pitch', 0, 'cv-pitch')`
    calls produce two channels claiming output 0.

28. **`setCvValue` clamps to `[0, 1]`, but the channel has explicit
    `minVoltage` / `maxVoltage`.** `cvGate/cvOutputOperations/setCvValue.ts:11`:
    `Math.max(0, Math.min(1, value))`. A pitch CV channel with range
    `[-2, 8]` (10 V span) is being treated as a normalised `[0, 1]`
    value — meaning the entire negative pitch range is clipped, and
    the positive range is squashed to `[0, 1]`. Either the
    documentation is wrong (callers must pre-normalise) or the clamp
    is wrong. There is no public contract document.

29. **`midiNoteToCv` in Hz/V mode returns frequency in Hz, not
    voltage.** `cvGate/cvConversion/midiNoteToCv.ts:16`: `return 440 *
2 ** ((note - 69) / 12)` — that is **frequency**, not voltage. Hz/V
    standards (e.g. Korg MS-20) use 1 V per octave referenced to a
    base voltage, not frequency-as-voltage. Returning 440 (Hz) into a
    DAC expecting volts produces a 440 V signal — which physically
    rails at the supply. If a downstream caller treats the return as
    "Hz to convert", it wastes a unit conversion. Either way, the
    function name promises CV.

30. **`getClockValue` returns `1` at exactly `phase = 0`.**
    `cvGate/cvConversion/getClockValue.ts:5`: `phase < 0.5 ? 1 : 0`.
    For a clock at `t = 0`, the test expects `1`. For `t = 0.25` at
    120 BPM, it expects `0`. But the test uses `division = 1`
    (default) — actually `division` here is **multiplied** by BPM
    (line 3). The variable is named `clockDivision` in the store but
    the conversion function multiplies. A "division" should reduce
    pulse rate, not multiply it. Naming bug + math bug.

31. **`triggerPulseMs` and `gateThreshold` are dead code.**
    `stores/cvGate.ts:29-31` declares them, persists them, but no
    file in this module reads them. AGENTS.md task focus: dead state
    in a persisted store is forward-incompatible because it ships with
    every saved project.

32. **No public events, but the module needs them.**
    `events/index.ts` is `// no public events`. CV/Gate state changes
    (e.g. `cvOutputAdded`, `voltageStandardChanged`) are not
    broadcast. Downstream modules that need to react to CV
    re-configuration must poll the store.

33. **`stores/cvGate.ts` exports `getNextOutputId` (UUID) and
    `VOLTAGE_RANGES` (constant lookup) from a `stores/` file.** Per
    AGENTS.md "stores/" is for persisted state. A pure helper
    (`getNextOutputId`) and a domain constant (`VOLTAGE_RANGES`)
    belong in `services/` (none exist in this module) or `models/`.
    The current placement makes `stores/cvGate.ts` import-heavy
    (`createStore`, `createAutomergeStorage`, plus helper exports),
    which complicates HMR and tests.

34. **No `dispose` / `cancelScheduledNotes` API.** Neither
    `scheduleNote` nor `scheduleKitNote` returns a handle that can
    cancel pending events. The `OscillatorNode` is returned, but
    cancelling it requires the caller to track every related node.
    For a "stop all sound" panic button, the only path is destroying
    the destination node. AGENTS.md "user-centric perspective" — DAW
    expectation is `panic / all-notes-off` works.

35. **`useCases/builtinSynth.ts` keeps a `cachedNoiseBuffer:
    AudioBuffer | null` module-level singleton — and the cache key is
    sample-rate-only, not `(ctx, sampleRate)`.** `builtinSynth.ts:39-52`
    (verified 2026-04-28). Two `BaseAudioContext`s with the same
    `sampleRate` (e.g. realtime `AudioContext` at 48 kHz and an
    `OfflineAudioContext` at 48 kHz used for export) will share the
    same cached buffer — but `AudioBuffer` instances are **bound to
    a single context**: passing a buffer minted on context A to a
    `BufferSource` in context B is undefined behaviour in the spec
    and throws in some browsers. The `engine/drumSynthVoices.ts:22`
    cache uses `WeakMap<BaseAudioContext, …>` and is correct; this
    one is wrong by structure. HMR-only concerns are secondary; the
    cross-context bug is the load-bearing one.

36. **Cross-module imports of `SynthParams` / `MpeParams` create a
    cyclic dependency surface.** `useCases/builtinSynth.ts:6` and
    `useCases/drumKitSynth.ts:8` import `SynthParams` / `MpeParams`
    **from** `#/modules/AudioEngine/useCases`. AudioEngine then uses
    `scheduleNote` / `scheduleKitNote` from `#/modules/Synth/useCases`
    (`AudioEngine/useCases/audition.ts`,
    `AudioEngine/useCases/offlineRender/scheduleTrackClips.ts`). The
    types are owned by AudioEngine but the implementations live here.
    AGENTS.md "Model isolation: Models are strictly private to their
    owning module and must never be exported or re-exported across
    module boundaries — not even through `useCases/`. If module B
    needs data shaped like module A's model, module B defines its
    own local type containing only the fields it uses." `SynthParams`
    is the canonical synth model — it should live in **Synth**'s
    `models/`, not in AudioEngine's `useCases/`. Today it's
    upside-down.

37. **`Device` type duplicated locally in `builtinSynth.ts`.**
    `:9` `type Device = { type: string; parameterValues: Record<string,
number> }`. Comment says "Consumer-local shape (AGENTS.md §95 —
    model isolation)". OK per the rule. But the same shape is
    re-defined in callers (`getSynthParamsForTrack.ts` etc.) — fine if
    truly local, but no test asserts the structural compatibility, so
    a divergence in the upstream `Device` model goes silent.

38. **`useCases/index.ts` re-exports nothing typed**, but downstream
    modules (e.g. `Transport/scheduling/scheduleMidiNotes.ts:15`)
    import non-type values. AGENTS.md is satisfied for type-leakage,
    but `scheduleNote`'s return type is `OscillatorNode` — exposing
    a Web Audio primitive across module boundaries leaks
    implementation. Future Synth implementations on a worklet would
    require a v2 of the contract.

39. **No `polyphony` parameter in `SynthParams`.** Real synths cap
    polyphony (e.g. 8/16-voice limits) and have a "voice steal" mode
    (oldest / quietest / lowest). `SynthParams` (defined in
    `AudioEngine/useCases`) has no polyphony or voice-stealing
    parameter. There is no voice manager. A held chord plus a
    sustained pattern produces unbounded note allocation.

40. **Oscillator anti-aliasing.** `OscillatorNode` with `type:
'sawtooth'` / `'square'` is band-limited by Web Audio (uses
    `PeriodicWave` internally), so anti-aliasing is "good enough" for
    the realtime path. For offline render at higher sample rates the
    band-limiting is correct. **However**, the 808 hi-hat
    (`drumSynthVoices.ts:161-168`) uses 6 raw `square` oscillators at
    800-1864 Hz with no further anti-aliasing — which is the canonical
    808 sound, but the Web Audio square is band-limited differently
    from a real analog square, producing audibly different artefacts.
    Cosmetic. The cowbell (`:228-235`) has the same shape.

41. **`drumKitSynth.findVoice` linear scan, not interval tree.**
    `drumKitSynth.ts:24-31`: O(n) per pitch lookup. With the current
    kit size (15 voices) this is fine. If kits grow, becomes a
    per-note hot-path cost. Note: `findVoiceByNote`
    (`drumSynthEngine/.../scheduleDrumKitNote.ts:4`) is also linear
    over `kit.voices`.

42. **No `velocity` curve / response shaping.** `scheduleNote` uses
    raw `velocity / 127` for `peakGain`. Real instruments (and most
    DAWs) provide a velocity curve (`exponential`, `s-curve`,
    `linear`). Not a bug; missing feature.

43. **No filter envelope **release** stage.** `builtinSynth.ts:240-241`
    decays the filter from `filterPeak` to `filterCutoff`, but nothing
    happens at note-off. A natural sound shape decays the filter
    further during release. Not a bug; missing nuance.

44. **`engine/drumSynthVoices.ts:schedule808Kick` waveshaper allocates
    a `Float32Array(256)` per kick.** `:58-62`: same curve every
    time, but freshly allocated. Cache the curve as a module-level
    constant.

45. **`engine/drumSynthVoices.ts` has no test coverage at all** for
    the actual scheduling. Twelve voice functions (`schedule808Kick`,
    `schedule808Snare`, etc.) ship with zero behavioural specs. The
    only scheduler test is
    `drumSynthEngine/kitDefinitions/__tests__/scheduleDrumKitNote.spec.ts`
    which (likely) tests routing only. Compounded by issue #14, this
    is a dark corner of the codebase.

46. **`SetVoltageStandard` uses `import('../../../stores/cvGate').VoltageStandard`
    inline.** `cvGate/cvOutputOperations/setVoltageStandard.ts:3` uses
    inline `import('...')` syntax for the type instead of a top-level
    `import type { VoltageStandard }`. Cosmetic; AGENTS.md prefers
    explicit `import type` at the top of the file.

47. **`useCases/dsp/*.dsp` files live under `useCases/`.** AGENTS.md
    "useCases/ contains TypeScript use cases, one function per file".
    The Faust DSP source files are not TypeScript, not functions, and
    not strictly use cases — they are **data** read by `?raw`. They
    belong in `engine/dsp/` or a `services/dsp/` location alongside
    the synth that consumes them. Consumers use `?raw` imports
    (Vite-specific syntax) which couples this module to Vite.

48. **`scheduleNote` returns `OscillatorNode` — but a caller could
    erroneously use it as the "note handle".** A naïve caller calling
    `osc1.stop(...)` to release the note will not stop osc2 / subOsc /
    noiseSource / vibratoLfo — they continue ringing past the cleanup
    closure. Returning the primary `OscillatorNode` is leaky; a
    `NoteHandle` (or the cleanup function) would be more honest.

49. **`startFaustNote` returns `() => void` ("stop"), but
    `scheduleFaustNote` returns `void` and embeds the stop in the
    schedule itself.** Inconsistent contract. A caller wanting
    "schedule with cancellable handle" (e.g. a live MIDI input) gets
    `startFaustNote`; a caller wanting "schedule a fixed-duration
    note" (e.g. clip playback) gets `scheduleFaustNote`. Both pull
    from `AudioEngine/useCases`. Document the dichotomy or unify.

50. **`startFaustNote.ts:13` reads `getCurrentTime()` lazily inside
    the cleanup closure.** This is correct in spirit (release at the
    moment the user releases the key), but the closure crosses
    module boundaries — the contract that `getCurrentTime()` is
    callable from any thread / context is not asserted. If it ever
    returns a time that lags the audio clock, all release timings
    drift.

51. **CV/Gate sub-tree mutates the persisted store directly without a
    handler indirection.** All five `cvOutputOperations/` files call
    `cvGateStore.set(...)`. There is no `AppAction` for these — the
    only consumer (`AudioEngine/handlers/finalFeature/handleAddCvOutput.ts`)
    is a wrapper. AGENTS.md "Use cases orchestrate repositories" —
    direct store writes from `useCases/` is the standard pattern in
    this codebase, but the absence of a `cvHandlers` map means CV
    state is not reachable from the command bus. Non-bug, but a
    future "undo/redo CV setup" feature would need handler-level
    integration.

52. **Audition reaches into the returned `OscillatorNode` for an
    `_env` GainNode that `scheduleNote` never attaches.**
    `AudioEngine/useCases/audition.ts:124` `scheduleNote(...) as
    OscillatorNode & { _env?: GainNode }` and `:129-132` reads
    `osc._env` to call `cancelScheduledValues + setTargetAtTime`. But
    `builtinSynth.scheduleNote` (`builtinSynth.ts:114-333`) never
    sets `_env` — `grep -n "_env" src/modules/Synth/useCases/builtinSynth.ts`
    is empty. The release branch is permanently dead. Audition uses
    `duration = 60` (`audition.ts:121`); a key-up triggers
    `osc.stop(killTime + releaseTime + 0.05)` which only stops osc1
    while osc2/sub/noise/vibrato/env keep running until their own
    pre-scheduled stop times **60+ seconds out**. Zombie note bug,
    user-visible as "the audition keeps singing after I let go".

53. **`handleAddCvOutput` casts `payload.type as CvOutputType` and is
    `undoable: true` with no inverse.**
    `AudioEngine/handlers/finalFeature/handleAddCvOutput.ts:9`. AGENTS.md
    soundness violation. `addCvOutput` returns `void` and the handler
    has no undo descriptor — the command bus tracks a non-undoable
    mutation as undoable, so the user clicks "undo" and the channel
    stays. Compounding: `payload.type` from `AiRuntime/models/RuntimeAction.ts:318`
    is `string`, so a malformed AI runtime payload crashes
    `addCvOutput.ts:8` (`VOLTAGE_RANGES[type]` returns `undefined`,
    `[minV, maxV]` throws).

54. **Entire CV/Gate sub-system is dead code that ships persisted
    state.** Verified 2026-04-28 via grep: `midiNoteToCv`,
    `velocityToCv`, `getClockValue`, `setCvValue`, `removeCvOutput`,
    `setVoltageStandard`, `setClockDivision` have **zero** external
    callers. Only `addCvOutput` is wired (one `AppAction`) and that
    path is broken (#53). There is no DC-coupled output device
    strategy, no UI rendering CV channel state, no audio-thread code
    that consumes the persisted `outputs[]`. Yet `cvGateStore`
    (`stores/cvGate.ts:33-42`) is an Automerge-persisted document
    written into every project file. The bugs in #5, #6, #7, #19,
    #28 are all real but unreachable today — they will surface the
    moment a developer wires the feature, with no test coverage on
    the integration path.

55. **Velocity-attack scaling is hard-coded with no opt-out and can
    go negative for out-of-range velocity.** `builtinSynth.ts:127`:
    `velAttack = params.attack * (1.5 - velocity / 127)`. User
    configures `attack = 1s` and gets 0.5s..1.5s — 3× variation,
    no slider to disable. Same shape duplicated in
    `scheduleNoteOffline.ts:386`. **More serious**: there is no clamp
    on `velocity` at the entry point. A velocity of 200 (e.g. an
    MPE pressure source mis-mapped, or an AI runtime payload
    bypassing validation) yields `velAttack = -0.075 * attack`, so
    `attackEnd < startTime` and the `linearRampToValueAtTime`
    schedules an event in the past. Web Audio behaviour for past
    events is implementation-defined.

56. **Offline render parity gap — drum kits render at full fidelity
    but builtin synth doesn't.** `AudioEngine/useCases/offlineRender/scheduleTrackClips.ts:286-308`
    routes `kitDef` and `drumKit` through realtime full-fat
    schedulers (`scheduleDrumKitNote` / `scheduleKitNote`) but
    builtin synth tracks through `scheduleNoteOffline` (3 nodes per
    note, no osc2/sub/noise/vibrato/spread). A track with both will
    sound like a "small" synth next to "full" drums in the bounce —
    incoherent mix between layers in the same project. Issue #4
    captures the synth side; this is the parity-mismatch dimension.

57. **`getSynthParamsFromDevices` and the scheduling-site dispatch
    define "is this a synth track?" with two different rules.**
    `builtinSynth.ts:341` matches `d.type === 'synth' ||
    d.type.startsWith('builtin-synth')`. The scheduling sites
    (`Transport/scheduling/scheduleMidiNotes.ts:462`,
    `AudioEngine/useCases/audition.ts:115-124`) call `scheduleNote`
    for **anything that didn't match drum/Faust/levain/fermenter/toaster/grand-boule** —
    a "default" branch. A device with `type = 'builtin'` (typo or
    new feature) routes to `scheduleNote` with **default**
    `SynthParams` (the `find` returns `undefined`, params resolver
    returns the default), silently degrading character. The two
    halves of "what is a synth" disagree.

---

## Priorities

1. **Audition's `_env` reach-through is broken — zombie notes after
   key-up** (finding #52, open issue #36). User-visible audition
   bug: held notes ring for 60 seconds after release because
   `osc._env` is `undefined` and the soft-release branch never
   fires. Priority #1 because it's a bug-on-the-happy-path.
2. **`registerProSynthInstruments` second call wipes compiled state**
   (finding #24, deepened). React StrictMode + dev HMR re-runs the
   effect, the second call replaces the compiled `FaustModule` with
   `compiled: false, generator: null`, breaking Faust instruments
   for the rest of the dev session. Real, frequently-encountered.
3. **Whole CV/Gate sub-tree is dead code with broken handler**
   (findings #54 + #53, open issues #41 + #38). Either build the
   feature (DC-coupled output strategy + UI) or delete the
   sub-tree. Half-shipped state with broken `as` casts and a
   `undoable: true` no-op handler.
4. **Two parallel "drum kit" abstractions in the same barrel** (issue
   #1) — choose one. Confusing, ships partially-tested code paths.
5. **No voice management / polyphony cap / panic** (issues #3, #34,
   #39) — high-density sequence piles up unbounded nodes; no panic.
6. **`scheduleNoteOffline` drops half the synth + drum kits don't**
   (issues #4 + #40). Offline render is incoherent across layers in
   the same project.
7. **CV/Gate semantics are broken** (issues #5, #6, #7) — but moot
   if the feature is deleted (priority #3).
8. **Velocity-clamp drift across three call paths** (issue #8) +
   **velocity-attack negative-attack bug** (#39).
9. **Test coverage tautologies + zero `engine/drumSynthVoices.ts`
   coverage** (issues #11, #20, #27).
10. **`SynthParams` ownership is upside-down** (issue #9) — canonical
    synth-parameter model lives in AudioEngine, not Synth.
11. **No module root barrel `index.ts`** (issue #2) — every external
    import violates AGENTS.md cross-module rules.
12. **Function signatures are 5-9 positional parameters** (issue #10).
10. **Faust DSP parameter `address` strings are not cross-checked**
    (issue #25) — silent drift between TS and DSP is a class of bug
    that lands in production with no test coverage.

---

## Open issues

### 1. Two parallel "drum kit" abstractions in the public surface

**Problem:** `useCases/index.ts` exports both
`scheduleKitNote` (subtractive synth voices addressed by `pitchRange:
[low, high]` + `SynthParams`) and `scheduleDrumKitNote` (analog 808
voices addressed by `midiNote: number` + `DrumVoiceType`). Their
`DrumKit` / `DrumKitDef` types are not interchangeable. Downstream
(`Transport/scheduling/scheduleMidiNotes.ts:15`) imports both. There
is no spec or comment explaining when to use which.

**Representative files:**

- `src/modules/Synth/useCases/drumKitSynth.ts:12,33`
- `src/modules/Synth/useCases/drumSynthEngine/kitDefinitions/scheduleDrumKitNote.ts:11`
- `src/modules/Synth/useCases/index.ts:7-13`
- `src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts:15`

**Needed:** Pick one. If both must coexist (e.g. `scheduleKitNote` is
for **synthesised** drum kits using subtractive synthesis,
`scheduleDrumKitNote` is for the **analog 808 emulation**), rename
them to make that intent explicit (`scheduleSynthKitNote` /
`scheduleAnalogKitNote`) and document in `useCases/index.ts`. If one
is dead, delete it.

### 2. No module root `src/modules/Synth/index.ts` barrel

**Problem:** AGENTS.md mandates that cross-module imports target the
destination module's root `index.ts`. Synth has no such file.
Downstream modules (`AudioEngine/useCases/audition.ts`,
`Transport/useCases/scheduling/scheduleMidiNotes.ts`,
`Workspace/presentations/hooks/useAppInitialization.ts`,
`Arrangement/useCases/getSynthParamsForTrack.ts`,
`AudioEngine/handlers/finalFeature/handleAddCvOutput.ts`,
`AudioEngine/repositories/webMidi/messageHandlers.ts`,
`AudioEngine/useCases/offlineRender/scheduleTrackClips.ts`) import
from `#/modules/Synth/useCases`. That bypasses the contract surface.

**Representative files:**

- `src/modules/Synth/` (no root `index.ts`)
- 8 external import sites listed above.

**Needed:** Create `src/modules/Synth/index.ts` re-exporting the
curated public surface from `useCases/`, `events/`, `stores/`. Migrate
the 8 external call sites to import from `#/modules/Synth`.

### 3. No voice manager, no polyphony cap, no panic / all-notes-off

**Problem:** `scheduleNote` allocates an unbounded number of node
graphs. There is no `MAX_VOICES`, no oldest-voice eviction, no
priority queue, no "stop all" handle. A high-density input or a
sequencer with overlapping notes will pile up node graphs until the
audio context glitches or runs out of memory.

**Representative files:**

- `src/modules/Synth/useCases/builtinSynth.ts:114-333`
- `src/modules/Synth/useCases/drumKitSynth.ts:33-48`
- `src/modules/Synth/engine/drumSynthVoices.ts:345-399`

**Needed:** Add a voice manager service in `services/` (currently
absent) that tracks active voices per `(trackId, deviceId)`, enforces
a polyphony cap (e.g. 16), and offers a `stopAllNotes` /
`cancelPending` API. Wire `scheduleNote` to register/unregister via
the manager. Expose a panic action through the command bus.

### 4. `scheduleNoteOffline` drops osc2 / sub / noise / vibrato / spread

**Problem:** `scheduleNoteOffline` is a "lightweight" path used during
offline render (`AudioEngine/useCases/offlineRender/scheduleTrackClips.ts`).
It explicitly drops the second oscillator, sub-oscillator, noise
layer, vibrato LFO, and stereo spread. The realtime path uses all
five. A user bounces a track, expecting the bounce to match what they
heard during monitoring; instead, the bounce is missing half the
synth's character.

**Representative files:**

- `src/modules/Synth/useCases/builtinSynth.ts:376-441`
- `src/modules/AudioEngine/useCases/offlineRender/scheduleTrackClips.ts`

**Needed:** Either (a) make `scheduleNoteOffline` produce the same
graph as `scheduleNote` (the offline `OfflineAudioContext` runs much
faster than realtime — the perf "savings" of dropping 60% of the
nodes are mostly imaginary), or (b) document this divergence as a
known limitation and add a "Render Quality: Draft / Full" toggle so
the user opts in. If keeping divergent paths, factor a shared
`buildSynthVoice(ctx, params, options)` so the two paths cannot drift
further (no `osc2`-related code in offline today, but the filter
envelope math was already cloned by hand and could drift on the next
edit).

### 5. CV/Gate `setCvValue` clamps to `[0, 1]` ignoring channel range

**Problem:** Each `CvOutputChannel` has explicit `minVoltage` /
`maxVoltage`. `setCvValue` ignores both and clamps to `[0, 1]`. For a
`cv-pitch` channel with range `[-2, 8]`, callers passing a real
voltage are silently mapped into `[0, 1]`. There is no documentation
saying values are normalised.

**Representative files:**

- `src/modules/Synth/useCases/cvGate/cvOutputOperations/setCvValue.ts:3-13`
- `src/modules/Synth/stores/cvGate.ts:14-23,49-56`

**Needed:** Decide the contract. If the store holds **normalised**
`[0, 1]` values, document it on the `value` field and rename
`setCvValue` to `setNormalisedCvValue`. If the store holds **voltage**,
clamp to `[output.minVoltage, output.maxVoltage]` instead. The current
code is internally inconsistent.

### 6. `midiNoteToCv` Hz/V mode returns frequency in Hz, not voltage

**Problem:** `cvGate/cvConversion/midiNoteToCv.ts:16` returns
`440 * 2 ** ((note - 69) / 12)` for `voltageStandard === 'hz-per-volt'`.
That's frequency, not voltage. Actual Hz/V converters (e.g. Korg MS-20
clones) take an exponential mapping; for a typical Korg MS-20-style
spec, "1 V doubles the frequency" — voltage = `log2(freq / refFreq)`,
not the raw frequency. The function name promises CV.

**Representative files:**

- `src/modules/Synth/useCases/cvGate/cvConversion/midiNoteToCv.ts:8-17`
- `src/modules/Synth/useCases/cvGate/__tests__/cvConversion.spec.ts:20-25`

**Needed:** Replace the Hz/V branch with the actual voltage mapping
for the chosen reference standard (Korg MS-20 uses
`V = log2(freq / 27.5)` referenced to A0 = 27.5 Hz, with a 0.32 V/oct
or similar — depends on the target hardware). Update the test (which
currently asserts the wrong behaviour). Add a doc comment with the
target hardware spec referenced.

### 7. `getClockValue` `division` multiplies, not divides

**Problem:** `cvGate/cvConversion/getClockValue.ts:3-5`:
`pulsePerSec = (bpm / 60) * division`. The store field is named
`clockDivision`. A "division" of 4 should mean "1 pulse every 4 beats"
(quarter the rate); the current code makes it "4 pulses per beat"
(quadruple the rate). Naming/semantics mismatch.

**Representative files:**

- `src/modules/Synth/useCases/cvGate/cvConversion/getClockValue.ts:1-6`
- `src/modules/Synth/useCases/cvGate/__tests__/cvConversion.spec.ts:39-44`

**Needed:** Decide whether this is "division" (divide rate) or
"multiplier" (multiply rate). Rename the parameter and store field to
match. Update the test (which only tests `division = 1`, so it doesn't
exercise the bug).

### 8. Velocity clamping diverges across three schedulers

**Problem:** Three schedulers, three contracts:
- `drumSynthEngine/.../scheduleDrumKitNote.ts:24` — clamps `[0,127]`,
  no floor.
- `faustInstrumentScheduler/scheduleFaustNote.ts:12` — clamps
  `[0,127]`, with `Math.floor`.
- `drumKitSynth.scheduleKitNote` (`drumKitSynth.ts:33-48`) — does **not**
  clamp at all; forwards `velocity` raw and `clipGain` separately into
  `scheduleNote`.

The three call sites can produce different audible levels for the same
input.

**Representative files:**

- `src/modules/Synth/useCases/drumKitSynth.ts:33-48`
- `src/modules/Synth/useCases/drumSynthEngine/kitDefinitions/scheduleDrumKitNote.ts:24`
- `src/modules/Synth/useCases/faustInstrumentScheduler/scheduleFaustNote.ts:12`

**Needed:** Define a single helper (`scaleAndClampVelocity({velocity,
clipGain})`) in a `services/` file (none exist yet — create one).
Update all three schedulers to call it. Pick floor / round / no-round
once and apply everywhere.

### 9. `SynthParams` / `MpeParams` ownership upside-down

**Problem:** `SynthParams` and `MpeParams` are imported from
`#/modules/AudioEngine/useCases` by `Synth/useCases/builtinSynth.ts:6`
and `Synth/useCases/drumKitSynth.ts:8`. The Synth module **is** the
canonical synthesizer; AudioEngine should not own its parameter
schema. AGENTS.md "Model isolation: Models are strictly private to
their owning module … If module B needs data shaped like module A's
model, module B defines its own local type containing only the fields
it uses."

**Representative files:**

- `src/modules/Synth/useCases/builtinSynth.ts:6`
- `src/modules/Synth/useCases/drumKitSynth.ts:8`
- `src/modules/AudioEngine/useCases/index.ts` (probable export site)

**Needed:** Move `SynthParams` and `MpeParams` to
`src/modules/Synth/models/SynthParams.ts` (private to Synth). Have
AudioEngine duplicate the fields it actually consumes (per AGENTS.md,
duplication is intentional). Update the cross-module imports.

### 10. Function signatures: 5-9 positional parameters

**Problem:** Pervasive across the module. AGENTS.md "Functions with
more than one parameter take a single object param". Worst offenders:

- `builtinSynth.scheduleNote` — 9 positional (`ctx, destination, pitch,
startTime, duration, velocity, params, mpe?, clipGain=1.0`).
- `builtinSynth.scheduleNoteOffline` — 7 positional.
- `drumKitSynth.scheduleKitNote` — 8 positional.
- `drumSynthEngine/.../scheduleDrumKitNote.scheduleDrumKitNote` — 7
  positional.
- All ten `engine/drumSynthVoices.ts:schedule808*` functions — 4-5
  positional.
- `faustInstrumentScheduler.scheduleFaustNote` — 7 positional.
- `cvGate/cvOutputOperations/addCvOutput` — 3 positional.
- `cvGate/cvOutputOperations/setCvValue` — 2 positional.
- `cvGate/cvConversion/{velocityToCv, getClockValue}` — 2-3 positional.

The trailing `clipGain: number = 1.0` defaults are particularly
fragile.

**Representative files:**

- `src/modules/Synth/useCases/builtinSynth.ts:114,376`
- `src/modules/Synth/useCases/drumKitSynth.ts:33`
- `src/modules/Synth/useCases/drumSynthEngine/kitDefinitions/scheduleDrumKitNote.ts:11`
- `src/modules/Synth/engine/drumSynthVoices.ts:44,74,110,146,184,214,241,273,299,320,345`
- `src/modules/Synth/useCases/faustInstrumentScheduler/{startFaustNote,scheduleFaustNote}.ts`
- `src/modules/Synth/useCases/cvGate/cvOutputOperations/{addCvOutput,setCvValue}.ts`
- `src/modules/Synth/useCases/cvGate/cvConversion/{velocityToCv,getClockValue}.ts`

**Needed:** Refactor each module-level function to take a single
object param (`ScheduleNoteInput`, `ScheduleKitNoteInput`,
`Schedule808VoiceInput`, etc.). Update all call sites — including the
external ones in AudioEngine, Transport, AiRuntime. Mechanical, but
must be done file-by-file (user memory: no automated bulk edits).

### 11. Tautological tests + zero coverage on `engine/drumSynthVoices.ts`

**Problem:** Three spec files assert nothing meaningful:
- `useCases/__tests__/builtinSynth.spec.ts:1-21` — only checks
  `typeof === 'function' || 'object'`.
- `useCases/__tests__/drumKitSynth.spec.ts` — only checks the type
  compiles (`params: {} as never`).
- `useCases/__tests__/proSynthInstruments.spec.ts:25-31` — checks
  `dsp.length > 0` and `params.length > 0`, never validates parameter
  `address` strings against the `.dsp` source.

The 10 voice schedulers in `engine/drumSynthVoices.ts` (~400 lines)
have **no** behavioural tests at all.

**Representative files:**

- `src/modules/Synth/useCases/__tests__/builtinSynth.spec.ts`
- `src/modules/Synth/useCases/__tests__/drumKitSynth.spec.ts`
- `src/modules/Synth/useCases/__tests__/proSynthInstruments.spec.ts`
- `src/modules/Synth/engine/drumSynthVoices.ts` (no tests)

**Needed:** Use `OfflineAudioContext` to render `scheduleNote` /
`scheduleKitNote` / each `schedule808*` and assert the rendered
buffer's RMS, peak, and (where applicable) frequency-domain peak. For
`registerProSynthInstruments`, parse the `.dsp` source to extract
`hslider("name", …)` definitions and assert each registered
`address` matches.

### 12. Faust DSP parameter `address` strings drift silently from `.dsp` source

**Problem:** `proSynthInstruments.ts` hard-codes parameter `address`
strings (`'/wt/morph'`, `'/supersaw/lfo_rate'`, etc.). The `.dsp`
sources use `hslider("morph", …)` — Faust constructs the address by
prepending the group path. There is no compile-time check that the
TS-side `address` matches a slider that exists in the compiled DSP.

**Representative files:**

- `src/modules/Synth/useCases/proSynthInstruments.ts:18-251`
- `src/modules/Synth/useCases/dsp/{morphing-synth,supersaw-unison,physical-model-string,additive-synth}.dsp`

**Needed:** Either (a) parse the `.dsp` source at build time (Vite
plugin) and inject typed parameter descriptors so a TS edit cannot
diverge, or (b) add a runtime warning in `registerFaustDSP` (Plugin
module) when an `address` does not resolve to a slider; surface as a
test that loads each registered DSP into the Faust compiler and asserts
parameter resolution.

### 13. Vibrato LFO redundant zero-ramp + no rate envelope

**Problem:** `builtinSynth.ts:287-289` writes
`setValueAtTime(0, startTime)` followed by `linearRampToValueAtTime(0,
attackEnd + vibDelay)` (a zero-to-zero ramp = a no-op event), then
ramps to `params.vibratoDepth` over 100 ms. The second ramp is correct
but the first ramp is meaningless and clutters the param-event list.
There is also no envelope on the LFO **rate** — vibrato doesn't speed
up over the duration, which most expressive synths offer. (#43 covers
the rate envelope omission as a missing feature.)

**Representative files:**

- `src/modules/Synth/useCases/builtinSynth.ts:280-300`

**Needed:** Replace the redundant ramp with a `setValueAtTime(0,
attackEnd + vibDelay)` so the depth holds at 0 until the delay
endpoint, then ramps in. Document the units of `vibratoDepth` (cents,
because it connects to `osc.detune`).

### 14. No filter envelope release stage; release ramp may click

**Problem:** Two related issues:
- The filter envelope (`builtinSynth.ts:234-244`) ramps from
  `filterPeak` to `filterCutoff` during decay, then holds. There is no
  `release` stage that brings the filter back to a low value at
  note-off (a common shape for synth pads).
- The amplitude release uses
  `env.gain.linearRampToValueAtTime(0, releaseEnd)` from
  `sustainLevel`. A linear ramp produces a slope discontinuity at
  `releaseEnd` — perceptually a soft click for high `sustainLevel` /
  short `release`. Standard practice is `setTargetAtTime` for an
  exponential decay.

**Representative files:**

- `src/modules/Synth/useCases/builtinSynth.ts:234-244,253-270`
- `src/modules/Synth/useCases/builtinSynth.ts:404-432` (offline path
  has the same shape).

**Needed:** Use `setTargetAtTime` for amplitude release. Add an
optional filter envelope release stage parameter
(`filterEnvRelease?: number`) and ramp the filter back to a configurable
value at note-off.

### 15. `scheduleNote` returns a leaky `OscillatorNode` handle

**Problem:** Returning the **primary** `OscillatorNode` invites
callers to call `.stop(...)` on it as if it were the note handle —
which would leave osc2/sub/noise/vibrato dangling. There is no
`NoteHandle` abstraction.

**Representative files:**

- `src/modules/Synth/useCases/builtinSynth.ts:114,322-330,332`

**Needed:** Either return a `NoteHandle = { stop(when?): void; cancel():
void }` that wraps the cleanup closure, or change the return type to
`void` and cancel via a separate API (issue #3 voice manager).

### 16. `useCases/dsp/*.dsp` files don't belong under `useCases/`

**Problem:** AGENTS.md "useCases/" is for TypeScript use cases (one
function per file). The four `.dsp` source files are non-TS data, used
via Vite `?raw` imports. They should be co-located with whichever
module owns the runtime that consumes them — either Synth's `engine/`
or a new `services/dsp/`.

**Representative files:**

- `src/modules/Synth/useCases/dsp/{additive,morphing,physical-model-string,supersaw-unison}.dsp`
- `src/modules/Synth/useCases/proSynthInstruments.ts:10-13` (imports)

**Needed:** Move the `.dsp` files to
`src/modules/Synth/engine/dsp/` (or an explicit `services/dsp/` if
that becomes a pattern). Update the four `?raw` imports in
`proSynthInstruments.ts`.

### 17. `stores/cvGate.ts` exports helpers and constants from a `stores/` file

**Problem:** `getNextOutputId` (UUID factory) and `VOLTAGE_RANGES`
(domain constant) live alongside the persisted store
(`stores/cvGate.ts:45-56`). Per AGENTS.md, `stores/` is for persisted
state; pure helpers and constants belong in `services/` (none exist
in this module) or `models/`.

**Representative files:**

- `src/modules/Synth/stores/cvGate.ts:45-56`
- 5 importers in `useCases/cvGate/cvOutputOperations/`.

**Needed:** Move `getNextOutputId` to `services/cvGate/getNextOutputId.ts`
and `VOLTAGE_RANGES` to `models/cvGate.ts`. Update the imports.

### 18. `triggerPulseMs` and `gateThreshold` are dead persisted state

**Problem:** `stores/cvGate.ts:29-31` declares two fields that no code
in the codebase reads. They are persisted in every project file via
Automerge.

**Representative files:**

- `src/modules/Synth/stores/cvGate.ts:29-31,40`

**Needed:** Either implement the trigger / gate logic that uses them,
or remove them from `CvGateState` and provide a one-time migration
that strips them from saved projects.

### 19. `addCvOutput` doesn't validate uniqueness of `outputChannel`

**Problem:** `cvGate/cvOutputOperations/addCvOutput.ts` appends a new
channel without checking whether `outputChannel` is already claimed by
another channel. Two `addCvOutput('Pitch', 0, 'cv-pitch')` calls
produce two channels both writing to physical output 0.

**Representative files:**

- `src/modules/Synth/useCases/cvGate/cvOutputOperations/addCvOutput.ts:3-20`

**Needed:** Validate uniqueness of `outputChannel` (or document that
duplicates are intentional). Return `Result<CvOutputChannel,
DuplicateChannelError>` so callers can react. (User memory: prefer
`neverthrow` for error handling.)

### 20. Tests use `as never` to skip type checking

**Problem:** `useCases/__tests__/drumKitSynth.spec.ts:14` uses
`params: {} as never` to construct a partial `SynthParams` fixture.
User memory: "No `as never` escapes — `as never`/`as unknown`/`as any`
are escape hatches that hide bugs; fix types properly."

**Representative files:**

- `src/modules/Synth/useCases/__tests__/drumKitSynth.spec.ts:14`

**Needed:** Build a typed `SynthParams` fixture (or a `makeDefaultSynthParams()`
factory) and use it. Drop the `as never`.

### 21. `useCases/index.ts` re-exports `OscillatorNode` indirectly via return types

**Problem:** `useCases/index.ts` re-exports `scheduleNote` (return
type `OscillatorNode`), `scheduleKitNote` (return type
`OscillatorNode | null`). Cross-module callers using
`Parameters<typeof scheduleNote>` / `ReturnType<typeof scheduleNote>`
inherit Web Audio types. Future Synth implementations on a
`AudioWorkletNode` or a Faust worklet would break the contract.

**Representative files:**

- `src/modules/Synth/useCases/index.ts:1-14`
- `src/modules/Synth/useCases/builtinSynth.ts:124,332`
- `src/modules/Synth/useCases/drumKitSynth.ts:42`

**Needed:** Wrap the return as a `NoteHandle` (issue #15) so the
public surface is a domain type. Or change the return to `void` and
expose cancellation through the voice manager (issue #3).

### 22. No `dispose` / `panic` / `stopAllNotes` API

**Problem:** Synth has no panic button. Held notes survive context
state changes; sequencer crashes leave nodes ringing. The DAW user
expectation is a "stop all sound" command.

**Representative files:**

- `src/modules/Synth/useCases/builtinSynth.ts` (no panic)
- `src/modules/Synth/engine/drumSynthVoices.ts` (no panic)

**Needed:** Implement a `stopAllNotes` or `panic` use case in
`useCases/`, register it as an `AppAction`, hand it the voice manager
from issue #3. Bind to a keyboard shortcut.

### 23. Cross-module Web Audio leakage

**Problem:** External callers must pass a `BaseAudioContext` and an
`AudioNode destination` into Synth schedulers. That couples every
caller to Web Audio. A native Tauri-side audio path or an offline
worklet path would require redesigning the entire surface.

**Representative files:**

- `src/modules/Synth/useCases/builtinSynth.ts:114,376`
- `src/modules/Synth/useCases/drumKitSynth.ts:33`
- `src/modules/Synth/engine/drumSynthVoices.ts:345`

**Needed:** Introduce a `SynthHost` abstraction (in `models/` or
`services/`) that hides the `ctx` / `destination` pair. Synth
schedulers take a `SynthHost`; the AudioEngine provides a
WebAudio-backed implementation. Callers don't need to know about
`BaseAudioContext`. (Major refactor; defer until the worklet/native
parity work is scheduled.)

### 24. `engine/` allocates and touches Web Audio I/O directly

**Problem:** `engine/drumSynthVoices.ts` calls `ctx.createOscillator`,
`ctx.createBiquadFilter`, `ctx.createBufferSource`, `connect`, etc.
AGENTS.md: "Repositories Touch Metal: All I/O (Tauri IPC, Storage,
Web Audio) goes in `repositories/`." A strict reading places every
`ctx.create*` call in a Synth `repositories/`, with `engine/` doing
pure scheduling math. Today the role is mixed.

**Representative files:**

- `src/modules/Synth/engine/drumSynthVoices.ts:44-340`
- `src/modules/Synth/useCases/builtinSynth.ts:138-303` (also touches
  Web Audio directly — though this is `useCases/`, the same boundary
  applies in spirit).

**Needed:** Extract the Web Audio node creation into a
`repositories/audioGraph.ts` (per-node factory or a
`createDrumVoiceGraph` builder) and have `engine/` consume the
factory. Or accept that Web Audio is the **substrate** of this module
and document an exemption.

### 25. `registerProSynthInstruments` is not idempotent

**Problem:** Calling it twice (HMR, double-init in
`useAppInitialization`) calls `registerFaustDSP` twice for the same
name. There is no "if already registered, skip" guard.

**Representative files:**

- `src/modules/Synth/useCases/proSynthInstruments.ts:18-252`
- `src/modules/Workspace/presentations/hooks/useAppInitialization.ts:20`

**Needed:** Track registration state in this module (a `Set<string>`
of registered names), or query `Plugin/useCases.isFaustDSPRegistered`
before each call. Make double-call a no-op.

### 26. `proSynthInstruments.makeSynthParams` typing is loose

**Problem:** `proSynthInstruments.ts:254-291`: `extra` is typed as
`Array<{ address; label; min; max; defaultValue; step }>` (without
`type`). The spread adds `type: 'hslider' as const`. If
`FaustParamDescriptor` evolves (new required field), this code
compiles but produces invalid descriptors.

**Representative files:**

- `src/modules/Synth/useCases/proSynthInstruments.ts:254-291`

**Needed:** Add `satisfies FaustParamDescriptor[]` to the return
expression, or type `extra` as
`Omit<FaustParamDescriptor, 'type'>[]`.

### 27. `engine/drumSynthVoices.ts` has no behavioural test coverage

**Problem:** Twelve voice functions (one per drum) ship with zero
specs. The kick pitch sweep, the clap multi-tap echo, the hi-hat
oscillator stack — none are tested. Combined with issue #11, this is a
dark corner.

**Representative files:**

- `src/modules/Synth/engine/drumSynthVoices.ts` (no `__tests__/`).

**Needed:** Add `engine/__tests__/drumSynthVoices.spec.ts` that
renders each voice into an `OfflineAudioContext` and asserts at least:
- the rendered buffer is non-silent for `velocity > 0`,
- the rendered buffer is silent for `velocity = 0` (issue #19),
- the peak amplitude scales monotonically with velocity,
- the frequency-domain peak matches the expected fundamental
  (`schedule808Cowbell` peak around 700 Hz, `schedule808Kick` decay
  reaching 30 Hz after 0.5 s, etc.).

### 28. `Math.random()` for noise — non-deterministic offline render

**Problem:** Both `builtinSynth.getNoiseBuffer` and
`drumSynthVoices.createNoiseBuffer` use `Math.random()` to fill noise
buffers. Offline render of the same project produces different
content each time. Bouncing a track for diff-testing is impossible.

**Representative files:**

- `src/modules/Synth/useCases/builtinSynth.ts:48`
- `src/modules/Synth/engine/drumSynthVoices.ts:38`

**Needed:** Use a seeded PRNG (e.g. `mulberry32(seed)`) keyed by a
project-stable seed (e.g. project id + sample rate). Document that
offline render is bit-exact reproducible. Alternative: precompute a
single canonical noise buffer at module load and reuse.

### 29. `engine/drumSynthVoices.ts:schedule808Kick` allocates `Float32Array(256)` per kick

**Problem:** `:58-62` allocates and fills the same waveshaper curve
on every kick. The curve is constant.

**Representative files:**

- `src/modules/Synth/engine/drumSynthVoices.ts:57-65`

**Needed:** Hoist the curve to a module-level
`const KICK_WAVESHAPER_CURVE = (() => { ... })()`. Cheap fix.

### 30. CV/Gate has no events; downstream modules must poll

**Problem:** `events/index.ts` is empty (`// no public events`).
Adding/removing CV outputs, changing `voltageStandard`, changing
`clockDivision` — none of these emit events. Any downstream module
needing to react to CV reconfiguration must subscribe to the store
directly.

**Representative files:**

- `src/modules/Synth/events/index.ts`
- `src/modules/Synth/useCases/cvGate/cvOutputOperations/*`

**Needed:** Define typed events for `cvOutputAdded`,
`cvOutputRemoved`, `voltageStandardChanged`, `clockDivisionChanged`.
Emit from each `useCase` call. Document in `events/index.ts`.

### 31. CV/Gate operations have no `AppAction` / handler entry

**Problem:** All five CV operations are exported from
`useCases/index.ts` and called directly. There is no `getSynthHandlers`
function returning a handler map for the command bus. The
`AudioEngine/handlers/finalFeature/handleAddCvOutput` wraps
`addCvOutput`, but `removeCvOutput`, `setCvValue`,
`setVoltageStandard`, `setClockDivision` have no command-bus surface.

**Representative files:**

- `src/modules/Synth/useCases/index.ts`
- `src/modules/Synth/` (no `handlers/` directory)
- `src/modules/AudioEngine/handlers/finalFeature/handleAddCvOutput.ts`

**Needed:** Either move the CV handlers into Synth's `handlers/`
directory (create one) and a `getSynthHandlers` use case, or document
why CV operations are exempt from the command-bus pattern. AGENTS.md
"Command handlers (non-contract): `handlers/`. They are not
re-exported from the module `index.ts`. Cross-module access is only
via `get<Module>Handlers` in `useCases/`."

### 32. `MpeParams` extension would silently no-op

**Problem:** `builtinSynth.ts:131-249` only handles
`mpe.pitchBend`, `mpe.pressure`, `mpe.slide`. If `MpeParams`
(owned by AudioEngine, see issue #9) gains new axes (`timbre`,
`brightness`), Synth silently ignores them. There is no
exhaustiveness check.

**Representative files:**

- `src/modules/Synth/useCases/builtinSynth.ts:131-249`

**Needed:** After moving `MpeParams` into Synth (issue #9), use a
discriminated-union/exhaustive-switch pattern and a `never` check on
unknown axes. Or document the supported axes in `SynthParams` JSDoc.

### 33. `setVoltageStandard` uses inline `import('...')` for type

**Problem:** `cvGate/cvOutputOperations/setVoltageStandard.ts:3`:
`standard: import('../../../stores/cvGate').VoltageStandard`. AGENTS.md
prefers explicit `import type { VoltageStandard }` at the top of the
file.

**Representative files:**

- `src/modules/Synth/useCases/cvGate/cvOutputOperations/setVoltageStandard.ts:3`

**Needed:** Replace the inline import with a top-level
`import type { VoltageStandard } from '../../../stores/cvGate';`.

### 34. Sample-accurate envelope timing is approximate

**Problem:** All envelope events are scheduled via Web Audio
`AudioParam.setValueAtTime` / `linearRampToValueAtTime` /
`exponentialRampToValueAtTime`. Web Audio is sample-accurate **inside
each render quantum** but events at fractional-sample times are
quantised to the quantum boundary. For very tight envelopes (e.g.
`attack = 0.001 s` at 44.1 kHz = 44 samples; one render quantum =
128 samples), the envelope may miss the attack peak entirely. The
scheduler offers no guarantees that the user-perceived attack timing
matches the requested time.

**Representative files:**

- `src/modules/Synth/useCases/builtinSynth.ts:253-270`

**Needed:** Document the timing precision ceiling. For sub-quantum
envelopes, consider a worklet-based envelope generator. (Out of scope
for a near-term fix; flagged so the next session has it on radar.)

### 35. No modulation matrix

**Problem:** Synth has discrete modulation sources (vibrato LFO,
filter envelope, velocity, key tracking) but no general
**modulation matrix** — no way to route an LFO to filter cutoff, or
velocity to LFO depth, or pressure to filter resonance, etc. Every
modulation route is hard-coded in `scheduleNote`.

**Representative files:**

- `src/modules/Synth/useCases/builtinSynth.ts` (entire file).

**Needed:** Out of scope for a fix today. Note it as a feature gap so
future modulation work has a starting point. The `models/` directory
is empty apart from `DrumSynthTypes.ts`; a future `ModulationMatrix`
type would live there.

### 36. Audition's `osc._env` reach-through is dead code; key-up produces zombie notes

**Problem:** `AudioEngine/useCases/audition.ts:124` casts
`scheduleNote`'s return as `OscillatorNode & { _env?: GainNode }`.
The cleanup closure at `:129-132` reads `osc._env` and runs
`cancelScheduledValues + setTargetAtTime` for a soft release. But
`builtinSynth.scheduleNote` (`builtinSynth.ts:114-333`) never
attaches `_env` — verified by `grep -n "_env"`, zero hits. The
release branch is permanently dead. Audition uses `duration = 60`
(`audition.ts:121`); the user releases the key, the cleanup runs
`osc1.stop(killTime + releaseTime + 0.05)` which only stops osc1
while osc2/sub/noise/vibrato/env keep their original `releaseEnd
+ 0.01` schedule (60+ seconds). The note rings on after release.

The cast itself is an AGENTS.md soundness violation (an `as`-
extended type that doesn't match reality).

**Representative files:**

- `src/modules/AudioEngine/useCases/audition.ts:116-138`
- `src/modules/Synth/useCases/builtinSynth.ts:114-333`

**Needed:** Make `scheduleNote` return a `NoteHandle = { stop(when?):
void; release(when?, releaseTime?): void }` (see issue #15). Audition
calls `handle.release(killTime, releaseTime)` instead of poking at
`osc._env`. Drop the cast.

### 37. `registerProSynthInstruments` second call replaces compiled `FaustModule` with empty shell

**Problem:** Verified 2026-04-28: `Plugin/useCases/faustEngine/compilerEngine.ts:110-138`
builds a fresh `FaustModule` with `compiled: false, generator:
null` on every call and runs `modules.set(mod.id, mod)`. The
second call therefore **erases** the compiled state. React
StrictMode and dev HMR re-mount `useAppInitialization`
(`useAppInitialization.ts:31, 50`) — `registerProSynthInstruments`
fires twice in normal development, the second registration wipes
the first. Subsequent `compileFaustDSP(mod.id)` re-runs the WASM
compile from scratch (~seconds) and any in-flight `createFaustNode`
serialised on `contextCreateLock` may be reading the old promise
while the descriptor map shows an uncompiled module.

This is the deepening of audit issue #25 — it is not "non-
idempotent in the merely-wasteful sense", it is **actively
destructive** of cached state.

**Representative files:**

- `src/modules/Synth/useCases/proSynthInstruments.ts:18-252`
- `src/modules/Plugin/useCases/faustEngine/compilerEngine.ts:110-138`
- `src/modules/Workspace/presentations/hooks/useAppInitialization.ts:31, 50`

**Needed:** Make `registerFaustDSP` idempotent by checking
`modules.has(id)` first and either returning the existing module or
skipping the registration. Or add an explicit `force` flag for the
test/HMR case. Or have `registerProSynthInstruments` track its own
"already done" flag.

### 38. `handleAddCvOutput` casts `payload.type as CvOutputType` and is `undoable: true` with no inverse

**Problem:** `AudioEngine/handlers/finalFeature/handleAddCvOutput.ts:9`:
```ts
addCvOutput(alpha.payload.name, alpha.payload.channel, alpha.payload.type as CvOutputType);
```
The payload's `type` is `string` (`AiRuntime/models/RuntimeAction.ts:318`).
The cast bypasses runtime validation; an AI-runtime payload with
`type: 'cv-pich'` (typo) reaches `addCvOutput.ts:8`
`VOLTAGE_RANGES[type]` returns `undefined`, the destructure
`[minV, maxV]` throws "Cannot read properties of undefined".

The handler is also `undoable: true` (`:12`), but `addCvOutput`
returns `void` and the handler emits no inverse — the command bus
records an undoable mutation that cannot be undone.

**Representative files:**

- `src/modules/AudioEngine/handlers/finalFeature/handleAddCvOutput.ts:7-13`
- `src/modules/AiRuntime/models/RuntimeAction.ts:318`
- `src/modules/Synth/useCases/cvGate/cvOutputOperations/addCvOutput.ts:8`

**Needed:** Replace the `as` cast with a runtime guard or Zod parse
that returns `Result<CvOutputType, …>` (user memory: prefer
neverthrow). Either implement an undo by tracking the new output's
id and inverting via `removeCvOutput`, or set `undoable: false`. Add
a unit test for malformed `payload.type`.

### 39. Velocity-attack scaling is hard-coded; out-of-range velocity produces negative attack

**Problem:** `builtinSynth.ts:127`: `velAttack = params.attack *
(1.5 - velocity / 127)`. User-configured `attack = 1s` becomes
0.5s (vel 127) … 1.5s (vel 0): 3× variation, no opt-out. Same
formula in `scheduleNoteOffline.ts:386`.

`velocity` is not clamped at the entry point. A velocity of 200
yields `velAttack = -0.075 * attack`; `attackEnd = startTime +
velAttack < startTime`; `linearRampToValueAtTime(peakGain, attackEnd)`
schedules an event in the past. Web Audio behaviour for past
events is implementation-defined.

**Representative files:**

- `src/modules/Synth/useCases/builtinSynth.ts:127, 256, 386, 420`

**Needed:** Clamp `velocity` to `[0, 127]` at the top of both
schedulers. Either accept the velocity-attack curve as a fixed
rule and document it, or expose it as a `SynthParams` field
(`velocityAttackScale: 0..1` where 0 = no scaling, 1 = current
behaviour) so users who want flat attack can opt out.

### 40. Offline render parity: drum kits render full-fat while builtin synth renders draft

**Problem:** `AudioEngine/useCases/offlineRender/scheduleTrackClips.ts:286-308`:
- `kitDef` → `scheduleDrumKitNote(offlineCtx, …)` → `scheduleDrumVoice` (full graph: 6-osc hi-hat, multi-tap clap, etc.)
- `drumKit` → `scheduleKitNote(offlineCtx, …)` → realtime `scheduleNote` (osc2/sub/noise/vibrato/spread all ON)
- builtin synth → `scheduleNoteOffline(offlineCtx, …)` → 3 nodes, **no** osc2/sub/noise/vibrato/spread.

A track with both synth and drums in the same project bounces
incoherently: drums sound full, synth sounds thin. The user A/Bs
realtime monitor vs offline bounce, hears the synth has "lost
character", and has no way to diagnose the asymmetry.

**Representative files:**

- `src/modules/AudioEngine/useCases/offlineRender/scheduleTrackClips.ts:286-308`
- `src/modules/Synth/useCases/builtinSynth.ts:376-441`
- `src/modules/Synth/useCases/drumKitSynth.ts:33-48`

**Needed:** Pick one. Either (a) `scheduleNoteOffline` becomes a
thin alias for `scheduleNote` (and possibly delete it entirely —
`OfflineAudioContext` runs much faster than realtime, the perf
"savings" of the lite path are mostly imaginary), or (b)
`scheduleKitNoteOffline` and `scheduleDrumKitNoteOffline` get
draft-fidelity siblings to match. The mixed regime is incoherent.

### 41. CV/Gate sub-system is dead code that ships persisted state

**Problem:** Verified 2026-04-28 by grepping `src/modules/` for
external callers of CV operations:
- `midiNoteToCv`, `velocityToCv`, `getClockValue`, `setCvValue`,
  `removeCvOutput`, `setVoltageStandard`, `setClockDivision` — **zero**
  external callers (only Synth's own tests).
- `addCvOutput` — wired to one AppAction (`handleAddCvOutput`) which
  is itself broken (#38).

There is no DC-coupled output device strategy, no UI rendering CV
channel state, no audio-thread code consuming `cvGateStore.outputs`.
Yet `cvGateStore` (`stores/cvGate.ts:33-42`) is an Automerge-
persisted document written into every project file. The semantic
bugs in #5, #6, #7, #19, #28 are real but unreachable today —
they will surface the moment a developer wires the feature, with
zero behavioural test coverage on the integration path.

**Representative files:**

- `src/modules/Synth/useCases/cvGate/**` (8 source files + tests)
- `src/modules/Synth/stores/cvGate.ts`
- `src/modules/Synth/useCases/index.ts:2-6`
- `src/modules/AudioEngine/handlers/finalFeature/handleAddCvOutput.ts`
- (no other consumer)

**Needed:** Decide. Either (a) build the missing piece — a
CV-output device strategy (DC-coupled `ConstantSourceNode` per
channel writing to a chosen output channel via `MediaStreamAudio
DestinationNode`/`AudioContext.destination`), plus a UI to wire
MIDI events to CV channels — or (b) delete the entire `cvGate/`
sub-tree, the store, and the AppAction. Add an Automerge migration
to strip the dead state from existing projects. Shipping
unreachable code that touches persisted state is the worst of both
worlds.

### 42. `getSynthParamsFromDevices` and the scheduling sites disagree on what counts as a synth

**Problem:** `builtinSynth.ts:341` matches synth devices via
`d.type === 'synth' || d.type.startsWith('builtin-synth')`. The
scheduling sites (`Transport/scheduling/scheduleMidiNotes.ts:462`,
`AudioEngine/useCases/audition.ts:115-124`) call `scheduleNote` on
a "default" branch — anything that didn't match drum/Faust/levain/
fermenter/toaster/grand-boule. A device with type `'builtin'` (or
any future feature whose name doesn't begin with `builtin-synth`)
falls into the synth-default branch but is **not** matched by the
params resolver, so it gets default `SynthParams`. Silent quality
regression.

**Representative files:**

- `src/modules/Synth/useCases/builtinSynth.ts:340-368`
- `src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts:462`
- `src/modules/AudioEngine/useCases/audition.ts:115-124`

**Needed:** Define a single canonical `isSynthDevice(device)`
predicate (in a Synth `services/` folder once it exists, see issue
#17). All call sites consume it.

### 43. `cachedNoiseBuffer` keys on `sampleRate` only, not `(ctx, sampleRate)` — buffers cross AudioContext boundaries

**Problem:** `builtinSynth.ts:39-52` keeps a module-level
`cachedNoiseBuffer: AudioBuffer | null` and reuses it whenever
`cachedNoiseBuffer.sampleRate === ctx.sampleRate`. A realtime
`AudioContext` at 48 kHz and an `OfflineAudioContext` at 48 kHz
(used during export) will share the same `AudioBuffer` instance.
`AudioBuffer` instances are bound to a single context in the spec;
passing one to a `BufferSource` in a different context is
undefined behaviour and throws in some browser implementations.
The drum-voice cache (`engine/drumSynthVoices.ts:22`) correctly
uses `WeakMap<BaseAudioContext, …>`; this one is wrong by
structure.

**Representative files:**

- `src/modules/Synth/useCases/builtinSynth.ts:39-52`

**Needed:** Replace the module-level singleton with a
`WeakMap<BaseAudioContext, AudioBuffer>` mirror of
`drumSynthVoices.ts:22`. Or pre-fill the noise buffer at first
`scheduleNote(ctx, …)` call and key on `ctx`.

---

## Open questions

- [ ] Are `drumKitSynth.scheduleKitNote` and
      `drumSynthEngine/.../scheduleDrumKitNote` both intentional, or
      is one obsolete? The Transport calls both
      (`Transport/scheduling/scheduleMidiNotes.ts:15`). (Affects issue #1.)
- [ ] **Is the CV/Gate sub-system intended to ship as a feature, or
      is it a half-finished experiment?** Today it is unreachable
      code in persisted state (open issue #41, finding #54). The
      answer determines whether to fix #5/#6/#7/#19/#28 or delete
      the entire `cvGate/` sub-tree.
- [ ] What is the intended contract for `setCvValue`? Voltage, or
      normalised `[0, 1]`? (Affects issue #5.)
- [ ] Is `scheduleNoteOffline`'s "draft" rendering an intentional UX
      choice (faster bounces) or an accidental divergence? (Affects
      issue #4 and the parity gap in #40.)
- [ ] What target hardware should the Hz/V CV mode emulate? (Affects
      issue #6.)
- [ ] Is `triggerPulseMs` / `gateThreshold` reserved for an unfinished
      feature, or dead state? (Affects issue #18.)
- [ ] Should Synth own `SynthParams` / `MpeParams`, or is the current
      AudioEngine ownership intentional? (Affects issue #9.)
- [ ] Should `engine/` be allowed to call `ctx.create*` / `connect`
      directly, or should those move to a `repositories/`? (Affects
      issue #24.)
- [ ] **Is the velocity-attack inversion `(1.5 - vel/127)` a feature
      or an accident?** (Affects issue #39.) If a feature, expose
      it as a configurable param; if an accident, remove it. Right
      now users see a 3× attack-time variation across velocity and
      cannot opt out.
- [ ] Is `audition.ts:124`'s `_env` reach-through a vestige of an
      earlier `scheduleNote` API, or is `scheduleNote` supposed to
      attach `_env` and someone deleted that line? Git blame on
      both files would clarify intent. (Affects issue #36.)

---

## Risks

- **Audio dropouts under sequence pressure.** Issues #3, #4, #5: a
  high-density MIDI input or a sequenced track with heavy synth
  patches accumulates unbounded nodes. Web Audio degrades
  unpredictably; the user experiences "the synth crashed" with no
  recovery path (issue #22).
- **Bouncing produces unfaithful renders.** Issue #4: `scheduleNoteOffline`
  drops half the synth. Users mix a track relying on the realtime
  monitoring, then bounce it — the bounce sounds wrong, and the
  reason is invisible.
- **Audition release is broken.** Issue #36 (was finding #52):
  `osc._env` reach-through is dead code; key-up does not soften
  the envelope, only stops osc1 — every other oscillator keeps
  running for 60 seconds. Encountered any time a user holds a key
  while auditioning a synth track. User-visible bug today.
- **Faust pro-instruments break under HMR.** Issue #37: second call
  to `registerProSynthInstruments` replaces the compiled module
  with `compiled: false, generator: null`. React StrictMode and
  dev HMR re-mount `useAppInitialization`. Developers experience
  "Faust instruments randomly stop working in dev". Users **could**
  also encounter this if any other code path triggers a second
  registration.
- **CV/Gate is dead code with broken handler that ships persisted
  state.** Issues #38 (handleAddCvOutput cast + bogus undoable),
  #41 (whole sub-tree unreachable), and the latent semantic bugs
  in #5/#6/#7/#19/#28. The dead state ships with every project; if
  the feature is built later without a migration, projects will
  carry forward bogus `outputs[]` arrays and stale
  `triggerPulseMs`/`gateThreshold` values.
- **CV/Gate modular synth integration is broken in the only mode
  that matters** if the feature were ever wired (issues #5, #6, #7):
  `setCvValue`'s `[0,1]` clamp destroys the pitch range; Hz/V
  converts to frequency, not voltage; `clockDivision` quadruples
  the clock instead of quartering it. Tests don't catch any of it.
- **Bouncing produces unfaithful renders.** Issue #4 +
  parity-mismatch issue #40: `scheduleNoteOffline` drops half the
  synth, but drum kits render at full fidelity in the same offline
  pass. Users hear an incoherent mix in their export.
- **Silent regressions in the analog drum kit.** Issues #11, #27:
  zero behavioural coverage on the 808 voices.
- **Faust DSP parameters look documented but the addresses are a
  lie.** Issue #25 (deepened): the `/wt/`, `/supersaw/`, `/pm/`,
  `/additive/`, `/synth/` prefixes are fabricated — none of the
  `.dsp` sources declare matching `vgroup`s. The bare-name cache in
  `faustDeviceFactory.ts:117-134` salvages it, but a developer
  reading `proSynthInstruments.ts:25` thinks the prefixes are
  meaningful and has no warning when a typo lands.
- **Velocity-attack negative-time bug.** Issue #39: out-of-range
  velocity yields negative `velAttack`, scheduling Web Audio
  events in the past. Reachable via MPE pressure + mis-mapping or
  malformed AI-runtime payloads.
- **Cross-context noise buffer reuse.** Issue #43: `cachedNoiseBuffer`
  may be shared between realtime `AudioContext` and offline
  `OfflineAudioContext`, which is undefined behaviour in the spec
  and throws in some browsers.
- **Architecture drift.** Issues #2, #9, #10, #16, #17, #21, #24,
  #31, #33: AGENTS.md violations have accumulated; left
  unaddressed they normalise positional-arg signatures, model
  ownership inversions, missing barrels, and `dsp/` files under
  `useCases/`.

---

## Suggested approaches

- **Land the test coverage first.** Issues #11, #20, #27, #28: replace
  tautological specs with `OfflineAudioContext`-rendered behavioural
  assertions, drop `as never`, and add the 808 voice tests. With
  coverage in place, every DSP fix below can land test-first.
- **Fix the CV bugs in one commit.** Issues #5, #6, #7, #19: small,
  contained, easy to review together. Add a single integration test
  that wires `addCvOutput` → `setCvValue` → reads the channel value.
- **Decide on the drum kit duplication** (issue #1) before any further
  surface changes. Either rename or delete; do not let the ambiguity
  ship another week.
- **Move `SynthParams` / `MpeParams` into Synth** (issue #9). This is
  the foundation for everything else (modulation matrix, voice
  manager, MPE expansion). Mechanical rename + 8 cross-module import
  updates.
- **Build the voice manager** (issues #3, #15, #22). One file in
  `services/`. Starts as a per-track polyphony cap with oldest-voice
  eviction. Exposes `panic`. `scheduleNote` registers/unregisters via
  the manager.
- **Convert positional signatures to object params** (issue #10) as a
  mechanical AGENTS.md compliance pass after the structural changes
  land. Do it module-by-module to keep diffs manageable.
- **Add the Synth root barrel `index.ts`** (issue #2). Mechanical.
  Migrate the 8 external imports.

---

## Recommendation

Start with **issues #11, #20, #27, #28** (test coverage). They are
mechanical, unblock every downstream DSP fix, and immediately surface
hidden regressions. Once the 808 voices and the builtin synth have
real behavioural specs, every subsequent change in this audit can land
test-first.

After coverage lands, tackle **issue #1 (duplicated drum kit
abstractions)** because the ambiguity blocks any further `useCases/`
surface work. Then **issues #5/#6/#7 (CV bugs)** as a single commit —
small surface, high user-visible impact when the feature is used.

Defer **issues #3 (voice manager) / #4 (offline render parity) / #9
(SynthParams ownership) / #34 (sample-accurate envelopes) / #35
(modulation matrix)** to dedicated specs — each is a feature-class
change that needs its own design doc.

---

## Resolved

_No issues resolved yet._
