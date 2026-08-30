import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AUTHOR_BOT_NODE_ID, REQUIRED_REPOSITORY, REVIEWER_BOT_NODE_ID, type GhSession } from '../githubAppIdentity.ts';
import {
    parseRecoverReviewResolutionLockArgs,
    runRecoverReviewResolutionLockCli,
} from '../recoverReviewResolutionLock.ts';
import {
    assertDetachedReviewResolutionChild,
    type DeletePendingReviewOptions,
    inspectReviewThread,
    parseResolveReviewThreadArgs,
    publishReviewResolutionChildLaunchMarker,
    readPersistedReviewResolutionChildLaunchMarker,
    runResolveReviewThreadCli,
    reviewResolutionOwnerFenceIsLive,
    resolveReviewThread,
    shellPort,
    deleteReply,
    deletePendingReview,
    submitReview,
    recoverPullRequestReviewResolutionLock,
    recoverReviewResolutionLockOwnerState,
    withPullRequestReviewResolutionLock,
    type ReviewResolutionLockOwner,
    type ReviewResolutionLockOwnerFence,
    type ResolveReviewThreadPort,
} from '../resolveReviewThread.ts';

const head = 'a'.repeat(40);
const movedHead = 'b'.repeat(40);
const pullRequestId = 'PR_kwDOExamplePullRequest';
const threadId = 'PRRT_kwDOExample';
const otherThreadId = 'PRRT_kwDOOtherExample';
const rootId = 'PRRC_root';
const replyId = 'PRRC_reply';
const reviewId = 'PRR_resolution';
type ReviewState = 'PENDING' | 'COMMENTED' | 'APPROVED';
function systemGitPath(): string {
    const result = spawnSync('bash', ['-lc', 'command -v git'], { encoding: 'utf8', shell: false });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout || 'could not resolve git');
    }
    return result.stdout.trim();
}
function systemPsPath(): string {
    const result = spawnSync('bash', ['-lc', 'command -v ps'], { encoding: 'utf8', shell: false });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout || 'could not resolve ps');
    }
    return result.stdout.trim();
}
const trustedGitPath = process.env.SOURDAW_TRUSTED_GIT_PATH ?? systemGitPath();
process.env.SOURDAW_TRUSTED_GIT_PATH = trustedGitPath;
const trustedGhPath = process.env.SOURDAW_TRUSTED_GH_PATH ?? process.execPath;
const trustedPsPath = process.env.SOURDAW_TRUSTED_PS_PATH ?? systemPsPath();
process.env.SOURDAW_TRUSTED_PS_PATH = trustedPsPath;
type ReviewRecord = {
    id: string;
    body: string;
    state: ReviewState;
    commitOid: string;
    authorNodeId: string | null;
    authorLogin: string | null;
    authorType: string | null;
};
type CommentRecord = {
    id: string;
    fullDatabaseId: string;
    body: string;
    authorNodeId: string | null;
    authorLogin: string | null;
    authorType: string | null;
    reviewId: string | null;
};
type TestLockOwnerRecord = {
    version: number;
    pid: number;
    ownerFence?: {
        kind: string;
        pid?: number;
        pgid?: number;
    };
    pgid?: number;
    threadId: string;
    head: string;
    token: string;
    mutation?: {
        phase?: string;
        epoch?: number;
        reviewId?: string;
        replyId?: string;
        body?: string;
        pendingReviewIds?: string[];
        settleAtMs?: number;
        replies?: { replyId?: string; reviewId?: string; reviewState?: string }[];
        allowedAttachedThreadIds?: string[];
        snapshotHead?: string;
        dispatchState?: string;
    };
};
function withTemporaryEnvironment<Value>(overrides: Record<string, string | undefined>, operation: () => Value): Value {
    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(overrides)) {
        previous.set(key, process.env[key]);
        if (value === undefined) {
            delete process.env[key];
            continue;
        }
        process.env[key] = value;
    }
    try {
        return operation();
    } finally {
        for (const [key, value] of previous) {
            if (value === undefined) {
                delete process.env[key];
                continue;
            }
            process.env[key] = value;
        }
    }
}
async function withTemporaryEnvironmentAsync<Value>(
    overrides: Record<string, string | undefined>,
    operation: () => Promise<Value>
): Promise<Value> {
    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(overrides)) {
        previous.set(key, process.env[key]);
        if (value === undefined) {
            delete process.env[key];
            continue;
        }
        process.env[key] = value;
    }
    try {
        return await operation();
    } finally {
        for (const [key, value] of previous) {
            if (value === undefined) {
                delete process.env[key];
                continue;
            }
            process.env[key] = value;
        }
    }
}
function resolutionReviewSummary(currentPullRequestId: string, currentThreadId: string, currentHead: string): string {
    return [
        'Resolved this review thread after applying the requested changes.',
        `<!-- sourdaw-review-resolve pull-request:${currentPullRequestId} thread:${currentThreadId} head:${currentHead} -->`,
    ].join('\n\n');
}
function pendingReviewBody(currentHead: string): string {
    return resolutionReviewSummary(pullRequestId, threadId, currentHead);
}
type Input = {
    heads?: readonly string[];
    authorNodeId?: string;
    throwAfterCreatePendingReview?: boolean;
    throwInspectAfterCreatePendingReview?: boolean;
    createClientMutationId?: string;
    throwAfterReply?: boolean;
    concurrentReplyOnThrow?: boolean;
    concurrentReplyBeforeConvergence?: boolean;
    foreignLowerReplyBeforeConvergence?: boolean;
    resolveBeforeConvergence?: boolean;
    throwResolveWithConcurrentState?: boolean;
    throwResolveOnceWithoutState?: boolean;
    throwAfterSubmitWithState?: boolean;
    throwAfterSubmitWithoutState?: boolean;
    submitClientMutationId?: string;
    submitReceiptAuthorNodeId?: string | null;
    submitReceiptAuthorType?: string | null;
    failDelete?: boolean;
    failDeletePendingReview?: boolean;
    failUpdateReviewBody?: boolean;
    rootAuthorNodeId?: string | null;
    rootAuthorType?: string | null;
    isResolved?: boolean;
    initialResolvedByNodeId?: string | null;
    initialResolvedByType?: string | null;
    resolvedByNodeIdAfterResolve?: string | null;
    resolvedByLoginAfterResolve?: string | null;
    resolvedByTypeAfterResolve?: string | null;
    existingReplyCount?: number;
    deleteReplyAfterResolve?: boolean;
    editReplyAfterResolve?: boolean;
    replyClientMutationId?: string;
    replyAuthorNodeId?: string;
    replyAuthorType?: string;
    resolveClientMutationId?: string;
    resolveReceiptNodeId?: string;
    resolveReceiptType?: string;
    existingPendingReviewCount?: number;
    existingPendingReviewIds?: readonly string[];
    existingPendingReviewBody?: string;
    existingPendingReviewCommitOid?: string;
    createReceiptAuthorNodeId?: string | null;
    createReceiptAuthorType?: string | null;
    addExactForeignPendingReview?: boolean;
    existingReplyReviewState?: ReviewState;
    existingReplyReviewBody?: string;
    existingReplyReviewCommitOid?: string;
    existingReplyReviewAuthorNodeId?: string | null;
    existingReplyReviewAuthorType?: string | null;
    existingReplyReviewMissing?: boolean;
    secondaryReplyReviewState?: ReviewState;
    secondaryReplyReviewId?: string;
    secondaryReplyReviewBody?: string;
    secondaryReplyReviewCommitOid?: string;
    secondaryReplyReviewAuthorNodeId?: string | null;
    secondaryReplyReviewAuthorType?: string | null;
    secondaryReplyReviewMissing?: boolean;
    addForeignPendingReview?: boolean;
    addExactPendingReplyMarker?: boolean;
    exactPendingReplyFullDatabaseId?: string;
    addPendingReplyMarkerToResolvedThread?: boolean;
    resolvedPendingReplyFullDatabaseId?: string;
    attachConcurrentManagedPendingReplyAfterLostCreate?: boolean;
    attachManagedPendingReplyOnFirstInspect?: boolean;
    attachConcurrentManagedPendingReplyDuringPendingDelete?: boolean;
    attachedReviewThreadIdsByReviewId?: Record<string, string[]>;
    concurrentCommentedReplyAfterReplyFailure?: boolean;
    concurrentResolveAfterReplyFailure?: boolean;
    concurrentCommentedResolvedStateOnCompensationInspect?: boolean;
    attachManagedReplyBeforeCompensation?: boolean;
    failDeleteMissingReply?: boolean;
    replyReceiptReviewId?: string;
    failUpdateReviewBodyIds?: readonly string[];
    updateClientMutationId?: string;
    updateReceiptState?: ReviewState;
    updateReceiptAuthorNodeId?: string | null;
    updateReceiptAuthorType?: string | null;
};
function fakePort(input: Input = {}) {
    const calls: string[] = [];
    const deletePendingReviewCalls: { reviewId: string; options: DeletePendingReviewOptions | undefined }[] = [];
    let index = 0;
    let resolved = input.isResolved ?? false;
    let createFailures = 0;
    let resolveCalled = false;
    let resolveFailures = 0;
    let submitFailures = 0;
    let resolvedByNodeId: string | null = input.initialResolvedByNodeId ?? null;
    let resolvedByLogin: string | null = null;
    let resolvedByType: string | null = input.initialResolvedByType ?? null;
    let concurrentReplyAdded = false;
    let compensationReplyAdded = false;
    const currentHead = (inspectIndex: number): string => input.heads?.[inspectIndex - 1] ?? head;
    const expectedReviewBody = pendingReviewBody(head);
    const reviewerLogin = 'renamed-reviewer[bot]';
    const authorLogin = 'renamed-author[bot]';
    const comments: CommentRecord[] = [
        {
            id: rootId,
            fullDatabaseId: '9223372036854775807',
            body: 'review',
            authorNodeId: input.rootAuthorNodeId ?? REVIEWER_BOT_NODE_ID,
            authorLogin: reviewerLogin,
            authorType: input.rootAuthorType ?? 'Bot',
            reviewId: null,
        },
    ];
    const reviews: ReviewRecord[] = [];
    function pushReview(id: string, state: ReviewState, body: string, commitOid: string): void {
        reviews.push({
            id,
            body,
            state,
            commitOid,
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin,
            authorType: 'Bot',
        });
    }
    function pushReply(id: string, fullDatabaseId: string, currentReviewId: string | null): void {
        comments.push({
            id,
            fullDatabaseId,
            body: 'Done',
            authorNodeId: input.replyAuthorNodeId ?? AUTHOR_BOT_NODE_ID,
            authorLogin,
            authorType: input.replyAuthorType ?? 'Bot',
            reviewId: currentReviewId,
        });
    }
    function nextReplyId(): string {
        return comments.some((comment) => comment.id === replyId) ? `PRRC_created_${comments.length - 1}` : replyId;
    }
    function nextReplyFullDatabaseId(): string {
        const max = comments.reduce((currentMax, comment) => {
            const current = BigInt(comment.fullDatabaseId);
            return current > currentMax ? current : currentMax;
        }, 0n);
        return String(max + 1n);
    }
    for (let reviewIndex = 0; reviewIndex < (input.existingPendingReviewCount ?? 0); reviewIndex += 1) {
        const currentReviewId =
            input.existingPendingReviewIds?.[reviewIndex] ??
            (reviewIndex === 0 ? reviewId : `PRR_pending_${reviewIndex}`);
        pushReview(
            currentReviewId,
            'PENDING',
            input.existingPendingReviewBody ?? expectedReviewBody,
            input.existingPendingReviewCommitOid ?? head
        );
    }
    if (input.addExactForeignPendingReview) {
        reviews.push({
            id: 'PRR_foreign_pending',
            body: expectedReviewBody,
            state: 'PENDING',
            commitOid: head,
            authorNodeId: REVIEWER_BOT_NODE_ID,
            authorLogin: reviewerLogin,
            authorType: 'Bot',
        });
    }
    if (input.addForeignPendingReview) {
        reviews.push({
            id: 'PRR_foreign_pending',
            body: 'foreign pending review',
            state: 'PENDING',
            commitOid: head,
            authorNodeId: REVIEWER_BOT_NODE_ID,
            authorLogin: reviewerLogin,
            authorType: 'Bot',
        });
    }
    if (input.addExactPendingReplyMarker) {
        pushReview('PRR_pending_reply', 'PENDING', expectedReviewBody, head);
        pushReply(
            'PRRC_pending_reply',
            input.exactPendingReplyFullDatabaseId ?? '9223372036854775811',
            'PRR_pending_reply'
        );
    }
    for (let replyIndex = 0; replyIndex < (input.existingReplyCount ?? 0); replyIndex += 1) {
        const currentReviewId = replyIndex === 0 ? reviewId : `PRR_existing_${replyIndex}`;
        const useSecondaryReplyReview = replyIndex > 0;
        const configuredReviewId = useSecondaryReplyReview
            ? (input.secondaryReplyReviewId ?? currentReviewId)
            : currentReviewId;
        const reviewMissing = useSecondaryReplyReview
            ? (input.secondaryReplyReviewMissing ?? input.existingReplyReviewMissing)
            : input.existingReplyReviewMissing;
        const reviewState = useSecondaryReplyReview
            ? (input.secondaryReplyReviewState ?? input.existingReplyReviewState ?? 'COMMENTED')
            : (input.existingReplyReviewState ?? 'COMMENTED');
        const reviewBody = useSecondaryReplyReview
            ? (input.secondaryReplyReviewBody ?? input.existingReplyReviewBody ?? expectedReviewBody)
            : (input.existingReplyReviewBody ?? expectedReviewBody);
        const reviewCommitOid = useSecondaryReplyReview
            ? (input.secondaryReplyReviewCommitOid ?? input.existingReplyReviewCommitOid ?? head)
            : (input.existingReplyReviewCommitOid ?? head);
        const reviewAuthorNodeId = useSecondaryReplyReview
            ? (input.secondaryReplyReviewAuthorNodeId ?? input.existingReplyReviewAuthorNodeId ?? AUTHOR_BOT_NODE_ID)
            : (input.existingReplyReviewAuthorNodeId ?? AUTHOR_BOT_NODE_ID);
        const reviewAuthorType = useSecondaryReplyReview
            ? (input.secondaryReplyReviewAuthorType ?? input.existingReplyReviewAuthorType ?? 'Bot')
            : (input.existingReplyReviewAuthorType ?? 'Bot');
        if (!reviewMissing) {
            pushReview(configuredReviewId, reviewState, reviewBody, reviewCommitOid);
            reviews[reviews.length - 1]!.authorNodeId = reviewAuthorNodeId;
            reviews[reviews.length - 1]!.authorType = reviewAuthorType;
        }
        pushReply(
            replyIndex === 0 ? replyId : `PRRC_existing_${replyIndex}`,
            String(9223372036854775808n + BigInt(replyIndex)),
            configuredReviewId
        );
    }
    if (input.addPendingReplyMarkerToResolvedThread) {
        pushReview('PRR_resolved_pending', 'PENDING', expectedReviewBody, head);
        pushReply(
            'PRRC_resolved_pending',
            input.resolvedPendingReplyFullDatabaseId ?? '9223372036854775812',
            'PRR_resolved_pending'
        );
    }
    function reviewById(id: string | null): ReviewRecord | undefined {
        return reviews.find((review) => review.id === id);
    }
    function deleteReviewById(id: string): void {
        const reviewIndex = reviews.findIndex((review) => review.id === id);
        if (reviewIndex >= 0) {
            reviews.splice(reviewIndex, 1);
        }
        for (let commentIndex = comments.length - 1; commentIndex >= 1; commentIndex -= 1) {
            if (comments[commentIndex]?.reviewId === id) {
                comments.splice(commentIndex, 1);
            }
        }
    }
    function nextReviewId(): string {
        const resolutionReview = reviewById(reviewId);
        if (resolutionReview === undefined) {
            return reviewId;
        }
        return `PRR_created_${reviews.length}`;
    }
    function hasAuthorPendingReview(): boolean {
        return reviews.some(
            (review) =>
                review.state === 'PENDING' && review.authorNodeId === AUTHOR_BOT_NODE_ID && review.authorType === 'Bot'
        );
    }
    const port: ResolveReviewThreadPort = {
        inspect: () => {
            calls.push(`inspect:${++index}`);
            if (input.throwInspectAfterCreatePendingReview && index === 2) {
                throw new Error('inspect transport lost');
            }
            if (input.concurrentReplyBeforeConvergence && !concurrentReplyAdded && index === 2) {
                concurrentReplyAdded = true;
                pushReview('PRR_concurrent', 'COMMENTED', expectedReviewBody, head);
                pushReply('PRRC_concurrent', '9223372036854775809', 'PRR_concurrent');
            }
            if (input.attachManagedPendingReplyOnFirstInspect && !compensationReplyAdded && index === 1) {
                compensationReplyAdded = true;
                pushReply('PRRC_first_pending', '9223372036854775815', reviewId);
            }
            if (input.foreignLowerReplyBeforeConvergence && !concurrentReplyAdded && index === 2) {
                concurrentReplyAdded = true;
                pushReview('PRR_foreign', 'COMMENTED', expectedReviewBody, head);
                pushReply('PRRC_foreign', '9223372036854775806', 'PRR_foreign');
            }
            if (input.resolveBeforeConvergence && index === 2) {
                resolved = true;
                resolvedByNodeId = AUTHOR_BOT_NODE_ID;
                resolvedByLogin = 'renamed-author';
                resolvedByType = 'User';
            }
            if (input.throwResolveWithConcurrentState && resolveCalled) {
                resolved = true;
            }
            if (input.attachManagedReplyBeforeCompensation && !compensationReplyAdded && index === 3) {
                compensationReplyAdded = true;
                pushReply(replyId, '9223372036854775808', reviewId);
            }
            if (input.attachConcurrentManagedPendingReplyAfterLostCreate && !compensationReplyAdded && index === 2) {
                compensationReplyAdded = true;
                pushReply('PRRC_concurrent_pending', '9223372036854775813', reviewId);
            }
            if (input.concurrentCommentedResolvedStateOnCompensationInspect && index === 3) {
                const targetReview = reviewById(reviewId);
                if (targetReview !== undefined) {
                    targetReview.state = 'COMMENTED';
                    targetReview.body = pendingReviewBody(head);
                }
                resolved = true;
                resolvedByNodeId = AUTHOR_BOT_NODE_ID;
                resolvedByLogin = 'renamed-author';
                resolvedByType = 'User';
            }
            if (
                resolveCalled &&
                (input.resolvedByNodeIdAfterResolve !== undefined ||
                    input.resolvedByLoginAfterResolve !== undefined ||
                    input.resolvedByTypeAfterResolve !== undefined)
            ) {
                resolvedByNodeId = input.resolvedByNodeIdAfterResolve ?? resolvedByNodeId;
                resolvedByLogin = input.resolvedByLoginAfterResolve ?? resolvedByLogin;
                resolvedByType = input.resolvedByTypeAfterResolve ?? 'User';
            }
            if (resolveCalled && input.deleteReplyAfterResolve) {
                deleteReviewById(reviewId);
            }
            if (resolveCalled && input.editReplyAfterResolve) {
                const target = comments.find((comment) => comment.id === replyId);
                if (target !== undefined) {
                    target.body = 'Edited';
                }
            }
            return {
                pullRequestId,
                head: currentHead(index),
                thread: {
                    id: threadId,
                    isResolved: resolved,
                    resolvedByNodeId,
                    resolvedByLogin,
                    resolvedByType,
                    rootCommentId: rootId,
                    rootCommentFullDatabaseId: '9223372036854775807',
                    rootAuthorNodeId: comments[0]?.authorNodeId ?? null,
                    rootAuthorLogin: comments[0]?.authorLogin ?? null,
                    rootAuthorType: comments[0]?.authorType ?? null,
                    comments: comments.map((comment) => {
                        const review = reviewById(comment.reviewId);
                        return {
                            id: comment.id,
                            fullDatabaseId: comment.fullDatabaseId,
                            body: comment.body,
                            authorNodeId: comment.authorNodeId,
                            authorLogin: comment.authorLogin,
                            authorType: comment.authorType,
                            reviewId: review?.id ?? null,
                            reviewState: review?.state ?? null,
                            reviewBody: review?.body ?? null,
                            reviewCommitOid: review?.commitOid ?? null,
                            reviewAuthorNodeId: review?.authorNodeId ?? null,
                            reviewAuthorLogin: review?.authorLogin ?? null,
                            reviewAuthorType: review?.authorType ?? null,
                        };
                    }),
                },
                pendingReviews: reviews
                    .filter((review) => review.state === 'PENDING')
                    .map((review) => ({
                        id: review.id,
                        state: review.state,
                        body: review.body,
                        commitOid: review.commitOid,
                        authorNodeId: review.authorNodeId,
                        authorLogin: review.authorLogin,
                        authorType: review.authorType,
                    })),
            };
        },
        inspectPullRequestReview: (_number, id) => {
            const review = reviewById(id);
            if (review === undefined) {
                return null;
            }
            return {
                id: review.id,
                state: review.state,
                body: review.body,
                commitOid: review.commitOid,
                authorNodeId: review.authorNodeId,
                authorLogin: review.authorLogin,
                authorType: review.authorType,
            };
        },
        createPendingReview: (currentPullRequestId, commitOid, body) => {
            calls.push(`createReview:${currentPullRequestId}`);
            if (hasAuthorPendingReview()) {
                throw new Error('pending review already exists');
            }
            const id = nextReviewId();
            pushReview(id, 'PENDING', body, commitOid);
            if (input.throwAfterCreatePendingReview && createFailures++ === 0) {
                throw new Error('create review transport lost');
            }
            return {
                id,
                state: 'PENDING',
                body,
                commitOid,
                authorNodeId: input.createReceiptAuthorNodeId ?? AUTHOR_BOT_NODE_ID,
                authorLogin,
                authorType: input.createReceiptAuthorType ?? 'Bot',
                clientMutationId: input.createClientMutationId ?? `review-create:${threadId}`,
            };
        },
        replyDone: (id, currentReviewId) => {
            calls.push(`reply:${id}:${currentReviewId}`);
            const createdReplyId = nextReplyId();
            const createdReplyFullDatabaseId = nextReplyFullDatabaseId();
            const receiptReviewId = input.replyReceiptReviewId ?? currentReviewId;
            if (receiptReviewId !== null && reviewById(receiptReviewId) === undefined) {
                pushReview(receiptReviewId, 'PENDING', expectedReviewBody, head);
            }
            pushReply(createdReplyId, createdReplyFullDatabaseId, receiptReviewId);
            if (input.throwAfterReply) {
                if (input.concurrentReplyOnThrow) {
                    pushReply('PRRC_concurrent', '9223372036854775809', null);
                }
                throw new Error('reply transport lost');
            }
            return {
                id: createdReplyId,
                fullDatabaseId: createdReplyFullDatabaseId,
                authorNodeId: input.replyAuthorNodeId ?? AUTHOR_BOT_NODE_ID,
                authorLogin,
                authorType: input.replyAuthorType ?? 'Bot',
                reviewId: receiptReviewId,
                reviewState: reviewById(receiptReviewId)?.state ?? null,
                reviewBody: reviewById(receiptReviewId)?.body ?? null,
                reviewCommitOid: reviewById(receiptReviewId)?.commitOid ?? null,
                reviewAuthorNodeId: reviewById(receiptReviewId)?.authorNodeId ?? null,
                reviewAuthorLogin: reviewById(receiptReviewId)?.authorLogin ?? null,
                reviewAuthorType: reviewById(receiptReviewId)?.authorType ?? null,
                clientMutationId: input.replyClientMutationId ?? `review-reply:${id}`,
            };
        },
        submitReview: (currentReviewId, body) => {
            calls.push(`submitReview:${currentReviewId}`);
            const review = reviewById(currentReviewId);
            if (review === undefined) {
                throw new Error(`missing review ${currentReviewId}`);
            }
            if (input.throwAfterSubmitWithoutState && submitFailures === 0) {
                submitFailures += 1;
                throw new Error('submit review transport lost');
            }
            review.body = body;
            review.state = 'COMMENTED';
            if (input.throwAfterSubmitWithState && submitFailures === 0) {
                submitFailures += 1;
                throw new Error('submit review transport lost');
            }
            return {
                id: currentReviewId,
                state: input.updateReceiptState ?? review.state,
                body: review.body,
                commitOid: review.commitOid,
                authorNodeId: input.submitReceiptAuthorNodeId ?? review.authorNodeId,
                authorLogin: review.authorLogin,
                authorType: input.submitReceiptAuthorType ?? review.authorType,
                clientMutationId: input.submitClientMutationId ?? `review-submit:${currentReviewId}`,
            };
        },
        updateReviewBody: (currentReviewId, body) => {
            calls.push(`updateReview:${currentReviewId}`);
            const review = reviewById(currentReviewId);
            if (review === undefined) {
                throw new Error(`missing review ${currentReviewId}`);
            }
            if (input.failUpdateReviewBody || input.failUpdateReviewBodyIds?.includes(currentReviewId)) {
                throw new Error('update denied');
            }
            review.body = body;
            return {
                id: currentReviewId,
                state: input.updateReceiptState ?? review.state,
                body: review.body,
                commitOid: review.commitOid,
                authorNodeId: input.updateReceiptAuthorNodeId ?? review.authorNodeId,
                authorLogin: review.authorLogin,
                authorType: input.updateReceiptAuthorType ?? review.authorType,
                clientMutationId: input.updateClientMutationId ?? `review-update:${currentReviewId}`,
            };
        },
        resolve: (id) => {
            calls.push(`resolve:${id}`);
            resolveCalled = true;
            if (input.throwResolveWithConcurrentState) {
                throw new Error('resolve transport lost');
            }
            if (input.throwResolveOnceWithoutState && resolveFailures === 0) {
                resolveFailures += 1;
                throw new Error('resolve transport lost');
            }
            resolved = true;
            resolvedByNodeId = AUTHOR_BOT_NODE_ID;
            resolvedByLogin = 'renamed-author';
            resolvedByType = 'User';
            return {
                resolvedByNodeId: input.resolveReceiptNodeId ?? resolvedByNodeId,
                resolvedByLogin,
                resolvedByType: input.resolveReceiptType ?? resolvedByType,
                clientMutationId: input.resolveClientMutationId ?? `review-resolve:${id}`,
            };
        },
        deleteReply: (id) => {
            calls.push(`delete:${id}`);
            if (input.failDelete) {
                throw new Error('delete denied');
            }
            if (input.concurrentCommentedReplyAfterReplyFailure) {
                input.concurrentCommentedReplyAfterReplyFailure = false;
                const targetReview = reviewById(reviewId);
                if (targetReview !== undefined) {
                    targetReview.state = 'COMMENTED';
                    targetReview.body = pendingReviewBody(head);
                }
            }
            if (input.concurrentResolveAfterReplyFailure) {
                input.concurrentResolveAfterReplyFailure = false;
                resolved = true;
                resolvedByNodeId = AUTHOR_BOT_NODE_ID;
                resolvedByLogin = 'renamed-author';
                resolvedByType = 'User';
            }
            const commentIndex = comments.findIndex((comment) => comment.id === id);
            if (commentIndex < 0) {
                if (input.failDeleteMissingReply) {
                    throw new Error(`missing review reply ${id}`);
                }
                return;
            }
            comments.splice(commentIndex, 1);
        },
        deletePendingReview: (id, options) => {
            calls.push(`deleteReview:${id}`);
            deletePendingReviewCalls.push({ reviewId: id, options });
            if (input.failDeletePendingReview) {
                throw new Error('delete pending review denied');
            }
            if (input.attachConcurrentManagedPendingReplyDuringPendingDelete) {
                input.attachConcurrentManagedPendingReplyDuringPendingDelete = false;
                pushReply('PRRC_delete_race', '9223372036854775814', reviewId);
            }
            deleteReviewById(id);
        },
        inspectAttachedReviewThreadIds: (number, id, expectedPullRequestId, expectedHead) => {
            calls.push(`inspectAttachedReviewThreads:${number}:${id}:${expectedPullRequestId}:${expectedHead}`);
            const attachedThreadIds = new Set(input.attachedReviewThreadIdsByReviewId?.[id] ?? []);
            if (comments.some((comment) => comment.reviewId === id)) {
                attachedThreadIds.add(threadId);
            }
            return [...attachedThreadIds];
        },
        serializeReviewThreadMutation: (_number, _threadId, _expectedHead, operation) => operation(),
        log: (message) => calls.push(`log:${message}`),
    };
    return {
        port,
        calls,
        deletePendingReviewCalls,
        authorNodeId: input.authorNodeId ?? AUTHOR_BOT_NODE_ID,
        state: () => ({ resolved, resolvedByNodeId, resolvedByLogin, resolvedByType, comments, reviews }),
        injectManagedPendingReply: (
            currentReplyId: string = 'PRRC_delayed_pending',
            fullDatabaseId: string = '9223372036854775816',
            currentReviewId: string = reviewId
        ) => {
            if (reviewById(currentReviewId) === undefined) {
                pushReview(currentReviewId, 'PENDING', expectedReviewBody, head);
            }
            pushReply(currentReplyId, fullDatabaseId, currentReviewId);
        },
    };
}

function threadPage(nodes: unknown[], hasNextPage: boolean, endCursor: string | null, pageHead: string = head) {
    return JSON.stringify({
        data: {
            repository: {
                pullRequest: {
                    id: pullRequestId,
                    headRefOid: pageHead,
                    reviewThreads: { nodes, pageInfo: { hasNextPage, endCursor } },
                },
            },
        },
    });
}
function reviewPage(nodes: unknown[], hasNextPage: boolean, endCursor: string | null, pageHead: string = head) {
    return JSON.stringify({
        data: {
            repository: {
                pullRequest: {
                    id: pullRequestId,
                    headRefOid: pageHead,
                    reviews: { nodes, pageInfo: { hasNextPage, endCursor } },
                },
            },
        },
    });
}
function commentPage(
    nodes: unknown[],
    hasNextPage: boolean,
    endCursor: string | null,
    currentThreadId: string = threadId,
    pageHead: string = head,
    currentPullRequestId: string = pullRequestId,
    threadState: {
        isResolved?: boolean;
        resolvedBy?: { id?: string; login?: string; __typename?: string } | null;
    } = { isResolved: false, resolvedBy: null }
) {
    return JSON.stringify({
        data: {
            repository: { pullRequest: { id: currentPullRequestId, headRefOid: pageHead } },
            node: {
                id: currentThreadId,
                ...threadState,
                comments: { nodes, pageInfo: { hasNextPage, endCursor } },
            },
        },
    });
}
function threadResolutionPage(
    currentThreadId: string = threadId,
    pageHead: string = head,
    currentPullRequestId: string = pullRequestId,
    threadState: {
        isResolved?: boolean;
        resolvedBy?: { id?: string; login?: string; __typename?: string } | null;
    } = { isResolved: false, resolvedBy: null }
) {
    return JSON.stringify({
        data: {
            repository: { pullRequest: { id: currentPullRequestId, headRefOid: pageHead } },
            node: {
                id: currentThreadId,
                ...threadState,
            },
        },
    });
}
const root = {
    id: rootId,
    fullDatabaseId: '9223372036854775807',
    body: 'review',
    author: { id: REVIEWER_BOT_NODE_ID, login: 'renamed-reviewer', __typename: 'Bot' },
};
function expectCanonicalResolutionReview(
    review: {
        id: string;
        state: ReviewState;
        body: string;
        commitOid: string;
        authorNodeId: string | null;
        authorType: string | null;
    },
    expectedReviewHead: string = head
): void {
    expect(review).toMatchObject({
        id: reviewId,
        state: 'COMMENTED',
        body: resolutionReviewSummary(pullRequestId, threadId, expectedReviewHead),
        commitOid: expectedReviewHead,
        authorNodeId: AUTHOR_BOT_NODE_ID,
        authorType: 'Bot',
    });
}

function createTemporaryGitRepository(): string {
    const directory = mkdtempSync(join(tmpdir(), 'resolve-review-thread-lock-'));
    const init = spawnSync('git', ['init', '--quiet'], {
        cwd: directory,
        encoding: 'utf8',
        shell: false,
    });
    if (init.error !== undefined) {
        throw init.error;
    }
    if (init.status !== 0) {
        throw new Error(init.stderr || 'git init failed');
    }
    return directory;
}

