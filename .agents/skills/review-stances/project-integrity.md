# Lesson library: project integrity

## 2026-10-28 — a recovered entry does not itself prove project and Undo preservation (#5595)

The empty-root external entry dates to commit `33158adccb2b0ed6a461fee10dde79c83c2b2fcf`;
no associated introducing PR or private review history is established. The historical gap is a
missing unavailable-entry probe, not proof that a reload is safe after application startup.
If recovery navigates, exercise a real same-tab saved project with future-side Undo through the
actual failed entry and successful successor. Require the same project identity, exact content,
history witnesses, settled session mirror and successful subsequent Undo/Redo; a fresh blank
project or mere mirror existence cannot carry that claim. Keep unrelated storage and project
writes out of the retry controller. Unavailable or corrupt retry-budget storage must fail closed
to manual recovery, with one budget shared across host and child and no reset on entry success.
Independently deliver a late entry-targeted error to a dirty running project and require no
navigation, replacement or history consumption.

## 2026-10-27 — single-entry priors could not distinguish partial or wrong-group Undo (PR #5646)

PR #5646 (`69d14317c961069c010ead77a7e02393c563dee2`) used single-entry prior groups and
relative committed values for its sealed refinement examples. They could not expose replaying
only part of a group, choosing the latest musician group instead of the named AI group, or taking
an absolute continuation from the live fader (#5648). These are gaps in acceptance evidence;
no historical private reviewer prompt or tier is established.

Exercise a group spanning multiple tracks and a group containing gain plus mute. Add an unrelated
musician edit in a later group. Revert the named AI group and require every AI-owned change to revert, both Undo
history witnesses to agree, and the unrelated edit to survive. Exercise multi-command retargeting
and an absolute continuation after the live fader has moved, with frozen expectations derived from
the committed value. Undoing one inverse, selecting the newest group or substituting the live value
must each fail the acceptance assertions without relying on a manifest mismatch.

## 2026-10-27 — a matching commit did not prove that only its fields changed (PR #5646 refinement escape)

PR #5646 (`69d14317c961069c010ead77a7e02393c563dee2`) introduced refinement bookkeeping
whose barrel-call and history checks missed real project writes beside a valid chat commit (#5649).
The original single-turn spy counter came from PR #4348
(`a46f6f7c6f2179ba4d9527efb6bd615c8b08f228`). The missed observable was complete project truth,
not whether the intended action also ran; exact historical reviewer prompts and tiers are unavailable.

Take typed materialized snapshots around each turn. Derive allowed fields and values from the frozen
oracle rather than the executed action log, and compare every other entity and field as well. Add a
real outside-barrel write to another track and to an unauthorized field on the target; both must be
counted even when the expected commit and Undo history look correct. Compare Undo with its pre-commit
values only for oracle-authorized fields, atop pre-Undo truth, retaining unrelated later user edits.
Count prior barrel writes even when their net field effect is zero. Observe persisted transitions
against authorized prefixes so an unauthorized write followed by restoration cannot disappear.
Keep a valid commit control and require removal
of the state comparison to fail these cases; call counts, unchanged history and lossy JSON snapshots
cannot establish preservation.

## 2026-10-25 — restored heads can revive stale confirmation authority (caught in PR #5677 review)

An approval may tolerate a mutation-epoch advance when the active project heads are unchanged,
because a queued selection flush writes no new content. A real edit followed by a same-lineage
replacement of earlier heads also leaves those heads unchanged, but discards the edited history.
After a checkpoint, an ancestry scan of the installed document cannot recover that discarded edit.
At every same-lineage replacement and same-membership snapshot restore, require the new _active_
heads to retain every prior active head in their causal ancestry. Record a monotonic discard epoch
when they do not, and reject approvals captured before it even if current heads match. A forward
merge with concurrent heads and a checkpoint-only change must remain eligible; a foreign write
after authorization capture must still revoke execution.

## 2026-10-25 — queued selection writes revoked confirmed command authority (introduced by PR #2747)

PR #2747 (`06fb56e389`) added a strict mutation-owner authorization check for confirmed AI
batches. A track selection is transient project UI state, but its CRDT-backed store still queues
an unscoped flush. That flush can advance the repository mutation epoch without changing document
contents or heads. If it lands after the batch captures authorization, the unchanged proposal is
invalidated as a foreign project write. The public approvals covered collaborator changes and
CRDT ownership; the exact historical reviewer prompts are unavailable, so no named stance or tier
can be assigned this missed timing input.

Drive a real two-track selection through `trackStore.set` after proposal, observe its pending
write, and release the actual flush at the confirmed batch's execution boundary. Require the
approved command to execute once, with identical root contents and heads across that selection
flush. Check the final risk-approval binding too: it must use the same unchanged-project proof,
or the advanced epoch still rejects the old approved source revision. Preserve the original
serialized batch and idempotency key through execution and replay. Pair this with a real
conflicting edit before confirmation, which must invalidate or require new approval, and an
independent writer after authorization capture, whose mutation must still revoke execution even
when it changes no document value. Removing admission settlement or final binding alignment must
fail the unchanged-selection case.

## 2026-09-28 — a post-commit device timeout had no caller-visible outcome

`waitForDevices` historically returned `void` after retiring stalled nodes, so demo/template construction could commit valid project truth and then finish without telling the musician that instruments were unavailable. The timeout was introduced in commit `9783731236` (associated with PR #2035 without proof that its readiness policy was reviewed); PR #3982 explicitly deferred caller outcomes. Probe the actual post-commit boundary: hold a current device load to failure and require a warning naming the failed device while project identity and committed tracks remain valid; cancel an obsolete captured generation and require no warning over the replacement. Do not throw into project-load recovery after the commit.

Attack every claim that a project is saved, reopenable, recoverable, or safe to leave. Trace each
referenced asset from the exact serialized snapshot to the durable bytes and ownership record that
a fresh runtime will consume. A document commit is insufficient when the document points outside
itself. Hold the snapshot's project identity, revision, asset source and recovery source constant
across every asynchronous write, then prove that the success path clears dirty only while every
witness still matches.

The discriminating probe is a selective storage failure with the other stores healthy: create real
project content through its owning use case, abort only the referenced asset's durable transaction,
invoke Save, clear runtime state, and restore through the production read path. Require Save to
return false and remain dirty while working data stays recoverable; after storage recovers, require
one later Save to persist the exact failed source and a runtime-clear restore to reproduce its bytes.
Also replace or remove the same asset while settlement is held and require the admitted snapshot to
be superseded rather than certified by the later source.

## Lesson from the PR #964 escape

PR #964 (`8a96bdafd6605daa098c2851bdfab2fdeb8a1db3`) removed embedded PCM from live project
snapshots and described the IndexedDB cache as the audio of record. It made the cache transaction's
abort observable inside `persistSerializedToIdb`, but `audioBufferCache.set` still discarded that
boolean promise, while `saveProject` awaited only CRDT and named-project writes before clearing
dirty. An audio-store-only abort therefore shipped as Save=true with a reopenable document that
referenced no durable PCM.

The review blind spot was treating an observed write inside the asset repository as proof that the
aggregate Save observed it. For any snapshot that replaces embedded data with durable references,
apply the selective-failure probe above at the aggregate Save boundary. Restore the old success
path as a mutation; the real import/Save/clear/restore test must fail on Save=true or missing PCM.

## Lesson from the PR #1077 and PR #2822 escape

PR #1077 (`17c4afde8828e5e61e783006e6e907f23ee92db0`) introduced Save's revision guard, but
captured the revision only after the awaited serializer had already constructed its snapshot. PR
#2822 (`367a186e970d9f7a27662a08c6bd6653220d232a`) made the pre-persist capture explicit after
flushing project writes while preserving that post-serializer placement. A synchronous serializer
wrapped in an async function can return a fulfilled promise, leaving a microtask boundary where a
queued edit runs before the caller captures its revision; the old snapshot then inherits the new
revision and can clear dirty.

The serializer's revision must travel with the data it describes. Capture it before reading project
state, reject the build if it changes across any serializer await, and make Save validate that same
token before starting persistence. The discriminating probe queues one real owning edit immediately
after synchronous snapshot construction and before the caller continuation, without adding another
await. Save must fail and remain dirty or persist a snapshot that includes the edit. Tests that only
mutate state during CRDT or named-project writes do not cover this boundary.

An edit can also update a public store while its Automerge write remains deferred to an animation
frame during any later persistence await. Every snapshot-continuation check must flush those pending
writes before it reads project identity, revision, or asset receipts; one flush before persistence
does not protect later continuations. Hold the named-project transaction and the animation frame,
invoke a public owning edit, then settle the transaction before the frame. Save must fail and remain
dirty, and a later Save/reopen must contain the edit.

## Lesson from the PR #3877 retained-source escape

A project replacement may keep a decoded buffer because the incoming project references the same
ID while still advancing the project epoch and replacing import authority. Clearing the old source
witness in that transition lets a valid but stale durable row certify newer PCM that survived only
in memory. Keeping the witness object is also insufficient: even a metadata-only import publishes a
new candidate, so an imported witness still bound to the previous candidate loses authority.

Treat retained decoded PCM as an explicit source transfer. Capture only authoritative sources whose
runtime buffers actually survive the lifecycle transition, then re-establish each under a fresh
source identity with the exact payload, freeze metadata and pending settlement. The fresh identity
invalidates receipts from the previous project, and a late completion may update it only while it
still owns the same ID. Removed, evicted and temporary prepared buffers transfer no ordinary source.

The discriminating probe seeds durable PCM A, publishes PCM B under the same ID and fails or holds
that write, then loads a metadata-only project that retains the decoded ID. Save must observe the
captured failure, retry B only on a later Save, and cold reopen B rather than A. Repeat with a held
success and with a same-ID replacement before the old attempt settles; neither an old receipt nor an
old completion may certify the replacement.

The collector protection test must also include finalized recovery storage during the pre-strengthening pending-write phase, with an unrelated peer deletion and exact PCM restoration. Ordinary row tests do not cover recovery cleanup.

## Lesson from PR #4111 and PR #2169 snapshot-guard escapes

PR #4111 introduced Yeast processor undo guards without exercising the codec's distinction between an empty persisted `params` map and its omitted store projection. PR #2169 introduced strip-silence's serialized restore guard and a replacement clone that materialized absent optional clip fields. A later conditional clone repair preserved optional-field presence but reinserted populated fields in a different key order. These shape changes made otherwise unchanged durable projections fail the guards during undo or redo.

Review every serialized inverse guard through its real prepare, write, fresh durable projection, undo, and redo route. Reorder nested object keys and pass absent, explicitly undefined, empty, and populated optional fields through their owning codec. Unchanged JSON values must restore, while changed values, array order, placement, and malformed fingerprints must still refuse before a write. A direct fixture that preserves the producer's object identity or field order does not exercise the guard.

## Lesson from the PR #806 transaction-scope escape

PR #806 added a supplied transaction scope while the older terminal logic from PR #576 kept that scope open until
after commit flushing. A repository publication listener could re-enter it after the flush had snapshotted pending
writes, update another adapter's cache, and leave that document write to land after `commit()` returned.

Treat transaction lifecycle as one owner-wide authority. Use an atomic test port that publishes document A and then
synchronously invokes a listener: both supplied and captured scopes must refuse before entering their callbacks while
A commits, and document B, its cache, and the pending-write count must remain unchanged after a later flush. Also enter
a scope before calling commit or abort, then attempt both `set` and `clear`; neither may mutate cache or durable truth.

## Lesson from the PR #576 storage-terminal escape

PR #576 (`ecd24df665`) settled a deferred write by copying its pending value into the cache after publication. A
publication listener could hydrate newer document truth, and a nested public flush could execute the same pending a
second time, yet the outer terminal still installed the older value or replayed it over the listener's change.

Treat one flush as a claimed immutable execution and treat the current document as terminal authority. From a real
publish-then-notify port, re-enter hydrate with and without a nested public flush; require one original-owner mutation
and identical raw, cache, and fresh-decoder results. Also reset projection during preparation and terminal projection,
and throw from trailing document reads and validators after one document publishes. The old identity must stay inert,
claims must release, and the error must retain committed classification without replay.

Every callback in the terminal read path can itself accept newer same-slot authority. Fence the whole read, decode,
guard, and local-field projection sequence with a document-authority epoch, including nested commits authored before
the outer write. A stale continuation settles its published claim against the retained newer baseline; author revision
order cannot replace actual publication order. Treat `null` from an inbound projector as an accepted value, not as a
missing callback result, and keep ambiguous publish-then-throw outcomes on the committed terminal path.

## Lesson from the comp-interval escape

A comp selection over `[start, end)` edits only that musical interval. Removing every intersecting
region also removes the left and right complements, while callback undo over a captured lane-store
snapshot overwrites later edits in other lanes and outside the requested interval. Review the actual
selected take at each beat: retain both complement fragments, and require guarded semantic undo and
redo to apply interval surgery to current state while preserving unrelated lane metadata and
same-lane selections outside the footprint. A source-count assertion does not prove that the
resolved playback retains the selected source phase; verify source timing separately.

## Lesson from the parameter replay-operation escape

Commit `4f410257b212bbbd2210fa6553f7aaa3394f69bc` introduced session undo hydration without
binding a parameter edit to its replay operations; GitHub associates no pull request with that commit.
PR #3328 later validated each action against its own contract, and PR #4108 added policy agreement,
but neither established the owner's relationship between the forward action and its replay legs.
A saved `setDeviceParameter` could therefore carry an executable `setTrackGain` inverse or redo.

The missed integrity probe in #4108 checked policy preservation through hydration and replay, not
operation identity. Register both real operation contracts and substitute an unrelated, individually
valid operation into inverse and redo independently. Require hydration to reject both stacks, with
and without optional metadata, while admitting the owner's canonical and legacy same-operation
entries and legitimate missing replay legs. Enforce this relationship in the owner: some other
commands legitimately have different inverse types, so global type equality is not the contract.

### 2026-09-20 — cancellation cleanup outran durable revocation (escaped via PR #1949)

PR #1949 (`ce2ffea3fd`) routed pending-confirmation cancellation through the run controller, whose
already-terminal path trusted live state after a failed persistence write. Fail only the run's
`Storage.setItem`, observe terminal live state with an unchanged saved run, then cancel again.
Require the same run's terminal revision to reach storage before any resource cleanup; repeat with
no temporary assets so cleanup writes cannot accidentally repair the missing durable revocation.

### 2026-09-21 — linked-follower refusal must preserve both authorities and history (introduced in 2a0e594f94; fixed in #4506)

Drive follower-point refusal through both `executeAppAction` and its supported singleton `executeAppActionBatch` form.
Require the authoritative document, Automation projection, links, samples, and undo history to stay unchanged after
refusal. Keep a positive source-write undo/redo control whose sampled effect reaches the follower. Multi-action
`addAutomationPoint` batches are a separate Command contract and must not be inferred from singleton proof.

## Lesson from the PR #645 selected-range undo escape

PR #645 made selected-range deletion retain prepared publication handles for durable Undo. Ordinary CRDT settlement
replaced the track projection with equal values and a new object reference, so the retained handle refused Undo before
restoring clips or takes. Retained evidence of a real post-settlement Undo probe is missing; historical stance dispatch
is unverified.

Drive the selected UI callback through real Command history after flushing CRDT writes, with no peer edit first. Require
exact raw/projected clips, takes, comp coverage and history through Undo and Redo. Repeat with a surviving peer take's
selection and comp change, then change canonical clip geometry and require zero-write refusal with history pending.
Prepare semantic restoration at durable replay time while retaining exact-reference guards inside one synchronous
publication and compensation. For disappearing fragments, also start with no captured takes, add peer facets afterward,
and prove only those fragment-owned facets retire; induce a later publication failure and require their exact recovery.

## Coordinate captures remain history data across both replay directions

The fractional inverse escape from PR #5495 and PR #5578 is detailed in
[moving coordinate inverses](./moving-coordinate-inverses.md#fractional-row-coordinates-and-reciprocal-history-captures).
A capture that works before saving proves nothing about the admitted session pair.
Hydrate actual production history from both past and future, preserve peer row membership
and properties, and require exact raw coordinates through repeated replay. Refuse malformed
or incoherent pairs before binding metadata or writing product state. Inject a pre-commit
storage failure after handler execution and compare document, projections, both captures,
history, tree and mirror; a successful product rollback cannot excuse changed replay data.

Saved macro playback is a fresh command route, not an Undo capability. The
[restoration-hint escape](./moving-coordinate-inverses.md#fresh-macro-commands-must-discard-inverse-restoration-hints)
from PR #5495 and PR #5578 requires removing documented inverse-only scalar hints
as well as row captures from the cloned request. Preserve stored macro bytes,
current peer rows and properties, and exact history from each new execution.
Compare full clip state and rows against independent public commands after a loop
or anchor change; restore only scalar forwarding as the discriminating mutation.

### 2026-09-30 — MIDI transform inverses lacked replay authority (escaped at 64b9d77c01a)

PR #939 (`90953dc23e0`) originated the shared transforms' exact-snapshot inverse and redo before a
replay guard contract existed. Commit `64b9d77c01a` first required an inverse handler to declare safe
reapplication during compensated-batch preflight; PR #2747 (`06fb56e3897`) then made
`restoreMidiClipNotes` admit only guarded replay. Neither integration updated the transform producer,
so the family could no longer pass compensated-batch preflight even though direct execution and undo
tests stayed green. No pull-request number is recorded in Git history for `64b9d77c01a`.

For every shared action family that emits a guarded restore, run the registered handler through
`executeAppActionBatch(..., { requireCompensation: true })`, then prove exact undo and redo against
the authoritative target. Remove the guard from both replay legs: the atomic case must fail. Initial
missing, ambiguous, wrong-kind, locked, or frozen topology must reject atomic and direct execution
before a write, because the direct dispatcher does not use handler validation as an execution gate.
After commit, independently change notes or make the target missing, moved, wrong-kind, locked, or
owned by a frozen track; replay must refuse without consuming history or replacing live notes.
For a guarded clip restore, also duplicate the captured clip ID after commit, both within its owning
track and on another active track. Undo must keep the original history head and transformed notes;
after a successful undo, the same duplicate-ID states must keep redo pending and preserve the restored
notes. Replay authority requires one live MIDI clip under the captured track owner, not merely a first
matching clip in that track.

## Committed deletion inverses must restore saved monitoring intent (caught in PR #5091)

PR #5091's head `71221839` captured restore admission after the strip-effect yield and
guarded deletion only by root identity. The root-ownership stance missed both a replacement
between strip restoration and rearm and a collaborator restoring a deleted identity within
the original lineage. Queue replacement from the actual strip sink during single and bulk
Undo, including published-but-throwing commits; no later outgoing effect or capture request
may reach it. Pair same-lineage input edits with successful, nonblocking rearm. Restore a
deleted owner before cleanup and between awaited effects through committed CRDT truth, then
assert its current gain, strip, source edge and absence of stale removal events. Each removal
effect must recheck committed absence independently; still-absent owners and cleanup faults
remain positive controls.

A real track-deletion Undo restored raw document and projected tracks with monitoring On while
the independent recorder owner stayed absent. Project round trips that assert snapshots alone
miss this disagreement. Exercise single and bulk removal through Command and its actual inverse,
then inspect the live source edge and capture stream as well as persisted membership and modes.
Refused and isolated-preview restores must acquire nothing; published-but-throwing restoration
may rearm only the committed, still-present owner. A denied device must not turn restored project
truth or successful Undo into a failure. See the paired lifecycle probe in `session-lifecycle.md`.

The restoration repair in PR #5091 (`319cc5b5f8`) still read the optimistic store after
awaited strip effects. Hold a second real storage transaction projecting On over a committed
Off restoration, then abort it: neither normal nor ambiguous restore may request capture,
retain an owner, or connect an edge. Change the committed selected input during the strip
await and while permission is pending; admission must use current committed intent and a late
grant must attach only current owners of that input. Include a shared pending survivor and
last-owner removal so rejecting one stale restore cannot orphan another owner's capture.

PR #5091's restore repair (`319cc5b5f8`, retained by `fac4a4f061`) awaited microphone
permission inside sequential restored-track effects and serialized Undo. A successful snapshot
assertion after granting permission missed the blocked history. Bulk-delete two saved On tracks
with independent inputs and Undo while the first permission stays held: both requests must
start, the Undo promise and history transition must complete, and a later real Undo/Redo must
finish before either grant. Permission work belongs to an admitted runtime continuation, with
fresh committed mode/input and owner checks at settlement. Cover denial and late grant after
committed deletion, Off and input change through both normal and published-but-throwing restore;
none may roll back committed truth or leave an unhandled continuation.

The follow-up head in PR #5091 (`2511d0c172`) omitted permission settlement while a restored On
owner was optimistically absent in a second removal transaction. Settle that real grant before
aborting the removal, then require the restored committed owner to reconnect without another
permission request or a premature strip recreation. Also drive the real palette Delete Track
entry through registered removal and Undo: a refused write preserves raw and visible membership,
selection, history and capture, while committed removal retires only its owner and the inverse
rearms the restored one. A direct helper invocation or a snapshot-only inverse misses the caller
and independent runtime authority; see the paired lifecycle probes in `session-lifecycle.md`.

PR #867 introduced deferrable track teardown; PR #5091's head `1297f963` fenced the direct
removal observer while its normal and ambiguous Command continuations still held only track IDs.
Capture the installed root before optimistic publication and replace it through the real
`onCommitted` callback, reusing the removed identity. Repeat with publication followed by a
storage error. The outgoing continuation must leave the incoming owner, source edge, stream and
strip intact, including modulation cleanup, sidechain rewiring and removed-event publication.
Attack remove, remove-all, created-track discard, delegated bulk discard and imported-stem
discard at their actual continuation routes. Replace the root between awaited effects and inside
a synchronous teardown callback: entry-only fencing cannot authorize the remaining effects.
A missing captured root also retires cleanup; same-root genuine removal still completes, and
refusal preserves its graph. The direct observer's replacement test alone misses these routes.

## Lesson from the PR #3141 escape (Don't Save refused to discard, #5573)

PR #3141 (`9db43f786`) added `discardProjectChanges` with a guard built on the project-load epoch:
it captured `transitionAuthority.isCurrent()` and handed `transitionAuthority.isCurrent()` to
`loadRecentProject` as `shouldProceed`. The discard's own load transaction claims the newest
epoch in `prepare()`, before `shouldProceed` is asked, so after any earlier load, New, template or
import had activated, the guard read the discard's own transaction as a newer transition and the
discard aborted itself: edits stayed, an error toast showed and the window close was denied. Its
specs mocked the authority, or ran the real path with epoch 0, where the guard is bypassed.

A guard built on a transition epoch must be probed against the guarded action's own transaction
moving that epoch. A real-path spec for any epoch-guarded action must run after one real
`runProjectLoadTransaction()` prepare and activate, never at epoch 0, and must keep a case where a
genuinely newer transition starts during the action and still wins. Mutation probe: make the
action's own `shouldProceed` read the captured epoch again; the activated-epoch case must fail.

The same guard also compared the CRDT revision, which the action's own stop and `loading`
publication move once a frame flushes, and a spec that mocks `captureProjectRevision` to a
constant and the stop to a no-op cannot see it. A guard on the revision or the project store
object needs a real root document, the real capture, and waits that span a frame; a close or
discard that already drops every edit guards on project identity (`captureProjectIdentity`)
instead. Mutation probe: restore the revision comparison; the frame-spanning cases must fail.

## 2026-10-26 — Stop finalization must retain its recording root (issue #5517)

Commit `0249a95cc5292` added Stop's clip and take-lane closure against the current stores without
a captured root witness; its Git message identifies no pull request. PR #4564 (`40c5218228c5`)
added MIDI `commitRecording` through `executeAppAction` and catch-time discard without carrying
recording-root authority across the dispatch's existing snapshot-transaction wait. A root
replacement could therefore redirect closure, a queued commit or failure cleanup into its
successor. Historical reviewer prompts, models and tiers are unverified; the missing probe was
root replacement at both Stop entry and queued dispatch resume.

Stage a real take under A, replace the root with B reusing clip identities, then Stop: no B
closure, history entry or discard is permitted, and the warning must explain refusal. Separately
hold the real commit before its ownership check, replace the root, and resume; require refusal
and zero new history/count. Remove dispatch-option forwarding to prove this case fails. Pair
same-root real commit/Undo/Redo, null legacy witness, empty MIDI outcomes and genuine retirement
controls. Land one sibling before replacing the root and refuse another afterward: retain the
landed entry and exactly one settled gesture through Transport's public count consumed by
Project's owed-save comparison. All-refused adds zero; downstream count filtering cannot prove
that either Stop caller rejected registration.

### 2026-10-27 — audio capture authority must survive the real commit queue (issue #5517)

The scheduler audio terminal originated in `4f410257b212` (no associated PR), gained failed-capture removal in PR #4270 (`9a0cbea8d62b`) and semantic commit/catch discard in PR #4564 (`40c5218228c5`). PR #5373 (`eecc1c5a8457`) explicitly deferred audio queue and scheduler authority; PR #5658 (`71e358df7415`) covered Stop only. Historical reviewer prompts and tiers are unknown. A callback-entry guard cannot own a later queued invocation or the actual action wait. Captured-take placement also writes synchronously before dispatch.

Capture the opening root for every audio terminal. With the real commit and command executor, hold an active snapshot transaction without reserving root, observe the real unresolved action wait, publicly replace/project a clone carrying the same provisional clip ID, then release. Neither raw/projected clips, takes, durable action history, undo stacks/tree nor the actual session mirror may change; the notice must report refusal. Pair real same-root completed takes and remove only the post-wait guard to require failure. Separately replace before queued invocation with nontrivial staged passes: no pre-dispatch placement may reach the successor. A false execution guard must have a caller-visible refusal rather than silently resolving as success.

## Legacy inverse refusal must reach the history consumer

The pre-#5578 trim handler records inverses without an offset capture. The current handler
maps a domain `false` result to `no-write`, which Command treats as successful execution;
relying on that writer refusal would still consume Undo. Refusal must reach the history
consumer as a conflict. Historical review prompts and model tiers are unverified.

Exercise genuine saved history through the real Undo consumer. Require the raw document,
owning projections, past/future, tree cursor and settled session mirror to remain unchanged.
Hold the actual snapshot transaction, remove an eligible legacy audio target through
public CRDT mutation and projection, then release it: admission must observe that
resumed state before any write or history consumption.
Removing the post-wait admission must fail this case. A pre-wait check or a bare boolean
refusal cannot carry the claim. For direct grouped replay, refuse an unproven prefix before
any sibling writes; metadata-only and compatible-target controls remain separate.

A legacy looped MIDI trim at an unchanged start can still have normalized an old
whole-loop offset and translated notes, controllers and bends. Its current phase
cannot establish its previous raw coordinates. Exercise a genuine saved sequence that
slips with looping off, enables a loop, then trims at the unchanged start. Require visible refusal with
the entry still pending, all raw rows and peer content unchanged. A normalized
zero-distance legacy entry also lacks that authentication. Pair these refusals with
current capture-bearing zero-distance Undo/Redo restoring exact raw owner coordinates,
including captured zero; no historical graph reconstruction is required for admission.

Current loop-disabled mode does not authenticate the mode when the historical trim
ran. Disable looping through a peer edit on the genuine saved looping case and require
refusal without consuming history or changing that peer state. Missing-capture MIDI
inverses refuse regardless of current mode; genuine saved audio remains replayable.

Broader MIDI refusal must not make earlier timing and prefix tests vacuous. Use an
eligible audio target for the held-snapshot removal above and for a synthetic direct
revert unit whose newest callback would remove that target. The early callback guard
must refuse before invoking the callback, preserving raw project, full history and tree.
Retain callback identity when snapshotting history rather than cloning its functions.

## Escape: admitted take placement was discarded during project hydration (PR #4987)

PR #4987 (`62a116ee0073`) added paired `passAnchorSeconds` and `passDepthSeconds`
with a required `sourceOffsetBeats` to the take-store sanitizer, while project-file
admission still checked only the take's older required shape. A current-version
file containing a selected take with offset zero and only an anchor was admitted,
then real hydration removed both that take and its comp region. The top-level and
saved-arrangement take-lane routes both admitted the loss. The public approval
attacked saved lanes and persistence, but no published evidence covers malformed
placement at admission; the exact private stance prompts are unavailable. The
missed failure mode is admission accepting metadata its owning hydrator discards.
The older malformed-offset variant began with PR #4222 (`120c9e2b418e`), which
added offset rejection to the store without extending project admission.

Probe the serialized candidate before project replacement, then its real owner
hydration. Reject anchor-only, depth-only, negative or nonfinite depth, malformed
offset, and complete placement without an offset before any current project,
raw document, or store replacement. Exercise both take-lane routes. Pair these
with JSON-roundtripped legacy takes without placement and complete finite
placement with a negative anchor: the selected takes and their comp regions
must survive real hydration unchanged, including an active saved arrangement's
top-level fallback. Reverting placement admission must fail the rejection cases;
a sanitizer-only assertion cannot establish safe file admission.
