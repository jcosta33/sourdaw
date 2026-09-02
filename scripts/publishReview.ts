#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
    REQUIRED_REPOSITORY,
    REVIEWER_BOT_NODE_ID,
    assertRequiredRepository,
    authenticateRole,
    isReviewerBotNodeId,
    parseJson,
    resolvePrimaryRoot,
    spawnCapture,
    type GhSession,
} from './githubAppIdentity.ts';
import { composeReviewCommentBody, fail, type ReviewCommentContent } from './prContract.ts';
import { reviewBundlePath } from './prepareReview.ts';
import {
    type PullRequestMutationSerialization,
    type PullRequestRemoteMutationBoundary,
    currentReviewPublicationOwnerFence,
    isReviewPublicationPullRequestMutationLockOwner,
    pullRequestMutationLockRef,
    readPullRequestMutationLockOid,
    readPullRequestMutationLockOwner,
    readPullRequestMutationLockReceipt,
    recordReviewPublicationRecoveryReceipt,
    replacePullRequestMutationLockOwner,
    releasePullRequestMutationLockOwner,
    reviewPublicationOwnerFenceIsLive,
    withPullRequestMutationLock,
} from './pullRequestMutationLock.ts';
import { legacyReviewPublicationIncidents } from './reviewPublicationLegacyIncidents.ts';

export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES';

/**
 * GitHub's review-creation request and the review it hands back use two different vocabularies:
 * the request says `APPROVE` / `REQUEST_CHANGES` / `COMMENT`, the response says `APPROVED` /
 * `CHANGES_REQUESTED` / `COMMENTED`. GitHub can also silently coerce the requested event — most
 * observed when the PR closed or merged between bundle prep and posting — and return 200 with a
 * review whose recorded state does not match what was asked for. Map the two vocabularies
 * explicitly rather than by string coincidence, so a coercion is never mistaken for success.
 */
export const EXPECTED_REVIEW_STATE: Record<ReviewEvent, string> = {
    APPROVE: 'APPROVED',
    REQUEST_CHANGES: 'CHANGES_REQUESTED',
};

export type ReviewComment = {
    path: string;
    line: number;
    side: 'LEFT' | 'RIGHT';
    defect: string;
    consequence: string;
    done: string;
};

export type ReviewDocument = {
    event: ReviewEvent;
    body: string;
    comments: ReviewComment[];
};

export type PublishReviewPort = {
    primaryRoot: () => string;
    currentHead: (number: number) => string;
    readReviewJson: (path: string) => unknown;
    readBundleDiff: (path: string) => string;
    postReview: (input: {
        number: number;
        commitId: string;
        event: ReviewEvent;
        body: string;
        comments: ReviewComment[];
    }) => { id: number; actorNodeId: string; login: string };
    log: (message: string) => void;
};

export type PublishReviewAuthentication = {
    minted: { actorNodeId: string };
    session: GhSession;
};

export type PublishReviewCoordinatorDependencies = {
    primaryRoot: () => string;
    serializeMutation: PullRequestMutationSerialization;
    authenticateReviewer: (primaryRoot: string) => Promise<PublishReviewAuthentication>;
    repositoryName: (session: GhSession, primaryRoot: string) => string;
    reviewPort: (
        session: GhSession,
        primaryRoot: string,
        markRemoteMutationAttempt: PullRequestRemoteMutationBoundary['markRemoteMutationAttempt']
    ) => PublishReviewPort;
    publish: (number: number, port: PublishReviewPort, boundary?: PullRequestRemoteMutationBoundary) => number;
};

export function parsePublishReviewArgs(args: string[]): { number?: number; help: boolean } {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { help: true };
    }
    const value = Number(args[0]);
    if (!Number.isSafeInteger(value) || value <= 0 || args.length !== 1) {
        fail('usage: pnpm review:publish <pr-number>');
    }
    return { number: value, help: false };
}

