# Closure and retirement

`pr:supersede` refuses to close a superseded pull request until every live
review thread on it has exactly one recorded disposition on the replacement.
Each finding is the decimal database id of a review thread's root comment, as
GitHub reports it. The caller writes that total map as a `FindingLineage` JSON
document and passes its path with `--lineage`; both the bare JSON object and the
rendered marker form are accepted, `oldPr`/`replacementPr` must match the
invocation, and a missing, unreadable, or malformed file refuses with the path.
The transaction then posts the receipt plus a second lineage marker, converges
duplicates to exactly one of each, and closes only afterwards, so a re-run after
a partial transaction repairs rather than duplicates.

`pr:retire` closes an owner-released obsolete PR without asserting a merged replacement. The
caller supplies a canonical `retirement-v1` JSON record with `pr`, `head`, `base`, a one-line
`rationale`, 1–8 repository evidence URL/observation pairs, a total `findings` list of live root
comment/thread IDs and native author repair/reviewer confirmation comment IDs, and `reviewBodies`
mapping each `REQUEST_CHANGES` review ID to its inline roots and `bodyDigest`, the lower-case
SHA-256 digest of that exact review body's UTF-8 bytes (without trimming or normalization).
The command checks this binding initially, before marker writes, before closing, after closing,
and on closed replay. Unbound historical records and markers refuse; they cannot authorize a new
close or replay and must never be adopted as bound evidence.
Each review proof reads both complete review-thread and requested-changes-review connections in
one GraphQL response. Eligibility is bounded to 100 threads, 100 requested-changes reviews and 100
comments per thread, with every `hasNextPage` false. Missing, malformed or truncated connections
refuse without pagination or stitching separate responses. One response does not establish
GraphQL resolver atomicity or prevent later changes.
The command refuses an unconfirmed
or unresolved root, unmatched review body, changed head/base/root set, or ambiguous role actor;
it posts one author-App marker and closes through the native transaction. The reason, evidence,
and mapping of review prose to inline roots are caller attestations, not machine proof of
obsolescence. A review body with a distinct finding that cannot truthfully be mapped to a
confirmed inline root remains a refusal; there is no discard or body-only admission in this
version. This does not change `pr:supersede`, review, Gate, or delivery rules.
The selected reviewer confirmation's decimal comment ID must strictly follow the selected author
repair's ID; identity and a matching repair digest alone do not establish that chronology.
Caller-selected IDs must identify the whole thread's authoritative native repair and sole
confirmation. Retirement reuses native author-record supersession and reviewer replay selection,
including historical full-record confirmations; another authorized conflicting repair or duplicate
confirmation refuses. Older author records require verified ancestry before a descending record
can supersede them. Plain or foreign replies do not gain authority. This does not restrict the
original finding's actor or require every root to originate in a requested-changes review.
Closed replay refreshes PR identity and canonical marker identity after the review proof and
refuses movement between those observations. It cannot fence changes arriving after its last read.

The replacement normally targets the old pull request's base exactly. A child
left behind after its stack parent was natively superseded may cross that base
only with `--superseded-parent <pr>`. The named parent must be closed without
merge, own the child's old base branch from the child's base repository, target
the replacement's base (or prove the completed nested binding below), and carry exactly one canonical author-Bot supersession
receipt and one total finding lineage marker naming the merged replacement. The
child's live `baseRef` must name that parent branch in the child's repository and
target the parent's final head commit. The parent's final head must also belong
to the old child's immutable history. When that head advanced after the published
child, only the existing native registered lane provenance can establish the
historical association: the protected-primary descriptor and matching
`branch.<child>.sourdaw-stack-fork`, exact child/parent branches and parent PR,
and the recorded fork commit retained in both old child and final parent. This
uses the existing same-account native provenance boundary, not cryptographic
ownership. A missing descriptor is never reconstructed from shared ancestry,
reviews, workflow associations or prose. A reused branch name is insufficient.
Any observed cached child `baseRefOid` must belong to both histories during fresh
admission; that cached commit alone is not parent provenance. The command
snapshots the live ref's repository, name
and target, re-reading the child after the parent proof at each mutation boundary.
It checks the child's finding set after that last remote proof immediately before
close, and again after the final post-close proof, so a finding added or removed
during parent inspection cannot inherit an earlier coverage check.

