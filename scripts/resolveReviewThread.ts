#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, normalize } from 'node:path';
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
export type ReviewResolutionLockOwner = {
    version: 2;
    pid: number;
    pgid: number;
    threadId: string;
    head: string;
    token: string;
};
export type ResolveReviewThreadPort = {
    inspect: (number: number, threadId: string) => ReviewThreadInspection;
    inspectAttachedReviewThreadIds: (number: number, reviewId: string, expectedHead: string) => string[];
    createPendingReview: (pullRequestId: string, commitOid: string, body: string) => ReviewEnvelopeReceipt;
    replyDone: (threadId: string, reviewId: string) => ReviewReply;
    submitReview: (reviewId: string, body: string) => ReviewEnvelopeReceipt;
    updateReviewBody: (reviewId: string, body: string) => ReviewEnvelopeReceipt;
    resolve: (threadId: string) => ReviewResolutionReceipt;
    deleteReply: (replyId: string) => void;
    deletePendingReview: (reviewId: string) => void;
    serializeReviewThreadMutation: <Value>(
        number: number,
        threadId: string,
        expectedHead: string,
        operation: () => Value
    ) => Value;
    log: (message: string) => void;
};
export type ResolveReviewThreadArgs = { number?: number; threadId?: string; head?: string; help: boolean };
const usage = 'usage: pnpm review:resolve <pr-number> --thread <graphql-thread-node-id> --head <40-hex-sha>';
const RESOLUTION_REVIEW_SUMMARY = 'Resolved this review thread after applying the requested changes.';
const REVIEW_RESOLUTION_LOCK_TOKEN_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FORTY_HEX_PATTERN = /^[0-9a-f]{40}$/iu;
const SIXTY_FOUR_HEX_PATTERN = /^[0-9a-f]{64}$/iu;
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
type ReviewResolutionExecutionFence = {
    pid: number;
    pgid: number;
};
const REVIEW_RESOLUTION_CHILD_ENV = 'SOURDAW_REVIEW_RESOLUTION_CHILD';
const REVIEW_RESOLUTION_CHILD_MARKER_VERSION = 1;

type ReviewResolutionChildLaunchMarker = {
    path: string;
    token: string;
};

export type PersistedReviewResolutionChildLaunchMarker = {
    version: 1;
    token: string;
    pid: number | null;
};

type ReviewResolutionChildMarkerPublicationPort = {
    randomUuid?: () => string;
    writeFileSync?: typeof writeFileSync;
    renameSync?: typeof renameSync;
    rmSync?: typeof rmSync;
};

function canonicalGitObjectId(value: string, label: string, lengths: number[] = [40]): string {
    const trimmed = value.trim();
    const valid =
        (lengths.includes(40) && FORTY_HEX_PATTERN.test(trimmed)) ||
        (lengths.includes(64) && SIXTY_FOUR_HEX_PATTERN.test(trimmed));
    if (!valid) {
        fail(label);
    }
    return trimmed.toLowerCase();
}

function invalidReviewResolutionChildMarker(): never {
    fail('review:resolve detached launcher marker is invalid');
}

function isPositiveSafeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function parseReviewResolutionChildLaunchMarker(value: string): ReviewResolutionChildLaunchMarker {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value) as unknown;
    } catch {
        invalidReviewResolutionChildMarker();
    }
    if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('path' in parsed) ||
        typeof parsed.path !== 'string' ||
        parsed.path.trim() === '' ||
        !isAbsolute(parsed.path) ||
        normalize(parsed.path) !== parsed.path ||
        !('token' in parsed) ||
        typeof parsed.token !== 'string' ||
        !REVIEW_RESOLUTION_LOCK_TOKEN_PATTERN.test(parsed.token)
    ) {
        invalidReviewResolutionChildMarker();
    }
    return { path: parsed.path, token: parsed.token };
}

export function readPersistedReviewResolutionChildLaunchMarker(
    marker: ReviewResolutionChildLaunchMarker
): PersistedReviewResolutionChildLaunchMarker {
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(marker.path, 'utf8')) as unknown;
    } catch {
        invalidReviewResolutionChildMarker();
    }
    const pid = typeof parsed === 'object' && parsed !== null && 'pid' in parsed ? parsed.pid : undefined;
    if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Object.keys(parsed).length !== 3 ||
        !('version' in parsed) ||
        parsed.version !== REVIEW_RESOLUTION_CHILD_MARKER_VERSION ||
        !('token' in parsed) ||
        parsed.token !== marker.token ||
        pid === undefined ||
        (pid !== null && !isPositiveSafeInteger(pid))
    ) {
        invalidReviewResolutionChildMarker();
    }
    return {
        version: REVIEW_RESOLUTION_CHILD_MARKER_VERSION,
        token: marker.token,
        pid,
    };
}

export function publishReviewResolutionChildLaunchMarker(
    path: string,
    token: string,
    pid: number | null,
    port: ReviewResolutionChildMarkerPublicationPort = {}
): void {
    const persisted: PersistedReviewResolutionChildLaunchMarker = {
        version: REVIEW_RESOLUTION_CHILD_MARKER_VERSION,
        token,
        pid,
    };
    const temporaryPath = `${path}.${(port.randomUuid ?? randomUUID)()}.tmp`;
    const write = port.writeFileSync ?? writeFileSync;
    const move = port.renameSync ?? renameSync;
    const remove = port.rmSync ?? rmSync;
    try {
        write(temporaryPath, JSON.stringify(persisted), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        move(temporaryPath, path);
    } catch (error) {
        remove(temporaryPath, { force: true });
        throw error;
    }
}

function createReviewResolutionChildLaunchMarker(): {
    envValue: string;
    bindChildPid: (pid: number) => void;
    cleanup: () => void;
} {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-review-resolve-'));
    const path = join(root, 'child-marker.json');
    const token = randomUUID();
    publishReviewResolutionChildLaunchMarker(path, token, null);
    return {
        envValue: JSON.stringify({ path, token }),
        bindChildPid: (pid) => {
            if (!Number.isSafeInteger(pid) || pid <= 0) {
                invalidReviewResolutionChildMarker();
            }
            publishReviewResolutionChildLaunchMarker(path, token, pid);
        },
        cleanup: () => {
            rmSync(root, { recursive: true, force: true });
        },
    };
}

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
        !FORTY_HEX_PATTERN.test(args[4])
    ) {
        fail(usage);
    }
    const number = Number(args[0]);
    if (!Number.isSafeInteger(number)) {
        fail(usage);
    }
    return { number, threadId: args[2], head: canonicalGitObjectId(args[4], usage), help: false };
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
    const canonicalHead = canonicalGitObjectId(expectedHead, usage);
    return port.serializeReviewThreadMutation(number, threadId, canonicalHead, () =>
        resolveReviewThreadWithinMutation(number, threadId, canonicalHead, port)
    );
}

