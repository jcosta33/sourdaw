---
type: spec
id: SPEC-time-stretch-engine
title: In-house time-stretch engine — real repitch, phase-vocoder, and WSOLA for ElasticAudio
status: in-progress
owner: The Sourdaw team
sources:
    - ../elastic-audio/spec.md
    - 'Originating campaign material (agent workspace, not repo-owned): CHANGE-module-decomposition, CHANGE-elastic-audio-ownership-and-worker, CHANGE-shared-dsp-primitives, CHANGE-offline-rendering-freeze-flatten-bounce, SPEC-performance-contracts-and-profiling, AUDIT-time-stretch-pitch'
---

# In-house time-stretch engine — real repitch, phase-vocoder, and WSOLA for ElasticAudio

## Intent

Make ElasticAudio's warp controls audible through one canonical implementation
family owned by this project. Today the only thing that stretches audio is
`AudioBufferSourceNode.playbackRate` in
`src/modules/Transport/useCases/scheduling/scheduleAudioClips.ts`: pitch and
duration are coupled, and Arrangement's warp markers never reach playback
scheduling. This spec governs the in-house streaming time-stretch engine that
makes `phase-vocoder` and `wsola` real, and the marker-driven segment playback
that feeds it.

The shipping catalog is exactly the existing repitch behaviour plus in-house
Rust/WASM phase-vocoder and WSOLA engines. Élastique, Rubber Band, and every
other third-party licensed stretch backend are excluded from the product; they
are not licensed, not vendored, and must never be named on a user-facing
surface. The existing offline Crumbs phase-vocoder and WSOLA code
(`crates/daw-dsp/src/crumbs/warp/`) is the mandatory implementation seed, not a
second backend: it is adapted behind the shared streaming contract and retained
through differential goldens until every consumer has migrated.

This spec's scope intentionally supersedes the `no new time-stretch DSP`
non-goal in `.agents/specs/elastic-audio/spec.md`. `SPEC-elastic-audio` governs
transient detection, marker placement, quantize, and the Elastic tab; this spec
governs the engines those markers drive and the scheduling that reaches them.
The two AC sets are disjoint and share no numbering.

Status is `in-progress` because two prerequisite merges already land against
these criteria: the dormant `primitives::time_stretch` contract, ratio types,
and conformance fixtures (`crates/daw-dsp/src/primitives/time_stretch/`,
`crates/daw-dsp/tests/time_stretch_contract.rs`), and the honest-surface
collapse that reduced the algorithm family to `repitch | phase-vocoder | wsola`
and gated the two unimplemented modes behind `available: false`. No executor
exists yet.

## Non-goals

- Any third-party stretch backend — licensed, vendored, linked, or named.
- Polyphonic note-level pitch editing and pitch correction; those are the Knead
  domain and are governed separately.
- Transient detection, marker placement, quantize semantics, and the Elastic
  tab UI — owned by `SPEC-elastic-audio`.
- A second render-request compiler, graph reconstructor, or artifact lifecycle
  for offline export; this spec owns only the stretch adapter inside that graph.
- A second persistence, hydration, or detection-worker owner; this spec supplies
  the observable migration outcomes those plans consume.
- Native CPAL playback as a substitute proof for browser realtime topology.

## Constraints

### Ownership

| Owner          | Exclusive responsibility                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Arrangement    | Durable clip warp settings and markers, marker validation, undoable writes, intrinsic-tempo and source-frame evidence, project migration.                                                                          |
| ElasticAudio   | Editor orchestration, selector semantics, capability reporting, and the `ElasticAudio/engine/` time-stretch node, worklet, and WASM executor.                                                                      |
| Transport      | Live schedule-window construction, tempo-map conversion, loop and seek clipping, delivery of prepared segment commands.                                                                                            |
| AudioEngine    | The single live `AudioContext`, host graph reconciliation, schedule activation, latency application, runtime failure summaries. It hosts ElasticAudio's executor without owning a second algorithm implementation. |
| `daw-dsp`      | Allocation-free streaming repitch, phase-vocoder, and WSOLA primitives carrying no project or UI truth.                                                                                                            |
| AudioRendering | The compiled offline/export request, graph reconstruction, executor topology, and file lifecycle. Its stretch adapter consumes this spec's validated segment and DSP contract.                                     |

