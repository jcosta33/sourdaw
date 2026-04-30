# CrdtDocument module audit

## Scope

This audit covers `src/modules/CrdtDocument/` in full — the Automerge
repository, project lifecycle (create / load / persist / compact / native
backend dispatch), branching, .sdaw export/import, snapshot save/restore,
DSO action history & revert, projection bridge, IndexedDB persistence,
native (Tauri) persistence stubs, the CRDT worker, store helpers
(`actionHistoryStore`, `branchStore`, `semanticChangeContext`), errors,
events, the two presentation dialogs, and every spec in `__tests__/`.

It is an adversarial review focusing on:

- CRDT convergence correctness
- Tombstone GC and incremental compaction
- Schema migration / format versioning
- Document snapshot races (in-flight async vs in-memory state)
- Observer chain memory leaks
- Type soundness, dead code, AGENTS.md architectural violations,
  testing gaps

It explicitly excludes the Collaboration module (which subscribes to
`subscribeToCrdtChanges`) and the legacy `Project/useCases/versionControl/*`
"snapshot" surface (mentioned only where it duplicates this module's
responsibility).

Related spec: none on disk.

---

## Goal

A correctness-first CRDT layer for the DAW:

- Exactly one canonical type module for `DocId` / `DocumentBundle` /
  `MergeResult` / `DOC_PREFIX_ROOT` / `DOC_BRANCHES`.
- A single, racing-safe `automergeRepository` whose mutations always
  notify exactly one observer chain and whose worker fallbacks preserve
  invariants (root id detection, listener count, in-memory consistency).
- Snapshot capture (`transactSnapshot`) that survives concurrent local
  edits without losing or duplicating dirty docs.
- Persistence: IndexedDB and Tauri native backends share a single
  read/write contract; format versioning is documented and enforced.
