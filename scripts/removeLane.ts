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
    body: string | null;
};

export type CampaignIssue = {
    number: number;
    state: string;
    body: string;
    labels: Array<{ name: string }>;
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
    campaignIssues: (numbers: number[]) => CampaignIssue[];
    lock: (path: string) => void;
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

function issueReferences(body: string | null): number[] {
    if (body === null) {
        return [];
    }
    const references = [...body.matchAll(/#(\d+)\b|\/issues\/(\d+)\b/g)].map((match) => Number(match[1] ?? match[2]));
    return [...new Set(references.filter((number) => Number.isSafeInteger(number) && number > 0))];
}

// A ledger records a merged pull request as `#N` or as the URL `gh` prints. Accepting only `#N`
// made pasting that URL silently unrecordable, and an unrecorded PR cannot have its lane retired.
function mentions(body: string, number: number): boolean {
    return new RegExp(`(?:^|\\D)#${number}(?!\\d)|/(?:pull|issues)/${number}(?!\\d)`).test(body);
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
        const stalePid = /^lane-remove:(\d+)$/.exec(lane.lockReason ?? '')?.[1];
        if (stalePid !== undefined && !port.processAlive(Number(stalePid))) {
            port.unlock(target);
            return identifyLane(target, port);
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
    campaign: number;
    remoteHead?: string;
};

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
    if (pullRequest.state !== 'MERGED' || pullRequest.mergedAt === null || pullRequest.isDraft) {
        fail(`PR #${pullRequest.number} is still active`);
    }
    // The ledger's own state is deliberately not checked. What authorises removal is that this
    // lane's work is finished and recorded: the pull request is MERGED (above) and one epic ledger
    // names it. A ledger stays OPEN for the whole life of its campaign, which is exactly when its
    // lanes finish and accumulate — requiring CLOSED made every lane of a live campaign
    // unremovable until the campaign itself ended, and lanes were retired by hand instead.
    const referenced = port.campaignIssues(issueReferences(pullRequest.body));
    const ledgers = referenced.filter((issue) => issue.labels.some((label) => label.name === 'epic'));
    if (ledgers.length === 0) {
        fail(`PR #${pullRequest.number} references no epic-labelled ledger issue`);
    }
    const campaigns = ledgers.filter((issue) => mentions(issue.body, pullRequest.number));
    if (campaigns.length === 0) {
        const names = ledgers.map((issue) => `#${issue.number}`).join(', ');
        fail(`PR #${pullRequest.number} is referenced by epic ledger ${names}, whose body does not name it back`);
    }
    if (campaigns.length > 1) {
        const names = campaigns.map((issue) => `#${issue.number}`).join(', ');
        fail(`PR #${pullRequest.number} is claimed by epic ledgers ${names}`);
    }
    const campaign = campaigns[0];
    if (campaign === undefined) {
        fail(`PR #${pullRequest.number} is not recorded in one campaign ledger`);
    }
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
        campaign: campaign.number,
        remoteHead,
    };
}

export function removeLane(target: string, port: LaneRemovalPort): void {
    port.fetch();
    const repository = port.repository();
    const lane = identifyLane(target, port);
    port.lock(target);
    let locked = true;
    try {
        const initial = validateOwnership(target, lane, repository, port);
        const final = validateOwnership(target, lane, repository, port);
        if (JSON.stringify(initial) !== JSON.stringify(final)) {
            fail('worktree authority changed during removal');
        }
        port.unlock(target);
        locked = false;
        port.remove(target);
    } finally {
        if (locked) {
            port.unlock(target);
        }
    }
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
                        body: string | null;
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
                body: pullRequest.body,
            }));
        },
        campaignIssues: (numbers) =>
            numbers.map((number) =>
                parseJson<CampaignIssue>(
                    shell.capture('gh', ['issue', 'view', String(number), '--json', 'number,state,body,labels']),
                    `issue #${number}`
                )
            ),
        lock: (path) => shell.run('git', ['worktree', 'lock', '--reason', `lane-remove:${process.pid}`, path]),
        unlock: (path) => shell.run('git', ['worktree', 'unlock', path]),
        remove: (path) => shell.run('git', ['worktree', 'remove', path]),
    };
}

function main(): number {
    try {
        const args = process.argv.slice(2);
        if (args[0] === '--help' && args.length === 1) {
            console.log('Usage: pnpm lane:remove <worktree-path>');
            console.log('');
            console.log('Removes a spent agent worktree. The lane must be clean, unlocked, idle, and');
            console.log('hold the merged head of exactly one pull request in this repository.');
            console.log('');
            console.log("Record the merged PR in its ledger issue's BODY (a comment is not read) as");
            console.log('`#<pr>` or as the pull-request URL, and label that issue `epic`. Exactly one');
            console.log('such issue must name the PR back, or removal is refused.');
            return 0;
        }
        if (args.length !== 1 || args[0] === undefined || args[0].startsWith('--')) {
            fail('usage: pnpm lane:remove <worktree-path>');
        }
        removeLane(realpathSync(resolve(process.cwd(), args[0])), shellPort());
        return 0;
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        return 1;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    process.exit(main());
}
