# Standing probes: collaboration teardown and receive-side sync

Defects where a collaboration session's teardown, staged backup, asset handoff or receive-side sync acts on a runtime
other than the one that began it, or reports progress that was never durable or transported. Split out of
`session-lifecycle.md`; probes moved from the `crdt-collaboration` skill.
Each probe names the failure mode, the input or state to drive and the check that must go red, and names the
mutation that must fail it where its source lesson established one. Controlled ports (media, graph, scheduler,
wall-clock) prove ordering, ownership and cleanup; they never establish physical hardware audibility.

## Standing probes

1. **Teardown and callbacks stay bound to their installed runtime.** A buffered leave-message drain followed by
   global session cleanup after an await closed whichever session was installed by then, and stale join
   continuations were invalidated without binding cleanup to the runtime that began it. Pause an outgoing leave at
   its transport await, install a successor session: the outgoing cleanup cannot close or reset the successor. Retain
   old manager, sync, asset, timer, branch-transition and decode callbacks and invoke or settle them after
   replacement: they neither read successor state nor write project, runtime or panel state, while current-owner
   callbacks stay effective.
2. **Teardown durability through the registered actions.** Drive the registered create, join and leave actions
   through both `executeAppAction` and singleton `executeAppActionBatch`. Hold and reject the underlying lifecycle
   promise: command completion waits for it, and the runtime route never opens a project storage transaction.
   Exercise no-op root persistence, changed-root persistence and handoff, and generic document persistence, since
   each route can swallow its own error before a drain-only tail sees it. Include a repository commit followed by an
   exact-head rejection, partial session initialization, and a second explicit lifecycle attempt retrying the
   retained work after the installed owner was cleared. A successful promise tail, a committed write without fresh
   exact authority, or a configuration-object assertion is not durable teardown.
3. **A staged session backup survives repeated removal failure (#1581).** Non-throwing local-storage writes advanced
   their cache after failure. Reject repeated removal failures until a fresh durable read proves the backup gone;
   write newer branch state while removal stays refused: retry does not replay the stale backup and a later
   successful removal settles it. Refuse both backup and branch-state reads after initialization: recovery keeps the
   earliest durable witness; a failed `trySet` notification cannot authorize deletion, while a directly observed
   successful adapter write protects the newer branch state even if reads stay blocked.
4. **A prepared asset-handoff commit queues behind accepted owner operations (#4248).** Prepared commit closures
   bypassed the durable owner operation queue. Prepare the handoff, admit and hold a source staging operation, then
   invoke the returned commit: it reaches no owner repository until the accepted operation settles, and both
   results stay recoverable from fresh repository instances.
5. **Receive-side sync progress is real, fenced transport work.** Suppressing repository change notifications while
   applying a remote document left no protocol reply or fan-out at the accepted receive boundary. Fixtures that
   fabricated a local change notification after every receive, or hid empty rounds behind three deliveries, masked
   it: treat the first change as the defect. Use isolated production endpoints, actual transport messages and one
   shared initialized genesis before separate offline edits; settle each send before delivering its response so the
   sender records the generated SyncState first, and prove a sanitizer sees an edit-bearing payload before asserting
   rollback. Fixed delivery counts are never convergence proof. After a successful accepted receive, the reply to its
   connected source and the changed-content fan-out use the existing per-peer queue, deferred only behind completed
   owner and persistence work, with scheduling and queued execution both fenced against stop or source disconnect.
   A stopped or disconnected runtime never revives a queue, while a live host still relays accepted content to its
   other connected peers.
