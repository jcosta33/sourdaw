# Lesson library: project integrity

## 2026-10-30 — a rejected bundle merge still owns its installed prefix (#5887)

The synchronous merge loop in `0a6c596db4b9bddafab3e63a79b9e3845077d2e4` and the worker
installation loop added by `c9fd03bfb9b13d939c20998ff6b3307fc7b5d755` notified projections
only after the whole loop succeeded. The GitHub commit/pulls lookup returned no associated PR for
either commit; historical review prompts, stances and tiers are not established. PR #5880 exposed
partial installation through root observers while preserving the existing omission from ordinary
change listeners. A root observer proving the installed value does not prove the project stores
received it.

Fail a later decode after an earlier root is actually installed, on both the worker-result and
synchronous fallback routes. At the caller's rejection boundary, require raw durable fields and
the real owning stores behind `setupProjectionBridge` to agree, with one bulk notification after
root-installation bookkeeping and the original error preserved. Cover a branch-only prefix and
failure before any installation; only the former publishes. Keep stale and cancelled results
uninstalled, private preview edits isolated, and a later successful merge coherent. Removing
either failure-path publication must fail its real-store case; checking only repository values
or root-observer calls misses the split.

## 2026-10-30 — an installed root swap escaped the acceptance state oracle (#5649)

PRs #5733 and #5735 delivered typed state snapshots and persisted-transition checks, but
`insertDoc('root', changedClone)` exposed changed project content to repository readers without a
change notification. Restoring the original root before phase exit still scored zero. The gap was
inherited from the original state oracle; historical private reviewer prompts and tiers are unknown.

Probe the installed `root` map at the operation boundary, before a later callback can restore it.
Alter a real track, clip, device or VCA group field in a clone, install it, independently read the
changed field through `getCrdtDoc('root')`, then restore the original. Require a positive unintended
mutation count with an unchanged barrel count and exact case outcome. Exercise root creation,
replacement, load, merge, snapshot restore, removal and reset, including a partial merge that
throws after installing changed root content. Keep same-content identity moves at zero and private
preview or aborted decode outside the root feed; never publish a change merely to make it observable.
If project replacement clears an installed document map before root initialization throws, its
exposed membership change must invalidate project identity and advance the mutation epoch once.
Removing only a child leaves the root identity stable; removing the root moves both identities.
An already empty map keeps all identities stable on the same failure. Check these failed routes
without manufacturing an ordinary content notification.

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

### VCA Inspector membership must retain Command and durable history

The Inspector's direct calls introduced in `22a84b216658f593391e7e141d90f7c84d13648b`
remained outside the typed VCA history route added by PR #1049. The missed observable was the
Inspector entry reaching that route; historical private review prompts and tiers are unknown.

Exercise Create, Assign and None through real Command and its registered handler against a
CRDT-backed root. Compare raw track group IDs and group member arrays with their projections;
require one history and Undo entry, and verify Undo and Redo restore exact prior and next states
without changing unrelated tracks or groups. Locked admission must preserve raw state, history and
engine writes; no-op selection must leave them unchanged. Revert the relevant component dispatch
to its direct use case and require the connected history or lock case to fail.

A queued gesture must keep its project identity across an asynchronous snapshot wait: copied
track and group IDs do not identify the owning document. Hold the real queue, dispatch each
gesture, replace the root with a same-ID successor through production repository and projection,
then release it and require unchanged successor raw/projected state, history and engine calls.
An ordinary same-project snapshot must still permit the gesture. This successor case was caught
in #5789 review before merge, not established as a main escape.

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

### Timeline bake must preserve project truth across a later-pad refusal

The direct per-pad writer traces to `90bc7995e`; GitHub reports no associated PR. PR #474
retained the escape when it added a groove-projection refusal after a clip write, allowing a
later pad failure to leave earlier clips or notes in the project. The missing probe was project
integrity across the whole action; historical private review prompts and tiers are unknown.

When one UI action generates several clips or notes, fail a later lane after an earlier lane is
valid. Pre-resolve source projections and submit one compensated typed batch bound to the current
project and document identity. Require refusal to leave raw CRDT, projected stores and Undo history
unchanged. On success, one Undo removes every generated clip and note, and one Redo restores
exact content. Direct writers inside a per-pad loop can leave partial music even when each writer
is valid.

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

