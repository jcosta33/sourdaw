#!/usr/bin/env node
import { createHash } from 'node:crypto';
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
    type PullRequestRemoteMutationBoundary,
    type PullRequestReviewPublicationMutationBoundary,
    type PullRequestReviewPublicationMutationSerialization,
    currentMutationOwnerFence,
    isReviewPublicationPullRequestMutationLockOwner,
    pullRequestMutationLockRef,
    readPullRequestMutationLockOid,
    readPullRequestMutationLockOwner,
    withPullRequestReviewPublicationMutationLock,
} from './pullRequestMutationLock.ts';
import { assertReviewCommentLinesInBundleDiff } from './reviewCommentDiffPreflight.ts';

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
    pullRequest: (number: number) => { state: string; head: string };
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
    serializeMutation: PullRequestReviewPublicationMutationSerialization;
    authenticateReviewer: (primaryRoot: string) => Promise<PublishReviewAuthentication>;
    repositoryName: (session: GhSession, primaryRoot: string) => string;
    reviewPort: (
        session: GhSession,
        primaryRoot: string,
        markRemoteMutationAttempt: PullRequestRemoteMutationBoundary['markRemoteMutationAttempt'],
        markDefinitiveNoMutationHttpStatus: PullRequestReviewPublicationMutationBoundary['markDefinitiveNoMutationHttpStatus']
    ) => PublishReviewPort;
    publish: (
        number: number,
        prepared: PreparedReviewPublication,
        port: PublishReviewPort,
        boundary: PullRequestReviewPublicationMutationBoundary
    ) => number;
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

export type PreparedReviewPublication = {
    head: string;
    document: ReviewDocument;
    payloadDigest: string;
};

function prepareReviewPublication(number: number, port: PublishReviewPort): PreparedReviewPublication {
    const head = port.pullRequest(number).head;
    const bundle = reviewBundlePath(port.primaryRoot(), number, head);
    let parsed: unknown;
    try {
        parsed = port.readReviewJson(join(bundle, 'review.json'));
    } catch {
        fail(`missing review.json at ${join(bundle, 'review.json')}`);
    }
    const document = parseReviewDocument(parsed);
    assertReviewCommentLinesInBundleDiff(document.comments, port.readBundleDiff(join(bundle, 'diff.patch')));
    return {
        head,
        document,
        payloadDigest: reviewPublicationPayloadDigest(
            reviewPublicationPayload({
                commitId: head,
                event: document.event,
                body: document.body,
                comments: document.comments,
            })
        ),
    };
}

export function publishPreparedReview(
    number: number,
    prepared: PreparedReviewPublication,
    port: PublishReviewPort,
    boundary?: PullRequestReviewPublicationMutationBoundary
): number {
    const pullRequest = port.pullRequest(number);
    if (pullRequest.state !== 'OPEN') {
        fail(`pull request is ${pullRequest.state}; refusing to post a review`);
    }
    if (pullRequest.head !== prepared.head) {
        fail('pull-request head moved; refusing to post a stale review');
    }
    boundary?.journalReviewPublication({
        expectedHead: prepared.head,
        payloadDigest: prepared.payloadDigest,
        reviewerActorNodeId: REVIEWER_BOT_NODE_ID,
    });
    const posted = port.postReview({
        number,
        commitId: prepared.head,
        event: prepared.document.event,
        body: prepared.document.body,
        comments: prepared.document.comments,
    });
    if (!isReviewerBotNodeId(posted.actorNodeId)) {
        fail(`review was posted by actor ${posted.actorNodeId} (${posted.login}), not ${REVIEWER_BOT_NODE_ID}`);
    }
    port.log(String(posted.id));
    return posted.id;
}

export function publishReview(
    number: number,
    port: PublishReviewPort,
    boundary?: PullRequestReviewPublicationMutationBoundary
): number {
    return publishPreparedReview(number, prepareReviewPublication(number, port), port, boundary);
}

