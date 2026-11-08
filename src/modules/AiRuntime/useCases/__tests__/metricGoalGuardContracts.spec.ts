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