## Recording replay must authenticate the captured owner

PR #4564 (`40c5218228c542c5a4cf3cdd73388f4da893ea4e`) introduced recording replay that checked only the destination track before restore and removed the clip ID globally on discard. A collaborator moving that same recorded ID to another track between history legs admitted a duplicate and then deleted the peer copy. Probe both moves before Undo and after Undo before Redo through real Command and CRDT storage; preserve raw and projected media, takes/comp, automation, MIDI and satellites, and retain the exact pending history on refusal. Count duplicate occurrences across tracks and within one track. Authenticate a discard's actual pending inverse against its original commit and explicit redo, and reject restore while any active occurrence exists. Historical private review prompts and tiers are unavailable; the missed stance is peer ownership changing between recording history legs.

## Escape: repairing attached composite conflicts cloned live proxies (PR #4292)

PR #4292 (`ac8e123b5e`) introduced a repair path that passed attached Automerge map and list proxies to `structuredClone`. The map input throws `DataCloneError: '#<Object> could not be cloned.'`; the list input throws `DataCloneError: '[object Array] could not be cloned.'`. The scalar conflict case did not exercise either composite shape. Keep this escape distinct from the actor-order flake in `test-validity.md`.

For project integrity, create real concurrent conflicts at the `tracks` map and `tracks.tracks` list with two fixed actors, then run the registered `repairProjectData` action. Verify the conflict and repair gate clear while the complete resolved tracks and MIDI remain identical in the raw document and projected stores, including exact `0.9999999999999999` gain, MIDI offset, and duration leaves. Save and reload actual Automerge bytes, rebuild projections, then run the registered `setTrackPan` action; the raw document and projection must agree and the edit must create one undo entry.

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

## Fermenter discrete filter choices bypassed Command

Filter Type entered through `c40d444ff96520cb2f718dd2a397173d72dc1b50`; Filter Model followed in `66b0569af54525fc983a0632ce0c12d92f83fe90`. Both panel callbacks used the direct parameter bridge, so changing the highlighted chip and engine state created no Command inverse. Neither origin has an evidenced public PR association; historical reviewer prompts and tiers are unknown. The missed stance is a discrete UI choice bypassing undoable project truth.

Trace the rendered chip through the registered Command, raw document, fresh projection, session display, Undo and Redo. A first selection must restore an absent leaf rather than materialize its default; a present default must remain present. Hydration must restore the visible default on absence while preserving unrelated patch fields and live macros. Model and Type each own pending authority by device and parameter; a hidden non-SVF Type stays stored. Hold a snapshot and vary project identity, revision, owner, chain, frozen state and peer value independently, including same-ID replacement and exact-state ABA. An old queued direct parameter frame must not overwrite the newer admitted choice.

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

## Lesson from the persisted clip-edit undo escape

PR #3354 introduced internal replay contracts for the existing session mirror but did not prove that
the real Delete Time, split, move, and remove handlers could save their generated inverse and redo
payloads. Their live undo stacks worked until a reload; the mirror silently omitted entries whose
internal restore actions lacked owner replay contracts. A neutral generated schema can also be
narrower than the complete clip or time-operation snapshot captured by its owning handler.

For each affected edit, execute the production action, wait until the session mirror contains its
entry, register fresh production handlers to hydrate it, and exercise Undo and Redo against the
authoritative project and its projections. Corrupt the saved inverse and redo separately: swap a
clip identity, placement, or split snapshot; put a nonfinite number in a snapshot; change a time
plan's scope or make its replay legs disagree. Hydration must drop each forged entry before any
project write. Keep internal restore validation with the owner and session mirror; admitting a
local forward action to the mirror must not add it to executable action discovery.

The first #5064 saved clip-edit validator (`e8163b99cc`) checked a removed clip's satellite
capture only as an array. Its malformed-history review stance mutated optional clip fields and
take state, but missed nested gain and warp values. A real `removeClip` with a gain envelope could
therefore persist an inverse whose `gainDb` was later changed to a string; fresh session hydration
kept it, and real Undo wrote the string to raw CRDT while the gain-envelope projection discarded it.
For every saved inverse carrying clip satellites, seed valid envelopes and warp markers through their
owning stores, remove the clip, corrupt one nested field in the persisted capture, then hydrate and
invoke real Undo. Require hydration to drop the entry and both raw authority and projections to stay
unchanged. Keep a valid gain-and-warp remove/reload/Undo/Redo control and the legacy warp alias and
default-collapse controls; an array check or general finite-number sweep cannot prove shape safety.

