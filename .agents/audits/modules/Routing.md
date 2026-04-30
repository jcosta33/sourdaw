# Routing module audit

## Scope

This audit covers `src/modules/Routing/` in full — every file in `errors/`,
`events/`, `models/`, `stores/`, `useCases/`, and their tests. It explicitly
excludes the AudioEngine's actual graph implementation
(`src/modules/AudioEngine/repositories/createWebAudioEngine.ts`,
`engine/BusNode.ts`, `engine/TrackNode.ts`) and the latency-compensation
helpers (`AudioEngine/useCases/latencyCompensation/...`) except where they are
called from this module or where Routing's data is consumed by them.

It is an adversarial review: routing-graph cycle detection, bus/send/aux
correctness, disconnect cleanup (orphan nodes), pre/post-fader semantics,
latency compensation across paths, race conditions, error handling,
architecture/test debt, and TypeScript soundness.

Related spec: none on disk.

---

## Goal

A correctness-first routing surface for the DAW:

- A single source of truth for **sidechain routes** (graph edges that bypass
  the regular send/output topology) lives in `Routing` and stays in sync with
  the live audio graph for every reachable mutation: add, remove, replace,
  track deletion, project switch, project load, project export.
- **Bus/send orchestration** (insert busses, set bus gain, set sends with
  pre/post-fader) flows through Routing as the **only** API other modules use
  to mutate the engine's send/bus topology, so cycles, dangling sends, and
  pre/post-fader updates have one chokepoint to validate at.
- **Cycle detection** is correct (no infinite loops, no false positives, no
  false negatives) for sidechains _and_ for sends/output routing
  (`A→bus→A`, `A sends to B` with `B output→A`, etc.).
- **Disconnect cleanup is total**. Removing a route, removing a send,
  removing a bus, or removing a track must disconnect every Web Audio node
  that referenced the removed entity — no orphan `GainNode`s, no live
  connections to disposed nodes.
- **Pre/post-fader semantics are honoured** in every path: live engine,
  offline render (`renderOffline`), and project export. Toggling pre-fader
  must move the tap atomically without dropping samples or double-summing.
- **Latency compensation accounts for all routing paths**, including
  sidechains: a track that sidechains an upstream device must be reported as
  upstream of that device for PDC purposes.
- AGENTS.md hard rules: contract boundaries (cross-module imports target
  the root `index.ts` only), single-function-per-file, single-object-param
  for >1 parameter, no `as any`/`as unknown as`, no namespace imports, no
  cross-module imports of `models/`, no use-case type re-exports across
  modules.

---

## Relevant code paths

- `src/modules/Routing/errors/RoutingErrors.ts`
- `src/modules/Routing/errors/__tests__/RoutingErrors.spec.ts`
- `src/modules/Routing/events/index.ts` (single comment, no exports)
- `src/modules/Routing/models/SidechainRoute.ts`
- `src/modules/Routing/models/__tests__/SidechainRoute.spec.ts`
- `src/modules/Routing/stores/index.ts`
- `src/modules/Routing/stores/sidechainStore.ts`
- `src/modules/Routing/useCases/index.ts`
- `src/modules/Routing/useCases/hydrateSidechainRoutes.ts`
- `src/modules/Routing/useCases/busControls/{ensureBusStrip,setBusGain,setSend}.ts`
- `src/modules/Routing/useCases/sidechain/{addSidechainRoute,removeSidechainRoute,getSidechainRoutesForTrack,getSidechainSource,getAllSidechainRoutes,setSidechainRoutes}.ts`
- `src/modules/Routing/useCases/__tests__/busControls.spec.ts`
- `src/modules/Routing/useCases/__tests__/sidechain.spec.ts`
- `src/modules/Routing/useCases/__tests__/hydrateSidechainRoutes.spec.ts`
- `src/modules/Routing/useCases/busControls/__tests__/{ensureBusStrip,setBusGain,setSend}.spec.ts`
- `src/modules/Routing/useCases/sidechain/__tests__/*.spec.ts`

Cross-references inspected (not part of this module's audit but load-bearing
for findings below):

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts`
  (`ensureBusStrip`, `setBusGain`, `setSend`, `removeSend`, `wireSidechainRoute`,
  `unwireSidechainRoute`, `removeBusStrip`)
- `src/modules/Arrangement/handlers/device/handleAddSidechainRoute.ts`
- `src/modules/Arrangement/handlers/device/handleRemoveSidechainRoute.ts`
- `src/modules/Arrangement/handlers/device/handleAddSend.ts`,
  `handleRemoveSend.ts`
- `src/modules/Arrangement/useCases/device/sendManagement/{setSend,toggleSendPreFader,removeSend}.ts`
- `src/modules/Arrangement/useCases/removeTrack.ts`
- `src/modules/Arrangement/services/getUpstreamSubgraph.ts`
- `src/modules/AudioEngine/useCases/latencyCompensation/compensation/helpers.ts`
- `src/modules/Arrangement/useCases/freezeBounce/renderOffline.ts`

---

## Current behavior

**No root barrel.** There is no `src/modules/Routing/index.ts`. Cross-module
consumers therefore cannot import from `#/modules/Routing` — they reach into
`#/modules/Routing/useCases`, `#/modules/Routing/stores`, and even
`#/modules/Routing/models/SidechainRoute` (Arrangement's
`getUpstreamSubgraph.ts:1`). AGENTS.md "Contract Boundaries" mandates the
root `index.ts` as the **only** cross-module surface.

**Sidechain store** (`stores/sidechainStore.ts`) holds `{ routes: SidechainRoute[] }`
behind `createAutomergeStorage('root', 'sidechainRoutes')`. The store is
hydrated from CRDT inside `CrdtDocument/useCases/projection/projectProjection.ts`
via `hydrateSidechainRoutes()`. There is no eager re-wire on hydrate — the
store is replaced, but `wireSidechainRoute` is never called for the newly
hydrated routes; the audio graph stays empty for sidechains until the user
manually edits a route.

**Bus controls** (`useCases/busControls/{ensureBusStrip,setBusGain,setSend}.ts`)
are 3-line pass-throughs to `#/modules/AudioEngine/useCases`. They do not
touch the track store, do not validate inputs, and do not check for cycles —
even though `setSend` can readily produce them
(track A's output → bus B; A also sends to bus B's output trail back to A).

**Sidechain use cases** (`useCases/sidechain/...`) are six functions:

- `addSidechainRoute` (`addSidechainRoute.ts:31-55`) checks duplicate by
  `(sourceTrackId, targetDeviceId)`, runs a BFS cycle check on the existing
  route set, mints a new `SidechainRoute` via `createSidechainRoute`, writes
  it to the store, and calls `wireSidechainRoute` on the AudioEngine.
- `removeSidechainRoute` (`removeSidechainRoute.ts:5-19`) finds the route by
  `id`, calls `unwireSidechainRoute`, then removes it from the store.
- `setSidechainRoutes` (`setSidechainRoutes.ts:6-19`) unwires _every_
  existing route, replaces the store, then wires every new route. Used by
  `resetModuleStoresToDefault()` (project switch).
- `getSidechainRoutesForTrack`, `getSidechainSource`, `getAllSidechainRoutes`
  are read-only store accessors.

**Errors** (`errors/RoutingErrors.ts`) defines `SidechainCycleError` and
`DuplicateSidechainRouteError`. Only `SidechainCycleError` is thrown
anywhere; `DuplicateSidechainRouteError` is never instantiated — the
duplicate path silently no-ops.

**Model** (`models/SidechainRoute.ts`) is a `{ id, sourceTrackId,
targetTrackId, targetDeviceId, targetParameterId, gain }` object. `gain` is
a model field, but no use case ever reads or writes it after creation —
`createSidechainRoute` defaults it to `1` and `wireSidechainRoute` ignores
it, hard-coding `scGain.gain.value = 1` in the engine
(`createWebAudioEngine.ts:458`).

**Cross-module callers** (audited as observers of Routing):

