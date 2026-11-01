# Lesson library: command entry and state oracles

Defects where a user mutation bypasses Command or half-applies, where acceptance counts notifications instead of
committed project truth, and where regeneration or interval edits drop material outside their footprint. Split out of
`project-integrity.md`; project truth is the CRDT root and every projection is a witness.
Each probe names the input or state that breaks and the check that must go red. Drive production actions and
real Automerge bytes (save, binary reload, fresh projections, hydrated history) and read raw CRDT truth beside
every projection; a probe that mocks the owner, starts at epoch 0 or stays in memory observes none of these
boundaries.

## Standing probes

### 1. State oracles and acceptance evidence observe complete project truth (#5646, #5649, #5887)

- Failure: acceptance passes because it counted barrel calls or notifications, or read a different module singleton.
- Probe: typed materialized snapshots around each turn with allowed fields from the frozen oracle, not the action log;
  an outside-barrel write to another track or an unauthorized field beside a valid commit is counted, net-zero writes
  too. Install a changed clone via `insertDoc('root', ...)`, read it, restore it: positive mutation count, barrel count
  unchanged, for create, replace, load, merge, snapshot restore, removal, reset and a partial merge that throws after
  installing (a replacement clearing an installed map before root init throws invalidates identity once); same-content
  moves and private previews count zero. A rejected bundle merge publishes its installed prefix to the real owning
  stores once on worker and synchronous routes, original error kept, nothing for stale results. Multi-track,
  multi-command and absolute-continuation priors expose partial or wrong-group Undo. Compiled inspection entries
  resolve the same live singletons as the real App; an export census is not proof. Removing only a child keeps root
  identity stable, removing the root moves both identity and epoch, and an already empty map keeps all identities
  stable. Compare Undo with pre-commit values only for oracle-authorized fields atop pre-Undo truth, and score
  persisted transitions against authorized prefixes so a write followed by restoration cannot disappear.

### 2. Every user mutation enters Command and reaches every authority (#1049, #5789, #474, #4506, #5247)

- Failure: a panel, inspector or generator bypasses Command, or half-applies, leaving no history or partial items.
- Probe: the rendered control through the registered handler on a CRDT-backed root: raw group/member IDs, projection,
  one history and Undo entry, exact Undo/Redo, locked/frozen refusal preserving raw, history and engine writes;
  reverting the component dispatch to the direct call fails. Discrete choices (filter type/model) restore an absent
  leaf on first-selection Undo, a hidden non-SVF Type stays stored, Model and Type each own pending authority by
  device and parameter, and an old queued direct parameter frame cannot overwrite the newer choice. A generator
  spanning pads or lanes submits one compensated batch bound to project and document identity: fail a later lane after
  an earlier is valid, raw, stores and Undo unchanged; one Undo removes all. Follower-point refusal through
  `executeAppAction` and singleton `executeAppActionBatch` leaves document, links, samples and history unchanged, with a
  positive source-write Undo/Redo control reaching the follower. Multi-action `addAutomationPoint` batches are a
  separate Command contract, never inferred from singleton proof: drive one whose refusal leaks no follower-point
  write. A mounted reader (ruler basis after Insert Time) repaints after Undo and Redo: capture raw and projected
  figures around the real Command and require a fresh drawing per history transition (a matching earlier frame is not
  a fresh read); replacing its map subscription with an imperative read must fail the stopped map-change and history
  paint checks.

### 3. Regeneration and interval edits keep everything outside their footprint (#5515, #645)

- Failure: redetection or a range edit drops protected or adjacent user material.
- Probe: a moved locked automatic marker beside user, grid and unlocked automatic rows: real Detect and re-detection at
  another sensitivity keep exact ID, original/warped beat, lock and confidence in raw and projection, suppress near-hit
  detections, and unlocking makes the row replaceable. A comp selection over `[start, end)` keeps both complements at
  each beat; guarded semantic Undo/Redo applies to current state without touching other lanes or selections outside
  the footprint; a source-count assertion does not prove the resolved playback keeps the selected source phase, so
  verify source timing separately. Selected-range deletion: add peer facets afterward and only fragment-owned facets
  retire, recovered exactly after a later publication failure. Dropping locked-row retention or near-hit suppression
  fails.

### 4. Command entry and identity-scoped replay must reach every authority and survive owner replacement (#4082)

- Failure: a visible flag updates while the decoder rejects the value (a Loop control kept an invalid region), or
  Undo/Redo replays onto an aggregate replaced by a new owner reusing track and child IDs, or from empty prior state.
- Probe: public command entry, then raw document, owner projection, control state and engine projection agree. Replace
  the aggregate reusing IDs and exercise an empty prior state; create history through the real producer, persist,
  reload, hydrate, replay (an injected entry proves neither producer nor saved contract).
