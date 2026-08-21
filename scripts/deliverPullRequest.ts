#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import {
    AUTHOR_BOT_LOGIN,
    REVIEWER_BOT_LOGIN,
    assertRequiredRepository,
    authenticateRole,
    authenticateTrackerAuthor,
    gitAuthenticatedArgs,
    GITHUB_HTTPS_REMOTE,
    isAuthorBotLogin,
    isReviewerBotLogin,
    REQUIRED_BASE_BRANCH,
    REQUIRED_REPOSITORY,
    resolvePrimaryRoot,
    spawnCapture,
    spawnRun,
} from './githubAppIdentity.ts';
import {
    TITLE_PATTERN,
    assertPullRequestBody,
    canonicalIssueReferenceFromBody,
    composeDeliveryReceipt,
    fail,
    parseDeliveryReceipt,
    type DeliveryReceiptPayload,
} from './prContract.ts';
import { shellPort as trackerIssueShellPort } from './reconcileTrackerIssue.ts';
import { completeTrackerIssue, type ReconcileTrackerIssuePort } from './trackerIssueReconciliation.ts';

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
    latestReviewerStateOnHead: string | null;
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
    merge: (number: number, expectedHead: string, hasDependents: boolean) => void;
    retarget: (number: number, baseBranch: string) => void;
    deliveryReceipts: (number: number) => DeliveryReceiptComment[];
    addDeliveryReceipt: (number: number, body: string) => DeliveryReceiptComment;
    log: (message: string) => void;
};

export type DeliveryReceiptComment = {
    id: string;
    body: string;
    authorLogin: string | null;
    authorType: string | null;
    createdAt: string;
    updatedAt: string;
};

export type TrackerCompletionPort = {
    complete: (issueNumber: number) => void;
};

export type ShellRunner = {
    capture: (command: string, args: string[]) => string;
    run: (command: string, args: string[]) => void;
};

function validatePullRequest(pullRequest: PullRequestSnapshot): void {
    if (pullRequest.state !== 'OPEN') {
        fail(`PR #${pullRequest.number} is ${pullRequest.state.toLowerCase()}`);
    }
    if (pullRequest.isDraft) {
        fail(`PR #${pullRequest.number} is still a draft`);
    }
    if (!TITLE_PATTERN.test(pullRequest.title)) {
        fail(`PR #${pullRequest.number} title is not conventional`);
    }
    if (pullRequest.mergeStateStatus !== 'CLEAN') {
        fail(`PR #${pullRequest.number} merge state is ${pullRequest.mergeStateStatus}`);
    }
    if (pullRequest.reviewDecision === 'CHANGES_REQUESTED') {
        fail(`PR #${pullRequest.number} has requested changes`);
    }
}

function trackerCompletionTarget(pullRequest: PullRequestSnapshot): number | undefined {
    const body = pullRequest.body ?? '';
    assertPullRequestBody(body, `PR #${pullRequest.number} body`);
    const reference = canonicalIssueReferenceFromBody(body, REQUIRED_REPOSITORY);
    return reference?.relationship === 'closes' ? reference.issue : undefined;
}

function validateReview(number: number, review: ReviewState): void {
    if (review.latestReviewerStateOnHead !== 'APPROVED') {
        fail(`PR #${number} is not approved by ${REVIEWER_BOT_LOGIN} on the current head`);
    }
    if (review.unresolvedThreads > 0) {
        fail(`PR #${number} has ${review.unresolvedThreads} unresolved review thread(s)`);
    }
}

/**
 * The base is what the change merges into, and nothing in a pull request's own state proves it is
 * still the branch the reviewer approved against: a retarget moves it silently and leaves the head,
 * the approval and the merge state untouched. Stacking does not need a non-default base here.
 * `deliver` merges the bottom pull request of a stack and then retargets whatever was based on its
 * head onto its own base, so the pull request being delivered always targets the trunk, and only
 * its not-yet-delivered dependents ever carry a lane branch as a base.
 */
function validateBaseBranch(pullRequest: PullRequestSnapshot): void {
    if (pullRequest.baseRefName !== REQUIRED_BASE_BRANCH) {
        fail(
            `PR #${pullRequest.number} targets ${pullRequest.baseRefName}, not ${REQUIRED_BASE_BRANCH}; ` +
                `deliver merges into ${REQUIRED_BASE_BRANCH} only. Deliver the pull request this one is ` +
                `stacked on, which retargets this one.`
        );
    }
}

