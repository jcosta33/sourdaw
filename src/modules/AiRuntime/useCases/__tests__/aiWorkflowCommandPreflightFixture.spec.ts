import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    commandBatchPreflightPort,
    compileVersionedCommandBatchEnvelope,
    createVersionedCommandEnvelope,
    executeVersionedCommandBatchEnvelope,
    serializeVersionedCommandEnvelope,
} from '#/modules/Command/useCases';

import { compileAgentRiskApproval } from '../compileAgentRiskApproval';
import { validateAgentRiskApproval } from '../validateAgentRiskApproval';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';

const mocks = vi.hoisted(() => ({
    captureProjectRevision: vi.fn(() => 'fixture-project'),
    getCrdtDoc: vi.fn(),
    getProjectContext: vi.fn(),
}));

vi.mock('../getProjectContext', () => ({
    getProjectContext: mocks.getProjectContext,
}));

vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>()),
    captureProjectRevision: mocks.captureProjectRevision,
    getCrdtDoc: mocks.getCrdtDoc,
}));

function capture(projectDocument: Readonly<Record<string, unknown>>, targetIds: readonly string[]) {
    const state = commandBatchPreflightPort.capture({
        assetReferences: [],
        projectDocument,
        targetIds,
    });
    expect(state).not.toBeNull();
    return state!;
}

describe('aiWorkflowCommandPreflightFixture target authority', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getProjectContext.mockReturnValue({ tracks: [], adjustmentLayers: [] });
        configureAiWorkflowCommandPreflightFixture('fixture-project');
    });

    afterEach(() => {
        resetAiWorkflowCommandPreflightFixture();
    });

    it('does not let projection-only tracks, devices, or layers establish target existence', () => {
        mocks.getProjectContext.mockReturnValue({
            tracks: [
                {
                    id: 'track-projection-only',
                    devices: [{ id: 'device-projection-only', type: 'builtin-compressor' }],
                },
            ],
            adjustmentLayers: [
                {
                    id: 'layer-projection-only',
                    name: 'Projection EQ',
                    effectType: 'eq',
                },
            ],
        });

        const state = capture({ tracks: { tracks: [] } }, [
            'track-projection-only',
            'device-projection-only',
            'layer-projection-only',
        ]);

        expect(state.targetFingerprints).toEqual({});
    });

    it('fails targets-exist when a command target exists only in the live projection', async () => {
        mocks.getProjectContext.mockReturnValue({
            tracks: [{ id: 'track-projection-only', gain: 1 }],
            adjustmentLayers: [],
        });
        mocks.getCrdtDoc.mockReturnValue({ tracks: { tracks: [] } });
        const command = createVersionedCommandEnvelope({
            action: {
                type: 'setTrackGain',
                payload: { trackId: 'track-projection-only', gain: 0.8, expectedGain: 1 },
            },
            availableDeviceVersions: {},
            expectedEffect: 'Set the projected track gain.',
            normalizedProjectRevision: 'revision-a',
            objectReferences: [{ argument: 'trackId', id: 'track-projection-only', scope: 'stable' }],
            parameterUnits: [
                { argument: 'gain', unit: 'linear-gain' },
                { argument: 'expectedGain', unit: 'linear-gain' },
            ],
            reason: 'Prove projection state cannot authorize a write.',
            time: [],
        });
        const commandBatch = compileVersionedCommandBatchEnvelope({
            baseRevision: 'revision-a',
            batchId: 'batch-projection-only',
            commands: [serializeVersionedCommandEnvelope(command)],
            intent: 'Attempt a projection-only write',
            mode: 'preview',
            projectId: 'fixture-project',
            runId: 'run-projection-only',
        });

        await expect(
            executeVersionedCommandBatchEnvelope({
                authority: commandBatch.authority,
                serialized: commandBatch.serialized,
            })
        ).resolves.toMatchObject({
            status: 'rejected',
            reason: 'Command batch target does not exist: track-projection-only',
            actions: [],
        });
    });

    it('preserves a document-backed master fingerprint and detects its drift', () => {
        mocks.getProjectContext.mockReturnValue({
            tracks: [{ id: 'master', name: 'Advertised Master', kind: 'master', gain: 1 }],
            adjustmentLayers: [],
        });
        const approved = capture(
            {
                tracks: {
                    tracks: [{ id: 'master', name: 'Document Master', kind: 'master', gain: 1 }],
                },
            },
            ['master', 'hw_out']
        );
        const drifted = capture(
            {
                tracks: {
                    tracks: [{ id: 'master', name: 'Document Master', kind: 'master', gain: 0.75 }],
                },
            },
            ['master', 'hw_out']
        );

        expect(approved.targetFingerprints.master).toContain('Document Master');
        expect(approved.targetFingerprints.master).toContain('Advertised Master');
        expect(approved.targetFingerprints.master).not.toBe('system-output:master');
        expect(drifted.targetFingerprints.master).not.toBe(approved.targetFingerprints.master);
        expect(approved.targetFingerprints.hw_out).toBe('system-output:hw_out');
    });

    it('uses the master sentinel only when the document has no master', () => {
        mocks.getProjectContext.mockReturnValue({
            tracks: [{ id: 'master', name: 'Projection Master', kind: 'master', gain: 1 }],
            adjustmentLayers: [],
        });

        const state = capture({ tracks: { tracks: [] } }, ['master', 'hw_out']);

        expect(state.targetFingerprints).toEqual({
            master: 'system-output:master',
            hw_out: 'system-output:hw_out',
        });
    });

    it('invalidates approval after document-backed master drift', () => {
        mocks.getProjectContext.mockReturnValue({
            tracks: [{ id: 'master', name: 'Advertised Master', kind: 'master', gain: 1 }],
            adjustmentLayers: [],
        });
        mocks.getCrdtDoc.mockReturnValue({
            tracks: { tracks: [{ id: 'master', name: 'Document Master', kind: 'master', gain: 1 }] },
        });
        const command = createVersionedCommandEnvelope({
            action: {
                type: 'setTrackGain',
                payload: { trackId: 'master', gain: 0.8, expectedGain: 1 },
            },
            availableDeviceVersions: {},
            expectedEffect: 'Set the document-backed master gain.',
            normalizedProjectRevision: 'revision-a',
            objectReferences: [{ argument: 'trackId', id: 'master', scope: 'stable' }],
            parameterUnits: [
                { argument: 'gain', unit: 'linear-gain' },
                { argument: 'expectedGain', unit: 'linear-gain' },
            ],
            reason: 'Prove real master drift invalidates approval.',
            time: [],
        });
        const commandBatch = compileVersionedCommandBatchEnvelope({
            baseRevision: 'revision-a',
            batchId: 'batch-master-authority',
            commands: [serializeVersionedCommandEnvelope(command)],
            intent: 'Adjust the document-backed master',
            mode: 'preview',
            projectId: 'fixture-project',
            runId: 'run-master-authority',
        });
        const approval = compileAgentRiskApproval({ commandBatch });

        mocks.getCrdtDoc.mockReturnValue({
            tracks: { tracks: [{ id: 'master', name: 'Document Master', kind: 'master', gain: 0.75 }] },
        });

        expect(validateAgentRiskApproval({ approval, commandBatch, currentRevision: 'revision-a' })).toEqual({
            status: 'invalid',
            reason: 'The approved target fingerprints no longer match.',
        });
    });
});
