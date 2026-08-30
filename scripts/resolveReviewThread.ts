#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

import {
    AUTHOR_BOT_NODE_ID,
    REQUIRED_REPOSITORY,
    REVIEWER_BOT_NODE_ID,
    assertRequiredRepository,
    assertTrustedExecutingBlob,
    authenticateRole,
    isAuthorBotNodeId,
    isReviewerBotNodeId,
    originMainBlob,
    parseGraphqlResponse,
    resolvePrimaryRoot,
    spawnCapture,
    type GhSession,
} from './githubAppIdentity.ts';
import { fail } from './prContract.ts';

export type ReviewComment = {
    id: string;
    fullDatabaseId: string;
    body: string;
    authorNodeId: string | null;
    authorLogin: string | null;
    authorType: string | null;
    reviewId: string | null;
    reviewState: string | null;
    reviewBody: string | null;
    reviewCommitOid: string | null;
    reviewAuthorNodeId: string | null;
    reviewAuthorLogin: string | null;
    reviewAuthorType: string | null;
};
export type PullRequestReview = {
    id: string;
    state: string;
    body: string;
    commitOid: string | null;
    authorNodeId: string | null;
    authorLogin: string | null;
    authorType: string | null;
};
export type ReviewThread = {
    id: string;
    isResolved: boolean;
    resolvedByNodeId: string | null;
    resolvedByLogin: string | null;
    resolvedByType: string | null;
    rootCommentId: string | null;
    rootCommentFullDatabaseId: string | null;
    rootAuthorNodeId: string | null;
    rootAuthorLogin: string | null;
    rootAuthorType: string | null;
    comments: ReviewComment[];
};
export type ReviewThreadInspection = {
    pullRequestId: string;
    head: string;
    thread: ReviewThread | null;
    pendingReviews: PullRequestReview[];
};
export type ReviewReply = {
    id: string;
    fullDatabaseId: string;
    authorNodeId: string | null;
    authorLogin: string | null;
    authorType: string | null;
    reviewId: string | null;
    reviewState: string | null;
    reviewBody: string | null;
    reviewCommitOid: string | null;
    reviewAuthorNodeId: string | null;
    reviewAuthorLogin: string | null;
    reviewAuthorType: string | null;
    clientMutationId: string;
};
export type ReviewEnvelopeReceipt = PullRequestReview & { clientMutationId: string };
export type ReviewResolutionReceipt = {
    resolvedByNodeId: string;
    resolvedByLogin: string;
    resolvedByType: string;
    clientMutationId: string;
};
export type ResolveReviewThreadPort = {
    inspect: (number: number, threadId: string) => ReviewThreadInspection;
    createPendingReview: (pullRequestId: string, commitOid: string, body: string) => ReviewEnvelopeReceipt;
    replyDone: (threadId: string, reviewId: string) => ReviewReply;
    submitReview: (reviewId: string, body: string) => ReviewEnvelopeReceipt;
    updateReviewBody: (reviewId: string, body: string) => ReviewEnvelopeReceipt;
    resolve: (threadId: string) => ReviewResolutionReceipt;
    deleteReply: (replyId: string) => void;
    deletePendingReview: (reviewId: string) => void;
    log: (message: string) => void;
};
export type ResolveReviewThreadArgs = { number?: number; threadId?: string; head?: string; help: boolean };
const usage = 'usage: pnpm review:resolve <pr-number> --thread <graphql-thread-node-id> --head <40-hex-sha>';
const RESOLUTION_REVIEW_SUMMARY = 'Resolved this review thread after applying the requested changes.';
type ResolutionReviewContext = {
    pullRequestId: string;
    threadId: string;
    expectedHead: string;
};
type ManagedReplyMarker = {
    marker: ReviewComment;
    review: PullRequestReview;
    currentHead: boolean;
};

export function parseResolveReviewThreadArgs(args: string[]): ResolveReviewThreadArgs {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { help: true };
    }
    if (
        args.length !== 5 ||
        args[1] !== '--thread' ||
        args[3] !== '--head' ||
        args[0] === undefined ||
        args[2] === undefined ||
        args[4] === undefined ||
        !/^[1-9][0-9]*$/.test(args[0]) ||
        !/^\S+$/.test(args[2]) ||
        !/^[0-9a-f]{40}$/i.test(args[4])
    ) {
        fail(usage);
    }
    const number = Number(args[0]);
    if (!Number.isSafeInteger(number)) {
        fail(usage);
    }
    return { number, threadId: args[2], head: args[4], help: false };
}

export function resolveReviewThread(
    number: number,
    threadId: string,
    expectedHead: string,
    authorNodeId: string,
    port: ResolveReviewThreadPort
): string {
    if (!isAuthorBotNodeId(authorNodeId)) {
        fail(`authenticated author actor ${authorNodeId} is not ${AUTHOR_BOT_NODE_ID}`);
    }
    const before = port.inspect(number, threadId);
    assertExpectedHead(before.head, expectedHead);
    const context = resolutionReviewContext(before.pullRequestId, threadId, expectedHead);
    if (before.thread?.isResolved) {
        repairCompletedResolution(number, before, context, port);
        return logResolutionSuccess(number, threadId, port);
    }
    assertResolvableThread(before.thread, threadId);
    let pendingReviewCreateAttempted = false;
    let pendingReviewCreated = false;
    let createdPendingReviewId: string | undefined;
    let replyAttempted = false;
    let replyCreated = false;
    let createdReplyId: string | undefined;
    let replyReviewId: string | undefined;
    let reviewUpdateAttempted = false;
    let reviewSubmitAttempted = false;
    let replyId: string | undefined;
    let resolveAttempted = false;
    let resolutionReceipt: ReviewResolutionReceipt | undefined;
    try {
        let working = before;
        const existingReply = findReusableReply(before.thread, context);
        if (existingReply === undefined) {
            let pendingReview = convergePendingReviews(working.pendingReviews, context, port);
            if (pendingReview === undefined) {
                pendingReviewCreateAttempted = true;
                const created = port.createPendingReview(
                    working.pullRequestId,
                    expectedHead,
                    resolutionReviewBody(context, expectedHead)
                );
                assertReviewEnvelopeReceipt(
                    created,
                    createReviewClientMutationId(threadId),
                    'PENDING',
                    resolutionReviewBody(context, expectedHead),
                    expectedHead,
                    'create pending review'
                );
                pendingReviewCreated = true;
                createdPendingReviewId = created.id;
                working = port.inspect(number, threadId);
                assertExpectedHeadAfterMutation(working.head, expectedHead);
                assertResolvableThread(working.thread, threadId);
                pendingReview = convergePendingReviews(working.pendingReviews, context, port);
            }
            if (pendingReview === undefined) {
                fail(`review thread ${threadId} has no reusable pending author review`);
            }
            replyAttempted = true;
            const reply = port.replyDone(threadId, pendingReview.id);
            assertReply(reply, replyClientMutationId(threadId), pendingReview.id, context);
            replyId = reply.id;
            replyReviewId = pendingReview.id;
            replyCreated = true;
            createdReplyId = reply.id;
        } else {
            replyId = existingReply.id;
        }
        const afterReply = port.inspect(number, threadId);
        assertExpectedHeadAfterMutation(afterReply.head, expectedHead);
        assertResolvableThread(afterReply.thread, threadId);
        reviewUpdateAttempted =
            repairManagedCommentedReviewEnvelopes(threadId, afterReply.thread, port, context, ['COMMENTED'], () => {
                reviewUpdateAttempted = true;
            }) || reviewUpdateAttempted;
        const pendingReviewDeleted = reconcilePendingReviewsForReply(
            afterReply.pendingReviews,
            afterReply.thread,
            context,
            port
        );
        reviewUpdateAttempted = pendingReviewDeleted || reviewUpdateAttempted;
        const replySource = pendingReviewDeleted ? port.inspect(number, threadId) : afterReply;
        if (pendingReviewDeleted) {
            assertExpectedHeadAfterMutation(replySource.head, expectedHead);
            assertResolvableThread(replySource.thread, threadId);
        }
        replyId = convergeReplyMarkers(threadId, replySource.thread, port, context, ['PENDING', 'COMMENTED']);
        const converged = port.inspect(number, threadId);
        assertExpectedHeadAfterMutation(converged.head, expectedHead);
        assertResolvableThread(converged.thread, threadId);
        const canonicalReply = requireOneReplyMarker(converged.thread, threadId);
        replyId = canonicalReply.id;
        let canonicalReview = requireReplyReview(canonicalReply, context, ['PENDING', 'COMMENTED'], true, expectedHead);
        if (canonicalReview.body.trim() === '') {
            reviewUpdateAttempted = true;
            const canonicalReviewCommitOid = requireReviewCommitOid(canonicalReview, `Done reply ${canonicalReply.id}`);
            const updatedReview = port.updateReviewBody(
                canonicalReview.id,
                resolutionReviewBody(context, canonicalReviewCommitOid)
            );
            canonicalReview = updatedReview;
            assertReviewEnvelopeReceipt(
                updatedReview,
                updateReviewClientMutationId(canonicalReview.id),
                updatedReview.state,
                resolutionReviewBody(context, canonicalReviewCommitOid),
                canonicalReviewCommitOid,
                'update review body'
            );
        } else if (
            canonicalReview.body !==
            resolutionReviewBody(context, requireReviewCommitOid(canonicalReview, `Done reply ${canonicalReply.id}`))
        ) {
            fail(`Done reply ${canonicalReply.id} is attached to a noncanonical author review`);
        }
        if (canonicalReview.state === 'PENDING') {
            reviewSubmitAttempted = true;
            const submittedReview = port.submitReview(canonicalReview.id, resolutionReviewBody(context, expectedHead));
            canonicalReview = submittedReview;
            assertReviewEnvelopeReceipt(
                submittedReview,
                submitReviewClientMutationId(canonicalReview.id),
                'COMMENTED',
                resolutionReviewBody(context, expectedHead),
                expectedHead,
                'submit review'
            );
        }
        const afterReview = reviewUpdateAttempted || reviewSubmitAttempted ? port.inspect(number, threadId) : converged;
        assertExpectedHeadAfterMutation(afterReview.head, expectedHead);
        assertResolvableThread(afterReview.thread, threadId);
        assertCommentedResolutionReply(requireOneReplyMarker(afterReview.thread, threadId), context);
        resolveAttempted = true;
        const resolveReceipt = port.resolve(threadId);
        assertResolutionReceipt(resolveReceipt, resolveClientMutationId(threadId));
        resolutionReceipt = resolveReceipt;
        const verified = port.inspect(number, threadId);
        assertExpectedHeadAfterMutation(verified.head, expectedHead);
        assertFinalResolution(verified.thread, threadId, replyId, context);
    } catch (error) {
        compensateResolution(
            number,
            threadId,
            before,
            context,
            pendingReviewCreateAttempted,
            pendingReviewCreated,
            createdPendingReviewId,
            replyAttempted,
            replyCreated,
            createdReplyId,
            replyReviewId,
            reviewUpdateAttempted,
            reviewSubmitAttempted,
            resolveAttempted,
            resolutionReceipt,
            port,
            error
        );
    }
    return logResolutionSuccess(number, threadId, port);
}

