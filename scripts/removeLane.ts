#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    AUTHOR_LOCK_REASON,
    assertTrustedExecutingBlob,
    isAuthorBotNodeId,
    originMainBlob,
    removalLockPid,
    resolvePrimaryRoot,
} from './githubAppIdentity.ts';
import { supersessionReplacement } from './prContract.ts';

export type Worktree = {
    path: string;
    head: string;
    branch?: string;
    bare: boolean;
    detached: boolean;
    locked: boolean;
    lockReason?: string;
    prunable: boolean;
};

export type PullRequest = {
    number: number;
    state: string;
    isDraft: boolean;
    headRefName: string;
    headRefOid: string;
    headRepository: string | null;
    mergedAt: string | null;
};

export type IssueComment = {
    body: string;
    authorNodeId: string | null;
    authorLogin: string | null;
    authorType: string | null;
};

export type ReplacementPullRequest = {
    number: number;
    state: string;
    mergedAt: string | null;
};

export type LaneRemovalPort = {
    fetch: () => void;
    repository: () => string;
    currentDirectory: () => string;
    worktrees: () => Worktree[];
    active: (path: string) => boolean;
    processAlive: (pid: number) => boolean;
    dirty: (path: string) => boolean;
    ignored: (path: string) => string[];
    operation: (path: string) => string | undefined;
    remoteHead: (branch: string) => string | undefined;
    pullRequests: (branch: string) => PullRequest[];
    comments: (number: number) => IssueComment[];
    replacement: (number: number) => ReplacementPullRequest;
    lock: (path: string, reason?: string) => void;
    unlock: (path: string) => void;
    remove: (path: string) => void;
};

export type ShellRunner = {
    capture: (command: string, args: string[]) => string;
    run: (command: string, args: string[]) => void;
};

function fail(message: string): never {
    throw new Error(message);
}

function inside(parent: string, candidate: string): boolean {
    const path = relative(parent, candidate);
    return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function disposableIgnored(path: string): boolean {
    const normalized = path.replaceAll('\\', '/');
    return (
        normalized === '.DS_Store' ||
        normalized.endsWith('/.DS_Store') ||
        /(?:^|\/)(?:node_modules|dist|coverage|target|playwright-report|test-results)(?:\/|$)/.test(normalized) ||
        /^\.agents\/ui-scripts\/[^/]+\.png$/.test(normalized)
    );
}

export function parseWorktrees(value: string): Worktree[] {
    return value
        .split('\0\0')
        .filter((record) => record !== '')
        .map((record) => {
            const fields = record.split('\0');
            const worktree = fields.find((field) => field.startsWith('worktree '))?.slice('worktree '.length);
            const head = fields.find((field) => field.startsWith('HEAD '))?.slice('HEAD '.length);
            if (worktree === undefined || head === undefined) {
                fail('git returned malformed worktree state');
            }
            const branch = fields.find((field) => field.startsWith('branch '))?.slice('branch refs/heads/'.length);
            const locked = fields.find((field) => field === 'locked' || field.startsWith('locked '));
            return {
                path: worktree,
                head,
                branch,
                bare: fields.includes('bare'),
                detached: fields.includes('detached'),
                locked: locked !== undefined,
                lockReason: locked?.slice('locked '.length) || undefined,
                prunable: fields.some((field) => field === 'prunable' || field.startsWith('prunable ')),
            };
        });
}

function identifyLane(target: string, port: LaneRemovalPort): Worktree {
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
        fail('refusing to remove the primary worktree');
    }
    const agentRoot = join(root.path, '.agents', 'worktrees');
    if (target === agentRoot || !inside(agentRoot, target)) {
        fail(`${target} is not an agent worktree`);
    }
    if (inside(target, port.currentDirectory())) {
        fail('refusing to remove the active worktree');
    }
    if (port.active(target)) {
        fail('worktree is active in another process');
    }
    if (lane.bare || lane.detached || lane.branch === undefined || lane.prunable) {
        fail('worktree ownership is unknown');
    }
    if (lane.locked) {
        const stalePid = removalLockPid(lane.lockReason);
        if (stalePid !== undefined && !port.processAlive(stalePid)) {
            port.unlock(target);
            return identifyLane(target, port);
        }
        if (lane.lockReason === AUTHOR_LOCK_REASON) {
            return lane;
        }
        fail('worktree is locked or shared');
    }
    return lane;
}