function resolveReviewThreadWithinMutation(
    number: number,
    threadId: string,
    expectedHead: string,
    port: ResolveReviewThreadPort
): string {
    const before = port.inspect(number, threadId);
    assertExpectedHead(before.head, expectedHead);
    const context = resolutionReviewContext(before.pullRequestId, threadId, expectedHead);
    if (before.thread?.isResolved) {
        repairCompletedResolution(number, before, context, port);
        return logResolutionSuccess(number, threadId, port);
    }
    assertResolvableThread(before.thread, threadId);
    assertManagedReplyMarkersReadable(before.thread!, context, ['PENDING', 'COMMENTED'], true);
    let pendingReviewCreateAttempted = false;
    let pendingReviewCreated = false;
    let pendingReviewDeleteAttempted = false;
    let replyAttempted = false;
    let replyCreated = false;
    let reviewUpdateAttempted = false;
    let reviewSubmitAttempted = false;
    let replyId: string | undefined;
    let resolveAttempted = false;
    let resolutionReceipt: ReviewResolutionReceipt | undefined;
    try {
        let working = before;
        const existingReply = findReusableReply(before.thread, context);
        if (existingReply === undefined) {
            let pendingReview = convergePendingReviews(number, working.pendingReviews, context, port);
            if (pendingReview === undefined) {
                const stalePendingReply = findStaleManagedPendingReply(working.thread, context);
                if (stalePendingReply !== undefined) {
                    let stalePendingReplyReview = stalePendingReply.review;
                    const stalePendingReplyCommitOid = requireReviewCommitOid(
                        stalePendingReplyReview,
                        `Done reply ${stalePendingReply.marker.id}`
                    );
                    if (stalePendingReplyReview.body.trim() === '') {
                        reviewUpdateAttempted = true;
                        const updatedReview = port.updateReviewBody(
                            stalePendingReplyReview.id,
                            resolutionReviewBody(context, stalePendingReplyCommitOid)
                        );
                        assertReviewEnvelopeReceipt(
                            updatedReview,
                            updateReviewClientMutationId(stalePendingReplyReview.id),
                            stalePendingReplyReview.state,
                            resolutionReviewBody(context, stalePendingReplyCommitOid),
                            stalePendingReplyCommitOid,
                            'update review body'
                        );
                        working = port.inspect(number, threadId);
                        assertExpectedHeadAfterMutation(working.head, expectedHead);
                        assertResolvableThread(working.thread, threadId);
                        const refreshedPendingReply = findManagedReplyMarkerByReviewId(
                            working.thread,
                            context,
                            stalePendingReplyReview.id,
                            ['PENDING', 'COMMENTED'],
                            true
                        );
                        if (refreshedPendingReply === undefined) {
                            fail(
                                `Done reply ${stalePendingReply.marker.id} is no longer attached to a valid author review`
                            );
                        }
                        stalePendingReplyReview = refreshedPendingReply.review;
                    }
                    if (stalePendingReplyReview.state === 'PENDING') {
                        reviewSubmitAttempted = true;
                        const submittedStalePendingReplyReview = port.submitReview(
                            stalePendingReplyReview.id,
                            resolutionReviewBody(context, stalePendingReplyCommitOid)
                        );
                        assertReviewEnvelopeReceipt(
                            submittedStalePendingReplyReview,
                            submitReviewClientMutationId(stalePendingReplyReview.id),
                            'COMMENTED',
                            resolutionReviewBody(context, stalePendingReplyCommitOid),
                            stalePendingReplyCommitOid,
                            'submit review'
                        );
                        working = port.inspect(number, threadId);
                        assertExpectedHeadAfterMutation(working.head, expectedHead);
                        assertResolvableThread(working.thread, threadId);
                    }
                    pendingReview = convergePendingReviews(number, working.pendingReviews, context, port);
                }
            }
            if (pendingReview === undefined) {
                if (findRetirableStaleUnattachedPendingReview(working.pendingReviews, working.thread!, context)) {
                    pendingReviewDeleteAttempted = true;
                    const retired = retireRetirableStaleUnattachedPendingReview(
                        number,
                        threadId,
                        working,
                        context,
                        port
                    );
                    working = retired.working;
                    assertResolvableThread(working.thread, threadId);
                    assertManagedReplyMarkersReadable(working.thread!, context, ['PENDING', 'COMMENTED'], true);
                    pendingReview = convergePendingReviews(number, working.pendingReviews, context, port);
                }
            }
            if (
                pendingReview === undefined &&
                hasBlockingAuthorPendingReview(working.pendingReviews, working.thread!, context)
            ) {
                fail(`review thread ${threadId} has a non-reusable pending author review`);
            }
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
                working = port.inspect(number, threadId);
                assertExpectedHeadAfterMutation(working.head, expectedHead);
                assertResolvableThread(working.thread, threadId);
                pendingReview = convergePendingReviews(number, working.pendingReviews, context, port);
            }
            if (pendingReview === undefined) {
                fail(`review thread ${threadId} has no reusable pending author review`);
            }
            replyAttempted = true;
            const reply = port.replyDone(threadId, pendingReview.id);
            assertReply(reply, replyClientMutationId(threadId), pendingReview.id, context);
            replyId = reply.id;
            replyCreated = true;
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
        let replyInspection = reviewUpdateAttempted ? port.inspect(number, threadId) : afterReply;
        if (reviewUpdateAttempted) {
            assertExpectedHeadAfterMutation(replyInspection.head, expectedHead);
            assertResolvableThread(replyInspection.thread, threadId);
        }
        let canonical = requireCanonicalManagedReplyMarker(
            replyInspection.thread!,
            threadId,
            context,
            ['PENDING', 'COMMENTED'],
            true
        );
        let canonicalReply = canonical.marker;
        let canonicalReview = canonical.review;
        if (canonicalReview.body.trim() === '') {
            reviewUpdateAttempted = true;
            const canonicalReviewCommitOid = requireReviewCommitOid(canonicalReview, `Done reply ${canonicalReply.id}`);
            const updatedReview = port.updateReviewBody(
                canonicalReview.id,
                resolutionReviewBody(context, canonicalReviewCommitOid)
            );
            assertReviewEnvelopeReceipt(
                updatedReview,
                updateReviewClientMutationId(canonicalReview.id),
                canonicalReview.state,
                resolutionReviewBody(context, canonicalReviewCommitOid),
                canonicalReviewCommitOid,
                'update review body'
            );
            replyInspection = port.inspect(number, threadId);
            assertExpectedHeadAfterMutation(replyInspection.head, expectedHead);
            assertResolvableThread(replyInspection.thread, threadId);
            canonical = requireCanonicalManagedReplyMarker(
                replyInspection.thread!,
                threadId,
                context,
                ['PENDING', 'COMMENTED'],
                true
            );
            canonicalReply = canonical.marker;
            canonicalReview = canonical.review;
        } else if (
            canonicalReview.body !==
            resolutionReviewBody(context, requireReviewCommitOid(canonicalReview, `Done reply ${canonicalReply.id}`))
        ) {
            fail(`Done reply ${canonicalReply.id} is attached to a noncanonical author review`);
        }
        if (canonicalReview.state === 'PENDING') {
            reviewSubmitAttempted = true;
            const canonicalReviewCommitOid = requireReviewCommitOid(canonicalReview, `Done reply ${canonicalReply.id}`);
            const submittedReview = port.submitReview(
                canonicalReview.id,
                resolutionReviewBody(context, canonicalReviewCommitOid)
            );
            canonicalReview = submittedReview;
            assertReviewEnvelopeReceipt(
                submittedReview,
                submitReviewClientMutationId(canonicalReview.id),
                'COMMENTED',
                resolutionReviewBody(context, canonicalReviewCommitOid),
                canonicalReviewCommitOid,
                'submit review'
            );
            replyInspection = port.inspect(number, threadId);
            assertExpectedHeadAfterMutation(replyInspection.head, expectedHead);
            assertResolvableThread(replyInspection.thread, threadId);
        }
        const pendingReviewDeleted = reconcilePendingReviewsForReply(
            number,
            replyInspection.pendingReviews,
            replyInspection.thread,
            context,
            port
        );
        reviewUpdateAttempted = pendingReviewDeleted || reviewUpdateAttempted;
        if (pendingReviewDeleted) {
            replyInspection = port.inspect(number, threadId);
            assertExpectedHeadAfterMutation(replyInspection.head, expectedHead);
            assertResolvableThread(replyInspection.thread, threadId);
        }
        replyId = convergeReplyMarkers(threadId, replyInspection.thread, port, context, ['COMMENTED']);
        const afterReview = port.inspect(number, threadId);
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
            pendingReviewDeleteAttempted,
            replyAttempted,
            replyCreated,
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
    pendingReviewDeleteAttempted: boolean,
    replyAttempted: boolean,
    replyCreated: boolean,
    reviewUpdateAttempted: boolean,
    reviewSubmitAttempted: boolean,
    resolveAttempted: boolean,
    resolutionReceipt: ReviewResolutionReceipt | undefined,
    port: ResolveReviewThreadPort,
    original: unknown
): never {
    const failures: string[] = [];
    let preservedAmbiguousPendingEvidence = false;
    let current: ReviewThreadInspection | undefined;
    attempt(failures, 'inspect ambiguous review transaction', () => {
        current = port.inspect(number, threadId);
    });
    if (current === undefined || current.thread === null || before.thread === null) {
        failures.push('cannot determine ambiguous review transaction state');
    } else {
        const canonicalCommentedReviewVisible = current.thread.comments.some((comment) =>
            hasCanonicalCommentedReview(comment, context)
        );
        const visibleReviewEvidence = reviewUpdateAttempted && canonicalCommentedReviewVisible;
        const submittedReviewEvidence = reviewSubmitAttempted && canonicalCommentedReviewVisible;
        const resolutionEvidence = resolutionReceipt !== undefined || resolveAttempted || current.thread.isResolved;
        if (resolutionEvidence) {
            failures.push('review-thread resolution was attempted; preserving Done reply as durable evidence');
        }
        if (submittedReviewEvidence) {
            failures.push('review submission was attempted; preserving submitted review evidence');
        } else if (reviewSubmitAttempted) {
            failures.push('review submission was attempted; preserving pending review evidence');
        } else if (visibleReviewEvidence) {
            failures.push('review body update was attempted; preserving submitted review evidence');
        } else if (canonicalCommentedReviewVisible) {
            failures.push('canonical commented review is already visible; preserving Done reply as durable evidence');
        }
        if (
            pendingReviewCreateAttempted &&
            !pendingReviewCreated &&
            !replyAttempted &&
            current.head !== context.expectedHead
        ) {
            preservedAmbiguousPendingEvidence =
                deleteAmbiguousCreatedPendingReview(
                    before.pendingReviews,
                    current.pendingReviews,
                    current.thread,
                    context,
                    port,
                    failures
                ) || preservedAmbiguousPendingEvidence;
        } else if (pendingReviewCreated && !replyAttempted) {
            failures.push(
                'created pending review is shareable after an ambiguous failure; preserving pending review evidence'
            );
        } else if (replyAttempted && !replyCreated) {
            failures.push('ambiguous review reply mutation; refusing to delete an unverified comment');
        } else if (replyCreated) {
            failures.push('ambiguous review reply mutation; preserving Done reply evidence');
        } else if (pendingReviewDeleteAttempted) {
            failures.push('pending review deletion was attempted; preserving current pending review evidence');
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
        !pendingReviewDeleteAttempted &&
        !replyAttempted &&
        !reviewUpdateAttempted &&
        !reviewSubmitAttempted &&
        !preservedAmbiguousPendingEvidence
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
    if (
        canonicalGitObjectId(currentHead, 'supplied head does not match the current pull-request head') !== expectedHead
    ) {
        fail('supplied head does not match the current pull-request head');
    }
}
function assertExpectedHeadAfterMutation(currentHead: string, expectedHead: string): void {
    if (canonicalGitObjectId(currentHead, 'pull-request head moved after mutation; compensating') !== expectedHead) {
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
        expectedHead: canonicalGitObjectId(expectedHead, 'cannot read current pull-request head'),
    };
}
function resolutionReviewBody(context: ResolutionReviewContext, reviewHead: string): string {
    const canonicalReviewHead = canonicalGitObjectId(reviewHead, 'resolution review body requires a valid review head');
    return [
        RESOLUTION_REVIEW_SUMMARY,
        `<!-- sourdaw-review-resolve pull-request:${context.pullRequestId} thread:${context.threadId} head:${canonicalReviewHead} -->`,
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
        commitOid: canonicalGitObjectId(value.reviewCommitOid, `${label} has no commit OID`),
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
        commitOid: canonicalGitObjectId(value.reviewCommitOid, 'managed Done reply has no commit OID'),
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
    return managed.sort(compareManagedReplyMarkers);
}
function assertManagedReplyMarkersReadable(
    thread: ReviewThread,
    context: ResolutionReviewContext,
    allowedStates: string[],
    allowEmptyBody: boolean
): void {
    for (const marker of validatedReplyMarkers(thread)) {
        requireReplyReview(marker, context, allowedStates, allowEmptyBody, null);
    }
}
function compareManagedReplyMarkers(left: ManagedReplyMarker, right: ManagedReplyMarker): number {
    const leftPriority = managedReplyPriority(left);
    const rightPriority = managedReplyPriority(right);
    if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
    }
    return compareMarkers(left.marker, right.marker);
}
function managedReplyPriority(candidate: ManagedReplyMarker): number {
    if (candidate.currentHead && candidate.review.state === 'COMMENTED') {
        return 0;
    }
    if (candidate.currentHead) {
        return 1;
    }
    if (candidate.review.state === 'COMMENTED') {
        return 2;
    }
    return 3;
}
function requireCanonicalManagedReplyMarker(
    thread: ReviewThread,
    threadId: string,
    context: ResolutionReviewContext,
    allowedStates: string[],
    allowEmptyBody: boolean
): ManagedReplyMarker {
    const managed = managedReplyMarkers(thread, context, allowedStates, allowEmptyBody);
    const canonical = managed[0];
    if (canonical === undefined) {
        const markers = validatedReplyMarkers(thread);
        const marker = markers[0];
        if (marker !== undefined && markers.length === 1) {
            requireReplyReview(marker, context, allowedStates, allowEmptyBody, null);
        }
        fail(`review thread ${threadId} has no valid Done reply marker`);
    }
    return canonical;
}
function findManagedReplyMarkerByReviewId(
    thread: ReviewThread | null,
    context: ResolutionReviewContext,
    reviewId: string,
    allowedStates: string[],
    allowEmptyBody: boolean
): ManagedReplyMarker | undefined {
    if (thread === null) {
        return undefined;
    }
    return managedReplyMarkers(thread, context, allowedStates, allowEmptyBody).find(
        (candidate) => candidate.review.id === reviewId
    );
}
function findStaleManagedPendingReply(
    thread: ReviewThread | null,
    context: ResolutionReviewContext
): ManagedReplyMarker | undefined {
    if (thread === null) {
        return undefined;
    }
    for (const marker of validatedReplyMarkers(thread)) {
        const review = toReplyReviewOrNull(marker);
        if (
            review === null ||
            review.state !== 'PENDING' ||
            typeof review.commitOid !== 'string' ||
            review.commitOid === '' ||
            review.commitOid === context.expectedHead
        ) {
            continue;
        }
        return {
            marker,
            review: requireReplyReview(marker, context, ['PENDING'], true, null),
            currentHead: false,
        };
    }
    return undefined;
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
function isCanonicalAuthorPendingReview(review: PullRequestReview, context: ResolutionReviewContext): boolean {
    return (
        review.state === 'PENDING' &&
        typeof review.commitOid === 'string' &&
        review.commitOid !== '' &&
        review.body === resolutionReviewBody(context, review.commitOid) &&
        isAuthorBotActor(review.authorNodeId, review.authorType)
    );
}
function attachedManagedReviewIds(thread: ReviewThread, context: ResolutionReviewContext): Set<string> {
    return new Set(
        managedReplyMarkers(thread, context, ['PENDING', 'COMMENTED'], true).map((candidate) => candidate.review.id)
    );
}
function findRetirableStaleUnattachedPendingReview(
    pendingReviews: PullRequestReview[],
    thread: ReviewThread,
    context: ResolutionReviewContext
): PullRequestReview | undefined {
    const attachedReviewIds = attachedManagedReviewIds(thread, context);
    const authorPendingReviews = pendingReviews.filter((review) =>
        isAuthorBotActor(review.authorNodeId, review.authorType)
    );
    if (authorPendingReviews.length !== 1) {
        return undefined;
    }
    const [candidate] = authorPendingReviews;
    if (
        candidate === undefined ||
        candidate.commitOid === context.expectedHead ||
        attachedReviewIds.has(candidate.id) ||
        !isCanonicalAuthorPendingReview(candidate, context)
    ) {
        return undefined;
    }
    return candidate;
}
function hasBlockingAuthorPendingReview(
    pendingReviews: PullRequestReview[],
    thread: ReviewThread,
    context: ResolutionReviewContext
): boolean {
    const attachedReviewIds = attachedManagedReviewIds(thread, context);
    return pendingReviews.some(
        (review) => isAuthorBotActor(review.authorNodeId, review.authorType) && !attachedReviewIds.has(review.id)
    );
}
function retireRetirableStaleUnattachedPendingReview(
    number: number,
    threadId: string,
    working: ReviewThreadInspection,
    context: ResolutionReviewContext,
    port: ResolveReviewThreadPort
): { working: ReviewThreadInspection; deleted: boolean } {
    const stalePendingReview = findRetirableStaleUnattachedPendingReview(
        working.pendingReviews,
        working.thread!,
        context
    );
    if (stalePendingReview === undefined) {
        return { working, deleted: false };
    }
    deletePendingReviewSafely(number, stalePendingReview.id, context, port);
    const refreshed = port.inspect(number, threadId);
    assertExpectedHeadAfterMutation(refreshed.head, context.expectedHead);
    return { working: refreshed, deleted: true };
}
function convergePendingReviews(
    number: number,
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
            deletePendingReviewSafely(number, review.id, context, port);
        }
    }
    return canonical;
}
function reconcilePendingReviewsForReply(
    number: number,
    pendingReviews: PullRequestReview[],
    thread: ReviewThread | null,
    context: ResolutionReviewContext,
    port: ResolveReviewThreadPort
): boolean {
    if (thread === null) {
        fail(`review thread ${context.threadId} was not found on this pull request`);
    }
    const currentHeadCommentedReply = managedReplyMarkers(thread, context, ['COMMENTED'], false).find(
        (candidate) => candidate.currentHead
    );
    const managedPendingReviewIds = new Set(
        managedReplyMarkers(thread, context, ['PENDING'], true).map((candidate) => candidate.review.id)
    );
    const currentHeadPendingReply = managedReplyMarkers(thread, context, ['PENDING'], true).find(
        (candidate) => candidate.currentHead
    );
    let keepReviewId: string | undefined;
    if (currentHeadCommentedReply === undefined && currentHeadPendingReply !== undefined) {
        const currentHeadPendingReplyCommitOid = requireReviewCommitOid(
            currentHeadPendingReply.review,
            `Done reply ${currentHeadPendingReply.marker.id}`
        );
        if (currentHeadPendingReply.review.body === resolutionReviewBody(context, currentHeadPendingReplyCommitOid)) {
            keepReviewId = currentHeadPendingReply.review.id;
        }
    }
    let deleted = false;
    for (const review of pendingReviews) {
        if (review.id === keepReviewId) {
            continue;
        }
        if (!managedPendingReviewIds.has(review.id) && !isExactPendingReview(review, context)) {
            continue;
        }
        deletePendingReviewSafely(
            number,
            review.id,
            context,
            port,
            managedPendingReviewIds.has(review.id) ? [context.threadId] : []
        );
        deleted = true;
    }
    return deleted;
}
function deletePendingReviewSafely(
    number: number,
    reviewId: string,
    context: ResolutionReviewContext,
    port: ResolveReviewThreadPort,
    allowedAttachedThreadIds: string[] = []
): void {
    const allowedThreadIds = new Set(allowedAttachedThreadIds);
    const attachedThreadIds = [
        ...new Set(port.inspectAttachedReviewThreadIds(number, reviewId, context.expectedHead)),
    ].sort();
    const unsafeThreadIds = attachedThreadIds.filter((threadId) => !allowedThreadIds.has(threadId));
    if (unsafeThreadIds.length > 0) {
        fail(
            `pending author review ${reviewId} still has attached review-thread comments on ${unsafeThreadIds.join(', ')}`
        );
    }
    port.deletePendingReview(reviewId);
}
function deleteAmbiguousCreatedPendingReview(
    before: PullRequestReview[],
    current: PullRequestReview[],
    thread: ReviewThread | null,
    context: ResolutionReviewContext,
    _port: ResolveReviewThreadPort,
    failures: string[]
): boolean {
    const beforeIds = new Set(before.map((review) => review.id));
    const created = current.filter((review) => !beforeIds.has(review.id));
    if (created.length === 0) {
        return false;
    }
    if (
        thread !== null &&
        created.some((review) =>
            managedReplyMarkers(thread, context, ['PENDING', 'COMMENTED'], true).some(
                (candidate) => candidate.review.id === review.id
            )
        )
    ) {
        failures.push('pending review now has a managed Done reply; preserving attached review evidence');
        return true;
    }
    if (created.some((review) => isExactPendingReview(review, context))) {
        failures.push('ambiguous pending review mutation; preserving exact pending review evidence');
        return true;
    }
    failures.push('ambiguous pending review mutation; preserving newly visible pending review evidence');
    return true;
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
    assertManagedReplyMarkersReadable(thread, context, ['PENDING', 'COMMENTED'], true);
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
    const canonical = requireCanonicalManagedReplyMarker(
        thread,
        context.threadId,
        context,
        ['PENDING', 'COMMENTED'],
        false
    );
    if (canonical.review.state === 'PENDING') {
        const reviewCommitOid = requireReviewCommitOid(canonical.review, `Done reply ${canonical.marker.id}`);
        const submittedReview = port.submitReview(canonical.review.id, resolutionReviewBody(context, reviewCommitOid));
        assertReviewEnvelopeReceipt(
            submittedReview,
            submitReviewClientMutationId(canonical.review.id),
            'COMMENTED',
            resolutionReviewBody(context, reviewCommitOid),
            reviewCommitOid,
            'submit review'
        );
        thread = refresh();
    }
    const pendingReviewDeleted = reconcilePendingReviewsForReply(number, working.pendingReviews, thread, context, port);
    if (pendingReviewDeleted) {
        thread = refresh();
    }
    const retired = retireRetirableStaleUnattachedPendingReview(number, context.threadId, working, context, port);
    if (retired.deleted) {
        working = retired.working;
        thread = refresh();
    }
    const pendingReplies = managedReplyMarkers(thread, context, ['PENDING'], false);
    const currentHeadCommentedReply = managedReplyMarkers(thread, context, ['COMMENTED'], false).find(
        (candidate) => candidate.currentHead
    );
    const managedPendingReviewIdsToDelete = new Set(
        pendingReplies
            .filter(
                (candidate) => currentHeadCommentedReply !== undefined || candidate.review.id !== canonical.review.id
            )
            .map((candidate) => candidate.review.id)
    );
    if (managedPendingReviewIdsToDelete.size > 0) {
        for (const reviewId of managedPendingReviewIdsToDelete) {
            deletePendingReviewSafely(number, reviewId, context, port, [context.threadId]);
        }
        thread = refresh();
    }
    if (hasBlockingAuthorPendingReview(working.pendingReviews, thread, context)) {
        fail(`review thread ${context.threadId} has a non-reusable pending author review`);
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
        inspectAttachedReviewThreadIds: (number, reviewId, expectedHead) =>
            inspectAttachedReviewThreadIds(number, reviewId, expectedHead, gh),
        createPendingReview: (pullRequestId, commitOid, body) =>
            createPendingReview(pullRequestId, commitOid, body, gh),
        replyDone: (id, reviewId) => mutationReply(id, reviewId, gh),
        submitReview: (reviewId, body) => submitReview(reviewId, body, gh),
        updateReviewBody: (reviewId, body) => updateReviewBody(reviewId, body, gh),
        resolve: (id) => resolveThread(id, gh),
        deleteReply: (id) => deleteReply(id, gh),
        deletePendingReview: (id) => deletePendingReview(id, gh),
        serializeReviewThreadMutation: (number, threadId, expectedHead, operation) =>
            withPullRequestReviewResolutionLock(primaryRoot, number, threadId, expectedHead, operation),
        log: (message) => console.log(message),
    };
}

function pullRequestReviewResolutionLockScope(number: number): string {
    if (!Number.isSafeInteger(number) || number <= 0) {
        fail('review-resolution lock requires a positive pull-request number');
    }
    return `review resolution on PR #${number}`;
}

function pullRequestReviewResolutionLockRef(number: number): string {
    pullRequestReviewResolutionLockScope(number);
    return `refs/sourdaw/review-resolution/pr-${number}`;
}

function reviewResolutionLockGit(primaryRoot: string, args: string[], input?: string) {
    return spawnSync('git', args, {
        cwd: primaryRoot,
        encoding: 'utf8',
        shell: false,
        ...(input === undefined ? {} : { input }),
    });
}

function parseReviewResolutionLockOwner(contents: string, number: number): ReviewResolutionLockOwner {
    const scope = pullRequestReviewResolutionLockScope(number);
    let value: unknown;
    try {
        value = JSON.parse(contents) as unknown;
    } catch {
        fail(`${scope} lock ownership is malformed`);
    }
    if (
        typeof value !== 'object' ||
        value === null ||
        Object.keys(value).length !== 6 ||
        !('version' in value) ||
        value.version !== 2 ||
        !('pid' in value) ||
        typeof value.pid !== 'number' ||
        !Number.isSafeInteger(value.pid) ||
        value.pid <= 0 ||
        !('pgid' in value) ||
        typeof value.pgid !== 'number' ||
        !Number.isSafeInteger(value.pgid) ||
        value.pgid <= 0 ||
        !('threadId' in value) ||
        typeof value.threadId !== 'string' ||
        value.threadId.trim() === '' ||
        !('head' in value) ||
        typeof value.head !== 'string' ||
        !/^[0-9a-f]{40}$/iu.test(value.head) ||
        !('token' in value) ||
        typeof value.token !== 'string' ||
        !REVIEW_RESOLUTION_LOCK_TOKEN_PATTERN.test(value.token)
    ) {
        fail(`${scope} lock ownership is malformed`);
    }
    return {
        version: 2,
        pid: value.pid,
        pgid: value.pgid,
        threadId: value.threadId,
        head: canonicalGitObjectId(value.head, `${scope} lock ownership is malformed`),
        token: value.token,
    };
}

function reviewResolutionLockObjectId(value: string, number: number): string {
    const scope = pullRequestReviewResolutionLockScope(number);
    return canonicalGitObjectId(value, `${scope} lock object identity is malformed`, [40, 64]);
}

function writeReviewResolutionLockOwner(primaryRoot: string, owner: ReviewResolutionLockOwner, number: number): string {
    const result = reviewResolutionLockGit(primaryRoot, ['hash-object', '-w', '--stdin'], JSON.stringify(owner));
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        fail(`${pullRequestReviewResolutionLockScope(number)} lock owner could not be stored`);
    }
    return reviewResolutionLockObjectId(result.stdout, number);
}

function readReviewResolutionLockOid(primaryRoot: string, ref: string, number: number) {
    const result = reviewResolutionLockGit(primaryRoot, ['show-ref', '--verify', '--hash', ref]);
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status === 1) {
        return undefined;
    }
    if (result.status !== 0) {
        fail(`${pullRequestReviewResolutionLockScope(number)} lock ownership cannot be verified`);
    }
    return reviewResolutionLockObjectId(result.stdout, number);
}

