/**
 * The hard bound on the reviewer change-request repair loop (ADR 0054): once a pull request's public
 * history holds `REVIEW_ROUND_FREEZE_THRESHOLD` reviewer `REQUEST_CHANGES` rounds, no fresh reviewer
 * publication is admitted on it, whatever the bundle carries. No caller document lifts the freeze;
 * the change is respun as a fresh pull request. The repair and confirmation paths are never gated,
 * so unresolved threads always stay resolvable.
 *
 * Pure by construction: counting takes data, never a live session.
 */

import { REVIEWER_BOT_NODE_ID } from './githubAppIdentity.ts';
import { fail } from './prContract.ts';
import {
    reconstructReviewRounds,
    type PublicReview,
    type PublicReviewComment,
    type ReviewReconstruction,
} from './reconstructReviewRounds.ts';

export const REVIEW_ROUND_FREEZE_THRESHOLD = 10;

/**
 * The reviewer `REQUEST_CHANGES` rounds in a reconstruction — rounds, never findings. A round is its
 * review, so the same review appearing twice, as a paginated read can return it, counts once.
 */
export function countReviewerRequestChangesRounds(reconstruction: ReviewReconstruction): number {
    return reviewerRequestChangesReviewIds(reconstruction).size;
}

function reviewerRequestChangesReviewIds(reconstruction: ReviewReconstruction): Set<number> {
    const reviews = new Set<number>();
    for (const round of reconstruction.rounds) {
        if (round.role === 'reviewer' && round.verdict === 'changes-requested') {
            reviews.add(round.reviewId);
        }
    }
    return reviews;
}

/**
 * The reviewer request-changes rounds the public history holds, the one count every freeze reader
 * uses. A dismissed reviewer review that owns an inline comment still counts: `review:publish`
 * refuses an approval with comments and a request for changes without one, so only a request for
 * changes leaves that shape, and dismissing it must not lower the count. A dismissed comment-less
 * review is an approval a later push made stale, and stays uncounted.
 */
export function countReviewerRequestChangesRoundsInHistory(
    number: number,
    pullRequest: { state: string; head: string },
    reviews: readonly PublicReview[],
    comments: readonly PublicReviewComment[]
): number {
    const rounds = reviewerRequestChangesReviewIds(reconstructReviewRounds(number, pullRequest, reviews, comments));
    const commentedReviews = new Set(comments.map((comment) => comment.reviewId));
    for (const review of reviews) {
        if (
            review.state === 'DISMISSED' &&
            review.actorNodeId === REVIEWER_BOT_NODE_ID &&
            commentedReviews.has(review.id)
        ) {
            rounds.add(review.id);
        }
    }
    return rounds.size;
}

export function reviewRoundFreezeFlag(number: number, observed: number | 'unreadable'): string {
    return `review-round-freeze:${number}:request-changes=${observed}:threshold=${REVIEW_ROUND_FREEZE_THRESHOLD}`;
}

/** Refuses a fresh reviewer publication on a pull request that has reached the freeze. */
export function assertReviewRoundsBelowFreeze(number: number, observedCount: number): void {
    if (observedCount < REVIEW_ROUND_FREEZE_THRESHOLD) {
        return;
    }
    fail(
        `review round freeze: PR #${number} has taken ${observedCount} reviewer request-changes rounds, at or above the freeze threshold ${REVIEW_ROUND_FREEZE_THRESHOLD}; ` +
            'no further reviewer publication is admitted. Respin the change as one consolidated fresh pull request, ' +
            `then close this one with pnpm pr:supersede ${number} once the replacement merges`
    );
}

/**
 * Logs the freeze flag when the observed reviewer request-changes rounds reach the threshold.
 * Advisory by design: the repair path must never refuse on an unreadable public history, so both a
 * missing reader and a failed reconstruction are swallowed rather than thrown.
 */
export function logReviewRoundFreezeAtThreshold(
    number: number,
    head: string,
    reviews: ((number: number) => PublicReview[]) | undefined,
    comments: ((number: number) => PublicReviewComment[]) | undefined,
    log: (message: string) => void
): void {
    try {
        if (reviews === undefined || comments === undefined) {
            return;
        }
        const requestChanges = countReviewerRequestChangesRoundsInHistory(
            number,
            { state: 'OPEN', head },
            reviews(number),
            comments(number)
        );
        if (requestChanges >= REVIEW_ROUND_FREEZE_THRESHOLD) {
            log(reviewRoundFreezeFlag(number, requestChanges));
        }
    } catch {
        // Never refuse a repair because the public round history was unreadable.
    }
}
