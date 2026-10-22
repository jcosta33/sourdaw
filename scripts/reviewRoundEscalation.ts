/**
 * The hard bound on the reviewer change-request repair loop (ADR 0054): once a pull request's public
 * history holds `REVIEW_ROUND_FREEZE_THRESHOLD` reviewer `REQUEST_CHANGES` rounds, no fresh reviewer
 * publication is admitted on it, whatever the bundle carries. No caller document lifts the freeze;
 * the change is respun as a fresh pull request. The repair and confirmation paths are never gated,
 * so unresolved threads always stay resolvable.
 *
 * Pure by construction: counting takes data, never a live session.
 */

import { fail } from './prContract.ts';
import {
    reconstructReviewRounds,
    type PublicReview,
    type PublicReviewComment,
    type ReviewReconstruction,
} from './reconstructReviewRounds.ts';

export const REVIEW_ROUND_FREEZE_THRESHOLD = 5;

/**
 * The reviewer `REQUEST_CHANGES` rounds in a reconstruction — rounds, never findings. A round is its
 * review, so the same review appearing twice, as a paginated read can return it, counts once.
 */
export function countReviewerRequestChangesRounds(reconstruction: ReviewReconstruction): number {
    const reviews = new Set<number>();
    for (const round of reconstruction.rounds) {
        if (round.role === 'reviewer' && round.verdict === 'changes-requested') {
            reviews.add(round.reviewId);
        }
    }
    return reviews.size;
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
        const reconstruction = reconstructReviewRounds(
            number,
            { state: 'OPEN', head },
            reviews(number),
            comments(number)
        );
        const requestChanges = countReviewerRequestChangesRounds(reconstruction);
        if (requestChanges >= REVIEW_ROUND_FREEZE_THRESHOLD) {
            log(reviewRoundFreezeFlag(number, requestChanges));
        }
    } catch {
        // Never refuse a repair because the public round history was unreadable.
    }
}
