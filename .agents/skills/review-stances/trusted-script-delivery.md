# Standing probes: trusted scripts, delivery and shared Git publication

Defects where a trusted script or delivery route is exercised through a substitute path, validated on a tree other
than the one that merges, or publishes source refs, rewritten history or pull-request
metadata it does not own: a stale local copy replaces newer remote work, a hook runs under the publisher's token,
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
   command from the fenced set, or restoring a direct package route to the transaction script, must fail
   `scripts/__tests__/trustedGithubWriteBootstrap.spec.ts` or `scripts/__tests__/supersedePullRequest.spec.ts`
   before any remote port call; lock fixtures that inject owner fences cannot show it.
2. **Validated tree vs merged tree (#5243).** Runs: CI; the reviewer reads the Types and contracts job on the
   head. When the base tip moved after the head's last run, especially in the same file, require evidence covering
   base plus head: the job's checked-out merge commit must contain the current base tip, and reverting either
   contributing hunk must fail that combined typecheck.
3. **Source publication and delivery ignore retired metadata and tools.** Use real bare remotes with
   absent, divergent and unreadable local authorship notes, and make metadata inspection unavailable.
   The actual publication adapter must push exactly the captured source commit without forcing; the
   delivery adapter must fetch and prune every origin head through both authenticated routes. Neither
   may read, rewrite, preserve, fetch or push notes, and existing local and remote metadata must remain
   untouched. Restoring notes inspection or a metadata refspec must fail the corresponding cases in
   `scripts/__tests__/publishLane.spec.ts` and `scripts/__tests__/deliverPullRequest.spec.ts`. The trusted
   launcher must neither discover GitAI nor carry its pin or directory into the child environment;
   restoring the binding must fail `scripts/__tests__/agentDeliveryScripts.spec.ts`.
4. **A token-bearing publisher isolates hooks (#5709).** Seed a lane-controlled `pre-push` or
   `reference-transaction` hook that emits a harmless marker when the fixture token is present.
   Publication must create no marker while the exact source commit arrives, and must not mutate local
   metadata refs. Removing the hook override must fail the `scripts/__tests__/publishLane.spec.ts`
   case. A rejected or non-fast-forward source push remains fatal; swallowing it must fail the
   required-source cases.
5. **Publication metadata derives from the lane's own commits (#2746, #4252, #5701).** A synchronized child can
   inherit its parent's commit title: a squash-landed parent leaves its original commits reachable from the child
   but absent from main, so pinning only a main-only range is insufficient. Exclude every commit reached by resolved main and parent heads when deriving a
   title. Use real Git history with a child commit followed by a later-dated parent repair, then synchronize the
   parent and its squash landing into the child: the native creation title names the child, and removing the
   parent-head exclusion makes `scripts/__tests__/publishLane.spec.ts` select the parent repair and fail. Explicit title changes pass the
   same owned-lane boundary and drive body validation, derived labels and projects, and type warnings from the
   title GitHub will show; observe the actual authenticated edit arguments for an explicit correction and the
   absence of a title argument on a default republish.
6. **Prepared and live review patches must preserve the same complete bytes.** The 64 MiB capture
   bound introduced by #2591 (`5cfdc662e38e`) admitted a 4 MiB ASCII child test but refused a larger
   combined source diff; the UTF-8 string capture also replaced non-UTF-8 source bytes. Historical
   reviewer tier and prompt are unknown. Trace both prepare and fresh publication through the same
   hook-safe capture boundary. Exercise real child stdout/stderr limits and a real Git patch containing
   non-UTF-8 bytes through bundle installation and live comparison. Alter one invalid byte to another
   with the same decoded text: publication must refuse the raw mismatch. Removing either full-diff
   allowance, restoring UTF-8 storage, or comparing decoded text must fail the corresponding cases in
   `githubAppIdentity.spec.ts`, `prepareReview.spec.ts`, and `reviewApprovalContext.spec.ts`.
