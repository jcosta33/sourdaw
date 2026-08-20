---
type: spec
id: SPEC-offline-live-collapse
subject: make the bounce the same program as the monitor, and prove it per device
status: obsolete
repo: sourdaw
date: 2026-08-03
blocked_by: SPEC-project-durability, SPEC-render-parity-instrumentation
blocks: survey programme phase 5
governs: ADR 0015 (every guard here), ADR 0016 ruling 3 (no legacy path)
sources:
    - .agents/artifacts/sourdaw/SURVEY-ultracode-scope.md §2 Phase 2, theme A
    - .agents/decisions/0015-a-guard-must-be-able-to-fail.md
    - .agents/decisions/0016-ultracode-session-scope-and-standard.md
---

# Collapse the offline path into the live path — Phase 2

The offline renderer is not the live renderer running without a deadline. It is a reimplementation
that reconstructs the graph from a different set of inputs, applies state through a different path,
and disagrees with the monitor in twelve recorded ways.

Theme A's one change: **a single offline construction path plus a registry-driven parity census.**
This spec is that change, plus the eight per-device divergences the survey's Phase 2 names.

## Three things this spec has to confront before it lists anything

### 1. Phase 2's stated acceptance criterion does not reach Phase 2's subjects

The survey says "the null test is the per-item acceptance criterion." That is not true yet, for two
independent reasons, and only one is fixable inside this phase.