The same #5064 removal capture admitted `clipAutomationLanes` when it was merely an array. In a real
two-lane removal, changing one persisted point value to a string let fresh history hydration keep the
entry; Undo restored the clip, while Automation rejected the entire lane batch and history advanced.
For saved clip-removal inverses, compare each lane with Automation's exact snapshot contract before
admission. Keep a valid producer-capture/reload/Undo/Redo control with two clip lanes and an unrelated
lane, then corrupt one nested lane field in the saved sibling entry. Hydration must drop that entry,
and real Undo must leave raw document, track, MIDI, gain, Automation projections and history unchanged.

The next #5064 repair checked each captured automation lane's shape but missed identity across
siblings. A real two-lane `removeClip` can save an inverse where both captured lanes later carry
one ID; Undo then appends duplicate IDs, or silently skips both when that ID belongs to a resident
unrelated lane. Produce the saved entry through the registered action, change only the saved sibling
IDs, hydrate fresh production contracts, and invoke real Undo. Require hydration to reject the whole
entry before any write; raw document, owner projections, and complete history must remain unchanged.
Keep the valid two-lane remove/save/hydrate/Undo/Redo control. A nested-shape-only stance cannot
detect a duplicate identity among individually valid siblings.

The #5064 removal validator at `06ed9f7c42` also admitted individually valid satellite and
automation rows owned by a different clip. From a genuine saved removal of clip-a, change only the
satellite's `clipId` and nested envelope `clipId` to clip-b, then separately redirect just one
captured automation lane's `clipId`. Shape and duplicate-ID checks cannot detect either relationship
failure. Require fresh production hydration to drop each entry, and real Undo to leave raw CRDT,
every exercised owner projection, and the complete public history unchanged. Keep a genuine saved
gain/warp/multiple-lane control with distinct clip-b owners through repeated Undo/Redo. Bind owners
to the removed clip without rejecting empty captures or imposing track relationships the producer
does not guarantee.

The #5064 move capture also needs Automation's point contract at saved-history admission. It records
partial lane snapshots with only id, trackId, and points, so a full-lane validator is the wrong shape.
Move a clip with two rich automation lanes through real save and hydration, then corrupt the same
point in the paired inverse and redo snapshots with an unsupported curve, negative beat, empty id,
or negative stair steps. Require hydration to discard the entry before real Undo can change raw
authority, projections, or history; keep a valid rich Undo/Redo control and an empty capture control.

PR #860 (`ad46a80c7e`) introduced a time-operation guard that compared the whole captured track-store state,
including local selection and ghost clips. The #5064 persisted Delete Time control hydrated handlers
without resetting projections, so it missed the production load boundary: `loadProject` resets
projections, clears selection, and leaves durable tracks unchanged. A saved replay then refused solely
because that UI state differed. Require a genuine registered Delete Time with joined audio, MIDI,
Automation, gain, warp, and take owners; wait for its saved entry, reset projections as a fresh load
does, hydrate production handlers, and run real Undo and Redo with different current selection and
ghosts. Both durable authority and projections must round-trip exactly while current UI state survives.
Keep strict saved-shape validation and zero-write refusal for changed durable content. The missed
stance obligation for #5064's newly persisted history is the actual fresh-load boundary, not handler
registration alone; the historical #860 review prompt is unverified.

PR #4519 (`00f29b9ca2`) restored retired takes by cloning their captured selection before appending
live-only takes. After split Undo retires a peer's selected right take, another peer can select a
surviving left take; Redo then revived both selections and the first stale take won resolution. A
project-integrity stance must synchronize real same-lineage Automerge messages before Undo and again
before Redo, hydrate both saved history stacks, and inspect the raw lane, projection, and selected-take
resolver. Restore the retired take and its placed source fields while preserving the later resident
selection uniquely. Also prove selected restoration when no live selection or lane exists. Retain the
existing conservative comp policy: any live overlap drops the whole captured region, while disjoint
regions return. Direct store fixtures without a later selected survivor missed this failure mode.

