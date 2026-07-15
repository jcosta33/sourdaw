---
type: spec
id: SPEC-crdt-multi-document
title: CRDT multi-document architecture and lazy loading
status: draft
owner: The Sourdaw team
sources:
    - self
---

# CRDT multi-document architecture and lazy loading

## Intent

Move project state from one giant root document toward a small root plus demand-loaded child
documents, so startup cost and memory pressure drop on large projects — while merge lineage
detection and incremental auto-save remain correct across every active document.

## Non-goals

- Multi-user real-time collaboration.
- Replacing Automerge with a new storage engine.
- The semantic history panel and compensating undo (a separate concern).

## Requirements

### AC-001 — Child documents load on demand

A child CRDT document must load only when it is visible in the viewport, selected, or needed
for playback prefetch.

Verify with: `pnpm test:run -- crdtLazyLoad`

### AC-002 — Idle child documents evict under LRU

An inactive child document must unload under an LRU cache policy.

Verify with: `pnpm test:run -- crdtLazyLoad`

### AC-003 — The audio engine never blocks on a child-doc fetch

The projection layer must prepare engine-ready snapshots ahead of playback so the audio
callback never waits on a child-document fetch.

Verify with: `pnpm test:run -- crdtProjection`

### AC-004 — Merge lineage uses shared heads, not trial merge

Lineage detection must decide shared history from intersecting heads or bundle metadata
rather than cloning and fully merging documents in memory.

Verify with: `pnpm test:run -- crdtMerge`

### AC-005 — Auto-save persists every active document

Incremental auto-save must write all active CRDT documents, not only the root document.

Verify with: `pnpm test:run -- startCrdtAutoSave`

### AC-006 — No cross-module internal imports

This feature must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

### AC-007 — Child-doc projection pre-loads a look-ahead window

The projection layer must pre-load child documents for the active window plus a look-ahead of at least 2 seconds ahead of the playhead.

Verify with: `pnpm test:run -- crdtProjection`

### AC-008 — Branch swaps preserve the stable root document key

When the active branch changes, the branching repository must serialize the
switch with all CRDT mutations and drain every deferred write to the outgoing
root before snapshotting it. A write scheduled before the switch must remain in
the outgoing branch and must never land in the incoming branch. Only after that
barrier may the repository hot-swap the underlying Automerge `Doc` behind the
fixed `DOC_PREFIX_ROOT` identifier, so UI, audio projection, and storage
consumers continue to address the same root key rather than being retargeted to
per-branch document IDs. Auto-save and merge-lineage detection must still
address the real per-document IDs, not the fixed alias.

Branch creation, switching, and merging must reject when their full persistence
step fails. Before rejecting, they must restore every document and branch-store
value changed by the operation, reload durable persistence authority, and
re-project the recovered state.

Verify with: `pnpm test:run src/modules/CrdtDocument/useCases/crdtBranching/__tests__/branchingPersistenceAdapter.spec.ts src/modules/CrdtDocument/useCases/crdtBranching/__tests__/forkProjectBranch.spec.ts src/modules/CrdtDocument/useCases/crdtBranching/__tests__/mergeBranch.spec.ts src/modules/CrdtDocument/useCases/crdtBranching/__tests__/switchBranch.spec.ts`.

## Open questions

