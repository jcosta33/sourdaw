#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Worktree = {
    path: string;
    head: string;
    branch?: string;
    bare: boolean;
    detached: boolean;
    locked: boolean;
    prunable: boolean;
};

export type PullRequest = {
    number: number;
    state: string;
    isDraft: boolean;
    headRefName: string;
    headRefOid: string;
    headRepositoryOwner: { login: string } | null;
    mergedAt: string | null;
};

export type LaneRemovalPort = {
    fetch: () => void;
    repository: () => string;
    currentDirectory: () => string;
    worktrees: () => Worktree[];
    dirty: (path: string) => boolean;
    operation: (path: string) => string | undefined;
    remoteHead: (branch: string) => string;
    pullRequests: (branch: string) => PullRequest[];
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

export function parseWorktrees(value: string): Worktree[] {
    const records = value.split('\0\0').filter((record) => record !== '');
    return records.map((record) => {
        const fields = record.split('\0');
        const worktree = fields.find((field) => field.startsWith('worktree '))?.slice('worktree '.length);
        const head = fields.find((field) => field.startsWith('HEAD '))?.slice('HEAD '.length);
        if (worktree === undefined || head === undefined) {
            fail('git returned malformed worktree state');
        }
        const branch = fields.find((field) => field.startsWith('branch '))?.slice('branch refs/heads/'.length);
        return {
            path: worktree,
            head,
            branch,
            bare: fields.includes('bare'),
            detached: fields.includes('detached'),
            locked: fields.some((field) => field === 'locked' || field.startsWith('locked ')),
            prunable: fields.some((field) => field === 'prunable' || field.startsWith('prunable ')),
        };
    });
}

export function removeLane(target: string, port: LaneRemovalPort): void {
    port.fetch();
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
    if (!inside(join(root.path, '.agents', 'worktrees'), target)) {
        fail(`${target} is not an agent worktree`);
    }
    if (inside(target, port.currentDirectory())) {
        fail('refusing to remove the active worktree');
    }
    if (lane.bare || lane.detached || lane.branch === undefined || lane.prunable) {
        fail('worktree ownership is unknown');
    }
    if (lane.locked) {
        fail('worktree is locked or shared');
    }
    if (port.dirty(target)) {
        fail('worktree is dirty');
    }
    const operation = port.operation(target);
    if (operation !== undefined) {
        fail(`worktree has an active ${operation}`);
    }

    const [owner] = port.repository().split('/');
    if (owner === undefined || owner === '') {
        fail('cannot identify the repository owner');
    }
    const pullRequests = port.pullRequests(lane.branch);
    if (pullRequests.length !== 1) {
        fail(`branch ${lane.branch} does not identify one pull request`);
    }
    const pullRequest = pullRequests[0];
    if (pullRequest === undefined) {
        fail(`branch ${lane.branch} has no pull request`);
    }
    if (pullRequest.headRepositoryOwner?.login !== owner) {
        fail(`PR #${pullRequest.number} is foreign`);
    }
    if (pullRequest.state !== 'MERGED' || pullRequest.mergedAt === null || pullRequest.isDraft) {
        fail(`PR #${pullRequest.number} is still active`);
    }
    const remoteHead = port.remoteHead(lane.branch);
    if (pullRequest.headRefName !== lane.branch || pullRequest.headRefOid !== lane.head || remoteHead !== lane.head) {
        fail(`branch ${lane.branch} head ownership is unproven`);
    }

    port.remove(target);
}

function capture(command: string, args: string[]): string {
    const result = spawnSync(command, args, { cwd: process.cwd(), encoding: 'utf8' });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || `${command} failed with exit ${result.status ?? 'signal'}`);
    }
    return result.stdout.trim();
}

function run(command: string, args: string[]): void {
    const result = spawnSync(command, args, { cwd: process.cwd(), stdio: 'inherit' });
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
    const repository = () => shell.capture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
    return {
        fetch: () => shell.run('git', ['fetch', '--prune', 'origin']),
        repository,
        currentDirectory: () => realpathSync(process.cwd()),
        worktrees: () => parseWorktrees(shell.capture('git', ['worktree', 'list', '--porcelain', '-z'])),
        dirty: (path) => shell.capture('git', ['-C', path, 'status', '--porcelain=v1', '--untracked-files=all']) !== '',
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
                if (existsSync(markerPath)) {
                    return name;
                }
            }
            return undefined;
        },
        remoteHead: (branch) => shell.capture('git', ['rev-parse', '--verify', `refs/remotes/origin/${branch}`]),
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
                        head: { ref: string; sha: string; repo: { owner: { login: string } } | null };
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
                headRepositoryOwner: pullRequest.head.repo?.owner ?? null,
                mergedAt: pullRequest.merged_at,
            }));
        },
        remove: (path) => shell.run('git', ['worktree', 'remove', path]),
    };
}

function main(): number {
    try {
        const args = process.argv.slice(2);
        if (args[0] === '--help' && args.length === 1) {
            console.log('Usage: pnpm lane:remove <worktree-path>');
            return 0;
        }
        if (args.length !== 1 || args[0] === undefined || args[0].startsWith('--')) {
            fail('usage: pnpm lane:remove <worktree-path>');
        }
        const target = realpathSync(resolve(process.cwd(), args[0]));
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
