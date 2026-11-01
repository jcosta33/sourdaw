# Lesson library: replay authority

Defects where Undo, Redo, group revert, a queued write or a deferred continuation acts on project truth other than
the one it captured: a peer edit, a replaced root reusing IDs, a newer transition, a refused outcome treated as
success. Split out of `project-integrity.md`; project truth is the CRDT root and every projection is a witness.
Each probe names the input or state that breaks and the check that must go red. Drive production actions and
real Automerge bytes (save, binary reload, fresh projections, hydrated history) and read raw CRDT truth beside
every projection; a probe that mocks the owner, starts at epoch 0 or stays in memory observes none of these
boundaries.

## Standing probes

### 1. Replay preflights every owner it will write, against live state, before any write (#2169, #3809, #4564, #5613)

- Failure: Undo, Redo or group revert overwrites or duplicates peer work, or fails half-way and consumes history.
- Probe: after save, reload and hydration, sync a peer change into each owner the replay touches, then run single and
  grouped replay: later MIDI notes/CC/bend, gain, warp or automation; a same-ID clip recreated on another track or in
  the track (count both); a recorded ID moved between history legs (a discard authenticates its pending inverse); ripple
  collateral rectangles and shifted automation scope; a reused retired lane id; locked, frozen or wrong-kind topology;
  unrelated same-track growth (valid) against a changed insertion slot, neighbour or cross-track array placement
  (refuse); a peer take selection after split Undo; a root rolled back in lineage from a committed observer (head change
  alone never refreshes an inverse); a peer rename published after the replay's write was staged but before Command
  committed, in both admission orders (both edits, or zero-write refusal, never hydration erasing the restore). Require
  zero owner writes, unchanged raw/heads/projections and complete history pending, an earlier group member never
  executed, and peer material surviving valid replay. Guarded restores declare safe reapplication so
  `executeAppActionBatch(..., { requireCompensation: true })` accepts them; removing the guard fails the atomic case.
  Group preflight projects earlier members in order (lanes restored by a non-ripple removal included) and rejects a
  duplicate restored lane ID against that prefix; a live-only guard falsely refuses the genuine group. Initial missing,
  ambiguous, locked or frozen topology rejects direct and atomic execution alike (the direct dispatcher skips handler
  validation). Retired-take restore drops a captured region on any live overlap, returns disjoint ones, and restores a
  selection with no live lane. Redo's fresh producer capture must reach the retained inverse (authenticating the first
  gesture after a later real Redo is stale): run Undo, Redo, a peer change, Undo. A round trip with no peer owner proves
  no protection.

### 2. A refusal or post-commit fault must reach its consumer as an outcome (#2035, #3982, #2597, #5578, #5565)

- Failure: a writer's false/no-write counts as success and consumes Undo, a guard resolves silently, or a failure after
  commit is lost or thrown into recovery.
- Probe: fail the real post-commit device load: a warning names the device, identity and tracks stay valid, an obsolete
  generation warns nothing over its replacement. Replay a genuine legacy trim inverse (no offset capture; looped MIDI at
  an unchanged start; loop disabled by a peer) through the real consumer: visible conflict, raw, projections, past,
  future, tree and mirror unchanged, admission observed after a held snapshot wait, grouped replay refusing an unproven
  prefix before sibling writes. An AI group revert whose older member conflicts after a newer one applied commits
  nothing and writes no engine value (mutation-owner authorization captured before the first await). A failed Freeze
  settles its diagnostic through a separate non-undoable action; withdraw task, cancellation, root, revision or
  expected-aggregate authority before admission and after settlement stages its replacement, and a stale attempt cannot
  erase its successor while real rollback, cleanup and storage failures stay observable; a refusal still discards the
  Redo capture, and a durable or ambiguous commit keeps its proven settlement. Missing-capture MIDI inverses
  refuse in any mode; saved audio stays replayable; history snapshots keep callback identity. Pair the group revert with
  an unrelated later musician edit and real Redo, from panel and thread callers.

### 3. Transaction terminals and queued writes honor current authority (#576, #806, #229, #4071, #1949)

- Failure: a scope or listener re-enters after commit, a terminal installs an older value, a trim outlives abort, or a
  null-journal write supersedes newer scoped truth.
