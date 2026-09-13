#!/usr/bin/env node
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    AUTHOR_LOCK_REASON,
    assertTrustedExecutingBlob,
    originMainBlob,
    resolvePrimaryRoot,
    spawnCapture,
    spawnRun,
} from './githubAppIdentity.ts';
import {
    nodeModulesLinkTarget as resolveNodeModulesLinkTarget,
    outsideSymlinkRefusal,
} from './pnpmModulesPreflight.ts';
import { assertIssueNumber, assertLaneSlug, fail, isIssueArgument, laneBranchName } from './prContract.ts';
import { assertStackAcyclic, readLaneStack, writeLaneStack, type LaneStack } from './stackedLanes.ts';

export const OPEN_LANE_USAGE = 'usage: pnpm lane:open [issue-number] [slug] [--stack-on <absolute-parent-lane>]';

const DEFAULT_LANE_SLUG = 'work';

export type OpenLanePort = {
    primaryRoot: () => string;
    pathExists: (path: string) => boolean;
    assertUnusedStackNamespace: (branch: string) => void;
    ensureWorktreeParent: (path: string) => void;
    fetchMain: () => void;
    worktreeAdd: (path: string, branch: string, reservedBranch?: boolean) => void;
    stackParent?: (path: string, childBranch: string) => LaneStack;
    saveStack?: (descriptor: LaneStack) => void;
    reserveStackBranch?: (branch: string, head: string) => void;
    /** Realpath of the lane's node_modules when it is a symlink; undefined when absent or a real directory. */
    nodeModulesLinkTarget: (lanePath: string) => string | undefined;
    lock: (path: string) => void;
    log: (message: string) => void;
};

