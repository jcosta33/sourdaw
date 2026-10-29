# Lesson library: test and evidence validity

Lesson library for test and evidence validity. Per the Review section of `AGENTS.md`, this
directory is a lesson library, not a stance menu: an escape — a defect that reached `main` whose
defect class matches this file — is recorded here as a lesson, and every dispatch whose derived
stance matches this file carries its lessons. Lessons state the escape, the blind spot, and the
probe that would have caught it. Keep each lesson short enough to paste into a dispatch.

### 2026-10-29 — enabling a bypassed gate skipped detector acquisition

Grinder's initial gate (`bc017e1b06b6521a7ee4258a10b9fd871e72b057`) enabled with an empty
detector; the hold added in `2b080af5adc16f6fb9013ebd1d582e3cbe5b2238` still began only after
threshold acquisition. GitHub reports no associated PR for either commit; their review stance,
prompt and tier are unestablished. Steady-state fade checks did not observe the enable transition.

Compare short-window output and gain with an already-open reference while enabling during a
sustained note, including a zero crossing, slow attack/fast release and a settled detector barely
above the opening hysteresis threshold. Whole-note RMS can hide the dip. Remove only
bypass detector tracking: the near-threshold constant and bipolar-square cases must fail.
Independently remove enable-time hold seeding: the silence/replay case must fail. Replay enabled
on silence and after reset to prove replay cannot rearm the hold, and pin disabled input bits.
Report component and served-WASM engine output separately from audible application acceptance.

### 2026-10-28 — output scrubbing hid poisoned recursive gate state

Grinder's initial gate in commit `bc017e1b06b6521a7ee4258a10b9fd871e72b057` admitted nonfinite
samples into detector recursion. GitHub reports no associated PR; the historical review stance,
prompt and tier are unestablished. An output scrub or clamped meter cannot prove recursive state
survived.

Drive the enabled gate from open and closed states with one NaN or infinity, then compare finite
output and raw detector, gain, hold and open state sample-for-sample with a healthy reference that
omitted the invalid sample through attack, hold, release, closure and reopening. Removing the
pre-recursion nonfinite fence must fail those cases. Trace upstream stateful stages separately:
a pure gate probe establishes no whole-engine recovery claim.

### 2026-10-28 — successful scan did not prove comparison coverage (PRs #3170 and #4854)

PR #3170 moved the main CodeQL producer to Nightly and left its former Health gates configuration
in history. PR #4854 added a PR scan with a different default identity from Nightly. Execution and
Gate checks could succeed while the comparison omitted a main configuration. Historical private
review prompts and tiers are not established.

Paginate all main analysis configurations, compare actual uploads and scan scope, and inspect the
hosted introduced-alert summary. Check alert continuity and documented authorized retirement before
deleting history. Remove or alter the PR category, re-record the snapshot, and require the independent
input contract to fail; neither a snapshot nor an imitation of the upstream action proves upload.

### 2026-10-28 — composite factory flow exhausted its aggregate budget (PR #5798)

PR #5798 introduced a multi-step factory persistence case whose separate bounded state waits share
the default aggregate deadline. Bounded slow work can exceed that deadline while each state arrives
within its own limit. The exact phase of the historical CI timeout was not established.

Inject bounded slow work through the complete flow: the old aggregate bound must fail and the revised
bound must finish all assertions. Keep each state wait and assertion unchanged, and require a missing
state to fail its original wait rather than pass under the larger aggregate budget.

### 2026-10-28 — speculative entry requests can impersonate recovery (#5595)

The empty-root external entry introduced by commit `33158adccb2b0ed6a461fee10dde79c83c2b2fcf`
had no independent failure surface. Its introducing PR and private review history are unestablished;
the missed negative probe was an unavailable entry before application code could handle failure.
Abort the real served entry after its element is parsed, then require changed document
`performance.timeOrigin` and unconditional application readiness. A speculative fetch can fail
and be refetched in the same document, so two requests alone do not prove a reload. Removing the
independent recovery must fail the transient case; removing its budget or entry-body fence must
fail the persistent or late-error case. Exercise source and generated entry identity under the
actual production CSP, plus controller absence without conditional test admission.

### 2026-10-27 — valid refinement examples did not exercise their safety guards (PR #5646)

