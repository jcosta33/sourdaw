# Review stances

This directory is a lesson library keyed by defect class: the standing probes, escape lessons,
and shared principles that bind them.

## Stance derivation and the lesson library

Stances are derived per task, never selected from this directory. Enumerate the material risks the
diff creates, name one stance per risk, and record the dispatched set with each stance's admission
evidence in the bundle's `stances.json`; the root `AGENTS.md` Review section carries the rule.

Every dispatched draw and its adjudication become durable evidence under the frozen attributable
evidence contract ([ADR 0048](../../decisions/0048-attributable-evidence-contract-is-frozen.md)):
stance names, models, tiers, outcomes, and dispositions enter the head-bound `dossier-v1` record.
Name stances by the failure mode that admits them so that record stays meaningful to a cold reader,
and keep every recorded value single-line and free of credentials or transcript material — the
contract's parsers refuse anything else.

This directory is a lesson library, not a menu. Each file collects standing probes and escape
lessons for one defect class, and the matching key is the risk the stance attacks — never the
files the diff touches. A stance carries the most specific matching file and never a broader one
in addition; a stance matching no file dispatches without one. An escape attaches to every file
whose probes participate in what would have caught it, or mints a new file for a defect class
none covers.

## Reviewer isolation

A reviewer holds no author tree. It reads the head with `git show <sha>:<path>` from the primary checkout and the bundle under `.agents/review-bundles/<pr>-<sha>/`. It never edits, installs, or runs a check in a live lane. Findings go to the orchestrator, never to GitHub.

Create a worktree only when a probe must edit code and run it. Reading the head does not need one. Add it with `git worktree add --detach` at the bundle's head SHA. Path: `.agents/review-worktrees/<pr>-<head>-<draw>/`. That directory is gitignored. Do not put it under `.agents/worktrees/`. Do not check out the lane branch. Detached HEAD is required because Git will not check the lane branch out twice, and a second checkout would move the author's branch. Run the primary checkout's binaries directly with the review worktree as the working directory; Node resolves the primary's modules by walking up the directory tree, because the review worktree lives inside the primary checkout. For example, from the worktree, with `<primary>` the parent of `git rev-parse --git-common-dir`:

```
node "<primary>/scripts/resourceGuard.ts" --profile focused --show-output -- node "<primary>/node_modules/vitest/vitest.mjs" run scripts/__tests__/<spec>
```

Not every spec runs this way: one that resolves the checkout's own tooling or a dependency through its own file location or through `process.cwd()/node_modules` cannot, because the worktree has no install. Recognize the class in the spec or its diff: it builds a path to `node_modules`, or to a binary inside it, from its own file location or from `process.cwd()`, then executes or imports through it — its swallowed ENOENT and exit 1 look exactly like a real head regression, so classify from the spec, never from the artifact. Treat a resulting environment failure as a limitation to record and verify by reading the head — never as evidence about the head. Record the limitation and report the head's corresponding claim as unverified, naming the spec, so the orchestrator can run it where the install exists; the mandatory mutation-and-named-spec baseline probe is undischargeable for such a spec, so the round must say so rather than pass.

Never symlink the primary checkout's `node_modules` into the worktree, never run `pnpm` there, and never run `pnpm install`. Never copy the primary tree; gitignored credentials live only there. The probe's own caches stay inside the review worktree and are removed with it; a transient Vite config temp may land in the checkout that owns the nearest install, and install metadata is not rewritten. Do not fetch, gc, commit, or stage from the review worktree. Unstaged edits stay in that worktree. Lock it for the probe with `git worktree lock`. When the probe returns, leave the directory and run `git worktree remove --force --force`. A plain remove refuses the modified and untracked files the probe leaves behind, and one `--force` refuses a worktree that is still locked. If a probe is killed and the directory is still there, run `git worktree remove --force --force` on it from outside the directory. `git worktree prune` only drops a registration whose directory is already gone. Do not use `rm -rf` as the cleanup. Do not take the author lock `active:sourdaw-author`.

**Why:** A scratch clone in the temp directory lands on the internal boot disk and filled it. Editing the live lane changes the head under review and can strand the author's push. A `node_modules` symlink plus `pnpm` in the worktree rewrote the primary checkout's install metadata: `node_modules/.modules.yaml` and `node_modules/.pnpm-workspace-state-v1.json` recorded the worktree path, so `pnpm review:prepare` decided the primary install was stale and started a full reinstall, and every trusted delivery script was at risk. The resource guard's `assertCurrentCheckoutModulesBelongToCheckout` also refuses a symlinked worktree outright.

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