function createTemporaryGitRepositoryWithTrackedResolveSource(): {
    repository: string;
    pinnedCommit: string;
    advancedCommit: string;
} {
    const repository = createTemporaryGitRepository();
    mkdirSync(join(repository, 'scripts'), { recursive: true });
    writeFileSync(join(repository, 'scripts/resolveReviewThread.ts'), 'export const trusted = "pinned";\n');
    gitCapture(repository, ['add', 'scripts/resolveReviewThread.ts']);
    gitCapture(repository, [
        '-c',
        'user.name=Codex',
        '-c',
        'user.email=codex@example.com',
        'commit',
        '--quiet',
        '-m',
        'base',
    ]);
    const pinnedCommit = gitCapture(repository, ['rev-parse', 'HEAD']);
    gitCapture(repository, ['update-ref', 'refs/remotes/origin/main', pinnedCommit]);
    writeFileSync(join(repository, 'scripts/resolveReviewThread.ts'), 'export const trusted = "advanced";\n');
    gitCapture(repository, ['add', 'scripts/resolveReviewThread.ts']);
    gitCapture(repository, [
        '-c',
        'user.name=Codex',
        '-c',
        'user.email=codex@example.com',
        'commit',
        '--quiet',
        '-m',
        'advanced',
    ]);
    const advancedCommit = gitCapture(repository, ['rev-parse', 'HEAD']);
    return { repository, pinnedCommit, advancedCommit };
}

function createFakeGhExecutable(responsesByKey: Record<string, string | string[]>): {
    root: string;
    executable: string;
} {
    const root = mkdtempSync(join(tmpdir(), 'resolve-review-thread-gh-'));
    const executable = join(root, 'gh');
    writeFileSync(
        executable,
        [
            `#!${process.execPath}`,
            `const responses = ${JSON.stringify(responsesByKey)};`,
            `const countsPath = ${JSON.stringify(join(root, 'counts.json'))};`,
            'const fs = require("node:fs");',
            'const args = process.argv.slice(2);',
            "if (args[0] !== 'api' || args[1] !== 'graphql') {",
            '  console.error(`unexpected gh args ${JSON.stringify(args)}`);',
            '  process.exit(1);',
            '}',
            'const queryArg = args.find((value) => value.startsWith("query="));',
            "if (queryArg === undefined) { console.error('missing query'); process.exit(1); }",
            'const query = queryArg.slice("query=".length);',
            'const fields = new Map();',
            'for (let index = 0; index < args.length; index += 1) {',
            "  if (args[index] !== '-F' && args[index] !== '-f') continue;",
            '  const field = args[index + 1];',
            "  if (typeof field !== 'string') { console.error('missing field value'); process.exit(1); }",
            "  const separator = field.indexOf('=');",
            '  if (separator <= 0) { console.error(`invalid field ${field}`); process.exit(1); }',
            '  fields.set(field.slice(0, separator), field.slice(separator + 1));',
            '}',
            "let key = 'unknown';",
            "if (query.includes('comments(first:100')) key = `comments:${fields.get('threadId') ?? ''}:${fields.get('cursor') ?? ''}`;",
            "else if (query.includes('reviews(first:100')) key = `reviews:${fields.get('cursor') ?? ''}`;",
            "else if (query.includes('reviewThreads(first:100')) key = `threads:${fields.get('cursor') ?? ''}`;",
            "else if (query.includes('node(id:$reviewId){... on PullRequestReview{')) key = `review:${fields.get('reviewId') ?? ''}`;",
            "else if (query.includes('addPullRequestReview(input:{pullRequestId:$pullRequestId')) key = `createReview:${fields.get('pullRequestId') ?? ''}:${fields.get('commitOid') ?? ''}:${fields.get('clientMutationId') ?? ''}`;",
            "else if (query.includes('node(id:$threadId){... on PullRequestReviewThread{id isResolved resolvedBy{id login __typename}}')) key = `threadResolution:${fields.get('threadId') ?? ''}`;",
            'const response = responses[key];',
            'if (response === undefined) { console.error(`unexpected key ${key}`); process.exit(1); }',
            'if (Array.isArray(response)) {',
            '  const counts = fs.existsSync(countsPath) ? JSON.parse(fs.readFileSync(countsPath, "utf8")) : {};',
            '  const count = typeof counts[key] === "number" ? counts[key] : 0;',
            '  const current = response[Math.min(count, response.length - 1)];',
            '  counts[key] = count + 1;',
            '  fs.writeFileSync(countsPath, JSON.stringify(counts));',
            '  process.stdout.write(current);',
            '  process.exit(0);',
            '}',
            'process.stdout.write(response);',
        ].join('\n'),
        { encoding: 'utf8', mode: 0o700 }
    );
    chmodSync(executable, 0o700);
    return { root, executable };
}

function createFailingReviewResolutionMutationGhExecutable(
    mutation: 'createPendingReview' | 'replyDone' | 'submitReview' | 'resolveThread'
): {
    root: string;
    executable: string;
    calledPath: string;
} {
    const root = mkdtempSync(join(tmpdir(), `resolve-review-thread-failing-${mutation}-gh-`));
    const executable = join(root, 'gh');
    const calledPath = join(root, `${mutation}-called`);
    let queryPattern: string;
    let transportLabel: string;
    switch (mutation) {
        case 'createPendingReview':
            queryPattern =
                'addPullRequestReview(input:{pullRequestId:$pullRequestId,body:$body,commitOID:$commitOid,clientMutationId:$clientMutationId})';
            transportLabel = 'create';
            break;
        case 'replyDone':
            queryPattern =
                'addPullRequestReviewThreadReply(input:{pullRequestReviewId:$reviewId,pullRequestReviewThreadId:$threadId,body:$body,clientMutationId:$clientMutationId})';
            transportLabel = 'reply';
            break;
        case 'submitReview':
            queryPattern =
                'submitPullRequestReview(input:{pullRequestReviewId:$reviewId,event:COMMENT,body:$body,clientMutationId:$clientMutationId})';
            transportLabel = 'submit';
            break;
        case 'resolveThread':
            queryPattern = 'resolveReviewThread(input:{threadId:$threadId,clientMutationId:$clientMutationId})';
            transportLabel = 'resolve';
            break;
    }
    writeFileSync(
        executable,
        [
            `#!${process.execPath}`,
            'const fs = require("node:fs");',
            `const calledPath = ${JSON.stringify(calledPath)};`,
            `const queryPattern = ${JSON.stringify(queryPattern)};`,
            `const transportLabel = ${JSON.stringify(transportLabel)};`,
            'const args = process.argv.slice(2);',
            "if (args[0] !== 'api' || args[1] !== 'graphql') { console.error(`unexpected gh args ${JSON.stringify(args)}`); process.exit(1); }",
            'const queryArg = args.find((value) => value.startsWith("query="));',
            "if (queryArg === undefined) { console.error('missing query'); process.exit(1); }",
            'const query = queryArg.slice("query=".length);',
            'if (query.includes(queryPattern)) {',
            "  fs.writeFileSync(calledPath, '1');",
            '  console.error(`${transportLabel} mutation transport lost`);',
            '  process.exit(1);',
            '}',
            'console.error(`unexpected query ${query}`);',
            'process.exit(1);',
        ].join('\n'),
        { encoding: 'utf8', mode: 0o700 }
    );
    chmodSync(executable, 0o700);
    return { root, executable, calledPath };
}

function createLockObservingCreateReviewGhExecutable(repository: string): {
    root: string;
    executable: string;
    mutationOwnerPath: string;
} {
    const root = mkdtempSync(join(tmpdir(), 'resolve-review-thread-create-recovery-gh-'));
    const executable = join(root, 'gh');
    const mutationOwnerPath = join(root, 'mutation-owner.json');
    writeFileSync(
        executable,
        [
            `#!${process.execPath}`,
            'const fs = require("node:fs");',
            'const { spawnSync } = require("node:child_process");',
            `const repository = ${JSON.stringify(repository)};`,
            `const trustedGitPath = ${JSON.stringify(trustedGitPath)};`,
            `const mutationOwnerPath = ${JSON.stringify(mutationOwnerPath)};`,
            `const reviewId = ${JSON.stringify(reviewId)};`,
            `const authorNodeId = ${JSON.stringify(AUTHOR_BOT_NODE_ID)};`,
            'const args = process.argv.slice(2);',
            "if (args[0] !== 'api' || args[1] !== 'graphql') { console.error(`unexpected gh args ${JSON.stringify(args)}`); process.exit(1); }",
            'const queryArg = args.find((value) => value.startsWith("query="));',
            "if (queryArg === undefined) { console.error('missing query'); process.exit(1); }",
            'const query = queryArg.slice("query=".length);',
            "if (!query.includes('addPullRequestReview(input:{pullRequestId:$pullRequestId,body:$body,commitOID:$commitOid,clientMutationId:$clientMutationId})')) {",
            '  console.error(`unexpected query ${query}`);',
            '  process.exit(1);',
            '}',
            'const fields = new Map();',
            'for (let index = 0; index < args.length; index += 1) {',
            "  if (args[index] !== '-F' && args[index] !== '-f') continue;",
            '  const field = args[index + 1];',
            "  if (typeof field !== 'string') { console.error('missing field value'); process.exit(1); }",
            "  const separator = field.indexOf('=');",
            '  if (separator <= 0) { console.error(`invalid field ${field}`); process.exit(1); }',
            '  fields.set(field.slice(0, separator), field.slice(separator + 1));',
            '}',
            "const oidResult = spawnSync(trustedGitPath, ['show-ref', '--verify', '--hash', 'refs/sourdaw/review-resolution/pr-42'], {",
            "  cwd: repository, encoding: 'utf8', shell: false,",
            '});',
            'if (oidResult.error !== undefined) throw oidResult.error;',
            "if (oidResult.status !== 0) { console.error(oidResult.stderr || oidResult.stdout || 'show-ref failed'); process.exit(1); }",
            'const oid = oidResult.stdout.trim();',
            "const ownerResult = spawnSync(trustedGitPath, ['cat-file', 'blob', oid], { cwd: repository, encoding: 'utf8', shell: false });",
            'if (ownerResult.error !== undefined) throw ownerResult.error;',
            "if (ownerResult.status !== 0) { console.error(ownerResult.stderr || ownerResult.stdout || 'cat-file failed'); process.exit(1); }",
            "fs.writeFileSync(mutationOwnerPath, JSON.stringify({ oid, owner: JSON.parse(ownerResult.stdout) }), 'utf8');",
            'process.stdout.write(JSON.stringify({',
            '  data: {',
            '    addPullRequestReview: {',
            "      clientMutationId: fields.get('clientMutationId') ?? '',",
            '      pullRequestReview: {',
            '        id: reviewId,',
            "        state: 'PENDING',",
            "        body: fields.get('body') ?? '',",
            "        commit: { oid: fields.get('commitOid') ?? '' },",
            "        author: { id: authorNodeId, login: 'renamed-author', __typename: 'Bot' },",
            '      },',
            '    },',
            '  },',
            '}));',
        ].join('\n'),
        { encoding: 'utf8', mode: 0o700 }
    );
    chmodSync(executable, 0o700);
    return { root, executable, mutationOwnerPath };
}

function reviewResolutionLockRef(number: number): string {
    return `refs/sourdaw/review-resolution/pr-${number}`;
}

function gitCapture(repository: string, args: string[], input?: string): string {
    const result = spawnSync('git', args, {
        cwd: repository,
        encoding: 'utf8',
        shell: false,
        ...(input === undefined ? {} : { input }),
    });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
    }
    return result.stdout.trim();
}

function readLockOid(repository: string, number: number): string | undefined {
    const result = spawnSync('git', ['rev-parse', '--verify', '--quiet', reviewResolutionLockRef(number)], {
        cwd: repository,
        encoding: 'utf8',
        shell: false,
    });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status === 1) {
        return undefined;
    }
    if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout || 'git show-ref failed');
    }
    return result.stdout.trim();
}

function readLockOwner(repository: string, number: number): TestLockOwnerRecord | undefined {
    const oid = readLockOid(repository, number);
    if (oid === undefined) {
        return undefined;
    }
    return JSON.parse(gitCapture(repository, ['cat-file', 'blob', oid])) as TestLockOwnerRecord;
}

function requireLockOwner(repository: string, number: number): ReviewResolutionLockOwner {
    const owner = readLockOwner(repository, number);
    if (owner === undefined) {
        throw new Error(`review-resolution lock owner for PR #${number} is unreadable`);
    }
    return owner as ReviewResolutionLockOwner;
}

function writeLegacyLockOwnerBlob(
    repository: string,
    version: 2 | 3,
    pid: number,
    pgid: number,
    currentHead: string = head,
    mutation?: {
        phase: string;
        epoch: number;
        reviewId?: string;
        replyId?: string;
        body?: string;
        pendingReviewIds?: readonly string[];
        settleAtMs?: number;
        replies?: readonly { replyId: string; reviewId: string; reviewState: 'PENDING' | 'COMMENTED' }[];
        allowedAttachedThreadIds?: readonly string[];
        snapshotHead?: string;
        dispatchState?: string;
    }
): string {
    return gitCapture(
        repository,
        ['hash-object', '-w', '--stdin'],
        JSON.stringify({
            version,
            pid,
            pgid,
            threadId,
            head: currentHead,
            token: '11111111-1111-4111-8111-111111111111',
            ...(version === 3 && mutation !== undefined ? { mutation } : {}),
        })
    );
}

function writeLockOwnerBlob(
    repository: string,
    pid: number,
    currentHead: string = head,
    mutation: {
        phase: string;
        epoch: number;
        reviewId?: string;
        replyId?: string;
        body?: string;
        pendingReviewIds?: readonly string[];
        settleAtMs?: number;
        replies?: readonly { replyId: string; reviewId: string; reviewState: 'PENDING' | 'COMMENTED' }[];
        allowedAttachedThreadIds?: readonly string[];
        snapshotHead?: string;
        dispatchState?: string;
    } = {
        phase: 'idle',
        epoch: 0,
    },
    ownerFence: ReviewResolutionLockOwnerFence = {
        kind: 'pgid',
        pgid: pid,
    }
): string {
    return gitCapture(
        repository,
        ['hash-object', '-w', '--stdin'],
        JSON.stringify({
            version: 4,
            pid,
            ownerFence,
            threadId,
            head: currentHead,
            token: '11111111-1111-4111-8111-111111111111',
            mutation,
        })
    );
}

function updateLock(repository: string, number: number, nextOid: string, previousOid?: string): void {
    const args =
        previousOid === undefined
            ? [reviewResolutionLockRef(number), nextOid, '0'.repeat(nextOid.length)]
            : [reviewResolutionLockRef(number), nextOid, previousOid];
    gitCapture(repository, ['update-ref', ...args]);
}

function tryUpdateLockRef(repository: string, args: string[]): boolean {
    const result = spawnSync('git', ['update-ref', ...args], {
        cwd: repository,
        encoding: 'utf8',
        shell: false,
    });
    if (result.error !== undefined) {
        throw result.error;
    }
    return result.status === 0;
}

async function waitForExit(child: ReturnType<typeof spawn>): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) {
        return;
    }
    await new Promise<void>((resolve, reject) => {
        child.once('exit', () => resolve());
        child.once('error', reject);
    });
}

async function readFirstStdoutLine(child: ReturnType<typeof spawn>): Promise<string> {
    return await new Promise((resolve, reject) => {
        if (child.stdout === null) {
            reject(new Error('child stdout is unavailable'));
            return;
        }
        let buffer = '';
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
            buffer += chunk;
            const newline = buffer.indexOf('\n');
            if (newline === -1) {
                return;
            }
            resolve(buffer.slice(0, newline).trim());
        });
        child.once('error', reject);
        child.once('exit', () => reject(new Error('child exited before reporting state')));
    });
}

async function waitForProcessGroupGone(pgid: number): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        try {
            process.kill(-pgid, 0);
        } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
                return;
            }
            throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`process group ${pgid} did not exit`);
}

async function waitForProcessGone(pid: number): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        try {
            process.kill(pid, 0);
        } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
                return;
            }
            throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`process ${pid} did not exit`);
}

function readProcessGroupId(pid: number): number {
    const result = spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], {
        encoding: 'utf8',
        shell: false,
    });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`could not read process group for pid ${pid}`);
    }
    const pgid = Number(result.stdout.trim());
    if (!Number.isSafeInteger(pgid) || pgid <= 0) {
        throw new Error(`invalid process group for pid ${pid}: ${JSON.stringify(result.stdout.trim())}`);
    }
    return pgid;
}

async function waitForReviewResolutionLock(
    repository: string,
    number: number
): Promise<{ oid: string; owner: TestLockOwnerRecord }> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        const oid = readLockOid(repository, number);
        if (oid !== undefined) {
            return {
                oid,
                owner: JSON.parse(gitCapture(repository, ['cat-file', 'blob', oid])) as TestLockOwnerRecord,
            };
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`review-resolution lock for PR #${number} did not appear`);
}

async function waitForReviewResolutionLockOwnerPidChange(
    repository: string,
    number: number,
    originalPid: number
): Promise<{ oid: string; owner: TestLockOwnerRecord }> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        const oid = readLockOid(repository, number);
        if (oid !== undefined) {
            const owner = JSON.parse(gitCapture(repository, ['cat-file', 'blob', oid])) as TestLockOwnerRecord;
            if (owner.pid !== originalPid) {
                return { oid, owner };
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`review-resolution lock owner for PR #${number} did not change pid`);
}

async function waitForProcessExitWithoutReviewResolutionLock(
    child: ReturnType<typeof spawn>,
    repository: string,
    number: number
): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        if (readLockOid(repository, number) !== undefined) {
            throw new Error(`unexpected review-resolution lock for PR #${number}`);
        }
        if (child.exitCode !== null || child.signalCode !== null) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`process did not exit before creating a review-resolution lock for PR #${number}`);
}

async function waitForFile(path: string): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        try {
            if (statSync(path).isFile()) {
                return;
            }
        } catch {
            // Wait for the file to appear.
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`timed out waiting for file ${path}`);
}

function writeResolveReviewSnapshot(snapshotRoot: string): string {
    const scriptsRoot = join(snapshotRoot, 'scripts');
    mkdirSync(scriptsRoot, { recursive: true });
    writeFileSync(
        join(scriptsRoot, 'resolveReviewThread.ts'),
        readFileSync(join(import.meta.dirname, '../resolveReviewThread.ts'))
    );
    writeFileSync(join(scriptsRoot, 'prContract.ts'), readFileSync(join(import.meta.dirname, '../prContract.ts')));
    writeFileSync(
        join(scriptsRoot, 'githubAppIdentity.ts'),
        [
            'const sleeper = new Int32Array(new SharedArrayBuffer(4));',
            "import { spawnSync } from 'node:child_process';",
            `export const AUTHOR_BOT_NODE_ID = ${JSON.stringify(AUTHOR_BOT_NODE_ID)};`,
            `export const REVIEWER_BOT_NODE_ID = ${JSON.stringify(REVIEWER_BOT_NODE_ID)};`,
            `export const REQUIRED_REPOSITORY = ${JSON.stringify(REQUIRED_REPOSITORY)};`,
            'export function assertRequiredRepository(repository) {',
            '  if (repository !== REQUIRED_REPOSITORY) throw new Error(`unexpected repository ${repository}`);',
            '}',
            'export function assertTrustedExecutingBlob() {}',
            'export async function authenticateRole() {',
            '  return { minted: { actorNodeId: AUTHOR_BOT_NODE_ID }, session: { env: {}, dispose() {} } };',
            '}',
            'export function isAuthorBotNodeId(value) { return value === AUTHOR_BOT_NODE_ID; }',
            'export function isReviewerBotNodeId(value) { return value === REVIEWER_BOT_NODE_ID; }',
            "export function originMainBlob() { return 'trusted'; }",
            'export function parseGraphqlResponse(output) { return JSON.parse(output); }',
            'export function resolvePrimaryRoot() {',
            '  const root = process.env.SOURDAW_TEST_PRIMARY_ROOT;',
            "  if (typeof root !== 'string' || root.trim() === '') throw new Error('missing test primary root');",
            '  return root;',
            '}',
            'export function spawnCapture(command, args, options = {}) {',
            "  if (command !== 'gh') throw new Error(`unexpected command ${command}`);",
            "  if (args[0] === 'repo' && args[1] === 'view') return REQUIRED_REPOSITORY;",
            '  const executable = process.env.SOURDAW_TEST_TRUSTED_GH_PATH;',
            "  if (typeof executable === 'string' && executable.trim() !== '') {",
            '    const result = spawnSync(executable, args, {',
            '      cwd: options.cwd,',
            '      env: options.env ?? process.env,',
            "      encoding: 'utf8',",
            '      shell: false,',
            '    });',
            '    if (result.error !== undefined) throw result.error;',
            '    if (result.status !== 0) throw new Error(result.stderr || result.stdout || `gh failed with exit ${result.status ?? "signal"}`);',
            '    return result.stdout.trim();',
            '  }',
            "  if (args[0] === 'api' && args[1] === 'graphql') {",
            '    for (;;) Atomics.wait(sleeper, 0, 0, 1000);',
            '  }',
            '  throw new Error(`unexpected gh args ${JSON.stringify(args)}`);',
            '}',
        ].join('\n')
    );
    const entryPath = join(snapshotRoot, 'resolve-review-entry.mjs');
    writeFileSync(
        entryPath,
        [
            "import { runResolveReviewThreadCli, assertTrustedReviewResolutionLauncher } from './scripts/resolveReviewThread.ts';",
            'const primaryRoot = process.env.SOURDAW_TEST_PRIMARY_ROOT;',
            "if (typeof primaryRoot !== 'string' || primaryRoot.trim() === '') throw new Error('missing test primary root');",
            'const trustedLauncher = assertTrustedReviewResolutionLauncher({',
            '  primaryRoot,',
            `  gitPath: process.env.SOURDAW_TEST_TRUSTED_GIT_PATH ?? ${JSON.stringify(trustedGitPath)},`,
            `  ghPath: process.env.SOURDAW_TEST_TRUSTED_GH_PATH ?? ${JSON.stringify(trustedGhPath)},`,
            `  psPath: process.env.SOURDAW_TEST_TRUSTED_PS_PATH ?? ${JSON.stringify(trustedPsPath)},`,
            '});',
            'const exitCode = await runResolveReviewThreadCli(process.argv.slice(2), { trustedLauncher });',
            'process.exitCode = exitCode;',
        ].join('\n'),
        { encoding: 'utf8', mode: 0o600 }
    );
    return entryPath;
}

function writePinnedOriginResolveReviewSnapshot(
    snapshotRoot: string,
    recordedRevisionPath: string,
    releasePath: string
): string {
    const entryPath = writeResolveReviewSnapshot(snapshotRoot);
    writeFileSync(
        join(snapshotRoot, 'scripts', 'githubAppIdentity.ts'),
        [
            'const sleeper = new Int32Array(new SharedArrayBuffer(4));',
            "import { readFileSync, existsSync, writeFileSync } from 'node:fs';",
            "import { spawnSync } from 'node:child_process';",
            "import { fileURLToPath } from 'node:url';",
            `const recordedRevisionPath = ${JSON.stringify(recordedRevisionPath)};`,
            `const releasePath = ${JSON.stringify(releasePath)};`,
            `export const AUTHOR_BOT_NODE_ID = ${JSON.stringify(AUTHOR_BOT_NODE_ID)};`,
            `export const REVIEWER_BOT_NODE_ID = ${JSON.stringify(REVIEWER_BOT_NODE_ID)};`,
            `export const REQUIRED_REPOSITORY = ${JSON.stringify(REQUIRED_REPOSITORY)};`,
            'export function assertRequiredRepository(repository) {',
            '  if (repository !== REQUIRED_REPOSITORY) throw new Error(`unexpected repository ${repository}`);',
            '}',
            'export function assertTrustedExecutingBlob(repoRelativePath, executingFile, originBlob, executingSource = readFileSync(executingFile, "utf8")) {',
            '  if (originBlob === undefined) return;',
            '  if (originBlob !== executingSource) {',
            '    throw new Error(`${repoRelativePath} does not match origin/main; refusing to run a mutated copy`);',
            '  }',
            '}',
            'export async function authenticateRole() {',
            "  throw new Error('stop after trusted blob check');",
            '}',
            'export function isAuthorBotNodeId(value) { return value === AUTHOR_BOT_NODE_ID; }',
            'export function isReviewerBotNodeId(value) { return value === REVIEWER_BOT_NODE_ID; }',
            'export function originMainBlob(_repoRelativePath, cwd = process.cwd(), env, gitCommand = process.env.SOURDAW_TEST_TRUSTED_GIT_PATH ?? "git", revision = "origin/main") {',
            '  writeFileSync(recordedRevisionPath, revision, "utf8");',
            '  while (!existsSync(releasePath)) Atomics.wait(sleeper, 0, 0, 20);',
            '  const pinned = process.env.SOURDAW_TRUSTED_ORIGIN_COMMIT;',
            "  if (typeof pinned !== 'string' || pinned.trim() === '') throw new Error('missing pinned origin commit');",
            '  if (revision === pinned) {',
            '    return readFileSync(fileURLToPath(new URL("./resolveReviewThread.ts", import.meta.url)), "utf8");',
            '  }',
            '  const result = spawnSync(gitCommand, ["rev-parse", "--verify", "refs/remotes/origin/main^{commit}"], {',
            '    cwd,',
            '    env,',
            '    encoding: "utf8",',
            '    shell: false,',
            '  });',
            '  if (result.error !== undefined) throw result.error;',
            "  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'origin/main lookup failed');",
            '  return result.stdout.trim() === pinned',
            '    ? readFileSync(fileURLToPath(new URL("./resolveReviewThread.ts", import.meta.url)), "utf8")',
            '    : "mutated";',
            '}',
            'export function parseGraphqlResponse(output) { return JSON.parse(output); }',
            'export function resolvePrimaryRoot() {',
            '  const root = process.env.SOURDAW_TEST_PRIMARY_ROOT;',
            "  if (typeof root !== 'string' || root.trim() === '') throw new Error('missing test primary root');",
            '  return root;',
            '}',
            'export function spawnCapture() { throw new Error("unexpected spawnCapture"); }',
        ].join('\n')
    );
    return entryPath;
}

function writePinnedOriginRecoverReviewSnapshot(
    snapshotRoot: string,
    recordedRevisionPath: string,
    releasePath: string
): string {
    const entryPath = writeRecoverReviewResolutionSnapshot(snapshotRoot);
    writeFileSync(
        join(snapshotRoot, 'scripts', 'githubAppIdentity.ts'),
        [
            'const sleeper = new Int32Array(new SharedArrayBuffer(4));',
            "import { readFileSync, existsSync, writeFileSync } from 'node:fs';",
            "import { spawnSync } from 'node:child_process';",
            "import { fileURLToPath } from 'node:url';",
            `const recordedRevisionPath = ${JSON.stringify(recordedRevisionPath)};`,
            `const releasePath = ${JSON.stringify(releasePath)};`,
            `export const AUTHOR_BOT_NODE_ID = ${JSON.stringify(AUTHOR_BOT_NODE_ID)};`,
            `export const REVIEWER_BOT_NODE_ID = ${JSON.stringify(REVIEWER_BOT_NODE_ID)};`,
            `export const REQUIRED_REPOSITORY = ${JSON.stringify(REQUIRED_REPOSITORY)};`,
            'export function assertRequiredRepository(repository) {',
            '  if (repository !== REQUIRED_REPOSITORY) throw new Error(`unexpected repository ${repository}`);',
            '}',
            'export function assertTrustedExecutingBlob(repoRelativePath, executingFile, originBlob, executingSource = readFileSync(executingFile, "utf8")) {',
            '  if (originBlob === undefined) return;',
            '  if (originBlob !== executingSource) {',
            '    throw new Error(`${repoRelativePath} does not match origin/main; refusing to run a mutated copy`);',
            '  }',
            '}',
            'export async function authenticateRole() {',
            "  throw new Error('stop after trusted blob check');",
            '}',
            'export function isAuthorBotNodeId(value) { return value === AUTHOR_BOT_NODE_ID; }',
            'export function isReviewerBotNodeId(value) { return value === REVIEWER_BOT_NODE_ID; }',
            'export function originMainBlob(_repoRelativePath, cwd = process.cwd(), env, gitCommand = process.env.SOURDAW_TEST_TRUSTED_GIT_PATH ?? "git", revision = "origin/main") {',
            '  writeFileSync(recordedRevisionPath, revision, "utf8");',
            '  while (!existsSync(releasePath)) Atomics.wait(sleeper, 0, 0, 20);',
            '  const pinned = process.env.SOURDAW_TRUSTED_ORIGIN_COMMIT;',
            "  if (typeof pinned !== 'string' || pinned.trim() === '') throw new Error('missing pinned origin commit');",
            '  if (revision === pinned) {',
            '    return readFileSync(fileURLToPath(new URL("./recoverReviewResolutionLock.ts", import.meta.url)), "utf8");',
            '  }',
            '  const result = spawnSync(gitCommand, ["rev-parse", "--verify", "refs/remotes/origin/main^{commit}"], {',
            '    cwd,',
            '    env,',
            '    encoding: "utf8",',
            '    shell: false,',
            '  });',
            '  if (result.error !== undefined) throw result.error;',
            "  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'origin/main lookup failed');",
            '  return result.stdout.trim() === pinned',
            '    ? readFileSync(fileURLToPath(new URL("./recoverReviewResolutionLock.ts", import.meta.url)), "utf8")',
            '    : "mutated";',
            '}',
            'export function parseGraphqlResponse(output) { return JSON.parse(output); }',
            'export function resolvePrimaryRoot() {',
            '  const root = process.env.SOURDAW_TEST_PRIMARY_ROOT;',
            "  if (typeof root !== 'string' || root.trim() === '') throw new Error('missing test primary root');",
            '  return root;',
            '}',
            'export function spawnCapture() { throw new Error("unexpected spawnCapture"); }',
        ].join('\n')
    );
    return entryPath;
}