export function parseOpenLaneArgs(args: string[]): { issue?: number; slug: string; help: boolean; stackOn?: string } {
    const selector = args.indexOf('--stack-on');
    if (selector !== -1) {
        const parent = args[selector + 1];
        if (parent === undefined || !isAbsolute(parent)) {
            fail('--stack-on requires an absolute parent lane path');
        }
        const rest = [...args.slice(0, selector), ...args.slice(selector + 2)];
        if (rest.includes('--stack-on') || rest.includes('--help')) {
            fail(OPEN_LANE_USAGE);
        }
        return { ...parseOpenLaneArgs(rest), stackOn: parent };
    }
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

function createStackWorktree(stack: LaneStack, lanePath: string, port: OpenLanePort): void {
    if (port.reserveStackBranch === undefined || port.saveStack === undefined) {
        fail('stack creation unavailable');
    }
    // Git's non-force branch creation is the ownership boundary; a preflight ref read cannot reserve it.
    port.reserveStackBranch(stack.childBranch, stack.forkHead);
    try {
        port.saveStack(stack);
        port.worktreeAdd(lanePath, stack.childBranch, true);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        fail(
            `stack creation failed; reserved branch ${stack.childBranch} remains at ${stack.forkHead}; preserve its evidence and choose a new slug: ${message}`
        );
    }
}

export function openLane(issue: number | undefined, slug: string, port: OpenLanePort, stackOn?: string): string {
    const branch = laneBranchName(issue, slug);
    const lanePath = join(port.primaryRoot(), '.agents', 'worktrees', laneDirectoryName(issue, slug));
    if (port.pathExists(lanePath)) {
        fail(`lane already exists: ${lanePath}`);
    }
    port.assertUnusedStackNamespace(branch);
    port.ensureWorktreeParent(lanePath);
    port.fetchMain();
    const stack = stackOn === undefined ? undefined : port.stackParent?.(stackOn, branch);
    if (stackOn !== undefined && (stack === undefined || port.saveStack === undefined)) {
        fail('stack creation unavailable');
    }
    if (stack !== undefined) {
        createStackWorktree(stack, lanePath, port);
    } else {
        port.worktreeAdd(lanePath, branch);
    }
    // Issue #4118: a lane node_modules that symlinks into another checkout makes every pnpm run
    // through it rewrite that checkout's install metadata, which later aborts every trusted
    // delivery script. Refusing before the lock leaves the created worktree unlocked, so the fix
    // (the lane's own install) or `git worktree remove` stays uncomplicated; a link created after
    // opening is caught by the guard preflight instead.
    const linkTarget = port.nodeModulesLinkTarget(lanePath);
    if (linkTarget !== undefined) {
        const refusal = outsideSymlinkRefusal({
            laneRoot: lanePath,
            linkPath: join(lanePath, 'node_modules'),
            linkTarget,
        });
        if (refusal !== undefined) {
            fail(refusal);
        }
    }
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
        assertUnusedStackNamespace: (branch) => {
            const refusal = `${branch} has retained stack evidence; preserve it and choose a new slug`;
            let descriptor: LaneStack | undefined;
            try {
                descriptor = readLaneStack(primaryRoot, branch);
            } catch {
                fail(refusal);
            }
            const keys = capture('git', ['config', '--name-only', '--list'], { cwd: primaryRoot }).split('\n');
            if (descriptor !== undefined || keys.includes(`branch.${branch}.sourdaw-stack-fork`)) {
                fail(refusal);
            }
        },
        ensureWorktreeParent: (path) => {
            mkdirSync(join(path, '..'), { recursive: true });
        },
        fetchMain: () => {
            run('git', ['fetch', 'origin', 'main'], { cwd: primaryRoot });
        },
        worktreeAdd: (path, branch, reservedBranch = false) => {
            if (reservedBranch) {
                run('git', ['worktree', 'add', path, branch], { cwd: primaryRoot });
            } else {
                run('git', ['worktree', 'add', '-b', branch, path, 'origin/main'], { cwd: primaryRoot });
            }
        },
        reserveStackBranch: (branch, head) => {
            run('git', ['branch', branch, head], { cwd: primaryRoot });
        },
        stackParent: (path, childBranch) => {
            if (!isAbsolute(path)) {
                fail('--stack-on requires an absolute parent lane path');
            }
            const parentPath = realpathSync(path);
            const worktrees = capture('git', ['worktree', 'list', '--porcelain', '-z'], { cwd: primaryRoot });
            const record = worktrees
                .split('\0\0')
                .find((entry) => entry.split('\0').includes(`worktree ${parentPath}`));
            const fields = record?.split('\0') ?? [];
            const parentBranch = fields
                .find((field) => field.startsWith('branch refs/heads/'))
                ?.slice('branch refs/heads/'.length);
            if (
                parentPath === realpathSync(primaryRoot) ||
                parentBranch === undefined ||
                !parentBranch.startsWith('agent/') ||
                !fields.includes(`locked ${AUTHOR_LOCK_REASON}`)
            ) {
                fail('stack parent must be an exact author-locked lane in this primary repository');
            }
            if (capture('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: parentPath }) !== '') {
                fail('stack parent has uncommitted changes');
            }
            const forkHead = capture('git', ['rev-parse', '--verify', 'HEAD^{commit}'], { cwd: parentPath });
            if (
                capture('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: parentPath }) !== parentBranch ||
                capture('git', ['rev-parse', '--verify', `refs/heads/${parentBranch}^{commit}`], {
                    cwd: primaryRoot,
                }) !== forkHead
            ) {
                fail('stack parent branch changed during creation');
            }
            const descriptor: LaneStack = { version: 1, childBranch, parentBranch, forkHead, parentHead: forkHead };
            assertStackAcyclic(descriptor, (branch) => readLaneStack(primaryRoot, branch));
            return descriptor;
        },
        saveStack: (descriptor) => {
            writeLaneStack(primaryRoot, descriptor);
            run('git', ['config', `branch.${descriptor.childBranch}.sourdaw-stack-fork`, descriptor.forkHead], {
                cwd: primaryRoot,
            });
        },
        nodeModulesLinkTarget: (path) => resolveNodeModulesLinkTarget(path),
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

export const shellCli: OpenLaneCli = {
    verifyTrustedBlob: (cwd) => {
        const executingFile = fileURLToPath(import.meta.url);
        assertTrustedExecutingBlob('scripts/openLane.ts', executingFile, originMainBlob('scripts/openLane.ts', cwd));
        const helper = fileURLToPath(new URL('./stackedLanes.ts', import.meta.url));
        const helperBlob = originMainBlob('scripts/stackedLanes.ts', cwd);
        if (helperBlob === undefined) {
            fail('scripts/stackedLanes.ts is not available from origin/main');
        }
        assertTrustedExecutingBlob('scripts/stackedLanes.ts', helper, helperBlob);
    },
    createPort: (cwd) => shellPort(spawnCapture, spawnRun, cwd),
};

export function runCli(argv: string[], cli: OpenLaneCli = shellCli, cwd: string = process.cwd()): number {
    try {
        const parsed = parseOpenLaneArgs(argv);
        if (parsed.help) {
            console.log(OPEN_LANE_USAGE.replace('usage:', 'Usage:'));
            return 0;
        }
        cli.verifyTrustedBlob(cwd);
        openLane(parsed.issue, parsed.slug, cli.createPort(cwd), parsed.stackOn);
        return 0;
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        return 1;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    process.exit(runCli(process.argv.slice(2)));
}
