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

Create a worktree only when a probe must edit code and run it. Reading the head does not need one. Add it with `git worktree add --detach` at the bundle's head SHA. Path: `.agents/review-worktrees/<pr>-<head>-<draw>/`. That directory is gitignored. Do not put it under `.agents/worktrees/`. Do not check out the lane branch. Detached HEAD is required because Git will not check the lane branch out twice, and a second checkout would move the author's branch. Give the worktree its own install before running a probe: from the worktree, run

```
pnpm install --frozen-lockfile --ignore-scripts
```

That install is measured at about eleven seconds and one gigabyte, hardlinked from the pnpm store, and it makes the worktree own its dependency tree. Run every probe from the worktree against that install; for example:

```
pnpm guard --profile focused --show-output -- pnpm test:run scripts/__tests__/<spec>
```

Run the probe through `pnpm test:run`, never `pnpm exec vitest run`: the same wrapper fails a run that collects no case or executes no assertion, while a bare vitest invocation can exit 0 on an empty collection and read as a pass.

Vite's file-serving allow list also names the installing checkout's `node_modules`, so specs that import package assets with `?url` load from a review worktree. Do not widen that list further (for example to the whole primary checkout), as it holds credentials and other checkout state.

A probe can still fail for environment reasons unrelated to the head. Treat that as a limitation to record and verify by reading the head — never as evidence about the head. Record the limitation and report the head's corresponding claim as unverified, naming the spec, so the orchestrator can run it where the environment exists; the mandatory mutation-and-named-spec baseline probe is undischargeable for such a spec, so the round must say so rather than pass. Recognize the class in the spec or its diff: it builds a path to `node_modules`, or to a binary inside it, from its own file location or from `process.cwd()`, then executes or imports through it — its swallowed ENOENT and exit 1 look exactly like a real head regression, so classify from the spec, never from the artifact. `scripts/__tests__/checkProjectLicense.spec.ts` and `scripts/__tests__/agentDeliveryScripts.spec.ts` are live examples.

Never symlink the primary checkout's `node_modules` into the worktree, and never copy the primary tree; gitignored credentials live only there. The worktree's own install is what keeps the primary's install untouched. Point the probe's caches inside the review worktree; they are removed with it. Do not fetch, gc, commit, or stage from the review worktree. Unstaged edits stay in that worktree. Lock it for the probe with `git worktree lock`. When the probe returns, leave the directory and run `git worktree remove --force --force`. A plain remove refuses the modified and untracked files the probe leaves behind, and one `--force` refuses a worktree that is still locked. If a probe is killed and the directory is still there, run `git worktree remove --force --force` on it from outside the directory. `git worktree prune` only drops a registration whose directory is already gone. Do not use `rm -rf` as the cleanup. Do not take the author lock `active:sourdaw-author`.

**Why:** A scratch clone in the temp directory lands on the internal boot disk and filled it. Editing the live lane changes the head under review and can strand the author's push. Sharing the primary checkout's install is refused: a `node_modules` symlink into it rewrites the owner's install metadata on every pnpm run and aborts the next trusted delivery script. The guard refuses exactly that signature — a `node_modules` whose install record names another project — and it fails open when there is no install or the record is unreadable, so its silence never proves isolation held. `pnpm install` in the review worktree is the sanctioned route: it gives the worktree its own install record, which is what the guard can examine.

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
