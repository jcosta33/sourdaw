import { describe, expect, it } from 'vitest';

import { parseReviewDocument } from '../publishReview';

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
                    verification: 'pnpm test:run src/modules/Project/handlers/project/__tests__/handleRepairProjectData.spec.ts',
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
