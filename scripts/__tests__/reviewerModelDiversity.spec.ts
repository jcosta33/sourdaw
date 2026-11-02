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
        const document = parseReviewDocument({ ...baseDocument, reviewerModel: 'review-model' });
        expect(document.reviewerModel).toBe('review-model');
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
            reviewerModel: 'review-model',
        });
        expect(document.reviewerModel).toBe('review-model');
    });

    it('carries a single-line modelExhaustion through parsing and omits it when absent', () => {
        const document = parseReviewDocument({
            ...baseDocument,
            reviewerModel: 'review-model',
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
        expect(() => parseReviewDocument({ ...baseDocument, modelExhaustion: 'first\u2029second' })).toThrow(
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
    const authorLabel = { name: 'review-model', description: 'Authored by review-model' };

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
                document: { reviewerModel: ' review-model ', body: 'The change held.' },
            })
        ).toThrow(/matches one of the PR's authoring models/u);
    });

    it('refuses when the reviewer model matches any fenced authoring model, not just the first', () => {
        // The check reads the live label set: a pull request last republished before the fence
        // reconciliation (#4296), or an unconverged partial metadata write, can still wear
        // several fences, so matching any fence present must refuse.
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [
                    { name: 'review-model', description: 'Authored by review-model' },
                    { name: 'bug', description: 'Something is broken' },
                    { name: 'review-model-two', description: 'Authored by review-model-two' },
                ],
                document: { reviewerModel: 'review-model-two', body: 'The change held.' },
            })
        ).toThrow(/matches one of the PR's authoring models/u);
    });

    it('passes when the reviewer model differs from the authoring model', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: { reviewerModel: 'review-model-two', body: 'The change held.' },
            })
        ).not.toThrow();
    });

    it('treats labels without the Authored-by fence as not-comparable', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [{ name: 'review-model' }, { name: 'bug', description: 'Something is broken' }],
                document: { reviewerModel: 'review-model', body: 'The change held.' },
            })
        ).not.toThrow();
    });

    it('admits the same-model fallback when exhaustion is recorded and the body names the reviewer model', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: {
                    reviewerModel: 'review-model',
                    modelExhaustion: 'every other harness on this machine is logged out or broken',
                    body: 'Reviewed on review-model under the same-model fallback after every other harness was unavailable.',
                },
            })
        ).not.toThrow();
    });

    it('refuses the same-model review without a recorded exhaustion', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: { reviewerModel: 'review-model', body: 'Reviewed on review-model.' },
            })
        ).toThrow(/matches one of the PR's authoring models/u);
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: { reviewerModel: 'review-model', modelExhaustion: '   ', body: 'Reviewed on review-model.' },
            })
        ).toThrow(/matches one of the PR's authoring models/u);
    });

    it('refuses the fallback when the published body does not name the reviewer model', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: {
                    reviewerModel: 'review-model',
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
                    reviewerModel: 'review-model',
                    modelExhaustion: 'every other harness on this machine is logged out or broken',
                    body: 'Reviewed on review-model-pro under the same-model fallback.',
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
                    reviewerModel: 'review-model',
                    modelExhaustion: 'every other harness on this machine is logged out or broken',
                    body: 'Same-model fallback: reviewed on review-model, with review-model-two unavailable.',
                },
            })
        ).not.toThrow();
    });

    it('admits the fallback when the standalone naming follows an embedded occurrence', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: {
                    reviewerModel: 'review-model',
                    modelExhaustion: 'every other harness on this machine is logged out or broken',
                    body: 'review-model-pro was unavailable; fell back to review-model for this review',
                },
            })
        ).not.toThrow();
    });

    it('refuses the fallback when the only occurrence extends the model with a token character', () => {
        for (const body of [
            'only review-model.1 was named',
            'only review-model+edge was named',
            'only xreview-model was named',
        ]) {
            expect(() =>
                assertReviewerModelDiversity({
                    actorNodeId: REVIEWER_BOT_NODE_ID,
                    authorLabels: [authorLabel],
                    document: {
                        reviewerModel: 'review-model',
                        modelExhaustion: 'every other harness on this machine is logged out or broken',
                        body,
                    },
                })
            ).toThrow(/naming the reviewer model/u);
        }
    });

    it('ignores a recorded exhaustion when the reviewer model already differs', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: {
                    reviewerModel: 'review-model-two',
                    modelExhaustion: 'stale field from an earlier round',
                    body: 'The change held under attack.',
                },
            })
        ).not.toThrow();
    });
});

