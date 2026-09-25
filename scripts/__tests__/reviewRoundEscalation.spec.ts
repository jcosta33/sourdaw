import { describe, expect, it } from 'vitest';

import { ORCHESTRATOR_USER_NODE_ID, REVIEWER_BOT_NODE_ID } from '../githubAppIdentity.ts';
import {
    reconstructReviewRounds,
    type PublicReview,
    type PublicReviewComment,
    type ReviewReconstruction,
} from '../reconstructReviewRounds.ts';
import {
    REVIEW_ROUND_ESCALATION_THRESHOLD,
    countReviewerRequestChangesRounds,
    gateReviewRoundEscalation,
    parseReviewReassessment,
} from '../reviewRoundEscalation.ts';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const PR = 42;
const BUNDLE = `/repo/.agents/review-bundles/${PR}-${HEAD}`;

function reviewerReview(id: number, commitId: string, state: string): PublicReview {
    return { id, state, commitId, actorNodeId: REVIEWER_BOT_NODE_ID, body: 'round' };
}

function reconstruction(
    reviews: readonly PublicReview[],
    comments: readonly PublicReviewComment[] = []
): ReviewReconstruction {
    return reconstructReviewRounds(PR, { state: 'OPEN', head: HEAD }, reviews, comments);
}

function reassessment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        format: 'reassessment-v1',
        pr: PR,
        headSha: HEAD,
        baseSha: BASE,
        roundsObserved: REVIEW_ROUND_ESCALATION_THRESHOLD,
        threshold: REVIEW_ROUND_ESCALATION_THRESHOLD,
        action: 'continue',
        reason: 're-scoped the change and re-dispatched the remaining stances',
        ...overrides,
    };
}

function gate(observedCount: number, value: unknown): ReturnType<typeof gateReviewRoundEscalation> {
    return gateReviewRoundEscalation({
        observedCount,
        pr: PR,
        headSha: HEAD,
        baseSha: BASE,
        bundle: BUNDLE,
        reassessment: value === undefined ? { present: false } : { present: true, value },
    });
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
});

describe('parseReviewReassessment', () => {
    it('round-trips a valid reassessment', () => {
        expect(parseReviewReassessment(reassessment())).toEqual({
            format: 'reassessment-v1',
            pr: PR,
            headSha: HEAD,
            baseSha: BASE,
            roundsObserved: REVIEW_ROUND_ESCALATION_THRESHOLD,
            threshold: REVIEW_ROUND_ESCALATION_THRESHOLD,
            action: 'continue',
            reason: 're-scoped the change and re-dispatched the remaining stances',
        });
    });

    it('refuses a wrong format', () => {
        expect(() => parseReviewReassessment(reassessment({ format: 'reassessment-v2' }))).toThrow(
            /format must be reassessment-v1/
        );
    });

    it('refuses a threshold that disagrees with the constant', () => {
        expect(() => parseReviewReassessment(reassessment({ threshold: 2 }))).toThrow(
            /threshold 2 does not match the escalation threshold 3/
        );
    });

    it('refuses an unknown action and names the allowed actions', () => {
        expect(() => parseReviewReassessment(reassessment({ action: 'rebase' }))).toThrow(
            /action must be one of split, respec, continue/
        );
    });

    it('refuses a blank reason', () => {
        expect(() => parseReviewReassessment(reassessment({ reason: '   ' }))).toThrow(
            /reason must be a non-blank string/
        );
    });

    it('refuses a credential-shaped reason', () => {
        expect(() => parseReviewReassessment(reassessment({ reason: `ghp_${'A'.repeat(24)}` }))).toThrow(
            /reason value at index 0 contains a GitHub token/
        );
    });

    it('refuses a non-object value', () => {
        expect(() => parseReviewReassessment('reassessment-v1')).toThrow(/must be an object/);
    });
});

describe('gateReviewRoundEscalation', () => {
    it('requires nothing below the threshold, even without a reassessment file', () => {
        expect(gate(REVIEW_ROUND_ESCALATION_THRESHOLD - 1, undefined)).toBeUndefined();
    });

    it('returns the parsed reassessment when the threshold is met and the file binds exactly', () => {
        expect(gate(REVIEW_ROUND_ESCALATION_THRESHOLD, reassessment())).toEqual(
            parseReviewReassessment(reassessment())
        );
    });

    it('refuses a missing file above the threshold, naming the observed count, threshold, path and actions', () => {
        expect(() => gate(REVIEW_ROUND_ESCALATION_THRESHOLD, undefined)).toThrow(
            new RegExp(
                `observed ${REVIEW_ROUND_ESCALATION_THRESHOLD} reviewer request-changes rounds.*threshold ${REVIEW_ROUND_ESCALATION_THRESHOLD}.*${BUNDLE}/reassessment.json.*split, respec, continue`
            )
        );
    });

    it.each([
        ['pr', { pr: PR + 1 }, /pr 43 does not match pull request 42/],
        ['headSha', { headSha: 'c'.repeat(40) }, /headSha c{40} does not match the live head a{40}/],
        ['baseSha', { baseSha: 'd'.repeat(40) }, /baseSha d{40} does not match the bundle baseSha b{40}/],
        [
            'roundsObserved',
            { roundsObserved: REVIEW_ROUND_ESCALATION_THRESHOLD - 1 },
            /roundsObserved 2 does not match the observed 3/,
        ],
    ])('refuses a rebound %s above the threshold', (_label, overrides, message) => {
        expect(() => gate(REVIEW_ROUND_ESCALATION_THRESHOLD, reassessment(overrides))).toThrow(message);
    });

    it('refuses an unknown action above the threshold', () => {
        expect(() => gate(REVIEW_ROUND_ESCALATION_THRESHOLD, reassessment({ action: 'rebase' }))).toThrow(
            /action must be one of split, respec, continue/
        );
    });

    it('refuses an unsafe reason above the threshold', () => {
        expect(() =>
            gate(REVIEW_ROUND_ESCALATION_THRESHOLD, reassessment({ reason: `ghp_${'A'.repeat(24)}` }))
        ).toThrow(/reason value at index 0 contains a GitHub token/);
    });
});