- `Arrangement/handlers/device/handleAddSidechainRoute.ts` — finds the
  first device whose `type.toLowerCase().includes('sidechain')` and adds a
  route. Will match any device whose **type string** has "sidechain" in it,
  not specifically the supported `'builtin-sidechain-compressor'` — but the
  engine's `wireSidechainRoute` then explicitly rejects anything else
  (`createWebAudioEngine.ts:448`), so the route lands in the store but the
  audio graph silently doesn't wire.
- `Arrangement/useCases/device/sendManagement/setSend.ts` — mutates the
  track store, then calls `engineSetSend`. Forgets the `level` argument's
  pre-fader resolution: when a send already exists, it forces
  `sends[i] = { busId, level, preFader: existing.preFader }` — but ignores
  the **caller-supplied** `preFader` and instead reuses the existing one.
  The engine call `engineSetSend(trackId, busId, level, resolvedPreFader)`
  is consistent with the store, but a "set send" coming in with a different
  pre-fader never updates the pre-fader. Toggling pre-fader has its own
  use case (`toggleSendPreFader.ts`).
- `Arrangement/useCases/device/sendManagement/removeSend.ts` — only
  mutates the track store. It does **not** call any engine teardown
  (`engine.removeSend(trackId, busId)` exists in `createWebAudioEngine.ts:412`
  but is unreachable from the Routing layer — there is no
  `Routing/useCases/busControls/removeSend.ts`). The send `GainNode` stays
  alive and connected. Until the user re-runs `ensureTrackStrips`, presses
  stop, or switches projects, the bus continues to receive signal from a
  removed send.
- `Arrangement/useCases/removeTrack.ts:65-70` — removes sidechain routes
  that reference a removed track. It does **not** remove sends that target
  the removed track if the track was a bus, and it does **not** call
  `engine.removeBusStrip` for bus tracks — both produce orphan engine
  state until the next `resetGraph()`.
