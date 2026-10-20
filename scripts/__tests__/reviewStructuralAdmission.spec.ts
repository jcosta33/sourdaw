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

function record(draws: readonly CompletedReviewStance[] = completed) {
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

function recordWithResult(result: string, draws: readonly CompletedReviewStance[] = completed) {
    const value = record(draws);
    value.stances[0]!.draws[0]!.baselineProbe.result = result;
    return value;
}

function admit(
    value: unknown,
    draws: readonly CompletedReviewStance[] = completed,
    riskPlan = plan,
    publication?: { recommendation: 'approve' | 'request-changes'; acceptedFindingCount: number }
): void {
    assertFreshReviewStructuralAdmission(riskPlan, draws, { present: true, value }, 'bundle/stances.json', publication);
}

describe('fresh reviewer structural admission', () => {
    it('admits a failed unmodified baseline only for a blocker draw in a change request with an accepted finding', () => {
        const draws: CompletedReviewStance[] = [{ ...completed[0]!, outcome: 'blocker-found' }, ...completed.slice(1)];
        expect(() =>
            admit(recordWithResult('baseline-failed', draws), draws, plan, {
                recommendation: 'request-changes',
                acceptedFindingCount: 1,
            })
        ).not.toThrow();
    });

    it.each([
        ['approval', { recommendation: 'approve', acceptedFindingCount: 1 }, 'blocker-found'],
        ['no accepted finding', { recommendation: 'request-changes', acceptedFindingCount: 0 }, 'blocker-found'],
        ['clean draw', { recommendation: 'request-changes', acceptedFindingCount: 1 }, 'clean'],
    ] as const)('refuses a failed baseline on %s', (_case, publication, outcome) => {
        const draws: CompletedReviewStance[] = [{ ...completed[0]!, outcome }, ...completed.slice(1)];
        expect(() => admit(recordWithResult('baseline-failed', draws), draws, plan, publication)).toThrow(
            /baseline probe.*reported baseline-failed/u
        );
    });

    it('refuses a failed baseline without matched publication context', () => {
        const draws: CompletedReviewStance[] = [{ ...completed[0]!, outcome: 'blocker-found' }, ...completed.slice(1)];
        expect(() => admit(recordWithResult('baseline-failed', draws), draws)).toThrow(
            /baseline probe.*reported baseline-failed/u
        );
    });

    it.each(['still-green', 'not-run'] as const)('still refuses %s on a blocking change request', (result) => {
        const draws: CompletedReviewStance[] = [{ ...completed[0]!, outcome: 'blocker-found' }, ...completed.slice(1)];
        expect(() =>
            admit(recordWithResult(result, draws), draws, plan, {
                recommendation: 'request-changes',
                acceptedFindingCount: 1,
            })
        ).toThrow(new RegExp(`baseline probe.*reported ${result}`, 'u'));
    });

    it.each([undefined, 'passed'] as const)('rejects unsupported probe result %s', (result) => {
        const value = recordWithResult('mutation-detected');
        Reflect.set(value.stances[0]!.draws[0]!.baselineProbe, 'result', result);
        expect(() => admit(value)).toThrow(
            /baselineProbe\.result must be mutation-detected, baseline-failed, still-green or not-run/u
        );
    });

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
