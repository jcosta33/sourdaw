import { describe, expect, it } from 'vitest';

import { assembleReviewDossier } from '../reviewDossier.ts';
import {
    assertSemanticAssessmentAcknowledged,
    parseSemanticAssessmentCoverage,
} from '../reviewDossierSemanticAssessment.ts';
import { SEMANTIC_CI_FORMAT } from '../semanticReviewContext.ts';

import type { AssessmentImpact, ReviewDossier, ReviewDossierEvent } from '../reviewDossier.ts';
import type { ReviewRiskPlan } from '../reviewRiskPolicy.ts';

const PLAN: ReviewRiskPlan = {
    format: 'risk-plan-v1',
    pr: 42,
    headSha: 'a'.repeat(40),
    baseSha: 'b'.repeat(40),
    riskClasses: ['small'],
    requiredStances: ['correctness'],
    triggers: ['small:handwritten-lines<=200'],
};

const STANCE: ReviewDossierEvent = {
    kind: 'stance-completed',
    stance: 'correctness',
    reviewerModel: 'model-correctness',
    modelTier: 'standard',
    outcome: 'clean',
};

function dossierWith(impact: AssessmentImpact, reason?: string): ReviewDossier {
    return assembleReviewDossier({
        plan: PLAN,
        events: [STANCE],
        discarded: [],
        evidence: [],
        limitations: [],
        recommendation: 'approve',
        assessmentImpact: impact,
        assessmentIgnoredReason: reason,
    });
}

/** A delivered assessment whose scope withheld two entries and left two questions unresolved. */
const DELIVERED_WITHHELD = {
    format: SEMANTIC_CI_FORMAT,
    pr: 42,
    headSha: 'a'.repeat(40),
    state: 'assessed',
    assessedHeadSha: 'a'.repeat(40),
    execution: 'partial',
    scope: {
        discovered: 5,
        eligible: 4,
        assessed: 3,
        excluded: [{ path: 'scripts/a.ts', reason: 'binary' }],
        unassessed: [{ path: 'scripts/b.ts', reason: 'evidence-withheld' }],
        truncated: [],
    },
    unresolvedQuestions: 2,
    artifact: { id: 1, name: 'semantic-review-42-1', expiresAt: '2030-01-01T00:00:00Z', digest: 'f'.repeat(64) },
};

const DELIVERED_COMPLETE = {
    ...DELIVERED_WITHHELD,
    scope: { discovered: 3, eligible: 3, assessed: 3, excluded: [], unassessed: [], truncated: [] },
    unresolvedQuestions: 0,
};

const NO_ASSESSMENT = {
    format: SEMANTIC_CI_FORMAT,
    pr: 42,
    headSha: 'a'.repeat(40),
    state: 'no-assessment',
    reason: 'absent',
};

describe('parseSemanticAssessmentCoverage', () => {
    it('projects a delivered assessment to its withheld and unresolved counts', () => {
        expect(parseSemanticAssessmentCoverage(DELIVERED_WITHHELD)).toEqual({
            state: 'assessed',
            withheld: 2,
            unresolved: 2,
        });
    });

    it('projects a complete delivered assessment to zero withheld and unresolved', () => {
        expect(parseSemanticAssessmentCoverage(DELIVERED_COMPLETE)).toEqual({
            state: 'assessed',
            withheld: 0,
            unresolved: 0,
        });
    });

    it('projects a no-assessment record to not delivered', () => {
        expect(parseSemanticAssessmentCoverage(NO_ASSESSMENT)).toEqual({ state: 'no-assessment' });
    });

    it('refuses a record whose state is neither assessed nor no-assessment', () => {
        expect(() => parseSemanticAssessmentCoverage({ ...DELIVERED_WITHHELD, state: 'partial' })).toThrow(
            /semantic-ci record state must be assessed or no-assessment, found "partial"/
        );
    });

    it('refuses a delivered record whose scope is not an object', () => {
        expect(() => parseSemanticAssessmentCoverage({ ...DELIVERED_WITHHELD, scope: 'none' })).toThrow(
            /semantic-ci record scope must be an object/
        );
    });

    it('refuses a record with a foreign format', () => {
        expect(() => parseSemanticAssessmentCoverage({ ...DELIVERED_WITHHELD, format: 'semantic-ci-v2' })).toThrow(
            /semantic-ci record format must be semantic-ci-v1, found "semantic-ci-v2"/
        );
    });
});

describe('assertSemanticAssessmentAcknowledged', () => {
    it('refuses a delivered assessment with withheld entries when the impact is none and no reason', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none'),
                parseSemanticAssessmentCoverage(DELIVERED_WITHHELD)
            )
        ).toThrow(
            /review dossier assessmentImpact none with no assessmentIgnoredReason ignores the delivered semantic assessment, which withheld 2 scope entries and left 2 questions unresolved/
        );
    });

    it('accepts the same dossier with an assessmentIgnoredReason', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none', 'the withheld audio module is outside this change’s blast radius'),
                parseSemanticAssessmentCoverage(DELIVERED_WITHHELD)
            )
        ).not.toThrow();
    });

    it('accepts a non-none impact, which cites the assessment', () => {
        const dossiers: ReviewDossier[] = [
            assembleReviewDossier({
                plan: PLAN,
                events: [
                    STANCE,
                    { kind: 'finding-accepted', findingId: 'f1', path: 'scripts/a.ts', line: 1, side: 'RIGHT' },
                ],
                discarded: [],
                evidence: [],
                limitations: [],
                recommendation: 'request-changes',
                assessmentImpact: 'finding-led',
            }),
            assembleReviewDossier({
                plan: PLAN,
                events: [STANCE],
                discarded: [],
                evidence: [],
                limitations: ['the assessment withheld the audio module'],
                recommendation: 'approve',
                assessmentImpact: 'limitation-only',
            }),
            dossierWith('stance-changed'),
        ];
        for (const dossier of dossiers) {
            expect(() =>
                assertSemanticAssessmentAcknowledged(dossier, parseSemanticAssessmentCoverage(DELIVERED_WITHHELD))
            ).not.toThrow();
        }
    });

    it('passes a bundle with no semantic-ci record', () => {
        expect(() => assertSemanticAssessmentAcknowledged(dossierWith('none'), undefined)).not.toThrow();
    });

    it('passes a delivered assessment that withheld nothing and left nothing unresolved', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none'),
                parseSemanticAssessmentCoverage(DELIVERED_COMPLETE)
            )
        ).not.toThrow();
    });

    it('passes a no-assessment record', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(dossierWith('none'), parseSemanticAssessmentCoverage(NO_ASSESSMENT))
        ).not.toThrow();
    });
});
