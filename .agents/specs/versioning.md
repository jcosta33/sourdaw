SYSTEM PROMPT / CONTEXT FOR AI AGENT

# Sourdaw CRDT Superpowers — Extended, Corrected Implementation Guide

# Target: existing AutomergeStorage architecture, single-player/local-first first, no audio-engine corruption

## 1. Objective

Expand Sourdaw’s current AutomergeStorage architecture to add single-player local-first capabilities that leverage real Automerge/CRDT strengths:

- append-only change history
- deterministic merge/convergence
- document branching/forking
- point-in-time views by heads
- incremental persistence
- multi-document repository patterns

The goal is to implement:

- semantic history inspection
- safe non-linear compensating undo workflows
- zero-friction offline merge/import
- project branching
- gradual migration toward lazy-loaded child documents
- all without allowing raw CRDT state to write directly into the live audio engine

This work must be built on top of the current architecture:

- `AutomergeStorage<T>`
- `automergeRepository`
- `projectCrdtToStores()`
- existing store hydration flow
- existing `.sdaw` import/export / merge flow

This is an extension of the current approach, not a replacement.

---

## 2. Critical Fact-Checked Corrections

These corrections override any earlier assumptions.

### 2.1 Semantic undo is possible, but not because Automerge gives us a generic “invert arbitrary change by hash” API

Automerge exposes:

- change messages
- optional timestamps
- actor IDs
- change history
- heads
- point-in-time views
- diffs between heads

That is enough to build a strong semantic history system.

However:

- do not assume Automerge gives us a universal built-in `revertChange(changeHash)` primitive
- do not assume arbitrary low-level CRDT ops can always be inverted safely
- do not build the feature around decoding and blindly inverting internal Automerge ops

### Correct approach

Build application-level semantic undo intents on top of Automerge history.

That means:

- every meaningful DAW action must produce:
    - a readable message
    - actor/device attribution
    - a timestamp
    - enough semantic metadata to compute an inverse later
- undo is implemented by applying a new compensating change at the current head
- not by rewinding document time globally

Example:

- original action: “Set track trk_a volume from -3.2 dB to -6.0 dB”
- inverse action: “Restore track trk_a volume to -3.2 dB”

This keeps undo aligned with local-first collaborative semantics.

---

### 2.2 Branching is real, but “selective merge” is not a free built-in primitive

Automerge supports:

- cloning/forking documents
- merging branched documents back together
- viewing old heads

But:

- `merge(docA, docB)` merges whole document history
- it does not natively mean “merge only track 7 from branch B into branch A”

### Correct approach

If we want selective merge such as:

- “bring the radio-edit arrangement from branch X into main”
- “merge only this clip lane”
- “pull only this track”

then the merge unit must be designed for it.

That means:

- either split those units into separate child documents
- or implement app-level cherry-pick/copy-import logic for specific entities

Therefore:

- whole-project branching can ship early
- selective merge must depend on document boundaries or explicit app logic

---

### 2.3 Persistence should be incremental, but not “incremental only forever”

Automerge supports incremental persistence patterns.

But:

- do not remove all concept of periodic compaction/checkpointing
- do not treat “append deltas forever” as the final storage strategy
- do not claim storage is “mathematically impossible to corrupt” just because it is append-oriented

### Correct approach

Use:

- incremental writes for responsiveness
- periodic compact snapshots/checkpoints for bounded storage and faster startup
- crash-safe file writing discipline for Tauri/native persistence

The correct goal is:

- crash-resistant
- append-friendly
- recoverable
- concurrent-safe

Not:

- “absolutely impossible to corrupt under any storage/backend failure mode”

---

### 2.4 Offline merge should be based on shared history / document identity, not “root actor lineage”

Automerge actor IDs identify authors of changes.
They are not the right basis for deciding whether two projects belong to the same branch family.

### Correct approach

Merge detection should be based on:

- shared document identity where appropriate
- shared history / heads / change graph ancestry
- import/export bundle metadata for multi-doc projects

Do not implement:

- “if root actor matches, silently merge”

That is the wrong abstraction.

---

### 2.5 Concurrent scalar updates are not a built-in app-controlled LWW policy

Do not describe Automerge scalar conflict behavior as “internal LWW” in the strict product sense.

For concurrent assignments:

- Automerge converges deterministically
- one visible value is chosen deterministically
- conflicting values can still exist in the conflict set and be inspected if needed

