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
    currentHeadReviews: number;
    unresolvedThreads: number;
};

export type StackedPullRequest = Pick<
    PullRequestSnapshot,
    'number' | 'state' | 'headRefName' | 'headRefOid' | 'baseRefName'
>;

export type DeliveryPort = {
    fetch: () => void;
    pullRequest: (number: number) => PullRequestSnapshot;
    reviewState: (number: number, expectedHead: string) => ReviewState;
    dependents: (baseBranch: string) => StackedPullRequest[];
    repositoryDeletesMergedBranches: () => boolean;
    localHead: () => string;
    localDirty: () => boolean;
    remoteBranchHead: (branch: string) => string;
    merge: (number: number, expectedHead: string) => void;
    retarget: (number: number, baseBranch: string) => void;
    log: (message: string) => void;
};

export type ShellRunner = {
    capture: (command: string, args: string[]) => string;
    run: (command: string, args: string[]) => void;
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
    let previousHeading = -1;
    for (let index = 0; index < requiredBodyHeadings.length; index += 1) {
        const heading = requiredBodyHeadings[index];
        if (heading === undefined) {
            continue;
        }
        const headingIndex = body.indexOf(heading);
        if (headingIndex < 0) {
            fail(`PR #${pullRequest.number} body is missing: ${heading}`);
        }
        if (headingIndex <= previousHeading) {
            fail(`PR #${pullRequest.number} body sections are out of order`);
        }
        if (body.includes(heading, headingIndex + heading.length)) {
            fail(`PR #${pullRequest.number} body duplicates: ${heading}`);
        }
        const nextHeading = requiredBodyHeadings[index + 1];
        const contentEnd =
            nextHeading === undefined ? body.length : body.indexOf(nextHeading, headingIndex + heading.length);
        if (contentEnd < 0 || body.slice(headingIndex + heading.length, contentEnd).trim() === '') {
            fail(`PR #${pullRequest.number} body section is empty: ${heading}`);
        }
        previousHeading = headingIndex;
    }
    if (pullRequest.mergeStateStatus !== 'CLEAN') {
        fail(`PR #${pullRequest.number} merge state is ${pullRequest.mergeStateStatus}`);
    }
    if (pullRequest.reviewDecision === 'CHANGES_REQUESTED') {
        fail(`PR #${pullRequest.number} has requested changes`);
    }
}

function validateReview(number: number, review: ReviewState): void {
    if (review.currentHeadReviews === 0) {
        fail(`PR #${number} has no current-head review activity`);
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
            fail(`PR #${before.number} ${field} changed during delivery`);
        }
    }
}

function validateDependent(current: PullRequestSnapshot, expected: StackedPullRequest): void {
    if (
        current.state !== 'OPEN' ||
        current.headRefOid !== expected.headRefOid ||
        current.headRefName !== expected.headRefName ||
        current.baseRefName !== expected.baseRefName
    ) {
        fail(`stacked PR #${expected.number} changed during delivery`);
    }
}

function validateDependentSet(before: StackedPullRequest[], after: StackedPullRequest[]): void {
    const beforeByNumber = new Map(before.map((dependent) => [dependent.number, dependent]));
    const afterByNumber = new Map(after.map((dependent) => [dependent.number, dependent]));
    if (beforeByNumber.size !== afterByNumber.size) {
        fail('stacked pull-request set changed during delivery');
    }
    for (const [number, expected] of beforeByNumber) {
        const current = afterByNumber.get(number);
        if (
            current === undefined ||
            current.state !== 'OPEN' ||
            current.headRefOid !== expected.headRefOid ||
            current.headRefName !== expected.headRefName ||
            current.baseRefName !== expected.baseRefName
        ) {
            fail(`stacked PR #${number} changed during delivery`);
        }
    }
}

function retargetDependents(dependents: StackedPullRequest[], baseBranch: string, port: DeliveryPort): void {
    for (const dependent of dependents) {
        port.retarget(dependent.number, baseBranch);
        const retargeted = port.pullRequest(dependent.number);
        if (
            retargeted.state !== 'OPEN' ||
            retargeted.headRefOid !== dependent.headRefOid ||
            retargeted.baseRefName !== baseBranch
        ) {
            fail(`stacked PR #${dependent.number} was not safely retargeted`);
        }
    }
}

