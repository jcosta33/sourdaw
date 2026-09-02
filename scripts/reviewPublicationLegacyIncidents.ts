import { REVIEWER_BOT_NODE_ID } from './githubAppIdentity.ts';

const failedPayload = {
    event: 'REQUEST_CHANGES' as const,
    body: 'Two blockers remain in historical terminal proof and its regression coverage.',
    comments: [
        {
            path: 'scripts/resolveReviewThread.ts',
            line: 5288,
            side: 'RIGHT' as const,
            defect: 'Markerless historical terminal proof ignores an author PENDING Done review attached to the same thread.',
            consequence:
                'Recovery can release both exact locks while an author review and duplicate resolution marker still require cleanup.',
            done: 'Require exactly one managed Done marker across PENDING and COMMENTED and no author pending reviews before terminal release.',
        },
        {
            path: 'scripts/__tests__/resolveReviewThread.spec.ts',
            line: 5810,
            side: 'RIGHT' as const,
            defect: 'The historical-path negatives do not vary review actor, database identity, body, state, or an attached PENDING marker.',
            consequence:
                'A regression weakening exact author-envelope proof or skipping pending-review cleanup could pass this suite and release both locks.',
            done: 'Add H2-owner and H1-review cases that drift each field and attach a PENDING Done review, asserting no mutation and exact lock retention.',
        },
    ],
};

export const legacyReviewPublicationIncidents = [
    {
        number: 3342,
        ownerOid: '79bd08fab83bb2c0adad067baa0204a8db17d58d',
        owner: { version: 1 as const, pid: 219213, token: '2cd01237-cf63-4579-9e58-85893794529d' },
        expectedHead: 'bc440045d47693f57a111bcf96a38d98bff00c1e',
        reviewerActorNodeId: REVIEWER_BOT_NODE_ID,
        definitiveNoMutationHttpStatus: 422 as const,
        failedPayload,
        preparedPayload: {
            ...failedPayload,
            comments: [{ ...failedPayload.comments[0], line: 5297 }, failedPayload.comments[1]],
        },
    },
] as const;