- [ ] (non-blocking) LRU eviction thresholds for the child-doc cache (entry count vs bytes), pending measurement on a 500-track project.
- [ ] (non-blocking) (restored detail) **`.sdaw` forward-compatibility / migration is unspecified.** The decoder treats `version=1` as a hard wall — any version mismatch throws `Unsupported .sdaw version` (`decodeSdawFile.ts:29`), so when `v2` ships every existing file becomes a hard error. There is no migration registry, no "open as read-only" fallback for older versions, no embedded originating-Automerge-binary-version (Automerge's own binary format is independently versioned, so files made on a different Automerge release may fail even at `.sdaw v1`), and no overall length sanity check on `docCount` (a bit-flip is caught only via stream-overrun). Splitting the root into a root-plus-child bundle increases the doc count and changes what a `.sdaw` file contains, so a multi-document landing must decide the migration/versioning strategy before it changes the on-disk shape. The strategy (registry vs read-only fallback vs both, and whether to embed the Automerge release version) is not yet decided.
- [ ] (non-blocking) (deferred-gap from intake/implementation-gaps.md) §3.2 Media Channels & Discovery — **Automerge document compaction strategies to prevent memory bloat over long sessions.** As an editing session runs for hours, the Automerge change history accumulates and the in-memory document footprint grows; a compaction pass (e.g. periodic save/reload to drop superseded change history, or Automerge's own compaction primitives) must bound this growth so a long-lived session does not exhaust memory. This is directly on-theme with this spec's goal of dropping memory pressure on large projects, but the compaction trigger (time-based vs change-count-based vs idle), what it does to each active child document, and its interaction with the LRU eviction policy (AC-002) and all-active-document auto-save (AC-005) are not yet decided. The strategy choice must not break merge-lineage detection (AC-004) — compacting away change history must still leave heads/bundle metadata intact for shared-history detection.
- [ ] (non-blocking) (deferred-gap from intake/spec-of-the-gaps.md) §2.1 CRDT & Persistence (source spec `crdt.md`) — bundles three gaps, two of which this spec already covers and one it does not: (a) **`CrdtHistory` and `crdtLazyLoad.ts` enhancements** — the `crdtLazyLoad.ts` enhancements are covered by AC-001/AC-002/AC-007, but **`CrdtHistory`** (a CRDT-backed history facility) is not specified here and sits in tension with this spec's Non-goal "The semantic history panel and compensating undo (a separate concern)"; carried here so its source detail is not lost, deferred to the history/undo concern rather than folded into a requirement. (b) **Refactor `crdtMerge` to replace the Brute-Force Trial Merge anti-pattern** — already covered by AC-004 (shared-heads/bundle-metadata lineage instead of clone-and-fully-merge). (c) **Robust incremental auto-save** — already covered by AC-005 (incremental auto-save persists every active document, not only the root). No new requirement needed for (b)/(c); only `CrdtHistory` remains open.
- [ ] (non-blocking) (deferred-gap from intake/audit-deferred-fixes.md) Group E — State/persistence/telemetry. This group is mostly tangential to the multi-document CRDT architecture (it concerns store-adapter wiring and telemetry plumbing, not the root/child-document split), so it is carried here for losslessness rather than folded into requirements. Its four items: **E1** — per-instance plugin stores: `levainStore`/`toasterStore` move from `createStore<X>` to `createStore<Record<DeviceId, X>>` with per-device helpers (`getLevainState(deviceId)`, `setLevainParam({deviceId,param,value})`, `removeLevainState(deviceId)`, etc.), `getToasterControls(deviceId)` takes an explicit deviceId, the "find the first toaster" lookup in `loadToasterKit.ts` is removed, `fermenterStore` is already deviceId-keyed (confirm). **E2** — `kneadStore` persists via Automerge: adopt `createAutomergeStorage<KneadStoreState>({ docId: 'project', key: 'sourdaw-knead', toCrdt })` where `toCrdt` strips `isAnalyzing`/`analysisProgress` and keeps `activeClipId` + `clips`; reload restores pitch edits (Knead pitch edits are project truth that must travel with the project). The open sub-question from the source: does the existing `'project'` doc have room or does Knead need its own doc? Default reuse `'project'`. This is the one part that touches CRDT persistence — if multi-document lazy loading lands, a per-clip Knead store may want to live in (or alongside) the relevant child document rather than the root `'project'` doc. **E3** — `actionHistoryStore` persists via `createLocalStorage<ActionHistoryState>('sourdaw-action-history')` (local-device, not collaboration-relevant), bounded to the most recent 200 entries; adds key `'sourdaw-action-history'` to `LocalStorageKeys.ts`. **E4** — Fermenter telemetry rides a per-instance SAB ring (via `telemetryAllocator`) sampled at UI/rAF rate instead of per-audio-tick `setFermenterTelemetry` store pushes; components subscribe via `useStoreSelector(fermenterStore, (s) => s[deviceId])` with a shallow-equal `equalityFn`. (E1/E4 are state/telemetry concerns with no bearing on the document-architecture requirements; tracked here only so the umbrella reference resolves.)

## Affected areas

- `src/modules/CrdtDocument/useCases/crdtLazyLoad.ts`
- `src/modules/CrdtDocument/useCases/crdtMerge.ts`
- `src/modules/CrdtDocument/useCases/startCrdtAutoSave.ts`
- `src/modules/CrdtDocument/useCases/crdtProjectLifecycle.ts`

## Known risks

Present-state observations from the CrdtDocument module audit that bear on the multi-document
architecture, projection, persistence, and auto-save surfaces this spec touches. These are
observations (file:line) of what is true today, not requirements; they bound how much of the
existing surface a multi-document change can lean on.

- **Stale-doc-id mutation notifies before it throws.** `changeDoc` throws `Document not found:
${id}` on a stale id (`automergeRepository.ts:175`); the use-case caller (`mutateCrdtDoc`)
  does not catch, and the projection bridge fires listeners _before_ the error returns — so a
  listener can observe a mutation that never actually applied. No stale-id test exists. (audit
  #12/#33)
- **`createCrdtProject` leaves stale `branchStore` records.** It clears the in-memory docs and
  rewrites the bundle (`crdtProjectLifecycle.ts:19-22`), and `saveAllToIdb`'s `store.clear()`
  incidentally drops old `branch_<uuid>` bytes from IDB — but `branchStore` (localStorage-backed)
  keeps stale `BranchRecord` entries pointing at now-non-existent docs, so a later
  `switchBranch(<stale-id>)` throws `Branch document not found`. (audit #24/#29)
- **`autoSaveHealth` is a mutable object literal, not a `Store`** (`startCrdtAutoSave.ts:22`):
  `export const autoSaveHealth = { consecutiveFailures: 0 }` can be read and written but offers no
  subscription, so UI cannot reactively observe `consecutiveFailures` — it must poll or never
  update. (audit #40)
- **`mergeRemoteDoc` returns void with no convergence assertion** (`automergeRepository.ts:196`):
  a parseable, no-change binary still triggers `notifyListeners(id)`, rehydrating every store for
  nothing. There is no "did this binary advance the heads" check. (audit #13)
- **`loadAll` synchronous fallback re-`save+load`s every doc as an in-place compact on the main
  thread** (`automergeRepository.ts:368-370`), double-allocating each doc (full save → full load);
  on a 50-doc project with multi-MB roots this can pause the main thread for hundreds of ms — the
  pause the worker was meant to avoid. (audit #10)
- **Listener errors are swallowed without back-off** (`automergeRepository.ts:464`): a
  perpetually-throwing listener is logged once per change with no per-listener back-off or
  unsubscribe-on-repeated-failure, so it floods logs on every change. (audit #16)
- **Projection bridge over-hydrates and discards the docId hint**
  (`projectProjection.ts:11-23,38-42`): `projectCrdtToStores` ignores the `docId` argument the
  listener is handed and re-hydrates a hardcoded ~10-store list on every change; a project-state
  store added in another module is silently missed (no registry). This is the hot projection path
  AC-003/AC-007 build on. (audit #38/#39)
- **Subscribe/notify does not scale**: three concurrent subscribers (`startCrdtAutoSave`,
  `setupProjectionBridge`, Collaboration's `automergeSync`) with no batching, scheduling, or
  microtask coalescing — every change triggers every listener, each of which may re-enter the
  repository (O(n²)-ish). Adding a fourth listener (inspector, history UI) compounds it. (audit #37)
- **`ActionHistoryAction.payload` is typed `unknown`** (`actionHistoryStore.ts:9`) despite being
  populated from typed `AppAction`s, so `revertAction` cannot validate the inverse payload shape
  against the action type. (audit #36 / Findings #59)
- **`importSdawFile` collapses four failure modes into one `null` return**
  (`crdtMerge/importSdawFile.ts:80-83`): file-read failure, decode failure, merge failure, and
  unrelated-project all return `null`, so `MergeResultDialog` cannot show a specific message even
  though it has distinct `success: false` rendering. (audit #21/#26)
- **Persistence-internal observations**: `hasCrdtDocsInIdb` uses `store.count()`, which counts
  `:incremental:` chunks as well as base docs (Findings #51); `loadIncrementalsFromIdb` is an O(n)
  full-store cursor scan, while compaction uses `saveAllToIdb`'s atomic clear-and-put transaction
  rather than a separate cleanup scan (#52); `saveDocToIdb` / `loadDocFromIdb` /
  `loadIncrementalsFromIdb` are dead code with no production importer (#29/#53);
  `getPersistenceBackend` returns `'native' | 'browser'` but the lifecycle always uses the IDB path,
  so the native (Tauri) backend dispatch is a stub (#42/#55).
- **Incremental-key delimiter is unvalidated against a DocId containing `:`.** Ordering parses
  `parseInt(key.split(':').pop())` and classification keys off the `:incremental:` substring
  (`automergeRepository.ts:352-356`, `crdtWorker.ts:52-56`); a `DocId` that itself contains `:`
  makes the prefix split ambiguous and could misclassify a base doc as an incremental chunk. There
  is no rule that `DocId` excludes `:`. (audit #18)
- **Bundle map iteration order diverges after a storage round-trip.** IDB recreates the bundle in
  key-sorted order while `.sdaw` encode/decode iterates in insertion order (`encodeSdawFile.ts:36`);
  because root-id is inferred by picking the last-iterated `'root'`-prefixed base doc, the inferred
  root is order-dependent after an IDB → `.sdaw` → IDB round-trip. (audit #20)
- **Test-quality gaps on the touched surface**: `BranchManagerDialog.spec` renders without the
  required `onClose` prop (runtime TypeError on close-button click) and asserts only
  `expect(document.body).toBeTruthy()` — zero behavior (Findings #31/#43); `automergeRepository.spec`
  uses 8 `as any` casts and a no-op `Worker` mock whose listeners never fire, so `loadAll` /
  `mergeBundle` / `transactSnapshot` / `mergeRemoteDoc` are never exercised (#33/#46);
  `crdtPersistence.spec` uses four `let _: any` (#34/#47); the `changeDoc` test omits the `message`
  argument, leaving the `change(doc, {message}, fn)` branch uncovered (#70).
- **Worker post protocol is typed `Record<string, unknown>`** (`automergeRepository.ts:30,47`),
  erasing `WorkerInMsg`: a typo in the message `type` silently sends a no-op and the Promise never
  resolves (the worker never posts back). The worker singleton holder is also not race-safe under
  HMR — on reload the previous worker is not terminated and no `dispose()`/`terminate()` is exposed.
  (audit #35/#48, #50)
- **`saveSnapshot` allocates the full bundle with no de-dup, streaming, or chunking**
  (`saveSnapshot.ts:12`), and `transactSnapshot` does it twice (per-doc clone-and-save plus the
  post-mutation save) — routinely ~2× the project size in transient binaries on the DSO undo path.
  (Clone-all #14 and concurrency #15 are recovered elsewhere; the ~2× allocation is restored here.)
  (audit #35/#5/#11)
- **`revertAction` is compensating, not rewinding** (`revertAction.ts:6-12`): it re-issues the
  inverse via `executeAppAction`, which pushes a _fresh_ history entry, so the journal momentarily
  shows both the original (`reverted=true`) and the inverse. The source documents this as
  intentional, but it is unverified because `revertAction` has no real test (#61). (audit #63)
- **Repository docs are type-erased.** Docs are stored as `AnyDoc = Record<string, unknown>` with
  `as Doc<TDoc>` / `as Doc<AnyDoc>` casts at seven sites (`automergeRepository.ts:119,162,173,179,
188,202,206`); the repository has no type-aware handle on the docs it stores, so projection and
  `mutateCrdtDoc<DocShape>` callers each cast independently and shape drift is uncaught. (audit
  #11/#66)

## Dropped from sources

- A full in-memory trial merge for lineage detection — replaced by shared-heads inspection (AC-004) to avoid O(N) graph overhead and large memory use.
- Root-only incremental auto-save — replaced by all-active-document persistence (AC-005) so branch child documents are protected.
- Refactor ordering (track docs → MIDI/automation → plugin states) — sequencing guidance for the implementer, not a behavioral requirement.