function writeRecoverReviewResolutionSnapshot(snapshotRoot: string): string {
    const scriptsRoot = join(snapshotRoot, 'scripts');
    mkdirSync(scriptsRoot, { recursive: true });
    writeFileSync(
        join(scriptsRoot, 'resolveReviewThread.ts'),
        readFileSync(join(import.meta.dirname, '../resolveReviewThread.ts'))
    );
    writeFileSync(
        join(scriptsRoot, 'recoverReviewResolutionLock.ts'),
        readFileSync(join(import.meta.dirname, '../recoverReviewResolutionLock.ts'))
    );
    writeFileSync(join(scriptsRoot, 'prContract.ts'), readFileSync(join(import.meta.dirname, '../prContract.ts')));
    writeFileSync(
        join(scriptsRoot, 'githubAppIdentity.ts'),
        [
            "import { spawnSync } from 'node:child_process';",
            `export const AUTHOR_BOT_NODE_ID = ${JSON.stringify(AUTHOR_BOT_NODE_ID)};`,
            `export const REVIEWER_BOT_NODE_ID = ${JSON.stringify(REVIEWER_BOT_NODE_ID)};`,
            `export const REQUIRED_REPOSITORY = ${JSON.stringify(REQUIRED_REPOSITORY)};`,
            'export function assertRequiredRepository(repository) {',
            '  if (repository !== REQUIRED_REPOSITORY) throw new Error(`unexpected repository ${repository}`);',
            '}',
            'export function assertTrustedExecutingBlob() {}',
            'export async function authenticateRole() {',
            '  return { minted: { actorNodeId: AUTHOR_BOT_NODE_ID }, session: { env: {}, dispose() {} } };',
            '}',
            'export function isAuthorBotNodeId(value) { return value === AUTHOR_BOT_NODE_ID; }',
            'export function isReviewerBotNodeId(value) { return value === REVIEWER_BOT_NODE_ID; }',
            "export function originMainBlob() { return 'trusted'; }",
            'export function parseGraphqlResponse(output) { return JSON.parse(output); }',
            'export function resolvePrimaryRoot() {',
            '  const root = process.env.SOURDAW_TEST_PRIMARY_ROOT;',
            "  if (typeof root !== 'string' || root.trim() === '') throw new Error('missing test primary root');",
            '  return root;',
            '}',
            'export function spawnCapture(command, args, options = {}) {',
            "  if (command !== 'gh') throw new Error(`unexpected command ${command}`);",
            "  if (args[0] === 'repo' && args[1] === 'view') return REQUIRED_REPOSITORY;",
            '  const executable = process.env.SOURDAW_TEST_TRUSTED_GH_PATH;',
            "  if (typeof executable !== 'string' || executable.trim() === '') throw new Error('missing test gh executable');",
            '  const result = spawnSync(executable, args, {',
            '    cwd: options.cwd,',
            '    env: options.env ?? process.env,',
            "    encoding: 'utf8',",
            '    shell: false,',
            '  });',
            '  if (result.error !== undefined) throw result.error;',
            '  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `gh failed with exit ${result.status ?? "signal"}`);',
            '  return result.stdout.trim();',
            '}',
        ].join('\n')
    );
    const entryPath = join(snapshotRoot, 'recover-review-entry.mjs');
    writeFileSync(
        entryPath,
        [
            "import { runRecoverReviewResolutionLockCli } from './scripts/recoverReviewResolutionLock.ts';",
            "import { assertTrustedReviewResolutionLauncher } from './scripts/resolveReviewThread.ts';",
            'const primaryRoot = process.env.SOURDAW_TEST_PRIMARY_ROOT;',
            "if (typeof primaryRoot !== 'string' || primaryRoot.trim() === '') throw new Error('missing test primary root');",
            'const trustedLauncher = assertTrustedReviewResolutionLauncher({',
            '  primaryRoot,',
            `  gitPath: process.env.SOURDAW_TEST_TRUSTED_GIT_PATH ?? ${JSON.stringify(trustedGitPath)},`,
            `  ghPath: process.env.SOURDAW_TEST_TRUSTED_GH_PATH ?? ${JSON.stringify(trustedGhPath)},`,
            `  psPath: process.env.SOURDAW_TEST_TRUSTED_PS_PATH ?? ${JSON.stringify(trustedPsPath)},`,
            '});',
            'const lingerMs = Number(process.env.SOURDAW_TEST_LINGER_AFTER_COMMAND_MS ?? "0");',
            'let exitCode;',
            'try {',
            '  exitCode = await runRecoverReviewResolutionLockCli(process.argv.slice(2), { trustedLauncher });',
            '} finally {',
            '  if (Number.isSafeInteger(lingerMs) && lingerMs > 0) {',
            '    await new Promise((resolve) => setTimeout(resolve, lingerMs));',
            '  }',
            '}',
            'process.exitCode = exitCode;',
        ].join('\n'),
        { encoding: 'utf8', mode: 0o600 }
    );
    return entryPath;
}