export function parseReviewDocument(value: unknown): ReviewDocument {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        fail('review.json must be an object');
    }
    const record = value as Record<string, unknown>;
    if (record.event !== 'APPROVE' && record.event !== 'REQUEST_CHANGES') {
        fail('review.json event must be APPROVE or REQUEST_CHANGES');
    }
    const rawComments = commentsArray(record.comments);
    if (record.event === 'APPROVE' && rawComments.length > 0) {
        fail('APPROVE must carry no comments; an inline comment opens a thread that blocks the merge');
    }
    const comments = parseCommentEntries(rawComments);
    const body = typeof record.body === 'string' ? record.body : '';
    if (record.event === 'REQUEST_CHANGES') {
        if (comments.length === 0) {
            fail('REQUEST_CHANGES requires comments');
        }
        if (body.trim() === '') {
            fail('REQUEST_CHANGES requires a top-level body');
        }
    }
    if (record.event === 'APPROVE' && body.trim() === '') {
        fail('APPROVE requires a body stating what was attacked and held');
    }
    return { event: record.event, body, comments };
}

export function reviewPublicationPayload(input: {
    commitId: string;
    event: ReviewEvent;
    body: string;
    comments: ReviewComment[];
}): string {
    return JSON.stringify({
        commit_id: input.commitId,
        event: input.event,
        body: input.body,
        comments: input.comments.map((comment) => ({
            path: comment.path,
            line: comment.line,
            side: comment.side,
            body: composeReviewCommentBody(comment),
        })),
    });
}

export function reviewPublicationPayloadDigest(payload: string): string {
    return createHash('sha256').update(payload).digest('hex');
}

export function publishReview(
    number: number,
    port: PublishReviewPort,
    boundary?: PullRequestRemoteMutationBoundary
): number {
    const headSha = port.currentHead(number);
    const bundle = reviewBundlePath(port.primaryRoot(), number, headSha);
    let parsed: unknown;
    try {
        parsed = port.readReviewJson(join(bundle, 'review.json'));
    } catch {
        fail(`missing review.json at ${join(bundle, 'review.json')}`);
    }
    const document = parseReviewDocument(parsed);
    assertReviewCommentLinesInBundleDiff(document.comments, port.readBundleDiff(join(bundle, 'diff.patch')));
    const payload = reviewPublicationPayload({
        commitId: headSha,
        event: document.event,
        body: document.body,
        comments: document.comments,
    });
    boundary?.journalReviewPublication?.({
        expectedHead: headSha,
        payloadDigest: reviewPublicationPayloadDigest(payload),
        reviewerActorNodeId: REVIEWER_BOT_NODE_ID,
    });
    const current = port.currentHead(number);
    if (current !== headSha) {
        fail('pull-request head moved; refusing to post a stale review');
    }
    const posted = port.postReview({
        number,
        commitId: headSha,
        event: document.event,
        body: document.body,
        comments: document.comments,
    });
    if (!isReviewerBotNodeId(posted.actorNodeId)) {
        fail(`review was posted by actor ${posted.actorNodeId} (${posted.login}), not ${REVIEWER_BOT_NODE_ID}`);
    }
    port.log(String(posted.id));
    return posted.id;
}

export function shellPort(
    session: GhSession,
    cwd: string = process.cwd(),
    capture: typeof spawnCapture = spawnCapture,
    markRemoteMutationAttempt: PullRequestRemoteMutationBoundary['markRemoteMutationAttempt'] = () => undefined
): PublishReviewPort {
    const primaryRoot = resolvePrimaryRoot(
        (command, args, directory) => capture(command, args, { cwd: directory }),
        cwd
    );
    const gh = (args: string[], input?: string) => capture('gh', args, { cwd: primaryRoot, env: session.env, input });
    return {
        primaryRoot: () => primaryRoot,
        currentHead: (number) =>
            capture(
                'gh',
                [
                    'pr',
                    'view',
                    String(number),
                    '--repo',
                    REQUIRED_REPOSITORY,
                    '--json',
                    'headRefOid',
                    '--jq',
                    '.headRefOid',
                ],
                { cwd: primaryRoot, env: session.env }
            ),
        readReviewJson: (path) => JSON.parse(readFileSync(path, 'utf8')) as unknown,
        readBundleDiff: (path) => readFileSync(path, 'utf8'),
        postReview: ({ number, commitId, event, body, comments }) => {
            const input = reviewPublicationPayload({ commitId, event, body, comments });
            markRemoteMutationAttempt();
            const response = parseJson<{
                id: number;
                state?: string;
                user?: { node_id?: string; login?: string };
            }>(
                gh(
                    ['api', '--method', 'POST', `repos/${REQUIRED_REPOSITORY}/pulls/${number}/reviews`, '--input', '-'],
                    input
                ),
                'create review'
            );
            if (!Number.isSafeInteger(response.id) || response.id <= 0) {
                fail('create review returned an unreadable id');
            }
            const expectedState = EXPECTED_REVIEW_STATE[event];
            if (response.state !== expectedState) {
                fail(
                    `review ${response.id} requested ${event} but GitHub recorded ${response.state ?? 'no state'}; refusing to report success`
                );
            }
            return {
                id: response.id,
                actorNodeId: response.user?.node_id ?? '',
                login: response.user?.login ?? '',
            };
        },
        log: (message) => {
            console.log(message);
        },
    };
}

