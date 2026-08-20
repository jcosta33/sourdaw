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
import { assertIssueNumber, assertLaneSlug, fail, laneBranchName } from './prContract.ts';

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
        return { help: true, slug: 'work' };
    }
    const issueArg = args[0];
    if (issueArg === undefined) {
        fail('usage: pnpm lane:open <issue-number> [slug]');
    }
    const issue = assertIssueNumber(issueArg, 'usage: pnpm lane:open <issue-number> [slug]');
    const slug = args[1] ?? 'work';
    if (args.length > 2) {
        fail(`unknown option: ${args[2] ?? ''}`);
    }
    assertLaneSlug(slug);
    return { issue, slug, help: false };
}

export function openLane(issue: number, slug: string, port: OpenLanePort): string {
    const branch = laneBranchName(issue, slug);
    const lanePath = join(port.primaryRoot(), '.agents', 'worktrees', `agent-${issue}-${slug}`);
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

function main(): number {
    try {
        const parsed = parseOpenLaneArgs(process.argv.slice(2));
        if (parsed.help) {
            console.log('Usage: pnpm lane:open <issue-number> [slug]');
            return 0;
        }
        if (parsed.issue === undefined) {
            fail('usage: pnpm lane:open <issue-number> [slug]');
        }
        const executingFile = fileURLToPath(import.meta.url);
        const cwd = process.cwd();
        assertTrustedExecutingBlob('scripts/openLane.ts', executingFile, originMainBlob('scripts/openLane.ts', cwd));
        openLane(parsed.issue, parsed.slug, shellPort());
        return 0;
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        return 1;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    process.exit(main());
}
