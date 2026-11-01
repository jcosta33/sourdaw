# Lesson library: project integrity

Project integrity is the defect class where saved, replayed or recovered project truth disagrees with what the
musician committed. Project truth is the CRDT root; stores, engine state and session history are projections or
witnesses of it. The breaks are Save certifying data that is not durable, history entries that replay against a
project they no longer describe, imports and checkpoints that cross the owner boundary unauthenticated, recovery
that replaces a running project, and tests that observe a mock instead of the committed document.

Each probe names the input or state that breaks and the check that must go red. Drive production actions and real
Automerge bytes (save, binary reload, fresh projections, hydrated history) and read raw CRDT truth beside every
projection; a probe that mocks the owner, starts at epoch 0 or stays in memory observes none of these boundaries.
Runtime-monitor companions live in `session-lifecycle.md`.

## Standing probes

### 1. Save certifies the exact snapshot and every asset it references (#964, #1077, #2822, #3877)

- Failure: Save returns true and clears dirty while the document points at PCM or state that is not durable, was edited
  after capture, or is certified by a receipt belonging to an older candidate.
- Probe: abort only the referenced asset's durable transaction with other stores healthy, Save, clear runtime, restore
  through the production read path; Save returns false and stays dirty, and one later Save persists the exact failed
  source. Queue a real owning edit right after a synchronous snapshot build (no extra await), and between persistence
  awaits while its Automerge write waits for an animation frame; Save fails or includes it, and every continuation
  flushes pending writes before reading identity, revision or receipts. Replace the same asset ID while settlement is
  held, and keep a decoded buffer across a metadata-only project load after a failed write of PCM B: no old receipt,
  witness or completion certifies the replacement, and cold reopen yields B. Restoring the old success path fails the
  import/Save/clear/restore case; collector protection also covers finalized recovery storage.

### 2. Cold-cache consumers rebuild every durable reference and report owner results (#187, #4496)

- Failure: export, mixdown, stems or recovery use a warm cache or a mocked owner, miss a buffer or swallow a failure.
- Probe: cold project with an ordinary clip and an active frozen print whose PCM has its own ID; both IDs reach cache
  restoration before encoding and the encoded PCM is inspected. Dropping the frozen ID fails before encoding; stale
  prints stay excluded and the empty-clip all-buffer fallback stays. Owner mocks satisfy the live callable result
  contract (a void strip mock threw inside recovery, was caught, and the spec stayed green); read logged recovery
  failures before trusting a pass (`test-validity.md`, stale owner result).

### 3. Admission accepts only what hydration keeps (#4987, #5064, #3354)

- Failure: a project file or saved history entry passes admission, then the owning hydrator or restore owner discards
  or mis-writes it, taking selected takes, comp regions or nested satellites with it.
- Probe: probe the serialized candidate before any project, raw or store replacement, then real owner hydration, on
  every route (top-level and saved-arrangement take lanes): reject anchor-only, depth-only, negative or nonfinite
  placement, malformed offset, a missing required capture; keep JSON-roundtripped legacy takes. For saved clip inverses
  seed real gain/warp envelopes and two automation lanes, corrupt one nested field of the persisted capture (string
  `gainDb`, point value, curve, negative beat, empty id, stair steps, duplicate note IDs, malformed CC/bend, nonfinite
  number), hydrate fresh handlers and run real Undo: the entry is dropped before any write, raw, projections and
  history unchanged. Partial move captures (`id`, `trackId`, `points`) use Automation's point contract, not the
  full-lane one. Revert the admission hunk and the rejection cases fail; array-only or sanitizer-only assertions cannot
  carry the claim. Keep valid null, present-empty and legacy-alias controls, and keep restore validation with the owner:
  admitting a forward action to the session mirror must not add it to executable action discovery.

### 4. Saved replay binds relationships between individually valid rows (#5064, #3328, #4108, #4519)

- Failure: each captured row passes its own shape check but its owner, identity or operation is foreign, so replay
  writes into an unrelated clip, track, lane or action.
- Probe: from a genuine saved entry change one relation only: a satellite or nested envelope `clipId`, one automation
  lane's `clipId` or `trackId`, sibling lane IDs made equal or equal to a resident unrelated lane, a retired lane id
  pointed at another track's lane, a split's right-fragment automation or satellite owner, the inverse or redo operation
  type (a valid `setTrackGain` inside `setDeviceParameter`, with and without optional metadata), or one side of a
  mirrored pair. Save/reload and hydrate fresh handlers: the whole entry or group is rejected before any write. Keep
  rich fractional, empty, historical and same-operation controls; enforce the relation in the owner, not by global type
  equality.