function commentsArray(value: unknown): unknown[] {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        fail('review.json comments must be an array');
    }
    return value;
}

function assertReviewCommentLinesInBundleDiff(comments: ReviewComment[], diff: string): void {
    const changed = changedDiffLines(diff);
    for (const [index, comment] of comments.entries()) {
        const lines = changed.get(comment.path);
        const side = comment.side === 'RIGHT' ? lines?.right : lines?.left;
        if (side?.has(comment.line) !== true) {
            fail(
                `review.json comments[${index}] ${comment.side} ${comment.path}:${comment.line} is not a changed line in bundle diff.patch`
            );
        }
    }
}

function changedDiffLines(diff: string): Map<string, { left: Set<number>; right: Set<number> }> {
    const changed = new Map<string, { left: Set<number>; right: Set<number> }>();
    let oldPath: string | undefined;
    let newPath: string | undefined;
    let leftLine: number | undefined;
    let rightLine: number | undefined;
    for (const line of diff.split('\n')) {
        if (line.startsWith('diff --git ')) {
            oldPath = undefined;
            newPath = undefined;
            leftLine = undefined;
            rightLine = undefined;
            continue;
        }
        if (leftLine === undefined && rightLine === undefined && line.startsWith('--- ')) {
            oldPath = diffPath(line.slice(4), 'a/');
            continue;
        }
        if (leftLine === undefined && rightLine === undefined && line.startsWith('+++ ')) {
            newPath = diffPath(line.slice(4), 'b/');
            leftLine = undefined;
            rightLine = undefined;
            continue;
        }
        const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        if (hunk !== null) {
            leftLine = Number(hunk[1]);
            rightLine = Number(hunk[2]);
            continue;
        }
        if (leftLine === undefined || rightLine === undefined || line === '') {
            continue;
        }
        if (line.startsWith('-')) {
            if (oldPath !== undefined) {
                const entry = changed.get(oldPath) ?? { left: new Set<number>(), right: new Set<number>() };
                entry.left.add(leftLine);
                changed.set(oldPath, entry);
            }
            leftLine += 1;
        } else if (line.startsWith('+')) {
            if (newPath !== undefined) {
                const entry = changed.get(newPath) ?? { left: new Set<number>(), right: new Set<number>() };
                entry.right.add(rightLine);
                changed.set(newPath, entry);
            }
            rightLine += 1;
        } else if (line.startsWith(' ')) {
            leftLine += 1;
            rightLine += 1;
        } else {
            continue;
        }
    }
    return changed;
}

function diffPath(value: string, prefix: 'a/' | 'b/'): string | undefined {
    if (value === '/dev/null') {
        return undefined;
    }
    return value.startsWith(prefix) ? value.slice(prefix.length) : undefined;
}

