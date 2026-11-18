# Lane operations

## Checkpoint receipts

For owned staging and checkpoint commits, run `node scripts/gitCheckpoint.ts add -- <paths>` or
`node scripts/gitCheckpoint.ts commit <git arguments>` from the lane. The command runs Git once
with its ordinary environment and hooks, streams stderr, and prints a private receipt location and
writer PID. The initial private receipt must be created before Git starts; failure to create it
refuses the checkpoint. Once Git starts, a diagnostic storage failure does not change its result.
Receipts contain selected source and index hashes, Git metadata, bounded stderr and a
stall observation; retain them when a checkpoint fails. They may contain private paths and Git
output. They default to `~/.agents/artifacts/sourdaw/git-checkpoints`; set `SOURDAW_CHECKPOINT_DIR`
to a private directory outside the worktree to choose their location, under the artifact workspace
([Artifacts](../../../../AGENTS.md#artifacts)) when the checkout's drive is not the home directory's. The watchdog does not stop a stalled writer or prevent Trace2 backpressure. Writer sampling uses a
best-effort PID and start identity check; the check is not atomic and the process can exit or its
PID can be reused before sampling. Shared receivers are never sampled. A failed
syscall pathname requires separately authorized observation arranged before the write; a receipt or
later trace cannot recover it. Do not retry an unchanged failure or change a shared daemon to collect
evidence.

## Local cleanup after delivery

Successful delivery queues local cleanup after merge, receipt and tracker bookkeeping and after the
delivery lock is released. A delivered PR stays delivered when its lane is protected or cleanup is
pending. The deterministic `pnpm lane:cleanup` worker also discovers missed deliveries and merged
legacy detached lanes under `.agents/review-worktrees/`; it never creates review worktrees.
It reuses `lane:remove` with fresh exact-head merge or native supersession proof, a directory identity
fence, clean/untracked/ignored-data checks, no active Git operation, and a complete open-file/process
inspection. Unknown activity, unavailable GitHub inspection, foreign locks and changed identities
retain work. Safety refusals recheck on the normal schedule; unavailable inspection uses capped
backoff. Successful delivery wakes its matching head without bypassing shared inspection backoff.
An old queued identity never authorizes a replacement
lane; discovery gives the replacement its own record and fresh proof after a delay.

Install or refresh the macOS user job with `pnpm lane:cleanup:install` from an approved current
checkout. It runs at login and periodically, using a verified `origin/main` runtime under the primary
checkout's gitignored `.agents/lane-cleanup/`, independent of removed author lanes and primary
working-tree drift. Installation may refresh only the protected primary
`scripts/trustedGithubWriteBootstrap.ts` from approved Git objects when it matches HEAD/index or the
exact previously installed approved blob; local launcher edits and staged changes refuse. This is
the sole tracked-primary installation exception; every other primary edit survives. The installed
job performs no dependency install. The worker preserves common Git `info/exclude` entries while
excluding only its operational namespace when the primary's tracked ignore rules are older. Inspect
`pnpm lane:cleanup --status` from a current checkout, the records and historical logs in that
directory, `~/Library/Logs/Sourdaw/lane-cleanup/worker.log` and `worker-error.log` for current
worker output, and `launchctl print gui/$(id -u)/com.sourdaw.lane-cleanup` plus the macOS system log
for launchd initialization failures. The job starts with the canonical home as its working directory
and opens its logs on that volume before Node accesses the primary checkout. Grant the pinned Node
binary Removable Volumes access for an external primary only when the macOS privacy log identifies
its denial; use Full Disk Access only when that denial requires it. The worker can run directly
where process inspection is available; the scheduler installer explicitly requires macOS.

If launchd cannot initialize the new job, the installer boots it out, restores and re-bootstraps
the previous plist when one existed, or removes it otherwise, then fails with the remediation.
After verifying the first launch, it prunes superseded runtimes. Each worker execution checks
the runtime and manifest against approved Git objects and requires only Node and existing Git and
GitHub CLI executables.

The worker serializes through Git compare-and-swap. It recovers only a proven-dead worker and
writes pending, protected, or removed records before attempting removal. The records authorize no
deletions. Failed delivery never attempts cleanup.

## Remove or strand a lane

Run `pnpm lane:remove <path>` outside the lane; its author lock remains until removal succeeds.
Removal requires a clean lane holding exactly one PR's head whose work reached `main`, either
merged directly or through `pr:supersede`'s receipt naming a merged replacement; a receipt stops
counting once the old PR is reopened at or after it. Removal and `lane:prune` never treat
credential-shaped ignored files (`.env*`, `*.pem`, `*.key`, SSH keys, `.npmrc` and the like) as
disposable, except inside `node_modules`. Other closed PRs
are abandonments: use `lane:strand` to preserve their unlanded work. It refuses open PRs or
uncommitted work, pins the abandoned tip at `refs/sourdaw/strands/<lane>` before writing the receipt
or removing anything, and records it, with that ref, in a receipt in the primary checkout. It refuses
when that ref or a same-lane receipt already records a different head; a retry at the same head
reuses both. After writing the receipt it
removes the worktree and deletes the lane's local branch with `git branch -D`;
`git branch <name> refs/sourdaw/strands/<lane>` revives the work. `lane:remove` leaves the local branch: delete it after removal.
