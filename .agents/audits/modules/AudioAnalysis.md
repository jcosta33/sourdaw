# AudioAnalysis module audit

## Scope

This audit covers `src/modules/AudioAnalysis/` in full — all use cases, handlers,
repositories, services, models, and their tests. It explicitly excludes the
upstream callers (`AiRuntime`, `Command`, `Arrangement`, `MIDI`, `Transport`,
`AudioEngine`) except where they are directly imported from this module, and
the cross-module store `mixAnalysisStore` that lives in `AiRuntime/stores`.

It is an adversarial review: bugs, race conditions, FFT/window mismatches,
dead/duplicated abstractions, lazy tests, accessibility, and audio-thread/UX
hazards.

Related spec: none on disk.

---

## Goal

A correctness-first analysis surface for the DAW:

- Each detection use case (key, tempo, pitch, audio→MIDI, mix analysis,
  comparison, stem separation, audio generation) returns _real_ signal-derived
  results, with documented FFT/window sizes, hop sizes, sample-rate handling,
  and clarity/confidence semantics.
- One canonical `analyzeMix` per concept — the **realtime master analyser**
  reading and the **track-config estimate** must not collide on a single name.
- Handlers are thin: they translate `AppAction` payloads to use-case calls,
  surface errors via `notifyUser`/store, and never silently drop fields that
  the action contract advertises.
- Tests verify behaviour, not "called the function with `null` returns
  `null`". Mocks point at the same import path the production code uses.
- No allocations in tight per-frame DSP loops; all module-level singletons
  are HMR-safe and racing-safe.
- AGENTS.md hard rules: no `any`, no `as any`/`as unknown as`, no `useMemo`/
  `useCallback`/`React.memo`, no `forwardRef`, no namespace imports, no
  cross-module imports of internals; one function per `useCases/` /
  `repositories/` file.

---

## Relevant code paths

- `src/modules/AudioAnalysis/useCases/index.ts` (cross-module surface — there is **no** root `index.ts`; the original audit was incorrect on this point)
- `src/modules/AudioAnalysis/useCases/keyDetection.ts`
- `src/modules/AudioAnalysis/useCases/tempoDetection.ts`
- `src/modules/AudioAnalysis/useCases/audioToMidi.ts`
- `src/modules/AudioAnalysis/useCases/polyphonicAudioToMidi.ts`
- `src/modules/AudioAnalysis/useCases/insertPolyphonicMidiNotes.ts`
- `src/modules/AudioAnalysis/useCases/pitchDetection.ts`
- `src/modules/AudioAnalysis/useCases/audioFeatures.ts`
- `src/modules/AudioAnalysis/useCases/analyzeMix.ts`
- `src/modules/AudioAnalysis/useCases/getAnalysisHandlers.ts`
- `src/modules/AudioAnalysis/useCases/referenceMixComparison/analyzeMix/analyzeMix.ts`
- `src/modules/AudioAnalysis/useCases/referenceMixComparison/analyzeMix/createReferenceAnalysis.ts`
- `src/modules/AudioAnalysis/useCases/referenceMixComparison/compareMixes.ts`
- `src/modules/AudioAnalysis/useCases/audioAi/*.ts` (5 thin re-exporters)
- `src/modules/AudioAnalysis/handlers/analysis/handle*.ts`
- `src/modules/AudioAnalysis/repositories/audioAiEngine.ts`
- `src/modules/AudioAnalysis/repositories/browserStemSeparation.ts`
- `src/modules/AudioAnalysis/services/mixAnalysisHelpers.ts`
- `src/modules/AudioAnalysis/models/MixComparisonTypes.ts`

---

## Current behavior

**Detection use cases.** `keyDetection.ts`, `tempoDetection.ts`,
`audioToMidi.ts`, `pitchDetection.ts`, `audioFeatures.ts`, and
`polyphonicAudioToMidi.ts` all read directly from
`audioBufferCache` (imported from `#/modules/AudioEngine/stores`). They
operate synchronously on `Float32Array`s and return arrays/objects of
detected events. `polyphonicAudioToMidi` is async because it runs a
TensorFlow.js model and may resample via `OfflineAudioContext`.

**Mix analysis (two of them).** There are **two** functions named
`analyzeMix` in this module:

1. `useCases/analyzeMix.ts:45` — async, reads the live Web Audio analyser
   nodes (`getMasterAnalyser`, `getTrackStrip`) and produces a snapshot used
   by `handleAnalyzeMix` / `handleAutoFixMix`.
2. `useCases/referenceMixComparison/analyzeMix/analyzeMix.ts:53` — sync,
   reads `trackStore.value` and _estimates_ a `MixAnalysis` from track
   gain/pan with hard-coded fallback profiles. Used by
   `compareToReference()` / `compareMixes`.

The barrel re-exports the second as `analyzeMixFromTrackLayout` and the
first as `analyzeMix` (`useCases/index.ts:13`, `:30`). Inside the module
they collide if both are imported by name.

**Handlers.** `getAnalysisHandlers.ts:25` returns the six analysis handlers.
Each `handle*.ts` file uses `createHandler<…>` from `#/utils/createHandler`.
`handleAutoFixMix` orchestrates a sequence of `setTrackGain` / `setMasterGain`
`AppAction`s, then re-runs `analyzeMix`.

**Repositories.** `audioAiEngine.ts` provides Tauri-or-browser dispatch for
stem separation and audio generation. `browserStemSeparation.ts` runs the
Demucs ONNX model in-browser (~235 MB, cached via the Cache API), with a
module-level singleton `ortSession`.

**Services.** `mixAnalysisHelpers.ts` is the only `services/` resident:
pure helpers (`readLevels`, `readFrequencyBalance`, `detectIssues`,
`generateSuggestions`). `linearToDb` is defined inside but kept
private (the original audit incorrectly called it exported). The file
exports four runtime functions plus six types — multiple-export
violation, see new issue #37.

