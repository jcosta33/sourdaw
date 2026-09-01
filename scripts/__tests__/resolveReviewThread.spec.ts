import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AUTHOR_BOT_NODE_ID, REQUIRED_REPOSITORY, REVIEWER_BOT_NODE_ID, type GhSession } from '../githubAppIdentity.ts';
import { withPullRequestMutationLock } from '../pullRequestMutationLock.ts';
import {
    parseRecoverReviewResolutionLockArgs,
    runRecoverReviewResolutionLockCli,
} from '../recoverReviewResolutionLock.ts';
import {
    assertDetachedReviewResolutionChild,
    type DeletePendingReviewOptions,
    coordinateResolveReviewThread,
    defaultResolveReviewThreadCoordinatorDependencies,
    inspectReviewThread,
    parseResolveReviewThreadArgs,
    publishReviewResolutionChildLaunchMarker,
    readPersistedReviewResolutionChildLaunchMarker,
    runResolveReviewThreadCli,
    currentWindowsProcessTreeFence,
    reviewResolutionOwnerFenceIsLive,
    resolveReviewThread,
    shellPort,
    deleteReply,
    deletePendingReview,
    submitReview,
    updateReviewBody,
    recoverPullRequestReviewResolutionLock,
    recoverStandaloneReviewResolutionSharedMutationLock,
    recoverReviewResolutionLockOwnerState,
    withPullRequestReviewResolutionLock,
    type ReviewResolutionLockOwner,
    type ReviewResolutionLockOwnerFence,
    type ResolveReviewThreadCoordinatorDependencies,
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
function immutableEnvelopeSnapshot(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        markerId: replyId,
        markerFullDatabaseId: '9223372036854775808',
        reviewId,
        reviewFullDatabaseId: '9223372036854775808',
        reviewState: 'COMMENTED',
        reviewBody: '',
        reviewCommitOid: head,
        reviewAuthorNodeId: AUTHOR_BOT_NODE_ID,
        reviewAuthorLogin: 'renamed-author[bot]',
        reviewAuthorType: 'Bot',
        ...overrides,
    };
}
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
const trustedPowerShellPath = process.env.SOURDAW_TRUSTED_POWERSHELL_PATH ?? '/trusted/powershell.exe';
function createWindowsProcessQueryExecutable(stdout: string): { executable: string; dispose: () => void } {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-windows-process-query-'));
    const executable = join(root, 'powershell.exe');
    writeFileSync(executable, `#!/bin/sh\nprintf '%s' ${JSON.stringify(stdout)}\n`, { mode: 0o700 });
    chmodSync(executable, 0o700);
    return {
        executable,
        dispose: () => rmSync(root, { recursive: true, force: true }),
    };
}
type ReviewRecord = {
    id: string;
    fullDatabaseId: string;
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
        version?: number;
        pid?: number;
        pgid?: number;
        rootPid?: number;
        rootStartedAt?: string;
    };
    pgid?: number;
    threadId: string;
    head: string;
    token: string;
    sharedMutationOwnerOid?: string;
    mutation?: {
        phase?: string;
        epoch?: number;
        reviewId?: string;
        reviewDatabaseId?: string;
        replyId?: string;
        body?: string;
        reviewCommitOid?: string;
        pullRequestId?: string;
        reviewState?: 'PENDING';
        pendingReviewIds?: string[];
        settleAtMs?: number;
        replayed?: boolean;
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

function runGit(root: string, args: string[]): string {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    }
    return result.stdout.trim();
}
type Input = {
    heads?: readonly string[];
    authorNodeId?: string;
    throwAfterCreatePendingReview?: boolean;
    throwInspectAfterCreatePendingReview?: boolean;
    createClientMutationId?: string;
    createReceiptBody?: string;
    createReceiptState?: ReviewState;
    createReceiptCommitOid?: string | null;
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
    submitReceiptState?: ReviewState;
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
    reverseExistingReplyOrder?: boolean;
    existingReplyFullDatabaseIds?: readonly string[];
    deleteReplyAfterResolve?: boolean;
    editReplyAfterResolve?: boolean;
    replyClientMutationId?: string;
    replyAuthorNodeId?: string | null;
    replyAuthorType?: string | null;
    resolveClientMutationId?: string;
    resolveReceiptNodeId?: string | null;
    resolveReceiptType?: string | null;
    existingPendingReviewCount?: number;
    existingPendingReviewIds?: readonly string[];
    existingPendingReviewBody?: string;
    existingPendingReviewCommitOid?: string;
    expectedAttachedReviewThreadInspectionHead?: string;
    expectedPullRequestReviewInspectionPullRequestId?: string;
    expectedPullRequestReviewInspectionHead?: string;
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
    resolvedPendingReplyBody?: string;
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
    updateReceiptReviewId?: string;
    updateReceiptFullDatabaseId?: string;
    updateReceiptBody?: string;
    updateReceiptCommitOid?: string | null;
    updateReceiptState?: ReviewState;
    updateReceiptAuthorNodeId?: string | null;
    updateReceiptAuthorType?: string | null;
    submitReceiptReviewId?: string;
    submitReceiptBody?: string;
    submitReceiptCommitOid?: string | null;
};
function fakePort(input: Input = {}) {
    const calls: string[] = [];
    const pullRequestReviewInspections: { number: number; reviewId: string; pullRequestId: string; head: string }[] =
        [];
    const submittedReviewCommitOids: { reviewId: string; reviewCommitOid: string }[] = [];
    const updatedReviewCommitOids: { reviewId: string; reviewCommitOid: string }[] = [];
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
            authorNodeId: input.rootAuthorNodeId === undefined ? REVIEWER_BOT_NODE_ID : input.rootAuthorNodeId,
            authorLogin: reviewerLogin,
            authorType: input.rootAuthorType === undefined ? 'Bot' : input.rootAuthorType,
            reviewId: null,
        },
    ];
    const reviews: ReviewRecord[] = [];
    function pushReview(id: string, state: ReviewState, body: string, commitOid: string): void {
        reviews.push({
            id,
            fullDatabaseId: String(9223372036854775808n + BigInt(reviews.length)),
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
            authorNodeId: input.replyAuthorNodeId === undefined ? AUTHOR_BOT_NODE_ID : input.replyAuthorNodeId,
            authorLogin,
            authorType: input.replyAuthorType === undefined ? 'Bot' : input.replyAuthorType,
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
            fullDatabaseId: '9223372036854775890',
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
            fullDatabaseId: '9223372036854775891',
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
        const existingReviewAuthorNodeId =
            input.existingReplyReviewAuthorNodeId === undefined
                ? AUTHOR_BOT_NODE_ID
                : input.existingReplyReviewAuthorNodeId;
        const existingReviewAuthorType =
            input.existingReplyReviewAuthorType === undefined ? 'Bot' : input.existingReplyReviewAuthorType;
        const reviewAuthorNodeId =
            useSecondaryReplyReview && input.secondaryReplyReviewAuthorNodeId !== undefined
                ? input.secondaryReplyReviewAuthorNodeId
                : existingReviewAuthorNodeId;
        const reviewAuthorType =
            useSecondaryReplyReview && input.secondaryReplyReviewAuthorType !== undefined
                ? input.secondaryReplyReviewAuthorType
                : existingReviewAuthorType;
        if (!reviewMissing) {
            pushReview(configuredReviewId, reviewState, reviewBody, reviewCommitOid);
            reviews[reviews.length - 1]!.authorNodeId = reviewAuthorNodeId;
            reviews[reviews.length - 1]!.authorType = reviewAuthorType;
        }
        pushReply(
            replyIndex === 0 ? replyId : `PRRC_existing_${replyIndex}`,
            input.existingReplyFullDatabaseIds?.[replyIndex] ?? String(9223372036854775808n + BigInt(replyIndex)),
            configuredReviewId
        );
    }
    if (input.reverseExistingReplyOrder) {
        const existingReplies = comments.filter(
            (comment) => comment.id === replyId || comment.id.startsWith('PRRC_existing_')
        );
        const otherComments = comments.filter(
            (comment) => comment.id !== replyId && !comment.id.startsWith('PRRC_existing_')
        );
        comments.splice(0, comments.length, ...otherComments, ...existingReplies.reverse());
    }
    if (input.addPendingReplyMarkerToResolvedThread) {
        pushReview('PRR_resolved_pending', 'PENDING', input.resolvedPendingReplyBody ?? expectedReviewBody, head);
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
                            reviewFullDatabaseId: review?.fullDatabaseId ?? null,
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
                        fullDatabaseId: review.fullDatabaseId,
                        state: review.state,
                        body: review.body,
                        commitOid: review.commitOid,
                        authorNodeId: review.authorNodeId,
                        authorLogin: review.authorLogin,
                        authorType: review.authorType,
                    })),
            };
        },
        inspectPullRequestReview: (number, id, expectedPullRequestId, expectedHead) => {
            pullRequestReviewInspections.push({
                number,
                reviewId: id,
                pullRequestId: expectedPullRequestId,
                head: expectedHead,
            });
            if (
                input.expectedPullRequestReviewInspectionPullRequestId !== undefined &&
                expectedPullRequestId !== input.expectedPullRequestReviewInspectionPullRequestId
            ) {
                throw new Error(`unexpected review inspection pull request ${expectedPullRequestId}`);
            }
            if (
                input.expectedPullRequestReviewInspectionHead !== undefined &&
                expectedHead !== input.expectedPullRequestReviewInspectionHead
            ) {
                throw new Error(`unexpected review inspection head ${expectedHead}`);
            }
            const review = reviewById(id);
            if (review === undefined) {
                return null;
            }
            return {
                id: review.id,
                fullDatabaseId: review.fullDatabaseId,
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
                fullDatabaseId: reviewById(id)?.fullDatabaseId ?? null,
                state: input.createReceiptState ?? 'PENDING',
                body: input.createReceiptBody ?? body,
                commitOid: input.createReceiptCommitOid ?? commitOid,
                authorNodeId:
                    input.createReceiptAuthorNodeId === undefined
                        ? AUTHOR_BOT_NODE_ID
                        : input.createReceiptAuthorNodeId,
                authorLogin,
                authorType: input.createReceiptAuthorType === undefined ? 'Bot' : input.createReceiptAuthorType,
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
                authorNodeId: input.replyAuthorNodeId === undefined ? AUTHOR_BOT_NODE_ID : input.replyAuthorNodeId,
                authorLogin,
                authorType: input.replyAuthorType === undefined ? 'Bot' : input.replyAuthorType,
                reviewId: receiptReviewId,
                reviewFullDatabaseId: reviewById(receiptReviewId)?.fullDatabaseId ?? null,
                reviewState: reviewById(receiptReviewId)?.state ?? null,
                reviewBody: reviewById(receiptReviewId)?.body ?? null,
                reviewCommitOid: reviewById(receiptReviewId)?.commitOid ?? null,
                reviewAuthorNodeId: reviewById(receiptReviewId)?.authorNodeId ?? null,
                reviewAuthorLogin: reviewById(receiptReviewId)?.authorLogin ?? null,
                reviewAuthorType: reviewById(receiptReviewId)?.authorType ?? null,
                clientMutationId: input.replyClientMutationId ?? `review-reply:${id}`,
            };
        },
        submitReview: (currentReviewId, body, reviewCommitOid) => {
            calls.push(`submitReview:${currentReviewId}`);
            const review = reviewById(currentReviewId);
            if (review === undefined) {
                throw new Error(`missing review ${currentReviewId}`);
            }
            if (review.commitOid !== reviewCommitOid) {
                throw new Error(`unexpected submit review commit ${reviewCommitOid}`);
            }
            submittedReviewCommitOids.push({ reviewId: currentReviewId, reviewCommitOid });
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
                id: input.submitReceiptReviewId ?? currentReviewId,
                fullDatabaseId: review.fullDatabaseId,
                state: input.submitReceiptState ?? review.state,
                body: input.submitReceiptBody ?? review.body,
                commitOid: input.submitReceiptCommitOid ?? review.commitOid,
                authorNodeId:
                    input.submitReceiptAuthorNodeId === undefined
                        ? review.authorNodeId
                        : input.submitReceiptAuthorNodeId,
                authorLogin: review.authorLogin,
                authorType:
                    input.submitReceiptAuthorType === undefined ? review.authorType : input.submitReceiptAuthorType,
                clientMutationId: input.submitClientMutationId ?? `review-submit:${currentReviewId}`,
            };
        },
        updateReviewBody: (currentReviewId, body, reviewCommitOid) => {
            calls.push(`updateReview:${currentReviewId}`);
            const review = reviewById(currentReviewId);
            if (review === undefined) {
                throw new Error(`missing review ${currentReviewId}`);
            }
            if (review.commitOid !== reviewCommitOid) {
                throw new Error(`unexpected update review commit ${reviewCommitOid}`);
            }
            updatedReviewCommitOids.push({ reviewId: currentReviewId, reviewCommitOid });
            if (input.failUpdateReviewBody || input.failUpdateReviewBodyIds?.includes(currentReviewId)) {
                throw new Error('update denied');
            }
            review.body = body;
            return {
                id: input.updateReceiptReviewId ?? currentReviewId,
                fullDatabaseId:
                    input.updateReceiptFullDatabaseId === undefined
                        ? review.fullDatabaseId
                        : input.updateReceiptFullDatabaseId,
                state: input.updateReceiptState ?? review.state,
                body: input.updateReceiptBody ?? review.body,
                commitOid: input.updateReceiptCommitOid ?? review.commitOid,
                authorNodeId:
                    input.updateReceiptAuthorNodeId === undefined
                        ? review.authorNodeId
                        : input.updateReceiptAuthorNodeId,
                authorLogin: review.authorLogin,
                authorType:
                    input.updateReceiptAuthorType === undefined ? review.authorType : input.updateReceiptAuthorType,
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
                resolvedByNodeId: (input.resolveReceiptNodeId === undefined
                    ? resolvedByNodeId
                    : input.resolveReceiptNodeId) as never,
                resolvedByLogin,
                resolvedByType: (input.resolveReceiptType === undefined
                    ? resolvedByType
                    : input.resolveReceiptType) as never,
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
            if (
                typeof input.expectedAttachedReviewThreadInspectionHead === 'string' &&
                expectedHead !== input.expectedAttachedReviewThreadInspectionHead
            ) {
                throw new Error(`unexpected attachment inspection head ${expectedHead}`);
            }
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
        pullRequestReviewInspections,
        deletePendingReviewCalls,
        authorNodeId: input.authorNodeId ?? AUTHOR_BOT_NODE_ID,
        state: () => ({
            resolved,
            resolvedByNodeId,
            resolvedByLogin,
            resolvedByType,
            comments,
            reviews,
            submittedReviewCommitOids,
            updatedReviewCommitOids,
        }),
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
        injectManagedPendingReview: (currentReviewId: string = 'PRR_delayed_pending') => {
            pushReview(currentReviewId, 'PENDING', expectedReviewBody, head);
        },
    };
}

