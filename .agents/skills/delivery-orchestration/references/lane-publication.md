# Lane publication and maintenance

Follow the [delivery path](../SKILL.md#delivery-path) to open and publish a lane. Consult this
reference for branch, claim, title, body, and tracker behavior.

## lane:publish mechanics

A lane branch is `<type>/<issue>/<slug>` or `<type>/<slug>`, where `<type>` is a
conventional-commit type (`feat`, `fix`, `chore`, `docs`, `test`, `refactor`,
`perf`, `build`, `ci`; never `style`) chosen at `lane:open --type`. The legacy
`agent/<issue>/<slug>` and `agent/<slug>` shapes of lanes opened earlier are
recognized by every script exactly as typed ones are; new lanes never use
`agent/`. `parseLaneBranch` in `scripts/prContract.ts` is the one reader: only
the first segment is the type, a numeric middle segment without a leading zero
is the issue (a number inside a slug is never an issue), and a slug is
dash-joined lowercase words that is never purely numeric, so `fix/12-beat` is an
issueless slug and `fix/12/34` is refused. A name is at most 100 characters
(`MAX_LANE_BRANCH_LENGTH`). Any other name, an unknown type included, is not a
lane branch.

An issue number resolves its lane by that parsed issue segment, across types and
legacy prefixes alike (two lanes carrying the same issue need `--lane`); `--lane`
names an exact absolute lane root, which is what disambiguates write-disjoint
lanes sharing one issue.

Off-convention legacy lanes refuse `--title` and remain push-only.

`lane:publish` targets `main` for ordinary lanes and the verified parent branch
for registered stack children.

Publishing gates authorship on exactly the commits it adds to the pull-request
branch (the notes ref the push also carries is the tool integration's own
channel, not publication the gate governs): the remote tip when the branch
already exists there at an ancestor of the head, otherwise the same base the
title derives from — always excluding what the resolved bases reach, both
origin/main and any stack parent head, because commits they already carry are
not the lane's to author. Every remaining commit, merges included, must carry
the author App's stamped identity as both author and committer (name and
email). The gate checks recorded git identity, not provenance: lane config can
forge it. A refusal names each offending commit and
email. Publication also refuses outright while the lane repository's shared
object store carries rewrites a push bypasses — an `info/grafts` file in the
common dir or any `refs/replace/*` ref — because `git log` follows the graft
file even with `--no-replace-objects` and the replace-refs disable applies to
the gate's read alone. The remedy: restamp with `pnpm lane:identity`, then —
only when the remote branch holds none of the lane's commits AND the
comparison base dominates every excluded base (it is origin/main itself, or a
parent head that already contains current main) — rebase from the comparison
base with
`git rebase --rebase-merges --exec 'git commit --amend --reset-author --no-edit' <comparison-base>`;
otherwise, when no offered rewrite can stay off base-side history, re-create
the named offending commits. Never a rewrite rooted at the remote tip: it
would replay base-side commits as the App.

Labels and milestone are written by the author App. Project membership is not:
installation tokens cannot reach user-owned Projects v2, so the project listing,
the issue's and PR's own membership, and the `--add-project` write all go through
the verified operator credential, in a second edit. Without that credential an
explicit `--project` refuses, and every other case logs one line and leaves
membership to the operator backfill — the rest of the publish still lands. An
issueless lane derives its project from its derived type label and keeps it only
when the live listing names that project.

When a typed branch's type differs from the type of the title the PR will show
(the explicit `--title`, otherwise the newest lane commit on a first publish or frozen title afterwards),
`lane:publish` logs a `warning:` line and publishes anyway: the branch name
cannot change after `lane:open`, and a `feat` lane routinely ends on a `test:`
or `chore:` follow-up. `agent/` lanes name no type and never warn.

Author-locked off-convention branches (any name `parseLaneBranch` rejects) may publish via `--lane <absolute-path>`
only with an already open PR for that exact branch, proving it a genuine
stranded lane. This path only pushes; it never writes PR title or body and
refuses if the PR is no longer open when the push lands.

## branch:prune