**The seam.** The Phase-1 null test landed at `ff8367ea4` (#966) and works — clean fixtures null
bit-identically and a committed broken fixture reds at −9.97 dBFS. But it builds **four of nineteen
builtin device types and no wasm device at all**. Live playback resolves a device through
`src/modules/AudioEngine/engine/wasmDeviceRegistry.ts`; offline render resolves the same device
through `src/modules/AudioEngine/repositories/deviceStrategy/nativeDspDeviceFactories.ts`. Twelve
device types cross between them. **Every device this phase fixes is on that side.**
`offlineDeviceCoverage.spec.ts` guards the structural half and states its own limit in its own
docblock — _"It does not prove the wasm module loads or renders audio."_ Nothing in the tree proves
the two arms produce the same audio. **AC-0 is that instrument. This spec owns it, sizes it, and
sequences it first.**

**Be precise about what the seam is, because overstating it produces a green run that proves
nothing.** The two tables are not two implementations. `nativeDspDeviceFactories.ts:3-14` imports
`createGlutenNode`, `createGrinderNode`, `createToasterNode` and the rest from `../../engine/*Node` —
the _same_ functions `wasmDeviceRegistry.ts` imports. Eleven of twelve types resolve to one
constructor; only `grand-boule` differs, and see AC-0's exemption. What genuinely differs is (a) the
**strip** each path builds around the device, and (b) the **state-application path**: live is
`TrackNode.addDevice` plus the live descriptor's own setup, offline is `createNativeDspStrategy`
replaying `parameterValues` plus `OFFLINE_DEVICE_HYDRATION`. Every defect in this spec lives in (b).
A defect inside the shared constructor — Grinder's rAF coalescing, its `setTargetAtTime` replay — is
**invisible** to a null between two legs that both run it, which is why AC-5 does not rely on one.
The landed Phase-1 harness already writes this distinction into its own header
(`liveOfflineNullTest.spec.ts:56-75`); carry it forward rather than claiming past it.

**Automation delivery.** AC-0 does not fix the second reason, and no instrument can. Live device-param
automation reaches a native worklet as `MessagePort` writes on the transport scheduler tick with an
exponential slew — `applyAutomation.ts:209-216` says so explicitly and says why: those params "cannot
be JS-scheduled a-rate here". Offline compiles the same lane into frame-addressed segments
(`compileAutomationEvents.ts`). Two mechanisms. The live one is driven by a wall-clock worker tick and
has no meaning inside an `OfflineAudioContext`, which is where AC-0's legs have to run to be
deterministic. **AC-4 therefore cannot be settled by a signal-level null, and says so, and states what
settles it instead.**

### 2. Five of these changes alter what an export sounds like

AC-1 (worklet preparation), AC-4 (offline automation), AC-5 (Grinder's state at frame 0), AC-6 (Knead
hydration), AC-7 (Toaster `engineParams`). Every one makes an existing project's bounce come out
different. Without an instrument that reaches the seam, the work cannot distinguish _fixed the
divergence_ from _moved it_ — a change that swaps one wrong render for another looks identical from
outside.

Two of the nine move the monitor, not only the bounce, and the PRs must say so:

- **AC-8 is a pure inversion.** Proof's dropped parameters under bypass make the _monitor_ wrong and
  leave the export correct by accident, because the offline node is built fresh from
  `parameterValues`. The fix moves live onto offline. Do not describe it as an export change.
- **AC-7 moves both legs.** Its evidence requires all three consumers of the Toaster projection to
  send `engineParams`, and one of the three is the live `audioDevice.loaded` subscriber — so a
  reopened project _plays_ differently as well as bouncing differently.

AC-2, AC-3, AC-9 and AC-10 change no audio on either leg.

**Ordering is mandatory, not advisory:**

| Stage | Contents                           | Why it is here                                                                                                                  |
| ----- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1     | AC-0, AC-2                         | The instrument, and the slot-pool leak that would otherwise cap the instrument's own run length                                 |
| 2     | AC-3                               | The census, rewritten and landed **before** any fix, with every incapable device/parameter pair entered as a reasoned exemption |
| 3     | AC-1, AC-4, AC-5, AC-6, AC-7, AC-8 | Each fix deletes its own census rows and produces its own per-device evidence                                                   |
| 4     | AC-9, AC-10                        | No audio change; may run in a parallel lane from stage 1                                                                        |

A stage-3 item landing before AC-3 is proven in aggregate rather than per device, which is exactly
what the survey put the census first to prevent.

### 3. Phase 3 is a precondition for part of the fixture set

**No fixture in this phase may contain a Yeast device, and none may depend on transport wall time.**
Yeast generators phase-lock to the first block they see, and the transport integrator loses wall time
on any stall over 100 ms. A null over those fixtures is red for reasons unrelated to what is being
fixed, and a nondeterministic instrument is worse than none. This is a constraint on the fixture set,
not a caveat, and AC-0 carries its own check for it (§AC-0, fixture guard) — Yeast is not in the
device population, so it cannot be an exemption row. It lifts when Phase 3 lands;
`yeast-live-offline-block-granularity-untested` is Phase 3's to close.

## Primary sources

Cited by interface and member, because the W3C REC (17 June 2021) and the current Editor's Draft
renumber. Re-check the section against the version read.

- **`AudioParam.setTargetAtTime(target, startTime, timeConstant)`** — a first-order exponential
  approach. The value **never reaches `target`**; each `timeConstant` covers 1−e⁻¹ ≈ 63.2% of the
  remaining distance. This is the whole of AC-5's head-of-render glide.
- **`AudioParam.setValueAtTime(value, startTime)`** — lands the value exactly, at the frame. The
  correct primitive for an initial state replay.
- **`BaseAudioContext.currentTime`** — starts at 0 and, on an `OfflineAudioContext`, does not advance
  until `startRendering()` runs. `setTargetAtTime(v, ctx.currentTime, 0.01)` during offline graph
  construction therefore places the glide at frame 0 of the render, not before it.
- **`AudioWorkletNode(context, name)`** — throws **`InvalidStateError`** when `name` is not a key in
  that `BaseAudioContext`'s _node name to parameter descriptor map_. The map is populated per context
  by `AudioWorklet.addModule()` (inherited from `Worklet`) resolving and `registerProcessor()` running
  in that context's `AudioWorkletGlobalScope`. **Registration is per-`BaseAudioContext`.** This
  establishes that every offline context needs its own registration — it does _not_ by itself argue
  for a shared construction path; AC-1 argues that on second-source-of-truth grounds instead.
- **`OfflineAudioContext.startRendering()`** — resolves once with the rendered `AudioBuffer`. There is
  **no abort**. The only control surface over an in-flight render is
  **`OfflineAudioContext.suspend(suspendTime)`**, whose time is quantised to a render-quantum boundary
  and which rejects `InvalidStateError` for a frame that is negative, at or before the current frame,
  at or beyond the total duration, or already scheduled. AC-10 rests on this: a `setTimeout` racing
  the promise cannot stop anything.
- **Render quantum** — 128 frames by default (`BaseAudioContext` render quantum size;
  `AudioContextOptions.renderSizeHint`). 128/48000 = 2.667 ms is the Phase-1 cost table's budget.
- **`AudioWorkletProcessor.parameterDescriptors` / `AudioParamDescriptor.automationRate: 'a-rate'`** —
  `process()` receives a `Float32Array` of render-quantum length, **or of length 1 when the value is
  constant across the block**. Any consumer must handle both.
- Chromium, for capability questions only:
  `third_party/blink/renderer/modules/webaudio/audio_render_capacity.cc`. Phase-1 AC-3 established
  that `AudioContext.renderCapacity` is exposed by no shipping build; do not re-probe it.

## Findings this spec acts on that carry `not independently verified`

Three theme-A findings carry the survey's `verifierNote: "not independently verified"`. The campaign
brief is explicit: re-derive before acting.

| Finding                                         | Where it lands                   | Status                                            |
| ----------------------------------------------- | -------------------------------- | ------------------------------------------------- |
| `grinder-offline-settargetattime-glide`         | AC-5, third defect               | **Must be re-derived first.** AC-5 blocks on it.  |
| `offline-render-arbitrary-wall-clock-budget`    | AC-10, in full                   | **Must be re-derived first.** AC-10 blocks on it. |
| `proofchamber-handrolled-block-rate-automation` | not acted on — see Ambiguities 2 | Re-derive before ruling it in or out.             |

Re-derivation means: reproduce the stated behaviour from the code on this branch and paste the
output. If one fails, report it — survey stop condition 10 counts failures across the 37.

## Outcome — first implementation pass

Branch `feat/offline-live-collapse-ultracode`, three commits. Full suite `--dir src` run twice,
exit 0 and exit 0, 3102 files / 19401 tests. `oxlint` 0, `eslint` 0, `typecheck` 0,
`typecheck:test` 0, `deps:validate` 0. No Rust touched, so `cargo` was not run.

| AC    | State                                  | Evidence                                                                                                                                                                                                                                                                                                                                              |
| ----- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-0  | **Not built.**                         | The browser-hosted per-device null harness. Sized below; nothing in this pass depends on it, and no claim here rests on it.                                                                                                                                                                                                                           |
| AC-1  | **Landed.**                            | `prepareOfflineContext.ts` shared by all three render paths; `__tests__/offlineContextPreparation.spec.ts` census. Mutations verified: dropping the freeze call reds the census; disabling one prepare reds the registry count.                                                                                                                       |
| AC-2  | **Landed.**                            | `destroyOfflineDeviceStrategies.ts` in a `finally` on all three paths; `TelemetryAllocator.occupiedSlotCount()` and the `releaseSlot` membership check. Mutation verified: moving teardown onto the success path reds the failure and cancellation cases and leaves the success case green. Browser leg (evidence 3) belongs to AC-0 and is not done. |
| AC-3  | **STOP CONDITION 3 FIRED. Not built.** | Measured before writing any census: 20 asserted verdicts against **285** reasoned exemption rows, 14:1. See below.                                                                                                                                                                                                                                    |
| AC-4  | **Not started.** Blocked by AC-3.      | The census is what makes each fix provable per device; it is the spec's own mandated ordering.                                                                                                                                                                                                                                                        |
| AC-5  | **Not started.**                       | Both findings re-derived and confirmed (below). Defect 1's proof is AC-0's null.                                                                                                                                                                                                                                                                      |
| AC-6  | **Not started.**                       | Its time-source design question is untouched.                                                                                                                                                                                                                                                                                                         |
| AC-7  | **Not started.**                       | Its evidence 3 is an AC-0 null.                                                                                                                                                                                                                                                                                                                       |
| AC-8  | **Landed.**                            | `ProofNode.setParam` forwards regardless of bypass; `ProofNodeCreate.spec.ts`. Mutation verified: restoring `!bypassed` reds two cases. The AC-0 null half is not done.                                                                                                                                                                               |
| AC-9  | **Landed.**                            | Freeze path calls `clampRenderFrameCount`; warning asserted, frame count deliberately not, per the AC's own instruction. Mutation verified with AC-1's.                                                                                                                                                                                               |
| AC-10 | **Landed.**                            | Monotonic `performance.now()` no-progress watchdog replaces the total-elapsed `Date.now()` budget and the racing `setTimeout`. Mutations verified: restoring the elapsed budget reds evidences 1 and 3; removing the no-progress check reds evidence 2 and the wedge case.                                                                            |

### Re-derivations — both findings survive

Required before AC-5 and AC-10 could be built. Both confirmed on this branch.

- **`grinder-offline-settargetattime-glide` — CONFIRMED.** `GrinderNode.ts:168` replays initial state
  with `param.setTargetAtTime(value, ctx.currentTime, 0.01)`. On an `OfflineAudioContext`
  `currentTime` is 0 until `startRendering()`, so the glide starts at frame 0. The rAF half is also
  confirmed: `GrinderNode.ts:114` `const canCoalesce = typeof requestAnimationFrame === 'function'`,
  with the "No rAF (offline render / non-DOM host)" escape hatch at `:126` unreachable on a main
  thread.
- **`offline-render-arbitrary-wall-clock-budget` — CONFIRMED.** Enforced twice over one render:
  `renderInSegments.ts:222` `Date.now() - startedAt >= timeoutMs`, and `renderWithTimeout.ts:13-15`'s
  `setTimeout`, whose own header (`:4-9`) states it "does NOT cancel the render itself".

Survey stop condition 10 counts zero failures from this phase's two.

### Stop condition 3 — the census population is wrong, and by an order of magnitude

Measured by enumerating `NATIVE_DSP_DEVICE_FACTORIES` × each factory's `getBuiltinPlugins()`
descriptor's `automatable: true` parameters, and intersecting with the three nodes that declare
`acceptsScheduledParam`:

```
FACTORIES=13   VERDICTS=20   EXEMPTIONS=285
fermenter:      automatable=105  covered=15  gap=90
toaster:        automatable=4    covered=3   gap=1
levain:         automatable=4    covered=0   gap=4
builtin-crumbs: automatable=10   covered=0   gap=10
grand-boule:    automatable=3    covered=0   gap=3
gluten:         automatable=43   covered=0   gap=43
crust:          automatable=13   covered=0   gap=13
bacteria:       automatable=62   covered=0   gap=62
grinder:        automatable=41   covered=0   gap=41
proof:          automatable=3    covered=0   gap=3
dutch-oven:     automatable=17   covered=2   gap=15
native-scoring: automatable=0    covered=0   gap=0
knead:          NO DESCRIPTOR
```

The 20 is independently confirmed by counting the three maps directly:
`FERMENTER_AUTOMATION_PARAM_IDS` 15 + `TOASTER_AUTOMATION_PARAM_IDS` 3 +
`PROOF_CHAMBER_AUTOMATION_PARAM_IDS` 2 = 20.

**This is the spec's own stop condition 3, and it fires by 14:1.** The spec anticipated "several
dozen pairs"; the real figure is 285. Writing 285 reasoned rows would produce exactly the artefact
the stop condition names — an allow-list by another name — so AC-3 was not built.

Three further things the measurement establishes, none of which the spec anticipated:

1. **The population is 13, not 12.** AC-0's enumeration omits `crust`, which is in
   `NATIVE_DSP_DEVICE_FACTORIES`. Any AC-0 population list must be re-derived from the registry.
2. **The gaps are two structurally different classes, not one.** 265 pairs across 9 devices are
   _device-level_ — the node supplies no `scheduleParam` at all, so every automatable parameter is
   dead, and one reason covers the whole device. The other ~106 are _parameter-level_ on the three
   devices the census calls capable: Fermenter covers 15 of 105, ProofChamber 2 of 17, Toaster 3 of 4.
   A census at device granularity is 13 rows with 3 capable; the per-parameter gaps inside a capable
   device are a **separate, unfiled finding** — Fermenter's 90 dead automatable parameters are not
   named anywhere in the survey and are not AC-4's subject.
3. **Knead has no plugin descriptor**, which corroborates the spec's own note that it is absent from
   the automation population.

**Recommended resolution, for the re-spec rather than decided here:** the census population should be
the _device_ (verdict `full | partial | none`, 13 rows), with the parameter-level shortfall inside a
capable device filed as its own finding and its own AC. That keeps the enumeration registry-driven,
keeps every row a verdict rather than an exemption, and does not bury a 90-parameter gap on the
flagship synth inside a table nobody will read.

### AC-0, sized

Not built, and it is the largest item in the spec. What it needs, none of which exists today: a
Playwright-hosted page under cross-origin isolation (`telemetryAllocator.ts`'s `ensureInit` calls
`new SharedArrayBuffer` with no availability guard, so an unisolated page throws); `pnpm wasm:all`
artefacts for 13 device types; both the live `TrackNode` builder and `createOfflineTrackStrip` driven
on the same `OfflineAudioContext`; `TrackNode` and `wasmDeviceRegistry` widened from `AudioContext`
to `BaseAudioContext`; a re-derived exit-2 vocabulary that excludes load average; per-device
occupancy reporting against AC-2's new `occupiedSlotCount()`; and a committed broken fixture that
breaks at the state-application path on a wasm device. It is a phase of its own and should be specced
and sized as one rather than carried as an item inside this list.

## Acceptance criteria

Each states an observable behaviour, the evidence that settles it, and the mutation that reds its
guard. ADR 0015 governs all of them: a guard for which no mutation exists is decoration — delete it
and say so.

### AC-0 — A null test that reaches the wasm registry seam, in a real browser

Sequenced first because the five sound-changing ACs are unprovable without it. If the Phase-1 lane
lands an equivalent instrument as its AC-7, this spec cites that work; absent that, this spec builds
it. It is the largest single item here and must be sized as such.

**Population, enumerated from the registry, not from a list.** The union of:

- the twelve types in `NATIVE_DSP_DEVICE_FACTORIES` — `fermenter`, `toaster`, `levain`,
  `builtin-crumbs`, `grand-boule`, `gluten`, `bacteria`, `grinder`, `proof`, `dutch-oven`,
  `native-scoring`, `knead`; **and**
- the builtin Web Audio device types whose offline construction is prepared out of band — today the
  sidechain compressor and the bitcrusher, which AC-1 is entirely about and which are not in
  `NATIVE_DSP_DEVICE_FACTORIES`.

An id that gains a wasm implementation, or an out-of-band prepare, appears without anyone editing the
harness.

**Shape.** A browser-hosted harness, not a Vitest spec. Reuse `scripts/measureRenderDeadline.ts`'s
plumbing rather than inventing a third: the Playwright pattern, the platform-support probe, per-leg
reporting, and the exit-code vocabulary — `0` measured-green, `1` measured-red, `2` not-measured.

**Exit 2 must be re-derived for this harness, not copied.** In `measureRenderDeadline.ts` exit 2 is
gated on machine load, and that is correct there because it measures real-time deadline misses. An
offline null is a deterministic computation whose residual does not depend on load average, so
carrying that gate over creates a suppressible red: a genuine seam divergence reported as
"not measured" because the box was busy. Enumerate the conditions that legitimately produce exit 2
here — module fetch failure, `SharedArrayBuffer` unavailable, a device that never reached ready,
`crossOriginIsolated === false` — and **exclude load average explicitly**.

Per device: drive an identical parameter set and note sequence through the graph the **live** builder
constructs and through the graph `createOfflineTrackStrip` constructs, subtract, report the residual
peak in dBFS. Budget as Phase-1 AC-1: **≤ −90 dBFS**, and **anything above −60 dBFS is a defect, not
tolerance**. Do not widen it, do not add a per-device tolerance table, do not narrow the measured
region.

**Both legs run inside an `OfflineAudioContext`** — the live _builder_ on an offline _context_, which
is what makes the comparison deterministic. **State the limit that buys, and do not exceed it:** it
proves the two _strips_ and the two _state-application paths_ agree. It does not prove the two device
registries are independent implementations (they are not), it does not see a defect inside a shared
node constructor, and it says nothing about the realtime scheduler.

**Typing is part of the work.** `TrackNode` and `wasmDeviceRegistry` declare `context: AudioContext`,
which an `OfflineAudioContext` does not satisfy. Widen both to `BaseAudioContext` — the repo bans
`as unknown as T`, and no `AudioContext`-only member is used inside either. If widening turns out to
break something, that is a finding, not a place for a cast.

**Evidence:** the harness, its per-device report, and a committed deliberately-broken fixture that
breaks **at the state-application path** — a device whose offline hydration or parameter replay is
disabled while the live path keeps it. Phase-1 AC-1's break (the offline registry ceasing to apply
`device.parameterValues`) is the right _class_ but was injected at a place the wasm devices never
reach; the new one must land on a wasm device. Mutation: restoring the break to correctness must
return the harness to green in the same run.

