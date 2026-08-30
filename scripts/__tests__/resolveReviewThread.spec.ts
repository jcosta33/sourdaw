import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AUTHOR_BOT_NODE_ID, REQUIRED_REPOSITORY, REVIEWER_BOT_NODE_ID, type GhSession } from '../githubAppIdentity.ts';
import {
    parseRecoverReviewResolutionLockArgs,
    runRecoverReviewResolutionLockCli,
} from '../recoverReviewResolutionLock.ts';
import {
    inspectReviewThread,
    parseResolveReviewThreadArgs,
    publishReviewResolutionChildLaunchMarker,
    readPersistedReviewResolutionChildLaunchMarker,
    resolveReviewThread,
    shellPort,
    deleteReply,
    deletePendingReview,
    submitReview,
    recoverPullRequestReviewResolutionLock,
    withPullRequestReviewResolutionLock,
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
const trustedGitPath = process.env.SOURDAW_TRUSTED_GIT_PATH ?? systemGitPath();
process.env.SOURDAW_TRUSTED_GIT_PATH = trustedGitPath;
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
    heads?: string[];
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
    existingPendingReviewIds?: string[];
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
    attachConcurrentManagedPendingReplyDuringPendingDelete?: boolean;
    attachedReviewThreadIdsByReviewId?: Record<string, string[]>;
    concurrentCommentedReplyAfterReplyFailure?: boolean;
    concurrentResolveAfterReplyFailure?: boolean;
    concurrentCommentedResolvedStateOnCompensationInspect?: boolean;
    attachManagedReplyBeforeCompensation?: boolean;
    failDeleteMissingReply?: boolean;
    replyReceiptReviewId?: string;
    failUpdateReviewBodyIds?: string[];
    updateClientMutationId?: string;
    updateReceiptState?: ReviewState;
    updateReceiptAuthorNodeId?: string | null;
    updateReceiptAuthorType?: string | null;
};
function fakePort(input: Input = {}) {
    const calls: string[] = [];
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
            pushReview(currentReviewId, reviewState, reviewBody, reviewCommitOid);
            reviews[reviews.length - 1]!.authorNodeId = reviewAuthorNodeId;
            reviews[reviews.length - 1]!.authorType = reviewAuthorType;
        }
        pushReply(
            replyIndex === 0 ? replyId : `PRRC_existing_${replyIndex}`,
            String(9223372036854775808n + BigInt(replyIndex)),
            currentReviewId
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
        deletePendingReview: (id) => {
            calls.push(`deleteReview:${id}`);
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
        authorNodeId: input.authorNodeId ?? AUTHOR_BOT_NODE_ID,
        state: () => ({ resolved, resolvedByNodeId, resolvedByLogin, resolvedByType, comments, reviews }),
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

function writeLockOwnerBlob(
    repository: string,
    pid: number,
    currentHead: string = head,
    mutation: { phase: string; epoch: number; reviewId?: string; replyId?: string; body?: string } = {
        phase: 'idle',
        epoch: 0,
    }
): string {
    return gitCapture(
        repository,
        ['hash-object', '-w', '--stdin'],
        JSON.stringify({
            version: 3,
            pid,
            pgid: pid,
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
): Promise<{ oid: string; owner: { pid: number; pgid: number; threadId: string; head: string } }> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        const oid = readLockOid(repository, number);
        if (oid !== undefined) {
            return {
                oid,
                owner: JSON.parse(gitCapture(repository, ['cat-file', 'blob', oid])) as {
                    pid: number;
                    pgid: number;
                    threadId: string;
                    head: string;
                },
            };
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`review-resolution lock for PR #${number} did not appear`);
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
            'export function spawnCapture(command, args) {',
            "  if (command !== 'gh') throw new Error(`unexpected command ${command}`);",
            "  if (args[0] === 'repo' && args[1] === 'view') return REQUIRED_REPOSITORY;",
            "  if (args[0] === 'api' && args[1] === 'graphql') {",
            '    for (;;) Atomics.wait(sleeper, 0, 0, 1000);',
            '  }',
            '  throw new Error(`unexpected gh args ${JSON.stringify(args)}`);',
            '}',
        ].join('\n')
    );
    return join(scriptsRoot, 'resolveReviewThread.ts');
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
            const ownerOid = gitCapture(
                repository,
                ['hash-object', '-w', '--stdin'],
                JSON.stringify({
                    version: 2,
                    pid: recorded.parentPid,
                    pgid: recorded.parentPid,
                    threadId,
                    head,
                    token: '11111111-1111-4111-8111-111111111111',
                })
            );
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
            expect(() =>
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    staleOwnerOid,
                    () => {
                        const replacementOwnerOid = writeLockOwnerBlob(repository, 1000000);
                        updateLock(repository, 42, replacementOwnerOid, staleOwnerOid);
                        return 'reconciled';
                    },
                    () => false
                )
            ).toThrow(/ownership changed before recovery/i);
            expect(readLockOid(repository, 42)).not.toBe(staleOwnerOid);
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
            expect(readLockOid(repository, 42)).toBe(ownerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('keeps the PR lock fenced when recovery cannot yet prove a delayed create-pending-review mutation landed, then recovers once the artifact is visible', async () => {
        const repository = createTemporaryGitRepository();
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'createPendingReview',
                epoch: 1,
            });
            updateLock(repository, 42, ownerOid);
            const session: GhSession = { configDir: repository, env: {}, dispose() {} };
            const inspections = [
                {
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
                },
                {
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
                    pendingReviews: [
                        {
                            id: reviewId,
                            state: 'PENDING',
                            body: resolutionReviewSummary(pullRequestId, threadId, head),
                            commitOid: head,
                            authorNodeId: AUTHOR_BOT_NODE_ID,
                            authorLogin: 'renamed-author',
                            authorType: 'Bot',
                        },
                    ],
                },
            ];
            const recoverDependencies = {
                trustedPrimaryRoot: () => repository,
                authenticateAuthor: async () => ({
                    minted: { actorNodeId: AUTHOR_BOT_NODE_ID },
                    session,
                }),
                repositoryName: () => REQUIRED_REPOSITORY,
                gh: () => () => '',
                inspectThread: () => inspections.shift()!,
                recoverLock: recoverPullRequestReviewResolutionLock,
            } satisfies Parameters<typeof runRecoverReviewResolutionLockCli>[1];

            await expect(
                runRecoverReviewResolutionLockCli(['42', '--owner', ownerOid], recoverDependencies)
            ).rejects.toThrow(/unreconciled in-flight createPendingReview mutation/i);
            expect(readLockOid(repository, 42)).toBe(ownerOid);

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
            expect(logs).toEqual([`review-resolution-lock-recovered:42:${threadId}:${head}:${head}:unresolved:1`]);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
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
        const token = '11111111-1111-4111-8111-111111111111';
        try {
            publishReviewResolutionChildLaunchMarker(markerPath, token, null);
            const originalInode = statSync(markerPath).ino;
            const temporaryPath = `${markerPath}.fixed-publication-id.tmp`;
            const writtenPaths: string[] = [];
            publishReviewResolutionChildLaunchMarker(markerPath, token, 4321, {
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
            });
            expect(statSync(markerPath).ino).not.toBe(originalInode);
            expect(() => statSync(temporaryPath)).toThrow();
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
        publishReviewResolutionChildLaunchMarker(markerPath, token, 999999);
        const child = spawn(process.execPath, [entryPath, '42', '--thread', threadId, '--head', head], {
            cwd: repository,
            env: {
                ...process.env,
                SOURDAW_TEST_PRIMARY_ROOT: repository,
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

    it('launches review:resolve in a detached worker group and keeps recovery fenced until that group exits', async () => {
        const repository = createTemporaryGitRepository();
        const snapshotRoot = mkdtempSync(join(tmpdir(), 'sourdaw-review-resolve-launcher-'));
        const entryPath = writeResolveReviewSnapshot(snapshotRoot);
        const launcher = spawn(process.execPath, [entryPath, '42', '--thread', threadId, '--head', head], {
            cwd: repository,
            env: { ...process.env, SOURDAW_TEST_PRIMARY_ROOT: repository },
            stdio: ['ignore', 'ignore', 'pipe'],
            shell: false,
        });
        let stderr = '';
        launcher.stderr?.setEncoding('utf8');
        launcher.stderr?.on('data', (chunk: string) => {
            stderr += chunk;
        });
        let owner: { pid: number; pgid: number; threadId: string; head: string } | undefined;
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
            expect(owner.pgid).toBe(owner.pid);
            expect(owner.pgid).not.toBe(launcherPgid);
            expect(() => recoverPullRequestReviewResolutionLock(repository, 42, lock.oid, () => 'recovered')).toThrow(
                /still held by live process group/i
            );

            process.kill(-owner.pgid, 'SIGKILL');
            await waitForProcessGroupGone(owner.pgid);
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
                    process.kill(-owner.pgid, 'SIGKILL');
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
