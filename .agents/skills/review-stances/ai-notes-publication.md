# Shared authorship notes during publication

AI authorship notes are a shared history with independent writers. A source publication must retain
its exact reviewed commit and normal non-forced admission. Publish optional notes separately using a
captured object ID and a non-forced fixed destination; a stale local map must never replace newer
remote notes. Retain captured local history under a durable ref before upload, because delivery may
refresh the default local notes ref. Refusal of optional notes must warn with that recovery ref and a
non-forced reconciliation instruction. A source push failure must still fail publication.

Use two real Git writers and a bare remote. Start from shared notes, independently add different notes,
and exercise the actual authenticated push adapter. Prove the remote peer history and note blobs stay
intact, the exact source commit arrives, and deferred local notes survive a later refresh of the default
notes ref. Also advance the peer immediately before the notes push, and cover absent local notes,
absent remote notes, a normal fast-forward, and a refused source push. A single-writer successful-upload
fixture does not observe lost peer data. Restoring the forced notes refspec must fail the preservation
spec; swallowing a source rejection must fail the required-source spec.

The token-bearing publisher must also isolate hooks for local ref mutations. `update-ref` can run
`reference-transaction` from a lane-controlled hooks directory even when both pushes disable hooks.
Seed real local notes before activating that hook, make it emit only a harmless marker when the fixture
token is present, and prove publication does not create the marker while the exact source, notes, and
pending ref still arrive. Removing the update-ref hook override must fail this case. PR #5709's first
repair added the durable pin without carrying the existing push hook boundary to that new mutation;
independent review caught the escape before merge.

Escape: [#4271](https://github.com/jcosta33/sourdaw/pull/4271), commit
`c5bfeda9bfeb68c934479536f3103221a853d940`, introduced the forced
`+refs/notes/ai:refs/notes/ai` publication alongside a single-writer fixture. A later native title-only
republish replaced a divergent remote notes history with its stale local map. The missing stance was
concurrent-writer provenance preservation, including preservation across a later local ref refresh.
Historical reviewer model, tier, and stance are unknown from the available evidence.