/**
 * The one place `defect` / `consequence` / `done` are still `unknown`: everything upstream of this
 * function reads raw JSON, and everything downstream trusts `ReviewCommentContent`. Each `typeof`
 * check below narrows a genuinely unknown value, unlike a check written against an input already
 * typed `string` — that version compiles clean but is unreachable, and an "unnecessary condition"
 * cleanup would delete it as dead code with nothing to object. Composing through
 * `composeReviewCommentBody` here, rather than after returning, keeps the byte-ceiling and format
 * failures for this comment's fields naming this comment's index too.
 */
function parseReviewCommentContent(
    fields: { defect: unknown; consequence: unknown; done: unknown },
    index: number
): ReviewCommentContent {
    const { defect, consequence, done } = fields;
    if (typeof defect !== 'string') {
        fail(`review.json comments[${index}] defect is invalid`);
    }
    if (typeof consequence !== 'string') {
        fail(`review.json comments[${index}] consequence is invalid`);
    }
    if (typeof done !== 'string') {
        fail(`review.json comments[${index}] done is invalid`);
    }
    const content: ReviewCommentContent = { defect, consequence, done };
    composeReviewCommentBody(content, `review.json comments[${index}]`);
    return content;
}

function parseCommentEntries(entries: unknown[]): ReviewComment[] {
    return entries.map((entry, index) => {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
            fail(`review.json comments[${index}] must be an object`);
        }
        const record = entry as Record<string, unknown>;
        if ('body' in record) {
            fail(`review.json comments[${index}] uses body; supply defect, consequence, and done instead`);
        }
        const path = record.path;
        const line = record.line;
        const side = record.side;
        if (typeof path !== 'string' || path === '') {
            fail(`review.json comments[${index}] path is invalid`);
        }
        if (typeof line !== 'number' || !Number.isSafeInteger(line) || line <= 0) {
            fail(`review.json comments[${index}] line is invalid`);
        }
        if (side !== 'LEFT' && side !== 'RIGHT') {
            fail(`review.json comments[${index}] side must be LEFT or RIGHT`);
        }
        const content = parseReviewCommentContent(
            { defect: record.defect, consequence: record.consequence, done: record.done },
            index
        );
        return { path, line, side, ...content };
    });
}

export function defaultPublishReviewCoordinatorDependencies(): PublishReviewCoordinatorDependencies {
    return {
        primaryRoot: () => resolvePrimaryRoot(),
        serializeMutation: withPullRequestMutationLock,
        authenticateReviewer: (primaryRoot) => authenticateRole({ primaryRoot, role: 'reviewer' }),
        repositoryName: (session, primaryRoot) =>
            spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
                env: session.env,
                cwd: primaryRoot,
            }),
        reviewPort: (session, primaryRoot, markRemoteMutationAttempt) =>
            shellPort(session, primaryRoot, spawnCapture, markRemoteMutationAttempt),
        publish: publishReview,
    };
}