function readReviewResolutionLockOwner(primaryRoot: string, oid: string, number: number): ReviewResolutionLockOwner {
    const result = reviewResolutionLockGit(primaryRoot, ['cat-file', 'blob', oid]);
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        fail(`${pullRequestReviewResolutionLockScope(number)} lock ownership cannot be verified`);
    }
    return parseReviewResolutionLockOwner(result.stdout, number);
}

function updateReviewResolutionLockRef(primaryRoot: string, args: string[]): boolean {
    const result = reviewResolutionLockGit(primaryRoot, ['update-ref', ...args]);
    if (result.error !== undefined) {
        throw result.error;
    }
    return result.status === 0;
}

function currentProcessGroupId(pid: number): number {
    if (process.platform === 'win32') {
        fail('review-resolution lock requires POSIX process-group fencing');
    }
    const result = spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], {
        encoding: 'utf8',
        shell: false,
    });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        fail('review-resolution lock could not determine the current process group');
    }
    const pgid = Number(result.stdout.trim());
    if (!Number.isSafeInteger(pgid) || pgid <= 0) {
        fail('review-resolution lock reported an invalid current process group');
    }
    return pgid;
}

function currentReviewResolutionExecutionFence(): ReviewResolutionExecutionFence {
    const pid = process.pid;
    return { pid, pgid: currentProcessGroupId(pid) };
}