### 5. Replay preflights every owner it will write, against live state, before any write (#2169, #3809, #4564, #5613)

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
  Group preflight projects earlier members in order. A green round trip with no peer owner proves no protection.

### 6. Guards and repairs are probed on the real persisted shape (#4111, #2169, #860, #645, #4292, #5495, #5578)

- Failure: a guard refuses unchanged truth (key order, absent vs empty optional, new reference, UI-only state), a repair
  crashes on attached Automerge values, or captured coordinates are valid live but not replayable.
- Probe: run the real prepare, write, fresh projection, Undo, Redo route; reorder nested keys and pass absent,
  `undefined`, empty and populated optionals through the owning codec: unchanged JSON restores while changed values,
  array order, placement and malformed fingerprints refuse before a write. Reset projections as a fresh load does and
  give Undo a different selection and ghosts: durable truth round-trips, UI state survives. Flush CRDT settlement (equal
  values, new reference) before Undo of a retained publication handle. Create real concurrent conflicts at an attached
  `tracks` map and list, run the registered repair, save/reload bytes, then edit. For coordinate captures hydrate both
  history directions (`moving-coordinate-inverses.md#fractional-row-coordinates-and-reciprocal-history-captures`,
  `#fresh-macro-commands-must-discard-inverse-restoration-hints`) and inject a pre-commit storage failure: document,
  projections, both captures, history, tree and mirror unchanged.

### 7. A refusal or post-commit fault must reach its consumer as an outcome (#2035, #3982, #2597, #5578, #5565)

- Failure: a writer's false/no-write counts as success and consumes Undo, a guard resolves silently, or a failure after
  commit is lost or thrown into recovery.
- Probe: fail the real post-commit device load: a warning names the device, identity and tracks stay valid, an obsolete
  generation warns nothing over its replacement. Replay a genuine legacy trim inverse (no offset capture; looped MIDI at
  an unchanged start; loop disabled by a peer) through the real consumer: visible conflict, raw, projections, past,
  future, tree and mirror unchanged, admission observed after a held snapshot wait, grouped replay refusing an unproven
  prefix before sibling writes. An AI group revert whose older member conflicts after a newer one applied commits
  nothing and writes no engine value (mutation-owner authorization captured before the first await). A failed Freeze
  settles its diagnostic through a separate non-undoable action and a stale attempt cannot erase its successor.

### 8. Identity namespaces are declared, scoped by path, and fail closed (#5157, #4036, #1857, #5570)

- Failure: the global ID walk marks a valid project repair-required (blocking Save and Undo), or copied subtrees reuse
  IDs that collide after reload.
- Probe: load each shipped demo and template, save, reload: repair gate stays clear. A split before surviving identified
  automation points (dyadic and non-dyadic cut), a rich audio split with clip-local gain-point IDs, and a chord track
  whose `migrationBase` copies live IDs survive binary reload and repeated Undo/Redo with a full global census.
  Pre-occupy the preferred generated ID under an unrelated owner, and let a peer claim a captured ID after Undo:
  zero-write refusal, no reminting. Duplicates within one envelope, global entity collisions and an undeclared copying
  slot stay repair-required. Scopes (`INDEPENDENT_ID_SCOPES`) are keyed by path from the namespace root, never object
  identity, and each has a case inside a real `change(from(doc))`, where list reads return fresh proxies.

### 9. Transaction terminals and queued writes honor current authority (#576, #806, #229, #4071, #1949)

- Failure: a scope, flush or listener re-enters after commit, a terminal installs an older value, an optimistic trim
  outlives abort, or a null-journal write supersedes newer scoped truth.
- Probe: atomic port that publishes document A then calls a listener: supplied and captured scopes refuse inside their
  callbacks, document B, cache and pending count stay unchanged after a later flush, and `set`/`clear` in an entered
  scope mutate nothing. Re-enter hydrate with and without a nested flush: one original-owner mutation, identical
  raw/cache/decoder results; publish-then-throw stays committed; `null` from an inbound projector is a value. Fill
  bounded history, stage eviction through the public storage transaction, abort: the oldest replay capability returns.
  Hold a scoped write, queue an unscoped one, advance the scope, flush the older: `null` captures lose to the newer
  commit, every nonnull journal (including `[]`) keeps owner semantics. Fail only `Storage.setItem` of a run, then
  cancel: the terminal revision reaches storage before any cleanup.

### 10. Captured root and project identity must survive every wait (#5517, #5556, #5849, #5091, #5789, #5780)

