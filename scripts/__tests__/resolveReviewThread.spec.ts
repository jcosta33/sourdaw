import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AUTHOR_BOT_NODE_ID, REVIEWER_BOT_NODE_ID } from '../githubAppIdentity.ts';
import {
    inspectReviewThread,
    parseResolveReviewThreadArgs,
    resolveReviewThread,
    deleteReply,
    deletePendingReview,
    submitReview,
    type ResolveReviewThreadPort,
} from '../resolveReviewThread.ts';

const head = 'a'.repeat(40);
const movedHead = 'b'.repeat(40);
const pullRequestId = 'PR_kwDOExamplePullRequest';
const threadId = 'PRRT_kwDOExample';
const rootId = 'PRRC_root';
const replyId = 'PRRC_reply';
const reviewId = 'PRR_resolution';
type ReviewState = 'PENDING' | 'COMMENTED';
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
    failDelete?: boolean;
    failDeletePendingReview?: boolean;
    failUpdateReviewBody?: boolean;
    rootAuthorNodeId?: string | null;
    rootAuthorType?: string | null;
    isResolved?: boolean;
    initialResolvedByNodeId?: string | null;
    initialResolvedByType?: string | null;
    resolvedByNodeIdAfterResolve?: string | null;
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
    existingPendingReviewCommitOid?: string;
    addExactForeignPendingReview?: boolean;
    existingReplyReviewState?: ReviewState;
    existingReplyReviewBody?: string;
    existingReplyReviewCommitOid?: string;
    existingReplyReviewAuthorNodeId?: string | null;
    existingReplyReviewAuthorType?: string | null;
    addForeignPendingReview?: boolean;
    addExactPendingReplyMarker?: boolean;
    exactPendingReplyFullDatabaseId?: string;
    addPendingReplyMarkerToResolvedThread?: boolean;
    resolvedPendingReplyFullDatabaseId?: string;
    addExactPendingReviewAfterLostCreate?: boolean;
    attachConcurrentManagedPendingReplyAfterLostCreate?: boolean;
    attachConcurrentManagedPendingReplyDuringPendingDelete?: boolean;
    concurrentCommentedReplyAfterReplyFailure?: boolean;
    concurrentResolveAfterReplyFailure?: boolean;
    concurrentCommentedResolvedStateOnCompensationInspect?: boolean;
    addTwoExactPendingReviewsAfterLostCreate?: boolean;
    attachManagedReplyBeforeCompensation?: boolean;
    failDeleteMissingReply?: boolean;
    replyReceiptReviewId?: string;
    failUpdateReviewBodyIds?: string[];
    updateClientMutationId?: string;
    updateReceiptState?: ReviewState;
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
        pushReview(currentReviewId, 'PENDING', expectedReviewBody, input.existingPendingReviewCommitOid ?? head);
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
        pushReview(
            currentReviewId,
            input.existingReplyReviewState ?? 'COMMENTED',
            input.existingReplyReviewBody ?? expectedReviewBody,
            input.existingReplyReviewCommitOid ?? head
        );
        reviews[reviews.length - 1]!.authorNodeId = input.existingReplyReviewAuthorNodeId ?? AUTHOR_BOT_NODE_ID;
        reviews[reviews.length - 1]!.authorType = input.existingReplyReviewAuthorType ?? 'Bot';
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
            if (input.addExactPendingReviewAfterLostCreate && !compensationReplyAdded && index === 2) {
                compensationReplyAdded = true;
                pushReview('PRR_concurrent_pending', 'PENDING', pendingReviewBody(movedHead), movedHead);
            }
            if (input.addTwoExactPendingReviewsAfterLostCreate && !compensationReplyAdded && index === 2) {
                compensationReplyAdded = true;
                pushReview('PRR_concurrent_pending_1', 'PENDING', pendingReviewBody(movedHead), movedHead);
                pushReview('PRR_concurrent_pending_2', 'PENDING', pendingReviewBody(movedHead), movedHead);
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
            if (resolveCalled && input.resolvedByNodeIdAfterResolve !== undefined) {
                resolvedByNodeId = input.resolvedByNodeIdAfterResolve;
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
                authorNodeId: AUTHOR_BOT_NODE_ID,
                authorLogin,
                authorType: 'Bot',
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
                authorNodeId: review.authorNodeId,
                authorLogin: review.authorLogin,
                authorType: review.authorType,
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
                authorNodeId: review.authorNodeId,
                authorLogin: review.authorLogin,
                authorType: review.authorType,
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
function commentPage(nodes: unknown[], hasNextPage: boolean, endCursor: string | null) {
    return JSON.stringify({
        data: { node: { id: threadId, comments: { nodes, pageInfo: { hasNextPage, endCursor } } } },
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

describe('review thread resolution', () => {
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
            return reviewPage([], false, null);
        });
        expect(inspection).toMatchObject({
            pullRequestId,
            head,
            thread: { id: threadId, rootCommentFullDatabaseId: '9223372036854775807' },
            pendingReviews: [],
        });
        expect(call).toBe(4);
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
            return reviewPage([], false, null);
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
            return reviewPage([], false, null);
        });
        expect(inspection.thread?.comments).toHaveLength(101);
        expect(inspection.thread?.comments.at(-1)?.id).toBe(replyId);
        expect(calls[2]).toContain('cursor=comments-1');
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
        for (const args of [
            [],
            ['42', '--head', head, '--thread', threadId],
            ['42', '--thread', threadId, '--head', 'bad'],
        ]) {
            expect(() => parseResolveReviewThreadArgs(args)).toThrow(/usage/i);
        }
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
    it('refuses the delete-time lost-create race by preserving an ambiguous exact pending review before pending-delete can run', () => {
        const { port, authorNodeId, state, calls } = fakePort({
            throwAfterCreatePendingReview: true,
            heads: [head, movedHead],
            addExactPendingReviewAfterLostCreate: true,
            attachConcurrentManagedPendingReplyDuringPendingDelete: true,
        });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /create review transport lost[\s\S]*ambiguous pending review/i
        );
        expect(calls.filter((call) => call.startsWith('deleteReview:'))).toEqual([]);
        expect(state()).toMatchObject({
            reviews: [
                { id: reviewId, state: 'PENDING', commitOid: head },
                { id: 'PRR_concurrent_pending', state: 'PENDING', commitOid: movedHead },
            ],
            comments: [{ id: rootId }],
        });
    });
    it('preserves two newly visible exact pending reviews after lost create plus head drift and does not delete either one', () => {
        const { port, authorNodeId, state, calls } = fakePort({
            throwAfterCreatePendingReview: true,
            heads: [head, movedHead],
            addTwoExactPendingReviewsAfterLostCreate: true,
        });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /create review transport lost[\s\S]*ambiguous pending review/i
        );
        expect(calls.filter((call) => call.startsWith('deleteReview:'))).toEqual([]);
        expect(state().reviews).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: reviewId, state: 'PENDING', commitOid: head }),
                expect.objectContaining({ id: 'PRR_concurrent_pending_1', state: 'PENDING', commitOid: movedHead }),
                expect.objectContaining({ id: 'PRR_concurrent_pending_2', state: 'PENDING', commitOid: movedHead }),
            ])
        );
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
        expect(calls.filter((call) => call.startsWith('deleteReview:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('createReview:'))).toEqual([
            `createReview:${pullRequestId}`,
            `createReview:${pullRequestId}`,
        ]);
        expect(calls.filter((call) => call.startsWith('submitReview:'))).toEqual([
            `submitReview:${reviewId}`,
            'submitReview:PRR_created_1',
        ]);
        expect(state().reviews).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: reviewId,
                    state: 'COMMENTED',
                    commitOid: head,
                    body: resolutionReviewSummary(pullRequestId, threadId, head),
                }),
                expect.objectContaining({ id: 'PRR_created_1', state: 'COMMENTED', commitOid: movedHead }),
            ])
        );
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
    it('submits an old-head author pending review before staging a new current-head review', () => {
        const { port, authorNodeId, state, calls } = fakePort({
            heads: [movedHead, movedHead, movedHead, movedHead, movedHead, movedHead, movedHead, movedHead],
            existingPendingReviewCount: 1,
            existingPendingReviewCommitOid: head,
        });
        expect(resolveReviewThread(42, threadId, movedHead, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('deleteReview:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('createReview:'))).toEqual([`createReview:${pullRequestId}`]);
        expect(calls.filter((call) => call.startsWith('submitReview:'))).toEqual([
            `submitReview:${reviewId}`,
            'submitReview:PRR_created_1',
        ]);
        expect(state().reviews).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: reviewId,
                    state: 'COMMENTED',
                    commitOid: head,
                    body: resolutionReviewSummary(pullRequestId, threadId, head),
                }),
                expect.objectContaining({ id: 'PRR_created_1', state: 'COMMENTED', commitOid: movedHead }),
            ])
        );
    });
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
    it('reuses the canonical pending review and deletes duplicate script-owned pending reviews before replying', () => {
        const { port, calls, authorNodeId, state } = fakePort({ existingPendingReviewCount: 2 });
        expect(resolveReviewThread(42, threadId, head, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('createReview:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('deleteReview:'))).toEqual(['deleteReview:PRR_pending_1']);
        expect(calls.filter((call) => call.startsWith('reply:'))).toEqual([`reply:${threadId}:${reviewId}`]);
        expectCanonicalResolutionReview(state().reviews[0]!);
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
    it('submits the current-head managed pending review on an already resolved thread and deletes orphan exact drafts', () => {
        const { port, calls, authorNodeId, state } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            existingReplyReviewState: 'PENDING',
            existingPendingReviewCount: 1,
            existingPendingReviewIds: ['PRR_orphan_pending'],
        });
        expect(resolveReviewThread(42, threadId, head, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('deleteReview:'))).toEqual(['deleteReview:PRR_orphan_pending']);
        expect(calls.filter((call) => call.startsWith('submitReview:'))).toEqual([`submitReview:${reviewId}`]);
        expect(calls.filter((call) => call.startsWith('resolve:'))).toEqual([]);
        expect(state().reviews).toEqual([
            expect.objectContaining({ id: reviewId, state: 'COMMENTED', commitOid: head }),
        ]);
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