**Tests.** Every public file has at least one spec. Specs lean on
`vi.mock(...)` heavily; many use `as any` to construct partial
fixtures. Six specs are smoke-only "the export exists" tests (new
#39). Five specs mock the wrong barrel level, exercising no
production code (#2, #25, new #40).

**Cross-cutting truth (added 2026-04-28).** `MixAnalysis.peakDb` /
`rmsDb` from the track-config `analyzeMix` is in linear-gain units, not
dBFS, despite the contract (new #34). The master analyser used by the
live `analyzeMix` is configured at `fftSize = 256`, which makes the
sub/bass/lowMid frequency bands collapse to a single bin at 48 kHz
(new #35).

---

## Findings

1. **Two `analyzeMix` use cases with overlapping responsibilities.** The
   barrel partially papers over the collision by aliasing one
   (`analyzeMixFromTrackLayout`), but downstream callers must know which is
   which. `referenceMixComparison/analyzeMix/analyzeMix.ts` does _not_
   actually analyse audio — it inspects track gain/pan and synthesises a
   `MixAnalysis` from constants. Anyone wiring it to a "compare to
   reference" UI will be comparing two synthetic profiles
   (`createReferenceAnalysis` is also constants), so `compareToReference`
   today returns a deterministic, audio-independent score.

2. **Test mocks target the wrong module.** Four specs declare
   `vi.mock('#/modules/AudioEngine/useCases', () => ({ audioBufferCache: …
}))` but the production code imports from
   `#/modules/AudioEngine/stores`. The mocks are inert; the tests still
   pass because the production code path naturally returns null for any
   missing buffer id. This means the "happy path" assertions never run
   under test:
    - `useCases/__tests__/keyDetection.spec.ts:8`
    - `useCases/__tests__/tempoDetection.spec.ts:3`
    - `useCases/__tests__/pitchDetection.spec.ts:3`
    - `useCases/__tests__/audioFeatures.spec.ts:3`

3. **`audioToMidi` handler silently drops half the action payload.** The
   `AppAction` for `audioToMidi` includes `mode: string` (and the use case
   accepts `targetPitch` and `minInterval`). `handleAudioToMidi.ts:14`
   only forwards `clipId`, `trackId`, `sensitivity`, and `mode`, throwing
   away anything else a future caller might add. Coupled with the
   `payload.mode: string` type (not a discriminated union) this is a
   silent-data-loss path.

4. **Krumhansl-Schmuckler implementation in `keyDetection.ts` is
   under-specified and weakly calibrated.** `keyDetection.ts:22` correctly
   advances frames with `data[frame + index]`, but the Goertzel pass is
   still a rectangular-window, per-frame magnitude sum across six octaves
   with no per-bin normalisation or calibration against the key-profile
   dot-product range. Additionally:
    - `s0` is declared without an initializer (`let s0: number,`) and read
      before its first assignment when `fftSize === 0` (technically harmless
      here since the body assigns first, but TS strict noises around it).
    - The Goertzel "power" formula uses `s1*s1 + s2*s2 - coeff*s1*s2` —
      standard Goertzel power is `s1² + s2² − coeff·s1·s2` only when used as
      squared magnitude; the code then takes `Math.abs` of it, masking sign
      errors. With this filter design, magnitude is not in dB and is summed
      across 6 octaves without any windowing or per-bin normalisation.
    - `confidence = Math.min(1, bestCorr / 30)`: 30 is a magic number with
      no relation to the chroma-profile dot-product range.

5. **`tempoDetection.ts` uses an O(n²) `slice + reduce` per frame.**
   `tempoDetection.ts:30` calls
   `energies.slice(Math.max(0, index − 10), index).reduce(...)` once per
   frame — at 10 ms frame size and a 5-minute clip that is 30 000 slices,
   each allocating a sub-array. The "double/half BPM" weighting also
   counts the same evidence three times (1×, 2×, ½) into separate bins,
   which biases the histogram toward whichever harmonic happens to land
   on a bin boundary.

6. **`compareToReference()` returns synthetic-vs-synthetic results.**
   `referenceMixComparison/compareMixes.ts:117` calls the
   _track-config_ `analyzeMix` (constants + gain heuristics) and then
   `createReferenceAnalysis` (also constants). The "% match" the user
   sees in the toast (`handleCompareToReference.ts:9`) is therefore not
   tied to the actual audio at all. UX-wise this is misleading.

7. **`handleAutoFixMix` second-analyse is dead/misleading.**
   `handleAutoFixMix.ts:41` calls `analyzeMix()` again after applying gain
   changes and stores the result, but the gain changes are dispatched
   through `executeAppAction` which schedules updates via `Command`/store
   — there is no guarantee they have been _applied to the AudioGraph_
   before `analyzeMix` reads `getMasterAnalyser()` again. The user sees a
   "refreshed" analysis that is, in the worst case, the pre-fix snapshot.
   Also: clipping fix math (`overshootDb = peakDb + 0.5`,
   `targetLinear = currentLinear / 10 ** ((overshootDb + 3) / 20)`) reduces
   gain by `peakDb + 3.5 dB` — for a track at +1 dB peak this drops gain
   by ~4.5 dB; for a track at 0 dB peak this drops it by ~3.5 dB; below
   0 dB peak the formula _increases_ gain (inverted sign). The "+3"
   safety margin and the `Math.min(1, …)` ceiling combine to silently
   produce nonsensical values for non-clipping tracks.

8. **`handleCompareToReference.execute` is sync but the test treats it
   as a Promise.** `handleCompareToReference.ts:7` is a synchronous arrow
   function returning `void`. The spec `void handleCompareToReference.execute(...)`
   pattern (`__tests__/handleCompareToReference.spec.ts:29`) is
   superficially fine, but the rest of the analysis handlers are
   `async`. Inconsistent contract: the action handler interface should
   pick one shape.

9. **Module-level mutable singletons.**
    - `browserStemSeparation.ts:30` `ortSession` holds the 235 MB ONNX
      session and the imported `onnxruntime-web` namespace. The comment
      acknowledges HMR will leak it.
    - `polyphonicAudioToMidi.ts:45` `modelHolder` holds the BasicPitch model.
    - These are not racing-safe: two concurrent calls to `getSession()` /
      `getBasicPitchModel()` will both observe `null`, both download the
      model, and both create a session (the second clobbers the first
      reference). At a ~235 MB allocation, that is a real OOM hazard if a
      UI panel triggers two stem-separation runs in parallel.

10. **`browserStemSeparation.ts` allocates per-segment in a hot loop.**
    `browserStemSeparation.ts:180` allocates a new `Float32Array(2 *
343980)` every segment (~2.7 MB each), and the per-sample copy at
    `:208` is a JS-level `for` over millions of indices instead of
    `set()` with `subarray`. The `outData[lIdx] ?? 0` fallback on a
    `Float32Array` element will only return the fallback if `lIdx` is
    out of range (typed arrays don't store undefined), so the `?? 0` is
    dead.

11. **`browserStemSeparation.ts` type assertion escape.**
    `browserStemSeparation.ts:133` `session as unknown as OrtSession` is a
    double-cast to bypass an `index signature variance` mismatch. The
    eslint-disable comment justifies it but the underlying fix — define
    `OrtSession` to match the index signature exactly — has not been
    done. AGENTS.md "TypeScript — soundness" classifies this as
    forbidden.

12. **`audioAi/*.ts` are five empty pass-throughs.** Each file
    re-exports the same-named function from `repositories/audioAiEngine.ts`
    with zero added behaviour:
    - `useCases/audioAi/isAudioGenerationAvailable.ts`
    - `useCases/audioAi/isAudioAiServerRunning.ts`
    - `useCases/audioAi/isStemSeparationAvailable.ts`
    - `useCases/audioAi/generateAudio.ts`
    - `useCases/audioAi/separateStems.ts`
      These satisfy the "useCases/ wraps repositories/" convention
      cosmetically but introduce five files of indirection that ship as
      five identical thin functions. Legitimate use cases should add value
      (validation, store mutation, error mapping, batching) — these add
      nothing.

13. **`isAudioAiServerRunning` is `async` for nothing.**
    `repositories/audioAiEngine.ts:35` is `async function … Promise<boolean>`
    that returns `isTauri()`. The eslint-disable comment cites
    "backward-compat", but the only consumer (`audioAi/isAudioAiServerRunning.ts`)
    just forwards the Promise. There is no boundary that genuinely needs
    a Promise here — it pollutes call sites with `await` for a sync check.

14. **`extractFeatures` mutates Meyda's global state.**
    `audioFeatures.ts:71-72` writes `Meyda.sampleRate` and
    `Meyda.bufferSize` per call. If two concurrent `extractFeatures`
    runs interleave (e.g. user analyses two clips at once), the second
    call's globals overwrite the first's mid-flight, corrupting the
    output. This is a hidden non-reentrant API masquerading as a pure
    function.

15. **`audioFeatures.summarizeFeatures` numerical drift.** The chroma
    average `chromaProfile[index] = chromaProfile[index] + chromaVal /
node` (`audioFeatures.ts:146`) divides each contribution by `node`
    inside the sum — across `node` frames this works, but with `node` in
    the thousands the per-element rounding error compounds. Sum first,
    divide once.

16. **`detectOnsets` off-by-one in onset timing.**
    `audioToMidi.ts:129` writes `timeSec = ((index + 1) * HOP_SIZE) /
sampleRate` but the _peak frame_ is at `index`; the onset is being
    reported one hop late (~11 ms at 44.1 kHz, 512-sample hop). The
    `amplitude` field uses `energies[index + 1]` for the same reason,
    which compounds the lag.

17. **`audioToMidi.estimatePitch` autocorrelation early-exits with `>
0.3`.** `audioToMidi.ts:77` accepts the _first_ lag whose normalised
    correlation exceeds 0.3 — but the loop iterates from `minLag`
    upward, so the result is biased toward the highest fundamental that
    crosses the threshold (i.e. octave errors are systematic, not
    statistical). MPM via `pitchy` is already used in `pitchDetection.ts`;
    `audioToMidi.estimatePitch` is a worse re-implementation.

18. **`detectPitchForOnsets` re-allocates the windowed slice via
    `start + windowSamples` without bounds-checking the right edge.**
    `audioToMidi.ts:147` passes `start = floor(timeSec * sampleRate)` and
    a `windowSamples = FRAME_SIZE * 2` (2048). For onsets near
    `clip.endBeat`, the window can extend past `channelData.length`;
    `estimatePitch` clamps with `Math.min(start + length, data.length)`,
    silently shrinking the window to a value that may break the
    `actual < 64` guard or simply emit a meaningless lag.

19. **`insertPolyphonicMidiNotes` ceil()s `endBeat`.**
    `insertPolyphonicMidiNotes.ts:39` and `audioToMidi.ts:206` both call
    `Math.ceil(sourceClip.endBeat)`. If a clip ends at e.g. 7.25 beats,
    the MIDI clip extends to 8 beats, beyond the source. Notes computed
    via `note.startTimeSeconds * beatsPerSecond` retain real positions,
    so a note at 7.4 s plays past the source's `endBeat` — and any
    downstream code that loops to `endBeat` will inherit the off-by-one.

20. **`insertPolyphonicMidiNotes` minimum duration is wrong unit.**
    `insertPolyphonicMidiNotes.ts:54`
    `Math.max(0.0625, note.durationSeconds * beatsPerSecond)` — `0.0625`
    is presumably 1/16 beat, but the value being clamped is in _beats_,
    so this only bites at extreme tempos. Document or move to a constant.

21. **`compareMixes` mismatched suggestion thresholds.**
    `compareMixes.ts:48` uses `Math.abs(diff) > 0.25 ? 'warning' : 'info'`
    inside a branch already gated on `Math.abs(diff) > 0.15`. The
    `dynamics` branch (`:65-70`) emits a `'critical'` severity at `> 5
dB` but the gate is `> 2 dB`, so anything in `(2, 5]` lands in
    `'warning'`. Across categories the severity ladders are inconsistent
    (loudness uses `1`/`4`, frequency uses `0.15`/`0.25`, dynamics
    `2`/`5`, stereo `0.1`/`0.25`). This is a UX/ DSP review item, not
    a bug per se, but the magic numbers are uncommented.

22. **Suggestions sort uses an object lookup that allocates per
    comparison.** `compareMixes.ts:104-106` constructs `{ critical: 0,
warning: 1, info: 2 }` inside the comparator, on every pair compared.
    Lift it.

23. **`createReferenceAnalysis()` is a hard-coded mastered-track
    fingerprint.** `createReferenceAnalysis.ts:6` returns the same
    object every call. There is no API to load a _user's_ reference
    track, so the entire `referenceMixComparison/` machinery is sealed
    against its purpose.

24. **Tests use `as any` and partial fixtures.**
    - `handleAutoFixMix.spec.ts:48`/`:65`/`:70` cast partial result
      objects to `any` to satisfy `analyzeMix`'s `Promise<AnalyzeMixOutput>`.
    - `analyzeMix.spec.ts:25` uses `(...args: any[]) => …` factories.
    - `polyphonicAudioToMidi.spec.ts:13` uses `(...args: any[])`.
    - `compareMixes.spec.ts` is fine.
      AGENTS.md "TypeScript — soundness" forbids these escapes.

25. **`detectKey` test never exercises `detectKey`.**
    `keyDetection.spec.ts:14`: the production import is
    `import { audioBufferCache } from '#/modules/AudioEngine/stores'`;
    the test mocks `#/modules/AudioEngine/useCases`. Then "returns null
    on a silent buffer" passes only because `Math.max(...chroma) === 0`
    short-circuits — but if the Goertzel loop were ever re-shaped to
    return non-zero on silence (e.g. by adding a windowing function
    constant), the test would still pass.

26. **Module-level mutable bindings: holder pattern.** Files use the
    `const holder = { instance: null }` pattern (see
    `polyphonicAudioToMidi.ts:45`, `browserStemSeparation.ts:30`) to
    "scope the mutation surface". This is a workaround for an architectural
    issue (module-private mutable state) and the inline comments admit
    they're partial fixes ("HMR still discards"). This deserves a
    proper persistent-store solution rather than five copies of the
    pattern.

27. **`AnalysisOptions` `bufferSize` is not forced to a power of two.**
    `audioFeatures.ts:60`: Meyda requires power-of-two `bufferSize`.
    `extractFeatures(id, { bufferSize: 1500 })` will silently produce
    nothing useful. Validate or clamp.

28. **`PolyphonicAudioToMidiOptions.minNoteLength = 11` units undocumented.**
    `polyphonicAudioToMidi.ts:67`: BasicPitch's `minNoteLength` is in
    frames (1 frame ≈ 11 ms at 22050 Hz / spectrogram hop). Calling code
    sees a "default 11" and may pass milliseconds. Either rename or
    type-brand.

29. **AGENTS.md function-signature rule violated.** `audioToMidi.ts:88`
    `detectOnsets(buffer: AudioBuffer, sensitivity: number,
minIntervalSec: number)` takes three positional parameters; per
    AGENTS.md "Functions with more than one parameter take a single
    object param" this should be `{ buffer, sensitivity, minIntervalSec
}`. Same for `detectPitchForOnsets` (`:141`), `computeRmsEnergy`
    (`:24`), `estimatePitch` (`:37`), `freqToMidiPitch` (`:84`),
    `insertPolyphonicMidiNotes` (`:18`), and the `audioToMidi` use case
    (which already takes an object — but `targetPitch`, `minInterval`
    are advertised but unused by the handler — see #3).

30. **`#/modules/AudioAnalysis/models/MixComparisonTypes` re-imported by
    `compareMixes.ts` via the absolute alias.** `compareMixes.ts:2-7`
    uses `#/modules/AudioAnalysis/models/...`. AGENTS.md: "Files under
    `src/modules/<Name>/` MUST NOT import from `#/modules/<Name>` (their
    own barrel)". The alias here is to a private models path, not the
    root barrel, but it still goes through `#/modules/AudioAnalysis/...`.
    Should be relative `../../../models/MixComparisonTypes`.
    `referenceMixComparison/analyzeMix/analyzeMix.ts:2` and
    `referenceMixComparison/analyzeMix/createReferenceAnalysis.ts:1` have
    the same problem.

31. **`useCases/index.ts` exports types from use cases.** Lines 12, 15,
    18, 23, 26 export `type` names. AGENTS.md "Use-case types stay
    private": "Do not `export type` from `useCases/` for other modules".
    Compounded by the root `index.ts` re-exporting the whole barrel.

32. **No status / progress feedback for long-running operations.**
    `polyphonicAudioToMidi` takes an `onProgress` callback but no handler
    plumbs it. `separateStems` and `generateAudio` (~235 MB / ~1.7 GB
    model downloads, ~10–60 s inference) emit only `logger.info(...)` —
    UI never sees a progress event. From a UX perspective the user
    triggers a command via `executeAppAction` and waits with no
    indication anything is happening.

33. **Accessibility / ARIA.** No presentation-layer files in this
    module — there is nothing to mark as `role="status"` or
    `aria-live`. But the `notifyUser(...)` calls in `handleDetectKey`,
    `handleDetectTempo`, `handleCompareToReference`, etc. assume the
    notification subsystem is screen-reader-friendly. Cross-reference
    item: the `Notification` module audit should confirm this; from
    here we only note that long-running analyses surface no progress to
    AT.

34. **Empty `handlers/` is at module level — convention check.** AGENTS.md
    "**Command handlers (non-contract):** `handlers/`" is followed; OK.
    But `handlers/analysis/` is the only sub-folder, with a single
    sibling concept — a flat `handlers/` would be simpler.

---

## Priorities

(Adversarial-review pass — `2026-04-28`. P-bands assigned after re-reading every cited file.)

1. **P0 — Track-config `analyzeMix` confuses linear gain with dB**
   (new issue #34). `referenceMixComparison/analyzeMix/analyzeMix.ts:62-65`
   reads `track.gain` (a linear value with default `0.8`, clamped 0–2 in
   the audio graph) and writes `rmsDb = avgGain - 6` and
   `peakDb = avgGain - 1` directly into a `MixAnalysis` whose contract
   is dBFS. Every downstream comparison (`compareToReference`,
   `compareMixes`) reads these as dB. Magnitudes off by 18+ dB.
2. **P0 — Master `AnalyserNode.fftSize = 256` makes `analyzeMix.frequencyBalance` near-useless**
   (new issue #35). `mixAnalysisHelpers.readFrequencyBalance` runs over
   128 bins (`createWebAudioEngine.ts:57`). At 48 kHz that's ≈187 Hz
   per bin — the entire `sub` (20–60 Hz) and most of `bass` (60–250 Hz)
   collapse into bin 1. The "muddy" / "harsh" detection in
   `detectIssues` therefore fires off unrelated cells.
3. **P0 — Test mocks pointing at the wrong module path** (issues #2 /
   #25) — four key tests exercise zero production DSP and have been
   silently green. Verified: every spec confirmed, no mitigating
   `vi.mock('#/modules/AudioEngine/stores')` exists in any of them.
4. **P1 — `handleAutoFixMix` race + arithmetic errors** (issue #7) —
   the handler can emit nonsensical gains _and_ presents a stale
   "refreshed" analysis as if it reflected the fix. Verified line-by-line
   below; the master-bus formula has a different sign-failure mode than
   the per-track one.
5. **P1 — `compareToReference` is synthetic-vs-synthetic** (issues #1,
   #6) — the comparison feature is misleading-by-construction. With
   #34 it is _additionally_ wrong, not just synthetic.
6. **P1 — `handleAudioToMidi` drops payload fields** (issue #3) —
   silent data loss across the action contract.
7. **P2 — DSP correctness slate** (issues #4, #5, #11, #12, new #36) —
   key-detection magic constants, tempo histogram triple-counting, onset
   off-by-one, autocorrelation octave bias, and the duplicate
   `estimatePitch` re-implementation that pitchy already supersedes.
8. **P2 — Hot-loop allocation and racing-unsafe singletons** (issues
   #8, #10, #9). Ranked below correctness because the OOM hazard
   requires concurrent stem-separation invocations the current UI
   doesn't drive — but the cost of a fix is small.
9. **P3 — Architectural / AGENTS.md drift** (issues #14, #15, #16,
   #17, #18, #23, new #37–#40). Not behavioural, but normalising the
   violations costs nothing if done with the correctness pass.

---

## Open issues

### 1. Two `analyzeMix` use cases collide on a name

**Problem:** Both `useCases/analyzeMix.ts` (live analyser-based) and
`useCases/referenceMixComparison/analyzeMix/analyzeMix.ts` (track-config
estimate) export a function called `analyzeMix`. The barrel re-exports
the second under an alias; the first keeps the canonical name. Imports
within the module that pull both end up needing `as` renames, and the
two functions are not interchangeable.

**Verified 2026-04-28:** Still present.
- `useCases/analyzeMix.ts:40` exports `analyzeMix(): Promise<AnalyzeMixOutput>` — async, reads `getMasterAnalyser` / `getTrackStrip`.
- `useCases/referenceMixComparison/analyzeMix/analyzeMix.ts:53` exports `analyzeMix(): MixAnalysis` — sync, reads `trackStore.value`, makes up frequency profile from track-kind ratios.
- `useCases/index.ts:13` exports the live one as `analyzeMix`; `:30` exports the synthetic one as `analyzeMixFromTrackLayout`.

**Root cause:** The track-config estimator was added in lieu of a real
audio-buffer analysis path for `compareToReference`. Naming the
function `analyzeMix` propagates the lie that it analyses anything.

**Blast radius:**
- `compareMixes.ts:118` calls the synthetic one (and inherits issue #34's unit bug).
- `AiRuntime/useCases/musicMentor/generateLessons.ts:9-25` imports `analyzeMixFromTrackLayout`, aliases it back to `analyzeMix`, and treats `lufs`, `crestFactor`, `dynamicRange` as real signal — they are constants of `gain - 6`.
- Internal collision: any file in the module that imports both will need an `as` rename — confirmed in `compareMixes.ts:9` (relative import is fine but adds confusion).

**Representative files:**

- `src/modules/AudioAnalysis/useCases/analyzeMix.ts:40`
- `src/modules/AudioAnalysis/useCases/referenceMixComparison/analyzeMix/analyzeMix.ts:53`
- `src/modules/AudioAnalysis/useCases/index.ts:13,30`
- `src/modules/AiRuntime/useCases/musicMentor/generateLessons.ts:9,15`

**Needed:** Rename the track-config estimator to something honest
(`estimateMixFromTrackLayout`, `synthesiseMixFingerprint`). Keep the
live-analyser one as the single `analyzeMix`. Update
`compareToReference` either to consume the live one (after #34/#35 fix
the unit bug and the FFT size) or to take a real reference-track
buffer (see #6). Audit `generateLessons` — the music-mentor
pipeline is producing pedagogy from constants right now.

### 2. Test mocks target `#/modules/AudioEngine/useCases` instead of `…/stores`

**Problem:** Four spec files mock the wrong import path. Production
imports `audioBufferCache` from `#/modules/AudioEngine/stores`. Tests
mock `#/modules/AudioEngine/useCases`. The mock factory is never
applied; production code falls through to the real
`audioBufferCache.get(...)` which returns null for the test's missing
ids. Tests pass but cover nothing.

**Verified 2026-04-28:** Still present in all four files.
- `keyDetection.ts:1` imports `from '#/modules/AudioEngine/stores'`. `keyDetection.spec.ts:8` mocks `#/modules/AudioEngine/useCases`.
- `tempoDetection.ts:1` / `tempoDetection.spec.ts:3` — same mismatch.
- `pitchDetection.ts:13` / `pitchDetection.spec.ts:3` — same mismatch.
- `audioFeatures.ts:13` / `audioFeatures.spec.ts:3` — same mismatch.
- `audioBufferCache` is **only** exported from `#/modules/AudioEngine/stores` (`AudioEngine/stores/index.ts:5`). It is not re-exported from `useCases`. So the mocks are inert.

**Root cause:** Four specs were created or refactored against a
different barrel layout (or copy-pasted from an older one); nothing in
CI catches the silent inertness because `audioBufferCache.get('present')`
returns `undefined` either way for the test fixtures.

**Blast radius:**
- Issues #4, #5, #11, #12, #25, #36 sit underneath these tests. Any DSP refactor will land green.
- `audioToMidi.spec.ts:20` mocks the **correct** path — it is a counter-example that proves the right mock works. Use it as the template.

**Reproduction:** Add `console.log('mocked')` inside the test's mock
factory and run `pnpm vitest keyDetection`. The log never fires.

**Fix sketch:** One-line change per file:
`vi.mock('#/modules/AudioEngine/useCases', …)` →
`vi.mock('#/modules/AudioEngine/stores', …)`. Then add a positive-path
test per file (synthesised sine wave / impulse train / chord) — without
that the mock-fix only proves the code _runs_, not that it is correct.

**Representative files:**

- `src/modules/AudioAnalysis/useCases/__tests__/keyDetection.spec.ts:8`
- `src/modules/AudioAnalysis/useCases/__tests__/tempoDetection.spec.ts:3`
- `src/modules/AudioAnalysis/useCases/__tests__/pitchDetection.spec.ts:3`
- `src/modules/AudioAnalysis/useCases/__tests__/audioFeatures.spec.ts:3`

**Needed:** Fix the mock paths to `#/modules/AudioEngine/stores` and
add at least one positive-path test per file. The "buffer missing →
null" tests are not enough to catch DSP regressions.

### 3. `handleAudioToMidi` drops payload fields

**Problem:** `audioToMidi` action payload allows `mode: string` but the
`audioToMidi` use case accepts `targetPitch` and `minInterval`. The
handler does not forward the latter two; the action contract advertises
`mode: string` (not the discriminated `'rhythm' | 'pitched'`), so a
caller passing a typo lands silently in `'rhythm'`. There is also no way
to set `targetPitch` from the command bus.

**Verified 2026-04-28:** Confirmed both ends.
- `Command/models/AppAction.ts:259` and `Command/useCases/commandQueries.ts:256`: `{ clipId; trackId?; sensitivity?; mode? }` — no `targetPitch`, no `minInterval`.
- `useCases/audioToMidi.ts:6-13`: `AudioToMidiOptions` types accept all four.
- `handleAudioToMidi.ts:14-21` forwards exactly four fields and runs `mode` through a permissive `normalizeAudioToMidiMode` (`:5-11`) that silently coerces anything ≠ `'pitched'` to `'rhythm'`.

**Root cause:** The action contract was widened to `mode: string`
without tightening it back to a discriminated union when the use-case
side knew the valid values. The two extra params were added to the use
case for direct callers (none currently exist outside the handler) and
never propagated to the contract.

**Blast radius:** Currently inert because no caller passes these
fields. But:
- The `AppAction` shape is the AI tool surface — agents constructing actions can pass `mode: 'pitched'` and the rest will silently default. They cannot pass `targetPitch`, so pitched conversions all land on MIDI 36 (C2 — kick drum range). For melodic content this is wrong silently.
- `Command/models/commands/aiCommands.ts:160` dispatches with only `clipId`. So the AI lesson path uses defaults exclusively — confirms the fields are dead-on-arrival.

**Fix sketch:**
- Tighten `AppAction` payload `mode` to `'rhythm' | 'pitched'` (drop `normalizeAudioToMidiMode`).
- Add `targetPitch?: number` and `minInterval?: number` to the payload **or** delete them from `AudioToMidiOptions` (only one direct caller — the handler).

**Representative files:**

- `src/modules/AudioAnalysis/handlers/analysis/handleAudioToMidi.ts:14`
- `src/modules/AudioAnalysis/useCases/audioToMidi.ts:160`
- `src/modules/Command/useCases/commandQueries.ts:256`
- `src/modules/Command/models/AppAction.ts:259`

**Needed:** Per fix sketch above. Add a test in `handleAudioToMidi.spec.ts`
that asserts `mode: 'gibberish'` reaches the use case as a typed error
(once the union tightens), not a silent coercion.

### 4. `keyDetection.ts` key-confidence calibration is under-specified

**Problem:** The implementation is non-windowed (rectangular =
spectral leakage), sums magnitudes across six octaves without per-bin
normalisation, uses `Math.abs` over a quantity that for real input is
already non-negative, and derives confidence from a magic constant.

**Verified 2026-04-28:** Source unchanged.
- `keyDetection.ts:22` — outer `for (frame; frame + fftSize < data.length; frame += hopSize)`. Bounds: inner loop `index < fftSize`, so `frame + index < frame + fftSize < data.length`. **The previous audit's claim of an out-of-bounds inner read is wrong.** Withdrawn from the "Needed" — the `?? 0` is dead defensive code, not a bug fix.
- `keyDetection.ts:33` — `let s0: number,` is declared without initialiser but is always assigned at `:38` before `:43` reads `s1`/`s2` only. `s0` is only used inside the loop and is overwritten before any read. **TS-strict noise; not a runtime bug.** Also withdrawn.
- `keyDetection.ts:43` — Goertzel "power" formula `s1*s1 + s2*s2 - coeff*s1*s2` matches the textbook squared-magnitude form for `coeff = 2*cos(w)`. For real-valued time-domain input this is non-negative; `Math.abs` is a paranoia coat that masks any future regression. **Cosmetic, not a bug.** Demote to a code-smell.
- `keyDetection.ts:82` — `confidence = Math.min(1, bestCorr / 30)`. Magic constant. Krumhansl-Schmuckler correlation magnitudes scale with `Σ chroma_i * profile_i`; with the chroma normalised to max=1 (`:54`) and the profile sum ≈ 41 (major) / 42 (minor), a perfect template fit gives `bestCorr ≈ 41`, so the cap of 30 saturates at ~73% match. **Real calibration bug.**
- Real bugs that remain: rectangular window (spectral leakage); raw magnitudes summed across octaves (no octave normalisation, low octaves dominate); `confidence` magic number.

**Root cause:** Implementation written from a textbook chroma sketch
without a calibration pass. The audit's previous "Goertzel inner
overshoots" claim was a false-positive — the inner loop runs `index <
fftSize` and the outer guard is `frame + fftSize < data.length`.

**Blast radius:** `handleDetectKey` is wired to a `notifyUser` toast,
so the visible symptom is "C major at 95% confidence" for clearly
non-C audio. No other module depends on the confidence number.

**Related sites:** `audioFeatures.ts` already extracts `chroma` from
Meyda — the same data the Goertzel pass is hand-rolling. There are
two chroma paths in this module today (Goertzel here, Meyda there).

**Fix sketch:**
- Apply a Hann window inside the inner loop (precompute once outside).
- Normalise per-octave: divide each octave's contribution by its bin width before summing across octaves.
- Replace `bestCorr / 30` with `bestCorr / Σ profile`. Even better, use Pearson correlation against the profile (zero-centred, unit-variance) — the canonical Krumhansl-Schmuckler form.
- Or: replace the entire Goertzel pass with `Meyda.extract(['chroma'], …)`.

**Representative files:**

- `src/modules/AudioAnalysis/useCases/keyDetection.ts:22-46,82`

**Needed:** Per fix sketch. Add a positive-path test that detects C
major from a synthesised C-E-G chord (depends on issue #2 fix).

### 5. `tempoDetection.ts` slice-per-frame and triple-counted histogram

**Problem:** A `slice(...).reduce(...)` is allocated per frame. The
histogram weighting adds the _same_ interval to the bin, half-bin, and
double-bin; if a track's true tempo lands between bins, the
half/double bins receive 50% weight that biases the histogram peak
toward whichever harmonic resolves cleanest. The "normalize to 60–200
BPM" doubling is naive: a 50 BPM ballad with strong 100 BPM doubles
can flip-flop.

**Verified 2026-04-28:** Source unchanged.
- `tempoDetection.ts:30` — `energies.slice(Math.max(0, index - 10), index).reduce(...)` per frame.
- `tempoDetection.ts:54-62` — triple-counts `binMs`, `binMs/2`, `binMs*2` with `0.5` weight on the harmonics.
- `tempoDetection.ts:80-86` — `while normalizedBpm < 60 multiply by 2; while > 200 divide by 2` — non-deterministic for in-between values.

**Root cause:** The detector was written without distinguishing
"unbiased histogram of inter-onset intervals" from "tempo posterior
under harmonic priors". They are different operators; the code mixes
them and the priors are baked into the histogram values rather than
applied at decision time.

**Blast radius:**
- `handleDetectTempo` runs this on a per-clip basis. False tempo lands as a `notifyUser` toast — not corrupting, but eroding trust.
- Allocations: at 5 minute clip × 100 frames/sec = 30 000 sub-array allocs per detection; trivially fixed with a moving sum.

**Related sites:** `Transport/useCases/detectProjectTempo` is invoked
as a fallback in `handleDetectTempo.ts:23`. If both heuristics
disagree, `handleDetectTempo` always prefers the buffer-based
detection (`:14-21`) — no cross-validation.

**Fix sketch:**
- Replace `slice + reduce` with a running-sum window: `running -= energies[i - 10]; running += energies[i];` and divide by `min(i, 10)`.
- Drop the half/double weighting from the histogram. Apply harmonic priors at the _peak-picking_ stage: pick all top-3 candidates, then pick whichever yields the highest local autocorrelation against the original onset train.
- Replace `> 2 × moving average` with a percentile threshold (e.g. 75th of the moving window).

**Representative files:**

- `src/modules/AudioAnalysis/useCases/tempoDetection.ts:14-89`

**Needed:** Per fix sketch. Add tests that detect 120 BPM from a
click-track fixture (depends on issue #2's mock-path fix) and verify
the histogram normalisation.

### 6. `compareToReference` is synthetic-vs-synthetic

**Problem:** The "current mix" and "reference" are both synthesised from
constants (gain heuristics and a hard-coded mastered fingerprint).
There is no path to load a user-supplied reference track and analyse
_its_ `MixAnalysis`. The percentage shown to users is therefore a
function of mute/gain/pan settings only.

**Representative files:**

- `src/modules/AudioAnalysis/useCases/referenceMixComparison/analyzeMix/analyzeMix.ts`
- `src/modules/AudioAnalysis/useCases/referenceMixComparison/analyzeMix/createReferenceAnalysis.ts`
- `src/modules/AudioAnalysis/useCases/referenceMixComparison/compareMixes.ts:117`

**Needed:** Plumb a real reference `AudioBuffer` or pre-rendered mix
analysis through `compareToReference`. If the feature is intentionally
a heuristic for now, the toast and any UI should clearly say
"estimated based on track settings". As-is, the message implies real
audio analysis happened.

### 7. `handleAutoFixMix` race condition and inverted-sign clipping math

**Problem:** Three sub-issues — gain-math sign error per-track,
gain-math sign error on master, and a race between
`setTrackGain`/`setMasterGain` and the second `analyzeMix` read.

**Verified 2026-04-28:** Source unchanged. Walked through line-by-line:

```
:22  const overshootDb = tl.peakDb + 0.5;          // for peakDb=+1 → 1.5; peakDb=-10 → -9.5
:23  const currentLinear = 10 ** (tl.peakDb / 20); // *peak* in linear (not the strip's gain)
:24  const targetLinear = currentLinear / 10 ** ((overshootDb + 3) / 20);
:25  const newGain = Math.max(0, Math.min(1, targetLinear));
:26  setTrackGain({ trackId, gain: newGain });
```

- The branch is gated on `tl.isClipping` (`:21`), which is true only when `peakDb > -0.5`. Within the gate the formula is "currentLinear / 10^((peakDb + 3.5)/20)" — for peakDb = +1, that's `1.122 / 10^(0.225) = 1.122 / 1.679 = 0.668` linear (-3.5 dBFS). That **is** an in-range reduction — but it _replaces_ the existing track gain rather than _multiplying into_ it. A track at gain `0.8` clipping at +1 dBFS would drop to gain `0.668` — but if the track was clipping at +1 dBFS with strip gain at 0.5, the source signal is +7 dBFS internally and a strip gain of 0.668 still clips. **The fix only works if the strip gain was 1.0 before.**
- `:33-38` (master): the gate is `peakDb > -3`, but the formula is `reductionDb = peakDb + 6` then `targetMasterLinear = currentMasterLinear / 10 ** (reductionDb/20)`. For peakDb = -1: reduction 5 dB, `1/10^0.25 = 0.562` linear (-5 dBFS). This is _further_ from the -3 dB ceiling than needed (a 2 dB cut would be enough). For peakDb = -2.9 (just inside the gate), reduction = 3.1 dB → `0.7` linear, which on a master sitting at 0.8 means the master's perceived peak shifts from -2.9 to -2.9 - 1 dB = -3.9 dBFS — fine, but again replaces rather than multiplies.
- `:41` (race): `setMasterGain`/`setTrackGain` dispatch via `executeAppAction` (`:26`, `:38`); these resolve the Promise after the action handler runs, but the audio-graph apply is `setTargetAtTime` with a 10 ms time constant (see `BusNode.ts:30`). The second `analyzeMix` reads `getMasterAnalyser()` immediately afterwards — the analyser has `smoothingTimeConstant = 0.8` (`createWebAudioEngine.ts:58`), so the displayed peak is dominated by samples from before the gain change.

**Root cause:** Two distinct bugs. (a) The gain math assumes "set strip
gain to a function of current peak", but the strip gain and the peak
are independent variables — you must compute `requiredReductionDb`
from `peakDb - targetCeilingDb` and multiply that into the existing
gain. (b) The "refresh" pass after the fix never waits for the audio
graph to absorb the gain ramp.

**Blast radius:**
- `mixAnalysisStore` is the source of truth for the `MixAnalysisPanel` UI (`AiRuntime/presentations/views/MixAnalysisPanel.tsx`). Users see the second analysis as "after auto-fix". When the race wins, the panel says "fixed" while showing pre-fix numbers.
- Tests at `handleAutoFixMix.spec.ts:60-83` only verify the dispatch _happens_, not the gain values. The first analyzeMix returns `peakDb: 2` (clipping) and the test expects an `executeAppAction` call — but the test never asserts the **value** of `gain` passed. So the formula could be mathematically wrong and the test would still pass.

**Related sites:** `services/mixAnalysisHelpers.ts:200-211` already
emits suggestions like "reduce gain by `${overshoot}` dB" with
**different math** (`overshoot = peakDb + 0.5`, not `peakDb + 3.5`).
The toast and the auto-fix disagree.

**Fix sketch:**
- Compute `reductionDb = peakDb - targetCeilingDb` (e.g. -1 dBFS for the master, -3 dBFS for the strip headroom).
- Read the current strip gain via the audio engine (`getTrackStrip(trackId)?.gain` or similar) — do **not** infer it from peakDb.
- New gain = `currentGain * 10^(-reductionDb/20)` (subtract dB, divide linear).
- For the second analysis: either drop it (and have the UI poll on `mixAnalysisStore` once the next animation frame fires), or `await new Promise(r => setTimeout(r, 50))` to let the analyser smoothing settle (still racey but at least not 0 ms).
- Add an `expect(executeAppAction).toHaveBeenCalledWith({ type: 'setTrackGain', payload: { trackId: 't1', gain: <number> } })` with a numeric tolerance.

**Representative files:**

- `src/modules/AudioAnalysis/handlers/analysis/handleAutoFixMix.ts:21-39,41`
- `src/modules/AudioAnalysis/services/mixAnalysisHelpers.ts:200-211`
- `src/modules/AudioEngine/engine/BusNode.ts:30` (smoothing constant)

**Needed:** Per fix sketch. Cross-check against
`mixAnalysisHelpers.generateSuggestions` so the toast text and the
applied gain agree.

### 8. Module-level mutable singletons, racing-unsafe

**Problem:** `polyphonicAudioToMidi.ts:45` and
`browserStemSeparation.ts:30,103-136` initialise heavy resources
lazily. Two concurrent callers both see `null`, both
download/instantiate the model, and the last write wins. The 235 MB
ONNX session leak on a double-load is OOM-class.

**Verified 2026-04-28:**
- `polyphonicAudioToMidi.ts:45-53` — `modelHolder.instance` populated synchronously on first hit; the `BasicPitch` constructor itself is _sync_, so the race window is the model file fetch inside the BasicPitch instance. Smaller race than the audit suggested but still real.
- `browserStemSeparation.ts:105-136` — `getSession` is `async`; the race is the entire `await ort.InferenceSession.create(modelBuffer, …)`, which is the multi-second 235 MB allocation. `:113` populates `ortSession.ort` lazily as well, with the same race.

**Root cause:** A holder object scopes the binding mutability but does
nothing to coalesce concurrent callers. The pattern needs a Promise
singleton, not a value singleton.

**Blast radius:**
- Two parallel UI clicks on "stem separate" before the first finishes → two `ort.InferenceSession.create` calls → ~470 MB peak before GC. On a 4 GB browser tab this trips a low-memory pressure event.
- `getModelBuffer()` (`:65-100`) is also called from inside the race; both calls hit the Cache API at once, both win cache hits the second time, but the first time the network is double-fetched (~470 MB transit).

**Reproduction steps:**
1. Click "Stem separate" on clip A.
2. Within ~2 s (before model load resolves) click "Stem separate" on clip B.
3. Observe two `[Browser Stems] Creating ONNX session ...` log lines and ~470 MB heap growth.

**Related sites:**
- `Mixer/repositories/createOnnxRuntime.ts` (if it exists in another module) — search for any other module that imports `onnxruntime-web` directly. The duplicate import is wasteful.
- `Mixer/useCases/...` for any other model holder that may have the same pattern. Outside this audit's scope but worth flagging.

**Fix sketch:** In each file, change the holder to
`{ promise: Promise<X> | null }` and:

```ts
if (!holder.promise) holder.promise = init();
return holder.promise;
```

Pass-through reads see the same Promise; the second caller `awaits`
the first's `init()` and never starts a parallel one.

**Representative files:**

- `src/modules/AudioAnalysis/useCases/polyphonicAudioToMidi.ts:45-53`
- `src/modules/AudioAnalysis/repositories/browserStemSeparation.ts:30,113,105-136`

**Needed:** Per fix sketch. Add a test invoking the use case twice
concurrently with `Promise.all` and asserting `InferenceSession.create`
was called exactly once.

### 9. `extractFeatures` mutates Meyda's global state non-reentrantly

**Problem:** `Meyda.sampleRate` and `Meyda.bufferSize` are global. Two
concurrent `extractFeatures` calls (e.g. parallel clip analysis) will
clobber each other's settings mid-iteration.

**Representative files:**

- `src/modules/AudioAnalysis/useCases/audioFeatures.ts:71-72`

**Needed:** Use `Meyda.createMeydaAnalyzer` (per-instance config) or
serialise calls behind a queue. Document the constraint in the JSDoc.

### 10. Hot-loop and per-segment allocations in `browserStemSeparation`

**Problem:** A 2.7 MB `Float32Array` per segment, plus a JS-level
double-nested for-loop copying samples one at a time. At a typical
3-minute song (~22 segments) this allocates ~60 MB of input tensors.

**Verified 2026-04-28:**
- `browserStemSeparation.ts:180` — `new Float32Array(2 * DEMUCS_SEGMENT_LEN)` per segment. `DEMUCS_SEGMENT_LEN = 343980` (`:15`), so `2 × 343980 × 4 bytes = 2.62 MB` per segment. Confirmed.
- `:184` — wrapped into a new `ort.Tensor` per segment, which holds a reference to that buffer through inference; the next `new Float32Array(...)` doesn't fully reclaim until the previous tensor's GC (cross-realm — the tensor sits in the WASM/WebGPU side).
- `:207-213` — the JS double-loop `for (let state ... for (let jIndex ...)` writes one sample at a time. Each `outData[lIdx]` is a typed-array read; `?? 0` returns `0` only for out-of-bounds indices, **but TypedArray out-of-bounds reads don't return `undefined`, they return `undefined` only via `at()`, _not_ via `[]` access.** Confirmed: `(new Float32Array(4))[100]` is `undefined` in TS but at runtime is `undefined` too — actually correct, the `?? 0` is reachable when `lIdx >= outData.length`. With `nStems=6, nCh=2, segOutLen=DEMUCS_SEGMENT_LEN=343980` and `state in [0,5], jIndex in [0, copyLen)` where `copyLen <= segOutLen`, the maximum `lIdx = 5 * 2 * 343980 + (343980 - 1) = 3 783 779`, but `outData.length = dims.product = 1*6*2*343980 = 4 127 760`. So in the typical case `lIdx < outData.length`. The `?? 0` only triggers if dims claims fewer stems than expected. **The audit's "dead defensive code" claim was correct — the fallback only fires on malformed model output.**

**Root cause:** Implementation written as if scripting Python/NumPy,
without TypedArray-native batch ops.

**Blast radius:** Memory allocation flood in browser tabs already
holding a 235 MB ONNX session. With 22 × 2.62 MB = ~58 MB of transient
input tensors, plus the WASM-side mirror, total transient allocation
is ~120 MB per separation request. The CPU cost of the per-element
copy is negligible vs. inference, but the GC pressure is observable.

**Related sites:**
- `polyphonicAudioToMidi.ts:103-111` allocates an `OfflineAudioContext` per call for resampling (smaller — single allocation per request, bounded by clip length).
- `audioFeatures.ts:77` already adopts the "allocate-once / reuse" pattern. Use it as the precedent here.

**Fix sketch:**
- Pre-allocate `inputData` and `inputTensor` once outside the segment loop; `inputData.set(left.subarray(offset, end), 0); inputData.fill(0, end - offset, DEMUCS_SEGMENT_LEN);` plus the right-channel mirror.
- Replace the inner copy with `stemL[state].set(outData.subarray(state * nCh * segOutLen, state * nCh * segOutLen + copyLen), offset)` and similarly for the right channel.
- Drop the `?? 0` after asserting `outData.length === expectedSize` once at the top of the segment loop.

**Representative files:**

- `src/modules/AudioAnalysis/repositories/browserStemSeparation.ts:172-216`

**Needed:** Per fix sketch.

### 11. Off-by-one onset timing in `audioToMidi.detectOnsets`

**Problem:** The peak frame is at `index`; the code reports onset time
at `(index + 1) * HOP_SIZE / sampleRate` and amplitude at
`energies[index + 1]`. ~11 ms shift at 44.1 kHz / 512 hop, compounded
across two metrics.

**Representative files:**

- `src/modules/AudioAnalysis/useCases/audioToMidi.ts:122-135`

**Needed:** Use `index * HOP_SIZE / sampleRate` and
`energies[index + 1] - energies[index]` for the flux but
`energies[index]` (or `energies[index + 1]` if you intend the rising
edge — pick one and document).

### 12. `audioToMidi.estimatePitch` octave bias

**Problem:** Loop iterates from `minLag` upward and accepts the _first_
correlation past 0.3 — meaning the highest fundamental that just
crosses the threshold wins. A duplicate, less-accurate version of the
detector that already exists in `pitchDetection.ts` (MPM via `pitchy`).

**Representative files:**

- `src/modules/AudioAnalysis/useCases/audioToMidi.ts:37-82`

**Needed:** Replace `estimatePitch` with a `pitchy` `PitchDetector`
call (windowed) and reuse the existing detector. Remove the dead
autocorrelation implementation.

### 13. `endBeat` ceil + duration unit mismatch when inserting MIDI

**Problem:** Both `audioToMidi` and `insertPolyphonicMidiNotes`
`Math.ceil(endBeat)` the source clip when creating the destination
MIDI clip. Combined with note positions in real beats, the MIDI clip
holds notes that play _past_ the source's `endBeat`. The minimum
duration in `insertPolyphonicMidiNotes.ts:54` is `0.0625` (presumably
1/16 beat) clamped against a beats value, with no comment.

**Representative files:**

- `src/modules/AudioAnalysis/useCases/insertPolyphonicMidiNotes.ts:39,54`
- `src/modules/AudioAnalysis/useCases/audioToMidi.ts:206`

**Needed:** Use `endBeat` directly (not ceil), or clamp final note end
to `endBeat`. Move `0.0625` to a named constant (`MIN_NOTE_DURATION_BEATS`).

### 14. `audioAi/*.ts` are five empty pass-throughs

**Problem:** Five files in `useCases/audioAi/` re-export the
same-named function from `repositories/audioAiEngine.ts` with zero
added behaviour. They satisfy the "use cases wrap repositories"
convention cosmetically but add no value.

**Verified 2026-04-28:**
- `isAudioGenerationAvailable.ts` — 5 lines, single `return checkAudioGenerationAvailability()`.
- `isStemSeparationAvailable.ts` — 9 lines including JSDoc, single `return …`.
- `isAudioAiServerRunning.ts` — 5 lines, single `return checkAudioAiServerStatus()`.
- `generateAudio.ts` — 9 lines, forwards 3 args.
- `separateStems.ts` — 5 lines, forwards 2 args.
- Each file has a `__tests__/<name>.spec.ts` that only verifies "the export is defined" (e.g. `generateAudio.spec.ts:7-10`). Confirmed via `grep "should export"` — six pass-throughs total, four of which test nothing more than `expect(subject.x).toBeDefined()`. **These tests provide false confidence**: deleting the function body but keeping the export would still pass.

**Root cause:** Convention-driven: "use cases wrap repositories" was
applied without checking whether each file earned its keep. The tests
were generated by the same convention without checking whether they
asserted behaviour.

**Blast radius:** Architectural drift. Once five empty pass-throughs
ship, the next dev sees them as the pattern and mints more. Plus six
files of `git diff` noise on every refactor.

**Related sites:** Search the codebase for other modules with
`useCases/<subdir>/<fnName>.ts` re-exporting `repositories/<fnName>` —
likely Mixer, AiGeneration. Outside this audit's scope but a flag.

**Fix sketch:**
- Delete the five files and their `__tests__/`.
- Re-export directly from `useCases/index.ts`:
  `export { isAudioGenerationAvailable, isAudioAiServerRunning, isStemSeparationAvailable, generateAudio, separateStems } from '../repositories/audioAiEngine';`.
- AGENTS.md "One Function Per File" applies to `useCases/` and
  `repositories/` files — the repository file already violates this
  with five exports (see #38), so the cleaner long-term fix is to
  split the repo into five files and inline the use-case wrappers.

**Representative files:**

- `src/modules/AudioAnalysis/useCases/audioAi/isAudioGenerationAvailable.ts`
- `src/modules/AudioAnalysis/useCases/audioAi/isAudioAiServerRunning.ts`
- `src/modules/AudioAnalysis/useCases/audioAi/isStemSeparationAvailable.ts`
- `src/modules/AudioAnalysis/useCases/audioAi/generateAudio.ts`
- `src/modules/AudioAnalysis/useCases/audioAi/separateStems.ts`
- `src/modules/AudioAnalysis/useCases/audioAi/__tests__/*.spec.ts` (4 of 5 are export-presence-only)

**Needed:** Per fix sketch.

### 15. `isAudioAiServerRunning` is async-for-no-reason

**Problem:** Returns `Promise.resolve(isTauri())` with an `eslint-disable
@typescript-eslint/require-await` comment. Forces every call site to
`await` a synchronous environment check.

**Representative files:**

- `src/modules/AudioAnalysis/repositories/audioAiEngine.ts:34-37`
- `src/modules/AudioAnalysis/useCases/audioAi/isAudioAiServerRunning.ts`

**Needed:** Make it sync (`(): boolean`). Update consumers (one
call site internally; the AppAction surface is unaffected).

### 16. Type-assertion escape in `browserStemSeparation`

**Problem:** `session as unknown as OrtSession` (`browserStemSeparation.ts:133`)
is a double-cast that bypasses index-signature variance. AGENTS.md
forbids `as unknown as …` to silence the compiler.

**Representative files:**

- `src/modules/AudioAnalysis/repositories/browserStemSeparation.ts:132-133`

**Needed:** Define `OrtSession.run` with a return type that matches
onnxruntime's `InferenceSession.run` (use `Awaited<ReturnType<typeof
session.run>>` or import the upstream type). Drop the eslint-disable.

### 17. Self-barrel and use-case-type-export violations

**Problem:**

- Three files import from `#/modules/AudioAnalysis/...` from inside the
  module (AGENTS.md "Same module — relative imports").
- `useCases/index.ts` re-exports `type` declarations
  (`AudioFeatures`, `AudioFeaturesSummary`, `AnalysisOptions`,
  `AudioToMidiOptions`, `DetectedOnset`, `InsertPolyphonicMidiNotesResult`,
  `PitchResult`, `PitchTrackingOptions`, `PolyphonicAudioToMidiOptions`,
  `PolyphonicAudioToMidiResult`).

**Verified 2026-04-28:**
- `useCases/referenceMixComparison/compareMixes.ts:1-7` imports `from '#/modules/AudioAnalysis/models/MixComparisonTypes'` — own-module absolute. Should be `../../models/MixComparisonTypes`.
- `useCases/referenceMixComparison/analyzeMix/analyzeMix.ts:2` — same pattern, should be `../../../models/MixComparisonTypes`.
- `useCases/referenceMixComparison/analyzeMix/createReferenceAnalysis.ts:1` — same pattern.
- `useCases/index.ts:12, 15, 18, 23, 26` — all `export type` lines confirmed; verified by re-reading the file.
- **The audit's previous claim of a root `src/modules/AudioAnalysis/index.ts` re-exporting `./useCases` is wrong: there is no such file.** AudioAnalysis follows the per-subdir pattern (`useCases/index.ts`, `stores/index.ts`, etc.) without a top-level barrel. This is a deviation from some other modules (Yeast, Transport, AiRuntime have only sub-folder barrels too — so the pattern is consistent). Cross-module consumers import from `#/modules/AudioAnalysis/useCases` directly.
- The type leakage is real and observable: `AiRuntime/useCases/musicMentor/generateLessons.ts` does `import { analyzeMixFromTrackLayout } from '#/modules/AudioAnalysis/useCases';` then uses `ReturnType<typeof analyzeMix>` (`:17,20`) — that's the workaround pattern AGENTS.md actually recommends, so the cross-module consumer is fine. The type **export** is still a violation per AGENTS.md "Use-case types stay private".

**Root cause:** The old "barrel that exposes both runtime and types"
convention was carried into this module. AGENTS.md tightened the rule
later; the file hasn't caught up.

**Blast radius:**
- `external` consumers can `import type { AudioFeatures } from '#/modules/AudioAnalysis/useCases'`. Search across the codebase: `grep -rn "import type.*AudioAnalysis/useCases" src/`. If any caller depends on these, removing the export breaks them; if not, it's a free clean-up.
- For the self-import paths, the violation is in `compareMixes.ts:2` and the two `analyzeMix/` siblings — three files total.

**Fix sketch:**
- Convert the three self-imports to relative.
- Strip every `export type` line from `useCases/index.ts`. Run `pnpm typecheck` — any cross-module `import type` from `useCases` will surface as an error; either move the type into the consumer or use `ReturnType<typeof fn>` / `Parameters<typeof fn>`.

**Representative files:**

- `src/modules/AudioAnalysis/useCases/referenceMixComparison/compareMixes.ts:1-7`
- `src/modules/AudioAnalysis/useCases/referenceMixComparison/analyzeMix/analyzeMix.ts:2`
- `src/modules/AudioAnalysis/useCases/referenceMixComparison/analyzeMix/createReferenceAnalysis.ts:1`
- `src/modules/AudioAnalysis/useCases/index.ts:12,15,18,23,26`

**Needed:** Per fix sketch. The previously cited
`src/modules/AudioAnalysis/index.ts` does not exist — withdraw that
representative file from the issue.

### 18. Function signatures take positional args (AGENTS.md violation)

**Problem:** Functions with multiple parameters use positional args.
AGENTS.md mandates a single object param.

**Representative files:**

- `src/modules/AudioAnalysis/useCases/audioToMidi.ts:24,37,84,88,141`
- `src/modules/AudioAnalysis/useCases/insertPolyphonicMidiNotes.ts:18`
- `src/modules/AudioAnalysis/repositories/audioAiEngine.ts:46-49,93,126`
- `src/modules/AudioAnalysis/repositories/browserStemSeparation.ts:38,138`
- `src/modules/AudioAnalysis/useCases/audioAi/generateAudio.ts:3-7`
- `src/modules/AudioAnalysis/useCases/audioAi/separateStems.ts:3`

**Needed:** Refactor each function to take a single object parameter
named `<FunctionName>Input` (per AGENTS.md). Mostly mechanical; care
with the public contract (`generateAudio`, `separateStems` are exposed
across modules).

### 19. `handleAutoFixMix` second-`analyzeMix` race

(Subset of issue #7 (a); kept separate so it can be addressed without
re-doing the gain math.)

**Problem:** `analyzeMix()` is called twice; the second read is not
synchronised with the audio graph having absorbed the dispatched
`setTrackGain`/`setMasterGain` actions.

**Representative files:**

- `src/modules/AudioAnalysis/handlers/analysis/handleAutoFixMix.ts:41`

**Needed:** Decide whether the second analysis is part of the user
contract (some toast or store value depends on it). If yes, await the
audio graph applying the gains (or a "next animation frame" tick
matched to the analyser's smoothing time). If no, drop it.

### 20. `compareMixes` inconsistent severity ladders + magic numbers

**Problem:** `compareMixes.ts` carries four severity ladders with no
shared origin: loudness `1`/`4` LUFS, frequency `0.15`/`0.25` (linear
profile diff), dynamics `2`/`5` dB, stereo `0.1`/`0.25` (stereo width
diff). Multipliers (10×, 30×, 8×, 150×) for the score deduction are
likewise undocumented. The category weights (loudness 0.3, freq 0.35,
dynamics 0.2, stereo 0.15) are also magic.

**Representative files:**

- `src/modules/AudioAnalysis/useCases/referenceMixComparison/compareMixes.ts:21-94`

**Needed:** Extract the thresholds and weights into a named config
object (`MIX_COMPARISON_CONFIG`) with comments explaining each number.
Add tests asserting the ladder boundaries.

### 21. `extractFeatures.bufferSize` not validated (Meyda requires power of two)

**Problem:** Caller-supplied `bufferSize` is forwarded directly to
Meyda. If non-power-of-two, Meyda either errors or returns nonsense
(silently).

**Representative files:**

- `src/modules/AudioAnalysis/useCases/audioFeatures.ts:46-77`

**Needed:** Validate (`(bufferSize & (bufferSize - 1)) === 0`) or
clamp to the nearest valid value with a `logger.warn`.

### 22. No progress feedback for long-running analyses

**Problem:** `polyphonicAudioToMidi` accepts `onProgress` but no
handler invokes it; `separateStems` and `generateAudio` (model
download / inference, can run for ~60 s) emit only `logger.info`.
Users get no indication anything is happening.

**Representative files:**

- `src/modules/AudioAnalysis/useCases/polyphonicAudioToMidi.ts:122-124`
- `src/modules/AudioAnalysis/repositories/audioAiEngine.ts:54,98,127`
- `src/modules/AudioAnalysis/repositories/browserStemSeparation.ts:80,125,174`

**Needed:** Plumb an `onProgress` (or `progressStore`) through all
three. The mix-analysis store already has an `isAnalyzing` boolean —
extend the same pattern for stem separation / MIDI conversion / audio
generation. Surface in the action contract. Cross-reference with the
`Notification` module for an aria-live channel.

### 23. Tests use `as any` to satisfy types

**Problem:** Spec files cast partial fixtures to `any`, breaking the
"tests assert the actual contract" rule.

**Representative files:**

- `src/modules/AudioAnalysis/handlers/analysis/__tests__/handleAutoFixMix.spec.ts:48,65,70`
- `src/modules/AudioAnalysis/useCases/__tests__/analyzeMix.spec.ts:25-29`
- `src/modules/AudioAnalysis/useCases/__tests__/polyphonicAudioToMidi.spec.ts:13`
- `src/modules/AudioAnalysis/useCases/__tests__/insertPolyphonicMidiNotes.spec.ts:13-22`

**Needed:** Build typed fixtures (full `AnalyzeMixOutput`,
`AudioBuffer` stubs via `OfflineAudioContext` or a typed mock factory).
Replace `(...args: any[]) => fn(...args)` with `vi.mocked(fn)` and the
real generic.

### 24. `detectKey` test never executes the real detection path

**Problem:** Both tests in `keyDetection.spec.ts` exit before
correlating against key profiles — the silent buffer test passes only
via an early `Math.max(...chroma) === 0` short-circuit. Combined with
issue #2 (wrong mock path), there is no positive coverage.

**Representative files:**

- `src/modules/AudioAnalysis/useCases/__tests__/keyDetection.spec.ts:14-26`

**Needed:** With the mock path fixed (issue #2), add a test that feeds
a synthesised C major chord (sum of sine waves at 261.63, 329.63,
392.00 Hz) and asserts the detector returns `key: 'C', mode: 'major'`
with non-zero confidence.

### 25. Duplicate hash-tracked module pattern across `polyphonicAudioToMidi` / `browserStemSeparation`

**Problem:** Both files use the `const holder = { instance: null }`
pattern with prose comments lamenting HMR. Indicates the underlying
problem (module-private mutable state) hasn't been solved.

**Representative files:**

- `src/modules/AudioAnalysis/useCases/polyphonicAudioToMidi.ts:45-53`
- `src/modules/AudioAnalysis/repositories/browserStemSeparation.ts:30-33,105-136`

**Needed:** Consider an explicit module-level cache abstraction (e.g. a
`modelCache` store keyed by model id, owned by `AudioEngine` or a new
`AiRuntime` subsystem) that survives HMR and serves as the single
locus of mutation. This is a cross-module cleanup; from
`AudioAnalysis`'s perspective, document the dependency.

_Issues #26-#33 are deferred slot reservations. The original audit's
Findings list (line 124) numbers up to #34 but only opens 25 issues
under "Open issues". To keep numbering stable so cross-references in
specs and tasks survive future edits, new issues from the 2026-04-28
adversarial review start at #34._

### 34. **P0** — Track-config `analyzeMix` mistakes linear gain for dB

**Problem:** `useCases/referenceMixComparison/analyzeMix/analyzeMix.ts:62-65`
maps `track.gain` (a linear value, default `0.8`, clamped 0–2 in
`BusNode.ts:30`) directly into a `MixAnalysis` whose contract is dBFS:

```ts
const gains = tracks.map((time) => time.gain ?? 0);
const avgGain = gains.reduce(...) / trackCount;
const rmsDb = Math.max(-60, avgGain - 6);   // 0.7 - 6 = -5.3 (claimed dBFS)
const peakDb = Math.max(-60, avgGain - 1);  // 0.7 - 1 = -0.3 (claimed dBFS, would be clipping!)
const lufs = rmsDb - 3;
```

A track at default gain 0.8 surfaces as `peakDb = -0.2` (effectively
clipping in any sane mix-analysis UI). The same track at gain 1.5
surfaces as `peakDb = +0.5` — which `compareMixes` treats as nominal
because the reference also says `peakDb = -1`. **Compounded across
all tracks the entire `compareMixes` pipeline reasons in the wrong
units.**

**Verified 2026-04-28:**
- `Arrangement/models/Track.ts:40` declares `gain: number` (no unit annotation).
- `Arrangement/models/Track.ts:184` and `:234` default to `0.8`.
- `AudioEngine/engine/BusNode.ts:30` clamps `gain` 0–2 and applies it directly via `gainNode.gain.setTargetAtTime(...)` — confirms linear domain.
- The function returns this value as `MixAnalysis.peakDb` which the contract documents as "Peak level in dBFS" (`MixComparisonTypes.ts:7`).

**Root cause:** Author wrote a quick scaffold for the comparison
feature without ever wiring the buffer-side analysis. The unit error
hides because the reference is also synthetic (issue #6).

**Blast radius:**
- `compareMixes.compareToReference` (`compareMixes.ts:117-121`) every percentage shown to users.
- `AiRuntime/useCases/musicMentor/generateLessons.ts` reads `lufs`, `crestFactor`, `dynamicRange` — all derived downstream.
- Any future "compare to user-supplied reference" feature inherits this until #6 is resolved.

**Fix sketch:**
- Either the function correctly maps linear gain to dB:
  `peakDb = 20 * Math.log10(Math.max(1e-6, avgGain))` —
  giving `0.8 → -1.94 dB`, `1.0 → 0 dB`, `0.5 → -6.02 dB`.
- Or, ideally, the function is renamed and rewritten to take a real
  `AudioBuffer` and compute peak/RMS from samples (collapsing #1, #6,
  and #34 into one fix).

**Representative files:**

- `src/modules/AudioAnalysis/useCases/referenceMixComparison/analyzeMix/analyzeMix.ts:62-65`
- `src/modules/AudioAnalysis/models/MixComparisonTypes.ts:5-7` (contract)
- `src/modules/Arrangement/models/Track.ts:40,184,234` (gain unit)

**Needed:** Per fix sketch. Add a unit test that asserts a track at
`gain: 1.0` produces `peakDb ≈ 0` and a track at `gain: 0.5` produces
`peakDb ≈ -6`.

### 35. **P0** — Master `AnalyserNode.fftSize = 256` makes frequency-balance bands pathological at typical sample rates

**Problem:** `mixAnalysisHelpers.readFrequencyBalance` divides energy
into six bands (sub 20-60, bass 60-250, lowMid 250-500, mid 500-2000,
highMid 2000-6000, high 6000-20000). At `fftSize = 256` (set in
`createWebAudioEngine.ts:57`), `frequencyBinCount = 128`. With
sample rate 48 kHz, `binWidth = sampleRate / (binCount * 2) = 48000 /
256 = 187.5 Hz`. The bands collapse:

| Band   | Range (Hz) | Bins covered                      |
| ------ | ---------- | --------------------------------- |
| sub    | 20-60      | none below bin 1; clamped to {1}  |
| bass   | 60-250     | bin 1 only (~187 Hz)              |
| lowMid | 250-500    | bins 2-2 ({~375 Hz})              |
| mid    | 500-2000   | bins 3-10                         |
| highMid| 2000-6000  | bins 11-32                        |
| high   | 6000-20000 | bins 33-106                       |

`sub` and `bass` share bin 1 (the `Math.max(1, …)` clamp at
`mixAnalysisHelpers.ts:78` overrides anything starting at bin 0). They
are **necessarily equal**. The "muddy mix" detection
(`mixAnalysisHelpers.ts:142-150`) compares `(sub + bass) / 2` to
`(mid + high) / 2`, but the first term is always `bass` repeated.

**Verified 2026-04-28:**
- `createWebAudioEngine.ts:57` — `this.masterAnalyser.fftSize = 256;`.
- `BusNode.ts:15` and `TrackNode.ts:56` — same `fftSize = 256` for per-track strips.
- `mixAnalysisHelpers.ts:60-95` — `readFrequencyBalance` runs over `analyser.frequencyBinCount` bins; binWidth derived as cited.
- `getFloatFrequencyData` returns `frequencyBinCount` bins; with `fftSize = 256` that is 128 bins.

**Root cause:** `fftSize = 256` was likely chosen for low-latency peak
metering, not spectral analysis. The same analyser is reused for
both, so the spectral analysis inherits the wrong resolution.

**Blast radius:**
- `analyzeMix` `frequencyBalance` (`analyzeMix.ts:43`) is meaningless under this resolution — every "muddy" / "harsh" `notifyUser` toast is signal-from-noise.
- `mixAnalysisStore` in AiRuntime, `MixAnalysisPanel` UI, and any AI tool that reads it inherits the wrong data.

**Fix sketch:**
- Split the analyser usage. Keep one `fftSize = 256` analyser for
  peak metering. Add a parallel `fftSize = 4096` analyser (binWidth
  ≈11.7 Hz at 48 kHz) for `readFrequencyBalance`. Connect both to the
  same source.
- Or, accept reduced accuracy and document that `frequencyBalance`
  bands below ~190 Hz collapse — and skip the "muddy" rule until the
  resolution improves.

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:56-58`
- `src/modules/AudioAnalysis/services/mixAnalysisHelpers.ts:60-95,142-150`
- (cross-module finding; AudioEngine owns the analyser, but
  AudioAnalysis is the consumer that breaks)

**Needed:** Per fix sketch. Cross-reference the AudioEngine audit
when one exists.

### 36. **P1** — `audioToMidi` flux is a half-wave-rectified energy diff, not spectral flux; `detectOnsets` peak picking is too lax

**Problem:** `audioToMidi.ts:97-110` builds a "flux" array from the
**RMS energy difference** between consecutive frames, half-wave
rectified. This is the simplest possible onset detector ("energy
flux"), not the more accurate spectral flux that uses FFT magnitude
differences. Peak-picking at `:122-136` requires `flux[i] > threshold
&& flux[i] > flux[i-1] && flux[i] >= flux[i+1]` — the `>=` on the
right tie allows two equal adjacent maxima to both fire, doubling
onsets on plateau-shaped flux peaks.

**Verified 2026-04-28:**
- `audioToMidi.ts:99` — RMS per frame (energy, not spectrum).
- `:104-110` — `flux[i] = Math.max(0, energies[i+1] - energies[i])` — half-wave-rectified energy diff. There is **no** FFT in this path.
- `:126` — `flux[index]! >= flux[index + 1]!` ties go to the earlier index, which is fine; the `>` on the left correctly excludes the trailing tie. So the `>=` does not in fact double-fire — withdraw that sub-claim.
- Onset time bug from the original audit (#11) **is** real:
  `:129` — `timeSec = ((index + 1) * HOP_SIZE) / sampleRate`. The peak
  flux frame is at `index`. The frame energy at `index` describes
  samples `[index*HOP_SIZE, index*HOP_SIZE + FRAME_SIZE)`. Reporting
  the onset at `(index+1)*HOP_SIZE` lands ~512 samples (≈11.6 ms at
  44.1 kHz) **after** the frame's start. With the `flux[i+1]` reading
  at `:132` for amplitude, the same lag.

**Root cause:** Naïve energy-flux detector picked for simplicity.
Time-of-frame conventions inconsistent.

**Blast radius:**
- Any audio→MIDI conversion (drum tracks, percussion samples) lands ~12 ms late. Combined with `Math.ceil(endBeat)` (#13) and the duration-clamp `(nextOnsetBeat - startBeat) * 0.9`, the resulting MIDI plays consistently late.
- The output is downstream MIDI inserted into the timeline — irreversible if the user accepts it. Late onsets beat-quantize to the wrong beat half the time.

**Fix sketch:**
- Replace `timeSec = ((index + 1) * HOP_SIZE) / sampleRate` with `index * HOP_SIZE / sampleRate`.
- For accuracy, replace the energy flux with FFT magnitude flux (sum of `max(0, |X[k][i+1]| - |X[k][i]|)` across positive-flux bins). FFT routines already exist in `keyDetection.ts` (Goertzel) and `audioFeatures.ts` (Meyda). Or use Meyda's `'spectralFlux'` feature directly.

**Representative files:**

- `src/modules/AudioAnalysis/useCases/audioToMidi.ts:88-139`

**Needed:** Per fix sketch. Add a test with a synthesised click at
sample N=22050 (0.5 s); assert the detected onset time is within
`HOP_SIZE / sampleRate ≈ 11 ms` of 0.5 s.

### 37. **NEW** — AGENTS.md violation: `services/mixAnalysisHelpers.ts` exports six functions from one file

**Problem:** AGENTS.md "One Function Per File: Every `useCase` and
`repository` file must export exactly ONE function." That rule is
explicit for `useCases/` and `repositories/`. The `services/` rule is
silent. But `mixAnalysisHelpers.ts` (`services/`) exports six
functions: `linearToDb` (private), `readLevels`, `readFrequencyBalance`,
`detectIssues`, `generateSuggestions`, plus types. (The audit's
"linearToDb is exported" claim was wrong — it's `function`, not
`export function`. Withdraw that claim.)

**Verified 2026-04-28:**
- `services/mixAnalysisHelpers.ts:9` — `function linearToDb` (private).
- `:18` — `export function readLevels`.
- `:60` — `export function readFrequencyBalance`.
- `:120` — `export function detectIssues`.
- `:197` — `export function generateSuggestions`.
- Plus `LevelReading`, `FrequencyBands`, `TrackLevelSummary`, `MixIssue`, `DetectIssuesInput`, `GenerateSuggestionsInput` exported types.

**Root cause:** Convention silence — services aren't covered by the
"one function per file" rule, but the file is becoming the kind of
multi-export grab-bag that the rule was designed to prevent.

**Blast radius:** Maintenance only. Any change to `detectIssues`
forces re-running tests for the entire `services/` file.

**Fix sketch:** Split into four files in `services/`:
`readLevels.ts`, `readFrequencyBalance.ts`, `detectIssues.ts`,
`generateSuggestions.ts`. Move `linearToDb` to a private helper file
or `#/utils/audio.ts`. Each file gets its own `__tests__/<name>.spec.ts`
(three exist already; only `generateSuggestions` needs splitting from
`mixAnalysisHelpers.spec.ts`).

**Representative files:**

- `src/modules/AudioAnalysis/services/mixAnalysisHelpers.ts`
- `src/modules/AudioAnalysis/services/__tests__/mixAnalysisHelpers.spec.ts`

**Needed:** Per fix sketch.

### 38. **NEW** — `repositories/audioAiEngine.ts` exports five functions from one file (AGENTS.md violation)

**Problem:** AGENTS.md "One Function Per File … `useCase` and
`repository`" — explicit rule. `repositories/audioAiEngine.ts` exports
`isStemSeparationAvailable`, `isAudioGenerationAvailable`,
`isAudioAiServerRunning`, `generateAudio`, and `separateStems`.

**Verified 2026-04-28:**
- `repositories/audioAiEngine.ts:21` — `export function isStemSeparationAvailable`.
- `:29` — `export function isAudioGenerationAvailable`.
- `:35` — `export async function isAudioAiServerRunning`.
- `:43` — `export const generateAudio = inject(...)`.
- `:88` — `export const separateStems = inject(...)`.

**Root cause:** Convention drift. The file pre-dates the rule, or the
rule was overlooked when adding the third+ function.

**Blast radius:** Compounds with #14: each empty pass-through in
`useCases/audioAi/` re-exports one of these. If we split the
repository, we can delete the five pass-throughs and re-export
directly from `useCases/index.ts`.

**Fix sketch:** Split into five files in `repositories/`. Update the
consumers (the five `useCases/audioAi/*.ts` files) — or, per #14,
delete those wrappers entirely and re-export the split repo files
from `useCases/index.ts`.

**Representative files:**

- `src/modules/AudioAnalysis/repositories/audioAiEngine.ts`

**Needed:** Per fix sketch.

### 39. **NEW** — Six smoke-only tests assert nothing but "the export exists"

**Problem:** Six spec files contain a single test of the form
`expect(subject.x).toBeDefined(); expect(typeof subject.x).toBe('function')`.
These provide false confidence: deleting the function body (return
type unchanged) keeps the test green.

**Verified 2026-04-28:**
- `useCases/audioAi/__tests__/generateAudio.spec.ts:7-10`
- `useCases/audioAi/__tests__/isAudioGenerationAvailable.spec.ts:7-10`
- `useCases/audioAi/__tests__/isStemSeparationAvailable.spec.ts:7-10`
- `useCases/audioAi/__tests__/separateStems.spec.ts:7-10`
- `useCases/referenceMixComparison/analyzeMix/__tests__/analyzeMix.spec.ts:7-10`
- `useCases/referenceMixComparison/analyzeMix/__tests__/createReferenceAnalysis.spec.ts:7-10`

**Root cause:** Test scaffolding was generated for each new file
without behaviour to assert; the placeholders shipped.

**Blast radius:** Inflates "test files" count, gives a false sense of
coverage. The six files add up to 60 lines of code that test nothing.

**Fix sketch:** Delete (or, where #14/#38 fixes apply, the files they
test cease to exist). For
`referenceMixComparison/analyzeMix/__tests__/analyzeMix.spec.ts`,
strengthen to a real behavioural test once #34 lands.

**Representative files:** see verified list above.

**Needed:** Delete or rewrite to assert behaviour.

### 40. **NEW** — `referenceMixComparison/__tests__/analyzeMix.spec.ts` mocks the wrong barrel level (related to #2)

**Problem:** The spec at `referenceMixComparison/__tests__/analyzeMix.spec.ts:3`
mocks `vi.mock('#/modules/Arrangement', () => ({ trackStore: {...} }))`
— but the production code in `analyzeMix.ts:1` imports
`from '#/modules/Arrangement/stores'`. The mock factory is inert; the
test passes only because the production code accepts an undefined
`trackStore.value` and falls through `createDefaultAnalysis`.

**Verified 2026-04-28:**
- `useCases/referenceMixComparison/analyzeMix/analyzeMix.ts:1` — `import { trackStore } from '#/modules/Arrangement/stores'`.
- `useCases/referenceMixComparison/__tests__/analyzeMix.spec.ts:3` — `vi.mock('#/modules/Arrangement', …)`.
- `Arrangement/stores/index.ts` exports `trackStore`. `Arrangement` may also re-export it from a higher barrel, but the production import is the explicit `/stores` path. The mock at the wrong path is inert.

**Root cause:** Same family as #2 — copy-pasted from a different
module with a different barrel layout.

**Fix sketch:** Change the mock path to
`#/modules/Arrangement/stores`. Then assert behaviour (`gain: 0.8`
input → expected `peakDb`/`rmsDb` outputs — combined with the #34 fix,
those become numerically meaningful).

**Representative files:**

- `src/modules/AudioAnalysis/useCases/referenceMixComparison/__tests__/analyzeMix.spec.ts:3`

**Needed:** Per fix sketch.

### 41. **NEW** — `analyzeMix.ts:39` masks `require-await` with eslint-disable — the function is sync today

**Problem:** `useCases/analyzeMix.ts:39` has
`// eslint-disable-next-line @typescript-eslint/require-await` with a
comment "async API contract; will be async when real DSP analysis is
added". The function is currently sync internally — every operation
is synchronous. The Promise wrapping forces every caller to `await`,
adds a microtask hop in `handleAnalyzeMix.ts:16` and
`handleAutoFixMix.ts:17,41`. Same anti-pattern as #15 in the original
audit (`isAudioAiServerRunning`).

**Verified 2026-04-28:**
- `useCases/analyzeMix.ts:40` — `export async function analyzeMix(): Promise<AnalyzeMixOutput>`. Body uses no `await`.
- The eslint-disable comment justifies the future intent. But "future intent" is what specs are for, not eslint comments.

**Root cause:** Speculative async wrapping for a future DSP path that
hasn't shipped.

**Blast radius:**
- `handleAutoFixMix.ts:41` — the second `await analyzeMix()` is part of the race in #7. Making it sync would not fix the race (the gain dispatch is genuinely async via `executeAppAction`), but it would clarify which `await` matters.
- Tests must `await` the function: `analyzeMix.spec.ts:47` and `handleAnalyzeMix.spec.ts:33-47`. They'd simplify if sync.

**Fix sketch:** Drop the `async`. When the real DSP path lands and
becomes async, change the signature back. The compiler will surface
all the call sites that need `await`. That's the correct way to
introduce async — top-down from the boundary.

**Representative files:**

- `src/modules/AudioAnalysis/useCases/analyzeMix.ts:39-40`

**Needed:** Per fix sketch.

### 42. **NEW** — `audioFeatures.ts:99-110` casts Meyda return values with `as` chains (TypeScript-soundness violation)

**Problem:** `audioFeatures.ts:99-110` builds the return type by:
`(features.rms as number) ?? 0`,
`(features.loudness as { total: number; specific: Float32Array }) ?? …`,
`(features.mfcc as number[]) ?? []`. These are `as`-style assertions
on values whose types come from Meyda. Per AGENTS.md "TypeScript —
soundness": "Forbidden: `as`, `as any`, or `as unknown as …` to
silence compiler errors instead of fixing the value or the type".

**Verified 2026-04-28:** Confirmed all five `as` assertions on lines
99-110.

**Root cause:** Meyda's `extract` returns
`Partial<Record<MeydaFeature, MeydaFeatureValue>>` which is strictly
correct (any feature can be undefined or wrong shape if the
configuration is off). The code wants to silence that; it does so via
`as` rather than via a runtime validator.

**Blast radius:** If Meyda's output shape changes in a future
upgrade, the casts hide the breakage; the code accepts whatever shape
arrives and produces zeros.

**Fix sketch:**
- Define a per-feature narrowing helper:
  `function asNumberOr(value: unknown, fallback: number): number { return typeof value === 'number' ? value : fallback; }` and similar for arrays/objects.
- Or use Zod at the Meyda boundary to validate the entire `features` object once.

**Representative files:**

- `src/modules/AudioAnalysis/useCases/audioFeatures.ts:99-110`

**Needed:** Per fix sketch.

### 43. **NEW** — `polyphonicAudioToMidi.ts` allocates a new `OfflineAudioContext` on every call when sample rate ≠ 22050

**Problem:** `polyphonicAudioToMidi.ts:104-111` constructs a new
`OfflineAudioContext` per invocation when the source rate is 44.1 / 48
kHz (the common case). `OfflineAudioContext` is heavy: it pre-allocates
a render graph buffer of `targetLength` samples × `numberOfChannels`
× 4 bytes. For a 5-min clip at 22050 Hz mono, ~26 MB.

**Verified 2026-04-28:** Source unchanged.

**Root cause:** Resampling per-call; no cache. Combined with the
allocator pressure of #10, two parallel runs on different clips cost
~50 MB of transient `OfflineAudioContext` graph state alone.

**Blast radius:** Smaller than #10 (one alloc per invocation, not per
segment). Still worth fixing if a per-clip "auto-MIDI" pass batches
many clips.

**Fix sketch:**
- Cache the resampled buffer keyed by `(audioBufferId, targetSampleRate)`.
- Or use `audioBufferCache` directly with a derived key.
- Or pre-resample once on import and cache there.

**Representative files:**

- `src/modules/AudioAnalysis/useCases/polyphonicAudioToMidi.ts:99-112`

**Needed:** Per fix sketch.

### 44. **NEW** — `audioToMidi` and `insertPolyphonicMidiNotes` create tracks during analysis (mutating side-effect inside a use-case-claiming-purity)

**Problem:** Both `audioToMidi.ts:191-198` and
`insertPolyphonicMidiNotes.ts:26-34` may call `addTrack(...)` if the
target track id doesn't resolve to a MIDI track. This is a hidden
mutation: a function nominally named "audio to MIDI" silently creates
a new track in the arrangement.

**Verified 2026-04-28:**
- `audioToMidi.ts:191-198` — branch `if (!existingTrack || existingTrack.kind !== 'midi') { addTrack(...) }`.
- `insertPolyphonicMidiNotes.ts:26-34` — same.

**Root cause:** Convenience: the caller "shouldn't have to" create the
track. But this means the use case has two responsibilities (analyse +
arrange) and the failure mode of "track creation failed" is subtle —
the function returns void / null without telling the caller _why_.

**Blast radius:**
- Tests in `audioToMidi.spec.ts:44-61` and
  `insertPolyphonicMidiNotes.spec.ts:33-39` already exercise the
  branch but do not assert that the side-effect is undone if the
  subsequent `addClip` / note insertion fails.
- The undo system: `handleAudioToMidi` is `undoable: true`. Does the
  undo unwind the implicit `addTrack`? **Probably not** — undo runs the
  inverse of the dispatched `AppAction`s, but `addTrack` here is a direct
  use-case call, not an action. So undo leaves the track behind.

**Fix sketch:**
- Split: the use case takes a resolved `midiTrackId` and fails fast if
  the track isn't MIDI. A separate command/handler creates the track
  if the user needs one.
- Or: dispatch `addTrack` as an `AppAction` so undo sees it.

**Representative files:**

- `src/modules/AudioAnalysis/useCases/audioToMidi.ts:191-198`
- `src/modules/AudioAnalysis/useCases/insertPolyphonicMidiNotes.ts:26-34`
- `src/modules/AudioAnalysis/handlers/analysis/handleAudioToMidi.ts:23` (`undoable: true`)

**Needed:** Per fix sketch. Decide first whether undo of "audio to
MIDI" should restore the original track count.

### 45. **NEW** — `linearToDb` private helper duplicates a likely existing one in `#/utils/`

**Problem:** `services/mixAnalysisHelpers.ts:9-14` defines a private
`linearToDb`. There is almost certainly an identical helper somewhere
in `#/utils/audio` or another module's `services/`.

**Verified 2026-04-28:** Did not enumerate — outside this audit's
scope. Flag for cross-module deduplication.

**Root cause:** Helper added without a search for prior art.

**Blast radius:** Cosmetic / DRY. Five-line duplication with a
single-source-of-truth concern only if the SILENCE_FLOOR_DB constant
ever changes.

**Fix sketch:** `grep -rn "function linearToDb\|export.*linearToDb" src/`.
If duplicated, hoist to `#/utils/audioMath.ts` or similar.

**Representative files:**

- `src/modules/AudioAnalysis/services/mixAnalysisHelpers.ts:9-14`

**Needed:** Cross-module grep + decision.

### 46. **NEW** — `compareToReference()` is sync but calls a function (`analyzeMix` from `referenceMixComparison`) that the audit had previously called sync — verify no async drift sneaks back in

**Problem:** `compareMixes.ts:117` declares `export function
compareToReference(): MixComparisonResult` — sync. It calls
`analyzeMix()` (track-config one — sync) and
`createReferenceAnalysis()` (sync) and `compareMixes(...)` (sync).
That's correct today. **But** if a future refactor makes
`analyzeMix` async (#41 already wraps the live one in a Promise), and
someone refactors `compareToReference` to use the live one (per #1
"collapse the two analyzeMixes"), the function silently changes
contract. `handleCompareToReference.execute` is sync (`:7`) and would
drop the Promise.

**Verified 2026-04-28:**
- `compareMixes.ts:117-121` — sync, all internal calls sync.
- `handleCompareToReference.ts:7` — `execute: () => { …; void … (sync) }`.

**Root cause:** Defensive note for the next session: if you fix #1 by
unifying on the live `analyzeMix`, you _must_ also make
`compareToReference` async and update the handler.

**Fix sketch:** Document the constraint inline (in the spec file
born from this audit) so the handler shape change is part of the same
patch.

**Representative files:**

- `src/modules/AudioAnalysis/useCases/referenceMixComparison/compareMixes.ts:117-121`
- `src/modules/AudioAnalysis/handlers/analysis/handleCompareToReference.ts:7-13`

**Needed:** No standalone fix; it's a guardrail for the #1/#6 work.

### 47. **NEW** — Polyphonic `audioToMidi` writes to the imported `BasicPitch` model URL `?url`-style — no test verifies the asset survives bundling

**Problem:** `polyphonicAudioToMidi.ts:17` —
`import basicPitchModelUrl from '@spotify/basic-pitch/model/model.json?url'`.
The file comment acknowledges that the previous `new URL(...,
import.meta.url)` form left the file unbundled in production. Today's
`?url` form is correct for Vite, but no test asserts it. If a build
config change ever introduces a Webpack/Rollup-shaped bundler step
that doesn't honour `?url`, the URL becomes a string literal and
inference fails at runtime.

**Verified 2026-04-28:** The `?url` import is in place; no test
covers the URL's resolved value.

**Root cause:** Bundler-specific syntax with no contract test.

**Blast radius:** Production-only failure mode. Hard to debug post-deploy.

**Fix sketch:** A vitest case asserting
`expect(basicPitchModelUrl).toMatch(/^\/.+model\.json/)` (vitest uses
Vite under the hood, so the `?url` resolves to a real path) — this
catches a breakage in vitest if anyone migrates to a non-Vite test
runner. Plus a CI smoke test that loads the asset URL.

**Representative files:**

- `src/modules/AudioAnalysis/useCases/polyphonicAudioToMidi.ts:14-17`

**Needed:** Per fix sketch.

---

## Open questions

- [ ] Is the `referenceMixComparison/` feature meant to ship to users as
      "synthetic vs synthetic", or is it scaffolding awaiting real
      reference-track ingestion? (Affects whether issue #6 is a bug or a
      "do not promote yet" item.)
- [ ] Does any caller depend on the current `audioToMidi` action's
      `targetPitch` / `minInterval` not being plumbed? (Search for
      `executeAppAction(... type: 'audioToMidi' …)`.)
- [ ] What is the intended HMR story for the BasicPitch / Demucs
      models? Does `AudioEngine` already own a model cache we should
      hook into?
- [ ] Is `notifyUser` aria-live / screen-reader friendly? If not, the
      no-progress-feedback issue is more severe.

---

## Risks

- **Unit confusion at the contract layer (P0, new #34).** Track-config
  `analyzeMix` produces `peakDb`/`rmsDb`/`lufs` numbers that are off
  by ~18-20 dB from any sane interpretation. The number is fed to
  `compareMixes`, the AI music-mentor lessons, and any UI surface that
  reads `MixComparisonResult.currentAnalysis`. Every metric is wrong
  in a way that won't be caught by smoke tests because it's
  internally consistent (synthetic vs synthetic).
- **FFT resolution insufficient for the contract (P0, new #35).**
  `frequencyBalance` "muddy / harsh" detection at fftSize=256 is
  guesswork. Any spec that lands an "auto-fix EQ" feature on top of
  this becomes a parallel-universe DSP product.
- **Correctness regressions hide behind passing tests** (P0, #2, #25,
  new #40). Five test files exercise no production code; the real
  implementations are silently uncovered. A well-meaning refactor of
  `keyDetection`, `tempoDetection`, `pitchDetection`, `audioFeatures`,
  or `referenceMixComparison/analyzeMix` could ship broken without
  any spec failing.
- **Audio-graph race in auto-fix** (P1, #7 / #19). User clicks
  "Auto-fix mix"; toast says "fixed", but displayed numbers and
  graph state can disagree. Worst case: the gain math produces a
  clamp to 1.0 (no change applied) and the user sees a "fixed" toast.
- **Concurrency-induced OOM** (P2, #8). A UI that allows two stem
  separations at once allocates two ~235 MB ONNX sessions. Worst case:
  ~470 MB peak with active inferences. Mitigation: the current UI
  doesn't actually expose two parallel runs, but the door is open.
- **DSP credibility** (P2, #4, #5, #11, #12, new #36). Octave errors
  in `audioToMidi.estimatePitch`, leakage-coloured chroma in
  `keyDetection`, half/double-time tempo flips, ~12 ms onset lag.
  Casual listening hides them; analytic users (the actual target
  audience for an analysis feature) will notice.
- **Architectural drift** (P3, #14, #15, #16, #17, #18, #23, new
  #37-#39, #41). AGENTS.md violations accumulated: no-op
  pass-throughs, async-for-no-reason, multi-export `services/` and
  `repositories/` files, smoke-only tests. Each isolated violation is
  cosmetic; in aggregate they signal that the convention isn't being
  enforced.

---

## Suggested approaches

- **Block #34 first.** Without unit-correct `analyzeMix`, any
  downstream UX claim is built on a fiction. The fix is two lines
  (linear→dB conversion). Add a unit test asserting `gain: 1.0 →
  peakDb ≈ 0`.
- **Then #35 (FFT resolution).** Cross-module fix — touches AudioEngine.
  Add a separate analyser at `fftSize = 4096` for spectral analysis;
  keep the 256 one for peak meters.
- **Land the test mock fixes (issues #2, #25, new #40).** Mock-path
  corrections are mechanical; once they apply, the DSP fixes (issues
  #4, #5, #11, #12, new #36) can be driven test-first.
- **Collapse the two `analyzeMix`es** (issue #1). Rename the
  track-config estimator. Decide whether it earns its keep — if
  `compareToReference` is going to ingest a real reference track
  eventually, the estimator can be deleted now. Note #46: the
  collapse forces `compareToReference` to become async, which forces
  `handleCompareToReference` to become async — coordinate.
- **Fix `handleAutoFixMix` math + race** (issue #7) with property
  tests on the gain formula and a settle-wait (or just drop the
  second analysis) before the second `analyzeMix`. The toast text in
  `mixAnalysisHelpers.generateSuggestions` already encodes a
  different formula — pick one.
- **Replace `audioToMidi.estimatePitch` with `pitchy`** (issue #12)
  and delete the duplicate detector. Combined with fixing the onset
  off-by-one (issue #11) and replacing energy-flux with spectral
  flux (new #36), this is the cheapest accuracy improvement on the
  audio→MIDI path.
- **Refactor singletons** (issue #8) to a Promise-coalesced lazy init.
  One pattern, two files.
- **Decide on `audioAi/*.ts`** (issue #14): either delete the folder
  and inline in the barrel, or split the repo file (#38) and assign
  each a real responsibility. The "delete + re-export from
  `useCases/index.ts`" path is shorter.
- **AGENTS.md compliance pass** (issues #15, #16, #17, #18, #23, new
  #37, #38, #39, #41, #42) as a follow-up sweep — small mechanical
  refactors that should land in a single commit.

A reasonable ordering: P0s (#34, #35, #2/#25/#40) → P1s (#7, #1/#6,
#3) → P2s (DSP slate + #8) → P3s (architecture).

---

## Recommendation

Start with **#34 (linear-vs-dB unit bug)** as a single-line patch
with a unit test. It's the cheapest fix with the largest correctness
return, and it unblocks #1/#6 — once `analyzeMix` is unit-honest,
the synthetic-vs-synthetic problem is the only remaining one.

Land **#35 (analyser fftSize)** as a coordinated patch with the
AudioEngine team — it changes a singleton's behaviour but the call
sites in this module already document what resolution they want.

Then **#2 / #25 / #40 (test mock paths)**. Mechanical, unblocks
adversarial coverage for keyDetection, tempoDetection,
pitchDetection, audioFeatures, and the track-layout analyzeMix.

Then **#7 (handleAutoFixMix math + race)** — most user-visible bug,
worth driving with a property-style test on the gain formula.

After those four land, the rest splits cleanly into
"correctness pass" (#4, #5, #11, #12, new #36, #21) and
"architecture pass" (#1, #6, #14, #15, #16, #17, #18, new #37-#42).

The audit's previous recommendation to start with #2 is downgraded
because the unit bug (#34) is more catastrophic and cheaper to fix.

---

## Resolved

### Withdrawn / corrected during 2026-04-28 adversarial review

These were claims in the original audit that did not survive a
line-by-line re-read. Listing them here so the next session does not
re-investigate.

- **Audit Findings #4 sub-claim "Goertzel inner loop overshoots data length"** — withdrawn. Outer loop guard `frame + fftSize < data.length` prevents `frame + index < data.length` from ever exceeding bounds inside the inner `index < fftSize` loop. The `?? 0` defensive read is dead code, not a bug fix. (`keyDetection.ts:22-46`.)
- **Audit Findings #4 sub-claim "Math.abs masks sign errors in Goertzel power"** — demoted. For real-valued time-domain input the formula is non-negative algebraically; the `Math.abs` is redundant cosmetic paranoia, not a correctness bug.
- **Audit Findings #4 sub-claim "`s0` is read before its first assignment"** — withdrawn. `s0` is local, assigned at `:38` before the loop body's only read of `s1`/`s2`. TypeScript-strict noise; not a runtime issue.
- **Audit Findings #10 sub-claim "the `?? 0` on `outData[lIdx]` is dead because TypedArray out-of-bounds returns 0"** — partially corrected. TypedArray `[]` access at out-of-bounds returns `undefined` (the `?? 0` does fire). However, with the verified dimensions (`6*2*343980` total floats, `lIdx` max ≈ 3.78M), the in-bounds case is the rule and the `?? 0` only triggers on malformed model output (different `nStems`/`nCh`). The audit's underlying claim ("defensive code") stands; the mechanism was misdiagnosed.
- **Audit Findings #17 / Open issue #17 "self-import via `src/modules/AudioAnalysis/index.ts`"** — withdrawn. There is no root `index.ts` in `src/modules/AudioAnalysis/`. The module follows the per-subdir barrel pattern. The three offending self-absolute imports inside `referenceMixComparison/` are still real and tracked in the (rewritten) #17.
- **Audit Findings #14 / Open issue #14 sub-claim "`linearToDb` is exported from `mixAnalysisHelpers.ts`"** — withdrawn. The function is private (no `export`). The original audit's "AGENTS.md violation: multiple exports" claim still holds because of `readLevels`, `readFrequencyBalance`, `detectIssues`, `generateSuggestions` — see new #37.
- **Audit Findings #29 / Open issue #18 "function signatures take positional args"** — partially corrected. `audioToMidi.ts:160` already uses an object param (`AudioToMidiOptions`). The remaining offenders are: `computeRmsEnergy` (`:24`), `estimatePitch` (`:37`), `detectOnsets` (`:88`), `detectPitchForOnsets` (`:141`), and `freqToMidiPitch` (`:84`). All are file-private — AGENTS.md applies to module-level functions and these are fine as multi-positional **inside** the file (the rule's intent is on the public contract). **Issue #18 is downgraded to "non-blocking; only the public surface needs object params"**, and `audioToMidi` already complies on its public surface. The originally listed `insertPolyphonicMidiNotes` (`:18`) public signature still takes three positional args — that one is real.

### Genuinely resolved

_None yet — no implementation has landed against this audit._