type OwnershipSnapshot = {
    head: string;
    branch: string;
    ignored: string[];
    pullRequest: number;
    supersededBy?: number;
    remoteHead?: string;
};

/**
 * A lane is spent once the work it holds is on `main`. Merging is the ordinary way there; being
 * superseded is the other one, and `pr:supersede` closes the old pull request unmerged, so state
 * alone cannot tell that lane from an abandoned one — and removing an abandoned lane discards
 * unmerged work.
 *
 * The receipt is what separates them. `pr:supersede` posts exactly one author-bot comment naming
 * the replacement before it closes anything. This function does not itself establish that
 * invariant — that guarantee lives in `supersedePullRequest.ts`, which refuses to post a receipt
 * onto a pull request already carrying a non-matching author-bot comment. What this function does
 * independently is count only the author-bot comments that actually parse as a receipt, so a
 * closed pull request carrying exactly one parsed receipt is trusted, and one carrying zero or
 * more than one — whether from unrelated author-bot chatter or genuinely conflicting receipts — is
 * refused. Reading the receipt back is not enough on its own: it says where the work went, not
 * that it arrived, so the named replacement must itself be merged before this lane counts as
 * spent.
 */
function supersededReplacement(number: number, port: LaneRemovalPort): number {
    const receipts = port
        .comments(number)
        .filter((comment) => comment.authorType === 'Bot' && isAuthorBotNodeId(comment.authorNodeId))
        .map((comment) => supersessionReplacement(comment.body))
        .filter((parsed): parsed is number => parsed !== undefined);
    const [replacement] = receipts;
    if (receipts.length !== 1 || replacement === undefined) {
        fail(`PR #${number} is closed without a supersession receipt`);
    }
    if (replacement === number) {
        fail(`PR #${number} names itself as its replacement`);
    }
    const landed = port.replacement(replacement);
    if (landed.number !== replacement || landed.state !== 'MERGED' || landed.mergedAt === null) {
        fail(`PR #${number} was superseded by #${replacement}, which is not merged`);
    }
    return replacement;
}

function validateOwnership(
    target: string,
    expected: Worktree,
    repository: string,
    port: LaneRemovalPort
): OwnershipSnapshot {
    const current = port.worktrees().find((worktree) => worktree.path === target);
    if (
        current === undefined ||
        current.head !== expected.head ||
        current.branch !== expected.branch ||
        current.bare ||
        current.detached ||
        current.prunable ||
        !current.locked
    ) {
        fail('worktree identity changed during removal');
    }
    if (port.dirty(target)) {
        fail('worktree is dirty');
    }
    if (port.active(target)) {
        fail('worktree is active in another process');
    }
    const ignored = port.ignored(target);
    const unsafeIgnored = ignored.filter((path) => !disposableIgnored(path));
    if (unsafeIgnored.length > 0) {
        fail(`worktree contains ignored data: ${unsafeIgnored.slice(0, 3).join(', ')}`);
    }
    const operation = port.operation(target);
    if (operation !== undefined) {
        fail(`worktree has an active ${operation}`);
    }

    const branch = expected.branch;
    if (branch === undefined) {
        fail('worktree ownership is unknown');
    }
    const pullRequests = port.pullRequests(branch);
    if (pullRequests.length !== 1) {
        fail(`branch ${branch} does not identify one pull request`);
    }
    const pullRequest = pullRequests[0];
    if (pullRequest === undefined) {
        fail(`branch ${branch} has no pull request`);
    }
    if (pullRequest.headRepository?.toLowerCase() !== repository.toLowerCase()) {
        fail(`PR #${pullRequest.number} is foreign`);
    }
    const merged = pullRequest.state === 'MERGED' && pullRequest.mergedAt !== null;
    // The draft flag says nothing about whether the work landed: an OPEN draft is already refused
    // below because it is neither merged nor closed, and GitHub cannot merge a pull request while
    // it is still a draft, so a MERGED pull request is never a draft either. A CLOSED draft is the
    // one state a standalone `isDraft` refusal here would wrongly block — `pr:supersede` can close
    // a draft pull request against a genuinely merged replacement, and that lane must still be able
    // to prove it through the receipt path below.
    if (!merged && pullRequest.state !== 'CLOSED') {
        fail(`PR #${pullRequest.number} is still active`);
    }
    const supersededBy = merged ? undefined : supersededReplacement(pullRequest.number, port);
    const remoteHead = port.remoteHead(branch);
    if (
        pullRequest.headRefName !== branch ||
        pullRequest.headRefOid !== expected.head ||
        (remoteHead !== undefined && remoteHead !== expected.head)
    ) {
        fail(`branch ${branch} head ownership is unproven`);
    }
    if (port.dirty(target) || port.active(target)) {
        fail('worktree changed during removal');
    }
    return {
        head: current.head,
        branch,
        ignored: [...ignored].sort(),
        pullRequest: pullRequest.number,
        supersededBy,
        remoteHead,
    };
}