**Guards.**

- **Occupancy before difference.** Both legs proven sounding, per leg and per device, before their
  difference means anything: a null of silence against silence is a perfect null. Phase-1 AC-1's
  presence pin (`signalPeakDbfs > −40`) is the model; Phase-1 AC-2 found Grand Boule and Toaster
  clearing an RMS-only check that one sounding voice in sixty-four would satisfy.
- **Exemptions assert in both directions,** with a reason each. `offlineDeviceCoverage.spec.ts:81-83`
  is the model. For each exemption, state what the reachability half actually tests — an exemption
  whose reverse check cannot be written is an exemption whose reason is wrong.
- **`grand-boule` is exempt, and the reason is not the one the transport docs suggest.**
  `GrandBouleNode.ts:480` selects its transport by context type —
  `ctx instanceof OfflineAudioContext` — so running the _live builder_ on an _offline context_ yields
  `createInlineWorkletTransport`, the offline transport. The harness cannot obtain the worker-ring leg
  at all; a null here would compare one implementation against itself and be green by construction,
  which is ADR 0015 rule 1. Record that as the reason. The reachability half of this row is a check on
  `GrandBouleNode.ts:480` itself: if transport selection stops being context-typed, the row reds.
  Closing this properly needs a different instrument and is not this phase.
