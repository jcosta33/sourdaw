#!/usr/bin/env node

// Reclaims disk from agent lanes by deleting their regenerable build and test products —
// dependency installs, compiled and bundled output, test and coverage reports, packaged
// desktop builds, and generated screenshots — the `target/` (1.6–2.0 GB) and
// `node_modules/` (~1.1 GB) measured per lane chief among them — without touching anything
// of record. The deletion set is exactly what `disposableIgnored` (`removeLane.ts`, one
// shared contract) admits: lane removal refuses a lane carrying ignored data that contract
// does not cover, and pruning deletes exactly what it does. Every other ignored path —
// credentials (`.env*`), editor state, review bundles — is left alone, as are tracked
// files, `.git`, and the lane's lock: pruning never touches git state, and the next
// cargo/pnpm/desktop build rebuilds what it deleted.
//
// Rules, with reasons:
// - Only registered worktrees under `.agents/worktrees` are prunable; the primary
//   checkout is refused outright, because its artifacts serve every lane's workflow.
// - A lane a process is using — its working directory inside the lane, or any open
//   file under it (a build run from another directory holding lane files) — is
//   refused: deleting artifacts under a live cargo/pnpm run breaks that run.
// - A dirty lane is refused. Dirt means uncommitted work — a lane mid-task, not an
//   idle one — and the fleet's disk problem is idle lanes.
// - The author lock (`active:sourdaw-author`) does NOT block pruning. Every lane is
//   born locked and stays locked until removal (`lane:open` locks on creation,
//   `lane:remove` drops the lock only when removal proceeds), so on a locked-lanes-
//   are-untouchable doctrine nothing could ever be pruned. The lock marks ownership,
//   not activity, and pruning never touches git state. A live `lane-remove:<pid>`
//   lock (a removal in flight) or any foreign lock reason does block it: another
//   tool owns the worktree.
// - `--stale-days <days>` prunes only lanes whose HEAD commit is at least that many
//   days old — the honest idle signal: a lane with no local commits carries
//   `origin/main`'s date, and a lane with fresh commits is being worked.

import { readFileSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    AUTHOR_LOCK_REASON,
    originMainBlob,
    removalLockPid,
    resolvePrimaryRoot,
    spawnCapture,
} from './githubAppIdentity.ts';
import { laneIsActive } from './laneActivity.ts';
import { canonicalPath, fail } from './prContract.ts';
import {
    capture as captureRemoval,
    disposableIgnored,
    inside,
    listIgnored,
    parseWorktrees,
    resolveLaneTarget,
    type ShellRunner,
    type Worktree,
} from './removeLane.ts';
import { trustedLocalImportClosure } from './trustedGithubWriteBootstrap.ts';

export const PRUNE_USAGE =
    'usage: pnpm lane:prune <worktree-path> | pnpm lane:prune --all | pnpm lane:prune --stale-days <days>';

export const PRUNE_HELP = `Usage: pnpm lane:prune <worktree-path>
       pnpm lane:prune --all
       pnpm lane:prune --stale-days <days>

Deletes regenerable build and test products (dependency installs, compiled and
bundled output, test and coverage reports, packaged desktop builds, generated
screenshots) from agent lanes and nothing else, per the shared disposableIgnored
contract (removeLane.ts). Tracked files, .git, the lane's lock, and every other
ignored path (.env credentials, editor state, review bundles) are never touched;
the next cargo/pnpm/desktop build rebuilds what was deleted.

Safety rules:
- refuses the primary checkout; only registered worktrees under .agents/worktrees
- refuses a lane a process is using, by working directory or any open file under
  it (artifacts may be mid-build), and the lane holding this process's working
  directory
- refuses a dirty lane: uncommitted work means mid-task, not idle
- the author lock (active:sourdaw-author) does not block pruning — it marks
  ownership, not activity, and every lane holds it until removal; a live
  lane-remove:<pid> lock or any foreign lock does block it
- --stale-days prunes only lanes whose HEAD commit is at least that many days old`;

export type LanePrunePort = {
    worktrees: () => Worktree[];
    currentDirectory: () => string;
    active: (path: string) => boolean;
    processAlive: (pid: number) => boolean;
    dirty: (path: string) => boolean;
    headCommitDate: (path: string) => string | undefined;
    ignored: (path: string) => string[];
    deleteEntry: (lane: string, entry: string) => void;
    log: (message: string) => void;
};

export type PruneArgs = { mode: 'help' } | { mode: 'lane'; target: string } | { mode: 'fleet'; staleDays?: number };