`pnpm branch:prune [--apply] [--limit <n>] [--branch <name>]...` defaults to
dry run and deletes only branches whose work reached `main`: every PR on the
branch is closed and one merged into `main`. A branch whose PR closed unmerged,
or merged into another base, is kept. Deletion is a compare-and-swap on the
branch tip, so a branch that moved since the read is kept. Each
`--branch` narrows the run to that remote branch and refuses a name the remote
does not list; pass your own spent branches so a prune never decides another
agent's. It runs through the trusted launcher, so only from the protected
primary checkout. It retains a branch that is the last remote holder of a
measurement source revision a tracked table records, because the admission
resolves that revision by SHA and squash delivery never lands the lane head on
`main`. A recorded revision the remote independently confirms is gone is
reported by name and skipped, so one stale table entry cannot abort the run; a
branch that merely cannot be compared holds nothing and is passed over, while
any comparison that cannot be answered still refuses and deletes nothing.

## Issue claims

An issue-bound lane claims its issue in the same step: `lane:open` prints the command, and
`pnpm issue:claim <issue>` — run from the protected primary checkout — adds the `status:active`
label, removes every other `status:` label, and moves every board item holding the issue to In
progress, reading the project's field and option ids live, and reads the label swap back before
moving any board. It reads and validates every board the issue sits on before its first write, so
an issue on more boards than one read covers, or on a board whose Status field is unreadable or has
no In progress option, refuses with nothing written. The script refuses a closed issue and an issue
that already carries `status:active`, making an existing claim visible before work starts. Two
claims racing past that check are decided by a claim comment: after its label swap each claim posts
one comment carrying a fresh token, then reads the issue timeline, and wins only when its token is
the only such comment the operator wrote since `status:active` was last removed. Only the winner moves the boards; every
other claim withdraws its own comment and refuses, naming the other claim comments it saw. Two
exactly simultaneous claims can both refuse, never both win. The winning comment stays on the
issue as the claim record. A refusal after the label swap leaves `status:active` on the issue; when
no lane holds it, release the issue by removing the label and claim again. A board move that fails
after the claim has won leaves the claim standing and names each board to move by hand.

An issueless lane's worktree and PR are the claim: choose a slug that names the change precisely and
publish early, before the head is final if needed. Work that outlives one lane or session — a
campaign, or a hand-off to another agent — is filed first so each lane binds to the issue that
carries it; a change one lane can land stays issueless.

## Titles and pull request bodies

- **Title.** For conforming lanes (typed or legacy `agent/`), a first publish titles the PR from
  the newest non-merge lane commit, excluding everything reached by resolved `origin/main` and stack
  parent heads; it refuses a lane lacking one. The title then stays frozen through follow-up commits
  and merges unless `--title "<conventional-subject>"` supplies the creation or replacement title.
  The same effective title governs body validation, derived metadata, and branch-type warnings.
  Every publish, follow-ups included, also checks that newest lane subject against `TITLE_PATTERN`
  in `scripts/prContract.ts` (`feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`, `build`,
  `ci`; never `style`, one line, no control characters) and refuses with `pull-request title is not
conventional` when it fails. Every title source is also refused when it carries an issue-closing
  reference, because the title becomes the squash commit subject on `main`, so
  the newest lane commit needs a conventional subject before every publish, and on the first
  publish it is the subject the PR should show.
- **Body flags.** The body follows [`.github/pull_request_template.md`](../../../../.github/pull_request_template.md);
  the script controls format and rejects malformed bodies. A new PR requires explicit `--summary`
  and `--test`; on later runs a supplied flag replaces its section and an omitted flag preserves it.
- **Product-scope How to test.** A product-scope change — any handwritten path under
  `src/modules/`, `src/components/`, or `electron/` — refuses a `--test` in which any sentence,
  clause, or line narrates a command or names specs, suites, or CI; it must teach only
  user/reviewer-observable steps and their expected result, with an app launch folded into the step
  that uses it, while a body preserved from an existing pull request is not re-judged.

Write the PR body for a teammate outside the session. Under template headings explain what changed
and why, without repeating the title, and how to test. How to test is the reviewer's script in the
app: what to open, click, play, or export, and what they should see or hear. Product changes carry
only those steps — unit, E2E, typecheck, lint, and CI runs do not belong beside them, because the
reviewer does not re-run them and the checks list already shows them. Internal or developer work
with no app surface exercises the tool an operator runs and what it prints or refuses, not the specs
covering it; only a test-only change names its specs. The template has no Screenshots section;
agents never attach one. Exclude session diaries, unpublished rounds, mutation tables, and test-run
inventories. The author brief's approach and reasoning stay out of the body.