- **Fixture guard, separate from the exemption table.** No fixture declares a Yeast device and no
  fixture depends on transport wall time. Assert it over the fixture table, the way
  `liveOfflineNullTest.spec.ts:100-106` states the same rule for its own fixtures. Mutation: adding a
  Yeast device to a fixture reds it.

**Depends on AC-2.** Every metered native node allocates from the 64-slot telemetry pool at
construction and only `destroy()` returns a slot. Twelve devices × two legs × several fixtures
exhausts the pool inside one page, after which `allocateSlot()` returns null and meters read zero with
a `logger.warn`. The harness must land after AC-2 or **fail loudly** on pool exhaustion; it may not
report a null taken on a run whose telemetry silently degraded. Note also
`telemetryAllocator.ts:231-239` constructs a `SharedArrayBuffer` with no availability guard, so a
harness page without cross-origin isolation throws — that is an exit-2 condition, enumerated above.

**Header (Phase-1 AC-6).** Its null threshold and why that number; which devices it reaches and which
it does not, derived from the registry; per exemption, what would make it reachable; and the limit
paragraph above, in full.

### AC-1 — One offline construction path, and no silent substitution behind it

**State the gap accurately.** The device factories _do_ register their own worklet modules on whatever
context they are handed — every wasm node calls `ensureWorkletRegistered(ctx, url)`
(`workletInitShared.ts`), which is per-context and cached. The two modules that are **not** registered
that way are the sidechain compressor's key path and `bitcrusher-rate-processor`: they are prepared out
of band by `prepareOfflineSidechainCompressor` and `prepareOfflineBitcrusherRate`, called only from
`src/modules/AudioEngine/useCases/renderOffline.ts:136/155` (the mixdown) and
`exportStems.ts:254/273`. `renderTrackSubgraphOffline.ts:146` — the freeze and bounce path reached
through `src/modules/Arrangement/useCases/freezeBounce/renderOffline.ts:125`, which is a _different_
file of the same name and constructs no context of its own — builds a bare
`new OfflineAudioContext(2, frameCount, sampleRate)` and calls neither.

Observable behaviour: **freezing a track that carries a sidechain compressor bakes the ducking, and
freezing a bitcrusher bakes the rate decimation.** Today freeze bakes a self-keyed
`DynamicsCompressorNode` and a shaper with no decimator, and both degradations are silent because
`onWarning` lives on the `prepared` record that was never created.

Three context constructors, one clamp, one prepare, one teardown: that is the second-source-of-truth
argument for `prepareOfflineContext`, and it is the argument to make. The three call it; none
re-implements any part of it.

**Evidence.**

1. A census over the out-of-band prepares: for each device type whose offline construction depends on
   a module no factory registers, assert every offline context constructor runs that prepare.
   Population from the prepare functions' own registry of target device types; expectation from the
   set of context constructors, found by a pinned search over `new OfflineAudioContext` in `src/`
   excluding specs — **two independently sourced values**, so the check is not a table against
   itself. Mutation: adding a fourth context constructor that skips `prepareOfflineContext` reds it;
   so does removing one prepare from `prepareOfflineContext`.
2. AC-0 nulls a freeze of a sidechain-compressor track and a bitcrusher track against the live leg.
   Both device types are in AC-0's population for exactly this reason. Mutation: reverting
   `renderTrackSubgraphOffline` to a bare context reds it at a residual this AC's PR quotes.
