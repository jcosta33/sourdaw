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

- `src/modules/AudioAnalysis/index.ts` (root barrel)
- `src/modules/AudioAnalysis/useCases/index.ts` (cross-module surface)
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
`generateSuggestions`, `linearToDb`).

**Tests.** Every public file has at least one spec. Specs lean on
`vi.mock(...)` heavily; many use `as any` to construct partial fixtures.

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

1. **Test mocks pointing at the wrong module path** (issue #2 / #25) —
   four test files exercise no production code; the real implementations
   are silently uncovered.
2. **`handleAutoFixMix` race + arithmetic errors** (issue #7) — the
   handler can emit nonsensical gains and presents a stale "refreshed"
   analysis as if it reflected the fix.
3. **Two competing `analyzeMix` implementations and a synthetic
   `compareToReference`** (issues #1, #6) — the comparison feature is
   misleading-by-construction.
4. **Bug: `handleAudioToMidi` drops payload fields** (issue #3) — silent
   data loss across the action contract.
5. **`keyDetection.ts` Goertzel loop is mis-structured** (issue #4) —
   chroma reflects only one window, scaled.
6. **Hot-loop allocation and per-segment array allocs** (issues #10,
   #14, #5) — wasted DSP work and concurrency hazards.

---

## Open issues

### 1. Two `analyzeMix` use cases collide on a name

**Problem:** Both `useCases/analyzeMix.ts` (live analyser-based) and
`useCases/referenceMixComparison/analyzeMix/analyzeMix.ts` (track-config
estimate) export a function called `analyzeMix`. The barrel re-exports
the second under an alias; the first keeps the canonical name. Imports
within the module that pull both end up needing `as` renames, and the
two functions are not interchangeable.

**Representative files:**

- `src/modules/AudioAnalysis/useCases/analyzeMix.ts:45`
- `src/modules/AudioAnalysis/useCases/referenceMixComparison/analyzeMix/analyzeMix.ts:53`
- `src/modules/AudioAnalysis/useCases/index.ts:13,30`

**Needed:** Rename one (e.g. the track-config estimator becomes
`estimateMixFromTracks`) and keep the live-analyser version as the
single `analyzeMix`. Update `compareMixes.compareToReference` to use the
real one (or a dedicated reference-track analyser — see #6).

### 2. Test mocks target `#/modules/AudioEngine/useCases` instead of `…/stores`

**Problem:** Four spec files mock the wrong import path. Production
imports `audioBufferCache` from `#/modules/AudioEngine/stores`. Tests
mock `#/modules/AudioEngine/useCases`. The mock factory is never
applied; production code falls through to the real
`audioBufferCache.get(...)` which returns null for the test's missing
ids. Tests pass but cover nothing.

**Representative files:**

- `src/modules/AudioAnalysis/useCases/__tests__/keyDetection.spec.ts:8`
- `src/modules/AudioAnalysis/useCases/__tests__/tempoDetection.spec.ts:3`
- `src/modules/AudioAnalysis/useCases/__tests__/pitchDetection.spec.ts:3`
- `src/modules/AudioAnalysis/useCases/__tests__/audioFeatures.spec.ts:3`

**Needed:** Fix the mock paths to `#/modules/AudioEngine/stores` and
add at least one positive-path test per file (a stub buffer with
predictable content — e.g. a sine wave — and assertions on the returned
detections). The "buffer missing → null" tests are not enough to catch
DSP regressions.

### 3. `handleAudioToMidi` drops payload fields

**Problem:** `audioToMidi` action payload allows `mode: string` but the
`audioToMidi` use case accepts `targetPitch` and `minInterval`. The
handler does not forward the latter two; the action contract advertises
`mode: string` (not the discriminated `'rhythm' | 'pitched'`), so a
caller passing a typo lands silently in `'rhythm'`. There is also no way
to set `targetPitch` from the command bus.

**Representative files:**

- `src/modules/AudioAnalysis/handlers/analysis/handleAudioToMidi.ts:14`
- `src/modules/AudioAnalysis/useCases/audioToMidi.ts:160`
- `src/modules/Command/useCases/commandQueries.ts:256`

**Needed:** Either expand the `AppAction` payload to include
`targetPitch?` / `minInterval?` and forward them, or document that they
are not user-configurable and remove them from the use-case signature.
Tighten `mode` to `'rhythm' | 'pitched'` and drop the
`normalizeAudioToMidiMode` helper.

### 4. `keyDetection.ts` key-confidence calibration is under-specified

**Problem:** The outer frame loop advances correctly with `frame +
index`, but the implementation is still non-windowed (rectangular =
spectral leakage), sums magnitudes across six octaves without per-bin
normalisation, uses `Math.abs` over a quantity that should already be
non-negative, and derives confidence from a magic constant.

**Representative files:**

- `src/modules/AudioAnalysis/useCases/keyDetection.ts:22-46`

**Needed:** Either fix the Goertzel loop to read
`data[frame + index]` (already does at `:38` — but the outer loop uses
`frame + fftSize < data.length` while the inner loop overshoots into
`frame + index` past `data.length`; the `?? 0` quietly absorbs the
out-of-bounds read), apply a Hann window, drop the `Math.abs`, and
calibrate `confidence`. Or replace with `pitchy`'s chroma /
`Meyda.chroma` (already in the dependency tree) and a single
Krumhansl-Schmuckler correlation step. Add a positive-path test that
detects C major from a synthesised C-E-G chord.

### 5. `tempoDetection.ts` slice-per-frame and triple-counted histogram

**Problem:** A `slice(...).reduce(...)` is allocated per frame (issue
#5). The histogram weighting at `:54-62` adds the _same_ interval to
the bin, half-bin, and double-bin; if a track's true tempo lands in
between bins, the half/double bins receive 50% weight that biases the
histogram peak toward whichever harmonic resolves cleanest. The
"normalize to 60–200 BPM" doubling at `:81-86` is naive: an actual
160 BPM track with strong 80 BPM half-time evidence gets reported as
160 (correct), but a 50 BPM ballad with strong 100 BPM doubles can
flip-flop.

**Representative files:**

- `src/modules/AudioAnalysis/useCases/tempoDetection.ts:14-89`

**Needed:** Replace `slice + reduce` with a moving-window sum
(`runningSum -= energies[i-10]; runningSum += energies[i];`). Drop the
half/double weighting or replace with a proper tempogram-style
autocorrelation. Use a percentile threshold (e.g. 75th) instead of `>
2× moving average`. Add tests that detect 120 BPM from a click-track
fixture and check the histogram normalisation.

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

**Problem:** Two sub-issues. (a) After dispatching `setTrackGain` /
`setMasterGain`, the handler immediately re-runs `analyzeMix()`; there
is no guarantee the audio graph has been updated by the time the second
read happens. (b) The clipping correction
`targetLinear = currentLinear / 10 ** ((peakDb + 0.5 + 3) / 20)` is
defined relative to dBFS, but it is being applied as a _multiplier on
existing track gain_. For a track at peak −10 dB the formula reduces
gain by `−10 + 3.5 = −6.5 dB`. For a non-clipping track this branch is
correctly skipped, but the handler also unconditionally reduces master
when `peakDb > −3` using the same formula on master, which can produce
absurd target gains (`Math.min(1, …)` then clamps to 1.0, masking the
bug).

**Representative files:**

- `src/modules/AudioAnalysis/handlers/analysis/handleAutoFixMix.ts:23-39,41`

**Needed:** (a) Wait for the `setTrackGain`/`setMasterGain` actions
to actually settle in the audio graph before re-reading the analyser
(or accept a single pass and remove the second `analyzeMix`). (b)
Recompute the gain math: target peak = ceiling, required reduction in
linear units = `currentLinear * (10 ** ((target − peak) / 20))`, then
multiply _into the existing strip gain_, not replace it. Add tests
that verify the new gain for known peakDb inputs.

### 8. Module-level mutable singletons, racing-unsafe

**Problem:** `polyphonicAudioToMidi.ts:45` and
`browserStemSeparation.ts:30,113` initialise heavy resources lazily.
Two concurrent callers will both see `null`, both download/instantiate
the model, and the last write wins. The 235 MB ONNX session leak on a
double-load is OOM-class.

**Representative files:**

- `src/modules/AudioAnalysis/useCases/polyphonicAudioToMidi.ts:45-53`
- `src/modules/AudioAnalysis/repositories/browserStemSeparation.ts:30,103-136`

**Needed:** Wrap the lazy init in a Promise singleton:
`if (!holder.promise) holder.promise = init(); return holder.promise;`.
Same pattern in both files. Add a test that invokes the use case twice
concurrently and asserts only one `InferenceSession.create` call.

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
The per-element `outData[lIdx] ?? 0` is dead defensive code on a typed
array.

**Representative files:**

- `src/modules/AudioAnalysis/repositories/browserStemSeparation.ts:180-216`

**Needed:** Allocate the input `Float32Array` once outside the loop and
reuse via `set()`. Replace the per-element copy with `subarray + set`
into pre-allocated stem buffers. Drop the `?? 0` defensive nullish.

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

**Representative files:**

- `src/modules/AudioAnalysis/useCases/audioAi/isAudioGenerationAvailable.ts`
- `src/modules/AudioAnalysis/useCases/audioAi/isAudioAiServerRunning.ts`
- `src/modules/AudioAnalysis/useCases/audioAi/isStemSeparationAvailable.ts`
- `src/modules/AudioAnalysis/useCases/audioAi/generateAudio.ts`
- `src/modules/AudioAnalysis/useCases/audioAi/separateStems.ts`

**Needed:** Either inline the repository calls in `useCases/index.ts`
(if no orchestration is needed) or absorb a real responsibility into
each (e.g. caching, validation, store mutation). Stop shipping
no-op indirection.

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
- The root `index.ts` re-exports the entire useCases barrel
  (`export * from './useCases'`), spreading the type leakage to all
  cross-module consumers.

**Representative files:**

- `src/modules/AudioAnalysis/useCases/referenceMixComparison/compareMixes.ts:1-7`
- `src/modules/AudioAnalysis/useCases/referenceMixComparison/analyzeMix/analyzeMix.ts:2`
- `src/modules/AudioAnalysis/useCases/referenceMixComparison/analyzeMix/createReferenceAnalysis.ts:1`
- `src/modules/AudioAnalysis/useCases/index.ts:12,15,18,23,26`
- `src/modules/AudioAnalysis/index.ts:1`

**Needed:** Convert internal absolute imports to relative paths. Move
shared types either to `models/` (cross-module-private; consumers
duplicate per AGENTS.md "Model isolation") or strip the type re-exports
from `useCases/index.ts`. Audit cross-module callers and delete the
imports that lean on these re-exports.

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

- **Correctness regressions hide behind passing tests.** Issues #2 and
  #25 mean the detection-side use cases ship without behavioural
  coverage. A well-meaning refactor of `keyDetection` or `tempoDetection`
  could ship broken without any spec failing.
- **Audio-graph race in auto-fix.** Issue #7 / #19: the user clicks
  "Auto-fix mix"; the toast says "fixed", but the displayed numbers and
  the actual graph state can disagree. In a worst case the gain math
  produces a clamp to 1.0 (no change applied) and the user sees a
  "fixed" success notification.
- **Concurrency-induced OOM.** Issue #8: a UI that allows two stem
  separations at once will allocate two ~235 MB ONNX sessions; the
  second one wins the binding but the first is garbage-collected only
  if no inference is in flight. Worst case: both sessions are alive
  during overlapped inferences → ~470 MB peak.
- **DSP credibility.** Issues #4, #5, #11, #12, #14: detections that
  look right under casual listening but are systematically biased
  (octave errors, leakage-coloured chroma, half/double-time tempo
  flips) erode user trust. The "% match" of `compareToReference`
  (issue #6) is theatrical.
- **Architectural drift.** Issues #14, #15, #17, #18: AGENTS.md
  violations have accumulated; left unaddressed they normalise
  no-op pass-throughs, async-for-no-reason, deep cross-module imports,
  and positional-arg signatures across the module.

---

## Suggested approaches

- **Land the test fixes first (issues #2, #24, #25).** Mock-path
  corrections are mechanical; once they apply, the rest of the audit's
  DSP fixes (issues #4, #5, #11, #12) can be driven test-first.
- **Collapse the two `analyzeMix`es** (issue #1). Rename the
  track-config estimator. Decide whether it earns its keep — if
  `compareToReference` is going to ingest a real reference track
  eventually, the estimator can be deleted now.
- **Fix `handleAutoFixMix` math + race** (issue #7) with property tests
  on the gain formula and an `await` (or store-subscription wait)
  before the second analysis.
- **Replace `audioToMidi.estimatePitch` with `pitchy`** (issue #12)
  and delete the duplicate detector. Combined with fixing the onset
  off-by-one (issue #11), this is the cheapest accuracy improvement.
- **Refactor singletons** (issue #8) to a Promise-coalesced lazy init.
  One pattern, two files.
- **Decide on `audioAi/*.ts`** (issue #14): either delete the folder
  and inline in the barrel, or assign each file a real responsibility.
- **AGENTS.md compliance pass** (issues #15, #16, #17, #18, #23) as a
  follow-up sweep — small mechanical refactors that should land in a
  single commit.

---

## Recommendation

Start with **issue #2 (test mock paths)**. It is mechanical, unblocks
adversarial test coverage for the four most fragile use cases
(keyDetection, tempoDetection, pitchDetection, audioFeatures), and
sets the stage for fixing the DSP bugs (#4, #5, #11, #12) test-first.
Land it as a standalone commit; then tackle **issue #7 (handleAutoFixMix
math + race)** because that is the most user-visible incorrect
behaviour today.

After those two land, the next session can decide between the
"correctness pass" (issues #4, #5, #11, #12, #14, #21) and the
"architecture pass" (issues #1, #6, #14, #15, #16, #17, #18). They are
independent.

---

## Resolved

_No issues resolved yet._
