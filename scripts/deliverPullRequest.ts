#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export type PullRequestSnapshot = {
    number: number;
    state: string;
    isDraft: boolean;
    title: string;
    body: string | null;
    headRefName: string;
    headRefOid: string;
    baseRefName: string;
    baseRefOid: string;
    mergeStateStatus: string;
    reviewDecision: string;
    changedFiles: number;
    additions: number;
    deletions: number;
};

export type ReviewState = {
    totalReviews: number;
    unresolvedThreads: number;
};

export type VerificationOverrides = {
    e2eSpecs: string[];
    fullE2e: boolean;
};

export type DeliveryPort = {
    fetch: () => void;
    pullRequest: (number: number) => PullRequestSnapshot;
    reviewState: (number: number) => ReviewState;
    dependents: (baseBranch: string) => PullRequestSnapshot[];
    localHead: () => string;
    localDirty: () => boolean;
    remoteBranchHead: (branch: string) => string;
    verify: (base: string, head: string, overrides: VerificationOverrides) => void;
    merge: (number: number, expectedHead: string) => void;
    retarget: (number: number, baseBranch: string) => void;
    log: (message: string) => void;
};

const titlePattern = /^(?:feat|fix|chore|docs|test|refactor|perf|build|ci)(?:\([^)]+\))?!?: .+/;
const requiredBodyHeadings = [
    '### 🎯 What does this PR do?',
    '### 🧪 How to test',
    '### 🖼️ Screenshots',
    '### 📌 Related tickets & additional notes',
];

function fail(message: string): never {
    throw new Error(message);
}

function validatePullRequest(pullRequest: PullRequestSnapshot): void {
    if (pullRequest.state !== 'OPEN') {
        fail(`PR #${pullRequest.number} is ${pullRequest.state.toLowerCase()}`);
    }
    if (pullRequest.isDraft) {
        fail(`PR #${pullRequest.number} is still a draft`);
    }
    if (!titlePattern.test(pullRequest.title)) {
        fail(`PR #${pullRequest.number} title is not conventional`);
    }
    const body = pullRequest.body ?? '';
    if (Buffer.byteLength(body, 'utf8') > 4_000) {
        fail(`PR #${pullRequest.number} body exceeds 4000 bytes`);
    }
    for (const heading of requiredBodyHeadings) {
        if (!body.includes(heading)) {
            fail(`PR #${pullRequest.number} body is missing: ${heading}`);
        }
    }
    if (pullRequest.mergeStateStatus !== 'CLEAN') {
        fail(`PR #${pullRequest.number} merge state is ${pullRequest.mergeStateStatus}`);
    }
    if (pullRequest.reviewDecision === 'CHANGES_REQUESTED') {
        fail(`PR #${pullRequest.number} has requested changes`);
    }
}

function validateReview(number: number, review: ReviewState): void {
    if (review.totalReviews === 0) {
        fail(`PR #${number} has no review activity`);
    }
    if (review.unresolvedThreads > 0) {
        fail(`PR #${number} has ${review.unresolvedThreads} unresolved review thread(s)`);
    }
}

function validateLocalState(port: DeliveryPort, pullRequest: PullRequestSnapshot): void {
    if (port.localDirty()) {
        fail('working tree is dirty');
    }
    const localHead = port.localHead();
    if (localHead !== pullRequest.headRefOid) {
        fail(`local HEAD ${localHead} does not match PR head ${pullRequest.headRefOid}`);
    }
    const remoteBase = port.remoteBranchHead(pullRequest.baseRefName);
    if (remoteBase !== pullRequest.baseRefOid) {
        fail(`origin/${pullRequest.baseRefName} ${remoteBase} does not match PR base ${pullRequest.baseRefOid}`);
    }
}

function validateStablePullRequest(before: PullRequestSnapshot, after: PullRequestSnapshot): void {
    const fields: Array<keyof PullRequestSnapshot> = ['headRefOid', 'baseRefOid', 'headRefName', 'baseRefName'];
    for (const field of fields) {
        if (before[field] !== after[field]) {
            fail(`PR #${before.number} ${field} changed during verification`);
        }
    }
}

function validateDependent(current: PullRequestSnapshot, expected: PullRequestSnapshot): void {
    if (
        current.state !== 'OPEN' ||
        current.headRefOid !== expected.headRefOid ||
        current.headRefName !== expected.headRefName ||
        current.baseRefName !== expected.baseRefName
    ) {
        fail(`stacked PR #${expected.number} changed during delivery`);
    }
}