## Models and tracker metadata

A lane records its authoring model when opened: `--model <model>`, the lowercase public name of
the model itself, keeping every qualifier that distinguishes capability or edition within the
family (flash, mini, pro, air, codex, thinking) and dropping only deployment-routing prefixes and
date-snapshot suffixes. `lane:publish` labels the PR with the model's bare name and carries the
bound issue's milestone and project membership. `--milestone` and `--project` override those
values by open title on any lane. Leave either empty when none applies. The PR carries the
repository's descriptive
labels: the bound issue's labels minus the `priority:` and `status:` namespaces, or on an issueless
lane one type label derived from the conventional subject (`feat` → `enhancement`,
`fix` → `bug`, `docs` → `documentation`); `--label <name>` adds more by live canonical name, and
descriptive labels are never created on demand — only authorship labels are, identified by their
`Authored by ` description.

If the author uses a different model, publish with `lane:publish --model <actual-model>`. This
replaces the recorded `branch.<branch>.sourdaw-author-model` and superseded `Authored by` label.

`lane:open` stamps `hplovecraft208[bot]`, keyed to immutable database ID 318698904, as the unsigned
commit identity without using a credential. Run `pnpm lane:identity` to restamp an older lane.

## Issue filing and reconciliation

Every issue needs priority, status, and descriptive labels. On `issue:file`, set an applicable
milestone by title, never UI number (validation against **open** milestones rejects it before filing),
and roadmap project membership when applicable; leave either empty rather than force a fit.
Sourdaw Features auto-add requires `project:features` and excludes `bug`; unfiltered sub-issue
inheritance is disabled because it cannot filter by category. Feature, Spec, and Campaign forms set
the route label. Generic Task, Audit, Research, and Inventory forms remain neutral: select
`--project "Sourdaw Features"` with `issue:file` or add the label manually when they belong there.
Selecting Bugs or Refactors removes the Features route, and Bug or Change plan forms cannot target
Features.
No sanctioned script edits existing issues beyond the claim and reconciliation — `pnpm issue:claim
<issue>` swaps the status labels, posts its claim comment and moves the boards, and `pnpm issue:reconcile` applies
digest-guarded body edits and closures at delivery; later corrections require manual `gh`, as does
backfilling a pull request's own labels, milestone, or project membership when it predates
`lane:publish`'s metadata assertion. Read live metadata
with `gh label list`, `gh api repos/:owner/:repo/milestones`, and `gh project list --owner <owner>`,
never a recorded list.

`issue:reconcile` performs the delivery-time reconciliation `deliver` does not perform itself, in two
modes: replacing exact text in an open issue's body (an `--edits-file` JSON array of 1–64
`{ "from", "to" }` entries, each `from` matching exactly once), or closing an issue as not planned
with one `Superseded by #<n>.` comment naming an open replacement issue. Both refuse unless
`--expected-body-sha256` equals the SHA-256 of the issue's current body. Later corrections to an
issue use manual `gh` under AGENTS.md [Artifacts](../../../../AGENTS.md#artifacts).

## Stack synchronization

Publish a stack parent first. `lane:publish` validates the child descriptor as untrusted data and
targets the exact open parent head, or `main` after the recorded parent PR has merged. Landed-child
publication and approval require both the verified final parent head and its landed commit in the
child history. A moved, missing, ambiguous, closed-unmerged, or racing parent blocks publication.
`pnpm lane:sync-parent --lane <absolute-child-lane>` merges the verified current parent head into
only that clean owned child. After the parent squash lands, it merges the verified final parent head
first, then the exact parent squash commit, then fetched current `main`, preserving all parent and
child history while retaining later main edits and reversions. Resolve a conflict at any merge in
the child, commit normally, and rerun synchronization. Never rebase,
reset, force-push, cascade to siblings, or silently adopt a replacement parent. Deliver remains
bottom-up and main-only; sync the child, then publish and obtain fresh Gate and review.
Keep earlier slices related with `--relates` until closure is warranted, and verify the original
end-to-end outcome on the final combined head.

See [historical stack admission](../historical-stack-admission.md) for a child without a descriptor or fork marker.