export function parsePruneArgs(args: string[]): PruneArgs {
    const [first, second] = args;
    if (args.length === 1 && first === '--help') {
        return { mode: 'help' };
    }
    if (args.length === 1 && first === '--all') {
        return { mode: 'fleet' };
    }
    if (first === '--stale-days') {
        if (args.length !== 2 || second === undefined) {
            fail(PRUNE_USAGE);
        }
        const days = Number(second);
        if (!Number.isSafeInteger(days) || days <= 0) {
            fail('--stale-days wants a positive whole number of days');
        }
        return { mode: 'fleet', staleDays: days };
    }
    if (args.length === 1 && first !== undefined && !first.startsWith('--')) {
        return { mode: 'lane', target: first };
    }
    return fail(PRUNE_USAGE);
}

/**
 * The ignored entries pruning may delete: exactly the output lane removal tolerates discarding, and
 * never a directory holding an entry it does not — deleting `dist/` would take `dist/.env` with it.
 */
export function prunableEntries(ignored: string[]): string[] {
    const kept = ignored.filter((entry) => !disposableIgnored(entry));
    return ignored.filter(
        (entry) => disposableIgnored(entry) && !kept.some((other) => other.startsWith(directoryPrefix(entry)))
    );
}

function directoryPrefix(entry: string): string {
    return entry.endsWith('/') ? entry : `${entry}/`;
}

/**
 * `lane:open` locks every lane `active:sourdaw-author` until removal, so that lock marks ownership
 * and never blocks pruning. A live `lane-remove:<pid>` lock means a removal is in flight over this
 * worktree; a dead one is stale leftover; anything else is a foreign tool's lock.
 */
export function laneLockRefusal(lane: Worktree, alive: (pid: number) => boolean): string | undefined {
    if (!lane.locked) {
        return undefined;
    }
    if (lane.lockReason === AUTHOR_LOCK_REASON) {
        return undefined;
    }
    const pid = removalLockPid(lane.lockReason);
    if (pid !== undefined) {
        return alive(pid) ? 'a lane removal is in flight' : undefined;
    }
    return 'worktree is locked or shared';
}

/** No commit date to read is not evidence of idleness, so an unreadable date never counts as stale. */
export function isStale(headDate: string | undefined, days: number, now: number = Date.now()): boolean {
    if (headDate === undefined || headDate === '') {
        return false;
    }
    const committed = Date.parse(headDate);
    if (Number.isNaN(committed)) {
        return false;
    }
    return now - committed >= days * 86_400_000;
}

/**
 * Defense in depth before an rmSync: git itself listed these entries, but a gitignore written to
 * shape lookalike or traversal paths must not turn a prune into a delete outside the lane.
 */
function canonicalInside(lane: string, entry: string): boolean {
    const trimmed = entry.endsWith('/') ? entry.slice(0, -1) : entry;
    const components = trimmed.split('/');
    const canonical = components.every((component) => component !== '' && component !== '.' && component !== '..');
    return canonical && inside(lane, resolve(lane, trimmed));
}

export function pruneTarget(target: string, port: LanePrunePort, staleDays?: number): string[] {
    const worktrees = port.worktrees();
    const root = worktrees[0];
    if (root === undefined) {
        fail('repository has no worktree state');
    }
    const lane = worktrees.find((worktree) => worktree.path === target);
    if (lane === undefined) {
        fail(`${target} is not a registered worktree`);
    }
    if (target === root.path) {
        fail('refusing to prune the primary checkout');
    }
    const agentRoot = join(root.path, '.agents', 'worktrees');
    if (target === agentRoot || !inside(agentRoot, target)) {
        fail(`${target} is not an agent worktree`);
    }
    if (lane.bare) {
        fail('worktree is bare');
    }
    if (lane.prunable) {
        fail('worktree is prunable; it holds no directory to prune');
    }
    if (inside(target, port.currentDirectory())) {
        fail('refusing to prune the active worktree');
    }
    if (port.active(target)) {
        fail('worktree is active in another process');
    }
    if (port.dirty(target)) {
        fail('worktree is dirty');
    }
    const refusal = laneLockRefusal(lane, port.processAlive);
    if (refusal !== undefined) {
        fail(refusal);
    }
    if (staleDays !== undefined && !isStale(port.headCommitDate(target), staleDays)) {
        fail(`lane's last commit is newer than ${staleDays} days`);
    }
    const entries = prunableEntries(port.ignored(target)).filter((entry) => canonicalInside(target, entry));
    for (const entry of entries) {
        port.deleteEntry(target, entry);
    }
    port.log(entries.length === 0 ? `pruned ${target}: nothing to prune` : `pruned ${target}: ${entries.join(', ')}`);
    return entries;
}