### Canonical measurements

- `playbackRateRatio = sourceSpanSeconds / outputSpanSeconds`. Ratios above 1.0
  produce shorter, higher-pitched repitch output; ratios below 1.0 produce
  longer, lower-pitched repitch output. Phase-vocoder and WSOLA adapters receive
  the reciprocal only where their internal API is expressed as
  `outputDuration / inputDuration`.
- Deterministic conformance fixtures are generated at 48 kHz and live in
  `crates/daw-dsp/testdata/time_stretch/` with checked-in expected hashes: a
  four-second mono 440 Hz tone and a four-second mono 880 Hz tone at -12 dBFS
  with 20 ms fades; a four-second stereo fixture carrying those tones on
  separate channels; and a four-second percussive fixture with 16 band-limited
  attacks at 250 ms intervals.
- Streaming tests use 128-frame render quanta. Duration is measured after
  declared latency and tail trimming. Fundamental frequency is measured with the
  existing pitch extractor over the steady-state middle 80%. RMS excludes the
  fades. Onset preservation requires 16 detected attacks with each normalized
  output attack within 5 ms of its expected scaled position.
- The browser stress workload is fixed at 48 kHz, 128-frame quanta, ten
  simultaneous looping stereo clips (four phase-vocoder, four WSOLA, two
  repitch), one ratio boundary per second, and 60 seconds per trial. The
  supported hardware, OS, and browser classes, the CPU and callback ceilings,
  the evidence-retention rules, and the variance and waiver policy come from the
  performance-contracts ledger (DG-001 through DG-005). Accepting those gates is
  a prerequisite to shipping worklet topology and to AC-013 verification; only
  dormant DSP contract and fixture work, and categorical no-allocation
  characterization, may precede them.

## Requirements

### AC-001 — One canonical ratio, one reciprocal

Every layer that computes or consumes a stretch ratio — project truth,
scheduling, DSP adapters, and offline rendering — must express it as
`sourceSpanSeconds / outputSpanSeconds`, and exactly one reciprocal may exist in
the whole path, applied at the adapter to a DSP API whose own parameter is an
inverse duration ratio. A second reciprocal, or a raw scalar bypassing the
canonical type, is a defect.

Verify with: `cargo test -p daw-dsp --test time_stretch_contract time_stretch_ratio_semantics && pnpm test:run src/modules/Transport/useCases/scheduling/__tests__/elasticRatioSemantics.spec.ts` — assert a canonical ratio of 2.0 halves output duration, that the inverse adapter is the only site producing `1 / ratio`, and that a round trip through the adapter returns the original ratio.

### AC-002 — The algorithm family is exactly three, and each runs its own executor

ElasticAudio must expose exactly `repitch`, `phase-vocoder`, and `wsola` as its
warp-algorithm family, and must route each choice to its own named executor:
`repitch` to playback-rate resampling, `phase-vocoder` to the in-house spectral
streaming engine, `wsola` to the in-house time-domain streaming engine. Playing
the canonical fixtures at ratios 0.5 and 2.0 must produce the duration and pitch
behaviour distinct to the selected executor — the three choices must not
collapse to one resample. No user-facing surface may name a third-party stretch
product. Which members of the family are _selectable_ at a given moment is
governed by AC-015; the family itself is closed at three.

Verify with: `pnpm test:run src/modules/ElasticAudio/presentations/views/__tests__/ElasticEditorPanel.spec.tsx src/modules/ElasticAudio/engine/__tests__/TimeStretchWorkletNode.spec.ts` — assert the family equals the three ids, that no rendered option label matches `/elastique|rubber ?band|complex/i`, and that each algorithm dispatches to a distinct executor whose output duration and measured f0 differ per algorithm at ratio 2.0.

### AC-003 — Legacy algorithm vocabularies migrate to the canonical set