3. Any degrade path that survives — a real browser can fail `addModule` — reaches `onWarning`, and the
   render reports the degradation to its caller. Mutation: swallowing the warning reds a spec that
   forces `addModule` to reject and asserts the warning arrives.

Whether the fallbacks are deleted outright or kept behind a reported warning is Ambiguity 4; this AC
requires only that no degradation is silent.

### AC-2 — An offline render owns the lifetime of what it builds

Every device strategy an offline render constructs is destroyed when the render resolves, on the
success path and on the failure and cancellation paths. `AudioDeviceStrategy.destroy()` has no
production caller under `useCases/offlineRender/`, `renderOffline.ts` or `exportStems.ts`, while the
live path already does it at `TrackNode.ts:586/767/881`.

Observable behaviour: **N sequential exports of a project with metered devices leave the telemetry
pool at its starting occupancy, and live meters added afterwards still read.** The pool is 64 slots
(`telemetryAllocator.ts:33`), every metered native node takes one at construction, the only reclaim is
`releaseSlot` from `destroy()`, and a garbage-collected `OfflineAudioContext` returns nothing — so the
leak is permanent for the page session and kills gain-reduction, LUFS, tuner and gate meters for every
device added afterwards.

**This AC adds public surface, and names it.** `TelemetryAllocator` exposes only `allocateSlot` and
`releaseSlot`; `freeSlots` is private and there is no accessor, so "occupancy returned to baseline" is
not observable today. Add one — `occupiedSlotCount()` or equivalent — as part of this AC, and say so
in the PR.

**Evidence, and the environment each leg runs in.**

1. **Unit, Vitest.** Against `TelemetryAllocator` directly: allocate to exhaustion, release all,
   assert `occupiedSlotCount()` is back to zero and the next `allocateSlot()` succeeds. Mutation:
   removing the release reds it.
2. **Integration, Vitest.** Render through the offline strip builder with a stubbed
   `AudioWorkletNode`, asserting `destroy()` is called on every constructed strategy on the success
   path, the failure path and the cancellation path. Mutation: removing the teardown loop reds all
   three.
3. **Browser, in AC-0's harness.** Sixty-five real allocations need real wasm nodes, which no Vitest
   spec can build. Report occupancy after the harness's own device sweep. Mutation: removing the
   teardown makes the sweep exhaust the pool and the harness must red on it rather than warn.

**`releaseSlot` hardening is part of this change, not an extra.** It pushes the index back with no
membership check, so a double release hands two devices one slot; adding a second `destroy()` caller
is what makes double release reachable. Evidence: a spec that releases the same byte offset twice and
asserts the second is refused. Mutation: removing the membership check reds it.

### AC-3 — The offline-automation census, rewritten, and landed before any fix

`offlineAutomationCoverage.spec.ts` is theme E's exhibit and ADR 0015's opening example: its native
arm's **selector is the same three-entry allow-list whose regrowth it claims to prevent**
(`[isFermenterDevice, isToasterDevice, isProofChamberDevice]`), everything else hits `continue`, and
the closing `expect(coveredFamilies).toBeGreaterThan(1)` is satisfied by the three that already work.
Its docblock claims "the allow-list class cannot silently regrow"; the native arm does not deliver
that. Its Web Audio and Faust arms do assert real verdicts and are kept.

Rewritten, the census must satisfy ADR 0015 rule 2 in full:

- **(i) Population from the registry production uses.** Every entry in `NATIVE_DSP_DEVICE_FACTORIES`
  crossed with every `automatable: true` parameter its `getBuiltinPlugins()` descriptor declares.
- **(ii) A verdict per pair.** `resolveOfflineAutomation(parameterId)` returns a non-null binding, or
  the pair appears in the exemption table.
- **(iii) A named, reason-bearing exemption table**, in the shape `nodelessOfflineDeviceTypes.ts` and
  `unrenderableCatalogDeviceTypes.ts` already use.
- **(iv) A deliberately broken fixture proving it can go red** — see the mutation set below, which is
  four mutations, not one.

**The exemption cohort is much larger than the four devices this phase fixes, and that must be faced
rather than designed around.** Only `FermenterNode`, `ToasterNode` and `ProofChamberNode` declare
`scheduleParam` at all, and ProofChamber's covers two of its automatable parameters. The full cross
product therefore also exempts pre-existing gaps on **Levain, Crumbs, Grand Boule, the remainder of
Toaster's parameters, and the remainder of ProofChamber's** — several dozen pairs that no AC here
closes. Each carries a reason and an owner and stays. Writing them down is the point: it converts
"shipped but inert" into a review decision, which is theme B's whole argument. **If the reasoned rows
outnumber the asserted verdicts, stop and report** — the table has become an allow-list by another
name, and the census needs a different population rather than a longer exemption list.

**Gluten, Bacteria, Grinder and Proof enter the table at this stage** with the reason "offline
automation not wired — AC-4", and **each AC-4 fix deletes its own rows**. That is the mechanism that
makes each fix proven per device rather than in aggregate, and it is why this AC precedes them.