export function deliverPullRequest(
    number: number,
    port: DeliveryPort,
    overrides: VerificationOverrides = { e2eSpecs: [], fullE2e: false }
): void {
    port.fetch();
    const initial = port.pullRequest(number);
    validatePullRequest(initial);
    validateLocalState(port, initial);
    validateReview(number, port.reviewState(number));

    const dependents = port.dependents(initial.headRefName).filter((candidate) => candidate.number !== number);
    port.log(
        `warning: review size is ${initial.changedFiles} file(s), +${initial.additions}/-${initial.deletions}; split before delivery if this is not one concern`
    );

    port.verify(initial.baseRefOid, initial.headRefOid, overrides);

    port.fetch();
    const verified = port.pullRequest(number);
    validatePullRequest(verified);
    validateStablePullRequest(initial, verified);
    validateLocalState(port, verified);
    validateReview(number, port.reviewState(number));
    for (const dependent of dependents) {
        validateDependent(port.pullRequest(dependent.number), dependent);
    }

    port.merge(number, verified.headRefOid);

    for (const dependent of dependents) {
        port.retarget(dependent.number, verified.baseRefName);
        const retargeted = port.pullRequest(dependent.number);
        if (
            retargeted.state !== 'OPEN' ||
            retargeted.headRefOid !== dependent.headRefOid ||
            retargeted.baseRefName !== verified.baseRefName
        ) {
            fail(`stacked PR #${dependent.number} was not safely retargeted`);
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

function shellPort(repository: string): DeliveryPort {
    const [owner, name] = repository.split('/');
    if (owner === undefined || name === undefined) {
        fail(`invalid GitHub repository: ${repository}`);
    }
    const pullRequestFields = [
        'number',
        'state',
        'isDraft',
        'title',
        'body',
        'headRefName',
        'headRefOid',
        'baseRefName',
        'baseRefOid',
        'mergeStateStatus',
        'reviewDecision',
        'changedFiles',
        'additions',
        'deletions',
    ].join(',');

    return {
        fetch: () => run('git', ['fetch', '--prune', 'origin']),
        pullRequest: (number) =>
            parseJson<PullRequestSnapshot>(
                capture('gh', ['pr', 'view', String(number), '--repo', repository, '--json', pullRequestFields]),
                `PR #${number}`
            ),
        reviewState: (number) => {
            const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviews(first:1){totalCount} reviewThreads(first:100){nodes{isResolved} pageInfo{hasNextPage}}}}}`;
            const response = parseJson<{
                data?: {
                    repository?: {
                        pullRequest?: {
                            reviews: { totalCount: number };
                            reviewThreads: {
                                nodes: Array<{ isResolved: boolean }>;
                                pageInfo: { hasNextPage: boolean };
                            };
                        };
                    };
                };
            }>(
                capture('gh', [
                    'api',
                    'graphql',
                    '-f',
                    `query=${query}`,
                    '-f',
                    `owner=${owner}`,
                    '-f',
                    `name=${name}`,
                    '-F',
                    `number=${number}`,
                ]),
                'review query'
            );
            const review = response.data?.repository?.pullRequest;
            if (review === undefined || review.reviewThreads.pageInfo.hasNextPage) {
                fail(`cannot prove complete review state for PR #${number}`);
            }
            return {
                totalReviews: review.reviews.totalCount,
                unresolvedThreads: review.reviewThreads.nodes.filter((thread) => !thread.isResolved).length,
            };
        },
        dependents: (baseBranch) =>
            parseJson<PullRequestSnapshot[]>(
                capture('gh', [
                    'pr',
                    'list',
                    '--repo',
                    repository,
                    '--state',
                    'open',
                    '--base',
                    baseBranch,
                    '--limit',
                    '100',
                    '--json',
                    pullRequestFields,
                ]),
                'stacked pull-request query'
            ),
        localHead: () => capture('git', ['rev-parse', 'HEAD']),
        localDirty: () => capture('git', ['status', '--porcelain=v1']) !== '',
        remoteBranchHead: (branch) => capture('git', ['rev-parse', `refs/remotes/origin/${branch}`]),
        verify: (base, head, overrides) =>
            run('pnpm', [
                'verify:change',
                '--base',
                base,
                '--head',
                head,
                ...overrides.e2eSpecs.flatMap((spec) => ['--e2e', spec]),
                ...(overrides.fullE2e ? ['--full-e2e'] : []),
            ]),
        merge: (number, expectedHead) => {
            const result = parseJson<{ merged: boolean; message: string }>(
                capture('gh', [
                    'api',
                    '--method',
                    'PUT',
                    `repos/${repository}/pulls/${number}/merge`,
                    '-f',
                    `sha=${expectedHead}`,
                    '-f',
                    'merge_method=merge',
                ]),
                'merge request'
            );
            if (!result.merged) {
                fail(`PR #${number} was not merged: ${result.message}`);
            }
        },
        retarget: (number, baseBranch) =>
            run('gh', [
                'api',
                '--method',
                'PATCH',
                `repos/${repository}/pulls/${number}`,
                '-f',
                `base=${baseBranch}`,
                '--silent',
            ]),
        log: (message) => console.log(message),
    };
}

function main(): number {
    try {
        const args = process.argv.slice(2);
        if (args[0] === '--help') {
            console.log('Usage: pnpm deliver <pr-number> [--e2e <spec>] [--full-e2e]');
            return 0;
        }
        const number = Number(args[0]);
        if (!Number.isSafeInteger(number) || number <= 0) {
            fail('usage: pnpm deliver <pr-number>');
        }
        const overrides: VerificationOverrides = { e2eSpecs: [], fullE2e: false };
        for (let index = 1; index < args.length; index += 1) {
            const argument = args[index];
            if (argument === '--full-e2e') {
                overrides.fullE2e = true;
                continue;
            }
            if (argument === '--e2e') {
                const spec = args[index + 1];
                if (spec === undefined) {
                    fail('--e2e requires a spec path');
                }
                overrides.e2eSpecs.push(spec);
                index += 1;
                continue;
            }
            fail(`unknown option: ${argument ?? ''}`);
        }
        const repository = capture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
        deliverPullRequest(number, shellPort(repository), overrides);
        return 0;
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        return 1;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    process.exit(main());
}