async function assertDetachedReviewResolutionChild(markerValue: string): Promise<void> {
    if (process.platform === 'win32') {
        fail('review-resolution lock requires POSIX process-group fencing');
    }
    const marker = parseReviewResolutionChildLaunchMarker(markerValue);
    const { pid, pgid } = currentReviewResolutionExecutionFence();
    if (pid !== pgid) {
        fail('review:resolve must run in its own detached POSIX process group');
    }
    for (let attempt = 0; attempt < 50; attempt += 1) {
        const persisted = readPersistedReviewResolutionChildLaunchMarker(marker);
        if (persisted.pid === null) {
            await new Promise((resolve) => setTimeout(resolve, 10));
            continue;
        }
        if (persisted.pid !== pid) {
            invalidReviewResolutionChildMarker();
        }
        rmSync(marker.path, { force: true });
        return;
    }
    invalidReviewResolutionChildMarker();
}

function isLiveProcessGroup(pgid: number): boolean {
    try {
        process.kill(-pgid, 0);
        return true;
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
            return false;
        }
        if (error instanceof Error && 'code' in error && error.code === 'EPERM') {
            return true;
        }
        throw error;
    }
}

function acquirePullRequestReviewResolutionLock(
    primaryRoot: string,
    number: number,
    threadId: string,
    expectedHead: string,
    executionFence: ReviewResolutionExecutionFence
): { ref: string; oid: string } {
    const ref = pullRequestReviewResolutionLockRef(number);
    const owner: ReviewResolutionLockOwner = {
        version: 2,
        pid: executionFence.pid,
        pgid: executionFence.pgid,
        threadId,
        head: expectedHead,
        token: randomUUID(),
    };
    const oid = writeReviewResolutionLockOwner(primaryRoot, owner, number);
    if (updateReviewResolutionLockRef(primaryRoot, [ref, oid, '0'.repeat(oid.length)])) {
        return { ref, oid };
    }

    const previousOid = readReviewResolutionLockOid(primaryRoot, ref, number);
    if (previousOid === undefined) {
        return fail(`${pullRequestReviewResolutionLockScope(number)} lock could not be acquired`);
    }
    const previousOwner = readReviewResolutionLockOwner(primaryRoot, previousOid, number);
    return fail(
        `${pullRequestReviewResolutionLockScope(number)} is already being resolved by process group ${previousOwner.pgid}`
    );
}