export function removeLane(target: string, port: LaneRemovalPort): void {
    port.fetch();
    const repository = port.repository();
    const lane = identifyLane(target, port);
    const authorLocked = lane.locked && lane.lockReason === AUTHOR_LOCK_REASON;
    if (!authorLocked) {
        port.lock(target);
    }
    let releaseOnFailure = !authorLocked;
    try {
        const initial = validateOwnership(target, lane, repository, port);
        const final = validateOwnership(target, lane, repository, port);
        if (JSON.stringify(initial) !== JSON.stringify(final)) {
            fail('worktree authority changed during removal');
        }
        port.unlock(target);
        releaseOnFailure = false;
        port.remove(target);
    } finally {
        if (releaseOnFailure) {
            port.unlock(target);
        }
    }
}

export function resolveLaneTarget(arg: string, primaryRoot: string): string {
    return realpathSync(isAbsolute(arg) ? arg : resolve(primaryRoot, arg));
}

function capture(command: string, args: string[]): string {
    const result = spawnSync(command, args, { cwd: process.cwd(), encoding: 'utf8', shell: false });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || `${command} failed with exit ${result.status ?? 'signal'}`);
    }
    return result.stdout.trim();
}

function run(command: string, args: string[]): void {
    const result = spawnSync(command, args, { cwd: process.cwd(), stdio: 'inherit', shell: false });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`${command} failed with exit ${result.status ?? 'signal'}`);
    }
}

function parseJson<Value>(value: string, label: string): Value {
    try {
        return JSON.parse(value) as Value;
    } catch (error) {
        throw new Error(`${label} returned invalid JSON`, { cause: error });
    }
}

