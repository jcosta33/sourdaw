import { describe, expect, it } from 'vitest';

import { ORCHESTRATOR_USER_NODE_ID, REVIEWER_BOT_NODE_ID } from '../githubAppIdentity';
import { parseReviewDocument } from '../publishReview';
import { assertReviewerModelDiversity } from '../reviewerModelDiversity';

describe('reviewer-model diversity enforcement', () => {
    const baseDocument = {
        format: 'compact-v1' as const,
        event: 'APPROVE' as const,
        body: 'The change holds: the repair action is admitted through the gate while it holds.',
        comments: [],
        evidence: {
            headSha: 'a'.repeat(40),
            claims: [
                {
                    observable: 'The repair action dispatches through the mutation gate',
                    verification:
                        'pnpm test:run src/modules/Project/handlers/project/__tests__/handleRepairProjectData.spec.ts',
                    observed: 'all tests pass',
                },
            ],
        },
    };

    it('reports a missing reviewerModel so the diversity check cannot be silently skipped', () => {
        const document = parseReviewDocument(baseDocument);
        expect(document.reviewerModel).toBeUndefined();
    });

    it('carries the reviewerModel through parsing when present', () => {
        const document = parseReviewDocument({ ...baseDocument, reviewerModel: 'glm-5.3-flash' });
        expect(document.reviewerModel).toBe('glm-5.3-flash');
    });

    it('carries the reviewerModel through REQUEST_CHANGES parsing too', () => {
        const document = parseReviewDocument({
            event: 'REQUEST_CHANGES',
            body: 'Blocking comment below.',
            comments: [
                {
                    path: 'src/example.ts',
                    line: 1,
                    side: 'RIGHT',
                    defect: 'The null check is inverted.',
                    consequence: 'The gate never opens.',
                    done: 'Fix the comparison.',
                },
            ],
            reviewerModel: 'glm-5.3-flash',
        });
        expect(document.reviewerModel).toBe('glm-5.3-flash');
    });
});

describe('assertReviewerModelDiversity', () => {
    const authorLabel = { name: 'glm-5.3', description: 'Authored by glm-5.3' };

    it('exempts the orchestrator acceptance identity entirely', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: ORCHESTRATOR_USER_NODE_ID,
                authorLabels: [authorLabel],
                reviewerModel: undefined,
            })
        ).not.toThrow();
    });

    it('refuses a missing reviewer model for the reviewer bot', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                reviewerModel: undefined,
            })
        ).toThrow(/must carry reviewerModel/u);
    });

    it('refuses when the reviewer model equals the fence-identified authoring model', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [{ name: 'bug', description: 'Something is broken' }, authorLabel],
                reviewerModel: ' glm-5.3 ',
            })
        ).toThrow(/matches the PR's authoring model/u);
    });

    it('passes when the reviewer model differs from the authoring model', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                reviewerModel: 'glm-5.3-flash',
            })
        ).not.toThrow();
    });

    it('treats labels without the Authored-by fence as not-comparable', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [{ name: 'glm-5.3' }, { name: 'bug', description: 'Something is broken' }],
                reviewerModel: 'glm-5.3',
            })
        ).not.toThrow();
    });
});