export function deliverPullRequest(number: number, port: DeliveryPort): void {
    port.fetch();
    const initial = port.pullRequest(number);
    if (initial.state === 'MERGED') {
        const remaining = port.dependents(initial.headRefName).filter((candidate) => candidate.number !== number);
        retargetDependents(remaining, initial.baseRefName, port);
        port.log(`PR #${number} was already merged; repaired ${remaining.length} remaining dependent(s)`);
        return;
    }
    validatePullRequest(initial);
    validateLocalState(port, initial);
    validateReview(number, port.reviewState(number, initial.headRefOid));

    const dependents = port.dependents(initial.headRefName).filter((candidate) => candidate.number !== number);
    if (dependents.length > 0 && port.repositoryDeletesMergedBranches()) {
        fail('automatic merged-branch deletion must be disabled before delivering a stacked PR');
    }
    port.log(`review size: ${initial.changedFiles} file(s), +${initial.additions}/-${initial.deletions}`);

    port.fetch();
    const current = port.pullRequest(number);
    validatePullRequest(current);
    validateStablePullRequest(initial, current);
    validateLocalState(port, current);
    validateReview(number, port.reviewState(number, current.headRefOid));
    const currentDependents = port.dependents(current.headRefName).filter((candidate) => candidate.number !== number);
    validateDependentSet(dependents, currentDependents);
    for (const dependent of currentDependents) {
        validateDependent(port.pullRequest(dependent.number), dependent);
    }

    port.merge(number, current.headRefOid);
    retargetDependents(currentDependents, current.baseRefName, port);
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

export function shellPort(repository: string, shell: ShellRunner = { capture, run }): DeliveryPort {
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
        fetch: () => shell.run('git', ['fetch', '--prune', 'origin']),
        pullRequest: (number) =>
            parseJson<PullRequestSnapshot>(
                shell.capture('gh', ['pr', 'view', String(number), '--repo', repository, '--json', pullRequestFields]),
                `PR #${number}`
            ),
        reviewState: (number, expectedHead) => {
            const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviews(last:100){nodes{state commit{oid}} pageInfo{hasPreviousPage}} reviewThreads(first:100){nodes{isResolved} pageInfo{hasNextPage}}}}}`;
            const response = parseJson<{
                data?: {
                    repository?: {
                        pullRequest?: {
                            reviews: {
                                nodes: Array<{ state: string; commit: { oid: string } | null }>;
                                pageInfo: { hasPreviousPage: boolean };
                            };
                            reviewThreads: {
                                nodes: Array<{ isResolved: boolean }>;
                                pageInfo: { hasNextPage: boolean };
                            };
                        };
                    };
                };
            }>(
                shell.capture('gh', [
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
            if (
                review === undefined ||
                review.reviews.pageInfo.hasPreviousPage ||
                review.reviewThreads.pageInfo.hasNextPage
            ) {
                fail(`cannot prove complete review state for PR #${number}`);
            }
            return {
                currentHeadReviews: review.reviews.nodes.filter(
                    (candidate) => candidate.state !== 'DISMISSED' && candidate.commit?.oid === expectedHead
                ).length,
                unresolvedThreads: review.reviewThreads.nodes.filter((thread) => !thread.isResolved).length,
            };
        },
        dependents: (baseBranch) => {
            const pages = parseJson<
                Array<
                    Array<{
                        number: number;
                        state: string;
                        head: { ref: string; sha: string };
                        base: { ref: string };
                    }>
                >
            >(
                shell.capture('gh', [
                    'api',
                    '--paginate',
                    '--slurp',
                    `repos/${repository}/pulls?state=open&base=${encodeURIComponent(baseBranch)}&per_page=100`,
                ]),
                'stacked pull-request query'
            );
            return pages.flat().map((pullRequest) => ({
                number: pullRequest.number,
                state: pullRequest.state.toUpperCase(),
                headRefName: pullRequest.head.ref,
                headRefOid: pullRequest.head.sha,
                baseRefName: pullRequest.base.ref,
            }));
        },
        repositoryDeletesMergedBranches: () =>
            shell.capture('gh', ['api', `repos/${repository}`, '--jq', '.delete_branch_on_merge']) === 'true',
        localHead: () => shell.capture('git', ['rev-parse', 'HEAD']),
        localDirty: () => shell.capture('git', ['status', '--porcelain=v1']) !== '',
        remoteBranchHead: (branch) => shell.capture('git', ['rev-parse', `refs/remotes/origin/${branch}`]),
        merge: (number, expectedHead) => {
            const result = parseJson<{ merged: boolean; message: string }>(
                shell.capture('gh', [
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
            shell.run('gh', [
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

export function parseCliArgs(args: string[]): { number?: number; help: boolean } {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { help: true };
    }
    const number = Number(args[0]);
    if (!Number.isSafeInteger(number) || number <= 0) {
        fail('usage: pnpm deliver <pr-number>');
    }
    if (args.length !== 1) {
        fail(`unknown option: ${args[1] ?? ''}`);
    }
    return { number, help: false };
}

function main(): number {
    try {
        const parsed = parseCliArgs(process.argv.slice(2));
        if (parsed.help) {
            console.log('Usage: pnpm deliver <pr-number>');
            return 0;
        }
        if (parsed.number === undefined) {
            fail('usage: pnpm deliver <pr-number>');
        }
        const repository = capture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
        deliverPullRequest(parsed.number, shellPort(repository));
        return 0;
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        return 1;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    process.exit(main());
}