PR #2169 (`bfbf1dd69b1`) added gain, warp, and automation restoration to clip removal inverses.
PR #3809 (`b34f9c49345`) guarded grouped restoration only by track presence and clip absence;
single-entry restoration bypassed that preflight. The missing risk was freshness of target-owned
material while the clip rectangle remained absent. After a real removal, saved capture, and fresh
hydration, independently publish later target MIDI notes, CC, pitch bend, gain, warp, and automation.
Both single and grouped Undo must write no owner or raw document state, keep the complete history
pending, and leave an earlier independent grouped inverse unapplied. Keep genuine unchanged-capture
Undo/Redo controls and later disjoint peer owners, current selection, and ghosts. The historical
review prompts and tiers are unverified. PR #239 routed MIDI restoration through its owner but
preserved an older unguarded overwrite; it is not evidence of the original MIDI defect introduction.

Saved replay admission also binds relationships between valid rows. For a real rich move, change
only a captured automation lane's track owner in each mirrored placement leg. For a placed audio
removal and a split whose Undo retires a later right-fragment pass, redirect the retired lane's track
owner while preserving its take and placement fields. Fresh hydration must discard each forged entry
before Undo or Redo writes. Keep rich, fractional, empty, and historical captures and the later
surviving selected take controls; shape validation alone does not prove containing-owner authority.

The #5064 repair at `7ea9bd75d5` bound captured removal automation to the removed clip but
still admitted a different containing track. Produce a real two-lane removal, change only
each captured lane's `trackId` to another existing track in separate attacks, save and reload
the document, and hydrate fresh production history. Require rejection of the complete single
entry or group before real Undo can write redirected automation. Prior foreign-clip and
shape attacks did not change this second ownership relation.

The same head checked removal replay absence only inside the captured track. After a genuine
remove/save/reload/hydrate cycle, synchronize a separate actor's valid recreation of that clip
identity on another track. Both single and grouped Undo must refuse with raw document and
heads, fresh owner projections, and complete history unchanged; in a group, spy on owner
writes to prove an earlier independent inverse never executes. Prior late MIDI, gain, warp,
and automation attacks left the clip rectangle absent everywhere, so they missed this live
identity-to-containing-track relation. Keep the genuine captures, fractional and placed-pass
controls, and later selected-survivor/disjoint-comp replay controls.

PR #4519 (`00f29b9ca2865f810070253bcb46e486c15c1db5`) introduced retirement restore's
lane-id-or-track lookup. A saved #5064 removal at `1ee740f340` could change only the
captured lane id to another track's resident lane while retaining the correct captured
track. Undo then restored takes and comp regions into the foreign lane. The missed
ownership probe is identity reuse, independently of the captured track field: change the
saved id before hydration and synchronize a separate actor's reuse after hydration. Run
single and grouped removal Undo and split Redo; require zero owner writes, unchanged raw
document and heads, fresh projections, and pending history. A retired id absent from live
is valid, and a new lane for the correct track still merges while preserving its unique
selected survivor and disjoint comp regions. Preflight the complete replay before any
clip, MIDI, satellite, automation, or take write; refusing only the final take restore
would leave a partial edit and consume history.

The same #5064 head admitted paired split captures with foreign automation owners.
`prepareClipSplit` captures automation for the right fragment only, and satellites for
source and right only; the pre-split right satellite is null. Bind every optional row to
that producer contract, using Automation's exact normalizers and the satellite codec's
duplicate and nested-owner checks. Change the paired inverse's expected and redo's
replacement automation owner independently by clip and track, and change paired source
satellite outer and nested owners to an unrelated clip. Save/load the real document and
hydrate the real history before replay; exact mirrored pairing and valid row shape do not
prove containing ownership. Keep rich fractional captures and absent optional legacy
fields usable. These saved-capture probes were absent from the earlier review's foreign
retired-track attacks, which left the retired id and split owner rows unchanged.