function validateStablePullRequest(before: PullRequestSnapshot, after: PullRequestSnapshot): void {
    const fields: Array<keyof PullRequestSnapshot> = ['headRefOid', 'headRefName', 'baseRefName', 'body'];
    for (const field of fields) {
        if (before[field] !== after[field]) {
            fail(`PR #${before.number} ${field} changed during delivery`);
        }
    }
}

function validateStableTrackerTarget(number: number, before: number | undefined, after: number | undefined): void {
    if (before !== after) {
        fail(`PR #${number} closing target changed during delivery`);
    }
}

function expectedDeliveryReceipt(
    pullRequest: PullRequestSnapshot,
    closingIssue: number | undefined
): DeliveryReceiptPayload {
    return {
        pullRequest: pullRequest.number,
        head: pullRequest.headRefOid,
        bodySha256: createHash('sha256')
            .update(pullRequest.body ?? '')
            .digest('hex'),
        closingIssue,
    };
}

function deliveryReceiptCandidates(
    comments: DeliveryReceiptComment[],
    pullRequest: Pick<PullRequestSnapshot, 'number' | 'headRefOid'>
): DeliveryReceiptComment[] {
    const candidates: DeliveryReceiptComment[] = [];
    for (const comment of comments) {
        const payload = parseDeliveryReceipt(comment.body);
        if (payload === undefined) {
            continue;
        }
        assertOwnedDeliveryReceipt(comment, payload, pullRequest.number);
        if (payload.head === pullRequest.headRefOid) {
            candidates.push(comment);
        }
    }
    return candidates;
}

function assertOwnedDeliveryReceipt(
    comment: DeliveryReceiptComment,
    payload: DeliveryReceiptPayload,
    pullRequestNumber: number
): void {
    if (
        comment.id === '' ||
        !isAuthorBotLogin(comment.authorLogin) ||
        comment.authorType !== 'Bot' ||
        comment.createdAt === '' ||
        comment.createdAt !== comment.updatedAt ||
        payload.pullRequest !== pullRequestNumber
    ) {
        fail(`PR #${pullRequestNumber} has an invalid delivery receipt`);
    }
}

function assertCanonicalDeliveryReceipt(
    comment: DeliveryReceiptComment,
    pullRequest: Pick<PullRequestSnapshot, 'number' | 'headRefOid'>,
    expected?: DeliveryReceiptPayload
): DeliveryReceiptPayload {
    const payload = parseDeliveryReceipt(comment.body);
    if (payload === undefined) {
        fail(`PR #${pullRequest.number} has an invalid delivery receipt`);
    }
    assertOwnedDeliveryReceipt(comment, payload, pullRequest.number);
    if (
        payload.head !== pullRequest.headRefOid ||
        (expected !== undefined && comment.body !== composeDeliveryReceipt(expected))
    ) {
        fail(`PR #${pullRequest.number} has an invalid delivery receipt`);
    }
    return payload;
}

function readDeliveryReceipt(pullRequest: PullRequestSnapshot, port: DeliveryPort): DeliveryReceiptPayload {
    const candidates = deliveryReceiptCandidates(port.deliveryReceipts(pullRequest.number), pullRequest);
    const receipt = candidates[0];
    if (candidates.length !== 1 || receipt === undefined) {
        fail(`PR #${pullRequest.number} must have exactly one canonical delivery receipt`);
    }
    return assertCanonicalDeliveryReceipt(receipt, pullRequest);
}