**Mutations, all four required.** The first three exercise the verdict and the table; the fourth
exercises the enumeration, which is the half that historically went blind (ADR 0015, Context: "A
device-write census went blind and spent 41 commits comparing an empty extraction against a
four-element expectation").

1. Deleting an exemption row while the device is still incapable must red — the census sees the pair.
2. Making an exempt pair capable without deleting its row must red — the exemption cannot rot.
3. The census is a function over an injected population; called with a synthetic factory that declares
   automatable params and supplies no `scheduleParam`, it must report it.
4. **With the production registry**, adding a synthetic incapable entry to `NATIVE_DSP_DEVICE_FACTORIES`
   itself must red, and the enumerated population's cardinality is pinned against
   `NATIVE_DSP_DEVICE_FACTORIES.length` sourced directly, not derived from the census's own walk.
   Mutation 3 alone proves only that the verdict function works on whatever it is handed.

**Knead is deliberately absent from the automation population.** It has no plugin descriptor, so it
declares no automatable parameter and no lane exists to drop. The survey's finding named five effects;
its verifier corrected it to four. Do not re-add Knead here — its offline gap is AC-6.

### AC-4 — A lane drawn on Gluten, Bacteria, Grinder or Proof renders as a moving value

`NativeDspDeviceStrategy.resolveOfflineAutomation` returns `null` unless the node supplies both
`scheduleParam` and `acceptsScheduledParam`, which only Fermenter, Toaster and ProofChamber do. Gluten,
Bacteria, Grinder and Proof expose `setParam` only, `automationScheduling.ts:162-164` `continue`s, and
the device renders at a frozen static value for the whole bounce with the export reporting success.
Every one of their descriptor parameters is `automatable: true`, so the lane picker offers all of
them. This is the largest single live/offline divergence in the effects area.

**This AC cannot be settled by a signal-level null**, for the reason in §1. Saying "the null test is
the criterion" here would be an acceptance criterion that cannot fail for the wrong reason — green
because the comparison was never made.

**Scope ruling, made here rather than deferred:** collapsing the two delivery mechanisms onto a-rate
`parameterDescriptors` is **out of this phase**. The survey's Phase 2 does not name it, it is an
L-shaped migration shared with Ambiguities 2 and 3, and Phase 5 is where "one implementation per
transform" lives. AC-4 therefore ships a bounded divergence, and evidence 2 is what bounds it. If the
bound cannot be met, that is a stop condition, not a scope expansion.

**What settles it, all four:**

1. **The census verdict** (AC-3): each of the four moves out of the exemption table. Mutation:
   reverting one node's `acceptsScheduledParam` reds its rows.
2. **A value-stream conformance test, driven at the live grain, not a constant.** Drive one lane
   through the live applier and capture its `(time, value)` writes to the device; compare against
   `compileAutomationEvents` output for the same lane sampled at the same times, within a tolerance
   the PR states and justifies. **Run it at more than one grain.** Live reads
   `state.scheduleGrainMs` from transport state (`startPlayheadScheduler.ts:152`,
   `TransportState.ts:14/38`, settable via `transportStore.ts:21`) while offline hardcodes
   `AUTOMATION_SLEW_TICK_SECONDS = 0.01` (`automationSlew.ts:49`, consumed at
   `automationScheduling.ts:58`). At the shipping default of 10 ms they agree; at any other grain the
   bounce's slew filter no longer matches the monitor's. Pinning the test at 100 Hz would hide that,
   and pinning both sides to the same constant is a check against itself. **Mutation: setting
   `scheduleGrainMs` away from 10 must red until offline reads the live grain.** Whether making
   offline read it is in this AC or is a new finding is settled by running the test: if it reds, it is
   in this AC.
   **State the limit:** both sides call `slewStep` and `evaluateAutomationCurve`, so this does not
   cross-check the slew or curve kernels — the existing automation curve-conformance specs do.
3. **The binding delivers the right parameter at the right frame.** A compiled segment for parameter
   _P_ arrives at the worklet as _P_, at the frame the segment names. An inverted or off-by-one
   mapping in a new `scheduleParam` binding produces a not-frozen render _and_ a conforming value
   stream, so neither 2 nor 4 catches it. Mutation: transposing two parameter ordinals in one node's
   binding reds it.
4. **A not-frozen assertion, per device.** Render the fixture offline with the lane, and again with the
   lane's initial value held static, and assert the two outputs differ by more than a stated margin at
   a stated frame, with a presence pin on both renders. Mutation: restoring the `continue` reds it —
   the two renders become identical.

### AC-5 — Grinder's state is in the worklet before frame 0, and lands exactly

**Blocks on re-deriving `grinder-offline-settargetattime-glide`** (see the table above). Three defects,
one observable: **the head of every Grinder export renders with the wrong amp.**

- **The neural patch never arrives.** `prepareOfflineDeviceSetup.ts:98` is `grinder: null`, but an
  imported profile is not a `parameterValue` — `syncGrinderPatchToAudio.ts:343-347` ships it as a port
  patch and only `sendNumericParamToDevice` persists. `neuralEnabled` _is_ persisted, so the export
  renders with neural on and the **built-in** model: a plausible wrong instrument, which
  `buildDeviceChain`'s own docblock calls the unacceptable failure class.
- **~31 of 42 params flush on `requestAnimationFrame`.** `GrinderNode.ts:114/132`. The escape hatch is
  commented "No rAF (offline render / non-DOM host)" and is dead — the export runs on a main thread
  where `requestAnimationFrame` is always a function. `createNativeDspStrategy` replays
  `parameterValues` synchronously and the only yield before rendering is
  `yieldToMain = setTimeout(resolve, 0)`, a macrotask that resumes before any frame, so the first rAF
  fires **after** the render has started. Deterministically wrong, not intermittent.
- **The 11 real `AudioParam`s glide in.** `GrinderNode.ts:168` uses
  `param.setTargetAtTime(value, ctx.currentTime, 0.01)` for the initial replay, at
  `ctx.currentTime === 0` on an offline context. Per the primary source, `setTargetAtTime` never
  reaches its target and covers 63.2% per time constant, so `gain`, `master` and nine others sweep
  from the contract default toward the project value over the first ~46 ms. State restore and knob
  smoothing are different operations; `setValueAtTime` is the one for a restore.

**AC-0 cannot settle defects 2 and 3**, because both live in the shared node constructor and both legs
run it — see §1. The evidence below pins the parameter, not the audio, for exactly that reason.

**Evidence.**

1. A `prepareOfflineGrinder` hydration entry replacing `grinder: null`, plus a spec asserting the
   imported profile reaches the offline worklet port before rendering. Mutation: restoring `null` reds
   it.
2. A spec asserting every entry of `parameterValues` is **observed at the worklet before the first
   `process()` call** — via an explicit `flushPendingParams()` the offline builder awaits, not a
   frame. Mutation: restoring the rAF coalescing on the offline path reds it.
3. A spec asserting each of the 11 `AudioParam`s carries a **`setValueAtTime` event at frame 0 landing
   the project value exactly**, read from the automation the offline builder writes or from the value
   the processor observes on its first `process()`. Mutation: restoring `setTargetAtTime` for the
   initial replay reds it.
   **Do not substitute an output-level assertion for this.** "The first render quantum matches steady
   state" is an absence assertion with no presence pin (ADR 0015 rule 4): it passes when the worklet
   fails to load and the chain degrades to a gain, when `parameterValues` never reaches the device at
   all, and when the output is silence. Worse, Grinder has its own settling transients on the same
   order as the glide — `triode.rs:104` carries a 10 ms coupling-cap time constant, plus the tone
   stack, power amp and cabinet — so any margin wide enough to pass after the fix swallows the effect
   the assertion exists to detect.
4. AC-0 nulls a Grinder fixture with an imported profile against the live leg — this settles defect 1,
   which is a state-application-path defect and therefore inside AC-0's reach.

### AC-6 — Knead renders corrected in an export

`prepareOfflineDeviceSetup.ts:105` is `knead: null` under a docblock defining `null` as "this device's
entire state reaches the offline node as plain `parameterValues`". That is false here. Knead has no
plugin descriptor, so `parameterValues` carries nothing pitch-related; the shift is derived per quantum
from the live transport SAB plus a clip/blob table (`kneadProcessor.ts:146-213`), and both arrive by
paths the offline chain never takes. `nativeDspDeviceFactories.ts` calls `factory.create(ctx)` with one
argument, so `createKneadNode(ctx, transportSAB?, signal?)` gets `undefined` and `_transportView` stays
null; the clip table only reaches the engine through `WebAudioEngine.syncKneadState`, which exists on
the live engine only.

Observable behaviour: **an export of a Knead track renders the corrected vocal.** Today
`currentShiftSemitones` stays 0 for the whole render — the bounce is uncorrected and, until the
separate PDC finding is closed, still 2048 samples late.

**Evidence:** a spec asserting the offline Knead node receives a clip table and a render-relative time
source, and that its shift at render frame _F_ equals the live shift at the corresponding transport
position over a fixture with a non-zero shift; plus AC-0's null over a Knead fixture, with a presence
pin proving both legs are sounding. Mutation: restoring `knead: null` reds both.

**The time source is a design question this spec does not settle.** The requirement is that offline
Knead reads render-relative position, not a realtime seqlock. Which frame clock supplies it — the
offline scheduler's own, a hydrated read-only view, or a per-render SAB — is a mechanism, and per the
campaign brief a mechanism waits for the measurement. Choose it in the PR and justify it there.

### AC-7 — Toaster's `engineParams` reach the engine on every path that loads a kit

`projectToasterKitToEngineMessages.ts:36` states "`engineParams` is deliberately not projected"; the
preset loader sends it (`loadToasterKit.ts:39-43`) while the `audioDevice.loaded` subscriber and
`prepareOfflineToaster.ts` do not. The values persist and restore (`ToasterKitState.ts:38-43`,
`:101-108`) and are then never pushed.

Observable behaviour: **load the 909 kit, whose kick carries `base_freq: 55`; the bounce renders 55,
not the engine default.** This diverges inside the same session, not only across a reload, because the
bounce goes through the projection alone. Per §2 this also changes what a reopened project plays.

**Read the stale-key hazard correctly.** The comment says the keys are `Pad` fields — `snappy`,
`noise_color`, `base_freq` — **shared across engines, not per-engine**. There is no engine→key
partition anywhere: `ToasterKit.ts` types `engineParams` as a bare `Record<string, number>` alongside a
separate `engineType`, and nothing maps between them. So the hazard is not "the wrong engine's keys
survive"; it is that any key survives an engine change with no way to tell whether it still applies.

**Evidence.**

1. A spec asserting all three consumers of the shared projection send `engineParams`. Mutation:
   dropping it from any one reds it.
2. A spec asserting the pad's `engineParams` record is **cleared in full** when its `engine_type`
   changes, and that only what the kit carries afterwards is applied. Clearing the whole record is the
   implementable rule; a per-engine key list would be new product data that does not exist today, and
   inventing it is out of scope — flag it if it turns out to be needed.
3. AC-0's null over a Toaster fixture whose **live leg loads the kit through the preset loader**.
   Without that, both legs skip `engineParams` and the null is green for the wrong reason. Mutation:
   dropping the replay reds the null.

Note the exposure bound the verifier recorded: no UI writes `engineParams` today; the values are
preset-authored only.

### AC-8 — Proof forwards parameter writes while bypassed

`ProofNode.ts:157` guards the post with `if (!bypassed && Number.isFinite(value))` and `setBypass` only
flips the flag — there is no replay on un-bypass — while `TrackNode.updateParam` forwards writes
regardless of bypass state and `updateBypass` routes the device out without rebuilding the node.
ProofNode is the only device in `engine/` that does this; Gluten, Bacteria, Grinder, Crumbs and the
rest forward unconditionally. Bypass is a signal-path decision, not a parameter gate.

Observable behaviour: **bypass Proof, change the limiter ceiling, un-bypass, and the DSP runs the new
value.** Today the UI and the document show the new value, the worklet keeps the old one for the whole
session, and automation writing into a bypassed Proof is dropped the same way.

**This changes the monitor, not the export** — see §2.

**Evidence:** a spec that bypasses, writes a param, un-bypasses, and asserts the worklet port received
the value; plus AC-0's null over a Proof fixture whose live leg performs that sequence — red before the
fix, green after, with the residual quoted both times. Mutation: restoring the `!bypassed` condition
reds both.

### AC-9 — One frame clamp, one truncation warning

`renderTrackSubgraphOffline.ts:142` re-inlines
`Math.min(Math.ceil(durationSeconds * sampleRate), MAX_OFFLINE_FRAMES)` instead of calling
`clampRenderFrameCount`, whose docstring exists because the clamp "used to be applied silently, so an
over-long export produced a short file that looked like a success". `onWarning` is already in scope at
`:120` and already forwarded twice in the same file.

**Size this honestly.** `MAX_OFFLINE_FRAMES` is 2³⁰ (`constants.ts:15`) — about 6.2 hours at 48 kHz,
and an `OfflineAudioContext` of 2³⁰ stereo frames is ~8.6 GB, which fails allocation long before
anyone freezes a region that long. This is a second-source-of-truth and a missing warning channel. It
is not the silent-bad-print class, and the PR must not describe it as one.

**Evidence:** a spec targeting the clamp's call site with a stubbed `OfflineAudioContext` — the real
freeze path constructs the context immediately after the clamp and would OOM first — passing a
duration above `MAX_OFFLINE_FRAMES` and asserting **`onWarning` received the truncation message**.
Mutation: re-inlining the `Math.min` reds it.

**The frame-count assertion carries nothing and must not be added.** Both sides read
`MAX_OFFLINE_FRAMES` from the same constant, so it compares a value against its own source (ADR 0015
rule 3) and survives the only mutation available — the count still matches when the warning is gone.
Per ADR 0015 rule 1 that makes it decoration. Assert the warning; say in the PR that the count
assertion was considered and rejected, and why.

### AC-10 — The render deadline is monotonic and measures progress, not elapsed time

**Blocks on re-deriving `offline-render-arbitrary-wall-clock-budget`** (see the table above).

`RENDER_TIMEOUT_MULTIPLIER = 10` with `MIN_RENDER_TIMEOUT_MS = 60_000` is enforced twice over one
render: at every checkpoint via `Date.now() - startedAt >= timeoutMs` (`renderInSegments.ts:222`) and
again by the `setTimeout` inside `renderWithTimeout`, whose own header admits it "does NOT cancel the
render itself". The primary source agrees: `OfflineAudioContext` has `startRendering()` and
`suspend()`/`resume()` and **no abort**, so the racing timer can only reject a promise while the work
continues.

Observable behaviour: **a render making forward progress is never aborted; a wedged render is; a system
clock adjustment changes neither verdict.**

**Evidence.**

1. A spec whose checkpoints arrive slowly but steadily past the old total-elapsed budget, asserting no
   abort. Mutation: restoring the total-elapsed budget reds it.
2. A spec whose checkpoints stop, asserting abort within the stated no-progress window and that the
   abort is expressed through the `suspend()` checkpoint loop. Mutation: removing the no-progress check
   reds it.
3. A spec that moves the wall clock backwards and forwards across a run, asserting the verdict is
   unchanged. Mutation: restoring `Date.now()` reds it; `performance.now()` is monotonic.

**The no-progress threshold must be measured, not chosen.** Inventing a second unmeasured number is the
defect this AC removes. The Phase-1 AC-2 cost table reports per-_quantum_ device cost and a
reference-project total; it does not report per-segment wall clock at `RENDER_SEGMENT_SECONDS`. **If no
such figure exists, measuring it is part of this AC** — one render of the reference project,
worst-observed segment time, times a factor the PR states. Write the number, the measurement and the
machine into the file header per Phase-1 AC-6. A threshold with no measurement behind it fails this AC.

## Ambiguities in the survey's Phase 2 list

Recorded rather than guessed. Each names what would resolve it.

1. **Is ProofChamber's hand-rolled block-rate interpolator in scope?** `dutch-oven` is ProofChamber and
   is _not_ the "Proof" in the Phase 2 list — that is `ProofNode`, the mastering suite.
   `proofchamber-handrolled-block-rate-automation` is theme A but unnamed in Phase 2, and it carries
   `not independently verified`. **Resolution:** re-derive it, then rule. Treated as **out** here; its
   remedy — a-rate `parameterDescriptors` — is the same migration AC-4 rules out and should move with
   it.
2. **Grinder's ~31 port params: flush, or make them `AudioParam`s?** The finding offers both. AC-5
   requires the flush: it is the smaller change that makes the observable behaviour correct, and
   promoting 31 params is the same a-rate migration. **Resolution:** if that migration is later ruled
   in, AC-5's evidence 2 is superseded rather than duplicated.
3. **Refuse or warn on a failed `addModule`?** The finding's remedy says the degradations "should
   refuse rather than substitute" and #841 set refusal as the codebase's answer; `renderOffline.ts`
   today catches and warns. **Resolution:** an owner call, because it changes whether an export can
   fail where it previously succeeded. Recommendation: refuse for freeze — the buffer is persisted over
   a real track — and warn for a user-initiated export. AC-1 requires only that neither is silent.
4. **`toaster-sequencer-free-running-timer` is theme A and XL and is not in the Phase 2 list**, which
   names only `engineParams` replay. Treated as **out**. Its remedy — move the sequencer into the
   worklet on the transport frame clock — is Phase 3's clock work.
5. **Does offline have to read the live scheduler grain?** Surfaced by AC-4 evidence 2 and not by the
   survey. **Resolution is mechanical:** run the conformance test at a non-default `scheduleGrainMs`.
   If it reds, the divergence is real and closing it is inside AC-4; if it does not, file it as a new
   finding with the measurement attached.

## Out of scope

- Anything Phase 3 owns: Yeast block granularity, the transport integrator, the Toaster sequencer's
  host sync, generator phase-locking. This spec constrains its fixtures around them (§3).
- The a-rate `parameterDescriptors` migration for device-param automation — ruled out in AC-4.
- Knead's 2048-sample PDC report (`knead-no-latency-report`) — a separate finding with its own owner
  decision about shifting every other track. AC-6 makes the export _corrected_, not _aligned_.
- Gluten's +6.31 dB oversampler — Phase 5; ADR 0016 ruling 3 already answered its version-gate branch.
- Crumbs' second engine, its unwired pad/slice model, and Grand Boule's unpersisted store — device-state
  findings under themes B and C, not offline/live divergence.
- Desktop, per ADR 0016 ruling 1.

## Stop conditions

Report; do not design around.

1. **A wasm device cannot be nulled deterministically at the seam** even with a Yeast-free fixture —
   uninitialised wasm memory, allocator-dependent output, a scheduler that will not run twice the same.
   Survey stop condition 1: the "prove parity by null test" premise fails and the acceptance criterion
   for the parity findings has to be replaced, not widened.
2. **AC-0 finds divergence across devices that no Phase 2 item explains.** A systemic problem in the
   state-application path is an audit that must precede any per-device fix, and it invalidates this
   spec's per-device ordering. This is the shape of survey stop condition 4.
3. **AC-3's reasoned exemption rows outnumber its asserted verdicts.** The census has become an
   allow-list by another name and needs a different population, not a longer table.
4. **The telemetry pool cannot be returned to baseline** because a slot is held by something the render
   does not own. Teardown is then not a render-lifetime problem and AC-2 is mis-specified.
5. **AC-0's legs cannot be driven at the block sequence production live playback uses.** A green null
   then proves less than the claim; narrow the claim and say so rather than keeping it.
6. **Either re-derivation fails** — `grinder-offline-settargetattime-glide` or
   `offline-render-arbitrary-wall-clock-budget`. Report it against survey stop condition 10 and drop
   the AC rather than building on an unverified finding.

## Verification

- Failing reproduction first for each behavioural AC, with real output pasted. Five of these change
  what an export sounds like; a fix without a red-first is indistinguishable from moving the defect.
- Every guard mutation-checked with the reding assertion named, per ADR 0015. Every census enumerated
  from a registry, with a reason-bearing exemption table, a committed broken fixture, and a mutation
  that exercises the _enumeration_ and not only the verdict.
- Every `file:line` in a PR re-derived against the branch it ships from. The citations in this spec were
  checked against `docs/phase-2-spec-ultracode`; they go stale.
- Run each affected test once through guarded package scripts; quote its exit code.
- No config, baseline or expected value edited to make a gate pass unless the value genuinely changed
  and the measurement is stated.