function logResolutionSuccess(number: number, threadId: string, port: ResolveReviewThreadPort): string {
    const success = `review-thread-resolved:${number}:${threadId}`;
    port.log(success);
    return success;
}

function compensateResolution(
    number: number,
    threadId: string,
    before: ReviewThreadInspection,
    context: ResolutionReviewContext,
    pendingReviewCreateAttempted: boolean,
    pendingReviewCreated: boolean,
    createdPendingReviewId: string | undefined,
    replyAttempted: boolean,
    replyCreated: boolean,
    createdReplyId: string | undefined,
    replyReviewId: string | undefined,
    reviewUpdateAttempted: boolean,
    reviewSubmitAttempted: boolean,
    resolveAttempted: boolean,
    resolutionReceipt: ReviewResolutionReceipt | undefined,
    port: ResolveReviewThreadPort,
    original: unknown
): never {
    const failures: string[] = [];
    let current: ReviewThreadInspection | undefined;
    attempt(failures, 'inspect ambiguous review transaction', () => {
        current = port.inspect(number, threadId);
    });
    if (current === undefined || current.thread === null || before.thread === null) {
        failures.push('cannot determine ambiguous review transaction state');
    } else {
        const visibleReviewEvidence =
            reviewUpdateAttempted &&
            current.thread.comments.some((comment) => hasCanonicalCommentedReview(comment, context));
        const submittedReviewEvidence =
            reviewSubmitAttempted &&
            current.thread.comments.some((comment) => hasCanonicalCommentedReview(comment, context));
        const resolutionEvidence = resolutionReceipt !== undefined || resolveAttempted;
        if (resolutionEvidence) {
            failures.push('review-thread resolution was attempted; preserving Done reply as durable evidence');
        }
        if (submittedReviewEvidence) {
            failures.push('review submission was attempted; preserving submitted review evidence');
        } else if (reviewSubmitAttempted) {
            failures.push('review submission was attempted; preserving pending review evidence');
        } else if (visibleReviewEvidence) {
            failures.push('review body update was attempted; preserving submitted review evidence');
        }
        if (!resolveAttempted && current.thread.isResolved && replyCreated && createdReplyId !== undefined) {
            deleteCreatedNoncanonicalReply(current.thread, createdReplyId, port, failures);
        } else if (
            pendingReviewCreateAttempted &&
            !pendingReviewCreated &&
            !replyAttempted &&
            current.head !== context.expectedHead
        ) {
            deleteAmbiguousCreatedPendingReview(before.pendingReviews, current.pendingReviews, context, port, failures);
        } else if (pendingReviewCreated && !replyAttempted) {
            deleteCreatedPendingReviewUnlessManagedReplyAttached(
                current.pendingReviews,
                current.thread,
                createdPendingReviewId,
                context,
                port,
                failures
            );
        } else if (replyAttempted && !replyCreated) {
            failures.push('ambiguous review reply mutation; refusing to delete an unverified comment');
        } else if (
            replyCreated &&
            !resolutionEvidence &&
            !submittedReviewEvidence &&
            !visibleReviewEvidence &&
            !reviewSubmitAttempted
        ) {
            if (createdReplyId === undefined || replyReviewId === undefined) {
                failures.push('ambiguous review reply mutation; refusing to delete an unverified comment');
            } else if (pendingReviewCreated && createdPendingReviewId === replyReviewId) {
                deleteCreatedPendingReviewUnlessManagedReplyAttached(
                    current.pendingReviews,
                    current.thread,
                    createdPendingReviewId,
                    context,
                    port,
                    failures
                );
            } else if (hasExpectedReply(current.thread, createdReplyId)) {
                attempt(failures, 'delete review reply', () => port.deleteReply(createdReplyId));
            } else if (current.thread.comments.some((comment) => comment.id === createdReplyId)) {
                failures.push('review reply receipt is no longer present; refusing to delete an unverified comment');
            }
        } else if (
            !pendingReviewCreated &&
            current.pendingReviews.some((review) => isExactPendingReview(review, context))
        ) {
            failures.push('ambiguous pending review mutation; preserving exact pending review evidence');
        }
    }
    if (
        current !== undefined &&
        before.thread !== null &&
        !current.thread?.isResolved &&
        resolutionReceipt === undefined &&
        !pendingReviewCreated &&
        !replyAttempted &&
        !reviewUpdateAttempted &&
        !reviewSubmitAttempted
    ) {
        const beforeThread = before.thread;
        attempt(failures, 'verify review-thread compensation', () => {
            const verified = port.inspect(number, threadId);
            if (
                verified.thread === null ||
                verified.thread.isResolved !== beforeThread.isResolved ||
                !sameComments(verified.thread.comments, beforeThread.comments) ||
                !sameReviews(verified.pendingReviews, before.pendingReviews)
            ) {
                fail(`review thread ${threadId} compensation was not verified`);
            }
        });
    }
    throwWithCompensation(original, failures);
}

