#!/usr/bin/env node

// Restamps every existing author lane's worktree git config with the author App's commit
// identity — the stamp `lane:open` now applies at creation. Lanes opened before the stamp
// existed commit under whatever global identity the machine carries, and `lane:publish`
// refuses commits authored as anyone but the App, so this is the backfill route that
// refusal names. Offline by construction: git only, no gh, no tokens, no network.
//
// Idempotent: a lane already carrying the identity is reported as such and rewritten
// harmlessly, and `extensions.worktreeConfig` — a primary-config write shared by every
// worktree — is simply set again.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
    AUTHOR_BOT_COMMIT_EMAIL,
    AUTHOR_BOT_COMMIT_NAME,
    AUTHOR_LOCK_REASON,
    assertTrustedExecutingBlob,
    originMainBlob,
    resolvePrimaryRoot,
    spawnCapture,
    spawnRun,
} from './githubAppIdentity.ts';
import { authorIdentityExtensionArgs, authorIdentityWorktreeArgs } from './openLane.ts';
import { AUTHOR_LANE_BRANCH_PREFIX, fail } from './prContract.ts';
import { parseWorktrees, type Worktree } from './removeLane.ts';

export const STAMP_LANE_IDENTITY_USAGE = 'usage: pnpm lane:identity';

/** The lanes the App owns: worktrees locked `active:sourdaw-author` on `agent/` branches. */
export function authorLanes(worktrees: Worktree[]): Worktree[] {
    return worktrees.filter(
        (lane) =>
            lane.locked &&
            lane.lockReason === AUTHOR_LOCK_REASON &&
            lane.branch !== undefined &&
            lane.branch.startsWith(AUTHOR_LANE_BRANCH_PREFIX)
    );
}

export type LaneIdentityStamp = { lane: string; changedKeys: string[] };

export type StampLaneIdentityPort = {
    worktrees: () => Worktree[];
    /** Runs one git command in `cwd`, failing loudly on a nonzero exit. */
    run: (command: string, args: string[], cwd: string) => void;
    /** Reads one git config value in `cwd`; `undefined` when the key is unset. */
    configValue: (args: string[], cwd: string) => string | undefined;
    log: (message: string) => void;
};

const IDENTITY_KEYS: Array<{ key: string; expected: string }> = [
    { key: 'user.name', expected: AUTHOR_BOT_COMMIT_NAME },
    { key: 'user.email', expected: AUTHOR_BOT_COMMIT_EMAIL },
    { key: 'commit.gpgsign', expected: 'false' },
];

export function stampLaneIdentities(port: StampLaneIdentityPort): LaneIdentityStamp[] {
    const stamps: LaneIdentityStamp[] = [];
    for (const lane of authorLanes(port.worktrees())) {
        // The extension must be on before the `--worktree` reads below work; it lives in the
        // primary's common config, so enabling it here covers every later lane too.
        port.run('git', authorIdentityExtensionArgs(), lane.path);
        const before = new Map(
            IDENTITY_KEYS.map(({ key }) => [key, port.configValue(['config', '--worktree', '--get', key], lane.path)])
        );
        for (const args of authorIdentityWorktreeArgs()) {
            port.run('git', args, lane.path);
        }
        const changedKeys = IDENTITY_KEYS.filter(({ key, expected }) => before.get(key) !== expected).map(
            ({ key }) => key
        );
        stamps.push({ lane: lane.path, changedKeys });
        port.log(
            changedKeys.length === 0
                ? `${lane.path} already carries the author identity`
                : `${lane.path} stamped: ${changedKeys.join(', ')}`
        );
    }
    return stamps;
}

export function shellPort(cwd: string = process.cwd()): StampLaneIdentityPort {
    const primaryRoot = resolvePrimaryRoot(undefined, cwd);
    return {
        worktrees: () =>
            parseWorktrees(spawnCapture('git', ['worktree', 'list', '--porcelain', '-z'], { cwd: primaryRoot })),
        run: (command, args, runCwd) => {
            spawnRun(command, args, { cwd: runCwd });
        },
        // `git config --get` answers exit 1 for an unset key: that is a value of this read, not a
        // failure, so it comes back as undefined instead of a thrown error.
        configValue: (args, configCwd) => {
            const result = spawnSync('git', args, { cwd: configCwd, encoding: 'utf8', shell: false });
            if (result.status === 1) {
                return undefined;
            }
            if (result.error !== undefined) {
                throw result.error;
            }
            if (result.status !== 0) {
                throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed with exit ${result.status}`);
            }
            return result.stdout.trim();
        },
        log: (message) => {
            console.log(message);
        },
    };
}

function main(): number {
    try {
        if (process.argv.length > 2) {
            fail(STAMP_LANE_IDENTITY_USAGE);
        }
        const cwd = process.cwd();
        assertTrustedExecutingBlob(
            'scripts/stampLaneIdentity.ts',
            fileURLToPath(import.meta.url),
            originMainBlob('scripts/stampLaneIdentity.ts', cwd)
        );
        const port = shellPort(cwd);
        const stamps = stampLaneIdentities(port);
        const restamped = stamps.filter((stamp) => stamp.changedKeys.length > 0).length;
        port.log(`${stamps.length} author ${stamps.length === 1 ? 'lane' : 'lanes'} checked, ${restamped} restamped`);
        return 0;
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        return 1;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    process.exit(main());
}