describe('assertReviewerModelDiversity draw records', () => {
    const authorLabel = { name: 'review-model', description: 'Authored by review-model' };

    it('refuses a draw on an authoring model when the document carries no exhaustion', () => {
        // The document reviewer model differs from every author, so only the draw can trip the rule.
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: {
                    reviewerModel: 'review-model-two',
                    body: 'The change held.',
                    draws: [
                        { stance: 'test-validity', reviewerModel: 'review-model-two', tier: 'standard' },
                        { stance: 'correctness', reviewerModel: 'review-model', tier: 'standard' },
                    ],
                },
            })
        ).toThrow(/reviewer model "review-model" matches one of the PR's authoring models/u);
    });

    it('refuses a disclosed authoring-model draw whose model the body never names', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: {
                    reviewerModel: 'review-model-two',
                    modelExhaustion: 'every other harness was down',
                    body: 'The change held.',
                    draws: [{ stance: 'correctness', reviewerModel: 'review-model', tier: 'standard' }],
                },
            })
        ).toThrow(/naming the reviewer model "review-model"/u);
    });

    it('admits draws whose models differ from every authoring model without exhaustion', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: {
                    reviewerModel: 'review-model-two',
                    body: 'The change held.',
                    draws: [
                        { stance: 'correctness', reviewerModel: 'review-model-two', tier: 'standard' },
                        { stance: 'test-validity', reviewerModel: 'review-model-two', tier: 'economy' },
                    ],
                },
            })
        ).not.toThrow();
    });

    it('admits an authoring-model draw disclosed by the document exhaustion and named in the body', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: {
                    reviewerModel: 'review-model-two',
                    modelExhaustion: 'every other harness was down for the correctness draw',
                    body: 'Correctness fell back to review-model, the only harness left; the change held.',
                    draws: [
                        { stance: 'test-validity', reviewerModel: 'review-model-two', tier: 'standard' },
                        { stance: 'correctness', reviewerModel: 'review-model', tier: 'standard' },
                    ],
                },
            })
        ).not.toThrow();
    });
});

describe('fresh review tier rule', () => {
    const authorLabel = { name: 'review-model', description: 'Authored by review-model' };

    function admit(reviewerModel: string, draws?: { stance: string; reviewerModel: string; tier?: string }[]): void {
        assertReviewerModelDiversity({
            actorNodeId: REVIEWER_BOT_NODE_ID,
            authorLabels: [authorLabel],
            document: { reviewerModel, body: 'The boundary held under attack.', draws },
        });
    }

    it.each(['strongest', 'frontier', ''])('refuses a draw at tier %s by the tier rule alone', (tier) => {
        expect(() =>
            admit('review-model-two', [{ stance: 'lost identity', reviewerModel: 'review-model-two', tier }])
        ).toThrow(/must use economy or standard review tier/u);
    });

    it('refuses a draw that records no tier', () => {
        expect(() =>
            admit('review-model-two', [{ stance: 'lost identity', reviewerModel: 'review-model-two' }])
        ).toThrow(/must use economy or standard review tier/u);
    });

    it('names only the tier rule when it refuses a draw', () => {
        let message = '';
        try {
            admit('review-model-two', [
                { stance: 'lost identity', reviewerModel: 'review-model-two', tier: 'strongest' },
            ]);
        } catch (error) {
            message = (error as Error).message;
        }
        expect(message).toBe(
            'review.json draws[0] must use economy or standard review tier; strongest is historical metadata only'
        );
    });

    it('checks every draw’s tier even when the preceding draws are admitted', () => {
        expect(() =>
            admit('review-model-two', [
                { stance: 'lost identity', reviewerModel: 'review-model-two', tier: 'economy' },
                { stance: 'lost head binding', reviewerModel: 'review-model-two', tier: 'strongest' },
            ])
        ).toThrow(/draws\[1\].*economy or standard/u);
    });

    it('admits the same-model fallback when exhaustion is recorded and the body names the model', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: {
                    reviewerModel: 'review-model',
                    body: 'Reviewed on review-model after every other model was unavailable.',
                    modelExhaustion: 'Every other configured model was unavailable.',
                },
            })
        ).not.toThrow();
    });

    it('does not let modelExhaustion waive the tier rule', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: {
                    reviewerModel: 'review-model',
                    body: 'Reviewed on review-model after other models were unavailable.',
                    modelExhaustion: 'All permitted review models were unavailable.',
                    draws: [{ stance: 'lost identity', reviewerModel: 'review-model', tier: 'strongest' }],
                },
            })
        ).toThrow(/economy or standard/u);
    });
});