function sameComments(left: ReviewComment[], right: ReviewComment[]): boolean {
    if (left.length !== right.length) {
        return false;
    }
    const commentsById = new Map(left.map((comment) => [comment.id, comment]));
    return (
        commentsById.size === right.length &&
        right.every((comment) => sameComment(commentsById.get(comment.id), comment))
    );
}
function sameComment(left: ReviewComment | undefined, right: ReviewComment): boolean {
    return (
        left?.fullDatabaseId === right.fullDatabaseId &&
        left.body === right.body &&
        left.authorNodeId === right.authorNodeId &&
        left.authorLogin === right.authorLogin &&
        left.authorType === right.authorType &&
        left.reviewId === right.reviewId &&
        left.reviewState === right.reviewState &&
        left.reviewBody === right.reviewBody &&
        left.reviewCommitOid === right.reviewCommitOid &&
        left.reviewAuthorNodeId === right.reviewAuthorNodeId &&
        left.reviewAuthorLogin === right.reviewAuthorLogin &&
        left.reviewAuthorType === right.reviewAuthorType
    );
}
function sameReviews(left: PullRequestReview[], right: PullRequestReview[]): boolean {
    if (left.length !== right.length) {
        return false;
    }
    const reviewsById = new Map(left.map((review) => [review.id, review]));
    return reviewsById.size === right.length && right.every((review) => sameReview(reviewsById.get(review.id), review));
}
function sameReview(left: PullRequestReview | undefined, right: PullRequestReview): boolean {
    return (
        left?.state === right.state &&
        left.body === right.body &&
        left.commitOid === right.commitOid &&
        left.authorNodeId === right.authorNodeId &&
        left.authorLogin === right.authorLogin &&
        left.authorType === right.authorType
    );
}
function throwWithCompensation(original: unknown, failures: string[]): never {
    const message = errorMessage(original);
    if (failures.length > 0) {
        throw new Error(`${message}; compensation failed: ${failures.join('; ')}`, { cause: original });
    }
    if (original instanceof Error) {
        throw original;
    }
    throw new Error(message);
}
function attempt(failures: string[], label: string, operation: () => void): void {
    try {
        operation();
    } catch (error) {
        failures.push(`${label}: ${errorMessage(error)}`);
    }
}
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
function assertExpectedHead(currentHead: string, expectedHead: string): void {
    if (currentHead !== expectedHead) {
        fail('supplied head does not match the current pull-request head');
    }
}
function assertExpectedHeadAfterMutation(currentHead: string, expectedHead: string): void {
    if (currentHead !== expectedHead) {
        fail('pull-request head moved after mutation; compensating');
    }
}
function isDecimalId(value: unknown): value is string {
    return typeof value === 'string' && /^[1-9][0-9]*$/.test(value);
}
function authorBotNodeId(value: unknown): string {
    if (typeof value !== 'string' || !isAuthorBotNodeId(value)) {
        fail('expected author bot actor ID');
    }
    return value;
}
function isAuthorBotActor(nodeId: unknown, type: unknown): boolean {
    return type === 'Bot' && typeof nodeId === 'string' && isAuthorBotNodeId(nodeId);
}
function isAuthorResolutionActor(nodeId: unknown, type: unknown): boolean {
    return type === 'User' && typeof nodeId === 'string' && isAuthorBotNodeId(nodeId);
}
function isReviewerBotActor(nodeId: unknown, type: unknown): boolean {
    return type === 'Bot' && typeof nodeId === 'string' && isReviewerBotNodeId(nodeId);
}
function resolutionReviewContext(
    pullRequestId: string,
    threadId: string,
    expectedHead: string
): ResolutionReviewContext {
    if (typeof pullRequestId !== 'string' || pullRequestId === '') {
        fail('cannot read current pull-request node ID');
    }
    return {
        pullRequestId,
        threadId,
        expectedHead,
    };
}
function resolutionReviewBody(context: ResolutionReviewContext, reviewHead: string): string {
    return [
        RESOLUTION_REVIEW_SUMMARY,
        `<!-- sourdaw-review-resolve pull-request:${context.pullRequestId} thread:${context.threadId} head:${reviewHead} -->`,
    ].join('\n\n');
}
function extractThreadIdFromBody(body: string): string {
    const match = /thread:([^\s]+)\s+head:/.exec(body);
    if (match?.[1] === undefined) {
        fail('resolution review body is missing its thread marker');
    }
    return match[1];
}
function createReviewClientMutationId(threadId: string): string {
    return `review-create:${threadId}`;
}
function replyClientMutationId(threadId: string): string {
    return `review-reply:${threadId}`;
}
function submitReviewClientMutationId(reviewId: string): string {
    return `review-submit:${reviewId}`;
}
function updateReviewClientMutationId(reviewId: string): string {
    return `review-update:${reviewId}`;
}
function resolveClientMutationId(threadId: string): string {
    return `review-resolve:${threadId}`;
}
function assertReviewEnvelopeReceipt(
    receipt: ReviewEnvelopeReceipt,
    expectedClientMutationId: string,
    expectedState: string,
    expectedBody: string,
    expectedHead: string,
    label: string
): void {
    if (
        typeof receipt.id !== 'string' ||
        receipt.id === '' ||
        receipt.state !== expectedState ||
        receipt.body !== expectedBody ||
        receipt.commitOid !== expectedHead ||
        !isAuthorBotActor(receipt.authorNodeId, receipt.authorType) ||
        receipt.clientMutationId !== expectedClientMutationId
    ) {
        fail(`${label} returned an invalid result`);
    }
}
function assertReply(
    reply: ReviewReply,
    expectedClientMutationId: string,
    expectedReviewId: string,
    context: ResolutionReviewContext
): void {
    if (
        typeof reply.id !== 'string' ||
        reply.id === '' ||
        !isDecimalId(reply.fullDatabaseId) ||
        !isAuthorBotActor(reply.authorNodeId, reply.authorType) ||
        reply.clientMutationId !== expectedClientMutationId
    ) {
        fail('add review-thread reply returned an invalid result');
    }
    const review = requireReplyReview(reply, context, ['PENDING'], false, context.expectedHead);
    if (review.id !== expectedReviewId) {
        fail('add review-thread reply was not attached to the staged author review');
    }
}
function assertResolutionReceipt(receipt: ReviewResolutionReceipt, expectedClientMutationId: string): void {
    if (
        !isAuthorResolutionActor(receipt.resolvedByNodeId, receipt.resolvedByType) ||
        receipt.clientMutationId !== expectedClientMutationId
    ) {
        fail('resolve review thread returned an invalid result');
    }
}
function toRequiredReview(
    value: {
        reviewId?: string | null;
        reviewState?: string | null;
        reviewBody?: string | null;
        reviewCommitOid?: string | null;
        reviewAuthorNodeId?: string | null;
        reviewAuthorLogin?: string | null;
        reviewAuthorType?: string | null;
    },
    label: string
): PullRequestReview {
    if (
        typeof value.reviewId !== 'string' ||
        value.reviewId === '' ||
        typeof value.reviewState !== 'string' ||
        typeof value.reviewBody !== 'string' ||
        typeof value.reviewCommitOid !== 'string'
    ) {
        fail(`${label} is not attached to a readable pull-request review`);
    }
    return {
        id: value.reviewId,
        state: value.reviewState,
        body: value.reviewBody,
        commitOid: value.reviewCommitOid,
        authorNodeId: value.reviewAuthorNodeId ?? null,
        authorLogin: value.reviewAuthorLogin ?? null,
        authorType: value.reviewAuthorType ?? null,
    };
}
function toReplyReviewOrNull(value: {
    reviewId?: string | null;
    reviewState?: string | null;
    reviewBody?: string | null;
    reviewCommitOid?: string | null;
    reviewAuthorNodeId?: string | null;
    reviewAuthorLogin?: string | null;
    reviewAuthorType?: string | null;
}): PullRequestReview | null {
    if (
        typeof value.reviewId !== 'string' ||
        value.reviewId === '' ||
        typeof value.reviewState !== 'string' ||
        typeof value.reviewBody !== 'string' ||
        typeof value.reviewCommitOid !== 'string'
    ) {
        return null;
    }
    return {
        id: value.reviewId,
        state: value.reviewState,
        body: value.reviewBody,
        commitOid: value.reviewCommitOid,
        authorNodeId: value.reviewAuthorNodeId ?? null,
        authorLogin: value.reviewAuthorLogin ?? null,
        authorType: value.reviewAuthorType ?? null,
    };
}
function requireReviewCommitOid(review: PullRequestReview, label: string): string {
    if (typeof review.commitOid !== 'string' || review.commitOid === '') {
        fail(`${label} has no commit OID`);
    }
    return review.commitOid;
}
function requireReplyReview(
    value: {
        id?: string;
        reviewId?: string | null;
        reviewState?: string | null;
        reviewBody?: string | null;
        reviewCommitOid?: string | null;
        reviewAuthorNodeId?: string | null;
        reviewAuthorLogin?: string | null;
        reviewAuthorType?: string | null;
    },
    context: ResolutionReviewContext,
    allowedStates: string[],
    allowEmptyBody: boolean,
    expectedCommitOid: string | null
): PullRequestReview {
    const review = toRequiredReview(value, `Done reply ${value.id ?? 'unknown'}`);
    if (!isAuthorBotActor(review.authorNodeId, review.authorType)) {
        fail(`Done reply ${value.id ?? 'unknown'} is attached to a non-author review`);
    }
    if (!allowedStates.includes(review.state)) {
        fail(`Done reply ${value.id ?? 'unknown'} is attached to an unsupported review state`);
    }
    if (expectedCommitOid !== null && review.commitOid !== expectedCommitOid) {
        fail(`Done reply ${value.id ?? 'unknown'} is attached to a stale review head`);
    }
    const reviewCommitOid = requireReviewCommitOid(review, `Done reply ${value.id ?? 'unknown'}`);
    const expectedBody = resolutionReviewBody(context, reviewCommitOid);
    if (!allowEmptyBody && review.body !== expectedBody) {
        fail(`Done reply ${value.id ?? 'unknown'} is attached to a noncanonical author review`);
    }
    if (!allowEmptyBody && review.body.trim() === '') {
        fail(`Done reply ${value.id ?? 'unknown'} is attached to an empty author review`);
    }
    if (allowEmptyBody && review.body !== expectedBody && review.body.trim() !== '') {
        fail(`Done reply ${value.id ?? 'unknown'} is attached to a noncanonical author review`);
    }
    return review;
}
function managedReplyReviewOrNull(
    value: {
        reviewId?: string | null;
        reviewState?: string | null;
        reviewBody?: string | null;
        reviewCommitOid?: string | null;
        reviewAuthorNodeId?: string | null;
        reviewAuthorLogin?: string | null;
        reviewAuthorType?: string | null;
    },
    context: ResolutionReviewContext,
    allowedStates: string[],
    allowEmptyBody: boolean
): PullRequestReview | null {
    const review = toReplyReviewOrNull(value);
    if (review === null || !isAuthorBotActor(review.authorNodeId, review.authorType)) {
        return null;
    }
    if (!allowedStates.includes(review.state)) {
        return null;
    }
    if (typeof review.commitOid !== 'string' || review.commitOid === '') {
        return null;
    }
    const expectedBody = resolutionReviewBody(context, review.commitOid);
    if (review.body !== expectedBody && (!allowEmptyBody || review.body.trim() !== '')) {
        return null;
    }
    return review;
}
function managedReplyMarkers(
    thread: ReviewThread,
    context: ResolutionReviewContext,
    allowedStates: string[],
    allowEmptyBody: boolean
): ManagedReplyMarker[] {
    const managed: ManagedReplyMarker[] = [];
    for (const marker of validatedReplyMarkers(thread)) {
        const review = managedReplyReviewOrNull(marker, context, allowedStates, allowEmptyBody);
        if (review === null) {
            continue;
        }
        managed.push({
            marker,
            review,
            currentHead: review.commitOid === context.expectedHead,
        });
    }
    return managed.sort((left, right) => compareMarkers(left.marker, right.marker));
}
function requireCanonicalManagedReplyMarker(
    thread: ReviewThread,
    threadId: string,
    context: ResolutionReviewContext,
    allowedStates: string[],
    allowEmptyBody: boolean
): ManagedReplyMarker {
    const managed = managedReplyMarkers(thread, context, allowedStates, allowEmptyBody);
    const canonical = managed.find((candidate) => candidate.currentHead) ?? managed[0];
    if (canonical === undefined) {
        fail(`review thread ${threadId} has no valid Done reply marker`);
    }
    return canonical;
}
function hasExpectedReply(thread: ReviewThread, replyId: string): boolean {
    return thread.comments.some(
        (comment) =>
            comment.id === replyId &&
            comment.body === 'Done' &&
            isAuthorBotActor(comment.authorNodeId, comment.authorType)
    );
}
function hasCanonicalCommentedReview(comment: ReviewComment, context: ResolutionReviewContext): boolean {
    return (
        comment.reviewState === 'COMMENTED' &&
        typeof comment.reviewCommitOid === 'string' &&
        comment.reviewBody === resolutionReviewBody(context, comment.reviewCommitOid) &&
        isAuthorBotActor(comment.reviewAuthorNodeId, comment.reviewAuthorType)
    );
}
function validatedReplyMarkers(thread: ReviewThread): ReviewComment[] {
    const owned = thread.comments.filter((comment) => isAuthorBotNodeId(comment.authorNodeId));
    for (const comment of owned) {
        if (
            !isDecimalId(comment.fullDatabaseId) ||
            comment.body !== 'Done' ||
            !isAuthorBotActor(comment.authorNodeId, comment.authorType)
        ) {
            fail('owned Done reply marker is not an exact author-bot receipt');
        }
    }
    return owned.sort(compareMarkers);
}
function compareMarkers(left: ReviewComment, right: ReviewComment): number {
    // The smallest decimal fullDatabaseId, then node ID, is the canonical concurrent marker.
    const difference = BigInt(left.fullDatabaseId) - BigInt(right.fullDatabaseId);
    if (difference === 0n) {
        return left.id.localeCompare(right.id);
    }
    return difference < 0n ? -1 : 1;
}
function requireOneReplyMarker(thread: ReviewThread | null, threadId: string): ReviewComment {
    if (thread === null) {
        fail(`review thread ${threadId} was not found on this pull request`);
    }
    const markers = validatedReplyMarkers(thread);
    const [marker] = markers;
    if (marker === undefined || markers.length !== 1) {
        fail(`review thread ${threadId} does not have exactly one valid Done reply marker`);
    }
    return marker;
}
function convergeReplyMarkers(
    threadId: string,
    thread: ReviewThread | null,
    port: ResolveReviewThreadPort,
    context: ResolutionReviewContext,
    allowedStates: string[]
): string {
    if (thread === null) {
        fail(`review thread ${threadId} was not found on this pull request`);
    }
    const canonical = requireCanonicalManagedReplyMarker(thread, threadId, context, allowedStates, true);
    for (const candidate of managedReplyMarkers(thread, context, allowedStates, true)) {
        if (candidate.marker.id !== canonical.marker.id) {
            port.deleteReply(candidate.marker.id);
        }
    }
    return canonical.marker.id;
}
function repairManagedCommentedReviewEnvelopes(
    threadId: string,
    thread: ReviewThread | null,
    port: ResolveReviewThreadPort,
    context: ResolutionReviewContext,
    allowedStates: string[] = ['COMMENTED'],
    beforeUpdate?: () => void
): boolean {
    if (thread === null) {
        fail(`review thread ${threadId} was not found on this pull request`);
    }
    const repairedReviewIds = new Set<string>();
    let updated = false;
    for (const candidate of managedReplyMarkers(thread, context, allowedStates, true)) {
        if (repairedReviewIds.has(candidate.review.id) || candidate.review.body.trim() !== '') {
            continue;
        }
        const reviewCommitOid = requireReviewCommitOid(candidate.review, `Done reply ${candidate.marker.id}`);
        const expectedBody = resolutionReviewBody(context, reviewCommitOid);
        beforeUpdate?.();
        const updatedReview = port.updateReviewBody(candidate.review.id, expectedBody);
        assertReviewEnvelopeReceipt(
            updatedReview,
            updateReviewClientMutationId(candidate.review.id),
            candidate.review.state,
            expectedBody,
            reviewCommitOid,
            'update review body'
        );
        repairedReviewIds.add(candidate.review.id);
        updated = true;
    }
    return updated;
}
function isExactPendingReview(review: PullRequestReview, context: ResolutionReviewContext): boolean {
    return (
        review.state === 'PENDING' &&
        review.body === resolutionReviewBody(context, context.expectedHead) &&
        review.commitOid === context.expectedHead &&
        isAuthorBotActor(review.authorNodeId, review.authorType)
    );
}
function convergePendingReviews(
    pendingReviews: PullRequestReview[],
    context: ResolutionReviewContext,
    port: ResolveReviewThreadPort,
    preferredReviewId?: string
): PullRequestReview | undefined {
    const exact = pendingReviews.filter((review) => isExactPendingReview(review, context));
    const canonical = exact.find((review) => review.id === preferredReviewId) ?? exact[0];
    if (canonical === undefined) {
        return undefined;
    }
    for (const review of exact) {
        if (review.id !== canonical.id) {
            port.deletePendingReview(review.id);
        }
    }
    return canonical;
}
function reconcilePendingReviewsForReply(
    pendingReviews: PullRequestReview[],
    thread: ReviewThread | null,
    context: ResolutionReviewContext,
    port: ResolveReviewThreadPort
): boolean {
    if (thread === null) {
        fail(`review thread ${context.threadId} was not found on this pull request`);
    }
    const canonical = managedReplyMarkers(thread, context, ['PENDING', 'COMMENTED'], true).find(
        (candidate) => candidate.currentHead
    );
    const keepReviewId =
        canonical?.review.state === 'PENDING' &&
        canonical.review.body ===
            resolutionReviewBody(context, requireReviewCommitOid(canonical.review, `Done reply ${canonical.marker.id}`))
            ? canonical.review.id
            : undefined;
    let deleted = false;
    for (const review of pendingReviews) {
        if (!isExactPendingReview(review, context) || review.id === keepReviewId) {
            continue;
        }
        port.deletePendingReview(review.id);
        deleted = true;
    }
    return deleted;
}
function requireOneOrMoreReplyMarker(thread: ReviewThread | null, threadId: string): ReviewComment {
    if (thread === null) {
        fail(`review thread ${threadId} was not found on this pull request`);
    }
    const [canonical] = validatedReplyMarkers(thread);
    if (canonical === undefined) {
        fail(`review thread ${threadId} has no valid Done reply marker`);
    }
    return canonical;
}
function deleteCreatedNoncanonicalReply(
    thread: ReviewThread,
    createdReplyId: string,
    port: ResolveReviewThreadPort,
    failures: string[]
): void {
    let canonical: ReviewComment;
    try {
        canonical = requireOneOrMoreReplyMarker(thread, thread.id);
    } catch (error) {
        failures.push(`inspect concurrent Done reply markers: ${errorMessage(error)}`);
        return;
    }
    if (canonical.id === createdReplyId || !hasExpectedReply(thread, createdReplyId)) {
        failures.push("concurrent resolution retained this invocation's canonical or unverified Done reply");
        return;
    }
    attempt(failures, 'delete noncanonical review reply', () => port.deleteReply(createdReplyId));
}
function deleteCreatedPendingReview(
    pendingReviews: PullRequestReview[],
    createdPendingReviewId: string | undefined,
    context: ResolutionReviewContext,
    port: ResolveReviewThreadPort,
    failures: string[]
): void {
    if (createdPendingReviewId === undefined) {
        failures.push('ambiguous pending review mutation; refusing to delete an unverified review');
        return;
    }
    const review = pendingReviews.find((candidate) => candidate.id === createdPendingReviewId);
    if (review === undefined) {
        return;
    }
    if (!isExactPendingReview(review, context)) {
        failures.push('pending review receipt is no longer exact; refusing to delete an unverified review');
        return;
    }
    attempt(failures, 'delete pending review', () => port.deletePendingReview(createdPendingReviewId));
}
function deleteCreatedPendingReviewUnlessManagedReplyAttached(
    pendingReviews: PullRequestReview[],
    thread: ReviewThread,
    createdPendingReviewId: string | undefined,
    context: ResolutionReviewContext,
    port: ResolveReviewThreadPort,
    failures: string[]
): void {
    if (
        createdPendingReviewId !== undefined &&
        managedReplyMarkers(thread, context, ['PENDING', 'COMMENTED'], true).some(
            (candidate) => candidate.review.id === createdPendingReviewId
        )
    ) {
        failures.push('pending review now has a managed Done reply; preserving attached review evidence');
        return;
    }
    deleteCreatedPendingReview(pendingReviews, createdPendingReviewId, context, port, failures);
}
function deleteAmbiguousCreatedPendingReview(
    before: PullRequestReview[],
    current: PullRequestReview[],
    context: ResolutionReviewContext,
    port: ResolveReviewThreadPort,
    failures: string[]
): void {
    const beforeIds = new Set(before.map((review) => review.id));
    const created = current.filter((review) => !beforeIds.has(review.id) && isExactPendingReview(review, context));
    const [review] = created;
    if (review === undefined) {
        failures.push('ambiguous pending review mutation; preserving exact pending review evidence');
        return;
    }
    if (created.length !== 1) {
        failures.push('ambiguous pending review mutation; refusing to delete multiple candidate reviews');
        return;
    }
    attempt(failures, 'delete pending review', () => port.deletePendingReview(review.id));
}
function assertCompletedResolution(thread: ReviewThread, threadId: string): void {
    assertRootReviewer(thread, threadId);
    if (!isAuthorResolutionActor(thread.resolvedByNodeId, thread.resolvedByType)) {
        fail(`review thread ${threadId} was not resolved by ${AUTHOR_BOT_NODE_ID}`);
    }
}
function assertCommentedResolutionReply(reply: ReviewComment, context: ResolutionReviewContext): void {
    requireReplyReview(reply, context, ['COMMENTED'], false, null);
}
function repairCompletedResolution(
    number: number,
    inspection: ReviewThreadInspection,
    context: ResolutionReviewContext,
    port: ResolveReviewThreadPort
): void {
    let working = inspection;
    let thread = inspection.thread;
    if (thread === null) {
        fail(`review thread ${context.threadId} was not found on this pull request`);
    }
    assertCompletedResolution(thread, context.threadId);
    const refresh = (): ReviewThread => {
        working = port.inspect(number, context.threadId);
        assertExpectedHeadAfterMutation(working.head, context.expectedHead);
        if (working.thread === null) {
            fail(`review thread ${context.threadId} was not found on this pull request`);
        }
        assertCompletedResolution(working.thread, context.threadId);
        return working.thread;
    };
    const updated = repairManagedCommentedReviewEnvelopes(context.threadId, thread, port, context, [
        'PENDING',
        'COMMENTED',
    ]);
    if (updated) {
        thread = refresh();
    }
    const pendingReviewDeleted = reconcilePendingReviewsForReply(working.pendingReviews, thread, context, port);
    if (pendingReviewDeleted) {
        thread = refresh();
    }
    const currentHeadPendingReply = managedReplyMarkers(thread, context, ['PENDING'], false).find(
        (candidate) => candidate.currentHead
    );
    if (currentHeadPendingReply !== undefined) {
        const reviewCommitOid = requireReviewCommitOid(
            currentHeadPendingReply.review,
            `Done reply ${currentHeadPendingReply.marker.id}`
        );
        const submittedReview = port.submitReview(
            currentHeadPendingReply.review.id,
            resolutionReviewBody(context, reviewCommitOid)
        );
        assertReviewEnvelopeReceipt(
            submittedReview,
            submitReviewClientMutationId(currentHeadPendingReply.review.id),
            'COMMENTED',
            resolutionReviewBody(context, reviewCommitOid),
            reviewCommitOid,
            'submit review'
        );
        thread = refresh();
    }
    const duplicateMarkers = managedReplyMarkers(thread, context, ['COMMENTED'], false);
    if (duplicateMarkers.length <= 1) {
        assertCommentedResolutionReply(requireOneReplyMarker(thread, context.threadId), context);
        return;
    }
    convergeReplyMarkers(context.threadId, thread, port, context, ['COMMENTED']);
    const verified = port.inspect(number, context.threadId);
    assertExpectedHeadAfterMutation(verified.head, context.expectedHead);
    if (verified.thread === null) {
        fail(`review thread ${context.threadId} was not found on this pull request`);
    }
    assertCompletedResolution(verified.thread, context.threadId);
    assertCommentedResolutionReply(requireOneReplyMarker(verified.thread, context.threadId), context);
}
function assertFinalResolution(
    thread: ReviewThread | null,
    threadId: string,
    replyId: string,
    context: ResolutionReviewContext
): void {
    if (
        thread?.id !== threadId ||
        !thread.isResolved ||
        !isAuthorResolutionActor(thread.resolvedByNodeId, thread.resolvedByType)
    ) {
        fail(`review thread ${threadId} was not resolved by ${AUTHOR_BOT_NODE_ID}`);
    }
    if (!hasExpectedReply(thread, replyId)) {
        fail(`review reply receipt ${replyId} is not present on thread ${threadId}`);
    }
    assertCommentedResolutionReply(requireOneReplyMarker(thread, threadId), context);
}
function assertResolvableThread(thread: ReviewThread | null, expectedThreadId: string): void {
    if (thread === null || thread.id !== expectedThreadId) {
        fail(`review thread ${expectedThreadId} was not found on this pull request`);
    }
    if (thread.isResolved) {
        fail(`review thread ${expectedThreadId} is already resolved`);
    }
    assertRootReviewer(thread, expectedThreadId);
}
function assertRootReviewer(thread: ReviewThread, threadId: string): void {
    if (!isReviewerBotActor(thread.rootAuthorNodeId, thread.rootAuthorType)) {
        fail(`review thread ${threadId} root comment is not authored by ${REVIEWER_BOT_NODE_ID}`);
    }
    if (
        typeof thread.rootCommentId !== 'string' ||
        thread.rootCommentId === '' ||
        !isDecimalId(thread.rootCommentFullDatabaseId)
    ) {
        fail(`review thread ${threadId} root comment has no decimal fullDatabaseId`);
    }
}
function findReusableReply(thread: ReviewThread | null, context: ResolutionReviewContext): ReviewComment | undefined {
    if (thread === null) {
        return undefined;
    }
    return managedReplyMarkers(thread, context, ['PENDING', 'COMMENTED'], true).find(
        (candidate) => candidate.currentHead
    )?.marker;
}

