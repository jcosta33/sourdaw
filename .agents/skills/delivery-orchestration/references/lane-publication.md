# Lane publication and maintenance

Claiming, titling, body flags, and the PR body live in the
[delivery path](../SKILL.md#delivery-path); this reference holds the rest of `lane:publish`.

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

## branch:prune

`branch:prune` defaults to dry run and deletes only branches whose every PR is
merged or closed. It retains a branch that is the last remote holder of a
measurement source revision a tracked table records, because the admission
resolves that revision by SHA and squash delivery never lands the lane head on
`main`. A recorded revision the remote independently confirms is gone is
reported by name and skipped, so one stale table entry cannot abort the run; a
branch that merely cannot be compared holds nothing and is passed over, while
any comparison that cannot be answered still refuses and deletes nothing.