- Probe: atomic port that publishes document A then calls a listener: supplied and captured scopes refuse inside their
  callbacks, document B, cache and pending count stay unchanged after a later flush, and `set`/`clear` in an entered
  scope mutate nothing. Re-enter hydrate with and without a nested flush: one original-owner mutation, identical
  raw/cache/decoder results; publish-then-throw stays committed; `null` from an inbound projector is a value. Fill
  bounded history, stage eviction through the public storage transaction, abort: the oldest replay capability returns
  (reconcile authority from committed history, never elapsed time as a publication signal or restored metadata). Keep a
  same-content empty clear followed by an ID re-add, successful eviction and consumed or claimed inverses as controls.
  Hold a scoped write, queue an unscoped one, advance the scope, flush the older: `null` captures lose to the newer
  commit, every nonnull journal (including `[]`) keeps owner semantics. Fail only `Storage.setItem` of a run, then
  cancel: the terminal revision reaches storage before any cleanup. Every callback in the terminal read path can
  itself accept newer same-slot authority, so fence the whole read, decode, guard and local-field projection sequence
  with a document-authority epoch: land a same-slot write inside a decoder or validator callback (nested commits
  authored before the outer write too), reset projection during preparation and terminal projection, and throw from
  trailing reads after one document publishes. A stale continuation settles against the retained newer baseline
  (publication order, not author revision order); the old identity stays inert and claims release.

### 4. Captured root and project identity must survive every wait (#5517, #5556, #5849, #5091, #5789, #5780)

- Failure: an await, queue or deferred effect resumes against a replacement project reusing IDs, or trusts the
  optimistic projection over the committed root.
- Probe: capture the root at entry, hold the real snapshot wait, queue, effect or permission, replace the root with a
  same-ID successor through production repository and projection (or restore, or clear Undo), then release: no write,
  history entry, discard, strip or capture request reaches the successor, refusal is visible, its Redo/past/tree are
  unchanged and all-refused adds zero to Transport's public gesture count. Same-root controls complete; removing the
  post-wait guard fails. Covers gesture queues, Stop and audio terminals, fork vs switch, deferred replay effects
  (finalize once at the publication boundary with the original entry objects; a no-publication no-op also rechecks
  mutation authority and the Undo snapshot), restoration effects after deletion Undo (rearm only the committed,
  still-present owner; pending permission never blocks Undo history; published-but-throwing commits and a denied device
  never turn restored truth or Undo into a failure), and Crumbs sample publications (own metadata commit and knob edits
  keep authority, replaced root/device or fresh sample leaf revokes). Runtime ownership follows committed intent: hold
  a removal projecting absence, commit a replacement input, observe raw root, projection and runtime together; abort
  keeps committed On (`session-lifecycle.md`). Stop: land one sibling before replacing the root and refuse another
  afterward (landed entry plus exactly one settled gesture kept); removing dispatch-option forwarding fails the case.

### 5. Authority tokens ignore the guarded action's own writes yet revoke on foreign ones (#5573, #2747, #5677, #5681)

- Failure: a captured epoch, revision or heads token aborts its own action, or stays valid after a foreign write.
- Probe: run the real path after one real `runProjectLoadTransaction()` prepare/activate (never epoch 0), across a
  frame, with a genuinely newer transition still winning; make the action's own `shouldProceed` reread the epoch or
  restore the revision comparison and the case fails (discard guards on project identity). A queued track-selection
  flush after proposal must not revoke a confirmed batch (same root contents and heads; final risk binding uses the same
  proof; executes once, one Undo) while a conflicting edit or an independent writer still does. A same-lineage
  replacement or snapshot restore whose new active heads drop a prior head records a discard epoch that rejects earlier
  approvals. Checkpoint-only descendants of two captured heads stay eligible, compared at their own dependency frontier;
  an unresolved whole-map checkpoint conflict refuses at confirmation.

### 6. Identity-scoped undo must survive peer edits (#3757)

- Failure: whole-aggregate snapshot restore erases peer work an isolated round trip never sees.
- Probe: peer edit after the operation and again after Undo, then real Undo/Redo through Command, reading raw CRDT
  and projection. Field order alone never conflicts; changed values, array order, missing fields, bad captures refuse.

### 7. Grouped inverse capture must read the owning action prefix (#4083, #4073, #4071)

- Failure: `executeAppActionBatch` describes members before executing, so later inverses capture pre-batch state.
- Probe: real grouped Undo/Redo against raw CRDT and projection; swap the earlier-sibling projection for live pre-batch
  state and the group fails. When a member snapshots state an earlier one produced (comp-then-remove), inspect the real
  history entry: a correct final state does not prove the inverse composed the prefix.

## Retired lessons

- Don't Save refused through a guard on its own load epoch (#5573) → enforced by
  `src/modules/Project/useCases/projectPersistence/__tests__/discardProjectChanges.realPath.spec.ts` (activated epoch);
  the general rule stays in probe 5.
- Checkpoint descendants lost the sibling frontier (#5681) → enforced by
  `src/modules/CrdtDocument/useCases/__tests__/projectRevisionMatchesLiveIgnoringCommandCheckpoint.spec.ts` ("accepts
  checkpoint-only descendants of both captured root heads").