function ensureDeliveryReceipt(
    pullRequest: PullRequestSnapshot,
    closingIssue: number | undefined,
    port: DeliveryPort
): DeliveryReceiptPayload {
    const expected = expectedDeliveryReceipt(pullRequest, closingIssue);
    const existing = deliveryReceiptCandidates(port.deliveryReceipts(pullRequest.number), pullRequest);
    if (existing.length > 1) {
        fail(`PR #${pullRequest.number} has duplicate delivery receipts`);
    }
    let receipt = existing[0];
    if (receipt === undefined) {
        const body = composeDeliveryReceipt(expected);
        try {
            receipt = port.addDeliveryReceipt(pullRequest.number, body);
        } catch (error) {
            const recovered = deliveryReceiptCandidates(port.deliveryReceipts(pullRequest.number), pullRequest);
            if (recovered.length !== 1 || recovered[0] === undefined) {
                throw error;
            }
            receipt = recovered[0];
        }
    }
    assertCanonicalDeliveryReceipt(receipt, pullRequest, expected);
    const verified = deliveryReceiptCandidates(port.deliveryReceipts(pullRequest.number), pullRequest);
    if (verified.length !== 1 || verified[0]?.id !== receipt.id) {
        fail(`PR #${pullRequest.number} delivery receipt was not durably verified`);
    }
    return assertCanonicalDeliveryReceipt(verified[0], pullRequest, expected);
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

function completeIssueAfterMerge(
    pullRequestNumber: number,
    issueNumber: number | undefined,
    tracker: TrackerCompletionPort
): void {
    if (issueNumber === undefined) {
        return;
    }
    try {
        tracker.complete(issueNumber);
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(
            `PR #${pullRequestNumber} is already merged, but issue #${issueNumber} was not completed: ${detail}`,
            { cause: error }
        );
    }
}

export function deliverPullRequest(number: number, port: DeliveryPort, tracker: TrackerCompletionPort): void {
    port.fetch();
    const initial = port.pullRequest(number);
    validateBaseBranch(initial);
    if (initial.state === 'MERGED') {
        const receipt = readDeliveryReceipt(initial, port);
        const remaining = port.dependents(initial.headRefName).filter((candidate) => candidate.number !== number);
        retargetDependents(remaining, initial.baseRefName, port);
        completeIssueAfterMerge(number, receipt.closingIssue, tracker);
        port.log(`PR #${number} was already merged; repaired ${remaining.length} remaining dependent(s)`);
        return;
    }
    const initialTrackerTarget = trackerCompletionTarget(initial);
    validatePullRequest(initial);
    validateReview(number, port.reviewState(number, initial.headRefOid));

    const dependents = port.dependents(initial.headRefName).filter((candidate) => candidate.number !== number);
    if (dependents.length > 0 && port.repositoryDeletesMergedBranches()) {
        fail('automatic merged-branch deletion must be disabled before delivering a stacked PR');
    }
    port.log(`review size: ${initial.changedFiles} file(s), +${initial.additions}/-${initial.deletions}`);

    port.fetch();
    const current = port.pullRequest(number);
    const currentTrackerTarget = trackerCompletionTarget(current);
    validatePullRequest(current);
    validateStableTrackerTarget(number, initialTrackerTarget, currentTrackerTarget);
    validateStablePullRequest(initial, current);
    validateReview(number, port.reviewState(number, current.headRefOid));
    const currentDependents = port.dependents(current.headRefName).filter((candidate) => candidate.number !== number);
    validateDependentSet(dependents, currentDependents);
    for (const dependent of currentDependents) {
        validateDependent(port.pullRequest(dependent.number), dependent);
    }

    const receipt = ensureDeliveryReceipt(current, currentTrackerTarget, port);
    port.merge(number, current.headRefOid, currentDependents.length > 0);
    retargetDependents(currentDependents, current.baseRefName, port);
    completeIssueAfterMerge(number, receipt.closingIssue, tracker);
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

type RepositoryMergeSettings = {
    allow_merge_commit?: unknown;
    allow_rebase_merge?: unknown;
    allow_squash_merge?: unknown;
    delete_branch_on_merge?: unknown;
};

type RepositoryMergePolicy = {
    method: 'squash';
    deletesMergedBranches: boolean;
};

function repositoryMergePolicy(repository: string, shell: ShellRunner): RepositoryMergePolicy {
    let settings: RepositoryMergeSettings;
    try {
        settings = parseJson<RepositoryMergeSettings>(
            shell.capture('gh', ['api', `repos/${repository}`]),
            'repository merge settings'
        );
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`cannot determine repository merge settings: ${detail}`, { cause: error });
    }
    if (
        typeof settings.allow_merge_commit !== 'boolean' ||
        typeof settings.allow_squash_merge !== 'boolean' ||
        typeof settings.allow_rebase_merge !== 'boolean' ||
        typeof settings.delete_branch_on_merge !== 'boolean'
    ) {
        throw new TypeError('cannot prove repository merge settings');
    }
    if (!settings.allow_squash_merge) {
        throw new Error('squash merge is not enabled for this repository');
    }
    return { method: 'squash', deletesMergedBranches: settings.delete_branch_on_merge };
}

function toDeliveryReceiptComment(value: unknown): DeliveryReceiptComment {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        fail('invalid delivery receipt comment');
    }
    const comment = value as {
        node_id?: unknown;
        body?: unknown;
        user?: { login?: unknown; type?: unknown } | null;
        created_at?: unknown;
        updated_at?: unknown;
    };
    if (
        typeof comment.node_id !== 'string' ||
        typeof comment.body !== 'string' ||
        typeof comment.created_at !== 'string' ||
        typeof comment.updated_at !== 'string'
    ) {
        fail('invalid delivery receipt comment');
    }
    return {
        id: comment.node_id,
        body: comment.body,
        authorLogin: typeof comment.user?.login === 'string' ? comment.user.login : null,
        authorType: typeof comment.user?.type === 'string' ? comment.user.type : null,
        createdAt: comment.created_at,
        updatedAt: comment.updated_at,
    };
}