### Product implication

For DAW semantics where one visible scalar is acceptable:

- this is fine for v1
- if a specific conflict policy is required later, implement it explicitly at the app layer

---

### 2.6 Lazy loading is valid, but aggressive unload/reload must be designed carefully

Automerge Repo supports multi-document management and handles.
Documents can be represented by refs/URLs and loaded when needed.

However:

- unloading/reloading behavior is subtle
- frequent “auto-unload on UI close” may create complexity
- the audio engine must never discover too late that a required child document is unavailable

### Correct approach

Use a staged lazy-loading strategy:

- root document always resident
- visible/active track docs preloaded
- clip/automation docs loaded on viewport selection or playback prefetch
- unload only with an explicit cache policy and safety checks
- engine playback always wins over UI memory-saving

---

## 3. Product Principles

1. The CRDT is canonical project state, not direct engine state.
2. Every local action must remain valid offline.
3. Undo must be expressed as “apply a compensating change now,” not “rewind the world.”
4. Branching should feel cheap and safe.
5. Import/merge from external `.sdaw` bundles should be mostly automatic when histories match.
6. Large sessions must move toward multiple child documents, but the migration should be incremental and safe.
7. The audio engine must receive validated commands/projections, never arbitrary raw remote history mutations.

---

## 4. Current Architecture Assumptions

The following existing system is assumed.

### Existing frontend CRDT layer

- `src/modules/CrdtDocument/repositories/automergeRepository.ts`
- `src/modules/CrdtDocument/useCases/crdtProjectLifecycle.ts`
- `src/modules/CrdtDocument/useCases/crdtMerge.ts`
- `src/modules/CrdtDocument/useCases/mergeOnOpen.ts`
- `src/modules/CrdtDocument/useCases/projection/projectProjection.ts`

### Existing storage backend

- `src/helpers/Store/Storage/AutomergeStorage.ts`

### Existing Rust/native side

- `crates/daw-collab/document_store.rs`
- `crates/daw-collab/persistence.rs`
- `crates/daw-collab/schema.rs`
- `src-tauri/src/commands/collab.rs`

### Existing current-state stores using AutomergeStorage

- `trackStore`
- `automationStore`
- `midiStore`
- `transportStore` (with ephemeral fields stripped)
- `tempoMapStore`
- `timeSignatureMapStore`
- `markerStore`
- `projectStore`

### Existing stores that remain non-CRDT

- `workspaceStore`
- `collaborationStore`
- `clipboardStore`
- `undoStore`
- presentation/UI-only stores

---

## 5. Feature Specification — Corrected

# Feature 1: Semantic History and Non-Linear Compensating Undo

## Goal

Allow users to inspect history semantically and revert a specific earlier intent without rewinding unrelated later work.

Example:

- user changed a delay parameter 10 minutes ago
- then recorded MIDI afterward
- user should be able to revert the delay change now without losing the MIDI recording

## What ships

### 5.1 Semantic change metadata

Every meaningful project mutation must go through a wrapper that records:

- semantic message
- actor/device ID
- timestamp
- action kind
- entity IDs affected
- inverse metadata payload where feasible

Examples:

- `Muted Track 4`
- `Set Track trk_a Volume to -6.0 dB`
- `Added MIDI Note note_1 to clip clip_9`
- `Moved clip clip_1 from beat 32 to beat 40`

### 5.2 History panel

Create a new history UI that shows:

- message
- actor/device label
- timestamp
- affected object/entity label
- branch context if applicable

### 5.3 Compensating undo

Undo must work by applying a new semantic inverse change at the current head.

Examples:

- inverse of scalar set:
    - restore previous value
- inverse of add:
    - delete newly added entity
- inverse of delete:
    - restore tombstoned entity if metadata exists
- inverse of reorder:
    - restore prior order key
- inverse of note move:
    - restore prior note timing
- inverse of range quantize:
    - only supported if original note timing snapshot was captured

### 5.4 Non-goal

Do not attempt universal automatic inversion of arbitrary historical low-level Automerge changes.

## Implementation directives

### 5.4.1 Add semantic mutation wrapper

Create a mutation helper layer, for example:

- `src/modules/CrdtHistory/domain/semanticChange.ts`
- `src/modules/CrdtHistory/domain/semanticActionTypes.ts`

Every store mutation touching collaborative project state must flow through helpers such as:

