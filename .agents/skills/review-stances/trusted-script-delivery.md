# Standing probes: trusted scripts, delivery and shared Git publication

Defects where a trusted script or delivery route is exercised through a substitute path, validated on a tree other
than the one that merges, or publishes shared Git state (authorship notes, rewritten history, pull-request
metadata) it does not own: a stale local copy replaces newer remote work, a hook runs under the publisher's token,
or inherited history names the lane's work. Split out of `correctness.md`; a stance matching this class carries
this file instead of it. Each probe names the failure mode, the input, state or mutation to run, and the check that
must go red. Use disposable bare remotes and isolated operator configuration, hooks and network. Report the
concrete break or none.

## Standing probes

1. **A new capability must reach the trusted launcher with default dependencies (#5639).** Supersession added a
   process-fenced owner without routing its package command through the trusted write bootstrap; injected-fence
   lock tests passed while the real command had no trusted `ps` pin and refused before PR I/O. Trace the
   capability from the package command through the protected launcher to its consumer: the command registry,
   static source closure, risk-classification union and fenced-command set must cover the actual package route.
   Run it with controlled remote ports and the default owner fence, driving the default process-fence consumer
   with a launcher-resolved POSIX `ps`, and observe the acquired process identity before the first PR read;
   verify Windows PowerShell selection independently. Inherited forged pins must not survive snapshot
   isolation, and a missing platform tool refuses rather than falling back to ambient execution. Omitting the
   command from the fenced set, or restoring a direct package route to the transaction script, must fail before
   any remote port call; lock fixtures that inject owner fences cannot show it.
2. **Validated tree vs merged tree (#5243).** When the base tip moved after the head's last run, especially in
   the same file, require evidence covering base plus head; reverting either contributing hunk must fail that
   combined typecheck.
3. **A forced notes fetch must not drop a divergent local notes history (#4271).** A forced fetch can replace a
   local notes history that is not an ancestor of the remote; a local preimage was later absent from the
   refreshed notes. With a disposable bare remote holding independent local and remote notes histories, check
   reachability of the exact observed local commit and its unique note blob after the actual fetch, not the
   refspec or the later non-forced push. Probe refusal before fetch when inspection or create-only recovery
   pinning fails. A recovery ref preserves an observation, not concurrent writers or a union.
4. **Optional notes publication preserves concurrent writers (#4271 `c5bfeda9bf`).** The forced
   `+refs/notes/ai:refs/notes/ai` publication, tested only by a single-writer fixture, let a later title-only
   republish replace divergent remote notes with its stale local map. Publish the exact reviewed source commit
   with normal non-forced admission, then notes separately from a captured object ID to a non-forced fixed
   destination, after pinning captured local history under a durable ref (delivery may refresh the default
   notes ref). Use two real Git writers and a bare remote: start from shared notes, add different notes on
   each, and drive the actual authenticated push adapter; the remote peer history and note blobs stay intact,
   the exact source commit arrives, and deferred local notes survive a later refresh. Also advance the peer
   immediately before the notes push and cover absent local notes, absent remote notes, a normal fast-forward
   and a refused source push. Refused notes warn with the recovery ref and a non-forced reconciliation
   instruction; a source push failure still fails publication. Restoring the forced refspec must fail the
   preservation spec; swallowing a source rejection must fail the required-source spec.
5. **A token-bearing publisher isolates hooks on local ref mutations (#5709, pre-merge).** `update-ref` can run
   `reference-transaction` from a lane-controlled hooks directory even when both pushes disable hooks; the first
   durable-pin repair did not carry the push hook boundary to that new mutation. Seed real local notes before
   activating that hook, make it emit only a harmless marker when the fixture token is present, and prove
   publication creates no marker while the exact source, notes and pending ref still arrive. Removing the
   update-ref hook override must fail the case.
6. **The post-merge rewrite destination is the landed squash's sole parent (#4271, #5711).** #4271 forwarded the
   cached PR base into authorship rewriting; with unrelated commits on main before a three-commit feature squash,
   git-ai 1.7.5 could classify the squash as a rebase and select unrelated main commits, and the delivery test
   asserted the forwarding without building the graph that makes it wrong. Read the boundary from immutable
   commit headers after fetching; neither the cached PR base nor a later main tip proves it. Exercise the actual
   delivery shell adapter over a real Git graph with three source commits, unrelated annotated main commits and
   main advanced both before and after the squash: the emitted destination equals the raw landed commit's sole
   parent, and restoring cached-base forwarding must fail. Unavailable, zero, multiple and malformed parents
   skip the optional rewrite and notes upload, observably, before any rewrite or notes push. An adapter test
   proves argument selection only: exercise the installed tool in a hermetic repository for squash
   classification, the full source-note union on the squash and byte-identical unrelated note blobs.
7. **Publication metadata derives from the lane's own commits (#5701; context from #4252).** After synchronization
   #5701 inherited its parent's `fix(review): pass resolver fixture paths as process data` title: a squash-landed
   parent leaves its original commits reachable from the child but absent from main (#2746 only pinned an
   existing main-only range). Exclude every commit reached by resolved main and parent heads when deriving a
   title. Use real Git history with a child commit followed by a later-dated parent repair, then synchronize the
   parent and its squash landing into the child: the native creation title names the child, and removing the
   parent-head exclusion makes the same spec select the parent repair and fail. Explicit title changes pass the
   same owned-lane boundary and drive body validation, derived labels and projects, and type warnings from the
   title GitHub will show; observe the actual authenticated edit arguments for an explicit correction and the
   absence of a title argument on a default republish.