function strictExpectedReviewUpdatePort(
    port: ResolveReviewThreadPort,
    expected: { id: string; fullDatabaseId: string; commitOid: string }
): ResolveReviewThreadPort {
    return {
        ...port,
        updateReviewBody: (reviewId, body, reviewCommitOid, review) => {
            if (
                review === undefined ||
                review.id !== expected.id ||
                reviewId !== expected.id ||
                review.fullDatabaseId !== expected.fullDatabaseId ||
                review.commitOid !== expected.commitOid ||
                reviewCommitOid !== expected.commitOid
            ) {
                throw new Error('update review body requires the inspected immutable review identity');
            }
            return port.updateReviewBody(reviewId, body, reviewCommitOid, review);
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

function createTemporaryGitRepository(objectFormat: 'sha1' | 'sha256' = 'sha1'): string {
    const directory = mkdtempSync(join(tmpdir(), 'resolve-review-thread-lock-'));
    const init = spawnSync(
        'git',
        ['init', '--quiet', ...(objectFormat === 'sha256' ? ['--object-format=sha256'] : [])],
        {
            cwd: directory,
            encoding: 'utf8',
            shell: false,
        }
    );
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
            "if (args[0] === 'api' && args[1] === '--method' && args[2] === 'PUT') {",
            '  const endpoint = args[3];',
            '  const bodyIndex = args.findIndex((value, index) => value === "-f" && args[index + 1]?.startsWith("body="));',
            '  if (typeof endpoint !== "string" || bodyIndex < 0) { console.error(`invalid review update ${JSON.stringify(args)}`); process.exit(1); }',
            '  const body = args[bodyIndex + 1].slice("body=".length);',
            '  const response = responses[`updateReview:${endpoint}:${body}`];',
            '  if (typeof response !== "string") { console.error(`unexpected review update ${endpoint}`); process.exit(1); }',
            '  process.stdout.write(response);',
            '  process.exit(0);',
            '}',
            "if (args[0] !== 'api' || args[1] !== 'graphql') {",
            '  console.error(`unexpected gh args ${JSON.stringify(args)}`);',
            '  process.exit(1);',
            '}',
            'const queryArg = args.find((value) => value.startsWith("query="));',
            "if (queryArg === undefined) { console.error('missing query'); process.exit(1); }",
            'const query = queryArg.slice("query=".length);',
            "if (query.includes('comments(first:100') && !query.includes('pullRequestReview{id fullDatabaseId state body commit{oid} author{login __typename ... on Bot{id}}}')) { console.error('review inspection omitted the decimal review identity'); process.exit(1); }",
            "if (query.includes('node(id:$reviewId){... on PullRequestReview') && !query.includes('id fullDatabaseId state body commit{oid} author{login __typename ... on Bot{id}} pullRequest{id}')) { console.error('review lookup omitted the decimal review identity'); process.exit(1); }",
            "if (query.includes('reviews(first:100') && !query.includes('nodes{id fullDatabaseId state body commit{oid} author{login __typename ... on Bot{id}}}')) { console.error('pending-review inspection omitted the decimal review identity'); process.exit(1); }",
            'const fields = new Map();',
            'for (let index = 0; index < args.length; index += 1) {',
            "  if (args[index] !== '-F' && args[index] !== '-f') continue;",
            '  const field = args[index + 1];',
            "  if (typeof field !== 'string') { console.error('missing field value'); process.exit(1); }",
            "  if (field.startsWith('query=')) continue;",
            "  const separator = field.indexOf('=');",
            '  if (separator <= 0) { console.error(`invalid field ${field}`); process.exit(1); }',
            '  fields.set(field.slice(0, separator), field.slice(separator + 1));',
            '}',
            "let key = 'unknown';",
            "if (query.includes('comments(first:100')) key = `comments:${fields.get('threadId') ?? ''}:${fields.get('cursor') ?? ''}`;",
            "else if (query.includes('reviews(first:100')) key = `reviews:${fields.get('cursor') ?? ''}`;",
            "else if (query.includes('reviewThreads(first:100')) key = `threads:${fields.get('cursor') ?? ''}`;",
            "else if (query.includes('node(id:$reviewId){... on PullRequestReview{')) key = `review:${fields.get('reviewId') ?? ''}`;",
            "else if (query === 'mutation($pullRequestId:ID!,$body:String!,$commitOid:GitObjectID!,$clientMutationId:String!){addPullRequestReview(input:{pullRequestId:$pullRequestId,body:$body,commitOID:$commitOid,clientMutationId:$clientMutationId}){clientMutationId pullRequestReview{id state body commit{oid} author{login __typename ... on Bot{id}}}}}') key = `createReview:${fields.get('pullRequestId') ?? ''}:${fields.get('body') ?? ''}:${fields.get('commitOid') ?? ''}:${fields.get('clientMutationId') ?? ''}`;",
            "else if (query === 'mutation($reviewId:ID!,$body:String!,$clientMutationId:String!){submitPullRequestReview(input:{pullRequestReviewId:$reviewId,event:COMMENT,body:$body,clientMutationId:$clientMutationId}){clientMutationId pullRequestReview{id state body commit{oid} author{login __typename ... on Bot{id}}}}}') key = `submitReview:${fields.get('reviewId') ?? ''}:${fields.get('body') ?? ''}:${fields.get('clientMutationId') ?? ''}`;",
            "else if (query === 'mutation($reviewId:ID!,$body:String!,$clientMutationId:String!){updatePullRequestReview(input:{pullRequestReviewId:$reviewId,body:$body,clientMutationId:$clientMutationId}){clientMutationId pullRequestReview{id state body commit{oid} author{login __typename ... on Bot{id}}}}}') key = `updateReview:${fields.get('reviewId') ?? ''}:${fields.get('body') ?? ''}:${fields.get('clientMutationId') ?? ''}`;",
            "else if (query === 'mutation($threadId:ID!,$reviewId:ID!,$body:String!,$clientMutationId:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewId:$reviewId,pullRequestReviewThreadId:$threadId,body:$body,clientMutationId:$clientMutationId}){clientMutationId comment{id fullDatabaseId body author{login __typename ... on Bot{id}} pullRequestReview{id state body commit{oid} author{login __typename ... on Bot{id}}}}}}') key = `reply:${fields.get('threadId') ?? ''}:${fields.get('reviewId') ?? ''}:${fields.get('body') ?? ''}:${fields.get('clientMutationId') ?? ''}`;",
            "else if (query.includes('deletePullRequestReviewComment')) key = `deleteReply:${fields.get('replyId') ?? ''}`;",
            "else if (query.includes('node(id:$threadId){... on PullRequestReviewThread{id isResolved resolvedBy{id login __typename}}')) key = `threadResolution:${fields.get('threadId') ?? ''}`;",
            "const expected = query.includes('addPullRequestReview(input:{') ? ['pullRequestId','body','commitOid','clientMutationId'] : query.includes('submitPullRequestReview(input:{') || query.includes('updatePullRequestReview(input:{') ? ['reviewId','body','clientMutationId'] : query.includes('addPullRequestReviewThreadReply(input:{') ? ['threadId','reviewId','body','clientMutationId'] : undefined;",
            'if (expected !== undefined && (fields.size !== expected.length || expected.some((name) => !fields.has(name)))) { console.error(`invalid mutation fields ${JSON.stringify([...fields.keys()])}`); process.exit(1); }',
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
    mutation:
        | 'createPendingReview'
        | 'replyDone'
        | 'submitReview'
        | 'updateReviewBody'
        | 'resolveThread'
        | 'deleteReply'
        | 'deletePendingReview'
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
        case 'updateReviewBody':
            queryPattern =
                'updatePullRequestReview(input:{pullRequestReviewId:$reviewId,body:$body,clientMutationId:$clientMutationId})';
            transportLabel = 'update';
            break;
        case 'resolveThread':
            queryPattern = 'resolveReviewThread(input:{threadId:$threadId,clientMutationId:$clientMutationId})';
            transportLabel = 'resolve';
            break;
        case 'deleteReply':
            queryPattern = 'deletePullRequestReviewComment(input:{id:$replyId,clientMutationId:$clientMutationId})';
            transportLabel = 'delete reply';
            break;
        case 'deletePendingReview':
            queryPattern =
                'deletePullRequestReview(input:{pullRequestReviewId:$reviewId,clientMutationId:$clientMutationId})';
            transportLabel = 'delete pending review';
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
            `if (${JSON.stringify(mutation)} === 'updateReviewBody' && args[0] === 'api' && args[1] === '--method' && args[2] === 'PUT' && typeof args[3] === 'string' && args[3].includes('/reviews/')) { fs.writeFileSync(calledPath, '1'); console.error(\`${transportLabel} mutation transport lost\`); process.exit(1); }`,
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

function reviewResolutionLockRef(number: number): string {
    return `refs/sourdaw/review-resolution/pr-${number}`;
}

function sharedMutationLockRef(number: number): string {
    return `refs/sourdaw/delivery/pr-${number}`;
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

function readSharedMutationLockOid(repository: string, number: number): string | undefined {
    const result = spawnSync('git', ['rev-parse', '--verify', '--quiet', sharedMutationLockRef(number)], {
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

function writeSharedMutationLockOwnerBlob(repository: string, pid: number): string {
    return gitCapture(
        repository,
        ['hash-object', '-w', '--stdin'],
        JSON.stringify({ version: 1, pid, token: '22222222-2222-4222-8222-222222222222' })
    );
}

function writeStandaloneReviewResolutionSharedMutationLockOwnerBlob(
    repository: string,
    pid: number,
    options: {
        number?: number;
        threadId?: string;
        head?: string;
        ownerFence?: ReviewResolutionLockOwnerFence;
        version?: 1 | 2;
    } = {}
): string {
    if (options.version === 1) {
        return writeSharedMutationLockOwnerBlob(repository, pid);
    }
    return gitCapture(
        repository,
        ['hash-object', '-w', '--stdin'],
        JSON.stringify({
            version: 2,
            pid,
            token: `00000000-0000-4000-8000-${String(pid).padStart(12, '0')}`,
            operation: 'review-resolution',
            number: options.number ?? 42,
            threadId: options.threadId ?? threadId,
            head: options.head ?? head,
            ownerFence: options.ownerFence ?? { kind: 'pid', pid },
        })
    );
}

function updateSharedMutationLock(repository: string, number: number, nextOid: string, previousOid?: string): void {
    const args =
        previousOid === undefined
            ? [sharedMutationLockRef(number), nextOid, '0'.repeat(nextOid.length)]
            : [sharedMutationLockRef(number), nextOid, previousOid];
    gitCapture(repository, ['update-ref', ...args]);
}

function updateGitRef(repository: string, args: string[]): boolean {
    const result = spawnSync(systemGitPath(), ['update-ref', ...args], {
        cwd: repository,
        encoding: 'utf8',
        shell: false,
    });
    if (result.error !== undefined) {
        throw result.error;
    }
    return result.status === 0;
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
        reviewDatabaseId?: string;
        replyId?: string;
        body?: string;
        pendingReviewIds?: readonly string[];
        settleAtMs?: number;
        replayed?: boolean;
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
        reviewDatabaseId?: string;
        replyId?: string;
        body?: string;
        reviewCommitOid?: string;
        pullRequestId?: string;
        reviewState?: 'PENDING';
        pendingReviewIds?: readonly string[];
        settleAtMs?: number;
        replayed?: boolean;
        replies?: readonly { replyId: string; reviewId: string; reviewState: 'PENDING' | 'COMMENTED' }[];
        allowedAttachedThreadIds?: readonly string[];
        snapshotHead?: string;
        marker?: ReturnType<typeof immutableEnvelopeSnapshot>;
        immutableEnvelope?: ReturnType<typeof immutableEnvelopeSnapshot>;
        target?: ReturnType<typeof immutableEnvelopeSnapshot>;
        dispatchState?: string;
    } = {
        phase: 'idle',
        epoch: 0,
    },
    ownerFence: ReviewResolutionLockOwnerFence = {
        kind: 'pgid',
        pgid: pid,
        leaderStartedAt: 'Mon Aug 31 12:00:00 2026',
    },
    legacyUnjournaled?: unknown,
    sharedMutationOwnerOid?: string
): string {
    let journaledMutation = mutation;
    if (mutation.phase === 'createPendingReview') {
        journaledMutation = {
            ...mutation,
            pullRequestId: mutation.pullRequestId ?? pullRequestId,
            body: mutation.body ?? resolutionReviewSummary(pullRequestId, threadId, currentHead),
            reviewCommitOid: mutation.reviewCommitOid ?? currentHead,
        };
    } else if (mutation.phase === 'replyDone') {
        journaledMutation = {
            ...mutation,
            reviewState: 'PENDING' as const,
            body: mutation.body ?? resolutionReviewSummary(pullRequestId, threadId, currentHead),
            reviewCommitOid: mutation.reviewCommitOid ?? currentHead,
        };
    } else if (mutation.phase === 'createPendingReviewSettlement') {
        journaledMutation = {
            ...mutation,
            pullRequestId: mutation.pullRequestId ?? pullRequestId,
            body: mutation.body ?? resolutionReviewSummary(pullRequestId, threadId, currentHead),
            reviewCommitOid: mutation.reviewCommitOid ?? currentHead,
            replayed: mutation.replayed ?? false,
        };
    } else if (mutation.phase === 'replyDoneSettlement') {
        journaledMutation = {
            ...mutation,
            body: mutation.body ?? resolutionReviewSummary(pullRequestId, threadId, currentHead),
            reviewCommitOid: mutation.reviewCommitOid ?? currentHead,
            replayed: mutation.replayed ?? false,
        };
    } else if (
        (mutation.phase === 'submitReview' || mutation.phase === 'updateReviewBody') &&
        mutation.reviewCommitOid === undefined
    ) {
        journaledMutation = { ...mutation, reviewCommitOid: currentHead };
    }
    return gitCapture(
        repository,
        ['hash-object', '-w', '--stdin'],
        JSON.stringify({
            version: sharedMutationOwnerOid === undefined ? 5 : 6,
            pid,
            ownerFence,
            threadId,
            head: currentHead,
            token: '11111111-1111-4111-8111-111111111111',
            mutation: journaledMutation,
            ...(sharedMutationOwnerOid === undefined ? {} : { sharedMutationOwnerOid }),
            ...(legacyUnjournaled === undefined ? {} : { legacyUnjournaled }),
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
        join(scriptsRoot, 'pullRequestMutationLock.ts'),
        readFileSync(join(import.meta.dirname, '../pullRequestMutationLock.ts'))
    );
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
            'export function originMainBlob(repoRelativePath) {',
            '  if (repoRelativePath !== "scripts/resolveReviewThread.ts") throw new Error(`unexpected origin path ${repoRelativePath}`);',
            "  return 'trusted';",
            '}',
            'export function parseGraphqlResponse(output) { return JSON.parse(output); }',
            'export function resolvePrimaryRoot() {',
            '  const root = process.env.SOURDAW_TEST_PRIMARY_ROOT;',
            "  if (typeof root !== 'string' || root.trim() === '') throw new Error('missing test primary root');",
            '  return root;',
            '}',
            'export function spawnCapture(command, args, options = {}) {',
            "  if (command !== 'gh') throw new Error(`unexpected command ${command}`);",
            "  if (args[0] === 'repo' && args[1] === 'view') return process.env.SOURDAW_TEST_REPOSITORY_NAME ?? REQUIRED_REPOSITORY;",
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
            'export function originMainBlob(repoRelativePath, cwd = process.cwd(), env, gitCommand = process.env.SOURDAW_TEST_TRUSTED_GIT_PATH ?? "git", revision = "origin/main") {',
            '  if (repoRelativePath !== "scripts/resolveReviewThread.ts") throw new Error(`unexpected origin path ${repoRelativePath}`);',
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
            'export function originMainBlob(repoRelativePath, cwd = process.cwd(), env, gitCommand = process.env.SOURDAW_TEST_TRUSTED_GIT_PATH ?? "git", revision = "origin/main") {',
            '  if (repoRelativePath !== "scripts/recoverReviewResolutionLock.ts") throw new Error(`unexpected origin path ${repoRelativePath}`);',
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
        join(scriptsRoot, 'pullRequestMutationLock.ts'),
        readFileSync(join(import.meta.dirname, '../pullRequestMutationLock.ts'))
    );
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
            'export function originMainBlob(repoRelativePath) {',
            '  if (repoRelativePath !== "scripts/recoverReviewResolutionLock.ts") throw new Error(`unexpected origin path ${repoRelativePath}`);',
            "  return 'trusted';",
            '}',
            'export function parseGraphqlResponse(output) { return JSON.parse(output); }',
            'export function resolvePrimaryRoot() {',
            '  const root = process.env.SOURDAW_TEST_PRIMARY_ROOT;',
            "  if (typeof root !== 'string' || root.trim() === '') throw new Error('missing test primary root');",
            '  return root;',
            '}',
            'export function spawnCapture(command, args, options = {}) {',
            "  if (command !== 'gh') throw new Error(`unexpected command ${command}`);",
            "  if (args[0] === 'repo' && args[1] === 'view') return process.env.SOURDAW_TEST_REPOSITORY_NAME ?? REQUIRED_REPOSITORY;",
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
        const executionFence = {
            pid: process.pid,
            ownerFence: { kind: 'pgid' as const, pgid: process.pid, leaderStartedAt: '1' },
        };
        try {
            expect(() =>
                withPullRequestReviewResolutionLock(
                    repository,
                    42,
                    threadId,
                    head,
                    () => {
                        const previousOwnerOid = readLockOid(repository, 42);
                        expect(previousOwnerOid).toBeDefined();
                        expect(() =>
                            resolveReviewThread(42, `${threadId}_other`, head, AUTHOR_BOT_NODE_ID, {
                                ...fakePort().port,
                                serializeReviewThreadMutation: (number, currentThreadId, expectedHead, operation) =>
                                    withPullRequestReviewResolutionLock(
                                        repository,
                                        number,
                                        currentThreadId,
                                        expectedHead,
                                        operation,
                                        { executionFence }
                                    ),
                            })
                        ).toThrow(
                            `review resolution on PR #42 is already being resolved by process group ${process.pid}; exact previous owner ${previousOwnerOid}; recover with pnpm review:resolve:recover 42 --owner ${previousOwnerOid}`
                        );
                        expect(
                            withPullRequestReviewResolutionLock(repository, 43, threadId, head, () => 'other-pr', {
                                executionFence,
                            })
                        ).toBe('other-pr');
                        throw new Error('boom');
                    },
                    { executionFence }
                )
            ).toThrow(/boom/);
            expect(
                withPullRequestReviewResolutionLock(repository, 42, threadId, head, () => 'ok', { executionFence })
            ).toBe('ok');
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('does not enter a resolution operation when the initial zero-ref CAS loses without a competing owner', () => {
        const repository = createTemporaryGitRepository();
        let entered = false;
        const acquireCalls: string[][] = [];
        try {
            expect(() =>
                withPullRequestReviewResolutionLock(
                    repository,
                    42,
                    threadId,
                    head,
                    () => {
                        entered = true;
                    },
                    {
                        acquireRef: (_primaryRoot, args) => {
                            acquireCalls.push(args);
                            return false;
                        },
                        readOid: () => undefined,
                    }
                )
            ).toThrow(/lock could not be acquired/);
            expect(entered).toBe(false);
            expect(acquireCalls).toHaveLength(1);
            const [ref, ownerOid, expectedZeroOid] = acquireCalls[0]!;
            expect(ref).toBe('refs/sourdaw/review-resolution/pr-42');
            expect(ownerOid).toMatch(/^[0-9a-f]{40}$/);
            expect(expectedZeroOid).toBe('0'.repeat(ownerOid!.length));
            expect(JSON.parse(gitCapture(repository, ['cat-file', 'blob', ownerOid!]))).toMatchObject({
                version: 5,
                threadId,
                head,
            });
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('normalizes the current POSIX group identity across caller locale and timezone', () => {
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
                `#!/bin/sh\nprintf '%s|%s|%s|%s\\n' "$LC_ALL" "$LANG" "$TZ" "$SOURDAW_TEST_CALLER_ONLY" >> ${JSON.stringify(trustedMarker)}\nexec ${JSON.stringify(trustedPsPath)} "$@"\n`
            );
            chmodSync(trustedPs, 0o700);
            writeFileSync(
                join(hostileBin, 'ps'),
                `#!/bin/sh\nprintf hostile > ${JSON.stringify(hostileMarker)}\nexit 91\n`
            );
            chmodSync(join(hostileBin, 'ps'), 0o700);

            const captureOwnerFence = (environment: NodeJS.ProcessEnv): ReviewResolutionLockOwnerFence => {
                let ownerFence: ReviewResolutionLockOwnerFence | undefined;
                withTemporaryEnvironment(environment, () => {
                    expect(
                        withPullRequestReviewResolutionLock(repository, 42, threadId, head, () => {
                            ownerFence = requireLockOwner(repository, 42).ownerFence;
                            return 'ok';
                        })
                    ).toBe('ok');
                });
                if (ownerFence === undefined) {
                    throw new Error('review-resolution lock did not persist a POSIX owner fence');
                }
                return ownerFence;
            };
            const europeanFence = captureOwnerFence({
                PATH: `${hostileBin}${delimiter}${previousPath ?? ''}`,
                SOURDAW_TRUSTED_PS_PATH: trustedPs,
                LC_ALL: 'de_CH.UTF-8',
                LANG: 'de_CH.UTF-8',
                TZ: 'Europe/Zurich',
                SOURDAW_TEST_CALLER_ONLY: 'european-caller-environment',
            });
            const americanFence = captureOwnerFence({
                PATH: `${hostileBin}${delimiter}${previousPath ?? ''}`,
                SOURDAW_TRUSTED_PS_PATH: trustedPs,
                LC_ALL: 'en_US.UTF-8',
                LANG: 'en_US.UTF-8',
                TZ: 'America/Los_Angeles',
                SOURDAW_TEST_CALLER_ONLY: 'american-caller-environment',
            });
            expect(europeanFence).toEqual(americanFence);
            expect(europeanFence).toMatchObject({ kind: 'pgid', leaderStartedAt: expect.any(String) });
            expect(readFileSync(trustedMarker, 'utf8')).toBe('C|C|UTC|\nC|C|UTC|\nC|C|UTC|\nC|C|UTC|\n');
            expect(existsSync(hostileMarker)).toBe(false);
        } finally {
            process.env.PATH = previousPath;
            rmSync(root, { recursive: true, force: true });
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('routes explicit retired-unseen recovery arguments through the exact-owner recovery claim', async () => {
        const session: GhSession = { configDir: process.cwd(), env: {}, dispose() {} };
        const fake = fakePort();
        const calls: string[] = [];
        const dependencies = {
            trustedPrimaryRoot: () => {
                calls.push('trustedPrimaryRoot');
                return process.cwd();
            },
            authenticateAuthor: async () => {
                calls.push('authenticateAuthor');
                return { minted: { actorNodeId: AUTHOR_BOT_NODE_ID }, session };
            },
            repositoryName: () => {
                calls.push('repositoryName');
                return REQUIRED_REPOSITORY;
            },
            gh: () => {
                calls.push('gh');
                return () => '';
            },
            createPort: () => {
                calls.push('createPort');
                return fake.port;
            },
            recoverLock: () => {
                calls.push('recoverLock');
                throw new Error('unsupported recovery arguments must not recover a lock');
            },
        } satisfies Parameters<typeof runRecoverReviewResolutionLockCli>[1];

        await expect(
            runRecoverReviewResolutionLockCli(['42', '--owner', 'a'.repeat(40), '--retire-unseen'], dependencies)
        ).rejects.toThrow(/unsupported recovery arguments must not recover a lock/);
        expect(calls).toEqual([
            'trustedPrimaryRoot',
            'authenticateAuthor',
            'repositoryName',
            'gh',
            'createPort',
            'recoverLock',
        ]);
        expect(fake.calls).toEqual([]);
    });

    it('retains the exact recovery owner when terminal attachment inspection finds a foreign thread', () => {
        const repository = createTemporaryGitRepository();
        const { port: basePort, calls } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            existingReplyReviewState: 'COMMENTED',
            existingReplyReviewBody: '',
        });
        let inspections = 0;
        const port: ResolveReviewThreadPort = {
            ...basePort,
            inspect: (number, currentThreadId) => {
                const inspection = basePort.inspect(number, currentThreadId);
                inspections += 1;
                return inspection;
            },
            inspectAttachedReviewThreadIds: (number, id, expectedPullRequestId, expectedHead) => {
                const attached = basePort.inspectAttachedReviewThreadIds(
                    number,
                    id,
                    expectedPullRequestId,
                    expectedHead
                );
                return inspections >= 3 ? [...attached, 'PRRT_foreign'] : attached;
            },
        };
        const mutation = {
            phase: 'updateReviewBody' as const,
            epoch: 1,
            reviewId,
            reviewDatabaseId: '9223372036854775808',
            reviewCommitOid: head,
            body: resolutionReviewSummary(pullRequestId, threadId, head),
            marker: immutableEnvelopeSnapshot(),
        };
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, mutation);
            updateLock(repository, 42, ownerOid);
            let retainedOwnerOid: string | undefined;
            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) => {
                    retainedOwnerOid = readLockOid(repository, 42);
                    return recoverReviewResolutionLockOwnerState(42, owner, port);
                })
            ).toThrow(/unreconciled|attached review-thread comments/i);
            expect(
                calls.filter((call) =>
                    /^(createReview|reply:|updateReview|delete:|deleteReview|submit|resolve|log:)/.test(call)
                )
            ).toEqual([]);
            expect(readLockOid(repository, 42)).toBe(retainedOwnerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it.each([
        ['createPendingReview', { phase: 'createPendingReview' as const, epoch: 1 }],
        [
            'replyDone',
            {
                phase: 'replyDone' as const,
                epoch: 1,
                reviewId,
                reviewState: 'PENDING' as const,
                body: pendingReviewBody(head),
                reviewCommitOid: head,
            },
        ],
    ] as const)(
        'retires a zero-evidence %s partial mutation only after two settled inspections',
        async (_phase, mutation) => {
            const repository = createTemporaryGitRepository();
            try {
                const ownerOid = writeLockOwnerBlob(repository, 9_999_999, head, mutation);
                updateLock(repository, 42, ownerOid);
                const session: GhSession = { configDir: repository, env: {}, dispose() {} };
                const fake = fakePort({ heads: [movedHead, movedHead] });
                let monotonicNow = 0n;
                const waits: number[] = [];
                await expect(
                    runRecoverReviewResolutionLockCli(['42', '--owner', ownerOid, '--retire-unseen'], {
                        trustedPrimaryRoot: () => repository,
                        authenticateAuthor: async () => ({ minted: { actorNodeId: AUTHOR_BOT_NODE_ID }, session }),
                        repositoryName: () => REQUIRED_REPOSITORY,
                        gh: () => () => '',
                        createPort: () => fake.port,
                        clock: { now: () => 0 },
                        retirementClock: {
                            monotonicNow: () => monotonicNow,
                            wait: (milliseconds) => {
                                waits.push(milliseconds);
                                monotonicNow += 30_000_000_000n;
                            },
                        },
                        recoverLock: (primaryRoot, number, owner, reconcile) =>
                            recoverPullRequestReviewResolutionLock(primaryRoot, number, owner, reconcile, () => false),
                    })
                ).resolves.toBe(0);
                expect(fake.calls).toEqual(['inspect:1', 'inspect:2']);
                expect(waits).toEqual([30_000]);
                expect(readLockOid(repository, 42)).toBeUndefined();
            } finally {
                rmSync(repository, { recursive: true, force: true });
            }
        }
    );

    it('refuses unseen retirement when the wait returns before the monotonic deadline and preserves the exact owner ref', async () => {
        const repository = createTemporaryGitRepository();
        try {
            const ownerOid = writeLockOwnerBlob(repository, 9_999_999, head, {
                phase: 'createPendingReview',
                epoch: 1,
            });
            updateLock(repository, 42, ownerOid);
            const session: GhSession = { configDir: repository, env: {}, dispose() {} };
            const fake = fakePort();
            const waits: number[] = [];
            let failure: Error | undefined;
            try {
                await runRecoverReviewResolutionLockCli(['42', '--owner', ownerOid, '--retire-unseen'], {
                    trustedPrimaryRoot: () => repository,
                    authenticateAuthor: async () => ({ minted: { actorNodeId: AUTHOR_BOT_NODE_ID }, session }),
                    repositoryName: () => REQUIRED_REPOSITORY,
                    gh: () => () => '',
                    createPort: () => fake.port,
                    clock: { now: () => 0 },
                    retirementClock: {
                        monotonicNow: () => 0n,
                        wait: (milliseconds) => waits.push(milliseconds),
                    },
                    recoverLock: (primaryRoot, number, owner, reconcile) =>
                        recoverPullRequestReviewResolutionLock(primaryRoot, number, owner, reconcile, () => false),
                });
            } catch (error) {
                failure = error as Error;
            }
            const preservedOwnerOid = readLockOid(repository, 42);
            expect(preservedOwnerOid).toBeDefined();
            expect(failure?.message).toContain('could not prove settlement elapsed with monotonic time');
            expect(failure?.message).toContain(`preserved exact lock owner ${preservedOwnerOid}`);
            expect(fake.calls).toEqual(['inspect:1']);
            expect(waits).toEqual([30_000]);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('refuses unseen retirement when pinned inspections drift from H2 to H3 and preserves the historical H1 evidence key', async () => {
        const repository = createTemporaryGitRepository();
        try {
            const thirdHead = 'c'.repeat(40);
            const ownerOid = writeLockOwnerBlob(repository, 9_999_999, head, {
                phase: 'createPendingReview',
                epoch: 1,
            });
            updateLock(repository, 42, ownerOid);
            const session: GhSession = { configDir: repository, env: {}, dispose() {} };
            const fake = fakePort({ heads: [movedHead, thirdHead] });
            let monotonicNow = 0n;
            const waits: number[] = [];
            let failure: Error | undefined;
            try {
                await runRecoverReviewResolutionLockCli(['42', '--owner', ownerOid, '--retire-unseen'], {
                    trustedPrimaryRoot: () => repository,
                    authenticateAuthor: async () => ({ minted: { actorNodeId: AUTHOR_BOT_NODE_ID }, session }),
                    repositoryName: () => REQUIRED_REPOSITORY,
                    gh: () => () => '',
                    createPort: () => fake.port,
                    clock: { now: () => 0 },
                    retirementClock: {
                        monotonicNow: () => monotonicNow,
                        wait: (milliseconds) => {
                            waits.push(milliseconds);
                            monotonicNow += 30_000_000_000n;
                        },
                    },
                    recoverLock: (primaryRoot, number, owner, reconcile) =>
                        recoverPullRequestReviewResolutionLock(primaryRoot, number, owner, reconcile, () => false),
                });
            } catch (error) {
                failure = error as Error;
            }
            const preservedOwnerOid = readLockOid(repository, 42);
            expect(preservedOwnerOid).toBeDefined();
            expect(failure?.message).toContain('retirement refuses head drift during remote inspection');
            expect(failure?.message).toContain(`preserved exact lock owner ${preservedOwnerOid}`);
            expect(fake.calls).toEqual(['inspect:1', 'inspect:2']);
            expect(waits).toEqual([30_000]);
            expect(requireLockOwner(repository, 42)).toMatchObject({
                head,
                mutation: {
                    phase: 'createPendingReviewSettlement',
                    epoch: 2,
                    body: pendingReviewBody(head),
                    reviewCommitOid: head,
                },
            });
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('refuses unseen retirement when historical H1 create and reply evidence appears only in the second stable H2 inspection', async () => {
        for (const phase of ['createPendingReview', 'replyDone'] as const) {
            const repository = createTemporaryGitRepository();
            try {
                const mutation =
                    phase === 'createPendingReview'
                        ? { phase, epoch: 1 }
                        : {
                              phase,
                              epoch: 1,
                              reviewId,
                              reviewState: 'PENDING' as const,
                              body: pendingReviewBody(head),
                              reviewCommitOid: head,
                          };
                const ownerOid = writeLockOwnerBlob(repository, 9_999_999, head, mutation);
                updateLock(repository, 42, ownerOid);
                const session: GhSession = { configDir: repository, env: {}, dispose() {} };
                const fake = fakePort({ heads: [movedHead, movedHead] });
                let inspectionCount = 0;
                const port: ResolveReviewThreadPort = {
                    ...fake.port,
                    inspect: (number, requestedThreadId) => {
                        const inspection = fake.port.inspect(number, requestedThreadId);
                        inspectionCount += 1;
                        if (inspectionCount !== 2) {
                            return inspection;
                        }
                        if (phase === 'createPendingReview') {
                            return {
                                ...inspection,
                                pendingReviews: [
                                    ...inspection.pendingReviews,
                                    {
                                        id: reviewId,
                                        state: 'PENDING',
                                        body: pendingReviewBody(head),
                                        commitOid: head,
                                        authorNodeId: AUTHOR_BOT_NODE_ID,
                                        authorLogin: 'renamed-author[bot]',
                                        authorType: 'Bot',
                                    },
                                ],
                            };
                        }
                        if (inspection.thread === null) {
                            throw new Error('expected review thread during retirement evidence inspection');
                        }
                        return {
                            ...inspection,
                            thread: {
                                ...inspection.thread,
                                comments: [
                                    ...inspection.thread.comments,
                                    {
                                        id: replyId,
                                        fullDatabaseId: '9223372036854775808',
                                        body: 'Done',
                                        authorNodeId: AUTHOR_BOT_NODE_ID,
                                        authorLogin: 'renamed-author[bot]',
                                        authorType: 'Bot',
                                        reviewId,
                                        reviewState: 'PENDING',
                                        reviewBody: pendingReviewBody(head),
                                        reviewCommitOid: head,
                                        reviewAuthorNodeId: AUTHOR_BOT_NODE_ID,
                                        reviewAuthorLogin: 'renamed-author[bot]',
                                        reviewAuthorType: 'Bot',
                                    },
                                ],
                            },
                        };
                    },
                };
                let monotonicNow = 0n;
                const waits: number[] = [];
                let failure: Error | undefined;
                try {
                    await runRecoverReviewResolutionLockCli(['42', '--owner', ownerOid, '--retire-unseen'], {
                        trustedPrimaryRoot: () => repository,
                        authenticateAuthor: async () => ({ minted: { actorNodeId: AUTHOR_BOT_NODE_ID }, session }),
                        repositoryName: () => REQUIRED_REPOSITORY,
                        gh: () => () => '',
                        createPort: () => port,
                        clock: { now: () => 0 },
                        retirementClock: {
                            monotonicNow: () => monotonicNow,
                            wait: (milliseconds) => {
                                waits.push(milliseconds);
                                monotonicNow += 30_000_000_000n;
                            },
                        },
                        recoverLock: (primaryRoot, number, owner, reconcile) =>
                            recoverPullRequestReviewResolutionLock(primaryRoot, number, owner, reconcile, () => false),
                    });
                } catch (error) {
                    failure = error as Error;
                }
                const preservedOwnerOid = readLockOid(repository, 42);
                expect(preservedOwnerOid).toBeDefined();
                expect(failure?.message).toContain('retirement found mutation evidence during remote inspection');
                expect(failure?.message).toContain(`preserved exact lock owner ${preservedOwnerOid}`);
                expect(fake.calls).toEqual(['inspect:1', 'inspect:2']);
                expect(waits).toEqual([30_000]);
                expect(requireLockOwner(repository, 42)).toMatchObject({
                    head,
                    mutation: {
                        phase:
                            phase === 'createPendingReview' ? 'createPendingReviewSettlement' : 'replyDoneSettlement',
                        epoch: 2,
                        body: pendingReviewBody(head),
                        reviewCommitOid: head,
                    },
                });
            } finally {
                rmSync(repository, { recursive: true, force: true });
            }
        }
    });

    it('refuses unseen retirement immediately when historical H1 create and reply evidence is present only in the first H2 inspection', async () => {
        for (const phase of ['createPendingReview', 'replyDone'] as const) {
            const repository = createTemporaryGitRepository();
            try {
                const mutation =
                    phase === 'createPendingReview'
                        ? { phase, epoch: 1 }
                        : {
                              phase,
                              epoch: 1,
                              reviewId,
                              reviewState: 'PENDING' as const,
                              body: pendingReviewBody(head),
                              reviewCommitOid: head,
                          };
                const ownerOid = writeLockOwnerBlob(repository, 9_999_999, head, mutation);
                updateLock(repository, 42, ownerOid);
                const session: GhSession = { configDir: repository, env: {}, dispose() {} };
                const fake = fakePort({ heads: [movedHead, movedHead] });
                let inspectionCount = 0;
                const port: ResolveReviewThreadPort = {
                    ...fake.port,
                    inspect: (number, requestedThreadId) => {
                        const inspection = fake.port.inspect(number, requestedThreadId);
                        inspectionCount += 1;
                        if (inspectionCount !== 1) {
                            return inspection;
                        }
                        if (phase === 'createPendingReview') {
                            return {
                                ...inspection,
                                pendingReviews: [
                                    ...inspection.pendingReviews,
                                    {
                                        id: reviewId,
                                        state: 'PENDING',
                                        body: pendingReviewBody(head),
                                        commitOid: head,
                                        authorNodeId: AUTHOR_BOT_NODE_ID,
                                        authorLogin: 'renamed-author[bot]',
                                        authorType: 'Bot',
                                    },
                                ],
                            };
                        }
                        if (inspection.thread === null) {
                            throw new Error('expected review thread during retirement evidence inspection');
                        }
                        return {
                            ...inspection,
                            thread: {
                                ...inspection.thread,
                                comments: [
                                    ...inspection.thread.comments,
                                    {
                                        id: replyId,
                                        fullDatabaseId: '9223372036854775808',
                                        body: 'Done',
                                        authorNodeId: AUTHOR_BOT_NODE_ID,
                                        authorLogin: 'renamed-author[bot]',
                                        authorType: 'Bot',
                                        reviewId,
                                        reviewState: 'PENDING',
                                        reviewBody: pendingReviewBody(head),
                                        reviewCommitOid: head,
                                        reviewAuthorNodeId: AUTHOR_BOT_NODE_ID,
                                        reviewAuthorLogin: 'renamed-author[bot]',
                                        reviewAuthorType: 'Bot',
                                    },
                                ],
                            },
                        };
                    },
                };
                let monotonicNow = 0n;
                const waits: number[] = [];
                let failure: Error | undefined;
                try {
                    await runRecoverReviewResolutionLockCli(['42', '--owner', ownerOid, '--retire-unseen'], {
                        trustedPrimaryRoot: () => repository,
                        authenticateAuthor: async () => ({ minted: { actorNodeId: AUTHOR_BOT_NODE_ID }, session }),
                        repositoryName: () => REQUIRED_REPOSITORY,
                        gh: () => () => '',
                        createPort: () => port,
                        clock: { now: () => 0 },
                        retirementClock: {
                            monotonicNow: () => monotonicNow,
                            wait: (milliseconds) => {
                                waits.push(milliseconds);
                                monotonicNow += 30_000_000_000n;
                            },
                        },
                        recoverLock: (primaryRoot, number, owner, reconcile) =>
                            recoverPullRequestReviewResolutionLock(primaryRoot, number, owner, reconcile, () => false),
                    });
                } catch (error) {
                    failure = error as Error;
                }
                const preservedOwnerOid = readLockOid(repository, 42);
                expect(preservedOwnerOid).toBeDefined();
                expect(failure?.message).toContain('retirement found mutation evidence during remote inspection');
                expect(failure?.message).toContain(`preserved exact lock owner ${preservedOwnerOid}`);
                expect(fake.calls).toEqual(['inspect:1']);
                expect(waits).toEqual([]);
                expect(readLockOid(repository, 42)).toBe(preservedOwnerOid);
                expect(requireLockOwner(repository, 42)).toMatchObject({
                    head,
                    mutation: {
                        phase,
                        epoch: 1,
                        body: pendingReviewBody(head),
                        reviewCommitOid: head,
                    },
                });
            } finally {
                rmSync(repository, { recursive: true, force: true });
            }
        }
    });

    it('refuses unseen retirement when stable H2 inspections change pull-request identity', async () => {
        const repository = createTemporaryGitRepository();
        try {
            const ownerOid = writeLockOwnerBlob(repository, 9_999_999, head, {
                phase: 'createPendingReview',
                epoch: 1,
            });
            updateLock(repository, 42, ownerOid);
            const session: GhSession = { configDir: repository, env: {}, dispose() {} };
            const fake = fakePort({ heads: [movedHead, movedHead] });
            let inspectionCount = 0;
            const port: ResolveReviewThreadPort = {
                ...fake.port,
                inspect: (number, requestedThreadId) => {
                    const inspection = fake.port.inspect(number, requestedThreadId);
                    inspectionCount += 1;
                    return inspectionCount === 2
                        ? { ...inspection, pullRequestId: 'PR_kwDOOtherPullRequest' }
                        : inspection;
                },
            };
            let monotonicNow = 0n;
            const waits: number[] = [];
            let failure: Error | undefined;
            try {
                await runRecoverReviewResolutionLockCli(['42', '--owner', ownerOid, '--retire-unseen'], {
                    trustedPrimaryRoot: () => repository,
                    authenticateAuthor: async () => ({ minted: { actorNodeId: AUTHOR_BOT_NODE_ID }, session }),
                    repositoryName: () => REQUIRED_REPOSITORY,
                    gh: () => () => '',
                    createPort: () => port,
                    clock: { now: () => 0 },
                    retirementClock: {
                        monotonicNow: () => monotonicNow,
                        wait: (milliseconds) => {
                            waits.push(milliseconds);
                            monotonicNow += 30_000_000_000n;
                        },
                    },
                    recoverLock: (primaryRoot, number, owner, reconcile) =>
                        recoverPullRequestReviewResolutionLock(primaryRoot, number, owner, reconcile, () => false),
                });
            } catch (error) {
                failure = error as Error;
            }
            const preservedOwnerOid = readLockOid(repository, 42);
            expect(preservedOwnerOid).toBeDefined();
            expect(failure?.message).toContain('retirement refuses head drift during remote inspection');
            expect(failure?.message).toContain(`preserved exact lock owner ${preservedOwnerOid}`);
            expect(fake.calls).toEqual(['inspect:1', 'inspect:2']);
            expect(waits).toEqual([30_000]);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('rejects invalid resolution and recovery argv before invoking delivery dependencies', async () => {
        const session: GhSession = { configDir: process.cwd(), env: {}, dispose() {} };
        const fake = fakePort();
        const calls: string[] = [];
        const trustedLauncher = {
            primaryRoot: process.cwd(),
            gitPath: trustedGitPath,
            ghPath: trustedGhPath,
            psPath: trustedPsPath,
        };
        const resolveDependencies = {
            get trustedLauncher() {
                calls.push('resolve:trustedLauncher');
                return trustedLauncher;
            },
            authenticateAuthor: async () => {
                calls.push('resolve:authenticateAuthor');
                return { minted: { actorNodeId: AUTHOR_BOT_NODE_ID }, session };
            },
            repositoryName: () => {
                calls.push('resolve:repositoryName');
                return REQUIRED_REPOSITORY;
            },
            createPort: () => {
                calls.push('resolve:createPort');
                return fake.port;
            },
        } satisfies Parameters<typeof runResolveReviewThreadCli>[1];
        const recoveryDependencies = {
            trustedPrimaryRoot: () => {
                calls.push('recover:trustedPrimaryRoot');
                return process.cwd();
            },
            authenticateAuthor: async () => {
                calls.push('recover:authenticateAuthor');
                return { minted: { actorNodeId: AUTHOR_BOT_NODE_ID }, session };
            },
            repositoryName: () => {
                calls.push('recover:repositoryName');
                return REQUIRED_REPOSITORY;
            },
            gh: () => {
                calls.push('recover:gh');
                return () => '';
            },
            createPort: () => {
                calls.push('recover:createPort');
                return fake.port;
            },
            recoverLock: () => {
                calls.push('recover:lock');
                throw new Error('invalid argv must not recover a lock');
            },
        } satisfies Parameters<typeof runRecoverReviewResolutionLockCli>[1];
        const invalidNumbers = ['0', '-1', '1.5', '9007199254740992'];
        const invalidResolveArgs = [
            ...invalidNumbers.map((number) => [number, '--thread', threadId, '--head', head]),
            ['42', '--thread'],
            ['42', '--thread', threadId, '--head'],
            ['42', '--thread', '', '--head', head],
            ['42', '--thread', threadId, '--head', ''],
            ['42', '--thread', threadId, '--head', 'not-an-oid'],
            ['--help', '--thread'],
        ];
        const invalidRecoveryArgs = [
            ...invalidNumbers.map((number) => [number, '--owner', 'a'.repeat(40)]),
            ['42', '--owner'],
            ['42', '--owner', ''],
            ['42', '--owner', 'not-an-oid'],
            ['--help', '--owner'],
        ];
        for (const args of invalidResolveArgs) {
            await expect(runResolveReviewThreadCli(args, resolveDependencies)).rejects.toThrow();
        }
        for (const args of invalidRecoveryArgs) {
            await expect(runRecoverReviewResolutionLockCli(args, recoveryDependencies)).rejects.toThrow();
        }
        expect(calls).toEqual([]);
        expect(fake.calls).toEqual([]);
    });

    it('refuses a wrong repository from the resolution CLI before a lock or GraphQL mutation', async () => {
        const repository = createTemporaryGitRepository();
        const snapshotRoot = mkdtempSync(join(tmpdir(), 'sourdaw-review-resolve-wrong-repository-'));
        const fakeGh = createFailingReviewResolutionMutationGhExecutable('resolveThread');
        const entryPath = writeResolveReviewSnapshot(snapshotRoot);
        let child: ReturnType<typeof spawn> | undefined;
        let stderr = '';
        try {
            child = spawn(process.execPath, [entryPath, '42', '--thread', threadId, '--head', head], {
                cwd: repository,
                env: {
                    ...process.env,
                    SOURDAW_TEST_PRIMARY_ROOT: repository,
                    SOURDAW_TEST_REPOSITORY_NAME: 'other-owner/other-repository',
                    SOURDAW_TEST_TRUSTED_GH_PATH: fakeGh.executable,
                    SOURDAW_TRUSTED_ORIGIN_COMMIT: head,
                },
                stdio: ['ignore', 'ignore', 'pipe'],
                shell: false,
            });
            child.stderr?.setEncoding('utf8');
            child.stderr?.on('data', (chunk: string) => {
                stderr += chunk;
            });

            await waitForExit(child);
            expect(child.exitCode).toBe(1);
            expect(stderr).toMatch(/unexpected repository other-owner\/other-repository/i);
            expect(readLockOid(repository, 42)).toBeUndefined();
            expect(() => statSync(fakeGh.calledPath)).toThrow();
        } finally {
            if (child !== undefined) {
                child.kill('SIGKILL');
                await waitForExit(child).catch(() => undefined);
            }
            rmSync(fakeGh.root, { recursive: true, force: true });
            rmSync(snapshotRoot, { recursive: true, force: true });
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('refuses a wrong repository from the recovery CLI before reconciliation or GraphQL work', async () => {
        const repository = createTemporaryGitRepository();
        try {
            const ownerOid = writeLockOwnerBlob(repository, 9_999_999);
            updateLock(repository, 42, ownerOid);
            const session: GhSession = { configDir: repository, env: {}, dispose() {} };
            const calls: string[] = [];
            await expect(
                runRecoverReviewResolutionLockCli(['42', '--owner', ownerOid], {
                    trustedPrimaryRoot: () => {
                        calls.push('trustedPrimaryRoot');
                        return repository;
                    },
                    authenticateAuthor: async () => {
                        calls.push('authenticateAuthor');
                        return { minted: { actorNodeId: AUTHOR_BOT_NODE_ID }, session };
                    },
                    repositoryName: () => {
                        calls.push('repositoryName');
                        return 'other-owner/other-repository';
                    },
                    gh: () => {
                        calls.push('gh');
                        return () => '';
                    },
                    createPort: () => {
                        calls.push('createPort');
                        return fakePort().port;
                    },
                    recoverLock: () => {
                        calls.push('recoverLock');
                        throw new Error('recovery must not run');
                    },
                })
            ).rejects.toThrow(/refusing to operate on other-owner\/other-repository/i);
            expect(calls).toEqual(['trustedPrimaryRoot', 'authenticateAuthor', 'repositoryName']);
            expect(readLockOid(repository, 42)).toBe(ownerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it.each([
        [
            'createPendingReviewSettlement',
            { phase: 'createPendingReviewSettlement', epoch: 1, pendingReviewIds: [reviewId], settleAtMs: 1 },
            { heads: [movedHead] },
        ],
        [
            'replyDoneSettlement',
            {
                phase: 'replyDoneSettlement',
                epoch: 1,
                reviewId,
                replies: [{ replyId, reviewId, reviewState: 'PENDING' }],
                settleAtMs: 1,
            },
            { heads: [movedHead] },
        ],
    ] as const)('preserves an unseen H1 %s settlement at H2 without replaying it', (_phase, mutation, input) => {
        const repository = createTemporaryGitRepository();
        const { port, calls } = fakePort(input);
        try {
            const ownerOid = writeLockOwnerBlob(repository, 9_999_999, head, mutation);
            updateLock(repository, 42, ownerOid);

            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                    recoverReviewResolutionLockOwnerState(42, owner, port)
                )
            ).toThrow(/unreconciled in-flight/);
            expect(calls).toEqual(['inspect:1']);
            expect(readLockOid(repository, 42)).toBeDefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it.each([
        { phase: 'createPendingReview' as const, pullRequestId, body: pendingReviewBody(head), reviewCommitOid: head },
        {
            phase: 'replyDone' as const,
            reviewId,
            reviewState: 'PENDING' as const,
            body: pendingReviewBody(head),
            reviewCommitOid: head,
        },
    ])('preserves an unseen obsolete H1 $phase mutation without replaying at H2', (mutation) => {
        const repository = createTemporaryGitRepository();
        const { port, calls } = fakePort({ heads: [movedHead] });
        try {
            const ownerOid = writeLockOwnerBlob(repository, 9_999_999, head, { ...mutation, epoch: 1 });
            updateLock(repository, 42, ownerOid);
            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                    recoverReviewResolutionLockOwnerState(42, owner, port)
                )
            ).toThrow(/unreconciled in-flight/);
            expect(calls).toEqual(['inspect:1']);
            expect(readLockOid(repository, 42)).toBeDefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('never replays an unseen create settlement after a wall-clock deadline', () => {
        const repository = createTemporaryGitRepository();
        const { port, calls } = fakePort();
        try {
            const ownerOid = writeLockOwnerBlob(repository, 9_999_999, head, {
                phase: 'createPendingReviewSettlement',
                epoch: 1,
                pendingReviewIds: [],
                settleAtMs: 0,
            });
            updateLock(repository, 42, ownerOid);

            expect(() =>
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    ownerOid,
                    (owner) =>
                        recoverReviewResolutionLockOwnerState(42, owner, port, { now: () => Number.MAX_SAFE_INTEGER }),
                    () => false
                )
            ).toThrow(/unreconciled in-flight createPendingReview mutation/);
            expect(calls.filter((call) => call.startsWith('createReview:'))).toEqual([]);
            expect(readLockOid(repository, 42)).toBeDefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('never replays an unseen Done reply settlement after a wall-clock deadline', () => {
        const repository = createTemporaryGitRepository();
        const { port, calls } = fakePort({ existingPendingReviewCount: 1 });
        try {
            const ownerOid = writeLockOwnerBlob(repository, 9_999_999, head, {
                phase: 'replyDoneSettlement',
                epoch: 1,
                reviewId,
                replies: [],
                settleAtMs: 0,
            });
            updateLock(repository, 42, ownerOid);

            expect(() =>
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    ownerOid,
                    (owner) =>
                        recoverReviewResolutionLockOwnerState(42, owner, port, { now: () => Number.MAX_SAFE_INTEGER }),
                    () => false
                )
            ).toThrow(/unreconciled in-flight replyDone mutation/);
            expect(calls.filter((call) => call.startsWith('reply:'))).toEqual([]);
            expect(readLockOid(repository, 42)).toBeDefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('converges landed evidence for a replayed create settlement before refusing it', () => {
        const repository = createTemporaryGitRepository();
        const { port, calls } = fakePort({ existingPendingReviewCount: 1 });
        try {
            const ownerOid = writeLockOwnerBlob(repository, 9_999_999, head, {
                phase: 'createPendingReviewSettlement',
                epoch: 1,
                pendingReviewIds: [],
                settleAtMs: 0,
                replayed: true,
            });
            updateLock(repository, 42, ownerOid);

            recoverPullRequestReviewResolutionLock(
                repository,
                42,
                ownerOid,
                (owner) => recoverReviewResolutionLockOwnerState(42, owner, port),
                () => false
            );
            expect(calls.filter((call) => call.startsWith('createReview:'))).toEqual([]);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('converges landed evidence for a replayed Done reply settlement before refusing it', () => {
        const repository = createTemporaryGitRepository();
        const { port, calls } = fakePort({ existingPendingReviewCount: 1, existingReplyCount: 1 });
        try {
            const ownerOid = writeLockOwnerBlob(repository, 9_999_999, head, {
                phase: 'replyDoneSettlement',
                epoch: 1,
                reviewId,
                replies: [],
                settleAtMs: 0,
                replayed: true,
            });
            updateLock(repository, 42, ownerOid);

            recoverPullRequestReviewResolutionLock(
                repository,
                42,
                ownerOid,
                (owner) => recoverReviewResolutionLockOwnerState(42, owner, port),
                () => false
            );
            expect(calls.filter((call) => call.startsWith('reply:'))).toEqual([]);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
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

    it('preserves the exact Windows process-tree fence after acquisition failure', () => {
        const repository = createTemporaryGitRepository();
        try {
            withTemporaryEnvironment({ SOURDAW_TRUSTED_PS_PATH: undefined }, () => {
                const executionFence = {
                    pid: process.pid,
                    ownerFence: {
                        kind: 'win32-process-tree' as const,
                        version: 1 as const,
                        rootPid: process.pid,
                        rootStartedAt: '2026-08-30T12:00:00.000000+000',
                    },
                };
                expect(() =>
                    withPullRequestReviewResolutionLock(
                        repository,
                        42,
                        threadId,
                        head,
                        () => {
                            throw new Error('forced operation failure');
                        },
                        {
                            platform: 'win32',
                            executionFence,
                            readOid: () => {
                                throw new Error('forced owner inspection failure');
                            },
                        }
                    )
                ).toThrow(/forced owner inspection failure/);
                expect(requireLockOwner(repository, 42).ownerFence).toEqual(executionFence.ownerFence);
            });
            gitCapture(repository, ['update-ref', '-d', reviewResolutionLockRef(42)]);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it.each([
        ['ESRCH', false],
        ['EPERM', true],
    ] as const)('treats POSIX PID liveness %s as %s', (code, expected) => {
        const error = new Error(code) as NodeJS.ErrnoException;
        error.code = code;
        expect(
            reviewResolutionOwnerFenceIsLive(
                {
                    kind: 'pid',
                    pid: 1234,
                },
                {
                    probe: () => {
                        throw error;
                    },
                }
            )
        ).toBe(expected);
    });

    it('propagates unexpected POSIX PID liveness failures', () => {
        const failure = new Error('probe exploded');
        expect(() =>
            reviewResolutionOwnerFenceIsLive(
                {
                    kind: 'pid',
                    pid: 1234,
                },
                {
                    probe: () => {
                        throw failure;
                    },
                }
            )
        ).toThrow(failure);
    });

    it('fails closed for legacy Windows PID owners even when the root PID is gone', () => {
        const error = new Error('missing root process') as NodeJS.ErrnoException;
        error.code = 'ESRCH';
        expect(
            reviewResolutionOwnerFenceIsLive(
                {
                    kind: 'pid',
                    pid: 1234,
                },
                {
                    platform: 'win32',
                    probe: () => {
                        throw error;
                    },
                }
            )
        ).toBe(true);
    });

    it('keeps a POSIX process group live only when its leader identity matches', () => {
        let probes = 0;
        expect(
            reviewResolutionOwnerFenceIsLive(
                { kind: 'pgid', pgid: 1234, leaderStartedAt: 'Mon Aug 31 12:00:00 2026' },
                {
                    inspectPosixGroupLeader: () => 'Mon Aug 31 12:00:00 2026',
                    probe: () => {
                        probes += 1;
                    },
                }
            )
        ).toBe(true);
        expect(probes).toBe(1);
    });

    it('treats a reused POSIX process-group leader as dead without probing its group', () => {
        expect(
            reviewResolutionOwnerFenceIsLive(
                { kind: 'pgid', pgid: 1234, leaderStartedAt: 'Mon Aug 31 12:00:00 2026' },
                {
                    inspectPosixGroupLeader: () => 'Mon Aug 31 12:01:00 2026',
                    probe: () => {
                        throw new Error('must not probe a reused group');
                    },
                }
            )
        ).toBe(false);
    });

    it('keeps a leader-gone POSIX process group live when an original child remains', () => {
        expect(
            reviewResolutionOwnerFenceIsLive(
                { kind: 'pgid', pgid: 1234, leaderStartedAt: 'Mon Aug 31 12:00:00 2026' },
                {
                    inspectPosixGroupLeader: () => undefined,
                    probe: () => {},
                }
            )
        ).toBe(true);
    });

    it('fails closed when POSIX leader identity inspection is unavailable and probes legacy groups without a leader identity', () => {
        const missingGroup = new Error('missing process group') as NodeJS.ErrnoException;
        missingGroup.code = 'ESRCH';
        const targets: number[] = [];
        expect(
            reviewResolutionOwnerFenceIsLive(
                { kind: 'pgid', pgid: 1234, leaderStartedAt: 'Mon Aug 31 12:00:00 2026' },
                {
                    inspectPosixGroupLeader: () => null,
                    probe: (target) => {
                        targets.push(target);
                        throw missingGroup;
                    },
                }
            )
        ).toBe(true);
        expect(
            reviewResolutionOwnerFenceIsLive(
                { kind: 'pgid', pgid: 1234 },
                {
                    probe: (target) => {
                        targets.push(target);
                        throw missingGroup;
                    },
                }
            )
        ).toBe(false);
        expect(targets).toEqual([-1234]);
    });

    it('keeps legacy PGID recovery live when probing its process group is permission-denied', () => {
        const permissionDenied = new Error('permission denied') as NodeJS.ErrnoException;
        permissionDenied.code = 'EPERM';
        const targets: number[] = [];
        expect(
            reviewResolutionOwnerFenceIsLive(
                { kind: 'pgid', pgid: 1234 },
                {
                    probe: (target) => {
                        targets.push(target);
                        throw permissionDenied;
                    },
                }
            )
        ).toBe(true);
        expect(targets).toEqual([-1234]);
    });

    it('propagates an unexpected POSIX group-leader inspection failure', () => {
        const failure = new Error('leader inspection failed');
        expect(() =>
            reviewResolutionOwnerFenceIsLive(
                { kind: 'pgid', pgid: 1234, leaderStartedAt: 'Mon Aug 31 12:00:00 2026' },
                {
                    inspectPosixGroupLeader: () => {
                        throw failure;
                    },
                }
            )
        ).toThrow(failure);
    });

    it('rejects a malformed persisted POSIX group-leader identity before recovery', () => {
        const repository = createTemporaryGitRepository();
        try {
            const ownerOid = writeLockOwnerBlob(
                repository,
                9_999_999,
                head,
                { phase: 'idle', epoch: 0 },
                { kind: 'pgid', pgid: 1234, leaderStartedAt: '' }
            );
            updateLock(repository, 42, ownerOid);

            expect(() =>
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    ownerOid,
                    () => 'unexpected',
                    () => false
                )
            ).toThrow(/lock ownership is malformed/i);
            expect(readLockOid(repository, 42)).toBe(ownerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it.each([
        ['POSIX process group', { kind: 'pgid', pgid: 999998 }],
        ['process', { kind: 'pid', pid: 999998 }],
        ['Windows process tree', { kind: 'win32-process-tree', version: 1, rootPid: 999998, rootStartedAt: '1' }],
    ] as const)('rejects a v5 owner whose %s fence names another process', (_label, ownerFence) => {
        const repository = createTemporaryGitRepository();
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, { phase: 'idle', epoch: 0 }, ownerFence);
            updateLock(repository, 42, ownerOid);

            expect(() =>
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    ownerOid,
                    () => 'unexpected',
                    () => false
                )
            ).toThrow(/lock ownership is malformed/i);
            expect(readLockOid(repository, 42)).toBe(ownerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it.each([
        ['POSIX process group', { kind: 'pgid', pgid: 999998 }],
        ['process', { kind: 'pid', pid: 999998 }],
        ['Windows process tree', { kind: 'win32-process-tree', version: 1, rootPid: 999998, rootStartedAt: '1' }],
    ] as const)('rejects a v6 owner whose %s fence names another process', (_label, ownerFence) => {
        const repository = createTemporaryGitRepository();
        try {
            const sharedOwnerOid = writeSharedMutationLockOwnerBlob(repository, 999999);
            const ownerOid = writeLockOwnerBlob(
                repository,
                999999,
                head,
                { phase: 'idle', epoch: 0 },
                ownerFence,
                undefined,
                sharedOwnerOid
            );
            updateSharedMutationLock(repository, 42, sharedOwnerOid);
            updateLock(repository, 42, ownerOid);

            expect(() =>
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    ownerOid,
                    () => 'unexpected',
                    () => false
                )
            ).toThrow(/lock ownership is malformed/i);
            expect(readLockOid(repository, 42)).toBe(ownerOid);
            expect(readSharedMutationLockOid(repository, 42)).toBe(sharedOwnerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('identifies the exact live Windows root and treats absent or reused roots as recoverable', () => {
        const ownerFence = {
            kind: 'win32-process-tree' as const,
            version: 1 as const,
            rootPid: 4100,
            rootStartedAt: '2026-08-30T12:00:00.000000+000',
        };
        expect(
            reviewResolutionOwnerFenceIsLive(ownerFence, {
                inspectWindowsProcessRows: () => [
                    {
                        pid: 4100,
                        parentPid: 1,
                        startedAt: '2026-08-30T12:00:00.000000+000',
                    },
                ],
            })
        ).toBe(true);
        expect(
            reviewResolutionOwnerFenceIsLive(ownerFence, {
                inspectWindowsProcessRows: () => [
                    {
                        pid: 4101,
                        parentPid: 4100,
                        startedAt: '2026-08-30T12:00:01.000000+000',
                    },
                ],
            })
        ).toBe(true);
        expect(
            reviewResolutionOwnerFenceIsLive(ownerFence, {
                inspectWindowsProcessRows: () => [
                    { pid: 4101, parentPid: 4100, startedAt: '2026-08-30T12:00:01.000000+000' },
                    { pid: 4102, parentPid: 4101, startedAt: '2026-08-30T12:00:02.000000+000' },
                ],
            })
        ).toBe(true);
        expect(
            reviewResolutionOwnerFenceIsLive(ownerFence, {
                inspectWindowsProcessRows: () => [
                    {
                        pid: 4100,
                        parentPid: 1,
                        startedAt: '2026-08-30T13:00:00.000000+000',
                    },
                ],
            })
        ).toBe(false);
        expect(
            reviewResolutionOwnerFenceIsLive(ownerFence, {
                inspectWindowsProcessRows: () => undefined,
            })
        ).toBe(true);
    });

    it('distinguishes Windows creation identities that differ within the same millisecond', () => {
        const ownerFence = {
            kind: 'win32-process-tree' as const,
            version: 1 as const,
            rootPid: 4100,
            rootStartedAt: '2026-08-30T12:00:00.0000000Z',
        };
        expect(
            reviewResolutionOwnerFenceIsLive(ownerFence, {
                inspectWindowsProcessRows: () => [
                    { pid: 4100, parentPid: 1, startedAt: '2026-08-30T12:00:00.0000001Z' },
                ],
            })
        ).toBe(false);
        expect(
            reviewResolutionOwnerFenceIsLive(ownerFence, {
                inspectWindowsProcessRows: () => [
                    { pid: 4100, parentPid: 1, startedAt: '2026-08-30T12:00:00.0000001Z' },
                    { pid: 4101, parentPid: 4100, startedAt: '2026-08-30T12:00:00.0000000Z' },
                ],
            })
        ).toBe(true);
        expect(
            reviewResolutionOwnerFenceIsLive(ownerFence, {
                inspectWindowsProcessRows: () => [
                    { pid: 4100, parentPid: 1, startedAt: '2026-08-30T12:00:00.0000001Z' },
                    { pid: 4101, parentPid: 4100, startedAt: '2026-08-30T12:00:00.0000002Z' },
                ],
            })
        ).toBe(false);
    });

    it('fails closed when Windows process-tree inspection is unavailable', () => {
        expect(
            reviewResolutionOwnerFenceIsLive(
                {
                    kind: 'win32-process-tree',
                    version: 1,
                    rootPid: 4200,
                    rootStartedAt: '2026-08-30T12:00:00.000000+000',
                },
                {
                    inspectWindowsProcessRows: () => undefined,
                }
            )
        ).toBe(true);
    });

    it('keeps Windows recovery live only for original or ambiguous descendants', () => {
        const ownerFence = {
            kind: 'win32-process-tree' as const,
            version: 1 as const,
            rootPid: 4100,
            rootStartedAt: '2026-08-30T12:00:00.000000+000',
        };
        expect(
            reviewResolutionOwnerFenceIsLive(ownerFence, {
                inspectWindowsProcessRows: () => [
                    { pid: 4101, parentPid: 4100, startedAt: '2026-08-30T12:00:01.000000+000' },
                ],
            })
        ).toBe(true);
        expect(
            reviewResolutionOwnerFenceIsLive(ownerFence, {
                inspectWindowsProcessRows: () => [
                    { pid: 4100, parentPid: 1, startedAt: '2026-08-30T13:00:00.000000+000' },
                    { pid: 4101, parentPid: 4100, startedAt: '2026-08-30T12:30:00.000000+000' },
                ],
            })
        ).toBe(true);
        expect(
            reviewResolutionOwnerFenceIsLive(ownerFence, {
                inspectWindowsProcessRows: () => [
                    { pid: 4101, parentPid: 4100, startedAt: '2026-08-30T12:00:01.000000+000' },
                    { pid: 4102, parentPid: 4101, startedAt: '2026-08-30T12:00:02.000000+000' },
                ],
            })
        ).toBe(true);
        expect(
            reviewResolutionOwnerFenceIsLive(ownerFence, {
                inspectWindowsProcessRows: () => [
                    { pid: 4100, parentPid: 1, startedAt: '2026-08-30T13:00:00.000000+000' },
                    { pid: 4101, parentPid: 4100, startedAt: '2026-08-30T13:00:01.000000+000' },
                    { pid: 4102, parentPid: 4101, startedAt: '2026-08-30T12:00:02.000000+000' },
                ],
            })
        ).toBe(true);
        expect(
            reviewResolutionOwnerFenceIsLive(ownerFence, {
                inspectWindowsProcessRows: () => [
                    { pid: 4100, parentPid: 1, startedAt: '2026-08-30T13:00:00.000000+000' },
                    { pid: 4101, parentPid: 4100, startedAt: '2026-08-30T13:00:01.000000+000' },
                ],
            })
        ).toBe(false);
        expect(
            reviewResolutionOwnerFenceIsLive(ownerFence, {
                inspectWindowsProcessRows: () => [
                    { pid: 4100, parentPid: 1, startedAt: '2026-08-30T13:00:00.000000+000' },
                    { pid: 4101, parentPid: 4100, startedAt: '2026-08-30T13:00:01.000000+000' },
                    { pid: 4102, parentPid: 4101, startedAt: '2026-08-30T13:00:02.000000+000' },
                ],
            })
        ).toBe(false);
        expect(reviewResolutionOwnerFenceIsLive(ownerFence, { inspectWindowsProcessRows: () => [] })).toBe(false);
        expect(
            reviewResolutionOwnerFenceIsLive(ownerFence, {
                inspectWindowsProcessRows: () => [
                    { pid: 4199, parentPid: 1, startedAt: '2026-08-30T12:00:01.0000000Z' },
                ],
            })
        ).toBe(false);
    });

    it('skips the CIM System Idle Process row so a dead Windows owner remains recoverable', () => {
        const fixtureRoot = mkdtempSync(join(tmpdir(), 'sourdaw-review-win32-idle-process-'));
        const powershellPath = join(fixtureRoot, 'powershell.exe');
        const ownerFence = {
            kind: 'win32-process-tree' as const,
            version: 1 as const,
            rootPid: 4100,
            rootStartedAt: '2026-08-30T12:00:00.000000+000',
        };
        try {
            writeFileSync(
                powershellPath,
                `#!/bin/sh\nprintf '%s' '${JSON.stringify([
                    { ProcessId: 0, ParentProcessId: 'ignored', CreationDate: '' },
                    { ProcessId: 4101, ParentProcessId: 1, CreationDate: '2026-08-30T12:00:01.0000000Z' },
                ])}'\n`,
                { mode: 0o700 }
            );
            chmodSync(powershellPath, 0o700);
            expect(
                reviewResolutionOwnerFenceIsLive(ownerFence, {
                    platform: 'win32',
                    windowsProcessQueryEnv: { SOURDAW_TRUSTED_POWERSHELL_PATH: powershellPath },
                })
            ).toBe(false);
        } finally {
            rmSync(fixtureRoot, { recursive: true, force: true });
        }
    });

    it('uses the exact trusted PowerShell path and root CreationDate when building a Windows process-tree fence', () => {
        const calls: { executable: string; args: string[]; envPath: string | undefined }[] = [];
        const env: NodeJS.ProcessEnv = { SOURDAW_TRUSTED_POWERSHELL_PATH: trustedPowerShellPath };
        const fence = currentWindowsProcessTreeFence(4321, env, ((executable, args, options) => {
            calls.push({
                executable,
                args: [...(args ?? [])],
                envPath: options?.env?.SOURDAW_TRUSTED_POWERSHELL_PATH,
            });
            return {
                pid: 0,
                output: [],
                stdout: '{"ProcessId":4321,"ParentProcessId":17,"CreationDate":"2026-08-30T12:34:56.0000000Z"}',
                stderr: '',
                status: 0,
                signal: null,
            } as ReturnType<typeof spawnSync>;
        }) as typeof spawnSync);
        expect(fence).toEqual({
            kind: 'win32-process-tree',
            version: 1,
            rootPid: 4321,
            rootStartedAt: '2026-08-30T12:34:56.0000000Z',
        });
        expect(calls).toEqual([
            {
                executable: trustedPowerShellPath,
                args: [
                    '-NoProfile',
                    '-NonInteractive',
                    '-Command',
                    "Get-CimInstance Win32_Process -Filter \"ProcessId = 4321\" | Select-Object ProcessId,ParentProcessId,@{Name='CreationDate';Expression={$_.CreationDate.ToUniversalTime().ToString('O',[System.Globalization.CultureInfo]::InvariantCulture)}} | ConvertTo-Json -Compress",
                ],
                envPath: trustedPowerShellPath,
            },
        ]);
    });

    it.each([
        ['PowerShell UTC identity', '2026-08-30T12:34:56.0000000Z'],
        ['PowerShell-compatible offset identity', '2026-08-30T12:34:56.0000000+02:30'],
    ] as const)('accepts the %s Windows creation identity contract', (_label, creationDate) => {
        const fixture = createWindowsProcessQueryExecutable(
            JSON.stringify({ ProcessId: 4321, ParentProcessId: 17, CreationDate: creationDate })
        );
        try {
            expect(
                currentWindowsProcessTreeFence(4321, {
                    SOURDAW_TRUSTED_POWERSHELL_PATH: fixture.executable,
                })
            ).toMatchObject({ rootPid: 4321, rootStartedAt: creationDate });
        } finally {
            fixture.dispose();
        }
    });

    it.each([
        ['empty output', ''],
        [
            'multiple rows',
            JSON.stringify([
                { ProcessId: 4321, ParentProcessId: 17, CreationDate: '2026-08-30T12:34:56.000000+000' },
                { ProcessId: 4322, ParentProcessId: 17, CreationDate: '2026-08-30T12:34:57.000000+000' },
            ]),
        ],
        [
            'wrong PID',
            JSON.stringify({ ProcessId: 4322, ParentProcessId: 17, CreationDate: '2026-08-30T12:34:56.000000+000' }),
        ],
        [
            'duplicate PID',
            JSON.stringify([
                { ProcessId: 4321, ParentProcessId: 17, CreationDate: '2026-08-30T12:34:56.000000+000' },
                { ProcessId: 4321, ParentProcessId: 17, CreationDate: '2026-08-30T12:34:57.000000+000' },
            ]),
        ],
        ['blank CreationDate', JSON.stringify({ ProcessId: 4321, ParentProcessId: 17, CreationDate: ' ' })],
        [
            'non-O-format CreationDate',
            JSON.stringify({ ProcessId: 4321, ParentProcessId: 17, CreationDate: '2026-08-30 12:34:56Z' }),
        ],
        [
            'out-of-range CreationDate offset',
            JSON.stringify({ ProcessId: 4321, ParentProcessId: 17, CreationDate: '2026-08-30T12:34:56.0000000+24:00' }),
        ],
    ] as const)('rejects %s while building a Windows process-tree fence', (_label, stdout) => {
        const fixture = createWindowsProcessQueryExecutable(stdout);
        try {
            expect(() =>
                currentWindowsProcessTreeFence(4321, {
                    SOURDAW_TRUSTED_POWERSHELL_PATH: fixture.executable,
                })
            ).toThrow(/could not determine the current Windows process identity/i);
        } finally {
            fixture.dispose();
        }
    });

    it('uses the exact trusted PowerShell path for full Windows process-tree liveness queries', () => {
        const calls: { executable: string; args: string[]; envPath: string | undefined }[] = [];
        expect(
            reviewResolutionOwnerFenceIsLive(
                {
                    kind: 'win32-process-tree',
                    version: 1,
                    rootPid: 4400,
                    rootStartedAt: '2026-08-30T12:00:00.000000+000',
                },
                {
                    platform: 'win32',
                    windowsProcessQueryEnv: {
                        SOURDAW_TRUSTED_POWERSHELL_PATH: trustedPowerShellPath,
                    },
                    runWindowsProcessQuery: ((executable, args, options) => {
                        calls.push({
                            executable,
                            args: [...(args ?? [])],
                            envPath: options?.env?.SOURDAW_TRUSTED_POWERSHELL_PATH,
                        });
                        return {
                            pid: 0,
                            output: [],
                            stdout: '[]',
                            stderr: '',
                            status: 0,
                            signal: null,
                        } as ReturnType<typeof spawnSync>;
                    }) as typeof spawnSync,
                }
            )
        ).toBe(false);
        expect(calls).toEqual([
            {
                executable: trustedPowerShellPath,
                args: [
                    '-NoProfile',
                    '-NonInteractive',
                    '-Command',
                    "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,@{Name='CreationDate';Expression={$_.CreationDate.ToUniversalTime().ToString('O',[System.Globalization.CultureInfo]::InvariantCulture)}} | ConvertTo-Json -Compress",
                ],
                envPath: trustedPowerShellPath,
            },
        ]);
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
                let failure: Error | undefined;
                try {
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
                            port.submitReview(reviewId, resolutionReviewSummary(pullRequestId, threadId, head), head);
                            return;
                        }
                        port.resolve(threadId);
                    });
                } catch (error) {
                    failure = error as Error;
                }
                expect(statSync(fakeGh.calledPath).isFile()).toBe(true);
                const preservedOid = readLockOid(repository, 42);
                expect(preservedOid).toBeDefined();
                expect(failure?.message).toContain(
                    `recover with pnpm review:resolve:recover 42 --owner ${preservedOid}`
                );
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
                            ownerFence: { kind: 'pgid', pgid: process.pid },
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
                                (ownerFence) => ownerFence.kind === 'pgid' && ownerFence.pgid === process.pid
                            )
                        ).toThrow(
                            `review resolution on PR #42 lock is still held by live process group ${process.pid}`
                        );
                        return 'outer recovery claimed the lock';
                    },
                    (ownerFence) => ownerFence.kind === 'pgid' && ownerFence.pgid === process.pid,
                    {
                        executionFence: {
                            pid: process.pid,
                            ownerFence: { kind: 'pgid', pgid: process.pid, leaderStartedAt: '1' },
                        },
                    }
                )
            ).toBe('outer recovery claimed the lock');
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('persists the exact shared mutation owner through the production review-resolution lock port', () => {
        const repository = createTemporaryGitRepository();
        try {
            const sharedOwnerOid = writeSharedMutationLockOwnerBlob(repository, process.pid);
            updateSharedMutationLock(repository, 42, sharedOwnerOid);
            const session: GhSession = { configDir: repository, env: {}, dispose() {} };
            const port = shellPort(session, repository, () => undefined, undefined, sharedOwnerOid);

            expect(
                port.serializeReviewThreadMutation(42, threadId, head, () => {
                    expect(requireLockOwner(repository, 42)).toMatchObject({
                        version: 6,
                        sharedMutationOwnerOid: sharedOwnerOid,
                    });
                    return 'serialized';
                })
            ).toBe('serialized');
            expect(readLockOid(repository, 42)).toBeUndefined();
            expect(readSharedMutationLockOid(repository, 42)).toBe(sharedOwnerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('claims and releases the exact review-resolution and shared mutation owners after successful recovery', async () => {
        const repository = createTemporaryGitRepository();
        try {
            const sharedOwnerOid = writeSharedMutationLockOwnerBlob(repository, 999999);
            updateSharedMutationLock(repository, 42, sharedOwnerOid);
            const ownerOid = writeLockOwnerBlob(
                repository,
                999999,
                head,
                { phase: 'resolveThread', epoch: 1 },
                undefined,
                undefined,
                sharedOwnerOid
            );
            updateLock(repository, 42, ownerOid);

            expect(
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    ownerOid,
                    (owner) => {
                        const claimedReviewOwnerOid = readLockOid(repository, 42);
                        const claimedSharedOwnerOid = readSharedMutationLockOid(repository, 42);
                        expect(claimedReviewOwnerOid).toBeDefined();
                        expect(claimedReviewOwnerOid).not.toBe(ownerOid);
                        expect(claimedSharedOwnerOid).toBeDefined();
                        expect(claimedSharedOwnerOid).not.toBe(sharedOwnerOid);
                        expect(owner).toMatchObject({
                            version: 6,
                            sharedMutationOwnerOid: claimedSharedOwnerOid,
                            mutation: { phase: 'resolveThread', epoch: 1 },
                        });
                        return 'reconciled';
                    },
                    () => false
                )
            ).toBe('reconciled');
            expect(readLockOid(repository, 42)).toBeUndefined();
            expect(readSharedMutationLockOid(repository, 42)).toBeUndefined();
            await expect(withPullRequestMutationLock(repository, 42, async () => 'fresh')).resolves.toBe('fresh');
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it.each(['review-resolution', 'shared mutation'] as const)(
        'preserves both exact owners when the %s lock changes before final release',
        (changedLock) => {
            const repository = createTemporaryGitRepository();
            try {
                const sharedOwnerOid = writeSharedMutationLockOwnerBlob(repository, 999999);
                updateSharedMutationLock(repository, 42, sharedOwnerOid);
                const ownerOid = writeLockOwnerBlob(
                    repository,
                    999999,
                    head,
                    { phase: 'resolveThread', epoch: 1 },
                    undefined,
                    undefined,
                    sharedOwnerOid
                );
                updateLock(repository, 42, ownerOid);
                let claimedReviewOwnerOid: string | undefined;
                let claimedSharedOwnerOid: string | undefined;
                let replacementOid: string | undefined;

                expect(() =>
                    recoverPullRequestReviewResolutionLock(
                        repository,
                        42,
                        ownerOid,
                        () => {
                            claimedReviewOwnerOid = readLockOid(repository, 42);
                            claimedSharedOwnerOid = readSharedMutationLockOid(repository, 42);
                            if (claimedReviewOwnerOid === undefined || claimedSharedOwnerOid === undefined) {
                                throw new Error('recovery locks were not claimed');
                            }
                            if (changedLock === 'review-resolution') {
                                replacementOid = writeLockOwnerBlob(
                                    repository,
                                    999998,
                                    head,
                                    { phase: 'resolveThread', epoch: 2 },
                                    undefined,
                                    undefined,
                                    claimedSharedOwnerOid
                                );
                                updateLock(repository, 42, replacementOid, claimedReviewOwnerOid);
                            } else {
                                replacementOid = writeSharedMutationLockOwnerBlob(repository, 999998);
                                updateSharedMutationLock(repository, 42, replacementOid, claimedSharedOwnerOid);
                            }
                            return 'reconciled';
                        },
                        () => false
                    )
                ).toThrow(/ownership changed/);
                expect(claimedReviewOwnerOid).toBeDefined();
                expect(claimedSharedOwnerOid).toBeDefined();
                expect(replacementOid).toBeDefined();
                expect(readLockOid(repository, 42)).toBe(
                    changedLock === 'review-resolution' ? replacementOid : claimedReviewOwnerOid
                );
                expect(readSharedMutationLockOid(repository, 42)).toBe(
                    changedLock === 'shared mutation' ? replacementOid : claimedSharedOwnerOid
                );
            } finally {
                rmSync(repository, { recursive: true, force: true });
            }
        }
    );

    it('preserves both exact owners when final dual-lock release refuses its transaction', () => {
        const repository = createTemporaryGitRepository();
        try {
            const sharedOwnerOid = writeSharedMutationLockOwnerBlob(repository, 999999);
            updateSharedMutationLock(repository, 42, sharedOwnerOid);
            const ownerOid = writeLockOwnerBlob(
                repository,
                999999,
                head,
                { phase: 'resolveThread', epoch: 1 },
                undefined,
                undefined,
                sharedOwnerOid
            );
            updateLock(repository, 42, ownerOid);
            let claimedReviewOwnerOid: string | undefined;
            let claimedSharedOwnerOid: string | undefined;
            const releaseTransactions: string[][] = [];

            expect(() =>
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    ownerOid,
                    () => {
                        claimedReviewOwnerOid = readLockOid(repository, 42);
                        claimedSharedOwnerOid = readSharedMutationLockOid(repository, 42);
                        return 'reconciled';
                    },
                    () => false,
                    {
                        releaseRefsTransaction: (_primaryRoot, commands) => {
                            releaseTransactions.push(commands);
                            return false;
                        },
                    }
                )
            ).toThrow(/ownership changed before release/);
            expect(releaseTransactions).toEqual([
                [
                    `delete ${reviewResolutionLockRef(42)} ${claimedReviewOwnerOid}`,
                    `delete ${sharedMutationLockRef(42)} ${claimedSharedOwnerOid}`,
                ],
            ]);
            expect(readLockOid(repository, 42)).toBe(claimedReviewOwnerOid);
            expect(readSharedMutationLockOid(repository, 42)).toBe(claimedSharedOwnerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('recovers a dead standalone review-resolution shared owner before a later mutation reacquires it', async () => {
        const repository = createTemporaryGitRepository();
        try {
            const ownerOid = writeStandaloneReviewResolutionSharedMutationLockOwnerBlob(repository, 999999);
            updateSharedMutationLock(repository, 42, ownerOid);

            expect(
                recoverStandaloneReviewResolutionSharedMutationLock(repository, 42, ownerOid, {
                    ownerFenceIsLive: () => false,
                    gitPath: systemGitPath(),
                    readReviewResolutionLockOid: (primaryRoot, _ref, pullRequestNumber) =>
                        readLockOid(primaryRoot, pullRequestNumber),
                    updateRef: updateGitRef,
                })
            ).toBe(`review-resolution-standalone-shared-lock-recovered:42:${threadId}:${head}`);
            expect(readLockOid(repository, 42)).toBeUndefined();
            expect(readSharedMutationLockOid(repository, 42)).toBeUndefined();
            await expect(withPullRequestMutationLock(repository, 42, async () => 'reacquired')).resolves.toBe(
                'reacquired'
            );
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('uses production liveness to retain a live detached standalone owner and recover it after worker death', async () => {
        if (process.platform === 'win32') {
            return;
        }
        const repository = createTemporaryGitRepository();
        const previousGit = process.env.SOURDAW_TRUSTED_GIT_PATH;
        const previousPs = process.env.SOURDAW_TRUSTED_PS_PATH;
        let worker: ReturnType<typeof spawn> | undefined;
        try {
            process.env.SOURDAW_TRUSTED_GIT_PATH = systemGitPath();
            process.env.SOURDAW_TRUSTED_PS_PATH = systemPsPath();
            worker = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], {
                detached: true,
                stdio: 'ignore',
                shell: false,
            });
            if (worker.pid === undefined) {
                throw new Error('detached worker did not report a PID');
            }
            const startedAt = spawnSync(systemPsPath(), ['-o', 'lstart=', '-p', String(worker.pid)], {
                encoding: 'utf8',
                shell: false,
                env: { LC_ALL: 'C', LANG: 'C', TZ: 'UTC' },
            }).stdout.trim();
            const ownerOid = writeStandaloneReviewResolutionSharedMutationLockOwnerBlob(repository, worker.pid, {
                ownerFence: { kind: 'pgid', pgid: worker.pid, leaderStartedAt: startedAt },
            });
            updateSharedMutationLock(repository, 42, ownerOid);

            const recoveryPort = {
                gitPath: systemGitPath(),
                readReviewResolutionLockOid: (primaryRoot: string, _ref: string, pullRequestNumber: number) =>
                    readLockOid(primaryRoot, pullRequestNumber),
                updateRef: updateGitRef,
            };
            expect(() =>
                recoverStandaloneReviewResolutionSharedMutationLock(repository, 42, ownerOid, recoveryPort)
            ).toThrow(/execution fence remains live/);
            expect(readSharedMutationLockOid(repository, 42)).toBe(ownerOid);
            worker.kill('SIGKILL');
            await waitForExit(worker);
            worker = undefined;

            expect(
                recoverStandaloneReviewResolutionSharedMutationLock(repository, 42, ownerOid, recoveryPort)
            ).toContain('standalone-shared-lock-recovered');
            await expect(withPullRequestMutationLock(repository, 42, async () => 'reacquired')).resolves.toBe(
                'reacquired'
            );
        } finally {
            if (worker !== undefined) {
                worker.kill('SIGKILL');
                await waitForExit(worker).catch(() => undefined);
            }
            if (previousGit === undefined) {
                delete process.env.SOURDAW_TRUSTED_GIT_PATH;
            } else {
                process.env.SOURDAW_TRUSTED_GIT_PATH = previousGit;
            }
            if (previousPs === undefined) {
                delete process.env.SOURDAW_TRUSTED_PS_PATH;
            } else {
                process.env.SOURDAW_TRUSTED_PS_PATH = previousPs;
            }
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it.each([
        ['pid', { kind: 'pid', pid: 999999 }],
        ['detached POSIX process group', { kind: 'pgid', pgid: 999999 }],
        ['Windows process tree', { kind: 'win32-process-tree', version: 1, rootPid: 999999, rootStartedAt: '1' }],
    ] as const)('accepts a valid %s fence bound to the standalone owner', (_label, ownerFence) => {
        const repository = createTemporaryGitRepository();
        try {
            const ownerOid = writeStandaloneReviewResolutionSharedMutationLockOwnerBlob(repository, 999999, {
                ownerFence,
            });
            updateSharedMutationLock(repository, 42, ownerOid);

            expect(
                recoverStandaloneReviewResolutionSharedMutationLock(repository, 42, ownerOid, {
                    ownerFenceIsLive: () => false,
                    gitPath: systemGitPath(),
                    readReviewResolutionLockOid: (primaryRoot, _ref, pullRequestNumber) =>
                        readLockOid(primaryRoot, pullRequestNumber),
                    updateRef: updateGitRef,
                })
            ).toContain('standalone-shared-lock-recovered');
            expect(readSharedMutationLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it.each([
        ['pid', { kind: 'pid', pid: 999998 }],
        ['detached POSIX process group', { kind: 'pgid', pgid: 999998 }],
        ['Windows process tree', { kind: 'win32-process-tree', version: 1, rootPid: 999998, rootStartedAt: '1' }],
    ] as const)('rejects a %s fence that names another standalone owner', (_label, ownerFence) => {
        const repository = createTemporaryGitRepository();
        try {
            const ownerOid = writeStandaloneReviewResolutionSharedMutationLockOwnerBlob(repository, 999999, {
                ownerFence,
            });
            updateSharedMutationLock(repository, 42, ownerOid);

            expect(() =>
                recoverStandaloneReviewResolutionSharedMutationLock(repository, 42, ownerOid, {
                    ownerFenceIsLive: () => false,
                    gitPath: systemGitPath(),
                    readReviewResolutionLockOid: (primaryRoot, _ref, pullRequestNumber) =>
                        readLockOid(primaryRoot, pullRequestNumber),
                })
            ).toThrow(/delivery lock ownership is malformed/);
            expect(readSharedMutationLockOid(repository, 42)).toBe(ownerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('preserves a paired shared owner when recovery is given its shared owner identity', () => {
        const repository = createTemporaryGitRepository();
        try {
            const sharedOwnerOid = writeStandaloneReviewResolutionSharedMutationLockOwnerBlob(repository, 999999);
            const reviewOwnerOid = writeLockOwnerBlob(
                repository,
                999999,
                head,
                undefined,
                undefined,
                undefined,
                sharedOwnerOid
            );
            updateSharedMutationLock(repository, 42, sharedOwnerOid);
            updateLock(repository, 42, reviewOwnerOid);

            expect(() =>
                recoverStandaloneReviewResolutionSharedMutationLock(repository, 42, sharedOwnerOid, {
                    gitPath: systemGitPath(),
                    readReviewResolutionLockOid: (primaryRoot, _ref, pullRequestNumber) =>
                        readLockOid(primaryRoot, pullRequestNumber),
                })
            ).toThrow(/has a paired review-resolution lock/);
            expect(readSharedMutationLockOid(repository, 42)).toBe(sharedOwnerOid);
            expect(readLockOid(repository, 42)).toBe(reviewOwnerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('routes an exact paired inner owner away from standalone shared recovery', () => {
        const repository = createTemporaryGitRepository();
        try {
            const sharedOwnerOid = writeStandaloneReviewResolutionSharedMutationLockOwnerBlob(repository, 999999);
            const reviewOwnerOid = writeLockOwnerBlob(
                repository,
                999999,
                head,
                { phase: 'idle', epoch: 0 },
                undefined,
                undefined,
                sharedOwnerOid
            );
            updateSharedMutationLock(repository, 42, sharedOwnerOid);
            updateLock(repository, 42, reviewOwnerOid);

            expect(
                recoverStandaloneReviewResolutionSharedMutationLock(repository, 42, reviewOwnerOid, {
                    gitPath: systemGitPath(),
                })
            ).toBeUndefined();
            expect(readLockOid(repository, 42)).toBe(reviewOwnerOid);
            expect(readSharedMutationLockOid(repository, 42)).toBe(sharedOwnerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('releases a dead standalone shared owner while preserving an unrelated v5 inner owner for recovery', async () => {
        const repository = createTemporaryGitRepository();
        try {
            const sharedOwnerOid = writeStandaloneReviewResolutionSharedMutationLockOwnerBlob(repository, 999999);
            const reviewOwnerOid = writeLockOwnerBlob(repository, 999999, head, { phase: 'idle', epoch: 0 });
            updateSharedMutationLock(repository, 42, sharedOwnerOid);
            updateLock(repository, 42, reviewOwnerOid);

            expect(
                recoverStandaloneReviewResolutionSharedMutationLock(repository, 42, sharedOwnerOid, {
                    ownerFenceIsLive: () => false,
                    gitPath: systemGitPath(),
                })
            ).toContain('standalone-shared-lock-recovered');
            expect(readSharedMutationLockOid(repository, 42)).toBeUndefined();
            expect(readLockOid(repository, 42)).toBe(reviewOwnerOid);
            expect(
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    reviewOwnerOid,
                    () => 'reconciled',
                    () => false
                )
            ).toBe('reconciled');
            expect(readLockOid(repository, 42)).toBeUndefined();
            await expect(
                withPullRequestMutationLock(repository, 42, () => Promise.resolve('later-mutation'))
            ).resolves.toBe('later-mutation');
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it.each([
        {
            phase: 'createPendingReview' as const,
            epoch: 1,
            pullRequestId,
            body: pendingReviewBody(head),
            reviewCommitOid: head,
        },
        { phase: 'deleteReply' as const, epoch: 1, replyId },
    ])('preserves both refs for a dead unrelated v5 %s journal', (mutation) => {
        const repository = createTemporaryGitRepository();
        try {
            const sharedOwnerOid = writeStandaloneReviewResolutionSharedMutationLockOwnerBlob(repository, 999999);
            const reviewOwnerOid = writeLockOwnerBlob(repository, 999999, head, mutation);
            updateSharedMutationLock(repository, 42, sharedOwnerOid);
            updateLock(repository, 42, reviewOwnerOid);

            expect(() =>
                recoverStandaloneReviewResolutionSharedMutationLock(repository, 42, sharedOwnerOid, {
                    ownerFenceIsLive: () => false,
                    gitPath: systemGitPath(),
                })
            ).toThrow(`recover with pnpm review:resolve:recover 42 --owner ${reviewOwnerOid}`);
            expect(readSharedMutationLockOid(repository, 42)).toBe(sharedOwnerOid);
            expect(readLockOid(repository, 42)).toBe(reviewOwnerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('adopts a dead standalone shared owner while reconciling a dead non-idle v5 owner before later PR work', async () => {
        const repository = createTemporaryGitRepository();
        try {
            const sharedOwnerOid = writeStandaloneReviewResolutionSharedMutationLockOwnerBlob(repository, 999999, {
                threadId: otherThreadId,
                head: movedHead,
            });
            const reviewOwnerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'deleteReply',
                epoch: 1,
                replyId,
            });
            updateSharedMutationLock(repository, 42, sharedOwnerOid);
            updateLock(repository, 42, reviewOwnerOid);

            expect(() =>
                recoverStandaloneReviewResolutionSharedMutationLock(repository, 42, sharedOwnerOid, {
                    ownerFenceIsLive: () => false,
                    gitPath: systemGitPath(),
                })
            ).toThrow(`recover with pnpm review:resolve:recover 42 --owner ${reviewOwnerOid}`);
            expect(
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    reviewOwnerOid,
                    () => 'reconciled',
                    () => false
                )
            ).toBe('reconciled');
            expect(readSharedMutationLockOid(repository, 42)).toBeUndefined();
            expect(readLockOid(repository, 42)).toBeUndefined();
            await expect(
                withPullRequestMutationLock(repository, 42, () => Promise.resolve('later-mutation'))
            ).resolves.toBe('later-mutation');
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('preserves the exact v5 owner when the adopted standalone shared owner changes before recovery claim', () => {
        const repository = createTemporaryGitRepository();
        try {
            const sharedOwnerOid = writeStandaloneReviewResolutionSharedMutationLockOwnerBlob(repository, 999999);
            const replacementSharedOwnerOid = writeStandaloneReviewResolutionSharedMutationLockOwnerBlob(
                repository,
                999998
            );
            const reviewOwnerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'deleteReply',
                epoch: 1,
                replyId,
            });
            updateSharedMutationLock(repository, 42, sharedOwnerOid);
            updateLock(repository, 42, reviewOwnerOid);

            expect(() =>
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    reviewOwnerOid,
                    () => 'reconciled',
                    () => false,
                    {
                        updateRefsTransaction: (primaryRoot) => {
                            updateSharedMutationLock(primaryRoot, 42, replacementSharedOwnerOid, sharedOwnerOid);
                            return false;
                        },
                    }
                )
            ).toThrow(/lock ownership changed before recovery/);
            expect(readLockOid(repository, 42)).toBe(reviewOwnerOid);
            expect(readSharedMutationLockOid(repository, 42)).toBe(replacementSharedOwnerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('uses the real ref transaction so a later shared update failure leaves the exact inner owner unchanged', () => {
        const repository = createTemporaryGitRepository();
        try {
            const sharedOwnerOid = writeStandaloneReviewResolutionSharedMutationLockOwnerBlob(repository, 999999);
            const replacementSharedOwnerOid = writeStandaloneReviewResolutionSharedMutationLockOwnerBlob(
                repository,
                999997
            );
            const reviewOwnerOid = writeLockOwnerBlob(repository, 999998, head, {
                phase: 'deleteReply',
                epoch: 1,
                replyId,
            });
            updateSharedMutationLock(repository, 42, sharedOwnerOid);
            updateLock(repository, 42, reviewOwnerOid);
            let sharedRefChanged = false;

            expect(() =>
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    reviewOwnerOid,
                    () => 'reconciled',
                    (ownerFence) => {
                        if (!sharedRefChanged && ownerFence.kind === 'pgid' && ownerFence.pgid === 999998) {
                            sharedRefChanged = true;
                            updateSharedMutationLock(repository, 42, replacementSharedOwnerOid, sharedOwnerOid);
                        }
                        return false;
                    }
                )
            ).toThrow(/lock ownership changed before recovery/);
            expect(sharedRefChanged).toBe(true);
            expect(readLockOid(repository, 42)).toBe(reviewOwnerOid);
            expect(readSharedMutationLockOid(repository, 42)).toBe(replacementSharedOwnerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('preserves both refs for an unknown v5 journal state', () => {
        const repository = createTemporaryGitRepository();
        try {
            const sharedOwnerOid = writeStandaloneReviewResolutionSharedMutationLockOwnerBlob(repository, 999999);
            const knownOwnerOid = writeLockOwnerBlob(repository, 999999, head, { phase: 'idle', epoch: 0 });
            const unknownOwner = JSON.parse(gitCapture(repository, ['cat-file', 'blob', knownOwnerOid])) as Record<
                string,
                unknown
            >;
            unknownOwner.mutation = { phase: 'unknown', epoch: 1 };
            const unknownOwnerOid = gitCapture(
                repository,
                ['hash-object', '-w', '--stdin'],
                JSON.stringify(unknownOwner)
            );
            updateSharedMutationLock(repository, 42, sharedOwnerOid);
            updateLock(repository, 42, unknownOwnerOid);

            expect(() =>
                recoverStandaloneReviewResolutionSharedMutationLock(repository, 42, sharedOwnerOid, {
                    ownerFenceIsLive: () => false,
                    gitPath: systemGitPath(),
                })
            ).toThrow(/lock ownership is malformed/);
            expect(readSharedMutationLockOid(repository, 42)).toBe(sharedOwnerOid);
            expect(readLockOid(repository, 42)).toBe(unknownOwnerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('preserves both owners when an unrelated v5 inner execution fence remains live', () => {
        const repository = createTemporaryGitRepository();
        try {
            const sharedOwnerOid = writeStandaloneReviewResolutionSharedMutationLockOwnerBlob(repository, 999999);
            const reviewOwnerOid = writeLockOwnerBlob(repository, 999998, head, { phase: 'idle', epoch: 0 });
            updateSharedMutationLock(repository, 42, sharedOwnerOid);
            updateLock(repository, 42, reviewOwnerOid);

            expect(() =>
                recoverStandaloneReviewResolutionSharedMutationLock(repository, 42, sharedOwnerOid, {
                    ownerFenceIsLive: (ownerFence) => ownerFence.kind === 'pgid' && ownerFence.pgid === 999998,
                    gitPath: systemGitPath(),
                })
            ).toThrow(/inner execution fence remains live/);
            expect(readSharedMutationLockOid(repository, 42)).toBe(sharedOwnerOid);
            expect(readLockOid(repository, 42)).toBe(reviewOwnerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('uses one exact transaction to prove no inner lock exists before deleting a standalone shared owner', () => {
        const repository = createTemporaryGitRepository();
        try {
            const sharedOwnerOid = writeStandaloneReviewResolutionSharedMutationLockOwnerBlob(repository, 999999);
            updateSharedMutationLock(repository, 42, sharedOwnerOid);
            let commands: string[] | undefined;

            expect(() =>
                recoverStandaloneReviewResolutionSharedMutationLock(repository, 42, sharedOwnerOid, {
                    ownerFenceIsLive: () => false,
                    gitPath: systemGitPath(),
                    readReviewResolutionLockOid: (primaryRoot, _ref, pullRequestNumber) =>
                        readLockOid(primaryRoot, pullRequestNumber),
                    updateRefsTransaction: (_primaryRoot, transactionCommands) => {
                        commands = transactionCommands;
                        return false;
                    },
                })
            ).toThrow(/ownership changed before release/);
            expect(commands).toEqual([
                `verify refs/sourdaw/review-resolution/pr-42 ${'0'.repeat(sharedOwnerOid.length)}`,
                `delete refs/sourdaw/delivery/pr-42 ${sharedOwnerOid}`,
            ]);
            expect(readSharedMutationLockOid(repository, 42)).toBe(sharedOwnerOid);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('preserves a dead standalone shared owner when a v6 inner owner retains another shared owner', () => {
        const repository = createTemporaryGitRepository();
        try {
            const sharedOwnerOid = writeStandaloneReviewResolutionSharedMutationLockOwnerBlob(repository, 999999);
            const otherSharedOwnerOid = writeStandaloneReviewResolutionSharedMutationLockOwnerBlob(repository, 999998);
            const reviewOwnerOid = writeLockOwnerBlob(
                repository,
                999999,
                head,
                { phase: 'idle', epoch: 0 },
                undefined,
                undefined,
                otherSharedOwnerOid
            );
            updateSharedMutationLock(repository, 42, sharedOwnerOid);
            updateLock(repository, 42, reviewOwnerOid);

            expect(() =>
                recoverStandaloneReviewResolutionSharedMutationLock(repository, 42, sharedOwnerOid, {
                    ownerFenceIsLive: () => false,
                    gitPath: systemGitPath(),
                })
            ).toThrow(/retains another shared owner/);
            expect(readSharedMutationLockOid(repository, 42)).toBe(sharedOwnerOid);
            expect(readLockOid(repository, 42)).toBe(reviewOwnerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('preserves both owners when an unrelated inner owner changes before standalone release', () => {
        const repository = createTemporaryGitRepository();
        try {
            const sharedOwnerOid = writeStandaloneReviewResolutionSharedMutationLockOwnerBlob(repository, 999999);
            const reviewOwnerOid = writeLockOwnerBlob(repository, 999999, head, { phase: 'idle', epoch: 0 });
            const replacementOwnerOid = writeLockOwnerBlob(repository, 999998, head, { phase: 'idle', epoch: 0 });
            updateSharedMutationLock(repository, 42, sharedOwnerOid);
            updateLock(repository, 42, reviewOwnerOid);

            expect(() =>
                recoverStandaloneReviewResolutionSharedMutationLock(repository, 42, sharedOwnerOid, {
                    ownerFenceIsLive: () => false,
                    gitPath: systemGitPath(),
                    beforeExactRelease: () => updateLock(repository, 42, replacementOwnerOid, reviewOwnerOid),
                })
            ).toThrow(/ownership changed before release/);
            expect(readSharedMutationLockOid(repository, 42)).toBe(sharedOwnerOid);
            expect(readLockOid(repository, 42)).toBe(replacementOwnerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('preserves a changed standalone shared owner before recovery', () => {
        const repository = createTemporaryGitRepository();
        try {
            const expectedOwnerOid = writeStandaloneReviewResolutionSharedMutationLockOwnerBlob(repository, 999999);
            const currentOwnerOid = writeStandaloneReviewResolutionSharedMutationLockOwnerBlob(repository, 999998);
            updateSharedMutationLock(repository, 42, currentOwnerOid);

            expect(() =>
                recoverStandaloneReviewResolutionSharedMutationLock(repository, 42, expectedOwnerOid, {
                    gitPath: systemGitPath(),
                    readReviewResolutionLockOid: (primaryRoot, _ref, pullRequestNumber) =>
                        readLockOid(primaryRoot, pullRequestNumber),
                })
            ).toThrow(/ownership changed before recovery/);
            expect(readSharedMutationLockOid(repository, 42)).toBe(currentOwnerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('records the review-resolution identity in the initial shared owner', async () => {
        const repository = createTemporaryGitRepository();
        try {
            await withPullRequestMutationLock(
                repository,
                42,
                async ({ ownerOid }) => {
                    expect(JSON.parse(gitCapture(repository, ['cat-file', 'blob', ownerOid]))).toEqual({
                        version: 2,
                        pid: process.pid,
                        token: expect.stringMatching(/^[0-9a-f-]{36}$/iu),
                        operation: 'review-resolution',
                        number: 42,
                        threadId,
                        head,
                        ownerFence: { kind: 'pid', pid: process.pid },
                    });
                },
                { reviewResolution: { threadId, head, ownerFence: { kind: 'pid', pid: process.pid } } }
            );
            expect(readSharedMutationLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('runs standalone shared-owner recovery before authentication or remote setup', async () => {
        const repository = createTemporaryGitRepository();
        try {
            const ownerOid = writeStandaloneReviewResolutionSharedMutationLockOwnerBlob(repository, 999999);
            updateSharedMutationLock(repository, 42, ownerOid);
            const calls: string[] = [];
            const logs: string[] = [];
            const originalLog = console.log;
            console.log = (message?: unknown) => logs.push(String(message));
            try {
                await expect(
                    runRecoverReviewResolutionLockCli(['42', '--owner', ownerOid], {
                        trustedPrimaryRoot: () => repository,
                        recoverStandaloneSharedLock: (primaryRoot, number, expectedOwnerOid) =>
                            recoverStandaloneReviewResolutionSharedMutationLock(primaryRoot, number, expectedOwnerOid, {
                                ownerFenceIsLive: () => false,
                                gitPath: systemGitPath(),
                                readReviewResolutionLockOid: (root, _ref, pullRequestNumber) =>
                                    readLockOid(root, pullRequestNumber),
                                updateRef: updateGitRef,
                            }),
                        authenticateAuthor: async () => {
                            calls.push('authenticate');
                            throw new Error('authentication must not run');
                        },
                        repositoryName: () => {
                            calls.push('repository');
                            return REQUIRED_REPOSITORY;
                        },
                        gh: () => {
                            calls.push('gh');
                            return () => '';
                        },
                        createPort: () => {
                            calls.push('port');
                            return fakePort().port;
                        },
                    })
                ).resolves.toBe(0);
            } finally {
                console.log = originalLog;
            }
            expect(calls).toEqual([]);
            expect(logs).toEqual([`review-resolution-standalone-shared-lock-recovered:42:${threadId}:${head}`]);
            expect(readSharedMutationLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it.each([
        [
            'live execution fence',
            (): typeof writeStandaloneReviewResolutionSharedMutationLockOwnerBlob =>
                writeStandaloneReviewResolutionSharedMutationLockOwnerBlob,
            (): boolean => true,
            /execution fence remains live/,
        ],
        [
            'legacy untagged owner',
            (): typeof writeSharedMutationLockOwnerBlob => writeSharedMutationLockOwnerBlob,
            (): boolean => false,
            /ownership is not recoverable/,
        ],
    ] as const)(
        'preserves a standalone shared owner with a %s',
        (_label, writeOwner, ownerFenceIsLive, errorPattern) => {
            const repository = createTemporaryGitRepository();
            try {
                const ownerOid = writeOwner()(repository, 999999);
                updateSharedMutationLock(repository, 42, ownerOid);

                expect(() =>
                    recoverStandaloneReviewResolutionSharedMutationLock(repository, 42, ownerOid, {
                        ownerFenceIsLive,
                        gitPath: systemGitPath(),
                        readReviewResolutionLockOid: (primaryRoot, _ref, pullRequestNumber) =>
                            readLockOid(primaryRoot, pullRequestNumber),
                    })
                ).toThrow(errorPattern);
                expect(readLockOid(repository, 42)).toBeUndefined();
                expect(readSharedMutationLockOid(repository, 42)).toBe(ownerOid);
            } finally {
                rmSync(repository, { recursive: true, force: true });
            }
        }
    );

    it('preserves both refs when a legacy inner owner appears between the absence proof and exact release', () => {
        const repository = createTemporaryGitRepository();
        try {
            const sharedOwnerOid = writeStandaloneReviewResolutionSharedMutationLockOwnerBlob(repository, 999999);
            updateSharedMutationLock(repository, 42, sharedOwnerOid);
            let pairedOwnerOid: string | undefined;

            expect(() =>
                recoverStandaloneReviewResolutionSharedMutationLock(repository, 42, sharedOwnerOid, {
                    ownerFenceIsLive: () => false,
                    gitPath: systemGitPath(),
                    readReviewResolutionLockOid: (primaryRoot, _ref, pullRequestNumber) =>
                        readLockOid(primaryRoot, pullRequestNumber),
                    beforeExactRelease: () => {
                        pairedOwnerOid = writeLockOwnerBlob(repository, process.pid, head);
                        updateLock(repository, 42, pairedOwnerOid);
                    },
                })
            ).toThrow(/ownership changed before release/);
            expect(readSharedMutationLockOid(repository, 42)).toBe(sharedOwnerOid);
            expect(readLockOid(repository, 42)).toBe(pairedOwnerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('preserves a malformed standalone shared owner', () => {
        const repository = createTemporaryGitRepository();
        try {
            const ownerOid = gitCapture(repository, ['hash-object', '-w', '--stdin'], '{"version":2}');
            updateSharedMutationLock(repository, 42, ownerOid);

            expect(() =>
                recoverStandaloneReviewResolutionSharedMutationLock(repository, 42, ownerOid, {
                    ownerFenceIsLive: () => false,
                    gitPath: systemGitPath(),
                    readReviewResolutionLockOid: (primaryRoot, _ref, pullRequestNumber) =>
                        readLockOid(primaryRoot, pullRequestNumber),
                })
            ).toThrow(/delivery lock ownership is malformed/);
            expect(readSharedMutationLockOid(repository, 42)).toBe(ownerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('preserves a substituted standalone shared owner when its exact release fails', () => {
        const repository = createTemporaryGitRepository();
        try {
            const ownerOid = writeStandaloneReviewResolutionSharedMutationLockOwnerBlob(repository, 999999);
            const replacementOid = writeStandaloneReviewResolutionSharedMutationLockOwnerBlob(repository, 999998);
            updateSharedMutationLock(repository, 42, ownerOid);

            expect(() =>
                recoverStandaloneReviewResolutionSharedMutationLock(repository, 42, ownerOid, {
                    ownerFenceIsLive: () => false,
                    gitPath: systemGitPath(),
                    readReviewResolutionLockOid: (primaryRoot, _ref, pullRequestNumber) =>
                        readLockOid(primaryRoot, pullRequestNumber),
                    updateRefsTransaction: (primaryRoot) => {
                        updateSharedMutationLock(primaryRoot, 42, replacementOid, ownerOid);
                        return false;
                    },
                })
            ).toThrow(/ownership changed before release/);
            expect(readSharedMutationLockOid(repository, 42)).toBe(replacementOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('preserves both exact claimed owners and refuses reacquisition after ambiguous recovery failure', async () => {
        const repository = createTemporaryGitRepository();
        try {
            const sharedOwnerOid = writeSharedMutationLockOwnerBlob(repository, 999999);
            updateSharedMutationLock(repository, 42, sharedOwnerOid);
            const ownerOid = writeLockOwnerBlob(
                repository,
                999999,
                head,
                { phase: 'resolveThread', epoch: 1 },
                undefined,
                undefined,
                sharedOwnerOid
            );
            updateLock(repository, 42, ownerOid);
            let claimedReviewOwnerOid: string | undefined;
            let claimedSharedOwnerOid: string | undefined;

            expect(() =>
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    ownerOid,
                    (owner) => {
                        claimedReviewOwnerOid = readLockOid(repository, 42);
                        claimedSharedOwnerOid = readSharedMutationLockOid(repository, 42);
                        expect(owner).toMatchObject({
                            version: 6,
                            sharedMutationOwnerOid: claimedSharedOwnerOid,
                        });
                        throw new Error('remote mutation outcome is ambiguous');
                    },
                    () => false
                )
            ).toThrow(/preserved exact lock owner/);
            expect(claimedReviewOwnerOid).toBeDefined();
            expect(claimedSharedOwnerOid).toBeDefined();
            expect(readLockOid(repository, 42)).toBe(claimedReviewOwnerOid);
            expect(readSharedMutationLockOid(repository, 42)).toBe(claimedSharedOwnerOid);
            expect(requireLockOwner(repository, 42)).toMatchObject({
                version: 6,
                sharedMutationOwnerOid: claimedSharedOwnerOid,
            });
            await expect(withPullRequestMutationLock(repository, 42, async () => 'must not run')).rejects.toThrow(
                'PR #42 is already being delivered by process'
            );
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it.each(['missing', 'changed', 'malformed'] as const)(
        'refuses %s shared mutation ownership before recovery reconciliation',
        (condition) => {
            const repository = createTemporaryGitRepository();
            try {
                const validSharedOwnerOid = writeSharedMutationLockOwnerBlob(repository, 999999);
                let recordedSharedOwnerOid = validSharedOwnerOid;
                let actualSharedOwnerOid: string | undefined;
                if (condition === 'changed') {
                    actualSharedOwnerOid = writeSharedMutationLockOwnerBlob(repository, 1_000_000);
                    updateSharedMutationLock(repository, 42, actualSharedOwnerOid);
                } else if (condition === 'malformed') {
                    recordedSharedOwnerOid = gitCapture(
                        repository,
                        ['hash-object', '-w', '--stdin'],
                        JSON.stringify({ version: 1, pid: 999999, token: 'not-a-valid-token' })
                    );
                    actualSharedOwnerOid = recordedSharedOwnerOid;
                    updateSharedMutationLock(repository, 42, actualSharedOwnerOid);
                }
                const ownerOid = writeLockOwnerBlob(
                    repository,
                    999999,
                    head,
                    { phase: 'resolveThread', epoch: 1 },
                    undefined,
                    undefined,
                    recordedSharedOwnerOid
                );
                updateLock(repository, 42, ownerOid);
                let reconciled = false;

                expect(() =>
                    recoverPullRequestReviewResolutionLock(
                        repository,
                        42,
                        ownerOid,
                        () => {
                            reconciled = true;
                            return 'must not reconcile';
                        },
                        () => false
                    )
                ).toThrow(/retained delivery lock|delivery lock ownership is malformed/);
                expect(reconciled).toBe(false);
                expect(readLockOid(repository, 42)).toBe(ownerOid);
                expect(readSharedMutationLockOid(repository, 42)).toBe(actualSharedOwnerOid);
            } finally {
                rmSync(repository, { recursive: true, force: true });
            }
        }
    );

    it('preserves an absent create-pending-review recovery phase without replaying it', () => {
        const repository = createTemporaryGitRepository();
        const { port, calls, state } = fakePort();
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
            ).toThrow(/unreconciled in-flight createPendingReview mutation/);
            expect(calls.filter((call) => call.startsWith('createReview:'))).toEqual([]);
            expect(state().comments.filter((comment) => comment.body === 'Done')).toHaveLength(0);
            expect(readLockOid(repository, 42)).toBeDefined();
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
            ).toThrow(/unreconciled in-flight createPendingReview mutation/);
            expect(calls.filter((call) => call.startsWith('createReview:'))).toEqual([]);
            expect(readLockOid(repository, 42)).toBeDefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('preserves an absent reply recovery phase without replaying it', () => {
        const repository = createTemporaryGitRepository();
        const { port, calls } = fakePort({ existingPendingReviewCount: 1 });
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
            ).toThrow(/unreconciled in-flight replyDone mutation/);
            expect(calls.filter((call) => call.startsWith('reply:'))).toEqual([]);
            expect(readLockOid(repository, 42)).toBeDefined();
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
            ).toThrow(/unreconciled in-flight createPendingReview mutation/i);
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
                `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${head}`,
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

    it('preserves submit recovery when pending-marker cleanup advances H1 to H2', () => {
        const repository = createTemporaryGitRepository();
        const { port, calls } = fakePort({
            heads: [head, movedHead],
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

            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                    recoverReviewResolutionLockOwnerState(42, owner, port)
                )
            ).toThrow(/pull-request head moved after mutation; compensating/i);
            expect(calls).toEqual(['inspect:1', 'delete:PRRC_first_pending', 'inspect:2']);
            expect(readLockOid(repository, 42)).toBeDefined();
            expect(requireLockOwner(repository, 42)).toMatchObject({
                threadId,
                head,
                mutation: { phase: 'submitReview', epoch: 1, reviewId },
            });
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('preserves the submit-recovery lock without a public mutation when its historical body is malformed', () => {
        const repository = createTemporaryGitRepository();
        const mutation = {
            phase: 'submitReview' as const,
            epoch: 1,
            reviewId,
            body: 'forged review body',
        };
        const { port, calls } = fakePort({
            existingReplyCount: 1,
            existingReplyReviewState: 'PENDING',
            existingReplyReviewBody: resolutionReviewSummary(pullRequestId, threadId, head),
            attachManagedPendingReplyOnFirstInspect: true,
        });
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, mutation);
            updateLock(repository, 42, ownerOid);

            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                    recoverReviewResolutionLockOwnerState(42, owner, port)
                )
            ).toThrow(/submit review recovery has an invalid historical body/i);
            expect(calls).toEqual(['inspect:1']);
            const preservedOwnerOid = readLockOid(repository, 42);
            expect(preservedOwnerOid).toBeDefined();
            expect(preservedOwnerOid).not.toBe(ownerOid);
            expect(requireLockOwner(repository, 42)).toMatchObject({ threadId, head, mutation });
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
        [
            'delete reply',
            { phase: 'deleteReply', epoch: 1, replyId: 'PRRC_deleted' },
            { existingReplyCount: 1, existingReplyReviewState: 'COMMENTED' },
        ],
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
            if (mutation.phase === 'deleteReply') {
                expect(calls).toContain(`resolve:${threadId}`);
            } else {
                expect(calls).toEqual(['inspect:1']);
            }
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('replays an absent update-review-body recovery phase and releases after the canonical pending body is restored', () => {
        const repository = createTemporaryGitRepository();
        const { port, calls, state } = fakePort({
            existingReplyCount: 1,
            existingReplyReviewState: 'PENDING',
            existingReplyReviewBody: '',
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
            expect(calls).toEqual([
                'inspect:1',
                `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${head}`,
                `updateReview:${reviewId}`,
                'inspect:2',
            ]);
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
            expect(state().updatedReviewCommitOids).toEqual([{ reviewId, reviewCommitOid: head }]);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('terminally reconciles an exact empty submitted-review update recovery without a remote update', () => {
        const repository = createTemporaryGitRepository();
        const {
            port: basePort,
            calls,
            pullRequestReviewInspections,
        } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            existingReplyReviewState: 'COMMENTED',
            existingReplyReviewBody: '',
        });
        const port: ResolveReviewThreadPort = {
            ...basePort,
            updateReviewBody: () => {
                throw new Error('immutable submitted review must not be updated');
            },
        };
        const mutation = {
            phase: 'updateReviewBody' as const,
            epoch: 1,
            reviewId,
            reviewDatabaseId: '9223372036854775808',
            reviewCommitOid: head,
            body: resolutionReviewSummary(pullRequestId, threadId, head),
            marker: immutableEnvelopeSnapshot(),
        };
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, mutation);
            updateLock(repository, 42, ownerOid);

            recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                recoverReviewResolutionLockOwnerState(42, owner, port)
            );

            expect(calls).toEqual([
                'inspect:1',
                `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${head}`,
                'inspect:2',
                `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${head}`,
                `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${head}`,
                'inspect:3',
                `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${head}`,
                'inspect:4',
                `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${head}`,
                `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${head}`,
            ]);
            expect(readLockOid(repository, 42)).toBeUndefined();
            expect(pullRequestReviewInspections).toEqual([
                { number: 42, reviewId, pullRequestId, head },
                { number: 42, reviewId, pullRequestId, head },
                { number: 42, reviewId, pullRequestId, head },
                { number: 42, reviewId, pullRequestId, head },
            ]);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it.each([2, 4])(
        'retains the immutable update-recovery lock when its captured marker is replaced on terminal inspection %i',
        (replacementInspection) => {
            const repository = createTemporaryGitRepository();
            const { port: basePort, calls } = fakePort({
                isResolved: true,
                initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
                initialResolvedByType: 'User',
                existingReplyCount: 1,
                existingReplyReviewState: 'COMMENTED',
                existingReplyReviewBody: '',
            });
            let inspections = 0;
            const port: ResolveReviewThreadPort = {
                ...basePort,
                inspect: (number, currentThreadId) => {
                    const inspection = basePort.inspect(number, currentThreadId);
                    inspections += 1;
                    if (inspections !== replacementInspection || inspection.thread === null) {
                        return inspection;
                    }
                    return {
                        ...inspection,
                        thread: {
                            ...inspection.thread,
                            comments: inspection.thread.comments.map((comment) =>
                                comment.id === replyId
                                    ? {
                                          ...comment,
                                          id: 'PRRC_replacement',
                                          fullDatabaseId: '9223372036854775809',
                                      }
                                    : comment
                            ),
                        },
                    };
                },
            };
            const mutation = {
                phase: 'updateReviewBody' as const,
                epoch: 1,
                reviewId,
                reviewDatabaseId: '9223372036854775808',
                reviewCommitOid: head,
                body: resolutionReviewSummary(pullRequestId, threadId, head),
                marker: immutableEnvelopeSnapshot(),
            };
            try {
                const ownerOid = writeLockOwnerBlob(repository, 999999, head, mutation);
                updateLock(repository, 42, ownerOid);
                let retainedOwnerOid: string | undefined;

                expect(() =>
                    recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) => {
                        retainedOwnerOid = readLockOid(repository, 42);
                        return recoverReviewResolutionLockOwnerState(42, owner, port);
                    })
                ).toThrow(/unreconciled in-flight|immutable/i);
                expect(
                    calls.filter((call) =>
                        /^(createReview|reply:|updateReview|delete:|deleteReview|submit|resolve|log:)/.test(call)
                    )
                ).toEqual([]);
                expect(retainedOwnerOid).toEqual(expect.any(String));
                expect(readLockOid(repository, 42)).toBe(retainedOwnerOid);
            } finally {
                rmSync(repository, { recursive: true, force: true });
            }
        }
    );

    it('releases an exact immutable H1 envelope after the pull request moves to H2 without mutation', () => {
        const repository = createTemporaryGitRepository();
        const { port, calls } = fakePort({
            heads: [movedHead, movedHead, movedHead],
            expectedAttachedReviewThreadInspectionHead: movedHead,
            expectedPullRequestReviewInspectionPullRequestId: pullRequestId,
            expectedPullRequestReviewInspectionHead: movedHead,
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            existingReplyReviewState: 'COMMENTED',
            existingReplyReviewBody: '',
            existingReplyReviewCommitOid: head,
        });
        const mutation = {
            phase: 'updateReviewBody' as const,
            epoch: 1,
            reviewId,
            reviewDatabaseId: '9223372036854775808',
            reviewCommitOid: head,
            body: resolutionReviewSummary(pullRequestId, threadId, head),
            marker: immutableEnvelopeSnapshot(),
        };
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, mutation);
            updateLock(repository, 42, ownerOid);

            const inspection = recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                recoverReviewResolutionLockOwnerState(42, owner, port)
            );

            expect(inspection.head).toBe(movedHead);
            expect(
                calls.filter((call) =>
                    /^(createReview|reply:|updateReview|delete:|deleteReview|submit|resolve|log:)/.test(call)
                )
            ).toEqual([]);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('treats an immutable envelope with a renamed author login as the same receipt', () => {
        const repository = createTemporaryGitRepository();
        const { port: basePort } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            existingReplyReviewState: 'COMMENTED',
            existingReplyReviewBody: '',
        });
        const port: ResolveReviewThreadPort = {
            ...basePort,
            inspect: (number, currentThreadId) => {
                const inspection = basePort.inspect(number, currentThreadId);
                if (inspection.thread === null) {
                    return inspection;
                }
                return {
                    ...inspection,
                    thread: {
                        ...inspection.thread,
                        comments: inspection.thread.comments.map((comment) =>
                            comment.id === replyId ? { ...comment, reviewAuthorLogin: 'renamed-again[bot]' } : comment
                        ),
                    },
                };
            },
        };
        const mutation = {
            phase: 'updateReviewBody' as const,
            epoch: 1,
            reviewId,
            reviewDatabaseId: '9223372036854775808',
            reviewCommitOid: head,
            body: resolutionReviewSummary(pullRequestId, threadId, head),
            marker: immutableEnvelopeSnapshot(),
        };
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, mutation);
            updateLock(repository, 42, ownerOid);
            recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                recoverReviewResolutionLockOwnerState(42, owner, port)
            );
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('retains the immutable update-recovery lock when its exact remote review lookup is missing', () => {
        const repository = createTemporaryGitRepository();
        const {
            port: basePort,
            calls,
            pullRequestReviewInspections,
        } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            existingReplyReviewState: 'COMMENTED',
            existingReplyReviewBody: '',
        });
        const port: ResolveReviewThreadPort = {
            ...basePort,
            inspectPullRequestReview: (number, currentReviewId, currentPullRequestId, currentHead) => {
                basePort.inspectPullRequestReview(number, currentReviewId, currentPullRequestId, currentHead);
                return null;
            },
        };
        const mutation = {
            phase: 'updateReviewBody' as const,
            epoch: 1,
            reviewId,
            reviewDatabaseId: '9223372036854775808',
            reviewCommitOid: head,
            body: resolutionReviewSummary(pullRequestId, threadId, head),
            marker: immutableEnvelopeSnapshot(),
        };
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, mutation);
            updateLock(repository, 42, ownerOid);
            let retainedOwnerOid: string | undefined;

            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) => {
                    retainedOwnerOid = readLockOid(repository, 42);
                    return recoverReviewResolutionLockOwnerState(42, owner, port);
                })
            ).toThrow(/could not prove an unlanded historical review/i);
            expect(pullRequestReviewInspections).toEqual([{ number: 42, reviewId, pullRequestId, head }]);
            expect(
                calls.filter((call) =>
                    /^(createReview|reply:|updateReview|delete:|deleteReview|submit|resolve|log:)/.test(call)
                )
            ).toEqual([]);
            expect(retainedOwnerOid).toEqual(expect.any(String));
            expect(readLockOid(repository, 42)).toBe(retainedOwnerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('backfills a whitespace-only pending review before reconciling it against an immutable submitted-review recovery lock', () => {
        const repository = createTemporaryGitRepository();
        const {
            port: basePort,
            calls,
            state,
        } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            existingReplyReviewState: 'COMMENTED',
            existingReplyReviewBody: '',
            addPendingReplyMarkerToResolvedThread: true,
            resolvedPendingReplyBody: ' \n\t ',
        });
        const port: ResolveReviewThreadPort = {
            ...basePort,
            updateReviewBody: (currentReviewId, body, commitOid, expectedReview) => {
                if (currentReviewId === reviewId) {
                    throw new Error('immutable submitted review must not be updated');
                }
                return basePort.updateReviewBody(currentReviewId, body, commitOid, expectedReview);
            },
        };
        const mutation = {
            phase: 'updateReviewBody' as const,
            epoch: 1,
            reviewId,
            reviewDatabaseId: '9223372036854775808',
            reviewCommitOid: head,
            body: resolutionReviewSummary(pullRequestId, threadId, head),
            marker: immutableEnvelopeSnapshot(),
        };
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, mutation);
            updateLock(repository, 42, ownerOid);

            recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                recoverReviewResolutionLockOwnerState(42, owner, port)
            );

            expect(calls).toContain('updateReview:PRR_resolved_pending');
            expect(calls).toContain('deleteReview:PRR_resolved_pending');
            expect(state().reviews).toEqual([expect.objectContaining({ id: reviewId, state: 'COMMENTED', body: '' })]);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('preserves an immutable submitted-review recovery lock when an unrelated moved-head pending review remains', () => {
        const repository = createTemporaryGitRepository();
        const mutation = {
            phase: 'updateReviewBody' as const,
            epoch: 1,
            reviewId,
            reviewCommitOid: head,
            body: resolutionReviewSummary(pullRequestId, threadId, head),
        };
        const { port, calls } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            existingReplyReviewState: 'COMMENTED',
            existingReplyReviewBody: '',
            existingPendingReviewCount: 1,
            existingPendingReviewIds: ['PRR_blocking'],
            existingPendingReviewCommitOid: movedHead,
            existingPendingReviewBody: 'unrelated moved pending body',
        });
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, mutation);
            updateLock(repository, 42, ownerOid);
            let retainedOwnerOid: string | undefined;

            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) => {
                    retainedOwnerOid = readLockOid(repository, 42);
                    return recoverReviewResolutionLockOwnerState(42, owner, port);
                })
            ).toThrow(/non-reusable pending author review/i);
            expect(
                calls.filter((call) => call.startsWith('deleteReview:') || call.startsWith('updateReview:'))
            ).toEqual([]);
            expect(retainedOwnerOid).toEqual(expect.any(String));
            expect(readLockOid(repository, 42)).toBe(retainedOwnerOid);
            expect(requireLockOwner(repository, 42)).toMatchObject({ threadId, head, mutation });
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('retains the exact recovery owner when the fourth terminal inspection finds an unrelated pending author review', () => {
        const repository = createTemporaryGitRepository();
        const { port: basePort, calls } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            existingReplyReviewState: 'COMMENTED',
            existingReplyReviewBody: '',
        });
        let inspections = 0;
        const port: ResolveReviewThreadPort = {
            ...basePort,
            inspect: (number, currentThreadId) => {
                const inspection = basePort.inspect(number, currentThreadId);
                inspections += 1;
                if (inspections !== 4) {
                    return inspection;
                }
                return {
                    ...inspection,
                    pendingReviews: [
                        ...inspection.pendingReviews,
                        {
                            id: 'PRR_unrelated_pending',
                            fullDatabaseId: '9223372036854775899',
                            state: 'PENDING',
                            body: 'unrelated pending body',
                            commitOid: head,
                            authorNodeId: AUTHOR_BOT_NODE_ID,
                            authorLogin: 'renamed-author[bot]',
                            authorType: 'Bot',
                        },
                    ],
                };
            },
        };
        const mutation = {
            phase: 'updateReviewBody' as const,
            epoch: 1,
            reviewId,
            reviewDatabaseId: '9223372036854775808',
            reviewCommitOid: head,
            body: resolutionReviewSummary(pullRequestId, threadId, head),
            marker: immutableEnvelopeSnapshot(),
        };
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, mutation);
            updateLock(repository, 42, ownerOid);
            let retainedOwnerOid: string | undefined;

            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) => {
                    retainedOwnerOid = readLockOid(repository, 42);
                    return recoverReviewResolutionLockOwnerState(42, owner, port);
                })
            ).toThrow(/non-reusable pending author review/i);
            expect(
                calls.filter((call) =>
                    /^(createReview|reply:|updateReview|delete:|deleteReview|submit|resolve|log:)/.test(call)
                )
            ).toEqual([]);
            expect(retainedOwnerOid).toEqual(expect.any(String));
            expect(readLockOid(repository, 42)).toBe(retainedOwnerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('retains the exact recovery owner when late duplicate convergence finds a foreign review envelope', () => {
        const repository = createTemporaryGitRepository();
        const { port: basePort, calls } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 2,
            existingReplyReviewState: 'COMMENTED',
            existingReplyReviewBody: '',
            secondaryReplyReviewBody: resolutionReviewSummary(pullRequestId, threadId, head),
        });
        let inspections = 0;
        const port: ResolveReviewThreadPort = {
            ...basePort,
            inspect: (number, currentThreadId) => {
                const inspection = basePort.inspect(number, currentThreadId);
                inspections += 1;
                const duplicate = inspection.thread?.comments.find((comment) => comment.id === 'PRRC_existing_1');
                if (inspections !== 3 || inspection.thread === null || duplicate === undefined) {
                    return inspection;
                }
                return {
                    ...inspection,
                    thread: {
                        ...inspection.thread,
                        comments: [
                            ...inspection.thread.comments,
                            {
                                ...duplicate,
                                id: 'PRRC_foreign_late',
                                fullDatabaseId: '9223372036854775898',
                                reviewId: 'PRR_foreign_late',
                                reviewFullDatabaseId: '9223372036854775897',
                                reviewAuthorNodeId: REVIEWER_BOT_NODE_ID,
                                reviewAuthorLogin: 'renamed-reviewer[bot]',
                                reviewAuthorType: 'Bot',
                            },
                        ],
                    },
                };
            },
        };
        const mutation = {
            phase: 'updateReviewBody' as const,
            epoch: 1,
            reviewId,
            reviewDatabaseId: '9223372036854775808',
            reviewCommitOid: head,
            body: resolutionReviewSummary(pullRequestId, threadId, head),
            marker: immutableEnvelopeSnapshot(),
        };
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, mutation);
            updateLock(repository, 42, ownerOid);
            let retainedOwnerOid: string | undefined;

            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) => {
                    retainedOwnerOid = readLockOid(repository, 42);
                    return recoverReviewResolutionLockOwnerState(42, owner, port);
                })
            ).toThrow(/non-author review/i);
            expect(
                calls.filter((call) =>
                    /^(createReview|reply:|updateReview|delete:|deleteReview|submit|resolve|log:)/.test(call)
                )
            ).toEqual([]);
            expect(retainedOwnerOid).toEqual(expect.any(String));
            expect(readLockOid(repository, 42)).toBe(retainedOwnerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it.each([
        ['resolved-by node', { resolvedByNodeId: REVIEWER_BOT_NODE_ID, resolvedByType: undefined }],
        ['resolved-by typename', { resolvedByNodeId: undefined, resolvedByType: 'Bot' }],
    ] as const)(
        'preserves an immutable submitted-review recovery lock when the fresh snapshot has the wrong %s',
        (_label, override) => {
            const repository = createTemporaryGitRepository();
            const { port: basePort, calls } = fakePort({
                isResolved: true,
                initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
                initialResolvedByType: 'User',
                existingReplyCount: 1,
                existingReplyReviewState: 'COMMENTED',
                existingReplyReviewBody: '',
            });
            let inspections = 0;
            const port: ResolveReviewThreadPort = {
                ...basePort,
                inspect: (number, currentThreadId) => {
                    const inspection = basePort.inspect(number, currentThreadId);
                    inspections += 1;
                    if (inspections !== 2 || inspection.thread === null) {
                        return inspection;
                    }
                    return {
                        ...inspection,
                        thread: {
                            ...inspection.thread,
                            ...(override.resolvedByNodeId === undefined
                                ? {}
                                : { resolvedByNodeId: override.resolvedByNodeId }),
                            ...(override.resolvedByType === undefined
                                ? {}
                                : { resolvedByType: override.resolvedByType }),
                        },
                    };
                },
                updateReviewBody: () => {
                    throw new Error('immutable submitted review must not be updated');
                },
            };
            const mutation = {
                phase: 'updateReviewBody' as const,
                epoch: 1,
                reviewId,
                reviewDatabaseId: '9223372036854775808',
                reviewCommitOid: head,
                body: resolutionReviewSummary(pullRequestId, threadId, head),
                marker: immutableEnvelopeSnapshot(),
            };
            try {
                const ownerOid = writeLockOwnerBlob(repository, 999999, head, mutation);
                updateLock(repository, 42, ownerOid);
                let retainedOwnerOid: string | undefined;

                expect(() =>
                    recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) => {
                        retainedOwnerOid = readLockOid(repository, 42);
                        return recoverReviewResolutionLockOwnerState(42, owner, port);
                    })
                ).toThrow(/not resolved by/i);
                expect(
                    calls.filter((call) =>
                        /^(createReview|reply:|updateReview|delete:|deleteReview|submit|resolve|log:)/.test(call)
                    )
                ).toEqual([]);
                expect(retainedOwnerOid).toEqual(expect.any(String));
                expect(readLockOid(repository, 42)).toBe(retainedOwnerOid);
                expect(requireLockOwner(repository, 42)).toMatchObject({ threadId, head, mutation });
            } finally {
                rmSync(repository, { recursive: true, force: true });
            }
        }
    );

    it.each([
        ['removes the marker', undefined, /does not have exactly one valid Done reply marker/i],
        ['changes the review author node', { reviewAuthorNodeId: REVIEWER_BOT_NODE_ID }, /non-author review/i],
        ['changes the review author typename', { reviewAuthorType: 'User' }, /non-author review/i],
        [
            'changes the decimal review identity',
            { reviewFullDatabaseId: '9223372036854775809' },
            /no longer has its immutable/i,
        ],
        ['changes the linked review ID', { reviewId: 'PRR_replacement' }, /no longer has its immutable/i],
        ['changes the review commit', { reviewCommitOid: movedHead }, /no longer has its immutable/i],
        ['changes the review body', { reviewBody: 'replacement review body' }, /noncanonical author review/i],
        ['changes the linked review state', { reviewState: 'PENDING' }, /unsupported review state/i],
    ] as const)(
        'retains the exact recovery owner when the terminal inspection %s',
        (_label, override, expectedError) => {
            const repository = createTemporaryGitRepository();
            const { port: basePort, calls } = fakePort({
                isResolved: true,
                initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
                initialResolvedByType: 'User',
                existingReplyCount: 1,
                existingReplyReviewState: 'COMMENTED',
                existingReplyReviewBody: '',
            });
            let inspections = 0;
            const port: ResolveReviewThreadPort = {
                ...basePort,
                inspect: (number, currentThreadId) => {
                    const inspection = basePort.inspect(number, currentThreadId);
                    inspections += 1;
                    if (inspections !== 3 || inspection.thread === null) {
                        return inspection;
                    }
                    return {
                        ...inspection,
                        thread: {
                            ...inspection.thread,
                            comments:
                                override === undefined
                                    ? inspection.thread.comments.filter((comment) => comment.id !== replyId)
                                    : inspection.thread.comments.map((comment) =>
                                          comment.id === replyId ? { ...comment, ...override } : comment
                                      ),
                        },
                    };
                },
            };
            const mutation = {
                phase: 'updateReviewBody' as const,
                epoch: 1,
                reviewId,
                reviewDatabaseId: '9223372036854775808',
                reviewCommitOid: head,
                body: resolutionReviewSummary(pullRequestId, threadId, head),
                marker: immutableEnvelopeSnapshot(),
            };
            try {
                const ownerOid = writeLockOwnerBlob(repository, 999999, head, mutation);
                updateLock(repository, 42, ownerOid);
                let retainedOwnerOid: string | undefined;
                expect(() =>
                    recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) => {
                        retainedOwnerOid = readLockOid(repository, 42);
                        return recoverReviewResolutionLockOwnerState(42, owner, port);
                    })
                ).toThrow(expectedError);
                expect(
                    calls.filter((call) =>
                        /^(createReview|reply:|updateReview|delete:|deleteReview|submit|resolve|log:)/.test(call)
                    )
                ).toEqual([]);
                expect(retainedOwnerOid).toEqual(expect.any(String));
                expect(readLockOid(repository, 42)).toBe(retainedOwnerOid);
            } finally {
                rmSync(repository, { recursive: true, force: true });
            }
        }
    );

    it.each([
        ['review author node', { reviewAuthorNodeId: REVIEWER_BOT_NODE_ID }],
        ['review author typename', { reviewAuthorType: 'User' }],
        ['review commit', { reviewCommitOid: movedHead }],
        ['review decimal identity', { reviewFullDatabaseId: '9223372036854775809' }],
    ] as const)(
        'preserves an immutable submitted-review recovery lock when the fresh marker has the wrong %s',
        (_label, override) => {
            const repository = createTemporaryGitRepository();
            const { port: basePort, calls } = fakePort({
                isResolved: true,
                initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
                initialResolvedByType: 'User',
                existingReplyCount: 1,
                existingReplyReviewState: 'COMMENTED',
                existingReplyReviewBody: '',
            });
            let inspections = 0;
            const port: ResolveReviewThreadPort = {
                ...basePort,
                inspect: (number, currentThreadId) => {
                    const inspection = basePort.inspect(number, currentThreadId);
                    inspections += 1;
                    if (inspections !== 2 || inspection.thread === null) {
                        return inspection;
                    }
                    return {
                        ...inspection,
                        thread: {
                            ...inspection.thread,
                            comments: inspection.thread.comments.map((comment) =>
                                comment.id === replyId ? { ...comment, ...override } : comment
                            ),
                        },
                    };
                },
                updateReviewBody: () => {
                    throw new Error('immutable submitted review must not be updated');
                },
            };
            const mutation = {
                phase: 'updateReviewBody' as const,
                epoch: 1,
                reviewId,
                reviewDatabaseId: '9223372036854775808',
                reviewCommitOid: head,
                body: resolutionReviewSummary(pullRequestId, threadId, head),
            };
            try {
                const ownerOid = writeLockOwnerBlob(repository, 999999, head, mutation);
                updateLock(repository, 42, ownerOid);
                let retainedOwnerOid: string | undefined;

                expect(() =>
                    recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) => {
                        retainedOwnerOid = readLockOid(repository, 42);
                        return recoverReviewResolutionLockOwnerState(42, owner, port);
                    })
                ).toThrow(/non-author review|unreconciled in-flight|could not prove an unlanded historical review/i);
                expect(
                    calls.filter((call) =>
                        /^(createReview|reply:|updateReview|delete:|deleteReview|submit|resolve|log:)/.test(call)
                    )
                ).toEqual([]);
                expect(retainedOwnerOid).toEqual(expect.any(String));
                expect(readLockOid(repository, 42)).toBe(retainedOwnerOid);
                expect(requireLockOwner(repository, 42)).toMatchObject({ threadId, head, mutation });
            } finally {
                rmSync(repository, { recursive: true, force: true });
            }
        }
    );

    it.each([
        [
            'review author node',
            {
                existingReplyReviewAuthorNodeId: REVIEWER_BOT_NODE_ID,
                existingReplyReviewAuthorType: undefined,
                reviewCommitOid: undefined,
            },
        ],
        [
            'review author typename',
            {
                existingReplyReviewAuthorNodeId: undefined,
                existingReplyReviewAuthorType: 'User',
                reviewCommitOid: undefined,
            },
        ],
        [
            'journaled review commit',
            {
                existingReplyReviewAuthorNodeId: undefined,
                existingReplyReviewAuthorType: undefined,
                reviewCommitOid: movedHead,
            },
        ],
    ] as const)('preserves an immutable submitted-review recovery lock with a wrong %s', (_label, override) => {
        const repository = createTemporaryGitRepository();
        const mutation = {
            phase: 'updateReviewBody' as const,
            epoch: 1,
            reviewId,
            reviewDatabaseId: '9223372036854775808',
            reviewCommitOid: override.reviewCommitOid ?? head,
            body: resolutionReviewSummary(pullRequestId, threadId, override.reviewCommitOid ?? head),
        };
        const { port, calls } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            existingReplyReviewState: 'COMMENTED',
            existingReplyReviewBody: '',
            ...(override.existingReplyReviewAuthorNodeId === undefined
                ? {}
                : { existingReplyReviewAuthorNodeId: override.existingReplyReviewAuthorNodeId }),
            ...(override.existingReplyReviewAuthorType === undefined
                ? {}
                : { existingReplyReviewAuthorType: override.existingReplyReviewAuthorType }),
        });
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, mutation);
            updateLock(repository, 42, ownerOid);

            let retainedOwnerOid: string | undefined;
            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) => {
                    retainedOwnerOid = readLockOid(repository, 42);
                    return recoverReviewResolutionLockOwnerState(42, owner, port);
                })
            ).toThrow(/non-author review|could not prove an unlanded historical review/i);
            expect(
                calls.filter((call) =>
                    /^(createReview|reply:|updateReview|delete:|deleteReview|submit|resolve|log:)/.test(call)
                )
            ).toEqual([]);
            expect(retainedOwnerOid).toEqual(expect.any(String));
            expect(readLockOid(repository, 42)).toBe(retainedOwnerOid);
            expect(requireLockOwner(repository, 42)).toMatchObject({ threadId, head, mutation });
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('preserves an immutable submitted-review recovery lock when its decimal identity changed', () => {
        const repository = createTemporaryGitRepository();
        const mutation = {
            phase: 'updateReviewBody' as const,
            epoch: 1,
            reviewId,
            reviewDatabaseId: '9223372036854775809',
            body: resolutionReviewSummary(pullRequestId, threadId, head),
        };
        const { port, calls } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            existingReplyReviewState: 'COMMENTED',
            existingReplyReviewBody: '',
        });
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, mutation);
            updateLock(repository, 42, ownerOid);

            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                    recoverReviewResolutionLockOwnerState(42, owner, port)
                )
            ).toThrow(/could not prove an unlanded historical review/i);
            expect(calls).toEqual(['inspect:1']);
            expect(requireLockOwner(repository, 42)).toMatchObject({ threadId, head, mutation });
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('preserves the exact recovery lock when two immutable submitted reviews compete at the current head', () => {
        const repository = createTemporaryGitRepository();
        const mutation = {
            phase: 'updateReviewBody' as const,
            epoch: 1,
            reviewId,
            reviewDatabaseId: '9223372036854775808',
            reviewCommitOid: head,
            body: resolutionReviewSummary(pullRequestId, threadId, head),
            marker: immutableEnvelopeSnapshot(),
        };
        const { port, calls } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 2,
            existingReplyReviewState: 'COMMENTED',
            existingReplyReviewBody: '',
            secondaryReplyReviewBody: '',
        });
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, mutation);
            updateLock(repository, 42, ownerOid);
            let retainedOwnerOid: string | undefined;

            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) => {
                    retainedOwnerOid = readLockOid(repository, 42);
                    return recoverReviewResolutionLockOwnerState(42, owner, port);
                })
            ).toThrow(/multiple immutable empty submitted-review envelopes/i);
            expect(
                calls.filter((call) => /^(updateReview|delete:|deleteReview|submit|resolve|log:)/.test(call))
            ).toEqual([]);
            expect(retainedOwnerOid).toEqual(expect.any(String));
            expect(readLockOid(repository, 42)).toBe(retainedOwnerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('preserves the exact recovery lock when an immutable review has no managed Done marker', () => {
        const repository = createTemporaryGitRepository();
        const mutation = {
            phase: 'updateReviewBody' as const,
            epoch: 1,
            reviewId,
            reviewDatabaseId: '9223372036854775808',
            reviewCommitOid: head,
            body: resolutionReviewSummary(pullRequestId, threadId, head),
        };
        const { port: basePort, calls } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            existingReplyReviewState: 'COMMENTED',
            existingReplyReviewBody: '',
        });
        const port: ResolveReviewThreadPort = {
            ...basePort,
            inspect: (number, currentThreadId) => {
                const inspection = basePort.inspect(number, currentThreadId);
                if (inspection.thread === null) {
                    return inspection;
                }
                return {
                    ...inspection,
                    thread: {
                        ...inspection.thread,
                        comments: inspection.thread.comments.filter((comment) => comment.id !== replyId),
                    },
                };
            },
        };
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, mutation);
            updateLock(repository, 42, ownerOid);
            let retainedOwnerOid: string | undefined;

            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) => {
                    retainedOwnerOid = readLockOid(repository, 42);
                    return recoverReviewResolutionLockOwnerState(42, owner, port);
                })
            ).toThrow(/unreconciled in-flight updateReviewBody/i);
            expect(
                calls.filter((call) => /^(updateReview|delete:|deleteReview|submit|resolve|log:)/.test(call))
            ).toEqual([]);
            expect(retainedOwnerOid).toEqual(expect.any(String));
            expect(readLockOid(repository, 42)).toBe(retainedOwnerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it.each([
        ['a landed review', resolutionReviewSummary(pullRequestId, threadId, head)],
        ['an unlanded review', ''],
    ])('preserves the recovery lock when the journaled decimal ID does not match %s', (_label, existingReviewBody) => {
        const repository = createTemporaryGitRepository();
        const mutation = {
            phase: 'updateReviewBody' as const,
            epoch: 1,
            reviewId,
            reviewDatabaseId: '9002',
            body: resolutionReviewSummary(pullRequestId, threadId, head),
        };
        const { port, calls } = fakePort({
            existingReplyCount: 1,
            existingReplyReviewState: 'PENDING',
            existingReplyReviewBody: existingReviewBody,
        });
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, mutation);
            updateLock(repository, 42, ownerOid);

            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                    recoverReviewResolutionLockOwnerState(42, owner, port)
                )
            ).toThrow(/could not prove an unlanded historical review/i);
            expect(calls).toEqual(['inspect:1']);
            expect(requireLockOwner(repository, 42)).toMatchObject({ threadId, head, mutation });
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('replays a shell-backed lost update-review-body response with the inspected review and releases the lock', () => {
        const repository = createTemporaryGitRepository();
        const body = resolutionReviewSummary(pullRequestId, threadId, head);
        const fakeGh = createFakeGhExecutable({
            [`updateReview:repos/${REQUIRED_REPOSITORY}/pulls/42/reviews/9223372036854775808:${body}`]: `{"id":9223372036854775808,"node_id":${JSON.stringify(reviewId)},"body":${JSON.stringify(body)},"state":"PENDING","commit_id":${JSON.stringify(head)},"user":{"node_id":${JSON.stringify(AUTHOR_BOT_NODE_ID)},"login":"renamed-author","type":"Bot"}}`,
        });
        const {
            port: fakePortForInspection,
            calls,
            state,
        } = fakePort({
            existingReplyCount: 1,
            existingReplyReviewState: 'PENDING',
            existingReplyReviewBody: '',
        });
        const shellBackedPort = shellPort(
            { configDir: repository, env: { SOURDAW_TRUSTED_GH_PATH: fakeGh.executable }, dispose() {} },
            repository
        );
        const port: ResolveReviewThreadPort = {
            ...fakePortForInspection,
            updateReviewBody: (currentReviewId, currentBody, reviewCommitOid, inspectedReview) => {
                const receipt = shellBackedPort.updateReviewBody(
                    currentReviewId,
                    currentBody,
                    reviewCommitOid,
                    inspectedReview
                );
                fakePortForInspection.updateReviewBody(currentReviewId, currentBody, reviewCommitOid, inspectedReview);
                return receipt;
            },
        };
        try {
            const mutation = {
                phase: 'updateReviewBody' as const,
                epoch: 1,
                reviewId,
                reviewDatabaseId: '9223372036854775808',
                body,
            };
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, mutation);
            updateLock(repository, 42, ownerOid);

            const inspection = recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                recoverReviewResolutionLockOwnerState(42, owner, port)
            );
            expect(calls).toEqual([
                'inspect:1',
                `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${head}`,
                `updateReview:${reviewId}`,
                'inspect:2',
            ]);
            expect(inspection.pendingReviews).toEqual([expect.objectContaining({ id: reviewId, body })]);
            expect(state().updatedReviewCommitOids).toEqual([{ reviewId, reviewCommitOid: head }]);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
            rmSync(fakeGh.root, { recursive: true, force: true });
        }
    });

    it('journals the exact marker before a landed shell update response is lost and recovers without another PUT', () => {
        const repository = createTemporaryGitRepository();
        const body = resolutionReviewSummary(pullRequestId, threadId, head);
        const fakeGh = createFailingReviewResolutionMutationGhExecutable('updateReviewBody');
        const {
            port: basePort,
            calls,
            state,
        } = fakePort({
            existingReplyCount: 1,
            existingReplyReviewState: 'COMMENTED',
            existingReplyReviewBody: '',
        });
        const initial = basePort.inspect(42, threadId);
        const marker = initial.thread?.comments.find((comment) => comment.id === replyId);
        if (
            marker === undefined ||
            marker.reviewId === null ||
            marker.reviewFullDatabaseId === null ||
            marker.reviewState === null ||
            marker.reviewBody === null ||
            marker.reviewCommitOid === null ||
            marker.reviewAuthorNodeId === null ||
            marker.reviewAuthorLogin === null ||
            marker.reviewAuthorType === null
        ) {
            throw new Error('fixture has no complete immutable review marker');
        }
        const review = {
            id: marker.reviewId,
            fullDatabaseId: marker.reviewFullDatabaseId,
            state: marker.reviewState,
            body: marker.reviewBody,
            commitOid: marker.reviewCommitOid,
            authorNodeId: marker.reviewAuthorNodeId,
            authorLogin: marker.reviewAuthorLogin,
            authorType: marker.reviewAuthorType,
        };
        const shellBackedPort = shellPort(
            { configDir: repository, env: { SOURDAW_TRUSTED_GH_PATH: fakeGh.executable }, dispose() {} },
            repository
        );
        const port: ResolveReviewThreadPort = {
            ...basePort,
            updateReviewBody: (currentReviewId, currentBody, reviewCommitOid, expectedReview, expectedMarker) => {
                try {
                    return shellBackedPort.updateReviewBody(
                        currentReviewId,
                        currentBody,
                        reviewCommitOid,
                        expectedReview,
                        expectedMarker
                    );
                } finally {
                    basePort.updateReviewBody(
                        currentReviewId,
                        currentBody,
                        reviewCommitOid,
                        expectedReview,
                        expectedMarker
                    );
                }
            },
        };
        try {
            expect(() =>
                withPullRequestReviewResolutionLock(
                    repository,
                    42,
                    threadId,
                    head,
                    () => port.updateReviewBody(reviewId, body, head, review, marker),
                    { executionFence: { pid: process.pid, ownerFence: { kind: 'pgid', pgid: process.pid } } }
                )
            ).toThrow(/update mutation transport lost/i);
            const ownerOid = readLockOid(repository, 42);
            expect(ownerOid).toEqual(expect.any(String));
            expect(requireLockOwner(repository, 42).mutation).toMatchObject({
                phase: 'updateReviewBody',
                reviewId,
                reviewDatabaseId: review.fullDatabaseId,
                body,
                reviewCommitOid: head,
                marker: immutableEnvelopeSnapshot(),
            });
            expect(statSync(fakeGh.calledPath).isFile()).toBe(true);

            const inspection = recoverPullRequestReviewResolutionLock(
                repository,
                42,
                ownerOid!,
                (owner) => recoverReviewResolutionLockOwnerState(42, owner, port),
                () => false
            );

            expect(calls.filter((call) => call === `updateReview:${reviewId}`)).toEqual([`updateReview:${reviewId}`]);
            expect(inspection.thread?.comments).toEqual([
                expect.objectContaining({ id: rootId }),
                expect.objectContaining({ id: replyId, reviewId, reviewBody: body, reviewState: 'COMMENTED' }),
            ]);
            expect(state().reviews).toEqual([expect.objectContaining({ id: reviewId, body, state: 'COMMENTED' })]);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
            rmSync(fakeGh.root, { recursive: true, force: true });
        }
    });

    it('replays a shell-inspected large decimal review identity through lookup, pending review, and exact PUT recovery', () => {
        const repository = createTemporaryGitRepository();
        const fullDatabaseId = '9223372036854775807';
        const body = resolutionReviewSummary(pullRequestId, threadId, head);
        const pendingReview = {
            id: reviewId,
            fullDatabaseId,
            state: 'PENDING',
            body: '',
            commit: { oid: head },
            author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
        };
        const linkedReply = {
            id: replyId,
            fullDatabaseId: '9223372036854775808',
            body: 'Done',
            author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
            pullRequestReview: pendingReview,
        };
        const updatedPendingReview = { ...pendingReview, body };
        const updatedLinkedReply = {
            ...linkedReply,
            pullRequestReview: updatedPendingReview,
        };
        const reviewLookup = JSON.stringify({
            data: {
                repository: { pullRequest: { id: pullRequestId, headRefOid: head } },
                node: { ...pendingReview, pullRequest: { id: pullRequestId } },
            },
        });
        const fakeGh = createFakeGhExecutable({
            'threads:': [
                threadPage([{ id: threadId, isResolved: false, resolvedBy: null }], false, null),
                threadPage([{ id: threadId, isResolved: false, resolvedBy: null }], false, null),
                threadPage([{ id: threadId, isResolved: false, resolvedBy: null }], false, null),
            ],
            [`comments:${threadId}:`]: [
                commentPage([root, linkedReply], false, null),
                commentPage([root, linkedReply], false, null),
                commentPage([root, updatedLinkedReply], false, null),
            ],
            'reviews:': [reviewPage([pendingReview], false, null), reviewPage([updatedPendingReview], false, null)],
            [`threadResolution:${threadId}`]: [threadResolutionPage(), threadResolutionPage()],
            [`review:${reviewId}`]: reviewLookup,
            [`updateReview:repos/${REQUIRED_REPOSITORY}/pulls/42/reviews/${fullDatabaseId}:${body}`]: `{"id":${fullDatabaseId},"node_id":${JSON.stringify(reviewId)},"body":${JSON.stringify(body)},"state":"PENDING","commit_id":${JSON.stringify(head)},"user":{"node_id":${JSON.stringify(AUTHOR_BOT_NODE_ID)},"login":"renamed-author","type":"Bot"}}`,
        });
        const port = shellPort(
            { configDir: repository, env: { SOURDAW_TRUSTED_GH_PATH: fakeGh.executable }, dispose() {} },
            repository
        );
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'updateReviewBody',
                epoch: 1,
                reviewId,
                reviewDatabaseId: fullDatabaseId,
                body,
            });
            updateLock(repository, 42, ownerOid);

            const inspection = recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                recoverReviewResolutionLockOwnerState(42, owner, port)
            );
            expect(inspection.pendingReviews).toEqual([
                expect.objectContaining({ id: reviewId, fullDatabaseId, body }),
            ]);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
            rmSync(fakeGh.root, { recursive: true, force: true });
        }
    });

    it('replays an unlanded H1 review-body update at H2 after proving the historical review and current attachment', () => {
        const repository = createTemporaryGitRepository();
        const { port, calls, state } = fakePort({
            heads: [movedHead, movedHead],
            existingReplyCount: 1,
            existingReplyReviewState: 'COMMENTED',
            existingReplyReviewBody: '',
            existingReplyReviewCommitOid: head,
            expectedAttachedReviewThreadInspectionHead: movedHead,
            expectedPullRequestReviewInspectionPullRequestId: pullRequestId,
            expectedPullRequestReviewInspectionHead: movedHead,
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
            expect(calls).toEqual([
                'inspect:1',
                `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${movedHead}`,
                `updateReview:${reviewId}`,
                'inspect:2',
            ]);
            expect(inspection.head).toBe(movedHead);
            expect(state().reviews).toEqual([
                expect.objectContaining({
                    id: reviewId,
                    state: 'COMMENTED',
                    commitOid: head,
                    body: resolutionReviewSummary(pullRequestId, threadId, head),
                }),
            ]);
            expect(state().updatedReviewCommitOids).toEqual([{ reviewId, reviewCommitOid: head }]);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('replays an unlanded H1 pending submission at H2 after proving the historical review and current attachment', () => {
        const repository = createTemporaryGitRepository();
        const { port, calls, state } = fakePort({
            heads: [movedHead, movedHead],
            existingReplyCount: 1,
            existingReplyReviewState: 'PENDING',
            existingReplyReviewBody: resolutionReviewSummary(pullRequestId, threadId, head),
            existingReplyReviewCommitOid: head,
            expectedAttachedReviewThreadInspectionHead: movedHead,
            expectedPullRequestReviewInspectionPullRequestId: pullRequestId,
            expectedPullRequestReviewInspectionHead: movedHead,
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
                `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${movedHead}`,
                `submitReview:${reviewId}`,
                'inspect:2',
            ]);
            expect(inspection.head).toBe(movedHead);
            expect(state().reviews).toEqual([
                expect.objectContaining({ id: reviewId, state: 'COMMENTED', commitOid: head }),
            ]);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('converges duplicate H1 Done markers after an H2 submit replay before releasing recovery', () => {
        const repository = createTemporaryGitRepository();
        const { port, calls, state } = fakePort({
            heads: [movedHead, movedHead, movedHead, movedHead],
            existingReplyCount: 1,
            existingReplyReviewState: 'PENDING',
            existingReplyReviewBody: resolutionReviewSummary(pullRequestId, threadId, head),
            existingReplyReviewCommitOid: head,
            concurrentReplyBeforeConvergence: true,
            expectedAttachedReviewThreadInspectionHead: movedHead,
            expectedPullRequestReviewInspectionPullRequestId: pullRequestId,
            expectedPullRequestReviewInspectionHead: movedHead,
        });
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'submitReview',
                epoch: 1,
                reviewId,
                body: resolutionReviewSummary(pullRequestId, threadId, head),
                reviewCommitOid: head,
            });
            updateLock(repository, 42, ownerOid);

            const inspection = recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                recoverReviewResolutionLockOwnerState(42, owner, port)
            );

            expect(inspection.head).toBe(movedHead);
            expect(calls).toEqual([
                'inspect:1',
                `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${movedHead}`,
                `submitReview:${reviewId}`,
                'inspect:2',
                'inspect:3',
                'delete:PRRC_concurrent',
                'inspect:4',
            ]);
            expect(state().reviews).toEqual([
                expect.objectContaining({
                    id: reviewId,
                    state: 'COMMENTED',
                    commitOid: head,
                    body: resolutionReviewSummary(pullRequestId, threadId, head),
                }),
                expect.objectContaining({
                    id: 'PRR_concurrent',
                    state: 'COMMENTED',
                    commitOid: head,
                    body: resolutionReviewSummary(pullRequestId, threadId, head),
                }),
            ]);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('converges duplicate landed H1 Done markers at H2 without another submit', () => {
        const repository = createTemporaryGitRepository();
        const { port, calls, state } = fakePort({
            heads: [movedHead, movedHead, movedHead],
            existingReplyCount: 2,
            existingReplyReviewState: 'COMMENTED',
            existingReplyReviewBody: resolutionReviewSummary(pullRequestId, threadId, head),
            existingReplyReviewCommitOid: head,
        });
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'submitReview',
                epoch: 1,
                reviewId,
                body: resolutionReviewSummary(pullRequestId, threadId, head),
                reviewCommitOid: head,
            });
            updateLock(repository, 42, ownerOid);

            recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                recoverReviewResolutionLockOwnerState(42, owner, port)
            );

            expect(calls).toEqual(['inspect:1', 'inspect:2', 'delete:PRRC_existing_1', 'inspect:3']);
            expect(state().reviews).toEqual([
                expect.objectContaining({ id: reviewId, state: 'COMMENTED', commitOid: head }),
                expect.objectContaining({ id: 'PRR_existing_1', state: 'COMMENTED', commitOid: head }),
            ]);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it.each([
        ['updateReviewBody', 'landed', 'PENDING', resolutionReviewSummary(pullRequestId, threadId, head)],
        ['updateReviewBody', 'unlanded', 'PENDING', ''],
        ['submitReview', 'landed', 'COMMENTED', resolutionReviewSummary(pullRequestId, threadId, head)],
        ['submitReview', 'unlanded', 'PENDING', resolutionReviewSummary(pullRequestId, threadId, head)],
    ] as const)(
        'recovers an owner-H2 review-H1 %s %s mutation with exact target-commit fencing',
        (phase, settlement, reviewState, reviewBody) => {
            const repository = createTemporaryGitRepository();
            const mutation = {
                phase,
                epoch: 1,
                reviewId,
                body: resolutionReviewSummary(pullRequestId, threadId, head),
                reviewCommitOid: head,
            };
            const { port, calls, state } = fakePort({
                heads: [movedHead, movedHead],
                existingReplyCount: 1,
                existingReplyReviewState: reviewState,
                existingReplyReviewBody: reviewBody,
                existingReplyReviewCommitOid: head,
                expectedAttachedReviewThreadInspectionHead: movedHead,
                expectedPullRequestReviewInspectionPullRequestId: pullRequestId,
                expectedPullRequestReviewInspectionHead: movedHead,
            });
            try {
                const ownerOid = writeLockOwnerBlob(repository, 999999, movedHead, mutation);
                updateLock(repository, 42, ownerOid);
                const inspection = recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                    recoverReviewResolutionLockOwnerState(42, owner, port)
                );

                expect(inspection.head).toBe(movedHead);
                expect(readLockOid(repository, 42)).toBeUndefined();
                if (settlement === 'landed') {
                    expect(calls).toEqual(['inspect:1']);
                } else {
                    expect(calls).toEqual([
                        'inspect:1',
                        `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${movedHead}`,
                        `${phase === 'submitReview' ? 'submitReview' : 'updateReview'}:${reviewId}`,
                        'inspect:2',
                    ]);
                    expect(state().reviews).toEqual([
                        expect.objectContaining({
                            id: reviewId,
                            body: resolutionReviewSummary(pullRequestId, threadId, head),
                            commitOid: head,
                        }),
                    ]);
                }
            } finally {
                rmSync(repository, { recursive: true, force: true });
            }
        }
    );

    it.each(['updateReviewBody', 'submitReview'] as const)(
        'preserves owner-H2 recovery when a %s target commit is malformed',
        (phase) => {
            const repository = createTemporaryGitRepository();
            const mutation = {
                phase,
                epoch: 1,
                reviewId,
                body: resolutionReviewSummary(pullRequestId, threadId, head),
                reviewCommitOid: movedHead,
            };
            const { port, calls } = fakePort({
                heads: [movedHead],
                existingReplyCount: 2,
                existingReplyReviewState: 'PENDING',
                existingReplyReviewBody:
                    phase === 'updateReviewBody' ? '' : resolutionReviewSummary(pullRequestId, threadId, head),
                existingReplyReviewCommitOid: head,
                expectedPullRequestReviewInspectionPullRequestId: pullRequestId,
                expectedPullRequestReviewInspectionHead: movedHead,
            });
            try {
                const ownerOid = writeLockOwnerBlob(repository, 999999, movedHead, mutation);
                updateLock(repository, 42, ownerOid);
                expect(() =>
                    recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                        recoverReviewResolutionLockOwnerState(42, owner, port)
                    )
                ).toThrow(/invalid historical body|could not prove an unlanded historical review/i);
                expect(calls).toEqual(['inspect:1']);
                expect(requireLockOwner(repository, 42)).toMatchObject({ threadId, head: movedHead, mutation });
            } finally {
                rmSync(repository, { recursive: true, force: true });
            }
        }
    );

    it('preserves the recovery lock after a malformed historical submit receipt', () => {
        const repository = createTemporaryGitRepository();
        const { port } = fakePort({
            existingReplyCount: 1,
            existingReplyReviewState: 'PENDING',
            existingReplyReviewBody: resolutionReviewSummary(pullRequestId, threadId, head),
            submitReceiptAuthorType: 'User',
        });
        try {
            const mutation = {
                phase: 'submitReview' as const,
                epoch: 1,
                reviewId,
                body: resolutionReviewSummary(pullRequestId, threadId, head),
            };
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, mutation);
            updateLock(repository, 42, ownerOid);
            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                    recoverReviewResolutionLockOwnerState(42, owner, port)
                )
            ).toThrow(/submit review returned an invalid result/i);
            expect(readLockOid(repository, 42)).toBeDefined();
            expect(requireLockOwner(repository, 42)).toMatchObject({ threadId, head, mutation });
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it.each([
        ['review identity', { submitReceiptReviewId: 'PRR_wrong' }],
        ['historical commit', { submitReceiptCommitOid: movedHead }],
    ] as const)('preserves the same-head submit-recovery lock after a malformed %s receipt', (_label, input) => {
        const repository = createTemporaryGitRepository();
        const mutation = {
            phase: 'submitReview' as const,
            epoch: 1,
            reviewId,
            body: resolutionReviewSummary(pullRequestId, threadId, head),
        };
        const { port, calls } = fakePort({
            ...input,
            existingReplyCount: 1,
            existingReplyReviewState: 'PENDING',
            existingReplyReviewBody: resolutionReviewSummary(pullRequestId, threadId, head),
        });
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, mutation);
            updateLock(repository, 42, ownerOid);

            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                    recoverReviewResolutionLockOwnerState(42, owner, port)
                )
            ).toThrow(/submit review returned an invalid result/i);
            expect(calls).toEqual([
                'inspect:1',
                `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${head}`,
                `submitReview:${reviewId}`,
            ]);
            const preservedOwnerOid = readLockOid(repository, 42);
            expect(preservedOwnerOid).toBeDefined();
            expect(preservedOwnerOid).not.toBe(ownerOid);
            expect(requireLockOwner(repository, 42)).toMatchObject({ threadId, head, mutation });
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('preserves the H1 submit-replay lock after an H2 receipt names the author as a non-Bot', () => {
        const repository = createTemporaryGitRepository();
        const mutation = {
            phase: 'submitReview' as const,
            epoch: 1,
            reviewId,
            body: resolutionReviewSummary(pullRequestId, threadId, head),
        };
        const { port, calls } = fakePort({
            heads: [movedHead],
            existingReplyCount: 1,
            existingReplyReviewState: 'PENDING',
            existingReplyReviewBody: resolutionReviewSummary(pullRequestId, threadId, head),
            existingReplyReviewCommitOid: head,
            expectedAttachedReviewThreadInspectionHead: movedHead,
            expectedPullRequestReviewInspectionPullRequestId: pullRequestId,
            expectedPullRequestReviewInspectionHead: movedHead,
            submitReceiptAuthorNodeId: AUTHOR_BOT_NODE_ID,
            submitReceiptAuthorType: 'User',
        });
        try {
            const originalOid = writeLockOwnerBlob(repository, 999999, head, mutation);
            updateLock(repository, 42, originalOid);

            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, originalOid, (owner) =>
                    recoverReviewResolutionLockOwnerState(42, owner, port)
                )
            ).toThrow(/submit review returned an invalid result/i);
            const preservedOid = readLockOid(repository, 42);
            expect(preservedOid).toBeDefined();
            expect(preservedOid).not.toBe(originalOid);
            expect(requireLockOwner(repository, 42)).toMatchObject({ threadId, head, mutation });
            expect(calls).toEqual([
                'inspect:1',
                `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${movedHead}`,
                `submitReview:${reviewId}`,
            ]);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('preserves the H1 submit-replay lock after an H2 receipt names a different review', () => {
        const repository = createTemporaryGitRepository();
        const mutation = {
            phase: 'submitReview' as const,
            epoch: 1,
            reviewId,
            body: resolutionReviewSummary(pullRequestId, threadId, head),
        };
        const { port, calls } = fakePort({
            heads: [movedHead],
            existingReplyCount: 1,
            existingReplyReviewState: 'PENDING',
            existingReplyReviewBody: resolutionReviewSummary(pullRequestId, threadId, head),
            existingReplyReviewCommitOid: head,
            expectedAttachedReviewThreadInspectionHead: movedHead,
            expectedPullRequestReviewInspectionPullRequestId: pullRequestId,
            expectedPullRequestReviewInspectionHead: movedHead,
            submitReceiptReviewId: 'PRR_wrong',
        });
        try {
            const originalOid = writeLockOwnerBlob(repository, 999999, head, mutation);
            updateLock(repository, 42, originalOid);

            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, originalOid, (owner) =>
                    recoverReviewResolutionLockOwnerState(42, owner, port)
                )
            ).toThrow(/submit review returned an invalid result/i);
            const preservedOid = readLockOid(repository, 42);
            expect(preservedOid).toBeDefined();
            expect(preservedOid).not.toBe(originalOid);
            expect(requireLockOwner(repository, 42)).toMatchObject({ threadId, head, mutation });
            expect(calls).toEqual([
                'inspect:1',
                `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${movedHead}`,
                `submitReview:${reviewId}`,
            ]);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('preserves the recovery lock when H1 submit recovery cannot prove the historical review at H2', () => {
        const repository = createTemporaryGitRepository();
        try {
            const mutation = {
                phase: 'submitReview' as const,
                epoch: 1,
                reviewId,
                body: resolutionReviewSummary(pullRequestId, threadId, head),
            };
            const { port, calls } = fakePort({
                heads: [movedHead],
                existingReplyCount: 1,
                existingReplyReviewState: 'PENDING',
                existingReplyReviewBody: resolutionReviewSummary(pullRequestId, threadId, head),
                existingReplyReviewCommitOid: movedHead,
                expectedPullRequestReviewInspectionPullRequestId: pullRequestId,
                expectedPullRequestReviewInspectionHead: movedHead,
            });
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, mutation);
            updateLock(repository, 42, ownerOid);

            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                    recoverReviewResolutionLockOwnerState(42, owner, port)
                )
            ).toThrow(/could not prove an unlanded historical review/i);
            expect(calls).toEqual(['inspect:1']);
            expect(readLockOid(repository, 42)).toBeDefined();
            expect(requireLockOwner(repository, 42)).toMatchObject({ threadId, head, mutation });
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('rejects a forged H1 submit body at current H2 before any public mutation', () => {
        const repository = createTemporaryGitRepository();
        const mutation = {
            phase: 'submitReview' as const,
            epoch: 1,
            reviewId,
            body: 'forged historical body',
            reviewCommitOid: head,
        };
        const { port, calls } = fakePort({
            heads: [movedHead],
            existingReplyCount: 1,
            existingReplyReviewState: 'PENDING',
            existingReplyReviewBody: mutation.body,
            existingReplyReviewCommitOid: head,
        });
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, mutation);
            updateLock(repository, 42, ownerOid);
            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                    recoverReviewResolutionLockOwnerState(42, owner, port)
                )
            ).toThrow(/submit review recovery has an invalid historical body/i);
            expect(calls).toEqual(['inspect:1']);
            expect(requireLockOwner(repository, 42)).toMatchObject({ threadId, head, mutation });
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it.each([
        ['client mutation id', { updateClientMutationId: 'wrong' }],
        ['review identity', { updateReceiptReviewId: 'PRR_wrong' }],
        ['decimal review identity', { updateReceiptFullDatabaseId: '9223372036854775810' }],
        ['body', { updateReceiptBody: 'wrong body' }],
        ['state', { updateReceiptState: 'COMMENTED' }],
        ['historical commit', { updateReceiptCommitOid: movedHead }],
        ['author actor', { updateReceiptAuthorNodeId: REVIEWER_BOT_NODE_ID }],
        ['author type', { updateReceiptAuthorNodeId: AUTHOR_BOT_NODE_ID, updateReceiptAuthorType: 'User' }],
    ] as const)('preserves the recovery lock after a malformed update-review-body %s receipt', (_label, input) => {
        const repository = createTemporaryGitRepository();
        const { port, calls } = fakePort({
            ...input,
            existingReplyCount: 1,
            existingReplyReviewState: 'PENDING',
            existingReplyReviewBody: '',
        });
        try {
            const mutation = {
                phase: 'updateReviewBody' as const,
                epoch: 1,
                reviewId,
                body: resolutionReviewSummary(pullRequestId, threadId, head),
            };
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, mutation);
            updateLock(repository, 42, ownerOid);
            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                    recoverReviewResolutionLockOwnerState(42, owner, port)
                )
            ).toThrow(/update review body returned an invalid result/i);
            expect(calls).toEqual([
                'inspect:1',
                `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${head}`,
                `updateReview:${reviewId}`,
            ]);
            const preservedOwnerOid = readLockOid(repository, 42);
            expect(preservedOwnerOid).toBeDefined();
            expect(preservedOwnerOid).not.toBe(ownerOid);
            expect(requireLockOwner(repository, 42)).toMatchObject({ threadId, head, mutation });
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
            existingReplyCount: 2,
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
            expect(inspection.thread?.comments.map((comment) => comment.id)).toEqual([rootId, 'PRRC_existing_1']);
            expect(state().comments.map((comment) => comment.id)).toEqual([rootId, 'PRRC_existing_1']);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it.each([
        ['the only canonical marker', replyId, { existingReplyCount: 1 }],
        ['an already-absent target without a canonical marker', 'PRRC_absent', { existingReplyCount: 0 }],
    ] as const)('preserves both recovery locks without deleting %s', (_label, targetReplyId, input) => {
        const repository = createTemporaryGitRepository();
        const { port, calls } = fakePort(input);
        try {
            const sharedOwnerOid = writeSharedMutationLockOwnerBlob(repository, 999999);
            updateSharedMutationLock(repository, 42, sharedOwnerOid);
            const ownerOid = writeLockOwnerBlob(
                repository,
                999999,
                head,
                { phase: 'deleteReply', epoch: 1, replyId: targetReplyId },
                undefined,
                undefined,
                sharedOwnerOid
            );
            updateLock(repository, 42, ownerOid);

            expect(() =>
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    ownerOid,
                    (owner) => recoverReviewResolutionLockOwnerState(42, owner, port),
                    () => false
                )
            ).toThrow(/unreconciled in-flight deleteReply mutation/);
            expect(calls).toEqual(['inspect:1']);
            expect(readLockOid(repository, 42)).toBeDefined();
            expect(readSharedMutationLockOid(repository, 42)).toBeDefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('continues same-head recovery after a landed reply deletion to converge and resolve', () => {
        const repository = createTemporaryGitRepository();
        const { port, calls, state } = fakePort({ existingReplyCount: 2, existingReplyReviewState: 'COMMENTED' });
        try {
            port.deleteReply(replyId);
            calls.length = 0;
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'deleteReply',
                epoch: 1,
                replyId,
            });
            updateLock(repository, 42, ownerOid);
            const inspection = recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                recoverReviewResolutionLockOwnerState(42, owner, port)
            );
            expect(calls).toContain(`resolve:${threadId}`);
            expect(inspection.thread).toMatchObject({
                isResolved: true,
                resolvedByNodeId: AUTHOR_BOT_NODE_ID,
                resolvedByType: 'User',
            });
            expect(state().comments.filter((comment) => comment.body === 'Done')).toHaveLength(1);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('recovers a lost delete response with duplicate canonical markers by converging before release', () => {
        const repository = createTemporaryGitRepository();
        const { port, calls, state } = fakePort({
            existingReplyCount: 3,
            existingReplyReviewState: 'COMMENTED',
            reverseExistingReplyOrder: true,
        });
        try {
            const sharedOwnerOid = writeSharedMutationLockOwnerBlob(repository, 999999);
            updateSharedMutationLock(repository, 42, sharedOwnerOid);
            const ownerOid = writeLockOwnerBlob(
                repository,
                999999,
                head,
                { phase: 'deleteReply', epoch: 1, replyId },
                undefined,
                undefined,
                sharedOwnerOid
            );
            updateLock(repository, 42, ownerOid);
            const deleteReplyWithLostResponse = port.deleteReply;
            let lostFirstResponse = true;
            port.deleteReply = (id) => {
                deleteReplyWithLostResponse(id);
                if (lostFirstResponse) {
                    lostFirstResponse = false;
                    throw new Error('delete reply response lost');
                }
            };
            expect(() => port.deleteReply(replyId)).toThrow('delete reply response lost');
            calls.length = 0;

            const inspection = recoverPullRequestReviewResolutionLock(
                repository,
                42,
                ownerOid,
                (owner) => recoverReviewResolutionLockOwnerState(42, owner, port),
                () => false
            );

            expect(calls).toContain(`resolve:${threadId}`);
            expect(calls).toContain('delete:PRRC_existing_2');
            expect(calls).not.toContain('delete:PRRC_existing_1');
            expect(inspection.thread).toMatchObject({ isResolved: true, resolvedByNodeId: AUTHOR_BOT_NODE_ID });
            expect(
                state()
                    .comments.filter((comment) => comment.body === 'Done')
                    .map((comment) => comment.id)
            ).toEqual(['PRRC_existing_1']);
            expect(readLockOid(repository, 42)).toBeUndefined();
            expect(readSharedMutationLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('releases an exact immutable envelope after a duplicate deletion response is lost', () => {
        const repository = createTemporaryGitRepository();
        const { port, calls, state } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 2,
            existingReplyReviewState: 'COMMENTED',
            existingReplyReviewBody: '',
            secondaryReplyReviewBody: resolutionReviewSummary(pullRequestId, threadId, head),
            existingReplyFullDatabaseIds: ['9223372036854775809', '9223372036854775808'],
        });
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'deleteReply',
                epoch: 1,
                replyId: 'PRRC_existing_1',
                immutableEnvelope: immutableEnvelopeSnapshot({ markerFullDatabaseId: '9223372036854775809' }),
            });
            updateLock(repository, 42, ownerOid);
            const deleteReplyWithLostResponse = port.deleteReply;
            port.deleteReply = (id) => {
                deleteReplyWithLostResponse(id);
                throw new Error('delete reply response lost');
            };
            expect(() => port.deleteReply('PRRC_existing_1')).toThrow('delete reply response lost');
            calls.length = 0;

            recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                recoverReviewResolutionLockOwnerState(42, owner, port)
            );

            expect(state().comments.filter((comment) => comment.body === 'Done')).toEqual([
                expect.objectContaining({ id: replyId, reviewId }),
            ]);
            expect(
                calls.filter((call) =>
                    /^(createReview|reply:|updateReview|delete:|deleteReview|submit|resolve)/.test(call)
                )
            ).toEqual([]);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('converges same-review empty immutable duplicates after the first delete response is lost', () => {
        const repository = createTemporaryGitRepository();
        const { port: basePort, calls } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 3,
            existingReplyReviewState: 'COMMENTED',
            existingReplyReviewBody: '',
            existingReplyFullDatabaseIds: ['9223372036854775808', '9223372036854775809', '9223372036854775810'],
        });
        const port: ResolveReviewThreadPort = {
            ...basePort,
            inspect: (number, currentThreadId) => {
                const inspection = basePort.inspect(number, currentThreadId);
                if (inspection.thread === null) {
                    return inspection;
                }
                const canonical = inspection.thread.comments.find((comment) => comment.id === replyId);
                if (canonical === undefined) {
                    throw new Error('fixture has no immutable canonical marker');
                }
                return {
                    ...inspection,
                    thread: {
                        ...inspection.thread,
                        comments: inspection.thread.comments.map((comment) =>
                            comment.id.startsWith('PRRC_existing_')
                                ? {
                                      ...comment,
                                      reviewId: canonical.reviewId,
                                      reviewFullDatabaseId: canonical.reviewFullDatabaseId,
                                      reviewState: canonical.reviewState,
                                      reviewBody: canonical.reviewBody,
                                      reviewCommitOid: canonical.reviewCommitOid,
                                      reviewAuthorNodeId: canonical.reviewAuthorNodeId,
                                      reviewAuthorLogin: canonical.reviewAuthorLogin,
                                      reviewAuthorType: canonical.reviewAuthorType,
                                  }
                                : comment
                        ),
                    },
                };
            },
        };
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'deleteReply',
                epoch: 1,
                replyId: 'PRRC_existing_1',
                immutableEnvelope: immutableEnvelopeSnapshot(),
            });
            updateLock(repository, 42, ownerOid);
            const deleteReplyWithLostResponse = port.deleteReply;
            let lostFirstResponse = true;
            port.deleteReply = (id) => {
                deleteReplyWithLostResponse(id);
                if (lostFirstResponse) {
                    lostFirstResponse = false;
                    throw new Error('delete reply response lost');
                }
            };
            expect(() => port.deleteReply('PRRC_existing_1')).toThrow('delete reply response lost');
            calls.length = 0;

            const inspection = recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                recoverReviewResolutionLockOwnerState(42, owner, port)
            );

            expect(calls).toContain('delete:PRRC_existing_2');
            expect(calls).not.toContain('delete:PRRC_existing_1');
            expect(inspection.thread?.comments.filter((comment) => comment.body === 'Done')).toEqual([
                expect.objectContaining({ id: replyId, reviewId }),
            ]);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('replays an unlanded shell-backed immutable delete only after journaling its exact target', () => {
        const repository = createTemporaryGitRepository();
        const fakeGh = createFakeGhExecutable({ 'deleteReply:PRRC_existing_1': 'not-json' });
        const { port: basePort } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 3,
            existingReplyReviewState: 'COMMENTED',
            existingReplyReviewBody: '',
            secondaryReplyReviewBody: resolutionReviewSummary(pullRequestId, threadId, head),
        });
        const deletePort = shellPort(
            { configDir: repository, env: { SOURDAW_TRUSTED_GH_PATH: fakeGh.executable }, dispose() {} },
            repository
        );
        const port: ResolveReviewThreadPort = {
            ...basePort,
            deleteReply: deletePort.deleteReply,
            serializeReviewThreadMutation: (number, currentThreadId, expectedHead, operation) =>
                withPullRequestReviewResolutionLock(repository, number, currentThreadId, expectedHead, operation, {
                    executionFence: {
                        pid: process.pid,
                        ownerFence: { kind: 'pgid', pgid: process.pid, leaderStartedAt: '1' },
                    },
                }),
        };
        try {
            expect(() => resolveReviewThread(42, threadId, head, AUTHOR_BOT_NODE_ID, port)).toThrow();
            const owner = requireLockOwner(repository, 42);
            expect(owner.mutation).toMatchObject({
                phase: 'deleteReply',
                replyId: 'PRRC_existing_1',
                immutableEnvelope: immutableEnvelopeSnapshot(),
                target: immutableEnvelopeSnapshot({
                    markerId: 'PRRC_existing_1',
                    markerFullDatabaseId: '9223372036854775809',
                    reviewId: 'PRR_existing_1',
                    reviewFullDatabaseId: '9223372036854775809',
                    reviewBody: resolutionReviewSummary(pullRequestId, threadId, head),
                }),
            });
            const inspection = recoverPullRequestReviewResolutionLock(
                repository,
                42,
                readLockOid(repository, 42)!,
                (owner) => recoverReviewResolutionLockOwnerState(42, owner, basePort),
                () => false
            );
            expect(inspection.thread?.comments.filter((comment) => comment.body === 'Done')).toEqual([
                expect.objectContaining({ id: replyId, reviewId }),
            ]);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
            rmSync(fakeGh.root, { recursive: true, force: true });
        }
    });

    it('retains the delete-recovery lock when its immutable survivor identity drifts', () => {
        const repository = createTemporaryGitRepository();
        const { port: basePort, calls } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 2,
            existingReplyReviewState: 'COMMENTED',
            existingReplyReviewBody: '',
            secondaryReplyReviewBody: resolutionReviewSummary(pullRequestId, threadId, head),
            existingReplyFullDatabaseIds: ['9223372036854775809', '9223372036854775808'],
        });
        const port: ResolveReviewThreadPort = {
            ...basePort,
            inspect: (number, currentThreadId) => {
                const inspection = basePort.inspect(number, currentThreadId);
                if (inspection.thread === null) {
                    return inspection;
                }
                return {
                    ...inspection,
                    thread: {
                        ...inspection.thread,
                        comments: inspection.thread.comments.map((comment) =>
                            comment.id === replyId
                                ? { ...comment, id: 'PRRC_replacement', fullDatabaseId: '9223372036854775810' }
                                : comment
                        ),
                    },
                };
            },
        };
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'deleteReply',
                epoch: 1,
                replyId: 'PRRC_existing_1',
                immutableEnvelope: immutableEnvelopeSnapshot({ markerFullDatabaseId: '9223372036854775809' }),
            });
            updateLock(repository, 42, ownerOid);
            basePort.deleteReply('PRRC_existing_1');
            calls.length = 0;
            let retainedOwnerOid: string | undefined;

            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) => {
                    retainedOwnerOid = readLockOid(repository, 42);
                    return recoverReviewResolutionLockOwnerState(42, owner, port);
                })
            ).toThrow(/unreconciled in-flight deleteReply mutation/i);
            expect(
                calls.filter((call) =>
                    /^(createReview|reply:|updateReview|delete:|deleteReview|submit|resolve|log:)/.test(call)
                )
            ).toEqual([]);
            expect(retainedOwnerOid).toEqual(expect.any(String));
            expect(readLockOid(repository, 42)).toBe(retainedOwnerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('retains immutable delete recovery when the journaled target identity drifts', () => {
        const repository = createTemporaryGitRepository();
        const { port: basePort, calls } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 2,
            existingReplyReviewState: 'COMMENTED',
            existingReplyReviewBody: '',
            secondaryReplyReviewBody: resolutionReviewSummary(pullRequestId, threadId, head),
            existingReplyFullDatabaseIds: ['9223372036854775809', '9223372036854775808'],
        });
        const port: ResolveReviewThreadPort = {
            ...basePort,
            inspect: (number, currentThreadId) => {
                const inspection = basePort.inspect(number, currentThreadId);
                if (inspection.thread === null) {
                    return inspection;
                }
                return {
                    ...inspection,
                    thread: {
                        ...inspection.thread,
                        comments: inspection.thread.comments.map((comment) =>
                            comment.id === 'PRRC_existing_1'
                                ? { ...comment, fullDatabaseId: '9223372036854775810' }
                                : comment
                        ),
                    },
                };
            },
        };
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'deleteReply',
                epoch: 1,
                replyId: 'PRRC_existing_1',
                immutableEnvelope: immutableEnvelopeSnapshot({ markerFullDatabaseId: '9223372036854775809' }),
                target: immutableEnvelopeSnapshot({
                    markerId: 'PRRC_existing_1',
                    markerFullDatabaseId: '9223372036854775808',
                    reviewId: 'PRR_existing_1',
                    reviewFullDatabaseId: '9223372036854775809',
                    reviewBody: resolutionReviewSummary(pullRequestId, threadId, head),
                }),
            });
            updateLock(repository, 42, ownerOid);
            let retainedOwnerOid: string | undefined;

            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) => {
                    retainedOwnerOid = readLockOid(repository, 42);
                    return recoverReviewResolutionLockOwnerState(42, owner, port);
                })
            ).toThrow(/unreconciled in-flight deleteReply mutation/i);
            expect(
                calls.filter((call) =>
                    /^(createReview|reply:|updateReview|delete:|deleteReview|submit|resolve|log:)/.test(call)
                )
            ).toEqual([]);
            expect(retainedOwnerOid).toEqual(expect.any(String));
            expect(readLockOid(repository, 42)).toBe(retainedOwnerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('retains immutable delete recovery when its terminal survivor becomes shared', () => {
        const repository = createTemporaryGitRepository();
        const { port: basePort, calls } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 2,
            existingReplyReviewState: 'COMMENTED',
            existingReplyReviewBody: '',
            secondaryReplyReviewBody: resolutionReviewSummary(pullRequestId, threadId, head),
            existingReplyFullDatabaseIds: ['9223372036854775809', '9223372036854775808'],
        });
        const port: ResolveReviewThreadPort = {
            ...basePort,
            inspectAttachedReviewThreadIds: (number, reviewId, expectedPullRequestId, expectedHead) => {
                const attached = basePort.inspectAttachedReviewThreadIds(
                    number,
                    reviewId,
                    expectedPullRequestId,
                    expectedHead
                );
                return reviewId === 'PRR_resolution' ? [...attached, otherThreadId] : attached;
            },
        };
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'deleteReply',
                epoch: 1,
                replyId: 'PRRC_existing_1',
                immutableEnvelope: immutableEnvelopeSnapshot({ markerFullDatabaseId: '9223372036854775809' }),
                target: immutableEnvelopeSnapshot({
                    markerId: 'PRRC_existing_1',
                    markerFullDatabaseId: '9223372036854775808',
                    reviewId: 'PRR_existing_1',
                    reviewFullDatabaseId: '9223372036854775809',
                    reviewBody: resolutionReviewSummary(pullRequestId, threadId, head),
                }),
            });
            updateLock(repository, 42, ownerOid);
            basePort.deleteReply('PRRC_existing_1');
            calls.length = 0;
            let retainedOwnerOid: string | undefined;

            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) => {
                    retainedOwnerOid = readLockOid(repository, 42);
                    return recoverReviewResolutionLockOwnerState(42, owner, port);
                })
            ).toThrow(/not attached exclusively/i);
            expect(
                calls.filter((call) =>
                    /^(createReview|reply:|updateReview|delete:|deleteReview|submit|resolve|log:)/.test(call)
                )
            ).toEqual([]);
            expect(retainedOwnerOid).toEqual(expect.any(String));
            expect(readLockOid(repository, 42)).toBe(retainedOwnerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it.each([
        ['becomes unresolved', { isResolved: false, resolvedByNodeId: null, resolvedByType: null }],
        [
            'is resolved by a foreign actor',
            { isResolved: true, resolvedByNodeId: REVIEWER_BOT_NODE_ID, resolvedByType: 'User' },
        ],
    ] as const)('retains immutable delete recovery when the thread %s', (_label, drift) => {
        const repository = createTemporaryGitRepository();
        const { port: basePort, calls } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 2,
            existingReplyReviewState: 'COMMENTED',
            existingReplyReviewBody: '',
            secondaryReplyReviewBody: resolutionReviewSummary(pullRequestId, threadId, head),
            existingReplyFullDatabaseIds: ['9223372036854775809', '9223372036854775808'],
        });
        const port: ResolveReviewThreadPort = {
            ...basePort,
            inspect: (number, currentThreadId) => {
                const inspection = basePort.inspect(number, currentThreadId);
                if (inspection.thread === null) {
                    return inspection;
                }
                return { ...inspection, thread: { ...inspection.thread, ...drift } };
            },
        };
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'deleteReply',
                epoch: 1,
                replyId: 'PRRC_existing_1',
                immutableEnvelope: immutableEnvelopeSnapshot({ markerFullDatabaseId: '9223372036854775809' }),
            });
            updateLock(repository, 42, ownerOid);
            basePort.deleteReply('PRRC_existing_1');
            calls.length = 0;
            let retainedOwnerOid: string | undefined;

            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) => {
                    retainedOwnerOid = readLockOid(repository, 42);
                    return recoverReviewResolutionLockOwnerState(42, owner, port);
                })
            ).toThrow(/unreconciled in-flight deleteReply mutation|not resolved by/i);
            expect(
                calls.filter((call) =>
                    /^(createReview|reply:|updateReview|delete:|deleteReview|submit|resolve|log:)/.test(call)
                )
            ).toEqual([]);
            expect(retainedOwnerOid).toEqual(expect.any(String));
            expect(readLockOid(repository, 42)).toBe(retainedOwnerOid);
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
                const expectedFailure =
                    mutation.phase === 'deleteReply'
                        ? /unreconciled in-flight deleteReply mutation/
                        : /head changed while reconciling review resolution/i;
                expect(() =>
                    recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                        recoverReviewResolutionLockOwnerState(42, owner, port)
                    )
                ).toThrow(expectedFailure);
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
            let failure: Error | undefined;
            try {
                withPullRequestReviewResolutionLock(
                    repository,
                    42,
                    threadId,
                    head,
                    () => {
                        port.replyDone(threadId, reviewId, {
                            id: reviewId,
                            state: 'PENDING',
                            body: resolutionReviewSummary(pullRequestId, threadId, head),
                            commitOid: head,
                            authorNodeId: AUTHOR_BOT_NODE_ID,
                            authorLogin: 'renamed-author[bot]',
                            authorType: 'Bot',
                        });
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
                );
            } catch (error) {
                failure = error as Error;
            }
            expect(statSync(fakeGh.calledPath).isFile()).toBe(true);
            const preservedOid = readLockOid(repository, 42);
            expect(preservedOid).toBeDefined();
            expect(failure?.message).toBe(
                `reply mutation transport lost; review resolution on PR #42 ownership could not be re-read after failure: simulated owner OID reread failure; review resolution on PR #42 preserved exact lock owner ${preservedOid} after replyDone epoch 1; recover with pnpm review:resolve:recover 42 --owner ${preservedOid}`
            );
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

    it.each([
        [
            'createPendingReview',
            (port: ResolveReviewThreadPort) => port.createPendingReview(pullRequestId, head, pendingReviewBody(head)),
            { phase: 'createPendingReview', pullRequestId, body: pendingReviewBody(head), reviewCommitOid: head },
        ],
        [
            'replyDone',
            (port: ResolveReviewThreadPort) =>
                port.replyDone(threadId, reviewId, {
                    id: reviewId,
                    state: 'PENDING',
                    body: pendingReviewBody(head),
                    commitOid: head,
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author',
                    authorType: 'Bot',
                }),
            {
                phase: 'replyDone',
                reviewId,
                reviewState: 'PENDING',
                body: pendingReviewBody(head),
                reviewCommitOid: head,
            },
        ],
        [
            'submitReview',
            (port: ResolveReviewThreadPort) => port.submitReview(reviewId, pendingReviewBody(head), head),
            { phase: 'submitReview', reviewId, body: pendingReviewBody(head), reviewCommitOid: head },
        ],
        [
            'updateReviewBody',
            (port: ResolveReviewThreadPort) =>
                port.updateReviewBody(reviewId, pendingReviewBody(head), head, {
                    id: reviewId,
                    fullDatabaseId: '9001',
                    state: 'PENDING',
                    body: '',
                    commitOid: head,
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author',
                    authorType: 'Bot',
                }),
            {
                phase: 'updateReviewBody',
                reviewId,
                reviewDatabaseId: '9001',
                body: pendingReviewBody(head),
                reviewCommitOid: head,
            },
        ],
        ['resolveThread', (port: ResolveReviewThreadPort) => port.resolve(threadId), { phase: 'resolveThread' }],
        [
            'deleteReply',
            (port: ResolveReviewThreadPort) => port.deleteReply(replyId),
            { phase: 'deleteReply', replyId },
        ],
        [
            'deletePendingReview',
            (port: ResolveReviewThreadPort) =>
                port.deletePendingReview(reviewId, { allowedAttachedThreadIds: [threadId], snapshotHead: head }),
            {
                phase: 'deletePendingReview',
                reviewId,
                allowedAttachedThreadIds: [threadId],
                snapshotHead: head,
            },
        ],
    ] as const)(
        'journals the full %s identity before a shell-backed transport failure and preserves the claimed owner',
        (mutation, operation, expectedMutation) => {
            const repository = createTemporaryGitRepository();
            const fakeGh = createFailingReviewResolutionMutationGhExecutable(mutation);
            try {
                const port = shellPort(
                    {
                        configDir: repository,
                        env: { SOURDAW_TRUSTED_GH_PATH: fakeGh.executable },
                        dispose() {},
                    },
                    repository
                );
                expect(() =>
                    withPullRequestReviewResolutionLock(repository, 42, threadId, head, () => operation(port))
                ).toThrow(/transport lost/);
                expect(statSync(fakeGh.calledPath).isFile()).toBe(true);
                const ownerOid = readLockOid(repository, 42);
                expect(ownerOid).toBeDefined();
                expect(requireLockOwner(repository, 42)).toMatchObject({
                    threadId,
                    head,
                    mutation: { ...expectedMutation, epoch: 1 },
                });
            } finally {
                rmSync(fakeGh.root, { recursive: true, force: true });
                rmSync(repository, { recursive: true, force: true });
            }
        }
    );

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
            let failure: Error | undefined;
            try {
                withPullRequestReviewResolutionLock(repository, 42, threadId, head, () => {
                    try {
                        port.replyDone(threadId, reviewId, {
                            id: reviewId,
                            state: 'PENDING',
                            body: resolutionReviewSummary(pullRequestId, threadId, head),
                            commitOid: head,
                            authorNodeId: AUTHOR_BOT_NODE_ID,
                            authorLogin: 'renamed-author[bot]',
                            authorType: 'Bot',
                        });
                    } catch (error) {
                        const currentOwnerOid = readLockOid(repository, 42);
                        expect(currentOwnerOid).toBeDefined();
                        replacementOwnerOid = writeLockOwnerBlob(repository, 1_000_000);
                        updateLock(repository, 42, replacementOwnerOid, currentOwnerOid);
                        throw error;
                    }
                });
            } catch (error) {
                failure = error as Error;
            }
            expect(replacementOwnerOid).toBeDefined();
            expect(failure?.message).toBe(
                `reply mutation transport lost; review resolution on PR #42 lock ownership changed after replyDone epoch 1; newer lock owner ${replacementOwnerOid} preserved`
            );
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

    it('preserves the claimed PR lock owner when expired reply settlement has no landed evidence', () => {
        const repository = createTemporaryGitRepository();
        const fakeGh = createFailingReviewResolutionMutationGhExecutable('replyDone');
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'replyDoneSettlement',
                epoch: 1,
                reviewId,
                replies: [],
                settleAtMs: 0,
                replayed: false,
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
                inspectPullRequestReview: inspectionPort.port.inspectPullRequestReview,
                inspectAttachedReviewThreadIds: inspectionPort.port.inspectAttachedReviewThreadIds,
                log: inspectionPort.port.log,
            };
            let failure: Error | undefined;
            try {
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    ownerOid,
                    (owner) => recoverReviewResolutionLockOwnerState(42, owner, port),
                    () => false
                );
            } catch (error) {
                failure = error as Error;
            }
            expect(inspectionPort.calls).toEqual(['inspect:1']);
            expect(existsSync(fakeGh.calledPath)).toBe(false);
            const preservedOid = readLockOid(repository, 42);
            expect(preservedOid).toBeDefined();
            expect(preservedOid).not.toBe(ownerOid);
            expect(failure?.message).toContain('unreconciled in-flight replyDone mutation');
            expect(requireLockOwner(repository, 42)).toMatchObject({
                threadId,
                head,
                mutation: { phase: 'replyDoneSettlement', epoch: 1, reviewId },
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
            const { port } = fakePort();
            expect(() =>
                recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, (owner) =>
                    recoverReviewResolutionLockOwnerState(42, owner, port)
                )
            ).toThrow(/refuses an unjournaled legacy v2 lock owner/i);
            expect(readLockOid(repository, 42)).toBeDefined();
            expect(requireLockOwner(repository, 42)).toMatchObject({ version: 2, threadId, head });
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

    it('keeps claimed legacy v2 owners fail closed across consecutive recovery attempts', () => {
        const repository = createTemporaryGitRepository();
        const { port } = fakePort();
        try {
            const originalOid = writeLegacyLockOwnerBlob(repository, 2, 999999, 999999);
            updateLock(repository, 42, originalOid);

            let firstError: Error | undefined;
            try {
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    originalOid,
                    (owner) => recoverReviewResolutionLockOwnerState(42, owner, port),
                    () => false
                );
            } catch (error) {
                firstError = error as Error;
            }
            const firstClaimedOid = readLockOid(repository, 42);
            expect(firstClaimedOid).toBeDefined();
            expect(firstClaimedOid).toBe(originalOid);
            expect(firstError?.message).toBe(
                'review-resolution recovery refuses an unjournaled legacy v2 lock owner without positive landed-mutation proof'
            );
            expect(requireLockOwner(repository, 42)).toMatchObject({ version: 2, threadId, head });

            let secondError: Error | undefined;
            try {
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    firstClaimedOid!,
                    (owner) => recoverReviewResolutionLockOwnerState(42, owner, port),
                    () => false
                );
            } catch (error) {
                secondError = error as Error;
            }
            const secondClaimedOid = readLockOid(repository, 42);
            expect(secondClaimedOid).toBeDefined();
            expect(secondClaimedOid).toBe(originalOid);
            expect(secondError?.message).toBe(firstError?.message);
            expect(requireLockOwner(repository, 42)).toMatchObject({ version: 2, threadId, head });
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('rejects forged or inconsistent legacy-un-journaled v4 lock owners', () => {
        const repository = createTemporaryGitRepository();
        try {
            const malformedOwners = [
                writeLockOwnerBlob(repository, 999999, head, { phase: 'idle', epoch: 0 }, undefined, false),
                writeLockOwnerBlob(
                    repository,
                    999998,
                    head,
                    { phase: 'replyDone', epoch: 1, reviewId },
                    undefined,
                    true
                ),
                gitCapture(
                    repository,
                    ['hash-object', '-w', '--stdin'],
                    JSON.stringify({
                        version: 3,
                        pid: 999997,
                        pgid: 999997,
                        threadId,
                        head,
                        token: '11111111-1111-4111-8111-111111111111',
                        mutation: { phase: 'idle', epoch: 0 },
                        legacyUnjournaled: true,
                    })
                ),
            ];
            for (const ownerOid of malformedOwners) {
                updateLock(repository, 42, ownerOid);
                expect(() =>
                    recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, () => 'reconciled')
                ).toThrow(/lock ownership is malformed/i);
                gitCapture(repository, ['update-ref', '-d', reviewResolutionLockRef(42), ownerOid]);
            }
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('refuses an unjournaled idle legacy v4 owner before it can be upgraded', () => {
        const repository = createTemporaryGitRepository();
        try {
            const ownerOid = gitCapture(
                repository,
                ['hash-object', '-w', '--stdin'],
                JSON.stringify({
                    version: 4,
                    pid: 9_999_999,
                    ownerFence: { kind: 'pgid', pgid: 9_999_999 },
                    threadId,
                    head,
                    token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                    mutation: { phase: 'idle', epoch: 0 },
                    legacyUnjournaled: true,
                })
            );
            updateLock(repository, 42, ownerOid);
            expect(() =>
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    ownerOid,
                    () => 'must not reconcile',
                    () => false
                )
            ).toThrow(/refuses an unjournaled legacy v4 lock owner/i);
            expect(readLockOid(repository, 42)).toBe(ownerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

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
            expect(() => recoverPullRequestReviewResolutionLock(repository, 42, ownerOid, () => 'reconciled')).toThrow(
                /refuses legacy v3 lock owner without a v5 replay receipt/i
            );
            expect(readLockOid(repository, 42)).toBe(ownerOid);
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

    it('fences legacy v4 owners before refusing their non-replayable journal after quiescence', () => {
        const repository = createTemporaryGitRepository();
        try {
            const ownerOid = gitCapture(
                repository,
                ['hash-object', '-w', '--stdin'],
                JSON.stringify({
                    version: 4,
                    pid: 999999,
                    ownerFence: { kind: 'pgid', pgid: 999999 },
                    threadId,
                    head,
                    token: '11111111-1111-4111-8111-111111111111',
                    mutation: { phase: 'replyDone', epoch: 1, reviewId },
                })
            );
            updateLock(repository, 42, ownerOid);
            expect(() =>
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    ownerOid,
                    () => 'reconciled',
                    () => true
                )
            ).toThrow(/still held by live process group/i);
            expect(() =>
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    ownerOid,
                    () => 'reconciled',
                    () => false
                )
            ).toThrow(/refuses legacy v4 lock owner without a v5 replay receipt/i);
            expect(readLockOid(repository, 42)).toBe(ownerOid);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

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

    it('recovers a root-absent or reused Windows root through the journaled recovery path', () => {
        const repository = createTemporaryGitRepository();
        try {
            const ownerFence = {
                kind: 'win32-process-tree' as const,
                version: 1 as const,
                rootPid: 4001,
                rootStartedAt: '2026-08-30T12:00:00.000000+000',
            };
            const ownerOid = writeLockOwnerBlob(
                repository,
                4001,
                head,
                {
                    phase: 'replyDone',
                    epoch: 1,
                    reviewId,
                },
                ownerFence
            );
            updateLock(repository, 42, ownerOid);
            const currentExecutionFence = {
                pid: process.pid,
                ownerFence: {
                    kind: 'win32-process-tree' as const,
                    version: 1 as const,
                    rootPid: process.pid,
                    rootStartedAt: '2026-08-30T12:05:00.000000+000',
                },
            };

            expect(
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    ownerOid,
                    () => 'reconciled',
                    (ownerFence) =>
                        reviewResolutionOwnerFenceIsLive(ownerFence, {
                            inspectWindowsProcessRows: () => [],
                        }),
                    {
                        platform: 'win32',
                        executionFence: currentExecutionFence,
                    }
                )
            ).toBe('reconciled');
            expect(readLockOid(repository, 42)).toBeUndefined();

            const reusedOwnerOid = writeLockOwnerBlob(
                repository,
                4001,
                head,
                { phase: 'replyDone', epoch: 1, reviewId },
                ownerFence
            );
            updateLock(repository, 42, reusedOwnerOid);
            expect(
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    reusedOwnerOid,
                    () => 'reconciled',
                    (ownerFence) =>
                        reviewResolutionOwnerFenceIsLive(ownerFence, {
                            inspectWindowsProcessRows: () => [
                                {
                                    pid: 4001,
                                    parentPid: 1,
                                    startedAt: '2026-08-30T13:00:00.000000+000',
                                },
                            ],
                        }),
                    { platform: 'win32', executionFence: currentExecutionFence }
                )
            ).toBe('reconciled');
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

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
            let failure: Error | undefined;
            try {
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
                );
            } catch (error) {
                failure = error as Error;
            }
            expect(failure?.message).toBe(
                `review resolution on PR #42 lock ownership changed before release; review resolution on PR #42 lock ownership changed after idle epoch 0; newer lock owner ${replacementOwnerOid} preserved`
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
                        updateRefsTransaction: (primaryRoot) => {
                            updateLock(primaryRoot, 42, replacementOwnerOid, ownerOid);
                            return false;
                        },
                    }
                )
            ).toThrow(
                `review resolution on PR #42 lock ownership changed before recovery; current lock owner ${replacementOwnerOid}; recover with pnpm review:resolve:recover 42 --owner ${replacementOwnerOid}`
            );
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

    it('reports the canonical current owner when recovery is invoked with a stale owner OID', () => {
        const repository = createTemporaryGitRepository();
        try {
            const staleOwnerOid = writeLockOwnerBlob(repository, 999999);
            const currentOwnerOid = writeLockOwnerBlob(repository, 1_000_000);
            updateLock(repository, 42, currentOwnerOid);

            expect(() =>
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    staleOwnerOid,
                    () => 'must not reconcile',
                    () => false
                )
            ).toThrow(
                `review resolution on PR #42 lock ownership changed before recovery; current lock owner ${currentOwnerOid}; recover with pnpm review:resolve:recover 42 --owner ${currentOwnerOid}`
            );
            expect(readLockOid(repository, 42)).toBe(currentOwnerOid);
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

    it('routes an exact paired v6 owner through CLI recovery and emits the canonical summary', async () => {
        const repository = createTemporaryGitRepository();
        try {
            const sharedOwnerOid = writeSharedMutationLockOwnerBlob(repository, 999999);
            const ownerOid = writeLockOwnerBlob(
                repository,
                999999,
                head,
                { phase: 'idle', epoch: 0 },
                undefined,
                undefined,
                sharedOwnerOid
            );
            updateSharedMutationLock(repository, 42, sharedOwnerOid);
            updateLock(repository, 42, ownerOid);
            const session: GhSession = { configDir: repository, env: {}, dispose() {} };
            const { port } = fakePort();
            const dependencies = {
                trustedPrimaryRoot: () => repository,
                authenticateAuthor: async () => ({ minted: { actorNodeId: AUTHOR_BOT_NODE_ID }, session }),
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
                    runRecoverReviewResolutionLockCli(['42', '--owner', ownerOid], dependencies)
                ).resolves.toBe(0);
            } finally {
                console.log = originalLog;
            }
            expect(logs).toEqual([`review-resolution-lock-recovered:42:${threadId}:${head}:${head}:unresolved:0`]);
            expect(readLockOid(repository, 42)).toBeUndefined();
            expect(readSharedMutationLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('reports a canonical resolved recovery summary with the exact pending-review count', async () => {
        const repository = createTemporaryGitRepository();
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, { phase: 'idle', epoch: 0 });
            updateLock(repository, 42, ownerOid);
            const session: GhSession = { configDir: repository, env: {}, dispose() {} };
            const { port } = fakePort({
                isResolved: true,
                initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
                initialResolvedByType: 'User',
                existingPendingReviewCount: 2,
            });
            const dependencies = {
                trustedPrimaryRoot: () => repository,
                authenticateAuthor: async () => ({ minted: { actorNodeId: AUTHOR_BOT_NODE_ID }, session }),
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
                    runRecoverReviewResolutionLockCli(['42', '--owner', ownerOid], dependencies)
                ).resolves.toBe(0);
            } finally {
                console.log = originalLog;
            }
            expect(logs).toEqual([`review-resolution-lock-recovered:42:${threadId}:${head}:${head}:resolved:2`]);
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
            const { port, calls } = fakePort();
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
                ).rejects.toThrow(/unreconciled in-flight createPendingReview mutation/);
            } finally {
                console.log = originalLog;
            }
            expect(logs).toEqual([]);
            expect(calls.filter((call) => call.startsWith('createReview:'))).toEqual([]);
            expect(readLockOid(repository, 42)).toBeDefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('preserves the claimed owner when expired create settlement has no landed evidence', async () => {
        const repository = createTemporaryGitRepository();
        const fakeGh = createFailingReviewResolutionMutationGhExecutable('createPendingReview');
        try {
            const ownerOid = writeLockOwnerBlob(repository, 999999, head, {
                phase: 'createPendingReviewSettlement',
                epoch: 1,
                pendingReviewIds: [],
                settleAtMs: 0,
                replayed: false,
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
            const port: ResolveReviewThreadPort = {
                ...mutationPort,
                inspect: () => {
                    inspectionCount += 1;
                    calls.push(`inspect:${inspectionCount}`);
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
                        pendingReviews: [],
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
                ).rejects.toThrow(/unreconciled in-flight createPendingReview mutation/i);
                expect(logs).toEqual([]);
                expect(calls).toEqual(['inspect:1']);
            } finally {
                console.log = originalLog;
            }
            expect(logs).toEqual([]);
            expect(existsSync(fakeGh.calledPath)).toBe(false);
            const preservedOwnerOid = readLockOid(repository, 42);
            expect(preservedOwnerOid).toBeDefined();
            expect(preservedOwnerOid).not.toBe(ownerOid);
            expect(requireLockOwner(repository, 42)).toMatchObject({
                threadId,
                head,
                mutation: {
                    phase: 'createPendingReviewSettlement',
                    epoch: 1,
                },
            });
        } finally {
            rmSync(fakeGh.root, { recursive: true, force: true });
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('continues after acquisition without re-reading the owner blob', () => {
        const repository = createTemporaryGitRepository();
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-review-resolution-no-owner-reread-'));
        const git = join(root, 'git');
        const catFileMarker = join(root, 'cat-file-entered');
        try {
            writeFileSync(
                git,
                `#!/bin/sh\nif [ "$1" = cat-file ]; then\nprintf entered > ${JSON.stringify(catFileMarker)}\nexit 91\nfi\nexec ${JSON.stringify(systemGitPath())} "$@"\n`,
                { mode: 0o700 }
            );
            chmodSync(git, 0o700);
            withTemporaryEnvironment({ SOURDAW_TRUSTED_GIT_PATH: git }, () => {
                expect(withPullRequestReviewResolutionLock(repository, 42, threadId, head, () => 'complete')).toBe(
                    'complete'
                );
            });
            expect(existsSync(catFileMarker)).toBe(false);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(root, { recursive: true, force: true });
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

    it('accepts a Windows detached child marker with trusted powershell and no ps path', async () => {
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
                        powershellPath: trustedPowerShellPath,
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
                            kind: 'win32-process-tree',
                            version: 1,
                            rootPid: process.pid,
                            rootStartedAt: '2026-08-30T12:00:00.000000+000',
                        },
                    },
                    sleep: async () => undefined,
                })
            ).resolves.toEqual({
                primaryRoot: markerRoot,
                gitPath: trustedGitPath,
                ghPath: trustedGhPath,
                powershellPath: trustedPowerShellPath,
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

    it('rejects a malformed recover child marker before lock recovery can mutate the owner', async () => {
        const repository = createTemporaryGitRepository();
        const snapshotRoot = mkdtempSync(join(tmpdir(), 'sourdaw-review-recover-forged-marker-'));
        const entryPath = writeRecoverReviewResolutionSnapshot(snapshotRoot);
        const ownerOid = writeLockOwnerBlob(repository, 9_999_999);
        updateLock(repository, 42, ownerOid);
        const child = spawn(process.execPath, [entryPath, '42', '--owner', ownerOid], {
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
            await waitForExit(child);
            expect(child.exitCode).toBe(1);
            expect(stderr).toMatch(/detached launcher marker is invalid/i);
            expect(readLockOid(repository, 42)).toBe(ownerOid);
        } finally {
            child.kill('SIGKILL');
            await waitForExit(child).catch(() => undefined);
            rmSync(snapshotRoot, { recursive: true, force: true });
            rmSync(repository, { recursive: true, force: true });
        }
    }, 10_000);

    it('rejects a wrong-PID recover child marker before lock recovery can reconcile', async () => {
        const repository = createTemporaryGitRepository();
        const snapshotRoot = mkdtempSync(join(tmpdir(), 'sourdaw-review-recover-wrong-pid-marker-'));
        const markerRoot = mkdtempSync(join(tmpdir(), 'sourdaw-review-recover-wrong-pid-marker-file-'));
        const entryPath = writeRecoverReviewResolutionSnapshot(snapshotRoot);
        const ownerOid = writeLockOwnerBlob(repository, 9_999_999);
        const markerPath = join(markerRoot, 'child-marker.json');
        const capabilityPath = join(markerRoot, 'bootstrap-capability.json');
        const token = '11111111-1111-4111-8111-111111111111';
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
        publishReviewResolutionChildLaunchMarker(markerPath, token, 999999, capabilityPath);
        const child = spawn(process.execPath, [entryPath, '42', '--owner', ownerOid], {
            cwd: repository,
            env: {
                ...process.env,
                SOURDAW_TEST_PRIMARY_ROOT: repository,
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
            await waitForExit(child);
            expect(child.exitCode).toBe(1);
            expect(stderr).toMatch(/detached launcher marker is invalid/i);
            expect(readLockOid(repository, 42)).toBe(ownerOid);
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
            expect(owner.ownerFence).toMatchObject({
                kind: 'pgid',
                pgid: owner.pid,
                leaderStartedAt: expect.any(String),
            });
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
            expect(claimed.owner.ownerFence).toMatchObject({
                kind: 'pgid',
                pgid: claimed.owner.pid,
                leaderStartedAt: expect.any(String),
            });
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
            expect(stderr).toMatch(/lock ownership changed before mutation/i);
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
                `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${head}`,
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
            const { port, calls } = fakePort({ existingPendingReviewCount: 1 });
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
                ).rejects.toThrow(/unreconciled in-flight replyDone mutation/);
            } finally {
                console.log = originalLog;
            }
            expect(logs).toEqual([]);
            expect(calls.filter((call) => call.startsWith('reply:'))).toEqual([]);
            expect(readLockOid(repository, 42)).toBeDefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it.each([
        [
            'same-head create',
            {
                phase: 'createPendingReview' as const,
                epoch: 1,
                pullRequestId,
                body: pendingReviewBody(head),
                reviewCommitOid: head,
            },
            head,
        ],
        [
            'H1-to-H2 create',
            {
                phase: 'createPendingReview' as const,
                epoch: 1,
                pullRequestId,
                body: pendingReviewBody(head),
                reviewCommitOid: head,
            },
            movedHead,
        ],
        [
            'same-head reply',
            {
                phase: 'replyDone' as const,
                epoch: 1,
                reviewId,
                reviewState: 'PENDING' as const,
                body: pendingReviewBody(head),
                reviewCommitOid: head,
            },
            head,
        ],
        [
            'H1-to-H2 reply',
            {
                phase: 'replyDone' as const,
                epoch: 1,
                reviewId,
                reviewState: 'PENDING' as const,
                body: pendingReviewBody(head),
                reviewCommitOid: head,
            },
            movedHead,
        ],
    ] as const)(
        'persists settlement for an unlanded %s base mutation through the CLI',
        async (_kind, mutation, observedHead) => {
            const repository = createTemporaryGitRepository();
            try {
                const ownerOid = writeLockOwnerBlob(repository, 9_999_999, head, mutation);
                updateLock(repository, 42, ownerOid);
                const session: GhSession = { configDir: repository, env: {}, dispose() {} };
                const { port, calls } = fakePort({ heads: [observedHead] });
                const recoverDependencies = {
                    trustedPrimaryRoot: () => repository,
                    authenticateAuthor: async () => ({ minted: { actorNodeId: AUTHOR_BOT_NODE_ID }, session }),
                    repositoryName: () => REQUIRED_REPOSITORY,
                    gh: () => () => '',
                    createPort: () => port,
                    recoverLock: (primaryRoot, number, owner, reconcile) =>
                        recoverPullRequestReviewResolutionLock(primaryRoot, number, owner, reconcile, () => false),
                } satisfies Parameters<typeof runRecoverReviewResolutionLockCli>[1];
                const logs: string[] = [];
                const originalLog = console.log;
                console.log = (message?: unknown) => logs.push(String(message));
                try {
                    await expect(
                        runRecoverReviewResolutionLockCli(['42', '--owner', ownerOid], recoverDependencies)
                    ).rejects.toThrow(/unreconciled in-flight/);
                } finally {
                    console.log = originalLog;
                }
                expect(logs).toEqual([]);
                expect(calls).toEqual(['inspect:1']);
                expect(readLockOid(repository, 42)).toBeDefined();
                let expectedPhase:
                    'createPendingReview' | 'replyDone' | 'createPendingReviewSettlement' | 'replyDoneSettlement' =
                    mutation.phase;
                if (observedHead === head) {
                    expectedPhase =
                        mutation.phase === 'createPendingReview'
                            ? 'createPendingReviewSettlement'
                            : 'replyDoneSettlement';
                }
                expect(requireLockOwner(repository, 42).mutation.phase).toBe(expectedPhase);
            } finally {
                rmSync(repository, { recursive: true, force: true });
            }
        }
    );

    it('holds the per-PR mutation fence across authentication and a remote resolution attempt', async () => {
        expect(defaultResolveReviewThreadCoordinatorDependencies().serializeMutation).toBe(withPullRequestMutationLock);
        const { port } = fakePort();
        const calls: string[] = [];
        let lockOptions: { reviewResolution?: { threadId: string; head: string } } | undefined;
        const dependencies: ResolveReviewThreadCoordinatorDependencies = {
            primaryRoot: () => '/repo',
            serializeMutation: async (_primaryRoot, number, operation, options) => {
                calls.push(`lock:${number}:acquire`);
                lockOptions = options;
                try {
                    return await operation({
                        ownerOid: 'f'.repeat(40),
                        markRemoteMutationAttempt: () => calls.push('attempt'),
                        registerSuccessfulCompletion: () => undefined,
                    });
                } finally {
                    calls.push(`lock:${number}:release`);
                }
            },
            authenticateAuthor: async () => {
                calls.push('authenticate');
                return {
                    minted: { actorNodeId: AUTHOR_BOT_NODE_ID },
                    session: {
                        configDir: '/tmp/sourdaw-author',
                        env: {},
                        dispose: () => calls.push('dispose'),
                    },
                };
            },
            repositoryName: () => {
                calls.push('repository');
                return 'jcosta33/sourdaw';
            },
            threadPort: (_session, _primaryRoot, markRemoteMutationAttempt, sharedMutationOwnerOid) => {
                calls.push(`port:${sharedMutationOwnerOid}`);
                return {
                    ...port,
                    resolve: (id) => {
                        markRemoteMutationAttempt();
                        calls.push('remote');
                        return port.resolve(id);
                    },
                };
            },
            resolve: (number, exactThreadId, expectedHead, _authorNodeId, threadPort) => {
                calls.push(`resolve:${number}:${exactThreadId}:${expectedHead}`);
                threadPort.resolve(exactThreadId);
                return 'resolved';
            },
        };

        await coordinateResolveReviewThread(42, threadId, head, dependencies);

        expect(lockOptions).toMatchObject({ reviewResolution: { threadId, head, ownerFence: expect.any(Function) } });
        expect(calls).toEqual([
            'lock:42:acquire',
            'authenticate',
            'repository',
            `port:${'f'.repeat(40)}`,
            `resolve:42:${threadId}:${head}`,
            'attempt',
            'remote',
            'dispose',
            'lock:42:release',
        ]);
    });

    it('retains both locks when author-session disposal fails after the inner resolution succeeds', async () => {
        const repository = createTemporaryGitRepository();
        try {
            const dependencies: ResolveReviewThreadCoordinatorDependencies = {
                primaryRoot: () => repository,
                serializeMutation: (primaryRoot, number, operation, options) =>
                    withPullRequestMutationLock(primaryRoot, number, operation, {
                        ...options,
                        reviewResolution:
                            options?.reviewResolution === undefined
                                ? undefined
                                : { ...options.reviewResolution, ownerFence: { kind: 'pid', pid: process.pid } },
                    }),
                authenticateAuthor: async () => ({
                    minted: { actorNodeId: AUTHOR_BOT_NODE_ID },
                    session: {
                        configDir: repository,
                        env: {},
                        dispose: () => {
                            throw new Error('author session disposal failed');
                        },
                    },
                }),
                repositoryName: () => REQUIRED_REPOSITORY,
                threadPort: (
                    session,
                    primaryRoot,
                    markRemoteMutationAttempt,
                    sharedMutationOwnerOid,
                    registerSuccessfulCompletion
                ) => {
                    const port = shellPort(
                        session,
                        primaryRoot,
                        markRemoteMutationAttempt,
                        undefined,
                        sharedMutationOwnerOid,
                        registerSuccessfulCompletion
                    );
                    return {
                        ...port,
                        serializeReviewThreadMutation: (number, exactThreadId, expectedHead, operation) =>
                            withPullRequestReviewResolutionLock(
                                primaryRoot,
                                number,
                                exactThreadId,
                                expectedHead,
                                operation,
                                {
                                    executionFence: {
                                        pid: process.pid,
                                        ownerFence: { kind: 'pgid', pgid: process.pid, leaderStartedAt: '1' },
                                    },
                                    sharedMutationOwnerOid,
                                    registerSuccessfulCompletion,
                                }
                            ),
                    };
                },
                resolve: (number, exactThreadId, expectedHead, _authorNodeId, port) =>
                    port.serializeReviewThreadMutation(number, exactThreadId, expectedHead, () => 'inner-complete'),
            };

            await expect(coordinateResolveReviewThread(42, threadId, head, dependencies)).rejects.toThrow(
                'author session disposal failed'
            );
            const ownerOid = readLockOid(repository, 42);
            const sharedOwnerOid = readSharedMutationLockOid(repository, 42);
            expect(ownerOid).toBeDefined();
            expect(sharedOwnerOid).toBeDefined();
            expect(requireLockOwner(repository, 42)).toMatchObject({
                version: 6,
                sharedMutationOwnerOid: sharedOwnerOid,
            });

            expect(
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    ownerOid!,
                    () => 'recovered',
                    () => false
                )
            ).toBe('recovered');
            expect(readLockOid(repository, 42)).toBeUndefined();
            expect(readSharedMutationLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('forwards exact parsed pull-request, thread, and head arguments to the live coordinator', async () => {
        const { port } = fakePort();
        let forwarded: { number: number; threadId: string; expectedHead: string } | undefined;
        const dependencies: ResolveReviewThreadCoordinatorDependencies = {
            primaryRoot: () => '/repo',
            serializeMutation: async (_primaryRoot, _number, operation) =>
                operation({
                    ownerOid: 'f'.repeat(40),
                    markRemoteMutationAttempt: () => undefined,
                    registerSuccessfulCompletion: () => undefined,
                }),
            authenticateAuthor: async () => ({
                minted: { actorNodeId: AUTHOR_BOT_NODE_ID },
                session: { configDir: '/tmp/sourdaw-author', env: {}, dispose: () => undefined },
            }),
            repositoryName: () => 'jcosta33/sourdaw',
            threadPort: () => port,
            resolve: (number, exactThreadId, expectedHead) => {
                forwarded = { number, threadId: exactThreadId, expectedHead };
                return 'resolved';
            },
        };

        const requestedThreadId = 'PRRT_cli_forwarding_distinct';
        const requestedHead = 'c'.repeat(40);
        const parsed = parseResolveReviewThreadArgs(['7819', '--thread', requestedThreadId, '--head', requestedHead]);
        expect(parsed).toEqual({ number: 7819, threadId: requestedThreadId, head: requestedHead, help: false });
        if (parsed.number === undefined || parsed.threadId === undefined || parsed.head === undefined) {
            throw new Error('valid resolution arguments were not parsed');
        }
        await coordinateResolveReviewThread(parsed.number, parsed.threadId, parsed.head, dependencies);

        expect(forwarded).toEqual({ number: 7819, threadId: requestedThreadId, expectedHead: requestedHead });
    });

    it.each<[string, (port: ResolveReviewThreadPort) => void]>([
        [
            'Done reply',
            (port) => {
                port.replyDone(threadId, reviewId, {
                    id: reviewId,
                    state: 'PENDING',
                    body: pendingReviewBody(head),
                    commitOid: head,
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: null,
                    authorType: 'Bot',
                });
            },
        ],
        ['thread resolution', (port) => port.resolve(threadId)],
        ['compensation delete', (port) => port.deleteReply(replyId)],
    ])('retains the exact shared owner when the production %s result is indeterminate', async (label, mutate) => {
        const primaryRoot = mkdtempSync(join(tmpdir(), 'sourdaw-resolve-lock-'));
        runGit(primaryRoot, ['init', '-b', 'main']);
        const number = 7820;
        const ref = `refs/sourdaw/delivery/pr-${number}`;
        let dispatched = 0;
        let reacquired = false;

        try {
            await expect(
                withPullRequestMutationLock(primaryRoot, number, async ({ markRemoteMutationAttempt }) => {
                    const port = shellPort(
                        { configDir: '/tmp/sourdaw-author', env: {}, dispose: () => undefined },
                        primaryRoot,
                        markRemoteMutationAttempt,
                        (command, args) => {
                            if (command === 'git' && args[0] === 'rev-parse') {
                                return `${primaryRoot}/.git`;
                            }
                            if (command === 'gh' && args[0] === 'api') {
                                dispatched += 1;
                                throw new Error(`${label} result is indeterminate`);
                            }
                            throw new Error(`unexpected command in test: ${command} ${args.join(' ')}`);
                        }
                    );
                    withPullRequestReviewResolutionLock(primaryRoot, number, threadId, head, () => mutate(port));
                })
            ).rejects.toThrow(`${label} result is indeterminate`);
            expect(dispatched).toBe(1);
            const retainedOwnerOid = runGit(primaryRoot, ['show-ref', '--verify', '--hash', ref]);

            await expect(
                withPullRequestMutationLock(primaryRoot, number, async () => {
                    reacquired = true;
                })
            ).rejects.toThrow(/already being delivered/);
            expect(reacquired).toBe(false);
            expect(runGit(primaryRoot, ['show-ref', '--verify', '--hash', ref])).toBe(retainedOwnerOid);
        } finally {
            rmSync(primaryRoot, { recursive: true, force: true });
        }
    });

    it('uses supported review-envelope, reply, and deletion mutation routes', () => {
        const source = readFileSync(join(import.meta.dirname, '../resolveReviewThread.ts'), 'utf8');
        expect(source).toContain('pullRequestReviewThreadId:$threadId');
        expect(source).toContain('pullRequestReviewId:$reviewId');
        expect(source).toContain(
            'addPullRequestReview(input:{pullRequestId:$pullRequestId,body:$body,commitOID:$commitOid'
        );
        expect(source).toContain(
            'submitPullRequestReview(input:{pullRequestReviewId:$reviewId,event:COMMENT,body:$body'
        );
        expect(source).toContain('`repos/${REQUIRED_REPOSITORY}/pulls/${number}/reviews/${review.fullDatabaseId}`');
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
        [
            'missing author',
            {
                data: {
                    deletePullRequestReviewComment: {
                        clientMutationId: replyId,
                        pullRequestReviewComment: { id: replyId, body: 'Done', author: null },
                    },
                },
            },
        ],
        [
            'missing author ID',
            {
                data: {
                    deletePullRequestReviewComment: {
                        clientMutationId: replyId,
                        pullRequestReviewComment: {
                            id: replyId,
                            body: 'Done',
                            author: { id: null, login: 'renamed-author', __typename: 'Bot' },
                        },
                    },
                },
            },
        ],
        [
            'missing author type',
            {
                data: {
                    deletePullRequestReviewComment: {
                        clientMutationId: replyId,
                        pullRequestReviewComment: {
                            id: replyId,
                            body: 'Done',
                            author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: null },
                        },
                    },
                },
            },
        ],
    ])('rejects a %s delete-reply receipt', (_case, response) => {
        expect(() => deleteReply(replyId, () => JSON.stringify(response))).toThrow(
            /delete review reply returned an invalid result/i
        );
    });
    it('sends the complete delete-reply mutation and accepts its exact receipt', () => {
        const ghCalls: string[][] = [];
        deleteReply(replyId, (args) => {
            ghCalls.push(args);
            return JSON.stringify({
                data: {
                    deletePullRequestReviewComment: {
                        clientMutationId: replyId,
                        pullRequestReviewComment: {
                            id: replyId,
                            body: 'Done',
                            author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
                        },
                    },
                },
            });
        });
        expect(ghCalls).toEqual([
            expect.arrayContaining([
                'api',
                'graphql',
                expect.stringContaining(
                    'deletePullRequestReviewComment(input:{id:$replyId,clientMutationId:$clientMutationId}){clientMutationId pullRequestReviewComment{id body author{login __typename ... on Bot{id}}}}'
                ),
                `replyId=${replyId}`,
                `clientMutationId=${replyId}`,
            ]),
        ]);
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
        expect(ghCalls[0]).toContain(
            'query=mutation($reviewId:ID!,$clientMutationId:String!){deletePullRequestReview(input:{pullRequestReviewId:$reviewId,clientMutationId:$clientMutationId}){clientMutationId pullRequestReview{id state body commit{oid} author{login __typename ... on Bot{id}}}}}'
        );
    });
    it('updates an empty submitted review through the review REST endpoint without truncating its decimal identity', () => {
        const ghCalls: string[][] = [];
        const body = resolutionReviewSummary(pullRequestId, threadId, head);
        const receipt = updateReviewBody(
            42,
            {
                id: reviewId,
                fullDatabaseId: '9223372036854775807',
                body: '',
                state: 'COMMENTED',
                commitOid: head,
                authorNodeId: AUTHOR_BOT_NODE_ID,
                authorLogin: 'renamed-author',
                authorType: 'Bot',
            },
            body,
            (args) => {
                ghCalls.push(args);
                return `{"id":9223372036854775807,"node_id":${JSON.stringify(reviewId)},"body":${JSON.stringify(body)},"state":"COMMENTED","commit_id":${JSON.stringify(head)},"user":{"node_id":${JSON.stringify(AUTHOR_BOT_NODE_ID)},"login":"renamed-author","type":"Bot"}}`;
            }
        );
        expect(receipt).toMatchObject({
            id: reviewId,
            body,
            state: 'COMMENTED',
            commitOid: head,
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorType: 'Bot',
        });
        expect(ghCalls).toEqual([
            [
                'api',
                '--method',
                'PUT',
                `repos/${REQUIRED_REPOSITORY}/pulls/42/reviews/9223372036854775807`,
                '-f',
                `body=${body}`,
            ],
        ]);
    });
    it('accepts an exact decimal REST review ID after valid response properties are reordered', () => {
        const body = resolutionReviewSummary(pullRequestId, threadId, head);
        expect(
            updateReviewBody(
                42,
                {
                    id: reviewId,
                    fullDatabaseId: '9223372036854775807',
                    body: '',
                    state: 'COMMENTED',
                    commitOid: head,
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author',
                    authorType: 'Bot',
                },
                body,
                () =>
                    `{"node_id":${JSON.stringify(reviewId)},"body":${JSON.stringify(body)},"state":"COMMENTED","commit_id":${JSON.stringify(head)},"user":{"id":9001,"node_id":${JSON.stringify(AUTHOR_BOT_NODE_ID)},"login":"renamed-author","type":"Bot"},"id":9223372036854775807}`
            )
        ).toMatchObject({ id: reviewId, fullDatabaseId: '9223372036854775807', body });
    });
    it.each([
        [
            'only a nested decimal ID',
            `{"node_id":${JSON.stringify(reviewId)},"body":"body","state":"COMMENTED","commit_id":${JSON.stringify(head)},"user":{"id":9223372036854775807,"node_id":${JSON.stringify(AUTHOR_BOT_NODE_ID)},"type":"Bot"}}`,
        ],
        [
            'duplicate top-level decimal IDs',
            `{"id":9223372036854775807,"node_id":${JSON.stringify(reviewId)},"body":"body","state":"COMMENTED","commit_id":${JSON.stringify(head)},"user":{"node_id":${JSON.stringify(AUTHOR_BOT_NODE_ID)},"type":"Bot"},"id":9223372036854775807}`,
        ],
    ])('rejects a REST update receipt with %s', (_label, response) => {
        expect(() =>
            updateReviewBody(
                42,
                {
                    id: reviewId,
                    fullDatabaseId: '9223372036854775807',
                    body: '',
                    state: 'COMMENTED',
                    commitOid: head,
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author',
                    authorType: 'Bot',
                },
                'body',
                () => response
            )
        ).toThrow(/update review body returned an invalid result/i);
    });
    it('refuses a submitted review without a decimal database identity before the REST update', () => {
        const ghCalls: string[][] = [];
        expect(() =>
            updateReviewBody(
                42,
                {
                    id: reviewId,
                    fullDatabaseId: null,
                    body: '',
                    state: 'COMMENTED',
                    commitOid: head,
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author',
                    authorType: 'Bot',
                },
                resolutionReviewSummary(pullRequestId, threadId, head),
                (args) => {
                    ghCalls.push(args);
                    return 'unexpected';
                }
            )
        ).toThrow(/no immutable decimal review identity/i);
        expect(ghCalls).toEqual([]);
    });
    it('refuses a shell-backed selected update without journaling or calling GitHub', () => {
        const repository = createTemporaryGitRepository();
        const fakeGh = createFailingReviewResolutionMutationGhExecutable('updateReviewBody');
        try {
            const port = shellPort(
                { configDir: repository, env: { SOURDAW_TRUSTED_GH_PATH: fakeGh.executable }, dispose() {} },
                repository
            );
            expect(() =>
                withPullRequestReviewResolutionLock(repository, 42, threadId, head, () =>
                    port.updateReviewBody(reviewId, resolutionReviewSummary(pullRequestId, threadId, head), head, {
                        id: reviewId,
                        fullDatabaseId: null,
                        state: 'COMMENTED',
                        body: '',
                        commitOid: head,
                        authorNodeId: AUTHOR_BOT_NODE_ID,
                        authorLogin: 'renamed-author',
                        authorType: 'Bot',
                    })
                )
            ).toThrow(/no immutable decimal review identity/i);
            expect(existsSync(fakeGh.calledPath)).toBe(false);
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(fakeGh.root, { recursive: true, force: true });
            rmSync(repository, { recursive: true, force: true });
        }
    });
    it.each([
        ['wrong decimal review ID', { id: 9002 }],
        ['wrong review node ID', { node_id: 'PRR_foreign' }],
        ['foreign actor', { user: { node_id: REVIEWER_BOT_NODE_ID, login: 'renamed-reviewer', type: 'Bot' } }],
    ])('rejects a %s REST update receipt', (_label, override) => {
        const body = resolutionReviewSummary(pullRequestId, threadId, head);
        expect(() =>
            updateReviewBody(
                42,
                {
                    id: reviewId,
                    fullDatabaseId: '9001',
                    body: '',
                    state: 'COMMENTED',
                    commitOid: head,
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author',
                    authorType: 'Bot',
                },
                body,
                () =>
                    JSON.stringify({
                        id: 9001,
                        node_id: reviewId,
                        body,
                        state: 'COMMENTED',
                        commit_id: head,
                        user: { node_id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', type: 'Bot' },
                        ...override,
                    })
            )
        ).toThrow(/update review body returned an invalid result/i);
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
            'non-Bot author type',
            {
                data: {
                    deletePullRequestReview: {
                        clientMutationId: reviewId,
                        pullRequestReview: {
                            id: reviewId,
                            state: 'PENDING',
                            body: pendingReviewBody(head),
                            commit: { oid: head },
                            author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'User' },
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
        [
            'missing author',
            {
                data: {
                    deletePullRequestReview: {
                        clientMutationId: reviewId,
                        pullRequestReview: {
                            id: reviewId,
                            state: 'PENDING',
                            body: pendingReviewBody(head),
                            commit: { oid: head },
                            author: null,
                        },
                    },
                },
            },
        ],
        [
            'missing author type',
            {
                data: {
                    deletePullRequestReview: {
                        clientMutationId: reviewId,
                        pullRequestReview: {
                            id: reviewId,
                            state: 'PENDING',
                            body: pendingReviewBody(head),
                            commit: { oid: head },
                            author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: null },
                        },
                    },
                },
            },
        ],
        [
            'missing author ID',
            {
                data: {
                    deletePullRequestReview: {
                        clientMutationId: reviewId,
                        pullRequestReview: {
                            id: reviewId,
                            state: 'PENDING',
                            body: pendingReviewBody(head),
                            commit: { oid: head },
                            author: { id: null, login: 'renamed-author', __typename: 'Bot' },
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
        const sha256OwnerOid = 'b'.repeat(64);
        expect(parseResolveReviewThreadArgs(['--help'])).toEqual({ help: true });
        expect(parseRecoverReviewResolutionLockArgs(['--help'])).toEqual({ help: true, retireUnseen: false });
        expect(parseRecoverReviewResolutionLockArgs(['42', '--owner', ownerOid])).toMatchObject({
            number: 42,
            owner: ownerOid,
        });
        expect(parseRecoverReviewResolutionLockArgs(['42', '--owner', ownerOid.toUpperCase()])).toMatchObject({
            number: 42,
            owner: ownerOid,
        });
        expect(parseRecoverReviewResolutionLockArgs(['42', '--owner', sha256OwnerOid.toUpperCase()])).toMatchObject({
            number: 42,
            owner: sha256OwnerOid,
        });
        expect(parseRecoverReviewResolutionLockArgs(['42', '--owner', ownerOid, '--retire-unseen'])).toMatchObject({
            number: 42,
            owner: ownerOid,
            retireUnseen: true,
        });
        for (const args of [[], ['42', '--thread', threadId, '--owner', ownerOid], ['42', '--owner', 'bad']]) {
            expect(() => parseRecoverReviewResolutionLockArgs(args)).toThrow(/usage/i);
        }
        await expect(runRecoverReviewResolutionLockCli(['42', '--owner', ownerOid])).rejects.toThrow(
            /protected primary checkout launcher/i
        );
        await expect(
            runRecoverReviewResolutionLockCli(['42', '--owner', sha256OwnerOid], {
                trustedPrimaryRoot: () => {
                    throw new Error('64-hex owner reached recovery bootstrap');
                },
            })
        ).rejects.toThrow(/64-hex owner reached recovery bootstrap/);
    });

    it('recovers an exact owner from a real SHA-256 Git repository', () => {
        const repository = createTemporaryGitRepository('sha256');
        try {
            const ownerOid = writeLockOwnerBlob(repository, 9_999_999);
            expect(ownerOid).toMatch(/^[0-9a-f]{64}$/);
            updateLock(repository, 42, ownerOid);
            expect(
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    ownerOid,
                    () => 'recovered',
                    () => false
                )
            ).toBe('recovered');
            expect(readLockOid(repository, 42)).toBeUndefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
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
        ['relative', 'powershell.exe'],
        [
            'non-normalized',
            `${dirname(trustedPowerShellPath)}/../${basename(dirname(trustedPowerShellPath))}/${basename(trustedPowerShellPath)}`,
        ],
    ])(
        'rejects a Windows detached launcher capability carrying a %s powershell path before lock acquisition',
        async (_label, powershellPath) => {
            const markerRoot = mkdtempSync(join(tmpdir(), 'sourdaw-review-resolve-invalid-powershell-marker-'));
            const markerPath = join(markerRoot, 'child-marker.json');
            const capabilityPath = join(markerRoot, 'bootstrap-capability.json');
            const token = '99999999-1111-4111-8111-111111111111';
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
                            powershellPath,
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
                                kind: 'win32-process-tree',
                                version: 1,
                                rootPid: process.pid,
                                rootStartedAt: '2026-08-30T12:00:00.000000+000',
                            },
                        },
                        sleep: async () => undefined,
                    })
                ).rejects.toThrow(/protected primary checkout launcher/i);
                expect(existsSync(markerPath)).toBe(true);
            } finally {
                rmSync(markerRoot, { recursive: true, force: true });
            }
        }
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
            `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${head}`,
            `reply:${threadId}:${reviewId}`,
            'inspect:3',
            `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${head}`,
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
    it.each([
        ['missing actor ID', { replyAuthorNodeId: null }],
        ['missing actor type', { replyAuthorType: null }],
    ])('rejects a reply receipt with %s before submit resolve delete or log', (_label, input) => {
        const { port, calls, authorNodeId } = fakePort(input);
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(/reply returned an invalid/i);
        expect(
            calls.filter(
                (call) =>
                    call.startsWith('submitReview:') ||
                    call.startsWith('resolve:') ||
                    call.startsWith('delete:') ||
                    call.startsWith('log:')
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
        ['missing actor ID', { resolveReceiptNodeId: null }],
        ['missing actor type', { resolveReceiptType: null }],
    ])('rejects a resolution receipt with %s before success logging', (_label, input) => {
        const { port, calls, authorNodeId } = fakePort({ existingReplyCount: 1, ...input });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /resolve review thread returned/i
        );
        expect(calls.filter((call) => call.startsWith('log:'))).toEqual([]);
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
        const {
            port: basePort,
            calls,
            authorNodeId,
            state,
        } = fakePort({
            existingReplyCount: 1,
            existingReplyReviewBody: '',
        });
        const port = strictExpectedReviewUpdatePort(basePort, {
            id: reviewId,
            fullDatabaseId: '9223372036854775808',
            commitOid: head,
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
    it('refuses to add Done to an exact pending review attached on another thread', () => {
        const { port, calls, authorNodeId } = fakePort({
            existingPendingReviewCount: 1,
            attachedReviewThreadIdsByReviewId: { [reviewId]: [otherThreadId] },
        });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            `pending author review ${reviewId} still has attached review-thread comments on ${otherThreadId}`
        );
        expect(calls.filter((call) => call.startsWith('inspectAttachedReviewThreads:'))).toEqual([
            `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${head}`,
        ]);
        expect(calls.filter((call) => call.startsWith('reply:') || call.startsWith('submitReview:'))).toEqual([]);
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
            expectedAttachedReviewThreadInspectionHead: movedHead,
        });
        expect(resolveReviewThread(42, threadId, movedHead, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls).toEqual([
            'inspect:1',
            `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${movedHead}`,
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
            `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${head}`,
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
        const {
            port: basePort,
            authorNodeId,
            state,
            calls,
        } = fakePort({
            heads: [movedHead, movedHead, movedHead, movedHead, movedHead, movedHead, movedHead, movedHead, movedHead],
            existingReplyCount: 1,
            existingReplyReviewState: 'PENDING',
            existingReplyReviewBody: '',
            existingReplyReviewCommitOid: head,
        });
        const port = strictExpectedReviewUpdatePort(basePort, {
            id: reviewId,
            fullDatabaseId: '9223372036854775808',
            commitOid: head,
        });
        expect(resolveReviewThread(42, threadId, movedHead, authorNodeId, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls).toEqual([
            'inspect:1',
            `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${movedHead}`,
            `updateReview:${reviewId}`,
            'inspect:2',
            `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${movedHead}`,
            `submitReview:${reviewId}`,
            'inspect:3',
            `createReview:${pullRequestId}`,
            'inspect:4',
            `inspectAttachedReviewThreads:42:PRR_created_1:${pullRequestId}:${movedHead}`,
            `reply:${threadId}:PRR_created_1`,
            'inspect:5',
            'inspect:6',
            `inspectAttachedReviewThreads:42:PRR_created_1:${pullRequestId}:${movedHead}`,
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
        ['missing actor ID', { submitReceiptAuthorNodeId: null }],
        ['missing actor type', { submitReceiptAuthorType: null }],
        ['wrong body', { submitReceiptBody: 'wrong body' }],
        ['wrong state', { submitReceiptState: 'PENDING' as const }],
        ['wrong commit OID', { submitReceiptCommitOid: movedHead }],
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
        ['missing actor ID', { createReceiptAuthorNodeId: null }],
        ['missing actor type', { createReceiptAuthorType: null }],
        ['wrong body', { createReceiptBody: 'wrong body' }],
        ['wrong state', { createReceiptState: 'COMMENTED' as const }],
        ['wrong commit OID', { createReceiptCommitOid: movedHead }],
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
            `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${movedHead}`,
            `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${movedHead}`,
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
    it('retains an attached review decimal identity through shell inspection and updates that exact review endpoint', () => {
        const repository = createTemporaryGitRepository();
        const body = resolutionReviewSummary(pullRequestId, threadId, head);
        const emptyReply = {
            id: replyId,
            fullDatabaseId: '9223372036854775809',
            body: 'Done',
            author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
            pullRequestReview: {
                id: reviewId,
                fullDatabaseId: '9223372036854775808',
                state: 'COMMENTED',
                body: '',
                commit: { oid: head },
                author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
            },
        };
        const updatedReply = {
            ...emptyReply,
            pullRequestReview: { ...emptyReply.pullRequestReview, body },
        };
        const fakeGh = createFakeGhExecutable({
            'threads:': [
                threadPage([{ id: threadId, isResolved: false, resolvedBy: null }], false, null),
                threadPage([{ id: threadId, isResolved: false, resolvedBy: null }], false, null),
            ],
            [`comments:${threadId}:`]: [
                commentPage([root, emptyReply], false, null),
                commentPage([root, updatedReply], false, null),
            ],
            'reviews:': [reviewPage([], false, null), reviewPage([], false, null)],
            [`threadResolution:${threadId}`]: [threadResolutionPage(), threadResolutionPage()],
            [`updateReview:repos/${REQUIRED_REPOSITORY}/pulls/42/reviews/9223372036854775808:${body}`]: `{"id":9223372036854775808,"node_id":${JSON.stringify(reviewId)},"body":${JSON.stringify(body)},"state":"COMMENTED","commit_id":${JSON.stringify(head)},"user":{"node_id":${JSON.stringify(AUTHOR_BOT_NODE_ID)},"login":"renamed-author","type":"Bot"}}`,
        });
        const basePort = shellPort(
            { configDir: repository, env: { SOURDAW_TRUSTED_GH_PATH: fakeGh.executable }, dispose() {} },
            repository
        );
        const calls: string[] = [];
        try {
            expect(() =>
                resolveReviewThread(42, threadId, head, AUTHOR_BOT_NODE_ID, {
                    ...basePort,
                    resolve: () => {
                        calls.push('resolve');
                        throw new Error('stop after verified review update');
                    },
                    serializeReviewThreadMutation: (_number, _threadId, _expectedHead, operation) => operation(),
                    log: (message) => calls.push(`log:${message}`),
                })
            ).toThrow(/stop after verified review update/i);
            expect(calls).toEqual(['resolve']);
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
            [`createReview:${pullRequestId}:${createBody}:${movedHead}:${createClientMutationId}`]: JSON.stringify({
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
    it('sends exact shell-backed submit, update, and reply fields and accepts only their matching receipts', () => {
        const repository = createTemporaryGitRepository();
        const body = resolutionReviewSummary(pullRequestId, threadId, head);
        const fakeGh = createFakeGhExecutable({
            [`submitReview:${reviewId}:${body}:review-submit:${reviewId}`]: JSON.stringify({
                data: {
                    submitPullRequestReview: {
                        clientMutationId: `review-submit:${reviewId}`,
                        pullRequestReview: {
                            id: reviewId,
                            state: 'COMMENTED',
                            body,
                            commit: { oid: head },
                            author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
                        },
                    },
                },
            }),
            [`updateReview:repos/${REQUIRED_REPOSITORY}/pulls/42/reviews/9223372036854775807:${body}`]: `{"id":9223372036854775807,"node_id":${JSON.stringify(reviewId)},"body":${JSON.stringify(body)},"state":"PENDING","commit_id":${JSON.stringify(head)},"user":{"node_id":${JSON.stringify(AUTHOR_BOT_NODE_ID)},"login":"renamed-author","type":"Bot"}}`,
            [`reply:${threadId}:${reviewId}:Done:review-reply:${threadId}`]: JSON.stringify({
                data: {
                    addPullRequestReviewThreadReply: {
                        clientMutationId: `review-reply:${threadId}`,
                        comment: {
                            id: replyId,
                            fullDatabaseId: '9223372036854775808',
                            body: 'Done',
                            author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
                            pullRequestReview: {
                                id: reviewId,
                                state: 'PENDING',
                                body,
                                commit: { oid: head },
                                author: { id: AUTHOR_BOT_NODE_ID, login: 'renamed-author', __typename: 'Bot' },
                            },
                        },
                    },
                },
            }),
        });
        const port = shellPort(
            { configDir: repository, env: { SOURDAW_TRUSTED_GH_PATH: fakeGh.executable }, dispose() {} },
            repository
        );
        const review = {
            id: reviewId,
            fullDatabaseId: '9223372036854775807',
            state: 'PENDING' as const,
            body,
            commitOid: head,
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author',
            authorType: 'Bot',
        };
        try {
            expect(
                withPullRequestReviewResolutionLock(repository, 42, threadId, head, () =>
                    port.submitReview(reviewId, body, head)
                )
            ).toMatchObject({
                id: reviewId,
                state: 'COMMENTED',
                body,
                commitOid: head,
                clientMutationId: `review-submit:${reviewId}`,
            });
            expect(
                withPullRequestReviewResolutionLock(repository, 42, threadId, head, () =>
                    port.updateReviewBody(reviewId, body, head, review)
                )
            ).toMatchObject({
                id: reviewId,
                state: 'PENDING',
                body,
                commitOid: head,
                clientMutationId: `review-update:${reviewId}`,
            });
            expect(
                withPullRequestReviewResolutionLock(repository, 42, threadId, head, () =>
                    port.replyDone(threadId, reviewId, review)
                )
            ).toMatchObject({
                id: replyId,
                reviewId,
                reviewCommitOid: head,
                clientMutationId: `review-reply:${threadId}`,
            });
            expect(() =>
                withPullRequestReviewResolutionLock(repository, 43, threadId, head, () =>
                    port.submitReview(reviewId, `${body} swapped`, head)
                )
            ).toThrow(/unexpected key/);
            expect(() =>
                withPullRequestReviewResolutionLock(repository, 44, threadId, head, () =>
                    port.updateReviewBody('PRR_swapped', body, head, { ...review, id: 'PRR_swapped' })
                )
            ).toThrow(/unexpected review update/);
            expect(() =>
                withPullRequestReviewResolutionLock(repository, 45, otherThreadId, head, () =>
                    port.replyDone(otherThreadId, reviewId, review)
                )
            ).toThrow(/unexpected key/);
        } finally {
            rmSync(repository, { recursive: true, force: true });
            rmSync(fakeGh.root, { recursive: true, force: true });
        }
    });
    it.each([
        [
            'missing create commitOID',
            'mutation($pullRequestId:ID!,$body:String!,$commitOid:GitObjectID!,$clientMutationId:String!){addPullRequestReview(input:{pullRequestId:$pullRequestId,body:$body,clientMutationId:$clientMutationId}){clientMutationId pullRequestReview{id state body commit{oid} author{login __typename ... on Bot{id}}}}}',
            [],
        ],
        [
            'missing submit body',
            'mutation($reviewId:ID!,$body:String!,$clientMutationId:String!){submitPullRequestReview(input:{pullRequestReviewId:$reviewId,event:COMMENT,clientMutationId:$clientMutationId}){clientMutationId pullRequestReview{id state body commit{oid} author{login __typename ... on Bot{id}}}}}',
            [],
        ],
        [
            'submit APPROVE event',
            'mutation($reviewId:ID!,$body:String!,$clientMutationId:String!){submitPullRequestReview(input:{pullRequestReviewId:$reviewId,event:APPROVE,body:$body,clientMutationId:$clientMutationId}){clientMutationId pullRequestReview{id state body commit{oid} author{login __typename ... on Bot{id}}}}}',
            [],
        ],
        [
            'swapped reply identities',
            'mutation($threadId:ID!,$reviewId:ID!,$body:String!,$clientMutationId:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewId:$threadId,pullRequestReviewThreadId:$reviewId,body:$body,clientMutationId:$clientMutationId}){clientMutationId comment{id fullDatabaseId body author{login __typename ... on Bot{id}} pullRequestReview{id state body commit{oid} author{login __typename ... on Bot{id}}}}}}',
            [],
        ],
        [
            'extra update input field',
            'mutation($reviewId:ID!,$body:String!,$clientMutationId:String!){updatePullRequestReview(input:{pullRequestReviewId:$reviewId,body:$body,clientMutationId:$clientMutationId}){clientMutationId pullRequestReview{id state body commit{oid} author{login __typename ... on Bot{id}}}}}',
            ['-F', 'unexpected=value'],
        ],
    ] as const)('fake gh rejects a %s mutation shape', (_case, query, extraArgs) => {
        const fakeGh = createFakeGhExecutable({});
        try {
            const result = spawnSync(fakeGh.executable, ['api', 'graphql', '-F', `query=${query}`, ...extraArgs], {
                encoding: 'utf8',
                shell: false,
            });
            expect(result.status).not.toBe(0);
        } finally {
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
            `inspectAttachedReviewThreads:42:PRR_pending_reply:${pullRequestId}:${head}`,
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
        expect(state().submittedReviewCommitOids).toEqual([{ reviewId: 'PRR_pending_reply', reviewCommitOid: head }]);
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
        ['review identity', { updateReceiptReviewId: 'PRR_wrong' }],
        ['body', { updateReceiptBody: 'wrong body' }],
        ['historical commit', { updateReceiptCommitOid: movedHead }],
        ['client mutation id', { updateClientMutationId: 'wrong' }],
        ['wrong immutable actor ID', { updateReceiptAuthorNodeId: REVIEWER_BOT_NODE_ID }],
        ['non-Bot type', { updateReceiptAuthorType: 'User' as const }],
        ['missing actor ID', { updateReceiptAuthorNodeId: null }],
        ['missing actor type', { updateReceiptAuthorType: null }],
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
    it('fails closed without mutation for stale immutable submitted-review envelopes', () => {
        const {
            port: basePort,
            calls,
            authorNodeId,
        } = fakePort({
            heads: [movedHead, movedHead, movedHead],
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 2,
            existingReplyReviewBody: '',
            existingReplyReviewCommitOid: head,
        });
        let attemptedUpdate = false;
        const port: ResolveReviewThreadPort = {
            ...basePort,
            updateReviewBody: () => {
                attemptedUpdate = true;
                throw new Error('immutable submitted review must not be updated');
            },
        };
        expect(() => resolveReviewThread(42, threadId, movedHead, authorNodeId, port)).toThrow();
        expect(attemptedUpdate).toBe(false);
        expect(
            calls.filter((call) =>
                /^(createReview|reply:|updateReview|delete:|deleteReview|submit|resolve|log:)/.test(call)
            )
        ).toEqual([]);
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
            `inspectAttachedReviewThreads:42:PRR_resolved_pending:${pullRequestId}:${head}`,
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
    it('reconciles an immutable submitted-review envelope after deleting its managed pending reply', () => {
        const {
            port: basePort,
            calls,
            authorNodeId,
            state,
        } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            existingReplyReviewBody: '',
            addPendingReplyMarkerToResolvedThread: true,
        });
        const port: ResolveReviewThreadPort = {
            ...basePort,
            updateReviewBody: () => {
                throw new Error('immutable submitted review must not be updated');
            },
            submitReview: () => {
                throw new Error('immutable submitted review must not be submitted');
            },
            resolve: () => {
                throw new Error('completed immutable review thread must not be resolved again');
            },
            deleteReply: () => {
                throw new Error('immutable submitted review marker must not be deleted');
            },
        };
        expect(resolveReviewThread(42, threadId, head, authorNodeId, port)).toBe(
            `review-thread-resolution-reconciled-immutable-empty-submitted-review:42:${threadId}`
        );
        expect(calls).toEqual([
            'inspect:1',
            `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${head}`,
            `inspectAttachedReviewThreads:42:PRR_resolved_pending:${pullRequestId}:${head}`,
            'deleteReview:PRR_resolved_pending',
            'inspect:2',
            `log:review-thread-resolution-reconciled-immutable-empty-submitted-review:42:${threadId}`,
        ]);
        expect(state().reviews).toEqual([
            expect.objectContaining({
                id: reviewId,
                state: 'COMMENTED',
                body: '',
            }),
        ]);
    });
    it('preserves one immutable submitted-review envelope while converging a nonempty duplicate marker', () => {
        const {
            port: basePort,
            calls,
            authorNodeId,
            state,
        } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 2,
            existingReplyReviewBody: '',
            secondaryReplyReviewBody: resolutionReviewSummary(pullRequestId, threadId, head),
            existingReplyFullDatabaseIds: ['9223372036854775809', '9223372036854775808'],
        });
        const port: ResolveReviewThreadPort = {
            ...basePort,
            updateReviewBody: () => {
                throw new Error('immutable submitted review must not be updated');
            },
        };
        expect(resolveReviewThread(42, threadId, head, authorNodeId, port)).toBe(
            `review-thread-resolution-reconciled-immutable-empty-submitted-review:42:${threadId}`
        );
        expect(calls).toEqual([
            'inspect:1',
            `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${head}`,
            'inspect:2',
            'inspect:3',
            'delete:PRRC_existing_1',
            'inspect:4',
            `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${head}`,
            `log:review-thread-resolution-reconciled-immutable-empty-submitted-review:42:${threadId}`,
        ]);
        expect(state().reviews.find((review) => review.id === reviewId)).toMatchObject({
            state: 'COMMENTED',
            body: '',
        });
        expect(state().comments.filter((comment) => comment.body === 'Done')).toEqual([
            expect.objectContaining({ id: replyId, reviewId }),
        ]);
    });
    it('backfills a whitespace-only COMMENTED duplicate while preserving the exact immutable envelope', () => {
        const {
            port: basePort,
            calls,
            authorNodeId,
            state,
        } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 2,
            existingReplyReviewBody: '',
            secondaryReplyReviewBody: ' \n\t ',
            existingReplyFullDatabaseIds: ['9223372036854775809', '9223372036854775808'],
        });
        const port: ResolveReviewThreadPort = {
            ...basePort,
            updateReviewBody: (currentReviewId, body, commitOid, expectedReview) => {
                if (currentReviewId === reviewId) {
                    throw new Error('immutable submitted review must not be updated');
                }
                return basePort.updateReviewBody(currentReviewId, body, commitOid, expectedReview);
            },
        };

        expect(resolveReviewThread(42, threadId, head, authorNodeId, port)).toBe(
            `review-thread-resolution-reconciled-immutable-empty-submitted-review:42:${threadId}`
        );

        expect(calls.filter((call) => call.startsWith('updateReview:'))).toEqual(['updateReview:PRR_existing_1']);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual(['delete:PRRC_existing_1']);
        expect(state().reviews.find((review) => review.id === reviewId)).toMatchObject({
            state: 'COMMENTED',
            body: '',
        });
    });
    it('fails without deletion when the preferred immutable marker disappears before duplicate convergence', () => {
        const {
            port: basePort,
            calls,
            authorNodeId,
        } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 2,
            existingReplyReviewBody: '',
            secondaryReplyReviewBody: resolutionReviewSummary(pullRequestId, threadId, head),
            existingReplyFullDatabaseIds: ['9223372036854775809', '9223372036854775808'],
        });
        let inspections = 0;
        const port: ResolveReviewThreadPort = {
            ...basePort,
            inspect: (number, currentThreadId) => {
                const inspection = basePort.inspect(number, currentThreadId);
                inspections += 1;
                if (inspections !== 3 || inspection.thread === null) {
                    return inspection;
                }
                return {
                    ...inspection,
                    thread: {
                        ...inspection.thread,
                        comments: inspection.thread.comments.filter((comment) => comment.id !== replyId),
                    },
                };
            },
        };
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /immutable empty submitted-review envelope/i
        );
        expect(
            calls.filter((call) =>
                /^(createReview|reply:|updateReview|delete:|deleteReview|submit|resolve|log:)/.test(call)
            )
        ).toEqual([]);
    });
    it('converges duplicate immutable Done markers from one submitted review before final reconciliation', () => {
        const {
            port: basePort,
            calls,
            authorNodeId,
            state,
        } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 2,
            existingReplyReviewBody: '',
            secondaryReplyReviewId: reviewId,
            secondaryReplyReviewBody: '',
        });
        const port: ResolveReviewThreadPort = {
            ...basePort,
            updateReviewBody: () => {
                throw new Error('immutable submitted review must not be updated');
            },
        };
        expect(resolveReviewThread(42, threadId, head, authorNodeId, port)).toBe(
            `review-thread-resolution-reconciled-immutable-empty-submitted-review:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('updateReview:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual(['delete:PRRC_existing_1']);
        expect(state().comments.filter((comment) => comment.body === 'Done')).toEqual([
            expect.objectContaining({ id: replyId, reviewId }),
        ]);
    });
    it('never updates a stale empty submitted-review envelope', () => {
        const {
            port: basePort,
            calls,
            authorNodeId,
        } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            existingReplyReviewBody: '',
            existingReplyReviewCommitOid: movedHead,
        });
        let attemptedUpdate = false;
        const port: ResolveReviewThreadPort = {
            ...basePort,
            updateReviewBody: () => {
                attemptedUpdate = true;
                throw new Error('stale immutable submitted review must not be updated');
            },
        };
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow();
        expect(attemptedUpdate).toBe(false);
        expect(
            calls.filter((call) =>
                /^(createReview|reply:|updateReview|delete:|deleteReview|submit|resolve|log:)/.test(call)
            )
        ).toEqual([]);
    });
    it('fails closed when the immutable submitted-review envelope is attached to another thread', () => {
        const { port, calls, authorNodeId } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            existingReplyReviewBody: '',
            attachedReviewThreadIdsByReviewId: { [reviewId]: ['PRRT_foreign'] },
        });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /attached review-thread comments/i
        );
        expect(calls.filter((call) => !call.startsWith('inspect:'))).toEqual([
            `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${head}`,
        ]);
    });
    it('fails closed when a completed immutable envelope gains a foreign attachment during terminal verification', () => {
        const {
            port: basePort,
            calls,
            authorNodeId,
        } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            existingReplyReviewBody: '',
        });
        let inspections = 0;
        const port: ResolveReviewThreadPort = {
            ...basePort,
            inspect: (number, currentThreadId) => {
                const inspection = basePort.inspect(number, currentThreadId);
                inspections += 1;
                return inspection;
            },
            inspectAttachedReviewThreadIds: (number, id, expectedPullRequestId, expectedHead) => {
                const attached = basePort.inspectAttachedReviewThreadIds(
                    number,
                    id,
                    expectedPullRequestId,
                    expectedHead
                );
                return inspections >= 2 ? [...attached, 'PRRT_foreign'] : attached;
            },
        };
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /attached review-thread comments/i
        );
        expect(
            calls.filter((call) =>
                /^(createReview|reply:|updateReview|delete:|deleteReview|submit|resolve|log:)/.test(call)
            )
        ).toEqual([]);
    });
    it('retires a stale unattached pending review before reconciling an immutable submitted-review envelope', () => {
        const {
            port: basePort,
            calls,
            authorNodeId,
            state,
        } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            existingReplyReviewBody: '',
            existingPendingReviewCount: 1,
            existingPendingReviewIds: ['PRR_stale'],
            existingPendingReviewCommitOid: movedHead,
            existingPendingReviewBody: resolutionReviewSummary(pullRequestId, threadId, movedHead),
        });
        const port: ResolveReviewThreadPort = {
            ...basePort,
            updateReviewBody: () => {
                throw new Error('immutable submitted review must not be updated');
            },
        };
        expect(resolveReviewThread(42, threadId, head, authorNodeId, port)).toBe(
            `review-thread-resolution-reconciled-immutable-empty-submitted-review:42:${threadId}`
        );
        expect(calls).toEqual([
            'inspect:1',
            `inspectAttachedReviewThreads:42:${reviewId}:${pullRequestId}:${head}`,
            `inspectAttachedReviewThreads:42:PRR_stale:${pullRequestId}:${head}`,
            'deleteReview:PRR_stale',
            'inspect:2',
            'inspect:3',
            `log:review-thread-resolution-reconciled-immutable-empty-submitted-review:42:${threadId}`,
        ]);
        expect(state().reviews).toEqual([expect.objectContaining({ id: reviewId, body: '', state: 'COMMENTED' })]);
    });
    it('keeps an immutable submitted-review envelope locked behind the completed-resolution pending-review guard', () => {
        const { port, calls, authorNodeId, state } = fakePort({
            isResolved: true,
            initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
            initialResolvedByType: 'User',
            existingReplyCount: 1,
            existingReplyReviewBody: '',
            existingPendingReviewCount: 1,
            existingPendingReviewIds: ['PRR_blocking'],
            existingPendingReviewCommitOid: movedHead,
            existingPendingReviewBody: 'unrelated moved pending body',
        });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
            /non-reusable pending author review/i
        );
        expect(
            calls.filter((call) =>
                /^(createReview|reply:|updateReview|delete:|deleteReview|submit|resolve|log:)/.test(call)
            )
        ).toEqual([]);
        expect(state().reviews).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: reviewId, body: '', state: 'COMMENTED' }),
                expect.objectContaining({ id: 'PRR_blocking', body: 'unrelated moved pending body', state: 'PENDING' }),
            ])
        );
        expect(state().reviews).toHaveLength(2);
    });
    it.each([
        ['review identity', { updateReceiptReviewId: 'PRR_wrong' }],
        ['body', { updateReceiptBody: 'wrong body' }],
        ['historical commit', { updateReceiptCommitOid: movedHead }],
        ['client mutation id', { updateClientMutationId: 'wrong' }],
    ] as const)(
        'fails closed on a completed-resolution backfill receipt with the wrong %s before logging success',
        (_label, input) => {
            const { port, calls, authorNodeId } = fakePort({
                isResolved: true,
                initialResolvedByNodeId: AUTHOR_BOT_NODE_ID,
                initialResolvedByType: 'User',
                existingReplyCount: 1,
                existingReplyReviewBody: ' ',
                ...input,
            });
            expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(
                /update review body returned an invalid result/i
            );
            expect(calls.filter((call) => call.startsWith('resolve:') || call.startsWith('log:'))).toEqual([]);
        }
    );
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
    it('rejects a missing comment author before resolution or deletion', () => {
        const { port, calls, authorNodeId } = fakePort({ rootAuthorNodeId: null });
        expect(() => resolveReviewThread(42, threadId, head, authorNodeId, port)).toThrow(/author|root comment/i);
        expect(calls.filter((call) => call.startsWith('resolve:') || call.startsWith('delete:'))).toEqual([]);
    });
    it('rejects a missing review author without resolving or releasing retained locks', () => {
        const repository = createTemporaryGitRepository();
        const { port, calls } = fakePort({ existingReplyCount: 1, existingReplyReviewAuthorNodeId: null });
        try {
            const sharedOwnerOid = writeSharedMutationLockOwnerBlob(repository, 999999);
            updateSharedMutationLock(repository, 42, sharedOwnerOid);
            const ownerOid = writeLockOwnerBlob(
                repository,
                999999,
                head,
                { phase: 'deleteReply', epoch: 1, replyId },
                undefined,
                undefined,
                sharedOwnerOid
            );
            updateLock(repository, 42, ownerOid);
            expect(() =>
                recoverPullRequestReviewResolutionLock(
                    repository,
                    42,
                    ownerOid,
                    (owner) => recoverReviewResolutionLockOwnerState(42, owner, port),
                    () => false
                )
            ).toThrow(/no review author/);
            expect(calls.filter((call) => call.startsWith('resolve:') || call.startsWith('delete:'))).toEqual([]);
            expect(readLockOid(repository, 42)).toBeDefined();
            expect(readSharedMutationLockOid(repository, 42)).toBeDefined();
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
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
