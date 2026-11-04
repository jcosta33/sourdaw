# Lane publication and maintenance

`branch:prune` defaults to dry run and deletes only branches whose every PR is
merged or closed. It retains a branch that is the last remote holder of a
measurement source revision a tracked table records, because the admission
resolves that revision by SHA and squash delivery never lands the lane head on
`main`. A recorded revision the remote independently confirms is gone is
reported by name and skipped, so one stale table entry cannot abort the run; a
branch that merely cannot be compared holds nothing and is passed over, while
any comparison that cannot be answered still refuses and deletes nothing.

## Claim at lane open

Two agents taking the same work waste both. Before `lane:open`, read
`git worktree list` and `gh pr list --state open` for a lane or PR already on
the same issue or surface; a lane or PR you did not open is another agent's
claim and is read-only for you.

Opening a lane stamps the worktree's git config with the author App's commit
identity — `hplovecraft208[bot]`, keyed to its immutable database id
318698904, unsigned — so lane commits attribute to the App without any
credential; `pnpm lane:identity` restamps lanes opened before that stamp
existed.

An issue-bound lane claims its issue in the same step: `lane:open` prints
the command, and `pnpm issue:claim <issue>` — run from the protected
primary checkout — adds the `status:active` label, removes every other
`status:` label, and moves every board item holding the issue to In
progress, reading the project's field and option ids live. The script
refuses an issue that already carries `status:active`, making an existing
claim visible before work starts; the check is read-then-write, not
atomic, so the survey before `lane:open` remains the guard against two
claims racing in one window. After delivery, verify the issue is closed
and the board item reads Done; project automation may not move it.

An issueless lane's worktree and PR are the claim: choose a slug that names
the change precisely and publish early, before the head is final if
needed. Work that outlives one lane or session — a campaign, or a hand-off to
another agent — is filed first so each lane binds to the issue that
carries it; a change one lane can land stays issueless.

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

For conforming lanes (typed or legacy `agent/`), `lane:publish` opens a PR titled from the newest
non-merge lane commit, excluding everything reached by resolved `origin/main` and stack parent
heads; it refuses lanes lacking one. Existing titles stay frozen through follow-up commits and
merges unless `--title "<conventional-subject>"` explicitly supplies the creation or replacement
title. The same effective title governs body validation, derived metadata, and branch-type
warnings. Off-convention legacy lanes refuse `--title` and remain push-only. The body
follows [`.github/pull_request_template.md`](../../../../.github/pull_request_template.md);
the script controls format and rejects malformed bodies. New PRs require
explicit `--summary` and `--test`; later supplied flags replace their section,
omitted flags preserve it. A product-scope change — any handwritten path under
`src/modules/`, `src/components/`, or `electron/` — refuses a `--test` in
which any sentence, clause, or line narrates a command or names specs, suites,
or CI; it must teach only user/reviewer-observable steps and their expected
result, with an app launch folded into the step that uses it, while a body
preserved from an existing pull request is not re-judged. Publishing neither enables auto-merge nor posts
reviews.

`lane:publish` targets `main` for ordinary lanes and the verified parent branch
for registered stack children.

Publishing gates authorship on exactly the commits it adds to the pull-request
branch (the notes ref the push also carries is the tool integration's own
channel, not publication the gate governs): the remote tip when the branch
already exists there at an ancestor of the head, otherwise the same base the
title derives from — always excluding what the resolved bases reach, both
origin/main and any stack parent head, because commits they already carry are
not the lane's to author. Every remaining commit, merges included, must carry
the author App's commit identity; a refusal names each offending commit and
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

### PR body

Write for a teammate outside the session. Under template headings explain what
changed and why, without repeating the title, and how to test. How to test is
the reviewer's script in the app: what to open, click, play, or export, and what
they should see or hear. Product changes carry only those steps — unit, E2E,
typecheck, lint, and CI runs do not belong beside them, because the reviewer does
not re-run them and the checks list already shows them. Internal or developer
work with no app surface exercises the tool an operator runs and what it prints
or refuses, not the specs covering it; only a test-only change names its specs.
The template has no Screenshots section; agents never attach one. Exclude
session diaries, unpublished rounds, mutation tables, and test-run inventories.