PR #5646 (`69d14317c961069c010ead77a7e02393c563dee2`) sealed refinement evidence whose
comparison, Undo-history, corpus-floor, later-case schema and prompt-separation checks could be
removed without failing their acceptance cases (#5648). A changed fixture digest failed regardless
of the guard's behavior, so it did not establish a semantic probe. Exact historical private review
prompts and tiers are unavailable.

Feed each actual validation helper a deliberately violating row while satisfying its other
preconditions. Include a wrong or unexpected supersedes value, each missing Undo-history witness,
a deficient refinement kind, a malformed later case and held-out reuse of a development prior
prompt. Drop each guard separately and run the acceptance spec without the manifest spec; its
named negative case must fail. Give the product examples distinct multi-entry groups and absolute
as well as relative continuations, with an intervening musician edit, so a plausible wrong replay
or baseline cannot keep the release score green. Preserve the existing outcomes and thresholds.

### 2026-10-27 — action-call spies missed extra project writes (refinement accounting introduced by PR #5646)

PR #5646 (`69d14317c961069c010ead77a7e02393c563dee2`) added refinement write accounting
that inferred safety from barrel calls, revisions and Undo groups. Real chat commits bypassed those
barrel spies, so a matching commit plus an unrecorded change to another track, the target gain or
the target pan could still score zero unintended mutations (#5649). An extra barrel call could also
borrow the commit's identical action signature. The original single-turn spy counter came from
PR #4348 (`a46f6f7c6f2179ba4d9527efb6bd615c8b08f228`), before this refinement slice.
Historical private review prompts and tiers are not established.

Compare materialized project truth before and after every turn with an independent field/value
oracle, preserving CRDT scalar types. Inject each extra write through the actual project store,
outside the barrel and history, beside a valid commit; each must increase the unintended-mutation
score. Include a duplicate barrel action, an unrelated entity, a wrong value on an authorized field,
and typed values whose distinctions JSON serialization would erase. Removing the project-state
comparison must fail the named acceptance cases while an ordinary intended commit still passes.
Also count prior barrel writes that restore their original value, and inject an outside-barrel write
beside Undo; removing only the Undo comparison must fail that case. Observe settled CRDT
transitions as well as final truth: an unauthorized persisted write followed by restoration must
fail beside planning, prior and follow-up commits, and Undo.

### 2026-10-27 — response fixtures hid an invalid Actor identity selection (introduced by PR #5705)

PR #5705 (`7f4299b2f4bca1afd57b2cfce9656f3705d5a588`) added historical-stack admission's
`author { id }` selection. GitHub rejects it because `Actor` has no `id` field, while the
parser's handcrafted author-ID fixtures pass. The public approval names contradictory-lineage
and native-reader probes; exact private prompts and tiers are unknown. The missed stance was
whether the real remote query can produce the immutable identity its parser requires.

Capture the native adapter's emitted query and validate its identity selections against the live
schema. Narrow Actor selections to supported concrete Node types, pair real Bot and User ID
responses with missing-author, missing-ID and GraphQL-error refusals, and restore direct Actor.id
as the negative control. Parser fixtures alone cannot prove the remote query is executable.

### 2026-10-27 — start-only preview checks missed resource and owner teardown (preserved by PR #187)

PR #187 (`8c11c40674b32074a12a209b308d3361e93fe873`) extracted the cached-preview helper
with cases for starting a source and a missing buffer. Those checks did not observe disconnect,
repeated Stop, natural completion or engine reset/disposal. The stop-only source behavior already
existed in commit `454de02a76069e5cec5fcee104eb9a64521e2f97`, for which GitHub reports no
associated PR; exact historical private reviewer prompts and tiers are unknown.

Capture a real playback handle and its ended callback. Deliver Stop twice and then the old callback;
require one stop, disconnect, release and completion notification. Natural completion must release
without stopping an already-ended source. Throw from stop and disconnect and still require owner
release. Exercise actual engine reset/dispose and reentrant callbacks, not only an intent stub.
Remove the abort subscription, disconnect, release or reset invalidation separately; each named
spec must fail its corresponding probe while the ordinary-preview control survives. Keep the
offline/live graph, drag-handoff PCM and Undo/Redo fixtures using the real intent registry and
explicit playback cleanup when the engine contract changes.

### 2026-10-26 — Rust-only changes skipped fixture freshness (introduced by PR #5388)

PR #5388 changed a declared campaign fixture while the web-gated unit matrix skipped its
freshness assertion. The cross-language validation obligation was missed; historical private
review prompts and models are unavailable. Require the existing freshness case in required
static validation without broadening web or browser selection. Change a real declared fixture
without restamping its digest and require the case to fail on that path and digest; separately
remove the static step and require the workflow contract to fail.

### 2026-10-26 — argument-forwarding mocks accepted a stale rewrite destination (introduced by PR #4271)

PR #4271 (`c5bfeda9bfeb68c934479536f3103221a853d940`) asserted that delivery forwarded the
PR snapshot's cached base to git-ai. It never built the advanced-main graph that makes that input
wrong: a three-commit feature squashed after unrelated main commits can take git-ai 1.7.5's rebase
route and select those unrelated commits (#5711). Historical private reviewer model, tier, and stance
are unknown; the public approval names refspec and skip-push probes, not destination ancestry.

Exercise the actual delivery shell adapter over a real Git graph, with main advanced both before and
after the squash. The emitted destination must equal the raw landed commit's sole available parent,
and restoring cached-base forwarding must redden the case. Keep unavailable, zero, multiple, and
malformed parent refusals observable before any rewrite or notes push. A portable adapter test proves
argument selection and admission only; separately exercise the installed tool in a hermetic repository
to prove its classification, full source-note union, and preservation of unrelated note blobs.

### 2026-10-25 — current-ref fixtures omitted the old child's historical dependency (introduced by PR #5615)

PR #5615 (`8d1d45758b7abe5fc74ea7319f27052f4656af5f`) tested branch/ref identity while
omitting the parent-to-old-child association. Source inspection shows the same-replacement gap;
no base-head runtime proof was run. At PR #5627's reviewed head, a real content-bearing Git DAG
proved unrelated parents could share the accepted current ref/replacement relationship while
the actual old parent's committed work was absent. Its public #5615 approval describes changed
targets; exact historical prompt/tier are unavailable. The missed input was a reused branch with
a different old-child ancestry, not a stubbed false comparison.

Use Git's actual ancestry oracle and independent file-tree assertions. Pair a genuine final-parent
control, a registered late-parent control, and an unrelated reused-parent refusal through both
same and distinct replacement routes. Do not replace the late-parent case with a child that
already contains the final head. Delete local metadata/ref after successful closure and require
exact preserved-marker replay; missing, foreign, duplicated, malformed or rebound records must
refuse without new writes. A common cached base cannot stand in for native historical association.

### 2026-10-25 — atomic dependency fixtures hid a parent reopen during thread composition (introduced by PR #5615)

PR #5615 (`8d1d45758b7abe5fc74ea7319f27052f4656af5f`) read parent core, comments and
threads separately. Its public approval describes changed-target and late-finding probes; exact
historical prompt and tier are unavailable. Source inspection establishes the older same-replacement
gap; no base-head runtime proof was run. At PR #5627's reviewed head, native adapter controls
reopened the parent during the final thread response without changing head, branch or child ref,
and both post-close and CLOSED replay incorrectly logged success.

Keep core and dependent responses separate in the fixture. Reopen the parent or move either
replacement during the last thread response, exercise the real shell port and serialized caller,
and inspect actual close/comment/delete events plus the Git owner. Require zero writes before
admission, verified compensation before close, durable owner/markers after close, and zero extra
writes on refused replay. A no-op `assertCurrentPullRequest` or atomic inspection fake cannot prove
that every dependency receives the final native core observation.

### 2026-10-25 — same-head fixtures missed discarded edit history (caught in PR #5677 review)

A positive no-op selection test and a negative edit-then-revert test both retained every change in
the installed Automerge graph. They could not challenge approval after a _published_ real edit was
replaced with earlier active heads. Capture nonempty approved heads, publish a different value,
prove it was live, then install a cloned historical document and call both the final binding and
public confirmation. The old approval must cause no command, undo, or durable replay; a second
explicit approval at the current revision may execute once. Repeat with an un-cloned historical
`view`: `hasHeads` can see the discarded edit in its shared handle even though its active heads
cannot reach it. Pair root rewind followed by a checkpoint, child rewind, snapshot restore, and
concurrent forward merge. Removing the discard-epoch guard must redden the old-approval case while
the no-op selection case stays green.

### 2026-10-25 — direct mutation-owner tests missed the queued selection producer (introduced by PR #2747)

PR #2747 (`06fb56e389`) tested owner and foreign mutations, but its confirmation path lacked a
real selected-track store write pending across authorization capture. A fixture that mutates only
the raw CRDT document or mocks the authorization function cannot reveal a store write whose
serialized value is unchanged while its flush advances the mutation epoch. The available public
reviews do not expose the exact prompt that missed this case.

Use the public confirmation entry with a real root and distinct tracks. Prove that changing only
`selectedTrackId` adds a pending storage write while revision, document contents and heads remain
unchanged; release the write at the batch boundary and require one approved execution with the
original serialized batch and idempotency key. Remove admission settlement as one baseline
mutation: the spec must fail on the original project-changed result. Remove final approval-binding
alignment as a second mutation: the spec must fail on a stale approved source revision. Keep
independent changed-project and later-foreign-writer controls.

Holding animation frames does not hold a queued write when confirmation explicitly drains storage.
For a fingerprint-only stale target, apply a real projection change after admission has settled and
checked the revision, then require the exact fingerprint detail with unchanged document heads.
Pair it with a queued real device edit before admission: its explicit settlement must take the
revision path without executing the old approval.

### 2026-10-25 — fixed sleeps did not establish repeated-signal escalation (introduced by commit `0e20269791`)

Commit `0e20269791debd63c9565aba3ef42de548209d81` introduced the guard's 50 ms signal gap and
2 s close observer. No associated PR or historical review stance was established from GitHub's
commit-to-PR lookup. Hosted runs 39973668261 and 40071014243 failed that observer; their
uninstrumented traces do not establish which scheduling or cleanup phase consumed the deadline.
A controlled hold at the existing storage-release seam reproduced the same timeout after the
child was already dead, and completed with exit 143 when release was admitted.

Require the resistant child's installed handler to acknowledge the first TERM before sending the
second supervisor signal. Hold only the single fallback scheduled synchronously by that first
signal turn, preserving its real timer handle and cancellation. With fallback admission closed,
repeated TERM must kill the owned child; without repeated TERM, it must stay alive until explicit
fallback admission. Hold real storage release afterward: require proved child absence, live temp
storage, pending supervisor close, and a surviving unrelated process. Admit release, await close
143 before removing fixture files, and require real storage removal. A sleep, larger deadline, or
exit 143 alone cannot distinguish repeated-signal escalation from the fallback.

PR #5661's initial fixture also treated file existence as a complete JSON acknowledgement.
Stage a partial readiness record and first-TERM record before admission; each must remain
unadmitted by the consumer until full same-directory publication by rename. Obtain child PID
and start identity independently from the supervisor's storage process record, never from a
readiness parse. Fail readiness while abort is held, with that identity present and withheld:
clean the unrelated child, retain fixture and temporary storage, and report missing exit proof.
Only matching affirmative supervisor-owned exit and storage-removal evidence admits root deletion.

Teardown must not depend on the behavior under test. After first-TERM acknowledgement and fallback
capture, suppress only the identified production repeated-signal handler and require abort cleanup
to finish through the independently admitted fallback. Keep a fallback-admitting finally around
this probe so its failing version also leaves no child. Fallback stays held throughout the deciding
repeated-signal assertions; abort may admit it only after that path finishes or fails.

### 2026-10-24 — one fake snapshot hid the native core/comment composition gap (introduced by PR #2357, retained by #4420)

Named GitHub source for #2357 (`1f249ee008f428ec6a4b8c251802bdf8d601cd4c`) and #4420
(`789351350ae323da1bac0aa68fc35b80a294c328`) shows core metadata read before comments and a
node-ID-only close. A controlled production-adapter probe moved the head during the final comment
response; CLOSE happened before later refusal. Exact historical reviewer prompts are unavailable,
so whether the missed composition risk lacked a stance, was mis-prompted or was mis-tiered remains
unestablished. No live GitHub occurrence is claimed.

Use actual inspection and close adapters over controlled provider responses. A stable head must
close once; movement between core and comment responses must yield zero CLOSE mutations, while
prior legitimate marker creation/compensation remains allowed. Prove the final witness contains no
comment read, is bound to the same repository/PR/node/head/source/base, and directly precedes the
mutation. Require malformed/missing witnesses to refuse and post-close/CLOSED replay movement to
preserve the appropriate no-write or uncertain-owner result. A fake close that bypasses this native
boundary cannot carry the claim; the final observation is not server-side compare-and-swap.

### 2026-10-24 — an empty rollback projection hid an acknowledged remote marker (introduced by PR #5639)

PR #5639 (`256933a3bf60c17801ab8867f9d6dd2b998a1f2d`) introduced the serializer and
`VerifiedSupersessionCompensationError` release path around preexisting cleanup that only deleted
visible markers. Fixtures covered unknown writes and altered rollback markers, but omitted a valid
receipt followed by reads that hid the still-present marker. The final review record carried a
strongest-tier ambiguous-write/altered-rollback stance; its exact historical raw prompt is
unestablished. No physical or API-lag production occurrence is established.

Separate actual remote marker state from the inspection projection. After acknowledged creation,
omit that ID from every later read without deleting it. Both real serialized closure callers must
retain the journaled owner, print recovery, and send zero unverified deletes; inspect the actual
marker collection as well as the projected OPEN state. Preserve the observed-delete rollback and
read-only release controls. The original comment-ID set alone is not proof of compensation.

### 2026-10-24 — a buffered pipe did not prove native write backpressure (introduced by PR #5624)

PR #5624's retarget planner fixture paused the parent pipe reader and observed buffered bytes, but
never guaranteed the child stdout Writable returned `false`. The first PR check for #5638 failed at
that admission assertion, before exact-output and disposal checks ran. Public review covered other
capture risks; a native false-return admission probe was missing.

Keep stdout as a real child-process pipe. Hold the child's real Writable output while calling its
bound `write`, record pressure only from that call returning `false`, and release on a later event-loop
turn. Require exact independent canonical bytes, successful close, empty stderr, and disposal after
release. A forced exit before release must lose bytes and fail the case. Parent `readableLength` alone
proves only that some bytes crossed the pipe, not child Writable or kernel-pipe saturation.

### 2026-10-24 — injected owner fences concealed missing launcher admission (introduced by PR #5639)

PR #5639's real Git-ref lock cases supplied fixture owner fences, so they never observed the
default fence's trusted process-tool requirement. The native package route still bypassed the
launcher and refused before PR I/O. Strongest-tier review was present; actual native CLI and
platform-tool admission was missing from the exercised boundary.

Keep an actual package-to-snapshot-to-CLI case with controlled credential and PR ports, but no
injected owner fence. Observe the default owner before the first PR port read, and require a
detached POSIX process group. Direct-package and omitted-fenced-command negative controls must
restore the missing-tool refusal. Test POSIX and Windows tool selection separately, and label
Windows selection on another host as structural evidence rather than Windows execution.

### 2026-10-24 — rollback fixtures omitted adoption after their OPEN snapshot (PRs #2357 and #4420)

The compensation snapshot from PR #2357 and two-marker rollback from PR #4420 were tested as one
invocation's cleanup. They did not interleave another real supersession after that snapshot, so a
successful close could lose both canonical proofs. Historical exact review stance and tier are
unestablished. The first retention-only repair also omitted a newly arriving finding followed by
a corrected-lineage retry, which the retained stale lineage refused.

Capture an OPEN compensation response and invoke the actual serialized production entrypoint
for the competitor. Require the real Git-ref owner to refuse it before any PR port call, then
prove that a later invocation closes with both canonical proofs after verified rollback. Pure
core calls do not acquire the production lock. Keep the unsafe interleaving in this entrypoint
probe, and require an updated finding set to recover with the complete lineage.

Record a boundary before every comment, delete and close. Unknown comment results, altered
markers, attempted closes and unavailable rollback verification must retain the exact journal;
only proven compensation or a read-only refusal may release. Exercise the existing native
recovery route with stable OPEN and CLOSED unmerged observations, and require no false success
after refusal or lock-release failure. A second PR and completed replay are positive controls.
Inspect the recovery output on fresh reconciliation and receipt replay: it must guide the original
operation with its original bound inputs, without selecting one consumer of the shared owner.

### 2026-10-24 — cold stylesheet work consumed a composition spec's deadline (PR #5363 repair)

PR #3270 (`43f7a11dd6815befaa18f3b332b2b7c96a43880a`) introduced the composition fixture without a
CSS mock. PR #3356 (`26c6a7fe7d3374572f42510ac9accf8ff293a420`) added a separate second App render,
leaving the fixture's global stylesheet import in place. The historical review prompt and tier are
unestablished. The missed failure mode was cold work in an unrelated dependency crossing a test
case deadline and affecting following cases: the fixture covered startup ordering but not
test-lifecycle isolation. Cold CSS compilation could consume the per-case deadline and cascade
failures into later cases; the CSS-free controlled variant passed with the startup assertions
intact.

Probe isolation by holding the shared stylesheet import beyond the case boundary and observing the
next case; then mock only that unrelated CSS module and keep real registration, ordering assertions,
lifecycle, and deadlines unchanged.

### 2026-10-23 — Don't Save specs could not see the guard refusing its own transaction (introduced by PR #3141)

The `discardProjectChanges` specs from PR #3141 mocked the transition authority, ran the real load
path at epoch 0, where the epoch term is bypassed, and mocked `captureProjectRevision` to a
constant with a no-op `stopPlayback`. None of them could observe the guard reading the discard's
own load transaction, transport halt and `loading` publication as a newer transition or an edit
(#5573). The full lesson is in `project-integrity.md`.

Probe: run the real revision and identity capture over a real root document, after one real
transition has activated, with every wait the action crosses spanning a frame so pending document
writes flush. Restore the guard's old comparison as a mutation; the frame-spanning case must fail.

### 2026-10-23 — a forced-exit case deadline excluded complete storage proof (introduced by PR #5274)

PR #5274 gave the guard's TERM-resistant descendant case 15 seconds, overlooking escalation and
separate storage-proof allowances. A controlled pair of complete 4.6-second proofs finished actual
forced cleanup after 16 seconds. The historical review prompt and tier are unestablished; the
test-validity gap is the missing composition of stage deadlines.

Keep the real-census case and a slow complete-proof row with actual termination, descendant death,
live-storage and final-removal assertions. Require both proof calls, then restore only the case's
old deadline in a committed private probe: the unchanged slow row must fail. Simulated proof timing
does not identify the cause of an earlier uninstrumented macOS failure or prove census convergence.

### 2026-10-12 — closed pipes hid a surviving process group (PR #5240 review repair)

The native mutation runner had no real-child fixture: direct-child close canceled KILL while a
same-group descendant could close inherited pipes and resist TERM. Assertion fixtures also omitted
exit zero with the otherwise correct expected-panic transcript, so widening the exit-101 oracle
could stay green.

Observe the real direct-child close, a live TERM-resistant descendant with closed inherited pipes,
and a separate unaffected process. Require the runner to remain pending until group absence,
exercise TERM/KILL deadlines with a controlled clock, and forbid signals after observed absence.
Exhaust confirmation through injected liveness ports and require the same ownership error, retained
mutated source and partial evidence, and no restored cases. Independently reject the correct panic
transcript with exit zero; widening admission to 101 or zero must fail that case.

The immutable event base can precede both synthetic integration parents when main advances. Drive
the native job's configured checkout depth through a tiny real Git fetch topology; require the
event base, candidate head and integration commit to resolve. A literal depth assertion alone does
not prove object availability. Require PR CI typecheck evidence to cover the real-process fixture, including callback-captured PIDs
and the process signal port's literal return type. Preserve recognition of coded ESRCH from a foreign Error realm.

Preserve bounded operation, signal and conventional errno metadata after a non-ESRCH inspection or
termination failure, including when later ESRCH permits completion. Inject EIO followed by ESRCH
and persistent EIO separately: the first still refuses mutation proof, the second retains mutated
source and partial evidence without restoration. Never infer the first intermittent failure's cause
from a later pass or retain raw error text in public diagnostics.

Inspection EPERM is not proof of a foreign UID or group absence: Darwin's group signal traversal
can exclude every zombie member before reap removes the group. Keep inspection EPERM provisional
until exact ESRCH, without changing deadlines or signaling policy. A real owned-child fixture
with injected EPERM must remain unsettled before ESRCH and recover only that provisional failure;
persistent EPERM must exhaust the existing deadline, retain mutated source and report its typed
diagnostic. EIO and actual termination EPERM must remain fatal after later absence. Current XNU
main explains a possible mechanism, never the installed kernel or a historical run's zombie state.

### 2026-10-26 — cold candidate compilation consumed the named-test deadline (introduced by PR #5240; escaped on PR #5459)

PR #5240's mutation runner applied its 180-second child deadline to each `cargo test` invocation, including compilation in a detached candidate worktree. On PR #5459, the first baseline child was terminated with `SIGTERM` after its timeout, while its retained log still showed `Compiling` and no `Finished`, `running 1 test`, or test result ([run 39970147805, job 120480006787](https://github.com/jcosta33/sourdaw/actions/runs/39970147805/job/120480006787)). The workflow step's 20-minute and job's 60-minute limits had not expired. This proves compilation consumed the child deadline before the named case began; the historical reviewer prompts are unavailable, so no missing stance is established.

Probe that would have caught it: hold a cold candidate compiler past the old 180-second deadline, then release it through an observable receipt. Require a separate finite compilation budget before the unchanged named-test budget. Build the exact baseline, each mutated source, and restored source before running their named cases; a successful build is not a mutation kill. Treat compile failure, compile timeout, or assertion-looking compiler output as no case execution and no kill. If absence of the owned process group is uncertain, retain the current source and refuse further cases or restoration rather than overwrite it.

### 2026-10-12 — one near-zero tempo missed governing identity (escaped via PR #5199)

PR #5199's opening-fold regression covered one positive near-zero tempo and a later distinct
change. It never placed multiple differing values entirely inside the origin tolerance: beats
`2e-7`, `4e-7`, `6e-7` at 90, 120, 160 BPM returned a 90 BPM tail. Public review
`5472288669` flagged absent opening-fold coverage; final `5474617910` omitted this cluster.
Private prompt and tier are unavailable, so the established miss is input coverage.

Probe exact-zero and strictly-positive clusters with distinct values and no later boundary;
require 160 BPM at the relocated origin. Independently observe sampled-ramp boundary integrals
and terminal tempo so an identity repair cannot replace finite-span means. Reverting the authored
identity binding must fail the unchanged cluster cases. A deliberate full-history workflow edit
also updates its owning independent assertion and regenerated snapshot; the snapshot diff must
contain only the intended checkout depth, and a depth-two mutation must fail the assertion.

### VCA Inspector call mocks missed the real Command entry

Commit `22a84b216658f593391e7e141d90f7c84d13648b` introduced the Inspector's direct
Create, Assign and None calls. PR #1049 later added typed VCA history and committed gain
reconciliation but did not connect that entry. The missed observable was the actual Inspector
caller reaching Command and runtime projection; historical private review prompts and tiers
are unknown.

Mount the Inspector with real registered Command handlers and CRDT storage. For each gesture,
observe one history entry, raw and projected membership, Undo/Redo and committed runtime gain;
locked gestures must warn without writes, and no-op gestures must complete without writes.
Revert each component dispatch to its direct use case and require its connected case to fail.
For a queued gesture, hold the real snapshot queue, replace the root with a same-ID successor
through the production repository and projection path, then release the queue. Require unchanged
successor state, history and engine calls; a same-project snapshot remains a positive control.
This queued-successor case was caught during review of #5789, not established as a main escape.

### 2026-10-12 — a release budget missed the still-open PCM entry (PR #5239 review repair)

An aborted bank could hold both a sealed sample and an unfinished reservation. Release freed
the open reservation first, then gave the sealed pool the full entry budget. A single-entry
call therefore freed both while existing large-budget disposal checks stayed green.

Stage one sealed and one open sample in the actual shipped module, abort, then release with
budgets zero and one: minimum progress is one entry, so the first call must retain the sealed
PCM and the second must finish. Pair native PCM-allocation counts with an open-only bank and a
shared sounding owner. Charge every PCM holder to the normalized budget; never forward zero
remaining budget to a lower helper that independently normalizes it to one. This is an entry
count contract, not a browser deallocation-time or audio-deadline measurement.

### Timeline-bake writer spies missed partial project commits

PR #474's exporter spec checked direct writer calls while a new groove-projection refusal could
occur after an earlier clip was added. Those spies could not establish atomic project truth or a
single Undo; historical private review prompts and tiers are unknown.

Run the real Command and CRDT batch with at least two active pad lanes. Reject or freeze the later
lane and compare the raw document, projected stores and history before and after. On success require
one grouped Undo to remove both lanes and Redo to restore them. Replace the batch with the prior
direct per-pad writers and require the later-lane case to fail.

A separate warning failure was caught in #5798 review before merge: the batch committed but the
history port failed, and the caller returned success without its warning. Inject that failure through
the real batch and require persisted clips and notes, unavailable Undo history and a visible warning
that identifies the committed result. Do not describe that finding as the #474 main escape.

### 2026-10-12 — grant ordering and shared PCM-copy oracles (PR #5239 review repair)

Levain's queued-credit tests cancelled before granting a waiter. They missed an ACK granting
that waiter followed by its own terminal error before the reservation continuation: the failed
load posted PCM and kept a credit it had not used. Grant first, then fail, dispose or cancel in
the same turn; require rejection, zero waiter PCM, and exact ceiling-sized reuse by the next
bank. Reverse ordering alone does not exercise the ownership handoff.

The shipped upload test compared two chunkings through the same copy path. Omitting that copy
could leave both renders equally wrong, while nonzero allocator leftovers passed a sounding
check. Poison the reserved PCM span, compare each acknowledged window with the independent
input bit-for-bit, and remove only the production copy in a committed private probe. Require
that unchanged oracle to fail; shared-path equality and non-silence cannot prove PCM transfer.

### Project-device assertions missed the Web Audio projection and cold strip

PR #2035 constructed runtime topology from every project device; PR #2083 filtered Yeast but not
scheduler synths and drums. A project snapshot can be correct while its Web Audio chain still
contains devices with no Web Audio node. The missed evidence joined actual MIDI editing to strip
construction; historical private review prompts and tiers are unknown.

Create a MIDI track with a scheduler synth or drum and a node-backed effect. Through real user
commands, inspect complete project identity and the Web Audio initializer and live chain before
Play, then after Play, Undo and Redo. Require only node-backed effects in Web Audio while the
project and native snapshots retain all devices; preserve unknown types for normal failure. Use
a deterministic AudioContext fixture that actually implements the strip constructor's required
methods, rather than treating a minimal mock's missing method as a product warning. Reintroduce
the unfiltered topology or remove cold initialization and require the corresponding unchanged
case to fail. A controlled engine boundary does not establish audible or hardware behavior.

### 2026-10-11 — callback assertions accepted the wrong history origin (PR #5323 review repair)

The subgraph fixture asserted that the inverse callback received the requested beat-four
anchor and returned beat six. It never observed the strip's AudioParam writes. The
orchestrator had prescribed that anchor without tracing history expansion to beat zero,
so the fixture confirmed the packet while accepting incorrect output.

Request beats four through eight under a 100→200 BPM linear ramp from beats zero through
eight. Observe terminal gain and pan before and after the crop boundary against the ramp's
independent integral and a whole render. Use a seed-sensitive history layer with positive
compensation: sample phase stays unchanged, only write times shift, and the zero-time seed
comes from the actual render origin. Revert each origin binding independently on a committed
private probe and require the unchanged regression to fail.

### 2026-10-11 — tempo integration checks observed an older caller population (#5243)

PR #5243's first-attempt run `38050968596` genuinely checked its author head `ba10195e`
against synthetic main `5823f7f77`, before #5209 added modulation. Its actual landing on
`83a92c4005` contained that later caller with removed aliases. PR #5273's first-attempt
run `38157801487` exposed the inherited missing names. Historical stance prompts and tiers
are unavailable; an obsolete integration and absent terminal-output probe are established.

Compare the checked caller population with the actual integration, then execute the new consumer
routes at that integration. Do not reproduce a seconds-to-beat helper's own expression in its
oracle: at 120 BPM half a second is one beat; for a 100→200 BPM ramp over eight beats, elapsed
seconds from beat four to six are `4.8 * ln(175/150)`. Assert terminal values and compensated
times/frames, not just captured callback identity or lane presence. Reverting inverse forwarding,
subregion anchoring or the consumer's inverse must independently turn the relevant case red.

### 2026-10-28 — live bank errors did not test buffered replay or repeated disposal (#5227)

Commit `90bc7995e44e809aa96d810bdf8b5e0b5f629a57` introduced the buffered loop with no
associated PR returned; PR #946 later handled bank-local errors on the live port but left that
buffered route behind the outer init catch. PR #5204 documented the broader contract. Private
review prompts and tiers are unknown. A live-error pass cannot prove that queued release and
ready replies survive a buffered bank-local error, that a terminal replay stops its tail, or
that a second dispose still answers after the first.

Use the real message handler with distinct bank tokens: queue a bank-local refusal followed by
its release and require decision, bank error, matching release and healthy ready in order. Pair
the terminal buffered case with a later request that receives the original error. Inject one
failed `initSync`, send a second init, and require the original error with no second construction
or ready. Count two `disposed` replies from one processor and a terminal drain reply; a mere
`toHaveBeenCalledWith` assertion misses the lost second answer. Removing the refusal guard and
removing the already-disposed post must each fail its unchanged focused case in a committed probe.

### 2026-10-11 — installed graph result hid a requested-root escape (introduced by PR #5284)

The installed affected-E2E loader case asserted full selection for opaque runtime dependencies, but the actual alias graph escaped its temporary root into the checkout. The published missing-consumer-or-opaque-edge probe preserved that result without observing resolved sources; requested-root scope isolation was the missing stance and probe.

Delegate to the installed cruise implementation and inspect its returned graph, rather than substituting a successful graph. Assert the exact fixture source set and root-relative alias edges for explicit, absent, and inherited `baseUrl`, together with the existing opaque-selection assertions. Reverting parsed-config forwarding or implicit-base normalization must fail the graph oracle even when selection still returns full.

The first PR #5291 repair's inherited fixture supplied an explicit `baseUrl`; it could not expose the resolver's implicit inherited-path rebase. The pre-merge regression must place the declaring config and real uncurated consumer in a nested directory, add an unrelated root shadow, and use valid relative imports for surrounding composition code. Require full admission before an unproved traversal or the actual declared graph; an unrelated unresolved alias would mask the omission by selecting full for another reason.

### 2026-10-11 — ALSA retry probes hid child outcomes behind Vitest's deadline (introduced by PR #5115)

The validation and nightly retry probes executed the published loop through four executable command shims and an external `wc` per attempt. Retained #5240 output shows their four cases timing out at Vitest's 5-second limit after 5439–7671 ms, while the child deadline was 10 seconds; the failed run did not retain child status, signal, error, or stderr. A later diagnostic observed the same loop complete correctly, so the original child outcomes and external cause remain unknown.

Probe the actual published loop with exported Bash functions loaded in its nested `bash -c`, a Bash-builtin attempt count, and a child deadline below Vitest's limit. Preserve exact three-attempt, 15/30-second backoff, early-success, and fatal-final-failure observations; remove later retries and force a successful final exit in separate mutations and require the corresponding assertions to fail. Stall a direct child deliberately and require `ETIMEDOUT`/`SIGTERM`, bounded child diagnostics, and fixture cleanup before the outer test limit. Do not infer machine load, add wall-time assertions, or raise Vitest's deadline.

Drive the stalled child through the same helper and fixture boundary used by the successful retry probes. A standalone child with a separate fixture can report timeout and cleanup while the retry helper's timeout guard is deleted. On the committed head, deleting that guard and deleting its cleanup must each fail the stalled-child case.

The timeout probe must also own the nested Bash process after its direct child exits. `spawnSync` can report `ETIMEDOUT` and allow fixture cleanup while that nested shell continues spinning. Record the nested shell's positive PID from Bash 3.2-compatible `$$`, then require it and the helper's detached process group to be gone before cleanup; a direct-PID-only termination mutation must fail the same case. Validate every recorded PID before probing or signaling it: an empty `BASHPID` on macOS coerced to PID 0 and killed the test runner's process group instead of observing the child.

Await process-group shutdown independently of Node's `close` event: a surviving grandchild can keep the inherited stderr pipe open after the direct child dies. On macOS, a group-zero probe may briefly return `EPERM` after `SIGTERM`; only `ESRCH` establishes that the group is gone. Keep the fixture until that observation, with a bounded `SIGKILL` escalation.

PR #5320's plain spinning grandchild died on the initial group `SIGTERM`, so deleting the independent group-exit wait still passed the stalled-child case. Make the nested published apt fixture ignore `TERM` and close its inherited stderr before spinning: the direct child and Node's `close` can finish while the owned grandchild remains. The unchanged case must fail separately when only the timeout path's group-exit wait is deleted and when group signaling is replaced with direct-PID signaling; its final rescue must kill and await the owned group before removing the fixture.

The first #5320 stalled-case rescue signaled the recorded group and descendant again after
its assertions observed `ESRCH`. Numeric validation bounded the identifiers but did not
preserve ownership after absence; a reused identifier could target another process. Retire
the owned group on its first `ESRCH`, share that ownership through helper shutdown and final
rescue, and never signal the raw descendant PID. Intercept every nonzero signal after a real
absence observation, model reuse without forwarding it, and require zero retired-ID signals.
Keep live-group rescue and fixture removal after independently observed group exit.

### 2026-10-10 — a required Rust job fetched its compiler before its caches (introduced by PR #3119)

The required Linux Rust job ran `rustup show` before any cache restore. PR #5064 run 38022076992
failed on a Rust distribution metadata TCP timeout before rustfmt or any health gate ran. Cargo
dependency caches after setup could not affect that failure. The missed CI runtime stance treated a
later green Rust job as evidence of recovery without proving its compiler setup path had changed.

Probe that would have caught it: trace the first compiler invocation and place an exact host-and-
TOML-keyed installed-toolchain restore before it. With the distribution endpoint unavailable,
require a complete exact hit to run rustc, rustfmt, and clippy with automatic installation disabled;
require a mismatched or incomplete hit to fail closed, and a cold install error to fail before Cargo
caches and health gates. A local fake endpoint proves the wiring only; hosted proof needs the
actual seeded main cache and a new-head required Rust run.

### 2026-10-09 — authority tests fixed PR state for the whole run (introduced by PR #4586)

PR #4586 introduced the authority append with a publication fixture whose PR reader always
returned `OPEN` at the same head. Its recorded test-validity stance asked whether reverting the
writer would stay green, but did not mutate PR state after approval inspection. PR #5032 extended the
same binder to recovery; its moved-head fixture changed the head before reconciliation and held
it constant through the two inspections and later dossier write.

Probe that would have caught it: make the first two inspections return the same open head, then
return merged, closed, or another head on the next PR read. Assert the publication binds without
`delivery-authorized`, replay is byte-identical, and no second POST occurs. Revert only the live
PR-state check and require these cases to fail; retain an open current-head approval control.

### 2026-10-09 — cold navigation expired before its warmup allowance (introduced by PR #3222)

The E2E global warmup gave the launch overlay 180 seconds but left the preceding `page.goto('/')`
at Playwright's default 30 seconds. On a cold review server, navigation timed out before any selected
spec could start. The slow load's underlying cause was not established.

Blind spot: review checked the overlay wait's allowance without tracing every awaited operation that
must complete before it. Probe the real warmup entry with a controlled monotonic clock: a 35-second
navigation followed by a prompt overlay must pass under one 180-second deadline, while a hung
navigation or late overlay must fail within that same deadline. Assert explicit positive remaining
timeouts at both Playwright calls, identity validation before browser launch, and browser closure on
success and failure. A controlled unit probe alone does not prove hosted browser-spec admission.

### 2026-10-08 — a shutdown timing assertion measured more than its budget (introduced by PR #2976)

A native CI run for PR #5064 completed plugin reclamation but failed the test's `elapsed < 250 ms`
assertion at 252.790917 ms. The production budget charges only measured sleep during scheduler
polling; the test timed the whole synchronous shutdown cascade and a separate releasing thread.
The source of that run's extra wall time is unknown.

Blind spot: a wall-clock bound on a larger operation cannot distinguish a slow unrelated cascade
step or thread scheduling from a polling regression. Probe the private wait seam with a retained
runtime: require the first requested poll to be exactly 2 ms, release the runtime in that callback,
return a synthetic 252.790917 ms wait, and require reclamation with no second wait. Hold the runtime
through a synthetic 502 ms wait in a companion case and require one poll plus an abandoned report.
Mutating the request to the full budget, deferring the sweep until the end, or charging requested
instead of measured time must turn the respective case red.

### 2026-10-07 — a retryable Playwright install could hang forever (introduced by PR #4228; tracked by #5047)

PR #4228 added three attempts and backoff around `playwright install --with-deps`, but only a returned
failure advanced the loop. A stalled download never returned, so the E2E shard spent its full hour
installing and ran no tests.

Blind spot: the workflow contract proved retries existed but did not require an attempt deadline,
prove the overall install step fit below its job budget, or exercise a blocked child through the loop.

Probe that would have caught it: execute the workflow's extracted loop with a fake install process that
signals readiness, ignores TERM, and remains blocked; apply short TERM/KILL bounds and prove three
attempts reach the final nonzero exit. Separately pin each real attempt and the maximum aggregate
attempt-plus-backoff time below both the install-step and E2E-job budgets.

### Explicit protection tests must observe final caller admission

Issue [#5339](https://github.com/jcosta33/sourdaw/issues/5339) reports protection text that a grounding
route did not enforce. PR [#5277](https://github.com/jcosta33/sourdaw/pull/5277) added coordinated-list
restriction cases, including a Strings case expected to refuse. The earliest defect introduction
and exact historical missed stance or tier remain unproven; that suite boundary alone proves no
single-target or compiled-route protection.

Require canonical actions or refusal through direct and atomic callers and through compiler-backed
callers where the selector path applies. Remove the final protection enforcement in an isolated
probe and require the named regression to fail; a helper-only parse assertion cannot establish
admission. For retained protections, move selection after creating the real grounding basis,
retain the original source call, refine twice, then compile a replacement targeting the formerly
selected object. Assert the recorded identity, exception, proposal scope and final refusal together.
Pair allowed gain with forbidden pan and rename after a whole-track fader exception, and add a
later whole-object protection to prove that refinement narrows the earlier permission. Separately
combine a positive fader protection and an exception through the basis producer and direct caller.

## Standing probes

- PR #5091's head `71221839` replaced the registered event bus after earlier deletion
  cases had cached the injected emitter. Its async-boundary case stayed green when the
  root guard was disabled. Observe the emitter actually retained by `inject`, using a stable
  registration across cases and a positive real removal emission. Replace with a root that
  lacks the outgoing ID so committed-absence checks cannot mask the root-guard mutation.
  The same named case must fail with `isCurrent = () => true` both alone and after its
  preceding deletion family. Run that qualification on a committed head in an isolated,
  owned probe; retain commands, patch, raw output and exit status.

- An aggregation test claiming a stored report route must use the production reader's filename and
  assert that both input records were admitted. An ignored artifact can make a boundary control pass
  while never reaching the claimed addition. For TypeSafe usage, prove stored scan plus verification
  and evaluation-reader outcomes independently: exact `MAX_SAFE_INTEGER + 0` succeeds and the next
  count refuses before record output. PR #4933 introduced the unchecked measurement addition; no
  historical reviewer stance or tier is established by this lesson.
- An SDK request test must execute in the server environment and capture the installed SDK's actual
  fetch body. A browser-environment refusal or a caller-only serialization assertion proves neither
  the exact wire string nor response-body timeout and cancellation. Preserve failed harness attempts
  separately from qualified behavior reproductions.

- For a queued MIDI expression test, cover both sides of the note lifetime: note-on before each member gesture, and every admitted gesture before note-off and the next same-channel note. Assert the recorded note fields through the byte dispatcher; a mocked handler call order that ends before release can pass while the curve is lost (PR #805).

- Apply the standard mechanical probe the Review section of `AGENTS.md` defines; this file does not
  restate it.
- A spec-only diff that turns red to green is the highest-risk diff class: for every hunk, read the
  product code the spec observes at head and decide stale-spec versus laundered defect.
- Exact-count and exact-shape assertions: verify the pinned value derives from the thing it claims
  to observe, not from whatever the code currently produces.
- A diff that adds an export to a contract barrel, or adds a barrel import to production code,
  changes what every spec mocking that barrel must supply. Require and inspect the pull request CI
  Barrel mock coverage result; report every `✗` row as the finding, named with the spec, the barrel,
  and the missing key. Keep the focused checker regression and a targeted mutation probe local when
  changing the checker itself.
- A test helper that names a production route in its doc — "one batch", "one drain", "the fenced
  path" — must emit the same fence, ordering, or envelope that production entry emits; trace the
  helper to the branch it actually drives, and a helper that reaches the loose branch while the spec
  claims the fenced one is the finding.
- When a spec pins a rule about repeated or overlapping events on one key, name the mutation that
  inverts the rule (last occurrence decides instead of first, a note-on covers instead of a note-off)
  and require the fixture to place the decisive event in the position that mutation would get wrong.
- A regression suite for a detector that asserts an invariant over a registered population must
  cover the invariant per adapter class, not replay the incident's fixture: enumerate the classes
  the population actually has — an ordering normalizer, an encoding change, a dropped field — and
  require a case in each that reverting the detector's invariant check fails. A suite green on the
  incident fixture alone does not discharge the detector's global claim.
- The e2e matrix never runs on a pull request, so nothing on the reviewing head catches a spec left
  asserting a control the diff renamed, removed, or replaced: sweep `tests/e2e/` for the old control
  name, aria-label, or text and re-home the affected specs in the same change. When a diff adds,
  removes, or reorders a desktop-bridge crossing on a launch or project-activation route, search
  `tests/e2e/` for the command string and for specs pinning an exact runtime-call list
  (`desktopRuntime.spec.ts`), and update the pinned list in the same change. A control can also be
  retired with no rename at all: when a diff changes a control's enabled, disabled, or visibility
  condition, read the changed control's attributes in the product and search `tests/e2e/` for each
  value it can be located by — its test id, its aria-label or accessible name, its placeholder, its
  title, and its rendered text — never for assertion names, which select unrelated specs. Those forms
  are examples of what to search, not a closed set, so also add any spec that reaches the control by
  role or text alone. Search every form the control has, not one of them: one term reaches only the
  specs that read that form and misses the specs that read another. The population the step acts on is
  the union of those searches, the specs whose locators resolve to the changed control; inside each
  returned spec, inspect every state read of that control: `toBeVisible`, `not.toBeVisible`,
  `toHaveCount`, `toBeDisabled`, `toBeEnabled`, `toBeHidden`, and the `isDisabled()`, `isEnabled()`,
  `isVisible()` conditional guards — the conditional-admission class the blind spot below names.
  Re-check each against the new condition and re-home it in the same change: a guard strands every
  assertion behind it, so a guard keyed on a state the diff changes must be re-homed even when no
  control was renamed, removed, or replaced.
  When a diff adds text-bearing UI beside an existing text locator, search `tests/e2e/`
  case-insensitively inside the text locators' own arguments — `getByText(...)`,
  `getByRole(..., { name: ... })`, `getByLabel(...)` — for the added sibling's own text, never
  whole-file text, which returns every spec that merely mentions it; that search finds the candidate
  arguments, but the judge runs the other way: a text locator becomes ambiguous when its argument is a
  case-insensitive substring of the added element's text, so an argument that contains the sibling's
  text, such as `getByText('Synth panel')`, would not match the option at all; keep only the candidates
  whose kind or role can select the added element, because a role-scoped locator for a different role
  cannot; the population is the specs holding such a locator, bounded because only a matching locator
  argument can resolve to the wrong element; for the recorded `synth` sibling that is the two specs
  holding `getByText('Synth')` — `tests/e2e/instrumentPanels.spec.ts` and
  `tests/e2e/templateAndInspectorFinal.spec.ts` — against the twelve a whole-file text search returns
  and the three a role-blind search returns, the role test removing `tests/e2e/e2eWorkflow.spec.ts`,
  whose `getByRole('button', { name: /^Bypass Synth/i })` at line 82 and
  `getByRole('button', { name: /^Enable Synth/i })` at line 86 are role-scoped locators for `button`
  that can never resolve to the added `<option>`. Require every spec in that population
  to redden if its locator is now ambiguous — `getByText` matches case-insensitive substrings, so a new
  sibling makes it a strict-mode violation or makes `.first()` select the wrong element.
- An either-arm assertion is a standing escape: select every hit of `expect\([^)]*\|\|` across the
  specs under review, with no qualifier about whether its arms can hold independently, and require
  each arm to be load-bearing by mutating that arm's condition away and confirming the assertion
  reddens — that mutation is how a dead arm is exposed, and until both arms are proven the
  disjunction can be silently narrowed to a single live arm.
- A test whose expectation is computed with the code's own expression cannot observe a divergence
  between that expression and its consumer's: it proves the expression is stable, never that it
  agrees with the boundary that will refuse the value. Pin the figure at the consumer's boundary, and
  state which source each literal came from.
- For every assertion a change adds, mutate the input it reads and confirm it fails _alone_, with
  its neighbours exactly as shipped. A pin placed after another assertion that already fixes the
  same value observes nothing; a relation with slack cannot redden the constant it was written for;
  a parse that reads the first match in a file bounds whichever entry comes first rather than the one
  it names; and a ratio derived from a value its neighbour pinned is arithmetic, not a check.

## Lessons from escapes

### 2026-10-25 — fixed protected IDs proved forwarding without source resolution (introduced by PR #2811)

PR [#2811](https://github.com/jcosta33/sourdaw/pull/2811)
(`beb59d2e74a4d98992b692ff07a40635db22ee39`) introduced raw substring inference in
`getApplicationProtectedObjects`. Its `getApplicationWorkflowScope` spec mocked that producer
with fixed protected IDs, proving forwarding without proving which whole object the text
protected. The historical review stance, prompt and tier are unestablished.

Call the real producer for `leave Bass Verse unchanged`, `leave Bass fader unchanged`, and
`leave Bass unchanged` with an exact track/clip or track/device name collision. Assert clip-only
and facet-only independence, conservative track candidates, and an unconsumed mixed source
range. Read the initial caller's recorded facts and require a sibling clip edit to survive;
separately require frozen whole-owner descendants to remain refused. A structural preservation
control must first assert its actual scope producer's `targetIds` and `excludedFrozenTrackIds`.
An all-frozen fixture can produce no bulk scope, so an incidental named restriction cannot stand
in for proof that the structural branch ran.

### 2026-10-21 — census specs pinned an observation count instead of the deadline (issue #5337)

PR #5331's controlled Darwin census cases asserted retention after exactly three catalogs for
persistent descriptor omissions and PID gaps. Those expectations encoded the cap that stopped
lanes under real load, so they would fail any convergent census while proving nothing about
whether a later complete catalog could be reached. This supersedes the three-observation bound in
the 2026-10-12 Darwin lesson below. Probe persistent omission through the whole simulated
deadline: every whole and PID-scoped `lsof` call must receive the remaining deadline as its
timeout, and expiry must name the last uncovered process. A reintroduced count cap must fail.

### 2026-10-21 — final storage cleanup outlived the returned leak verdict

PR #5274 (`40baa0716b`) recorded a retained-storage verdict before an existing final cleanup
attempt. A first refusal followed by complete proof could remove the real owned payload in that
final attempt while the guard still returned `reason: leak` and a retained message. The historical
review stance, prompt, and tier are unestablished; the missing oracle compared the final
filesystem state with the reported disposition.

Probe the real guarded child and owned storage with one controlled proof refusal followed by
complete direct and claimed proof. Require both physical removal and a result without a
storage-only leak. Keep a persistently incomplete or thrown proof retained, preserve an earlier
nonstorage failure, and retain child-authored text that resembles the guard's diagnostic.

### 2026-10-12 — one omitted Darwin field did not prove a bounded omission sequence

PR #5274 (`40baa0716b`) tested one missing descriptor type followed by complete proof,
but did not exercise two omissions before a complete catalog. Live account captures
later demonstrated transient `f,n` records without `t`; their exact historical failed-run
descriptor identities and review dispatch are unestablished.

Probe the real parser and census with two omissions then complete third proof, persistent
three omissions, a third live borrower, a third uncovered live PID, and the unchanged
five-second deadline. Assert observation counts and remaining command timeouts. Pair the
controlled census with real owned release and borrower retention; a parser result alone
does not prove deletion. Reverting the bounded admission must fail the release case.

Probe two successive exclusively new, same-UID live PID gaps, then require a third wholly
complete catalog to release real owned storage. A protected borrower in that third catalog
must veto deletion; another new PID there must retain storage. Keep a prior missing PID
present in the next pre-sample as a refusal, and assert the shared three-observation and
original five-second bounds on every path.

An earlier `dead` sample does not bind a later startup recovery: a new uncovered live PID
can make that later census `unknown` while the new run itself succeeds. Require retention
only for the exact later PID-coverage diagnostic, reject other unexpected diagnostics,
and inspect both the original run and claim payloads. Keep complete-proof deletion
unconditional; observing a prior sample or the new run's exit code cannot prove it.

### 2026-10-10 — ZIP fixtures left paired writer timestamps to chance (introduced by PR #4057, commit `d608d165a49`)

PR #4057 added the streamed-artifact positive case and ZIP-based strict-parser fixtures without
explicit `mtime` values. In fflate 0.8.3, streamed `Zip.add` and `Zip.end` each call `wzh` for the
local and central header; `zipSync` calls that same writer twice for every file. Each call reads a
fresh `Date.now()`. If a pair crosses a DOS two-second timestamp boundary, the timestamp words
differ and the unchanged parser rejects the archive before the intended descriptor, bounds, or
decompressed-data oracle. The CI failure established parser rejection, not how often or how quickly
the reads crossed the boundary.

Blind spot: fixture validity depended on separate live clock reads, so the archive's metadata could
fail before its intended positive or negative assertion ran.

Probe that would have caught it: force actual streamed and `zipSync` writers across a DOS two-second
boundary, capture local and central timestamp bytes, and require the strict parser to reject the
archive. Apply one fixed fixture `mtime` through the supported `zipSync` options and streamed-entry
property; run the owning spec with its payload, bounds, CRC, file-set, encryption, and descriptor
oracles intact. On the fixed head, reverting `mtime` must make the forced-clock case red. Keep the
strict parser unchanged; this probe does not establish the hosted failure's clock interval or rate.

### 2026-10-09 — a newly declared "every spec owes the first-paint bound" left literal 15 s and 30 s waits in place (escaped via commit `04c28be0f8`)

Commit `04c28be0f8` declared in `tests/e2e/e2eUtils.ts` that every spec waiting on the launch overlay itself owes `LAUNCH_SCREEN_FIRST_PAINT_TIMEOUT_MS`, but did not sweep the specs that already waited with a literal bound; the 15 s in `promptBarCancelRecentTestId.spec.ts` came from commit `d78dac728a`. It surfaced only when two Playwright workers per runner added CPU contention and a cold boot was still on its loading overlay at 15 s.

Blind spot: a contract written as prose ("every X owes Y") binds sites the diff never touches, and a green suite on the declaring head cannot show them, because the literals were sufficient until contention changed boot time.

Probe that would have caught it: when a change declares an "every X owes Y" contract, grep every existing X, run a census of them against Y, and land the census as a spec that reads the real files and cannot pass by matching nothing.

### 2026-09-28 — one aggregate deadline hid cumulative closure work (CI run 36366521880, job 108754137864; introduced by PR #4775)

The trusted-write closure spec walked all 13 command graphs in one Vitest case. Each walk independently proved its command's exact closure, but the accumulated work took 5547 ms against the default 5000 ms case timeout and failed the CI shard. The failure was test granularity, not evidence that a command graph was wrong.

Blind spot: independent obligations shared one per-test deadline, so their cumulative cost could fail the aggregate case without identifying a slow command by its own named result.

Probe that would have caught it: when a spec repeats an independent invariant across a registered population, probe the cumulative work under the actual default deadline. Keep each population member as a named parameterized case with its own fresh inputs and deadline, preserve a mutation-discriminating assertion for every member, and do not raise the shared timeout to mask aggregate work.

### 2026-09-28 — an elapsed-time readiness test omitted the real progress producer

The existing timeout cases exercised stalled Crumbs loads and captured-generation isolation, but no check drove Levain's decoded-bank progress into all five live TrackNodes across the 10-second boundary. A green timeout test therefore could not distinguish a healthy cold bank from a stall. PR #3982's review explicitly scoped out progressing-load policy and caller-visible outcomes; the test gap is the missing #3318 acceptance probe, not a failed #3982 cohort oracle.

Probe: use the real decoded-bank producer and sink/descriptor route, assert each captured device receives its own increasing completion callback, then cross the old deadline, finish the finite bank, and require five token-matched worklet acknowledgements. Reverting progress forwarding or the per-device renewal must redden that case. Independently hold one final acknowledgement and one stalled peer, and assert typed failure rather than treating promise settlement or decoded bytes as playable readiness.

### 2026-09-28 — specs that measured a budget with the budget's own expression could not fail (escaped via PR #4491; merge `9effe3689c`)

The semantic review's planner and its provider each measured one request budget differently — the planner reserved a hand-rolled wrapper, the provider measured `{state, questions}` — and the specs asserted the planner's figure with the planner's arithmetic, so the nine-byte divergence that left 37 of 42 scanned units unassessed in CI — the oversized unit under its own `budget_exhausted` refusal and 36 more under `budget-exhausted-before-admission` — was invisible to a green suite. The class of pin that cannot fail reappears whenever a repair adds pins, and each shape is checkable in the spec at head rather than in the history: an assertion reachable only after a neighbouring pin has already fixed the same value, a relation with enough slack that the constant it was written for cannot redden it, a parse that reads the first match in a file rather than the entry it names, and a ratio computed from a value its neighbour pinned.

Blind spot: a suite that measures the system with the system's own arithmetic is self-consistent by construction, so it can never fail on the disagreement that matters; and a pin written beside an exact pin feels like coverage while observing nothing. The first real signal came from running the command end to end and reading its own report, not from any test.

Probe that would have caught it: for each budget, take the consumer's expression as the oracle and assert the producer's admitted unit against it (`JSON.stringify` byte length against the profile's ceiling). For each pin, mutate the input it reads with its neighbours untouched and require it to fail alone; when a mutation leaves the suite green, the pin is the finding.

### 2026-09-26 — a startup bridge crossing left the desktop-runtime call list stale (escaped via PR #4568)

PR #4568 (commit `a0aa4c1f18`) added `clearInheritedRetrospectiveCaptureArm()` to `src/app/main.tsx`,
issuing a `disarm_retrospective_capture` bridge call before anything renders whenever a desktop
bridge is present. `tests/e2e/desktopRuntime.spec.ts` pins the exact ordered list of non-poll
runtime calls a launch issues; it was never updated, so nightly e2e reddened on `main`.

Blind spot: e2e never runs on a pull request, so a new call on the startup path has no check on the
reviewing head, and a call-list pin looks like an assertion about diagnostics polling rather than
about every crossing the launch route makes.

Probe that would have caught it: when a diff adds, removes, or reorders a desktop-bridge crossing on
a launch or project-activation route, search `tests/e2e/` for the command string and for specs
pinning an exact runtime-call list, and update the pinned list in the same change.

### 2026-09-22 — renamed controls and an ambiguous text locator left `tests/e2e/` stale (escaped via PRs #4464, #4473, #4479)

The nightly end-to-end train reddened on `main` across six of twelve shards: the `Command Mode`,
`Confirm actions`/`Cancel actions` and `toBeDisabled` failures came from a spec asserting a control
or state the product no longer exposes, while the two Synth failures came from a newly added sibling
that made an existing text locator ambiguous. The composer's "Command Mode" button was
removed on 2026-08-15 by commit `bd618a5a79` ("fix(agent): expose governed execution modes"), which
replaced it with the `Agent execution mode` select; PR #4479 removed the prompt bar's inline
`Confirm actions` / `Cancel actions` controls; and PR #4464 removed the `isLlmAvailable` term from the
composer's `disabled` expression — retiring that state contract, leaving
`chatComposerTestId.spec.ts`'s `toBeDisabled()` assertion stale, and, because the stale `Command Mode`
locator sat behind an `isDisabled()` guard, unmasking that five-week-old locator. PR #4473 added a
track-role `<option value="synth">` above the inspector's `Synth` device card, so `getByText('Synth')`
matched both — a strict-mode violation in one spec and, because `getByText` matches case-insensitive
substrings, `.first()` resolving to the invisible `<option value="synth">`, whose click timed out at
line 63 and reddened that spec and its shard. A text locator that resolves to the wrong element
makes its assertion observe something other than the intended control, and when the assertion is a
disjunction written against that locator, an arm it cannot satisfy is dead: the disjunction
silently narrows to whichever single arm still holds.

Blind spot: e2e never runs on a pull request, so a control rename, removal, replacement, or state
change has no check on the reviewing head; a guard keyed on a state the diff changes hides the stale
locator behind it; a text locator is treated as stable when a new sibling's text is a
case-insensitive substring of it, so the locator resolves to the wrong element and the assertion
observes something other than the intended control; and an either-arm assertion whose arms can hold
independently is accepted as covering both when one arm may be dead.

Probe that would have caught it: when a diff renames, removes, or replaces a control, sweep
`tests/e2e/` for the old control name, aria-label, or text and re-home every stale spec in the same
change; when a diff changes a control's enabled, disabled, or visibility condition, read the changed
control's attributes in the product and search `tests/e2e/` for each value it can be located by —
its test id, its aria-label or accessible name, its placeholder, its title, and its rendered text —
never assertion names, and take the union of those searches rather than one term: one term reaches
only the specs that read that form and misses the specs that read another; those forms are examples
of what to search, not a closed set, so also add any spec that reaches the control by role or text
alone; the population is the union of those searches, the specs whose locators resolve to the changed
control; inside each returned spec, inspect every state read of it — `toBeVisible`,
`not.toBeVisible`, `toHaveCount`, `toBeDisabled`, `toBeEnabled`, `toBeHidden`, and the
`isDisabled()`, `isEnabled()`, `isVisible()` guards — and re-home each in the same change; when a
diff adds text-bearing UI beside an existing text locator, search `tests/e2e/` case-insensitively
inside the text locators' own arguments — `getByText(...)`, `getByRole(..., { name: ... })`,
`getByLabel(...)` — for the added sibling's own text, never whole-file text, which returns every
spec that merely mentions it; that search finds the candidate arguments, but the judge runs the
other way: a text locator becomes ambiguous when its argument is a case-insensitive substring of the
added element's text, so an argument that contains the sibling's text, such as
`getByText('Synth panel')`, would not match the option at all; keep only the candidates whose kind
or role can select the added element, because a role-scoped locator for a different role cannot; the
population is the specs holding such a locator, bounded because only a matching locator argument can
resolve to the wrong element; for the recorded `synth` sibling that is the two specs holding
`getByText('Synth')` — `tests/e2e/instrumentPanels.spec.ts` and
`tests/e2e/templateAndInspectorFinal.spec.ts` — against the twelve a whole-file text search returns
and the three a role-blind search returns, the role test removing `tests/e2e/e2eWorkflow.spec.ts`,
whose `getByRole('button', { name: /^Bypass Synth/i })` at line 82 and
`getByRole('button', { name: /^Enable Synth/i })` at line 86 are role-scoped locators for `button`
that can never resolve to the added `<option>`; require every spec in that population to
redden if the locator is made ambiguous —
`getByText` matches case-insensitive substrings, so a new sibling makes it a strict-mode violation or
makes `.first()` select the wrong element — then assert the control through stable handles (test ids,
roles) rather than bare text; and select every hit of `expect\([^)]*\|\|` across the specs under
review, requiring each arm to be load-bearing by mutating that arm's condition away and confirming
the assertion reddens before the disjunction counts.

### 2026-09-21 — internal level assertions missed the provider wire (escaped via PR #4392)

PR #4392 (`5c476c92153`) added linear/decibel project-context fields, but its provider assertion covered only master and track decibels in one projection. It did not inspect the final full and delta messages for paired master, track, send, clip, and gain-lane values.

Coverage gap: the added assertions proved producer objects and a master/track-only provider projection, but did not inspect the correction-round delta or nested level fields.

Probe that would have caught it: inspect `buildAgentContext().message` in full and delta modes, mutate an unselected track's clip, send, and gain lane independently of its gain/name, and require every linear value beside its decibel reading, removals represented, and exactly one law header.

### 2026-09-21 — an expected refusal printed as a failure misled two readers (issue #4486)

The publish spec inherited the trusted publisher's stderr, so a refusal the case deliberately provokes
(`expected exactly one locked author lane`) printed to the shard log and read as a test failure to two
readers across two review rounds. Probe: capture child stderr in the helper and assert refusals through
the thrown error, then require a deliberately-refused case to leave the spec's own stderr clean.

### 2026-09-19 — an Anthropic usage fixture mirrored the raw-field mapping (escaped via PR #4393)

PR #4393 normalized Anthropic `input_tokens` directly as total input while also exposing cache-read and
cache-creation counters. Its fixture reported 50 raw, 5 read, and 8 creation tokens, then asserted 50,
so the test encoded the faulty mapping instead of the provider's documented 63-token billing total.

Blind spot: the adapter test checked that every wire field reached some result field, but never stated
which counters are subsets and which normalized counter is inclusive. The later attribution helper
repeated the production mapping, so it could not expose a dropped field in that mapping.

Probe that would have caught it: use unequal raw, cache-read, and cache-write values; assert their
inclusive total and separate counters through the real provider producer, protocol accumulator, run
budget, and cost projection. Make the terminal stream event output-only, and require the initial input
and cache counters to survive without being added twice.

### 2026-09-18 — a command whose own spec imported it, and a freshness check that healed the state it asserted (escaped via PR #4356)

`scripts/restampWasmInventory.ts` ended in a bare `run();` with no entry guard, and its spec imported the module for its helpers, so collecting the spec executed the command: running it rewrote `release/open-source-inventory.json`, the spec's "the command reports a current inventory on a fresh committed tree" case then observed the file it had just healed and could never fail on a drifted tree, and on a tree the command would refuse the module-level throw prevented the file's tests from running at all. The same head's refusal also told the reader to run "its wasm:* script", a name that does not exist for every package.

Blind spot: the stance asked what each assertion would do under a mutation of the logic under test, but treated one spawned end-to-end case as covering the command without checking which branch it took — that tree had nothing to restamp, so every write-path mutation stayed green — and it never asked what the spec's own imports do to the tree.

Probe that would have caught it: for a spec that imports the module it tests, import it against a deliberately drifted fixture and require every tracked file to be unchanged; then require the command's happy path to be exercised on a drifted fixture and delete the write, retarget the path, drop the refusal call and remove the printing, requiring each mutation to fail the suite.

### 2026-10-09 — a landed recovery receipt left a modern dossier unbound (issue #5111)

An absent-lock replay returned success from its receipt before authenticating or inspecting the
landed review. The fresh-owner recovery test exercised a different branch, so it did not prove
historical receipt adoption or native publication replay.

Probe that would have caught it: start with an exact landed version-2 receipt, no lock, and a modern
unbound dossier; require two stable exact remote reads, one append-only publication binding, and a
second recovery plus native publish replay with no new POST. Restore the old early return and require
the owning assertion to fail. On a merged PR, require publication binding without retrospective
delivery authorization; on an open current approval, require zero unresolved threads for authority.

### 2026-09-02 — a rejected review stranded its mutation lock (escaped via PR #3342)

Review publication treated a definitive GitHub validation rejection as an ordinary failed write and retained a generic lock owner with no immutable publication intent. A later operator could not prove whether the review landed, so neither release nor replay was safe.

Blind spot: tests asserted request validation but not the lock's recovery evidence after a remote mutation boundary.

Probe that would have caught it: force a definitive 422 after the journaled pre-write transition, then prove recovery releases only when the prepared bundle digest, head, reviewer actor, and remote review enumeration all match; mutate each field and require the exact owner to remain retained.

### 2026-08-29 — a refactor that rewrites its own witnesses (escaped via PR #2988)

PR #2988 extracted render-retry execution, claimed in its body that it kept exact revision, budget,
continuation, chat, and no-replay behavior, and in the same diff rewrote its own handler spec's
call-count assertion from a two-pass pin to a single-flight pin — an observable contract change
shipped under a preservation claim. Two end-to-end witnesses (`drumBusPromptWorkflow`,
`backingVocalPlateWorkflow`) were edited by that same diff yet only partially realigned: their
stale attempt-count expectations survived the edit and were left failing on `main`, diagnosed from
scratch later (#3060).

Blind spot: the stance checked that the diff's own specs discriminate, but not that the diff's spec
edits were consistent with the body's preservation claim — and in files the diff touched, partial
realignment passed as realignment; assertions the diff left standing in edited files were never
re-checked against the new behavior, and untouched witnesses of the same surface were never run.

Probe that would have caught it: when a refactor's body claims behavior preservation, diff every
assertion the refactor itself rewrites — a changed expected value under a preservation claim is a
contradiction to raise, not context to accept; in every spec file the diff touches, re-check the
assertions it did NOT change against the new behavior; and search the repository for other specs
observing the same call surface, running the nearest ones.

### 2026-08-29 — a barrel mock the diff silently invalidated (escaped via PR #3098)

At PR #3098's first head, production code grew an import from the `#/modules/AudioEngine/useCases`
barrel. A sibling spec, `src/modules/Transport/useCases/__tests__/playheadScheduler.spec.ts`, mocks
that barrel with an explicit factory that lists its keys instead of spreading the original, so the
new key resolved to `undefined` and 14 of that spec's 23 tests failed on the head. The pull
request's gate stayed green — the unit legs were softened on pull requests at the time — no stance
raised it, and the author found it by running the spec.

Blind spot: the stance read the diff's own specs and the specs of the files the diff edited. A
`vi.mock` factory in an unedited file is a contract with a barrel, and a diff that widens what
production code takes from that barrel breaks that contract without appearing in the diff at all —
nothing in the changed lines points at the spec that now fails.

Probe that would have caught it: when a diff adds an export to a barrel, or adds a barrel import to
production code, grep the repository for specs mocking that barrel; for each, decide whether its
factory spreads the original or lists keys, and whether the spec transitively executes the changed
production path. A listing factory on an executed path is the finding, named with the missing key
and the spec that will fail. The unit legs block a pull request now, so this failure class does
reach the gate — but only on a head the suite has actually run against, and only for the shard that
holds the spec. Read the gate as evidence about the head it ran on, never as evidence about a spec
no run in this pull request executed.

### 2026-08-30 — a vitest-green spec whose types fail the strict build (escaped both stances via PR #3127, caught only by the pipeline)

PR #3127's new census spec passed its focused vitest run and both blind stances cleared it, but its
`import.meta.glob` value handling failed the strict test typecheck (TS2322/TS2769 under
`noUncheckedIndexedAccess`); only the pipeline's Types-and-contracts job caught it.
The same class hit PR #3120 (a production WeakMap typed too narrowly for a new field, TS2339) —
vitest transpiles without typechecking, so a green run is never type evidence.

Blind spot: the stance proves specs discriminate by running them; vitest's pass says nothing about
the strict `tsc` contracts the pipeline enforces, so a PR adding TypeScript files can carry type
errors no spec-level probe surfaces.

Probe that would have caught it: when a diff adds or edits TypeScript files, require the pull
request's CI TypeScript typecheck to cover the changed files and inspect its result; a focused
Vitest pass is not type evidence. Reproduce a posted type finding by identifying the CI diagnostic
and the source change that removes it. PR #3136 historically used an isolated compiler probe; the
current evidence path is the pull request's CI typecheck.

### 2026-08-30 — a new device type string that is a classified third-party mark (escaped via PR #3127, caught by the release-inventory job)

PR #3127 inlined preset chains whose faust device types carry trademark strings;
`faust-1176-compressor` tripped the release inventory's mark census (unclassified mark path),
failing the pipeline's Release-inventory step. Five sibling files were already classified in
`release/open-source-inventory.json`.

Blind spot: no stance treats the repository's artifact-contract checks (release inventory marks,
dependency-license proofs) as part of the diff's blast radius; a new string constant in a type/name
registry can violate a data contract no spec observes.

Probe that would have caught it: when a diff adds type or name strings to registries (device types,
plugin descriptors, preset ids), require the pull request's Release inventory check to pass and
classify any reported mark hit in the same change. The tracked-set digest variant of this gap, where no digest moves
at all, is the 2026-10-24 entry below.

### 2026-10-24 — a tracked-set source edit left its release digest unrestamped (escaped via PR #5568, found by a manual release-inventory run on main)

PR #5568 added the overdub controller command handlers and their argument keys. It changed
`src/modules/Command/useCases/versionedCommandArgumentKeys.ts` and `src/utils/handlerContract.ts`,
both inside the Grand Boule project-state tracked set in `scripts/checkReleaseInventory.ts`, and did
not restamp `release/open-source-inventory.json`. Its checks were green. `main` then failed
`pnpm test:release-inventory` with a digest mismatch until a follow-up restamp. A manual run on main
found it after a reviewer of another PR noticed the stale digest.

Blind spot: at the time of this escape, no pull-request check ran `pnpm test:release-inventory`; the
nightly and `release:proof:assemble` were the only runners. A diff could therefore change a
tracked-set source while its recorded digest went stale unobserved. Stances that attack the change's
behavior never touch the digest, so the escape reached `main` unless a reviewer checked for it.

Probe that would have caught it: for each surface boundary in `scripts/checkReleaseInventory.ts`,
find its `gitPathspecs` by its `digestLabel` (the Grand Boule project-state boundary is the one with
`digestLabel: 'grand-boule-project-state'`) and run
`git diff --name-only <base> <head> -- <gitPathspecs>`, keeping its `:(exclude…)` entries. Match only
against `gitPathspecs`: those are what the digest hashes. The boundary's `paths` is licensing
membership and is broader, since it includes GrandBoule specs and AGENTS.md. When the command lists
a path, require `release/open-source-inventory.json` to move in the same diff, then inspect the
pull request's Release inventory check for the digest result. A missing digest move is a finding for
the reviewer, not something to leave to the author's local run. If the author must restamp,
`pnpm release:restamp:tracked-set` refuses while tracked-set source changes are uncommitted, so the
source commit comes first.

### 2026-10-25 — script-only package routes left dependency provenance stale (escaped via PRs #5642 and #5625)

PR #5642 changed the `pr:supersede` script in `package.json`; PR #5625 added `pr:retire` and a
repository URL prefix in `scripts/retirementRecord.ts`. Neither updated release provenance. The
pull-request Release inventory check later reported `Cargo source inputs drifted` because
`package.json` is a fixed source input in `scripts/dependencyLicenseReport.ts`. The sanctioned
dependency restamp then exposed the unclassified URL literal.

Blind spot: a script-only package edit still changes the raw-byte Cargo source pin, and a source
URL literal needs an external-reference assignment even when it only validates input.

Probe: for every `package.json` edit, check its recorded Cargo source digest and require the
dependency restamp artifacts to move with it. For new URL literals under `scripts/`, inspect their
external-reference assignment. Inspect the pull request's Release inventory result on the changed
head; a pass from an earlier head or a retry cannot discharge either obligation.

### 2026-09-09 — one native trace nesting edge never reached equality (escaped via PR #4068)

The helper fixture always ended the AudioWorkletNode handler after its outer callback. Its separate
equal-endpoint case exercised only the author/outer relationship, so reverting the handler/outer
equality rule still left every test green.

Probe that would have caught it: for every nesting comparison the parser validates independently,
add one case with equal end timestamps and one with the enclosure ending a single timestamp unit
early. The first must admit only a unique enclosure; the second and the existing overlap fixtures
must refuse.

### 2026-09-09 — transaction tests skipped the committing window (escaped via PR #806)

The captured-scope test entered only after settlement. It never exercised the separately supplied scope while commit
was publishing, nor a scope entered before commit whose callback continued with a later write, so one guard could mask
the absence of the other.

Probe that would have caught it: publish document A through the real atomic port shape and synchronously re-enter each
scope from its listener. Assert callback entry count is zero separately from cache, document, and pending-write state.
Then enter a scope before commit or abort and attempt `set` and `clear` afterward; reverting only the write-context guard
must fail that case while reverting only a scope-entry guard must fail its callback-entry assertion.

### 2026-10-27 — a held wrapper did not exercise the recording action wait (issue #5517)

PR #5373 (`eecc1c5a8457`) and PR #5658 (`71e358df7415`) retained useful callback/Stop guard tests, but holding a mocked commit wrapper before invoking the real commit does not exercise root replacement after the real action has already entered its snapshot wait. Both PRs explicitly scoped the remaining audio windows out. Exact historical reviewer prompts and tiers are unknown.

Drive actual manual and scheduler-registered audio callbacks into real commitRecording and executeAppAction. A forwarding waiter spy may expose entry, but must return the actual unresolved wait. Hold a real active transaction that has not reserved root; prove one wait entry, no entry yet, in-flight lifecycle and unresolved wait before public replacement and release. Assert raw CRDT, projections, takes, durable action history, undo stacks/tree and the actual mirror against the successor snapshot. Internal recording commands can be omitted from that mirror, so do not invent session contracts or require mirror entry counts. A targeted post-wait guard mutation on a committed head must redden the unchanged owning spec; pair same-root successful completion and guarded stale callback/failure/catch cases. Queue proof establishes authority and history, not physical audio, full fork persistence or browser UI acceptance.

### 2026-09-03 — a native method read off its host and called unbound (escaped via PR #2097)

`electron/scanWorker.ts`'s `nativeCommand` read a napi class method off the addon host and returned
the bare function; `main` then invoked it unbound, so every packaged scan failed with `Illegal
invocation`. The same PR added the identical read in `router.ts` and bound it correctly through
`Reflect.apply(implementation, host, callArguments)` a few files away — one surface handled two ways
in one diff, and nothing raised the divergence.

Blind spot: the spec's fake host used an arrow function for `scanPlugins`, which ignores `this`
entirely, so a bare reference and a properly bound call produced the same passing assertion; the
fake could not distinguish the defect from the fix.

Probe that would have caught it: when a diff reads a method off a native or class host and calls it
later, fake that host receiver-sensitively — a plain function or class method that throws unless
`this` is the host — so an unbound call fails the spec; then diff every call site reading the same
kind of host for consistent receiver handling, and flag one that binds where another does not.

### 2026-09-03 — a missing-environment assertion that read the runner's ambient variables (escaped via PR #3513)

The spec expected the `GITHUB_REPOSITORY` refusal while stubbing neither GitHub variable. Actions
exports `GITHUB_REPOSITORY` to every step, so the runner threw for `GITHUB_TOKEN` instead and the
case failed on every nightly shard while passing on the author's shell. PR #3526 repaired it by
stubbing `GITHUB_REPOSITORY` to `''` before the first assertion and re-stubbing `GITHUB_TOKEN` to
`''` before the second.

Blind spot: a spec that asserts on the absence of an environment variable is only valid if it
controls every variable the code reads, and the stance checked what the spec stubbed rather than
what the runner already exports.

Probe that would have caught it: for any assertion on a missing-environment error, list every
`process.env` name the code path reads before the asserted one and require the spec to stub each of
them explicitly; run the spec once with `GITHUB_REPOSITORY`, `GITHUB_ACTIONS`, `CI`, and
`GITHUB_TOKEN` exported in the shell.

### 2026-09-04 — a workflow comment's claim about a third-party installer read as evidence (escaped via PR #3548)

PR #3548 added the nightly `desktop-measure` leg. Its install step said "BlackHole is a HAL
plugin: coreaudiod picks it up as soon as the cask lands it, so nothing here reboots." The cask's
own caveat prints "You must reboot for the installation of blackhole-2ch to take effect", its pkg
distribution declares `onConclusion='RequireRestart'` with a post-install script that only fixes
permissions, and coreaudiod enumerates `/Library/Audio/Plug-Ins/HAL` only when it starts. The first
hosted run failed at `SwitchAudioSource` with
`Could not find an audio device named "BlackHole 2ch"`. The approval attacked "whether every step's
precondition holds in order on a hosted macos-latest runner" and reported all held, having checked
the claim against the comment rather than the package; actions/runner-images issue 11746 had
recorded the same failure and the `sudo killall coreaudiod` fix since March 2025.

Blind spot: a comment or pull-request body asserting how a third-party installer, runner image, or
external service behaves was accepted as evidence, and a job that cannot run on the pull request
was approved with no run of it at all.

Probe that would have caught it: for every claim about an external component in a workflow diff,
open that component's primary source — the cask or formula, the installer's distribution and
post-install scripts, the runner-image release notes, the vendor's open issues — and quote the line
that supports or contradicts the claim; a caveat, restart flag, or open issue that contradicts the
comment is the finding. When the job cannot run on the pull request, name the first hosted run as
the only evidence and require the pull request's test section to say so.

### 2026-09-06 — a barrel consumer broke 28 mock factories (escaped two stances, #3910)

The head added two `#/modules/AudioEngine/useCases` imports to a MIDI dependency object. Twenty-eight
specs across ten modules mock that barrel with listing factories; the pipeline's Barrel mock
coverage step failed on the head after two test-validity rounds had cleared it, one of which had
this file's 2026-08-29 lesson in its dispatch.

Blind spot: the 2026-08-29 probe was phrased as a manual grep-and-judge sweep, so a stance under
time pressure judged the specs in the diff and the modules the diff touched, never the mocks in
modules the diff never named. Nothing in the changed lines points at them.

Probe that would have caught it: require the pull request's Barrel mock coverage check on the head;
report every `✗` row, named with its spec, barrel, and missing key. Keep local checker execution for
focused checker regressions or a targeted mutation probe of the checker itself.

### 2026-09-09 — storage tests observed one terminal but not reentrant execution (escaped via PR #576)

The adapter tests exercised an ordinary pending write and its final cache value. They never invoked a synchronous
publication listener that called the public flush again, never changed a later selected write during an earlier
preparation callback, and never compared terminal cache against a fresh decode of the actual published document.

Probe that would have caught it: use an atomic publish-then-notify port and assert mutation owner/count, raw document,
adapter cache, fresh decoder, pending count, and later flush. Delete the whole-snapshot claims, restore terminal pending
copying, capture a later write only when its preparation starts, remove callback identity checks, and remove the
post-publication error catch one at a time; each owning case must fail on behavior rather than error wording.

The same probe must publish newer same-slot authority from inside each independently guarded terminal/hydrate callback
and cover both later- and earlier-authored nested scopes. Bypass the authority-epoch check and the ambiguous terminal
call separately; each must leave raw and cache divergent and fail. Include projectors that return `null` and throw with
no configured initial value so nullish fallback cannot silently reinstate rejected document content.

### 2026-09-10 — catalog cases asserted presence, never selectability (escaped via PR #4128)

The catalog spec checked that the creation slots for a track target existed by object type and the
admission spec selected targets and dimensions, but no case selected a clip, notes, or device slot by
its published id and observed the minted authority carrying it. A duplicate-id defect that made
three slots unselectable therefore left every case green.

Mechanical probe: for each published id family (targets, dimensions, constraints, creation slots),
one case must select the LAST published member by id through the real admission and assert it on
the result; then mutate the id minting to collide and confirm that case goes red.

### 2026-09-10 — no fixture ever tied an interval START to the outer callback (introduced in 4266e649b, repeated at 0a4efc74f)

4266e649b's fixtures placed every handler and author start strictly inside or before the
outer callback; 0a4efc74f added the handler/outer equal-END fixture and repeated the
pattern, so both strict START comparisons were never exercised at equality. The first
nightly trace refused 2256 of 24001 callbacks tied on handler start.

Blind spot: the 2026-09-09 probe was phrased for one boundary only, and fixtures followed it
literally without covering both boundaries (start and end) of the nesting pairs.

Probe that would have caught it: for every nesting comparison independently validated, add one
case with equal start timestamps and one with equal end timestamps; for each pair, add a third
with the enclosure a single unit narrower. The equality cases must admit only unique enclosures;
the narrower and existing overlap fixtures must refuse.

### 2026-09-12 — groove identity guards compared object serialization (escaped via PR #471)

PR #471 introduced the extraction and inverse guards in `10bbf0bdcc` and the creation identity
guard in `c166247ea4`. They compared `JSON.stringify` output, so a fresh Automerge projection with
the same template or assignment fields in a different object-key order was rejected as changed.

Blind spot: the fixtures reused author-constructed objects and never crossed a fresh document
projection, while their retry assertions used the same insertion order as the producer.

Probe that would have caught it: cross a fresh document projection for creation idempotence and
guarded inverse checks, construct equal typed values with different top-level and nested key order,
and assert their JSON strings differ. Unchanged values must admit the no-write or inverse path,
while changed timing, dynamics, identity, and array order must still refuse.

### 2026-09-12 — MIDI split fixtures equated absent keys with undefined (escaped via PRs #638 and #1874)

PR #638 rebuilt split-right notes with absent optional fields materialized as own keys whose values
were `undefined`; PR #1874 repeated the shape while adding two expression fields. Automerge's JSON
boundary removed those keys, so the prepared undo guard could never match committed project truth.

Blind spot: the producer specs used `toEqual` with explicit `undefined` properties, an oracle that
also passes when those properties are absent.

Probe that would have caught it: compare generated optional-field objects with `toStrictEqual` or
explicit `Object.hasOwn` assertions before a serialized undo round trip. Require absent optionals to
stay absent, defined zero values to survive, and changed values and array order to remain distinct.

### 2026-09-12 — Replacement clones materialized absent clip fields (escaped via PR #2169)

PR #2169 introduced the shared replacement-clip clone with unconditional `overrides` and
`kneadState` properties. Inserting a captured clip that omitted those optionals therefore produced
own keys set to `undefined`; the strict glue freshness guard then rejected the live replacement even
though its serialized values were unchanged.

Probe that would have caught it: clone snapshots with each optional absent, explicitly present as
`undefined`, and populated. Use `toStrictEqual` plus `Object.hasOwn` to verify exact property presence,
mutate every populated nested container to prove source isolation, then run the connected glue
apply/undo/redo path and retain a changed-value conflict case.

### 2026-09-16 — a merge-conflict fixture left the winning actor to chance (escaped via PR #4292)

The repair-route integration spec cloned the remote side with actor `'b'.repeat(64)` against a local document holding a random `init()` actor, and asserted the remote value won. Automerge picks the concurrent value by greatest opId, actor deciding at equal counters, so about one run in four kept the local value and the spec failed on main with `expected 0.6 to be 0.7` on unrelated heads.

Blind spot: the fixture's chosen actor looked deterministic, and the stance never asked what the other side's actor was or which side the assertion assumed would win.

Probe that would have caught it: for any fixture that merges two concurrent writes to one key and asserts the surviving value, name both actors; if either is random, require the fixture to fix the ordering (an actor that sorts above or below every possible peer) and run the spec with the chosen actor flipped to the opposite extreme, expecting it to redden.

### 2026-09-17 — an arm click waited for a track a fresh project never has (escaped via commit 32179299b)

Two Playwright specs added `await page.locator('[data-testid^="track-arm-"]').first().click()` right after `launch_new_project(page)`. A new project starts with zero tracks, so the locator never resolved and both tests hit the 90 s suite timeout on every nightly run. E2E never runs on pull requests, only on approving-review runs and the nightly train, so Gate never executed the edited specs.

Blind spot: an E2E spec edit was accepted on a Gate that never runs E2E; the added step's precondition (a track exists) was never traced to the fixture (`launch_new_project` yields an empty arrangement).

Probe that would have caught it: for every edited or added Playwright step, name the fixture state the locator needs and trace it to the helper that produces it; run the edited spec locally with `pnpm test:e2e <spec>` as the focused regression check, and inspect the selected PR CI E2E result. A locator whose precondition no helper in the test produces is the finding.

### 2026-10-28 — Grinder shard assertions disagreed with the configured origin (introduced across PRs #5437 and #5723)

PR #5437 added a Grinder-only dev-companion assertion using `localhost`; PR #5723 pinned
`e2eOrigin` to `127.0.0.1` because Vite binds IPv4 loopback. The exact shard assertion therefore
contradicted the shared serving-origin contract and failed in PR #5371's unit suite. Passing adjacent
shard cases did not exercise this pairing.

Probe that would have caught it: run `runs a shard selecting only Grinder PCM parity through its
matching dev companion` with `SOURDAW_E2E_PORT=6123`. Require the companion `baseURL` and both
readiness URLs to use the explicit `http://127.0.0.1` origin. Keep literal expectations so changing
the production origin back to `localhost` makes the unchanged named case fail; deriving expected
values from `e2eOrigin` would couple the oracle to the helper.

### Parameter replay-operation escape — unregistered alternatives hide owner-validation gaps

Session hydration introduced in `4f410257b212bbbd2210fa6553f7aaa3394f69bc` (no associated PR)
accepted unrelated replay types. PR #3328's per-action schema checks and PR #4108's policy-agreement
validator preserved that gap. The #4108 test-validity review mutated policy propagation and agreement,
but never substituted a valid different operation with the same absent policy.

Register both the intended and substituted operation contracts in the real hydration fixture, then
replace inverse and redo independently. An unregistered alternative fails generic admission before
the owner sees it and cannot prove owner validation. Include absent optional metadata, canonical
same-operation entries, and legacy same-operation entries. Revert only the owner's operation-type
check: the unrelated-operation cases must fail because history is admitted, while the positive
controls remain accepted.

### 2026-09-20 — incomplete hosted usage released the admitted estimate (escaped via PR #2648)

PR #2648 converted null input or output counters to zero and finalized the budget attempt, so a partial provider report
could lower the charged ceiling and appear as a complete provider total in route and approval views.

Probe that would have caught it: reserve a real hosted attempt, report each required counter as null independently, and
inspect the lifecycle budget plus the real route and approval projections. The reservation must remain non-final until both
required counters are known; then repeat the complete report and follow it with a partial one. The charge must settle once,
and both rendered cost surfaces must distinguish the pending reservation from a final provider-reported total.

### 2026-09-20 — compatible choice-count rejection lost billed usage (introduced by PR #4407)

PR #4407 kept an OpenAI-compatible response with zero or multiple choices as a typed, retryable protocol failure, but its fixture stopped at adapter rejection and never proved the already-read usage reached run billing.

Blind spot: the protocol-shape stance had no real adapter-to-inference-to-run/cost fixture, so it could preserve rejection identity while dropping the paid result.

Probe that would have caught it: stub a compatible 200 response with two choices and inclusive usage 63/9, drive the real adapter through inference and run accounting, and require one 72-token cost with the original attempt correlation, provider, and model, a typed retryable failure, and zero executable tool calls.

### 2026-09-20 — mocked cancellation hid failed durable revocation (escaped via PR #1949)

PR #1949 (`ce2ffea3fd`) added run-controller cancellation before pending-confirmation settlement,
but its owner spec mocked that controller. The mock could not expose live terminal state advancing
before `Storage.setItem` failed. Use the real lifecycle and cancellation controller, fail the actual
storage write once, then cancel the same confirmation again. Removing the persistence retry must
leave the saved run nonterminal and fail the assertion, both with and without cleanup assets.

### 2026-09-25 — a two-part artifact reader outlived the producer's move to an attempt-scoped name (escaped via PR #4577, introduced the gap PR #4582 widened)

PR #4577 added `scripts/semanticReviewContext.ts`'s `artifactIdentity`, parsing
`semantic-review-<pr>-<runId>` with a hand-written two-part fixture. PR #4582 moved the workflow's
`Upload the advisory report` step to the attempt-scoped `semantic-review-<pr>-<runId>-<attempt>`
(`.github/workflows/semantic-review.yml`) and pinned that three-part template in
`semanticReviewWorkflowContract.ts`, but never touched the reader. Every delivered assessment's
artifact then failed the reader's two-part regex, so `selectAssessmentArtifact` found nothing and
`resolveSemanticReviewContext` recorded `no-assessment` / `absent` for a check that was green: run
36217869489 carried artifact `semantic-review-4793-36217869489-1`, and `review:prepare 4793` wrote
`absent`.

Blind spot: the reader's own spec fixtures were hand-written to the reader's regex rather than
derived from the producer's upload-name template, so a producer-side rename could not turn the
reader's suite red; the producer and consumer of a CI-generated name lived in unrelated diffs, and
no case tied either side to the other.

Probe that would have caught it: for a consumer of a CI-produced artifact, check, or payload name,
derive the spec's fixture from the producer's own definition, with concrete values substituted for
its template placeholders, and assert the reader selects an artifact under that derived name. Then
mutate the producer's shape (add
or drop a segment, as the attempt scoping did) and require the derived case to fail rather than the
hand-written fixture staying silently valid.

### 2026-09-21 — unlinked command fixtures missed inaudible follower writes (escaped via PRs #931 and #4392; fixed in #4506)

PR #931 tested point delegation with a mocked unlinked writer, and PR #4392 tested decibel forms only on unlinked lanes.
For a point-command change, dispatch through real Command and CRDT-backed Automation state, then inspect the raw
document, owning projection, undo history, and `getAutomationValueAtBeat`. A handler-call or stored-value assertion
cannot prove the sampler will use the point.

## Lesson from the PR #645 projection-identity oracle escape

PR #645's selected-range Undo fixture treated a value-equal shallow copy as a stale conflict while successful fixtures
kept the original projection reference. That oracle accepted a guard which rejected ordinary CRDT settlement. Retained
evidence of a real post-settlement Undo probe is missing; historical stance dispatch is unverified.

Flush the production CRDT write and prove equal canonical values with replaced projection identity before actual Command
Undo. Assert raw/projected state, resolved comp coverage, buffer-retention metadata and history through Undo/Redo. Use a
changed clip value as the rejection control; a copied object alone is not conflicting project truth. Replacing fresh
semantic preparation with the retained handle must fail the settled replay case, while weakening intra-publication
guards must fail reentrancy or compensation controls. Include an initially empty lane with later peer fragment facets,
and a write-then-throw after their retirement, so empty captures and rollback cannot disappear behind helper-only proof.

### 2026-09-28 — disposable Git fixtures inherited asynchronous Trace2 writes (escaped via PR #4854)

PR #4854 added disposable Git fixtures whose child commands inherited `GIT_TRACE2_EVENT`; its event writer could
outlive a Git command and race `rmSync` with `ENOTEMPTY`.

Blind spot: the fixture checked Git's validation result but never checked whether an external writer remained active
while the temporary tree was removed.

Probe that would have caught it: run a real Git child under a supplied inherited Trace2 target and prove the fixture
disables tracing for that child (or that the target receives no child events); keep environment restoration in a
`finally` that runs even when recursive cleanup throws. A parent-process environment assertion or a mocked Git child
does not prove the external writer is isolated.

### 2026-09-29 — passing status-bar cases hid a Faust compiler abort (introduced by PR #4904; fixed in #4916)

The EDM status-bar E2E cases asserted rate and latency text but did not observe the console assertion emitted while the effect-free Supersaw loaded. The FaustWasm upgrade review's baseline probes covered node instantiation and passing tests, so they could not distinguish clean compilation from a caught, noisy failure followed by a successful fallback.

Probe that would have caught it: attach to the browser before template loading, capture the full console and exception stack, and require no compiler abort while the real Supersaw and reverb nodes load. Pair that check with the real compiler's factory inputs and an offline `keyOn` PCM assertion; status text alone proves neither clean compilation nor audible output.

When a repair adds a `compile`-named production route, run the device-write boundary closure census and account for each new match by its actual runtime or document effect. A narrow audio spec does not prove the production sink inventory still closes.

## Exact inverses need actual Command, reciprocal capture and hydration proof

The fractional inverse escape from PR #5495 and PR #5578 is detailed in
[moving coordinate inverses](./moving-coordinate-inverses.md#fractional-row-coordinates-and-reciprocal-history-captures).
Integer row figures and a JSON-round-tripped pure planner omit the execution boundary,
the discarded skipUndo description, actual history counterpart refresh and session admission.
Use fractional note, controller and bend figures, real snapshot admission, peer edits before
Undo and Redo, and saved history from both stacks. Mutating restoration, counterpart refresh,
hydration binding or abort metadata restoration must fail the case that claims it. Keep raw
CRDT and projected-store equality; audible equivalence and tolerance assertions cannot prove
exact stored restoration.

For the [macro restoration-hint escape](./moving-coordinate-inverses.md#fresh-macro-commands-must-discard-inverse-restoration-hints)
introduced by PR #5495 and PR #5578, a fixture's expected result must come from
independent real public commands, not retained inverse fields or the normalization
helper under test. Record public history reversion, serialize it, change loop
basis or anchor, and run both routes from an exactly restored common prestate.
Compare full rows and clip state, then check each saved Undo/Redo checkpoint.
Include zero and null restoration hints; keeping only those scalar hints while
stripping coordinate captures must fail the unchanged macro comparison.

### 2026-09-30 — exact payload assertions preserved uncompensable MIDI transforms (escaped at 64b9d77c01a)

PR #939 (`90953dc23e0`) asserted the shared transform helper's complete inverse and redo payloads and
exercised handlers through direct execution before a replay guard contract existed. The checks were
not extended when commit `64b9d77c01a` added guarded compensation preflight or when PR #2747
(`06fb56e3897`) restricted restore replay to guarded actions. They therefore preserved snapshot shape
and ordinary undo while never entering the atomic admission that now rejected the family. No
pull-request number is recorded in Git history for `64b9d77c01a`.

Parameterize every handler registered by the shared transform map through the real atomic executor,
with one undo entry and concrete full-note poststate, undo, and redo oracles. Include deterministic
seed control for humanize. Delete `noteTransformReplayGuard` from the inverse and redo to prove the
case turns red. Separate cases must show invalid initial topology rejects both atomic and direct
execution without notes or history changing, and that stale topology or notes leaves committed undo
pending. A helper-level payload assertion alone is not caller admission proof.

Make the direct-dispatch topology oracle individually load-bearing for every registered transform:
cross each transform with missing, wrong-kind, frozen, locked, and duplicate-ID targets through the
real dispatcher, and assert notes plus both history stacks stay unchanged. One representative action
cannot carry the family-wide claim. For replay, duplicate the clip ID on the same track and on another
track after commit for undo, then again after undo for redo; assert the live notes remain exact and the
blocked history entry stays on its original stack.

## Escape: opaque Bearer fixtures missed complete caller admission

[PR #4491](https://github.com/jcosta33/sourdaw/pull/4491) introduced the screen and
adapter in `9effe3689c72384f30f60971ca40f26a44c0a355`. Issue #5144 exposed a
value-bearing HTTP scheme outside vendor prefixes and secret assignments. Synthetic offline
SDK/CLI captures established admission into request bytes, not real credential disclosure; the
historical stance name, prompt and tier are unestablished.

Compose opaque fixtures at runtime and exercise actual scan, verify, complete request and stance
callers. Assert refusal unconditionally together with zero cache read/write, budget reservation,
recording/provider invocation and delegated fetch; an empty answer or caught provider error is
insufficient. Use a schema-valid would-hit cache, a later unsafe candidate after an admitted
placeholder, repeated calls, ordinary controls and clean independent units. Preserve the separate
serialized-only fixture. On a committed head, removing the recognizer must redden the caller cases,
and bypassing preparation before cache must redden the would-hit-cache cases.

PR #5156's unlanded comment/array repair extended a source fixture to raw line comments,
but its scan hunk still ended at line one. The paired value was on a later line, so the
fixture screened a different input and could not establish the intended withholding.
Derive the fixture's admitted range from the complete multiline binding; preserve an
independent beyond-hunk fallback case. Require the final unchanged fixture to fail when
only the committed recognizer is reverted. A full-source screen assertion does not prove
which region the real scan caller admitted.

PR #5091's head `1297f963` had green single-owner disconnect and direct-root retirement checks,
but the surrounding sweep could abandon a second deleted owner and the Command tail could reach
a replacement root. Use two owners for failure isolation and the real Command commit callbacks
for continuation authority. Assert raw membership, actual owner maps, distinct source edges,
stream stops and strip effects, including replacement between effects. A green owner-key check
alone does not prove terminal release or incoming graph preservation.

An already-granted Auto deletion refusal and an absent-row On permission case do not prove
pending Auto ownership. Settle permission before aborting the real removal transaction; inspect
retained capture and absent strip before rollback, then the original edge after rollback without
reacquisition. Genuine denial and committed ineligibility remain separate controls. Controlled
media and graph ports prove ownership and control flow, not audible input or physical device stop.

PR #5091's head `b2e7491d` covered committed On deletion and pre-commit On admission separately,
but missed a disarmed Auto owner deleted before the optimistic On gesture committed. Keep the
stale On projection visible while actual CRDT truth removes that owner, settle the pending grant,
and assert strip creation, connected edges, capture ownership and exact stream stop count. Pair
the negative with an existing committed owner and a shared survivor; a projected-row removal
or a gesture whose On already committed does not exercise the same admission reader.

The follow-up `3b1c0ad9` deletion check covered absence but left a present owner's committed Off
or input replacement invisible to pre-commit On settlement. Drive these separately through an
initialized committed provider and actual CRDT mutation while the projected On selector remains
unchanged. Require no strip/edge/capture/owner and exactly one stop, then pair unchanged committed
Auto/Off, an unrelated committed rename, shared permission and a current selected-input owner.
A global document revision check rejects the valid rename control; a presence-only check misses
both supersessions. Preserve the committed On latch and actual abort controls independently.

Repair `00f4b688` introduced both fixture defects; the follow-up `46caac58` passed runtime cases
while its test source used quarantined `vca` as a
persisted `TrackKind` and wrote through an unchecked array lookup. The original hosted test types
rejected both. Model kind supersession with a supported non-audio kind and committed Auto; require
that removing kind from the admission's intent comparison makes the unchanged rejection assertion
fail. Guard the actual raw-document owner before mutation, including deletion, so a missing ID
cannot silently splice a shared survivor. Runtime execution does not establish typed fixture
validity; retain the original type failure and verify the repaired source without widening contracts
or asserting away absence.

PR #5091's head `e9672c7966` tested root replacement during outgoing removal and pending grants
during same-root intent changes, but never moved the root while permission itself was pending.
Drive both the optimistic On transaction and real Undo rearm through initialized project access,
replace the root with an identical clone, and settle permission only after proving the runtime root
token changed. Assert `headConsumed` before the Undo grant, zero stale strip/edge/capture ownership,
one orphan-stream stop, then a fresh two-owner successor capture that remains live. Reverting only
the shared admission's original-root fencing, including its retained reader, must fail both named cases; a root-cleanup case and a
same-root intent mutation cannot carry that oracle.

### 2026-10-10 — exact Rust cache fixture omitted rust-std (escaped via PR #5269)

PR #5269's successful exact-hit fixture reported rustc, cargo, rustfmt, and clippy, so it
could not expose that the cache admission omitted the host `rust-std` required by rustup's
minimal profile.

Probe that would have caught it: keep `rust-std-<host>` in the complete exact-hit fixture,
then remove only that component while leaving rustc, cargo, and every TOML extra installed.
Require the exact cache hit to fail before any toolchain-install request; the preserved full
fixture must still pass without installation.

The component registry alone is insufficient: a partial restore can retain its
`rust-std-<host>` entry while losing the host library payload. Keep the registry
entry in the broken fixture, make a one-input `std`-using executable compile fail
at the link step, and require setup to fail before Cargo admission with no install
or success output. The complete exact-hit fixture must pass the same compile
without installation. Also copy a different nightly under the expected directory
name and require its channel manifest date to reject setup before Cargo; a compiler
commit date need not equal the requested channel date.

### 2026-10-11 — warning-only Faust failure produced an incomplete musician export (#5215)

PR #841 (`4edbe587b`) established the construction-error split: unsupported claimed devices refused,
but runtime factory failures warned and omitted the device. Its Faust case asserted that omission;
the dialog's warning case asserted success over a returned buffer. The historical stance dispatch
is unverified. The missing failure mode was an admitted, audible device failing after admission.

Inject a real Faust factory rejection through the musician mixdown's strip and chain, require a
named track/device refusal with no buffer, then require the dialog to perform no encode, write or
download. Exercise grouped stem strips and auxiliary detector keys; a refusal must invalidate the
whole requested set after strategy teardown. Preserve bypass, withheld and non-contributing cases
and degradable agent/freeze callers. A bundled constructor success does not prove refusal after a
later runtime load failure.

## Historical replay fixtures must retain the real producer and reader

PR #5578 repairs newly recorded trim inverses; its capture-bearing fixtures cannot prove
that old saved inverses remain safe. Generate historical actions, document records and the
witness-stamped session mirror with the untouched historical producer. Keep those bytes
and hydrate them with the current production reader before invoking real Undo. A `.sdaw`
file alone does not contain the session Undo mirror. Historical review prompts and model
tiers are unverified; the missing proof joined historical production, current hydration and real Undo.

Assert the actual pending entry, tree cursor and settled mirror alongside raw project
contents. Reverting admission must consume the unsafe entry or alter its coordinates and
fail the named case. Preserve independently produced compatible controls. Historical
trim/slip handlers are singleton handlers, and hydration excludes internal restore
prefixes; synthetic direct groups test defensive APIs, not supported saved grouped history.

Derive hydrated entry counts from the saved mirror: the historical producer may run
setup commands without retaining them in that mirror. Admit the genuine trim and its
keyless inverse unconditionally before checking refusal. A zero-distance regression
must include an unnormalized offset produced with looping off, then enable a loop and
trim at the same start. Preserve its exact saved bytes and require the old reader's
consumed history, absent warning and displaced raw rows to fail the new refusal oracle.
The normalized zero-distance control is also a conservative refusal, not proof that
the current phase identifies the old offset. Keep real current captures of zero and
a whole-loop offset and compare raw owner coordinates through Undo and Redo.

Current loop mode cannot stand in for historical mode. Load the authentic looping
fixture, disable looping through a peer mutation and real projection, then require
visible refusal with all peer state and pending history intact. The original loop-off
MIDI fixture is also a conservative refusal; genuine audio remains the replay control.
When broader refusal makes a former post-wait or prefix test reject from its starting
state, replace that test with an eligible audio target. Hold the actual snapshot wait,
remove the target through public CRDT mutation and projection, and capture the peer
snapshot before releasing the transaction. Moving admission before the wait must
consume history and fail the case. In a synthetic direct unit, a callback prefix that
removes the audio target must remain uncalled: removing only its early guard must fail
full state preservation even though later admission still throws the same error class.
Snapshot all action payloads, history IDs and tree entries while retaining callback
function identity; do not drop callback members or attempt to structured-clone them.

### 2026-10-26 — transient catalog fixtures omitted inspection diagnostics (#5347, caught further in #5730)

PR #5274 (`40baa0716b`) introduced fail-closed file-inspection diagnostics; PR #5365 (`75b10ca71b`)
refreshed whole and scoped catalogs for missing descriptor types while diagnostics still stopped
immediately. Exact historical private reviewer prompts and tiers are unknown. Before merge, #5730's
initial repair retained the diagnostic only at expiry: a later failed process list instead reported
transient-eligible `process-users-unavailable`, without complete replacement proof.

Run `refreshes an incomplete Darwin` whole/scoped cases with complete clear and holder replacements,
persistent diagnostics, and later omissions. Run `keeps a Darwin ... diagnostic stable after` sequence
cases with failed/unusable opening and closing process lists, missing/changed-UID identity, and later
whole/scoped/parent inspection failures. Require retained storage and a stable, non-transient reason
on every inconclusive exit; only fresh complete proof may resolve it. Reverting either refresh route
or restricting stable reason propagation to expiry must fail these cases. Do not pool partial catalogs
or add inspection diagnostics to the warning-success allowlist.

### 2026-10-27 — device deltas assumed live eligibility meant an initialized strip (introduced by PR #2083)

PR #2083 made device edits require an exact live before-chain. MIDI import publishes a track with its default Synth after boot's strip projection, so a lawful Remove Synth before first Play commits project truth and then fails against an absent strip. Its public review caught project-only folders but did not cover an uninitialized live-eligible MIDI track; historical private prompts, models and tiers are unavailable. Play/Stop warming masked the missing admission. Undo also has to change the existing live chain, rather than send an initialization snapshot that can only accept an already matching strip.

Probe the real import, Command/CRDT/history and engine boundary with a completed import, an actually absent strip and no Play gesture. Require clean removal, exact authoritative final topology, and identity-preserving Undo/Redo. Exercise cold add/remove/reorder and grouped final-chain composition; refuse an existing mismatched strip, stale or unrelated project divergence and duplicate ownership. Inject initialization rejection and require committed failure with no later parameter writes. Revert the missing-strip admission and require the cold Command regression to fail. UI admission must require the Remove Synth control unconditionally and click it before first Play.

## Escape: sanitizer tests did not prove project-file admission (PR #4987)

PR #4987 (`62a116ee0073`) tested paired take placement in the take-store sanitizer
and valid saved-lane compatibility, but the file admission predicate ignored the
new fields. PR #4222 (`120c9e2b418e`) had already left the same gap for
malformed `sourceOffsetBeats`. A selected take carrying only `passAnchorSeconds` beside offset zero
passed admission and disappeared with its comp region during real hydration.
The missed input was malformed placement entering the full import route; private
review prompts are unavailable, so do not infer a named historical stance or tier.

Use a current-version file with a canonical project ID and a valid referenced
track and clip, and first prove the valid control is admitted. Reject malformed
placement in both top-level and saved-arrangement take lanes before replacement
of an existing project. Assert raw authority, tracks, arrangement and selected
material remain unchanged. Separately admit a JSON roundtrip of legacy takes and
complete placed passes, including negative finite anchors, and assert exact
selected-take and comp-region retention after real owner hydration. Removing only
placement admission must redden the rejection case; testing a store sanitizer
alone cannot observe the file admission gap.

### 2026-10-28 — dirty-work retention was mistaken for busy-pump delivery (introduced by PR #5461)

The native live automation real-store test held an apply, changed a store, settled the apply, and then explicitly pumped again. It proved that the dirty revision survived, but could not fail when the in-flight pump dropped the only next-frame request. The issue's remaining one-invocation qualification required backend submission after that held request. Historical private reviewer prompts and tiers are unknown.

Capture the actual composed backend batch and leave its apply unresolved. Change each real owning store, call the busy pump once, assert no second apply while the first is held, then settle it and await the session's actual queued work without another pump. Assert the successor's exact target, Hold or Step time, accepted revision, unchanged unrelated queued stamps and one active backend apply at a time. Repeat for refused and thrown predecessors, latest-input coalescing, and stale pass/backend suppression. Reverting the completion scheduling must redden the named case; observing a pending revision or manually issuing another pump is insufficient. The controlled backend proves command delivery, not hardware audibility.
