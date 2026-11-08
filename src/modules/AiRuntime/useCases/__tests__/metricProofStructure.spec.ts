import { afterEach, describe, expect, it } from 'vitest';

import { type MeasuredPreview } from '../../models/MeasuredPreview';

import { resetMetricGoalProject } from './metricGoalWorkflowFixture';
import { metricGuardFixture } from './metricGuardFixture';

afterEach(resetMetricGoalProject);

describe('metric proof structure', () => {
    it.each(['missing provenance', 'baseline route', 'preview route'] as const)(
        'rejects %s while accepting the unmodified proof',
        (defect) => {
            const f = metricGuardFixture();
            expect(f.evaluate(f.state).status).toBe('verified');
            const proof = f.state.proofs[0]!;
            const provenance = proof.preview.provenance!;
            const artifacts = provenance.targets[0]!;
            let changedArtifacts = artifacts;
            if (defect === 'baseline route') {
                changedArtifacts = { ...artifacts, baseline: { ...artifacts.baseline, route: 'mixdown' } };
            } else if (defect === 'preview route') {
                changedArtifacts = { ...artifacts, preview: { ...artifacts.preview, route: 'mixdown' } };
            }
            const targets = proof.preview.targets;
            let provenanceTargets = [changedArtifacts, provenance.targets[1]!];
            if (defect === 'missing provenance') {
                provenanceTargets = [{ ...artifacts, targetId: 'other' }, provenance.targets[1]!];
            }
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
    it('rejects duplicate preview targets even when a separate proof supplies the reference', () => {
        const f = metricGuardFixture();
        expect(f.evaluate(f.state).status).toBe('verified');
        const proof = f.state.proofs[0]!;
        const provenance = proof.preview.provenance!;
        const bass = proof.preview.targets[0]!;
        const bassArtifact = provenance.targets[0]!;
        const drums = proof.preview.targets[1]!;
        const drumsArtifact = provenance.targets[1]!;
        const duplicate = {
            ...proof,
            preview: {
                ...proof.preview,
                scope: { kind: 'tracks' as const, ids: ['bass', 'bass'] },
                targets: [bass, bass],
                provenance: { ...provenance, targets: [bassArtifact, bassArtifact] },
            },
        };
        const reference = {
            ...proof,
            receiptDigest: 'reference',
            preview: {
                ...proof.preview,
                scope: { kind: 'tracks' as const, ids: ['drums'] },
                targets: [drums],
                provenance: { ...provenance, callId: 'reference', targets: [drumsArtifact] },
            },
        };
        const state = f.bind({ ...f.state, proofs: [duplicate, reference] });
        expect(f.evaluate(state)).toMatchObject({ status: 'blocked', failure: 'incomparable' });
    });
    it.each(['baseline', 'preview'] as const)('requires the master %s mixdown route', (side) => {
        const f = metricGuardFixture();
        const proof = f.state.proofs[0]!;
        const provenance = proof.preview.provenance!;
        const target = { ...proof.preview.targets[0]!, targetId: 'master', targetKind: 'master' as const };
        const mixdown = { ...provenance.targets[0]!.baseline, route: 'mixdown' as const };
        const masterArtifacts = { targetId: 'master', baseline: mixdown, preview: mixdown };
        const masterProof = {
            ...proof,
            preview: {
                ...proof.preview,
                scope: { kind: 'master' as const },
                targets: [target],
                provenance: { ...provenance, targets: [masterArtifacts] },
            },
        };
        const referenceTarget = { ...proof.preview.targets[1]!, targetId: 'bass' };
        const referenceArtifacts = { ...provenance.targets[1]!, targetId: 'bass' };
        const referenceProof = {
            ...proof,
            receiptDigest: 'reference',
            preview: {
                ...proof.preview,
                scope: { kind: 'tracks' as const, ids: ['bass'] },
                targets: [referenceTarget],
                provenance: { ...provenance, callId: 'reference', targets: [referenceArtifacts] },
            },
        };
        const makeState = (entry: NonNullable<MeasuredPreview['provenance']>['targets'][number]) =>
            f.bind({
                ...f.state,
                authorities: [f.master],
                proofs: [
                    {
                        ...masterProof,
                        preview: {
                            ...masterProof.preview,
                            provenance: { ...masterProof.preview.provenance, targets: [entry] },
                        },
                    },
                    referenceProof,
                ],
            });
        expect(f.evaluate(makeState(masterArtifacts)).status).toBe('verified');
        const wrong = { ...masterArtifacts, [side]: { ...mixdown, route: 'isolated-subgraph' as const } };
        expect(f.evaluate(makeState(wrong))).toMatchObject({ status: 'blocked', failure: 'incomparable' });
    });
    it('admits broadcast and pairwise references but rejects a third reference for two targets', () => {
        const f = metricGuardFixture();
        const authority = f.state.authorities[0]!;
        const goal = authority.goals[0]!;
        const proof = f.state.proofs[0]!;
        const provenance = proof.preview.provenance!;
        const ids = ['bass', 'drums', 'reference-a', 'reference-b', 'reference-c'];
        const targets = ids.map((targetId, index) => ({ ...proof.preview.targets[index < 2 ? 0 : 1]!, targetId }));
        const artifacts = ids.map((targetId) => ({ ...provenance.targets[0]!, targetId }));
        const expandedProof = {
            ...proof,
            preview: {
                ...proof.preview,
                scope: { kind: 'tracks' as const, ids },
                targets,
                provenance: { ...provenance, targets: artifacts },
            },
        };
        function withReferences(referenceTargetIds: string[]) {
            return f.bind({
                ...f.state,
                authorities: [{ ...authority, goals: [{ ...goal, targetIds: ids.slice(0, 2), referenceTargetIds }] }],
                proofs: [expandedProof],
            });
        }
        expect(f.evaluate(withReferences(ids.slice(2, 3))).status).toBe('verified');
        expect(f.evaluate(withReferences(ids.slice(2, 4))).status).toBe('verified');
        expect(f.evaluate(withReferences(ids.slice(2, 5)))).toMatchObject({
            status: 'blocked',
            failure: 'incomparable',
            reason: expect.stringContaining('Compatible actual baseline'),
        });
    });
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
