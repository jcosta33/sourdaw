import { describe, expect, it } from 'vitest';

import { parseReviewStancesRecord } from '../reviewDossierPublication.ts';
import { assertFreshReviewStructuralAdmission, REVIEW_STANCES_ADMISSION_FORMAT } from '../reviewStructuralAdmission.ts';

import type { CompletedReviewStance } from '../reviewDossier.ts';
import type { ReviewRiskPlan } from '../reviewRiskPolicy.ts';

const plan: ReviewRiskPlan = {
    format: 'risk-plan-v1',
    pr: 42,
    headSha: 'a'.repeat(40),
    baseSha: 'b'.repeat(40),
    riskClasses: ['small'],
    requiredStances: ['correctness', 'test-validity'],
    triggers: ['small:handwritten-lines<=200'],
};

const completed: CompletedReviewStance[] = [
    { stance: 'lost review', reviewerModel: 'model-one', modelTier: 'standard', outcome: 'clean' },
    { stance: 'weak probe', reviewerModel: 'model-two', modelTier: 'standard', outcome: 'clean' },
    { stance: 'stale replay', reviewerModel: 'model-three', modelTier: 'standard', outcome: 'clean' },
];

function record(draws: readonly CompletedReviewStance[] = completed): unknown {
    return {
        format: REVIEW_STANCES_ADMISSION_FORMAT,
        pr: plan.pr,
        headSha: plan.headSha,
        baseSha: plan.baseSha,
        stances: Array.from(new Set(draws.map((draw) => draw.stance)), (stance) => ({
            stance,
            admittedBy: `the ${stance} failure can escape review`,
            draws: draws
                .filter((draw) => draw.stance === stance)
                .map((draw) => {
                    const entry = {
                        reviewerModel: draw.reviewerModel,
                        baselineProbe: {
                            spec: 'scripts/__tests__/reviewStructuralAdmission.spec.ts',
                            mutation: `remove the ${stance} guard`,
                            observed: 'the named spec failed on the mutation',
                            result: 'mutation-detected',
                        },
                        exhaustion: draw.exhaustion,
                    };
                    return entry;
                }),
        })),
    };
}

function admit(value: unknown, draws: readonly CompletedReviewStance[] = completed, riskPlan = plan): void {
    assertFreshReviewStructuralAdmission(riskPlan, draws, { present: true, value }, 'bundle/stances.json');
}

describe('fresh reviewer structural admission', () => {
    it('accepts three task-derived names without requiring the plan menu names', () => {
        expect(() => admit(record())).not.toThrow();
    });

    it('counts two models on one stance as two exact probe pairs and one stance', () => {
        const draws = [
            ...completed,
            { ...completed[0]!, reviewerModel: 'model-four', exhaustion: 'other models were unavailable' },
        ];
        expect(() => admit(record(draws), draws)).not.toThrow();
    });

    it('keeps a pre-dispatch bound record readable by the historical loose parser', () => {
        const pending = {
            format: REVIEW_STANCES_ADMISSION_FORMAT,
            pr: plan.pr,
            headSha: plan.headSha,
            baseSha: plan.baseSha,
            stances: completed.map((draw) => ({
                stance: draw.stance,
                admittedBy: `the ${draw.stance} failure can escape review`,
            })),
        };
        expect(parseReviewStancesRecord(pending, 'bundle/stances.json').stances.map((row) => row.stance)).toEqual(
            completed.map((draw) => draw.stance)
        );
        expect(() => admit(pending)).toThrow(/draws must be an array/u);
    });
});