export function shellPort(session: GhSession, cwd: string = process.cwd()): ResolveReviewThreadPort {
    const primaryRoot = resolvePrimaryRoot(
        (command, args, directory) => spawnCapture(command, args, { cwd: directory }),
        cwd
    );
    const gh = (args: string[]) => spawnCapture('gh', args, { cwd: primaryRoot, env: session.env });
    return {
        inspect: (number, id) => inspectReviewThread(number, id, gh),
        createPendingReview: (pullRequestId, commitOid, body) =>
            createPendingReview(pullRequestId, commitOid, body, gh),
        replyDone: (id, reviewId) => mutationReply(id, reviewId, gh),
        submitReview: (reviewId, body) => submitReview(reviewId, body, gh),
        updateReviewBody: (reviewId, body) => updateReviewBody(reviewId, body, gh),
        resolve: (id) => resolveThread(id, gh),
        deleteReply: (id) => deleteReply(id, gh),
        deletePendingReview: (id) => deletePendingReview(id, gh),
        log: (message) => console.log(message),
    };
}
type Gh = (args: string[]) => string;
function graphql(gh: Gh, query: string, fields: string[], label: string): unknown {
    return parseGraphqlResponse(gh(['api', 'graphql', '-f', `query=${query}`, ...fields]), label);
}
export function inspectReviewThread(number: number, requestedThreadId: string, gh: Gh): ReviewThreadInspection {
    const [owner, name] = REQUIRED_REPOSITORY.split('/');
    if (owner === undefined || name === undefined) {
        fail(`invalid GitHub repository: ${REQUIRED_REPOSITORY}`);
    }
    let cursor: string | undefined;
    const cursors = new Set<string>();
    let pullRequestId: string | undefined;
    let head: string | undefined;
    for (;;) {
        const connection = cursor === undefined ? 'reviewThreads(first:100)' : 'reviewThreads(first:100,after:$cursor)';
        const query = `query($owner:String!,$name:String!,$number:Int!${cursor === undefined ? '' : ',$cursor:String!'}){repository(owner:$owner,name:$name){pullRequest(number:$number){id headRefOid ${connection}{nodes{id isResolved resolvedBy{id login __typename}} pageInfo{hasNextPage endCursor}}}}}`;
        const fields = ['-F', `owner=${owner}`, '-F', `name=${name}`, '-F', `number=${number}`];
        if (cursor !== undefined) {
            fields.push('-F', `cursor=${cursor}`);
        }
        const response = graphql(gh, query, fields, `review thread query for PR #${number}`) as {
            data?: {
                repository?: {
                    pullRequest?: {
                        id?: unknown;
                        headRefOid?: unknown;
                        reviewThreads?: { nodes?: unknown; pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } };
                    };
                };
            };
        };
        const pullRequest = response.data?.repository?.pullRequest;
        if (typeof pullRequest?.id !== 'string' || typeof pullRequest.headRefOid !== 'string') {
            fail(`cannot read current head for PR #${number}`);
        }
        pullRequestId = pullRequest.id;
        if (head === undefined) {
            head = pullRequest.headRefOid;
        } else if (head !== pullRequest.headRefOid) {
            fail(`pull-request head changed while reading review threads for PR #${number}`);
        }
        const threads = pullRequest.reviewThreads;
        if (!Array.isArray(threads?.nodes) || typeof threads.pageInfo?.hasNextPage !== 'boolean') {
            fail(`invalid review-thread page for PR #${number}`);
        }
        const selected = threads.nodes.find(
            (
                candidate
            ): candidate is {
                id?: unknown;
                isResolved?: unknown;
                resolvedBy?: { id?: unknown; login?: unknown; __typename?: unknown } | null;
            } =>
                typeof candidate === 'object' &&
                candidate !== null &&
                (candidate as { id?: unknown }).id === requestedThreadId
        );
        if (selected !== undefined) {
            return {
                pullRequestId,
                head,
                thread: inspectThreadComments(
                    requestedThreadId,
                    selected.isResolved,
                    selected.resolvedBy?.id,
                    selected.resolvedBy?.login,
                    selected.resolvedBy?.__typename,
                    gh
                ),
                pendingReviews: inspectPendingReviews(number, pullRequestId, head, gh),
            };
        }
        if (!threads.pageInfo.hasNextPage) {
            return {
                pullRequestId,
                head,
                thread: null,
                pendingReviews: inspectPendingReviews(number, pullRequestId, head, gh),
            };
        }
        const next = threads.pageInfo.endCursor;
        if (typeof next !== 'string' || next === '' || cursors.has(next)) {
            fail(`invalid review-thread pagination for PR #${number}`);
        }
        cursors.add(next);
        cursor = next;
    }
}
function inspectPendingReviews(
    number: number,
    pullRequestId: string,
    expectedHead: string,
    gh: Gh
): PullRequestReview[] {
    const [owner, name] = REQUIRED_REPOSITORY.split('/');
    if (owner === undefined || name === undefined) {
        fail(`invalid GitHub repository: ${REQUIRED_REPOSITORY}`);
    }
    let cursor: string | undefined;
    const cursors = new Set<string>();
    const pending: PullRequestReview[] = [];
    for (;;) {
        const connection = cursor === undefined ? 'reviews(first:100)' : 'reviews(first:100,after:$cursor)';
        const query = `query($owner:String!,$name:String!,$number:Int!${cursor === undefined ? '' : ',$cursor:String!'}){repository(owner:$owner,name:$name){pullRequest(number:$number){id headRefOid ${connection}{nodes{id state body commit{oid} author{login __typename ... on Bot{id}}} pageInfo{hasNextPage endCursor}}}}}`;
        const fields = ['-F', `owner=${owner}`, '-F', `name=${name}`, '-F', `number=${number}`];
        if (cursor !== undefined) {
            fields.push('-F', `cursor=${cursor}`);
        }
        const response = graphql(gh, query, fields, `pull-request reviews for PR #${number}`) as {
            data?: {
                repository?: {
                    pullRequest?: {
                        id?: unknown;
                        headRefOid?: unknown;
                        reviews?: { nodes?: unknown; pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } };
                    };
                };
            };
        };
        const pullRequest = response.data?.repository?.pullRequest;
        if (pullRequest?.id !== pullRequestId || pullRequest.headRefOid !== expectedHead) {
            fail(`pull-request head changed while reading reviews for PR #${number}`);
        }
        const reviews = pullRequest.reviews;
        if (!Array.isArray(reviews?.nodes) || typeof reviews.pageInfo?.hasNextPage !== 'boolean') {
            fail(`invalid review page for PR #${number}`);
        }
        for (const value of reviews.nodes) {
            const review = toPullRequestReview(value);
            if (review !== null && review.state === 'PENDING') {
                if (pending.some((current) => current.id === review.id)) {
                    fail(`duplicate pull-request review ${review.id}`);
                }
                pending.push(review);
            }
        }
        if (!reviews.pageInfo.hasNextPage) {
            return pending;
        }
        const next = reviews.pageInfo.endCursor;
        if (typeof next !== 'string' || next === '' || cursors.has(next)) {
            fail(`invalid pull-request review pagination for PR #${number}`);
        }
        cursors.add(next);
        cursor = next;
    }
}
function inspectThreadComments(
    threadId: string,
    isResolved: unknown,
    resolvedByNodeId: unknown,
    resolvedByLogin: unknown,
    resolvedByType: unknown,
    gh: Gh
): ReviewThread {
    if (typeof isResolved !== 'boolean') {
        fail(`invalid review thread ${threadId}`);
    }
    let cursor: string | undefined;
    const cursors = new Set<string>();
    const comments: ReviewComment[] = [];
    for (;;) {
        const connection = cursor === undefined ? 'comments(first:100)' : 'comments(first:100,after:$cursor)';
        const query = `query($threadId:ID!${cursor === undefined ? '' : ',$cursor:String!'}){node(id:$threadId){... on PullRequestReviewThread{id ${connection}{nodes{id fullDatabaseId body author{login __typename ... on Bot{id}} pullRequestReview{id state body commit{oid} author{login __typename ... on Bot{id}}}} pageInfo{hasNextPage endCursor}}}}}`;
        const fields = ['-F', `threadId=${threadId}`];
        if (cursor !== undefined) {
            fields.push('-F', `cursor=${cursor}`);
        }
        const response = graphql(gh, query, fields, `review comments for thread ${threadId}`) as {
            data?: {
                node?: {
                    id?: unknown;
                    comments?: { nodes?: unknown; pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } };
                } | null;
            };
        };
        const thread = response.data?.node;
        if (
            thread?.id !== threadId ||
            !Array.isArray(thread.comments?.nodes) ||
            typeof thread.comments.pageInfo?.hasNextPage !== 'boolean'
        ) {
            fail(`invalid review comments for thread ${threadId}`);
        }
        for (const value of thread.comments.nodes) {
            const comment = toReviewComment(value);
            if (comments.some((current) => current.id === comment.id)) {
                fail(`duplicate review comment ${comment.id}`);
            }
            comments.push(comment);
        }
        if (!thread.comments.pageInfo.hasNextPage) {
            break;
        }
        const next = thread.comments.pageInfo.endCursor;
        if (typeof next !== 'string' || next === '' || cursors.has(next)) {
            fail(`invalid review-comment pagination for thread ${threadId}`);
        }
        cursors.add(next);
        cursor = next;
    }
    const root = comments[0];
    return {
        id: threadId,
        isResolved,
        resolvedByNodeId: typeof resolvedByNodeId === 'string' ? resolvedByNodeId : null,
        resolvedByLogin: typeof resolvedByLogin === 'string' ? resolvedByLogin : null,
        resolvedByType: typeof resolvedByType === 'string' ? resolvedByType : null,
        rootCommentId: root?.id ?? null,
        rootCommentFullDatabaseId: root?.fullDatabaseId ?? null,
        rootAuthorNodeId: root?.authorNodeId ?? null,
        rootAuthorLogin: root?.authorLogin ?? null,
        rootAuthorType: root?.authorType ?? null,
        comments,
    };
}
function toReviewComment(value: unknown): ReviewComment {
    const comment = value as {
        id?: unknown;
        fullDatabaseId?: unknown;
        body?: unknown;
        author?: { id?: unknown; login?: unknown; __typename?: unknown } | null;
        pullRequestReview?: unknown;
    };
    if (typeof comment.id !== 'string' || !isDecimalId(comment.fullDatabaseId) || typeof comment.body !== 'string') {
        fail('invalid review comment');
    }
    const review = toPullRequestReview(comment.pullRequestReview);
    return {
        id: comment.id,
        fullDatabaseId: comment.fullDatabaseId,
        body: comment.body,
        authorNodeId: typeof comment.author?.id === 'string' ? comment.author.id : null,
        authorLogin: typeof comment.author?.login === 'string' ? comment.author.login : null,
        authorType: typeof comment.author?.__typename === 'string' ? comment.author.__typename : null,
        reviewId: review?.id ?? null,
        reviewState: review?.state ?? null,
        reviewBody: review?.body ?? null,
        reviewCommitOid: review?.commitOid ?? null,
        reviewAuthorNodeId: review?.authorNodeId ?? null,
        reviewAuthorLogin: review?.authorLogin ?? null,
        reviewAuthorType: review?.authorType ?? null,
    };
}
function toPullRequestReview(value: unknown): PullRequestReview | null {
    if (value === null || value === undefined) {
        return null;
    }
    const review = value as {
        id?: unknown;
        state?: unknown;
        body?: unknown;
        commit?: { oid?: unknown } | null;
        author?: { id?: unknown; login?: unknown; __typename?: unknown } | null;
    };
    if (typeof review.id !== 'string' || typeof review.state !== 'string' || typeof review.body !== 'string') {
        fail('invalid pull-request review');
    }
    const commitOid = review.commit?.oid;
    if (commitOid !== null && commitOid !== undefined && typeof commitOid !== 'string') {
        fail('invalid pull-request review');
    }
    return {
        id: review.id,
        state: review.state,
        body: review.body,
        commitOid: typeof commitOid === 'string' ? commitOid : null,
        authorNodeId: typeof review.author?.id === 'string' ? review.author.id : null,
        authorLogin: typeof review.author?.login === 'string' ? review.author.login : null,
        authorType: typeof review.author?.__typename === 'string' ? review.author.__typename : null,
    };
}
function createPendingReview(pullRequestId: string, commitOid: string, body: string, gh: Gh): ReviewEnvelopeReceipt {
    const clientMutationId = createReviewClientMutationId(extractThreadIdFromBody(body));
    const query =
        'mutation($pullRequestId:ID!,$body:String!,$commitOid:GitObjectID!,$clientMutationId:String!){addPullRequestReview(input:{pullRequestId:$pullRequestId,body:$body,commitOID:$commitOid,clientMutationId:$clientMutationId}){clientMutationId pullRequestReview{id state body commit{oid} author{login __typename ... on Bot{id}}}}}';
    const response = graphql(
        gh,
        query,
        [
            '-F',
            `pullRequestId=${pullRequestId}`,
            '-f',
            `body=${body}`,
            '-F',
            `commitOid=${commitOid}`,
            '-f',
            `clientMutationId=${clientMutationId}`,
        ],
        'create pending review'
    ) as {
        data?: {
            addPullRequestReview?: {
                clientMutationId?: unknown;
                pullRequestReview?: unknown;
            };
        };
    };
    const receipt = toPullRequestReview(response.data?.addPullRequestReview?.pullRequestReview);
    const responseClientMutationId = response.data?.addPullRequestReview?.clientMutationId;
    if (receipt === null) {
        fail('create pending review returned an invalid result');
    }
    return {
        ...receipt,
        clientMutationId: typeof responseClientMutationId === 'string' ? responseClientMutationId : '',
    };
}
function mutationReply(threadId: string, reviewId: string, gh: Gh): ReviewReply {
    const clientMutationId = replyClientMutationId(threadId);
    const query =
        'mutation($threadId:ID!,$reviewId:ID!,$body:String!,$clientMutationId:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewId:$reviewId,pullRequestReviewThreadId:$threadId,body:$body,clientMutationId:$clientMutationId}){clientMutationId comment{id fullDatabaseId body author{login __typename ... on Bot{id}} pullRequestReview{id state body commit{oid} author{login __typename ... on Bot{id}}}}}}';
    const response = graphql(
        gh,
        query,
        [
            '-F',
            `threadId=${threadId}`,
            '-F',
            `reviewId=${reviewId}`,
            '-f',
            'body=Done',
            '-f',
            `clientMutationId=${clientMutationId}`,
        ],
        'add review-thread reply'
    ) as {
        data?: {
            addPullRequestReviewThreadReply?: {
                clientMutationId?: unknown;
                comment?: {
                    id?: unknown;
                    fullDatabaseId?: unknown;
                    body?: unknown;
                    author?: { id?: unknown; login?: unknown; __typename?: unknown } | null;
                    pullRequestReview?: unknown;
                };
            };
        };
    };
    const comment = response.data?.addPullRequestReviewThreadReply?.comment;
    const authorNodeId = typeof comment?.author?.id === 'string' ? comment.author.id : null;
    const authorLogin = typeof comment?.author?.login === 'string' ? comment.author.login : null;
    const authorType = typeof comment?.author?.__typename === 'string' ? comment.author.__typename : null;
    if (
        comment?.body !== 'Done' ||
        typeof comment.id !== 'string' ||
        !isDecimalId(comment.fullDatabaseId) ||
        !isAuthorBotActor(authorNodeId, authorType) ||
        response.data?.addPullRequestReviewThreadReply?.clientMutationId !== clientMutationId
    ) {
        fail(`add review-thread reply returned an invalid result for ${threadId}`);
    }
    const review = toPullRequestReview(comment.pullRequestReview);
    return {
        id: comment.id,
        fullDatabaseId: comment.fullDatabaseId,
        authorNodeId,
        authorLogin,
        authorType,
        reviewId: review?.id ?? null,
        reviewState: review?.state ?? null,
        reviewBody: review?.body ?? null,
        reviewCommitOid: review?.commitOid ?? null,
        reviewAuthorNodeId: review?.authorNodeId ?? null,
        reviewAuthorLogin: review?.authorLogin ?? null,
        reviewAuthorType: review?.authorType ?? null,
        clientMutationId,
    };
}
export function submitReview(reviewId: string, body: string, gh: Gh): ReviewEnvelopeReceipt {
    const clientMutationId = submitReviewClientMutationId(reviewId);
    const query =
        'mutation($reviewId:ID!,$body:String!,$clientMutationId:String!){submitPullRequestReview(input:{pullRequestReviewId:$reviewId,event:COMMENT,body:$body,clientMutationId:$clientMutationId}){clientMutationId pullRequestReview{id state body commit{oid} author{login __typename ... on Bot{id}}}}}';
    const response = graphql(
        gh,
        query,
        ['-F', `reviewId=${reviewId}`, '-f', `body=${body}`, '-f', `clientMutationId=${clientMutationId}`],
        'submit review'
    ) as {
        data?: {
            submitPullRequestReview?: {
                clientMutationId?: unknown;
                pullRequestReview?: unknown;
            };
        };
    };
    const receipt = toPullRequestReview(response.data?.submitPullRequestReview?.pullRequestReview);
    const responseClientMutationId = response.data?.submitPullRequestReview?.clientMutationId;
    if (receipt === null) {
        fail(`submit review returned an invalid result for ${reviewId}`);
    }
    return {
        ...receipt,
        clientMutationId: typeof responseClientMutationId === 'string' ? responseClientMutationId : '',
    };
}
function updateReviewBody(reviewId: string, body: string, gh: Gh): ReviewEnvelopeReceipt {
    const clientMutationId = updateReviewClientMutationId(reviewId);
    const query =
        'mutation($reviewId:ID!,$body:String!,$clientMutationId:String!){updatePullRequestReview(input:{pullRequestReviewId:$reviewId,body:$body,clientMutationId:$clientMutationId}){clientMutationId pullRequestReview{id state body commit{oid} author{login __typename ... on Bot{id}}}}}';
    const response = graphql(
        gh,
        query,
        ['-F', `reviewId=${reviewId}`, '-f', `body=${body}`, '-f', `clientMutationId=${clientMutationId}`],
        'update review body'
    ) as {
        data?: {
            updatePullRequestReview?: {
                clientMutationId?: unknown;
                pullRequestReview?: unknown;
            };
        };
    };
    const receipt = toPullRequestReview(response.data?.updatePullRequestReview?.pullRequestReview);
    const responseClientMutationId = response.data?.updatePullRequestReview?.clientMutationId;
    if (receipt === null) {
        fail(`update review body returned an invalid result for ${reviewId}`);
    }
    return {
        ...receipt,
        clientMutationId: typeof responseClientMutationId === 'string' ? responseClientMutationId : '',
    };
}
function resolveThread(threadId: string, gh: Gh): ReviewResolutionReceipt {
    const clientMutationId = resolveClientMutationId(threadId);
    const query = `mutation($threadId:ID!,$clientMutationId:String!){resolveReviewThread(input:{threadId:$threadId,clientMutationId:$clientMutationId}){clientMutationId thread{id isResolved resolvedBy{id login __typename}}}}`;
    const response = graphql(
        gh,
        query,
        ['-F', `threadId=${threadId}`, '-f', `clientMutationId=${clientMutationId}`],
        'resolve review thread'
    ) as {
        data?: {
            resolveReviewThread?: {
                clientMutationId?: unknown;
                thread?: {
                    id?: unknown;
                    isResolved?: unknown;
                    resolvedBy?: { id?: unknown; login?: unknown; __typename?: unknown } | null;
                };
            };
        };
    };
    const receipt = response.data?.resolveReviewThread;
    const resolvedByNodeId = receipt?.thread?.resolvedBy?.id;
    const resolvedByLogin = receipt?.thread?.resolvedBy?.login;
    if (
        receipt?.clientMutationId !== clientMutationId ||
        receipt.thread?.id !== threadId ||
        receipt.thread.isResolved !== true
    ) {
        fail(`resolveReviewThread returned an invalid result for ${threadId}`);
    }
    const resolvedByType = receipt?.thread?.resolvedBy?.__typename;
    if (typeof resolvedByType !== 'string' || !isAuthorResolutionActor(resolvedByNodeId, resolvedByType)) {
        fail(`resolveReviewThread returned an invalid result for ${threadId}`);
    }
    return {
        resolvedByNodeId: authorBotNodeId(resolvedByNodeId),
        resolvedByLogin: typeof resolvedByLogin === 'string' ? resolvedByLogin : '',
        resolvedByType,
        clientMutationId,
    };
}
function deletePendingReview(reviewId: string, gh: Gh): void {
    const response = graphql(
        gh,
        'mutation($reviewId:ID!,$clientMutationId:String!){deletePullRequestReview(input:{pullRequestReviewId:$reviewId,clientMutationId:$clientMutationId}){clientMutationId pullRequestReview{id state body commit{oid} author{login __typename ... on Bot{id}}}}}',
        ['-F', `reviewId=${reviewId}`, '-f', `clientMutationId=${reviewId}`],
        'delete pending review'
    ) as {
        data?: {
            deletePullRequestReview?: {
                clientMutationId?: unknown;
                pullRequestReview?: unknown;
            };
        };
    };
    const receipt = toPullRequestReview(response.data?.deletePullRequestReview?.pullRequestReview);
    if (
        response.data?.deletePullRequestReview?.clientMutationId !== reviewId ||
        receipt === null ||
        receipt.id !== reviewId ||
        receipt.state !== 'PENDING' ||
        !isAuthorBotActor(receipt.authorNodeId, receipt.authorType)
    ) {
        fail(`delete pending review returned an invalid result for ${reviewId}`);
    }
}
export function deleteReply(replyId: string, gh: Gh): void {
    const response = graphql(
        gh,
        'mutation($replyId:ID!,$clientMutationId:String!){deletePullRequestReviewComment(input:{id:$replyId,clientMutationId:$clientMutationId}){clientMutationId pullRequestReviewComment{id body author{login __typename ... on Bot{id}}}}}',
        ['-F', `replyId=${replyId}`, '-f', `clientMutationId=${replyId}`],
        'delete review reply'
    ) as {
        data?: {
            deletePullRequestReviewComment?: {
                clientMutationId?: unknown;
                pullRequestReviewComment?: {
                    id?: unknown;
                    body?: unknown;
                    author?: { id?: unknown; login?: unknown; __typename?: unknown } | null;
                } | null;
            };
        };
    };
    const receipt = response.data?.deletePullRequestReviewComment;
    if (
        receipt?.clientMutationId !== replyId ||
        receipt.pullRequestReviewComment?.id !== replyId ||
        receipt.pullRequestReviewComment.body !== 'Done' ||
        !isAuthorBotActor(
            receipt.pullRequestReviewComment.author?.id,
            receipt.pullRequestReviewComment.author?.__typename
        )
    ) {
        fail(`delete review reply returned an invalid result for ${replyId}`);
    }
}
async function main(): Promise<number> {
    const parsed = parseResolveReviewThreadArgs(process.argv.slice(2));
    if (parsed.help) {
        console.log(`Usage: ${usage.slice('usage: '.length)}`);
        return 0;
    }
    if (parsed.number === undefined || parsed.threadId === undefined || parsed.head === undefined) {
        fail(usage);
    }
    const cwd = process.cwd();
    assertTrustedExecutingBlob(
        'scripts/resolveReviewThread.ts',
        fileURLToPath(import.meta.url),
        originMainBlob('scripts/resolveReviewThread.ts', cwd)
    );
    const primaryRoot = resolvePrimaryRoot();
    const auth = await authenticateRole({ primaryRoot, role: 'author' });
    try {
        if (!isAuthorBotNodeId(auth.minted.actorNodeId)) {
            fail(`minted actor ${auth.minted.actorNodeId} is not ${AUTHOR_BOT_NODE_ID}`);
        }
        assertRequiredRepository(
            spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
                env: auth.session.env,
                cwd: primaryRoot,
            })
        );
        resolveReviewThread(
            parsed.number,
            parsed.threadId,
            parsed.head,
            auth.minted.actorNodeId,
            shellPort(auth.session)
        );
        return 0;
    } finally {
        auth.session.dispose();
    }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    void main().then(
        (code) => process.exit(code),
        (error: unknown) => {
            console.error(error instanceof Error ? error.message : error);
            process.exit(1);
        }
    );
}
