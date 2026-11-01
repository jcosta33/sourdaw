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

Split out by defect class (a stance matching one carries that file, not this one): Undo, Redo and deferred
continuations acting on foreign or replaced truth in `replay-authority.md`; Command entry, state oracles and
regeneration footprints in `command-entry-and-state-oracles.md`.

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
  import/Save/clear/restore case; collector protection also covers finalized recovery storage. The serializer's revision
  travels with its data and the build is rejected if it changes across a serializer await; repeat the retained-buffer
  case with a held success.

### 2. Cold-cache consumers rebuild every durable reference and report owner results (#187, #4496)

- Failure: export, mixdown, stems or recovery use a warm cache or a mocked owner, miss a buffer or swallow a failure.
- Probe: cold project with an ordinary clip and an active frozen print whose PCM has its own ID; both IDs reach cache
  restoration before encoding and the encoded PCM is inspected. Dropping the frozen ID fails before encoding; stale
  prints stay excluded and the empty-clip all-buffer fallback stays. Owner mocks satisfy the live callable result
  contract (a void strip mock threw inside recovery, was caught, and the spec stayed green); read logged recovery
  failures before trusting a pass (`test-validity.md`: a stale owner result swallowed by recovery tests).

### 3. Admission accepts only what hydration keeps (#4987, #5064, #3354)

- Failure: a project file or saved history entry passes admission, then the owning hydrator or restore owner discards
  or mis-writes it, taking selected takes, comp regions or nested satellites with it.
- Probe: probe the serialized candidate before any project, raw or store replacement, then real owner hydration, on
  every route (top-level and saved-arrangement take lanes): reject anchor-only, depth-only, negative or nonfinite
  placement, malformed offset, a missing required capture; keep JSON-roundtripped legacy takes. For saved clip inverses
  seed real gain/warp envelopes and two automation lanes, corrupt one nested field of the persisted capture (string
  `gainDb`, point value, unsupported, malformed or non-name curve, negative beat, empty id, zero, negative, fractional
  or non-integer stair steps, duplicate note IDs, malformed CC/bend, nonfinite number), hydrate fresh handlers and run
  real Undo: the entry is dropped before any write, raw, projections and history unchanged. Corrupt the inverse and the
  redo leg separately (also the paired point shapes of a move; swap a clip identity, placement or split snapshot;
  change a Delete Time plan's scope or make its replay legs disagree: a neutral generated schema can be narrower than
  the time-operation snapshot). Partial move captures (`id`, `trackId`, `points`) use Automation's point contract, not
  the full-lane one. Revert the admission hunk and the rejection cases fail; array-only or sanitizer-only assertions
  cannot carry the claim. Keep valid null, present-empty and legacy-alias controls, and keep restore validation with
  the owner: admitting a forward action to the session mirror must not add it to executable action discovery.

### 4. Saved replay binds relationships between individually valid rows (#5064, #3328, #4108, #4519)

- Failure: each captured row passes its own shape check but its owner, identity or operation is foreign, so replay
  writes into an unrelated clip, track, lane or action.
- Probe: from a genuine saved entry change one relation only: a satellite or nested envelope `clipId`, one automation
  lane's `clipId` or `trackId`, sibling lane IDs made equal or equal to a resident unrelated lane, a retired lane id
  pointed at another track's lane, a split's right-fragment automation or satellite owner, the inverse or redo operation
  type (a valid `setTrackGain` inside `setDeviceParameter`, with and without optional metadata), or one side of a
  mirrored pair. Save/reload and hydrate fresh handlers: the whole entry or group is rejected before any write. Keep
  rich fractional, empty, historical and same-operation controls; enforce it in the owner, not by type equality.

### 5. Guards and repairs are probed on the real persisted shape (#4111, #2169, #860, #645, #4292, #5495, #5578)

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
  projections, both captures, history, tree and mirror unchanged. A retained handle refuses once clip geometry changed.

### 6. Identity namespaces are declared, scoped by path, and fail closed (#5157, #4036, #1857, #5570)

- Failure: the ID walk marks a valid project repair-required (blocking Save, Undo), or copied subtrees collide.
- Probe: load each shipped demo and template, save, reload: repair gate stays clear. A split before surviving identified
  automation points (dyadic and non-dyadic cut), a rich audio split with clip-local gain-point IDs, and a chord track
  whose `migrationBase` copies live IDs survive binary reload and repeated Undo/Redo with a full global census.
  Pre-occupy the preferred generated ID under an unrelated owner, and let a peer claim a captured ID after Undo:
  zero-write refusal, no reminting. Duplicates within one envelope, global entity collisions and an undeclared copying
  slot stay repair-required. Scopes (`INDEPENDENT_ID_SCOPES`) are keyed by path from the namespace root, never object
  identity, and each has a case inside a real `change(from(doc))`, where list reads return fresh proxies. For a
  batch-admitted restored clip that precedes a split, compare the IDs captured at preflight with the committed IDs
  before reload and replay twice: a live execution that remints a preflight capture is not replay-stable. Draw is
  singleton-only, so a rejected draw/split batch proves admission, not prefix execution.

## Standing probes: CRDT undo, imports, checkpoints and branch recovery

### 7. An import must cross the serialized owner boundary (#3968)

- Failure: parser, writer and mocked owner each pass, yet events vanish or land past the usable extent.
- Probe: real bytes through the real parser into owning stores and document, then Undo/Redo, with event-only inputs and
  points after notes or on an extent boundary; dropping an event or channel, skipping the owner write, mis-sizing the
  extent or skipping a history half each fail.

### 8. Checkpoint catalogs need scoped metadata, atomic authority and active-project binding (#3945)

- Failure: hydrating the catalog reads every stored root, publication is not atomic, or a handle surviving a
  create/load lifecycle overwrites the incoming project or moves its cursor.
- Probe: owner-filtered metadata-only reads, validating only a selected root; abort after queued successes publishes
  nothing; two connections race one expected revision. Every restoration route, ownerless and private bypass included,
  against active project identity, canonical document contents and catalog selection.

### 9. Recovery and retry must preserve the running project, history and bound undo (#3338, #5595, #3356)

- Failure: recovery navigates, replaces, or restores outgoing undo onto a different document truth.
- Probe: failed branch switch whose durable recovery selects a third branch: final active document and undo history
  agree (exact rollback is the positive control). Unavailable-entry recovery or initial App rejection on a same-tab
  saved project with future-side Undo: same identity, raw/projected owners, PCM digests, witness-bound history,
  successful Undo/Redo, new document (`performance.timeOrigin` changed). Corrupt retry-budget storage fails closed
  with one budget across host and child; a late entry error to a dirty running project navigates and consumes nothing.

## Retired lessons

- Chord migration base copies locked chorded projects (#1857) → enforced by
  `src/app/__tests__/captureCommandBatchPreflightState.spec.ts` ("admits a chord track whose migration base");
  scope rule stays in probe 6.
- Aborted graph repair must restore monitoring from the committed root (#5286) → enforced by
  `src/modules/Transport/useCases/__tests__/repairRuntimeGraphFromProject.optimisticRestore.integration.spec.ts`.
- A projected absence is not a committed deletion (#5283) → enforced by
  `src/modules/AudioEngine/repositories/audioRecorder/__tests__/removeTrackInputMonitoring.integration.spec.ts`
  ("retires a hidden On owner after a committed selector change").
