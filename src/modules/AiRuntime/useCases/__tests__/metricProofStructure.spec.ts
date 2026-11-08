import { afterEach, describe, expect, it } from 'vitest';

import { metricGuardFixture } from './metricGuardFixture';
import { resetMetricGoalProject } from './metricGoalWorkflowFixture';

afterEach(resetMetricGoalProject);

describe('metric proof structure', () => {
    it.each(['duplicate target', 'missing provenance', 'baseline route', 'preview route'] as const)(
        'rejects %s while accepting the unmodified proof',
        (defect) => {
            const f = metricGuardFixture();
            expect(f.evaluate(f.state).status).toBe('verified');
            const proof = f.state.proofs[0]!;
            const provenance = proof.preview.provenance!;
            const artifacts = provenance.targets[0]!;
            const changedArtifacts =
                defect === 'baseline route'
                    ? { ...artifacts, baseline: { ...artifacts.baseline, route: 'mixdown' as const } }
                    : defect === 'preview route'
                      ? { ...artifacts, preview: { ...artifacts.preview, route: 'mixdown' as const } }
                      : artifacts;
            const targets =
                defect === 'duplicate target'
                    ? [proof.preview.targets[0]!, proof.preview.targets[0]!]
                    : proof.preview.targets;
            const provenanceTargets =
                defect === 'missing provenance'
                    ? [{ ...artifacts, targetId: 'other' }, provenance.targets[1]!]
                    : [changedArtifacts, provenance.targets[1]!];
            const state = f.bind({
                ...f.state,
                proofs: [
                    {
                        ...proof,
                        preview: {
                            ...proof.preview,
                            targets,
                            provenance: { ...provenance, targets: provenanceTargets },
                        },
                    },
                ],
            });
            expect(f.evaluate(state)).toMatchObject({
                status: 'blocked',
                failure: 'incomparable',
                reason: expect.stringContaining('Compatible actual baseline'),
            });
        }
    );
    it.each(['before', 'after'] as const)('rejects a rebound prefix with altered %s', (field) => {
        const f = metricGuardFixture();
        expect(f.evaluate(f.state).status).toBe('verified');
        const binding = f.state.binding!;
        const state = {
            ...f.state,
            binding: { ...binding, prefixes: binding.prefixes.map((prefix) => ({ ...prefix, [field]: 'altered' })) },
        };
        expect(f.evaluate(state)).toMatchObject({
            status: 'blocked',
            failure: 'stale',
            reason: 'The metric logical-step bindings do not match this command batch.',
        });
    });
});
