# Review stance: project integrity

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
