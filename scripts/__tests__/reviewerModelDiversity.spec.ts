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

    it('carries a single-line modelExhaustion through parsing and omits it when absent', () => {
        const document = parseReviewDocument({
            ...baseDocument,
            reviewerModel: 'glm-5.3',
            modelExhaustion: ' every other harness is logged out ',
        });
        expect(document.modelExhaustion).toBe('every other harness is logged out');
        expect(parseReviewDocument(baseDocument).modelExhaustion).toBeUndefined();
    });

    it('refuses a blank or multi-line modelExhaustion instead of trimming it silent', () => {
        expect(() => parseReviewDocument({ ...baseDocument, modelExhaustion: '   ' })).toThrow(
            /modelExhaustion must be one non-empty line/u
        );
        expect(() => parseReviewDocument({ ...baseDocument, modelExhaustion: 'first\nsecond' })).toThrow(
            /modelExhaustion must be one non-empty line/u
        );
        expect(() => parseReviewDocument({ ...baseDocument, modelExhaustion: 'first\rsecond' })).toThrow(
            /modelExhaustion must be one non-empty line/u
        );
        expect(() => parseReviewDocument({ ...baseDocument, modelExhaustion: 'first\u2028second' })).toThrow(
            /modelExhaustion must be one non-empty line/u
        );
    });

    it('refuses a non-string modelExhaustion with the framed message', () => {
        expect(() => parseReviewDocument({ ...baseDocument, modelExhaustion: 5 })).toThrow(
            /modelExhaustion must be a string/u
        );
        expect(() => parseReviewDocument({ ...baseDocument, modelExhaustion: null })).toThrow(
            /modelExhaustion must be a string/u
        );
    });
});

describe('assertReviewerModelDiversity', () => {
    const authorLabel = { name: 'glm-5.3', description: 'Authored by glm-5.3' };

    it('exempts the orchestrator acceptance identity entirely', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: ORCHESTRATOR_USER_NODE_ID,
                authorLabels: [authorLabel],
                document: { body: 'The change held.' },
            })
        ).not.toThrow();
    });

    it('refuses a missing reviewer model for the reviewer bot', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: { body: 'The change held.' },
            })
        ).toThrow(/must carry reviewerModel/u);
    });

    it('refuses when the reviewer model equals the fence-identified authoring model', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [{ name: 'bug', description: 'Something is broken' }, authorLabel],
                document: { reviewerModel: ' glm-5.3 ', body: 'The change held.' },
            })
        ).toThrow(/matches one of the PR's authoring models/u);
    });

    it('refuses when the reviewer model matches any fenced authoring model, not just the first', () => {
        // lane:publish metadata edits are add-only, so republishing with a different --model
        // leaves the previous fenced label on the PR; matching either fence must refuse.
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [
                    { name: 'glm-5.3', description: 'Authored by glm-5.3' },
                    { name: 'bug', description: 'Something is broken' },
                    { name: 'glm-5.3-flash', description: 'Authored by glm-5.3-flash' },
                ],
                document: { reviewerModel: 'glm-5.3-flash', body: 'The change held.' },
            })
        ).toThrow(/matches one of the PR's authoring models/u);
    });

    it('passes when the reviewer model differs from the authoring model', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: { reviewerModel: 'glm-5.3-flash', body: 'The change held.' },
            })
        ).not.toThrow();
    });

    it('treats labels without the Authored-by fence as not-comparable', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [{ name: 'glm-5.3' }, { name: 'bug', description: 'Something is broken' }],
                document: { reviewerModel: 'glm-5.3', body: 'The change held.' },
            })
        ).not.toThrow();
    });

    it('admits the same-model fallback when exhaustion is recorded and the body names the reviewer model', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: {
                    reviewerModel: 'glm-5.3',
                    modelExhaustion: 'every other harness on this machine is logged out or broken',
                    body: 'Reviewed on glm-5.3 under the same-model fallback after every other harness was unavailable.',
                },
            })
        ).not.toThrow();
    });

    it('refuses the same-model review without a recorded exhaustion', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: { reviewerModel: 'glm-5.3', body: 'Reviewed on glm-5.3.' },
            })
        ).toThrow(/matches one of the PR's authoring models/u);
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: { reviewerModel: 'glm-5.3', modelExhaustion: '   ', body: 'Reviewed on glm-5.3.' },
            })
        ).toThrow(/matches one of the PR's authoring models/u);
    });

    it('refuses the fallback when the published body does not name the reviewer model', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: {
                    reviewerModel: 'glm-5.3',
                    modelExhaustion: 'every other harness on this machine is logged out or broken',
                    body: 'The change held under attack.',
                },
            })
        ).toThrow(/naming the reviewer model/u);
    });

    it('refuses the fallback when the body names only a longer model sharing the prefix', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: {
                    reviewerModel: 'glm-5.3',
                    modelExhaustion: 'every other harness on this machine is logged out or broken',
                    body: 'Reviewed on glm-5.3-flash under the same-model fallback.',
                },
            })
        ).toThrow(/naming the reviewer model/u);
    });

    it('admits the fallback when the body names the reviewer model as a standalone token', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: {
                    reviewerModel: 'glm-5.3',
                    modelExhaustion: 'every other harness on this machine is logged out or broken',
                    body: 'Same-model fallback: reviewed on glm-5.3, with glm-5.3-flash unavailable.',
                },
            })
        ).not.toThrow();
    });

    it('ignores a recorded exhaustion when the reviewer model already differs', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: {
                    reviewerModel: 'glm-5.3-flash',
                    modelExhaustion: 'stale field from an earlier round',
                    body: 'The change held under attack.',
                },
            })
        ).not.toThrow();
    });
});