export function shellPort(
    repository: string,
    shell: ShellRunner = { capture, run },
    options: { gitToken?: string; helperDir?: string } = {}
): DeliveryPort {
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
        fetch: () => {
            if (options.gitToken !== undefined) {
                const helperDir =
                    options.helperDir ?? fail('authenticated git fetch requires a credential helper directory');
                shell.run(
                    'git',
                    gitAuthenticatedArgs(options.gitToken, helperDir, [
                        'fetch',
                        '--prune',
                        GITHUB_HTTPS_REMOTE,
                        '+refs/heads/*:refs/remotes/origin/*',
                    ])
                );
                return;
            }
            shell.run('git', ['fetch', '--prune', 'origin']);
        },
        pullRequest: (number) =>
            parseJson<PullRequestSnapshot>(
                shell.capture('gh', ['pr', 'view', String(number), '--repo', repository, '--json', pullRequestFields]),
                `PR #${number}`
            ),
        reviewState: (number, expectedHead) => {
            const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviews(last:100){nodes{state submittedAt author{login} commit{oid}} pageInfo{hasPreviousPage}} reviewThreads(first:100){nodes{isResolved} pageInfo{hasNextPage}}}}}`;
            const response = parseJson<{
                data?: {
                    repository?: {
                        pullRequest?: {
                            reviews: {
                                nodes: Array<{
                                    state: string;
                                    submittedAt?: string | null;
                                    author: { login: string } | null;
                                    commit: { oid: string } | null;
                                }>;
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
            const onHead = review.reviews.nodes.filter(
                (candidate) =>
                    candidate.state !== 'DISMISSED' &&
                    candidate.state !== 'PENDING' &&
                    candidate.commit?.oid === expectedHead &&
                    isReviewerBotLogin(candidate.author?.login)
            );
            onHead.sort((left, right) => (left.submittedAt ?? '').localeCompare(right.submittedAt ?? ''));
            return {
                latestReviewerStateOnHead: onHead.at(-1)?.state ?? null,
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
        merge: (number, expectedHead, hasDependents) => {
            const policy = repositoryMergePolicy(repository, shell);
            if (hasDependents && policy.deletesMergedBranches) {
                fail('automatic merged-branch deletion must be disabled before delivering a stacked PR');
            }
            const result = parseJson<{ merged: boolean; message: string }>(
                shell.capture('gh', [
                    'api',
                    '--method',
                    'PUT',
                    `repos/${repository}/pulls/${number}/merge`,
                    '-f',
                    `sha=${expectedHead}`,
                    '-f',
                    `merge_method=${policy.method}`,
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
        deliveryReceipts: (number) => {
            const pages = parseJson<unknown>(
                shell.capture('gh', [
                    'api',
                    '--paginate',
                    '--slurp',
                    `repos/${repository}/issues/${number}/comments?per_page=100`,
                ]),
                `delivery receipts for PR #${number}`
            );
            if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
                fail(`cannot inspect delivery receipts for PR #${number}`);
            }
            const comments = pages.flat().map(toDeliveryReceiptComment);
            if (new Set(comments.map((comment) => comment.id)).size !== comments.length) {
                fail(`duplicate comment identity on PR #${number}`);
            }
            return comments;
        },
        addDeliveryReceipt: (number, body) =>
            toDeliveryReceiptComment(
                parseJson<unknown>(
                    shell.capture('gh', [
                        'api',
                        '--method',
                        'POST',
                        `repos/${repository}/issues/${number}/comments`,
                        '-f',
                        `body=${body}`,
                    ]),
                    `delivery receipt for PR #${number}`
                )
            ),
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