Stacked closure posts a third canonical author-Bot
`sourdaw-supersession-parent-v1` marker binding the child, parent, both replacement
identities and immutable commits to the admitted provenance kind, fork and cached
base. It participates in exact observation, convergence, journaled writes,
compensation and ambiguous-write retention alongside receipt and lineage.
An already CLOSED child may replay without writes after its live base ref or
local lane metadata has been deleted only with exactly one strictly parsed,
canonical authorized binding marker, receipt and total lineage. Replay uses the
stored historical fork and cached base, verifies current identities and immutable
ancestry, and refuses a present contradictory descriptor or live ref. A later
cached base does not rewrite the admitted history. An old two-marker completion
cannot acquire this binding during CLOSED replay. The distinction confirms an
existing completion only and cannot admit fresh closure with an absent live ref.

The command revalidates that live parent proof before the first child write, before
closing, and after closing before reporting success. A refusal before writing
leaves no child mutation, a refusal after adding child markers compensates those
markers, and a post-close authority failure reports ambiguity while retaining
all the closed child's markers as durable evidence.

When the parent was superseded by a different merged PR, name it explicitly with
`--parent-replacement <pr>` after `--superseded-parent`. All four PR identities
must differ. Both replacements must target `main`; the old parent must target `main`
or supply the completed nested-binding proof described below. The old parent's
canonical receipt and total live finding lineage must name its own
replacement, while the child keeps its independent lineage to the child
replacement. The parent's replacement merge commit must be an ancestor of the
child replacement's source head. The read-only comparison binds the repository,
ordered full commit SHAs, base object, merge-base object and terminal descendant
commit. The comparison has no paging parameters, so GitHub's terminal returned
commit remains the newest even when its list is capped at 250. A branch match or
status alone is insufficient, and unavailable evidence refuses. This path
snapshots and revalidates all four identities, merge commits, parent markers and
both old PR finding sets before the first child write, immediately before close,
and after close. Each proof ends with independent core reads of every replacement
and parent after the final dependent marker and thread reads, followed by the
child's final core read. CLOSED replay uses the same final authority witnesses.
These client reads cannot exclude changes after their respective observations.
Pre-close refusals use the same marker compensation; post-close
failure reports ambiguity and preserves the closed child's markers. The option
does not infer a new parent from prose, retarget a branch, or change a registered
stack. Ancestry proves dependency containment, not semantic replacement or product
acceptance; those remain independently reviewed caller obligations. Historical
same-base supersessions and the existing same-replacement parent path do not
require this additional merge-commit proof.

A closed parent that itself crossed a superseded parent's base can authorize the next child only
through its existing canonical completion. The command revalidates that parent's receipt, total
live finding lineage and exact authorized parent-binding marker recursively, to the original
one-level proof. The parent's recorded replacement must equal the selected parent successor:
`--parent-replacement` when supplied, otherwise the child's replacement. Every distinct replacement
merge must belong to the corresponding child replacement's immutable source history. Sharing one
replacement across adjacent levels does not require its squash merge to occur in its own source.
All original parent identities, historical provenance, cached-base ancestry and present live refs
remain required; only an already completed node can use its stored binding after ref/ledger cleanup.

New nested completions write `sourdaw-supersession-parent-v2`, binding the immediate parent's
completion comment node ID, decimal database ID and exact canonical v1/v2 payload. The v1 schema,
bytes and existing one-level admission remain unchanged; replay never upgrades a completion.
Strict parsing refuses unknown or duplicate fields, contradictory repeated identities, cycles,
more than 32 binding levels or a marker exceeding 60,000 UTF-8 bytes. Before any child write, before
close, after close and on CLOSED replay, the full ancestor proof and all original finding sets are
revalidated. Final dependent marker/thread reads are followed by independent core witnesses for
every unique parent and replacement, then the child's final core. Ancestors are read-only. The
existing child owner, marker convergence, verified pre-close compensation and post-close ambiguity
retention apply to v2 unchanged. These are finite client observations, not a remote atomic snapshot.
