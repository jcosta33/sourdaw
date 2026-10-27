import { describe, expect, it } from 'vitest';

import { ORCHESTRATOR_USER_NODE_ID, REVIEWER_BOT_NODE_ID } from '../githubAppIdentity.ts';
import {
    reconstructReviewRounds,
    type PublicReview,
    type PublicReviewComment,
    type ReviewReconstruction,
} from '../reconstructReviewRounds.ts';
import {
    REVIEW_ROUND_FREEZE_THRESHOLD,
    assertReviewRoundsBelowFreeze,
    countReviewerRequestChangesRounds,
    logReviewRoundFreezeAtThreshold,
    reviewRoundFreezeFlag,
} from '../reviewRoundEscalation.ts';

const HEAD = 'a'.repeat(40);
const PR = 42;

function reviewerReview(id: number, commitId: string, state: string): PublicReview {
    return { id, state, commitId, actorNodeId: REVIEWER_BOT_NODE_ID, body: 'round' };
}

function reconstruction(
    reviews: readonly PublicReview[],
    comments: readonly PublicReviewComment[] = []
): ReviewReconstruction {
    return reconstructReviewRounds(PR, { state: 'OPEN', head: HEAD }, reviews, comments);
}

describe('countReviewerRequestChangesRounds', () => {
    it('counts reviewer request-changes rounds and ignores approvals, orchestrator rounds and plain comments', () => {
        const reviews: PublicReview[] = [
            reviewerReview(10, HEAD, 'APPROVED'),
            reviewerReview(9, HEAD, 'CHANGES_REQUESTED'),
            { id: 8, state: 'APPROVED', commitId: HEAD, actorNodeId: ORCHESTRATOR_USER_NODE_ID, body: 'accepted' },
            reviewerReview(7, HEAD, 'CHANGES_REQUESTED'),
            { id: 6, state: 'COMMENTED', commitId: HEAD, actorNodeId: REVIEWER_BOT_NODE_ID, body: 'note' },
        ];

        expect(countReviewerRequestChangesRounds(reconstruction(reviews))).toBe(2);
    });

    it('returns zero when no reviewer round requested changes', () => {
        expect(countReviewerRequestChangesRounds(reconstruction([reviewerReview(1, HEAD, 'APPROVED')]))).toBe(0);
    });

    it('counts one review once when the history returns it twice', () => {
        const reviews: PublicReview[] = [
            reviewerReview(14, HEAD, 'CHANGES_REQUESTED'),
            reviewerReview(13, HEAD, 'CHANGES_REQUESTED'),
            reviewerReview(12, HEAD, 'CHANGES_REQUESTED'),
            reviewerReview(11, HEAD, 'CHANGES_REQUESTED'),
            reviewerReview(11, HEAD, 'CHANGES_REQUESTED'),
        ];

        expect(countReviewerRequestChangesRounds(reconstruction(reviews))).toBe(4);
    });
});

describe('assertReviewRoundsBelowFreeze', () => {
    it('pins the freeze at five reviewer request-changes rounds', () => {
        expect(REVIEW_ROUND_FREEZE_THRESHOLD).toBe(5);
    });

    it.each([0, REVIEW_ROUND_FREEZE_THRESHOLD - 1])('admits a fresh publication after %s rounds', (rounds) => {
        expect(() => assertReviewRoundsBelowFreeze(PR, rounds)).not.toThrow();
    });

    it.each([REVIEW_ROUND_FREEZE_THRESHOLD, REVIEW_ROUND_FREEZE_THRESHOLD + 3])(
        'refuses after %s rounds, telling the operator to respin and supersede',
        (rounds) => {
            expect(() => assertReviewRoundsBelowFreeze(PR, rounds)).toThrow(
                `review round freeze: PR #${PR} has taken ${rounds} reviewer request-changes rounds, at or above the freeze threshold ${REVIEW_ROUND_FREEZE_THRESHOLD}; ` +
                    'no further reviewer publication is admitted. Respin the change as one consolidated fresh pull request, ' +
                    `then close this one with pnpm pr:supersede ${PR} once the replacement merges`
            );
        }
    );
});

describe('logReviewRoundFreezeAtThreshold', () => {
    function loggedReviews(count: number): PublicReview[] {
        return Array.from({ length: count }, (_, index) => reviewerReview(index + 1, HEAD, 'CHANGES_REQUESTED'));
    }

    function messagesFor(count: number): string[] {
        const messages: string[] = [];
        logReviewRoundFreezeAtThreshold(
            PR,
            HEAD,
            () => loggedReviews(count),
            () => [],
            (message) => messages.push(message)
        );
        return messages;
    }

    it('logs nothing below the freeze', () => {
        expect(messagesFor(REVIEW_ROUND_FREEZE_THRESHOLD - 1)).toEqual([]);
    });

    it.each([REVIEW_ROUND_FREEZE_THRESHOLD, REVIEW_ROUND_FREEZE_THRESHOLD + 1])(
        'flags the freeze at %s rounds',
        (rounds) => {
            expect(messagesFor(rounds)).toEqual([reviewRoundFreezeFlag(PR, rounds)]);
            expect(messagesFor(rounds)[0]).toBe(`review-round-freeze:${PR}:request-changes=${rounds}:threshold=5`);
        }
    );

    it('swallows an unreadable history instead of refusing the repair', () => {
        const messages: string[] = [];
        logReviewRoundFreezeAtThreshold(
            PR,
            HEAD,
            () => {
                throw new Error('unreadable');
            },
            () => [],
            (message) => messages.push(message)
        );
        expect(messages).toEqual([]);
    });
});
