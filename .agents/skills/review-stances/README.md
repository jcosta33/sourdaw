# Review stances

This directory is a lesson library keyed by defect class: the standing probes, escape lessons,
and shared principles that bind them.

## Stance derivation and the lesson library

Stances are derived per task, never selected from this directory. Enumerate the material risks the
diff creates, name one stance per risk, and record each completed draw in `review.json`'s `draws`;
the root `AGENTS.md` Review section carries the rule and the risk plan's floor.

Every completed draw becomes durable evidence: `review:publish` derives the head-bound `dossier-v1`
record from `review.json`, so stance names, models, tiers, and outcomes enter it
([ADR 0054](../../decisions/0054-proportional-machine-checked-review-floor.md)).
Name stances by the failure mode that admits them so that record stays meaningful to a cold reader,
and keep every recorded value single-line and free of credentials or transcript material — the
contract's parsers refuse anything else.

For a fresh plan-carrying publication with findings, each `comments[]` entry declares a non-empty
`sources` array of `{ stance, reviewerModel }` pairs naming the completed draws that independently
detected that finding. Match pairs by both fields; array order does not imply execution order. This
is declared provenance, not proof that a model actually ran. Historical records with unknown
attribution keep it unknown; do not invent sources or rewrite their evidence. The
[document parser](../../../scripts/reviewDocumentParser.ts) and
[publication builder](../../../scripts/reviewDossierPublication.ts) own the validation and compatibility
rules.

This directory is a lesson library, not a menu. Each file collects standing probes and escape
lessons for one defect class, and the matching key is the risk the stance attacks — never the
files the diff touches. A stance carries the most specific matching file and never a broader one
in addition; a stance matching no file dispatches without one. An escape attaches to every file
whose probes participate in what would have caught it, or mints a new file for a defect class
none covers.

Release tracked-set drift lessons live in `test-validity.md`.

## Reviewer isolation

A reviewer reads the fixed commit with `git show <sha>:<path>` and the bundle under
`.agents/review-bundles/<pr>-<sha>/` by default. Review remains blind and independent: findings go
to the orchestrator, never to GitHub, and authors do not judge their own findings. Reviewers never
create a worktree or clone, or install or upgrade dependencies for review.

When a check or mutation probe needs execution, the orchestrator may grant an explicit exclusive
handoff of the author's existing lane. The handoff names the absolute lane, branch, reviewed SHA, permitted
mutation paths, exact checks, and holder. The author stops all writes and check processes before
handoff; only one writer or probe holds the lane at a time. Before execution, the reviewer verifies
the branch and HEAD match the handoff and reviewed SHA and tracked state is clean. Never probe
uncommitted work. Save the original bytes of every planned mutation path before changing it. Use the
lane's existing private install and the prescribed guard and test wrapper; do not install, upgrade,
switch branches, stage, commit, or push.

Wait for the probe and all its processes to exit. Restore only the planned mutation paths from the
saved bytes, then verify their original bytes, branch, HEAD, and clean tracked state before handback.
Leave untracked files and credentials untouched. If any unexpected change appears, stop and report
it without overwriting it. If a handoff or execution is unavailable, report the precise mutation,
named check, and limitation; the orchestrator arranges author execution. An unrun probe is not a
pass, and no alternate worktree or clone is allowed.

Run the probe through `pnpm test:run`, never `pnpm exec vitest run`: the same wrapper fails a run
that collects no case or executes no assertion, while a bare vitest invocation can exit 0 on an
empty collection and read as a pass.

Formatting must select the owned file from the owned checkout. Run the formatter with the lane as
its working directory and lane-relative targets; an external installed formatter binary is fine.
Check its file-info result or output when selection is uncertain. An ignored file or a zero exit
status alone does not prove formatting ran. For a tracked README that ignore rules exclude, an
explicit `--ignore-path /dev/null` is acceptable when targeting only that file.

Each existing checkout that runs pnpm needs its own install rooted in that checkout. Never symlink,
junction, or copy another checkout's `node_modules`: pnpm can overwrite the owner's install records
and abort its next trusted delivery script ([issue #4505](https://github.com/jcosta33/sourdaw/issues/4505)).

A probe can fail for environment reasons unrelated to the head. Record the limitation, the named
spec, and the corresponding claim as unverified; the orchestrator must arrange execution where the
environment exists. A mandatory mutation-and-named-spec baseline probe remains undischargeable until
it runs. A spec that derives a `node_modules` or binary path from its file location or working
directory can swallow ENOENT and exit 1 like a head regression; classify from the spec, not the
artifact. `scripts/__tests__/checkProjectLicense.spec.ts` and
`scripts/__tests__/agentDeliveryScripts.spec.ts` are examples.

### Existing legacy probe worktrees

The following cleanup procedure applies only to already existing legacy probe worktrees. It does not
authorize creation of new reviewer worktrees.

Cleanup is controlled by the orchestrator. A reviewer may clean up only the exact probe worktree explicitly assigned in its task; otherwise leave it registered and report its path. For assigned cleanup, first wait until the probe creator, its guard, and every descendant process have actually exited. Verify no process still has its working directory or open files in that worktree. Inspect the exact diff and restore only tracked files changed by that probe's planned mutations, using saved original bytes. Verify each restored path matches its saved original and no unrelated tracked changes remain. Inventory untracked and ignored dependencies, caches, and backups. Preserve probe-owned private files with a same-filesystem move to a unique retained path that does not already exist, and verify the paths, counts, byte totals, and hashes before and after the move. Do not delete them or alter files whose ownership is unclear.

After the restoration and preservation checks pass, unlock only that completed probe worktree, then, from outside it, run ordinary `git worktree remove <path>` without force. If the checks are unclear, restoration or removal fails, or other untracked files remain, stop, preserve the worktree and its contents, and report the exact blocker to the orchestrator. Never use force, `git reset --hard`, `git clean`, `git worktree prune`, or `rm -rf` to get past a cleanup refusal. This procedure is not user approval and does not authorize changing the primary checkout or another agent's worktree; the current task and owner policy govern.

## Review language

Every approval, acceptance, and review body is a review finding written for a human teammate,
not a pipeline log. State what the change does, what was attacked, what held, and any remaining
concerns. The posting identity already carries the authority — never announce the role ("on
behalf of", "as orchestrator", "in the capacity of"). Never cite check counts, hash footers,
or tool-generated provenance artifacts. If the sentence could appear unchanged in a CI log,
it does not belong in a review body.

**Why:** across the September 2026 batch-fix campaigns, every approval body announced the
orchestrator's identity chain, cited Gate check counts, and relied on the auto-generated
evidence hash footer for substance. A teammate reading the PR saw process narration, not a
review. The evidence prose was in the bundle all along — the failure was writing the body
as an execution log instead of as the finding it should have been.