- `applySemanticChange({ message, actionKind, entityRefs, inversePayload }, callback)`

Behavior:

- internally calls an Automerge change with message/options
- records metadata in a local semantic history index

### 5.4.2 Store inverse payloads at app level

Add a local semantic history journal:

- persisted locally
- keyed by document ID + change hash
- includes enough data to compute inverse actions
- does not need to be part of canonical CRDT unless explicitly desired later

Minimum schema:

```ts
type SemanticHistoryEntry = {
    docId: string;
    changeHash: string;
    actorId: string;
    timestamp: number;
    message: string;
    actionKind: string;
    entityRefs: string[];
    inversePayload: unknown;
    headsBefore?: string[];
    headsAfter?: string[];
};
```

### 5.4.3 Build history browsing on real heads/history

Use real Automerge history/head APIs for:

- listing changes
- time views
- mapping semantic entries onto actual change graph positions

Use available APIs in the current stack for:

- doc history
- handle history
- read-only views at old heads
- diffs between head sets

### 5.4.4 Implement compensating actions, not rewind

Create:

- `src/modules/CrdtHistory/useCases/revertSemanticAction.ts`

Behavior:

1. resolve semantic entry
2. verify target entities still exist or are restorable
3. build inverse app mutation
4. apply inverse mutation at current head
5. produce new history entry such as:
    - `Reverted: Set Track trk_a Volume to -6.0 dB`

### 5.4.5 Unsupported inverse cases

If inverse is unsafe or underspecified:

- show “cannot safely revert directly”
- offer manual inspect/jump-to-entity instead

Examples:

- opaque plugin state blob edits
- destructive bulk transforms with no captured prior values
- imported history chunks missing inverse metadata

---

# Feature 2: Project Branching and Versioned Experimentation

## Goal

Allow users to experiment without duplicating whole project files manually.

Examples:

- “Club Mix”
- “Radio Edit”
- “Alt Vocals”
- “Mastering Pass A/B”

## What ships

### 5.5 Whole-project branch/fork

Users can create a branch of the current project cheaply.

### 5.6 Branch list

UI shows:

- branch name
- created from branch
- created timestamp
- current heads
- optional note/description

### 5.7 Merge back

Users can merge one branch into another.

### 5.8 Selective merge — scoped, not magical

Selective merge is supported only for units explicitly designed for it.

v1 rule:

- whole-project merge first
- selective merge only for child-document units that already isolate a track/clip/lane

## Correct model

### 5.8.1 Branch storage model

Do not invent a fake `BranchId` inside a single Automerge document as the primary mechanism.

Instead:

- a branch is a forked/cloned document lineage
- branch metadata can live in a root branch registry document or app metadata layer
- each branch should point to its root document URL / document ID / bundle ID

### 5.8.2 Branch operation options

Depending on layer:

#### Option A — JS/repo layer

Use repo clone/fork semantics for branch creation if exposed by the current repository wrapper.

#### Option B — core document layer

Use core Automerge clone/fork functionality on the root document and propagate the branch identity at the app layer.

The chosen mechanism must preserve shared history and create a fresh actor identity for later changes.

## Implementation directives

### 5.8.3 Create branch registry

Add:

- `src/modules/CrdtDocument/models/BranchTypes.ts`
- `src/modules/CrdtDocument/useCases/crdtBranching.ts`

Suggested registry schema:

```ts
type BranchRecord = {
    branchId: string;
    name: string;
    rootDocId: string;
    sourceBranchId?: string;
    createdAt: number;
    createdFromHeads: string[];
    note?: string;
};
```

This registry may live:

- in app metadata storage, or
- in a workspace/root meta document,
  depending on desired portability

### 5.8.4 Branch creation

Implement:

- `forkProjectBranch({ sourceDocId, sourceHeads?, name })`

Behavior:

1. ensure source doc is loaded and ready
2. clone/fork source document
3. register new branch metadata
4. optionally copy/update root project pointer
5. open the new branch in UI

### 5.8.5 Whole-branch merge

Implement:

- `mergeBranchIntoBranch({ sourceBranchId, targetBranchId })`

Behavior:

1. load both documents
2. verify they share history
3. perform merge on the target copy
4. add semantic merge provenance if useful
5. rehydrate stores

### 5.8.6 Selective merge rules

Do not implement “merge just this track” by calling `merge(docA, docB)` and hoping.