The project ID walker introduced in `83be56e84ee` treated every nested `id` as
global. PR #3032 (`93710471aa`) scoped arrangement snapshots but retained that
assumption for live gain envelopes. Split and duplicate preserve authored gain
point IDs; edits address them by clipId plus pointId. A genuine rich split saved
and binary-loaded in #5064 therefore passed audio-graph inspection but failed
project invariants, leaving every owner projection empty and refusing Undo.
Probe the inspector with real binary-loaded canonical gain envelopes that share
point IDs across clips, including an ID equal to a global track ID, then drive
the actual rich fractional split through reload and both history legs. Require
duplicates within one envelope, global entity collisions, and repeated
arrangement IDs to remain repair-required. The missed stance clause was the
identity's owning namespace, not whether recursive traversal found every ID.

Ripple removal's restore changed collateral owners without authenticating them.
Commit `7a85ce6456a79b050b0bf9aaacc79924ef34244e` introduced the unconditional
shifted-rectangle restore; GitHub reports no associated PR for that commit.
PR #922 (`cb5cc8fabc22a82f18225deced69e0e01b9c7f6f`) added inverse automation
shifts to the same route. The #5064 saved-history replay at `f1b39bf9e7` guarded
the removed clip but still rewrote a later peer move of the shifted clip and
consumed the head. The missing stance clause was every owner the inverse will
write, including collateral rectangles and complete shifted automation scope.
Remove a clip with ripple, binary-save/load and hydrate real history, then sync
a peer move, track change, owner deletion, point edit, lane deletion/rebinding,
or added scoped lane onto a shifted clip. Require single and grouped Undo to
refuse before any owner write with raw document, heads, projections, and history
unchanged. Keep fractional automated ripple Undo/Redo/Undo with real reloads,
unrelated peer owners, selection/ghosts, and current take/comp reconciliation.
Redo's fresh producer capture must reach the retained inverse: authenticating
the first gesture after a later actual redo is stale. Historical missing lane
captures remain readable, but only an empty shifted automation scope can be
authenticated without them. The old probe checked the retired clip's owners
and left every shifted owner unchanged; its green round trip proved no peer
protection for these collateral writes.

Capture sequential real removals under one group ID, with automation on both
the next removed clip and a shared shifted survivor. Group preflight sees the
same state each inverse will see only after projecting already-validated
earlier restores in order, including lanes restored by a non-ripple removal.
Keep saved Undo/Redo/Undo across both reload legs and reject duplicate restored
lane identities against that prefix before any member writes. A live-only
guard falsely refuses the genuine group; checking only current lane IDs lets
an earlier restore occupy a later restore's ID and causes partial replay.

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

### Restore monitoring from the authoritative root after aborted repair (issue #5286)

During a held same-project repair, compare the committed project root with its optimistic
projection: a projected Off must not erase committed On intent. After the version restore aborts,
require the rebuilt strip to receive a newly acquired source and the old stream to stop once; the
aborted operation must add no history. A committed Off during reset stays Off, and a root
replacement must not reset or rearm its successor. Preserve pending and refused permission cases
and armed Auto's final-transport behavior. Read these root, projection, connection, stream, and
history assertions in `repairRuntimeGraphFromProject.optimisticRestore.integration.spec.ts` and
`repairRuntimeGraphFromProject.autoMonitoring.spec.ts`; controlled ports do not prove hardware audio.

### A projected absence is not a committed deletion (issue #5283)

Hold the production registered removal handler for an On track `a` in a real storage transaction.
While its optimistic projection hides `a`, independently commit `replacement-input` with
`mutateCrdtDoc`. At that held interval observe the raw committed root still containing `a`, the
visible projection omitting it, and runtime ownership together: the obsolete `a` key and edge
must already be retired, while eligible shared `b` keeps the same capture, edge, and stream. In a
last-owner case, the old input must stop. Neither case may recreate `a`'s strip or request
permission. Commit must remove `a`; abort must re-admit its current input. A same-input abort preserves the original owner
and capture. Testing deletion and selector changes separately misses this authority crossing.

## Crumbs waveform ownership must survive its own project mirror

The unfenced sampler continuation in `c8c1257477838ab15d98b5ea6b38e821ddb4ad57`
survived PR #5041's decode-only sequence check (#5780). No public PR is associated with the
origin, and private historical review prompts and tiers are unknown.