export type DeliveryAuthentication = {
    minted: { token: string; login: string; permissions: Record<string, string> };
    session: { configDir: string; env: NodeJS.ProcessEnv; dispose: () => void };
};

export type DeliveryCoordinatorDependencies = {
    primaryRoot: () => string;
    authenticateAuthor: (primaryRoot: string) => Promise<DeliveryAuthentication>;
    authenticateTracker: (primaryRoot: string) => Promise<DeliveryAuthentication>;
    repositoryName: (session: DeliveryAuthentication['session'], primaryRoot: string) => string;
    deliveryPort: (repository: string, authentication: DeliveryAuthentication, primaryRoot: string) => DeliveryPort;
    trackerPort: (session: DeliveryAuthentication['session']) => ReconcileTrackerIssuePort;
    completeIssue: (issueNumber: number, login: string, port: ReconcileTrackerIssuePort) => void;
    deliver: (number: number, port: DeliveryPort, tracker: TrackerCompletionPort) => void;
};

function defaultDeliveryCoordinatorDependencies(cwd: string): DeliveryCoordinatorDependencies {
    return {
        primaryRoot: () => resolvePrimaryRoot(),
        authenticateAuthor: (primaryRoot) => authenticateRole({ primaryRoot, role: 'author' }),
        authenticateTracker: (primaryRoot) => authenticateTrackerAuthor({ primaryRoot }),
        repositoryName: (session, primaryRoot) =>
            spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
                env: session.env,
                cwd: primaryRoot,
            }),
        deliveryPort: (repository, authentication, primaryRoot) => {
            const shell: ShellRunner = {
                capture: (command, args) =>
                    spawnCapture(command, args, { env: authentication.session.env, cwd: primaryRoot }),
                run: (command, args) => spawnRun(command, args, { env: authentication.session.env, cwd: primaryRoot }),
            };
            return shellPort(repository, shell, {
                gitToken: authentication.minted.token,
                helperDir: authentication.session.configDir,
            });
        },
        trackerPort: (session) => trackerIssueShellPort(session, cwd),
        completeIssue: completeTrackerIssue,
        deliver: deliverPullRequest,
    };
}

export async function coordinateDelivery(
    number: number,
    dependencies: DeliveryCoordinatorDependencies = defaultDeliveryCoordinatorDependencies(process.cwd())
): Promise<void> {
    const primaryRoot = dependencies.primaryRoot();
    const authorAuth = await dependencies.authenticateAuthor(primaryRoot);
    let trackerAuth: DeliveryAuthentication | undefined;
    try {
        if (authorAuth.minted.login !== AUTHOR_BOT_LOGIN) {
            fail(`minted login ${authorAuth.minted.login} is not ${AUTHOR_BOT_LOGIN}`);
        }
        const repository = dependencies.repositoryName(authorAuth.session, primaryRoot);
        assertRequiredRepository(repository);
        const authenticatedTracker = await dependencies.authenticateTracker(primaryRoot);
        trackerAuth = authenticatedTracker;
        const trackerPort = dependencies.trackerPort(authenticatedTracker.session);
        dependencies.deliver(number, dependencies.deliveryPort(repository, authorAuth, primaryRoot), {
            complete: (issueNumber) =>
                dependencies.completeIssue(issueNumber, authenticatedTracker.minted.login, trackerPort),
        });
    } finally {
        trackerAuth?.session.dispose();
        authorAuth.session.dispose();
    }
}

export async function runDeliverCli(args: string[], dependencies?: DeliveryCoordinatorDependencies): Promise<number> {
    const parsed = parseCliArgs(args);
    if (parsed.help) {
        console.log('Usage: pnpm deliver <pr-number>');
        return 0;
    }
    if (parsed.number === undefined) {
        fail('usage: pnpm deliver <pr-number>');
    }
    await coordinateDelivery(parsed.number, dependencies);
    return 0;
}
