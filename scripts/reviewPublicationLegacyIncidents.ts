import { REVIEWER_BOT_NODE_ID } from './githubAppIdentity.ts';

type LegacyReviewComment = {
    path: string;
    line: number;
    side: 'LEFT' | 'RIGHT';
    defect: string;
    consequence: string;
    done: string;
};

type LegacyReviewPublicationIncident = {
    number: number;
    ownerOid: string;
    owner: { version: 1; pid: number; token: string };
    expectedHead: string;
    reviewerActorNodeId: string;
    definitiveNoMutationHttpStatus: 422;
    failedPayload: { event: 'REQUEST_CHANGES'; body: string; comments: LegacyReviewComment[] };
    preparedPayload: { event: 'REQUEST_CHANGES'; body: string; comments: LegacyReviewComment[] };
};

const failedReviewComment: LegacyReviewComment = {
    path: 'scripts/resolveReviewThread.ts',
    line: 5288,
    side: 'RIGHT',
    defect: 'Markerless historical terminal proof ignores an author PENDING Done review attached to the same thread.',
    consequence:
        'Recovery can release both exact locks while an author review and duplicate resolution marker still require cleanup.',
    done: 'Require exactly one managed Done marker across PENDING and COMMENTED and no author pending reviews before terminal release.',
};

const failedCoverageComment: LegacyReviewComment = {
    path: 'scripts/__tests__/resolveReviewThread.spec.ts',
    line: 5810,
    side: 'RIGHT',
    defect: 'The historical-path negatives do not vary review actor, database identity, body, state, or an attached PENDING marker.',
    consequence:
        'A regression weakening exact author-envelope proof or skipping pending-review cleanup could pass this suite and release both locks.',
    done: 'Add H2-owner and H1-review cases that drift each field and attach a PENDING Done review, asserting no mutation and exact lock retention.',
};

const failedPayload: LegacyReviewPublicationIncident['failedPayload'] = {
    event: 'REQUEST_CHANGES',
    body: 'Two blockers remain in historical terminal proof and its regression coverage.',
    comments: [failedReviewComment, failedCoverageComment],
};

export const legacyReviewPublicationIncidents: readonly [LegacyReviewPublicationIncident] = [
    {
        number: 3342,
        ownerOid: '79bd08fab83bb2c0adad067baa0204a8db17d58d',
        owner: { version: 1, pid: 219213, token: '2cd01237-cf63-4579-9e58-85893794529d' },
        expectedHead: 'bc440045d47693f57a111bcf96a38d98bff00c1e',
        reviewerActorNodeId: REVIEWER_BOT_NODE_ID,
        definitiveNoMutationHttpStatus: 422,
        failedPayload,
        preparedPayload: {
            ...failedPayload,
            comments: [{ ...failedReviewComment, line: 5297 }, failedCoverageComment],
        },
    },
];