export function shellPort(
    session: GhSession,
    cwd: string = process.cwd(),
    capture: typeof spawnCapture = spawnCapture,
    markRemoteMutationAttempt: PullRequestRemoteMutationBoundary['markRemoteMutationAttempt'] = () => undefined,
    markDefinitiveNoMutationHttpStatus: PullRequestReviewPublicationMutationBoundary['markDefinitiveNoMutationHttpStatus'] = () =>
        undefined
): PublishReviewPort {
    const primaryRoot = resolvePrimaryRoot(
        (command, args, directory) => capture(command, args, { cwd: directory }),
        cwd
    );
    const gh = (args: string[], input?: string) => capture('gh', args, { cwd: primaryRoot, env: session.env, input });
    return {
        primaryRoot: () => primaryRoot,
        pullRequest: (number) => {
            const pullRequest = parseJson<{ state?: unknown; headRefOid?: unknown }>(
                gh(['pr', 'view', String(number), '--repo', REQUIRED_REPOSITORY, '--json', 'state,headRefOid']),
                'review publication pull request'
            );
            if (typeof pullRequest.state !== 'string' || typeof pullRequest.headRefOid !== 'string') {
                fail('review publication pull request is unreadable');
            }
            return { state: pullRequest.state, head: pullRequest.headRefOid };
        },
        readReviewJson: (path) => JSON.parse(readFileSync(path, 'utf8')) as unknown,
        readBundleDiff: (path) => readFileSync(path, 'utf8'),
        postReview: ({ number, commitId, event, body, comments }) => {
            const input = reviewPublicationPayload({ commitId, event, body, comments });
            markRemoteMutationAttempt();
            let created: string;
            try {
                created = gh(
                    ['api', '--method', 'POST', `repos/${REQUIRED_REPOSITORY}/pulls/${number}/reviews`, '--input', '-'],
                    input
                );
            } catch (error) {
                // GitHub validates a review creation before persisting it, so its 422 answer
                // proves the POST created nothing. Journal that proof into the lock owner so
                // exact-owner recovery can tell this failure apart from an indeterminate one.
                if (error instanceof Error && /\bHTTP 422\b/u.test(error.message)) {
                    markDefinitiveNoMutationHttpStatus(422);
                }
                throw error;
            }
            const response = parseJson<{
                id: number;
                state?: string;
                user?: { node_id?: string; login?: string };
            }>(created, 'create review');
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
        serializeMutation: withPullRequestReviewPublicationMutationLock,
        authenticateReviewer: (primaryRoot) => authenticateRole({ primaryRoot, role: 'reviewer' }),
        repositoryName: (session, primaryRoot) =>
            spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
                env: session.env,
                cwd: primaryRoot,
            }),
        reviewPort: (session, primaryRoot, markRemoteMutationAttempt, markDefinitiveNoMutationHttpStatus) =>
            shellPort(
                session,
                primaryRoot,
                spawnCapture,
                markRemoteMutationAttempt,
                markDefinitiveNoMutationHttpStatus
            ),
        publish: publishPreparedReview,
    };
}

export async function coordinatePublishReview(
    number: number,
    dependencies: PublishReviewCoordinatorDependencies = defaultPublishReviewCoordinatorDependencies()
): Promise<void> {
    const primaryRoot = dependencies.primaryRoot();
    try {
        const auth = await dependencies.authenticateReviewer(primaryRoot);
        try {
            if (!isReviewerBotNodeId(auth.minted.actorNodeId)) {
                fail(`minted actor ${auth.minted.actorNodeId} is not ${REVIEWER_BOT_NODE_ID}`);
            }
            assertRequiredRepository(dependencies.repositoryName(auth.session, primaryRoot));
            const preflightPort = dependencies.reviewPort(
                auth.session,
                primaryRoot,
                () => undefined,
                () => undefined
            );
            const prepared = prepareReviewPublication(number, preflightPort);
            await dependencies.serializeMutation(
                primaryRoot,
                number,
                async (boundary) =>
                    dependencies.publish(
                        number,
                        prepared,
                        dependencies.reviewPort(
                            auth.session,
                            primaryRoot,
                            boundary.markRemoteMutationAttempt,
                            boundary.markDefinitiveNoMutationHttpStatus
                        ),
                        boundary
                    ),
                {
                    reviewPublication: {
                        expectedHead: prepared.head,
                        payloadDigest: prepared.payloadDigest,
                        reviewerActorNodeId: auth.minted.actorNodeId,
                        ownerFence: currentMutationOwnerFence,
                    },
                }
            );
        } finally {
            auth.session.dispose();
        }
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
