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

A reviewer holds no author tree. It reads the head with `git show <sha>:<path>` from the primary checkout and the bundle under `.agents/review-bundles/<pr>-<sha>/`. It never edits, installs, or runs a check in a live lane. Findings go to the orchestrator, never to GitHub.

Create a worktree only when a probe must edit code and run it. Reading the head does not need one. Add it with `git worktree add --detach` at the bundle's head SHA. Path: `.agents/review-worktrees/<pr>-<head>-<draw>/`. That directory is gitignored. Do not put it under `.agents/worktrees/`. Do not check out the lane branch. Detached HEAD is required because Git will not check the lane branch out twice, and a second checkout would move the author's branch. Give the worktree its own install before running a probe: from the already-installed primary checkout, run

Choose `<estimated-mib>` above the latest observed guarded install peak.

```
pnpm guard --profile focused --max-rss-mib <estimated-mib> -- pnpm --dir <absolute-probe> install --frozen-lockfile --ignore-scripts
```

The first `pnpm` invocation in an empty probe can bootstrap dependencies before its own `guard` script starts. Do not invoke the probe's own `pnpm guard` before this initial install. Run the install through the primary's installed guard, then run every probe from the worktree against its private install; for example:

```
pnpm guard --profile focused --show-output -- pnpm test:run scripts/__tests__/<spec>
```

Run the probe through `pnpm test:run`, never `pnpm exec vitest run`: the same wrapper fails a run that collects no case or executes no assertion, while a bare vitest invocation can exit 0 on an empty collection and read as a pass.

Formatting must select the owned file from the owned checkout. Run the formatter with the lane as
its working directory and lane-relative targets; an external installed formatter binary is fine.
Check its file-info result or output when selection is uncertain. An ignored file or a zero exit
status alone does not prove formatting ran. For a tracked README that ignore rules exclude, an
explicit `--ignore-path /dev/null` is acceptable when targeting only that file.

The isolation is a property of the install record, and it binds every checkout outside the primary that runs pnpm, not only the sanctioned worktree above: a scratch clone anywhere — `/tmp` included — must run its installs against its own `node_modules`, with the clone itself as the install root, so its install metadata (`node_modules/.modules.yaml` and `node_modules/.pnpm-workspace-state-v1.json`) stays structurally private to the clone. Never symlink, junction, or copy another checkout's `node_modules` into a clone to skip the install: pnpm then writes the clone's records through into the real owner — the owner's `.modules.yaml` ends up naming the clone's virtual store — and the owner's next pnpm run aborts every trusted delivery script with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` until it is repaired with `CI=true pnpm install --frozen-lockfile` from the owner root ([issue #4505](https://github.com/jcosta33/sourdaw/issues/4505)).

Keep the repository's `enableGlobalVirtualStore: false` workspace policy in the probe. pnpm records
false by default in CI, while an unset local value fails the dependency freshness comparison against
that record. The explicit setting lets the same private install run under both environments with
freshness checking intact. The content-addressed download cache may remain shared; each checkout's
installed virtual tree and ownership metadata stay private. This workspace policy governs the outer
package runner before the trusted launcher; its pinned source snapshot remains a separate boundary.

A probe can still fail for environment reasons unrelated to the head. Treat that as a limitation to record and verify by reading the head — never as evidence about the head. Record the limitation and report the head's corresponding claim as unverified, naming the spec, so the orchestrator can run it where the environment exists; the mandatory mutation-and-named-spec baseline probe is undischargeable for such a spec, so the round must say so rather than pass. Recognize the class in the spec or its diff: it builds a path to `node_modules`, or to a binary inside it, from its own file location or from `process.cwd()`, then executes or imports through it — its swallowed ENOENT and exit 1 look exactly like a real head regression, so classify from the spec, never from the artifact. `scripts/__tests__/checkProjectLicense.spec.ts` and `scripts/__tests__/agentDeliveryScripts.spec.ts` are live examples.

Never symlink the primary checkout's `node_modules` into the worktree, and never copy the primary tree; gitignored credentials live only there. The worktree's own install is what keeps the primary's install untouched. Point the probe's caches inside the review worktree. Do not fetch, gc, commit, or stage from the review worktree. Keep probe edits there and lock the worktree with `git worktree lock` while the probe runs. Do not take the author lock `active:sourdaw-author`.

Cleanup is controlled by the orchestrator. A reviewer may clean up only the exact probe worktree explicitly assigned in its task; otherwise leave it registered and report its path. For assigned cleanup, first wait until the probe creator, its guard, and every descendant process have actually exited. Verify no process still has its working directory or open files in that worktree. Inspect the exact diff and restore only tracked files changed by that probe's planned mutations, using saved original bytes. Verify each restored path matches its saved original and no unrelated tracked changes remain. Inventory untracked and ignored dependencies, caches, and backups. Preserve probe-owned private files with a same-filesystem move to a unique retained path that does not already exist, and verify the paths, counts, byte totals, and hashes before and after the move. Do not delete them or alter files whose ownership is unclear.

After the restoration and preservation checks pass, unlock only that completed probe worktree, then, from outside it, run ordinary `git worktree remove <path>` without force. If the checks are unclear, restoration or removal fails, or other untracked files remain, stop, preserve the worktree and its contents, and report the exact blocker to the orchestrator. Never use force, `git reset --hard`, `git clean`, `git worktree prune`, or `rm -rf` to get past a cleanup refusal. This procedure is not user approval and does not authorize changing the primary checkout or another agent's worktree; the current task and owner policy govern.

**Why:** A scratch clone in the temp directory lands on the internal boot disk and filled it. Editing the live lane changes the head under review and can strand the author's push. Sharing the primary checkout's install is refused: a `node_modules` symlink into it rewrites the owner's install metadata on every pnpm run and aborts the next trusted delivery script. In September 2026 a `/tmp` mutation-review clone did exactly this and left the primary's `.modules.yaml` naming the clone's virtual store; pnpm 11's manifest shape carries no project directory, so the virtual store is the record that gives the corruption away. The guard refuses exactly that signature — a `node_modules` whose install record names another project, or whose manifest names a foreign virtual store — and it fails open when there is no install or the record is unreadable, so its silence never proves isolation held. The guarded install targeted at the review worktree gives it a private install record that the guard can examine.

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