export type FleetPruneOutcome = {
    pruned: string[];
    refused: Array<{ lane: string; reason: string }>;
};

/**
 * Best-effort sweep: one lane's refusal (a dirty or busy lane is exactly what should survive a
 * fleet prune) must not shield the rest of the fleet from pruning, so refusals are collected and
 * reported rather than thrown.
 */
export function pruneFleet(port: LanePrunePort, staleDays?: number): FleetPruneOutcome {
    const worktrees = port.worktrees();
    const root = worktrees[0];
    if (root === undefined) {
        fail('repository has no worktree state');
    }
    const agentRoot = join(root.path, '.agents', 'worktrees');
    const outcome: FleetPruneOutcome = { pruned: [], refused: [] };
    for (const lane of worktrees) {
        if (lane.path === root.path || lane.bare || lane.prunable || !inside(agentRoot, lane.path)) {
            continue;
        }
        try {
            pruneTarget(lane.path, port, staleDays);
            outcome.pruned.push(lane.path);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            outcome.refused.push({ lane: lane.path, reason });
            port.log(`refused ${lane.path}: ${reason}`);
        }
    }
    return outcome;
}

export type PruneShell = Pick<ShellRunner, 'capture'>;

/** Removal's capture: pinned system lsof/ps, bounded inspection time, and incomplete-census refusal. */
export const capture = captureRemoval;

export function shellPort(shell: PruneShell = { capture }): LanePrunePort {
    return {
        worktrees: () =>
            parseWorktrees(shell.capture('git', ['worktree', 'list', '--porcelain', '-z'])).map((worktree) => ({
                ...worktree,
                path: canonicalPath(worktree.path, realpathSync),
            })),
        currentDirectory: () => realpathSync(process.cwd()),
        // The same complete same-user census removal trusts: any open file or working directory
        // under the lane, from any process, keeps a live build's artifacts in place.
        active: (path) => laneIsActive(path, shell),
        processAlive: (pid) => {
            try {
                process.kill(pid, 0);
                return true;
            } catch (error) {
                return error instanceof Error && 'code' in error && error.code !== 'ESRCH';
            }
        },
        dirty: (path) => shell.capture('git', ['-C', path, 'status', '--porcelain=v1', '--untracked-files=all']) !== '',
        headCommitDate: (path) => {
            const date = shell.capture('git', ['-C', path, 'log', '-1', '--format=%cI']);
            return date === '' ? undefined : date;
        },
        // `-z` is the byte-faithful form: no quoting, so an unusual path can never be misread.
        ignored: (path) => listIgnored(path, shell),
        deleteEntry: (lane, entry) => {
            rmSync(resolve(lane, entry), { recursive: true, force: true });
        },
        log: (message) => {
            console.log(message);
        },
    };
}

/**
 * Prune's deletion authority lives as much in `removeLane.ts` and the rest of its import closure as
 * in its entry file, so every file it loads must be the approved origin/main source, as the cleanup
 * installer requires of its runtime.
 */
export function assertTrustedClosure(
    entry: string,
    readLocal: (path: string) => string,
    readOrigin: (path: string) => string | undefined
): void {
    for (const path of trustedLocalImportClosure(entry, readOrigin)) {
        const approved = readOrigin(path);
        if (approved === undefined || readLocal(path) !== approved) {
            throw new Error(`${path} does not match origin/main; refusing to run a mutated copy`);
        }
    }
}

function main(): number {
    try {
        const args = process.argv.slice(2);
        const parsed = parsePruneArgs(args);
        if (parsed.mode === 'help') {
            console.log(PRUNE_HELP);
            return 0;
        }
        const cwd = process.cwd();
        const commit = spawnCapture('git', ['rev-parse', 'origin/main^{commit}'], { cwd });
        assertTrustedClosure(
            'scripts/pruneLane.ts',
            (path) => readFileSync(join(dirname(dirname(fileURLToPath(import.meta.url))), path), 'utf8'),
            (path) => originMainBlob(path, cwd, undefined, 'git', commit)
        );
        if (parsed.mode === 'lane') {
            const target = resolveLaneTarget(parsed.target, resolvePrimaryRoot());
            pruneTarget(target, shellPort());
            return 0;
        }
        const outcome = pruneFleet(shellPort(), parsed.staleDays);
        if (outcome.refused.length > 0) {
            for (const refusal of outcome.refused) {
                console.error(`refused ${refusal.lane}: ${refusal.reason}`);
            }
            return 1;
        }
        return 0;
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        return 1;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    process.exit(main());
}
