# AiGeneration module audit

## Scope

This audit covers `src/modules/AiGeneration/` in full — every file under
`errors/`, `events/`, `models/`, `repositories/`, `stores/`, `handlers/`
(both `aiMidi/` and `generation/`), `useCases/` (including the action
handlers in `useCases/actions/`, the algorithmic generators in
`useCases/generate{Melody,DrumPattern,ChordProgression}/`, the groove
template subsystem in `useCases/grooveTemplate/`, and the LLM-backed
helpers `llmMidiGeneration.ts` and `generateMidiVariations.ts`), and
all sibling tests.

Adversarial review: bugs, races, type-soundness escapes, contract
gaps, dead/orphan handlers, duplicate implementations, inconsistent
module boundaries, audit-grade DSP issues in the generators, and UX
breakage. Excludes upstream callers (`AiRuntime`, `Command`,
`Arrangement`, `MIDI`, `Workspace`, `AudioAnalysis`) except where
imported directly here, and the LLM/runtime backends behind
`#/modules/AiRuntime/useCases` (covered by their own audits).

Related spec: none on disk.

---

## Goal

A correctness-first AI generation surface that:

- Has a single root `index.ts` that is the **only** cross-module entry
  point. External consumers must not be reaching into `useCases/`,
  `stores/`, `stores/aiStore`, or `models/GenerationStyles` by deep
  import.
- Wires every `AppAction` handler defined in this module into exactly
  one `get*Handlers` aggregate. Orphan `handle*AiMidi` files for
  `audioToMidi`/`detectKey`/`detectTempo`/`stripSilence` either ship
  through Command or are deleted — they should not sit in the tree as
  "kept for unit tests" duplicates of the canonical Arrangement
  handlers.
- Uses one common `addTask` / `updateTask` flow for every long-running
  AI operation (MIDI generation, audio generation, denoise, stem
  separation, BasicPitch, variations, completion, bassline) — not a
  mix of "tasks store" for some and silent `notifyUser` for others.
- Generates MIDI with note positions that respect the destination
  clip's beat range, with documented and tested clamping at clip
  boundaries; no `Math.ceil(endBeat)` / floor-zero collisions; no
  swing math that breaks at `swingAmount > 1`; no `density * 2` /
  `density * 1.5` magic multipliers without a referenced "100% density
  = 100% probability" calibration.
- Uses real input validation on LLM JSON (zod or equivalent), not
  `as` casts plus `typeof === 'number'` and silently-discarded fields.
- Surfaces undo entries that consistently snapshot and restore both
  `trackStore` and `midiStore` — and does so on the same code path,
  not duplicated per handler with different snapshot timing.
- Adheres to AGENTS.md: no `any`, `as any`, `as unknown as …`; no
  `import * as`; no namespace imports; no positional-arg signatures
  beyond one parameter; no use-case `export type`; relative imports
  inside the module, alias imports only across modules and only at
  the destination root barrel; one function per `useCases/` /
  `repositories/` file.

---

## Relevant code paths