- Failure: an await, queue, held transaction or deferred effect resumes against a replacement project reusing IDs, or
  trusts the optimistic projection instead of the committed root.
- Probe: capture the root at entry, hold the real snapshot wait, queue, effect or permission, replace the root with a
  same-ID successor through production repository and projection (or restore, or clear Undo), then release: no write,
  history entry, discard, strip or capture request reaches the successor, refusal is visible, its Redo/past/tree are
  unchanged and all-refused adds zero to Transport's public gesture count. Same-root controls complete; removing the
  post-wait guard fails. Covers gesture queues, Stop and audio terminals, fork vs switch, deferred replay effects
  (finalize once at the publication boundary with the original entry objects; a no-publication no-op also rechecks
  mutation authority and the Undo snapshot), restoration effects after deletion Undo (rearm only the committed,
  still-present owner; pending permission never blocks Undo history), and Crumbs sample publications (own metadata
  commit and knob edits keep authority, replaced root/device or fresh sample leaf revokes). Runtime ownership follows
  committed intent: hold a removal projecting absence, commit a replacement input, observe raw root, projection and
  runtime together; abort keeps committed On (`session-lifecycle.md`).

### 11. Authority tokens ignore the guarded action's own writes yet revoke on foreign ones (#5573, #2747, #5677, #5681)

- Failure: a captured epoch, revision or heads token aborts its own action, or stays valid after a foreign write.
- Probe: run the real path after one real `runProjectLoadTransaction()` prepare/activate (never epoch 0), across a
  frame, with a genuinely newer transition still winning; make the action's own `shouldProceed` reread the epoch or
  restore the revision comparison and the case fails (discard guards on project identity). A queued track-selection
  flush after proposal must not revoke a confirmed batch (same root contents and heads; final risk binding uses the same
  proof; executes once, one Undo) while a conflicting edit or an independent writer still does. A same-lineage
  replacement or snapshot restore whose new active heads drop a prior head records a discard epoch that rejects earlier
  approvals. Checkpoint-only descendants of two captured heads stay eligible, compared at their own dependency frontier;
  an unresolved whole-map checkpoint conflict refuses at confirmation.

### 12. State oracles and acceptance evidence observe complete project truth (#5646, #5649, #5887)

- Failure: acceptance passes because it counted barrel calls or notifications, or read a different module singleton.
- Probe: typed materialized snapshots around each turn with allowed fields from the frozen oracle, not the action log;
  an outside-barrel write to another track or an unauthorized field beside a valid commit is counted, net-zero writes
  too. Install a changed clone via `insertDoc('root', ...)`, read it, restore it: positive mutation count, barrel count
  unchanged, for create, replace, load, merge, snapshot restore, removal, reset and a partial merge that throws after
  installing (a replacement clearing an installed map before root init throws invalidates identity once); same-content
  moves and private previews count zero. A rejected bundle merge publishes its installed prefix to the real owning
  stores once on worker and synchronous routes, original error kept, nothing for stale results. Multi-track,
  multi-command and absolute-continuation priors expose partial or wrong-group Undo. Compiled inspection entries
  resolve the same live singletons as the real App; an export census is not proof.

### 13. Every user mutation enters Command and reaches every authority (#1049, #5789, #474, #4506, #5247)

- Failure: a panel, inspector or generator calls the use case or parameter bridge directly, or half-applies, leaving no
  history or earlier items after a later refusal.
- Probe: the rendered control through the registered handler on a CRDT-backed root: raw group/member IDs, projection,
  one history and Undo entry, exact Undo/Redo, locked/frozen refusal preserving raw, history and engine writes;
  reverting the component dispatch to the direct call fails. Discrete choices (filter type/model) restore an absent
  leaf on first-selection Undo and an old queued direct parameter frame cannot overwrite the newer choice. A generator
  spanning pads or lanes submits one compensated batch bound to project and document identity: fail a later lane after
  an earlier is valid, raw, stores and Undo unchanged; one Undo removes all. Follower-point refusal through
  `executeAppAction` and singleton `executeAppActionBatch` leaves document, links and history unchanged. A mounted
  reader (ruler basis after Insert Time) repaints after Undo and Redo.

### 14. Regeneration and interval edits keep everything outside their footprint (#5515, #645)

- Failure: redetection or a range edit drops protected or adjacent user material.
- Probe: a moved locked automatic marker beside user, grid and unlocked automatic rows: real Detect and re-detection at
  another sensitivity keep exact ID, original/warped beat, lock and confidence in raw and projection, suppress near-hit
  detections, and unlocking makes the row replaceable. A comp selection over `[start, end)` keeps both complements at
  each beat; guarded semantic Undo/Redo applies to current state without touching other lanes or selections outside
  the footprint. Selected-range deletion: add peer facets afterward and only fragment-owned facets retire, exactly
  recovered after a later publication failure.

