import { describe, expect, it } from 'vitest';

import { assertReviewDrawFloor } from '../reviewStructuralAdmission.ts';

import type { CompletedReviewStance } from '../reviewDossier.ts';
import type { ReviewRiskClass, ReviewRiskPlan } from '../reviewRiskPolicy.ts';

function plan(riskClasses: ReviewRiskClass[]): ReviewRiskPlan {
    return {
        format: 'risk-plan-v1',
        pr: 42,
        headSha: 'a'.repeat(40),
        baseSha: 'b'.repeat(40),
        riskClasses,
        // The floor reads the classes alone; the parser, not this gate, pins the earned stance list.
        requiredStances: ['correctness'],
        triggers: ['fixture'],
    };
}

function draws(count: number, tier: CompletedReviewStance['modelTier'] = 'standard'): CompletedReviewStance[] {
    return Array.from({ length: count }, (_, index) => ({
        stance: `risk ${index}`,
        reviewerModel: `model-${index}`,
        modelTier: tier,
        outcome: 'clean',
    }));
}

describe('assertReviewDrawFloor', () => {
    it.each([
        [['docs-only'], 1],
        [['test-only'], 1],
        [['small'], 2],
        [['small-tooling'], 3],
        [['ordinary'], 3],
        [['cross-domain'], 3],
    ] as const)('admits a %j plan at its floor of %i distinct stances', (riskClasses, floor) => {
        expect(() => assertReviewDrawFloor(plan([...riskClasses]), draws(floor))).not.toThrow();
    });

    it.each([
        [['docs-only'], 0, 1],
        [['test-only'], 0, 1],
        [['small'], 1, 2],
        [['small-tooling'], 2, 3],
        [['ordinary'], 2, 3],
    ] as const)('refuses a %j plan with %i distinct stances below its floor of %i', (riskClasses, count, floor) => {
        expect(() => assertReviewDrawFloor(plan([...riskClasses]), draws(count))).toThrow(
            `review.json draws cover ${count} distinct stances; the ${riskClasses.join(', ')} risk plan requires at least ${floor}`
        );
    });

    it('counts distinct stances, so several draws on one stance raise no count', () => {
        const repeated: CompletedReviewStance[] = [
            { stance: 'lost review', reviewerModel: 'model-one', modelTier: 'standard', outcome: 'clean' },
            { stance: 'lost review', reviewerModel: 'model-two', modelTier: 'standard', outcome: 'blocker-found' },
        ];
        expect(() => assertReviewDrawFloor(plan(['small']), repeated)).toThrow(/cover 1 distinct stances/u);
    });

    it.each(['native-security', 'realtime-audio', 'undo'] as const)(
        'refuses a %s plan whose draws carry no strongest tier',
        (riskClass) => {
            expect(() => assertReviewDrawFloor(plan([riskClass]), draws(3))).toThrow(
                `review.json draws need at least one strongest-tier draw for the ${riskClass} risk plan`
            );
        }
    );

    it('admits a specialist plan with one strongest draw among its stances', () => {
        const mixed = [...draws(2), { ...draws(1, 'strongest')[0]!, stance: 'escaped secret' }];
        expect(() => assertReviewDrawFloor(plan(['native-security', 'undo']), mixed)).not.toThrow();
    });
});