Hydrating a legacy clip must resolve warp enablement and a saved algorithm
deterministically from the four coexisting vocabularies (`Clip.stretchMode`,
`WarpState.stretchMode`, the legacy nine-name `WarpAlgorithm` set, and the
editor's local stretch-mode names). Enablement resolves as: explicit `off`
disabled; explicit `repitch` or `timestretch` enabled; otherwise Arrangement
`WarpState.enabled`; otherwise Elastic clip-settings `enabled`; otherwise
disabled. Independently, exactly one canonical algorithm must be persisted even
while warping is disabled, choosing explicit `repitch` first, otherwise the
first present per-clip algorithm or `WarpState.stretchMode`, otherwise
`phase-vocoder` only for an explicit `timestretch`, otherwise `repitch`.
`rubber-band-rt`, `slice`, `texture`, and `beats` must map to `wsola`;
`elastique-pro`, `elastique-efficient`, `elastique-soloist`, `rubber-band-r3`,
`complex`, `complex-pro`, and `timestretch` must map to `phase-vocoder`;
`repitch` is preserved. The store-level `defaultAlgorithm` must never rewrite an
existing clip.

Verify with: `pnpm test:run src/modules/Arrangement/useCases/warp/__tests__/elasticWarpMigration.spec.ts` — table-drive every legacy name and every enablement combination, asserting the resolved `{ enabled, algorithm }` pair per row and that a clip carrying a legacy algorithm is unchanged by a differing `defaultAlgorithm`.

### AC-004 — The Crumbs seeds converge; they are not rewritten or prematurely deleted

Phase-vocoder and WSOLA must be delivered by adapting the existing offline
Crumbs implementations (`crates/daw-dsp/src/crumbs/warp/phase_vocoder.rs`,
`wsola.rs`) onto the shared streaming contract, not by a parallel from-scratch
implementation. The adapted engines must reproduce the accepted offline output
through differential goldens against the recorded characterization baseline, and
the removal of a duplicate Crumbs entry point must be gated on proving that
entry point has zero remaining callers.

Verify with: `cargo test -p daw-dsp --test time_stretch_contract time_stretch_crumbs_differential && cargo test -p daw-dsp --test time_stretch_contract time_stretch_private_callers_zero && cargo check --workspace` — assert adapted output matches the baseline within the recorded tolerance and that the caller-count assertion fails if a private warp entry point is still referenced.

### AC-005 — Phase-vocoder conformance

Running the canonical tonal and stereo fixtures through the in-house
phase-vocoder at ratios from 0.25 through 4.0 must keep mean fundamental-frequency
deviation below 1% of the input f0, emit only finite samples, preserve stereo
identity (each output channel derives from its own input channel; no channel is
a copy of the other and no downmix occurs), and stay within 3 dB RMS of the
input at ratio 1.0. The implementation must use an FFT, not the current O(N·K)
naive DFT.

Verify with: `cargo test -p daw-dsp --test time_stretch_contract time_stretch_phase_vocoder && pnpm test:run src/modules/ElasticAudio/engine/__tests__/timeStretchWasmBinding.spec.ts` — assert measured f0 deviation, `is_finite()` across all output samples, per-channel divergence on the stereo fixture, and the RMS bound at unity ratio.

### AC-006 — WSOLA conformance

Running the canonical stereo and 16-onset fixtures through in-house WSOLA at
ratios 0.5, 1.0, 1.5, and 2.0 must accept the whole 0.5-through-2.0 range
without error, emit only finite samples, preserve stereo identity under the same
definition as AC-005, and satisfy the canonical onset rule: 16 detected attacks,
each within 5 ms of its expected scaled position.

Verify with: `cargo test -p daw-dsp --test time_stretch_contract time_stretch_wsola && pnpm test:run src/modules/ElasticAudio/engine/__tests__/timeStretchWasmBinding.spec.ts` — assert the onset count and per-onset timing error on the percussive fixture, finiteness, and per-channel divergence.

### AC-007 — Repitch keeps its current observable behaviour

The `repitch` executor must preserve the observables of today's
`AudioBufferSourceNode.playbackRate` path: at a canonical playback-rate ratio
the output duration must equal `1 / playbackRateRatio` times the source
duration, and the measured fundamental frequency must equal the input f0 times
`playbackRateRatio`, both within 0.1%. Re-expressing repitch through the
streaming contract must not change these numbers.

Verify with: `pnpm test:run src/modules/Transport/useCases/scheduling/__tests__/repitchReference.spec.ts` — assert the duration and f0 relationships at ratios 0.5, 1.0, and 2.0 against the reference fixtures.

### AC-008 — Realtime stretch ships as a WASM AudioWorklet on the single live context

Custom realtime stretch must become audible as ElasticAudio Rust/WASM running in
an `AudioWorkletProcessor` on AudioEngine's single live `AudioContext`, under
`src/modules/ElasticAudio/engine/`. Module fetch, compile, instantiate,
algorithm selection, and all fixed allocation must complete on the slow path
before the first `process()` call. Neither a Worker pre-render path nor native
CPAL playback may be presented as evidence that this criterion is met.

Verify with: `pnpm test:run src/modules/ElasticAudio/engine/__tests__/TimeStretchWorkletNode.spec.ts && pnpm test:e2e --grep "ElasticAudio AudioWorklet WASM topology"` — assert the node registers against the existing shared context rather than constructing one, that instantiation resolves before the first render quantum, and that a warped clip is audible with no Worker render step in the call path.

### AC-009 — Streaming processor contract

A streaming engine must initialize, process 128-frame mono or stereo quanta,
change ratio, seek or loop discontinuously, drain, and fail under one contract:
all processing buffers preallocated; a ratio change applied at an exact frame
boundary rather than smeared across a quantum; a stable published
`latencyFrames`; `reset()` returning the processor to a deterministic state so
that identical input after reset yields identical output; a finite drain that
terminates; and typed failure values. `process()` must perform no fetch,
parsing, logging, handle publication, or graph rebuild.

Verify with: `cargo test -p daw-dsp --test time_stretch_contract time_stretch_streaming_contract && pnpm test:run src/modules/ElasticAudio/engine/__tests__/TimeStretchWorkletProcessor.spec.ts` — assert byte-identical output across two reset-separated runs, that a ratio change lands on the declared frame index, that drain terminates within a bounded quantum count, and that a forced failure returns a typed variant instead of throwing.

### AC-010 — Deterministic warp map

Arrangement must build a clip warp map that adds implicit clip-in and clip-out
anchors, sorts explicit markers by `originalBeat`, requires strictly increasing
finite in-range source and warped coordinates, and attaches the owning clip's
intrinsic-tempo and source-frame evidence. The map must be a pure function of
clip truth: building it must not consult Transport or AudioRendering tempo
projection, and building the same clip truth twice must produce an identical
map.

Verify with: `pnpm test:run src/modules/Arrangement/useCases/warp/__tests__/buildWarpMap.spec.ts` — assert the two implicit anchors are present at the clip bounds, that unsorted input produces sorted output, that the returned evidence matches the owning clip, and that two builds of the same input are deeply equal.

### AC-011 — Invalid markers fail closed with a typed repair state

Marker writes that are duplicate, crossed, non-finite, or out of clip range must
be rejected before any mutation occurs, leaving prior state untouched. Hydration
that discovers such a legacy map must disable marker warping for that clip,
publish a typed repair state, and fall back to repitch with that fallback
disclosed on the surface. Silent reordering, a crash, and continued emission of
stale warped audio are all failures of this criterion.

Verify with: `pnpm test:run src/modules/Arrangement/useCases/warp/__tests__/validateWarpMap.spec.ts src/modules/ElasticAudio/presentations/views/__tests__/ElasticEditorPanel.spec.tsx` — assert each invalid class returns a typed rejection and leaves the stored markers unchanged, and that the panel renders the disclosed fallback notice, routed from the repair state rather than always present.

### AC-012 — Segment scheduling and next-pass invalidation

Transport must schedule a warped clip by clipping the validated map to the
active look-ahead window, deriving source time from the clip's intrinsic
evidence, integrating destination time through the project tempo map, and
emitting per-segment commands carrying the canonical ratio and exact frame and
context times. Engine state must be preserved across ordinary segment
boundaries and reset only at a genuine discontinuity (seek, loop wrap, clip
restart). A marker edit must be consumed on the next scheduling pass without
rescheduling unrelated clips.

Verify with: `pnpm test:run src/modules/Transport/useCases/scheduling/__tests__/scheduleWarpSegments.spec.ts` — assert emitted segment source offsets and context times for a map crossing a loop boundary, that `reset` is requested at the loop wrap but not at an interior boundary, and that editing one clip's markers reissues commands for that clip only.

### AC-013 — Realtime safety and bounded seams

Under the canonical 60-second stress workload, on every browser class accepted
by the performance ledger, the processor must report zero render-thread
allocations, zero locks, zero blocking calls, zero dropped quanta, zero
non-finite samples, and zero graph reconstructions. At every ratio segment
boundary the sample-to-sample jump must be at most twice the corresponding
unwarped reference jump plus 0.01 full scale.

Verify with: `cargo test -p daw-dsp --test time_stretch_contract time_stretch_assert_no_alloc && pnpm test:e2e --grep "ElasticAudio 60 second worklet stress"` — assert the allocation counter is zero across the workload, and compute the boundary-jump bound against the unwarped reference render rather than asserting the render merely completed.

### AC-014 — Offline and export parity

When an offline or export render processes the same warped-clip project truth
used by realtime playback, its time-stretch adapter must consume the same
validated absolute segment map and the same shared engines, apply an equivalent
destination-tempo projection, match realtime per-segment source offsets and
total duration within one 128-frame quantum, and satisfy the same pitch, onset,
and finite-sample rules. It must not own a second render-request or graph
compiler. A warped clip that renders or exports at a different length or pitch
than it plays is a failure of this criterion.

Verify with: `pnpm test:run src/modules/AudioRendering/useCases/__tests__/timeStretchOfflineParity.spec.ts` — render the same warped fixture project live-path and offline-path, asserting per-segment source-offset equality within one quantum, total-duration equality within one quantum, and equal measured f0.

### AC-015 — Typed capability, no silent substitution, no fake choices

ElasticAudio must publish a typed capability state per algorithm describing
whether an executor for it actually runs. An algorithm whose executor does not
exist, or whose WASM module fails to load or faults during playback, must report
unavailable; it must not be presented to the user as a selectable, running
choice, and it must never be silently substituted by another algorithm. When
playback needs a fallback, that fallback must be repitch, explicitly disclosed
on the surface, and it must not overwrite the clip's saved algorithm — the saved
truth survives the fallback and is restored when the executor becomes available.
This criterion governs the current state, in which only `repitch` reports
available while `phase-vocoder` and `wsola` report unavailable pending the
engine, as well as the post-engine state.

Verify with: `pnpm test:run src/modules/ElasticAudio/useCases/audioWarping/__tests__/getAlgorithmInfo.spec.ts src/modules/ElasticAudio/presentations/views/__tests__/ElasticEditorPanel.spec.tsx src/modules/ElasticAudio/engine/__tests__/timeStretchFailureState.spec.ts` — assert that every algorithm reporting `available: false` is absent from the rendered option set while an available one is present, that a mid-playback executor fault yields a typed failure plus a disclosed repitch fallback, and that the clip's saved algorithm value is unchanged after that fallback.

### AC-016 — Dependency-gated activation order

"Activation" means any change that lets a non-repitch algorithm report
available, or routes audible playback through a streaming executor. Activation
must not merge until the stages below have merged ahead of it, in this order,
with each stage's verification command green:

1. Dormant DSP contract, ratio types, and conformance fixtures — no executor,
   no caller. (Delivered.)
2. AC-004, AC-005, AC-006 — seed convergence and algorithm conformance, still
   with zero production callers.
3. AC-009 and the categorical no-allocation half of AC-013 — streaming contract
   and realtime-safety characterization.
4. AC-003, AC-018, AC-019 — vocabulary, scalar, and intrinsic-evidence
   migration, landed before any warp map is built from legacy truth.
5. AC-010, AC-011, AC-017 — warp-map construction, validation, and
   scalar/marker composition.
6. AC-008 and AC-012 — worklet topology and segment scheduling, gated on
   accepted performance DG-001 through DG-005.
7. AC-002 — flipping availability and routing the user-visible selector.
8. AC-014 — offline and export parity, gated additionally on the offline
   rendering plan's own compiled-request and graph contract.

An implementing PR must record the prerequisite merge commits (or the ordered
commits within itself) in its description, and its CI graph must run the
migration, streaming-contract, and performance-manifest checks before any
executor-activation test.

Verify with: `pnpm test:run src/modules/ElasticAudio/useCases/audioWarping/__tests__/getAlgorithmInfo.spec.ts` — assert the standing invariant that no algorithm reports `available: true` unless a registered executor for it resolves, so that flipping availability ahead of its stage fails the suite; and confirm in review that the PR's dependency ledger and CI ordering match the stage list.

### AC-017 — Scalar and marker composition is single and deterministic

A clip's `stretchRatio` scalar must be applied exactly once, to define the
clip-wide implicit clip-in/clip-out output envelope. Explicit warp markers
subdivide that envelope; each segment ratio is derived directly from its
adjacent absolute source and output anchors and must not be multiplied by the
scalar a second time. Editing the scalar so that retained markers become
non-finite, crossed, or outside the new envelope must be rejected. With no
explicit markers, the two implicit anchors must reproduce exactly the uniform
scalar playback that exists today. Realtime and offline must rebuild identical
maps from the same truth.

Verify with: `pnpm test:run src/modules/Arrangement/useCases/warp/__tests__/stretchRatioMarkerComposition.spec.ts src/modules/Transport/useCases/scheduling/__tests__/scheduleWarpSegments.spec.ts src/modules/AudioRendering/useCases/__tests__/timeStretchOfflineParity.spec.ts` — assert that a clip with scalar 2.0 and one interior marker yields segment ratios derived from anchors (not `2.0 × segment`), that a marker-free clip's single segment ratio equals the scalar, and that an envelope-invalidating scalar edit is rejected with the prior markers intact.

### AC-018 — Legacy scalar precedence is total

Hydration must resolve one canonical stretch scalar from the two legacy owners.
A finite positive `Clip.stretchRatio` wins, because it is the durable value live
playback already uses. A finite positive ElasticAudio `clipSettings.stretchRatio`
is chosen only when the clip value is absent. When both are absent the value is
`1.0`. A present but invalid higher-precedence value must enter the typed
repair-disabled state rather than falling through to the lower-precedence owner.
The selected value must be persisted once as the canonical clip warp-state
scalar, after which both legacy fields are decode-only.

Verify with: `pnpm test:run src/modules/Arrangement/useCases/warp/__tests__/elasticWarpScalarMigration.spec.ts` — table-drive absent/equal/different/invalid/single-owner combinations asserting the resolved scalar per row, that an invalid clip-level value produces the repair state rather than the Elastic value, and that the canonical field is written exactly once.

### AC-019 — Marker maps without intrinsic evidence fail closed

Hydration that finds any legacy marker-bearing map — Arrangement or
ElasticAudio, with its legacy enabled flag either true or false — lacking finite
positive intrinsic-tempo and source-frame evidence must retain the legacy
coordinates only inside a disclosed read-only `missing-intrinsic-tempo` repair
payload. Canonical marker warping and Quantize must be forced disabled for that
clip with an audible repitch fallback. The coordinates must not be auto-promoted
by deriving tempo from the project tempo; recovery requires the user to discard
them or to re-detect after evidence is accepted.

Verify with: `pnpm test:run src/modules/Arrangement/useCases/warp/__tests__/elasticWarpMissingTempoMigration.spec.ts src/modules/ElasticAudio/presentations/views/__tests__/ElasticEditorPanel.spec.tsx` — assert that the repair payload carries the original coordinates and is not writable, that marker warping and Quantize are disabled for such a clip while an evidence-bearing clip leaves them enabled, and that no project-tempo-derived coordinate is produced.

## Known risks

- **The seeds are further from the contract than "adapt" suggests.** The Crumbs
  phase-vocoder is mono, allocates inside `process()`, and uses an O(N·K) naive
  DFT rather than an FFT; the Crumbs WSOLA is mono, allocates, and has no
  streaming or reset path. AC-005, AC-006, AC-009, and AC-013 cannot be met
  without substantial rework, and AC-004's differential goldens must be recorded
  before that rework starts or the baseline is lost.
- **The editor still ships a second stretch vocabulary.** The Elastic panel's
  local stretch-mode control offers `repitch | complex | texture | beats`, which
  are not the canonical family and include names inherited from the retired
  impostor set. AC-003 defines their migration targets; until it lands, that
  control remains a surface that implies distinctions the engine does not make.
- **Warp state is not durable.** Warp markers currently live in an in-memory map
  that is not CRDT-backed, so they are lost on save and reload and never sync to
  collaborators. AC-010 through AC-012 assume a durable, hydratable map, which
  means the persistence move must precede them or they verify against state that
  cannot survive a session.
- **Performance gates are external.** AC-013 and AC-016 depend on the
  performance-contracts ledger's DG-001 through DG-005 being accepted. If that
  ledger stalls, worklet topology is blocked by design and the engine cannot
  ship even with conformant DSP.
- **Offline currently ignores the scalar entirely.** The offline render path
  does not apply `stretchRatio` for audio clips, so AC-014 parity is a real
  behavioural change to export output, not only a new test.
- **`available: false` is load-bearing for honesty, not just UX.** The
  capability surface is what keeps the product from advertising engines it does
  not have. Any change that flips availability ahead of its AC-016 stage
  re-creates the misrepresentation this spec exists to close.

## Open questions

- [ ] (blocking AC-005/AC-006 scope) Is formant preservation in scope for this
      engine? `ClipWarpSettings.formantPreservation` already exists in the store
      and is documented as "consumed by the future in-house engine", and the
      golden standard treats formant-preserving pitch shift as table stakes, but
      no acceptance criterion here requires or measures it. Either an AC is
      added with a measurable spectral-envelope criterion, or the field is
      removed as an unbacked claim. It cannot stay unspecified and shipped.
- [ ] (blocking AC-007 interpretation) Is the current
      `AudioBufferSourceNode.playbackRate` resample the permanent `repitch`
      executor, or a placeholder to be re-expressed through the streaming
      contract? AC-007 preserves its observables either way, but the two answers
      imply different work and a different final topology for the `repitch`
      path.
- [ ] (non-blocking) Should the honest surface re-introduce quality, CPU-cost,
      and realtime metadata per algorithm once real executors exist? The
      previous unbacked `quality`/`cpuCost`/`realTime` fields were removed for
      being unmeasured claims. Re-adding them as _measured_ values is possible
      but is a new commitment with its own measurement contract.
- [ ] (non-blocking) What is the default algorithm for new clips after the
      engine lands? The store default is `repitch` today, which is correct while
      it is the only available mode, but no decision records what it becomes
      once `phase-vocoder` and `wsola` run.
- [ ] (non-blocking) Do granular and Texture-class stretch ship at all? A
      granular primitive exists in the Crumbs tree and the editor exposes
      `texture` and `beats` modes, but AC-003 migrates both names into `wsola`,
      which retires the distinction. Whether a genuine grain-based mode returns
      as a fourth family member is unanswered; if it does, AC-002's closed
      three-member family must be amended rather than quietly widened.
- [ ] (non-blocking) Who moves warp state onto the durable write path, and when?
      The in-memory map was a deliberate choice to break a module cycle. The
      sequencing between that ownership change and AC-010's map construction
      needs to be settled before AC-010 is implemented, or the cycle returns.

## Affected areas

- `src/modules/ElasticAudio/engine/` (new — worklet node, processor, WASM
  binding, failure state)
- `src/modules/ElasticAudio/stores/audioWarp.ts`
- `src/modules/ElasticAudio/useCases/audioWarping/getAlgorithmInfo.ts`
- `src/modules/ElasticAudio/presentations/views/ElasticEditorPanel.tsx`
- `src/modules/Arrangement/useCases/warp/` (warp-map build, validation,
  migration)
- `src/modules/Arrangement/models/WarpMarker.ts`, `models/Track.ts`
- `src/modules/Transport/useCases/scheduling/scheduleAudioClips.ts` and warp
  segment scheduling
- `src/modules/AudioRendering/useCases/` (offline stretch adapter)
- `crates/daw-dsp/src/primitives/time_stretch/`
- `crates/daw-dsp/src/crumbs/warp/`
- `crates/daw-dsp/tests/time_stretch_contract.rs`,
  `crates/daw-dsp/testdata/time_stretch/`

## Dropped from sources

- Third-party stretch backends (élastique, Rubber Band, and the `complex`
  family) — excluded from the product entirely, not deferred. The nine legacy
  names survive only as migration inputs in AC-003.
- The `no new time-stretch DSP` non-goal inherited from
  `.agents/specs/elastic-audio/spec.md` — superseded by the decision to build
  the in-house engine.
- Worker pre-render and native CPAL playback as realtime proof — explicitly
  rejected by AC-008 rather than deferred.
- A second offline render-request compiler or graph reconstructor — remains
  owned by the offline-rendering plan; only the stretch adapter is in scope
  here.
- Formant preservation — not dropped, but not accepted either; recorded as a
  blocking open question rather than silently assumed.