Trace the accepted sample through the real session store, persistence subscriber, registered
Command, raw CRDT device and reconciliation. Its own metadata commit and ordinary knob/track
edits must preserve authority; a whole-root revision or projected row identity cancels valid
work. A replaced root/device and a fresh accepted sample leaf must revoke older publications.
Distinguish same-effective metadata replay, which preserves usable cached peaks, from the
leaf witness that owns a pending result. Retain nested paired holds, withdrawal convergence
and user-pick replay controls. A fake injected token cannot prove the app's authority producer.

## Lesson from direct commit 61adb8: redetection dropped locked automatic markers

Commit `61adb8dfbb04f8cb6eb01057b9814a6e6ef1d53d` promised to preserve locked markers, but its predicate retained only markers whose origin was not `transient-auto`, dropping locked automatic rows too. The original preservation fixture covered a user row and an unlocked automatic row, so it could not expose that loss. Current main retains `locked === true` rows and suppresses detections within `1e-3` of a retained original beat (PR #5515).

Exercise real Detect, sensitivity re-detection and the registered Command with a moved locked automatic row beside user, grid and unlocked automatic rows. Require the exact ID, original and warped beats, lock and confidence to survive in raw CRDT and projected state. Vary the input or sensitivity so redetection changes the detected population; visible counts, draws and hit state must reflect that new projection, while other clips and source PCM remain unchanged. Then unlock that same held automatic marker and detect again; the marker must be replaceable, so retaining it after unlock fails the control. Independently remove locked-row retention and equal/near-hit suppression; the row-preservation and collision probes must each fail. This is source-and-fixture guidance only: it claims no Worker or performance acceptance, new runtime test, or full #4630 acceptance.

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

### 2026-10-09 — copied split automation identities broke saved-project replay (PR #4036)

Commit `7961816964ebfe247ead1f057a2cd0f33571f624`, merged through PR #4036, copied
surviving automation point IDs onto the right fragment while retaining the source lane.
A split before those points therefore violated global ID uniqueness after binary reload.
PR #4036's public round-four review described curve, stretch, and link-law probes, but
its published evidence did not include binary reload or a global identity census. The
missed stance was reload identity and global-ID preservation; its historical tier is not inferred.

Split before surviving identified main, trim, and ghost points, using both a dyadic cut
and a non-dyadic cut. Produce entries through real Command, save/load the Automerge
document, replace it in its lineage, reset every owner projection, and hydrate the separate
session history mirror. Require a full global-ID census, valid project invariants, exact
scalar values/order/curves, and all owner projections before real Undo and Redo. Retaining
copied point IDs must turn that reload assertion red; fresh in-memory curve checks alone
do not observe this obligation.

### Saved replay authority refinements measured in PR #5064

A saved clip inverse must use its MIDI owner's complete snapshot law before hydration or any
Arrangement write. Duplicate note identities, malformed CC or pitch-bend rows, and a missing
required capture are not an empty or null capture. Probe a real removal's saved inverse through
production hydration, then require no raw, projection or history write; retain separate valid null
and present-empty controls. Minimal mocked rows cannot establish that the restore owner admitted
what the earlier Arrangement write already published.

For split replay, recreate either target identity under another track after Undo and binary reload,
then require direct and grouped Redo to preserve every owner and the pending history. Delete just
one side of a mirrored optional satellite or automation guard: reject the group before a later peer
value can be replaced. Both historically absent sides remain valid, and present empty is distinct.
A durable-head change alone cannot authorize refresh of a removal inverse; roll the root back in
its lineage from a committed observer before the finalizer, and require the old inverse to survive
on ordinary and ambiguous commit paths. Keep genuine own-commit warning and refused-flush controls.

PR #1425 (`9aebb8837ddc9c6640a7a8037c2b7b25eaea204d`) compared an absent split right clip's
remembered insertion slot with current track length; PR #2287 later extracted that guard. The missed
probe was valid saved Redo after unrelated same-track growth: split, Undo, append a peer clip, binary
reload, then Redo twice. Preserve the peer clip and captured insertion position; a present right
clip still requires its exact slot and value, and an invalid replacement slot still refuses.

PR #515 (`58847d9a26e4c59772441bd23ae3a587f3573b2c`) omitted array placement from the saved
cross-track move capture. Probe a real middle move, binary reload, Undo and Redo twice with raw and
store order plus the beat-5 overlap hit; remove a captured neighbor and append an unrelated peer
clip to prove replay keeps the surviving neighbor's priority and peer material.

Copied split lane, main, trim, ghost and seam identities must reserve the entire live namespace.
Preoccupy the preferred generated identity under an unrelated owner before the split, then require
binary reload and repeated Undo/Redo with exact values and valid invariants. After Undo, let a peer
claim an actual captured identity and require zero-write refusal rather than reminting that saved
capture. A census only against the source lane misses both collisions. Include nested object points
and cross-domain clip owners, while preserving clip-local gain point and arrangement namespaces.
For a batch-admitted restored clip preceding a split, compare captured IDs with the actual committed
IDs before reloading and replaying twice; a live execution that remints a preflight capture is not
replay-stable. Draw is singleton-only, so a rejected draw/split batch proves admission, not prefix
execution. Read executable entries from the full history owner rather than its label-only UI view.

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

### 2026-10-25 — optimistic replay success did not prove its committed owner (#5520 / #5613)

PR #5520 (`21bcc9487c`) introduced the generic nested-field hydrate winner and base advance.
At #5613 head `af579c26`, real Undo-first peer sync could publish an unrelated surviving-clip
rename after restoreClip staged its track write but before Command committed. Hydration erased
the local restoration; Undo still consumed history. Historical introducing-review stance coverage
is unverified. The missing probe was actual commit preservation after replay admission.

Drive real Command removal/Undo and actual AutomergeSync continuations in both admission orders.
Require either both edits in raw authority/projection or zero-write refusal with past retained.
Repeat with identical and different same-ID recreation, plus no-peer, fully published unrelated
peer, grouped/ripple and same-target placement/split controls. A setter-injected microtask alone
does not establish the production receive protocol. Authenticate affected raw pre-images and the
prospective committed owners; a written handler result or optimistic store does not prove either.
A projection may run inside an entered transaction scope, so ambient owner equality cannot
certify its data as newly authored intent. Interpose publication and hydration there, with an
unrelated notification before hydration, and require the original restoration obligation to remain.

Track presence does not certify the restored source programme. Independently race MIDI notes,
controllers/bend, clip-scoped automation, gain and warp owners without changing raw tracks; a late
peer owner must survive refusal and history must remain pending. Preserve captured child-ID
availability in its existing namespace, including unrelated owner buckets. Exercise the prospective
mutable document as well as the immutable root: proxy identity is not an ownership witness, and
canonical clip-local gain-point IDs must remain local in both. Pair these conflicts with a real
unrelated programme edit and a valid same-target successor that commits the final owning projection.

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

For the PR #4564 manual-terminal escape (#5289; fenced by PR #5373), preserve the current branch contract in the test: switch awaits Stop before replacing the root, while fork snapshots and replaces it before the old recorder terminal settles. Use the actual branch use cases, real Command/CRDT projection and branch-state commit. Observe outgoing commit at the switch's real replacement and read its actual backing snapshot; after a real fork, compare raw root, projected clips/takes, durable action history, Undo stacks/tree and the actual session mirror before and after stale success and stale failure. The fork's legitimate copied provisional clip is part of its baseline, not a ghost to delete. A same-owner PCM/Undo/Redo control and an always-true captured-root mutation must distinguish retained ownership from a disconnected callback fixture. Immediate Stop mocks or direct root replacement do not prove these branch routes.

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

## 2026-10-29 — an AI group revert committed a newer inverse before an older conflict (#5565)

The history caller introduced by `22a84b216658f593391e7e141d90f7c84d13648b` replayed
members separately; `78ccb2d361ffc61f97048ec3a4fa4b51e2cf6637` moved that loop into
Command without making it atomic. GitHub reports no associated PR for either commit;
historical private reviewer prompts, models and tiers are unknown. The missing failure
mode was a later inverse refusing after a newer member had already changed the project.

Apply Keys gain and Bass mute in one real group, remove Keys, then invoke the public AI
history revert. Require unchanged raw project, projections, both Undo stacks, tree and AI
metadata, plus a visible refusal and no Bass engine write. Pair an intact multi-member
group with a later unrelated musician edit and real Redo. Hold the actual snapshot wait,
replace the root with identical content or discard same-lineage history, then require
zero-write refusal. Capture existing mutation-owner authorization before the first await;
permit the replay's own writes and settle already-visible queued writes synchronously.

## 2026-10-29 — deferred replay effects could finalize history into a restored project (PR #5556, caught in #5849)

PR #5556 (`6e8565f8ce195daf3ee7d763cd88e700a9779890`) finalized atomic group history only
after awaiting replay and its deferred effects. Review of #5849 caught a committed inverse
whose held effect allowed project replacement and Undo clear before old entries entered the
replacement's Redo. Historical private reviewer prompts, models and tiers are unknown.

Hold a real post-commit effect after proving the inverse's raw writes committed. Replace or
restore the captured project, clear history and release the effect; require the replacement's
past, future and tree unchanged. Repeat through actual ambiguous publication reconciliation,
including restoreUndoHistory with the original captured entry objects, not only cloned IDs.
Object identity is not history ownership: capture and compensation preserve those objects.
Finalize once at the normal or distinct ambiguous publication boundary before effects can
re-enter; a committed inverse stays committed truth even if later effects warn. A later musician
edit must retain its entry and invalidate Redo normally. Keep normal onCommitted silent for
no-op, cancelled, rejected and ambiguous outcomes, and retain the original ambiguity if its
separate observer throws.

The same late-finalization route also admitted stale no-op history: replay can skip every
inverse yet still yield before history settlement. In #5849, a real legacy clamped-gain
inverse proved no project or track write occurred while replacement and clear installed a
different history; old entries still entered its future and AI metadata claimed a revert.
Keep the unchanged no-op control, but require caller project mutation authority and the
untouched Undo snapshot again before consuming a no-publication result. Exercise both panel
and thread callers, same-lineage edits with the exact Undo snapshot retained, clear-only,
discard, original-reference restoration and request cancellation. This fence applies only
before publication: a real committed inverse remains committed truth.

## 2026-10-30 — startup retry must preserve the initialized project and its history

PR #3356 (`26c6a7fe7d3374572f42510ac9accf8ff293a420`) added a second App render after first paint.
The later initial-App rejection occurred before that App rendered, while bootstrap activity was
already visible. The App rejection defect reached main; exact private review prompts and tier are
unknown. A retry that only proves a new page or restored controls does not prove project integrity.

Begin with a canonical same-project new-document reload of a genuinely initialized project, live
witness-bound history and an operative Undo/Redo entry. Inject the actual initial App rejection,
then require unchanged project identity, exact raw and projected owners, full-channel PCM digests,
durable witness-bound history, and successful Undo/Redo after recovery. Confirm a changed
`performance.timeOrigin`; a same-URL fragment navigation is not a new document. Playback controls
and mirror existence alone are insufficient.

### 2026-10-30 — checkpoint descendants lost the captured sibling frontier (#5681)

The root checkpoint-equivalence helper originated in PR #3175. Its first form compared each
descendant's single-head projection with the captured merged projection. After approval captured
two concurrent root heads, either branch therefore appeared changed when it advanced only
`commandBatchIdempotency`, because its isolated view omitted the sibling's project truth. This
pre-existing rejection was recorded while reviewing PR #5677; PR #5716 fixed it by comparing
each new change with the projection at that change's own dependency frontier. The historical
review prompt, stance and tier for this specific failure are not established.

Capture two fixed-actor branches with distinct real project edits, merge them, and retain both
branch documents. Add checkpoint-only records independently to each retained branch, merge the
descendants, and require the root frontier to remain two-headed and equal to the captured project
truth after excluding only `commandBatchIdempotency`. This helper case does not require or assert
that the whole checkpoint map is conflict-free; the matcher compares project truth outside that
bookkeeping slot. Keep a real project edit, edit-then-restore, and discarded history as helper
refusal controls. For the public confirmation positive path, use non-conflicting checkpoint record
inserts; the proposal must execute once, store its receipt and one Undo entry, and Undo must
restore the previous value. Separately retain refusal at actual confirmation for an unresolved
whole-map checkpoint conflict. Reverting the dependency-frontier comparison to compare each
singleton descendant with the merged capture must fail the focused regression in
`projectRevisionMatchesLiveIgnoringCommandCheckpoint.spec.ts`.
