# Repair and lock recovery

## Thread resolution

Push the fix, then record it with `review:repair`, which runs as the author App
and leaves the thread open. It reads the thread live and refuses one already
resolved, a `--head` that is not the pull request's live head, or a `--commit`
outside `base..head`: an ancestor of or equal to that head and not an ancestor
of the pull request's `baseRefOid`, so the merge base and every pre-pull-request
commit are refused. The repair must also strictly descend the reviewed commit
from the thread root's live `pullRequestReview.commit.oid`; it may equal the
live head. The reviewed commit itself, its predecessors, and commits that do
not descend it are refused. Missing or malformed root review provenance and
unavailable ancestry comparisons fail closed before posting. It binds the
thread's own root comment as
the finding, plus the commit, one-line summary, bounded evidence, and head, and
posts a readable reply carrying one canonical `sourdaw-repair-v1` marker line;
it never resolves. Re-running the same head and commit posts nothing and reports
the already-recorded state.

For ancestry `B -> P -> R -> H`, let `B` be the PR base and `R` the root finding's
reviewed commit. `H` qualifies as the repair even when it is the live head.
`P` predates the finding, and `R` is the revision that received it; neither
strictly descends `R`, so neither can be recorded or confirmed as its repair.

The reviewer confirms with `review:confirm`, a distinct identity from the
author's. It resolves, in one pass with deterministic mutation ids, the threads
whose author-recorded repair validates: same pull request, same thread, a
recorded head equal to or an ancestor of the live head with the repairing
commit still contained in it, finding equal to the thread's root comment,
repairing commit inside
`base..head` and strictly descending the thread root's live associated review
commit (`pullRequestReview.commit.oid`), record well formed, evidence safe.
A re-record on a descending head supersedes the thread's earlier record
(#4589). The repairing commit may equal the live head. Missing or malformed
root review provenance or an unavailable ancestry comparison fails closed for
the whole batch before any confirmation or resolution. It also fails closed —
a refused record, conflicting duplicate records no descending re-record
supersedes, a thread already carrying a
confirmation for a different record or a duplicated identical confirmation, a
rebound identity, a mismatched finding, or a commit outside the reviewed range
resolves nothing and reports the refusal, leaving the operator to fix the
ambiguity and re-run. New reviewer replies carry only a canonical
`sourdaw-repair-confirmation-v1` whole-record digest binding; the full V1 record
stays in the author's reply. One historical full-record reviewer confirmation
remains readable for exact replay. Mixed, duplicated, malformed, or stale
reviewer markers refuse the whole batch before posting or resolving. After a
partial post-success and resolve failure, replay recognizes the same record on
a descendant live head, logs `repair-confirmation-replayed:<pr>:<thread>`, and
resolves without posting a second confirmation.
Both commands acquire the existing per-PR fenced mutation owner before authentication and
hold it through their complete read, selection, write and replay operation. Cooperating
processes sharing the Git common directory serialize with publication, delivery and native
closure commands; another PR remains independent. Deterministic mutation IDs correlate
receipts; GitHub does not deduplicate these requests by ID. This is local process
serialization, not distributed exactly-once execution across separate clones or direct APIs.

Each actual reply or resolve attempt journals the owner before the remote call. A failed
attempt retains the owner and prints its exact recovery command:
`pnpm deliver --recover-lock <pr> --owner <oid>`. After the recorded process fence is dead,
recover through that existing route, then rerun the original repair or confirmation command
with its original bound inputs. Recovery itself posts and resolves nothing. Replay reads
existing records, skips posted confirmations, and ignores threads already resolved; it
completes the remaining work without duplicating authoritative replies.

`review:resolve` is retired. Valid invocations refuse before authentication or
GitHub access; `--help` explains the replacement. Record every repair with
`review:repair` and let the distinct reviewer confirm it with `review:confirm`.
Historical records remain readable, but historical roots do not restore
author-side resolution.
No script writes free-form thread replies; wrongly posted findings have no
discussion route. Clarify code, not threads. Resolve only when the current head
addresses the finding, then obtain a new review. File out-of-scope feedback; do
not grow the PR.

## The delivery lock

`deliver` serializes each PR with a protected-primary Git ref pointing to a
strict owner blob. Acquire with zero-ref Git compare-and-swap; release requires
the acquired object ID. Hold ownership from before authentication through merge
or already-merged recovery and tracker completion. Validate and refuse existing
owners without waiting or automatic takeover, regardless of liveness. Crashes
leave the ref; only `deliver --recover-lock` clears it.

`pr:supersede` and `pr:retire` use this same per-PR owner for every live PR read, replay, comment,
delete, close and compensation. A pre-close refusal releases only after verified
rollback restores the original OPEN comment-ID set and removes every comment the
invocation created; the overall command still fails. This permits corrected
lineage on a later invocation without letting another native closer adopt markers
while their creator can still roll them back. Retaining stale lineage alone would
prevent such a corrected retry.
An acknowledged created comment ID must be observed with its exact owned marker before deletion
and must be absent after the acknowledged deletion. Omission from a later read alone cannot prove
rollback; missing or altered created markers retain the owner without an unverified deletion.

Ambiguous comment results, altered markers, attempted closure and unverified or
failed compensation retain the journaled owner and print its exact recovery
command. After that owner's process fence is dead, use the existing
`deliver --recover-lock <pr> --owner <oid>` route. It can reconcile stable OPEN or
CLOSED unmerged observations, but recovery does not prove supersession complete:
rerun the original closure command with its verified head and complete bound record or lineage.
Closure success is logged only after its mutation owner releases. Retirement preserves its exact
marker and retained owner after ambiguous writes, failed or unverified compensation, or uncertainty
after a close attempt; a verified complete OPEN rollback releases ownership while still refusing.
Both native closers observe the bound PR core again after their marker/review reads and immediately
before the close mutation, without fetching comments in that last observation. They compare PR
number/node identity, head, source, base, state and closure facts. Post-close proof and CLOSED replay
also finish with an independent core observation. A moved or unreadable witness refuses; safe
pre-close compensation remains available, while uncertainty after a close preserves the evidence
and owner. GitHub's `ClosePullRequestInput` has no expected-head comparison, so this bounds the
client's split-read composition gap without eliminating external changes after its final read.

Launch supersession and retirement through the protected primary package route. Their pinned
snapshot closures include the CLI, transaction, GitHub adapter and record parsers;
the launcher freezes POSIX `ps` or Windows PowerShell before the default process
fence is acquired. POSIX snapshots own a detached process group. Calling the
transaction script directly does not supply this trusted process-tool boundary.

Recovery refuses a live recorded process fence, adopts the lock under its own
fence before reading anything, then requires two matching remote reads. It
never merges, retargets, posts, or closes, and accepts only the immutable
author Bot or historical orchestrator User as merger. Clearing records a
dead-owner-keyed receipt; repeat recovery replays it without GitHub access.
The shared owner does not identify the original command. Fresh recovery and receipt replay guide
rerunning that original operation with its original bound inputs; they do not prescribe delivery,
certify completion or authorize a merge. All original operation and delivery gates still apply.

Already-merged recovery accepts the immutable author Bot or historical
orchestrator User as merger; fresh delivery requires the author App and rejects
a fresh orchestrator-user merge. Actor type and immutable ID must agree in both
paths.

## Review-publication lock recovery

`review:publish` and `review:accept` serialize each PR with their own owner ref.
A run that dies after the journal records `remote-mutation-attempted` but before
GitHub answers leaves a dead owner that recovery can neither release nor replace
with a releasable one: the journal cannot prove the POST never landed, so the
default refusal has to hold, and adoption only re-creates the same refusal.

`review:publish:recover` refuses a live fence, authenticates the recorded
publication identity, and requires the retained payload digest to match the
bundle document plus two stable inspections of the same head. When the journal
itself proves no mutation landed — the owner is still `prepared`, or it carries
an HTTP 422 marker — absence releases the owner, and its receipt makes repeat
recovery idempotent without GitHub access.

The live main ruleset dismisses a reviewer approval when the pull request head moves
past it, so a landed approval then reads back as DISMISSED. Recovery accepts that one
state difference, and only for the reviewer App's APPROVE document once the live head
differs from the journaled head; every other field must still match exactly. It binds
the publication, records no delivery authorization (a dismissed approval of a stale head
authorizes nothing), and releases the lock. A DISMISSED review on an unmoved head, a
dismissed REQUEST_CHANGES, or a dismissed review from another actor keeps the
ambiguous-or-non-exact refusal. A dismissed exact copy of the document from any actor
other than the sanctioned other publication identity (the reviewer App or the
orchestrator) is refused as unauthorized landed review evidence, exactly as a live copy
is, whatever the head or event: unlike the reviewer's own dismissed approval, it needs
neither a moved head nor an APPROVE document to be refused. The two
inspections must agree: an approval that stands at the first read and is dismissed at
the second refuses as a change during reconciliation, moved head or not.
`review:publish` and `deliver` never treat DISMISSED as live.

`--attest-absent` is the operator's explicit assertion that the review POST never
landed, and it is the only path that releases an owner whose sole failing
condition is a missing definitive answer. It is legitimate only after
independently establishing that the remote holds no review at the journaled head
— for instance, the owning run has been dead long enough that a landed POST
would be visible. The flag adds one term to the release decision; every other
protection still runs and keeps its refusal: a live fence, ambiguous or non-exact
landed review evidence, unauthorized landed review evidence, a payload digest
that differs from the retained lock, and a missing or mismatched bundle. The
release records the operator attestation in its own receipt version rather than
inferring it from an older receipt, so replay distinguishes it from a
journal-attested absence and a receipt that did not record it never gains it.

## Receipts

Same-head delivery receipts preserve the issue-comment REST endpoint's
ascending comment-ID order for adjacency and newest authority; timestamps only
prove App-owned comments remained unedited.