Instead:

- if a track is a separate child doc, merge that child doc only
- if a feature lives inside the same document, implement explicit app-level copy/cherry-pick

Example selective merge candidates:

- track document
- clip document
- automation lane document

---

# Feature 3: Crash-Resistant Incremental Persistence

## Goal

Make save behavior feel continuous and safe without requiring manual save rituals for canonical CRDT state.

## What ships

### 5.9 Incremental writes on change

Each local CRDT mutation should persist small binary change data quickly.

### 5.10 Periodic compaction

System occasionally writes compact snapshots for faster load and bounded log growth.

### 5.11 Recoverable startup

After crash/restart:

- load latest snapshot
- apply remaining incremental chunks
- recover last valid state

## Critical correction

Do not remove all save/checkpoint concepts from the system.
Manual “save project” UX may still exist for:

- export
- named savepoint
- archive bundle
- explicit file write

But canonical CRDT state should autosave incrementally.

## Implementation directives

### 5.10.1 Frontend/web persistence

For browser-side local persistence:

- keep using IndexedDB/OPFS-compatible binary storage
- store binary chunks directly
- avoid JSON serialization

### 5.10.2 Native persistence

For Tauri/native:

- implement append-friendly chunk storage
- write snapshot and incremental chunks separately, or
- write append log plus periodic compacted snapshot
- use atomic rename / temp-file swap for snapshot compaction
- fsync where appropriate

### 5.10.3 Do not depend only on `getLastLocalChange()`

`getLastLocalChange()` may be useful for immediate sync/streaming, but it is not the whole persistence strategy.

Prefer:

- tracked persisted heads
- incremental save APIs
- repo-style chunk storage
- periodic full save/compaction

### 5.10.4 Persistence strategy by layer

#### JS/browser layer

- use incremental binary persistence for “changes since last persisted heads”
- use full save/compaction periodically

#### Rust/native layer

- persist incremental changes after tracked heads
- periodically write compact snapshots
- support replaying incrementals into a base snapshot on recovery

### 5.10.5 Integrate with existing repository abstraction

Refactor current persistence so that:

- `automergeRepository` tracks persisted heads per doc
- on change, persist only changes since last persisted heads
- compaction job updates persisted snapshot marker

### 5.10.6 Recommended new modules

- `src/modules/CrdtDocument/repositories/crdtIncrementalPersistence.ts`
- `src/modules/CrdtDocument/repositories/crdtSnapshotCompaction.ts`

Rust:

- extend `crates/daw-collab/persistence.rs`
- optionally add `incremental_log.rs`

---

# Feature 4: Offline Import/Merge (“Flash Drive Merge”)

## Goal

Support offline workflows where users move `.sdaw` bundles between machines and merge without “newer file?” dialogs.

## What ships

### 5.11 Import merge flow

When importing a `.sdaw` file:

- if it clearly belongs to the currently open project lineage, merge
- otherwise open separately or offer import-as-branch

### 5.12 Deterministic convergence

Concurrent edits merge without hand-written “pick newer file” prompts.

### 5.13 Conflict inspection when needed

If a field had concurrent conflicting writes:

- visible state converges deterministically
- app may optionally expose conflict details for advanced users/debugging

## Critical correction

Do not say:

- “Automerge resolves volume conflicts by internal LWW”

Say:

- “Automerge converges deterministically for concurrent writes; visible winners are deterministic, and conflicting values can still be inspected if needed.”

## Implementation directives

### 5.13.1 Bundle identity model

Extend `.sdaw` bundle metadata with:

- root document ID
- child document IDs
- export timestamp
- branch metadata if present
- optional source branch/root heads

### 5.13.2 Import decision logic

When opening/importing `.sdaw`:

1. parse bundle metadata
2. compare root document IDs / known branch ancestry
3. if same project lineage:
    - import and merge
4. if same history but different branch:
    - import as branch or merge candidate
5. if unrelated:
    - open as separate project

### 5.13.3 Use history/shared-lineage checks, not actor-lineage checks

Possible checks:

- same root doc ID
- shared history proven by import metadata
- successful diff/merge capability between docs
- branch registry ancestry

### 5.13.4 Merge workflow

Implement:

- `importBundleAsMergeCandidate(bundle)`
- `mergeImportedCandidateIntoOpenProject(candidateId)`

Behavior:

