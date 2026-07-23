---
type: audit
id: AUDIT-collab-crdt-audio
scope: Collaboration / CRDT write path under audio-thread constraints
base_sha: 0f8ade6650bb0127085e1653638825a53f46efb2
branch: audit/collab-crdt-audio
date: 2026-07-23
method: sus-audit (observe, prove, prescribe nothing) + crdt-collaboration project invariants
disposition: AUDIT ONLY — no fixes applied. Artifact-only diff.
---

# Collaboration / CRDT under audio constraints — audit

Ground truth is one Automerge document feeding four consumers (live stores, undo/history,
persistence, collaboration sync) through one write path. This audit measures the current write
path, projection layer, and transports against first-class practice for interactive CRDT editors
that must never stall the audio or interaction thread.

Every observation is anchored to `file:line` at base SHA `0f8ade66`. Dynamic-timing claims that
were not run against the live app are labelled **(static; unproven at runtime)** — they rest on
code reading, not a captured trace, per sus-audit discipline.

---

## Golden Standard (citations)

**G1 — Batch changes; a per-change transaction is the atomic unit.** Automerge is fastest when
related edits are grouped: "Insert ~260k operations" in 1,816 ms for 2.0.1, and the format is
built by "packing data efficiently in memory, ensuring that related data is stored close together"
([Automerge 2.0](https://automerge.org/blog/automerge-2/)). The crdt-benchmarks corpus tests
*individual* edits precisely because per-edit update-event cost dominates real editors
([dmonad/crdt-benchmarks](https://github.com/dmonad/crdt-benchmarks)). Standard: one CRDT change
per user-visible intent, and downstream observation cost proportional to *what changed*, not to
total document size.

**G2 — Projection is derived, disposable, and incremental; never a second writer.** Local-first
practice materializes views from the document and recomputes only affected regions — "incremental
projection reduces update latency from O(n) to O(log n)" and "lazy materialization computes …
only for visible regions"
([Ink & Switch, Local-first software](https://www.inkandswitch.com/local-first/);
[Collabs, Weidner et al.](https://arxiv.org/abs/2212.02618)). A projection that writes *back* into
the document is a second source of truth — the anti-pattern local-first architectures exist to
remove.

**G3 — Convergence ≠ meaning; undo/intention preservation is a separate, hard problem.** Automerge
guarantees concurrent edits converge ([Shapiro et al., *Conflict-free Replicated Data Types*, INRIA
RR-7687](https://inria.hal.science/inria-00609399/)), but "support of undo for real-time
collaborative editing is still very limited," and selective/collaborative undo requires explicit
machinery to preserve operation intentions
([Yu, Ignat et al., *A CRDT Supporting Selective Undo for Collaborative Text Editing*](https://members.loria.fr/CIgnat/files/pdf/YuDAIS15.pdf)).
Standard: a remote merge must not silently disable local undo, and replaying an inverse must detect
that the target moved.

**G4 — Separate the ephemeral channel from the document channel.** Presence/cursors/playhead are
high-rate and loss-tolerant; document sync is reliable and ordered. Prior art routes them on
distinct channels so presence spam never head-of-line-blocks document convergence
([Ink & Switch, Local-first](https://www.inkandswitch.com/local-first/);
[Automerge sync protocol](https://automerge.org/docs/repositories/synchronization/)).

**G5 — Keep heavy CRDT WASM off the interaction thread.** load/merge/save are WASM-bound and can
stall the main thread; interactive editors move them to a worker so a large open/merge/compact does
not drop audio callbacks or interaction frames (Automerge 2.0 rewrite motivation, above; general
local-first worker-offload guidance,
[Smashing, *Architecture of local-first web development*](https://www.smashingmagazine.com/2026/05/architecture-local-first-web-development/)).

---

## Current-State Map

Write path for one project mutation:

```
executeAppAction (Command/useCases/executeAppAction.ts)
  setSemanticContext → runWithAutomergeStorageTransaction(scoped commitOwner)
    handler.execute → store.set(...)                       // adapter cache updated now
      createAutomergeStorage.set  → rAF-deferred pending (createAutomergeStorage.ts:~560)
  storage_transaction.commit()  → flushMatchingAutomergeStorageWrites
    commitAutomergeStorageMutations → port.mutateDoc
      automergeRepository.changeDoc (automergeRepository.ts:281)
        change(doc, …) ; notifyListeners(id)               // SYNCHRONOUS
          setupProjectionBridge listener → projectCrdtToStores()  // ALL stores hydrate
```

- **Adapter** `src/infra/store/storage/createAutomergeStorage.ts` — per-store cache + rAF-coalesced
  CRDT write; owner/revision bookkeeping; #601 superseded-write guard (`preparePendingWrite`,
  `committedSetRevision`); #658 deferred-visibility notify (`recordCommittedWrite`,
  `abortPendingWrite`, `subscribe`); `hydrate()` includes a back-write path (line ~ "known-but-absent"
  branch: `writeToCrdt(cachedValue)`).
- **Repository** `src/modules/CrdtDocument/repositories/automergeRepository.ts` — singleton doc
  holder. `changeDoc` (281) / `replaceDoc` (300) / `mergeRemoteDoc` (318) / `restoreSnapshot` (445)
  all call `notifyListeners`. `createProject` (259) does **not**. Heavy decode/merge offloaded to
  `workers/crdtWorker.ts` (`invokeWorker`); **save/compact are not offloaded** (`saveAll`, `saveDoc`
  call `save()` on the main thread).
- **Projection bridge** `useCases/projection/setupProjectionBridge.ts` — subscribes `onChange`;
  narrows on the `DOC_PREFIX_ROOT` hint (§138.1) then calls `projectCrdtToStores()`.
  `projection/projectProjection.ts` lists **11 stores** + `hydrateMidi/Yeast/Knead/Sidechain`
  functions.
- **executeAppAction** `src/modules/Command/useCases/executeAppAction.ts` — scoped transaction;
  `no-write`/`conflict` → `abort()`; success → `commit()`; action-history metadata recorded
  **after** commit (unscoped, separate write path).
- **Collaboration** `src/modules/Collaboration/useCases/automergeSync.ts` — per-peer per-doc
  `SyncState`; §138.1 single-doc fast path; `receiveSync` calls `resetActionReplayAuthority()`
  (line 197) before `replaceCrdtDoc`. Transports in `repositories/peerConnection.ts`: `crdt-sync`
  channel `{ordered:true}` (28,61); `presence` channel `{ordered:false, maxRetransmits:0}` (29,66).
- **Undo — two systems.** (a) `undoStore` stack (`useCases/undo.ts`,`redo.ts`) replays
  `inverseAction` directly. (b) CRDT action-history revert (`useCases/revertAction.ts`) gated on
  `actionReplayCapabilities` (`Command/stores/actionReplayCapabilities.ts`).
- **Autosave** `useCases/startCrdtAutoSave.ts` — 2 s debounce, `MAX_WAIT_MS` 10 s cap, pagehide /
  visibilitychange flush; durability establishment via `compactProject`.
- **CRDT-backed stores** (15 `createAutomergeStorage` slots, all `DOC_PREFIX_ROOT`): tracks,
  takeLanes, markers, transport, tempoMap, timeSignatureMap, automation, **modulation**, cvGate,
  sidechainRoutes, arrangements, projectMeta, knead, midi, actionHistory. **`toCrdt` strippers:**
  tracks, knead, transport, projectMeta only. **`hydrateMissing`:** actionHistory, chordTrack, midi
  only.

---

## Findings

### CC-1 — Full 15-store re-projection fires on *every* CRDT change, local included — O(project size) per frame — **major / M**

`automergeRepository.changeDoc` (automergeRepository.ts:281,289) calls `notifyListeners(id)`
synchronously on every mutation; the projection bridge listener runs `projectCrdtToStores()`
(projectProjection.ts:28) which calls `.hydrate()` on 11 stores + 4 hydrate functions. Each
`adapter.hydrate()` executes `JSON.stringify(incomingValues)` **before** the `lastHydratedJson`
early-return (createAutomergeStorage.ts, hydrate body), so every store re-serializes its whole doc
slot on every change to *any* store.

The design comment in `setupProjectionBridge.ts` claims projection "is only needed for Phase 2
(incoming remote changes). For local operations, AutomergeStorage handles the write path directly."
The bridge cannot distinguish local from remote — `changeDoc` notifies unconditionally — so this
full re-projection also runs for every **local** edit. On a knob sweep / fader drag the adapter
coalesces to one `changeDoc` per animation frame (adapter docstring), and each such frame therefore
pays `Σ JSON.stringify(slot)` across all 15 slots — dominated by `stringify(tracks)` for a large
arrangement. This is `O(total serialized project size)` per interaction frame regardless of the
size of the field that changed — the exact opposite of G1/G2's "cost proportional to what changed."

Amplifier: `executeAppAction` records action-history metadata *after* `commit()`, as an **unscoped**
store write (executeAppAction.ts, post-commit block → `actionHistoryStore` set). That is a second
rAF → second `changeDoc` → second full re-projection. Every undoable action pays the projection
storm at least twice.

Failure mode: interaction-thread jank / dropped frames on gesture-dense edits over large projects;
competes for the main thread with audio-graph scheduling. **(static; unproven at runtime — no
captured frame trace.)** Firing condition: any project mutation. Blast radius: every hot editing
gesture, worse as project grows.

### CC-2 — `hydrate()` writes back into the document → projection is a second writer; re-entrant O(n²) storm; latent stale-bleed — **major / M**

`createAutomergeStorage.hydrate()` "known-but-absent" branch: when a slot is **missing**,
`cachedValue !== null`, and the store has **no `hydrateMissing`**, it calls
`writeToCrdt(cachedValue)` — a synchronous `commitAutomergeStorageMutations` → `changeDoc` →
`notifyListeners` → `projectCrdtToStores()` **re-entrantly, from inside a projection pass**. This is
exactly the "projection you cannot throw away / a second writable copy of truth" that
crdt-collaboration rule 2 and G2 forbid.

Only 3 of 15 slots carry `hydrateMissing` (actionHistory, chordTrack, midi). The other 12 (tracks,
automation, modulation, transport, tempoMap, timeSignatureMap, markers, takeLanes, arrangements,
projectMeta, cvGate, sidechainRoutes, knead) take the back-write branch whenever their slot is
absent with a non-null cache.

Two consequences:
1. **Re-entrant recursion.** During one projection pass over an empty/partial doc, each missing-slot
   store back-writes → nested full `projectCrdtToStores()` → up to ~12 nested passes, each
   re-hydrating all 15 stores with full `JSON.stringify` → `O(n²)` hydrate calls on a single reset
   or first-change. This matches the #687 forensic note that
   "changeDoc→notifyListeners→projectCrdtToStores runs synchronously and re-entrantly."
2. **Stale-bleed across authority boundaries.** `resetCrdtProjectAuthority` →
   `automergeRepository.createProject` (259) clears repo docs but **does not** `notifyListeners` and
   **no code clears the project-store caches** (whole-scope grep: no `clearProjectStores` /
   project-store `.clear()` on switch). The stores retain the previous project's `cachedValue`. The
   first hydrate against the fresh empty root then **back-writes the previous project's tracks /
   automation / markers / … into the new document** — a new/blank project silently inherits prior
   state. Guarded only when a template action repopulates every slot before any hydrate.

Failure mode: correctness (stale project data resurrected into truth, then persisted and synced) +
main-thread stall. **(static; unproven at runtime — deterministic repro requires the live app, out
of scope for this audit lane.)** Firing condition: hydrate of a missing slot with a live cache
(authority reset, new blank project, partial remote doc). Blast radius: cross-project truth
integrity.

### CC-3 — Every received sync wipes all action-replay capabilities → collaborative revert-from-history is dead during active sessions — **major / S**

`automergeSync.receiveSync` (automergeSync.ts:197) calls `resetActionReplayAuthority()` →
`clearActionReplayCapabilities()` (actionReplayCapabilities.ts:260), which bumps the generation and
**clears every capability and tombstone**, *unconditionally, before* `replaceCrdtDoc` — on every
inbound `crdt-sync` message, including no-op sync rounds and `branch_*` / `__branches__` doc syncs,
not only root edits.

`revertAction` (revertAction.ts) — the action-history-panel revert — requires
`claimActionReplayCapability`; with capabilities cleared it returns `{status:'unavailable'}` for
**every** history entry. Capabilities are only re-registered by *new local* `executeAppAction`s.
Net effect: in any live collaboration session, a peer's edit (or a routine sync round) disables the
user's ability to revert any prior action from the history view until they perform fresh local
actions. The action-history entries remain visible (the store is CRDT-synced) but inert — the
"technically-consistent document nobody can explain" failure of rule 6 / G3.

Note the asymmetry with the other undo system: the `undoStore` stack (`undo.ts`) is *not* cleared
by sync — see CC-6 for its opposite hazard.

The clear is defensible as a safety measure (a locally-held `inverseAction` may be stale against a
remotely-merged doc), but its granularity — all capabilities, every message — is far wider than the
risk. Failure mode: feature degradation (collaborative selective-undo non-functional). Firing
condition: any inbound sync. Blast radius: all history-panel reverts for the duration of a session.

### CC-4 — `modulationStore` is written and synced to the CRDT but never projected back — write-only truth slot — **major / S**

`modulationStore` persists to `createAutomergeStorage(DOC_PREFIX_ROOT, 'modulation')`
(modulationStore.ts:265) and is mutated by `addMapping`/`addModulator`/`updateModulator`/… so its
slot is written into the document, persisted to IDB, and synced to peers. But it is **absent from
`projectCrdtToStores()`** and **no hydrate function covers it** (whole-scope grep:
`modulationStore.hydrate` → 0 hits; not in projectProjection.ts's `projectStores` nor in
`hydrateMidi/Yeast/Knead/Sidechain`).

Because the store constructs at module init (before any project loads) and is never re-hydrated,
the persisted `modulation` slot is never read back: modulation mappings are **lost on reload** and
**never received from a peer** even though the local edits are broadcast to them. This is a
one-directional truth slot — writes reach the document, projection never returns. Either the store
must be in the projection set or it should not be CRDT-backed; the current asymmetry is a defect
under any reading. Failure mode: silent data loss on reload + non-convergent modulation in collab.
Firing condition: reload or remote peer with modulation edits. Blast radius: all modulation
state.

### CC-5 — Discard terminal (`didDiscard`) recomputes and notifies nothing — sound for the superseded case, a narrow gap for the doc-absent case — **minor / S**

`flushMatchingAutomergeStorageWrites` routes a write whose `prepare()` returns null into
`write.didDiscard()` → `releasePendingWrite` (createAutomergeStorage.ts), which — unlike
`recordCommittedWrite` (#658) and `abortPendingWrite` — does **not** `recomputeCachedValue()` nor
`notifyDeferredChange()`.

For the **superseded-unscoped** trigger (#601 guard: `pending.revision < committedSetRevision`)
this is provably sound: `committedCacheRevision` is bumped to `++nextRevision` at commit, so any
pending that set before that commit can never be the visible (max-revision) value; the discarded
pending is already non-visible and the cache already reflects the newer committed value. No notify
is correct.

For the **doc-absent** trigger (`createMutation` returns null because `!port.hasDoc(docId)`) the
cache keeps the pending's optimistic value that never persisted, with no recompute/notify. Narrow
window (doc missing between reset and load; next hydrate overwrites), but the terminal is
*value-agnostic* — it relies on the caller's context to be safe rather than proving it, so it is a
latent correctness edge if a future caller reaches `didDiscard` while the discarded pending *is*
visible. Failure mode: brief cache/store divergence with no re-notify. Firing condition:
prepare-unavailable while doc absent. Blast radius: one store, until next hydrate.

### CC-6 — `undoStore` undo replays `inverseAction` with no conflict handling, unlike `revertAction` — asymmetric intention preservation — **minor / M**

`undo.ts`/`redo.ts` call `executeAppAction(entry.inverseAction, {skipUndo:true})` and treat any
resolved promise as success. `revertAction.ts` handles `AppActionConflictError`
(restore-capability) and `AppActionCommittedError` explicitly. So the *stack* undo path has weaker
concurrency semantics than the *history* revert path: undoing a local action after a peer edited
the same entity applies the inverse against the merged state with no intention check (G3). The
Automerge merge still converges, but the *result* of the undo may not match user intent. Failure
mode: surprising undo outcomes under concurrency. Firing condition: local undo of an entity a peer
concurrently changed. Blast radius: undo correctness in collaboration.

### CC-7 — `preparationFailed` orphans a pending write (cancelled rAF, never retried) — **minor / S**

In `flushMatchingAutomergeStorageWrites`, when a `write.prepare()` **throws**
(`preparationFailed`), the group is `continue`d: the write stays in `pendingAutomergeStorageWrites`
with `rafId` already cancelled and no re-arm. It will only ever flush if a later flush targets the
same owner. `prepare` → `createMutation` → `toDocSafe` (`JSON.parse(JSON.stringify)`) / `toCrdt`
can throw on a non-serializable value. Failure mode: a stuck, never-persisted write (silent local
data loss for that store) and a leaked pending entry. **(static; requires a throwing serialize to
trigger.)** Firing condition: `toCrdt`/serialize throws during flush. Blast radius: one store's
write.

### CC-8 — Compaction / full-save runs `save()` on the main thread; only decode+merge are worker-offloaded — **minor / M**

The CRDT worker (`crdtWorker.ts`, `invokeWorker`) offloads `loadAll`/`mergeBundle` (heavy parse).
But `automergeRepository.saveAll`/`saveDoc` call Automerge `save()` synchronously on the main
thread, and `compactProject` (via `runCrdtPersistenceOperation('compact')`) full-saves all docs.
Autosave's durability path invokes `compactProject` periodically, and the debounced incremental
path uses the cheaper `saveIncremental`. For a large project, the periodic full-save is a
main-thread WASM cost not covered by the worker offload (G5). Failure mode: periodic jank during
editing. **(static; unproven at runtime.)** Firing condition: compaction / explicit save. Blast
radius: interaction thread during save.

### CC-9 — Automation recording buffers points in a transient in-memory map, outside the CRDT, until flush — durability window — **polish / S**

`recordAutomationValue` (automationRecording/recordAutomationValue.ts) pushes points into
`pendingPoints` (in-memory) and defers the CRDT write to `stopAutomationRecording`. This is the
*correct* choice for write-amplification (it explicitly replaced a per-value "~100 Hz full lane
re-map"), and it means gesture-rate recording does **not** hit CC-1 per sample — a positive. The
tradeoff: an in-progress recording pass (potentially minutes) lives only in RAM; a crash/close
before flush loses it (autosave never sees it). Bounded and arguably acceptable, noted for
completeness. Firing condition: crash during an active recording pass. Blast radius: unflushed
automation.

### Confirmed sound (no risk observed in scope)

- **Presence transport isolation (G4).** `peerConnection.ts` puts presence on an unreliable,
  unordered channel (`{ordered:false, maxRetransmits:0}`, lines 29,66) separate from the reliable
  ordered `crdt-sync` channel (28,61). `broadcastPresence` uses `peerManager.broadcastPresence`
  (its own channel), never the document sync path. Presence spam cannot head-of-line-block document
  convergence. **None observed.**
- **Receive-sync loop guard.** `isApplyingRemoteSync` (automergeSync.ts) suppresses re-broadcast of
  a received change; `persistCrdtProject()` after receive is fire-and-forget (does not block the
  sync loop). **None observed.**
- **Unknown-doc rejection.** `isKnownDocId` refuses arbitrary peer-minted docs
  (root / `__branches__` / `branch_*` only). **None observed.**
- **Autosave starvation cap.** `MAX_WAIT_MS` (startCrdtAutoSave.ts) bounds persistence lag under a
  continuous edit gesture; pagehide + visibilitychange flush the debounce. **None observed** beyond
  the inherent async-IDB hard-crash window the code already documents.
- **§138.1 single-doc sync hint.** `sendDocSyncToAllPeers` cuts per-edit sync from
  `O(peers×docs)` to `O(peers×1)`. **None observed.**

---

## Remediation Roadmap (first-class directions; sizing S/M/L)

1. **CC-4 (S, do first — data loss).** Resolve the `modulation` slot asymmetry: add
   `modulationStore` to `projectCrdtToStores()` (with a `hydrateMissing` default), or remove its
   CRDT backing if modulation is meant to be derived. Add a projection-completeness test asserting
   every `createAutomergeStorage(DOC_PREFIX_ROOT, …)` slot has exactly one projection consumer.
2. **CC-2 (M).** Make projection purely derived: remove the `writeToCrdt(cachedValue)` back-write
   from `hydrate()`; give every project store a `hydrateMissing` default (or an explicit reset), and
   clear project-store caches on authority switch so a fresh doc cannot inherit stale caches. Kills
   both the re-entrant storm and the stale-bleed.
3. **CC-1 (M).** Make projection incremental/per-slot: dispatch hydrate only to the store(s) whose
   slot changed (the `changeDoc` already knows the doc; extend the hint to the changed key set), and
   skip re-projection entirely for locally-originated writes (the adapter already holds the truth).
   Move the pre-compare `JSON.stringify` behind a cheap identity/heads check.
4. **CC-3 (S).** Scope replay-authority invalidation to the docs/entries a received sync actually
   touched instead of clearing all capabilities on every message; or re-derive capabilities from the
   synced action-history rather than dropping them.
5. **CC-8 (M).** Offload `save`/`saveAll`/compaction to the CRDT worker as load/merge already are.
6. **CC-6 (S).** Route `undoStore` replay through the same conflict-aware path as `revertAction`.
7. **CC-5 / CC-7 (S).** Make `didDiscard` recompute+notify like abort (or prove the invariant at the
   call site); re-arm or explicitly fail an orphaned pending on `preparationFailed`.

---

## Open Questions

- **CC-4 intent:** is `modulation` meant to be collaborative project truth (then projection is the
  bug) or engine-derived local state (then the CRDT slot is the bug)? Needs an owner decision.
- **CC-2 reachability:** is a truly-blank `createCrdtProject` (no template) reachable from the UI,
  and does any flow project before the first store write? A live repro would confirm/deny stale-bleed
  — out of scope for this static audit lane.
- **CC-1 / CC-8 magnitude:** no runtime frame trace was captured (audit-only, no app run). The cost
  shape is derived from code; a profiler pass on a large project during a knob drag and during
  compaction would quantify actual frame budget consumed.
- **CC-3 rationale:** confirm whether the wide capability-clear is a deliberate safety stance; if so,
  document the collaborative-revert limitation, since the history panel currently offers an inert
  control during sessions.

---

## Sources

- [Automerge 2.0 — performance and binary format](https://automerge.org/blog/automerge-2/)
- [Automerge — synchronization protocol](https://automerge.org/docs/repositories/synchronization/)
- [dmonad/crdt-benchmarks](https://github.com/dmonad/crdt-benchmarks)
- [Shapiro et al., *Conflict-free Replicated Data Types* (INRIA RR-7687)](https://inria.hal.science/inria-00609399/)
- [Ink & Switch — Local-first software: you own your data, in spite of the cloud](https://www.inkandswitch.com/local-first/)
- [Weidner et al., *Collabs: A Flexible and Performant CRDT Collaboration Framework*](https://arxiv.org/abs/2212.02618)
- [Yu, Ignat et al., *A CRDT Supporting Selective Undo for Collaborative Text Editing*](https://members.loria.fr/CIgnat/files/pdf/YuDAIS15.pdf)
- [Smashing Magazine — The architecture of local-first web development](https://www.smashingmagazine.com/2026/05/architecture-local-first-web-development/)
