# Lesson library: command entry and state oracles

Defects where a user mutation bypasses Command or half-applies, where acceptance counts notifications instead of
committed project truth, where regeneration or interval edits drop material outside their footprint, and where
overlapping inputs read state before an earlier input commits. Saved projects and saved history belong to
`project-integrity.md`; project truth is the CRDT root and every projection is a witness.
Each probe names the input or state that breaks and the check that must go red. Drive production actions and
real Automerge bytes (save, binary reload, fresh projections, hydrated history) and read raw CRDT truth beside
every projection; a probe that mocks the owner, starts at epoch 0 or stays in memory observes none of these
boundaries.

## Standing probes

1. **State oracles and acceptance evidence observe complete project truth (#5646, #5649, #5887).** Failure:
   acceptance passes because it counted barrel calls or notifications, or read a different module singleton. Probe:
   typed materialized snapshots around each turn with allowed fields from the frozen oracle, not the action log; an
   outside-barrel write to another track or an unauthorized field beside a valid commit is counted, net-zero writes
   too. Install a changed clone via `insertDoc('root', ...)`, read it, restore it: positive mutation count, barrel
   count unchanged, for create, replace, load, merge, snapshot restore, removal, reset and a partial merge that throws
   after installing (a replacement clearing an installed map before root init throws invalidates identity once);
   same-content moves and private previews count zero. A rejected bundle merge publishes its installed prefix to the
   real owning stores once on worker and synchronous routes, original error kept, nothing for stale results.
   Multi-track, multi-command and absolute-continuation priors expose partial or wrong-group Undo. Compiled
   inspection entries resolve the same live singletons as the real App; an export census is not proof. Removing
   only a child keeps root identity stable, removing the root moves both identity and epoch, and an already empty
   map keeps all identities stable. Compare Undo with pre-commit values only for oracle-authorized fields atop
   pre-Undo truth, and score persisted transitions against authorized prefixes so a write followed by restoration
   cannot disappear.
2. **A rendered control or discrete choice bypasses Command (#1049, #5789, #474).** Failure: a panel or inspector
   writes directly, leaving no history. Probe: the rendered control through the registered handler on a CRDT-backed
   root: raw group/member IDs, projection, one history and Undo entry, exact Undo/Redo, locked/frozen refusal
   preserving raw, history and engine writes; reverting the component dispatch to the direct call fails.
   For deliberately performative controls, prove the same transaction and refusal with unchanged full history,
   while an ordinary action remains undoable; the direct-route mutation must fail the real refused click. Exercise rapid
   repeated controls through real commits, and hold project replacement and teardown across admission and publication.
   During a held stale sequence, a fresh valid gesture in the successor project must still execute. Discrete
   choices (filter type/model) restore an absent leaf on first-selection Undo, a hidden non-SVF Type stays stored,
   Model and Type each own pending authority by device and parameter, and an old queued direct parameter frame
   cannot overwrite the newer choice.
   Crust's initial numeric panel bridge (`cd59903255`, no associated PR returned by commit lookup) persisted
   preview samples outside semantic history; its historical review brief and stance coverage are unestablished.
   Drive keyboard and multi-sample pointer gestures through the real panel, Command and CRDT: previews leave
   complete project/history unchanged, one physical terminal records one action/inverse, and Undo/Redo keeps the
   device installed. Preserve exact original leaf absence and hydrate its default without erasing a still-owned
   preview after an unrelated edit. Hold snapshot admission across replacement, cancel and unmount; stale work
   cannot commit or restore over newer runtime. Observe event-time automation samples at movement and physical
   release, with synthetic settlement and canonical/replay writes suppressed; real controller call-through is not
   audible-output proof. Restoring the direct bridge must fail history, inverse and raw/projection assertions.
   Fermenter's numeric-only full-patch writer dropped macro and mapping arrays (#6321), introduced by
   `173b7a9e7a614feb17ea25910e33082460dc2ee3` (2026-04-16). Commit lookup returned no associated PR; the historical
   review stance is unestablished. Drive real continuous macro/morph and scalar controls through the typed owner
   write: compare the complete authoritative device chunk in raw CRDT, fresh hydration, declared history behavior and
   engine projection. A numeric mirror, engine update or persister spy cannot witness nested persistence. Assert
   the route's declared history semantics, with one undo unit for each discrete patch edit; continuous gesture Undo
   remains the separate #2370 obligation. Pending draft M, discrete N, Undo M and Redo N must agree in project, panel
   and runtime. Hold a queued write across an unrelated revision or owner replacement; refusal reconciles only
   under current project/device authority and never overwrites the
   successor. Removing array persistence must fail the macro/morph cases named in `test-validity.md` probe 3;
   save/binary-reopen and audible claims require their own observations (`project-integrity.md` probe 11).
   Batch preflight copied an unclamped parameter into the projected prefix while the actual writer clamped it
   (#1857, introducing `064fb88392`; historical review stance unknown). Probe below/above-range writes followed
   by a guarded device action against the real registered route: prefix and committed values must obey the same
   parameter law and leaf-presence rules. The shared projector's retained case "plans numeric device values
   using the same clamp and deletion law as the actual writer" requires a 20 Hz cutoff after -100, independently of the helper.
3. **A multi-unit edit half-applies or a linked follower write never reaches the sampler (#4506; #931, #4392).**
   Failure: a generator or batch leaves partial items, or a follower point is stored where playback ignores it. Probe:
   a generator spanning pads or lanes submits one compensated batch bound to project and document identity: fail a
   later lane after an earlier is valid, raw, stores and Undo unchanged; one Undo removes all. Dispatch a point
   command through real Command and CRDT-backed Automation state on a linked lane, then inspect the raw document,
   owning projection, undo history and `getAutomationValueAtBeat` for the follower; replacing the follower write
   with the mocked unlinked writer (how #931 and #4392 passed) must fail, and a handler-call or stored-value
   assertion cannot prove the sampler uses the point. Follower-point refusal through `executeAppAction` and
   singleton `executeAppActionBatch` leaves document, links, samples and history unchanged, with a positive
   source-write Undo/Redo control reaching the follower. Multi-action `addAutomationPoint` batches are a separate
   Command contract, never inferred from singleton proof: drive one whose refusal leaks no follower-point write.
4. **Regeneration keeps protected rows outside its footprint (#5515).** Failure: redetection drops or rewrites
   locked user material. Probe: a moved locked automatic marker beside user, grid and unlocked automatic rows: real
   Detect and re-detection at another sensitivity keep exact ID, original/warped beat, lock and confidence in raw
   and projection and suppress near-hit detections; unlocking makes the row replaceable. Dropping locked-row
   retention or near-hit suppression fails. On the Worker route, hold completion while editing a retained row or
   adding a user row, then require the admitted write's real Undo/Redo to retain that edit and a later divergent
   edit to refuse replay without writing. Switch source/project, replace PCM, change tempo or cancel before commit:
   raw CRDT, projections, other clips and cached PCM stay unchanged while visible counts reflect only committed
   truth. Compare original PCM bytes, not merely buffer identity.
5. **An interval edit keeps everything outside `[start, end)` (#645).** Failure: a range edit drops adjacent user
   material. Probe: a comp selection over `[start, end)` keeps both complements at each beat; guarded semantic
   Undo/Redo applies to current state without touching other lanes or selections outside the footprint; a
   source-count assertion does not prove the resolved playback keeps the selected source phase, so verify source
   timing separately. Selected-range deletion: add peer facets afterward and only fragment-owned facets retire,
   recovered exactly after a later publication failure.
6. **Command entry and identity-scoped replay reach every authority and survive owner replacement (#4082).**
   Failure: a visible flag updates while the decoder rejects the value (a Loop control kept an invalid region), or
   Undo/Redo replays onto an aggregate replaced by a new owner reusing track and child IDs, or from empty prior
   state. Probe: public command entry, then raw document, owner projection, control state and engine projection
   agree. Replace the aggregate reusing IDs and exercise an empty prior state; create history through the real
   producer, persist, reload, hydrate, replay (an injected entry proves neither producer nor saved contract).
7. **Transcription completes only after every generated entity commits.** Failure: a conversion reports success
   while its track, clip or note chunks are still uncommitted or only partly written. Direct clip/note writes and a
   dispatched but unawaited destination cannot witness one completed conversion. Drive the registered runtime
   command and each rendered caller with real decoded PCM: a held snapshot queue keeps completion pending, one
   compensated child batch creates track, clip and all 128-note chunks, and a failure in the final chunk leaves raw
   CRDT, projections and history unchanged. Require one grouped Undo/Redo/Undo, and macro playback of the committed
   children without another transcription. Replace the awaited batch with fire-and-forget dispatch or a direct note
   write: the completion, atomicity or history case must fail. Caller tests must reject cancelled, refused and
   no-op outcomes without a success notice.
8. **Overlapping duplicate presses capture one stale source (#6218).** Failure: both presses finish after a held
   snapshot transaction and copy the original interval. Probe the real shortcut handler, Command and CRDT with two
   presses dispatched while the first is held at the real snapshot-transaction boundary, before any copy selection
   exists; a test that waits for the first copy selection before its second press proves completed serial input
   only. Single, next-bar and unequal-span multi selection must chain geometry (unequal spans distinguish
   continuation from two copies of the original), copy content and select the last copies, with one Undo/Redo
   group per press; assert raw CRDT, owner projections, selected IDs and per-input Undo/Redo content. Observe
   settlement through the actual returned intent promises; a fixed microtask count proves no scheduling boundary.
   Change selection away and back inside one store batch, or replace the project reusing IDs, while admission or a
   staged handler waits: no old publication or completion may overwrite newer truth or selection; fresh input must
   recover. Test each authority predicate while the others remain valid: replacing the root and reselecting a clip
   changes both project and selection, so it cannot detect removal of the project-identity check alone; keep every
   selected ID alive and retain the same selection reference in a separate real replacement case, then remove only
   that identity check. Insert an inapplicable next-bar input between valid multi-clip duplicates: ignoring that
   input must preserve both valid groups, while actual refusal still retires its failed chain. Revert ordering or
   remove the route's execution/publication authority predicate and the corresponding integration must fail. Use
   controlled Command outcomes only for error interpretation, labelled as such; they cannot prove kernel
   admission or publication fences. A committed-error or ambiguous result uses preallocated live copy IDs as
   witnesses, reports the error and never replays the mutation.
9. **Default names are planned at the owning write boundary (#6202).** Failure: two overlapping nameless track
   additions read the same default-name state before the snapshot wait and commit duplicate names; sequential
   completed additions cannot exhibit it. Hold a real snapshot transaction, start two nameless UI dispatches and
   observe both admissions before release, then await every command. Distinct committed IDs, complete raw and
   projected track arrays and recorded history names must agree before requiring consecutive names; transient
   selection and ghost state are not persisted-slot fields. Undo/Redo/Undo keeps each row's recorded identity and
   name; explicit names remain verbatim and a peer's higher number never renumbers Redo. The owner opts fresh
   singleton naming into the post-wait synchronous read/write continuation; reverting only that late naming phase
   must fail the overlap case under `pnpm guard --profile focused -- pnpm test:run
src/modules/Arrangement/handlers/track/__tests__/handleAddTrackDefaultName.integration.spec.ts`. Cleanup
   releases and settles every created promise even when an earlier assertion fails, and a later await preserves
   the original command failure. Preserve highest-per-kind numbering, compiler and supplied-envelope digests,
   early admission/runtime captures, isolated materialized observers and authenticated pending-Redo bindings.
   A batch materializes arguments before member writes, so addition-only prefixes miss renamed, removed and
   restored name sets. Project identity/kind/name in order: actual captured restore rows, exact non-master
   removals with children surviving, and anonymous raw additions kept separately without minted IDs, distinguishing
   actual stored names from event metadata. Prefer canonical prepared prefixes and preserve supplied names.
   Require real remove/rename-then-add batches to agree in raw tracks, projection and recorded names through
   Undo/Redo/Undo; restoring the append-only planner must fail. Singleton-only operations remain rejected in
   multi-action batches.

## Relocated

- Mounted reader missing a history transition (ruler fresh drawing after Insert Time Undo/Redo, #5247) →
  `rendered-ui-layout.md` probe 4.