1. import doc(s)
2. verify shared lineage
3. merge root docs
4. merge child docs by matching doc IDs
5. rehydrate projection into stores
6. emit merge result summary

### 5.13.5 UX outcomes

- silent merge if confidence is high
- otherwise:
    - “Import as branch”
    - “Merge into current project”
    - “Open separately”

No “Which file is newer?” dialog.

---

# Feature 5: Multi-Document Architecture and Lazy Loading

## Goal

Move from one giant root document toward a root+child-doc layout that reduces startup cost and memory pressure.

## Current reality

Right now project state is effectively concentrated in one root doc through the AutomergeStorage mapping.
That is acceptable as the current correctness baseline.

### Correct migration strategy

Do not rewrite everything at once.
Split high-cost domains first.

## What ships

### 5.14 Root document stays small

Root doc should hold:

- project metadata
- track registry
- routing registry
- references to child docs
- branch/project pointers
- asset manifest metadata

### 5.15 Child docs for heavy sections

Move into child docs over time:

- track bodies
- large MIDI clips
- heavy automation lanes
- optional editor/session documents
- optional branch-local scratch docs

### 5.16 Demand-driven loading

Load a child doc when:

- visible in viewport
- selected/opened in editor
- needed for playback/render prep
- required for merge/import operation

### 5.17 Safe unload policy

Do not aggressively unload docs needed by:

- active playback
- current recording target
- visible focused editor
- imminent preroll buffer window

## Implementation directives

### 5.17.1 Refactor target order

Split in this order:

Phase A:

- root project metadata
- track documents

Phase B:

- MIDI clip documents
- automation lane documents

Phase C:

- optional device-state or plugin wrapper documents where safe

### 5.17.2 Root references

Use explicit root references such as:

```ts
type RootTrackRegistryEntry = {
    ref: string;
    orderKey: string;
    type: 'audio' | 'midi' | 'bus' | 'master';
};
```

### 5.17.3 Repository loading API

Use repository find/load only when needed.
Create a document loader service:

- `src/modules/CrdtDocument/useCases/crdtLazyLoad.ts`

Responsibilities:

- load doc handle by ref/url
- cache handles
- notify projection system
- expose prefetch and release hooks

### 5.17.4 Cache policy

Implement an LRU-like policy:

- keep active docs resident
- keep nearby playback-window docs prefetched
- unload or detach inactive docs only when memory pressure policy says so

### 5.17.5 Unload caution

If using handle unload:

- gate behind explicit repository cache policy
- verify the handle can be safely reacquired/reloaded in the current stack
- do not rely on UI-close as the sole unload trigger

### 5.17.6 Audio engine rule

If the engine needs a doc for playback:

- preload before playback reaches it
- never block the audio callback on CRDT hydration
- projection/cache layer must prepare canonical engine-ready snapshots ahead of time

---

## 6. Engine Safety Rule

The collaborative/branching document is not the live audio engine state.

Required pipeline:

1. CRDT document changes
2. projection into canonical project model
3. validation layer
4. engine command/snapshot generation
5. engine update

Examples:

- volume field change -> validated mixer parameter update
- clip move -> arrangement mutation command
- imported branch merge -> validated project diff -> engine rebuild/snapshot update
- track doc lazy-load -> hydrate project model -> engine materialization only when needed

Do not allow:

- raw imported child doc state
- raw merged CRDT objects
- raw plugin blobs
  to mutate the engine directly.

---

## 7. Required New Modules

### Frontend / TS

Add:

- `src/modules/CrdtHistory/`
    - `domain/semanticActionTypes.ts`
    - `domain/semanticChange.ts`
    - `repositories/semanticHistoryRepository.ts`
    - `useCases/revertSemanticAction.ts`
    - `useCases/listSemanticHistory.ts`
- `src/modules/CrdtDocument/useCases/crdtBranching.ts`
- `src/modules/CrdtDocument/useCases/crdtLazyLoad.ts`
- `src/modules/CrdtDocument/repositories/crdtIncrementalPersistence.ts`
- `src/modules/CrdtDocument/repositories/crdtSnapshotCompaction.ts`

### UI

Add:

- `src/modules/CrdtHistory/presentations/views/HistoryPanel.tsx`
- `src/modules/CrdtDocument/presentations/views/BranchManagerDialog.tsx`

### Rust / Native

Extend:

- `crates/daw-collab/document_store.rs`
- `crates/daw-collab/persistence.rs`
- `crates/daw-collab/schema.rs`