export async function coordinatePublishReview(
    number: number,
    dependencies: PublishReviewCoordinatorDependencies = defaultPublishReviewCoordinatorDependencies()
): Promise<void> {
    const primaryRoot = dependencies.primaryRoot();
    try {
        await dependencies.serializeMutation(primaryRoot, number, async (boundary) => {
            const auth = await dependencies.authenticateReviewer(primaryRoot);
            try {
                if (!isReviewerBotNodeId(auth.minted.actorNodeId)) {
                    fail(`minted actor ${auth.minted.actorNodeId} is not ${REVIEWER_BOT_NODE_ID}`);
                }
                assertRequiredRepository(dependencies.repositoryName(auth.session, primaryRoot));
                dependencies.publish(
                    number,
                    dependencies.reviewPort(auth.session, primaryRoot, boundary.markRemoteMutationAttempt),
                    boundary
                );
            } finally {
                auth.session.dispose();
            }
        });
    } catch (error) {
        const recovery = retainedReviewPublicationRecoveryCommand(primaryRoot, number);
        if (recovery === undefined) {
            throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${message}; retained exact review-publication owner: ${recovery}`, { cause: error });
    }
}

function retainedReviewPublicationRecoveryCommand(primaryRoot: string, number: number): string | undefined {
    try {
        const ownerOid = readPullRequestMutationLockOid(primaryRoot, pullRequestMutationLockRef(number), number);
        if (ownerOid === undefined) {
            return undefined;
        }
        const owner = readPullRequestMutationLockOwner(primaryRoot, ownerOid, number);
        if (!isReviewPublicationPullRequestMutationLockOwner(owner)) {
            return undefined;
        }
        return `pnpm review:publish:recover ${number} --owner ${ownerOid}`;
    } catch {
        return undefined;
    }
}

export async function runPublishReviewCli(
    args: string[],
    dependencies?: PublishReviewCoordinatorDependencies
): Promise<number> {
    const parsed = parsePublishReviewArgs(args);
    if (parsed.help) {
        console.log('Usage: pnpm review:publish <pr-number>');
        return 0;
    }
    if (parsed.number === undefined) {
        fail('usage: pnpm review:publish <pr-number>');
    }
    await coordinatePublishReview(parsed.number, dependencies);
    return 0;
}

export type RecoverPublishReviewArgs = {
    number?: number;
    owner?: string;
    help: boolean;
};

export type RemotePublishedReview = {
    id: number;
    state: string;
    body: string;
    commitId: string;
    actorNodeId: string;
    comments: Array<{ path: string; line: number; side: 'LEFT' | 'RIGHT'; body: string }>;
};

type RecoveryInspection = {
    state: string;
    head: string;
    reviews: RemotePublishedReview[];
    otherActorReviews?: RemotePublishedReview[];
};

export type RecoverPublishReviewDependencies = {
    primaryRoot: () => string;
    authenticateReviewer: (primaryRoot: string) => Promise<PublishReviewAuthentication>;
    repositoryName: (session: GhSession, primaryRoot: string) => string;
    inspect: (
        number: number,
        expectedActorNodeId: string,
        expectedHead: string,
        session: GhSession,
        primaryRoot: string
    ) => RecoveryInspection;
    isOwnerLive?: (
        owner: Extract<import('./pullRequestMutationLock.ts').PullRequestMutationLockOwner, { version: 3 }>
    ) => boolean;
    currentOwnerFence?: () => import('./pullRequestMutationLock.ts').PullRequestMutationLockOwnerFence;
};

const recoverPublishReviewUsage = 'usage: pnpm review:publish:recover <pr-number> --owner <lock-object-id>';

export function parseRecoverPublishReviewArgs(args: string[]): RecoverPublishReviewArgs {
    if (args.length === 1 && args[0] === '--help') {
        return { help: true };
    }
    if (args.length !== 3 || !/^[1-9][0-9]*$/u.test(args[0] ?? '') || args[1] !== '--owner') {
        fail(recoverPublishReviewUsage);
    }
    const number = Number(args[0]);
    const owner = args[2];
    if (!Number.isSafeInteger(number) || owner === undefined || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(owner)) {
        fail(recoverPublishReviewUsage);
    }
    return { number, owner: owner.toLowerCase(), help: false };
}

function defaultRecoverPublishReviewDependencies(): RecoverPublishReviewDependencies {
    return {
        primaryRoot: () => resolvePrimaryRoot(),
        authenticateReviewer: (primaryRoot) => authenticateRole({ primaryRoot, role: 'reviewer' }),
        repositoryName: (session, primaryRoot) =>
            spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
                env: session.env,
                cwd: primaryRoot,
            }),
        inspect: (number, expectedActorNodeId, expectedHead, session, primaryRoot) => {
            const gh = (args: string[]) => spawnCapture('gh', args, { env: session.env, cwd: primaryRoot });
            return inspectReviewPublicationRemote(number, expectedActorNodeId, expectedHead, gh);
        },
        isOwnerLive: reviewPublicationOwnerFenceIsLive,
    };
}

export function inspectReviewPublicationRemote(
    number: number,
    expectedActorNodeId: string,
    expectedHead: string,
    gh: (args: string[]) => string
): { state: string; head: string; reviews: RemotePublishedReview[] } {
    const pullRequest = parseJson<{ state?: unknown; headRefOid?: unknown }>(
        gh(['pr', 'view', String(number), '--repo', REQUIRED_REPOSITORY, '--json', 'state,headRefOid']),
        'review-publication recovery pull request'
    );
    if (typeof pullRequest.state !== 'string' || typeof pullRequest.headRefOid !== 'string') {
        fail('review-publication recovery pull request is unreadable');
    }
    const remote = flattenedGhPages(
        parseJson<unknown>(
            gh(['api', '--paginate', '--slurp', `repos/${REQUIRED_REPOSITORY}/pulls/${number}/reviews?per_page=100`]),
            'review-publication recovery reviews'
        ),
        'review-publication recovery reviews'
    );
    const remoteComments = flattenedGhPages(
        parseJson<unknown>(
            gh(['api', '--paginate', '--slurp', `repos/${REQUIRED_REPOSITORY}/pulls/${number}/comments?per_page=100`]),
            'review-publication recovery pull-request comments'
        ),
        'review-publication recovery pull-request comments'
    );
    const reviews: RemotePublishedReview[] = [];
    const otherActorReviews: RemotePublishedReview[] = [];
    for (const entry of remote) {
        if (entry === null || typeof entry !== 'object') {
            fail('review-publication recovery reviews are unreadable');
        }
        const record = entry as Record<string, unknown>;
        const user = record.user;
        if (typeof user !== 'object' || user === null || typeof (user as { node_id?: unknown }).node_id !== 'string') {
            fail('review-publication recovery reviews are unreadable');
        }
        if (record.commit_id !== expectedHead) {
            continue;
        }
        if (
            !Number.isSafeInteger(record.id) ||
            typeof record.state !== 'string' ||
            typeof record.body !== 'string' ||
            typeof record.commit_id !== 'string'
        ) {
            fail('review-publication recovery review candidate is unreadable');
        }
        const candidate: RemotePublishedReview = {
            id: record.id,
            state: record.state,
            body: record.body,
            commitId: record.commit_id,
            actorNodeId: (user as { node_id: string }).node_id,
            comments: remoteComments
                .filter((comment) => {
                    if (
                        comment === null ||
                        typeof comment !== 'object' ||
                        !Number.isSafeInteger((comment as { pull_request_review_id?: unknown }).pull_request_review_id)
                    ) {
                        fail('review-publication recovery pull-request comment is unreadable');
                    }
                    return (comment as { pull_request_review_id: number }).pull_request_review_id === record.id;
                })
                .map((comment) => {
                    if (
                        comment === null ||
                        typeof comment !== 'object' ||
                        typeof (comment as { path?: unknown }).path !== 'string' ||
                        !Number.isSafeInteger((comment as { original_line?: unknown }).original_line) ||
                        ((comment as { side?: unknown }).side !== 'LEFT' &&
                            (comment as { side?: unknown }).side !== 'RIGHT') ||
                        typeof (comment as { body?: unknown }).body !== 'string'
                    ) {
                        fail('review-publication recovery pull-request comment is unreadable');
                    }
                    return {
                        path: (comment as { path: string }).path,
                        line: (comment as { original_line: number }).original_line,
                        side: (comment as { side: 'LEFT' | 'RIGHT' }).side,
                        body: (comment as { body: string }).body,
                    };
                }),
        };
        if ((user as { node_id: string }).node_id === expectedActorNodeId) {
            reviews.push(candidate);
        } else {
            otherActorReviews.push(candidate);
        }
    }
    return {
        state: pullRequest.state,
        head: pullRequest.headRefOid.toLowerCase(),
        reviews,
        ...(otherActorReviews.length === 0 ? {} : { otherActorReviews }),
    };
}

function flattenedGhPages(value: unknown, label: string): unknown[] {
    if (!Array.isArray(value)) {
        fail(`${label} are unreadable`);
    }
    if (value.every((page) => Array.isArray(page))) {
        return value.flat();
    }
    if (value.every((entry) => !Array.isArray(entry))) {
        return value;
    }
    return fail(`${label} are unreadable`);
}

export function exactPublishedReview(
    review: RemotePublishedReview,
    document: ReviewDocument,
    head: string,
    actorNodeId: string
): boolean {
    if (
        review.actorNodeId !== actorNodeId ||
        review.commitId !== head ||
        review.state !== EXPECTED_REVIEW_STATE[document.event] ||
        review.body !== document.body ||
        review.comments.length !== document.comments.length
    ) {
        return false;
    }
    return review.comments.every((comment, index) => {
        const expected = document.comments[index];
        return (
            expected !== undefined &&
            comment.path === expected.path &&
            comment.line === expected.line &&
            comment.side === expected.side &&
            comment.body === composeReviewCommentBody(expected)
        );
    });
}

function recoveryReceipt(
    number: number,
    ownerOid: string,
    head: string,
    payloadDigest: string,
    outcome: string
): object {
    return { version: 1, operation: 'review-publication-recovery', number, ownerOid, head, payloadDigest, outcome };
}

function isMatchingRecoveryReceipt(value: unknown, number: number, ownerOid: string): boolean {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const receipt = value as Record<string, unknown>;
    return (
        receipt.version === 1 &&
        receipt.operation === 'review-publication-recovery' &&
        receipt.number === number &&
        receipt.ownerOid === ownerOid &&
        typeof receipt.head === 'string' &&
        typeof receipt.payloadDigest === 'string' &&
        (receipt.outcome === 'absent' || receipt.outcome === 'landed')
    );
}

export async function runRecoverPublishReviewLockCli(
    args: string[],
    dependencies: RecoverPublishReviewDependencies = defaultRecoverPublishReviewDependencies()
): Promise<number> {
    const parsed = parseRecoverPublishReviewArgs(args);
    if (parsed.help) {
        console.log(`Usage: ${recoverPublishReviewUsage.slice('usage: '.length)}`);
        return 0;
    }
    const number = parsed.number!;
    const ownerOid = parsed.owner!;
    const primaryRoot = dependencies.primaryRoot();
    const currentOid = readPullRequestMutationLockOid(primaryRoot, pullRequestMutationLockRef(number), number);
    if (currentOid === undefined) {
        if (
            isMatchingRecoveryReceipt(
                readPullRequestMutationLockReceipt(primaryRoot, number, ownerOid),
                number,
                ownerOid
            )
        ) {
            console.log(`review-publication-lock-already-recovered:${number}:${ownerOid}`);
            return 0;
        }
        fail(`PR #${number} review-publication lock is absent without an exact recovery receipt`);
    }
    if (currentOid !== ownerOid) {
        fail(`PR #${number} delivery lock ownership changed before recovery`);
    }
    const originalOwner = readPullRequestMutationLockOwner(primaryRoot, currentOid, number);
    const legacy = originalOwner.version === 1;
    if (!legacy && !isReviewPublicationPullRequestMutationLockOwner(originalOwner)) {
        fail(`PR #${number} recovery requires a review-publication lock owner`);
    }
    const incident = legacy
        ? legacyReviewPublicationIncidents.find(
              (candidate) => candidate.number === number && candidate.ownerOid === ownerOid
          )
        : undefined;
    if (
        legacy &&
        (incident === undefined ||
            originalOwner.pid !== incident.owner.pid ||
            originalOwner.token !== incident.owner.token ||
            incident.definitiveNoMutationHttpStatus !== 422)
    ) {
        fail('legacy review-publication recovery requires the exact trusted incident receipt');
    }
    if (!legacy && (dependencies.isOwnerLive ?? reviewPublicationOwnerFenceIsLive)(originalOwner)) {
        fail(`PR #${number} review-publication lock is still held by a live process`);
    }
    if (legacy) {
        try {
            process.kill(originalOwner.pid, 0);
            fail(`PR #${number} legacy review-publication lock is still held by a live process`);
        } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
                throw error;
            }
        }
    }
    const expectedHead = legacy ? incident.expectedHead : originalOwner.expectedHead;
    const expectedActorNodeId = legacy ? incident.reviewerActorNodeId : originalOwner.reviewerActorNodeId;
    const auth = await dependencies.authenticateReviewer(primaryRoot);
    try {
        if (!isReviewerBotNodeId(auth.minted.actorNodeId)) {
            fail(`minted actor ${auth.minted.actorNodeId} is not ${REVIEWER_BOT_NODE_ID}`);
        }
        assertRequiredRepository(dependencies.repositoryName(auth.session, primaryRoot));
        const bundle = reviewBundlePath(primaryRoot, number, expectedHead);
        const document = parseReviewDocument(JSON.parse(readFileSync(join(bundle, 'review.json'), 'utf8')) as unknown);
        assertReviewCommentLinesInBundleDiff(document.comments, readFileSync(join(bundle, 'diff.patch'), 'utf8'));
        if (legacy && JSON.stringify(document) !== JSON.stringify(incident.preparedPayload)) {
            fail('legacy review-publication recovery bundle does not match the trusted incident receipt');
        }
        const payloadDigest = reviewPublicationPayloadDigest(
            reviewPublicationPayload({
                commitId: expectedHead,
                event: document.event,
                body: document.body,
                comments: document.comments,
            })
        );
        const expectedDigest = legacy
            ? reviewPublicationPayloadDigest(
                  reviewPublicationPayload({
                      commitId: expectedHead,
                      event: incident.preparedPayload.event,
                      body: incident.preparedPayload.body,
                      comments: incident.preparedPayload.comments,
                  })
              )
            : originalOwner.payloadDigest;
        if (payloadDigest !== expectedDigest) {
            fail('review-publication recovery payload does not match the retained lock');
        }
        const first = dependencies.inspect(number, expectedActorNodeId, expectedHead, auth.session, primaryRoot);
        if (
            (first.otherActorReviews ?? []).some((review) =>
                exactPublishedReview(review, document, expectedHead, review.actorNodeId)
            )
        ) {
            fail('review-publication recovery found unauthorized landed review evidence');
        }
        if (
            first.reviews.length > 1 ||
            (first.reviews.length === 1 &&
                !exactPublishedReview(first.reviews[0]!, document, expectedHead, expectedActorNodeId))
        ) {
            fail('review-publication recovery found ambiguous or non-exact remote review evidence');
        }
        const adoptedOwner = {
            version: 3 as const,
            pid: process.pid,
            token: randomUUID(),
            operation: 'review-publication' as const,
            number,
            expectedHead,
            payloadDigest: expectedDigest,
            reviewerActorNodeId: expectedActorNodeId,
            ownerFence: dependencies.currentOwnerFence?.() ?? currentReviewPublicationOwnerFence(),
            mutation: { phase: 'prepared' as const, epoch: legacy ? 1 : originalOwner.mutation.epoch + 1 },
            ...(legacy
                ? {
                      recovery: {
                          legacyOwnerOid: ownerOid,
                          definitiveNoMutationHttpStatus: 422 as const,
                      },
                  }
                : {}),
        };
        const adoptedOid = replacePullRequestMutationLockOwner(primaryRoot, number, ownerOid, adoptedOwner);
        try {
            const second = dependencies.inspect(number, expectedActorNodeId, expectedHead, auth.session, primaryRoot);
            if (
                second.state !== first.state ||
                second.head !== first.head ||
                (second.otherActorReviews ?? []).some((review) =>
                    exactPublishedReview(review, document, expectedHead, review.actorNodeId)
                ) ||
                second.reviews.length !== first.reviews.length ||
                (second.reviews.length === 1 &&
                    !exactPublishedReview(second.reviews[0]!, document, expectedHead, expectedActorNodeId))
            ) {
                fail('review-publication recovery remote state changed during reconciliation');
            }
            const outcome = second.reviews.length === 1 ? 'landed' : 'absent';
            recordReviewPublicationRecoveryReceipt(
                primaryRoot,
                number,
                ownerOid,
                recoveryReceipt(number, ownerOid, expectedHead, expectedDigest, outcome)
            );
            releasePullRequestMutationLockOwner(primaryRoot, number, adoptedOid);
            console.log(`review-publication-lock-recovered:${number}:${ownerOid}:${outcome}`);
            return 0;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(
                `${message}; PR #${number} review-publication recovery preserved exact lock owner ${adoptedOid}`,
                { cause: error }
            );
        }
    } finally {
        auth.session.dispose();
    }
}
