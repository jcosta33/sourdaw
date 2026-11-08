import { afterEach, describe, expect, it } from 'vitest';

import { metricGuardFixture } from './metricGuardFixture';
import { resetMetricGoalProject } from './metricGoalWorkflowFixture';

afterEach(resetMetricGoalProject);

describe('bound measured-goal completeness', () => {
    it('verifies the source-admitted overall comparison control', () => {
        const f = metricGuardFixture();
        expect(f.evaluate(f.state).status).toBe('verified');
    });
    it('blocks a codec-admitted empty measured authority', () => {
        const f = metricGuardFixture();
        const authority = f.state.authorities[0]!;
        const state = f.bind({ ...f.state, authorities: [{ ...authority, goals: [] }] });
        expect(f.evaluate(state)).toMatchObject({
            status: 'blocked',
            failure: 'missing',
            reason: 'The perceptual request has no compatible frozen objective criterion.',
        });
    });
    it('blocks an empty measured authority beside an otherwise verified goal', () => {
        const f = metricGuardFixture();
        const authority = f.state.authorities[0]!;
        const state = f.bind({
            ...f.state,
            authorities: [authority, { ...authority, authorityId: 'empty', goals: [] }],
        });
        expect(f.evaluate(state)).toMatchObject({
            status: 'blocked',
            failure: 'missing',
            reason: 'The perceptual request has no compatible frozen objective criterion.',
        });
    });
    it.each(['none', 'partial'] as const)('blocks %s bound command coverage', (coverage) => {
        const f = metricGuardFixture();
        const step = f.state.steps[0]!;
        const steps =
            coverage === 'none' ? [] : [{ ...step, commandCount: 1, operationTypes: step.operationTypes.slice(0, 1) }];
        const state = f.bind({ ...f.state, steps });
        expect(state.binding?.prefixes).toEqual([]);
        expect(f.evaluate(state)).toMatchObject({
            status: 'blocked',
            failure: 'missing',
            reason: 'The proposal has no complete application-bound logical mixing steps.',
        });
    });
    it('requires the first recipe goal to hold across the final batch as well as its step', () => {
        const f = metricGuardFixture();
        const goal = f.recipe.goals.find(
            (entry) => entry.metricId === 'spectralCentroid' && entry.relation === 'decrease'
        )!;
        const proof = f.state.proofs[0]!;
        const target = proof.preview.targets[0]!;
        const figure = (value: number) => ({
            status: 'measured' as const,
            metricVersion: 1,
            unit: 'hertz',
            value,
            confidence: 'exact' as const,
        });
        const first = {
            ...proof,
            preview: {
                ...proof.preview,
                batchContentHash: f.firstHash,
                targets: [{ ...target, preview: { spectralCentroid: figure(800) } }, proof.preview.targets[1]!],
            },
        };
        function withFinal(value: number) {
            const final = {
                ...proof,
                receiptDigest: 'final',
                preview: {
                    ...proof.preview,
                    provenance: { ...proof.preview.provenance!, callId: 'final' },
                    targets: [{ ...target, preview: { spectralCentroid: figure(value) } }, proof.preview.targets[1]!],
                },
            };
            return f.bind({
                ...f.state,
                authorities: [{ ...f.recipe, goals: [goal] }],
                steps: [
                    {
                        stepId: goal.stepId,
                        commandCount: 1,
                        operationTypes: [f.operations[0]!],
                        recipePrefixHash: f.firstHash,
                    },
                    { stepId: 'overall', commandCount: 1, operationTypes: [f.operations[1]!], recipePrefixHash: null },
                ],
                proofs: [first, final],
            });
        }
        expect(f.evaluate(withFinal(700)).status).toBe('verified');
        expect(f.evaluate(withFinal(950))).toMatchObject({
            status: 'blocked',
            failure: 'out-of-tolerance',
            reason: expect.stringContaining('do not satisfy'),
        });
    });
    it('rejects independently admitted opposed goals on the same subjects', () => {
        const f = metricGuardFixture();
        expect(f.evaluate(f.state).status).toBe('verified');
        const state = f.bind({ ...f.state, authorities: [...f.state.authorities, f.opposed] });
        expect(f.evaluate(state)).toMatchObject({
            status: 'blocked',
            failure: 'contradictory',
            reason: expect.stringContaining('contradict'),
        });
    });
    it('rejects disagreeing compatible proofs', () => {
        const f = metricGuardFixture();
        const proof = f.state.proofs[0]!;
        const target = proof.preview.targets[0]!;
        const other = {
            ...proof,
            receiptDigest: 'other',
            preview: {
                ...proof.preview,
                provenance: { ...proof.preview.provenance!, callId: 'other' },
                targets: [
                    {
                        ...target,
                        preview: {
                            spectralCentroid: {
                                status: 'measured' as const,
                                metricVersion: 1,
                                unit: 'hertz',
                                value: 950,
                                confidence: 'exact' as const,
                            },
                        },
                    },
                    ...proof.preview.targets.slice(1),
                ],
            },
        };
        expect(f.evaluate(f.bind({ ...f.state, proofs: [proof, other] }))).toMatchObject({
            status: 'blocked',
            failure: 'incomparable',
        });
        expect(f.evaluate(f.bind({ ...f.state, proofs: [proof, { ...proof, receiptDigest: 'other' }] })).status).toBe(
            'verified'
        );
    });
});