- Public surface (`<Module>/index.ts`) is the **only** entry for cross-
  module callers (AGENTS.md "Cross-module imports MUST only target the
  destination module's root `index.ts`"). Internal absolute imports use
  relative paths.
- Tests assert real behaviour: bundle round-trips, merge convergence,
  snapshot before/after dirty-set correctness, branch semantics, .sdaw
  decode of malformed inputs. No "should export X" smoke tests.
- AGENTS.md hard rules: no `any`/`as unknown as`/`as never`, no `useMemo`
  / `forwardRef`, type discriminated unions over optional fields, no
  duplicate models or use-case-type re-exports, one function per use-case
  / repository file.

---

## Relevant code paths

- `src/modules/CrdtDocument/` — **no root `index.ts`** (see issue #1).
- `models/CrdtDocumentTypes.ts`, `models/BranchTypes.ts`
- `useCases/crdtDocumentTypes.ts` (duplicate of `models/CrdtDocumentTypes.ts`)
- `useCases/index.ts` (only barrel-ish file the module exposes)
- `useCases/createCrdtDoc.ts`, `getCrdtDoc.ts`, `getCrdtDocIds.ts`,
  `hasCrdtDoc.ts`, `mutateCrdtDoc.ts`, `replaceCrdtDoc.ts`,
  `removeCrdtDoc.ts`
- `useCases/crdtProjectLifecycle.ts`
- `useCases/saveSnapshot.ts`, `restoreSnapshot.ts`
- `useCases/startCrdtAutoSave.ts`, `subscribeToCrdtChanges.ts`
- `useCases/semanticChangeContext.ts` (duplicate of
  `stores/semanticChangeContext.ts`)
- `useCases/getDsoSnapshotHandlers.ts`
- `useCases/revertAction/revertAction.ts`,
  `useCases/revertAction/canRevertAction.ts`
- `useCases/projection/projectProjection.ts`
- `useCases/crdtBranching/{forkProjectBranch, switchBranch, mergeBranch,
  deleteBranch, listBranches, getActiveBranch}.ts`
- `useCases/crdtMerge/{exportSdawFile, importSdawFile,
  mergeDocumentBundle, helpers}.ts`
- `useCases/sdawFileFormat/{encodeSdawFile, decodeSdawFile, helpers}.ts`
- `repositories/automergeRepository.ts`
- `repositories/crdtPersistence/*.ts` (10 files)
- `repositories/nativeCrdtPersistence/*.ts` (8 files)
- `workers/crdtWorker.ts`
- `stores/actionHistoryStore.ts`, `branchStore.ts`,
  `semanticChangeContext.ts`, `index.ts`
- `handlers/snapshot/handleRestoreDsoSnapshot.ts`
- `errors/{BranchError, SdawFormatError}.ts`
- `events/index.ts` (empty)
- `presentations/views/{BranchManagerDialog, MergeResultDialog}.tsx`,
  `views/index.ts`

---

## Current behavior

**No root barrel.** The module ships **without** a root `index.ts`. All
cross-module callers reach into `#/modules/CrdtDocument/useCases`,
`#/modules/CrdtDocument/stores`, `#/modules/CrdtDocument/models/...`,
or even `#/modules/CrdtDocument/useCases/<file>` directly (see issue
#1). AGENTS.md mandates a root `index.ts` per module.

**Two parallel type modules.** `models/CrdtDocumentTypes.ts` and
`useCases/crdtDocumentTypes.ts` are byte-equivalent: both define `type
DocId = string`, `type DocumentBundle = Map<DocId, Uint8Array>`, `type
MergeResult`, and the constants `DOC_PREFIX_ROOT` and `DOC_BRANCHES`.
Repositories import from `models/`; use cases (and external callers,
including `Command/models/AppAction.ts:1`) import from `useCases/`.

**Two parallel `semanticChangeContext` files.** `useCases/semanticChangeContext.ts`
and `stores/semanticChangeContext.ts` both export `setSemanticContext` /
`getSemanticContext` / `clearSemanticContext`. Each has its own private
`sessionState` module-level mutable. Production reads/writes the
`stores/` version via `Command/useCases/executeAppAction.ts` and
`infra/store/storage/createAutomergeStorage.ts`. The `useCases/` version
is **dead in production but tested in isolation**, so a regression in
the live one is not caught.

**`automergeRepository`.** Singleton instance owning a `Map<DocId,
Doc<AnyDoc>>`. All mutations route through `changeDoc` / `replaceDoc`
/ `mergeRemoteDoc` / `loadAll` / `mergeBundle` / `restoreSnapshot`,
each of which calls `notifyListeners(docId?)`. Heavy WASM operations
(`loadBundle`, `mergeBundle`) post messages to a singleton `Worker`
created lazily via the `crdtWorkerState = { worker: null, nextId: 0 }`
holder pattern. Worker failures fall back to synchronous
`_loadAllSync` / `_mergeBundleSync` on the main thread.

**Persistence.** `crdtPersistence/` opens a single IndexedDB database
(`sourdaw-crdt-docs`, version 1, store `documents`). `helpers.ts` caches
`_db` and `_dbPromise` at module scope. `saveAllToIdb` does
`store.clear()` then `put` for every doc. `saveIncrementalToIdb` writes
under a key `${id}:incremental:${Date.now()}-${random4}`. Compaction
runs after `incrementalSaveCount >= 50` or on demand. `nativeCrdtPersistence/`
provides 7 thin Tauri-IPC functions; only `isNativeCrdtAvailable` is
called from production — the other six are unused.

**Branching.** `branchStore` lives in localStorage (NOT in the CRDT) —
branches are session-scoped on the local device. `forkProjectBranch`
clones the root doc into a new `branch_<uuid>` doc id and writes it
into the same `automergeRepository`. `switchBranch` overwrites the
`root` slot in the repository with the branch's doc (without removing
the branch slot — see issue #6). `mergeBranch` merges the source
branch's doc into the current root and persists.

**.sdaw format.** Custom binary container with magic `SDAW`, 16-bit
little-endian `version=1`, 16-bit little-endian doc count, then per-doc
`<u32 id-len><id-bytes><u32 data-len><data-bytes>`. Decoder verifies
magic and version, otherwise throws `SdawFormatError`.

**Tests.** Distribution: ~20 spec files. Roughly half (~10 files) are
"should export <fn>" smoke tests — `forkProjectBranch.spec.ts`,
`switchBranch.spec.ts`, `mergeBranch.spec.ts`, `deleteBranch.spec.ts`,
`listBranches.spec.ts`, `getActiveBranch.spec.ts`, `revertAction.spec.ts`,
`startCrdtAutoSave.spec.ts`, `getDsoSnapshotHandlers.spec.ts`,
`exportSdawFile.spec.ts`, `importSdawFile.spec.ts`, `helpers.spec.ts`
(crdtMerge), `mergeDocumentBundle.spec.ts`, `encodeSdawFile.spec.ts`,
`decodeSdawFile.spec.ts`, `sdawFileFormat/helpers.spec.ts` — all of
shape `expect(subject.foo).toBeDefined(); expect(typeof subject.foo
=== 'function' || 'object').toBe(true)`. They run, they pass, they
prove nothing.

---

## Findings

1. **No root `index.ts`.** The module has no root barrel. AGENTS.md:
   "Cross-module imports MUST only target the destination module's
   root `index.ts`". Cross-module callers therefore drop into
   `useCases/`, `stores/`, `models/`, and even
   `useCases/crdtDocumentTypes` paths directly — every one of them is
   an architectural violation by AGENTS.md's wording.

2. **Two duplicated module types files.** `models/CrdtDocumentTypes.ts`
   and `useCases/crdtDocumentTypes.ts` are byte-identical. The split
   means repositories and use cases each import from a different file,
   so changes have to be made twice. Worse, models are supposed to be
   *strictly private* (AGENTS.md "Model isolation" / "models-private-cross")
   yet the `useCases/` duplicate exists *because* `useCases/index.ts`
   wants to re-export `DocId` / `DocumentBundle` / `MergeResult` —
   which is itself prohibited by "Use-case types stay private".

3. **Two duplicated `semanticChangeContext.ts` files with separate
   state.** `useCases/semanticChangeContext.ts:18` and
   `stores/semanticChangeContext.ts:21` each declare their own
   `sessionState = { currentContext: null }`. They are not aliased;
   they are independent modules with independent mutables. If anything
   ever imports the `useCases/` version (e.g. a future caller, or
   anyone hand-completing on `'#/modules/CrdtDocument/useCases'`'s
   exports), the two halves will silently disagree about "current
   context" and the storage layer will read `null` while the executor
   thinks it set a value. Today only the test imports the `useCases/`
   version; that test gives **false confidence** about the live one.

4. **Cross-module callers go through deep paths, not the (missing)
   barrel.** Top offenders:
   - `Command/models/AppAction.ts:1` imports from
     `#/modules/CrdtDocument/useCases/crdtDocumentTypes` — a deep
     `useCases/` path *and* a use-case-type import (also forbidden).
   - `infra/store/storage/createAutomergeStorage.ts:2` imports from
     `#/modules/CrdtDocument/models/CrdtDocumentTypes` — deep into a
     private folder (`models/` is "STRICTLY PRIVATE to its module").
   - `infra/store/storage/createAutomergeStorage.ts:14` imports from
     `#/modules/CrdtDocument/stores/semanticChangeContext` — deep
     into `stores/` past the `stores/index.ts` barrel.
   - Multiple files in `Command/`, `Project/`, `AiRuntime/`,
     `Workspace/`, `Collaboration/` import `#/modules/CrdtDocument/useCases`,
     `#/modules/CrdtDocument/stores`, or
     `#/modules/CrdtDocument/useCases/<file>` directly.

5. **`useCases/index.ts` re-exports types and constants** —
   `DocId`, `DocumentBundle`, `MergeResult`, `MutateCrdtDocInput`,
   `ReplaceCrdtDocInput`, `DOC_PREFIX_ROOT`, `DOC_BRANCHES`. AGENTS.md:
   "Do not `export type` from `useCases/` for other modules". The
   constants are runtime values (allowed), but the types must be
   redefined in each consumer (per the "Model isolation" / "Use-case
   types stay private" rules).

6. **`switchBranch` mutates `root` without preserving the original
   "main" doc, and never restores it on switch-back.**
   `crdtBranching/switchBranch.ts:30` does
   `automergeRepository.replaceDoc(DOC_PREFIX_ROOT, branchDoc)`.
   There is no symmetric save of the *current* root before
   overwriting it. If the user is on the `main` branch, edits, then
   switches to `feature-x`, the in-memory `root` becomes the
   feature-x doc and the **main branch's edits are lost from the
   `root` slot**. Switching back to main reads the slot named
   `branch_<main-uuid>` (which doesn't exist for `MAIN_BRANCH_ID =
   'main'` because main was never forked) — so `state.branches.find(b
   ⇒ b.branchId === 'main')` returns the seeded record with
   `rootDocId: 'root'`, and `automergeRepository.getDoc('root')`
   returns the *feature-x* doc still occupying that slot. The user
   sees feature-x state under "main".

7. **`forkProjectBranch` persists via direct `saveAllToIdb`,
   bypassing compaction and incremental tracking.** `forkProjectBranch.ts:49`
   calls `saveAllToIdb(bundle)` while `crdtProjectLifecycle.ts`
   carefully tracks `incrementalSaveCount` to drive periodic
   compaction. The fork path does not reset that counter. Following
   forks, the next incremental persist still increments toward 50
   from where it left off, so the counter no longer reflects "50
   incremental writes since last full save".

8. **`branchStore` is in localStorage; CRDT branches are not in the
   CRDT.** `stores/branchStore.ts:21` uses `createLocalStorage`. The
   metadata for branches lives outside Automerge, so:
   - It does **not** sync to peers via `subscribeToCrdtChanges`
     (which is why `Collaboration/sessionManagement.ts:114` has to
     manually create a `__branches__` Automerge doc to relay branch
     state). Two sources of truth for the same data.
   - It does **not** export with `.sdaw` (since `exportSdawFile`
     calls `saveAll()` on the repo, and `branchStore` isn't there).
     Importing a `.sdaw` therefore loses the original author's
     branches; the importer's `branchStore` (defaulting to "main"
     only) is preserved.

9. **`mergeBundle` worker fallback path silently changes
   convergence semantics.** `automergeRepository.ts:383` posts to the
   worker; on worker error it falls back to `_mergeBundleSync` (`:415`).
   The worker compacts the merged docs via `save(doc)` and returns
   binary, then the main thread re-`load`s them. The synchronous
   fallback does *not* compact (it leaves the merged docs in place),
   so the post-merge in-memory representation differs (different
   change graph state) between the two paths. Subsequent
   `getChanges(id, heads)` results therefore depend on which path was
   taken — non-deterministic for a CRDT layer.

10. **`loadAll` synchronous fallback re-`save+load`s every doc to
    "compact"; the worker path does this in the worker.** `automergeRepository.ts:368-370`
    runs `this.docs.set(id, load(save(doc)))` for every doc as a
    "compact in place" pass. This silently double-allocates every doc
    (full save → full load) on the main thread under the fallback
    path. For a 50-doc project with multi-MB roots this can pause the
    main thread for hundreds of milliseconds — the very thing the
    worker was meant to avoid.

11. **`AutomergeRepository.actorId` is generated per-singleton.**
    `automergeRepository.ts:105` initialises `actorId =
    crypto.randomUUID().replaceAll('-', '')` *at module load time*.
    On HMR (Vite dev), the module reloads but the in-memory CRDT
    docs persist in memory only via this same module — yet any
    bundle saved with the previous actor id and reloaded after HMR
    will have its lineage stamped with two different actor ids for
    the same logical session. `getActorId()` is exposed but never
    used by production code today, so the symptom only surfaces if
    Collaboration ever switches to actor-id-based author attribution.
    Worse: the actor id is **never written back into Automerge's
    `init({actor})`** — calls to `init<AnyDoc>()` use Automerge's own
    actor id, not this one. The class's `actorId` is a vestigial
    field that's "set" to a value that does nothing.

12. **`changeDoc` throws on missing doc; callers don't handle it.**
    `automergeRepository.ts:175` `throw new Error(\`Document not
found: ${id}\`)`. `mutateCrdtDoc` (the use-case) does not catch.
    `executeAppAction` (the AppAction execution path) treats handler
    throws as command failures, but the projection bridge fires
    listeners *before* the error returns — leaving the in-memory
    state consistent with the throw but the listener chain still
    notified for the last successful mutation. There's no test
    around "what happens when a stale doc id is referenced". For
    sync, this surfaces as the listener seeing a mutation that
    never actually applied.

13. **`mergeRemoteDoc` returns void, no convergence assertion.**
    `automergeRepository.ts:196` accepts `Uint8Array`, calls `load`
    then `merge`, replaces the slot. There is no "did this binary
    actually advance the heads" check — a malformed but parseable
    binary that yields a doc with no new changes still triggers
    `notifyListeners(id)`, kicking the projection bridge to
    rehydrate every store for nothing.

14. **`transactSnapshot` clones every doc up-front, including ones
    that are never dirtied.** `automergeRepository.ts:247` runs
    `clone(doc)` for *every* doc in the repository before the
    transaction starts, then keeps only the dirtied ones afterward.
    For a 50-doc project where a single-doc edit is wrapped, that's
    49 wasted clones — and `clone` performs a full O(n) Automerge
    state copy. For undo/redo flows that wrap every action, this is
    a hot path. A lazy clone-on-first-write would solve it.

15. **`transactSnapshot` does not synchronise across concurrent
    `transactSnapshot` calls.** Two concurrent invocations of
    `transactSnapshot` (e.g. two AI actions racing) each subscribe
    their own listener; the dirtied set of *each* listener will
    include changes made by the other. Their `before` bundles are
    captured at *different* clock points (`clone` runs on `await
fn()` start), so the "before" of the second transaction reflects
    state *after* the first transaction's mutations — even though
    the AI agent intended to roll back to the pre-action snapshot.
    Effectively: two parallel undo records, neither of which round-
    trips to the truly-pre state. There is no mutex / serial queue.

16. **Listener errors are swallowed silently.** `automergeRepository.ts:464`
    `notifyListeners` wraps each listener in `try { listener(docId) }
catch (error) { logger.warn(...) }`. A buggy listener that throws
    still allows other listeners to run, but the failure is logged
    once per call. There's no per-listener back-off or unsubscribe-on-
    repeated-failure policy. A listener that throws every time will
    log every change — flooding logs and masking real warnings. (The
    projection bridge has zero error boundary in
    `projectProjection.ts:38`, so any throw inside `projectCrdtToStores`
    will trigger this swallow.)

17. **`saveIncrementalToIdb` key collisions.** `saveIncrementalToIdb.ts:15`
    builds the key as `${id}:incremental:${Date.now()}-${4 random
chars}`. With ~36⁴ ≈ 1.6M random suffixes per millisecond and a
    `persistCrdtProject` debounce of 2s, collisions are vanishingly
    rare in normal usage — but the code still does `store.put(chunk,
key)` (which **overwrites** the existing key on collision). On a
    collision the older incremental chunk is silently lost, breaking
    convergence on next load. Use `add()` (which throws on duplicate
    keys) and surface, or use a strictly increasing counter.

18. **Incremental ordering by `parseInt(suffix.split(':').pop() ?? '0',
    10)` parses the *random* suffix when the timestamp portion
    doesn't get cleanly split.** The key is
    `${id}:incremental:${Date.now()}-${random}`, e.g.
    `root:incremental:1716000000000-ab12`. `automergeRepository.ts:353`
    splits on `':'`, takes the last segment (`1716000000000-ab12`),
    and `parseInt`s it — which yields `1716000000000` (the trailing
    `-ab12` is discarded). That works *most* of the time, but if a
    `DocId` ever contains `:`, the prefix split at `:incremental:`
    becomes ambiguous and the sort order is wrong. Worse, the
    `:incremental:` substring inside a DocId would mis-classify a
    base doc as an incremental chunk. There is no validation that
    `DocId` excludes the `:` separator.

19. **`_loadAllSync` infers the root id by `id.startsWith(DOC_PREFIX_ROOT)`.**
    `automergeRepository.ts:347` and `crdtWorker.ts:47`: any doc whose
    id starts with `'root'` (e.g. a hypothetical `rootMarker`,
    `root-replica-2`, etc.) is interpreted as the project root and
    overwrites `this.rootId`. There's no canonical "the root id is
    `DOC_PREFIX_ROOT` exactly" check. With multiple matching ids,
    the last one wins — non-deterministic across map iteration order.

20. **Bundle map iteration order is implementation-defined when
    storage round-trips.** `saveAllToIdb` writes via `store.put` per
    map entry; `loadAllFromIdb` recreates the map in
    `getAllKeys`/`getAll` order (which IDB defines as **key-sorted**,
    not insertion-ordered). The encoder/decoder for `.sdaw` (`encodeSdawFile.ts:36`)
    iterates `bundle` in insertion order. After a round-trip through
    IDB → `.sdaw` → IDB, the doc ordering shifts from insertion to
    key-sorted, which only matters because `_loadAllSync`'s root-id
    inference (issue #19) and the worker's processLoad
    (`crdtWorker.ts:42-50`) both pick the last-iterated `'root'-prefixed`
    base doc as root. Behaviour is order-dependent.

21. **`.sdaw` `version=1` with no migration path.** `sdawFileFormat/decodeSdawFile.ts:29`
    throws `Unsupported .sdaw version` for any version mismatch.
    There is no migration registry, no forward-compat strategy, no
    "open as read-only" branch for older versions, and no schema
    metadata about Automerge's binary format version. When `v2`
    ships, every existing user file becomes a hard error. Combined
    with the `.sdaw` not embedding the originating Automerge release
    version (binary format guarantees from upstream Automerge are
    *also* versioned), users will be unable to open files made on a
    different Automerge release even at `.sdaw v1`.

22. **`.sdaw` `version` and `docCount` are 16-bit unsigned ints.**
    `encodeSdawFile.ts:31` writes `setUint16` for the doc count.
    65,536 documents is more than any real project, but a malicious
    or corrupted file claiming `docCount = 65535` causes the decoder
    to loop until the stream is exhausted, throwing on `Truncated at
document N` — i.e. the decoder is correct here, but the format has
    no overall length sanity check (the file *should* equal `header
+ Σ doc lengths`). A bit-flip on `docCount` will be detected only
    via length-overrun.

23. **`.sdaw` per-doc `dataLen` is `u32` little-endian.** Maximum
    4 GB per document. Automerge docs can grow into the hundreds of
    MB but practical caps are far below 4 GB; no enforcement of an
    upper bound during decode. `bytes.slice(offset, offset + dataLen)`
    on a `Uint8Array` whose length is less than `offset + dataLen`
    just returns a shorter array — but the prior `if (offset + dataLen
> bytes.length)` check at `:60` rejects it, good.

24. **`exportSdawFile` uses `as unknown as BlobPart`.** `crdtMerge/exportSdawFile.ts:11`
    has an `eslint-disable sourdaw/no-type-assertion-escape` cast
    `bytes as unknown as BlobPart`. The justification ("Uint8Array<ArrayBufferLike>
    requires cast to BlobPart") is a 2024 TS type-narrowing
    regression around the new `Uint8Array<TArrayBuffer>` generic. The
    proper fix is to construct the Blob with `new Blob([bytes.buffer])`
    or to widen `BlobPart` shape via a typed wrapper — not to silence
    via `as unknown as`. AGENTS.md classifies this as a forbidden
    escape (TypeScript — soundness).

25. **`detectImportDecision` never returns `'branch'`.** `crdtMerge/importSdawFile.ts:23-57`
    declares `ImportDecision = 'merge' | 'branch' | 'separate'` and
    returns only `'merge'` or `'separate'`. The `'branch'` arm of
    the importer (`:71`) is dead. The detection logic is a single
    "shared lineage → merge, no shared lineage → separate" toggle
    despite the type promising three outcomes. Either the
    "diverged-but-related" detection needs implementing (compare
    common ancestors, recent divergence width) or the type and the
    branching arm should be removed.

26. **`importSdawFile` swallows all errors and returns `null`.**
    `crdtMerge/importSdawFile.ts:80-83` has a single `try { ... }
catch (error) { logger.warn(...); return null; }`. Three distinct
    failure modes (file read failure, decode failure, merge failure)
    collapse into one `null` return. The caller sees the same
    "unknown failure" for "user opened a non-.sdaw file" vs "the
    Automerge merge crashed". The `MergeResultDialog` has separate
    `success: false` rendering for these but the importer never
    surfaces them.

27. **`mergeBranch` does not validate target = current.** `crdtBranching/mergeBranch.ts:13`
    accepts a `sourceBranchId` and merges into "the current
    (target) branch", but never reads `state.activeBranchId`. The
    target is implicitly "whatever doc occupies `DOC_PREFIX_ROOT`",
    which (per issue #6) may not match the active branch's intended
    root. A merge can therefore land in the wrong target if the
    user just switched branches and the swap is partially complete.

28. **`deleteBranch` does not delete the branch's persisted bytes.**
    `crdtBranching/deleteBranch.ts:22` calls `automergeRepository.removeDoc(branch.rootDocId)`
    (in-memory) and updates `branchStore`. It never calls
    `saveAllToIdb` or any IDB delete — so the deleted branch's
    bytes remain in the IndexedDB store under
    `branch_<uuid>` until the next `compactProject()` (which uses
    `saveAllToIdb` that *clears* the store first, so it's
    eventually consistent). Until that happens, `loadAll` after a
    page reload re-materialises the deleted branch.

29. **`createCrdtProject` clears docs but does not clear IDB or
    `branchStore`.** `crdtProjectLifecycle.ts:19-22` calls
    `automergeRepository.createProject(name)` which does
    `this.docs.clear()`, then `compactProject()` which writes the
    fresh empty bundle. But: any pre-existing `branch_<uuid>` docs
    in IDB are blown away by `saveAllToIdb`'s `store.clear()` (good
    accidentally), while `branchStore` — backed by *localStorage* —
    retains stale `BranchRecord` entries pointing at non-existent
    docs. Subsequent `switchBranch(<stale-id>)` throws "Branch
    document not found".

30. **`autoSaveHealth.consecutiveFailures` is module-mutable but
    typed as a literal.** `startCrdtAutoSave.ts:22`
    `export const autoSaveHealth = { consecutiveFailures: 0 }`.
    Anyone importing it and writing to `consecutiveFailures` will
    succeed (TS doesn't prevent mutation of object literals in
    `const`). UI code reading `autoSaveHealth.consecutiveFailures`
    has no subscription mechanism — UI either polls or never
    updates. Should be a `Store<{consecutiveFailures: number}>` so
    `useStore` works.

31. **`startCrdtAutoSave` debounce timer is per-call, not per-doc.**
    A long burst of edits to multiple docs is debounced into a
    single `persistCrdtProject` for the *root* doc only (because
    `persistCrdtProject` writes only `DOC_PREFIX_ROOT`'s
    incremental). Edits to non-root docs (child docs created via
    `createCrdtDoc`, branch docs) are **never** auto-persisted. On
    crash, child-doc edits are silently lost.

32. **`persistCrdtProject` only persists `DOC_PREFIX_ROOT` (issue
    #31 root cause).** `crdtProjectLifecycle.ts:45`
    `automergeRepository.saveDocIncremental(DOC_PREFIX_ROOT)`. Any
    child doc registered via `createCrdtDoc` is left out. The next
    `compactProject()` (every 50 incrementals or on demand) does
    `saveAll()` and writes everything — but auto-save's bursty
    incremental path is single-doc.

33. **`loadCrdtProject` ignores branch state.** `crdtProjectLifecycle.ts:28`
    loads the bundle and hydrates the repository. There is no read
    of `branchStore.value?.activeBranchId` to pre-select which doc
    occupies `DOC_PREFIX_ROOT` after load. If the user was on a
    feature branch when they closed the tab, on reopen the project
    boots into the `root` doc as last serialised — which (per issue
    #6) is "whatever was last `replaceDoc`'d into root". Effectively,
    branch state on reopen depends on serialisation order.

34. **`getDsoSnapshotHandlers` is a single-entry map.** `useCases/getDsoSnapshotHandlers.ts:15`
    returns `{ restoreDsoSnapshot: handleRestoreDsoSnapshot }`. The
    indirection is appropriate per AGENTS.md ("`get<Module>Handlers`
    only merges pre-built maps"), but for one entry it's a minor
    code smell — fine as-is.

35. **`saveSnapshot` returns the live in-memory bundle as binary.**
    `useCases/saveSnapshot.ts:12` calls `automergeRepository.saveAll()`
    which serialises every doc once. There is no de-duplication,
    no streaming, and no chunking — for a 200 MB project the
    snapshot allocates a Map of 200 MB of `Uint8Array`s in one go.
    Used by `transactSnapshot` (which does this *twice*: once
    via the per-doc clone-and-save in `transactSnapshot`, once via
    the post-mutation save). The DSO snapshot/undo path therefore
    routinely allocates 2× the project size in transient binaries.

36. **`automergeRepository.reset()` does not clear listeners.**
    `automergeRepository.ts:441` clears `this.docs` and resets
    `rootId` but leaves `this.changeListeners` intact. After a
    session boundary (close project / open new project) any
    listeners registered in the previous session are still attached
    and will fire on the new session's edits. The Collaboration
    module relies on this in
    `sessionManagement.ts:200`-style cleanup, but the **AutomergeRepository
    itself does not enforce the contract**, leaving callers to
    remember to unsubscribe.

37. **`subscribeToCrdtChanges` is the only public subscribe API.**
    The `automergeRepository.onChange` is also exported via
    `setupProjectionBridge` (use case). Three concurrent
    subscribers run today: `startCrdtAutoSave`, `setupProjectionBridge`
    (Collaboration), and `Collaboration.automergeSync`. Any
    additional listener (a future inspector, history UI, etc.)
    creates O(n²) behaviour — every change triggers every listener,
    each of which may itself call into the repository. There's no
    fire-and-forget batching, no scheduling, no microtask coalescing.

38. **`projectProjection.projectCrdtToStores` re-hydrates 10 stores
    on every change.** `projectProjection.ts:25-31` synchronously
    iterates a hardcoded array of stores and calls `.hydrate()` on
    each. The list lives inside this module; if a new project-state
    store is added in another module, this list silently misses it.
    No registry, no change-aware routing — even a single-property
    edit on `projectStore` triggers `trackStore.hydrate()`,
    `automationStore.hydrate()`, etc. For complex projects that's a
    significant per-change cost.

39. **`projectCrdtToStores` ignores the `docId` hint passed to its
    listener.** `setupProjectionBridge` registers
    `automergeRepository.onChange(() => projectCrdtToStores())` —
    discarding the `docId` argument. The whole *point* of the docId
    hint (per `automergeRepository.ts:88-89` "Consumers use the hint
    to narrow per-doc work") is unused on the hot projection path.

40. **`forkProjectBranch` heads-as-`String` cast.** `crdtBranching/forkProjectBranch.ts:27`
    `getHeads(sourceDoc).map(String)`. Automerge `Heads` are
    already strings — `map(String)` is a no-op that papers over a
    type that should just be `Heads = string[]`. Smell, not a bug.

41. **`branchStore` allows `branches: []` after delete; `getActiveBranch`
    returns `null`.** `crdtBranching/deleteBranch.ts:27-30`
    filters out the deleted branch and assumes the active one was
    not deleted (line 19 enforces). But a future caller could
    mutate `branchStore` directly (it's a public-exported store)
    and leave `activeBranchId` pointing at a non-existent record —
    `getActiveBranch.ts:11` `find` returns `undefined` →
    coerced to `null`. Any UI that asserts an active branch breaks.

42. **`MergeResultDialog` is not exported from the views barrel.**
    `presentations/views/index.ts:1` exports only `BranchManagerDialog`.
    `MergeResultDialog` and its `MergeResultData` type are
    component-private but tested. The component is dead from the
    consumer's POV — no caller can import it without reaching
    inside `presentations/views/MergeResultDialog`. Either export
    it or delete it.

43. **`BranchManagerDialog` test renders without the required
    `onClose` prop.** `presentations/views/__tests__/BranchManagerDialog.spec.tsx:16`
    calls `render(<BranchManagerDialog />)`. The component declares
    `type BranchManagerDialogProps = { onClose: () => void }` and
    destructures `{ onClose }`. The render in the test should
    fail typecheck — that it doesn't suggests the test file is
    being typechecked with relaxed settings (or under a `react/jsx`
    configuration that doesn't propagate prop types). When `onClose`
    is then bound to a button's `onClick`, clicking the close
    button at runtime calls `undefined()` → TypeError.

44. **`BranchManagerDialog` test has zero meaningful assertions.**
    Every `it` block does `render(...)` then
    `expect(document.body).toBeTruthy()` (which is **always** true).
    Four tests, no behaviour exercised. Equivalent to "the test file
    parses."

45. **15 spec files are pure smoke tests.** Listed in "Current
    behavior". Each is shape `import * as subject from '../foo';
expect(subject.foo).toBeDefined()`. They report green for
    something that hasn't been verified at all. AGENTS.md
    "TypeScript — soundness — Tests": "Do not stop at 'defined' /
    'truthy' — assert the actual contract".

46. **`automergeRepository.spec.ts` casts to `as any` in 8 places.**
    Lines 52, 54, 59, 60, 68, 78, 79, 80, 86 each do `'child-1' as
any`, `mockDoc as any`, `(doc: any) =>`, etc. AGENTS.md "TypeScript
    — soundness" forbids `as any`. The tests are also super-shallow
    — they do not exercise `loadAll`, `mergeBundle`, `transactSnapshot`,
    `restoreSnapshot`, `mergeRemoteDoc`, `saveDoc`, `saveDocIncremental`,
    or `getChanges`. The most critical CRDT operation paths are
    untested.

47. **`crdtPersistence.spec.ts` uses `let mockTx: any`, `mockStore:
    any`, `mockDb: any`, `mockRequest: any`.** Lines 13-17. Three
    of `let _: any`. Same AGENTS.md forbidden escape.

48. **Worker post protocol uses untyped `Record<string, unknown>`.**
    `automergeRepository.ts:47` `function invokeWorker(msg:
Record<string, unknown>)`. The two valid messages are typed
    inside the worker (`WorkerInMsg`) but the caller side erases
    that. A typo in `type: 'mergeBundle'` (e.g. `'mergeBundles'`)
    would silently send a no-op message and the Promise would never
    resolve (the worker never posts back).

49. **Worker fallback condition is "any throw".** `automergeRepository.ts:317`
    catches *all* errors from `invokeWorker` and falls back to sync
    parsing. A worker that returns an error message
    (`{ type: 'error', message: ... }`) is rejected from
    `invokeWorker` (good), but a worker that sends an unrelated
    message — say one with a stale `id` from a previous attempt —
    is silently filtered (the `if (data.id !== id) return` at
    `:58`). With multiple in-flight requests on a slow worker, IDs
    could in principle wrap (after `2^53 - 1` requests) — not a
    real concern, but worth noting that the protocol assumes
    monotonically increasing `nextId`.

50. **Worker singleton holder isn't racing-safe under HMR.**
    `automergeRepository.ts:30` `crdtWorkerState = { worker: null,
nextId: 0 }`. On HMR, the module reloads but the previous worker
    is not terminated. The new module instance creates a new
    Worker; the old one continues to receive messages from any
    long-lived listener (none, today, but the pattern is fragile).
    No `dispose()` /`terminate()` API is exposed.

51. **`hasCrdtDocsInIdb` uses `store.count()`** which counts both
    base docs and `:incremental:` chunks. A project that has been
    cleared but whose final compaction wrote zero base docs (an
    empty project followed by clear) might still report `true` if
    a stray incremental was orphaned. Edge case, but the correct
    counter is "any *base* doc exists".

52. **`loadIncrementalsFromIdb` and `clearIncrementalsFromIdb` use
    cursor scans.** Each scans the entire object store for keys
    matching `${id}:incremental:`. With multiple docs and many
    incrementals, this is O(n) per call. An IDB index on a derived
    `docId` field would make it O(matches). Not a current
    performance issue, but `clearIncrementalsFromIdb` is called on
    every compaction — for a 50-incremental burst the scan is
    wasted work.

53. **`saveDocToIdb`, `loadDocFromIdb`, `loadIncrementalsFromIdb`
    are dead code.** No production import (verified by grep). They
    remain as part of the persistence API but are unused.

54. **`nativeApplyChange`, `nativeCreateProject`, `nativeGetDocumentState`,
    `nativeLoadBundle`, `nativeMergeBundle`, `nativeSaveBundle` are
    dead code.** Only `isNativeCrdtAvailable` is consumed (by
    `crdtProjectLifecycle.getPersistenceBackend`). The Tauri backend
    dispatch is wired up to nothing — the `getPersistenceBackend()`
    call returns `'native'` on Tauri, but `loadCrdtProject` /
    `persistCrdtProject` / `compactProject` always go through the
    IDB path. The native backend code is a stub.

55. **`getPersistenceBackend` is misleading.** It returns
    `'native' | 'browser'` but the production lifecycle ignores
    this and always uses IDB. Either delete `nativeCrdtPersistence/`
    or wire it up.

56. **`isAppError` import in error tests.** `errors/__tests__/BranchError.spec.ts:3`
    and `SdawFormatError.spec.ts:3` import `isAppError` from
    `#/infra/errors/isAppError`. Healthy assertion, OK.

57. **`events/index.ts` is a `// No events defined`** comment. Per
    AGENTS.md, the convention is to keep `events/` even if empty,
    so this is fine — but if the module owns no events, the file
    could be deleted entirely once the module's root `index.ts`
    exists and doesn't try to re-export from `events`.

58. **`actionHistoryStore.ts` redefines `DOC_PREFIX_ROOT`.**
    `stores/actionHistoryStore.ts:4` `const DOC_PREFIX_ROOT =
'root'`. Three places now define this constant: `models/
CrdtDocumentTypes.ts`, `useCases/crdtDocumentTypes.ts`, and here.
    Drift hazard.

59. **`ActionHistoryAction.payload` is `unknown`.**
    `stores/actionHistoryStore.ts:9`
    `payload?: unknown`. The history is populated from `executeAppAction`,
    where the action is fully typed (`AppAction`). Saving as
    `unknown` defers narrowing entirely — a `revertAction` that
    reads `entry.inverseAction` cannot validate the payload shape
    against the action type. This is the contract surface for
    AppAction; it should hold the `AppAction` discriminated union.

60. **`MAX_HISTORY = 200` is silent truncation.** `stores/actionHistoryStore.ts:28`
    The 201st pushed entry silently drops the oldest. `revertAction`
    looks up by id; once an old entry falls off the slice, the
    user can no longer revert it but receives the same `false`
    return value as "entry not found" or "already reverted" — UX
    can't distinguish "expired" from "invalid".

61. **`revertAction` has no test.** `useCases/revertAction/__tests__/revertAction.spec.ts`
    is a smoke test. The actual behaviour (look up entry → call
    `executeAppAction` with inverse → mark reverted) is unverified.
    Combined with `ActionHistoryAction.payload: unknown`, regressions
    here are silent.

62. **`canRevertAction.spec.ts` is the only useful test in the
    `revertAction/` folder.** Three real assertions on three real
    branches. This is what the rest of the smoke tests should look
    like.

63. **Action handlers with side-effects on dispatch are not undoable
    here, but the system claims so.** `handleRestoreDsoSnapshot.ts:10`
    `undoable: false` — fair, restore-from-snapshot is itself an
    undo. But `revertAction` re-issues the inverse via
    `executeAppAction`, which will *itself* push a history entry
    (the executor doesn't know it's a revert). `markEntryReverted(entryId)`
    runs after the dispatch returns — so the action history
    momentarily contains both the original action (reverted=true)
    and the inverse (a fresh entry). The undo stack semantics are
    "compensating", not "rewinding", but the UI naively shows both
    rows. This is documented in `revertAction.ts:6-12` as
    intentional, but the test gap (issue #61) means the contract
    is unverified.

64. **`crdtWorker.ts` does not bound `processLoad` or `processMerge`.**
    No memory limits, no max-doc-count, no timeout. A malicious
    `.sdaw` blob with millions of fake DocIds in the bundle map
    would parse until the worker OOM'd. The decoder (`decodeSdawFile.ts`)
    is bounded by the file's own length, but the post-decode
    bundle Map is not size-checked before being handed to the
    worker.

65. **Type assertion: `result as Uint8Array | undefined`.**
    `repositories/crdtPersistence/loadDocFromIdb.ts:17`. Acceptable
    at the IDB boundary, but combined with issue #53 (dead) it
    doesn't matter. Note for future use if revived.

66. **`automergeRepository.ts` uses `as Doc<TDoc>` and `as Doc<AnyDoc>`
    casts internally.** Lines 119, 162, 173, 179, 188, 202, 206.
    These bypass type narrowing for generic doc shapes — the
    repository is structurally type-erased (`AnyDoc =
Record<string, unknown>`) so callers cast in/out. This is a
    real architectural issue: the repository has no type-aware
    handle on the docs it stores, so the projection bridge and
    `mutateCrdtDoc<DocShape>` callers each cast independently.
    Drift between expected and actual shapes is not caught.

67. **`stores/index.ts` re-exports types from `actionHistoryStore`
    only.** It does not export the `BranchRecord`, `BranchStoreState`,
    or `MAIN_BRANCH_ID` from `branchStore.ts`, even though
    `BranchManagerDialog` imports them via the deep path
    `../../stores/branchStore`. The barrel is incomplete, forcing
    the dialog into a deep import.

68. **`BranchManagerDialog` imports use cases via deep paths.**
    `presentations/views/BranchManagerDialog.tsx:13-16` imports
    `deleteBranch`, `forkProjectBranch`, `mergeBranch`,
    `switchBranch` directly from `../../useCases/crdtBranching/<file>`.
    AGENTS.md "Same module — relative imports" allows this (it's
    relative), but the pattern means each function is now a load-
    bearing path the dialog cannot ignore. A `useCases/index.ts`
    re-export would simplify, except AGENTS.md says the barrel is
    only for *external* consumers — same-module callers should use
    relative paths. So this is fine, but combined with #2 (two
    types files) it shows the module's surface is incoherent.

69. **`automergeRepository.spec.ts` mocks `Worker` globally with
    `vi.stubGlobal`.** Line 24-32. The mock returns
    `addEventListener: vi.fn()` etc., so `invokeWorker` will
    register listeners that never fire — the Promise would hang
    forever. The repository tests therefore *never exercise*
    `loadAll`, `mergeBundle`, or any worker path — and the test
    file does not assert this (the worker mock is silent on
    timeouts). The synchronous fallback path is reached in
    production *only on worker error*, so the actual tested code
    paths are: `createProject`, `createChildDoc`, `insertDoc`,
    `changeDoc + listener notify`, `removeDoc`, `reset`.
    Everything else is uncovered.

70. **`automergeRepository.changeDoc` test does not assert message
    handling.** Line 68: `automergeRepository.changeDoc('root', (doc:
any) => { doc.foo = 'bar' })` — no `message` argument. The
    `change(doc, { message }, changeFn)` vs `change(doc, changeFn)`
    branches at `:178` are uncovered by tests, even though
    `mutateCrdtDoc.spec.ts` exercises both call shapes (one level
    up). The repository's branch is silently the entire surface
    that powers Automerge change attribution.

---

## Priorities

1. **Establish a root `index.ts` for the module** (issue #1) — every
   cross-module import is currently a violation. This is the single
   highest-impact change because it unblocks fixing #2, #4, #5
   coherently and is mechanical.

2. **Collapse the two types files and the two `semanticChangeContext`
   files** (issues #2, #3, #58) — silent dual-state and silent dual-
   type are real correctness hazards once a future caller picks the
   wrong one.

3. **Fix `switchBranch` / `forkProjectBranch` semantics** (issues #6,
   #7, #27, #28, #29, #33) — branching today loses data on switch,
   leaks bytes on delete, and races with the active-branch source of
   truth. This is the single largest user-visible correctness gap.

4. **Fix `transactSnapshot` cloning + concurrency** (issues #14, #15)
   — the DSO undo path is hot and currently allocates O(N docs)
   regardless of dirtied count, and breaks under concurrent invocations.

5. **Replace 15 smoke tests with real assertions** (issues #44, #45,
   #46, #47, #61, #69, #70) — the entire branching surface, the
   action-revert surface, the worker fallback path, and the snapshot
   helpers ship without behavioural coverage.

6. **Persistence completeness** (issues #31, #32, #28, #51) — child-
   doc edits never auto-save; deleted-branch bytes leak; the
   incremental path is single-doc.

7. **`mergeBundle` worker/sync path divergence** (issues #9, #10) — a
   silent change in serialised state depending on which path was
   taken is a CRDT correctness hazard.

8. **Native backend stub or wire it up** (issues #54, #55) — six
   functions and a ~470-LOC subfolder ship dead.

9. **AGENTS.md compliance pass** (issues #4, #5, #24, #46, #47, #66)
   — assertion escapes, deep imports, and use-case-type re-exports.

---

## Open issues

### 1. Module has no root `index.ts`

**Problem:** `src/modules/CrdtDocument/` ships without a top-level
`index.ts`. AGENTS.md: "Cross-module imports MUST only target the
destination module's root `index.ts`. Deep imports into `useCases/`,
`events/`, `stores/`, `presentations/views/`, or any other path from
outside the module are forbidden." Today every cross-module caller
goes through a forbidden path.

**Representative files:**

- `src/modules/CrdtDocument/` (no `index.ts`)
- `src/modules/Command/models/AppAction.ts:1` (deep import)
- `src/infra/store/storage/createAutomergeStorage.ts:2,14` (deep `models/` and `stores/` imports)
- `src/modules/Project/useCases/projectPersistence/loadProject.ts` (uses `#/modules/CrdtDocument/useCases`)
- `src/app/bootstrap.ts`, `src/modules/AiRuntime/...`, `src/modules/Workspace/...`, `src/modules/Collaboration/...`

**Needed:** Create `src/modules/CrdtDocument/index.ts` that re-exports
from `useCases/`, `events/` (empty), `stores/`, and
`presentations/views/`. Then update every cross-module caller to
import from `#/modules/CrdtDocument` only. Deletes/rewrites the deep
imports. Remove the `useCases/crdtDocumentTypes.ts` duplicate (issue
#2) before this so the barrel exports a single source of truth.

### 2. Two byte-equivalent `crdtDocumentTypes` files

**Problem:** `models/CrdtDocumentTypes.ts` and
`useCases/crdtDocumentTypes.ts` are duplicates. Repositories import
from `models/`; use cases (and external callers) import from
`useCases/`. Schema changes must be applied to both.

**Representative files:**

- `src/modules/CrdtDocument/models/CrdtDocumentTypes.ts`
- `src/modules/CrdtDocument/useCases/crdtDocumentTypes.ts`
- All `repositories/crdtPersistence/*.ts` (import from `../../models/CrdtDocumentTypes`)
- All `useCases/*.ts` that need types (import from `./crdtDocumentTypes`)
- `src/modules/Command/models/AppAction.ts:1` (cross-module import of `useCases/crdtDocumentTypes`)
- `src/modules/CrdtDocument/stores/actionHistoryStore.ts:4` (a third `DOC_PREFIX_ROOT` literal)

**Needed:** Pick one home — `models/CrdtDocumentTypes.ts` per AGENTS.md
"models/" — and delete `useCases/crdtDocumentTypes.ts`. Stop re-
exporting types from `useCases/index.ts`. Update use-case files to
import from `../models/CrdtDocumentTypes` (relative). Define a single
local copy of `DocId`/`DocumentBundle` in `Command/models/AppAction.ts`
per AGENTS.md "Model isolation". Drop the `DOC_PREFIX_ROOT` redefinition
in `actionHistoryStore.ts`.

### 3. Two `semanticChangeContext` files with separate state

**Problem:** `useCases/semanticChangeContext.ts` and
`stores/semanticChangeContext.ts` each declare their own
`sessionState = { currentContext: null }`. Production uses the
`stores/` version; tests for the `useCases/` version pass without
exercising the live one.

**Representative files:**

- `src/modules/CrdtDocument/useCases/semanticChangeContext.ts`
- `src/modules/CrdtDocument/stores/semanticChangeContext.ts`
- `src/modules/CrdtDocument/useCases/__tests__/semanticChangeContext.spec.ts`
  (tests the dead version)
- `src/modules/Command/useCases/executeAppAction.ts:3` (uses live)
- `src/infra/store/storage/createAutomergeStorage.ts:14` (uses live, deep import)

**Needed:** Delete `useCases/semanticChangeContext.ts` and its test,
or replace its body with `export * from '../stores/semanticChangeContext'`.
Move the test to `stores/__tests__/`. Once #1 lands, expose the
context functions from the root `index.ts` and update the storage
adapter to import via the barrel.

### 4. Cross-module callers reach into `models/`, `useCases/<file>`, and `stores/<file>`

**Problem:** AGENTS.md mandates root-`index.ts`-only cross-module
imports. Top offenders: `Command/models/AppAction.ts:1`
(`#/modules/CrdtDocument/useCases/crdtDocumentTypes`),
`infra/store/storage/createAutomergeStorage.ts:2,14`
(`#/modules/CrdtDocument/models/CrdtDocumentTypes`,
`#/modules/CrdtDocument/stores/semanticChangeContext`).

**Representative files:**

- `src/modules/Command/models/AppAction.ts:1`
- `src/infra/store/storage/createAutomergeStorage.ts:2,14`
- `src/modules/AiRuntime/models/RuntimeAction.ts` (probably; see grep)

**Needed:** After issues #1 and #2 land, rewrite each deep import to
target `#/modules/CrdtDocument`. For `AppAction.ts`, define
`DocumentBundle` locally per AGENTS.md "Model isolation".

### 5. `useCases/index.ts` re-exports types and constants

**Problem:** Lines 1, 18, 24 re-export `type DocId`, `type
DocumentBundle`, `type MergeResult`, `type MutateCrdtDocInput`, `type
ReplaceCrdtDocInput`. AGENTS.md "Use-case types stay private": "Do
not `export type` from `useCases/` for other modules".

**Representative files:**

- `src/modules/CrdtDocument/useCases/index.ts:1,18,24`

**Needed:** Strip the type re-exports. Each consumer module either
defines its own local types (per "Model isolation") or uses
`Parameters<typeof fn>` / `ReturnType<typeof fn>` against the
imported function.

### 6. `switchBranch` overwrites the `root` slot without saving the previous branch's state

**Problem:** `crdtBranching/switchBranch.ts:30` calls
`automergeRepository.replaceDoc(DOC_PREFIX_ROOT, branchDoc)`.
There is no symmetric "save current root → its `branch_<previous>`
slot" before swapping. After
`main → fork(feature) → editFeature → switchBranch(main)`, the
`root` slot is whatever was last written, not the original main
state. Combined with `MAIN_BRANCH_ID`'s seeded record having
`rootDocId: 'root'` (no separate `branch_main` doc exists), there
is no way to reach the original main state without the slot still
holding it.

**Representative files:**

- `src/modules/CrdtDocument/useCases/crdtBranching/switchBranch.ts:24-33`
- `src/modules/CrdtDocument/stores/branchStore.ts:25-34` (seeds main with `rootDocId: 'root'`)

**Needed:** Before swapping, write the current `root` doc into the
*outgoing* branch's slot (or create a `branch_main` slot lazily on
first switch-away from main). Better: never mutate `root` — store
each branch in its own slot and have a `currentBranchRootDocId`
indirection that the projection layer resolves. Add a test that
asserts round-trip switch (A → B → A) preserves A's edits.

### 7. `forkProjectBranch` persists via direct `saveAllToIdb`, breaking the compaction counter

**Problem:** `forkProjectBranch.ts:49` calls `saveAllToIdb(bundle)`
without resetting `compactionState.incrementalSaveCount`. The
counter no longer reflects "incrementals since last full save".

**Representative files:**

- `src/modules/CrdtDocument/useCases/crdtBranching/forkProjectBranch.ts:49`
- `src/modules/CrdtDocument/useCases/crdtProjectLifecycle.ts:13,51,64`

**Needed:** Replace the direct `saveAllToIdb` with `compactProject()`
(which performs `saveAll` + `clearIncrementals` + counter reset).

### 8. Branch metadata in localStorage; CRDT branches not in CRDT

**Problem:** `branchStore` (`stores/branchStore.ts:21`) is
`createLocalStorage`-backed. Branch metadata does not sync via the
CRDT subscription path, does not export with `.sdaw`, and is local-
device-only. Collaboration manually replicates this through a
parallel `__branches__` Automerge doc.

**Representative files:**

- `src/modules/CrdtDocument/stores/branchStore.ts:21-37`
- `src/modules/Collaboration/useCases/collaboration/sessionManagement.ts:114-200`

**Needed:** Move branch metadata into a dedicated Automerge child doc
(named `DOC_BRANCHES` — already defined as `'__branches__'`) so
exports, imports, and sync replicate it for free. Then delete the
parallel `__branches__` plumbing in Collaboration.

### 9. `mergeBundle` worker vs sync paths produce different in-memory states

**Problem:** The worker (`crdtWorker.ts:106-109`) compacts merged docs
via `save(doc)` and returns binary; the main thread re-`load`s to
get a fresh doc. The sync fallback (`automergeRepository.ts:415-433`)
calls `merge(local, incoming)` directly, leaving the doc's internal
change graph in a different state. Subsequent
`automergeRepository.getChanges(id, heads)` may return different
results depending on which path was taken — a non-deterministic
CRDT layer.

**Representative files:**

- `src/modules/CrdtDocument/repositories/automergeRepository.ts:383-433`
- `src/modules/CrdtDocument/workers/crdtWorker.ts:76-112`

**Needed:** Make the sync fallback compact identically (`load(save(merged))`)
to match the worker's output. Add a test that runs both paths on the
same input and asserts `save()` of the result is byte-equivalent.

### 10. `loadAll` synchronous fallback re-`save+load`s every doc on the main thread

**Problem:** `automergeRepository.ts:368-370` runs
`load(save(doc))` for every doc as a "compact in place" pass. On a
50-doc, multi-MB project this can take hundreds of milliseconds on
the main thread — the very situation the worker exists to avoid.

**Representative files:**

- `src/modules/CrdtDocument/repositories/automergeRepository.ts:333-373`

**Needed:** Drop the in-place compaction in the sync fallback (or run
it lazily on first read). The fallback's purpose is "the worker is
unavailable" — simply parsing the bundle is enough; compaction can
be deferred until the next persist cycle.

### 11. `actorId` field is set but never used by Automerge

**Problem:** `automergeRepository.ts:105` initialises a 32-char hex
actor id, exposes `getActorId()`, but never passes it to
`init({actor})`. Automerge generates its own actor ids per `init`.
The class field is vestigial.

**Representative files:**

- `src/modules/CrdtDocument/repositories/automergeRepository.ts:105,113-115`

**Needed:** Either pass `actor: this.actorId` into every `init()`
call (and document the actor-id stability across HMR) or delete the
field and `getActorId()`. If the repo never persists actor identity,
delete.

### 12. `transactSnapshot` clones every doc up-front

**Problem:** Lines 246-248 clone every doc before the transaction
runs, then keep only the dirtied ones. A 50-doc project where one
doc is edited wastes 49 full Automerge clones. `clone` is O(state),
and the DSO undo path wraps every action — this is a hot path.

**Representative files:**

- `src/modules/CrdtDocument/repositories/automergeRepository.ts:241-280`

**Needed:** Subscribe first, then clone-on-first-write inside the
listener. Add a test that confirms only dirtied docs are cloned.

### 13. `transactSnapshot` is not concurrency-safe

**Problem:** Two concurrent invocations interleave their `dirtied`
sets. The second call's "before" bundle is captured *after* the
first call's mutations have landed in the repository, so the
second's undo bundle is wrong.

**Representative files:**

- `src/modules/CrdtDocument/repositories/automergeRepository.ts:241-280`

**Needed:** Serialise transactions through a queue (or reject if a
transaction is already in flight). Add a test that interleaves two
async `transactSnapshot` calls and verifies the rollback bundles.

### 14. Listener errors are swallowed without backoff

**Problem:** `notifyListeners` wraps each listener in `try/catch`
and `logger.warn`. A throwing listener floods the log on every
change. There is no per-listener disable, no backoff.

**Representative files:**

- `src/modules/CrdtDocument/repositories/automergeRepository.ts:464-471`

**Needed:** Track per-listener failure counts; after N consecutive
throws, unsubscribe and surface to the caller.

### 15. `saveIncrementalToIdb` uses `put` (overwrites on key collision)

**Problem:** Random suffix on the key reduces collision probability
but does not eliminate it. `store.put` silently overwrites — losing
the prior incremental chunk.

**Representative files:**

- `src/modules/CrdtDocument/repositories/crdtPersistence/saveIncrementalToIdb.ts:15-21`

**Needed:** Use `store.add()` (which throws on duplicate keys) and
retry with a fresh suffix, or use a strictly increasing
module-private counter.

### 16. Incremental sort uses `parseInt(key.split(':').pop())` against a non-numeric tail

**Problem:** Key shape is `${id}:incremental:${ms}-${rand4}`.
`split(':').pop()` gives `${ms}-${rand4}`; `parseInt` gracefully
stops at the `-` and returns `${ms}`. Works today but: any DocId
containing `:` breaks the split; any rename of the key shape that
moves the timestamp earlier breaks the sort silently.

**Representative files:**

- `src/modules/CrdtDocument/repositories/automergeRepository.ts:352-356`
- `src/modules/CrdtDocument/workers/crdtWorker.ts:52-56`

**Needed:** Validate `DocId` excludes `:` (or use a different
delimiter). Encode the timestamp as a separate IDB column or a
fixed-width zero-padded prefix that survives lexical sort. Add a
test with a key containing `:` to lock the contract.

### 17. `_loadAllSync` and worker `processLoad` infer root id by `startsWith('root')`

**Problem:** Any doc id starting with `root` (e.g. `root-2`,
`rootBackup`) wins the root assignment on the last iteration. With
multiple matches, behaviour depends on map iteration order.

**Representative files:**

- `src/modules/CrdtDocument/repositories/automergeRepository.ts:347`
- `src/modules/CrdtDocument/workers/crdtWorker.ts:47`

**Needed:** Match `id === DOC_PREFIX_ROOT` exactly (or a brand-new
exact-match constant). If the multi-root pattern is intentional
(branches use `branch_<uuid>`, not `root_<uuid>`), enforce a stricter
naming convention with a runtime check.

### 18. `.sdaw` format has no migration registry; `version=1` is a hard wall

**Problem:** `decodeSdawFile.ts:29` throws on any version mismatch.
No migration strategy, no read-only fallback for older versions,
no Automerge-binary-version metadata embedded.

**Representative files:**

- `src/modules/CrdtDocument/useCases/sdawFileFormat/decodeSdawFile.ts:27-31`
- `src/modules/CrdtDocument/useCases/sdawFileFormat/helpers.ts:5`

**Needed:** Add a version-migration registry (`migrations[from][to]`).
Embed the originating Automerge release version in the `.sdaw`
header. Decide whether to support read-only opens of newer-format
files, or to surface an explicit "newer file — upgrade your app"
error in `MergeResultDialog`.

### 19. `exportSdawFile` uses `as unknown as BlobPart`

**Problem:** Line 11 has `bytes as unknown as BlobPart`. AGENTS.md
"TypeScript — soundness" forbids `as unknown as ...` to silence the
compiler. The eslint-disable comment names the issue but does not
fix it.

**Representative files:**

- `src/modules/CrdtDocument/useCases/crdtMerge/exportSdawFile.ts:10-11`

**Needed:** Pass `bytes.buffer` to `new Blob([buffer])` — `ArrayBufferLike`
is a valid `BlobPart`. Or wrap in a typed helper that asserts the
shape with a runtime check. Drop the eslint-disable.

### 20. `detectImportDecision` claims three outcomes, returns two

**Problem:** `ImportDecision = 'merge' | 'branch' | 'separate'`
but the implementation returns only `'merge'` or `'separate'`. The
`'branch'` arm of the importer is dead.

**Representative files:**

- `src/modules/CrdtDocument/useCases/crdtMerge/importSdawFile.ts:14-57`

**Needed:** Either implement diverged-but-related detection (compare
common ancestors and divergence width) or remove `'branch'` from
the union and the importer's branching arm.

### 21. `importSdawFile` collapses three failure modes into `null`

**Problem:** Line 80-83 catches all errors and returns `null`.
File-read, decode, merge, and "unrelated project" all surface as
the same `null`.

**Representative files:**

- `src/modules/CrdtDocument/useCases/crdtMerge/importSdawFile.ts:59-84`

**Needed:** Return a discriminated union (`{ ok: true; result } |
{ ok: false; reason: 'invalid-format' | 'unrelated' | 'merge-error' |
'read-error'; error?: AppError }`) so the dialog can show a
specific message.

### 22. `mergeBranch` does not validate target = `state.activeBranchId`

**Problem:** Line 13 accepts a source branch id but ignores
`activeBranchId`. Merges land in whatever doc occupies `DOC_PREFIX_ROOT`,
which (per issue #6) may not match the user's expected target.

**Representative files:**

- `src/modules/CrdtDocument/useCases/crdtBranching/mergeBranch.ts:13-39`

**Needed:** Read `state.activeBranchId`, resolve its
`rootDocId`, and merge into that slot. Add a test asserting
`mergeBranch(B)` while on `A` lands in `A`'s doc, not the global
`root` slot.

### 23. `deleteBranch` does not delete the branch's IDB bytes

**Problem:** Removes only from in-memory and the localStorage
branchStore. Until the next compaction, `branch_<uuid>` bytes
remain in IDB and reload re-materialises the branch.

**Representative files:**

- `src/modules/CrdtDocument/useCases/crdtBranching/deleteBranch.ts:22-30`

**Needed:** Delete the IDB key after `removeDoc`, or call
`compactProject()` synchronously within the delete.

### 24. `createCrdtProject` leaks stale `branchStore` records

**Problem:** New project clears in-memory CRDT and IDB but leaves
`branchStore` (localStorage) untouched. Stale branch records point
at non-existent docs.

**Representative files:**

- `src/modules/CrdtDocument/useCases/crdtProjectLifecycle.ts:19-22`
- `src/modules/CrdtDocument/stores/branchStore.ts`

**Needed:** Reset `branchStore` to its initial state inside
`createCrdtProject`. Once issue #8 lands (branches in CRDT), this
goes away naturally.

### 25. `persistCrdtProject` only saves `DOC_PREFIX_ROOT`'s incremental

**Problem:** Child docs created via `createCrdtDoc` and branch docs
are never auto-saved between full compactions. On crash, child-doc
edits are lost.

**Representative files:**

- `src/modules/CrdtDocument/useCases/crdtProjectLifecycle.ts:44-54`

**Needed:** Iterate every dirty doc id (track via `subscribeToCrdtChanges`
hint or a per-doc `lastIncrementalHeads` map) and write an
incremental for each. The auto-save should debounce per-doc, not
globally.

### 26. `loadCrdtProject` ignores `branchStore.activeBranchId`

**Problem:** On reopen, the user lands on whatever doc occupies
`DOC_PREFIX_ROOT`, which may not match the previously active
branch.

**Representative files:**

- `src/modules/CrdtDocument/useCases/crdtProjectLifecycle.ts:28-35`
- `src/modules/CrdtDocument/stores/branchStore.ts`

**Needed:** After loading the bundle, read `branchStore.value.activeBranchId`,
resolve to a `rootDocId`, and `replaceDoc(DOC_PREFIX_ROOT, doc)`.
Combined with issue #6, this requires the slot model to be fixed.

### 27. `automergeRepository.reset()` does not clear listeners

**Problem:** Clears docs but leaves `changeListeners`. Listeners
from the previous session continue to fire on the new session's
edits.

**Representative files:**

- `src/modules/CrdtDocument/repositories/automergeRepository.ts:441-444`

**Needed:** Clear `this.changeListeners` in `reset()`. Document that
callers must re-subscribe after reset. Add a test that asserts
post-reset listeners do not fire.

### 28. Six native CRDT functions are dead code

**Problem:** `nativeApplyChange`, `nativeCreateProject`,
`nativeGetDocumentState`, `nativeLoadBundle`, `nativeMergeBundle`,
`nativeSaveBundle` have no production callers. Only
`isNativeCrdtAvailable` is consumed (by `getPersistenceBackend`),
and the lifecycle never branches on its return value.

**Representative files:**

- `src/modules/CrdtDocument/repositories/nativeCrdtPersistence/nativeApplyChange.ts`
- `src/modules/CrdtDocument/repositories/nativeCrdtPersistence/nativeCreateProject.ts`
- `src/modules/CrdtDocument/repositories/nativeCrdtPersistence/nativeGetDocumentState.ts`
- `src/modules/CrdtDocument/repositories/nativeCrdtPersistence/nativeLoadBundle.ts`
- `src/modules/CrdtDocument/repositories/nativeCrdtPersistence/nativeMergeBundle.ts`
- `src/modules/CrdtDocument/repositories/nativeCrdtPersistence/nativeSaveBundle.ts`
- `src/modules/CrdtDocument/useCases/crdtProjectLifecycle.ts:77-82` (the misleading branch helper)

**Needed:** Either wire the native backend up (lifecycle dispatches
to native or browser based on `getPersistenceBackend`) or delete
the entire `nativeCrdtPersistence/` folder + the helper. Document
which is the chosen path.

### 29. Three IDB persistence functions are dead code

**Problem:** `saveDocToIdb`, `loadDocFromIdb`, `loadIncrementalsFromIdb`
have no production callers.

**Representative files:**

- `src/modules/CrdtDocument/repositories/crdtPersistence/saveDocToIdb.ts`
- `src/modules/CrdtDocument/repositories/crdtPersistence/loadDocFromIdb.ts`
- `src/modules/CrdtDocument/repositories/crdtPersistence/loadIncrementalsFromIdb.ts`

**Needed:** Delete unless a near-term feature needs them. (Single-
doc load is plausibly useful for a future "open one doc on demand"
flow — but absent a spec, dead code accumulates.)

### 30. `MergeResultDialog` is not exported from the views barrel

**Problem:** `presentations/views/index.ts` exports only
`BranchManagerDialog`. `MergeResultDialog` is component-private,
tested, but unreachable to other modules.

**Representative files:**

- `src/modules/CrdtDocument/presentations/views/index.ts:1`
- `src/modules/CrdtDocument/presentations/views/MergeResultDialog.tsx`

**Needed:** Decide: export `MergeResultDialog` (and its
`MergeResultData` type) from the views barrel and wire it to
`importSdawFile` results via Workspace, or delete the file and its
spec. As-is the component is unreachable.

### 31. `BranchManagerDialog` test renders without required `onClose` prop

**Problem:** `BranchManagerDialog` declares `onClose: () => void`
as required. Test calls `render(<BranchManagerDialog />)`. Should
fail typecheck; clicking the close button at runtime calls
`undefined`.

**Representative files:**

- `src/modules/CrdtDocument/presentations/views/__tests__/BranchManagerDialog.spec.tsx:16,21,26,31`

**Needed:** Pass an `onClose={vi.fn()}` in every render call. While
fixing, also make the assertions meaningful (assert the dialog
title is present, assert clicking close calls `onClose`).

### 32. 15 spec files are pure smoke tests

**Problem:** Each is shape `expect(subject.foo).toBeDefined();
expect(typeof subject.foo === 'function' || 'object').toBe(true);`.
They run, pass, and assert nothing about behaviour. AGENTS.md
"TypeScript — soundness — Tests": "Do not stop at 'defined' /
'truthy'".

**Representative files:**

- `useCases/crdtBranching/__tests__/forkProjectBranch.spec.ts`
- `useCases/crdtBranching/__tests__/switchBranch.spec.ts`
- `useCases/crdtBranching/__tests__/mergeBranch.spec.ts`
- `useCases/crdtBranching/__tests__/deleteBranch.spec.ts`
- `useCases/crdtBranching/__tests__/listBranches.spec.ts`
- `useCases/crdtBranching/__tests__/getActiveBranch.spec.ts`
- `useCases/revertAction/__tests__/revertAction.spec.ts`
- `useCases/__tests__/startCrdtAutoSave.spec.ts`
- `useCases/__tests__/getDsoSnapshotHandlers.spec.ts`
- `useCases/crdtMerge/__tests__/exportSdawFile.spec.ts`
- `useCases/crdtMerge/__tests__/importSdawFile.spec.ts`
- `useCases/crdtMerge/__tests__/helpers.spec.ts`
- `useCases/crdtMerge/__tests__/mergeDocumentBundle.spec.ts`
- `useCases/sdawFileFormat/__tests__/encodeSdawFile.spec.ts`
- `useCases/sdawFileFormat/__tests__/decodeSdawFile.spec.ts`
- `useCases/sdawFileFormat/__tests__/helpers.spec.ts`

**Needed:** Replace each with at least one behavioural assertion.
For branching: round-trip A → fork → switch → edit → switch back →
assert state. For .sdaw: encode/decode round-trip with a known
fixture; reject malformed magic and version. For
`mergeDocumentBundle`: deterministic merge result on a fixed input.

### 33. `automergeRepository.spec.ts` uses `as any` and skips most paths

**Problem:** Eight `as any` casts. The Worker is mocked with a
no-op so the worker paths (`loadAll`, `mergeBundle`) never resolve;
the test never asserts a timeout. `restoreSnapshot`, `mergeRemoteDoc`,
`saveDoc`, `saveDocIncremental`, `getChanges`, `getHeads`,
`transactSnapshot` are uncovered.

**Representative files:**

- `src/modules/CrdtDocument/repositories/__tests__/automergeRepository.spec.ts:24-93`

**Needed:** Replace `as any` with typed fixtures. Test the worker
fallback path (force `invokeWorker` to reject and assert the sync
parser runs). Add tests for `restoreSnapshot`, `mergeRemoteDoc`,
`saveDoc`/`saveDocIncremental` round-trip, `getChanges` /
`getHeads` invariants.

### 34. `crdtPersistence.spec.ts` typed with `let _: any`

**Problem:** Lines 14-17 declare four `let mockX: any`. The mock
chains skip TS shape checks entirely.

**Representative files:**

- `src/modules/CrdtDocument/repositories/crdtPersistence/__tests__/crdtPersistence.spec.ts:14-17`

**Needed:** Replace with `vi.mocked(IDBObjectStore.prototype.put)` or
typed factory functions (e.g. `function fakeStore(): IDBObjectStore`).

### 35. Worker `invokeWorker` typed as `Record<string, unknown>` input

**Problem:** Caller side erases the `WorkerInMsg` discriminated
union. A typo in `type: 'mergeBundle'` silently sends a no-op
message; the Promise never resolves.

**Representative files:**

- `src/modules/CrdtDocument/repositories/automergeRepository.ts:47-80`
- `src/modules/CrdtDocument/workers/crdtWorker.ts:116-118`

**Needed:** Lift the `WorkerInMsg` type into a shared module
(e.g. `models/CrdtWorkerProtocol.ts`) and type `invokeWorker` as
`(msg: WorkerInMsg): Promise<WorkerResponse>`. Drop the
`Record<string, unknown>`.

### 36. `ActionHistoryAction.payload` is `unknown`; revert can't validate shape

**Problem:** `actionHistoryStore.ts:9` `payload?: unknown`. The
history is populated from typed `AppAction`s but stored as
`unknown`, so `revertAction` cannot type-check the dispatched
inverse against the action type.

**Representative files:**

- `src/modules/CrdtDocument/stores/actionHistoryStore.ts:7-23`
- `src/modules/CrdtDocument/useCases/revertAction/revertAction.ts:33`

**Needed:** Type `action` and `inverseAction` as the discriminated
`AppAction` (or a structural subset that captures `type` + payload
shape). Per AGENTS.md "Model isolation", `CrdtDocument` cannot
import `AppAction`'s type directly — define a structural subset
locally that the executor populates.

### 37. `MAX_HISTORY = 200` silent truncation indistinguishable from "missing"

**Problem:** Reverting an entry that has fallen off the slice
returns `false` (same as "entry not found" or "already reverted").

**Representative files:**

- `src/modules/CrdtDocument/stores/actionHistoryStore.ts:28,40`
- `src/modules/CrdtDocument/useCases/revertAction/revertAction.ts:14-40`

**Needed:** Distinguish via a result enum (`'reverted' | 'expired' |
'not-found' | 'already-reverted'`). UI can then surface a meaningful
message.

### 38. `projectCrdtToStores` discards the `docId` change hint

**Problem:** `setupProjectionBridge` calls
`projectCrdtToStores()` with no arguments; the docId hint from
`automergeRepository.onChange` is ignored. Every change rehydrates
all 10 project stores.

**Representative files:**

- `src/modules/CrdtDocument/useCases/projection/projectProjection.ts:38-42`

**Needed:** Route the docId to a per-store dispatcher (build a
`docId → store[]` map). For changes with a hinted docId, hydrate
only the affected store. Bulk changes (docId === undefined) keep
the current behaviour.

### 39. `projectCrdtToStores` hardcodes a 10-store list

**Problem:** New project-state stores added in other modules are
silently absent from rehydration.

**Representative files:**

- `src/modules/CrdtDocument/useCases/projection/projectProjection.ts:11-23`

**Needed:** Replace with a registry: each owning module registers
its store with the projection bridge at module init. The bridge
iterates the registry. Add a test that asserts a newly registered
store is hydrated.

### 40. `autoSaveHealth` is a mutable object, not a Store

**Problem:** UI cannot subscribe to changes in `consecutiveFailures`;
either polls or never updates.

**Representative files:**

- `src/modules/CrdtDocument/useCases/startCrdtAutoSave.ts:22`

**Needed:** Convert to a `Store<{ consecutiveFailures: number;
lastError?: string }>` so `useStore` works. Surface the failing
state via a status bar UI (Notification or app shell).

### 41. `actionHistoryStore` redefines `DOC_PREFIX_ROOT` literally

**Problem:** Three definitions across the module. Drift hazard.

**Representative files:**

- `src/modules/CrdtDocument/stores/actionHistoryStore.ts:4`

**Needed:** Import from `../models/CrdtDocumentTypes` (after #2 lands).

### 42. `getPersistenceBackend` is purely advisory; never branches the lifecycle

**Problem:** Returns `'native' | 'browser'` but `loadCrdtProject`,
`persistCrdtProject`, `compactProject` always go through IDB.
Misleading API.

**Representative files:**

- `src/modules/CrdtDocument/useCases/crdtProjectLifecycle.ts:77-82`

**Needed:** Either wire the lifecycle to dispatch on the backend
(IDB vs Tauri) or delete this helper.

### 43. `crdtWorker.ts` has no input bounds

**Problem:** No max-doc-count, no max-bundle-size, no timeout. A
large or malformed bundle can OOM the worker.

**Representative files:**

- `src/modules/CrdtDocument/workers/crdtWorker.ts:25-71,76-112`

**Needed:** Validate `bundle.size` and total bytes before parsing.
Surface an `error` response if exceeded.

### 44. `decodeSdawFile` `bytes.subarray`/`bytes.slice` returns differ in semantics

**Problem:** `decodeSdawFile.ts:50` uses `subarray` for the docId,
`:63` uses `slice` for the data. `subarray` shares the buffer
(zero-copy); `slice` copies. The buffer-sharing means the returned
`DocumentBundle`'s docIds point into the original input buffer —
if the caller pools or re-uses the buffer, decoded ids alias
with that buffer.

**Representative files:**

- `src/modules/CrdtDocument/useCases/sdawFileFormat/decodeSdawFile.ts:50,63`

**Needed:** Either decode via `slice` consistently (defensive copy)
or document that the caller must not mutate the input buffer until
the bundle is consumed. The decode is followed immediately by
Automerge `load` which copies internally, so the alias is
practically safe — but it's a footgun for any future caller.

---

## Open questions

- [ ] Is the `nativeCrdtPersistence/` folder a planned future backend
      or vestigial scaffolding? (Affects whether issue #28 is "wire
      it up" or "delete it".)
- [ ] Should branch metadata live in CRDT (issue #8) or remain
      device-local? Collaboration's parallel `__branches__` doc
      suggests "in CRDT" is the intended end state.
- [ ] What is the intended migration story for `.sdaw v1`?
      (Affects issue #18 — without an answer, every future format
      change becomes a hard wall for users with existing files.)
- [ ] Is `transactSnapshot` expected to handle concurrent invocations
      (issue #13), or is the executor contract single-threaded?
- [ ] Is the legacy `Project/useCases/versionControl/*` snapshot
      / branching surface being phased out in favour of
      `CrdtDocument`'s? Two parallel systems exist today.

---

## Risks

- **Branch corruption / data loss.** Issue #6 + #7 + #22 + #26: a
  user who switches branches, edits, switches back, and reloads can
  observe edits ending up in the wrong branch slot — or being lost
  entirely.
- **Silent CRDT divergence.** Issue #9: the same merge yields
  different binary state depending on whether the worker was
  available. Two clients running the same operation may end up with
  byte-level disagreement on the same logical CRDT state.
- **Auto-save lying about durability.** Issue #25: child-doc edits
  do not auto-save. A crash between full compactions silently loses
  user work. The `autoSaveHealth.consecutiveFailures` UI signal does
  not catch this — it only fires when IDB writes fail, not when the
  per-doc save is missing.
- **Untested fast paths.** Issue #32 + #33 + #34: the bulk of the
  module ships without behavioural coverage. A refactor of any
  branching / merge / snapshot path would not break a test.
  Re-introducing a regression in `switchBranch` or
  `transactSnapshot` is undetectable.
- **Architectural drift.** Issue #1 + #2 + #3 + #4 + #5: AGENTS.md
  violations have accumulated to the point that the module's public
  surface is incoherent. Cross-module callers reach into
  `models/`, `stores/<file>`, and `useCases/<file>` because the
  root barrel does not exist; once it does, the duplications
  surface as conflicts.
- **Future format wall.** Issue #18: `.sdaw v1` has no migration
  registry. Any future format change orphans existing user files.
- **DSO undo over-allocates.** Issue #12: every action wraps a
  full-repository clone. Memory pressure on a large project.

---

## Suggested approaches

- **Land issue #1 (root `index.ts`) first.** It is mechanical: copy
  the curated re-exports from `useCases/index.ts` (minus types per
  issue #5), add `stores/index.ts`, `events/index.ts`, and
  `presentations/views/index.ts` (after fixing #30). Then sweep
  cross-module callers.
- **Tackle the duplications next** (issues #2, #3, #41). One canonical
  file each. After this, the module's surface is coherent.
- **Branching correctness** (issues #6, #7, #8, #22, #23, #24, #26)
  is a single coherent piece of work — the slot model is broken; the
  fix is moving branch metadata into a CRDT child doc and using
  `currentBranchRootDocId` indirection in the projection layer. Spec
  this before implementing.
- **Snapshot correctness** (issues #12, #13) is a smaller piece —
  rewrite `transactSnapshot` with lazy clones and a serialisation
  queue. Property test it with two interleaved transactions.
- **Replace smoke tests with real assertions** (issue #32) is a
  long-tail effort. Pick the highest-risk surfaces first
  (branching, .sdaw decode, mergeBundle parity) and write fixtures
  that exercise round-trips. The branching tests can serve as
  acceptance criteria for the branching rewrite.
- **Native backend decision** (issue #28). Ask the user. If
  delete, the lifecycle simplifies; if wire-up, every IDB call
  needs a Tauri counterpart.

---

## Recommendation

Start with **issue #1 (root `index.ts`)**. It is mechanical and
unblocks a coherent public surface. Land it together with issue #2
(collapse the two `crdtDocumentTypes` files) so the barrel re-
exports a single source of truth, and #3 (collapse the two
`semanticChangeContext` files) so the storage layer's deep import
becomes a barrel import.

Next, write a spec for **branching correctness** (issues #6, #7,
#8, #22, #23, #24, #26 as one piece). Branch state today is wrong
in three ways at once, and fixing them piecemeal will introduce
regressions. The spec should pick a slot model (option A: each
branch has a dedicated `branch_<id>` slot, with `root` reserved as
"current branch's slot, mirrored"; option B: branches stored in a
CRDT child doc with `activeBranchId` resolving to a `rootDocId`
indirection) and the projection bridge follows the indirection.

After branching, the next session can choose between
**snapshot correctness** (#12, #13) or the **test-coverage sweep**
(#32). They are independent.

---

## Resolved

_No issues resolved yet._