export function shellPort(shell: ShellRunner = { capture, run }): LaneRemovalPort {
    let cachedRepository: string | undefined;
    const repository = () => {
        cachedRepository ??= shell.capture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
        return cachedRepository;
    };
    return {
        fetch: () => shell.run('git', ['fetch', '--prune', 'origin']),
        repository,
        currentDirectory: () => realpathSync(process.cwd()),
        worktrees: () => parseWorktrees(shell.capture('git', ['worktree', 'list', '--porcelain', '-z'])),
        active: (path) => {
            let pid: number | undefined;
            for (const line of shell.capture('lsof', ['-a', '-d', 'cwd', '-F', 'pn']).split('\n')) {
                if (line.startsWith('p')) {
                    pid = Number(line.slice(1));
                    continue;
                }
                if (line.startsWith('n') && pid !== process.pid && inside(path, line.slice(1))) {
                    return true;
                }
            }
            return false;
        },
        processAlive: (pid) => {
            try {
                process.kill(pid, 0);
                return true;
            } catch (error) {
                return error instanceof Error && 'code' in error && error.code !== 'ESRCH';
            }
        },
        dirty: (path) => shell.capture('git', ['-C', path, 'status', '--porcelain=v1', '--untracked-files=all']) !== '',
        ignored: (path) =>
            shell
                .capture('git', ['-C', path, 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory'])
                .split('\n')
                .filter((candidate) => candidate !== ''),
        operation: (path) => {
            const candidates = [
                ['merge', 'MERGE_HEAD'],
                ['rebase', 'rebase-merge'],
                ['rebase', 'rebase-apply'],
                ['cherry-pick', 'CHERRY_PICK_HEAD'],
                ['revert', 'REVERT_HEAD'],
                ['bisect', 'BISECT_LOG'],
            ] as const;
            for (const [name, marker] of candidates) {
                const markerPath = shell.capture('git', ['-C', path, 'rev-parse', '--git-path', marker]);
                const absoluteMarker = isAbsolute(markerPath) ? markerPath : resolve(path, markerPath);
                if (existsSync(absoluteMarker)) {
                    return name;
                }
            }
            return undefined;
        },
        remoteHead: (branch) => {
            const head = shell.capture('git', [
                'for-each-ref',
                '--format=%(objectname)',
                `refs/remotes/origin/${branch}`,
            ]);
            return head === '' ? undefined : head;
        },
        pullRequests: (branch) => {
            const nameWithOwner = repository();
            const [owner] = nameWithOwner.split('/');
            if (owner === undefined || owner === '') {
                fail('cannot identify the repository owner');
            }
            const pages = parseJson<
                Array<
                    Array<{
                        number: number;
                        state: string;
                        draft: boolean;
                        head: { ref: string; sha: string; repo: { full_name: string } | null };
                        merged_at: string | null;
                    }>
                >
            >(
                shell.capture('gh', [
                    'api',
                    '--paginate',
                    '--slurp',
                    `repos/${nameWithOwner}/pulls?state=all&head=${owner}%3A${encodeURIComponent(branch)}&per_page=100`,
                ]),
                'pull-request query'
            );
            return pages.flat().map((pullRequest) => ({
                number: pullRequest.number,
                state: pullRequest.merged_at === null ? pullRequest.state.toUpperCase() : 'MERGED',
                isDraft: pullRequest.draft,
                headRefName: pullRequest.head.ref,
                headRefOid: pullRequest.head.sha,
                headRepository: pullRequest.head.repo?.full_name ?? null,
                mergedAt: pullRequest.merged_at,
            }));
        },
        comments: (number) => {
            const pages = parseJson<
                Array<Array<{ body: string; user: { node_id: string; login: string; type: string } | null }>>
            >(
                shell.capture('gh', [
                    'api',
                    '--paginate',
                    '--slurp',
                    `repos/${repository()}/issues/${number}/comments?per_page=100`,
                ]),
                'pull-request comment query'
            );
            return pages.flat().map((comment) => ({
                body: comment.body,
                authorNodeId: comment.user?.node_id ?? null,
                authorLogin: comment.user?.login ?? null,
                authorType: comment.user?.type ?? null,
            }));
        },
        replacement: (number) => {
            const pullRequest = parseJson<{ number: number; state: string; merged_at: string | null }>(
                shell.capture('gh', ['api', `repos/${repository()}/pulls/${number}`]),
                `PR #${number} query`
            );
            return {
                number: pullRequest.number,
                state: pullRequest.merged_at === null ? pullRequest.state.toUpperCase() : 'MERGED',
                mergedAt: pullRequest.merged_at,
            };
        },
        lock: (path, reason = `lane-remove:${process.pid}`) =>
            shell.run('git', ['worktree', 'lock', '--reason', reason, path]),
        unlock: (path) => shell.run('git', ['worktree', 'unlock', path]),
        remove: (path) => shell.run('git', ['worktree', 'remove', path]),
    };
}

function main(): number {
    try {
        const args = process.argv.slice(2);
        if (args[0] === '--help' && args.length === 1) {
            console.log('Usage: node scripts/removeLane.ts <worktree-path>');
            console.log('');
            console.log('Removes a spent agent worktree. The lane must be clean, unlocked, idle, and');
            console.log('hold the head of exactly one pull request in this repository that either');
            console.log('merged, or was superseded by a pull request that merged.');
            return 0;
        }
        if (args.length !== 1 || args[0] === undefined || args[0].startsWith('--')) {
            fail('usage: node scripts/removeLane.ts <worktree-path>');
        }
        const cwd = process.cwd();
        assertTrustedExecutingBlob(
            'scripts/removeLane.ts',
            fileURLToPath(import.meta.url),
            originMainBlob('scripts/removeLane.ts', cwd)
        );
        const primaryRoot = resolvePrimaryRoot();
        const target = resolveLaneTarget(args[0], primaryRoot);
        removeLane(target, shellPort());
        return 0;
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        return 1;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    process.exit(main());
}