- `Transport/useCases/ensureTrackStrips.ts` — bootstraps engine state
  before playback. It does not bootstrap **sidechain routes** even though
  it runs after a project load; the only sidechain wiring path is the
  `addSidechainRoute` user action (which fires exactly once at user input).
  This means a freshly loaded project plays back without any sidechain
  routes wired. (See issue #1.)

**Tests.** There are 17 spec files in this module:

- `__tests__/sidechain.spec.ts` and `__tests__/busControls.spec.ts` are real
  behavioural tests with proper mocks against the engine deep-import path
  (`#/modules/AudioEngine/useCases/engineAccess/wireSidechainRoute` etc.).
- 9 of the 17 (`useCases/busControls/__tests__/*` and
  `useCases/sidechain/__tests__/*` — one file per use case) are pure
  "is the symbol exported?" smoke tests with the literal assertion
  `expect(time === 'function' || time === 'object').toBe(true)`. They
  exercise no behaviour, mock no dependency, and accept _any_ exported
  value, including objects that are not functions. They were almost
  certainly auto-generated.

---

## Findings

1. **Sidechain wiring is orphaned on every project hydrate.**
   `hydrateSidechainRoutes` (`useCases/hydrateSidechainRoutes.ts:10`) only
   replaces the in-memory store from CRDT. Nothing in the codebase calls
   `wireSidechainRoute(...)` for the newly-hydrated routes — there is no
   `for (const route of routes) wireSidechainRoute(...)` loop in
   `projectCrdtToStores`, `ensureTrackStrips`, `setupProjectionBridge`, or
   anywhere else. After project load: the store says routes exist; the
   audio graph has no `sidechainConnections`. The only wiring that ever
   reaches the engine is the user clicking "add sidechain". The four
   demo-project builders (`createNebulaDriftDemo`, `createResonanceDemo`,
   `templateHelpers/builder`) call `addSidechainRoute(...)` directly, so
   _their_ first-load flow does wire the engine — but a saved project
   loaded later does not.

2. **`removeSend` leaks engine state.**
   `Arrangement/useCases/device/sendManagement/removeSend.ts:3-8` updates
   only the track store. The engine's `removeSend(sourceTrackId, busId)`
   path (`createWebAudioEngine.ts:412-419`) is never called. The
   `sendNode.gainNode` stays connected from the track tap to the bus until
   `ensureTrackStrips` next runs (which only **adds** sends — it does not
   diff against existing engine sends). Practical effect: removing a send
   while audio is playing keeps it routing audio to the bus indefinitely.
   The send line **also** disappears from the routing graph view because
   the view reads `track.sends`, so the user gets a "removed" UI with a
   live audio path. There is no Routing-side use case to call (no
   `useCases/busControls/removeSend.ts`).

3. **Bus deletion has no cleanup path at all.** No use case calls
   `engine.removeBusStrip(busId)`. The only consumer is `resetGraph()`,
   which iterates _all_ buses (`createWebAudioEngine.ts:567-569`).
   `Arrangement/useCases/removeTrack.ts` deletes a track — including
   bus tracks (`track.kind === 'bus'`) — from the track store, but does
   not call any engine bus-removal API. Effects: (a) a deleted bus's
   `BusNode` (gain + analyser) stays alive forever; (b) every track that
   was sending to that bus continues to drive the dead `GainNode` (it
   simply doesn't reach the speakers because `BusNode.dispose` was never
   called); (c) the track store loses the bus track but the engine's
   `busNodes` Map keeps the entry, so re-creating a bus with the same id
   silently reuses the old wiring (peak meters frozen at last value).

4. **Cycle detection only covers sidechain edges.**
   `addSidechainRoute.wouldCreateCycle` (`addSidechainRoute.ts:7-29`)
   only walks the existing **sidechain** routes. A real engine cycle can
   form via output routing or sends:

    - `A.outputId = B`, then `addSidechainRoute(B → A)` — the BFS only
      follows sidechain edges from `B` and never sees the output edge
      `A → B`, so the cycle isn't detected. The Web Audio graph then has
      `A → B` (output) and `B's analyser → A's compressor SC input`,
      which is a feedback loop.
    - Two sends forming a loop bus-to-bus (bus A sends to bus B, bus B
      sends to bus A) bypasses the entire check; the BFS only consults
      sidechain routes. `setSend` performs **no** cycle detection at all.
    - The BFS uses non-null-asserted `queue.shift()!` (`addSidechainRoute.ts:14`)
      — fine here since the loop guards on `queue.length > 0`, but it is
      an `as`-style escape and the AGENTS.md rule discourages `!`.

5. **Self-routing detection is correct but limited.**
   `wouldCreateCycle` (`:8-10`) returns `true` for `sourceTrackId ===
targetTrackId`. But the duplicate-detection path that runs first
   (`:42-45`) only checks `(sourceTrackId, targetDeviceId)`, not
   `(sourceTrackId, targetTrackId)`. Two sidechain devices on the same
   target track can still both be sourced from the same track, which is
   probably correct (different devices) — but a misconfigured caller
   could try `addSidechainRoute(A, A, dev-on-A)` and it lands in the
   self-routing branch first, throwing. So far OK; flagging the
   asymmetry between the two checks.

6. **`DuplicateSidechainRouteError` is dead code.**
   `errors/RoutingErrors.ts:13-23` defines the class. It is never
   instantiated anywhere in the codebase. The duplicate path returns
   silently (`addSidechainRoute.ts:42-45`). Either the silent no-op is
   correct (then delete the class and its test), or the contract should
   throw (then thread the throw through and surface to the user).

7. **`setSidechainRoutes` race against the engine.**
   `setSidechainRoutes.ts:8-18` runs `unwireSidechainRoute` for every old
   route, then `sidechainStore.set(...)`, then `wireSidechainRoute` for
   every new route. The audio graph mutation is _synchronous_ (Web Audio
   `connect`/`disconnect` is synchronous), but the use case throws a
   silent floor between unwire and rewire. During `resetModuleStoresToDefault()`,
   `setSidechainRoutes([])` is called **after** `trackStore.set({ tracks: [], … })`.
   At that point, every track in the engine still exists (track strip
   teardown happens via `engine.resetGraph()`, called from a different
   path). `unwireSidechainRoute` for each old route walks the engine's
   `sidechainConnections` map by `sourceTrackId→targetDeviceId`, finds
   the gain node, disconnects it, deletes the entry. That works. But
   there is no validation that the engine state and the store agree —
   if `setSidechainRoutes` is called before the engine is initialised
   (`fallbackMode = true` from `createWebAudioEngine.ts:67`), all
   wireSidechainRoute calls early-return and the engine state diverges
   from the store with no recovery path.

8. **Sidechain `gain` field is dead.**
   `models/SidechainRoute.ts:15,23,31` adds a `gain: number` (default 1).
   `wireSidechainRoute` (engine, `createWebAudioEngine.ts:458`) hard-codes
   `scGain.gain.value = 1`. There is no API to update a route's gain —
   neither `addSidechainRoute` (which discards the parameter at call
   time) nor any other use case takes a gain. The field exists in the
   serialised AppAction and the persisted CRDT, but nothing reads it.
   Either remove it, or thread it through `wireSidechainRoute` and add a
   `setSidechainGain(routeId, gain)` use case.

9. **`targetParameterId` is dead.** `models/SidechainRoute.ts:14,22,30`
   takes a `targetParameterId` (defaults to `'threshold'`). It is
   persisted in the model but no use case or engine method consumes it
   downstream — the engine's `wireSidechainRoute` connects to
   `deviceNode.inputNode` channel 1 unconditionally, no parameter routing.
   Same disposition as `gain`: unimplemented surface in the model.

10. **`Routing` has no root `index.ts`.** AGENTS.md "Contract Boundaries"
    mandates the root barrel as the only cross-module entry point. There
    is no `src/modules/Routing/index.ts`. Consequence: every cross-module
    caller (`Arrangement/handlers/device/handle{Add,Remove}SidechainRoute.ts`,
    `Arrangement/useCases/{removeTrack,device/sendManagement/...}.ts`,
    `Transport/useCases/ensureTrackStrips.ts`,
    `CrdtDocument/useCases/projection/projectProjection.ts`,
    `Workspace/presentations/views/RoutingGraph.tsx`,
    `Project/useCases/{...}/projectPersistence/...`,
    `Project/useCases/demoProjects/{nebulaDrift,resonance}/...`,
    `Project/useCases/projectTemplates/templateHelpers/builder.ts`) reaches
    in via `#/modules/Routing/useCases` or `#/modules/Routing/stores` — a
    deep import per AGENTS.md.

11. **`getUpstreamSubgraph` imports Routing's `models/`.**
    `Arrangement/services/getUpstreamSubgraph.ts:1` does `import { type
SidechainRoute } from '#/modules/Routing/models/SidechainRoute'`.
    AGENTS.md "Model isolation" forbids this absolutely: models are
    private, and cross-module consumers must define their own local
    type. Since the field set Arrangement actually reads is
    `{ sourceTrackId, targetTrackId }`, the local type is trivial.

12. **9 of 17 specs are smoke tests.** The "should export X" pattern in
    `useCases/busControls/__tests__/*` and `useCases/sidechain/__tests__/*`
    asserts only that the named export is `function | object` — accepting
    any non-`undefined` value. The substantive tests live in the parent
    `__tests__/sidechain.spec.ts` and `__tests__/busControls.spec.ts`,
    which is itself a structure violation per `docs/06-testing.md`
    (each use-case file should have a co-located `__tests__/` test, not
    a parent-level umbrella). Net effect: 9 specs add zero coverage and
    confuse the per-file test-search reflex.

13. **`sidechain.spec.ts` writes to a closure variable named `mockStoreValue`
    declared _after_ the `vi.mock` factory that closes over it.**
    `__tests__/sidechain.spec.ts:39` declares `mockStoreValue` after the
    `vi.hoisted` mocks at `:11` and the `vi.mock('../../models/SidechainRoute', ...)`
    at `:35`. The `vi.mock('../../stores/sidechainStore', ...)` at `:41`
    closes over `mockStoreValue` via a `get value()` getter, which is OK
    because `vi.mock` is hoisted and the getter is invoked lazily — but
    this is fragile: a single accidental read inside the factory body
    (rather than in the getter) would TDZ at hoist time. The spec also
    overrides `createSidechainRoute` (`:35-37`) so the duplicate-detection
    test at `:68-82` doesn't actually exercise the real `id` shape.

14. **`addSidechainRoute` cycle BFS is O(n²) per call.**
    `addSidechainRoute.ts:13-27` BFS revisits every route on every queue
    pop because the inner loop iterates `routes` linearly. For N routes
    in the store, the worst case is `O(N × N)`. Not a problem at
    realistic counts (10s), but a fan-in topology with hundreds of
    routes (auto-generated mixing chains, AI-driven sessions) would burn
    perceptible CPU on every add. Build a `Map<sourceTrackId, targetIds[]>`
    once per call (or memoise across the use case for batch operations).

15. **`SidechainRoute.id` uses `crypto.randomUUID()` directly.**
    `models/SidechainRoute.ts:26` calls `crypto.randomUUID()`. The repo's
    test for this (`models/__tests__/SidechainRoute.spec.ts:15`) asserts
    a regex match against the canonical UUID v4 shape. Fine for browser
    environments; in older Node test runners (< 16.7) `crypto.randomUUID`
    may not exist. Most of the codebase uses `crypto.randomUUID()` so
    this is on-pattern, but it is a non-injectable global — the test
    cannot stub it. Acceptable given the repo conventions; flagged.

16. **`getSidechainRoutesForTrack` returns both source and target matches
    in one bag.** `useCases/sidechain/getSidechainRoutesForTrack.ts:9`
    returns `r.sourceTrackId === trackId || r.targetTrackId === trackId`
    — a track's "incoming sidechains" and "outgoing sidechains" are
    indistinguishable in the result. `handleRemoveSidechainRoute` then
    filters by `r.sourceTrackId === payload.sourceTrackId`, so the call
    site essentially undoes the "either/or" by re-filtering. Either rename
    to `getSidechainRoutesInvolvingTrack` or split into two use cases
    (`getOutgoing…`, `getIncoming…`).

17. **Latency compensation does not include sidechains.**
    `AudioEngine/useCases/latencyCompensation/compensation/helpers.ts:34-69`
    computes `getTrackLatency` by walking `track.outputId` and
    `track.sends[i].busId`. It never consults
    `sidechainStore.value?.routes`, so a sidechain source feeding a
    builtin-sidechain-compressor (the only device with non-zero device
    latency in `deviceLatencyMap` — `:16`, ~2.7 ms at 48 kHz) does not
    contribute the compressor's latency to the source track's
    compensation budget. Pumping mixes go out of phase by a few samples.

18. **`setSend` engine update is a coarse `setTargetAtTime`.**
    `createWebAudioEngine.ts:389` uses `setTargetAtTime(level,
currentTime, 0.01)` for **already-existing** sends, but
    `:405` directly assigns `sendGain.gain.value = level` for
    new sends (zipper-noise-prone). The Routing-side use case
    (`useCases/busControls/setSend.ts`) is a 3-line pass-through, so
    there is no chance to add a ramp envelope there. Consistency: pick
    one ramp shape and apply at both create and update.

19. **`setSend` pre-fader handoff drops samples on toggle.**
    `createWebAudioEngine.ts:390-400`: when `existing.preFader !==
preFader`, the code disconnects the existing send `gainNode`, then
    connects the new tap. Between those two synchronous calls the engine
    does emit a single audio block of silence on the bus — for a
    pumping bus or a mid-rendering bounce, that's a 2.7 ms gap. A
    crossfade (two GainNodes ramping in opposite directions over ~10 ms)
    would be glitch-free. The Routing-side `setSend` use case has no
    visibility into this.

20. **`renderOffline` ignores pre-fader for sends.**
    `Arrangement/useCases/freezeBounce/renderOffline.ts:163-172` always
    connects the source's `output` (post-fader, post-pan, post-meter) to
    the send gain. The comment at `:167` admits "preFader send logic
    deferred for now". Pre-fader sends bounce **post-fader**. Any project
    using pre-fader sends as a parallel-processing path (parallel
    compression, headphone mix) bounces wrong. Routing has no offline-render
    counterpart to `engine.setSend`'s pre/post-fader switch.

21. **`renderOffline` ignores sidechain `gain`.**
    `renderOffline.ts:182-184` connects `sourceNode → scGain (gain=r.gain)
→ targetDeviceNode.inputNode` at channel 1. Reads `r.gain` correctly,
    but the live engine **ignores** it (`createWebAudioEngine.ts:458`).
    Bouncing a project will therefore produce different sidechain
    behaviour than playing it live. Inconsistent contract.

22. **`renderOffline` cycle handling is implicit.**
    `Arrangement/services/getUpstreamSubgraph.ts:21-51` walks output,
    sends, and sidechains depth-first with a `visited` set, which
    prevents infinite loops, but means a real cycle in the project (see
    issue #4) silently loses one of its edges in the render. There is no
    warning, no log, no error.

23. **`hydrateSidechainRoutes` is a 1-line wrapper around
    `sidechainStore.hydrate()`.** The JSDoc (`:3-8`) says the wrap is
    intentional ("intent is explicit at the use-case layer"), but it
    doesn't actually re-wire the engine after hydration (issue #1), so
    "hydrate" is misleading: it hydrates the store and only the store,
    leaving the engine out of sync.

24. **`busControls/__tests__/...` umbrella tests use deep mock paths.**
    `useCases/__tests__/busControls.spec.ts:13-21` mocks
    `'#/modules/AudioEngine/useCases/engineAccess/{ensureBusStrip,setBusGain,setSend}'`
    — a **deep** mock path. Production code uses
    `'#/modules/AudioEngine/useCases'` (the barrel). At runtime Vitest's
    module-level `vi.mock` resolves both because the deep-import file is
    re-exported by the barrel, but the spec is fragile: rename the
    `engineAccess/` file and the mock silently breaks while tests still
    pass against the un-mocked barrel. (See AudioAnalysis audit issue #2
    for the same class of bug.)

25. **`sidechain.spec.ts` mocks the engine via deep path.** Same shape:
    `__tests__/sidechain.spec.ts:28-33` mocks
    `'#/modules/AudioEngine/useCases/engineAccess/wireSidechainRoute'`
    and `'.../unwireSidechainRoute'`. Production imports
    `'#/modules/AudioEngine/useCases'`. Same fragility. The umbrella
    `busControls.spec.ts` and `sidechain.spec.ts` are otherwise the only
    behavioural tests in the module.

26. **`events/index.ts` is a single-line comment file.**
    `events/index.ts:1` says `// no public events`. Either delete the
    file (no public events implies no events folder at all — convention
    violation per AGENTS.md "events/" being one of four allowed root
    re-export folders) or define the events the module actually
    publishes (e.g. `routing.sidechain.added`, `routing.sidechain.removed`).
    Current state pollutes the directory tree with a stub.

27. **`addSidechainRoute` ignores `targetParameterId` argument.** The
    function takes `targetParameterId = 'threshold'` (`addSidechainRoute.ts:35`)
    and threads it into `createSidechainRoute(...)` — but no caller in
    the codebase passes anything other than the default. The
    `handleAddSidechainRoute` AppAction (`commandQueries.ts:271`,
    `Command/models/AppAction.ts:274`) does not include
    `targetParameterId` in its payload. So the model field exists, the
    function arg exists, the AppAction surface does not. Either remove
    the arg or expose it in the action.

28. **No undo/redo plumbing for routing.** `addSidechainRoute` writes to
    `sidechainStore` and mutates the engine directly. The handler at
    `handleAddSidechainRoute.ts` is `undoable: true`, but no undo path
    in the Routing module unwires the engine — the undo system relies on
    `sidechainStore.set(...)` being reverted by the CRDT layer, which
    leaves the engine's `sidechainConnections` in the post-add state.
    Same for `setSend` (engine state not re-applied on undo).
    Architecture concern: undo of routing actions doesn't fully
    round-trip the audio graph.

29. **Bus ID type is implicit `string`.** `models/SidechainRoute.ts`,
    `useCases/busControls/{ensureBusStrip,setBusGain,setSend}.ts`, and
    every signature take `string` for `busId`/`trackId`/`targetDeviceId`.
    The codebase has no branded types for these — a caller swapping
    track IDs and bus IDs at runtime cannot be caught by tsc. The engine
    (`createWebAudioEngine.ts:441-462`) silently early-returns when
    either id is missing from the strip maps, hiding the misroute.

30. **AGENTS.md function-signature rule violated.** `setSend`
    (`useCases/busControls/setSend.ts:3`) takes 4 positional parameters
    `(sourceTrackId, busId, level, preFader = false)`. Per AGENTS.md
    "Function Signatures" this should be a single object `SetSendInput`.
    Same for `ensureBusStrip` (1 arg, OK), `setBusGain` (2 args,
    violation), `addSidechainRoute` (4 args, violation),
    `createSidechainRoute` (5 args, violation), `wouldCreateCycle`
    (3 args, violation, internal).

31. **`useCases/index.ts` is fine on type re-exports.** Only runtime
    values are exported (`addSidechainRoute`, `setSend`, etc.) — no
    `export type` lines. Compliant with AGENTS.md "Use-case types stay
    private". Flagging here only because it's the one architectural rule
    this module gets right where AudioAnalysis does not.

32. **Tests assert `as unknown as Parameters<typeof setSidechainRoutes>[0]`.**
    `__tests__/sidechain.spec.ts:117` casts `[newRoute]` through
    `as unknown as Parameters<typeof setSidechainRoutes>[0]`. This is
    the AGENTS.md "TypeScript — soundness" forbidden double-cast pattern
    used to silence a tsc complaint about partial fixtures. The fixture
    is missing the `gain` field — adding it to the fixture removes the
    cast.

33. **Sidechain route writes through `sidechainStore.set({ routes: [...] })`
    on every add/remove.** Each mutation copies the entire `routes`
    array. For projects with many sidechains this is fine, but the
    Automerge backing storage will diff each `set`, producing one CRDT
    op per route per mutation. A batched API (`addSidechainRoutes(routes[])`)
    would help bulk import paths (project templates, demo projects,
    AI-generated sessions).

34. **`Arrangement/handlers/device/handleAddSidechainRoute.ts` looks up
    the sidechain device by substring match.** Line 9:
    `targetTrack?.devices.find((d) => d.type.toLowerCase().includes('sidechain'))`.
    Fragile: any device whose type string has "sidechain" in the name
    (a hypothetical `'builtin-sidechain-eq'` or `'thirdparty/Sidechain
Reverb'`) lands here, but `engine.wireSidechainRoute` then explicitly
    accepts only `type === 'builtin-sidechain-compressor'`
    (`createWebAudioEngine.ts:448`). The store has the route, the engine
    refuses to wire — same divergence as issue #1, by a different
    mechanism. Cross-reference, not strictly Routing's bug, but the
    contract "what is a valid sidechain target?" is split across two
    modules with no shared validator.

35. **Accessibility / UX: routing changes have no aria-live feedback.**
    `Workspace/presentations/views/RoutingGraph.tsx` re-renders on store
    change but emits no `role="status"` / `aria-live="polite"`
    announcement. Adding/removing a sidechain or send is silent to
    screen-readers. Out-of-scope for this module, but flagging because
    the cycle-error path (`SidechainCycleError` thrown by
    `addSidechainRoute`) currently propagates to the action handler and
    has nowhere to go — `handleAddSidechainRoute.execute` doesn't catch
    it (`handleAddSidechainRoute.ts:7-13`), so the error bubbles up to
    `executeAppAction` and is logged via the global error path. The user
    sees nothing.

---

## Priorities

1. **Sidechain wiring is orphaned on every project hydrate** (issue #1).
   Saved projects with sidechains play back without any sidechain
   processing. This is an outright bug-class regression hiding behind
   working demo-project paths.
2. **`removeSend` leaks engine state** (issue #2). Removing a send keeps
   the audio path live; the user sees the send removed in the UI and
   still hears it in the bus. Trivial fix (add `removeSend` engine
   passthrough), high-impact bug.
3. **Bus deletion has no engine cleanup** (issue #3). Same class of leak,
   but more severe because `BusNode` retention prevents bus-id reuse.
4. **Cycle detection only covers sidechain edges** (issue #4). Real
   feedback loops via output + sidechain (or bus + bus) bypass the
   check; `setSend` does no cycle check at all.
5. **Latency compensation skips sidechains** (issue #17). Sidechain
   pumping mixes go out of phase by a worklet block. Subtle but
   audible on tight EDM mixes.
6. **9 of 17 specs are smoke tests** (issue #12). The module's per-file
   test coverage is theatre; substantive coverage lives in two umbrella
   files.
7. **No root barrel + cross-module deep imports** (issues #10, #11).
   Architectural debt; AGENTS.md violations across the entire
   consumer set.
8. **`gain` and `targetParameterId` fields are dead model surface**
   (issues #8, #9, #27). Either expose them or remove them.
9. **`renderOffline` ignores pre-fader and uses different sidechain gain
   semantics than the live engine** (issues #20, #21). Bouncing
   produces audible drift from playback.
10. **`hydrateSidechainRoutes` is a misleading name** (issue #23). It
    only hydrates the store; it does not re-establish the engine wiring.

---

## Open issues

### 1. Sidechain routes are not re-wired on project hydrate

**Problem:** `hydrateSidechainRoutes` (`useCases/hydrateSidechainRoutes.ts:10-12`)
calls only `sidechainStore.hydrate()`. There is no call site anywhere
that loops over the hydrated `routes` and invokes `wireSidechainRoute`
on the engine. After loading a saved project, `sidechainStore.value.routes`
is populated but `engine.sidechainConnections` is empty. Sidechain
compression silently fails to engage. Demo projects don't hit this
because they call `addSidechainRoute` at construction time (which both
writes the store and wires the engine).

**Representative files:**

- `src/modules/Routing/useCases/hydrateSidechainRoutes.ts:10-12`
- `src/modules/CrdtDocument/useCases/projection/projectProjection.ts:30`
- `src/modules/Transport/useCases/ensureTrackStrips.ts` (does not wire
  sidechains)
- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:437-462`

**Needed:** After hydration, walk the routes and call
`wireSidechainRoute(sourceTrackId, targetTrackId, targetDeviceId)` for
each, **after** the engine track strips have been ensured (otherwise
the engine's `wireSidechainRoute` no-ops on missing strips —
`createWebAudioEngine.ts:441-444`). Either:

- extend `hydrateSidechainRoutes` to call a new `applySidechainRoutesToEngine()`
  and gate it on engine readiness, or
- add a Routing-side `bootstrapSidechainEngine()` use case and call it
  from `Transport/useCases/ensureTrackStrips.ts` (right after the
  bus/track loop), or
- have `setSidechainRoutes` (already wires) be the single hydrate path —
  rename `hydrateSidechainRoutes` to `loadAndApplySidechainRoutes` and
  internally call `setSidechainRoutes(automergeRepository.read(...))`.

Add a regression test that hydrates a project with two sidechain routes
and asserts `wireSidechainRoute` was called twice with the right args.

### 2. `removeSend` leaks engine state

**Problem:**
`Arrangement/useCases/device/sendManagement/removeSend.ts:3-8` updates
the track store; the engine's `sendNodes` map keeps the entry, the
`GainNode` keeps connecting the track tap to the bus. There is no
Routing-side use case that calls `engine.removeSend(trackId, busId)`.

**Representative files:**

- `src/modules/Arrangement/useCases/device/sendManagement/removeSend.ts:3-8`
- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:412-419`
- `src/modules/Routing/useCases/busControls/` (no `removeSend.ts`)

**Needed:** Add `Routing/useCases/busControls/removeSend.ts` that
forwards to `engine.removeSend(sourceTrackId, busId)`; export it from
the `useCases/index.ts` barrel; call it from
`Arrangement/useCases/device/sendManagement/removeSend.ts` after the
track-store mutation. Add a behavioural test that removes a send and
asserts `engine.removeSend` is called.

### 3. Bus deletion has no engine cleanup path

**Problem:** Deleting a bus track (`Arrangement/useCases/removeTrack.ts`)
removes it from the track store and removes sidechain routes that
reference it, but does not call `engine.removeBusStrip(busId)`. The
`BusNode` (gain + analyser) leaks; sends from other tracks that
targeted this bus continue to drive the dead gain node. Re-creating a
bus with the same id silently rebinds to the leaked node — peak meters
and gain may be in an unexpected state.

**Representative files:**

- `src/modules/Arrangement/useCases/removeTrack.ts` (no `removeBusStrip`
  call)
- `src/modules/Routing/useCases/busControls/` (no `removeBusStrip.ts`)
- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:250-263`

**Needed:** Add `Routing/useCases/busControls/removeBusStrip.ts` and
have `removeTrack` call it when `track.kind === 'bus'`. The use case
should also iterate the track store and remove any
`tracks[i].sends[j]` whose `busId` matches (mirrored to engine via
`engine.removeSend`). Add a test that removes a bus with two sends
pointing to it and asserts the strip + both sends are gone from the
engine.

### 4. Cycle detection only covers sidechain edges

**Problem:** `addSidechainRoute.wouldCreateCycle` walks only sidechain
routes. Output routing (`track.outputId`) and sends (`track.sends[i].busId`)
are ignored. A user can create:

- `A.outputId = B`, then `addSidechainRoute(B → A)` — feedback loop in
  the audio graph that bypasses the check.
- `A sends to bus C`, `bus C sends to bus D`, `bus D sends to bus C` —
  no cycle check on `setSend` at all.

**Representative files:**

- `src/modules/Routing/useCases/sidechain/addSidechainRoute.ts:7-29,47`
- `src/modules/Routing/useCases/busControls/setSend.ts` (no cycle check)
- `src/modules/Arrangement/services/getUpstreamSubgraph.ts:21-51` (the
  full graph walk that **should** be the basis of cycle detection)

**Needed:** Lift `getUpstreamSubgraph`'s walk to a shared service (or
duplicate the read into Routing per the model-isolation rule), and run
it as the cycle check. Add a `setSend`-side cycle check that consults
the same walk including the proposed new send edge. Add tests for: A→B
output then SC B→A (rejected), bus-bus loop via sends (rejected),
unrelated topology (accepted). Decide whether to throw the existing
`SidechainCycleError` or a new `RoutingCycleError` for the broader
case.

### 5. `removeSend` engine path missing — store/graph divergence

(Subset of #2; kept to make the divergence visible at audit level.)

**Problem:** `removeSend` produces a state where
`track.sends[i]` does not reference `bus C`, but the engine still has
`sendNodes['track→C']` connected. UI updates correctly; audio graph
does not.

**Representative files:**

- `src/modules/Arrangement/useCases/device/sendManagement/removeSend.ts`
- `src/modules/Routing/useCases/busControls/`

**Needed:** Same as #2. Listed separately for the priority table.

### 6. `DuplicateSidechainRouteError` is dead code

**Problem:** The class is defined and tested, but no caller throws it.
The duplicate path is a silent return (`addSidechainRoute.ts:42-45`).

**Representative files:**

- `src/modules/Routing/errors/RoutingErrors.ts:13-23`
- `src/modules/Routing/errors/__tests__/RoutingErrors.spec.ts:17-26`
- `src/modules/Routing/useCases/sidechain/addSidechainRoute.ts:42-45`

**Needed:** Decide on the contract. Either delete the class + test, or
have `addSidechainRoute` throw `DuplicateSidechainRouteError` and
update consumers (currently
`Arrangement/handlers/device/handleAddSidechainRoute.ts:7-13` does not
catch — this would surface as a notification). Document the chosen
behaviour in the Routing barrel JSDoc once it exists.

### 7. Sidechain `gain` and `targetParameterId` are dead model fields

**Problem:** Both fields exist on `SidechainRoute` (and persist through
CRDT), but neither is read anywhere downstream.
`engine.wireSidechainRoute` hard-codes `scGain.gain.value = 1` and
connects to `inputNode` channel 1 unconditionally.

**Representative files:**

- `src/modules/Routing/models/SidechainRoute.ts:14-15,22-23,30-31`
- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:457-461`
  (no read of `gain` / `targetParameterId`)
- `src/modules/Routing/useCases/sidechain/addSidechainRoute.ts:35,51`
- `src/modules/Arrangement/useCases/freezeBounce/renderOffline.ts:182-187`
  (reads `r.gain` — divergent from live engine)

**Needed:** Either remove the fields and the parameter on
`createSidechainRoute`, or wire them through:
`engine.wireSidechainRoute({ sourceTrackId, targetTrackId,
targetDeviceId, targetParameterId, gain })` and add a
`setSidechainGain(routeId, gain)` use case. If keeping, fix the live /
offline-render divergence (#21).

### 8. `hydrateSidechainRoutes` is misnamed and incomplete

**Problem:** The function name implies "hydrate the routes (and bring
them up to date with the world)". Today it only refreshes the in-memory
store. The engine remains unaware. JSDoc claims the wrap exists "so the
intent is explicit at the use-case layer" — but the intent _isn't_
explicit, because it skips the engine.

**Representative files:**

- `src/modules/Routing/useCases/hydrateSidechainRoutes.ts`
- `src/modules/CrdtDocument/useCases/projection/projectProjection.ts:30`

**Needed:** Either rename to `hydrateSidechainStore` (and add a separate
`applySidechainRoutesToEngine` use case), or extend the implementation
to call `setSidechainRoutes(routes)` after the store is hydrated, so
the engine is brought into sync. Either way, fix the project-load
sidechain flow (issue #1).

### 9. Cycle BFS uses non-null `!` and is O(n²) per call

**Problem:** `addSidechainRoute.wouldCreateCycle` (`:14`) uses
`queue.shift()!`; the loop guards length, so safe — but it's an
`as`-style escape AGENTS.md discourages. Inner loop iterates the full
`routes` array on every pop, O(n²) worst case.

**Representative files:**

- `src/modules/Routing/useCases/sidechain/addSidechainRoute.ts:7-29`

**Needed:** Build `Map<sourceTrackId, targetTrackId[]>` once, then BFS.
Replace `queue.shift()!` with a `for (const current of queue)` over a
running index (no shifts). Add a test with 1000 routes and assert
sub-millisecond runtime.

### 10. `Routing` has no root `index.ts` — every cross-module caller deep-imports

**Problem:** AGENTS.md "Contract Boundaries" requires the root
`index.ts` as the only cross-module entry. There is none. Cross-module
callers reach into `#/modules/Routing/useCases`,
`#/modules/Routing/stores`, and even
`#/modules/Routing/models/SidechainRoute`.

**Representative files:**

- (missing) `src/modules/Routing/index.ts`
- `src/modules/Arrangement/handlers/device/handleAddSidechainRoute.ts:1`
- `src/modules/Arrangement/handlers/device/handleRemoveSidechainRoute.ts:1`
- `src/modules/Arrangement/useCases/removeTrack.ts:5`
- `src/modules/Arrangement/useCases/freezeBounce/renderOffline.ts:4`
- `src/modules/Arrangement/useCases/device/sendManagement/setSend.ts:1`
- `src/modules/Arrangement/useCases/device/sendManagement/toggleSendPreFader.ts:1`
- `src/modules/Arrangement/services/getUpstreamSubgraph.ts:1`
- `src/modules/Transport/useCases/ensureTrackStrips.ts:18`
- `src/modules/CrdtDocument/useCases/projection/projectProjection.ts:6`
- `src/modules/Workspace/presentations/views/RoutingGraph.tsx:8`
- `src/modules/Project/useCases/projectTemplates/templateHelpers/builder.ts:4`
- `src/modules/Project/useCases/projectPersistence/fileIO/exportProjectFile.ts:11`
- `src/modules/Project/useCases/projectPersistence/helpers/resetModuleStoresToDefault.ts:13`
- `src/modules/Project/useCases/demoProjects/nebulaDrift/createNebulaDriftDemo.ts:31`
- `src/modules/Project/useCases/demoProjects/resonance/createResonanceDemo.ts:7`

**Needed:** Add `src/modules/Routing/index.ts` re-exporting from
`./useCases`, `./stores`, `./events` (delete `events/index.ts` if no
events). Migrate every cross-module caller to import from
`#/modules/Routing` only. Surface `SidechainRoute` as a typed payload
through the events bus (or just don't expose it — see issue #11).

### 11. Cross-module imports of `Routing/models/SidechainRoute`

**Problem:** `Arrangement/services/getUpstreamSubgraph.ts:1` imports
`SidechainRoute` from `#/modules/Routing/models/SidechainRoute`.
AGENTS.md "Model isolation" forbids this absolutely.

**Representative files:**

- `src/modules/Arrangement/services/getUpstreamSubgraph.ts:1`
- `src/modules/Routing/models/SidechainRoute.ts`

**Needed:** Define a local type in Arrangement (just `{ sourceTrackId:
string; targetTrackId: string }` — those are the only fields the walk
reads). Drop the cross-module import. Same fix applies to anywhere
else that grew the same pattern (none others found at audit time).

### 12. 9 of 17 specs are exported-symbol smoke tests

**Problem:** Per-use-case spec files in `useCases/busControls/__tests__/`
and `useCases/sidechain/__tests__/` use the
`expect(typeof X === 'function' || typeof X === 'object').toBe(true)`
pattern, accepting any non-`undefined` value.

**Representative files:**

- `src/modules/Routing/useCases/busControls/__tests__/ensureBusStrip.spec.ts`
- `src/modules/Routing/useCases/busControls/__tests__/setBusGain.spec.ts`
- `src/modules/Routing/useCases/busControls/__tests__/setSend.spec.ts`
- `src/modules/Routing/useCases/sidechain/__tests__/addSidechainRoute.spec.ts`
- `src/modules/Routing/useCases/sidechain/__tests__/getAllSidechainRoutes.spec.ts`
- `src/modules/Routing/useCases/sidechain/__tests__/getSidechainRoutesForTrack.spec.ts`
- `src/modules/Routing/useCases/sidechain/__tests__/getSidechainSource.spec.ts`
- `src/modules/Routing/useCases/sidechain/__tests__/removeSidechainRoute.spec.ts`
- `src/modules/Routing/useCases/sidechain/__tests__/setSidechainRoutes.spec.ts`

**Needed:** Replace each with a behavioural test that mocks the
engine's `engineAccess/...` (or, after fixing #10, the barrel) and
asserts the use case's actual contract (input → side-effect on store +
on engine + on cycle detection). The umbrella tests
(`__tests__/sidechain.spec.ts`, `__tests__/busControls.spec.ts`) can
then be split into the per-file specs (per `docs/06-testing.md`'s
co-located convention). Delete the smoke tests.

### 13. Latency compensation does not include sidechain edges

**Problem:** `getTrackLatency`
(`AudioEngine/useCases/latencyCompensation/compensation/helpers.ts:34-69`)
walks `outputId` and `sends[i].busId`. It does not consult sidechain
routes, so the `builtin-sidechain-compressor`'s ~2.7 ms latency
(`:16,27`) on the target track does not contribute to the source
track's compensation budget. Pumping mixes go out of phase by a worklet
block. The miss is in AudioEngine but the data lives in Routing —
either Routing exposes the walk, or AudioEngine reads
`sidechainStore.value`.

**Representative files:**

- `src/modules/AudioEngine/useCases/latencyCompensation/compensation/helpers.ts:34-86`
- `src/modules/Routing/stores/sidechainStore.ts`
- `src/modules/Routing/useCases/sidechain/getAllSidechainRoutes.ts`

**Needed:** Extend `getTrackLatency` to consult sidechain routes for
the `trackId`: if there exists a route `route.sourceTrackId === trackId`,
include the latency of each `route.targetTrackId` in the
`maxDownstreamMs` accumulator. Add a regression test with a kick→bass
sidechain that asserts the kick track's `totalLatencyMs` reflects the
compressor block-size.

### 14. `renderOffline` ignores pre-fader and uses different sidechain
gain semantics than the live engine

**Problem:** `renderOffline.ts:163-172` always taps post-fader for
sends (comment at `:167` admits "deferred"). Live engine respects
`send.preFader` (`createWebAudioEngine.ts:396-407`). Bouncing a
project with pre-fader sends produces different audio than playing
it. Separately, `renderOffline.ts:183` reads `r.gain` for sidechain
gain; live engine ignores `r.gain` and hard-codes 1.

**Representative files:**

- `src/modules/Arrangement/useCases/freezeBounce/renderOffline.ts:163-172,182-187`
- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:396-407,457-461`

**Needed:** In `renderOffline`, branch the send tap on `send.preFader`
(connect from a "pre-fader" point of the offline track strip — i.e.
the gain node before automation). Reconcile sidechain gain semantics:
either both honour `r.gain` (preferred) or both ignore it (then
delete the field; see #7). Add tests for both paths.

### 15. `setSidechainRoutes` race against engine readiness

**Problem:** `setSidechainRoutes.ts:6-19` unwires every existing route
synchronously, replaces the store, then wires every new route. If the
engine is in `fallbackMode` (audio context creation failed,
`createWebAudioEngine.ts:67`), every wire/unwire silently early-returns
and the engine state diverges from the store with no recovery. Same
issue if called before `engine.initialize()` resolves.

**Representative files:**

- `src/modules/Routing/useCases/sidechain/setSidechainRoutes.ts:6-19`
- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:438-470`
- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:67-71`
  (fallback path)

**Needed:** Either gate the use case on engine readiness (read
`engineState.isReady`), queue the wire calls, and replay on engine
ready; or document the contract that callers must wait for engine
initialisation. Add a test that calls `setSidechainRoutes` in fallback
mode and asserts a recoverable state (warning logged, store still
correct).

### 16. `getSidechainRoutesForTrack` mixes incoming and outgoing

**Problem:** `useCases/sidechain/getSidechainRoutesForTrack.ts:9` returns
routes where the track is **either** source or target. Callers
(`handleRemoveSidechainRoute.ts:6-9`) then re-filter by
`r.sourceTrackId === payload.sourceTrackId`, undoing the wider net.
The function name doesn't tell either of these stories.

**Representative files:**

- `src/modules/Routing/useCases/sidechain/getSidechainRoutesForTrack.ts:4-10`
- `src/modules/Arrangement/handlers/device/handleRemoveSidechainRoute.ts:5-9`

**Needed:** Split into `getOutgoingSidechainRoutes(trackId)` and
`getIncomingSidechainRoutes(trackId)`. Or rename the current to
`getSidechainRoutesInvolvingTrack` and add an explicit `direction`
parameter. Update callers.

### 17. AGENTS.md function-signature rule violated across the module

**Problem:** Multiple use cases take >1 positional parameter; AGENTS.md
mandates a single object parameter named `<FunctionName>Input`.

**Representative files:**

- `src/modules/Routing/useCases/busControls/setBusGain.ts:3` (2 args)
- `src/modules/Routing/useCases/busControls/setSend.ts:3` (4 args)
- `src/modules/Routing/useCases/sidechain/addSidechainRoute.ts:31-36`
  (4 args)
- `src/modules/Routing/models/SidechainRoute.ts:18-24` (5 args)
- `src/modules/Routing/useCases/sidechain/addSidechainRoute.ts:7-29`
  (3 args, internal helper)

**Needed:** Refactor each to a single object param. Define
`<FunctionName>Input` immediately above each function (per AGENTS.md
"Function Signatures"). Update call sites.

### 18. `events/index.ts` is a stub with no exports

**Problem:** `events/index.ts:1` is a single comment line (`// no public
events`). The folder exists but contributes nothing.

**Representative files:**

- `src/modules/Routing/events/index.ts`

**Needed:** Decide whether Routing should publish events
(`routing.sidechain.added/removed/replaced`, `routing.send.changed`,
`routing.bus.added/removed`). If yes, define them; if no, delete the
folder. The current state is dead surface.

### 19. `addSidechainRoute` `targetParameterId` parameter has no entry point

**Problem:** The function takes `targetParameterId = 'threshold'`
(`addSidechainRoute.ts:35`), but the AppAction payload at
`Command/models/AppAction.ts:274` is
`{ sourceTrackId, targetTrackId }` only. The parameter is
plumbed down to the model but no caller can ever set it — except
demo-project builders, which always omit it.

**Representative files:**

- `src/modules/Routing/useCases/sidechain/addSidechainRoute.ts:31-36`
- `src/modules/Command/models/AppAction.ts:274-275`
- `src/modules/Arrangement/handlers/device/handleAddSidechainRoute.ts:11`

**Needed:** Either expand the action payload to expose
`targetParameterId?: string` and forward it, or drop the parameter
from the use-case signature. Pair with #7 (the field is similarly
unread).

### 20. `RoutingGraph` view does not announce changes

**Problem:** Adding/removing a sidechain or send re-renders the SVG in
`Workspace/presentations/views/RoutingGraph.tsx:187-360` but emits no
`role="status"` / `aria-live` announcement, and the cycle-error path
(`SidechainCycleError` thrown by `addSidechainRoute`) bubbles up
uncaught from `handleAddSidechainRoute.execute`
(`handleAddSidechainRoute.ts:7-13`) — the user gets no feedback.

**Representative files:**

- `src/modules/Workspace/presentations/views/RoutingGraph.tsx`
- `src/modules/Arrangement/handlers/device/handleAddSidechainRoute.ts:7-13`
- `src/modules/Routing/errors/RoutingErrors.ts`

**Needed:** In the handler, catch `SidechainCycleError` /
`DuplicateSidechainRouteError` and call `notifyUser(...)`. In the
graph view, wrap the SVG in a `role="img" aria-label`-d region (it has
this already at `:276`) and add an `aria-live="polite"` companion
that announces "Added send X to Y" / "Removed sidechain". Out-of-scope
for the Routing module strictly speaking, but the contract belongs to
Routing's errors.

### 21. Test mock paths target `engineAccess/<file>` instead of the
barrel

**Problem:** `__tests__/busControls.spec.ts:13-21` and
`__tests__/sidechain.spec.ts:28-33` mock the AudioEngine via
`#/modules/AudioEngine/useCases/engineAccess/<file>`. Production code
imports from `#/modules/AudioEngine/useCases` (the barrel). The mocks
do work because Vitest module-level mocks intercept the deep import
that the barrel itself uses to re-export, but renaming any
`engineAccess/<file>.ts` file (or moving it) breaks the mock without
breaking production — silent test rot.

**Representative files:**

- `src/modules/Routing/useCases/__tests__/busControls.spec.ts:13-21`
- `src/modules/Routing/useCases/__tests__/sidechain.spec.ts:28-33`
- `src/modules/Routing/useCases/__tests__/hydrateSidechainRoutes.spec.ts`
  (this one mocks `'../../stores/sidechainStore'` correctly)

**Needed:** Mock at the barrel path the production code actually uses
(`#/modules/AudioEngine/useCases`). Add a positive-path test for the
real "wire after add" / "unwire after remove" effect.

### 22. `setSend` engine-side: zipper noise on first set, glitch on
pre/post-fader toggle

**Problem:** `createWebAudioEngine.ts:405` assigns
`sendGain.gain.value = level` directly when creating a send (zipper
noise on parameter step). `:390-400` disconnects the existing send
gain before connecting the new tap on pre/post-fader toggle — between
those two synchronous calls the engine emits one block of silence.
The Routing-side use case is too thin to ramp/crossfade.

**Representative files:**

- `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:376-410`
- `src/modules/Routing/useCases/busControls/setSend.ts:3-5`

**Needed:** In the engine path, ramp the send's gain from 0 to
`level` over ~10 ms on first set (use `setTargetAtTime` at create
time too). For pre/post-fader toggle, create the new tap's gain
node at 0, ramp it up while ramping the old tap's gain down,
disconnect the old node after the ramp completes. The Routing-side
use case is unchanged (still a thin pass-through), but a test should
cover the smooth transition by inspecting the gain ramp parameters.

### 23. Test casts `as unknown as Parameters<typeof setSidechainRoutes>[0]`

**Problem:** `__tests__/sidechain.spec.ts:117` uses
`[newRoute] as unknown as Parameters<typeof setSidechainRoutes>[0]`
to bypass the missing `gain: number` field on the fixture — AGENTS.md
"TypeScript — soundness" forbids `as unknown as`.

**Representative files:**

- `src/modules/Routing/useCases/__tests__/sidechain.spec.ts:117`

**Needed:** Add `gain: 1` to the fixtures (and `id` if missing). Drop
the cast.

### 24. `removeSidechainRoute` does not validate route existence

**Problem:** `removeSidechainRoute.ts:5-19` looks up the route by `id`
and only calls `unwireSidechainRoute` if found, but always writes the
filtered routes back. If the route isn't in the store, the engine call
is skipped. If the engine has a stray connection that doesn't have a
corresponding store entry (issue #15 race), the engine entry is never
cleaned up.

**Representative files:**

- `src/modules/Routing/useCases/sidechain/removeSidechainRoute.ts:5-19`

**Needed:** Either also iterate engine state on a "compact" path, or
document the contract "store is the source of truth, engine sync is
best-effort". A `compactSidechainConnections` use case that diffs
engine state against store state would help.

### 25. `addSidechainRoute` writes the store before wiring the engine

**Problem:** `addSidechainRoute.ts:51-54` writes
`sidechainStore.set(...)` _before_ calling `wireSidechainRoute`. If
`wireSidechainRoute` throws (it can't today — it early-returns silently
on missing strips, see `createWebAudioEngine.ts:441-444` — but the
contract should not depend on that), the store has the route while the
engine doesn't. Subscribers of `sidechainStore` (e.g. the
`RoutingGraph` view) re-render with a route that has no audio effect.

**Representative files:**

- `src/modules/Routing/useCases/sidechain/addSidechainRoute.ts:51-54`

**Needed:** Wire the engine first, then write the store on success.
Or use a transactional pattern: write a `pending` route, await wire
success, promote to permanent. (Trivial today since both calls are
synchronous, but the order should reflect the contract.)

---

## Open questions

- [ ] Should `hydrateSidechainRoutes` be the place that re-applies the
      engine wiring on project load, or should that happen inside
      `Transport/useCases/ensureTrackStrips.ts` after track strips
      exist? Affects whether we can call `wireSidechainRoute` at hydrate
      time (engine may not be ready).
- [ ] Is the `gain` field on `SidechainRoute` intentionally unused (a
      placeholder for future per-route ducking depth) or stale? The
      offline render uses it; the live engine does not — which is the
      desired behaviour?
- [ ] Should bus deletion cascade to also remove every track's
      `sends[]` entry that targeted the bus, or is that the
      `removeBus` AppAction's responsibility? There is no `removeBus`
      AppAction today.
- [ ] Should cycle detection over output + sends + sidechain live in
      Routing (and own a copy of the relevant track-store fields per
      Model isolation), or should `getUpstreamSubgraph` move to
      AudioEngine? It currently lives in Arrangement and crosses
      module boundaries the wrong way.

---

## Risks

- **Silent functional regressions hide behind passing tests.** Issue
  #12: 9 of 17 specs assert nothing meaningful. Issues #1, #2, #3 are
  "pass tests, fail in prod" bugs — the smoke specs cannot detect them
  by construction.
- **Saved-project sidechain compression is silently broken** (issue
  #1). Anything that relied on a sidechain route through CRDT load
  (export → reimport, multiplayer hydrate, project switch with the
  same project re-loaded later) plays back without sidechain ducking.
  A user re-opening a kick-pumping bass project hears a wall of bass
  with no compression.
- **Send removal leaks audio to the bus** (issue #2). Live audio path
  diverges from UI state, making "remove send" untrustworthy. In a
  collaborative session this is worse: track A removes the send to
  bus C, the action replicates, every peer's UI updates, every peer's
  audio engine still routes to bus C until the next reset.
- **Bus deletion leaks engine state forever within a session** (issue
  #3). Re-creating a bus with the same id rebinds to the orphan node
  with stale gain/meter state.
- **Real feedback loops bypass cycle detection** (issue #4). Web
  Audio's behaviour with cycles is implementation-defined and tends
  toward DC blocks + denormal smoothing — silent at first, then a
  growing low-frequency rumble.
- **PDC drift on sidechain pumping** (issue #13). Subtle but audible
  on tight EDM mixes; user has no way to discover the cause.
- **Bounce ≠ playback** (issue #14). The exported audio of a project
  with pre-fader sends or non-unity sidechain gain differs from the
  monitor mix. Producer-killer.
- **Architectural drift accumulates** (issues #10, #11, #17, #18,
  #23). AGENTS.md violations are widespread; left alone they normalise
  deep imports, model leakage, and positional-arg signatures across
  every consumer.

---

## Suggested approaches

- **Land issue #1 first.** Add a `bootstrapSidechainEngine` use case
  (or fold it into `hydrateSidechainRoutes`) and wire it into project
  load after `ensureTrackStrips`. Add a regression test that hydrates
  a fixture project with one sidechain route and asserts
  `wireSidechainRoute` was called.
- **Add `removeSend` and `removeBusStrip` use cases** (issues #2, #3)
  in `Routing/useCases/busControls/`. Each is a 3-line passthrough to
  the engine, plus a barrel export, plus a behavioural test. Update
  the `Arrangement`-side `removeSend` use case and `removeTrack` to
  call them.
- **Unify cycle detection** (issue #4). Either move
  `getUpstreamSubgraph` to a shared `services/` location both modules
  can read (currently AGENTS.md says no — services are private to the
  owning module), or duplicate the walk into Routing as
  `services/computeUpstreamTracks.ts` and have `addSidechainRoute` +
  `setSend` consult it. Add tests for: output-then-sidechain loop,
  bus-bus loop, valid topology.
- **Extend latency compensation** (issue #13) with a sidechain edge
  walk. One ~10-line addition to `getTrackLatency` plus a test.
- **Introduce a Routing root barrel** (issue #10). Migrate every
  cross-module call site in one commit (per AGENTS.md "Reflex Rule",
  with `pnpm deps:validate` after every 10 files). Delete the
  cross-module `models/SidechainRoute.ts` import (issue #11) at the
  same time by defining a local Arrangement-side type.
- **Decide on `gain` and `targetParameterId`** (issues #7, #19).
  Either commit to per-route gain + multi-parameter routing (then
  thread through the engine and the AppAction), or strip them.
- **Replace the smoke tests** (issue #12) with behavioural tests at
  the per-file level. Delete the umbrella `__tests__/sidechain.spec.ts`
  and `__tests__/busControls.spec.ts` once each use case has its own
  meaningful spec.
- **AGENTS.md compliance pass** (issues #10, #11, #17, #18, #23) as
  a single follow-up sweep — small mechanical refactors. Convert
  positional args to objects; remove `events/index.ts` if no events;
  drop the `as unknown as Parameters<…>[0]` cast.

---

## Recommendation

Start with **issue #1 (sidechain wiring not re-applied on hydrate)**.
It is the most user-visible correctness bug — saved projects play
back without sidechain processing — and the fix is small (one new
loop in `hydrateSidechainRoutes` or one new call site in
`ensureTrackStrips`). Land it as a standalone commit with a
regression test that hydrates a fixture and asserts the wiring.

Then tackle **issues #2 and #3 (send/bus removal leaks)** as a pair —
both are missing-passthrough bugs with the same shape (`Routing/useCases/busControls/{removeSend,removeBusStrip}.ts`).
Each is ~5 lines plus a test plus a caller migration. Together they
close the most embarrassing UI-vs-audio divergences.

After those land, the next session can decide between the
"correctness pass" (issues #4 cycle detection, #13 PDC, #14 bounce
parity, #15 fallback race) and the "architecture pass" (issues #10
root barrel, #11 model isolation, #12 smoke tests, #17 signatures,
#18 events stub, #19 dead parameter, #23 cast). They are independent.

The **highest-leverage** single change is probably issue #4 (unify
cycle detection across sidechain + sends + output): it's the only
place in the codebase that can prevent a real Web Audio feedback
loop, and the data needed already exists in the upstream-walk
service.

---

## Resolved

_No issues resolved yet._