- `src/modules/AiGeneration/` (no root `index.ts` exists; this is
  itself a finding — see issue #1)
- `src/modules/AiGeneration/errors/AiGenerationError.ts`
- `src/modules/AiGeneration/events/index.ts` (placeholder — comment-only)
- `src/modules/AiGeneration/models/AiGeneratedMidiNote.ts`
- `src/modules/AiGeneration/models/GenerationStyles.ts`
- `src/modules/AiGeneration/models/GrooveTemplate.ts`
- `src/modules/AiGeneration/repositories/factoryGrooves.ts`
- `src/modules/AiGeneration/stores/aiStore.ts`
- `src/modules/AiGeneration/stores/index.ts`
- `src/modules/AiGeneration/useCases/index.ts`
- `src/modules/AiGeneration/useCases/llmMidiGeneration.ts`
- `src/modules/AiGeneration/useCases/generateMidiVariations.ts`
- `src/modules/AiGeneration/useCases/getAiMidiHandlers.ts`
- `src/modules/AiGeneration/useCases/getGenerationHandlers.ts`
- `src/modules/AiGeneration/useCases/actions/{addTask,updateTask,removeTask,cancelProcessingTask,toggleAiPanel,handleAiDenoiseClip,handleGenerateAudioFallback,handleGenerateMidiPrompt,handleStemSeparationPreview}.ts`
- `src/modules/AiGeneration/useCases/generate{Melody,DrumPattern,ChordProgression}/{algorithm,applyToTrack}.ts`
- `src/modules/AiGeneration/useCases/grooveTemplate/applyGrooveByGrooveId.ts`
- `src/modules/AiGeneration/useCases/grooveTemplate/operations/{applyGroove,extractGroove}.ts`
- `src/modules/AiGeneration/handlers/aiMidi/{handleAddNotes,handleCompleteMidi,handleVariationMidi,handleGenerateBassline,handleGenerateAudioAiMidi,handleStemSeparate,handleDetectKeyAiMidi,handleDetectTempoAiMidi,handleStripSilenceAiMidi,handleAudioToMidiAiMidi,llmNoteHelpers,audioBufferToWav}.ts`
- `src/modules/AiGeneration/handlers/generation/{createGenerationHandler,generationHandlerHelpers,handleGenerateMelody,handleGenerateDrumPattern,handleGenerateChordProgression,handleApplyGroove,handleExtractGroove}.ts`

---

## Current behavior

**No module barrel.** There is no `src/modules/AiGeneration/index.ts`.
External callers (`bootstrap`, `Workspace`, `AiRuntime`, `Arrangement`)
import directly from `#/modules/AiGeneration/useCases`,
`#/modules/AiGeneration/stores`, `#/modules/AiGeneration/stores/aiStore`,
and `#/modules/AiGeneration/models/GenerationStyles`. No file outside
this module imports from `#/modules/AiGeneration` (i.e. the missing
barrel) — they all go to the sub-paths.

**Two sets of "AppAction" handlers.** Two top-level handler folders
(`handlers/aiMidi/` and `handlers/generation/`) plus two aggregator
use cases (`getAiMidiHandlers`, `getGenerationHandlers`) wired in
`src/app/bootstrap.ts`. The aiMidi map covers `addNotes`,
`completeMidi`, `variationMidi`, `generateBassline`, `generateAudio`,
`stemSeparate`. The generation map covers `generateDrumPattern`,
`generateMelody`, `generateChordProgression`, `extractGroove`,
`applyGroove`. Four orphan handler files
(`handle{DetectKey,DetectTempo,StripSilence,AudioToMidi}AiMidi.ts`)
target actions that are also registered in
`Arrangement/handlers/clip/`. The orphan files exist (with their own
specs) but are never registered — the comment in
`useCases/getAiMidiHandlers.ts:11-14` admits this and explains the
deduplication.

**Long-running AI tasks vs `aiStore`.** A four-status task pipeline
(`idle | processing | success | error`) lives in `stores/aiStore.ts`
and is surfaced in the AI panel. `addTask` / `updateTask` are called
from `handleGenerateMidiPrompt`, `handleAiDenoiseClip`,
`handleGenerateAudioFallback`, and `handleStemSeparationPreview`
(`useCases/actions/`). Command-bus handlers in `handlers/aiMidi/`
(`handleGenerateAudioAiMidi`, `handleStemSeparate`, `handleCompleteMidi`,
`handleVariationMidi`, `handleGenerateBassline`) **do not** touch
`aiStore`; they call `notifyUser`, `logger.info`, and throw on
failure. So whether a user sees a task card depends on which entry
point the UI used.

**Two stem-separation paths.**
`useCases/actions/handleStemSeparationPreview.ts` (entry-point: a
`presentations/views/Inspector/ClipAudioAiSection.tsx` button, with
task-store integration) and `handlers/aiMidi/handleStemSeparate.ts`
(entry-point: command bus, no task-store). Both call
`audioBufferToWav` + `separateStems(...)` from `AudioAnalysis`. The
former writes results to `audioBufferCache` keyed `${clipId}-${name}`
without creating tracks; the latter creates a new audio track per
stem and a new `audioBufferCache` entry per stem with a freshly
generated UUID. They do not share code.

**Two audio-to-MIDI paths.** `Arrangement/handlers/clip/handleAudioToMidi.ts`
is the canonical Command-bus handler. `handlers/aiMidi/handleAudioToMidiAiMidi.ts`
is a near-identical copy that asserts the action payload's `mode`
field with a hand-rolled ternary instead of `as 'rhythm' | 'pitched'`.
The orphan exists with a passing spec; nothing wires it.

**Two MIDI generation paths.** `useCases/llmMidiGeneration.ts`
(direct LLM calls from a free-form `prompt`) is invoked by
`useCases/actions/handleGenerateMidiPrompt`. `handlers/aiMidi/llmNoteHelpers.ts`
(`llmGenerateNotes`, tool-call wrapper) is invoked by
`handleCompleteMidi`, `handleVariationMidi`, and `handleGenerateBassline`.
Neither shares the JSON-validation logic; both manually filter by
`typeof … === 'number'`.

**Algorithmic generators.** `generate{Melody,DrumPattern,ChordProgression}`
each consist of `algorithm.ts` (pure, seeded RNG, returns `notes` +
`seed`) and `applyToTrack.ts` (`addClip` + `batchAddMidiNotes`).
`createGenerationHandler` in `handlers/generation/` is a generic
factory that validates style, picks a track, computes a placement
beat from playhead or payload, and dispatches.

**Groove templates.** Six factory grooves shipped in
`repositories/factoryGrooves.ts`. `useCases/grooveTemplate/operations/applyGroove.ts`
quantizes existing notes onto a step grid and applies offsets +
velocity scales. `useCases/grooveTemplate/operations/extractGroove.ts`
infers a `GrooveTemplate` from existing clip notes — but the result
is **only returned** from the function; `handlers/generation/handleExtractGroove.ts`
calls `extractGroove(clipId)` and discards the return value. The
template never reaches a registry, the `notifyUser` channel, or the
UI.

**Tests.** Every public file has a spec. `vi.mock(...)` is used
heavily; many specs use `as any` or `as unknown as …` to construct
partial fixtures.

---

## Findings

1. **No root barrel `index.ts` exists for the module.** Cross-module
   consumers reach into deep paths (`#/modules/AiGeneration/useCases`,
   `#/modules/AiGeneration/stores`, `#/modules/AiGeneration/stores/aiStore`,
   `#/modules/AiGeneration/models/GenerationStyles`). AGENTS.md is
   explicit: "Cross-module imports MUST only target the destination
   module's root **`index.ts`**" — there is no enforcement here
   because the file does not exist. Every other module in this repo
   has one.

2. **Four orphan command handlers.**
   `handlers/aiMidi/handle{DetectKey,DetectTempo,StripSilence,AudioToMidi}AiMidi.ts`
   are `createHandler<...>(...)` exports for actions whose canonical
   handler lives in `Arrangement/handlers/clip/`. The comment in
   `useCases/getAiMidiHandlers.ts:11` admits these were duplicating
   the Arrangement handlers and "overwriting" them in the merge. The
   orphan files (and their four specs) remain in the tree as a
   documentation-by-accident of "this is what the handler used to
   look like". There are now two parallel implementations of
   `handleAudioToMidi` — the Arrangement one casts `payload.mode as
   'rhythm' | 'pitched'`, the AiGeneration one uses a ternary
   `payload.mode === 'pitched' ? 'pitched' : 'rhythm'`. They will
   drift.

3. **Inconsistent task-store coverage.** Five Command-bus handlers
   (`handleGenerateAudioAiMidi`, `handleStemSeparate`, `handleCompleteMidi`,
   `handleVariationMidi`, `handleGenerateBassline`) run for **seconds
   to minutes** but never call `addTask` / `updateTask`. Three
   action use cases (`handleGenerateMidiPrompt`, `handleAiDenoiseClip`,
   `handleStemSeparationPreview`, `handleGenerateAudioFallback`) do.
   The user sees a "processing → success/error" card in the AI panel
   for some operations and silence-then-toast for others, with no
   explanation. Since `aiStore` is the only progress feedback channel
   for AI work, this means generation triggered through Command
   (right-click → "Generate audio") is invisible until it finishes.

4. **`handleExtractGroove` discards its return value.** The handler
   (`handlers/generation/handleExtractGroove.ts:7`) calls
   `extractGroove(alpha.payload.clipId)` and never stores or surfaces
   the resulting `GrooveTemplate`. There is no registry of extracted
   grooves; `applyGrooveByGrooveId` only consults `factoryGrooves`
   (`useCases/grooveTemplate/applyGrooveByGrooveId.ts:6`). Whatever
   the user just "extracted" is unreachable until they reload the
   factory grooves. The action is undoable (`describe`/`undoable`
   set) but it is in fact a no-op user-visibly.

5. **Two parallel `extractGroove` implementations.**
   `MIDI/useCases/grooveExtraction/extractGrooveFromClip.ts` (used by
   `Workspace/presentations/views/ClipView/PianoRollContextMenu.tsx`)
   does the same job as
   `AiGeneration/useCases/grooveTemplate/operations/extractGroove.ts`
   (used by the orphan `handleExtractGroove` above). Different return
   shapes, different grid handling. AGENTS.md "Model isolation"
   explains the duplication is fine — the bug is that the two
   features are presented to the user as the same thing ("extract
   groove from clip") but only the MIDI module's output is consumable
   anywhere.

6. **`generateMidiVariations` undo entry restores the wrong order.**
   `useCases/generateMidiVariations.ts:154-181` snapshots before, calls
   `createAlternativeClips`, snapshots after, then registers an undo
   entry. The "undo" callback (`:165`) restores the **before**
   snapshot, the "redo" callback (`:172`) restores the **after**
   snapshot. The `pushUndoEntry` signature in this codebase is
   `(label, undo, redo, options)` — passing `undo` first, `redo`
   second. The current code looks superficially correct. **However**,
   `createAlternativeClips` is called between the two snapshots, and
   if it has any side effect on `midiStore` that resolves
   asynchronously (microtask, animation frame), `midiSnapshotAfter`
   may still equal `midiSnapshotBefore`. There is no test covering
   the undo/redo round-trip; `__tests__/generateMidiVariations.spec.ts`
   only asserts the "track state unavailable" early-return path.

7. **`generateMidiVariations` requires `targetClip.endBeat -
   startBeat > 0` but does not handle a clip that is exactly 0
   beats.** `useCases/generateMidiVariations.ts:75-78` uses `<= 0`,
   so a zero-length clip does throw — but the type of `Clip.endBeat`
   /`startBeat` is `number`, so `NaN` slips through (`NaN - NaN = NaN
   <= 0` is `false`). A future caller with a malformed clip will get
   "Generate variations" prompts the LLM with `length ${duration}` =
   `"length NaN beats"` and burns API tokens.

8. **Unbounded LLM-token concatenation in `generateMidiVariations`.**
   `useCases/generateMidiVariations.ts:101,118-122` accumulates the
   cloud-stream response into a single `responseStr` with no
   `maxTokens` enforcement on the runtime side beyond the
   `streamCloudChatCompletion` parameter. There is no abort signal,
   no user-cancellation hook, no idle timeout — once the request
   starts, it runs to completion. `cancelProcessingTask` only
   force-fails the task UI; the network request keeps running and
   the comment in
   `useCases/actions/cancelProcessingTask.ts:5-9` admits this.

9. **`llmMidiGeneration` JSON regex is broken for nested objects.**
   `useCases/llmMidiGeneration.ts:146` uses
   `raw.match(/\{[\s\S]*"notes"[\s\S]*\}/)`. `[\s\S]*` is greedy, so
   if the LLM emits any text after the JSON object, the regex
   captures from the first `{` through the last `}` anywhere in the
   response, which can over-capture trailing markdown explanations
   and produce malformed JSON. Combined with a single bare `JSON.parse`
   inside `try {}` (no validation library, no zod), parse failures
   silently fall back to the pattern-match path. The same regex
   shape is repeated in `generateMidiVariations.ts:131`.

10. **`parseMidiResponse` lets NaN propagate through clamping.**
    `useCases/llmMidiGeneration.ts:175-177` defines `clamp(value, min,
    max) → Math.min(max, Math.max(min, value))`. The predecessor
    filter at `:158-163` accepts `typeof velocity === 'number'` —
    which is `true` for `NaN`. `Math.round(NaN) → NaN`,
    `Math.max(1, NaN) → NaN`, `Math.min(127, NaN) → NaN`. (The
    audit previously cited a non-existent formula
    `Math.max(min, Math.max(value, max))`; the code is correct
    `min/max` order — what's broken is that NaN is fixed-point
    under `Math.max`/`Math.min`, not the order of arguments.) NaN
    pitches and start_beats slip through to `MidiGenerationNote`
    consumers downstream. `handleGenerateMidiPrompt.ts:78-83`
    forwards them to `batchAddMidiNotes` without re-checking. A
    NaN start_beat will fail any sort comparator
    (`a.startBeat - b.startBeat = NaN`); a NaN pitch indexed into
    a piano-roll bucket gives `undefined`. **`handleAddNotes` and
    `handleVariationMidi` don't have this bug** — both call
    `Math.max(min, Math.min(max, Math.round(...)))` which is also
    NaN-fixed-point, but their *upstream* (`llmGenerateNotes`
    in `llmNoteHelpers.ts:54-60`) returns `addNotesCall.arguments.notes
    as Array<...>` with no validation at all, so NaN can land via a
    different code path. Three independent validation surfaces, none
    of them reject NaN.

11. **`generateMidiVariations` validator doesn't check ranges.**
    `useCases/generateMidiVariations.ts:31-44` `isVariationNoteArray`
    only validates `typeof === 'number'`, not `0 ≤ pitch ≤ 127`,
    `velocity ∈ [1, 127]`, `startBeat ≥ 0`, `duration > 0`. The LLM
    can return `pitch = 9999` and the variation will be created with
    that value, then any downstream code that indexes into a
    `Float32Array[pitch]` will silently fail.

12. **`handleGenerateMidiPrompt` Tauri seed notes are hard-coded
    nonsense.** `useCases/actions/handleGenerateMidiPrompt.ts:22-28`
    seeds the native engine with a fixed `[60, 62, 64, 65]` quartet
    every call. There is no way for the user to seed a continuation
    from existing notes, no way to pass a key, no way to pass a
    creativity. The Tauri path effectively ignores the user's prompt.
    The browser path (`generateMidiViaLlm`) does use the prompt.

13. **`handleGenerateAudioAiMidi.endBeat` math is wrong unit.**
    `handlers/aiMidi/handleGenerateAudioAiMidi.ts:37`
    `Math.max(1, Math.ceil(audioBuffer.duration * 2))` derives
    `durationBeats` from "seconds × 2", which is only correct if the
    project tempo is 120 BPM. At 60 BPM a 4-second buffer becomes a
    "8-beat" clip but the audio is 2 beats long; at 180 BPM it
    becomes "8-beat" but the audio is 12 beats long. The clip will
    play short or run off the end of its bounds depending on tempo.

14. **`handleGenerateAudioAiMidi` ignores playhead.** `:42`
    `startBeat: 0` — every AI-generated audio clip lands at beat 0
    regardless of where the user is. `handleGenerateMidiPrompt` does
    use the playhead (`getTransportState().playheadPosition`); the
    audio handler doesn't.

15. **`handleStemSeparate` allocates a new track per stem
    unconditionally.** `handlers/aiMidi/handleStemSeparate.ts:38-53`
    creates a new `audio` track per returned stem with no
    de-duplication. Re-running stem separation on the same clip
    creates a second batch of tracks named `${clip.name} —
    ${stemName}`. The first batch is never reused or removed. A user
    who clicks "separate stems" three times has 12 tracks (3× 4
    stems), all titled the same.

16. **`handleStemSeparate` does not validate `stems` payload.**
    `handlers/aiMidi/handleStemSeparate.ts:12` `stems = alpha.payload.stems
?? ['all']` — but the `AppAction` type only declares `stems?:
string[]`, not `'all' | 'vocals' | 'drums' | 'bass' | 'other'`.
    Garbage in `stems` (`["voccals"]`, `[""]`) is forwarded to
    `separateStems()`. The repository layer's contract is unclear
    from this side.

17. **Stem-separation cache key conflict between the two paths.**
    `useCases/actions/handleStemSeparationPreview.ts:30`
    `audioBufferCache.set(\`${clipId}-${name}\`, stemBuffer)`.
    `handlers/aiMidi/handleStemSeparate.ts:43`
    `audioBufferCache.set(crypto.randomUUID(), stemBuffer)`. Two
    sequential runs (preview then full) leave duplicate buffers for
    the same audio under different keys. `handleStemSeparationPreview`
    has no UI hook to display its results — it just writes to cache.

18. **`handleAiDenoiseClip` writes a fixed `${clipId}-denoised`
    cache key.** `useCases/actions/handleAiDenoiseClip.ts:28,57`
    overwrites the previous denoised version every call. There is no
    way to A/B compare strengths, no clip created on a track, and
    the `audio` UI never knows the buffer exists. The "task data"
    record (`:62`) is the only surface ever bridging back; the user
    must manually mount that buffer onto a clip.

19. **`handleAiDenoiseClip` browser-path noise floor math is wrong.**
    `useCases/actions/handleAiDenoiseClip.ts:32` computes
    `noiseSamples = floor((sampleRate * 0.5) / hop) * hop`. With
    `hop = 1024` and `sampleRate = 44100`, this is `21 * 1024 =
21504`. The intent (per `*0.5`) was 0.5 seconds; the actual value
    is 21504/44100 ≈ 0.487 s. Acceptable, but the loop at `:34-38`
    runs over `noiseSamples`, sums `mono[i] * mono[i]`, divides by
    `Math.max(noiseSamples, 1)` — but the `mono[i] ?? 0` defensive
    fallback is dead code on a `Float32Array` (typed-array reads
    return 0 for out-of-range indexes; they don't return undefined),
    same anti-pattern as `AudioAnalysis/repositories/browserStemSeparation.ts`.

20. **`handleAiDenoiseClip` browser-path expansion ratio formula
    has a discontinuity at threshold.**
    `useCases/actions/handleAiDenoiseClip.ts:46-51`:
    `output[index] = state * (ratio * (1 - strength) + (1 - ratio) *
0.05)` where `ratio = abs / threshold`. At `abs = 0`, multiplier
    is `0.05`. At `abs = threshold` (just below), multiplier is
    `1 * (1 - strength) + 0 * 0.05 = 1 - strength`. At
    `abs > threshold`, the `else` branch passes through unmodified
    (multiplier 1). With `strength = 0.7`: the curve runs `0.05 →
0.30` from silence to threshold, then **jumps** to `1.0` at
    threshold-crossing. That step from 0.30 to 1.0 is a 10 dB
    discontinuity, audible as a buzz on every threshold-crossing
    sample. With `strength = 1.0` the discontinuity is from 0 to
    1 (∞ dB). (Audit previously claimed "full silence at threshold"
    — only true when `strength = 1`. The discontinuity is the real
    bug.) A correct downward expander must be C¹-continuous at
    threshold; the standard form is `gain = ratio^k` for some
    user-controlled `k > 1` (with `k = 1` reducing to a simple gate).

21. **`handleCompleteMidi` "backward" direction shifts notes
    incorrectly when `minBeat = 0`.** `handlers/aiMidi/handleCompleteMidi.ts:40-45`
    initialises `minBeat = 0` then takes `Math.min` with each
    `n.startBeat`. If the LLM correctly emits notes with negative
    startBeats, `minBeat` becomes the most-negative; the shift at
    `:61` (`shiftedStart = note.startBeat - minBeat`) then maps the
    earliest note to 0 (correct). **But** if the LLM ignores the
    instruction and emits notes with `startBeat ≥ 0`, `minBeat`
    remains `0`, and the notes are written verbatim — which means a
    note at `startBeat = 7` lands at beat 7 inside a clip that ends
    at `refClip.startBeat`. Without clipping, the prepended clip
    will hold notes that overflow beyond its `endBeat`.

22. **`handleCompleteMidi` "backward" silently drops backward notes
    if no track contains the source clip.** `:32-34` finds the
    track via `trackStore.value?.tracks.find(...)`. If the lookup
    fails, the entire backward branch is skipped — but the LLM call
    has already happened (and the user has paid the latency). The
    handler exits with `logger.info("[AI MIDI] Completed N notes
    (backward)")` even though zero notes were inserted. There is no
    error notification path.

23. **`handleGenerateBassline` does not snapshot for undo.** Marked
    `undoable: true` but never registers an undo entry. Calling
    `Cmd-Z` after generating a bassline will not undo the new
    track + new clip + new notes. Same pattern in
    `handleStemSeparate`, `handleGenerateAudioAiMidi`,
    `handleAddNotes` (relies on the action handler middleware to
    diff stores, not on explicit `pushUndoEntry`).

24. **`handleAddNotes` writes notes one at a time.**
    `handlers/aiMidi/handleAddNotes.ts:11-17` calls `addMidiNote(...)`
    in a `for` loop. Per `applyChordProgressionToTrack.ts:38-49` and
    `applyMelodyToTrack.ts:38-47`, the canonical code path uses
    `batchAddMidiNotes` for exactly this reason ("avoids O(N) CRDT
    flood"). The AI handler ships the slow path. For an LLM-generated
    bassline of ~32 notes this is one store mutation per note, ie.
    32 React renders.

25. **`generateMidiVariations` formats notes with `String(duration)`
    that may exceed JSON-token budget.** `useCases/generateMidiVariations.ts:90`
    builds a `noteStrings` payload by string-joining every existing
    note. For a 4-bar clip with ~64 notes this is ~3 KB of text in
    the prompt; for a longer clip the prompt size scales linearly
    with note count and may exceed the LLM's context window. There
    is no truncation or summarisation.

26. **Magic-number `density * 1.x` multipliers in melody/drum
    generators.** `useCases/generateMelody/algorithm.ts:91,105,119,135,158`
    multiplies `density` by a per-style constant (1.2, 1.5, 1.4,
    1.3, 0.8) before comparing to `rng()` for rest selection. The
    multipliers are uncommented and not derived from any reference.
    Same pattern for drums (`generateDrumPattern.ts:495`,
    `effectiveProbability = probability >= 1 ? 1 : probability *
density * 2`). At `density = 1`, `density * 2 = 2 > 1`, so the
    `else` branch never gates — meaning at full density, every
    nonzero-probability slot fires. At `density = 0.4`, the
    multiplier is 0.8, which is "less than full" — but the cell
    probability values are themselves in [0, 1], so the threshold
    becomes a quadratic of two independent randomnesses. Documented
    nowhere.

27. **`applySwing` only swings odd subdivisions.**
    `useCases/generateDrumPattern/algorithm.ts:457-462`:
    `if (swingAmount <= 0 || subdivisionIndex % 2 === 0) return
beat;` — the early-return shape is fine, but the constant
    `swingAmount * 0.25 * 0.5` (= `swingAmount * 0.125`) is only
    correct for 16th-note swing; the comment is missing and the
    function is called with `subdivisionIndex` from a 16th-grid loop,
    so it happens to work. Hard-coded grid resolution.

28. **`createGenerationHandler` casts the action to a payload shape
    via `as`.** `handlers/generation/createGenerationHandler.ts:46,69,92`
    uses `(alpha as { payload: CommonGenerationPayload }).payload`
    and `alpha as Extract<AppAction, { type: ActionType }>` because
    the generic `ActionType extends GenerationActionType` doesn't
    let TypeScript narrow on the discriminant inside the factory.
    AGENTS.md "TypeScript — soundness" forbids these escapes; the
    correct fix is a discriminated-union factory or a per-action
    handler. The comment ("alpha is the specific action union
    member; cast to shared payload shape for uniform handling") just
    documents the shortcut.

29. **`handleGenerateChordProgression` / `handleGenerateMelody`
    payload-narrowing uses `as`.** Both call out to
    `createGenerationHandler` and then themselves cast within the
    `applyToTrack` callback (`handleGenerateChordProgression.ts:17`,
    `handleGenerateMelody.ts:21`). The `applyChordProgressionToTrack`
    type signature requires a `ChordProgressionStyle`, but the
    factory only validates against a `ReadonlySet<string>` — the
    values inside the set are typed `string`, so the narrowing
    relies on faith.

30. **`useCases/index.ts` re-exports types implicitly.** The barrel
    re-exports `applyChordProgressionToTrack` /
    `applyDrumPatternToTrack` / `applyMelodyToTrack` (whose typed
    parameters are `GenerateChordProgressionOptions`,
    `GenerateDrumPatternOptions`, `GenerateMelodyOptions`) plus
    `generateMidiVariations`. AGENTS.md: "Use-case types stay
    private — Do not `export type` from `useCases/` for other
    modules". No explicit `export type {}` here, but
    `compileDso.ts` consumes the type unions from
    `#/modules/AiGeneration/models/GenerationStyles` directly —
    crossing a module boundary into `models/` (forbidden by
    `models-private-cross`) under the cover of `import type` and a
    multi-paragraph justifying comment.

31. **`compileDso.ts` cross-module `import type` from
    `models/GenerationStyles`.** AGENTS.md is unambiguous: "Models
    (`models/`) are strictly private to their owning module and must
    never be exported or re-exported across module boundaries — not
    even through `useCases/`". The architectural-circular-dependency
    workaround documented in `models/GenerationStyles.ts:1-12` and
    `compileDso.ts:18-30` is a violation. The correct fix is to
    duplicate the type unions in the consumer (AGENTS.md "Model
    isolation" — "Duplication is intentional"). Cross-module
    couplings should break loudly when the contract changes; the
    import hides that.

32. **AGENTS.md "Same module — relative imports" is honoured here**
    (no `#/modules/AiGeneration/...` self-imports inside the module),
    but the `handlers/aiMidi/` and `handlers/generation/` files
    import `useCases/...` via three-level-deep `../../../useCases/...`
    relative paths (e.g. `handleApplyGroove.ts:3`,
    `handleExtractGroove.ts:3`). Functional, but the `handlers/`
    layer importing `useCases/` is the intended direction; the
    convention is fine.

33. **Tests cast partial fixtures and action payloads via `as any`
    / `as unknown as …`.**
    - `handlers/aiMidi/__tests__/handleStemSeparate.spec.ts:14`
      `trackStoreValue: { value: null } as any`.
    - `handlers/generation/__tests__/createGenerationHandler.spec.ts:42,48,52,64,68`
      `} as any`, `as any` on `execute(...)`.
    - `handlers/generation/__tests__/handleGenerateChordProgression.spec.ts:67-70`
      `as unknown as 'pop'` on three lines.
    - `handlers/generation/__tests__/handleGenerateMelody.spec.ts:66-67`
      `as unknown as 'simple'`, `as unknown as 'major'`.
    - `useCases/grooveTemplate/operations/__tests__/applyGroove.spec.ts:8`
      `midiStoreValue: { value: null } as any`.
    - `useCases/grooveTemplate/operations/__tests__/extractGroove.spec.ts:7`
      `midiStoreValue: { value: null } as any`.
    AGENTS.md "TypeScript — soundness" forbids these.

34. **`createGenerationHandler.spec.ts` uses `import * as helpers`.**
    `handlers/generation/__tests__/createGenerationHandler.spec.ts:4`
    is the only namespace import in the module — AGENTS.md "Imports:
    Never use namespace imports". Replace with named imports of
    `resolveOrCreateMidiTrack` and `getPlayheadBeat`.

35. **`handleGenerateMidiPrompt` doubles up undo entries when the
    generation is empty.** `useCases/actions/handleGenerateMidiPrompt.ts:34-128`
    only calls `pushUndoEntry` (`:90`) inside the `if (clip)` branch,
    but `addClip` runs before that. So a generation that produced
    notes but failed at `addClip` would leave the new track from
    `addTrack` (`:47-50`) without an undo entry. The "no notes"
    branch (`:122-128`) likewise leaves any newly-created track
    behind.

36. **`handleAiDenoiseClip` does not handle `OfflineAudioContext`
    rejection.** `useCases/actions/handleAiDenoiseClip.ts:25,54` calls
    `new OfflineAudioContext(1, length, sampleRate)` and `createBuffer`.
    On Safari (and some headless environments) this can throw if
    `length === 0` or `sampleRate` is below the implementation's
    minimum. The catch is generic (`error: unknown`), the user sees
    "Denoise failed", and the original buffer is untouched — but
    `addTask`'s `data` field still records `clipId` and `noiseFloorDb`
    in the success path; the failure path stores no diagnostic.

37. **`audioBufferToWav` lives in `handlers/aiMidi/`.** AGENTS.md:
    "**Repositories Touch Metal:** All I/O ... goes in `repositories/`.
    Use cases orchestrate repositories." `audioBufferToWav` is a
    pure helper; `services/` is where it belongs (per the
    `AudioAnalysis` audit's "Services layer" definition). Currently
    it sits in `handlers/aiMidi/` with its sibling specs. The
    duplicate function is also imported from `AudioEngine/useCases`
    (`handlers/aiMidi/handleStemSeparate.ts:6`,
    `useCases/actions/handleStemSeparationPreview.ts:4`) — so we
    have one local copy and one cross-module dependency on
    `AudioEngine`.

38. **`handlers/aiMidi/handleAddNotes.ts` test uses sub-path import.**
    `handlers/aiMidi/__tests__/handleAddNotes.spec.ts:5,15` imports
    `#/modules/MIDI/useCases/midiNoteCrud/addMidiNote`. AGENTS.md
    Contract Boundaries: "Cross-module imports MUST only target the
    destination module's root **`index.ts`**." Even in tests the
    deep import is a violation; `addMidiNote` is exported from
    `#/modules/MIDI/useCases/index.ts`.

39. **`handleStemSeparate` and `handleGenerateAudioAiMidi` import
    `audioBufferCache` from `#/modules/AudioEngine/stores`.** This
    is a deep import into AudioEngine's `stores/`. AGENTS.md
    "Cross-module imports MUST only target the destination module's
    root `index.ts`". The same pattern repeats in
    `useCases/actions/handleStemSeparationPreview.ts:3`,
    `handleAiDenoiseClip.ts:2`, `handleGenerateAudioFallback.ts:3`,
    `handleGenerateMidiPrompt` (none, uses `MIDI/useCases`),
    `handleGenerateAudioAiMidi.ts:3`. This is consistent across the
    module but consistently wrong; it leaks the private path to all
    of `AudioEngine`'s consumers if the rule is enforced.

40. **`generationHandlerHelpers.VALID_*` lists are out of date.**
    `handlers/generation/generationHandlerHelpers.ts:4-44`. The
    `VALID_DRUM_STYLES` set lists 8 styles (`four-on-floor,
breakbeat, trap, jazz, latin, rock, dnb, half-time`). The
    algorithm `useCases/generateDrumPattern/algorithm.ts:39-451`
    handles **17** styles (`four-on-floor, breakbeat, trap, jazz,
latin, rock, dnb, half-time, blues, reggae, lofi, house, techno,
synthwave, afrobeat, metal, punk`). Anyone selecting `house`,
    `techno`, `lofi`, `blues`, `reggae`, `metal`, `punk`,
    `afrobeat`, `synthwave` from a UI dropdown will be silently
    coerced to `'rock'` in `createGenerationHandler.execute`
    (`:47`). `VALID_MELODY_STYLES` is in sync (5 / 5);
    `VALID_CHORD_STYLES` lists 8 (`pop, jazz, classical, edm, blues,
rnb, folk, cinematic`) but the algorithm has 12 (adds `neo-soul,
gospel, rock, lofi`); `VALID_SCALES` lists 7 of 14. This is the
    most user-visible bug in the module.

41. **`buildPatternForBar` exits with `default: throw new
Error(...)`** (`useCases/generateDrumPattern/algorithm.ts:452`)
    even though the `style: DrumPatternStyle` parameter is a
    discriminated union. With `validStyles` not in sync (issue
    #40), this will never throw at runtime — but the unreachable
    branch is the only safety net for "unknown drum pattern" if a
    refactor adds a style without handling it. Better: exhaustive
    `switch` returning `never` and `assertNever`.

42. **`generateChordProgression` `applyVoicing` returns `[]` on
    fallthrough that cannot happen.** `useCases/generateChordProgression/algorithm.ts:139-160`
    has a complete `switch` over `ChordVoicing` with `return` in
    every branch, then a dead `return []` after the switch. Same
    pattern in `buildRhythmEvents` (`:165-193`) and `pickNextNote`
    (`:173-220`) — `default: return currentIndex` and the
    post-switch `return [] / return currentIndex` lines exist as
    "TS exhaustiveness fallbacks". The result is not buggy but it
    masks future enum additions: a new `ChordVoicing` would silently
    return `[]` instead of failing the type-check.

43. **`generateMelody` `pickNextNote` arpeggiated wrap is
    off-by-one at exact `-len`.**
    `useCases/generateMelody/algorithm.ts:189-195`:
    ```
    let next = currentIndex + step;
    if (next >= len) { next = next % len; }
    if (next < 0)   { next = len + (next % len); }
    return next;
    ```
    When `next = -5` and `len = 5`: `next % len = -0` (JS preserves
    sign of the dividend, but `-0 === 0`), so `next = 5 + 0 = 5`,
    then returned as the array index. `scaleNotes[5]` is `undefined`
    on a length-5 array, but the call site at
    `algorithm.ts:271-272` does `const pitch = scaleNotes[currentScaleIndex]!;`
    — non-null assertion — so the build-time type system silently
    coerces `undefined` to `number`, and downstream `note.pitch =
undefined` propagates to `batchAddMidiNotes`. Reproducer: pick
    a 7-step scale (`len = 7`), arpeggiated style, very long run with
    repeated `step = -7` outcomes. The canonical positive-modulo
    idiom `((next % len) + len) % len` avoids both the boundary case
    and the opacity. (Audit previously called this "opaque math",
    not a bug — it is a bug.) The mirror branch `next >= len`
    has the same structure but lands on the `[0, len)` invariant
    correctly because `next % len` is in `[0, len)` for positive
    `next`. The assignment `currentScaleIndex = pickNextNote(...)`
    at `:271` then **persists** the bad index for subsequent calls
    in the same melody — a single bad wrap can corrupt the rest
    of the run.

44. **`handleStemSeparationPreview` does not create clips for the
    new buffers.** `useCases/actions/handleStemSeparationPreview.ts:29-31`
    sets cache entries but never calls `addClip` or `addTrack`. The
    stem buffers are orphaned in the cache. The "preview" semantics
    are unclear — what is the user expected to do with this?
    Compare with `handlers/aiMidi/handleStemSeparate.ts:38-53`
    which does the full track-and-clip creation. Either rename
    `handleStemSeparationPreview` to make the lack of UI integration
    explicit or actually surface the buffers somewhere.

45. **`extractGroove` clamps offsets to `±0.5`** (`useCases/grooveTemplate/operations/extractGroove.ts:43`).
    The comment in the test (`extractGroove.spec.ts:99-103`)
    acknowledges that `Math.round`-based step assignment guarantees
    `|offset| ≤ 0.5` mathematically, so the clamp is cosmetic. Dead
    defensive code.

46. **`audioBufferToWav` clamps but doesn't normalise to dBFS.**
    `handlers/aiMidi/audioBufferToWav.ts:41` clamps to `[-1, 1]`
    before writing as 16-bit. Loud sources (e.g. AI-generated audio
    with > 1.0 peaks) silently clip. Stem separation results are
    re-encoded through this; if Demucs produced > 1.0 peaks the
    encoded WAV will be hard-clipped before being passed back out.

47. **`audioBufferToWav` non-interleaved channel iteration is
    cache-hostile.** `handlers/aiMidi/audioBufferToWav.ts:38-45`
    loops `for (sample) { for (channel) { ... } }` — correct
    interleaving order, but the inner loop reads from
    `channels[ch]![index]` across separate `Float32Array`s,
    incurring a cache miss per channel switch. For a 60 s stereo
    buffer at 44.1 kHz that's 5.3M cache-line crosses. Using the
    `OfflineAudioContext.createBuffer` round-trip in
    `handleStemSeparate` and `handleAiDenoiseClip` makes this hot.

48. **`isAudioGenerationAvailable()` checked twice in two paths.**
    `handlers/aiMidi/handleGenerateAudioAiMidi.ts:10` checks it; so
    does `useCases/actions/handleGenerateAudioFallback.ts:14`. Both
    throw `createAiGenerationError` on `false`. Duplicated branch
    with slightly different error messages
    ("requires the Sourdaw desktop app" vs "requires the Sourdaw
desktop app (uses Stable Audio Open via Python sidecar)"). Pick
    one source of truth.

49. **`MIDI/useCases` deep test imports.** Specs in
    `useCases/grooveTemplate/__tests__/applyGrooveByGrooveId.spec.ts:10`
    use `vi.mock('../../../repositories/factoryGrooves', ...)`
    with three-level relative paths. Functional but brittle; if
    `applyGrooveByGrooveId.ts` moves, the mock path silently breaks.
    Several other specs depend on relative paths that mirror the
    module structure (e.g.
    `handlers/aiMidi/__tests__/handleStemSeparate.spec.ts`,
    `handlers/generation/__tests__/handleGenerateMelody.spec.ts`).
    Acceptable, but a single rename will require coordinated updates.

50. **`useCases/grooveTemplate/__tests__/operations.spec.ts` is a
    duplicate of `useCases/grooveTemplate/operations/__tests__/extractGroove.spec.ts`.**
    Both files cover `extractGroove`. The first
    (`__tests__/operations.spec.ts:1-26`) has a single test
    asserting `subdivisions === 8`; the second
    (`operations/__tests__/extractGroove.spec.ts`) has four. The
    redundant file lives in a folder named for the missing
    `operations.ts` (no such file exists; `applyGroove.ts` and
    `extractGroove.ts` are individual files in `operations/`).
    Dead test file.

51. **`AiGeneratedMidiNote` model is never imported anywhere.**
    `models/AiGeneratedMidiNote.ts:1-7` defines a snake-cased note
    shape, but every call site uses ad-hoc inline types
    (`useCases/llmMidiGeneration.ts:35-42`,
    `useCases/generateMidiVariations.ts:31-44`,
    `handlers/aiMidi/llmNoteHelpers.ts:9-11,29-31,55-60`). Either
    use it or delete it.

52. **`events/index.ts` is a placeholder.** Single comment line:
    `// No events defined in AiGeneration module`. Nothing imports
    it. Either remove the folder or define module events (e.g.
    `aiGenerationStarted`, `aiGenerationCompleted`, `aiTaskUpdated`)
    as a proper contract surface.

53. **No accessibility or progress-feedback contract for AI
    operations.** `aiStore.tasks` is consumed by `AiTaskResultCard`
    (`#/modules/AiRuntime/presentations/components/AiTaskResultCard.tsx`)
    but no `role="status"` / `aria-live` plumbing is visible from
    this side, and the five Command-bus handlers (#3) don't even
    populate the store. Long-running operations (~60s LLM stream,
    ~60s stem separation, ~30s audio generation) emit only
    `logger.info` and a final `notifyUser`. Screen-reader users get
    no progress feedback.

54. **The `AppAction` payload for `audioToMidi` advertises `mode:
string` (free-form).** `Command/models/AppAction.ts:259`
    `mode?: string` rather than `'rhythm' | 'pitched'`. The orphan
    `handleAudioToMidiAiMidi.ts:13` and the canonical
    `Arrangement/handlers/clip/handleAudioToMidi.ts:10` both
    coerce. AGENTS.md "TypeScript — soundness — discriminated
    unions" applies. Fixing this is in `Command`, not here, but
    the orphan handler is a representative file.

55. **`getAiSnapshot` falls back to a fresh `initialState` if
    `aiStore.value` is `null`.** `stores/aiStore.ts:37-39`:
    `return aiStore.value ?? initialState;`. Then `addTask`,
    `updateTask`, `removeTask`, `cancelProcessingTask`,
    `toggleAiPanel` all call `getAiSnapshot()`, mutate, and
    `aiStore.set(...)` the result. If two operations interleave
    (microtask scheduling), the second one's snapshot is the
    pre-set value — race window between `getAiSnapshot()` and
    `aiStore.set(...)`. The window is small but non-zero, and
    tasks added in parallel can be lost. Stress test:
    `Promise.all([addTask({...}), addTask({...})])`.

---

## Priorities

1. **`VALID_*` style sets are out of date with the algorithms**
   (issue #40) — user-visible bug: 9 of 17 drum styles, 4 of 12
   chord styles, and 7 of 14 scales are silently coerced to a
   default. Mechanical fix; high impact.
2. **Orphan handlers + missing root `index.ts`** (issues #1, #2) —
   the module's public surface is undefined. Pick one of: register
   the orphans, delete the orphans (and their specs), and add a
   barrel.
3. **Inconsistent task-store coverage** (issue #3) — five
   long-running Command-bus handlers run silently, breaking the
   panel-feedback contract.
4. **`handleGenerateAudioAiMidi.endBeat` and ignored playhead**
   (issues #13, #14) — generated audio clips land at beat 0 with
   tempo-incorrect length.
5. **`extractGroove` discards its result** (issue #4) — the action
   advertised in the UI is a no-op.
6. **Magic-number generation parameters and density formula**
   (issues #26, #27) — undocumented, hard to tune, and probably
   wrong at extremes.
7. **LLM JSON parsing is fragile (regex + minimal validation)**
   (issues #9, #10, #11) — invalid LLM output silently falls back
   to a built-in pattern.
8. **AGENTS.md type-soundness violations** (issues #28, #29, #31,
   #33, #34) — `as`, `as unknown as`, `as any`, namespace import,
   cross-module `import type` from `models/`.
9. **Dead/duplicated code** (issues #5, #19, #45, #50, #51, #52) —
   parallel `extractGroove` implementations, dead `?? 0` on typed
   arrays, dead `±0.5` clamp, dead `operations.spec.ts`, unused
   `AiGeneratedMidiNote` model, placeholder `events/`.
10. **Cross-module deep imports** (issues #38, #39) — module-private
    paths leaking out.

---

## Open issues

### 1. No root `index.ts` barrel for the module

**Problem:** The module has no `src/modules/AiGeneration/index.ts`.
Cross-module consumers reach into `useCases/`, `stores/`,
`stores/aiStore`, and `models/GenerationStyles` directly. AGENTS.md
"Cross-module imports MUST only target the destination module's
root `index.ts`" cannot be enforced because the file does not exist.
Other modules in the repo have one.

**Representative files:**

- `src/app/bootstrap.ts:4` (`#/modules/AiGeneration/useCases`)
- `src/modules/AiRuntime/presentations/views/GenerativeAiPanel.tsx:14,21`
- `src/modules/AiRuntime/presentations/components/AiTaskResultCard.tsx:7`
- `src/modules/AiRuntime/presentations/components/__tests__/AiTaskResultCard.spec.tsx:4`
- `src/modules/Workspace/presentations/views/AppShell.tsx:8`
- `src/modules/Workspace/presentations/views/Inspector/ClipMidiAiSection.tsx:13`
- `src/modules/Workspace/presentations/views/Inspector/ClipAudioAiSection.tsx:9`
- `src/modules/Workspace/presentations/views/ClipView/WaveformEditor.tsx:16`
- `src/modules/Workspace/presentations/views/Transport/PanelToggles.tsx:20-21`
- `src/modules/Arrangement/presentations/views/ClipContextMenu.tsx:8`
- `src/modules/AiRuntime/useCases/dsoEditor/compileDso.ts:30`

**Needed:** Create `src/modules/AiGeneration/index.ts` re-exporting
the curated cross-module surface from `useCases/`, `stores/`, and
`events/` (`AGENTS.md`: "may **only** re-export from `useCases/`,
`events/`, `stores/`, and `presentations/views/`"). Migrate every
external consumer to import from `#/modules/AiGeneration` instead of
the deep paths. Run `pnpm deps:validate` to confirm.

### 2. Four orphan command handlers duplicate Arrangement handlers

**Problem:** `handlers/aiMidi/handle{DetectKey,DetectTempo,StripSilence,AudioToMidi}AiMidi.ts`
exist with their own specs but are not registered in any
`get*Handlers` aggregator. The comment in
`useCases/getAiMidiHandlers.ts:11-15` admits they were duplicates of
the canonical Arrangement handlers and were removed from the merge
to fix `[DEV][WARN] duplicate-key` logs. Keeping the files in the
tree means there are now two parallel implementations of each
handler that will drift.

**Representative files:**

- `src/modules/AiGeneration/handlers/aiMidi/handleAudioToMidiAiMidi.ts`
- `src/modules/AiGeneration/handlers/aiMidi/handleDetectKeyAiMidi.ts`
- `src/modules/AiGeneration/handlers/aiMidi/handleDetectTempoAiMidi.ts`
- `src/modules/AiGeneration/handlers/aiMidi/handleStripSilenceAiMidi.ts`
- (canonical) `src/modules/Arrangement/handlers/clip/handleAudioToMidi.ts`
- `src/modules/AiGeneration/useCases/getAiMidiHandlers.ts:11-15`

**Needed:** Decide. Either (a) wire these AiGeneration variants in
and remove the Arrangement versions if they belong here
domain-wise, or (b) delete the four orphan files and their four
specs. Do not leave them as documentation.

### 3. `VALID_*` style sets out of sync with algorithm switches

**Problem:** `handlers/generation/generationHandlerHelpers.ts:4-44`
declares `VALID_DRUM_STYLES` (8 entries), `VALID_CHORD_STYLES` (8
entries), and `VALID_SCALES` (7 entries). The algorithms support
17 drum styles, 12 chord styles, and 14 scales. Selecting any
"missing" style from a UI dropdown silently coerces to the
default (`rock`/`pop`/`major`).

**Representative files:**

- `src/modules/AiGeneration/handlers/generation/generationHandlerHelpers.ts:4-44`
- `src/modules/AiGeneration/useCases/generateDrumPattern/algorithm.ts:39-451`
- `src/modules/AiGeneration/useCases/generateChordProgression/algorithm.ts:59-111`
- `src/modules/AiGeneration/useCases/generateMelody/algorithm.ts:34-49`
- (consumer) `src/modules/AiGeneration/handlers/generation/createGenerationHandler.ts:47`

**Needed:** Replace the hand-typed `VALID_*` sets with sets derived
from the type unions in `models/GenerationStyles.ts`. Or generate
them from the algorithm's `switch` cases at compile-time via a
const tuple. Add a unit test that verifies set-vs-algorithm
parity. Failing test should fail today.

### 4. Inconsistent task-store coverage across handlers

**Problem:** Long-running Command-bus handlers
(`handleGenerateAudioAiMidi`, `handleStemSeparate`,
`handleCompleteMidi`, `handleVariationMidi`, `handleGenerateBassline`)
do not call `addTask` / `updateTask`. The action use cases that
share the same UX (`handleGenerateMidiPrompt`,
`handleAiDenoiseClip`, `handleStemSeparationPreview`,
`handleGenerateAudioFallback`) do. Whether the user sees a "task
processing" card depends entirely on which entry point fired.

**Representative files:**

- `src/modules/AiGeneration/handlers/aiMidi/handleGenerateAudioAiMidi.ts`
- `src/modules/AiGeneration/handlers/aiMidi/handleStemSeparate.ts`
- `src/modules/AiGeneration/handlers/aiMidi/handleCompleteMidi.ts`
- `src/modules/AiGeneration/handlers/aiMidi/handleVariationMidi.ts`
- `src/modules/AiGeneration/handlers/aiMidi/handleGenerateBassline.ts`
- `src/modules/AiGeneration/useCases/actions/handleGenerateMidiPrompt.ts`
- `src/modules/AiGeneration/useCases/actions/handleAiDenoiseClip.ts`
- `src/modules/AiGeneration/stores/aiStore.ts`

**Needed:** Wrap the LLM/audio operations in a single `withAiTask`
helper that runs `addTask → … → updateTask` around the body, and
apply it to every long-running handler. Surface the AppAction's
description as the task's `prompt`. Audit every command-bus AI
handler to ensure parity.

### 5. `handleExtractGroove` discards the extracted template

**Problem:** `handlers/generation/handleExtractGroove.ts:7` calls
`extractGroove(alpha.payload.clipId)` and never stores or surfaces
the resulting `GrooveTemplate`. There is no registry of extracted
grooves; `applyGrooveByGrooveId` only consults the factory list.
The action visible to the user is a no-op.

**Representative files:**

- `src/modules/AiGeneration/handlers/generation/handleExtractGroove.ts:7`
- `src/modules/AiGeneration/useCases/grooveTemplate/operations/extractGroove.ts:15-61`
- `src/modules/AiGeneration/useCases/grooveTemplate/applyGrooveByGrooveId.ts:1-11`
- `src/modules/AiGeneration/repositories/factoryGrooves.ts:59-61`

**Needed:** Either (a) maintain an `extractedGrooves` collection in
`aiStore` (or a new `grooveStore`) and have `applyGrooveByGrooveId`
consult both factory and extracted grooves; (b) write the extracted
template into MIDI module state; or (c) delete the action and route
through `MIDI/useCases/extractGrooveFromClip` (issue #6 below).

### 6. Two parallel `extractGroove` implementations

**Problem:** Two modules ship "extract groove" code:
`MIDI/useCases/grooveExtraction/extractGrooveFromClip.ts` (used by
the piano-roll context menu) and
`AiGeneration/useCases/grooveTemplate/operations/extractGroove.ts`
(used by the dead `handleExtractGroove`). Different return shapes,
different grid handling. The user-visible UI presents them as the
same operation.

**Representative files:**

- `src/modules/MIDI/useCases/grooveExtraction/extractGrooveFromClip.ts`
- `src/modules/AiGeneration/useCases/grooveTemplate/operations/extractGroove.ts`
- `src/modules/Workspace/presentations/views/ClipView/PianoRollContextMenu.tsx:25,329`

**Needed:** Pick one. AGENTS.md "Model isolation" supports
duplication, so if both APIs are intentionally different, document
the difference and rename one. If they're meant to be the same,
delete one.

### 7. `handleGenerateAudioAiMidi` `endBeat` math + ignored playhead

**Problem:** (a) `handlers/aiMidi/handleGenerateAudioAiMidi.ts:37`
computes `durationBeats = Math.max(1, Math.ceil(audioBuffer.duration
* 2))`. The `*2` only converts seconds to beats at 120 BPM. At 60
BPM the clip is 2× too long; at 180 BPM it's 1.5× too short.
(b) `:42` `startBeat: 0` always — the user's playhead is ignored
even though `handleGenerateMidiPrompt` does respect it.

**Representative files:**

- `src/modules/AiGeneration/handlers/aiMidi/handleGenerateAudioAiMidi.ts:37,42`

**Needed:** Read the project tempo (e.g. `getTransportState().bpm`)
to compute `durationBeats = audioBuffer.duration * (bpm / 60)`. Use
`getTransportState().playheadPosition` for `startBeat`. Add a test
covering both behaviours.

### 8. LLM JSON parsing is fragile

**Problem:** Both `useCases/llmMidiGeneration.ts:146` and
`useCases/generateMidiVariations.ts:131` use `\{[\s\S]*"notes"[\s\S]*\}`
or `\{[\s\S]*\}` regexes to extract JSON from a free-form LLM
response. The greedy `[\s\S]*` over-captures on multi-object
responses; a single bare `JSON.parse` and a `typeof === 'number'`
filter is the only validation. NaN passes the filter,
`Math.round(NaN)` produces NaN, and clamps return NaN —
silently-broken notes downstream.

**Representative files:**

- `src/modules/AiGeneration/useCases/llmMidiGeneration.ts:144-173`
- `src/modules/AiGeneration/useCases/generateMidiVariations.ts:131-151`

**Needed:** Replace the regex+`JSON.parse` with a zod (or
equivalent) schema validator. Reject NaN and out-of-range pitches
explicitly. Share the validator across both call sites. Add tests
covering NaN, out-of-range, missing fields, multi-object.

### 9. `generateMidiVariations` undo entries unverified

**Problem:** The undo entry in
`useCases/generateMidiVariations.ts:154-181` snapshots the stores
before and after `createAlternativeClips`. There is no test
covering the round-trip — `__tests__/generateMidiVariations.spec.ts`
only asserts the early-return path. If `createAlternativeClips` has
asynchronous store side effects, `midiSnapshotAfter` may equal
`midiSnapshotBefore`, breaking redo.

**Representative files:**

- `src/modules/AiGeneration/useCases/generateMidiVariations.ts:154-181`
- `src/modules/AiGeneration/useCases/__tests__/generateMidiVariations.spec.ts`

**Needed:** Add a behavioural test that drives the full flow,
captures the pushed undo entry's `undo` and `redo` callbacks, and
asserts the stores round-trip correctly. Confirm
`createAlternativeClips` is synchronous w.r.t. `trackStore.value` /
`midiStore.value`. If not, await its effect explicitly before
snapshotting.

### 10. `handleStemSeparate` re-runs create duplicate tracks

**Problem:** `handlers/aiMidi/handleStemSeparate.ts:38-53` creates a
new audio track per returned stem with no de-duplication. Re-running
on the same clip produces tracks named `${clip.name} — vocals`,
`${clip.name} — drums`, etc., one per run. There is no idempotency
key.

**Representative files:**

- `src/modules/AiGeneration/handlers/aiMidi/handleStemSeparate.ts:38-53`

**Needed:** Look up existing stem tracks (e.g. by tag or
parent-clip ID), reuse them when re-running, and replace the
buffers. Or add an action `removePreviousStems` before the new
batch.

### 11. Two stem-separation paths with different output behaviour

**Problem:** `useCases/actions/handleStemSeparationPreview.ts`
writes stem buffers to `audioBufferCache` keyed `${clipId}-${name}`
and creates a task entry, but never adds tracks/clips. The user
cannot reach the buffers from the UI.
`handlers/aiMidi/handleStemSeparate.ts` creates a track and clip
per stem with `crypto.randomUUID()` keys but no task entry. The
two run different code paths for nominally the same operation.

**Representative files:**

- `src/modules/AiGeneration/useCases/actions/handleStemSeparationPreview.ts`
- `src/modules/AiGeneration/handlers/aiMidi/handleStemSeparate.ts`

**Needed:** Pick one user contract. If "preview" means "show in the
panel without modifying the project", document it and add UI to
play back the cached buffers. If it's redundant, delete it and
route both UI buttons through `handleStemSeparate`.

### 12. `handleAiDenoiseClip` browser-path expander math is wrong

**Problem:** `useCases/actions/handleAiDenoiseClip.ts:46-51` applies
`output[i] = state * (ratio * (1 - strength) + (1 - ratio) * 0.05)`
where `ratio = abs / threshold`. At `abs = 0` the multiplier is
`0.05`; at `abs = threshold` it is `0`. That is not a downward
expander — the function attenuates **more** as the signal
approaches the threshold from below, then jumps to passthrough
once it exceeds. Audible discontinuities on every threshold
crossing.

**Representative files:**

- `src/modules/AiGeneration/useCases/actions/handleAiDenoiseClip.ts:32-58`

**Needed:** Replace with a real downward expander
(`output = state * (1 - (1 - ratio)^k)` for some `k > 1`) or a
soft-knee gate. Add a test with a known noise floor that asserts
output amplitude monotonically increases with input amplitude
(no threshold-crossing discontinuity).

### 13. Generation density and swing magic numbers undocumented

**Problem:** Per-style density multipliers (1.2, 1.5, 1.4, 1.3,
0.8 in melody; `density * 2` in drums) and the `swingAmount * 0.25
* 0.5` constant in `applySwing` are unexplained. At extremes
(`density = 1` for drums, `swing = 1`) the math produces
saturation or beats off-grid by amounts that don't correspond to
any standard swing percentage.

**Representative files:**

- `src/modules/AiGeneration/useCases/generateMelody/algorithm.ts:91,105,119,135,158`
- `src/modules/AiGeneration/useCases/generateDrumPattern/algorithm.ts:495,457-462`
- `src/modules/AiGeneration/useCases/generateChordProgression/algorithm.ts:225`

**Needed:** Document each multiplier in a comment that ties it to a
musical reference (e.g. "70% swing = 16th-note triplet feel"). Add
boundary tests at `density ∈ {0, 0.5, 1}` and `swing ∈ {0, 0.5,
1}` that assert sensible note counts and timing. Consider
replacing the per-style multipliers with a lookup table named
`STYLE_REST_PROBABILITY`.

### 14. `useCases/index.ts` re-exports leak across module boundary

**Problem:** The barrel re-exports the apply* functions from
`generate{Chord,Drum,Melody}`, plus `generateMidiVariations`. Their
parameter types (`Generate*Options`) are not type-only re-exported,
but the runtime functions are. AGENTS.md "Use-case types stay
private" applies. `compileDso.ts` (in `AiRuntime`) consumes
`models/GenerationStyles` directly — bypassing both the missing
barrel and the model-isolation rule.

**Representative files:**

- `src/modules/AiGeneration/useCases/index.ts:9-13`
- `src/modules/AiGeneration/models/GenerationStyles.ts:1-12`
- `src/modules/AiRuntime/useCases/dsoEditor/compileDso.ts:24-30`

**Needed:** Duplicate the type unions in `AiRuntime` per AGENTS.md
"Model isolation". Remove the `import type` from `compileDso.ts`.
Add a regression test that the two definitions remain in sync (or
accept they will diverge intentionally — the design rationale).

### 15. `createGenerationHandler` casts via `as` to bypass generics

**Problem:** `handlers/generation/createGenerationHandler.ts:46,69,92`
uses `(alpha as { payload: CommonGenerationPayload }).payload` and
`alpha as Extract<AppAction, { type: ActionType }>` because the
factory's generic parameter doesn't let TypeScript narrow on the
discriminant. Three `as` escapes in one factory.

**Representative files:**

- `src/modules/AiGeneration/handlers/generation/createGenerationHandler.ts:46,69,92`

**Needed:** Inline the three handlers (one per action) instead of
sharing a generic factory; the duplication is small and the type
narrowing falls into place. Or restructure the factory to take a
discriminated `actionType` plus payload-narrowing callbacks.

### 16. Tests use `as any` / `as unknown as` to construct fixtures

**Problem:** Multiple specs cast `null` to `any` for `value`
properties of fake stores, cast invalid action payloads to typed
union members for "fallback" tests, and use `vi.fn` without proper
typing. AGENTS.md "TypeScript — soundness" forbids these.

**Representative files:**

- `src/modules/AiGeneration/handlers/aiMidi/__tests__/handleStemSeparate.spec.ts:14`
- `src/modules/AiGeneration/handlers/generation/__tests__/createGenerationHandler.spec.ts:42,48,52,64,68`
- `src/modules/AiGeneration/handlers/generation/__tests__/handleGenerateChordProgression.spec.ts:67-70`
- `src/modules/AiGeneration/handlers/generation/__tests__/handleGenerateMelody.spec.ts:66-67`
- `src/modules/AiGeneration/useCases/grooveTemplate/operations/__tests__/applyGroove.spec.ts:8`
- `src/modules/AiGeneration/useCases/grooveTemplate/operations/__tests__/extractGroove.spec.ts:7`

**Needed:** Build typed fixtures (full `TrackStore`/`MidiStore`
shapes via factories), use `vi.mocked(fn)` with the original
types, and where a test needs to exercise the "fallback" branch,
make the action union accept the bad payload via the actual type
(declare the field as `string`) — fix at the source, not at the
call site.

### 17. Namespace import in test

**Problem:** `handlers/generation/__tests__/createGenerationHandler.spec.ts:4`
`import * as helpers from '../generationHandlerHelpers'`. AGENTS.md
"Imports: Never use namespace imports".

**Representative files:**

- `src/modules/AiGeneration/handlers/generation/__tests__/createGenerationHandler.spec.ts:4`

**Needed:** Replace with named imports of `resolveOrCreateMidiTrack`
and `getPlayheadBeat` (both already mocked).

### 18. `audioToMidi` payload contract advertised as free-form `string`

**Problem:** `Command/models/AppAction.ts:259` `mode?: string` —
both `handleAudioToMidi` (Arrangement) and `handleAudioToMidiAiMidi`
(AiGeneration orphan) coerce the value with different ternaries.
A typo lands silently in `'rhythm'`. The `mode` field has only two
valid values; the type should be a discriminated literal.

**Representative files:**

- `src/modules/Command/models/AppAction.ts:259`
- `src/modules/AiGeneration/handlers/aiMidi/handleAudioToMidiAiMidi.ts:13`
- `src/modules/Arrangement/handlers/clip/handleAudioToMidi.ts:10`

**Needed:** Change to `mode?: 'rhythm' | 'pitched'`. Drop the
ternary coercion in both handlers; let TypeScript enforce the
contract. (Cross-module — the change lives in `Command`.)

### 19. `handleAddNotes` ships the slow path (one store mutation per note)

**Problem:** `handlers/aiMidi/handleAddNotes.ts:11-17` calls
`addMidiNote(...)` in a `for` loop, which triggers one store
mutation per note (per the same comment in
`applyChordProgressionToTrack.ts:38-49`: "single-shot store write.
addMidiNote in a loop fires one midiStore.set per note, which
becomes visibly janky").

**Representative files:**

- `src/modules/AiGeneration/handlers/aiMidi/handleAddNotes.ts:11-17`

**Needed:** Use `batchAddMidiNotes` with the validated array. Same
fix in `handleCompleteMidi.ts:62-69` and
`handleGenerateBassline.ts:50-52`. Run a perf test with 64 notes.

### 20. `handleStemSeparationPreview` writes to cache without surfacing

**Problem:** `useCases/actions/handleStemSeparationPreview.ts:29-31`
sets `audioBufferCache` entries keyed `${clipId}-${name}` but does
not create tracks or clips. The buffers are orphaned. The user
sees a "success" task card but can play nothing.

**Representative files:**

- `src/modules/AiGeneration/useCases/actions/handleStemSeparationPreview.ts:11-37`

**Needed:** Either add a "preview UI" that plays the cached buffers
(consume `aiStore.tasks[].data.stems` to render a list with
play-back) or merge the function with `handleStemSeparate` so that
"separate stems" and "preview stems" produce the same artefacts.

### 21. `handleAiDenoiseClip` denoised buffer never reaches a clip

**Problem:** `useCases/actions/handleAiDenoiseClip.ts:28,57` writes
the denoised buffer to `audioBufferCache.set(\`${clipId}-denoised\`,
...)` — but no track/clip references that buffer ID. The user has
to manually wire the denoised version into a clip via some other
path.

**Representative files:**

- `src/modules/AiGeneration/useCases/actions/handleAiDenoiseClip.ts:25-57`

**Needed:** Either replace the original clip's `audioBufferId` with
the denoised key (with undo support that restores the original) or
create a sibling clip on a new track named "${clipName} (denoised)".
The current contract leaves the user without a UI affordance.

### 22. `handleStemSeparate` and friends do not register undo entries

**Problem:** `handlers/aiMidi/handleStemSeparate.ts`,
`handleGenerateAudioAiMidi.ts`, `handleGenerateBassline.ts`,
`handleAddNotes.ts`, `handleCompleteMidi.ts`, `handleVariationMidi.ts`
are all `undoable: true`, but only the action-use-case handlers
(`handleGenerateMidiPrompt`, `generateMidiVariations`) call
`pushUndoEntry` explicitly. The Command middleware likely diffs
stores at a higher level — but stem separation creates **tracks**
(an Arrangement-level mutation), not just MIDI notes. If the
middleware only diffs `midiStore`, undo won't roll back the tracks.

**Representative files:**

- `src/modules/AiGeneration/handlers/aiMidi/handleStemSeparate.ts`
- `src/modules/AiGeneration/handlers/aiMidi/handleGenerateAudioAiMidi.ts`
- `src/modules/AiGeneration/handlers/aiMidi/handleGenerateBassline.ts`
- `src/modules/AiGeneration/handlers/aiMidi/handleAddNotes.ts`
- `src/modules/AiGeneration/handlers/aiMidi/handleCompleteMidi.ts`
- `src/modules/AiGeneration/handlers/aiMidi/handleVariationMidi.ts`

**Needed:** Audit Command's diff middleware (out of scope for this
audit). If it does not snapshot `trackStore`, add explicit
`pushUndoEntry` calls in each handler — same pattern as
`handleGenerateMidiPrompt.ts:90-109`.

### 23. `aiStore` snapshot/set has a non-zero race window

**Problem:** `addTask`, `updateTask`, `removeTask`,
`cancelProcessingTask`, `toggleAiPanel` all call `getAiSnapshot()`
followed by `aiStore.set(...)`. Two interleaved calls can read the
same snapshot and clobber each other.

**Representative files:**

- `src/modules/AiGeneration/useCases/actions/addTask.ts:7-9`
- `src/modules/AiGeneration/useCases/actions/updateTask.ts:4-8`
- `src/modules/AiGeneration/useCases/actions/removeTask.ts:4-8`
- `src/modules/AiGeneration/useCases/actions/cancelProcessingTask.ts:12-21`
- `src/modules/AiGeneration/useCases/actions/toggleAiPanel.ts:4-6`
- `src/modules/AiGeneration/stores/aiStore.ts:34-39`

**Needed:** Replace the snapshot+mutate pattern with a transactional
update (`aiStore.update(state => ...)`), if the store API supports
it; otherwise serialise via a microtask queue. Add a test that
fires `Promise.all([addTask({}), addTask({})])` and asserts both
land.

### 24. Cross-module deep imports of `AudioEngine/stores`

**Problem:** Multiple handlers import `audioBufferCache` from
`#/modules/AudioEngine/stores`, a private path. AGENTS.md
"Cross-module imports MUST only target the destination module's
root `index.ts`".

**Representative files:**

- `src/modules/AiGeneration/handlers/aiMidi/handleStemSeparate.ts:5`
- `src/modules/AiGeneration/handlers/aiMidi/handleGenerateAudioAiMidi.ts:3`
- `src/modules/AiGeneration/useCases/actions/handleStemSeparationPreview.ts:3`
- `src/modules/AiGeneration/useCases/actions/handleAiDenoiseClip.ts:2`
- `src/modules/AiGeneration/useCases/actions/handleGenerateAudioFallback.ts:3`

**Needed:** Re-export `audioBufferCache` from `AudioEngine`'s root
`index.ts` (cross-module), and update the imports to
`#/modules/AudioEngine`. Confirm via `pnpm deps:validate`.

### 25. `handleAddNotes` test reaches into `MIDI/useCases/midiNoteCrud`

**Problem:** `handlers/aiMidi/__tests__/handleAddNotes.spec.ts:5,15`
imports `#/modules/MIDI/useCases/midiNoteCrud/addMidiNote`. Even
though it's a test, the path is a deep import past the destination
barrel.

**Representative files:**

- `src/modules/AiGeneration/handlers/aiMidi/__tests__/handleAddNotes.spec.ts:5,15`

**Needed:** Mock at the barrel boundary `#/modules/MIDI/useCases`
instead. Standardised mock paths reduce the blast radius of an
internal `MIDI` refactor.

### 26. `models/AiGeneratedMidiNote` is unused

**Problem:** Defined in `models/AiGeneratedMidiNote.ts:1-7` but no
file imports it. Every call site uses ad-hoc inline note types.

**Representative files:**

- `src/modules/AiGeneration/models/AiGeneratedMidiNote.ts`
- `src/modules/AiGeneration/useCases/llmMidiGeneration.ts:35-42`
- `src/modules/AiGeneration/useCases/generateMidiVariations.ts:31-44`
- `src/modules/AiGeneration/handlers/aiMidi/llmNoteHelpers.ts:9-11,29-31,55-60`

**Needed:** Adopt the shared type at every call site, or delete it.
If kept, also use it as the input to the (new) zod schema in
issue #8.

### 27. `events/index.ts` is a placeholder

**Problem:** Single comment line; nothing imports it.

**Representative files:**

- `src/modules/AiGeneration/events/index.ts`

**Needed:** Either define module events (e.g. `aiTaskStarted`,
`aiTaskCompleted`, `aiTaskFailed`, `aiPanelToggled`) and replace
the direct `aiStore` mutations with event-driven flow, or remove
the folder and the placeholder.

### 28. Dead test file `useCases/grooveTemplate/__tests__/operations.spec.ts`

**Problem:** A near-empty test that overlaps with
`useCases/grooveTemplate/operations/__tests__/extractGroove.spec.ts`.
The folder name suggests an `operations.ts` file that doesn't
exist — `applyGroove.ts` and `extractGroove.ts` are siblings under
`operations/`.

**Representative files:**

- `src/modules/AiGeneration/useCases/grooveTemplate/__tests__/operations.spec.ts`

**Needed:** Delete the dead spec or merge its single assertion
into the canonical `extractGroove.spec.ts`.

### 29. `parseMidiResponse` and friends accept NaN

**Problem:** `useCases/llmMidiGeneration.ts:158-169` filters
`typeof === 'number'` (which is `true` for NaN), then runs
`Math.round(NaN) → NaN`, `Math.max(min, NaN) → NaN`,
`Math.min(max, NaN) → NaN`. NaN-valued notes propagate silently to
`batchAddMidiNotes`. Same pattern in
`useCases/generateMidiVariations.ts:31-44` (`isVariationNoteArray`)
which doesn't even clamp.

**Representative files:**

- `src/modules/AiGeneration/useCases/llmMidiGeneration.ts:144-173`
- `src/modules/AiGeneration/useCases/generateMidiVariations.ts:31-44`
- `src/modules/AiGeneration/handlers/aiMidi/llmNoteHelpers.ts:54-60`

**Needed:** Add a `Number.isFinite(...)` filter alongside `typeof
=== 'number'`. Use a zod schema that rejects NaN by default. Add
a regression test with a fixture LLM response containing `NaN`,
`Infinity`, `null`, and out-of-range values.

### 30. `handleGenerateMidiPrompt` Tauri seed is hard-coded

**Problem:** `useCases/actions/handleGenerateMidiPrompt.ts:22-28`
seeds the native engine with `[60, 62, 64, 65]` regardless of
prompt, key, or scale. The browser path (`generateMidiViaLlm`)
does honour the prompt; the native path does not.

**Representative files:**

- `src/modules/AiGeneration/useCases/actions/handleGenerateMidiPrompt.ts:22-32`

**Needed:** Either remove the hard-coded seed and pass the prompt
through to `generateMidiAI` (if the Rust side accepts a prompt) or
generate the seed from the user's selected key/scale. Document
which is the source of truth.

### 31. `handleStemSeparate` `stems: ['all']` default is uncontracted

**Problem:** `handlers/aiMidi/handleStemSeparate.ts:12` defaults
`stems` to `['all']`. The action's `AppAction` type
(`Command/models/AppAction.ts:303-306`) declares `stems?: string[]`
without enumerating valid values. Garbage forwarded to
`separateStems()`.

**Representative files:**

- `src/modules/AiGeneration/handlers/aiMidi/handleStemSeparate.ts:12`
- `src/modules/Command/models/AppAction.ts:303-306`

**Needed:** Define a `StemName` union (`'vocals' | 'drums' |
'bass' | 'other' | 'all'`), use it in the action contract, and
narrow it in the handler. Cross-module change in `Command`.

### 32. `audioBufferToWav` lives in `handlers/aiMidi/`

**Problem:** Pure helper, no I/O, no orchestration — sits in
`handlers/aiMidi/audioBufferToWav.ts:5-48` next to handler files.
AGENTS.md "Services layer" definition fits this perfectly. Also
duplicates an `AudioEngine/useCases/audioBufferToWav` re-export
that some handlers use instead.

**Representative files:**

- `src/modules/AiGeneration/handlers/aiMidi/audioBufferToWav.ts`
- `src/modules/AiGeneration/handlers/aiMidi/handleStemSeparate.ts:6` (uses AudioEngine version)
- `src/modules/AiGeneration/useCases/actions/handleStemSeparationPreview.ts:4` (uses AudioEngine version)

**Needed:** Either delete the local copy and route everything
through `AudioEngine/useCases.audioBufferToWav`, or move the local
copy to `services/audioBufferToWav.ts` and stop importing from
AudioEngine in the two callers. Pick one source.

### 33. Magic numbers in groove math (`extractGroove ±0.5`, `velocity / 100`)

**Problem:** `useCases/grooveTemplate/operations/extractGroove.ts:43-44`
clamps to `±0.5` (mathematically guaranteed by the `Math.round`-based
step assignment — dead code). Velocity is normalised to `[0, ~1.27]`
by dividing by `100`, then `applyGroove` reverses it via `velScale =
1 + (velocity[i] - 1) * amount`. Hard-coded reference value (100)
is unmotivated; a velocity of 127 maps to factor 1.27, of 50 maps
to 0.5.

**Representative files:**

- `src/modules/AiGeneration/useCases/grooveTemplate/operations/extractGroove.ts:43-44`
- `src/modules/AiGeneration/useCases/grooveTemplate/operations/applyGroove.ts:38-39`

**Needed:** Remove the dead clamp. Document the velocity-100
reference (or replace with `velocity / 127`, the MIDI maximum).
Add a property test asserting `applyGroove(extractGroove(clip),
clip, 1.0)` is approximately the identity.

### 34. `handleCompleteMidi` backward branch silent failure

**Problem:** `handlers/aiMidi/handleCompleteMidi.ts:31-65`: if
`refTrack` or `refClip` cannot be found, the entire backward branch
is skipped with no error, no notification, just an `info` log
about "Completed N notes" — even though zero notes were inserted.

**Representative files:**

- `src/modules/AiGeneration/handlers/aiMidi/handleCompleteMidi.ts:31-65,72`

**Needed:** Surface a `notifyUser('Completion failed: source clip
not found', 'error')` and throw, matching the pattern in
`handleStemSeparate`. Add a test covering the missing-clip path.

### 35. Long-running operations have no abort signal

**Problem:** `cancelProcessingTask` (`useCases/actions/cancelProcessingTask.ts:5-9`)
admits the underlying network/inference request keeps running. There
is no `AbortController` plumbed through `streamCloudChatCompletion`,
`generateNativeCompletion`, `generateWebLlmCompletion`, `generateAudio`,
or `separateStems`. The user clicks "stop", the UI updates, the LLM
keeps streaming and burning tokens.

**Representative files:**

- `src/modules/AiGeneration/useCases/actions/cancelProcessingTask.ts:5-9`
- `src/modules/AiGeneration/useCases/llmMidiGeneration.ts:64-79`
- `src/modules/AiGeneration/useCases/generateMidiVariations.ts:103-128`
- `src/modules/AiGeneration/useCases/actions/handleStemSeparationPreview.ts:25-31`

**Needed:** Plumb an `AbortSignal` through every async LLM/audio
call. `cancelProcessingTask` should fire `controller.abort()` and
the handlers should map the abort to a clean `task.status =
'cancelled'`. Cross-module work in `AiRuntime`.

### 36. No accessibility / aria-live progress channel for AI work

**Problem:** Long-running operations emit `notifyUser` toasts and
`logger.info` only. Screen-reader users get no progress feedback
during multi-second LLM/inference work.

**Representative files:**

- `src/modules/AiGeneration/handlers/aiMidi/handleGenerateAudioAiMidi.ts:26-32,49-51`
- `src/modules/AiGeneration/handlers/aiMidi/handleStemSeparate.ts:13,55`
- `src/modules/AiGeneration/handlers/aiMidi/handleCompleteMidi.ts:72`
- `src/modules/AiGeneration/handlers/aiMidi/handleGenerateBassline.ts:53`

**Needed:** Once issue #4 (task-store coverage) is fixed, every
long-running handler will write to `aiStore.tasks`. Then ensure
the consumer (`AiTaskResultCard`) is rendered with `role="status"`
/ `aria-live="polite"`. Cross-module follow-up in `AiRuntime`.

### 37. `applyChordProgressionToTrack` `MIN_NOTE_DURATION = 0.25` magic

**Problem:** `useCases/generateChordProgression/applyToTrack.ts:36`
and `useCases/generateMelody/applyToTrack.ts:36` both clamp note
duration to `0.25` beats (a 16th note). Hard-coded constant; not a
named export; not aligned with the algorithm's actual minimum
durations (which differ per style).

**Representative files:**

- `src/modules/AiGeneration/useCases/generateChordProgression/applyToTrack.ts:36`
- `src/modules/AiGeneration/useCases/generateMelody/applyToTrack.ts:36`

**Needed:** Move to a shared constant `MIN_NOTE_DURATION_BEATS` in
a `services/` file. Document why 16th-note is the floor.

### 38. `compileDso.ts` cross-module type import bypasses model isolation

**Problem:** `compileDso.ts:24-30` does `import type { ... } from
'#/modules/AiGeneration/models/GenerationStyles'`. AGENTS.md "Model
isolation" forbids cross-module model imports. The 12-line comment
in the file justifies this as a "circular dependency workaround"
— but the correct fix per AGENTS.md is **duplication**, not a deep
import.

**Representative files:**

- `src/modules/AiRuntime/useCases/dsoEditor/compileDso.ts:18-30`
- `src/modules/AiGeneration/models/GenerationStyles.ts:1-12`

**Needed:** Duplicate the unions in
`AiRuntime/models/GenerationStyles.ts`. Drop the comment-justified
import. AGENTS.md "Duplication is intentional" — when the contract
changes, the consumer breaks at compile time.

---

## Open questions

- [ ] Is the "preview" / "command-bus" stem separation split
      intentional, or did one path predate the other? (Resolves #11.)
- [ ] Does the Command undo middleware diff `trackStore`, or only
      `midiStore`? (Resolves #22.)
- [ ] Are the orphan handlers (`handle{DetectKey,DetectTempo,StripSilence,AudioToMidi}AiMidi`)
      kept "for future reuse" or are they dead? (Resolves #2.)
- [ ] Should the Tauri MIDI generator (`generateMidiAI`) accept a
      prompt instead of a fixed seed? (Resolves #30.)
- [ ] Is `extractGroove`'s output meant to enter a project-wide
      groove library, or feed into a per-clip "remember last
      extraction" cache? (Resolves #4.)

---

## Risks

- **Silent style coercion (issue #3).** Picking `house` from a
  drum-style dropdown silently produces a `rock` pattern. The user
  will not understand why their selection didn't take.
- **Long-running operations look hung.** Half the AI handlers don't
  populate `aiStore` (issue #4). A user clicks "Generate audio"
  from the command palette and sees no feedback for 30+ seconds. A
  second click triggers a duplicate run.
- **Wrong-tempo audio clips (issue #7).** Generated audio lands at
  beat 0 with a duration computed at fixed 120 BPM. At 60/180 BPM
  the clip is the wrong length and at the wrong start.
- **No undo for tracks created by AI (issue #22).** Stem separation
  / audio generation / bassline generation create tracks. If undo
  doesn't snapshot them, `Cmd-Z` produces an unrecoverable mess.
- **NaN propagation from LLM responses (issue #29).** Malformed
  LLM JSON yields NaN-valued notes that are added to the project.
  Downstream code assumes finite values.
- **Cancellation is theatrical (issue #35).** Users believe they
  stopped a 30 s LLM stream; the API call keeps burning tokens.
- **`aiStore` race (issue #23).** Two concurrent task additions
  can clobber each other. Peer-to-peer collaboration would
  multiply the surface area.
- **Module surface is undefined (issue #1).** Without a root
  `index.ts`, every consumer reaches into private paths and the
  blast radius of any internal refactor is the entire repo.
- **Architectural drift across multiple files.** AGENTS.md
  violations (issues #14, #15, #16, #17, #18, #24, #38) have
  accumulated into a coherent pattern: type-soundness escapes are
  normal, deep cross-module imports are normal, action contracts
  use free-form `string`. Not addressing them normalises the
  pattern.

---

## Suggested approaches

- **Land issues #1 + #2 first.** Create `index.ts`; decide on the
  orphan handlers; migrate consumers. This unblocks the
  architectural-cleanup pass downstream.
- **Then issue #3** (style-set drift). Mechanical: derive the
  `VALID_*` sets from the type unions in `models/GenerationStyles.ts`.
- **Then issue #4 + #36** (task-store coverage + accessibility).
  Wrap every long-running handler in a `withAiTask` helper; surface
  progress through `aiStore.tasks` + `aria-live`.
- **Issues #7, #10, #12, #13, #20** are a "user-visible bug" pass
  — fix the audio clip math, the duplicate stem tracks, the
  expander formula, the magic-number multipliers, and the orphan
  preview.
- **Issues #8 + #29** (LLM JSON validation): introduce a single zod
  schema (or hand-rolled validator) shared by both `llmMidiGeneration`
  and `generateMidiVariations`. Drive it from
  `models/AiGeneratedMidiNote` (issue #26).
- **Issues #14, #15, #16, #17, #18, #24, #25, #28, #32, #38**
  (AGENTS.md compliance) as a follow-up sweep — small mechanical
  refactors, one PR.
- **Issues #5 + #6 + #33** (groove subsystem cleanup): pick one
  `extractGroove` implementation; surface results into a usable
  store; fix the velocity reference value. Property test the
  extract→apply round-trip.

---

## Recommendation

Start with **issue #3 (`VALID_*` style sets out of date)**. It is
mechanical, immediately user-visible, and unblocks confidence in
the other generation-side fixes. Land as a standalone commit with
a regression test. Then tackle **issue #1 (no root barrel)** and
**issue #2 (orphan handlers)** as a single architectural-cleanup
PR — this normalises the cross-module surface and removes the
duplicate-handler ambiguity. After those land, the next session
can choose between the **"correctness pass"** (issues #4, #7, #10,
#12, #13, #20, #22, #29) and the **"AGENTS.md compliance pass"**
(issues #14, #15, #16, #17, #18, #24, #25, #28, #32, #38). They
are independent.

---

## Resolved

_No issues resolved yet._
