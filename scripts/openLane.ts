#!/usr/bin/env node
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    AUTHOR_LOCK_REASON,
    assertTrustedExecutingBlob,
    originMainBlob,
    resolvePrimaryRoot,
    spawnCapture,
    spawnRun,
} from './githubAppIdentity.ts';
import { assertIssueNumber, assertLaneSlug, fail, isIssueArgument, laneBranchName } from './prContract.ts';

export const OPEN_LANE_USAGE = 'usage: pnpm lane:open [issue-number] [slug]';

const DEFAULT_LANE_SLUG = 'work';

export type OpenLanePort = {
    primaryRoot: () => string;
    pathExists: (path: string) => boolean;
    ensureWorktreeParent: (path: string) => void;
    fetchMain: () => void;
    worktreeAdd: (path: string, branch: string) => void;
    lock: (path: string) => void;
    log: (message: string) => void;
};

export function parseOpenLaneArgs(args: string[]): { issue?: number; slug: string; help: boolean } {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { help: true, slug: DEFAULT_LANE_SLUG };
    }
    const first = args[0];
    if (first === undefined) {
        return { slug: DEFAULT_LANE_SLUG, help: false };
    }
    if (isIssueArgument(first)) {
        if (args.length > 2) {
            fail(`unknown option: ${args[2] ?? ''}`);
        }
        const slug = args[1] ?? DEFAULT_LANE_SLUG;
        assertLaneSlug(slug);
        return { issue: assertIssueNumber(first, OPEN_LANE_USAGE), slug, help: false };
    }
    if (args.length > 1) {
        fail(`unknown option: ${args[1] ?? ''}`);
    }
    assertLaneSlug(first);
    return { slug: first, help: false };
}

/**
 * One directory per branch, both ways. `agent/12/beat` and `agent/12-beat` are different lanes, so
 * flattening both to `agent-12-beat` would make the second `lane:open` fail as "lane already
 * exists". A slug never contains a doubled dash and the issue form always puts a digit straight
 * after `agent-`, so the doubled dash is free to mark the issueless form.
 */
export function laneDirectoryName(issue: number | undefined, slug: string): string {
    return issue === undefined ? `agent--${slug}` : `agent-${issue}-${slug}`;
}

export function openLane(issue: number | undefined, slug: string, port: OpenLanePort): string {
    const branch = laneBranchName(issue, slug);
    const lanePath = join(port.primaryRoot(), '.agents', 'worktrees', laneDirectoryName(issue, slug));
    if (port.pathExists(lanePath)) {
        fail(`lane already exists: ${lanePath}`);
    }
    port.ensureWorktreeParent(lanePath);
    port.fetchMain();
    port.worktreeAdd(lanePath, branch);
    port.lock(lanePath);
    port.log(lanePath);
    return lanePath;
}

export function shellPort(
    capture: typeof spawnCapture = spawnCapture,
    run: typeof spawnRun = spawnRun,
    cwd: string = process.cwd()
): OpenLanePort {
    const primaryRoot = resolvePrimaryRoot(
        (command, args, directory) => capture(command, args, { cwd: directory }),
        cwd
    );
    return {
        primaryRoot: () => primaryRoot,
        pathExists: (path) => existsSync(path),
        ensureWorktreeParent: (path) => {
            mkdirSync(join(path, '..'), { recursive: true });
        },
        fetchMain: () => {
            run('git', ['fetch', 'origin', 'main'], { cwd: primaryRoot });
        },
        worktreeAdd: (path, branch) => {
            run('git', ['worktree', 'add', '-b', branch, path, 'origin/main'], { cwd: primaryRoot });
        },
        lock: (path) => {
            run('git', ['worktree', 'lock', '--reason', AUTHOR_LOCK_REASON, path], { cwd: primaryRoot });
        },
        log: (message) => {
            console.log(message);
        },
    };
}

/**
 * Everything `lane:open` does that leaves the process. `verifyTrustedBlob` reads `origin/main`
 * through git and `createPort` resolves the primary root the same way, so a test that imported the
 * real pair would run git for real; taking them as a parameter is what gives a test a whole CLI
 * with no path outward at all.
 */
export type OpenLaneCli = {
    verifyTrustedBlob: (cwd: string) => void;
    createPort: (cwd: string) => OpenLanePort;
};

const shellCli: OpenLaneCli = {
    verifyTrustedBlob: (cwd) => {
        const executingFile = fileURLToPath(import.meta.url);
        assertTrustedExecutingBlob('scripts/openLane.ts', executingFile, originMainBlob('scripts/openLane.ts', cwd));
    },
    createPort: (cwd) => shellPort(spawnCapture, spawnRun, cwd),
};

export function runCli(argv: string[], cli: OpenLaneCli = shellCli, cwd: string = process.cwd()): number {
    try {
        const parsed = parseOpenLaneArgs(argv);
        if (parsed.help) {
            console.log('Usage: pnpm lane:open [issue-number] [slug]');
            return 0;
        }
        cli.verifyTrustedBlob(cwd);
        openLane(parsed.issue, parsed.slug, cli.createPort(cwd));
        return 0;
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        return 1;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    process.exit(runCli(process.argv.slice(2)));
}