Potentially add:

- `crates/daw-collab/incremental_store.rs`
- `crates/daw-collab/branch_registry.rs`

---

## 8. Agent Execution Plan

# Step 1 — Introduce semantic mutation wrappers

Refactor existing mutation entrypoints so project-state writes use a semantic wrapper.

Requirements:

- all collaborative mutations get a message
- all collaborative mutations capture timestamp and actor/device label where available
- all collaborative mutations emit a semantic history record
- do not rewrite all handlers at once; wrap the existing Store/AutomergeStorage write path incrementally

Validation:

- history entries are readable
- every major DAW action type appears with a useful message
- change hash can be correlated with the semantic entry

---

# Step 2 — Build history inspection layer

Implement:

- list history entries
- inspect heads/snapshots
- jump to entity from history row
- open point-in-time view for debug/inspection

Validation:

- user can browse semantic history without mutating the current project
- point-in-time views are read-only
- a semantic entry links to the current entity if still present

---

# Step 3 — Implement compensating semantic undo

Implement:

- `revertSemanticAction(entryId)`

Start with safe action classes:

- scalar set
- add/delete entity with restorable payload
- reorder via orderKey restore
- note move/edit
- clip move/edit

Do not start with:

- opaque plugin state
- destructive bulk transforms with missing inverse metadata

Validation:

- reverting an old scalar change does not rewind unrelated later edits
- undo writes a new change at the current head
- engine receives validated command updates only

---

# Step 4 — Add project branching

Implement:

- branch registry
- fork current project
- open branch
- merge branch into target
- import branch from `.sdaw` bundle

Validation:

- branch creation is fast
- branch shares history with source
- merge back converges
- branch metadata survives reload/export

---

# Step 5 — Upgrade persistence to incremental + compaction

Implement:

- tracked persisted heads per document
- incremental write on local change
- periodic compaction snapshot
- recovery path that loads snapshot + incrementals

Validation:

- restart after many edits restores latest state
- compacted loads are faster than replaying long incremental logs only
- crash during incremental append does not destroy the last known valid snapshot

---

# Step 6 — Improve offline import/merge

Implement:

- bundle metadata inspection
- shared-lineage detection
- import-as-branch
- merge-candidate workflow
- automatic merge when safe

Validation:

- importing same-project divergent bundle merges or offers branch import
- unrelated bundle opens separately
- no “newer file?” dialog is needed

---

# Step 7 — Begin multi-doc migration

Start with:

- root doc + per-track docs

Then:

- large MIDI clips
- automation lanes

Validation:

- project opens with root metadata first
- inactive heavy docs are not loaded immediately
- visible track/docs load on demand
- playback-required docs prefetch before they are needed

---

## 9. Validation Checklist

The work is complete only when all are true:

1. Every major collaborative mutation has a semantic message.
2. A history panel can inspect changes without mutating current state.
3. Reverting one old semantic action does not erase unrelated later work.
4. Branch creation is cheap and mergeable.
5. Merge/import logic is based on shared document lineage, not actor coincidence.
6. Incremental persistence works, but compaction/checkpoints still exist.
7. `.sdaw` import can auto-merge matching project lineages.
8. Current root-document behavior still works while multi-doc rollout is in progress.
9. Heavy child docs can be loaded on demand.
10. Audio engine updates still go through projection + validation, never raw CRDT state.

---

## 10. Explicit Non-Goals

Do not do these in this phase:

- universal automatic inversion of arbitrary low-level Automerge changes
- full plugin-state semantic merge
- direct CRDT-to-audio-engine mutation
- replacing current AutomergeStorage approach
- all-at-once migration to many documents
- aggressive unload/reload without a tested cache policy
- describing scalar conflict behavior as built-in LWW

---

## 11. Final Directive

Build on the current AutomergeStorage architecture.

Exploit real Automerge capabilities:

- change history
- messages
- timestamps
- actor attribution
- cloning/forking
- merging
- point-in-time heads/views
- incremental save/load
- repository-based document management

Do not assume capabilities Automerge does not directly provide.

Ship in this order:

1. semantic history metadata
2. compensating semantic undo
3. branch creation/merge
4. incremental persistence + compaction
5. offline bundle merge improvements
6. gradual multi-document lazy loading

Prioritize correctness, recoverability, and engine safety over cleverness.
