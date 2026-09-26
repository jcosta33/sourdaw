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

const EXPECTED = { pr: PLAN.pr, headSha: PLAN.headSha };

const STANCE: ReviewDossierEvent = {
    kind: 'stance-completed',
    stance: 'correctness',
    reviewerModel: 'model-correctness',
    modelTier: 'standard',
    outcome: 'clean',
};

/** Satisfies `finding-led`'s own construction-time requirement for at least one accepted finding. */
const FINDING_ACCEPTED: ReviewDossierEvent = {
    kind: 'finding-accepted',
    findingId: 'finding-1',
    path: 'scripts/reviewDossierSemanticAssessment.ts',
    line: 1,
    side: 'RIGHT',
};

function dossierWith(
    impact: AssessmentImpact,
    options: { reason?: string; limitations?: string[]; events?: ReviewDossierEvent[] } = {}
): ReviewDossier {
    return assembleReviewDossier({
        plan: PLAN,
        events: options.events ?? [STANCE],
        discarded: [],
        evidence: [],
        limitations: options.limitations ?? [],
        recommendation: 'approve',
        assessmentImpact: impact,
        assessmentIgnoredReason: options.reason,
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
    it('projects a delivered assessment to its binding identity, withheld counts and citation tokens', () => {
        expect(parseSemanticAssessmentCoverage(DELIVERED_WITHHELD)).toEqual({
            state: 'assessed',
            pr: 42,
            headSha: 'a'.repeat(40),
            withheld: 2,
            unresolved: 2,
            artifactName: 'semantic-review-42-1',
            withheldPaths: ['scripts/a.ts', 'scripts/b.ts'],
        });
    });

    it('projects a complete delivered assessment to zero withheld and unresolved', () => {
        expect(parseSemanticAssessmentCoverage(DELIVERED_COMPLETE)).toEqual({
            state: 'assessed',
            pr: 42,
            headSha: 'a'.repeat(40),
            withheld: 0,
            unresolved: 0,
            artifactName: 'semantic-review-42-1',
            withheldPaths: [],
        });
    });

    it('projects a no-assessment record to not delivered, carrying its reason', () => {
        expect(parseSemanticAssessmentCoverage(NO_ASSESSMENT)).toEqual({
            state: 'no-assessment',
            pr: 42,
            headSha: 'a'.repeat(40),
            reason: 'absent',
        });
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
                parseSemanticAssessmentCoverage(DELIVERED_WITHHELD),
                EXPECTED
            )
        ).toThrow(
            /review dossier assessmentImpact none with no assessmentIgnoredReason ignores the delivered semantic assessment, which withheld 2 scope entries and left 2 questions unresolved/
        );
    });

    it('accepts the same dossier with an assessmentIgnoredReason', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none', { reason: 'the withheld audio module is outside this change’s blast radius' }),
                parseSemanticAssessmentCoverage(DELIVERED_WITHHELD),
                EXPECTED
            )
        ).not.toThrow();
    });

    it('accepts a limitation naming the assessment’s artifact identity', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('limitation-only', {
                    limitations: ['the assessment run semantic-review-42-1 withheld the audio module'],
                }),
                parseSemanticAssessmentCoverage(DELIVERED_WITHHELD),
                EXPECTED
            )
        ).not.toThrow();
    });

    it('accepts a limitation naming a path the assessment withheld', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('limitation-only', { limitations: ['the assessment withheld scripts/b.ts'] }),
                parseSemanticAssessmentCoverage(DELIVERED_WITHHELD),
                EXPECTED
            )
        ).not.toThrow();
    });

    it('refuses an unrelated limitation that never names the assessment', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('limitation-only', {
                    limitations: ['the native audio path is not exercised on this head'],
                }),
                parseSemanticAssessmentCoverage(DELIVERED_WITHHELD),
                EXPECTED
            )
        ).toThrow(
            /review dossier assessmentImpact limitation-only does not cite the delivered semantic assessment, which withheld 2 scope entries and left 2 questions unresolved: name its artifact or a withheld path in a limitation/
        );
    });

    it('refuses a coverage record bound to another publication', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none'),
                parseSemanticAssessmentCoverage({ ...DELIVERED_WITHHELD, pr: 99, headSha: 'f'.repeat(40) }),
                EXPECTED
            )
        ).toThrow(/semantic-ci record pr 99 headSha f{40} does not match the publication pr 42 headSha a{40}/);
    });

    it('passes a bundle with no semantic-ci record', () => {
        expect(() => assertSemanticAssessmentAcknowledged(dossierWith('none'), undefined, EXPECTED)).not.toThrow();
    });

    it('passes a delivered assessment that withheld nothing and left nothing unresolved', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none'),
                parseSemanticAssessmentCoverage(DELIVERED_COMPLETE),
                EXPECTED
            )
        ).not.toThrow();
    });

    it('refuses a no-assessment record when the impact is none, even with a citing limitation', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none', { limitations: ['semantic-ci absent: CI delivered no assessment for this head'] }),
                parseSemanticAssessmentCoverage(NO_ASSESSMENT),
                EXPECTED
            )
        ).toThrow(/assessmentImpact none/);
    });

    it('refuses a no-assessment record when the impact is none plus an assessmentIgnoredReason', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none', { reason: 'ci ran red on this head' }),
                parseSemanticAssessmentCoverage(NO_ASSESSMENT),
                EXPECTED
            )
        ).toThrow(/assessmentImpact none/);
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none', { reason: 'ci ran red on this head' }),
                parseSemanticAssessmentCoverage(NO_ASSESSMENT),
                EXPECTED
            )
        ).toThrow(/no semantic assessment/);
    });

    it('refuses a limitation-only round whose limitation never cites the no-assessment record', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('limitation-only', {
                    limitations: ['the native audio path is not exercised on this head'],
                }),
                parseSemanticAssessmentCoverage(NO_ASSESSMENT),
                EXPECTED
            )
        ).toThrow(/semantic-ci absent/);
    });

    it('refuses a stance-changed round whose limitation never cites the no-assessment record', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('stance-changed', {
                    limitations: ['draw r1s2 fell back to the authoring model'],
                }),
                parseSemanticAssessmentCoverage(NO_ASSESSMENT),
                EXPECTED
            )
        ).toThrow(/semantic-ci absent/);
    });

    it('refuses a limitation-only round whose limitation cites the wrong reason for the no-assessment record', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('limitation-only', {
                    limitations: ['semantic-ci red-check: CI delivered no assessment for this head'],
                }),
                parseSemanticAssessmentCoverage(NO_ASSESSMENT),
                EXPECTED
            )
        ).toThrow(/semantic-ci absent/);
    });

    it('passes a no-assessment record when the impact is limitation-only with a citing limitation', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('limitation-only', {
                    limitations: ['semantic-ci absent: CI delivered no assessment for this head'],
                }),
                parseSemanticAssessmentCoverage(NO_ASSESSMENT),
                EXPECTED
            )
        ).not.toThrow();
    });

    it('refuses a no-assessment record with no limitations though the impact is finding-led', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('finding-led', { events: [STANCE, FINDING_ACCEPTED] }),
                parseSemanticAssessmentCoverage(NO_ASSESSMENT),
                EXPECTED
            )
        ).toThrow(/semantic-ci absent/);
    });

    it('refuses a no-assessment record bound to another publication before the impact is checked', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none'),
                parseSemanticAssessmentCoverage({ ...NO_ASSESSMENT, pr: 99, headSha: 'f'.repeat(40) }),
                EXPECTED
            )
        ).toThrow(/semantic-ci record pr 99 headSha f{40} does not match the publication pr 42 headSha a{40}/);
    });
});