describe('review thread resolution', () => {
    it('serializes one review-resolution mutation per PR, refuses same-PR different-thread contenders, and releases after failure', () => {
        const repository = createTemporaryGitRepository();
        try {
            expect(() =>
                withPullRequestReviewResolutionLock(repository, 42, threadId, head, () => {
                    expect(() =>
                        resolveReviewThread(42, `${threadId}_other`, head, AUTHOR_BOT_NODE_ID, {
                            ...fakePort().port,
                            serializeReviewThreadMutation: (number, currentThreadId, expectedHead, operation) =>
                                withPullRequestReviewResolutionLock(
                                    repository,
                                    number,
                                    currentThreadId,
                                    expectedHead,
                                    operation
                                ),
                        })
                    ).toThrow(/already being resolved by process group/i);
                    expect(withPullRequestReviewResolutionLock(repository, 43, threadId, head, () => 'other-pr')).toBe(
                        'other-pr'
                    );
                    throw new Error('boom');
                })
            ).toThrow(/boom/);
            expect(withPullRequestReviewResolutionLock(repository, 42, threadId, head, () => 'ok')).toBe('ok');
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('reads the current process group through the launcher-bound ps executable instead of PATH', () => {
        const repository = createTemporaryGitRepository();
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-review-resolve-ps-path-'));
        const trustedBin = join(root, 'trusted-bin');
        const hostileBin = join(root, 'hostile-bin');
        const trustedPs = join(trustedBin, 'ps');
        const trustedMarker = join(root, 'trusted-ps-entered');
        const hostileMarker = join(root, 'hostile-ps-entered');
        const previousPath = process.env.PATH;
        try {
            mkdirSync(trustedBin, { recursive: true });
            mkdirSync(hostileBin, { recursive: true });
            writeFileSync(
                trustedPs,
                `#!/bin/sh\nprintf trusted > ${JSON.stringify(trustedMarker)}\nexec ${JSON.stringify(trustedPsPath)} "$@"\n`
            );
            chmodSync(trustedPs, 0o700);
            writeFileSync(
                join(hostileBin, 'ps'),
                `#!/bin/sh\nprintf hostile > ${JSON.stringify(hostileMarker)}\nexit 91\n`
            );
            chmodSync(join(hostileBin, 'ps'), 0o700);

            withTemporaryEnvironment(
                {
                    PATH: `${hostileBin}${delimiter}${previousPath ?? ''}`,
                    SOURDAW_TRUSTED_PS_PATH: trustedPs,
                },
                () => {
                    expect(withPullRequestReviewResolutionLock(repository, 42, threadId, head, () => 'ok')).toBe('ok');
                }
            );

            expect(readFileSync(trustedMarker, 'utf8')).toBe('trusted');
            expect(existsSync(hostileMarker)).toBe(false);
        } finally {
            process.env.PATH = previousPath;
            rmSync(root, { recursive: true, force: true });
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it.each([
        ['relative', 'ps', /trusted ps executable path is not absolute/i],
        [
            'non-normalized',
            `${dirname(trustedPsPath)}/../${basename(dirname(trustedPsPath))}/${basename(trustedPsPath)}`,
            /trusted ps executable path is not normalized/i,
        ],
    ])('fails closed on a %s trusted ps path for review-resolution lock operations', (_label, psPath, error) => {
        const repository = createTemporaryGitRepository();
        try {
            withTemporaryEnvironment({ SOURDAW_TRUSTED_PS_PATH: psPath }, () => {
                expect(() => withPullRequestReviewResolutionLock(repository, 42, threadId, head, () => 'ok')).toThrow(
                    error
                );
                const ownerOid = writeLockOwnerBlob(repository, 999999);
                updateLock(repository, 42, ownerOid);
                expect(() =>
                    recoverPullRequestReviewResolutionLock(
                        repository,
                        42,
                        ownerOid,
                        () => ({
                            pullRequestId,
                            head,
                            thread: {
                                id: threadId,
                                isResolved: false,
                                resolvedByNodeId: null,
                                resolvedByLogin: null,
                                resolvedByType: null,
                                rootCommentId: null,
                                rootCommentFullDatabaseId: null,
                                rootAuthorNodeId: null,
                                rootAuthorLogin: null,
                                rootAuthorType: null,
                                comments: [],
                            },
                            pendingReviews: [],
                        }),
                        () => false
                    )
                ).toThrow(error);
            });
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('uses exact PID fencing for Windows lock ownership without requiring a trusted ps path', () => {
        const repository = createTemporaryGitRepository();
        try {
            withTemporaryEnvironment({ SOURDAW_TRUSTED_PS_PATH: undefined }, () => {
                expect(
                    withPullRequestReviewResolutionLock(
                        repository,
                        42,
                        threadId,
                        head,
                        () => {
                            expect(requireLockOwner(repository, 42)).toMatchObject({
                                pid: process.pid,
                                ownerFence: { kind: 'pid', pid: process.pid },
                                threadId,
                                head,
                                mutation: { phase: 'idle', epoch: 0 },
                            });
                            return 'ok';
                        },
                        { platform: 'win32' }
                    )
                ).toBe('ok');
            });
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it.each([
        ['ESRCH', false],
        ['EPERM', true],
    ] as const)('treats injected Windows PID liveness %s as %s', (code, expected) => {
        const error = new Error(code) as NodeJS.ErrnoException;
        error.code = code;
        expect(
            reviewResolutionOwnerFenceIsLive(
                {
                    kind: 'pid',
                    pid: 1234,
                },
                () => {
                    throw error;
                }
            )
        ).toBe(expected);
    });

    it('propagates unexpected injected Windows PID liveness failures', () => {
        const failure = new Error('probe exploded');
        expect(() =>
            reviewResolutionOwnerFenceIsLive(
                {
                    kind: 'pid',
                    pid: 1234,
                },
                () => {
                    throw failure;
                }
            )
        ).toThrow(failure);
    });

    it.each([
        ['create', 'createPendingReview', { phase: 'createPendingReview', epoch: 1 }],
        [
            'submit',
            'submitReview',
            {
                phase: 'submitReview',
                epoch: 1,
                reviewId,
                body: resolutionReviewSummary(pullRequestId, threadId, head),
            },
        ],
        ['resolve', 'resolveThread', { phase: 'resolveThread', epoch: 1 }],
    ] as const)(
        'preserves the exact PR lock owner after an ambiguous %s transport failure',
        (_label, failingMutation, mutation) => {
            const repository = createTemporaryGitRepository();
            const fakeGh = createFailingReviewResolutionMutationGhExecutable(failingMutation);
            try {
                const session: GhSession = {
                    configDir: repository,
                    env: { SOURDAW_TRUSTED_GH_PATH: fakeGh.executable },
                    dispose() {},
                };
                const port = shellPort(session, repository);
                expect(() =>
                    withPullRequestReviewResolutionLock(repository, 42, threadId, head, () => {
                        if (failingMutation === 'createPendingReview') {
                            port.createPendingReview(
                                pullRequestId,
                                head,
                                resolutionReviewSummary(pullRequestId, threadId, head)
                            );
                            return;
                        }
                        if (failingMutation === 'submitReview') {
                            port.submitReview(reviewId, resolutionReviewSummary(pullRequestId, threadId, head));
                            return;
                        }
                        port.resolve(threadId);
                    })
                ).toThrow(new RegExp(`recover with pnpm review:resolve:recover 42 --owner [0-9a-f]{40}`));
                expect(statSync(fakeGh.calledPath).isFile()).toBe(true);
                const owner = readLockOwner(repository, 42);
                expect(owner).toMatchObject({
                    threadId,
                    head,
                    mutation: { phase: mutation.phase },
                });
            } finally {
                rmSync(fakeGh.root, { recursive: true, force: true });
                rmSync(repository, { recursive: true, force: true });
            }
        }
    );

    it('claims the exact dead PR lock owner before reconciliation so concurrent recovery sees a live holder', () => {
        const repository = createTemporaryGitRepository();
        const currentPgid = readProcessGroupId(process.pid);
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'createPendingReview',
                epoch: 1,
            });
            updateLock(repository, 42, ownerOid);
            expect(
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    ownerOid,
                    (owner) => {
                        expect(owner).toMatchObject({
                            threadId,
                            head,
                            pid: process.pid,
                            ownerFence: { kind: 'pgid', pgid: currentPgid },
                            mutation: { phase: 'createPendingReview', epoch: 1 },
                        });
                        const claimedOwnerOid = readLockOid(repository, 42);
                        expect(claimedOwnerOid).toBeDefined();
                        expect(claimedOwnerOid).not.toBe(ownerOid);
                        expect(() =>
                            recoverPullRequestReviewResolutionLock(
                                repository,
                                42,
                                claimedOwnerOid!,
                                () => 'nested recovery must not start',
                                (ownerFence) => ownerFence.kind === 'pgid' && ownerFence.pgid === currentPgid
                            )
                        ).toThrow(
                            `review resolution on PR #42 lock is still held by live process group ${currentPgid}`
                        );
                        return 'outer recovery claimed the lock';
                    },
                    (ownerFence) => ownerFence.kind === 'pgid' && ownerFence.pgid === currentPgid
                )
            ).toBe('outer recovery claimed the lock');
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('preserves an absent create-pending-review recovery phase without replaying, then resolves once the original draft appears', () => {
        const repository = createTemporaryGitRepository();
        const { port, calls, state } = fakePort();
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'createPendingReview',
                epoch: 1,
            });
            updateLock(repository, 42, ownerOid);
            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                    recoverReviewResolutionLockOwnerState(42, owner, port)
                )
            ).toThrow(/unreconciled in-flight createPendingReview/i);
            expect(calls).toEqual(['inspect:1']);
            expect(state().reviews).toEqual([]);
            const preservedOwnerOid = readLockOid(repository, 42);
            expect(preservedOwnerOid).toBeDefined();
            expect(preservedOwnerOid).not.toBe(ownerOid);
            expect(requireLockOwner(repository, 42)).toMatchObject({
                threadId,
                head,
                mutation: { phase: 'createPendingReview', epoch: 1 },
            });

            state().reviews.push({
                id: reviewId,
                state: 'PENDING',
                body: resolutionReviewSummary(pullRequestId, threadId, head),
                commitOid: head,
                authorNodeId: AUTHOR_BOT_NODE_ID,
                authorLogin: 'renamed-author[bot]',
                authorType: 'Bot',
            });

            const inspection = recoverPullRequestReviewResolutionLock(
                repository,
                42,
                preservedOwnerOid!,
                (owner) => recoverReviewResolutionLockOwnerState(42, owner, port),
                () => false
            );
            expect(calls.filter((call) => call.startsWith('createReview:'))).toEqual([]);
            expect(calls.filter((call) => call.startsWith('reply:'))).toEqual([`reply:${threadId}:${reviewId}`]);
            expect(calls.filter((call) => call.startsWith('submitReview:'))).toEqual([`submitReview:${reviewId}`]);
            expect(calls.filter((call) => call.startsWith('resolve:'))).toEqual([`resolve:${threadId}`]);
            expect(state().comments.filter((comment) => comment.body === 'Done')).toHaveLength(1);
            expect(inspection.thread).toMatchObject({
                id: threadId,
                isResolved: true,
                resolvedByNodeId: AUTHOR_BOT_NODE_ID,
                resolvedByType: 'User',
            });
            expectCanonicalResolutionReview(state().reviews[0]!);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('preserves an absent create-pending-review recovery when only a stale commented Done marker is visible', () => {
        const repository = createTemporaryGitRepository();
        const { port, calls } = fakePort({
            existingReplyCount: 1,
            existingReplyReviewCommitOid: movedHead,
            existingReplyReviewBody: pendingReviewBody(movedHead),
        });
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'createPendingReview',
                epoch: 1,
            });
            updateLock(repository, 42, ownerOid);
            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                    recoverReviewResolutionLockOwnerState(42, owner, port)
                )
            ).toThrow(/unreconciled in-flight createPendingReview/i);
            expect(calls).toEqual(['inspect:1']);
            const preservedOwnerOid = readLockOid(repository, 42);
            expect(preservedOwnerOid).toBeDefined();
            expect(preservedOwnerOid).not.toBe(ownerOid);
            expect(requireLockOwner(repository, 42)).toMatchObject({
                threadId,
                head,
                mutation: { phase: 'createPendingReview', epoch: 1 },
            });
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('preserves an absent reply recovery phase without replaying, then resolves once the original Done marker appears', () => {
        const repository = createTemporaryGitRepository();
        const { port, calls, state, injectManagedPendingReply } = fakePort({ existingPendingReviewCount: 1 });
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'replyDone',
                epoch: 1,
                reviewId,
            });
            updateLock(repository, 42, ownerOid);
            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                    recoverReviewResolutionLockOwnerState(42, owner, port)
                )
            ).toThrow(/unreconciled in-flight replyDone/i);
            expect(calls).toEqual(['inspect:1']);
            expect(state().comments.filter((comment) => comment.body === 'Done')).toHaveLength(0);
            const preservedOwnerOid = readLockOid(repository, 42);
            expect(preservedOwnerOid).toBeDefined();
            expect(preservedOwnerOid).not.toBe(ownerOid);
            expect(requireLockOwner(repository, 42)).toMatchObject({
                threadId,
                head,
                mutation: { phase: 'replyDone', epoch: 1, reviewId },
            });

            injectManagedPendingReply();

            const inspection = recoverPullRequestReviewResolutionLock(
                repository,
                42,
                preservedOwnerOid!,
                (owner) => recoverReviewResolutionLockOwnerState(42, owner, port),
                () => false
            );
            expect(calls.filter((call) => call.startsWith('reply:'))).toEqual([]);
            expect(calls.filter((call) => call.startsWith('submitReview:'))).toEqual([`submitReview:${reviewId}`]);
            expect(calls.filter((call) => call.startsWith('resolve:'))).toEqual([`resolve:${threadId}`]);
            expect(inspection.thread?.comments.filter((comment) => comment.body === 'Done')).toHaveLength(1);
            expect(inspection.thread).toMatchObject({
                id: threadId,
                isResolved: true,
                resolvedByNodeId: AUTHOR_BOT_NODE_ID,
                resolvedByType: 'User',
            });
            expectCanonicalResolutionReview(state().reviews[0]!);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('releases the stale-head create-pending-review recovery once one exact H1 draft is provably landed, then admits a fresh H2 acquisition', () => {
        const repository = createTemporaryGitRepository();
        const { port, calls, state } = fakePort({
            heads: [movedHead],
            existingPendingReviewCount: 1,
            existingPendingReviewCommitOid: head,
        });
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'createPendingReview',
                epoch: 1,
            });
            updateLock(repository, 42, ownerOid);
            const inspection = recoverPullRequestReviewResolutionLock(
                repository,
                42,
                ownerOid,
                (owner) => recoverReviewResolutionLockOwnerState(42, owner, port),
                () => false
            );
            expect(calls).toEqual(['inspect:1']);
            expect(inspection.head).toBe(movedHead);
            expect(inspection.pendingReviews).toEqual([
                expect.objectContaining({
                    id: reviewId,
                    state: 'PENDING',
                    body: resolutionReviewSummary(pullRequestId, threadId, head),
                    commitOid: head,
                }),
            ]);
            expect(state().comments.filter((comment) => comment.body === 'Done')).toHaveLength(0);
            expect(readLockOid(repository, 42)).toBeUndefined();
            expect(withPullRequestReviewResolutionLock(repository, 42, threadId, movedHead, () => 'fresh-h2')).toBe(
                'fresh-h2'
            );
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('fails closed on stale-head create-pending-review recovery when more than one exact H1 draft exists', () => {
        const repository = createTemporaryGitRepository();
        const { port, calls } = fakePort({
            heads: [movedHead],
            existingPendingReviewCount: 2,
            existingPendingReviewCommitOid: head,
        });
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'createPendingReview',
                epoch: 1,
            });
            updateLock(repository, 42, ownerOid);
            expect(() =>
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    ownerOid,
                    (owner) => recoverReviewResolutionLockOwnerState(42, owner, port),
                    () => false
                )
            ).toThrow(/could not prove exact landed createPendingReview/i);
            expect(calls).toEqual(['inspect:1']);
            const preservedOwnerOid = readLockOid(repository, 42);
            expect(preservedOwnerOid).toBeDefined();
            expect(preservedOwnerOid).not.toBe(ownerOid);
            expect(requireLockOwner(repository, 42)).toMatchObject({
                threadId,
                head,
                mutation: { phase: 'createPendingReview', epoch: 1 },
            });
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('releases the stale-head reply recovery once one exact H1 Done marker is provably landed, then admits a fresh H2 acquisition', () => {
        const repository = createTemporaryGitRepository();
        const { port, calls } = fakePort({
            heads: [movedHead],
            existingReplyCount: 1,
            existingReplyReviewState: 'PENDING',
            existingReplyReviewCommitOid: head,
        });
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'replyDone',
                epoch: 1,
                reviewId,
            });
            updateLock(repository, 42, ownerOid);
            const inspection = recoverPullRequestReviewResolutionLock(
                repository,
                42,
                ownerOid,
                (owner) => recoverReviewResolutionLockOwnerState(42, owner, port),
                () => false
            );
            expect(calls).toEqual(['inspect:1']);
            expect(inspection.head).toBe(movedHead);
            expect(inspection.thread?.comments.filter((comment) => comment.body === 'Done')).toHaveLength(1);
            expect(readLockOid(repository, 42)).toBeUndefined();
            expect(withPullRequestReviewResolutionLock(repository, 42, threadId, movedHead, () => 'fresh-h2')).toBe(
                'fresh-h2'
            );
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('fails closed on stale-head reply recovery when more than one exact H1 Done marker matches the same review', () => {
        const repository = createTemporaryGitRepository();
        const { port, calls } = fakePort({
            heads: [movedHead],
            existingReplyCount: 2,
            existingReplyReviewState: 'PENDING',
            existingReplyReviewCommitOid: head,
            secondaryReplyReviewId: reviewId,
            secondaryReplyReviewMissing: true,
        });
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'replyDone',
                epoch: 1,
                reviewId,
            });
            updateLock(repository, 42, ownerOid);
            expect(() =>
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    ownerOid,
                    (owner) => recoverReviewResolutionLockOwnerState(42, owner, port),
                    () => false
                )
            ).toThrow(/could not prove exact landed replyDone/i);
            expect(calls).toEqual(['inspect:1']);
            const preservedOwnerOid = readLockOid(repository, 42);
            expect(preservedOwnerOid).toBeDefined();
            expect(preservedOwnerOid).not.toBe(ownerOid);
            expect(requireLockOwner(repository, 42)).toMatchObject({
                threadId,
                head,
                mutation: { phase: 'replyDone', epoch: 1, reviewId },
            });
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('replays an ambiguous submit-review mutation, deletes duplicate pending Done markers before submit, and converges to one COMMENTED envelope', () => {
        const repository = createTemporaryGitRepository();
        const { port, calls, state } = fakePort({
            existingReplyCount: 1,
            existingReplyReviewState: 'PENDING',
            attachManagedPendingReplyOnFirstInspect: true,
        });
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'submitReview',
                epoch: 1,
                reviewId,
                body: resolutionReviewSummary(pullRequestId, threadId, head),
            });
            updateLock(repository, 42, ownerOid);
            const inspection = recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                recoverReviewResolutionLockOwnerState(42, owner, port)
            );
            expect(calls).toEqual([
                'inspect:1',
                'delete:PRRC_first_pending',
                'inspect:2',
                `submitReview:${reviewId}`,
                'inspect:3',
            ]);
            expect(inspection.thread?.comments.filter((comment) => comment.body === 'Done')).toHaveLength(1);
            expect(inspection.thread?.comments.find((comment) => comment.id === replyId)?.reviewState).toBe(
                'COMMENTED'
            );
            expect(state().comments.filter((comment) => comment.body === 'Done')).toHaveLength(1);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it.each([
        [
            'update review body',
            {
                phase: 'updateReviewBody',
                epoch: 1,
                reviewId,
                body: resolutionReviewSummary(pullRequestId, threadId, head),
            },
            {
                existingPendingReviewCount: 1,
            },
        ],
        [
            'resolve thread',
            { phase: 'resolveThread', epoch: 1 },
            {
                isResolved: true,
                initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
                initialResolvedByType: 'User',
                existingReplyCount: 1,
                existingReplyReviewState: 'COMMENTED',
            },
        ],
        ['delete reply', { phase: 'deleteReply', epoch: 1, replyId }, {}],
        [
            'delete pending review',
            { phase: 'deletePendingReview', epoch: 1, reviewId, allowedAttachedThreadIds: [], snapshotHead: head },
            {},
        ],
    ] as const)('treats an already-settled %s recovery phase as idempotent', (_label, mutation, input) => {
        const repository = createTemporaryGitRepository();
        const { port, calls } = fakePort(input);
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, mutation);
            updateLock(repository, 42, ownerOid);
            recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                recoverReviewResolutionLockOwnerState(42, owner, port)
            );
            expect(calls).toEqual(['inspect:1']);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('replays an absent update-review-body recovery phase and releases after the canonical pending body is restored', () => {
        const repository = createTemporaryGitRepository();
        const { port, calls, state } = fakePort({
            existingPendingReviewCount: 1,
            existingPendingReviewBody: '',
        });
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'updateReviewBody',
                epoch: 1,
                reviewId,
                body: resolutionReviewSummary(pullRequestId, threadId, head),
            });
            updateLock(repository, 42, ownerOid);
            const inspection = recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                recoverReviewResolutionLockOwnerState(42, owner, port)
            );
            expect(calls).toEqual(['inspect:1', `updateReview:${reviewId}`, 'inspect:2']);
            expect(inspection.pendingReviews).toEqual([
                expect.objectContaining({
                    id: reviewId,
                    body: resolutionReviewSummary(pullRequestId, threadId, head),
                }),
            ]);
            expect(state().reviews).toEqual([
                expect.objectContaining({
                    id: reviewId,
                    body: resolutionReviewSummary(pullRequestId, threadId, head),
                }),
            ]);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('replays an absent resolve-thread recovery phase and releases after the thread is resolved', () => {
        const repository = createTemporaryGitRepository();
        const { port, calls, state } = fakePort({
            existingReplyCount: 1,
            existingReplyReviewState: 'COMMENTED',
        });
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'resolveThread',
                epoch: 1,
            });
            updateLock(repository, 42, ownerOid);
            const inspection = recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                recoverReviewResolutionLockOwnerState(42, owner, port)
            );
            expect(calls).toEqual(['inspect:1', `resolve:${threadId}`, 'inspect:2']);
            expect(inspection.thread).toMatchObject({
                id: threadId,
                isResolved: true,
                resolvedByNodeId: AUTHOR_BOT_NODE_ID,
                resolvedByType: 'User',
            });
            expect(state()).toMatchObject({
                resolved: true,
                comments: [{ id: rootId }, { id: replyId, body: 'Done', reviewId }],
            });
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('replays an absent delete-reply recovery phase and releases after the obsolete Done marker is removed', () => {
        const repository = createTemporaryGitRepository();
        const { port, calls, state } = fakePort({
            existingReplyCount: 1,
            existingReplyReviewState: 'COMMENTED',
        });
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'deleteReply',
                epoch: 1,
                replyId,
            });
            updateLock(repository, 42, ownerOid);
            const inspection = recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                recoverReviewResolutionLockOwnerState(42, owner, port)
            );
            expect(calls).toEqual(['inspect:1', `delete:${replyId}`, 'inspect:2']);
            expect(inspection.thread?.comments.map((comment) => comment.id)).toEqual([rootId]);
            expect(state().comments.map((comment) => comment.id)).toEqual([rootId]);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('replays an absent delete-pending-review recovery phase with its persisted attachment allowance and snapshot head', () => {
        const repository = createTemporaryGitRepository();
        const { port, calls, deletePendingReviewCalls, state } = fakePort({
            existingPendingReviewCount: 1,
            attachedReviewThreadIdsByReviewId: { [reviewId]: [threadId] },
        });
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'deletePendingReview',
                epoch: 1,
                reviewId,
                allowedAttachedThreadIds: [threadId],
                snapshotHead: head,
            });
            updateLock(repository, 42, ownerOid);
            const inspection = recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                recoverReviewResolutionLockOwnerState(42, owner, port)
            );
            expect(calls).toEqual([
                'inspect:1',
                `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${head}`,
                `deleteReview:${reviewId}`,
                'inspect:2',
            ]);
            expect(deletePendingReviewCalls).toEqual([
                {
                    reviewId,
                    options: {
                        allowedAttachedThreadIds: [threadId],
                        snapshotHead: head,
                    },
                },
            ]);
            expect(inspection.pendingReviews).toEqual([]);
            expect(state().comments.map((comment) => comment.id)).toEqual([rootId]);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('preserves the recovery owner when delete-pending-review inspection can still read the review as COMMENTED', () => {
        const repository = createTemporaryGitRepository();
        const { port, state } = fakePort({ existingPendingReviewCount: 1 });
        state().reviews[0]!.state = 'COMMENTED';
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'deletePendingReview',
                epoch: 1,
                reviewId,
                allowedAttachedThreadIds: [threadId],
                snapshotHead: head,
            });
            updateLock(repository, 42, ownerOid);
            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                    recoverReviewResolutionLockOwnerState(42, owner, port)
                )
            ).toThrow(
                /unreconciled in-flight deletePendingReview mutation from epoch 1; retry recovery after GitHub state changes/i
            );
            expect(readLockOid(repository, 42)).toBeDefined();
            expect(requireLockOwner(repository, 42)).toMatchObject({
                threadId,
                head,
                mutation: {
                    phase: 'deletePendingReview',
                    epoch: 1,
                    reviewId,
                    allowedAttachedThreadIds: [threadId],
                    snapshotHead: head,
                },
            });
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it.each([
        [
            'update review body',
            {
                phase: 'updateReviewBody',
                epoch: 1,
                reviewId,
                body: resolutionReviewSummary(pullRequestId, threadId, head),
            },
            {
                heads: [movedHead],
                existingPendingReviewCount: 1,
                existingPendingReviewBody: '',
            },
            [`updateReview:${reviewId}`],
        ],
        [
            'resolve thread',
            { phase: 'resolveThread', epoch: 1 },
            {
                heads: [movedHead],
                existingReplyCount: 1,
                existingReplyReviewState: 'COMMENTED',
            },
            [`resolve:${threadId}`],
        ],
        [
            'delete reply',
            { phase: 'deleteReply', epoch: 1, replyId },
            {
                heads: [movedHead],
                existingReplyCount: 1,
                existingReplyReviewState: 'COMMENTED',
            },
            [`delete:${replyId}`],
        ],
        [
            'delete pending review',
            {
                phase: 'deletePendingReview',
                epoch: 1,
                reviewId,
                allowedAttachedThreadIds: [threadId],
                snapshotHead: head,
            },
            {
                heads: [movedHead],
                existingPendingReviewCount: 1,
                existingReplyCount: 1,
                existingReplyReviewState: 'PENDING',
            },
            [`deleteReview:${reviewId}`],
        ],
    ] as const)(
        'preserves the exact owner when %s recovery sees head drift before replay',
        (_label, mutation, input, mutationCalls) => {
            const repository = createTemporaryGitRepository();
            const { port, calls } = fakePort(input);
            const expectedMutationCalls: string[] = [...mutationCalls];
            try {
                const ownerOid = writeLockOwnerBlob(repository, 999999, head, mutation);
                updateLock(repository, 42, ownerOid);
                expect(() =>
                    recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                        recoverReviewResolutionLockOwnerState(42, owner, port)
                    )
                ).toThrow(/head changed while reconciling review resolution/i);
                expect(calls).toEqual(['inspect:1']);
                expect(calls.filter((call) => expectedMutationCalls.includes(call))).toEqual([]);
                const preservedOwnerOid = readLockOid(repository, 42);
                expect(preservedOwnerOid).toBeDefined();
                expect(preservedOwnerOid).not.toBe(ownerOid);
                expect(requireLockOwner(repository, 42)).toMatchObject({ threadId, head, mutation });
            } finally {
                rmSync(repository, { recursive: true, force: true });
            }
        }
    );

    it('preserves the exact PR lock owner when owner OID reread fails after a non-idle mutation throws', () => {
        const repository = createTemporaryGitRepository();
        const fakeGh = createFailingReviewResolutionMutationGhExecutable('replyDone');
        try {
            const session: GhSession = {
                configDir: repository,
                env: { SOURDAW_TRUSTED_GH_PATH: fakeGh.executable },
                dispose() {},
            };
            const port = shellPort(session, repository);
            let readOidAttempts = 0;
            expect(() =>
                withPullRequestReviewResolutionLock(
                    repository,
                    42,
                    threadId,
                    head,
                    () => {
                        port.replyDone(threadId, reviewId);
                    },
                    {
                        readOid: () => {
                            readOidAttempts += 1;
                            if (readOidAttempts === 1) {
                                throw new Error('simulated owner OID reread failure');
                            }
                            return readLockOid(repository, 42);
                        },
                    }
                )
            ).toThrow(
                /ownership could not be re-read after failure: simulated owner OID reread failure; review resolution on PR #42 preserved exact lock owner [0-9a-f]{40} after replyDone epoch 1; recover with pnpm review:resolve:recover 42 --owner [0-9a-f]{40}/i
            );
            expect(statSync(fakeGh.calledPath).isFile()).toBe(true);
            expect(readLockOwner(repository, 42)).toMatchObject({
                threadId,
                head,
                mutation: { phase: 'replyDone', epoch: 1, reviewId },
            });
        } finally {
            rmSync(fakeGh.root, { recursive: true, force: true });
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('preserves a newer foreign owner when failure finds the ref changed after a non-idle mutation throws', () => {
        const repository = createTemporaryGitRepository();
        const fakeGh = createFailingReviewResolutionMutationGhExecutable('replyDone');
        try {
            const session: GhSession = {
                configDir: repository,
                env: { SOURDAW_TRUSTED_GH_PATH: fakeGh.executable },
                dispose() {},
            };
            const port = shellPort(session, repository);
            let replacementOwnerOid: string | undefined;
            expect(() =>
                withPullRequestReviewResolutionLock(repository, 42, threadId, head, () => {
                    try {
                        port.replyDone(threadId, reviewId);
                    } catch (error) {
                        const currentOwnerOid = readLockOid(repository, 42);
                        expect(currentOwnerOid).toBeDefined();
                        replacementOwnerOid = writeLockOwnerBlob(repository, 1_000_000);
                        updateLock(repository, 42, replacementOwnerOid, currentOwnerOid);
                        throw error;
                    }
                })
            ).toThrow(
                /reply mutation transport lost; review resolution on PR #42 lock ownership changed after replyDone epoch 1; newer lock owner [0-9a-f]{40} preserved/i
            );
            expect(replacementOwnerOid).toBeDefined();
            expect(statSync(fakeGh.calledPath).isFile()).toBe(true);
            expect(readLockOid(repository, 42)).toBe(replacementOwnerOid);
            expect(readLockOwner(repository, 42)).toMatchObject({
                threadId,
                head,
                mutation: { phase: 'idle', epoch: 0 },
            });
        } finally {
            rmSync(fakeGh.root, { recursive: true, force: true });
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('preserves the claimed PR lock owner when shell-backed reply recovery cannot yet observe the original Done marker', () => {
        const repository = createTemporaryGitRepository();
        const fakeGh = createFailingReviewResolutionMutationGhExecutable('replyDone');
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'replyDone',
                epoch: 1,
                reviewId,
            });
            updateLock(repository, 42, ownerOid);
            const session: GhSession = {
                configDir: repository,
                env: { SOURDAW_TRUSTED_GH_PATH: fakeGh.executable },
                dispose() {},
            };
            const inspectionPort = fakePort({ existingPendingReviewCount: 1 });
            const mutationPort = shellPort(session, repository);
            const port: ResolveReviewThreadPort = {
                ...mutationPort,
                inspect: inspectionPort.port.inspect,
                inspectPullRequestReview: mutationPort.inspectPullRequestReview,
                inspectAttachedReviewThreadIds: inspectionPort.port.inspectAttachedReviewThreadIds,
                log: inspectionPort.port.log,
            };
            expect(() =>
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    ownerOid,
                    (owner) => recoverReviewResolutionLockOwnerState(42, owner, port),
                    () => false
                )
            ).toThrow(
                /unreconciled in-flight replyDone mutation from epoch 1; retry recovery after GitHub state changes; review resolution on PR #42 preserved exact lock owner [0-9a-f]{40} after replyDone epoch 1; recover with pnpm review:resolve:recover 42 --owner [0-9a-f]{40}/i
            );
            expect(inspectionPort.calls).toEqual(['inspect:1']);
            expect(() => statSync(fakeGh.calledPath)).toThrow();
            const preservedOid = readLockOid(repository, 42);
            expect(preservedOid).toBeDefined();
            expect(preservedOid).not.toBe(ownerOid);
            expect(requireLockOwner(repository, 42)).toMatchObject({
                threadId,
                head,
                mutation: { phase: 'replyDone', epoch: 1, reviewId },
            });
        } finally {
            rmSync(fakeGh.root, { recursive: true, force: true });
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('refuses recovery after the lock holder parent dies while a same-group child still lives, then recovers once the group is quiescent', async () => {
        const repository = createTemporaryGitRepository();
        const holder = spawn(
            process.execPath,
            [
                '--input-type=module',
                '--eval',
                [
                    "import { spawn } from 'node:child_process';",
                    "const child = spawn('bash', ['-lc', 'sleep 30'], { stdio: 'ignore' });",
                    "if (child.pid === undefined) throw new Error('missing child pid');",
                    'console.log(JSON.stringify({ parentPid: process.pid, childPid: child.pid }));',
                    'setInterval(() => {}, 1000);',
                ].join('\n'),
            ],
            { detached: true, stdio: ['ignore', 'pipe', 'ignore'] }
        );
        let descendantPid: number | undefined;
        try {
            const recorded = JSON.parse(await readFirstStdoutLine(holder)) as { parentPid: number; childPid: number };
            descendantPid = recorded.childPid;
            const ownerOid = writeLegacyLockOwnerBlob(repository, 2, recorded.parentPid, recorded.parentPid);
            updateLock(repository, 42, ownerOid);
            expect(() => recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, () => 'reconciled')).toThrow(
                /still held by live process group/i
            );
            holder.kill('SIGKILL');
            await waitForExit(holder);
            expect(() => recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, () => 'reconciled')).toThrow(
                /still held by live process group/i
            );

            process.kill(descendantPid, 'SIGKILL');
            await waitForProcessGroupGone(recorded.parentPid);
            expect(
                recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) => ({
                    owner,
                    inspection: {
                        pullRequestId,
                        head: owner.head,
                        thread: { id: owner.threadId, isResolved: false },
                        pendingReviews: [],
                    },
                }))
            ).toMatchObject({
                owner: { threadId, head },
                inspection: { head, thread: { id: threadId, isResolved: false }, pendingReviews: [] },
            });
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            if (descendantPid !== undefined) {
                try {
                    process.kill(descendantPid, 'SIGKILL');
                } catch {
                    // Best-effort cleanup for a descendant already gone.
                }
            }
            holder.kill('SIGKILL');
            await waitForExit(holder).catch(() => undefined);
            rmSync(repository, { recursive: true, force: true });
        }
    }, 10_000);

    it('keeps a legacy v3 non-idle PGID owner live until its descendant exits and preserves the recovery mutation', async () => {
        const repository = createTemporaryGitRepository();
        const holder = spawn(
            process.execPath,
            [
                '--input-type=module',
                '--eval',
                [
                    "import { spawn } from 'node:child_process';",
                    "const child = spawn('bash', ['-lc', 'sleep 30'], { stdio: 'ignore' });",
                    "if (child.pid === undefined) throw new Error('missing child pid');",
                    'console.log(JSON.stringify({ parentPid: process.pid, childPid: child.pid }));',
                    'setInterval(() => {}, 1000);',
                ].join('\n'),
            ],
            { detached: true, stdio: ['ignore', 'pipe', 'ignore'] }
        );
        let descendantPid: number | undefined;
        try {
            const recorded = JSON.parse(await readFirstStdoutLine(holder)) as { parentPid: number; childPid: number };
            descendantPid = recorded.childPid;
            const ownerOid = writeLegacyLockOwnerBlob(repository, 3, recorded.parentPid, recorded.parentPid, head, {
                phase: 'replyDone',
                epoch: 1,
                reviewId,
            });
            updateLock(repository, 42, ownerOid);
            expect(() => recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, () => 'reconciled')).toThrow(
                /still held by live process group/i
            );
            holder.kill('SIGKILL');
            await waitForExit(holder);
            expect(() => recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, () => 'reconciled')).toThrow(
                /still held by live process group/i
            );

            process.kill(descendantPid, 'SIGKILL');
            await waitForProcessGroupGone(recorded.parentPid);
            expect(
                recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) => ({
                    owner,
                    inspection: {
                        pullRequestId,
                        head: owner.head,
                        thread: { id: owner.threadId, isResolved: false },
                        pendingReviews: [],
                    },
                }))
            ).toMatchObject({
                owner: {
                    threadId,
                    head,
                    pid: process.pid,
                    ownerFence: { kind: 'pgid', pgid: readProcessGroupId(process.pid) },
                    mutation: { phase: 'replyDone', epoch: 1, reviewId },
                },
                inspection: { head, thread: { id: threadId, isResolved: false }, pendingReviews: [] },
            });
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            if (descendantPid !== undefined) {
                try {
                    process.kill(descendantPid, 'SIGKILL');
                } catch {
                    // Best-effort cleanup for a descendant already gone.
                }
            }
            holder.kill('SIGKILL');
            await waitForExit(holder).catch(() => undefined);
            rmSync(repository, { recursive: true, force: true });
        }
    }, 10_000);

    it('rejects cross-kind POSIX owner fences before recovery', () => {
        const repository = createTemporaryGitRepository();
        try {
            const malformedOwnerOid = gitCapture(
                repository,
                ['hash-object', '-w', '--stdin'],
                JSON.stringify({
                    version: 4,
                    pid: 999999,
                    ownerFence: {
                        kind: 'pgid',
                        pgid: 999999,
                        pid: 999999,
                    },
                    threadId,
                    head,
                    token: '11111111-1111-4111-8111-111111111111',
                    mutation: { phase: 'idle', epoch: 0 },
                })
            );
            updateLock(repository, 42, malformedOwnerOid);
            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, malformedOwnerOid, () => 'reconciled')
            ).toThrow(/lock ownership is malformed/i);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('rejects cross-kind Windows owner fences before recovery', () => {
        const repository = createTemporaryGitRepository();
        try {
            const malformedOwnerOid = gitCapture(
                repository,
                ['hash-object', '-w', '--stdin'],
                JSON.stringify({
                    version: 4,
                    pid: 999999,
                    ownerFence: {
                        kind: 'pid',
                        pid: 999999,
                        pgid: 999999,
                    },
                    threadId,
                    head,
                    token: '11111111-1111-4111-8111-111111111111',
                    mutation: { phase: 'idle', epoch: 0 },
                })
            );
            updateLock(repository, 42, malformedOwnerOid);
            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, malformedOwnerOid, () => 'reconciled')
            ).toThrow(/lock ownership is malformed/i);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('uses the detached child PID as the Windows recovery fence so a live child blocks and its exit unlocks recovery', async () => {
        const repository = createTemporaryGitRepository();
        const holder = spawn(
            process.execPath,
            [
                '--input-type=module',
                '--eval',
                [
                    "import { spawn } from 'node:child_process';",
                    "const child = spawn('bash', ['-lc', 'sleep 30'], { stdio: 'ignore' });",
                    "if (child.pid === undefined) throw new Error('missing child pid');",
                    'console.log(JSON.stringify({ parentPid: process.pid, childPid: child.pid }));',
                    'setInterval(() => {}, 1000);',
                ].join('\n'),
            ],
            { detached: true, stdio: ['ignore', 'pipe', 'ignore'] }
        );
        let childPid: number | undefined;
        try {
            const recorded = JSON.parse(await readFirstStdoutLine(holder)) as { parentPid: number; childPid: number };
            childPid = recorded.childPid;
            const ownerOid = writeLockOwnerBlob(
                repository,
                childPid,
                head,
                {
                    phase: 'replyDone',
                    epoch: 1,
                    reviewId,
                },
                {
                    kind: 'pid',
                    pid: childPid,
                }
            );
            updateLock(repository, 42, ownerOid);

            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, () => 'reconciled', undefined, {
                    platform: 'win32',
                })
            ).toThrow(`review resolution on PR #42 lock is still held by live process ${childPid}`);

            process.kill(childPid, 'SIGKILL');
            await waitForProcessGone(childPid);

            expect(holder.exitCode).toBeNull();
            expect(
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    ownerOid,
                    (owner) => {
                        expect(owner.ownerFence).toEqual({ kind: 'pid', pid: process.pid });
                        return {
                            owner,
                            inspection: {
                                pullRequestId,
                                head: owner.head,
                                thread: { id: owner.threadId, isResolved: false },
                                pendingReviews: [],
                            },
                        };
                    },
                    undefined,
                    { platform: 'win32' }
                )
            ).toMatchObject({
                owner: { threadId, head, ownerFence: { kind: 'pid', pid: process.pid } },
                inspection: { head, thread: { id: threadId, isResolved: false }, pendingReviews: [] },
            });
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            if (childPid !== undefined) {
                try {
                    process.kill(childPid, 'SIGKILL');
                } catch {
                    // Best-effort cleanup for a child already gone.
                }
            }
            holder.kill('SIGKILL');
            await waitForExit(holder).catch(() => undefined);
            rmSync(repository, { recursive: true, force: true });
        }
    }, 10_000);

    it('recovers a quiescent PR-scoped review-resolution lock only after reconciliation and fences owner changes', () => {
        const repository = createTemporaryGitRepository();
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999);
            updateLock(repository, 42, ownerOid);
            expect(
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    ownerOid,
                    (owner) => ({
                        head: owner.head,
                        pendingReviews: [],
                        thread: { id: owner.threadId, isResolved: false },
                    }),
                    () => false
                )
            ).toMatchObject({ head, pendingReviews: [], thread: { id: threadId, isResolved: false } });
            expect(readLockOid(repository, 42)).toBeUndefined();

            const staleOwnerOid = writeLockOwnerBlob(repository, 999998);
            updateLock(repository, 42, staleOwnerOid);
            let replacementOwnerOid: string | undefined;
            expect(() =>
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    staleOwnerOid,
                    () => {
                        const claimedOwnerOid = readLockOid(repository, 42);
                        expect(claimedOwnerOid).toBeDefined();
                        replacementOwnerOid = writeLockOwnerBlob(repository, 1000000);
                        updateLock(repository, 42, replacementOwnerOid, claimedOwnerOid);
                        return 'reconciled';
                    },
                    () => false
                )
            ).toThrow(
                /lock ownership changed before release; review resolution on PR #42 lock ownership changed after idle epoch 0; newer lock owner [0-9a-f]{40} preserved/i
            );
            expect(readLockOid(repository, 42)).toBe(replacementOwnerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('rejects recovery when the owner changes after inspection but before the recovery claim, preserving the newer owner', () => {
        const repository = createTemporaryGitRepository();
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999);
            updateLock(repository, 42, ownerOid);
            const replacementOwnerOid = writeLockOwnerBlob(repository, 1_000_000);
            let reconcileCalled = false;
            expect(() =>
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    ownerOid,
                    () => {
                        reconcileCalled = true;
                        return 'reconciled';
                    },
                    () => false,
                    {
                        updateRef: (primaryRoot, args) => {
                            updateLock(primaryRoot, 42, replacementOwnerOid, ownerOid);
                            return tryUpdateLockRef(primaryRoot, args);
                        },
                    }
                )
            ).toThrow(/lock ownership changed before recovery/i);
            expect(reconcileCalled).toBe(false);
            expect(readLockOid(repository, 42)).toBe(replacementOwnerOid);
            expect(requireLockOwner(repository, 42)).toMatchObject({
                pid: 1_000_000,
                ownerFence: { kind: 'pgid', pgid: 1_000_000 },
                threadId,
                head,
                mutation: { phase: 'idle', epoch: 0 },
            });
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('accepts uppercase stale-lock inputs and reports lowercase canonical recovery state', async () => {
        const repository = createTemporaryGitRepository();
        try {
            const uppercaseHead = head.toUpperCase();
            const ownerOid = writeLockOwnerBlob(repository, 999999, uppercaseHead);
            updateLock(repository, 42, ownerOid);
            const session: GhSession = { configDir: repository, env: {}, dispose() {} };
            const recoverDependencies = {
                trustedPrimaryRoot: () => repository,
                authenticateAuthor: async () => ({
                    minted: { actorNodeId: AUTHOR_BOT_NODE_ID },
                    session,
                }),
                repositoryName: () => REQUIRED_REPOSITORY,
                gh: () => () => '',
                inspectThread: () => ({
                    pullRequestId,
                    head,
                    thread: {
                        id: threadId,
                        isResolved: false,
                        resolvedByNodeId: null,
                        resolvedByLogin: null,
                        resolvedByType: null,
                        rootCommentId: null,
                        rootCommentFullDatabaseId: null,
                        rootAuthorNodeId: null,
                        rootAuthorLogin: null,
                        rootAuthorType: null,
                        comments: [],
                    },
                    pendingReviews: [],
                }),
                recoverLock: recoverPullRequestReviewResolutionLock,
            } satisfies Parameters<typeof runRecoverReviewResolutionLockCli>[1];

            const logs: string[] = [];
            const originalLog = console.log;
            console.log = (message?: unknown) => {
                logs.push(String(message));
            };
            try {
                await expect(
                    runRecoverReviewResolutionLockCli(['42', '--owner', ownerOid.toUpperCase()], recoverDependencies)
                ).resolves.toBe(0);
            } finally {
                console.log = originalLog;
            }
            expect(logs).toEqual([`review-resolution-lock-recovered:42:${threadId}:${head}:${head}:unresolved:0`]);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('recovers the exact dead owner after the PR head advances and records both original and current heads', async () => {
        const repository = createTemporaryGitRepository();
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head);
            updateLock(repository, 42, ownerOid);
            const session: GhSession = { configDir: repository, env: {}, dispose() {} };
            const recoverDependencies = {
                trustedPrimaryRoot: () => repository,
                authenticateAuthor: async () => ({
                    minted: { actorNodeId: AUTHOR_BOT_NODE_ID },
                    session,
                }),
                repositoryName: () => REQUIRED_REPOSITORY,
                gh: () => () => '',
                inspectThread: () => ({
                    pullRequestId,
                    head: movedHead,
                    thread: {
                        id: threadId,
                        isResolved: false,
                        resolvedByNodeId: null,
                        resolvedByLogin: null,
                        resolvedByType: null,
                        rootCommentId: null,
                        rootCommentFullDatabaseId: null,
                        rootAuthorNodeId: null,
                        rootAuthorLogin: null,
                        rootAuthorType: null,
                        comments: [],
                    },
                    pendingReviews: [],
                }),
                recoverLock: recoverPullRequestReviewResolutionLock,
            } satisfies Parameters<typeof runRecoverReviewResolutionLockCli>[1];

            const logs: string[] = [];
            const originalLog = console.log;
            console.log = (message?: unknown) => {
                logs.push(String(message));
            };
            try {
                await expect(
                    runRecoverReviewResolutionLockCli(['42', '--owner', ownerOid], recoverDependencies)
                ).resolves.toBe(0);
            } finally {
                console.log = originalLog;
            }
            expect(logs).toEqual([`review-resolution-lock-recovered:42:${threadId}:${head}:${movedHead}:unresolved:0`]);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('keeps the exact owner ref when recovery inspection is missing the bound thread or head', async () => {
        const repository = createTemporaryGitRepository();
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999);
            updateLock(repository, 42, ownerOid);
            const session: GhSession = { configDir: repository, env: {}, dispose() {} };
            const recoverDependencies = {
                trustedPrimaryRoot: () => repository,
                authenticateAuthor: async () => ({
                    minted: { actorNodeId: AUTHOR_BOT_NODE_ID },
                    session,
                }),
                repositoryName: () => REQUIRED_REPOSITORY,
                gh: () => () => '',
                inspectThread: () => ({
                    pullRequestId,
                    head: movedHead,
                    thread: {
                        id: 'PRRT_other',
                        isResolved: false,
                        resolvedByNodeId: null,
                        resolvedByLogin: null,
                        resolvedByType: null,
                        rootCommentId: null,
                        rootCommentFullDatabaseId: null,
                        rootAuthorNodeId: null,
                        rootAuthorLogin: null,
                        rootAuthorType: null,
                        comments: [],
                    },
                    pendingReviews: [],
                }),
                recoverLock: recoverPullRequestReviewResolutionLock,
            } satisfies Parameters<typeof runRecoverReviewResolutionLockCli>[1];

            await expect(
                runRecoverReviewResolutionLockCli(['42', '--owner', ownerOid], recoverDependencies)
            ).rejects.toThrow(/review thread .* was not found|head changed while reconciling/i);
            const preservedOwnerOid = readLockOid(repository, 42);
            expect(preservedOwnerOid).toBeDefined();
            expect(preservedOwnerOid).not.toBe(ownerOid);
            expect(requireLockOwner(repository, 42)).toMatchObject({
                threadId,
                head,
                mutation: { phase: 'idle', epoch: 0 },
            });
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('preserves an absent create-pending-review recovery through the CLI, then resolves once the original draft appears', async () => {
        const repository = createTemporaryGitRepository();
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'createPendingReview',
                epoch: 1,
            });
            updateLock(repository, 42, ownerOid);
            const session: GhSession = { configDir: repository, env: {}, dispose() {} };
            const { port, calls, state } = fakePort();
            const recoverDependencies = {
                trustedPrimaryRoot: () => repository,
                authenticateAuthor: async () => ({
                    minted: { actorNodeId: AUTHOR_BOT_NODE_ID },
                    session,
                }),
                repositoryName: () => REQUIRED_REPOSITORY,
                gh: () => () => '',
                createPort: () => port,
                recoverLock: (primaryRoot, number, owner, reconcile) =>
                    recoverPullRequestReviewResolutionLock(primaryRoot, number, owner, reconcile, () => false),
            } satisfies Parameters<typeof runRecoverReviewResolutionLockCli>[1];

            const logs: string[] = [];
            const originalLog = console.log;
            console.log = (message?: unknown) => {
                logs.push(String(message));
            };
            try {
                await expect(
                    runRecoverReviewResolutionLockCli(['42', '--owner', ownerOid], recoverDependencies)
                ).rejects.toThrow(/unreconciled in-flight createPendingReview/i);
                expect(logs).toEqual([]);
                expect(calls).toEqual(['inspect:1']);
                const preservedOwnerOid = readLockOid(repository, 42);
                expect(preservedOwnerOid).toBeDefined();
                expect(preservedOwnerOid).not.toBe(ownerOid);
                expect(requireLockOwner(repository, 42)).toMatchObject({
                    mutation: { phase: 'createPendingReview', epoch: 1 },
                });
                state().reviews.push({
                    id: reviewId,
                    state: 'PENDING',
                    body: resolutionReviewSummary(pullRequestId, threadId, head),
                    commitOid: head,
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                });
                await expect(
                    runRecoverReviewResolutionLockCli(['42', '--owner', preservedOwnerOid!], recoverDependencies)
                ).resolves.toBe(0);
            } finally {
                console.log = originalLog;
            }
            expect(logs).toEqual([`review-resolution-lock-recovered:42:${threadId}:${head}:${head}:resolved:0`]);
            expect(calls.filter((call) => call.startsWith('createReview:'))).toEqual([]);
            expect(calls.filter((call) => call.startsWith('reply:'))).toEqual([`reply:${threadId}:${reviewId}`]);
            expect(calls.filter((call) => call.startsWith('submitReview:'))).toEqual([`submitReview:${reviewId}`]);
            expect(calls.filter((call) => call.startsWith('resolve:'))).toEqual([`resolve:${threadId}`]);
            expect(calls.filter((call) => call.startsWith('log:'))).toEqual([
                `log:review-thread-resolved:42:${threadId}`,
            ]);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('preserves the claimed owner through a shell-backed create recovery when the original draft is still absent', async () => {
        const repository = createTemporaryGitRepository();
        const fakeGh = createLockObservingCreateReviewGhExecutable(repository);
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'createPendingReview',
                epoch: 1,
            });
            updateLock(repository, 42, ownerOid);
            const session: GhSession = {
                configDir: repository,
                env: { SOURDAW_TRUSTED_GH_PATH: fakeGh.executable },
                dispose() {},
            };
            const mutationPort = shellPort(session, repository);
            const calls: string[] = [];
            let inspectionCount = 0;
            const pendingReview = {
                id: reviewId,
                state: 'PENDING' as const,
                body: resolutionReviewSummary(pullRequestId, threadId, head),
                commitOid: head,
                authorNodeId: AUTHOR_BOT_NODE_ID,
                authorLogin: 'renamed-author',
                authorType: 'Bot',
            };
            const port: ResolveReviewThreadPort = {
                ...mutationPort,
                inspect: () => {
                    inspectionCount += 1;
                    calls.push(`inspect:${inspectionCount}`);
                    let createObserved: boolean;
                    try {
                        createObserved = statSync(fakeGh.mutationOwnerPath).isFile();
                    } catch {
                        createObserved = false;
                    }
                    return {
                        pullRequestId,
                        head,
                        thread: {
                            id: threadId,
                            isResolved: false,
                            resolvedByNodeId: null,
                            resolvedByLogin: null,
                            resolvedByType: null,
                            rootCommentId: null,
                            rootCommentFullDatabaseId: null,
                            rootAuthorNodeId: null,
                            rootAuthorLogin: null,
                            rootAuthorType: null,
                            comments: [],
                        },
                        pendingReviews: createObserved ? [pendingReview] : [],
                    };
                },
                inspectAttachedReviewThreadIds: () => [],
                log: (message) => calls.push(`log:${message}`),
            };
            const recoverDependencies = {
                trustedPrimaryRoot: () => repository,
                authenticateAuthor: async () => ({
                    minted: { actorNodeId: AUTHOR_BOT_NODE_ID },
                    session,
                }),
                repositoryName: () => REQUIRED_REPOSITORY,
                gh: () => () => '',
                createPort: () => port,
                recoverLock: (primaryRoot, number, owner, reconcile) =>
                    recoverPullRequestReviewResolutionLock(primaryRoot, number, owner, reconcile, () => false),
            } satisfies Parameters<typeof runRecoverReviewResolutionLockCli>[1];

            const logs: string[] = [];
            const originalLog = console.log;
            console.log = (message?: unknown) => {
                logs.push(String(message));
            };
            try {
                await expect(
                    runRecoverReviewResolutionLockCli(['42', '--owner', ownerOid], recoverDependencies)
                ).rejects.toThrow(/unreconciled in-flight createPendingReview/i);
                expect(logs).toEqual([]);
                expect(calls).toEqual(['inspect:1']);
            } finally {
                console.log = originalLog;
            }
            expect(logs).toEqual([]);
            expect(() => statSync(fakeGh.mutationOwnerPath)).toThrow();
            const preservedOwnerOid = readLockOid(repository, 42);
            expect(preservedOwnerOid).toBeDefined();
            expect(preservedOwnerOid).not.toBe(ownerOid);
            expect(requireLockOwner(repository, 42)).toMatchObject({
                threadId,
                head,
                mutation: {
                    phase: 'createPendingReview',
                    epoch: 1,
                },
            });
        } finally {
            rmSync(fakeGh.root, { recursive: true, force: true });
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('uses the launcher-resolved trusted Git path for review-resolution lock operations and ignores a hostile PATH git', () => {
        const repository = createTemporaryGitRepository();
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-review-resolution-trusted-git-'));
        const hostileBin = join(root, 'hostile');
        const hostileMarker = join(root, 'hostile-entered');
        try {
            mkdirSync(hostileBin);
            writeFileSync(
                join(hostileBin, 'git'),
                `#!/bin/sh\nprintf entered > ${JSON.stringify(hostileMarker)}\nexit 91\n`
            );
            chmodSync(join(hostileBin, 'git'), 0o700);
            withTemporaryEnvironment(
                {
                    PATH: `${hostileBin}${delimiter}${process.env.PATH ?? ''}`,
                    SOURDAW_TRUSTED_GIT_PATH: trustedGitPath,
                },
                () => {
                    expect(withPullRequestReviewResolutionLock(repository, 42, threadId, head, () => 'ok')).toBe('ok');
                }
            );
            const ownerOid = writeLockOwnerBlob(repository, 999999);
            updateLock(repository, 42, ownerOid);
            withTemporaryEnvironment(
                {
                    PATH: `${hostileBin}${delimiter}${process.env.PATH ?? ''}`,
                    SOURDAW_TRUSTED_GIT_PATH: trustedGitPath,
                },
                () => {
                    expect(
                        recoverPullRequestReviewResolutionLock(
                            repository,
                            42,
                            ownerOid,
                            () => ({
                                pullRequestId,
                                head,
                                thread: {
                                    id: threadId,
                                    isResolved: false,
                                    resolvedByNodeId: null,
                                    resolvedByLogin: null,
                                    resolvedByType: null,
                                    rootCommentId: null,
                                    rootCommentFullDatabaseId: null,
                                    rootAuthorNodeId: null,
                                    rootAuthorLogin: null,
                                    rootAuthorType: null,
                                    comments: [],
                                },
                                pendingReviews: [],
                            }),
                            () => false
                        )
                    ).toMatchObject({ head, thread: { id: threadId, isResolved: false } });
                }
            );
            expect(() => statSync(hostileMarker)).toThrow();
        } finally {
            rmSync(root, { recursive: true, force: true });
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('fails closed when the trusted Git binding is absent for review-resolution lock operations', () => {
        const repository = createTemporaryGitRepository();
        try {
            withTemporaryEnvironment({ SOURDAW_TRUSTED_GIT_PATH: undefined }, () => {
                expect(() => withPullRequestReviewResolutionLock(repository, 42, threadId, head, () => 'ok')).toThrow(
                    /trusted git path/i
                );
                expect(() =>
                    recoverPullRequestReviewResolutionLock(
                        repository,
                        42,
                        'a'.repeat(40),
                        () => 'recovered',
                        () => false
                    )
                ).toThrow(/trusted git path/i);
            });
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('publishes child-marker PID binding through the production temp-write then atomic rename path', () => {
        const markerRoot = mkdtempSync(join(tmpdir(), 'sourdaw-review-marker-publication-'));
        const markerPath = join(markerRoot, 'child-marker.json');
        const capabilityPath = join(markerRoot, 'bootstrap-capability.json');
        const token = '11111111-1111-4111-8111-111111111111';
        try {
            publishReviewResolutionChildLaunchMarker(markerPath, token, null, capabilityPath);
            const originalInode = statSync(markerPath).ino;
            const temporaryPath = `${markerPath}.fixed-publication-id.tmp`;
            const writtenPaths: string[] = [];
            publishReviewResolutionChildLaunchMarker(markerPath, token, 4321, capabilityPath, {
                randomUuid: () => 'fixed-publication-id',
                writeFileSync: (currentPath, data, options) => {
                    expect(typeof currentPath).toBe('string');
                    if (typeof currentPath !== 'string') {
                        throw new TypeError('marker publication wrote to a non-path target');
                    }
                    writtenPaths.push(currentPath);
                    expect(currentPath).toBe(temporaryPath);
                    writeFileSync(currentPath, data, options);
                },
            });
            expect(writtenPaths).toEqual([temporaryPath]);
            expect(readPersistedReviewResolutionChildLaunchMarker({ path: markerPath, token })).toEqual({
                version: 1,
                token,
                pid: 4321,
                capabilityPath,
            });
            expect(statSync(markerPath).ino).not.toBe(originalInode);
            expect(() => statSync(temporaryPath)).toThrow();
        } finally {
            rmSync(markerRoot, { recursive: true, force: true });
        }
    });

    it('accepts a Windows detached child marker and launcher capability without a ps path', async () => {
        const markerRoot = mkdtempSync(join(tmpdir(), 'sourdaw-review-win32-child-marker-'));
        const markerPath = join(markerRoot, 'child-marker.json');
        const capabilityPath = join(markerRoot, 'bootstrap-capability.json');
        const token = '11111111-1111-4111-8111-111111111111';
        try {
            writeFileSync(
                capabilityPath,
                JSON.stringify({
                    version: 1,
                    token,
                    trustedLauncher: {
                        primaryRoot: markerRoot,
                        gitPath: trustedGitPath,
                        ghPath: trustedGhPath,
                    },
                }),
                { encoding: 'utf8', mode: 0o600 }
            );
            publishReviewResolutionChildLaunchMarker(markerPath, token, process.pid, capabilityPath);
            await expect(
                assertDetachedReviewResolutionChild(JSON.stringify({ path: markerPath, token }), {
                    platform: 'win32',
                    executionFence: {
                        pid: process.pid,
                        ownerFence: {
                            kind: 'pid',
                            pid: process.pid,
                        },
                    },
                    sleep: async () => undefined,
                })
            ).resolves.toEqual({
                primaryRoot: markerRoot,
                gitPath: trustedGitPath,
                ghPath: trustedGhPath,
            });
            expect(existsSync(markerPath)).toBe(false);
        } finally {
            rmSync(markerRoot, { recursive: true, force: true });
        }
    });

    it('rejects a forged preset child marker before creating the PR lock', async () => {
        const repository = createTemporaryGitRepository();
        const snapshotRoot = mkdtempSync(join(tmpdir(), 'sourdaw-review-resolve-forged-marker-'));
        const entryPath = writeResolveReviewSnapshot(snapshotRoot);
        const child = spawn(process.execPath, [entryPath, '42', '--thread', threadId, '--head', head], {
            cwd: repository,
            env: {
                ...process.env,
                SOURDAW_TEST_PRIMARY_ROOT: repository,
                SOURDAW_REVIEW_RESOLUTION_CHILD: '1',
            },
            stdio: ['ignore', 'ignore', 'pipe'],
            shell: false,
            detached: true,
        });
        let stderr = '';
        child.stderr?.setEncoding('utf8');
        child.stderr?.on('data', (chunk: string) => {
            stderr += chunk;
        });
        try {
            await waitForProcessExitWithoutReviewResolutionLock(child, repository, 42);
            await waitForExit(child);
            expect(child.exitCode).toBe(1);
            expect(stderr).toMatch(/detached launcher marker is invalid/i);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            child.kill('SIGKILL');
            await waitForExit(child).catch(() => undefined);
            rmSync(snapshotRoot, { recursive: true, force: true });
            rmSync(repository, { recursive: true, force: true });
        }
    }, 10_000);

    it('rejects a valid-looking inherited child marker whose persisted PID names a different detached process', async () => {
        const repository = createTemporaryGitRepository();
        const snapshotRoot = mkdtempSync(join(tmpdir(), 'sourdaw-review-resolve-inherited-marker-'));
        const markerRoot = mkdtempSync(join(tmpdir(), 'sourdaw-review-resolve-inherited-marker-file-'));
        const entryPath = writeResolveReviewSnapshot(snapshotRoot);
        const token = '22222222-2222-4222-8222-222222222222';
        const markerPath = join(markerRoot, 'child-marker.json');
        const capabilityPath = join(markerRoot, 'bootstrap-capability.json');
        publishReviewResolutionChildLaunchMarker(markerPath, token, 999999, capabilityPath);
        const child = spawn(process.execPath, [entryPath, '42', '--thread', threadId, '--head', head], {
            cwd: repository,
            env: {
                ...process.env,
                SOURDAW_TEST_PRIMARY_ROOT: repository,
                SOURDAW_TEST_TRUSTED_GIT_PATH: trustedGitPath,
                SOURDAW_REVIEW_RESOLUTION_CHILD: JSON.stringify({ path: markerPath, token }),
            },
            stdio: ['ignore', 'ignore', 'pipe'],
            shell: false,
            detached: true,
        });
        let stderr = '';
        child.stderr?.setEncoding('utf8');
        child.stderr?.on('data', (chunk: string) => {
            stderr += chunk;
        });
        try {
            await waitForProcessExitWithoutReviewResolutionLock(child, repository, 42);
            await waitForExit(child);
            expect(child.exitCode).toBe(1);
            expect(stderr).toMatch(/detached launcher marker is invalid/i);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            child.kill('SIGKILL');
            await waitForExit(child).catch(() => undefined);
            rmSync(markerRoot, { recursive: true, force: true });
            rmSync(snapshotRoot, { recursive: true, force: true });
            rmSync(repository, { recursive: true, force: true });
        }
    }, 10_000);

    it('rejects a valid PID-bound child marker when the child is not its own process-group leader before lock acquisition', async () => {
        const repository = createTemporaryGitRepository();
        const snapshotRoot = mkdtempSync(join(tmpdir(), 'sourdaw-review-resolve-shared-pgid-'));
        const markerRoot = mkdtempSync(join(tmpdir(), 'sourdaw-review-resolve-shared-pgid-marker-'));
        const entryPath = writeResolveReviewSnapshot(snapshotRoot);
        const token = '33333333-3333-4333-8333-333333333333';
        const markerPath = join(markerRoot, 'child-marker.json');
        const capabilityPath = join(markerRoot, 'bootstrap-capability.json');
        writeFileSync(
            capabilityPath,
            JSON.stringify({
                version: 1,
                token,
                trustedLauncher: {
                    primaryRoot: repository,
                    gitPath: trustedGitPath,
                    ghPath: trustedGhPath,
                    psPath: trustedPsPath,
                },
            }),
            { encoding: 'utf8', mode: 0o600 }
        );
        publishReviewResolutionChildLaunchMarker(markerPath, token, null, capabilityPath);
        const child = spawn(process.execPath, [entryPath, '42', '--thread', threadId, '--head', head], {
            cwd: repository,
            env: {
                ...process.env,
                SOURDAW_TEST_PRIMARY_ROOT: repository,
                SOURDAW_TEST_TRUSTED_GIT_PATH: trustedGitPath,
                SOURDAW_TRUSTED_ORIGIN_COMMIT: head,
                SOURDAW_REVIEW_RESOLUTION_CHILD: JSON.stringify({ path: markerPath, token }),
            },
            stdio: ['ignore', 'ignore', 'pipe'],
            shell: false,
        });
        let stderr = '';
        child.stderr?.setEncoding('utf8');
        child.stderr?.on('data', (chunk: string) => {
            stderr += chunk;
        });
        try {
            if (child.pid === undefined) {
                throw new Error('child pid is unavailable');
            }
            expect(readProcessGroupId(child.pid)).not.toBe(child.pid);
            publishReviewResolutionChildLaunchMarker(markerPath, token, child.pid, capabilityPath);
            await waitForProcessExitWithoutReviewResolutionLock(child, repository, 42);
            await waitForExit(child);
            expect(child.exitCode).toBe(1);
            expect(stderr).toMatch(/own detached POSIX process group/i);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            child.kill('SIGKILL');
            await waitForExit(child).catch(() => undefined);
            rmSync(markerRoot, { recursive: true, force: true });
            rmSync(snapshotRoot, { recursive: true, force: true });
            rmSync(repository, { recursive: true, force: true });
        }
    }, 10_000);

    it('pins detached child blob verification to the launcher commit even if local origin/main advances before the check resumes', async () => {
        const { repository, pinnedCommit, advancedCommit } = createTemporaryGitRepositoryWithTrackedResolveSource();
        const snapshotRoot = mkdtempSync(join(tmpdir(), 'sourdaw-review-resolve-pinned-origin-'));
        const markerRoot = mkdtempSync(join(tmpdir(), 'sourdaw-review-resolve-pinned-origin-marker-'));
        const recordedRevisionPath = join(snapshotRoot, 'recorded-revision.txt');
        const releasePath = join(snapshotRoot, 'release-origin-check');
        const entryPath = writePinnedOriginResolveReviewSnapshot(snapshotRoot, recordedRevisionPath, releasePath);
        const token = '44444444-4444-4444-8444-444444444444';
        const markerPath = join(markerRoot, 'child-marker.json');
        const capabilityPath = join(markerRoot, 'bootstrap-capability.json');
        writeFileSync(
            capabilityPath,
            JSON.stringify({
                version: 1,
                token,
                trustedLauncher: {
                    primaryRoot: repository,
                    gitPath: trustedGitPath,
                    ghPath: trustedGhPath,
                    psPath: trustedPsPath,
                },
            }),
            { encoding: 'utf8', mode: 0o600 }
        );
        publishReviewResolutionChildLaunchMarker(markerPath, token, null, capabilityPath);
        const child = spawn(process.execPath, [entryPath, '42', '--thread', threadId, '--head', head], {
            cwd: repository,
            env: {
                ...process.env,
                SOURDAW_TEST_PRIMARY_ROOT: repository,
                SOURDAW_TEST_TRUSTED_GIT_PATH: trustedGitPath,
                SOURDAW_TRUSTED_ORIGIN_COMMIT: pinnedCommit,
                SOURDAW_REVIEW_RESOLUTION_CHILD: JSON.stringify({ path: markerPath, token }),
            },
            stdio: ['ignore', 'ignore', 'pipe'],
            shell: false,
            detached: true,
        });
        let stderr = '';
        child.stderr?.setEncoding('utf8');
        child.stderr?.on('data', (chunk: string) => {
            stderr += chunk;
        });
        try {
            if (child.pid === undefined) {
                throw new Error('child pid is unavailable');
            }
            publishReviewResolutionChildLaunchMarker(markerPath, token, child.pid, capabilityPath);
            await waitForFile(recordedRevisionPath);
            expect(readFileSync(recordedRevisionPath, 'utf8')).toBe(pinnedCommit);
            gitCapture(repository, ['update-ref', 'refs/remotes/origin/main', advancedCommit, pinnedCommit]);
            writeFileSync(releasePath, '1', 'utf8');
            await waitForProcessExitWithoutReviewResolutionLock(child, repository, 42);
            await waitForExit(child);
            expect(child.exitCode).toBe(1);
            expect(stderr).toMatch(/stop after trusted blob check/i);
            expect(stderr).not.toMatch(/mutated copy/i);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            child.kill('SIGKILL');
            await waitForExit(child).catch(() => undefined);
            rmSync(markerRoot, { recursive: true, force: true });
            rmSync(snapshotRoot, { recursive: true, force: true });
            rmSync(repository, { recursive: true, force: true });
        }
    }, 10_000);

    it('pins detached recover child blob verification to the launcher commit even if local origin/main advances before the check resumes', async () => {
        const { repository, pinnedCommit, advancedCommit } = createTemporaryGitRepositoryWithTrackedResolveSource();
        const snapshotRoot = mkdtempSync(join(tmpdir(), 'sourdaw-review-recover-pinned-origin-'));
        const markerRoot = mkdtempSync(join(tmpdir(), 'sourdaw-review-recover-pinned-origin-marker-'));
        const recordedRevisionPath = join(snapshotRoot, 'recorded-revision.txt');
        const releasePath = join(snapshotRoot, 'release-origin-check');
        const entryPath = writePinnedOriginRecoverReviewSnapshot(snapshotRoot, recordedRevisionPath, releasePath);
        const token = '123e4567-e89b-12d3-a456-426614174000';
        const markerPath = join(markerRoot, 'child-marker.json');
        const capabilityPath = join(markerRoot, 'bootstrap-capability.json');
        const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
            phase: 'replyDone',
            epoch: 1,
            reviewId,
        });
        updateLock(repository, 42, ownerOid);
        writeFileSync(
            capabilityPath,
            JSON.stringify({
                version: 1,
                token,
                trustedLauncher: {
                    primaryRoot: repository,
                    gitPath: trustedGitPath,
                    ghPath: trustedGhPath,
                    psPath: trustedPsPath,
                },
            }),
            { encoding: 'utf8', mode: 0o600 }
        );
        publishReviewResolutionChildLaunchMarker(markerPath, token, null, capabilityPath);
        const child = spawn(process.execPath, [entryPath, '42', '--owner', ownerOid], {
            cwd: repository,
            env: {
                ...process.env,
                SOURDAW_TEST_PRIMARY_ROOT: repository,
                SOURDAW_TEST_TRUSTED_GIT_PATH: trustedGitPath,
                SOURDAW_TRUSTED_ORIGIN_COMMIT: pinnedCommit,
                SOURDAW_REVIEW_RESOLUTION_CHILD: JSON.stringify({ path: markerPath, token }),
            },
            stdio: ['ignore', 'ignore', 'pipe'],
            shell: false,
            detached: true,
        });
        let stderr = '';
        child.stderr?.setEncoding('utf8');
        child.stderr?.on('data', (chunk: string) => {
            stderr += chunk;
        });
        try {
            if (child.pid === undefined) {
                throw new Error('child pid is unavailable');
            }
            publishReviewResolutionChildLaunchMarker(markerPath, token, child.pid, capabilityPath);
            await waitForFile(recordedRevisionPath);
            expect(readFileSync(recordedRevisionPath, 'utf8')).toBe(pinnedCommit);
            gitCapture(repository, ['update-ref', 'refs/remotes/origin/main', advancedCommit, pinnedCommit]);
            writeFileSync(releasePath, '1', 'utf8');
            await waitForExit(child);
            expect(child.exitCode).toBe(1);
            expect(stderr).toMatch(/stop after trusted blob check/i);
            expect(stderr).not.toMatch(/mutated copy/i);
            expect(readLockOid(repository, 42)).toBe(ownerOid);
        } finally {
            child.kill('SIGKILL');
            await waitForExit(child).catch(() => undefined);
            rmSync(markerRoot, { recursive: true, force: true });
            rmSync(snapshotRoot, { recursive: true, force: true });
            rmSync(repository, { recursive: true, force: true });
        }
    }, 10_000);

    it('refuses detached recover execution when the launcher-pinned origin commit is missing', async () => {
        const repository = createTemporaryGitRepository();
        const snapshotRoot = mkdtempSync(join(tmpdir(), 'sourdaw-review-recover-missing-origin-'));
        const markerRoot = mkdtempSync(join(tmpdir(), 'sourdaw-review-recover-missing-origin-marker-'));
        const recordedRevisionPath = join(snapshotRoot, 'recorded-revision.txt');
        const releasePath = join(snapshotRoot, 'release-origin-check');
        const entryPath = writePinnedOriginRecoverReviewSnapshot(snapshotRoot, recordedRevisionPath, releasePath);
        const token = '123e4567-e89b-12d3-a456-426614174001';
        const markerPath = join(markerRoot, 'child-marker.json');
        const capabilityPath = join(markerRoot, 'bootstrap-capability.json');
        const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
            phase: 'replyDone',
            epoch: 1,
            reviewId,
        });
        updateLock(repository, 42, ownerOid);
        writeFileSync(
            capabilityPath,
            JSON.stringify({
                version: 1,
                token,
                trustedLauncher: {
                    primaryRoot: repository,
                    gitPath: trustedGitPath,
                    ghPath: trustedGhPath,
                    psPath: trustedPsPath,
                },
            }),
            { encoding: 'utf8', mode: 0o600 }
        );
        publishReviewResolutionChildLaunchMarker(markerPath, token, null, capabilityPath);
        const child = spawn(process.execPath, [entryPath, '42', '--owner', ownerOid], {
            cwd: repository,
            env: {
                ...process.env,
                SOURDAW_TEST_PRIMARY_ROOT: repository,
                SOURDAW_TEST_TRUSTED_GIT_PATH: trustedGitPath,
                SOURDAW_REVIEW_RESOLUTION_CHILD: JSON.stringify({ path: markerPath, token }),
            },
            stdio: ['ignore', 'ignore', 'pipe'],
            shell: false,
            detached: true,
        });
        let stderr = '';
        child.stderr?.setEncoding('utf8');
        child.stderr?.on('data', (chunk: string) => {
            stderr += chunk;
        });
        try {
            if (child.pid === undefined) {
                throw new Error('child pid is unavailable');
            }
            publishReviewResolutionChildLaunchMarker(markerPath, token, child.pid, capabilityPath);
            await waitForExit(child);
            expect(child.exitCode).toBe(1);
            expect(stderr).toMatch(/protected primary checkout launcher/i);
            expect(() => statSync(recordedRevisionPath)).toThrow();
            expect(readLockOid(repository, 42)).toBe(ownerOid);
        } finally {
            child.kill('SIGKILL');
            await waitForExit(child).catch(() => undefined);
            rmSync(markerRoot, { recursive: true, force: true });
            rmSync(snapshotRoot, { recursive: true, force: true });
            rmSync(repository, { recursive: true, force: true });
        }
    }, 10_000);

    it('launches review:resolve in a detached worker group and keeps recovery fenced until that group exits', async () => {
        const repository = createTemporaryGitRepository();
        const snapshotRoot = mkdtempSync(join(tmpdir(), 'sourdaw-review-resolve-launcher-'));
        const entryPath = writeResolveReviewSnapshot(snapshotRoot);
        const launcher = spawn(process.execPath, [entryPath, '42', '--thread', threadId, '--head', head], {
            cwd: repository,
            env: {
                ...process.env,
                SOURDAW_TEST_PRIMARY_ROOT: repository,
                SOURDAW_TRUSTED_ORIGIN_COMMIT: head,
            },
            stdio: ['ignore', 'ignore', 'pipe'],
            shell: false,
        });
        let stderr = '';
        launcher.stderr?.setEncoding('utf8');
        launcher.stderr?.on('data', (chunk: string) => {
            stderr += chunk;
        });
        let owner: TestLockOwnerRecord | undefined;
        try {
            if (launcher.pid === undefined) {
                throw new Error('launcher pid is unavailable');
            }
            const launcherPgid = readProcessGroupId(launcher.pid);
            const lock = await waitForReviewResolutionLock(repository, 42);
            owner = lock.owner;
            expect(owner.threadId).toBe(threadId);
            expect(owner.head).toBe(head);
            expect(owner.pid).not.toBe(launcher.pid);
            expect(owner.ownerFence).toEqual({ kind: 'pgid', pgid: owner.pid });
            expect(owner.ownerFence?.kind).toBe('pgid');
            expect(owner.ownerFence?.pgid).not.toBe(launcherPgid);
            expect(() => recoverPullRequestReviewResolutionLock(repository, 42, lock.oid, () => 'recovered')).toThrow(
                /still held by live process group/i
            );

            process.kill(-owner.pid, 'SIGKILL');
            await waitForProcessGroupGone(owner.pid);
            await waitForExit(launcher);
            expect(launcher.exitCode).toBe(1);
            expect(stderr).toMatch(/terminated by SIGKILL/i);
            expect(
                recoverPullRequestReviewResolutionLock(repository, 42, lock.oid, (lockOwner) => ({
                    head: lockOwner.head,
                    pendingReviews: [],
                    thread: { id: lockOwner.threadId, isResolved: false },
                }))
            ).toMatchObject({ head, pendingReviews: [], thread: { id: threadId, isResolved: false } });
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            if (owner !== undefined) {
                try {
                    process.kill(-owner.pid, 'SIGKILL');
                } catch {
                    // Best-effort cleanup for a worker group already gone.
                }
            }
            launcher.kill('SIGKILL');
            await waitForExit(launcher).catch(() => undefined);
            rmSync(snapshotRoot, { recursive: true, force: true });
            rmSync(repository, { recursive: true, force: true });
        }
    }, 10_000);

    it('admits later recovery after a failed detached recover worker exits, even while its launcher parent is still alive', async () => {
        const repository = createTemporaryGitRepository();
        const snapshotRoot = mkdtempSync(join(tmpdir(), 'sourdaw-review-recover-launcher-'));
        const entryPath = writeRecoverReviewResolutionSnapshot(snapshotRoot);
        const fakeGh = createFakeGhExecutable({
            'threads:': threadPage([{ id: threadId, isResolved: false }], false, null),
            [`comments:${threadId}:`]: commentPage([root], false, null),
            [`threadResolution:${threadId}`]: threadResolutionPage(threadId, head),
            'reviews:': reviewPage([], false, null),
        });
        let launcher: ReturnType<typeof spawn> | undefined;
        let stderr = '';
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'replyDone',
                epoch: 1,
                reviewId,
            });
            updateLock(repository, 42, ownerOid);
            launcher = spawn(process.execPath, [entryPath, '42', '--owner', ownerOid], {
                cwd: repository,
                env: {
                    ...process.env,
                    SOURDAW_TEST_PRIMARY_ROOT: repository,
                    SOURDAW_TEST_TRUSTED_GIT_PATH: trustedGitPath,
                    SOURDAW_TEST_TRUSTED_GH_PATH: fakeGh.executable,
                    SOURDAW_TRUSTED_ORIGIN_COMMIT: head,
                    SOURDAW_TEST_LINGER_AFTER_COMMAND_MS: '3000',
                },
                stdio: ['ignore', 'ignore', 'pipe'],
                shell: false,
            });
            launcher.stderr?.setEncoding('utf8');
            launcher.stderr?.on('data', (chunk: string) => {
                stderr += chunk;
            });
            const claimed = await waitForReviewResolutionLockOwnerPidChange(repository, 42, 999999);
            expect(launcher.exitCode).toBeNull();
            expect(claimed.owner.pid).not.toBe(launcher.pid);
            expect(claimed.owner.ownerFence).toEqual({ kind: 'pgid', pgid: claimed.owner.pid });
            expect(
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    claimed.oid,
                    (owner) => ({
                        head: owner.head,
                        pendingReviews: [],
                        thread: { id: owner.threadId, isResolved: false },
                    }),
                    () => false
                )
            ).toMatchObject({ head, pendingReviews: [], thread: { id: threadId, isResolved: false } });
            expect(readLockOid(repository, 42)).toBeUndefined();
            await waitForExit(launcher);
            expect(launcher.exitCode).toBe(1);
            expect(stderr).toMatch(/unreconciled in-flight replyDone mutation/i);
        } finally {
            launcher?.kill('SIGKILL');
            if (launcher !== undefined) {
                await waitForExit(launcher).catch(() => undefined);
            }
            rmSync(fakeGh.root, { recursive: true, force: true });
            rmSync(snapshotRoot, { recursive: true, force: true });
            rmSync(repository, { recursive: true, force: true });
        }
    }, 10_000);

    it('replays submit-review recovery through the CLI and deletes duplicate pending Done markers before publishing one COMMENTED envelope', async () => {
        const repository = createTemporaryGitRepository();
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'submitReview',
                epoch: 1,
                reviewId,
                body: resolutionReviewSummary(pullRequestId, threadId, head),
            });
            updateLock(repository, 42, ownerOid);
            const session: GhSession = { configDir: repository, env: {}, dispose() {} };
            const { port, calls } = fakePort({
                existingReplyCount: 1,
                existingReplyReviewState: 'PENDING',
                attachManagedPendingReplyOnFirstInspect: true,
            });
            const recoverDependencies = {
                trustedPrimaryRoot: () => repository,
                authenticateAuthor: async () => ({
                    minted: { actorNodeId: AUTHOR_BOT_NODE_ID },
                    session,
                }),
                repositoryName: () => REQUIRED_REPOSITORY,
                gh: () => () => '',
                createPort: () => port,
                recoverLock: (primaryRoot, number, owner, reconcile) =>
                    recoverPullRequestReviewResolutionLock(primaryRoot, number, owner, reconcile, () => false),
            } satisfies Parameters<typeof runRecoverReviewResolutionLockCli>[1];

            const logs: string[] = [];
            const originalLog = console.log;
            console.log = (message?: unknown) => {
                logs.push(String(message));
            };
            try {
                await expect(
                    runRecoverReviewResolutionLockCli(['42', '--owner', ownerOid], recoverDependencies)
                ).resolves.toBe(0);
            } finally {
                console.log = originalLog;
            }
            expect(logs).toEqual([`review-resolution-lock-recovered:42:${threadId}:${head}:${head}:unresolved:0`]);
            expect(calls).toEqual([
                'inspect:1',
                'delete:PRRC_first_pending',
                'inspect:2',
                `submitReview:${reviewId}`,
                'inspect:3',
            ]);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('preserves an absent reply recovery through the CLI, then resolves once the original Done marker appears', async () => {
        const repository = createTemporaryGitRepository();
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'replyDone',
                epoch: 1,
                reviewId,
            });
            updateLock(repository, 42, ownerOid);
            const session: GhSession = { configDir: repository, env: {}, dispose() {} };
            const { port, calls, injectManagedPendingReply } = fakePort({ existingPendingReviewCount: 1 });
            const recoverDependencies = {
                trustedPrimaryRoot: () => repository,
                authenticateAuthor: async () => ({
                    minted: { actorNodeId: AUTHOR_BOT_NODE_ID },
                    session,
                }),
                repositoryName: () => REQUIRED_REPOSITORY,
                gh: () => () => '',
                createPort: () => port,
                recoverLock: (primaryRoot, number, owner, reconcile) =>
                    recoverPullRequestReviewResolutionLock(primaryRoot, number, owner, reconcile, () => false),
            } satisfies Parameters<typeof runRecoverReviewResolutionLockCli>[1];

            const logs: string[] = [];
            const originalLog = console.log;
            console.log = (message?: unknown) => {
                logs.push(String(message));
            };
            try {
                await expect(
                    runRecoverReviewResolutionLockCli(['42', '--owner', ownerOid], recoverDependencies)
                ).rejects.toThrow(/unreconciled in-flight replyDone/i);
                expect(logs).toEqual([]);
                const preservedOwnerOid = readLockOid(repository, 42);
                expect(preservedOwnerOid).toBeDefined();
                expect(preservedOwnerOid).not.toBe(ownerOid);
                expect(requireLockOwner(repository, 42)).toMatchObject({
                    mutation: { phase: 'replyDone', epoch: 1, reviewId },
                });
                injectManagedPendingReply();
                await expect(
                    runRecoverReviewResolutionLockCli(['42', '--owner', preservedOwnerOid!], recoverDependencies)
                ).resolves.toBe(0);
            } finally {
                console.log = originalLog;
            }
            expect(logs).toEqual([`review-resolution-lock-recovered:42:${threadId}:${head}:${head}:resolved:0`]);
            expect(calls.filter((call) => call.startsWith('reply:'))).toEqual([]);
            expect(calls.filter((call) => call.startsWith('submitReview:'))).toEqual([`submitReview:${reviewId}`]);
            expect(calls.filter((call) => call.startsWith('resolve:'))).toEqual([`resolve:${threadId}`]);
            expect(calls.filter((call) => call.startsWith('log:'))).toEqual([
                `log:review-thread-resolved:42:${threadId}`,
            ]);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('uses supported GraphQL review-envelope, reply, and deletion input fields', () => {
        const source = readFileSync(join(import.meta.dirname, '../resolveReviewThread.ts'), 'utf8');
        expect(source).toContain('pullRequestReviewThreadId:$threadId');
        expect(source).toContain('pullRequestReviewId:$reviewId');
        expect(source).toContain(
            'addPullRequestReview(input:{pullRequestId:$pullRequestId,body:$body,commitOID:$commitOid'
        );
        expect(source).toContain(
            'submitPullRequestReview(input:{pullRequestReviewId:$reviewId,event:COMMENT,body:$body'
        );
        expect(source).toContain('updatePullRequestReview(input:{pullRequestReviewId:$reviewId,body:$body');
        expect(source).toContain(
            'deletePullRequestReview(input:{pullRequestReviewId:$reviewId,clientMutationId:$clientMutationId})'
        );
        expect(source).toContain(
            'deletePullRequestReviewComment(input:{id:$replyId,clientMutationId:$clientMutationId})'
        );
        expect(source).toContain(
            'addPullRequestReviewThreadReply(input:{pullRequestReviewId:$reviewId,pullRequestReviewThreadId:$threadId,body:$body,clientMutationId:$clientMutationId})'
        );
        expect(source).toContain('resolveReviewThread(input:{threadId:$threadId,clientMutationId:$clientMutationId})');
        expect(source).not.toMatch(/\bauthor\s*\{\s*id\b/);
        expect(source.match(/author\{login __typename \.\.\. on Bot\{id\}\}/g)?.length).toBeGreaterThanOrEqual(6);
        const inspectQuery = source.match(
            /export function inspectReviewThread\b[\s\S]*?const query\s*=\s*`(query\([^`]*)`;/
        )?.[1];
        const resolveMutation = source.match(
            /function resolveThread\b[\s\S]*?const query\s*=\s*`(mutation\([^`]*)`;/
        )?.[1];
        const replyMutation = source.match(/function mutationReply\b[\s\S]*?const query\s*=\s*'([^']*)';/)?.[1];
        const resolvedByActorSelection = /resolvedBy\s*\{\s*id\s+login\s+__typename\s*\}/;
        const resolvedByBotFragment = /resolvedBy\s*\{[^}]*\.\.\.\s+on\s+Bot\s*\{\s*id\s*\}/;
        for (const operationQuery of [inspectQuery, resolveMutation]) {
            expect(operationQuery).toMatch(resolvedByActorSelection);
            expect(operationQuery).not.toMatch(resolvedByBotFragment);
        }
        expect(replyMutation).toContain(
            'pullRequestReview{id state body commit{oid} author{login __typename ... on Bot{id}}}'
        );
    });
    it.each([
        [
            'missing comment',
            { data: { deletePullRequestReviewComment: { clientMutationId: replyId, pullRequestReviewComment: null } } },
        ],
        [
            'mismatched comment',
            {
                data: {
                    deletePullRequestReviewComment: {
                        clientMutationId: replyId,
                        pullRequestReviewComment: { id: 'PRRC_other' },
                    },
                },
            },
        ],
        [
            'missing client mutation',
            {
                data: {
                    deletePullRequestReviewComment: {
                        clientMutationId: null,
                        pullRequestReviewComment: { id: replyId },
                    },
                },
            },
        ],
        [
            'mismatched client mutation',
            {
                data: {
                    deletePullRequestReviewComment: {
                        clientMutationId: 'PRRC_other',
                        pullRequestReviewComment: { id: replyId },
                    },
                },
            },
        ],
    ])('rejects a %s delete-reply receipt', (_case, response) => {
        expect(() => deleteReply(replyId, () => JSON.stringify(response))).toThrow(
            /delete review reply returned an invalid result/i
        );
    });
    it('passes the requested review id into delete-pending-review and accepts only the matching receipt identity', () => {
        const ghCalls: string[][] = [];
        deletePendingReview(reviewId, (args) => {
            ghCalls.push(args);
            return JSON.stringify({
                data: {
                    deletePullRequestReview: {
                        clientMutationId: reviewId,
                        pullRequestReview: {
                            id: reviewId,
                            state: 'PENDING',
                            body: pendingReviewBody(head),
                            commit: { oid: head },
                            author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
                        },
                    },
                },
            });
        });
        expect(ghCalls).toHaveLength(1);
        expect(ghCalls[0]).toContain(`reviewId=${reviewId}`);
        expect(ghCalls[0]).toContain(`clientMutationId=${reviewId}`);
    });
    it.each([
        [
            'missing review',
            { data: { deletePullRequestReview: { clientMutationId: reviewId, pullRequestReview: null } } },
        ],
        [
            'non-pending review',
            {
                data: {
                    deletePullRequestReview: {
                        clientMutationId: reviewId,
                        pullRequestReview: {
                            id: reviewId,
                            state: 'COMMENTED',
                            body: pendingReviewBody(head),
                            commit: { oid: head },
                            author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
                        },
                    },
                },
            },
        ],
        [
            'foreign author review',
            {
                data: {
                    deletePullRequestReview: {
                        clientMutationId: reviewId,
                        pullRequestReview: {
                            id: reviewId,
                            state: 'PENDING',
                            body: pendingReviewBody(head),
                            commit: { oid: head },
                            author: { id: REVIEWER_BOT_NODE_ID, login: 'renamed-reviewer', __typename: 'Bot' },
                        },
                    },
                },
            },
        ],
        [
            'mismatched receipt id',
            {
                data: {
                    deletePullRequestReview: {
                        clientMutationId: reviewId,
                        pullRequestReview: {
                            id: 'PRR_other',
                            state: 'PENDING',
                            body: pendingReviewBody(head),
                            commit: { oid: head },
                            author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
                        },
                    },
                },
            },
        ],
        [
            'null client mutation',
            {
                data: {
                    deletePullRequestReview: {
                        clientMutationId: null,
                        pullRequestReview: {
                            id: reviewId,
                            state: 'PENDING',
                            body: pendingReviewBody(head),
                            commit: { oid: head },
                            author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
                        },
                    },
                },
            },
        ],
        [
            'mismatched client mutation',
            {
                data: {
                    deletePullRequestReview: {
                        clientMutationId: 'wrong',
                        pullRequestReview: {
                            id: reviewId,
                            state: 'PENDING',
                            body: pendingReviewBody(head),
                            commit: { oid: head },
                            author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
                        },
                    },
                },
            },
        ],
    ])('rejects a %s delete-pending-review receipt', (_case, response) => {
        expect(() => deletePendingReview(reviewId, () => JSON.stringify(response))).toThrow(
            /delete pending review returned an invalid result/i
        );
    });
    it('parses submit-review receipts with commit and Bot actor metadata', () => {
        const ghCalls: string[][] = [];
        const receipt = submitReview(reviewId, resolutionReviewSummary(pullRequestId, threadId, head), (args) => {
            ghCalls.push(args);
            return JSON.stringify({
                data: {
                    submitPullRequestReview: {
                        clientMutationId: `review-submit:${reviewId}`,
                        pullRequestReview: {
                            id: reviewId,
                            state: 'COMMENTED',
                            body: resolutionReviewSummary(pullRequestId, threadId, head),
                            commit: { oid: head },
                            author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
                        },
                    },
                },
            });
        });
        expect(receipt).toEqual({
            id: reviewId,
            state: 'COMMENTED',
            body: resolutionReviewSummary(pullRequestId, threadId, head),
            commitOid: head,
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author',
            authorType: 'Bot',
            clientMutationId: `review-submit:${reviewId}`,
        });
        expect(ghCalls).toEqual([
            expect.arrayContaining(['-F', `reviewId=${reviewId}`, '-f', `clientMutationId=review-submit:${reviewId}`]),
        ]);
    });
    it.each([
        [
            'null client mutation',
            {
                data: {
                    submitPullRequestReview: {
                        clientMutationId: null,
                        pullRequestReview: {
                            id: reviewId,
                            state: 'COMMENTED',
                            body: resolutionReviewSummary(pullRequestId, threadId, head),
                            commit: { oid: head },
                            author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
                        },
                    },
                },
            },
        ],
        [
            'mismatched client mutation',
            {
                data: {
                    submitPullRequestReview: {
                        clientMutationId: 'wrong',
                        pullRequestReview: {
                            id: reviewId,
                            state: 'COMMENTED',
                            body: resolutionReviewSummary(pullRequestId, threadId, head),
                            commit: { oid: head },
                            author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
                        },
                    },
                },
            },
        ],
    ])('rejects a %s submit-review receipt', (_case, response) => {
        expect(() =>
            submitReview(reviewId, resolutionReviewSummary(pullRequestId, threadId, head), () =>
                JSON.stringify(response)
            )
        ).toThrow(/submit review returned an invalid result/i);
    });
    it('rejects a mixed-snapshot thread pagination head change before inspecting comments', () => {
        let call = 0;
        expect(() =>
            inspectReviewThread(42, threadId, () => {
                call += 1;
                if (call === 1) {
                    return threadPage([], true, 'threads-1', head);
                }
                return threadPage([{ id: threadId, isResolved: false }], false, null, movedHead);
            })
        ).toThrow(/head changed while reading review threads/i);
    });
    it('rejects a review-thread page whose pull-request node changes even when the head stays the same', () => {
        let call = 0;
        expect(() =>
            inspectReviewThread(42, threadId, () => {
                call += 1;
                if (call === 1) {
                    return threadPage([], true, 'threads-1', head);
                }
                return JSON.stringify({
                    data: {
                        repository: {
                            pullRequest: {
                                id: 'PR_kwDOOtherPullRequest',
                                headRefOid: head,
                                reviewThreads: {
                                    nodes: [{ id: threadId, isResolved: false }],
                                    pageInfo: { hasNextPage: false, endCursor: null },
                                },
                            },
                        },
                    },
                });
            })
        ).toThrow(/pull-request changed while reading review threads/i);
    });
    it('finds the requested thread on a later page and paginates its comments', () => {
        let call = 0;
        const calls: string[][] = [];
        const inspection = inspectReviewThread(42, threadId, (args) => {
            calls.push(args);
            call += 1;
            if (call === 1) {
                return threadPage([], true, 'threads-1');
            }
            if (call === 2) {
                return threadPage([{ id: threadId, isResolved: false }], false, null);
            }
            if (call === 3) {
                return commentPage([root], false, null);
            }
            if (call === 4) {
                return reviewPage([], false, null);
            }
            return threadResolutionPage();
        });
        expect(inspection).toMatchObject({
            pullRequestId,
            head,
            thread: { id: threadId, rootCommentFullDatabaseId: '9223372036854775807' },
            pendingReviews: [],
        });
        expect(call).toBe(5);
    });
    it('retains linked author review metadata from inspected Done comments', () => {
        let call = 0;
        const linkedReply = {
            id: replyId,
            fullDatabaseId: '9223372036854775808',
            body: 'Done',
            author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
            pullRequestReview: {
                id: reviewId,
                state: 'COMMENTED',
                body: resolutionReviewSummary(pullRequestId, threadId, head),
                commit: { oid: head },
                author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
            },
        };
        const inspection = inspectReviewThread(42, threadId, () => {
            call += 1;
            if (call === 1) {
                return threadPage([{ id: threadId, isResolved: false }], false, null);
            }
            if (call === 2) {
                return commentPage([root, linkedReply], false, null);
            }
            if (call === 3) {
                return reviewPage([], false, null);
            }
            return threadResolutionPage();
        });
        expect(inspection.thread?.comments[1]).toEqual({
            id: replyId,
            fullDatabaseId: '9223372036854775808',
            body: 'Done',
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author',
            authorType: 'Bot',
            reviewId,
            reviewState: 'COMMENTED',
            reviewBody: resolutionReviewSummary(pullRequestId, threadId, head),
            reviewCommitOid: head,
            reviewAuthorNodeId: AUTHOR_BOT_NODE_ID,
            reviewAuthorLogin: 'renamed-author',
            reviewAuthorType: 'Bot',
        });
    });
    it('reads the full attached-thread set for a review across two-thread history', () => {
        const repository = createTemporaryGitRepository();
        const targetLinkedReply = {
            id: replyId,
            fullDatabaseId: '9223372036854775808',
            body: 'Done',
            author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
            pullRequestReview: {
                id: reviewId,
                state: 'COMMENTED',
                body: '',
                commit: { oid: head },
                author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
            },
        };
        const otherRoot = {
            id: 'PRRC_other_root',
            fullDatabaseId: '9223372036854775817',
            body: 'other review',
            author: { id: REVIEWER_BOT_NODE_ID, login: 'renamed-reviewer', __typename: 'Bot' },
        };
        const otherLinkedReply = {
            id: 'PRRC_other_reply',
            fullDatabaseId: '9223372036854775818',
            body: 'Done',
            author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
            pullRequestReview: {
                id: reviewId,
                state: 'COMMENTED',
                body: '',
                commit: { oid: head },
                author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
            },
        };
        const fakeGh = createFakeGhExecutable({
            'threads:': threadPage([{ id: threadId, isResolved: false }], true, 'cursor-1'),
            'threads:cursor-1': threadPage([{ id: otherThreadId, isResolved: false }], false, null),
            [`comments:${threadId}:`]: commentPage([root, targetLinkedReply], false, null),
            [`comments:${otherThreadId}:`]: commentPage(
                [otherRoot, otherLinkedReply],
                false,
                null,
                otherThreadId,
                head,
                pullRequestId,
                { isResolved: false, resolvedBy: null }
            ),
        });
        const port = shellPort(
            {
                configDir: repository,
                env: { SOURDAW_TRUSTED_GH_PATH: fakeGh.executable },
                dispose() {},
            },
            repository
        );
        try {
            expect(
                port
                    .inspectAttachedReviewThreadIds(42, reviewId, pullRequestId, head)
                    .sort((left, right) => left.localeCompare(right))
            ).toEqual([threadId, otherThreadId].sort((left, right) => left.localeCompare(right)));
        } finally {
            rmSync(repository, { recursive: true, force: true });
            rmSync(fakeGh.root, { recursive: true, force: true });
        }
    });
    it('parses non-empty pending review pages with commit and Bot actor metadata', () => {
        let call = 0;
        const inspection = inspectReviewThread(42, threadId, () => {
            call += 1;
            if (call === 1) {
                return threadPage([{ id: threadId, isResolved: false }], false, null);
            }
            if (call === 2) {
                return commentPage([root], false, null);
            }
            if (call === 3) {
                return reviewPage(
                    [
                        {
                            id: reviewId,
                            state: 'PENDING',
                            body: resolutionReviewSummary(pullRequestId, threadId, head),
                            commit: { oid: head },
                            author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
                        },
                    ],
                    false,
                    null
                );
            }
            return threadResolutionPage();
        });
        expect(inspection.pendingReviews).toEqual([
            {
                id: reviewId,
                state: 'PENDING',
                body: resolutionReviewSummary(pullRequestId, threadId, head),
                commitOid: head,
                authorNodeId: AUTHOR_BOT_NODE_ID,
                authorLogin: 'renamed-author',
                authorType: 'Bot',
            },
        ]);
    });
    it('paginates pending review pages and retains all pending review metadata', () => {
        let call = 0;
        const calls: string[][] = [];
        const inspection = inspectReviewThread(42, threadId, (args) => {
            calls.push(args);
            call += 1;
            if (call === 1) {
                return threadPage([{ id: threadId, isResolved: false }], false, null);
            }
            if (call === 2) {
                return commentPage([root], false, null);
            }
            if (call === 3) {
                return reviewPage(
                    [
                        {
                            id: reviewId,
                            state: 'PENDING',
                            body: resolutionReviewSummary(pullRequestId, threadId, head),
                            commit: { oid: head },
                            author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
                        },
                    ],
                    true,
                    'reviews-1'
                );
            }
            if (call === 4) {
                return reviewPage(
                    [
                        {
                            id: 'PRR_pending_1',
                            state: 'PENDING',
                            body: resolutionReviewSummary(pullRequestId, threadId, movedHead),
                            commit: { oid: movedHead },
                            author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
                        },
                    ],
                    false,
                    null
                );
            }
            return threadResolutionPage();
        });
        expect(inspection.pendingReviews).toEqual([
            {
                id: reviewId,
                state: 'PENDING',
                body: resolutionReviewSummary(pullRequestId, threadId, head),
                commitOid: head,
                authorNodeId: AUTHOR_BOT_NODE_ID,
                authorLogin: 'renamed-author',
                authorType: 'Bot',
            },
            {
                id: 'PRR_pending_1',
                state: 'PENDING',
                body: resolutionReviewSummary(pullRequestId, threadId, movedHead),
                commitOid: movedHead,
                authorNodeId: AUTHOR_BOT_NODE_ID,
                authorLogin: 'renamed-author',
                authorType: 'Bot',
            },
        ]);
        expect(calls[3]).toContain('cursor=reviews-1');
    });
    it('rejects a mixed-snapshot pending review pagination head change on a later page', () => {
        let call = 0;
        expect(() =>
            inspectReviewThread(42, threadId, () => {
                call += 1;
                if (call === 1) {
                    return threadPage([{ id: threadId, isResolved: false }], false, null);
                }
                if (call === 2) {
                    return commentPage([root], false, null);
                }
                if (call === 3) {
                    return reviewPage([], true, 'reviews-1', head);
                }
                return reviewPage([], false, null, movedHead);
            })
        ).toThrow(/head changed while reading reviews/i);
    });
    it('rejects partial GraphQL data with errors before accepting a review thread', () => {
        expect(() =>
            inspectReviewThread(42, threadId, () =>
                JSON.stringify({
                    data: {
                        repository: {
                            pullRequest: {
                                headRefOid: head,
                                reviewThreads: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
                            },
                        },
                    },
                    errors: [{ message: 'partial failure' }],
                })
            )
        ).toThrow(/invalid GraphQL envelope/i);
    });
    it('proves absence only after the final thread page', () => {
        let call = 0;
        const inspection = inspectReviewThread(42, threadId, () => {
            call += 1;
            if (call <= 2) {
                return threadPage([], call === 1, call === 1 ? 'threads-1' : null);
            }
            return reviewPage([], false, null);
        });
        expect(inspection).toEqual({ pullRequestId, head, thread: null, pendingReviews: [] });
        expect(call).toBe(3);
    });
    it('finds and retains a created reply beyond 100 comments', () => {
        const first = Array.from({ length: 100 }, (_, index) => ({
            id: `PRRC_${index}`,
            fullDatabaseId: String(index + 1),
            body: 'old',
            author: { id: REVIEWER_BOT_NODE_ID, login: 'renamed-reviewer' },
        }));
        first[0] = root;
        const later = {
            id: replyId,
            fullDatabaseId: '9223372036854775808',
            body: 'Done',
            author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author' },
        };
        let call = 0;
        const calls: string[][] = [];
        const inspection = inspectReviewThread(42, threadId, (args) => {
            calls.push(args);
            call += 1;
            if (call === 1) {
                return threadPage([{ id: threadId, isResolved: false }], false, null);
            }
            if (call === 2) {
                return commentPage(first, true, 'comments-1');
            }
            if (call === 3) {
                return commentPage([later], false, null);
            }
            if (call === 4) {
                return reviewPage([], false, null);
            }
            return threadResolutionPage();
        });
        expect(inspection.thread?.comments).toHaveLength(101);
        expect(inspection.thread?.comments.at(-1)?.id).toBe(replyId);
        expect(calls[2]).toContain('cursor=comments-1');
    });
    it('rejects a mixed-snapshot comment pagination head change on a later page', () => {
        let call = 0;
        expect(() =>
            inspectReviewThread(42, threadId, () => {
                call += 1;
                if (call === 1) {
                    return threadPage([{ id: threadId, isResolved: false }], false, null, movedHead);
                }
                if (call === 2) {
                    return commentPage([root], true, 'comments-1', threadId, movedHead);
                }
                return commentPage([], false, null, threadId, 'c'.repeat(40));
            })
        ).toThrow(/head changed while reading review comments/i);
    });
    it('rejects a requested-thread comment page whose pull-request node changes even when the head stays the same', () => {
        let call = 0;
        expect(() =>
            inspectReviewThread(42, threadId, () => {
                call += 1;
                if (call === 1) {
                    return threadPage([{ id: threadId, isResolved: false, resolvedBy: null }], false, null, movedHead);
                }
                return commentPage([root], false, null, threadId, movedHead, 'PR_kwDOOtherPullRequest');
            })
        ).toThrow(/head changed while reading review comments/i);
    });
    it('rejects a same-head resolve-state drift between the outer thread page and inner comment snapshot', () => {
        let call = 0;
        expect(() =>
            inspectReviewThread(42, threadId, () => {
                call += 1;
                if (call === 1) {
                    return threadPage(
                        [
                            {
                                id: threadId,
                                isResolved: true,
                                resolvedBy: {
                                    id: AUTHOR_BOT_NODE_ID,
                                    login: 'renamed-author',
                                    __typename: 'User',
                                },
                            },
                        ],
                        false,
                        null,
                        movedHead
                    );
                }
                if (call === 2) {
                    return commentPage([root], false, null, threadId, movedHead, pullRequestId, {
                        isResolved: false,
                        resolvedBy: null,
                    });
                }
                return reviewPage([], false, null, movedHead);
            })
        ).toThrow(/changed while reading review comments/i);
    });
    it('rejects a same-head resolve-state drift that appears only after multi-page pending-review pagination', () => {
        let call = 0;
        expect(() =>
            inspectReviewThread(42, threadId, () => {
                call += 1;
                if (call === 1) {
                    return threadPage(
                        [
                            {
                                id: threadId,
                                isResolved: true,
                                resolvedBy: {
                                    id: AUTHOR_BOT_NODE_ID,
                                    login: 'renamed-author',
                                    __typename: 'User',
                                },
                            },
                        ],
                        false,
                        null,
                        movedHead
                    );
                }
                if (call === 2) {
                    return commentPage([root], false, null, threadId, movedHead, pullRequestId, {
                        isResolved: true,
                        resolvedBy: {
                            id: AUTHOR_BOT_NODE_ID,
                            login: 'renamed-author',
                            __typename: 'User',
                        },
                    });
                }
                if (call === 3) {
                    return reviewPage([], true, 'reviews-1', movedHead);
                }
                if (call === 4) {
                    return reviewPage([], false, null, movedHead);
                }
                return threadResolutionPage(threadId, movedHead, pullRequestId, {
                    isResolved: false,
                    resolvedBy: null,
                });
            })
        ).toThrow(/changed while reading reviews/i);
    });
    it.each([
        ['repeated', 'comments-1'],
        ['empty', ''],
    ])('fails closed on a %s comment cursor', (_case, cursor) => {
        let call = 0;
        expect(() =>
            inspectReviewThread(42, threadId, () => {
                call += 1;
                if (call === 1) {
                    return threadPage([{ id: threadId, isResolved: false }], false, null);
                }
                return commentPage([], true, cursor);
            })
        ).toThrow(/pagination/i);
    });
    it('parses strict arguments', () => {
        expect(parseResolveReviewThreadArgs(['42', '--thread', threadId, '--head', head])).toMatchObject({
            number: 42,
            threadId,
            head,
        });
        expect(parseResolveReviewThreadArgs(['42', '--thread', threadId, '--head', head.toUpperCase()])).toMatchObject({
            number: 42,
            threadId,
            head,
        });
        for (const args of [
            [],
            ['42', '--head', head, '--thread', threadId],
            ['42', '--thread', threadId, '--head', 'bad'],
        ]) {
            expect(() => parseResolveReviewThreadArgs(args)).toThrow(/usage/i);
        }
    });
    it('parses review-resolution recovery arguments and refuses non-bootstrap execution by default', async () => {
        const ownerOid = 'a'.repeat(40);
        expect(parseRecoverReviewResolutionLockArgs(['42', '--owner', ownerOid])).toMatchObject({
            number: 42,
            owner: ownerOid,
        });
        expect(parseRecoverReviewResolutionLockArgs(['42', '--owner', ownerOid.toUpperCase()])).toMatchObject({
            number: 42,
            owner: ownerOid,
        });
        for (const args of [[], ['42', '--thread', threadId, '--owner', ownerOid], ['42', '--owner', 'bad']]) {
            expect(() => parseRecoverReviewResolutionLockArgs(args)).toThrow(/usage/i);
        }
        await expect(runRecoverReviewResolutionLockCli(['42', '--owner', ownerOid])).rejects.toThrow(
            /protected primary checkout launcher/i
        );
    });
    it.each([
        ['reviewer actor', REVIEWER_BOT_NODE_ID],
        ['unexpected actor', 'BOT_other'],
    ])(
        'rejects recovery when authenticateAuthor returns a %s before repository or lock work',
        async (_label, actorNodeId) => {
            const repository = createTemporaryGitRepository();
            try {
                const ownerOid = writeLockOwnerBlob(repository, 999999);
                updateLock(repository, 42, ownerOid);
                const calls: string[] = [];
                const session: GhSession = { configDir: repository, env: {}, dispose() {} };
                await expect(
                    runRecoverReviewResolutionLockCli(['42', '--owner', ownerOid], {
                        trustedPrimaryRoot: () => {
                            calls.push('trustedPrimaryRoot');
                            return repository;
                        },
                        authenticateAuthor: async () => {
                            calls.push('authenticateAuthor');
                            return { minted: { actorNodeId }, session };
                        },
                        repositoryName: () => {
                            calls.push('repositoryName');
                            return REQUIRED_REPOSITORY;
                        },
                        gh: () => {
                            calls.push('gh');
                            return () => '';
                        },
                        inspectThread: () => {
                            calls.push('inspectThread');
                            return {
                                pullRequestId,
                                head,
                                thread: null,
                                pendingReviews: [],
                            };
                        },
                        createPort: () => {
                            calls.push('createPort');
                            return fakePort().port;
                        },
                        recoverLock: <Value>() => {
                            calls.push('recoverLock');
                            return 'recovered' as Value;
                        },
                    })
                ).rejects.toThrow(/minted actor .* is not/i);
                expect(calls).toEqual(['trustedPrimaryRoot', 'authenticateAuthor']);
                expect(readLockOid(repository, 42)).toBe(ownerOid);
            } finally {
                rmSync(repository, { recursive: true, force: true });
            }
        }
    );
    it('refuses direct review-resolution execution even with forged trusted-launcher env and no bootstrap capability', async () => {
        await withTemporaryEnvironmentAsync(
            {
                SOURDAW_TRUSTED_PRIMARY_ROOT: '/tmp/forged-primary',
                SOURDAW_TRUSTED_ORIGIN_COMMIT: head,
                SOURDAW_TRUSTED_GIT_PATH: trustedGitPath,
                SOURDAW_TRUSTED_GH_PATH: trustedGhPath,
            },
            async () => {
                await expect(runRecoverReviewResolutionLockCli(['42', '--owner', 'a'.repeat(40)])).rejects.toThrow(
                    /protected primary checkout launcher/i
                );
                await expect(runResolveReviewThreadCli(['42', '--thread', threadId, '--head', head])).rejects.toThrow(
                    /protected primary checkout launcher/i
                );
            }
        );
    });
    it.each([
        ['relative', 'ps'],
        [
            'non-normalized',
            `${dirname(trustedPsPath)}/../${basename(dirname(trustedPsPath))}/${basename(trustedPsPath)}`,
        ],
    ])(
        'rejects a detached launcher capability carrying a %s ps path before lock acquisition',
        async (_label, psPath) => {
            const repository = createTemporaryGitRepository();
            const snapshotRoot = mkdtempSync(join(tmpdir(), 'sourdaw-review-resolve-invalid-ps-capability-'));
            const markerRoot = mkdtempSync(join(tmpdir(), 'sourdaw-review-resolve-invalid-ps-marker-'));
            const entryPath = writeResolveReviewSnapshot(snapshotRoot);
            const token = '11111111-1111-4111-8111-111111111111';
            const markerPath = join(markerRoot, 'child-marker.json');
            const capabilityPath = join(markerRoot, 'bootstrap-capability.json');
            writeFileSync(
                capabilityPath,
                JSON.stringify({
                    version: 1,
                    token,
                    trustedLauncher: {
                        primaryRoot: repository,
                        gitPath: trustedGitPath,
                        ghPath: trustedGhPath,
                        psPath,
                    },
                }),
                { encoding: 'utf8', mode: 0o600 }
            );
            publishReviewResolutionChildLaunchMarker(markerPath, token, null, capabilityPath);
            const child = spawn(process.execPath, [entryPath, '42', '--thread', threadId, '--head', head], {
                cwd: repository,
                env: {
                    ...process.env,
                    SOURDAW_TEST_PRIMARY_ROOT: repository,
                    SOURDAW_TEST_TRUSTED_GIT_PATH: trustedGitPath,
                    SOURDAW_TRUSTED_ORIGIN_COMMIT: head,
                    SOURDAW_REVIEW_RESOLUTION_CHILD: JSON.stringify({ path: markerPath, token }),
                },
                stdio: ['ignore', 'ignore', 'pipe'],
                shell: false,
                detached: true,
            });
            let stderr = '';
            child.stderr?.setEncoding('utf8');
            child.stderr?.on('data', (chunk: string) => {
                stderr += chunk;
            });
            try {
                if (child.pid === undefined) {
                    throw new Error('child pid is unavailable');
                }
                publishReviewResolutionChildLaunchMarker(markerPath, token, child.pid, capabilityPath);
                await waitForProcessExitWithoutReviewResolutionLock(child, repository, 42);
                await waitForExit(child);
                expect(child.exitCode).toBe(1);
                expect(stderr).toMatch(/protected primary checkout launcher/i);
                expect(readLockOid(repository, 42)).toBeUndefined();
            } finally {
                child.kill('SIGKILL');
                await waitForExit(child).catch(() => undefined);
                rmSync(markerRoot, { recursive: true, force: true });
                rmSync(snapshotRoot, { recursive: true, force: true });
                rmSync(repository, { recursive: true, force: true });
            }
        },
        10_000
    );
    it.each([
        ['wrong head', { heads: [movedHead] }],
        ['wrong author', { rootAuthorNodeId: 'BOT_other' }],
        ['resolved', { isResolved: true }],
    ])('refuses %s with zero mutations', (_name, input) => {
        const { port, calls, authorNodeId } = fakePort(input);
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow();
        expect(calls.filter((call) => !call.startsWith('inspect:'))).toEqual([]);
    });
    it('refuses the wrong actor with zero mutations', () => {
        const { port, calls } = fakePort();
        expect(() => resolveReviewThread(42, threadId, head, REVIEWER_BOT_NODE_ID, port)).toThrow(/author/i);
        expect(calls).toEqual([]);
    });
    it('creates a pending review, attaches Done to it, submits a non-empty COMMENT review, and resolves', () => {
        const { port, calls, authorNodeId, state } = fakePort();
        expect(resolveReviewThread(42, threadId, head, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls).toEqual([
            'inspect:1',
            `createReview:${pullRequestId}`,
            'inspect:2',
            `reply:${threadId}:${reviewId}`,
            'inspect:3',
            `submitReview:${reviewId}`,
            'inspect:4',
            'inspect:5',
            `resolve:${threadId}`,
            'inspect:6',
            `log:review-thread-resolved:42:${threadId}`,
        ]);
        expect(state().comments.find((comment) => comment.id === replyId)?.reviewId).toBe(reviewId);
        expectCanonicalResolutionReview(state().reviews[0]!);
    });
    it('accepts an uppercase head input and still writes lowercase public resolution records', () => {
        const uppercaseHead = head.toUpperCase();
        const { port, authorNodeId, state } = fakePort();
        expect(resolveReviewThread(42, threadId, uppercaseHead, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expectCanonicalResolutionReview(state().reviews[0]!, head);
        expect(state().reviews[0]?.body).toContain(`head:${head}`);
        expect(state().reviews[0]?.body).not.toContain(`head:${uppercaseHead}`);
    });
    it('rejects a mismatched reply client receipt before submit or resolve', () => {
        const { port, calls, authorNodeId } = fakePort({ replyClientMutationId: 'wrong' });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(/reply returned an invalid/i);
        expect(calls.filter((call) => call.startsWith('submitReview:') || call.startsWith('resolve:'))).toEqual([]);
    });
    it('rejects a User-typed reply receipt before submit, resolve, or success', () => {
        const { port, calls, authorNodeId } = fakePort({ replyAuthorType: 'User' });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(/reply returned an invalid/i);
        expect(
            calls.filter(
                (call) => call.startsWith('submitReview:') || call.startsWith('resolve:') || call.startsWith('log:')
            )
        ).toEqual([]);
    });
    it('rejects a Done reply receipt attached to the wrong pending review before submit or resolve', () => {
        const { port, calls, authorNodeId, state } = fakePort({
            replyReceiptReviewId: 'PRR_wrong_pending',
        });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(/staged author review/i);
        expect(calls.filter((call) => call.startsWith('submitReview:') || call.startsWith('resolve:'))).toEqual([]);
        expect(state().reviews).toEqual([
            expect.objectContaining({ id: reviewId, state: 'PENDING' }),
            expect.objectContaining({ id: 'PRR_wrong_pending', state: 'PENDING' }),
        ]);
    });
    it('rejects a mismatched resolve client receipt without accepting state ownership', () => {
        const { port, calls, authorNodeId } = fakePort({ resolveClientMutationId: 'wrong' });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /resolve review thread returned an invalid/i
        );
        expect(calls.filter((call) => call.startsWith('unresolve:'))).toEqual([]);
    });
    it.each([
        ['wrong typename', { resolveReceiptType: 'Bot' }],
        ['wrong actor ID', { resolveReceiptNodeId: 'BOT_other' }],
    ])('rejects a resolve receipt with %s before success', (_case, input) => {
        const { port, calls, authorNodeId } = fakePort(input);
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /resolve review thread returned an invalid/i
        );
        expect(calls.filter((call) => call.startsWith('log:'))).toEqual([]);
    });
    it('repairs an empty submitted resolution review before resolving an existing Done marker', () => {
        const { port, calls, authorNodeId, state } = fakePort({
            existingReplyCount: 1,
            existingReplyReviewBody: '',
        });
        expect(resolveReviewThread(42, threadId, head, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('reply:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('updateReview:'))).toEqual([`updateReview:${reviewId}`]);
        expect(calls.filter((call) => call.startsWith('resolve:'))).toEqual([`resolve:${threadId}`]);
        expectCanonicalResolutionReview(state().reviews[0]!);
    });
    it('fails closed before backfilling an empty managed review that is still attached on another thread', () => {
        const { port, calls, authorNodeId } = fakePort({
            existingReplyCount: 1,
            existingReplyReviewBody: '',
            attachedReviewThreadIdsByReviewId: { [reviewId]: [otherThreadId] },
        });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            `pending author review ${reviewId} still has attached review-thread comments on ${otherThreadId}`
        );
        expect(calls.filter((call) => call.startsWith('inspectAttachedReviewThreads:'))).toEqual([
            `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${head}`,
        ]);
        expect(calls.filter((call) => call.startsWith('updateReview:') || call.startsWith('resolve:'))).toEqual([]);
    });
    it('backfills and submits a whitespace-only pending resolution review before resolving an existing Done marker', () => {
        const { port, calls, authorNodeId, state } = fakePort({
            existingReplyCount: 1,
            existingReplyReviewState: 'PENDING',
            existingReplyReviewBody: '  \n\t  ',
        });
        expect(resolveReviewThread(42, threadId, head, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('createReview:') || call.startsWith('reply:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('updateReview:'))).toEqual([`updateReview:${reviewId}`]);
        expect(calls.filter((call) => call.startsWith('submitReview:'))).toEqual([`submitReview:${reviewId}`]);
        expect(calls.filter((call) => call.startsWith('resolve:'))).toEqual([`resolve:${threadId}`]);
        expect(state().comments.filter((comment) => comment.body === 'Done')).toEqual([
            expect.objectContaining({ id: replyId, reviewId }),
        ]);
        expectCanonicalResolutionReview(state().reviews[0]!);
    });
    it('rejects a reviewer-owned empty COMMENTED envelope linked to an author Done marker without trying to update it', () => {
        const { port, calls, authorNodeId } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            existingReplyReviewBody: '',
            existingReplyReviewAuthorNodeId: REVIEWER_BOT_NODE_ID,
            existingReplyReviewAuthorType: 'Bot',
        });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(/non-author review/i);
        expect(calls).toEqual(['inspect:1']);
    });
    it('backfills an already resolved empty author review using its original review head, not the current PR head', () => {
        const { port, calls, authorNodeId, state } = fakePort({
            heads: [movedHead, movedHead],
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            existingReplyReviewBody: '',
            existingReplyReviewCommitOid: head,
        });
        expect(resolveReviewThread(42, threadId, movedHead, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls).toEqual([
            'inspect:1',
            `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${head}`,
            `updateReview:${reviewId}`,
            'inspect:2',
            `log:review-thread-resolved:42:${threadId}`,
        ]);
        expect(calls.filter((call) => call.startsWith('reply:'))).toEqual([]);
        expectCanonicalResolutionReview(state().reviews[0]!, head);
        expect(state().resolved).toBe(true);
    });
    it('backfills and submits an already resolved whitespace-only author review without creating another marker', () => {
        const { port, calls, authorNodeId, state } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            existingReplyReviewState: 'PENDING',
            existingReplyReviewBody: ' \n\t ',
        });
        expect(resolveReviewThread(42, threadId, head, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls).toEqual([
            'inspect:1',
            `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${head}`,
            `updateReview:${reviewId}`,
            'inspect:2',
            `submitReview:${reviewId}`,
            'inspect:3',
            `log:review-thread-resolved:42:${threadId}`,
        ]);
        expect(state().comments.filter((comment) => comment.body === 'Done')).toEqual([
            expect.objectContaining({ id: replyId, reviewId }),
        ]);
        expectCanonicalResolutionReview(state().reviews[0]!);
        expect(state().resolved).toBe(true);
    });
    const invalidCompletedResolutionMarkerCases = [
        [
            'foreign Bot review',
            { secondaryReplyReviewAuthorNodeId: REVIEWER_BOT_NODE_ID, secondaryReplyReviewAuthorType: 'Bot' },
            /non-author review/i,
        ],
        ['unreadable review', { secondaryReplyReviewMissing: true }, /readable pull-request review/i],
        ['unsupported review state', { secondaryReplyReviewState: 'APPROVED' as const }, /unsupported review state/i],
        [
            'noncanonical author review',
            { secondaryReplyReviewBody: 'not the managed resolution review body' },
            /noncanonical author review/i,
        ],
    ] satisfies [string, Partial<Input>, RegExp][];
    it.each(invalidCompletedResolutionMarkerCases)(
        'rejects an already resolved thread with a valid empty marker plus a %s before any mutation',
        (_case, input, errorPattern) => {
            const { port, calls, authorNodeId } = fakePort({
                isResolved: true,
                initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
                initialResolvedByType: 'User',
                existingReplyCount: 2,
                existingReplyReviewBody: '',
                ...input,
            });
            expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(errorPattern);
            expect(
                calls.filter(
                    (call) =>
                        call.startsWith('updateReview:') ||
                        call.startsWith('submitReview:') ||
                        call.startsWith('delete:') ||
                        call.startsWith('deleteReview:') ||
                        call.startsWith('resolve:') ||
                        call.startsWith('log:')
                )
            ).toEqual([]);
        }
    );
    it('fails without success when the exact receipt reply disappears before final inspection', () => {
        const { port, calls, authorNodeId } = fakePort({ deleteReplyAfterResolve: true });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(/reply receipt/i);
        expect(calls.filter((call) => call.startsWith('unresolve:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('log:'))).toEqual([]);
    });
    it('does not unresolve a thread whose resolution marker changed concurrently', () => {
        const { port, calls, authorNodeId, state } = fakePort({ resolvedByNodeIdAfterResolve: 'BOT_other' });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(/not resolved by/i);
        expect(calls.filter((call) => call.startsWith('unresolve:'))).toEqual([]);
        expect(state().resolved).toBe(true);
    });
    it.each([
        ['node ID', { resolvedByNodeIdAfterResolve: 'BOT_other' }, /not resolved by/i],
        ['login', { resolvedByLoginAfterResolve: 'other-author' }, /changed while reading resolution confirmation/i],
        ['typename', { resolvedByTypeAfterResolve: 'Bot' }, /not resolved by/i],
    ])('rejects terminal same-isResolved resolvedBy %s drift before success', (_case, input, pattern) => {
        const { port, calls, authorNodeId, state } = fakePort(input);
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(pattern);
        expect(calls.filter((call) => call.startsWith('log:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('unresolve:'))).toEqual([]);
        expect(state().resolved).toBe(true);
    });
    it('does not unresolve a same-identity resolution after its final head check fails', () => {
        const { port, calls, authorNodeId, state } = fakePort({
            heads: [head, head, head, head, head, movedHead],
        });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(/head moved/i);
        expect(calls.filter((call) => call.startsWith('unresolve:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        expect(state()).toMatchObject({ resolved: true, comments: [{ id: rootId }, { id: replyId, body: 'Done' }] });
    });
    it('does not delete an edited reply during a failed receipted resolution', () => {
        const { port, calls, authorNodeId, state } = fakePort({
            heads: [head, head, head, head, head, movedHead],
            editReplyAfterResolve: true,
            resolvedByNodeIdAfterResolve: AUTHOR_BOT_NODE_ID,
        });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(/head moved/i);
        expect(calls.filter((call) => call.startsWith('unresolve:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        expect(state().comments.find((comment) => comment.id === replyId)?.body).toBe('Edited');
    });
    it('preserves the exact created pending review when the head moves before replying', () => {
        const { port, authorNodeId, state, calls } = fakePort({ heads: [head, movedHead, movedHead] });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(/head moved/i);
        expect(state().reviews).toEqual([expect.objectContaining({ id: reviewId, state: 'PENDING', commitOid: head })]);
        expect(state().comments).toEqual([expect.objectContaining({ id: rootId, reviewId: null })]);
        expect(calls.filter((call) => call.startsWith('deleteReview:'))).toEqual([]);
    });
    it('does not attempt successful-create cleanup deletion after head drift when the pending review could be attached concurrently', () => {
        const { port, authorNodeId, state, calls } = fakePort({
            heads: [head, movedHead, movedHead],
            attachConcurrentManagedPendingReplyDuringPendingDelete: true,
        });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(/head moved/i);
        expect(calls.filter((call) => call.startsWith('deleteReview:'))).toEqual([]);
        expect(state()).toMatchObject({
            reviews: [{ id: reviewId, state: 'PENDING', commitOid: head }],
            comments: [{ id: rootId }],
        });
    });
    it('preserves a sole Done marker when compensation sees a concurrent canonical commented resolution', () => {
        const { port, authorNodeId, state, calls } = fakePort({
            existingPendingReviewCount: 1,
            heads: [head, movedHead],
            concurrentCommentedResolvedStateOnCompensationInspect: true,
        });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /head moved[\s\S]*canonical commented review/i
        );
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        expect(state()).toMatchObject({
            resolved: true,
            comments: [{ id: rootId }, { id: replyId, body: 'Done', reviewId }],
            reviews: [
                {
                    id: reviewId,
                    state: 'COMMENTED',
                    body: resolutionReviewSummary(pullRequestId, threadId, head),
                    commitOid: head,
                },
            ],
        });
    });
    it('fails closed when a thrown reply mutation collides with an identical concurrent comment', () => {
        const { port, authorNodeId, state, calls } = fakePort({ throwAfterReply: true, concurrentReplyOnThrow: true });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /reply transport lost[\s\S]*ambiguous review reply mutation/i
        );
        expect(calls.filter((call) => call.startsWith('delete:') || call.startsWith('deleteReview:'))).toEqual([]);
        expect(state().comments.map((comment) => comment.id)).toEqual([rootId, replyId, 'PRRC_concurrent']);
    });
    it('does not unresolve a concurrent state after resolve throws without a receipt', () => {
        const { port, authorNodeId, state, calls } = fakePort({ throwResolveWithConcurrentState: true });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /resolve transport lost[\s\S]*durable evidence/i
        );
        expect(calls.filter((call) => call.startsWith('unresolve:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        expect(state().comments.find((comment) => comment.id === replyId)?.body).toBe('Done');
        expect(state().resolved).toBe(true);
    });
    it('reuses a created pending review after a lost create response', () => {
        const { port, authorNodeId, state, calls } = fakePort({ throwAfterCreatePendingReview: true });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /create review transport lost[\s\S]*ambiguous pending review/i
        );
        expect(state().reviews).toEqual([
            expect.objectContaining({
                id: reviewId,
                state: 'PENDING',
                body: resolutionReviewSummary(pullRequestId, threadId, head),
            }),
        ]);
        expect(resolveReviewThread(42, threadId, head, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('createReview:'))).toEqual([`createReview:${pullRequestId}`]);
        expectCanonicalResolutionReview(state().reviews[0]!);
    });
    it('preserves a created pending review when post-create inspection fails after another invocation attaches a Done reply', () => {
        const { port, authorNodeId, state, calls } = fakePort({
            throwInspectAfterCreatePendingReview: true,
            attachManagedReplyBeforeCompensation: true,
        });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(/inspect transport lost/i);
        expect(calls.filter((call) => call.startsWith('deleteReview:'))).toEqual([]);
        expect(state()).toMatchObject({
            reviews: [{ id: reviewId, state: 'PENDING' }],
            comments: [{ id: rootId }, { id: replyId, body: 'Done', reviewId }],
        });
    });
    it('preserves a newly visible exact pending review after lost create plus head drift when a concurrent managed Done attaches to it', () => {
        const { port, authorNodeId, state, calls } = fakePort({
            throwAfterCreatePendingReview: true,
            heads: [head, movedHead],
            attachConcurrentManagedPendingReplyAfterLostCreate: true,
        });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /create review transport lost/i
        );
        expect(calls.filter((call) => call.startsWith('deleteReview:'))).toEqual([]);
        expect(state()).toMatchObject({
            reviews: [{ id: reviewId, state: 'PENDING', commitOid: head }],
            comments: [{ id: rootId }, { id: 'PRRC_concurrent_pending', body: 'Done', reviewId }],
        });
    });
    it('submits a stale lost-create draft with an attached concurrent Done marker before creating the new-head review on retry', () => {
        const { port, authorNodeId, state, calls } = fakePort({
            throwAfterCreatePendingReview: true,
            heads: [
                head,
                movedHead,
                movedHead,
                movedHead,
                movedHead,
                movedHead,
                movedHead,
                movedHead,
                movedHead,
                movedHead,
            ],
            attachConcurrentManagedPendingReplyAfterLostCreate: true,
        });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /create review transport lost/i
        );
        expect(resolveReviewThread(42, threadId, movedHead, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('createReview:'))).toEqual([
            `createReview:${pullRequestId}`,
            `createReview:${pullRequestId}`,
        ]);
        expect(calls.filter((call) => call.startsWith('submitReview:'))).toEqual([
            `submitReview:${reviewId}`,
            'submitReview:PRR_created_1',
        ]);
        expect(calls.filter((call) => call.startsWith('deleteReview:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual(['delete:PRRC_concurrent_pending']);
        expect(state().comments.filter((comment) => comment.body === 'Done')).toEqual([
            expect.objectContaining({ reviewId: 'PRR_created_1' }),
        ]);
        expect(state().reviews).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: reviewId,
                    state: 'COMMENTED',
                    commitOid: head,
                    body: resolutionReviewSummary(pullRequestId, threadId, head),
                }),
                expect.objectContaining({
                    id: 'PRR_created_1',
                    state: 'COMMENTED',
                    commitOid: movedHead,
                    body: resolutionReviewSummary(pullRequestId, threadId, movedHead),
                }),
            ])
        );
    });
    it('backfills and submits a stale attached author pending review before creating the new-head draft', () => {
        const { port, authorNodeId, state, calls } = fakePort({
            heads: [movedHead, movedHead, movedHead, movedHead, movedHead, movedHead, movedHead, movedHead, movedHead],
            existingReplyCount: 1,
            existingReplyReviewState: 'PENDING',
            existingReplyReviewBody: '',
            existingReplyReviewCommitOid: head,
        });
        expect(resolveReviewThread(42, threadId, movedHead, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls).toEqual([
            'inspect:1',
            `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${head}`,
            `updateReview:${reviewId}`,
            'inspect:2',
            `submitReview:${reviewId}`,
            'inspect:3',
            `createReview:${pullRequestId}`,
            'inspect:4',
            `reply:${threadId}:PRR_created_1`,
            'inspect:5',
            'inspect:6',
            `submitReview:PRR_created_1`,
            'inspect:7',
            `delete:${replyId}`,
            'inspect:8',
            `resolve:${threadId}`,
            'inspect:9',
            `log:review-thread-resolved:42:${threadId}`,
        ]);
        expect(state().comments.filter((comment) => comment.body === 'Done')).toEqual([
            expect.objectContaining({ reviewId: 'PRR_created_1' }),
        ]);
        expect(state().reviews).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: reviewId,
                    state: 'COMMENTED',
                    commitOid: head,
                    body: resolutionReviewSummary(pullRequestId, threadId, head),
                }),
                expect.objectContaining({
                    id: 'PRR_created_1',
                    state: 'COMMENTED',
                    commitOid: movedHead,
                    body: resolutionReviewSummary(pullRequestId, threadId, movedHead),
                }),
            ])
        );
    });
    it('preserves a stale attached empty author pending review when its backfill update fails', () => {
        const { port, authorNodeId, state, calls } = fakePort({
            heads: [movedHead, movedHead, movedHead, movedHead],
            existingReplyCount: 1,
            existingReplyReviewState: 'PENDING',
            existingReplyReviewBody: '',
            existingReplyReviewCommitOid: head,
            failUpdateReviewBodyIds: [reviewId],
        });
        expect(() => resolveReviewThread(42, threadId, movedHead, authorNodeId, port)).toThrow(/update denied/i);
        expect(
            calls.filter(
                (call) =>
                    call.startsWith('submitReview:') ||
                    call.startsWith('createReview:') ||
                    call.startsWith('delete:') ||
                    call.startsWith('deleteReview:') ||
                    call.startsWith('resolve:') ||
                    call.startsWith('log:')
            )
        ).toEqual([]);
        expect(state()).toMatchObject({
            resolved: false,
            comments: [{ id: rootId }, { id: replyId, body: 'Done', reviewId }],
            reviews: [{ id: reviewId, state: 'PENDING', commitOid: head, body: '' }],
        });
    });
    it('preserves a stale attached empty author pending review when submit is lost after backfill', () => {
        const { port, authorNodeId, state, calls } = fakePort({
            heads: [movedHead, movedHead, movedHead, movedHead, movedHead],
            existingReplyCount: 1,
            existingReplyReviewState: 'PENDING',
            existingReplyReviewBody: '',
            existingReplyReviewCommitOid: head,
            throwAfterSubmitWithState: true,
        });
        expect(() => resolveReviewThread(42, threadId, movedHead, authorNodeId, port)).toThrow(
            /submit review transport lost[\s\S]*submitted review/i
        );
        expect(
            calls.filter(
                (call) =>
                    call.startsWith('createReview:') ||
                    call.startsWith('delete:') ||
                    call.startsWith('deleteReview:') ||
                    call.startsWith('resolve:') ||
                    call.startsWith('log:')
            )
        ).toEqual([]);
        expect(state()).toMatchObject({
            resolved: false,
            comments: [{ id: rootId }, { id: replyId, body: 'Done', reviewId }],
            reviews: [
                {
                    id: reviewId,
                    state: 'COMMENTED',
                    commitOid: head,
                    body: resolutionReviewSummary(pullRequestId, threadId, head),
                },
            ],
        });
    });
    it('preserves the sole surviving current-head Done marker after deleting an older stale marker and then failing', () => {
        const { port, authorNodeId, state, calls } = fakePort({
            heads: [movedHead, movedHead, movedHead, head, head],
            existingReplyCount: 1,
            existingReplyReviewCommitOid: head,
        });
        expect(() => resolveReviewThread(42, threadId, movedHead, authorNodeId, port)).toThrow(/head moved/i);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('deleteReview:'))).toEqual([]);
        expect(state().comments.filter((comment) => comment.body === 'Done')).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: replyId, reviewId }),
                expect.objectContaining({ id: 'PRRC_created_1', reviewId: 'PRR_created_1' }),
            ])
        );
        expect(state().reviews).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: reviewId, state: 'COMMENTED', commitOid: head }),
                expect.objectContaining({
                    id: 'PRR_created_1',
                    state: 'COMMENTED',
                    commitOid: movedHead,
                    body: resolutionReviewSummary(pullRequestId, threadId, movedHead),
                }),
            ])
        );
    });
    it('preserves a newly appeared stale pending review after lost create plus head drift, then succeeds on retry at the new head', () => {
        const { port, authorNodeId, state, calls } = fakePort({
            throwAfterCreatePendingReview: true,
            heads: [head, movedHead, movedHead, movedHead, movedHead, movedHead, movedHead, movedHead, movedHead],
        });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /create review transport lost/i
        );
        expect(state().reviews).toEqual([expect.objectContaining({ id: reviewId, state: 'PENDING', commitOid: head })]);
        expect(resolveReviewThread(42, threadId, movedHead, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('deleteReview:'))).toEqual([`deleteReview:${reviewId}`]);
        expect(calls.filter((call) => call.startsWith('createReview:'))).toEqual([
            `createReview:${pullRequestId}`,
            `createReview:${pullRequestId}`,
        ]);
        expect(calls.filter((call) => call.startsWith('submitReview:'))).toEqual([`submitReview:${reviewId}`]);
        expect(state().reviews).toEqual([
            expect.objectContaining({
                id: reviewId,
                state: 'COMMENTED',
                commitOid: movedHead,
                body: resolutionReviewSummary(pullRequestId, threadId, movedHead),
            }),
        ]);
    });
    it('preserves a pending review reply after a lost reply response, then reuses it on retry', () => {
        const { port, authorNodeId, state, calls } = fakePort({ throwAfterReply: true });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /reply transport lost[\s\S]*ambiguous review reply mutation/i
        );
        expect(state()).toMatchObject({
            resolved: false,
            comments: [{ id: rootId }, { id: replyId, body: 'Done', reviewId }],
            reviews: [{ id: reviewId, state: 'PENDING' }],
        });
        expect(calls.filter((call) => call.startsWith('delete:') || call.startsWith('deleteReview:'))).toEqual([]);
        expect(resolveReviewThread(42, threadId, head, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('reply:'))).toEqual([`reply:${threadId}:${reviewId}`]);
    });
    it('preserves submitted review evidence after a lost submit response, then resolves on retry', () => {
        const { port, authorNodeId, state, calls } = fakePort({ throwAfterSubmitWithState: true });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /submit review transport lost[\s\S]*submitted review/i
        );
        expect(state()).toMatchObject({
            resolved: false,
            comments: [{ id: rootId }, { id: replyId, body: 'Done', reviewId }],
            reviews: [
                { id: reviewId, state: 'COMMENTED', body: resolutionReviewSummary(pullRequestId, threadId, head) },
            ],
        });
        expect(calls.filter((call) => call.startsWith('delete:') || call.startsWith('deleteReview:'))).toEqual([]);
        expect(resolveReviewThread(42, threadId, head, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('submitReview:'))).toEqual([`submitReview:${reviewId}`]);
        expect(calls.filter((call) => call.startsWith('reply:'))).toEqual([`reply:${threadId}:${reviewId}`]);
    });
    it('rejects a submit-review receipt with a mismatched clientMutationId before resolve', () => {
        const { port, authorNodeId, calls } = fakePort({ submitClientMutationId: 'wrong' });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /submit review returned an invalid result/i
        );
        expect(calls.filter((call) => call.startsWith('resolve:') || call.startsWith('log:'))).toEqual([]);
    });
    it.each([
        ['wrong immutable actor ID', { submitReceiptAuthorNodeId: REVIEWER_BOT_NODE_ID }],
        ['non-Bot type', { submitReceiptAuthorType: 'User' as const }],
    ])('rejects a submit-review receipt with %s before resolve or log', (_case, overrides) => {
        const { port, authorNodeId, calls } = fakePort({
            existingReplyCount: 1,
            existingReplyReviewState: 'PENDING',
            existingReplyReviewBody: pendingReviewBody(head),
            existingReplyReviewCommitOid: head,
            ...overrides,
        });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /submit review returned an invalid result/i
        );
        expect(calls.filter((call) => call.startsWith('resolve:') || call.startsWith('log:'))).toEqual([]);
    });
    it('rejects a create-pending-review receipt with a mismatched clientMutationId before reply submit resolve or log', () => {
        const { port, authorNodeId, calls } = fakePort({ createClientMutationId: 'wrong' });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /create pending review returned an invalid result/i
        );
        expect(
            calls.filter(
                (call) =>
                    call.startsWith('reply:') ||
                    call.startsWith('submitReview:') ||
                    call.startsWith('resolve:') ||
                    call.startsWith('log:')
            )
        ).toEqual([]);
    });
    it.each([
        ['wrong immutable actor ID', { createReceiptAuthorNodeId: REVIEWER_BOT_NODE_ID }],
        ['non-Bot type', { createReceiptAuthorType: 'User' as const }],
    ])('rejects a create-pending-review receipt with %s before reply submit resolve or log', (_case, overrides) => {
        const { port, authorNodeId, calls } = fakePort(overrides);
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /create pending review returned an invalid result/i
        );
        expect(
            calls.filter(
                (call) =>
                    call.startsWith('reply:') ||
                    call.startsWith('submitReview:') ||
                    call.startsWith('resolve:') ||
                    call.startsWith('log:')
            )
        ).toEqual([]);
    });
    it('retires a stale script-owned Done marker after a lost submit response and resolves with a new current-head review', () => {
        const { port, authorNodeId, state, calls } = fakePort({
            throwAfterSubmitWithState: true,
            heads: [
                head,
                head,
                head,
                head,
                movedHead,
                movedHead,
                movedHead,
                movedHead,
                movedHead,
                movedHead,
                movedHead,
            ],
        });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /submit review transport lost[\s\S]*submitted review/i
        );
        expect(resolveReviewThread(42, threadId, movedHead, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([`delete:${replyId}`]);
        expect(calls.filter((call) => call.startsWith('createReview:'))).toEqual([
            `createReview:${pullRequestId}`,
            `createReview:${pullRequestId}`,
        ]);
        expect(state().comments.filter((comment) => comment.body === 'Done')).toHaveLength(1);
        expect(state().reviews).toEqual([
            expect.objectContaining({
                id: reviewId,
                state: 'COMMENTED',
                body: resolutionReviewSummary(pullRequestId, threadId, head),
                commitOid: head,
            }),
            expect.objectContaining({
                state: 'COMMENTED',
                body: resolutionReviewSummary(pullRequestId, threadId, movedHead),
                commitOid: movedHead,
            }),
        ]);
    });
    it('preserves a pending review after a lost submit response without state, then resubmits it on retry', () => {
        const { port, authorNodeId, state, calls } = fakePort({ throwAfterSubmitWithoutState: true });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /submit review transport lost[\s\S]*pending review/i
        );
        expect(state()).toMatchObject({
            resolved: false,
            comments: [{ id: rootId }, { id: replyId, body: 'Done', reviewId }],
            reviews: [{ id: reviewId, state: 'PENDING' }],
        });
        expect(resolveReviewThread(42, threadId, head, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('submitReview:'))).toEqual([
            `submitReview:${reviewId}`,
            `submitReview:${reviewId}`,
        ]);
    });
    it('retires an old-head unattached author pending review before staging a new current-head review', () => {
        const { port, authorNodeId, state, calls } = fakePort({
            heads: [movedHead, movedHead, movedHead, movedHead, movedHead, movedHead, movedHead, movedHead],
            existingPendingReviewCount: 1,
            existingPendingReviewIds: ['PRR_stale_pending'],
            existingPendingReviewCommitOid: head,
        });
        expect(resolveReviewThread(42, threadId, movedHead, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('inspectAttachedReviewThreads:'))).toEqual([
            `inspectAttachedReviewThreads:42:PRR_stale_pending:${pullRequestId}:${movedHead}`,
        ]);
        expect(calls.filter((call) => call.startsWith('deleteReview:'))).toEqual(['deleteReview:PRR_stale_pending']);
        expect(calls.filter((call) => call.startsWith('createReview:'))).toEqual([`createReview:${pullRequestId}`]);
        expect(calls.filter((call) => call.startsWith('submitReview:'))).toEqual([`submitReview:${reviewId}`]);
        expect(state().reviews).toEqual([
            expect.objectContaining({
                id: reviewId,
                state: 'COMMENTED',
                commitOid: movedHead,
                body: resolutionReviewSummary(pullRequestId, threadId, movedHead),
            }),
        ]);
    });
    it('preserves a stale pending author review when it is still attached on another thread', () => {
        const { port, authorNodeId, state, calls } = fakePort({
            heads: [movedHead, movedHead, movedHead],
            existingPendingReviewCount: 1,
            existingPendingReviewIds: ['PRR_stale_pending'],
            existingPendingReviewCommitOid: head,
            attachedReviewThreadIdsByReviewId: { PRR_stale_pending: [otherThreadId] },
        });

        expect(() => resolveReviewThread(42, threadId, movedHead, authorNodeId, port)).toThrow(
            `pending author review PRR_stale_pending still has attached review-thread comments on ${otherThreadId}`
        );
        expect(calls.filter((call) => call.startsWith('inspectAttachedReviewThreads:'))).toEqual([
            `inspectAttachedReviewThreads:42:PRR_stale_pending:${pullRequestId}:${movedHead}`,
        ]);
        expect(calls.filter((call) => call.startsWith('deleteReview:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('createReview:'))).toEqual([]);
        expect(state().reviews).toContainEqual(
            expect.objectContaining({
                id: 'PRR_stale_pending',
                state: 'PENDING',
                commitOid: head,
            })
        );
    });
    it('refuses duplicate exact pending-review convergence when another attached thread still depends on the duplicate draft', () => {
        const { port, authorNodeId, state, calls } = fakePort({
            heads: [movedHead],
            existingPendingReviewCount: 2,
            existingPendingReviewIds: ['PRR_canonical_pending', 'PRR_attached_pending'],
            existingPendingReviewBody: pendingReviewBody(movedHead),
            existingPendingReviewCommitOid: movedHead,
            attachedReviewThreadIdsByReviewId: { PRR_attached_pending: [otherThreadId] },
        });

        expect(() => resolveReviewThread(42, threadId, movedHead, authorNodeId, port)).toThrow(
            `pending author review PRR_attached_pending still has attached review-thread comments on ${otherThreadId}`
        );
        expect(calls.filter((call) => call.startsWith('inspectAttachedReviewThreads:'))).toEqual([
            `inspectAttachedReviewThreads:42:PRR_attached_pending:${pullRequestId}:${movedHead}`,
        ]);
        expect(calls.filter((call) => call.startsWith('deleteReview:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('reply:'))).toEqual([]);
        expect(state().reviews).toContainEqual(
            expect.objectContaining({
                id: 'PRR_attached_pending',
                state: 'PENDING',
                commitOid: movedHead,
            })
        );
    });
    it('preserves an exact pending review on another thread when the target thread already has a managed commented reply', () => {
        const { port, authorNodeId, state, calls } = fakePort({
            heads: [movedHead, movedHead],
            existingReplyCount: 1,
            existingReplyReviewState: 'COMMENTED',
            existingReplyReviewBody: pendingReviewBody(movedHead),
            existingReplyReviewCommitOid: movedHead,
            existingPendingReviewCount: 1,
            existingPendingReviewIds: ['PRR_other_thread_pending'],
            existingPendingReviewBody: pendingReviewBody(movedHead),
            existingPendingReviewCommitOid: movedHead,
            attachedReviewThreadIdsByReviewId: { PRR_other_thread_pending: [otherThreadId] },
        });

        expect(() => resolveReviewThread(42, threadId, movedHead, authorNodeId, port)).toThrow(
            `pending author review PRR_other_thread_pending still has attached review-thread comments on ${otherThreadId}`
        );
        expect(calls.filter((call) => call.startsWith('inspectAttachedReviewThreads:'))).toEqual([
            `inspectAttachedReviewThreads:42:PRR_other_thread_pending:${pullRequestId}:${movedHead}`,
        ]);
        expect(calls.filter((call) => call.startsWith('deleteReview:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('resolve:'))).toEqual([]);
        expect(state().reviews).toContainEqual(
            expect.objectContaining({
                id: 'PRR_other_thread_pending',
                state: 'PENDING',
                commitOid: movedHead,
            })
        );
    });
    it('detects later-page attached comments through the shell-backed GraphQL scanner and refuses stale review deletion', () => {
        const repository = createTemporaryGitRepository();
        const fakeGh = createFakeGhExecutable({
            'threads:': threadPage(
                [{ id: threadId, isResolved: false, resolvedBy: null }],
                true,
                'thread-page-2',
                movedHead
            ),
            [`threadResolution:${threadId}`]: threadResolutionPage(threadId, movedHead),
            'threads:thread-page-2': threadPage(
                [{ id: otherThreadId, isResolved: false, resolvedBy: null }],
                false,
                null,
                movedHead
            ),
            'reviews:': reviewPage(
                [
                    {
                        id: 'PRR_stale_pending',
                        state: 'PENDING',
                        body: resolutionReviewSummary(pullRequestId, threadId, head),
                        commit: { oid: head },
                        author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
                    },
                ],
                false,
                null,
                movedHead
            ),
            [`comments:${threadId}:`]: commentPage([root], false, null, threadId, movedHead),
            [`comments:${otherThreadId}:`]: commentPage(
                [
                    {
                        ...root,
                        id: 'PRRC_other_root',
                        fullDatabaseId: '9223372036854775810',
                    },
                ],
                true,
                'other-comment-page-2',
                otherThreadId,
                movedHead
            ),
            [`comments:${otherThreadId}:other-comment-page-2`]: commentPage(
                [
                    {
                        id: 'PRRC_other_done',
                        fullDatabaseId: '9223372036854775811',
                        body: 'Done',
                        author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
                        pullRequestReview: {
                            id: 'PRR_stale_pending',
                            state: 'PENDING',
                            body: resolutionReviewSummary(pullRequestId, threadId, head),
                            commit: { oid: head },
                            author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
                        },
                    },
                ],
                false,
                null,
                otherThreadId,
                movedHead
            ),
        });
        const session: GhSession = {
            configDir: repository,
            env: { SOURDAW_TRUSTED_GH_PATH: fakeGh.executable },
            dispose() {},
        };
        try {
            expect(() =>
                resolveReviewThread(42, threadId, movedHead, AUTHOR_BOT_NODE_ID, shellPort(session, repository))
            ).toThrow(
                `pending author review PRR_stale_pending still has attached review-thread comments on ${otherThreadId}`
            );
        } finally {
            rmSync(repository, { recursive: true, force: true });
            rmSync(fakeGh.root, { recursive: true, force: true });
        }
    });
    it('fails before deletion when a shell-backed requested-thread comment page advances the head after the outer thread page', () => {
        const repository = createTemporaryGitRepository();
        const fakeGh = createFakeGhExecutable({
            'threads:': threadPage([{ id: threadId, isResolved: false, resolvedBy: null }], false, null, movedHead),
            [`comments:${threadId}:`]: commentPage([root], true, 'comments-1', threadId, movedHead),
            [`comments:${threadId}:comments-1`]: commentPage([], false, null, threadId, 'c'.repeat(40)),
        });
        const basePort = shellPort(
            {
                configDir: repository,
                env: { SOURDAW_TRUSTED_GH_PATH: fakeGh.executable },
                dispose() {},
            },
            repository
        );
        const calls: string[] = [];
        try {
            expect(() =>
                resolveReviewThread(42, threadId, movedHead, AUTHOR_BOT_NODE_ID, {
                    ...basePort,
                    createPendingReview: () => {
                        calls.push('createPendingReview');
                        throw new Error('unexpected create');
                    },
                    deletePendingReview: (id) => {
                        calls.push(`deleteReview:${id}`);
                    },
                    replyDone: () => {
                        calls.push('replyDone');
                        throw new Error('unexpected reply');
                    },
                    serializeReviewThreadMutation: (_number, _threadId, _expectedHead, operation) => operation(),
                    log: (message) => calls.push(`log:${message}`),
                })
            ).toThrow(/head changed while reading review comments/i);
            expect(calls).toEqual([]);
        } finally {
            rmSync(repository, { recursive: true, force: true });
            rmSync(fakeGh.root, { recursive: true, force: true });
        }
    });
    it('fails before deletion when the shell-backed attachment scanner sees a different pull-request node at the same head', () => {
        const repository = createTemporaryGitRepository();
        const fakeGh = createFakeGhExecutable({
            'threads:': [
                threadPage([{ id: threadId, isResolved: false, resolvedBy: null }], false, null, movedHead),
                JSON.stringify({
                    data: {
                        repository: {
                            pullRequest: {
                                id: 'PR_kwDOOtherPullRequest',
                                headRefOid: movedHead,
                                reviewThreads: {
                                    nodes: [{ id: threadId, isResolved: false, resolvedBy: null }],
                                    pageInfo: { hasNextPage: false, endCursor: null },
                                },
                            },
                        },
                    },
                }),
            ],
            [`threadResolution:${threadId}`]: threadResolutionPage(threadId, movedHead),
            [`comments:${threadId}:`]: [
                commentPage([root], false, null, threadId, movedHead),
                commentPage([root], false, null, threadId, movedHead, 'PR_kwDOOtherPullRequest'),
            ],
            'reviews:': reviewPage(
                [
                    {
                        id: 'PRR_stale_pending',
                        state: 'PENDING',
                        body: resolutionReviewSummary(pullRequestId, threadId, head),
                        commit: { oid: head },
                        author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
                    },
                ],
                false,
                null,
                movedHead
            ),
        });
        const basePort = shellPort(
            {
                configDir: repository,
                env: { SOURDAW_TRUSTED_GH_PATH: fakeGh.executable },
                dispose() {},
            },
            repository
        );
        const calls: string[] = [];
        try {
            expect(() =>
                resolveReviewThread(42, threadId, movedHead, AUTHOR_BOT_NODE_ID, {
                    ...basePort,
                    createPendingReview: () => {
                        calls.push('createPendingReview');
                        throw new Error('unexpected create');
                    },
                    deletePendingReview: (id) => {
                        calls.push(`deleteReview:${id}`);
                    },
                    replyDone: () => {
                        calls.push('replyDone');
                        throw new Error('unexpected reply');
                    },
                    serializeReviewThreadMutation: (_number, _threadId, _expectedHead, operation) => operation(),
                    log: (message) => calls.push(`log:${message}`),
                })
            ).toThrow(/pull-request changed while reading review threads/i);
            expect(calls).toEqual([]);
        } finally {
            rmSync(repository, { recursive: true, force: true });
            rmSync(fakeGh.root, { recursive: true, force: true });
        }
    });
    it('fails closed when a same-head inner snapshot shows the thread became unresolved before completed-resolution success', () => {
        const repository = createTemporaryGitRepository();
        const linkedReply = {
            id: replyId,
            fullDatabaseId: '9223372036854775808',
            body: 'Done',
            author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
            pullRequestReview: {
                id: reviewId,
                state: 'COMMENTED',
                body: resolutionReviewSummary(pullRequestId, threadId, movedHead),
                commit: { oid: movedHead },
                author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
            },
        };
        const fakeGh = createFakeGhExecutable({
            'threads:': threadPage(
                [
                    {
                        id: threadId,
                        isResolved: true,
                        resolvedBy: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'User' },
                    },
                ],
                false,
                null,
                movedHead
            ),
            [`comments:${threadId}:`]: commentPage(
                [root, linkedReply],
                false,
                null,
                threadId,
                movedHead,
                pullRequestId,
                { isResolved: false, resolvedBy: null }
            ),
            'reviews:': reviewPage([], false, null, movedHead),
        });
        const basePort = shellPort(
            {
                configDir: repository,
                env: { SOURDAW_TRUSTED_GH_PATH: fakeGh.executable },
                dispose() {},
            },
            repository
        );
        const calls: string[] = [];
        try {
            expect(() =>
                resolveReviewThread(42, threadId, movedHead, AUTHOR_BOT_NODE_ID, {
                    ...basePort,
                    createPendingReview: () => {
                        calls.push('createPendingReview');
                        throw new Error('unexpected create');
                    },
                    updateReviewBody: () => {
                        calls.push('updateReviewBody');
                        throw new Error('unexpected update');
                    },
                    submitReview: () => {
                        calls.push('submitReview');
                        throw new Error('unexpected submit');
                    },
                    replyDone: () => {
                        calls.push('replyDone');
                        throw new Error('unexpected reply');
                    },
                    resolve: () => {
                        calls.push('resolve');
                        throw new Error('unexpected resolve');
                    },
                    deletePendingReview: (id) => {
                        calls.push(`deleteReview:${id}`);
                    },
                    deleteReply: (id) => {
                        calls.push(`deleteReply:${id}`);
                    },
                    serializeReviewThreadMutation: (_number, _threadId, _expectedHead, operation) => operation(),
                    log: (message) => calls.push(`log:${message}`),
                })
            ).toThrow(/changed while reading review comments/i);
            expect(calls).toEqual([]);
        } finally {
            rmSync(repository, { recursive: true, force: true });
            rmSync(fakeGh.root, { recursive: true, force: true });
        }
    });
    it('binds the shell-backed create-pending-review mutation to the inspected pull-request node id before any later mutation', () => {
        const repository = createTemporaryGitRepository();
        const createBody = resolutionReviewSummary(pullRequestId, threadId, movedHead);
        const createClientMutationId = `review-create:${threadId}`;
        const fakeGh = createFakeGhExecutable({
            'threads:': threadPage([{ id: threadId, isResolved: false, resolvedBy: null }], false, null, movedHead),
            [`comments:${threadId}:`]: commentPage([root], false, null, threadId, movedHead),
            [`threadResolution:${threadId}`]: threadResolutionPage(threadId, movedHead),
            'reviews:': [
                reviewPage([], false, null, movedHead),
                reviewPage(
                    [
                        {
                            id: reviewId,
                            state: 'PENDING',
                            body: createBody,
                            commit: { oid: movedHead },
                            author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
                        },
                    ],
                    false,
                    null,
                    movedHead
                ),
            ],
            [`createReview:${pullRequestId}:${movedHead}:${createClientMutationId}`]: JSON.stringify({
                data: {
                    addPullRequestReview: {
                        clientMutationId: createClientMutationId,
                        pullRequestReview: {
                            id: reviewId,
                            state: 'PENDING',
                            body: createBody,
                            commit: { oid: movedHead },
                            author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
                        },
                    },
                },
            }),
        });
        const basePort = shellPort(
            {
                configDir: repository,
                env: { SOURDAW_TRUSTED_GH_PATH: fakeGh.executable },
                dispose() {},
            },
            repository
        );
        const calls: string[] = [];
        try {
            expect(() =>
                resolveReviewThread(42, threadId, movedHead, AUTHOR_BOT_NODE_ID, {
                    ...basePort,
                    replyDone: () => {
                        calls.push('replyDone');
                        throw new Error('stop after create');
                    },
                    submitReview: () => {
                        calls.push('submitReview');
                        throw new Error('unexpected submit');
                    },
                    resolve: () => {
                        calls.push('resolve');
                        throw new Error('unexpected resolve');
                    },
                    deletePendingReview: (id) => {
                        calls.push(`deleteReview:${id}`);
                    },
                    deleteReply: (id) => {
                        calls.push(`deleteReply:${id}`);
                    },
                    log: (message) => calls.push(`log:${message}`),
                })
            ).toThrow(/stop after create[\s\S]*ambiguous review reply mutation/i);
            expect(calls).toEqual(['replyDone']);
        } finally {
            rmSync(repository, { recursive: true, force: true });
            rmSync(fakeGh.root, { recursive: true, force: true });
        }
    });
    it('does not publish a stale unattached pending review when the head drifts before the new-head draft is inspected', () => {
        const newerHead = 'c'.repeat(40);
        const { port, authorNodeId, state, calls } = fakePort({
            heads: [movedHead, newerHead],
            existingPendingReviewCount: 1,
            existingPendingReviewIds: ['PRR_stale_pending'],
            existingPendingReviewCommitOid: head,
        });
        expect(() => resolveReviewThread(42, threadId, movedHead, authorNodeId, port)).toThrow(
            /head moved[\s\S]*pending review deletion was attempted/i
        );
        expect(calls.filter((call) => call.startsWith('submitReview:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('deleteReview:'))).toEqual(['deleteReview:PRR_stale_pending']);
        expect(calls.filter((call) => call.startsWith('createReview:'))).toEqual([]);
        expect(
            calls.filter((call) => call.startsWith('reply:') || call.startsWith('resolve:') || call.startsWith('log:'))
        ).toEqual([]);
        expect(state().reviews).toEqual([]);
        expect(state().reviews.filter((review) => review.state === 'COMMENTED')).toEqual([]);
    });
    it('rejects a stale attached pending Done marker linked to a foreign Bot review without submit delete or reuse', () => {
        const { port, authorNodeId, calls } = fakePort({
            heads: [movedHead, movedHead, movedHead],
            existingReplyCount: 1,
            existingReplyReviewState: 'PENDING',
            existingReplyReviewBody: '',
            existingReplyReviewCommitOid: head,
            existingReplyReviewAuthorNodeId: REVIEWER_BOT_NODE_ID,
            existingReplyReviewAuthorType: 'Bot',
        });
        expect(() => resolveReviewThread(42, threadId, movedHead, authorNodeId, port)).toThrow(/non-author review/i);
        expect(
            calls.filter(
                (call) =>
                    call.startsWith('updateReview:') ||
                    call.startsWith('submitReview:') ||
                    call.startsWith('createReview:') ||
                    call.startsWith('delete:') ||
                    call.startsWith('deleteReview:') ||
                    call.startsWith('reply:') ||
                    call.startsWith('resolve:') ||
                    call.startsWith('log:')
            )
        ).toEqual([]);
    });
    it('rejects a stale attached pending Done marker linked to a noncanonical author review without submit delete or reuse', () => {
        const { port, authorNodeId, calls } = fakePort({
            heads: [movedHead, movedHead, movedHead],
            existingReplyCount: 1,
            existingReplyReviewState: 'PENDING',
            existingReplyReviewBody: 'not the managed resolution review body',
            existingReplyReviewCommitOid: head,
        });
        expect(() => resolveReviewThread(42, threadId, movedHead, authorNodeId, port)).toThrow(
            /noncanonical author review/i
        );
        expect(
            calls.filter(
                (call) =>
                    call.startsWith('updateReview:') ||
                    call.startsWith('submitReview:') ||
                    call.startsWith('createReview:') ||
                    call.startsWith('delete:') ||
                    call.startsWith('deleteReview:') ||
                    call.startsWith('reply:') ||
                    call.startsWith('resolve:') ||
                    call.startsWith('log:')
            )
        ).toEqual([]);
    });
    const invalidCurrentHeadMarkerCases = [
        [
            'foreign Bot review',
            { existingReplyReviewAuthorNodeId: REVIEWER_BOT_NODE_ID, existingReplyReviewAuthorType: 'Bot' },
            /non-author review/i,
        ],
        ['unreadable review', { existingReplyReviewMissing: true }, /readable pull-request review/i],
        ['unsupported review state', { existingReplyReviewState: 'APPROVED' as const }, /unsupported review state/i],
        [
            'noncanonical author review',
            { existingReplyReviewBody: 'not the managed resolution review body' },
            /noncanonical author review/i,
        ],
    ] satisfies [string, Partial<Input>, RegExp][];
    it.each(invalidCurrentHeadMarkerCases)(
        'rejects a current-head attached Done marker linked to a %s before any mutation',
        (_case, input, errorPattern) => {
            const { port, authorNodeId, calls } = fakePort({
                existingReplyCount: 1,
                ...input,
            });
            expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(errorPattern);
            expect(
                calls.filter(
                    (call) =>
                        call.startsWith('updateReview:') ||
                        call.startsWith('submitReview:') ||
                        call.startsWith('createReview:') ||
                        call.startsWith('delete:') ||
                        call.startsWith('deleteReview:') ||
                        call.startsWith('reply:') ||
                        call.startsWith('resolve:') ||
                        call.startsWith('log:')
                )
            ).toEqual([]);
        }
    );
    it('preserves a marker after an unresolved resolve throw, then reuses it on retry', () => {
        const { port, authorNodeId, state, calls } = fakePort({ throwResolveOnceWithoutState: true });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /resolve transport lost[\s\S]*attempted[\s\S]*durable evidence/i
        );
        expect(state()).toMatchObject({
            resolved: false,
            comments: [{ id: rootId }, { id: replyId, body: 'Done', reviewId }],
            reviews: [
                { id: reviewId, state: 'COMMENTED', body: resolutionReviewSummary(pullRequestId, threadId, head) },
            ],
        });
        expect(calls.filter((call) => call.startsWith('delete:') || call.startsWith('deleteReview:'))).toEqual([]);
        expect(resolveReviewThread(42, threadId, head, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('reply:'))).toEqual([`reply:${threadId}:${reviewId}`]);
    });
    it('preserves the staged pending review and Done reply when the head moves after replying', () => {
        const { port, authorNodeId, state, calls } = fakePort({ heads: [head, head, movedHead, movedHead] });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(/head moved/i);
        expect(state()).toMatchObject({
            resolved: false,
            comments: [{ id: rootId }, { id: replyId, body: 'Done', reviewId }],
            reviews: [{ id: reviewId, state: 'PENDING' }],
        });
        expect(calls.filter((call) => call.startsWith('delete:') || call.startsWith('deleteReview:'))).toEqual([]);
    });
    it('reuses one exact existing Done reply and performs the missing resolution', () => {
        const { port, calls, authorNodeId } = fakePort({ existingReplyCount: 1 });
        expect(resolveReviewThread(42, threadId, head, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('reply:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('submitReview:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('resolve:'))).toEqual([`resolve:${threadId}`]);
    });
    it('converges multiple existing Done replies to the smallest fullDatabaseId before resolving', () => {
        const { port, calls, authorNodeId } = fakePort({ existingReplyCount: 2 });
        expect(resolveReviewThread(42, threadId, head, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual(['delete:PRRC_existing_1']);
        expect(calls.filter((call) => call.startsWith('resolve:'))).toEqual([`resolve:${threadId}`]);
    });
    it('converges an interleaved concurrent Done reply before resolution', () => {
        const { port, calls, authorNodeId, state } = fakePort({ concurrentReplyBeforeConvergence: true });
        expect(resolveReviewThread(42, threadId, head, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('resolve:'))).toEqual([`resolve:${threadId}`]);
        expect(state().comments.filter((comment) => comment.body === 'Done')).toHaveLength(1);
        expect(state().reviews).toEqual([
            expect.objectContaining({
                state: 'COMMENTED',
                body: resolutionReviewSummary(pullRequestId, threadId, head),
                commitOid: head,
                authorNodeId: AUTHOR_BOT_NODE_ID,
            }),
        ]);
    });
    it('refreshes after deleting a duplicate pending review whose attached Done marker disappeared with the review', () => {
        const { port, calls, authorNodeId, state } = fakePort({
            existingReplyCount: 1,
            addExactPendingReplyMarker: true,
            failDeleteMissingReply: true,
        });
        expect(resolveReviewThread(42, threadId, head, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('deleteReview:'))).toEqual(['deleteReview:PRR_pending_reply']);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        expect(state().comments.filter((comment) => comment.body === 'Done')).toEqual([
            expect.objectContaining({ id: replyId }),
        ]);
    });
    it('submits the current-head pending marker before retiring a stale commented marker on an unresolved thread', () => {
        const { port, calls, authorNodeId, state } = fakePort({
            existingReplyCount: 1,
            existingReplyReviewCommitOid: movedHead,
            existingReplyReviewBody: pendingReviewBody(movedHead),
            addExactPendingReplyMarker: true,
        });
        expect(resolveReviewThread(42, threadId, head, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls).toEqual([
            'inspect:1',
            'inspect:2',
            `submitReview:PRR_pending_reply`,
            'inspect:3',
            'delete:PRRC_reply',
            'inspect:4',
            `resolve:${threadId}`,
            'inspect:5',
            `log:review-thread-resolved:42:${threadId}`,
        ]);
        expect(state().comments.filter((comment) => comment.body === 'Done')).toEqual([
            expect.objectContaining({ id: 'PRRC_pending_reply', reviewId: 'PRR_pending_reply' }),
        ]);
        expect(state().reviews).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: reviewId,
                    state: 'COMMENTED',
                    commitOid: movedHead,
                    body: resolutionReviewSummary(pullRequestId, threadId, movedHead),
                }),
                expect.objectContaining({
                    id: 'PRR_pending_reply',
                    state: 'COMMENTED',
                    commitOid: head,
                    body: resolutionReviewSummary(pullRequestId, threadId, head),
                }),
            ])
        );
    });
    it('preserves the stale commented marker when current pending submission is lost on an unresolved thread', () => {
        const { port, calls, authorNodeId, state } = fakePort({
            existingReplyCount: 1,
            existingReplyReviewCommitOid: movedHead,
            existingReplyReviewBody: pendingReviewBody(movedHead),
            addExactPendingReplyMarker: true,
            throwAfterSubmitWithState: true,
        });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /submit review transport lost[\s\S]*submitted review/i
        );
        expect(calls.filter((call) => call.startsWith('delete:') || call.startsWith('deleteReview:'))).toEqual([]);
        expect(state().resolved).toBe(false);
        expect(state().comments.filter((comment) => comment.body === 'Done')).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: replyId, reviewId }),
                expect.objectContaining({ id: 'PRRC_pending_reply', reviewId: 'PRR_pending_reply' }),
            ])
        );
        expect(state().reviews).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: reviewId,
                    state: 'COMMENTED',
                    commitOid: movedHead,
                    body: resolutionReviewSummary(pullRequestId, threadId, movedHead),
                }),
                expect.objectContaining({
                    id: 'PRR_pending_reply',
                    state: 'COMMENTED',
                    commitOid: head,
                    body: resolutionReviewSummary(pullRequestId, threadId, head),
                }),
            ])
        );
    });
    it('retires a stale attached pending Done marker beside a current COMMENTED marker on unresolved retry', () => {
        const { port, calls, authorNodeId, state } = fakePort({
            heads: [movedHead, movedHead, movedHead, movedHead, movedHead],
            existingReplyCount: 1,
            existingReplyReviewBody: pendingReviewBody(movedHead),
            existingReplyReviewCommitOid: movedHead,
            addExactPendingReplyMarker: true,
        });
        expect(resolveReviewThread(42, threadId, movedHead, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls).toEqual([
            'inspect:1',
            'inspect:2',
            `inspectAttachedReviewThreads:42:PRR_pending_reply:${pullRequestId}:${movedHead}`,
            'deleteReview:PRR_pending_reply',
            'inspect:3',
            'inspect:4',
            `resolve:${threadId}`,
            'inspect:5',
            `log:review-thread-resolved:42:${threadId}`,
        ]);
        expect(state().comments.filter((comment) => comment.body === 'Done')).toEqual([
            expect.objectContaining({ id: replyId, reviewId }),
        ]);
        expect(state().reviews).toEqual([
            expect.objectContaining({
                id: reviewId,
                state: 'COMMENTED',
                commitOid: movedHead,
                body: resolutionReviewSummary(pullRequestId, threadId, movedHead),
            }),
        ]);
    });
    it('fails closed on an unresolved backfill receipt that reports COMMENTED before inspection confirms submission', () => {
        const { port, calls, authorNodeId } = fakePort({
            existingReplyCount: 1,
            existingReplyReviewState: 'PENDING',
            existingReplyReviewBody: '',
            updateReceiptState: 'COMMENTED',
        });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /update review body returned an invalid result/i
        );
        expect(
            calls.filter(
                (call) =>
                    call.startsWith('submitReview:') ||
                    call.startsWith('delete:') ||
                    call.startsWith('deleteReview:') ||
                    call.startsWith('resolve:') ||
                    call.startsWith('log:')
            )
        ).toEqual([]);
    });
    it.each([
        ['wrong immutable actor ID', { updateReceiptAuthorNodeId: REVIEWER_BOT_NODE_ID }],
        ['non-Bot type', { updateReceiptAuthorType: 'User' as const }],
    ])('rejects an update-review-body receipt with %s before submit resolve delete or log', (_case, overrides) => {
        const { port, calls, authorNodeId } = fakePort({
            existingReplyCount: 1,
            existingReplyReviewBody: '',
            ...overrides,
        });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /update review body returned an invalid result/i
        );
        expect(
            calls.filter(
                (call) =>
                    call.startsWith('submitReview:') ||
                    call.startsWith('delete:') ||
                    call.startsWith('deleteReview:') ||
                    call.startsWith('resolve:') ||
                    call.startsWith('log:')
            )
        ).toEqual([]);
    });
    it('backfills empty submitted duplicate review envelopes before deleting their historical Done markers', () => {
        const { port, calls, authorNodeId, state } = fakePort({
            existingReplyCount: 2,
            existingReplyReviewBody: '',
        });
        expect(resolveReviewThread(42, threadId, head, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual(['delete:PRRC_existing_1']);
        expect(calls.filter((call) => call.startsWith('updateReview:'))).toEqual([
            `updateReview:${reviewId}`,
            'updateReview:PRR_existing_1',
        ]);
        expect(state().reviews).toEqual([
            expect.objectContaining({
                id: reviewId,
                body: resolutionReviewSummary(pullRequestId, threadId, head),
            }),
            expect.objectContaining({
                id: 'PRR_existing_1',
                body: resolutionReviewSummary(pullRequestId, threadId, head),
            }),
        ]);
    });
    it('does not claim compensation restored state when one empty managed review body was updated before the next update failed', () => {
        const { port, calls, authorNodeId, state } = fakePort({
            existingReplyCount: 2,
            existingReplyReviewBody: '',
            failUpdateReviewBodyIds: ['PRR_existing_1'],
        });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /update denied[\s\S]*compensation failed/i
        );
        expect(calls.filter((call) => call.startsWith('updateReview:'))).toEqual([
            `updateReview:${reviewId}`,
            'updateReview:PRR_existing_1',
        ]);
        expect(state().reviews.find((review) => review.id === reviewId)?.body).toBe(
            resolutionReviewSummary(pullRequestId, threadId, head)
        );
        expect(state().reviews.find((review) => review.id === 'PRR_existing_1')?.body).toBe('');
    });
    it('backfills already resolved duplicate empty review envelopes with their own historical head before converging markers', () => {
        const { port, calls, authorNodeId, state } = fakePort({
            heads: [movedHead, movedHead, movedHead],
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 2,
            existingReplyReviewBody: '',
            existingReplyReviewCommitOid: head,
        });
        expect(resolveReviewThread(42, threadId, movedHead, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('updateReview:'))).toEqual([
            `updateReview:${reviewId}`,
            'updateReview:PRR_existing_1',
        ]);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual(['delete:PRRC_existing_1']);
        expect(state().reviews).toEqual([
            expect.objectContaining({
                id: reviewId,
                body: resolutionReviewSummary(pullRequestId, threadId, head),
                commitOid: head,
            }),
            expect.objectContaining({
                id: 'PRR_existing_1',
                body: resolutionReviewSummary(pullRequestId, threadId, head),
                commitOid: head,
            }),
        ]);
        expect(state().comments.filter((comment) => comment.body === 'Done')).toEqual([
            expect.objectContaining({ id: replyId }),
        ]);
    });
    it('retires a stale-head managed pending Done marker beside a current COMMENTED marker on a completed resolution', () => {
        const { port, calls, authorNodeId, state } = fakePort({
            heads: [movedHead, movedHead, movedHead],
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            existingReplyReviewBody: pendingReviewBody(movedHead),
            existingReplyReviewCommitOid: movedHead,
            addPendingReplyMarkerToResolvedThread: true,
        });
        expect(resolveReviewThread(42, threadId, movedHead, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('deleteReview:'))).toEqual(['deleteReview:PRR_resolved_pending']);
        expect(state().comments.filter((comment) => comment.body === 'Done')).toEqual([
            expect.objectContaining({ id: replyId, reviewId }),
        ]);
        expect(state().reviews).toEqual([
            expect.objectContaining({ id: reviewId, state: 'COMMENTED', commitOid: movedHead }),
        ]);
    });
    it('ignores foreign pending reviews while reusing the author-owned canonical review', () => {
        const { port, calls, authorNodeId, state } = fakePort({
            existingPendingReviewCount: 1,
            addForeignPendingReview: true,
        });
        expect(resolveReviewThread(42, threadId, head, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('deleteReview:'))).toEqual([]);
        expect(state().reviews).toEqual([
            expect.objectContaining({ id: reviewId, state: 'COMMENTED' }),
            expect.objectContaining({ id: 'PRR_foreign_pending', state: 'PENDING' }),
        ]);
    });
    it('ignores an exact current-head foreign pending review instead of reusing or deleting it', () => {
        const { port, calls, authorNodeId, state } = fakePort({ addExactForeignPendingReview: true });
        expect(resolveReviewThread(42, threadId, head, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('createReview:'))).toEqual([`createReview:${pullRequestId}`]);
        expect(calls.filter((call) => call.startsWith('deleteReview:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('reply:'))).toEqual([`reply:${threadId}:${reviewId}`]);
        expect(state().reviews).toEqual([
            expect.objectContaining({
                id: 'PRR_foreign_pending',
                state: 'PENDING',
                authorNodeId: REVIEWER_BOT_NODE_ID,
            }),
            expect.objectContaining({ id: reviewId, state: 'COMMENTED', authorNodeId: AUTHOR_BOT_NODE_ID }),
        ]);
    });
    it("preserves this invocation's draft when another invocation resolves first", () => {
        const { port, calls, authorNodeId, state } = fakePort({
            foreignLowerReplyBeforeConvergence: true,
            resolveBeforeConvergence: true,
        });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /already resolved[\s\S]*canonical commented review/i
        );
        expect(calls.filter((call) => call.startsWith('deleteReview:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('resolve:'))).toEqual([]);
        expect(state()).toMatchObject({
            resolved: true,
            comments: [{ id: rootId }, { id: 'PRRC_foreign', body: 'Done', reviewId: 'PRR_foreign' }],
            reviews: [
                { id: reviewId, state: 'PENDING', commitOid: head },
                { id: 'PRR_foreign', state: 'COMMENTED', commitOid: head },
            ],
        });
    });
    it('returns completed success for one exact Bot Done marker resolved by the documented User actor', () => {
        const { port, calls, authorNodeId } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
        });
        expect(resolveReviewThread(42, threadId, head, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls).toEqual(['inspect:1', `log:review-thread-resolved:42:${threadId}`]);
    });
    it('submits a completed resolution whose only managed author Done marker is still PENDING', () => {
        const { port, calls, authorNodeId, state } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            existingReplyReviewState: 'PENDING',
        });
        expect(resolveReviewThread(42, threadId, head, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('submitReview:'))).toEqual([`submitReview:${reviewId}`]);
        expect(state().reviews).toEqual([
            expect.objectContaining({ id: reviewId, state: 'COMMENTED', commitOid: head }),
        ]);
    });
    it('retires a sole stale unattached pending author review on a completed resolution before returning success', () => {
        const { port, calls, authorNodeId, state } = fakePort({
            heads: [movedHead, movedHead, movedHead],
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            existingReplyReviewBody: pendingReviewBody(movedHead),
            existingReplyReviewCommitOid: movedHead,
            existingPendingReviewCount: 1,
            existingPendingReviewIds: ['PRR_stale_pending'],
            existingPendingReviewCommitOid: head,
        });
        expect(resolveReviewThread(42, threadId, movedHead, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('deleteReview:'))).toEqual(['deleteReview:PRR_stale_pending']);
        expect(state().reviews).toEqual([
            expect.objectContaining({
                id: reviewId,
                state: 'COMMENTED',
                commitOid: movedHead,
                body: resolutionReviewSummary(pullRequestId, threadId, movedHead),
            }),
        ]);
        expect(state().comments.filter((comment) => comment.body === 'Done')).toEqual([
            expect.objectContaining({ id: replyId, reviewId }),
        ]);
    });
    it('fails closed if the head moves after retiring a stale unattached pending author review on a completed resolution', () => {
        const newerHead = 'c'.repeat(40);
        const { port, calls, authorNodeId, state } = fakePort({
            heads: [movedHead, newerHead],
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            existingReplyReviewBody: pendingReviewBody(movedHead),
            existingReplyReviewCommitOid: movedHead,
            existingPendingReviewCount: 1,
            existingPendingReviewIds: ['PRR_stale_pending'],
            existingPendingReviewCommitOid: head,
        });
        expect(() => resolveReviewThread(42, threadId, movedHead, authorNodeId, port)).toThrow(/head moved/i);
        expect(calls.filter((call) => call.startsWith('deleteReview:'))).toEqual(['deleteReview:PRR_stale_pending']);
        expect(calls.filter((call) => call.startsWith('log:'))).toEqual([]);
        expect(state().reviews).toEqual([
            expect.objectContaining({
                id: reviewId,
                state: 'COMMENTED',
                commitOid: movedHead,
                body: resolutionReviewSummary(pullRequestId, threadId, movedHead),
            }),
        ]);
    });
    it('submits and preserves a sole stale-head pending Done marker on an already resolved thread', () => {
        const { port, calls, authorNodeId, state } = fakePort({
            heads: [movedHead, movedHead, movedHead],
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            existingReplyReviewState: 'PENDING',
            existingReplyReviewCommitOid: head,
        });
        expect(resolveReviewThread(42, threadId, movedHead, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('submitReview:'))).toEqual([`submitReview:${reviewId}`]);
        expect(calls.filter((call) => call.startsWith('deleteReview:') || call.startsWith('delete:'))).toEqual([]);
        expect(state()).toMatchObject({
            resolved: true,
            comments: [{ id: rootId }, { id: replyId, body: 'Done', reviewId }],
            reviews: [
                {
                    id: reviewId,
                    state: 'COMMENTED',
                    commitOid: head,
                    body: resolutionReviewSummary(pullRequestId, threadId, head),
                },
            ],
        });
    });
    it('submits the current-head pending marker before retiring a stale commented marker on an already resolved thread', () => {
        const { port, calls, authorNodeId, state } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            existingReplyReviewCommitOid: movedHead,
            existingReplyReviewBody: pendingReviewBody(movedHead),
            addPendingReplyMarkerToResolvedThread: true,
        });
        expect(resolveReviewThread(42, threadId, head, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls).toEqual([
            'inspect:1',
            `submitReview:PRR_resolved_pending`,
            'inspect:2',
            'delete:PRRC_reply',
            'inspect:3',
            `log:review-thread-resolved:42:${threadId}`,
        ]);
        expect(state().comments.filter((comment) => comment.body === 'Done')).toEqual([
            expect.objectContaining({ id: 'PRRC_resolved_pending', reviewId: 'PRR_resolved_pending' }),
        ]);
        expect(state().reviews).toEqual([
            expect.objectContaining({ id: reviewId, state: 'COMMENTED', commitOid: movedHead }),
            expect.objectContaining({ id: 'PRR_resolved_pending', state: 'COMMENTED', commitOid: head }),
        ]);
    });
    it('deletes duplicate current-head pending envelopes on a completed resolution and keeps one canonical Done marker', () => {
        const { port, calls, authorNodeId, state } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            addPendingReplyMarkerToResolvedThread: true,
        });
        expect(resolveReviewThread(42, threadId, head, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('deleteReview:'))).toEqual(['deleteReview:PRR_resolved_pending']);
        expect(state().comments.filter((comment) => comment.body === 'Done')).toEqual([
            expect.objectContaining({ id: replyId }),
        ]);
    });
    it('prefers the current-head commented Done marker over a lower-id pending marker before canonical tie-breaking', () => {
        const { port, calls, authorNodeId, state } = fakePort({
            existingReplyCount: 1,
            addExactPendingReplyMarker: true,
            exactPendingReplyFullDatabaseId: '9223372036854775806',
        });
        expect(resolveReviewThread(42, threadId, head, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('submitReview:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('deleteReview:'))).toEqual(['deleteReview:PRR_pending_reply']);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        expect(state().comments.filter((comment) => comment.body === 'Done')).toEqual([
            expect.objectContaining({ id: replyId, reviewId }),
        ]);
        expect(state().reviews).toEqual([
            expect.objectContaining({ id: reviewId, state: 'COMMENTED', commitOid: head }),
        ]);
    });
    it('preserves duplicate pending Done markers on a completed resolution when canonical pending submission is lost', () => {
        const { port, calls, authorNodeId, state } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            existingReplyReviewState: 'PENDING',
            addPendingReplyMarkerToResolvedThread: true,
            throwAfterSubmitWithState: true,
        });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /submit review transport lost/i
        );
        expect(
            calls.filter(
                (call) => call.startsWith('delete:') || call.startsWith('deleteReview:') || call.startsWith('log:')
            )
        ).toEqual([]);
        expect(state()).toMatchObject({
            resolved: true,
            comments: [
                { id: rootId },
                { id: replyId, body: 'Done', reviewId },
                { id: 'PRRC_resolved_pending', body: 'Done', reviewId: 'PRR_resolved_pending' },
            ],
            reviews: [
                {
                    id: reviewId,
                    state: 'COMMENTED',
                    commitOid: head,
                    body: resolutionReviewSummary(pullRequestId, threadId, head),
                },
                { id: 'PRR_resolved_pending', state: 'PENDING', commitOid: head },
            ],
        });
    });
    it('backfills an already resolved thread whose associated author review summary is empty', () => {
        const { port, calls, authorNodeId, state } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            existingReplyReviewBody: '',
        });
        expect(resolveReviewThread(42, threadId, head, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls).toEqual([
            'inspect:1',
            `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${head}`,
            `updateReview:${reviewId}`,
            'inspect:2',
            `log:review-thread-resolved:42:${threadId}`,
        ]);
        expectCanonicalResolutionReview(state().reviews[0]!);
    });
    it('fails closed on an invalid update-review-body receipt during completed-resolution backfill before logging success', () => {
        const { port, calls, authorNodeId } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            existingReplyReviewBody: '',
            updateClientMutationId: 'wrong',
        });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /update review body returned an invalid result/i
        );
        expect(calls.filter((call) => call.startsWith('resolve:') || call.startsWith('log:'))).toEqual([]);
    });
    it('rejects a completed resolution with the wrong resolvedBy typename', () => {
        const { port, calls, authorNodeId } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'Bot',
            existingReplyCount: 1,
        });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(/not resolved by/i);
        expect(calls.filter((call) => !call.startsWith('inspect:'))).toEqual([]);
    });
    it('converges multiple completed Done markers to one canonical historical receipt', () => {
        const { port, calls, authorNodeId, state } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 2,
        });
        expect(resolveReviewThread(42, threadId, head, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls).toEqual([
            'inspect:1',
            'delete:PRRC_existing_1',
            'inspect:2',
            `log:review-thread-resolved:42:${threadId}`,
        ]);
        expect(state().comments.filter((comment) => comment.body === 'Done')).toEqual([
            expect.objectContaining({ id: replyId }),
        ]);
    });
    it('rejects a User-typed root reviewer for a completed thread without mutation', () => {
        const { port, calls, authorNodeId } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            rootAuthorType: 'User',
        });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(/root comment/i);
        expect(calls.filter((call) => !call.startsWith('inspect:'))).toEqual([]);
    });
    it('rejects a User-typed reviewer marker before any mutation', () => {
        const { port, calls, authorNodeId } = fakePort({ rootAuthorType: 'User' });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(/root comment/i);
        expect(calls.filter((call) => !call.startsWith('inspect:'))).toEqual([]);
    });
    it('reports original and compensation failure', () => {
        const { port, authorNodeId } = fakePort({
            heads: [head, head, movedHead, movedHead],
            failDeletePendingReview: true,
        });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /head moved[\s\S]*compensation failed/i
        );
    });
});