## Standing probes: CRDT undo, imports, checkpoints and branch recovery

### 15. Identity-scoped undo must survive peer edits (#3757)

- Failure: whole-aggregate snapshot restore erases peer work an isolated round trip never sees.
- Probe: peer edit after the operation and again after Undo, then real Undo/Redo through Command, reading raw CRDT
  and projection. Field order alone never conflicts; changed values, array order, missing fields, bad captures refuse.

### 16. An import must cross the serialized owner boundary (#3968)

- Failure: parser, writer and mocked owner each pass, yet events vanish or land past the usable extent.
- Probe: real bytes through the real parser into owning stores and document, then Undo/Redo, with event-only inputs and
  points after notes or on an extent boundary; dropping an event or channel, skipping the owner write, mis-sizing the
  extent or skipping a history half each fail.

### 17. Checkpoint catalogs need scoped metadata, atomic authority and active-project binding (#3945)

- Failure: hydrating the catalog reads every stored root, publication is not atomic, or a handle surviving a
  create/load lifecycle overwrites the incoming project or moves its cursor.
- Probe: owner-filtered metadata-only reads, validating only a selected root; abort after queued successes publishes
  nothing; two connections race one expected revision. Every restoration route, ownerless and private bypass included,
  against active project identity, canonical document contents and catalog selection.

### 18. Recovery and retry must preserve the running project, history and bound undo (#3338, #5595, #3356)

- Failure: recovery navigates, replaces, or restores outgoing undo onto a different document truth.
- Probe: failed branch switch whose durable recovery selects a third branch: final active document and undo history
  agree (exact rollback is the positive control). Unavailable-entry recovery or initial App rejection on a same-tab
  saved project with future-side Undo: same identity, raw/projected owners, PCM digests, witness-bound history,
  successful Undo/Redo, new document (`performance.timeOrigin` changed). Corrupt retry-budget storage fails closed
  with one budget across host and child; a late entry error to a dirty running project navigates and consumes nothing.

## Standing probes: command entry, identity-scoped replay and grouped inverse capture

### 19. Command entry and identity-scoped replay must reach every authority and survive owner replacement (#4082)

- Failure: a visible flag updates while the decoder rejects the value (a Loop control kept an invalid region), or
  Undo/Redo replays onto an aggregate replaced by a new owner reusing track and child IDs, or from empty prior state.
- Probe: public command entry, then raw document, owner projection, control state and engine projection agree. Replace
  the aggregate reusing IDs and exercise an empty prior state; create history through the real producer, persist,
  reload, hydrate, replay (an injected entry proves neither producer nor saved contract).

### 20. Grouped inverse capture must read the owning action prefix (#4083, #4073, #4071)

- Failure: `executeAppActionBatch` describes members before executing, so later inverses capture pre-batch state.
- Probe: real grouped Undo/Redo against raw CRDT and projection; swap the earlier-sibling projection for live pre-batch
  state and the group fails. When a member snapshots state an earlier one produced (comp-then-remove), inspect the real
  history entry: a correct final state does not prove the inverse composed the prefix.

## Retired lessons

- Don't Save refused through a guard on its own load epoch (#5573) → enforced by
  `src/modules/Project/useCases/projectPersistence/__tests__/discardProjectChanges.realPath.spec.ts` (activated epoch);
  the general rule stays in probe 11.
- Chord migration base copies locked chorded projects (#1857) → enforced by
  `src/app/__tests__/captureCommandBatchPreflightState.spec.ts` ("admits a chord track whose migration base");
  scope rule stays in probe 8.
- Checkpoint descendants lost the sibling frontier (#5681) → enforced by
  `src/modules/CrdtDocument/useCases/__tests__/projectRevisionMatchesLiveIgnoringCommandCheckpoint.spec.ts` ("accepts
  checkpoint-only descendants of both captured root heads").
- Aborted graph repair must restore monitoring from the committed root (#5286) → enforced by
  `src/modules/Transport/useCases/__tests__/repairRuntimeGraphFromProject.optimisticRestore.integration.spec.ts`.
- A projected absence is not a committed deletion (#5283) → enforced by
  `src/modules/AudioEngine/repositories/audioRecorder/__tests__/removeTrackInputMonitoring.integration.spec.ts`
  ("retires a hidden On owner after a committed selector change").