function releasePullRequestReviewResolutionLock(primaryRoot: string, ref: string, oid: string, number: number): void {
    if (!updateReviewResolutionLockRef(primaryRoot, ['-d', ref, oid])) {
        fail(`${pullRequestReviewResolutionLockScope(number)} lock ownership changed before release`);
    }
}

export function withPullRequestReviewResolutionLock<Value>(
    primaryRoot: string,
    number: number,
    threadId: string,
    expectedHead: string,
    operation: () => Value
): Value {
    const lock = acquirePullRequestReviewResolutionLock(
        primaryRoot,
        number,
        threadId,
        expectedHead,
        currentReviewResolutionExecutionFence()
    );
    try {
        return operation();
    } finally {
        releasePullRequestReviewResolutionLock(primaryRoot, lock.ref, lock.oid, number);
    }
}

export function recoverPullRequestReviewResolutionLock<Value>(
    primaryRoot: string,
    number: number,
    expectedOwnerOid: string,
    reconcile: (owner: ReviewResolutionLockOwner) => Value,
    processGroupIsLive: (pgid: number) => boolean = isLiveProcessGroup
): Value {
    const ref = pullRequestReviewResolutionLockRef(number);
    const currentOwnerOid = readReviewResolutionLockOid(primaryRoot, ref, number);
    if (currentOwnerOid === undefined) {
        return fail(`${pullRequestReviewResolutionLockScope(number)} lock is not held`);
    }
    const expectedOid = reviewResolutionLockObjectId(expectedOwnerOid, number);
    if (currentOwnerOid !== expectedOid) {
        return fail(`${pullRequestReviewResolutionLockScope(number)} lock ownership changed before recovery`);
    }
    const owner = readReviewResolutionLockOwner(primaryRoot, currentOwnerOid, number);
    if (processGroupIsLive(owner.pgid)) {
        return fail(
            `${pullRequestReviewResolutionLockScope(number)} lock is still held by live process group ${owner.pgid}`
        );
    }
    const reconciled = reconcile(owner);
    if (!updateReviewResolutionLockRef(primaryRoot, ['-d', ref, expectedOid])) {
        return fail(`${pullRequestReviewResolutionLockScope(number)} lock ownership changed before recovery`);
    }
    return reconciled;
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
        if (pullRequestId === undefined) {
            pullRequestId = pullRequest.id;
        } else if (pullRequestId !== pullRequest.id) {
            fail(`pull-request changed while reading review threads for PR #${number}`);
        }
        const pageHead = canonicalGitObjectId(pullRequest.headRefOid, `cannot read current head for PR #${number}`);
        if (head === undefined) {
            head = pageHead;
        } else if (head !== pageHead) {
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
                    number,
                    pullRequestId,
                    head,
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
function inspectAttachedReviewThreadIds(number: number, reviewId: string, expectedHead: string, gh: Gh): string[] {
    const [owner, name] = REQUIRED_REPOSITORY.split('/');
    if (owner === undefined || name === undefined) {
        fail(`invalid GitHub repository: ${REQUIRED_REPOSITORY}`);
    }
    let cursor: string | undefined;
    const cursors = new Set<string>();
    const attachedThreadIds = new Set<string>();
    let pullRequestId: string | undefined;
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
        if (pullRequestId === undefined) {
            pullRequestId = pullRequest.id;
        } else if (pullRequestId !== pullRequest.id) {
            fail(`pull-request head changed while reading review threads for PR #${number}`);
        }
        if (
            canonicalGitObjectId(pullRequest.headRefOid, `cannot read current head for PR #${number}`) !== expectedHead
        ) {
            fail(`pull-request head changed while reading review threads for PR #${number}`);
        }
        const threads = pullRequest.reviewThreads;
        if (!Array.isArray(threads?.nodes) || typeof threads.pageInfo?.hasNextPage !== 'boolean') {
            fail(`invalid review-thread page for PR #${number}`);
        }
        for (const candidate of threads.nodes) {
            if (
                typeof candidate !== 'object' ||
                candidate === null ||
                typeof (candidate as { id?: unknown }).id !== 'string'
            ) {
                fail(`invalid review-thread page for PR #${number}`);
            }
            const thread = candidate as {
                id: string;
                isResolved?: unknown;
                resolvedBy?: { id?: unknown; login?: unknown; __typename?: unknown } | null;
            };
            if (
                inspectThreadComments(
                    number,
                    pullRequestId,
                    expectedHead,
                    thread.id,
                    thread.isResolved,
                    thread.resolvedBy?.id,
                    thread.resolvedBy?.login,
                    thread.resolvedBy?.__typename,
                    gh
                ).comments.some((comment) => comment.reviewId === reviewId)
            ) {
                attachedThreadIds.add(thread.id);
            }
        }
        if (!threads.pageInfo.hasNextPage) {
            return [...attachedThreadIds];
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
        if (pullRequest?.id !== pullRequestId || typeof pullRequest.headRefOid !== 'string') {
            fail(`pull-request head changed while reading reviews for PR #${number}`);
        }
        if (
            canonicalGitObjectId(
                pullRequest.headRefOid,
                `pull-request head changed while reading reviews for PR #${number}`
            ) !== expectedHead
        ) {
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
    number: number,
    pullRequestId: string,
    expectedHead: string,
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
        const query = `query($owner:String!,$name:String!,$number:Int!,$threadId:ID!${cursor === undefined ? '' : ',$cursor:String!'}){repository(owner:$owner,name:$name){pullRequest(number:$number){id headRefOid}} node(id:$threadId){... on PullRequestReviewThread{id ${connection}{nodes{id fullDatabaseId body author{login __typename ... on Bot{id}} pullRequestReview{id state body commit{oid} author{login __typename ... on Bot{id}}}} pageInfo{hasNextPage endCursor}}}}}`;
        const [owner, name] = REQUIRED_REPOSITORY.split('/');
        if (owner === undefined || name === undefined) {
            fail(`invalid GitHub repository: ${REQUIRED_REPOSITORY}`);
        }
        const fields = [
            '-F',
            `owner=${owner}`,
            '-F',
            `name=${name}`,
            '-F',
            `number=${number}`,
            '-F',
            `threadId=${threadId}`,
        ];
        if (cursor !== undefined) {
            fields.push('-F', `cursor=${cursor}`);
        }
        const response = graphql(gh, query, fields, `review comments for thread ${threadId}`) as {
            data?: {
                repository?: {
                    pullRequest?: {
                        id?: unknown;
                        headRefOid?: unknown;
                    } | null;
                };
                node?: {
                    id?: unknown;
                    comments?: { nodes?: unknown; pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } };
                } | null;
            };
        };
        assertExpectedPullRequestSnapshot(
            response.data?.repository?.pullRequest,
            pullRequestId,
            expectedHead,
            `pull-request head changed while reading review comments for thread ${threadId}`
        );
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
function assertExpectedPullRequestSnapshot(
    pullRequest: { id?: unknown; headRefOid?: unknown } | null | undefined,
    expectedPullRequestId: string,
    expectedHead: string,
    label: string
): void {
    if (pullRequest?.id !== expectedPullRequestId || typeof pullRequest.headRefOid !== 'string') {
        fail(label);
    }
    if (canonicalGitObjectId(pullRequest.headRefOid, label) !== expectedHead) {
        fail(label);
    }
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
        commitOid:
            typeof commitOid === 'string' ? canonicalGitObjectId(commitOid, 'invalid pull-request review') : null,
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
    if (receipt === null || responseClientMutationId !== clientMutationId) {
        fail(`submit review returned an invalid result for ${reviewId}`);
    }
    return {
        ...receipt,
        clientMutationId: responseClientMutationId,
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
export function deletePendingReview(reviewId: string, gh: Gh): void {
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

async function runResolveReviewThreadInDetachedProcess(args: string[]): Promise<number> {
    const marker = createReviewResolutionChildLaunchMarker();
    try {
        const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args], {
            cwd: process.cwd(),
            env: { ...process.env, [REVIEW_RESOLUTION_CHILD_ENV]: marker.envValue },
            stdio: 'inherit',
            shell: false,
            detached: true,
        });
        if (child.pid === undefined) {
            fail('review:resolve detached launcher could not determine the child process');
        }
        marker.bindChildPid(child.pid);
        return await new Promise<number>((resolve, reject) => {
            child.once('error', reject);
            child.once('close', (code, signal) => {
                if (code === null) {
                    reject(new Error(`review:resolve terminated by ${signal ?? 'unknown signal'}`));
                    return;
                }
                resolve(code);
            });
        });
    } finally {
        marker.cleanup();
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
    const childMarker = process.env[REVIEW_RESOLUTION_CHILD_ENV];
    if (childMarker === undefined) {
        return await runResolveReviewThreadInDetachedProcess(process.argv.slice(2));
    }
    await assertDetachedReviewResolutionChild(childMarker);
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
