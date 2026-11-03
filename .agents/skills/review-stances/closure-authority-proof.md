# Standing probes: destructive closure on an unbound or moved observation

Use this file for a stance that attacks whether a destructive closure (closing a superseded pull request,
admitting a historical stack, removing a merged lane) rests on a complete observation bound to the right
identity, head and revision, rather than on a present-tense ref match, a split read, a missing field, or a Git
pathname whose framing or components were reinterpreted before the deletion decision. Each
probe names the failure, the input, and the check that must go red. The supersession probes are controlled
native-adapter or source reproductions, not claims of live or `main` occurrence; they bound client composition,
not later remote changes or a server-side compare-and-swap. Historical reviewer prompts and tiers are
unestablished unless a probe says otherwise.

## Standing probes

1. **Cleanup must prove release and survive removal refusal (lane removal #1802 `4404e50fdc`, cwd-only activity
   inspection `2a13a418e1`).** A process outside the lane could hold a lane file open without blocking
   deletion; a refused native removal after unlock lost the original author lock; a manual-only exit left merged
   worktrees behind when delivery or its caller stopped before removal. Probe native removal with a spawned
   process whose cwd is elsewhere but whose descriptor holds a lane file; incomplete or denied lsof catalogs and
   omitted live same-user PIDs must retain the lane. Inject a native removal refusal after unlock and require the
   original author lock restored. Kill the worker after durable queue publication and require a later process to
   reclaim only after fresh merged-head proof. Race a second worker, move HEAD, reuse the same directory path,
   and tamper with the installed runtime and manifest; stale authority or unverifiable bytes must never delete
   work.
2. **Merge state alone does not prove the work reached `main`.** An exact PR head merged into an open stack
   parent is still unlanded. Require a live `main` base and valid merge timestamp for author and review heads,
   and for the merged replacement of a closed superseded lane; missing metadata stays unproven and a missing
   `merged_at` never maps to merged. Probe non-main and unknown bases, missing or malformed timestamps,
   open-state/timestamp contradictions, and a base transition between the two ownership reads. Preserve valid
   `main` merges and closed stack lanes whose truthful replacement landed on `main`. The pre-publication
   integration probe exposed this gap before automatic cleanup shipped.
3. **A current branch ref substituted an unrelated historical parent (#5615 `8d1d45758b`; reproduced on #5627's
   distinct-replacement path).** #5615 bound the child's current base ref to the named parent's final head but
   never established the parent belonged to the old child's history; the older same-replacement gap is
   source-established, base-head execution was not performed. The old child's original parent work was absent
   from the merged replacement, yet a reused parent ref plus genuine replacement ancestry still permitted
   closure, and two unbound child markers permitted deleted-ref replay through the wrong parent. Use a real
   content-bearing Git DAG with unrelated parents sharing a base. Require final-parent containment or previously
   registered native fork provenance, and reject cached or common ancestry alone. Keep a genuine late-parent
   control whose final head is absent from the old child. Preserve the exact admitted binding in an authorized
   canonical marker; delete local metadata and the ref before replay, then substitute another parent or a
   malformed or missing binding and require zero writes. Never reconstruct missing provenance from reviews,
   workflow associations or prose.
