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

    it('admits the fallback when the standalone naming follows an embedded occurrence', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: {
                    reviewerModel: 'glm-5.3',
                    modelExhaustion: 'every other harness on this machine is logged out or broken',
                    body: 'glm-5.3-flash was unavailable; fell back to glm-5.3 for this review',
                },
            })
        ).not.toThrow();
    });

    it('refuses the fallback when the only occurrence extends the model with a token character', () => {
        for (const body of ['only glm-5.3.1 was named', 'only glm-5.3+edge was named', 'only xglm-5.3 was named']) {
            expect(() =>
                assertReviewerModelDiversity({
                    actorNodeId: REVIEWER_BOT_NODE_ID,
                    authorLabels: [authorLabel],
                    document: {
                        reviewerModel: 'glm-5.3',
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
                    reviewerModel: 'glm-5.3-flash',
                    modelExhaustion: 'stale field from an earlier round',
                    body: 'The change held under attack.',
                },
            })
        ).not.toThrow();
    });
});

describe('assertReviewerModelDiversity per-draw records', () => {
    const authorLabel = { name: 'glm-5.3', description: 'Authored by glm-5.3' };

    it('refuses a draw on an authoring model without its own exhaustion, naming the stance and model', () => {
        // The composing model here differs from every author, so only the per-draw record can
        // catch this draw: the refusal must name the stance, which the document-level rule cannot.
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: { reviewerModel: 'claude-opus-4.5', body: 'The change held.' },
                stanceDraws: [
                    { stance: 'test-validity', reviewerModel: 'claude-opus-4.5' },
                    { stance: 'correctness', reviewerModel: 'glm-5.3' },
                ],
            })
        ).toThrow(/review stance "correctness" drew reviewer model "glm-5\.3", which matches/u);
    });

    it('refuses a draw whose exhaustion is blank as if it carried none', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: { reviewerModel: 'claude-opus-4.5', body: 'The change held.' },
                stanceDraws: [{ stance: 'correctness', reviewerModel: 'glm-5.3', exhaustion: '   ' }],
            })
        ).toThrow(/review stance "correctness" drew reviewer model "glm-5\.3"/u);
    });

    it('admits draws whose models differ from every authoring model without exhaustion', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: { reviewerModel: 'claude-opus-4.5', body: 'The change held.' },
                stanceDraws: [
                    { stance: 'correctness', reviewerModel: 'claude-opus-4.5' },
                    { stance: 'test-validity', reviewerModel: 'glm-5.3-flash' },
                ],
            })
        ).not.toThrow();
    });

    it('admits a draw on an authoring model that carries its own exhaustion', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: { reviewerModel: 'claude-opus-4.5', body: 'The change held.' },
                stanceDraws: [
                    { stance: 'correctness', reviewerModel: 'glm-5.3', exhaustion: 'every other harness was down' },
                ],
            })
        ).not.toThrow();
    });

    it('admits the mixed round: document model on an author fence, one draw on that model exhausted, no document-level field', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: {
                    reviewerModel: 'glm-5.3',
                    body: 'Mixed round: test-validity ran on claude-opus-4.5; correctness fell back to glm-5.3, the only harness left.',
                },
                stanceDraws: [
                    { stance: 'test-validity', reviewerModel: 'claude-opus-4.5' },
                    { stance: 'correctness', reviewerModel: 'glm-5.3', exhaustion: 'every other harness was down' },
                ],
            })
        ).not.toThrow();
    });

    it('still requires the mixed round to name the reviewer model in the body', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: { reviewerModel: 'glm-5.3', body: 'The change held under attack.' },
                stanceDraws: [
                    { stance: 'correctness', reviewerModel: 'glm-5.3', exhaustion: 'every other harness was down' },
                ],
            })
        ).toThrow(/naming the reviewer model/u);
    });

    it('keeps the document-level refusal when draws exist but none on the document model carries exhaustion', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: { reviewerModel: 'glm-5.3', body: 'Reviewed on glm-5.3.' },
                stanceDraws: [{ stance: 'correctness', reviewerModel: 'claude-opus-4.5' }],
            })
        ).toThrow(/matches one of the PR's authoring models/u);
    });

    it('admits a draw on the authoring model carrying its own exhaustion alongside the document-level field', () => {
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: {
                    reviewerModel: 'glm-5.3',
                    modelExhaustion: 'every other harness on this machine is logged out or broken',
                    body: 'Reviewed on glm-5.3 under the same-model fallback after every other harness was unavailable.',
                },
                stanceDraws: [
                    { stance: 'correctness', reviewerModel: 'glm-5.3', exhaustion: 'no other model offered' },
                ],
            })
        ).not.toThrow();
    });

    it('admits a bare authoring-model draw only under a present, non-blank document-level whole-round exhaustion', () => {
        // The document-level whole-round fallback covers every draw, so the draw needs no
        // exhaustion of its own; a blank field covers nothing and the refusal names the stance.
        const stanceDraws = [{ stance: 'correctness', reviewerModel: 'glm-5.3' }];
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: {
                    reviewerModel: 'glm-5.3',
                    modelExhaustion: 'every other harness on this machine is logged out or broken',
                    body: 'Reviewed on glm-5.3 under the whole-round fallback after every other harness was unavailable.',
                },
                stanceDraws,
            })
        ).not.toThrow();
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: {
                    reviewerModel: 'claude-opus-4.5',
                    modelExhaustion: '   ',
                    body: 'The change held under attack.',
                },
                stanceDraws,
            })
        ).toThrow(/review stance "correctness" drew reviewer model "glm-5\.3"/u);
    });

    it('refuses naming the stance when an off-fence draw refutes the whole-round field', () => {
        // The document-level field claims every draw fell back, but a dispatched draw on a
        // non-author model refutes that claim; the bare author-model draw is undisclosed.
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: {
                    reviewerModel: 'glm-5.3',
                    modelExhaustion: 'every other harness on this machine is logged out or broken',
                    body: 'Reviewed on glm-5.3 under the whole-round fallback after every other harness was unavailable.',
                },
                stanceDraws: [
                    { stance: 'correctness', reviewerModel: 'glm-5.3' },
                    { stance: 'test-validity', reviewerModel: 'claude-opus-4.5' },
                ],
            })
        ).toThrow(/review stance "correctness" drew reviewer model "glm-5\.3"/u);
    });

    it('refuses naming the stance when the whole-round field is stale on a document model off the fence', () => {
        // The document reviewer model differs from every author, so the document-level field is
        // inert baggage, not a live whole-round fallback; the bare author-model draw is undisclosed.
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: {
                    reviewerModel: 'claude-opus-4.5',
                    modelExhaustion: 'every other harness on this machine is logged out or broken',
                    body: 'The change held under attack.',
                },
                stanceDraws: [{ stance: 'correctness', reviewerModel: 'glm-5.3' }],
            })
        ).toThrow(/review stance "correctness" drew reviewer model "glm-5\.3"/u);
    });

    it('refuses naming the stance when a blank field sits on an otherwise whole-round record', () => {
        // Pins the field conjunct: with the document model fenced and every draw on the fences,
        // only the blank field keeps the whole-round arm off, so the bare draw is undisclosed.
        expect(() =>
            assertReviewerModelDiversity({
                actorNodeId: REVIEWER_BOT_NODE_ID,
                authorLabels: [authorLabel],
                document: {
                    reviewerModel: 'glm-5.3',
                    modelExhaustion: '   ',
                    body: 'The change held under attack.',
                },
                stanceDraws: [{ stance: 'correctness', reviewerModel: 'glm-5.3' }],
            })
        ).toThrow(/review stance "correctness" drew reviewer model "glm-5\.3"/u);
    });
});
