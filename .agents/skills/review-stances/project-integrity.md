# Lesson library: project integrity

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

## Lesson from the persisted clip-edit undo escape

PR #3354 introduced the session mirror but did not prove that the real Delete Time, split, move,
and remove handlers could save their generated inverse and redo payloads. Their live undo stacks
worked until a reload; the mirror silently omitted entries whose internal restore actions lacked
owner replay contracts. A neutral generated schema can also be narrower than the complete clip or
time-operation snapshot captured by its owning handler.

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