4. **Dependency authority changed during its final thread response (#5615, carried into #5627).** The parent core
   was read before separate marker and thread requests. Controlled native-adapter cases at the reviewed head
   reopened the parent during its last thread response while head, branch and child ref stayed unchanged;
   post-close verification and CLOSED replay still reported success. The missed risk was movement inside each
   dependency authority's composed proof, beyond the child-only final witness. For every proof subject, mutate
   its core during its last dependent response; drive the actual shell adapters and the serialized transaction at
   pre-write, mid-proof, post-close and replay boundaries. Require an independent current core for the parent
   and both replacements after all dependent reads, then the existing final child witness. Preserve compensation
   before close and retained owner and markers after uncertain closure.
5. **Split PR metadata could close a head that arrived during comment reads (#2357 `1f249ee008`, extracted by
   #4420 `789351350a` into `supersedePullRequestGh.ts`; #5413 is not the introduction).** Core metadata was read
   before a separate comment request, then closed by node ID alone. A production-adapter probe moved the head
   during the final comment response and observed CLOSE before the command refused. Drive the real inspection
   and close adapters together, move the head between core and comment responses, and require refusal before
   CLOSE. Observe an independent, bound core response after all composite marker and review reads, directly
   before mutation; malformed or wrongly bound witnesses must refuse too. Finish post-close and CLOSED replay
   proof with the same witness. Preserve a stable control and ambiguous-close evidence.
   `ClosePullRequestInput` carries no expected-head CAS.
6. **An acknowledged marker vanished from reads and released its owner (#5639 `256933a3bf`).** An acknowledged
   comment ID omitted from later inspections received no delete, yet an apparently original OPEN comment set
   certified rollback and released ownership. The final review included a strongest-tier
   ambiguous-write/altered-rollback stance; the acknowledged-write, omitted-read input was missed. Keep a real
   marker after a valid creation receipt while every later inspection omits its ID; drive both serialized
   retirement and supersession and require zero unverified deletes, the real journaled owner retained, and its
   exact native recovery command. Pair with observed exact deletion and verified OPEN rollback release. A
   missing read cannot discharge a known remote write. After shared-owner recovery on stable OPEN or CLOSED
   state, require guidance to rerun the original operation with its original bound inputs; clearing a shared
   owner does not select delivery or authorize a merge.
7. **Authoritative fields must survive from the native parser to the final equality witness (#5627).** The new
   historical-parent observation cut exposed an inherited omission of the child's live `baseRef`; cached
   `baseRefOid` did not bind its name, repository, target or presence. Change each ref field, remove it, or
   recreate it after an admitted cleanup while returning the final parent marker response. Require the actual
   final child core to observe and refuse the change before closure or replay success, retaining owner and
   markers after an attempted close. An inspected null ref is bound absence; an internal core-only projection
   omitting the field is not an observed absence. Keep stable present-ref and cleanup-replay controls, and
   reject an explicitly owned undefined expectation. A selected native response field must exist: omitted or
   undefined `baseRef` is unavailable evidence, never the explicit null that admits cleanup. Probe native parser
   admission and CLOSED replay with a moved underlying ref but the selected key omitted; require no writes or
   success.
8. **Selected native fields stay separate from optional internal projections (#5627).** The cached `baseRefOid`
   reader accepted an omitted selected nonnull SHA; the undefined skipped cached ancestry and became null in a
   fresh historical binding. The native-adapter reproduction rejected a present divergent SHA but closed when
   only that wire key was omitted. Pair those inputs and require zero writes for both. Reject missing, null or
   malformed native cached SHAs before comment inspection, while preserving valid cached SHAs and explicit null
   live-ref cleanup on CLOSED replay. An absent live ref does not erase its cached commit, and deliberate
   non-native optional projections do not weaken the selected native response contract.
9. **Registered provenance binds the source identity its registration attests (#5627).** The protected-primary
   lane fallback attests same-repository children; branch spelling and a shared fork commit cannot authorize a
   foreign source. Preserve the observed child source in the canonical record and require the same identity on
   replay after descriptor and ref cleanup. A registered source becoming null or foreign refuses; a record
   missing that required field is not upgraded. Keep real-DAG and native-adapter controls for native
   registration and for fork children with actual final-parent containment; the latter must ignore an
   unrelated same-named local ledger, and a recorded null source is eligible only through that independent
   containment route and only while its observed identity still matches.
10. **Immutable identity must be selectable on the remote schema (#5705 `7f4299b2f4`).** The query selected
    `author { id }` from GitHub's Actor interface, which exposes no `id`; live GitHub rejected it before
    historical admission observed either author, while parser fixtures supplied IDs directly. The missed stance
    was remote identity availability across the actual query/parser boundary. Validate the native query against
    the remote schema, selecting immutable IDs only on supported concrete Node types. Pair real Bot and User
    responses with missing and unsupported author refusals; never substitute a mutable login or silently admit
    absent identity. Restoring direct `Actor.id` must fail the emitted-query regression and the read-only live
    query.
11. **Git pathnames that authorize deletion are NUL-framed and captured raw (#1802 `d3cfd6f01d`, #5655, #2954).**
    `lane:remove` split `git ls-files --ignored --directory` on lines; Git C-quotes a pathname containing a line
    feed, so the `.agents/` protection missed the quoted record while its `/dist/` component matched the generic
    disposable rule, and `lane:remove` and `lane:strand` admitted deletion (#2954 NUL-framed `lane:prune` but left
    the removal reader). The first #5655 repair added `-z` but both shell captures still called `stdout.trim()`,
    turning a first record `<line feed>dist/receipt.json` into the different, disposable `dist/receipt.json`.
    Read every deletion-authorizing Git pathname stream with `-z` through an explicit raw-stdout capture (non-path
    output keeps its trimming and error handling) and split on NUL before classification. In a real disposable
    Git fixture ignore `.agents/records<line feed>/dist/receipt.json` and a leading-line-feed ignored file (each
    beside a tracked or unignored sibling so Git reports the exact path), a tracked `dist/receipt.json` sentinel
    and an ordinary ignored `node_modules/` directory. Feed the actual ignored adapter to `removeLane` and
    `strandLane` with fake mutation ports: both refuse before unlock, worktree removal, receipt write or branch
    deletion, while `node_modules/` stays admitted; `lane:prune` selects only `node_modules/` and preserves the
    protected data and the sentinel. Replacing NUL framing with line splitting, or either reader with trimmed
    stdout, must fail the corresponding real-Git test.
12. **Git pathname components stay opaque (#5655).** The shared `disposableIgnored` classifier replaced each
    backslash with `/`, but Git's `-z` contract emits the pathname verbatim and a POSIX backslash is a filename
    character, so an ignored regular file literally named `node_modules\\receipt.json` passed the
    `node_modules/` component rule; removal and stranding admitted deletion and pruning deleted the leaf. Split
    only on the slash Git emits and never convert backslashes before applying disposable rules. Keep direct
    cases for backslash-only lookalikes and slash-delimited controls, plus a real Git fixture with the literal
    backslash leaf: removal and stranding refuse before mutation, and pruning preserves the file.
