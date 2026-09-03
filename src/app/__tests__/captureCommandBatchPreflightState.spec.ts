import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type getProjectContext } from '#/modules/AiRuntime/useCases';
import {
    commandBatchPreflightPort,
    compileVersionedCommandBatchEnvelope,
    createVersionedCommandEnvelope,
    executeVersionedCommandBatchEnvelope,
    serializeVersionedCommandEnvelope,
} from '#/modules/Command/useCases';

import { captureCommandBatchPreflightState } from '../captureCommandBatchPreflightState';

const mocks = vi.hoisted(() => {
    const agentProjectRepairStateStore: { value: unknown } = { value: null };
    return {
        agentProjectRepairStateStore,
        captureProjectIdentity: vi.fn(() => 'document-identity-a'),
        captureProjectRevision: vi.fn(() => 'document-identity-a'),
        getAssetTransfer: vi.fn(),
        getCrdtDoc: vi.fn<(id: string) => unknown>(),
        getProjectContext: vi.fn(),
        hasAudioBuffer: vi.fn<(id: string) => boolean>(),
        trackStore: { value: { tracks: [] } },
    };
});

vi.mock('#/modules/AiRuntime/useCases', () => ({
    getProjectContext: mocks.getProjectContext,
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: mocks.trackStore,
    adjustmentLayerStore: { value: { layers: [] }, subscribe: vi.fn() },
    takeLaneStore: { value: { lanes: [] }, subscribe: vi.fn() },
    deriveVcaMultiplier: vi.fn(() => 1),
    getVcaGroupsState: vi.fn(() => ({})),
    shouldCreateLiveTrackStrip: vi.fn(() => false),
    deriveEffectiveAudibility: vi.fn(() => true),
    warpStates: new Map(),
    getWarpState: vi.fn(),
    addWarpMarker: vi.fn(),
    clampDeviceParamWrite: vi.fn(),
    // A barrel factory replaces the whole module, so every member anything in
    // this spec's graph imports has to be present here — Automation's range
    // handlers reach both of these, and neither is exercised by these cases.
    markerStore: { value: null, subscribe: vi.fn() },
    resolveEligibleDeviceWriteTarget: vi.fn(() => null),
}));

vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: { has: mocks.hasAudioBuffer },
}));

vi.mock('#/modules/Collaboration/useCases', () => ({
    getAssetTransfer: mocks.getAssetTransfer,
}));

vi.mock('#/modules/CrdtDocument/stores', () => ({
    agentProjectRepairStateStore: mocks.agentProjectRepairStateStore,
    actionHistoryStore: { value: { entries: [] as unknown[] }, subscribe: vi.fn() },
    setSemanticContext: vi.fn(),
    clearSemanticContext: vi.fn(),
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectIdentity: mocks.captureProjectIdentity,
    captureProjectRevision: mocks.captureProjectRevision,
    DOC_PREFIX_ROOT: 'root',
    getCrdtDoc: mocks.getCrdtDoc,
}));

function projectContext(): ReturnType<typeof getProjectContext> {
    return {
        tempo: 120,
        timeSignature: [4, 4],
        isPlaying: false,
        isRecording: false,
        isLooping: false,
        loopStart: 0,
        loopEnd: 4,
        punchInEnabled: false,
        punchInBeat: 0,
        punchOutBeat: 4,
        metronomeEnabled: false,
        metronomeVolume: 0.8,
        masterGain: 1,
        tracks: [
            {
                id: 'track-vocal',
                name: 'Vocal',
                kind: 'audio',
                muted: false,
                soloed: false,
                soloSafe: false,
                armed: false,
                frozen: false,
                gain: 1,
                pan: 0,
                automationMode: 'read',
                outputId: 'bus-vocal',
                clipCount: 0,
                deviceCount: 0,
                clips: [],
                devices: [],
                sends: [],
            },
            {
                id: 'bus-vocal',
                name: 'Vocal Bus',
                kind: 'bus',
                muted: false,
                soloed: false,
                soloSafe: false,
                armed: false,
                frozen: false,
                gain: 1,
                pan: 0,
                automationMode: 'read',
                outputId: 'master',
                clipCount: 0,
                deviceCount: 0,
                clips: [],
                devices: [],
                sends: [],
            },
            {
                id: 'master',
                name: 'Master',
                kind: 'master',
                muted: false,
                soloed: false,
                soloSafe: false,
                armed: false,
                frozen: false,
                gain: 1,
                pan: 0,
                automationMode: 'read',
                outputId: 'hw_out',
                clipCount: 0,
                deviceCount: 0,
                clips: [],
                devices: [],
                sends: [],
            },
        ],
        selectedTrackId: null,
        selectedClipId: null,
        selectedClipIds: [],
        activeView: 'arrange',
        playheadPosition: 0,
    };
}

describe('captureCommandBatchPreflightState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.agentProjectRepairStateStore.value = null;
        mocks.captureProjectIdentity.mockReturnValue('document-identity-a');
        mocks.captureProjectRevision.mockReturnValue('document-identity-a');
        mocks.getProjectContext.mockReturnValue(projectContext());
        mocks.getCrdtDoc.mockReturnValue({
            tracks: {
                tracks: [
                    {
                        id: 'track-vocal',
                        kind: 'audio',
                        gain: 1,
                        pan: 0,
                        outputId: 'bus-vocal',
                        clips: [],
                        devices: [],
                        sends: [],
                    },
                    {
                        id: 'bus-vocal',
                        kind: 'bus',
                        gain: 1,
                        pan: 0,
                        outputId: 'master',
                        clips: [],
                        devices: [],
                        sends: [],
                    },
                    {
                        id: 'master',
                        kind: 'master',
                        gain: 1,
                        pan: 0,
                        outputId: 'hw_out',
                        clips: [],
                        devices: [],
                        sends: [],
                    },
                ],
            },
        });
        mocks.hasAudioBuffer.mockImplementation((id) => id === 'buffer-vocal');
        mocks.getAssetTransfer.mockReturnValue({ hasAsset: (hash: string) => hash === 'sha256:vocal' });
    });

    it('captures authoritative targets, assets, invariants, and routing validity', () => {
        const state = captureCommandBatchPreflightState({
            assetReferences: [{ assetHash: 'sha256:vocal', audioBufferId: 'buffer-vocal' }],
            targetIds: ['track-vocal', 'hw_out'],
        });

        expect(state).toMatchObject({
            audioGraphValid: true,
            availableAssetHashes: ['sha256:vocal'],
            availableAudioBufferIds: ['buffer-vocal'],
            lockedRanges: [],
            projectId: 'document-identity-a',
            projectInvariantsValid: true,
            targetFingerprints: {
                hw_out: 'system-output:hw_out',
            },
        });
        expect(state.targetFingerprints['track-vocal']).toContain('track-vocal');
    });

    it('captures device parameters by plain and device-qualified target identity', () => {
        mocks.getCrdtDoc.mockReturnValue({
            tracks: [
                {
                    id: 'track-bass-di',
                    devices: [
                        {
                            id: 'device-compressor',
                            parameterValues: {
                                'comp-attack': 12,
                                'comp-threshold': -24,
                            },
                        },
                    ],
                },
            ],
        });

        const state = captureCommandBatchPreflightState({
            assetReferences: [],
            targetIds: ['comp-threshold', 'device-compressor:comp-attack'],
        });

        expect(state.targetFingerprints['comp-threshold']).toBe(
            JSON.stringify([
                JSON.stringify({ deviceId: 'device-compressor', parameterId: 'comp-threshold', value: -24 }),
            ])
        );
        expect(state.targetFingerprints['device-compressor:comp-attack']).toBe(
            JSON.stringify([JSON.stringify({ deviceId: 'device-compressor', parameterId: 'comp-attack', value: 12 })])
        );
    });

    it('does not let projection-only tracks, devices, or layers establish writable target authority', () => {
        const context = projectContext();
        context.tracks[0] = {
            ...context.tracks[0]!,
            id: 'track-projection-only',
            devices: [
                {
                    id: 'device-projection-only',
                    name: 'Projection Compressor',
                    type: 'builtin-compressor',
                    bypassed: false,
                },
            ],
        };
        context.adjustmentLayers = [
            {
                id: 'layer-projection-only',
                name: 'Projection EQ',
                effectType: 'eq',
                parameters: [],
                affectedTrackIds: ['track-projection-only'],
                insertionIndex: 0,
                regions: [],
                enabled: true,
                mix: 1,
                color: '#ffffff',
            },
        ];
        mocks.getProjectContext.mockReturnValue(context);

        const state = captureCommandBatchPreflightState({
            assetReferences: [],
            projectDocument: { tracks: { tracks: [] } },
            targetIds: ['track-projection-only', 'device-projection-only', 'layer-projection-only'],
        });

        expect(state.targetFingerprints).toEqual({});
        expect(state.advertisedTargetFingerprints).toEqual({});
    });

    it('fails targets-exist when the requested target exists only in the live projection', async () => {
        const context = projectContext();
        context.tracks[0] = { ...context.tracks[0]!, id: 'track-projection-only' };
        mocks.getProjectContext.mockReturnValue(context);
        mocks.getCrdtDoc.mockReturnValue({ tracks: { tracks: [] } });
        commandBatchPreflightPort.setProvider(captureCommandBatchPreflightState);
        const command = createVersionedCommandEnvelope({
            action: {
                type: 'setTrackGain',
                payload: { trackId: 'track-projection-only', gain: 0.8, expectedGain: 1 },
            },
            availableDeviceVersions: {},
            expectedEffect: 'Set the projected track gain.',
            normalizedProjectRevision: 'document-identity-a',
            objectReferences: [{ argument: 'trackId', id: 'track-projection-only', scope: 'stable' }],
            parameterUnits: [
                { argument: 'gain', unit: 'linear-gain' },
                { argument: 'expectedGain', unit: 'linear-gain' },
            ],
            reason: 'Prove projection state cannot authorize a write.',
            time: [],
        });
        const batch = compileVersionedCommandBatchEnvelope({
            baseRevision: 'document-identity-a',
            batchId: 'batch-projection-only',
            commands: [serializeVersionedCommandEnvelope(command)],
            intent: 'Attempt a projection-only write',
            mode: 'preview',
            projectId: 'document-identity-a',
            runId: 'run-projection-only',
        });

        try {
            const result = await executeVersionedCommandBatchEnvelope({
                authority: batch.authority,
                serialized: batch.serialized,
            });

            expect(result).toMatchObject({
                status: 'rejected',
                reason: 'Command batch target does not exist: track-projection-only',
                actions: [],
            });
        } finally {
            commandBatchPreflightPort.setProvider(null);
        }
    });

    it('reports advertised drift for a document-backed target without moving its document fingerprint', () => {
        const document = {
            tracks: {
                tracks: [
                    {
                        id: 'track-vocal',
                        kind: 'audio',
                        gain: 1,
                        pan: 0,
                        outputId: 'master',
                        clips: [],
                        devices: [],
                        sends: [],
                    },
                ],
            },
        };
        const approved = captureCommandBatchPreflightState({
            assetReferences: [],
            projectDocument: document,
            targetIds: ['track-vocal'],
        });
        const driftedContext = projectContext();
        driftedContext.tracks[0] = { ...driftedContext.tracks[0]!, gain: 0.25 };
        mocks.getProjectContext.mockReturnValue(driftedContext);

        const drifted = captureCommandBatchPreflightState({
            assetReferences: [],
            projectDocument: document,
            targetIds: ['track-vocal'],
        });

        expect(approved.targetFingerprints['track-vocal']).toContain('track-vocal');
        expect(drifted.targetFingerprints['track-vocal']).toBe(approved.targetFingerprints['track-vocal']);
        expect(approved.advertisedTargetFingerprints['track-vocal']).toBeDefined();
        expect(drifted.advertisedTargetFingerprints['track-vocal']).not.toBe(
            approved.advertisedTargetFingerprints['track-vocal']
        );
    });

    it('captures an adjustment layer from its document-owned slot', () => {
        const state = captureCommandBatchPreflightState({
            assetReferences: [],
            projectDocument: {
                adjustmentLayers: {
                    layers: [
                        {
                            id: 'layer-bass-eq',
                            name: 'Bass EQ',
                            effectType: 'eq',
                            parameters: [],
                            affectedTrackIds: ['track-bass'],
                            insertionIndex: 0,
                            regions: [],
                            enabled: true,
                            mix: 0.8,
                            color: '#ffffff',
                        },
                    ],
                },
                tracks: {
                    tracks: [
                        {
                            id: 'track-bass',
                            kind: 'audio',
                            gain: 1,
                            pan: 0,
                            outputId: 'master',
                            clips: [],
                            devices: [],
                            sends: [],
                        },
                    ],
                },
            },
            targetIds: ['layer-bass-eq'],
        });

        expect(state.targetFingerprints['layer-bass-eq']).toContain('Bass EQ');
    });

    it('prefers a real master identity while keeping output fallbacks system-scoped', () => {
        const realMaster = captureCommandBatchPreflightState({
            assetReferences: [],
            projectDocument: {
                tracks: {
                    tracks: [
                        {
                            id: 'master',
                            name: 'Document Master',
                            kind: 'master',
                            gain: 0.73,
                            pan: 0,
                            outputId: 'hw_out',
                            clips: [],
                            devices: [],
                            sends: [],
                        },
                    ],
                },
            },
            targetIds: ['master', 'hw_out'],
        });
        const fallbacks = captureCommandBatchPreflightState({
            assetReferences: [],
            projectDocument: { tracks: { tracks: [] } },
            targetIds: ['master', 'hw_out', 'track-projection-only'],
        });

        expect(realMaster.targetFingerprints.master).toContain('Document Master');
        expect(realMaster.targetFingerprints.master).not.toBe('system-output:master');
        expect(realMaster.targetFingerprints.hw_out).toBe('system-output:hw_out');
        expect(fallbacks.targetFingerprints).toEqual({
            master: 'system-output:master',
            hw_out: 'system-output:hw_out',
        });
    });

    it('reports a cycle already present in the complete routing graph', () => {
        const context = projectContext();
        context.tracks[1]!.outputId = 'track-vocal';
        mocks.getProjectContext.mockReturnValue(context);

        const state = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });

        expect(state.audioGraphValid).toBe(false);
    });

    it('binds projectId to the document identity, independently of the revision it commits against', () => {
        const first = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });
        // projectId answers "same project"; it must stay put across an ordinary revision move so an
        // unrelated edit between an AI proposal and its confirm does not read as a different project.
        mocks.captureProjectRevision.mockReturnValue('document-identity-b');

        const stableAcrossRevision = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });

        expect(first.projectId).toBe('document-identity-a');
        expect(stableAcrossRevision.projectId).toBe('document-identity-a');

        mocks.captureProjectIdentity.mockReturnValue('document-identity-c');
        const afterProjectReplacement = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });

        expect(afterProjectReplacement.projectId).toBe('document-identity-c');
    });

    it('captures targets and routing from the staged root document when supplied', () => {
        const state = captureCommandBatchPreflightState({
            assetReferences: [],
            projectDocument: {
                tracks: {
                    tracks: [
                        {
                            id: 'track-vocal',
                            kind: 'audio',
                            gain: 1,
                            pan: 0,
                            outputId: 'bus-vocal',
                            clips: [],
                            devices: [],
                            sends: [],
                        },
                        {
                            id: 'bus-vocal',
                            kind: 'bus',
                            gain: 1,
                            pan: 0,
                            outputId: 'track-vocal',
                            clips: [],
                            devices: [],
                            sends: [],
                        },
                        {
                            id: 'track-created',
                            kind: 'audio',
                            gain: 1,
                            pan: 0,
                            outputId: 'master',
                            clips: [],
                            devices: [],
                            sends: [],
                        },
                    ],
                },
            },
            targetIds: ['track-created'],
        });

        expect(state.targetFingerprints['track-created']).toContain('track-created');
        expect(state.projectInvariantsValid).toBe(true);
        expect(state.audioGraphValid).toBe(false);
    });

    it('rejects invalid raw transport truth instead of validating its sanitized projection', () => {
        const state = captureCommandBatchPreflightState({
            assetReferences: [],
            projectDocument: {
                tracks: {
                    tracks: [
                        {
                            id: 'track-vocal',
                            kind: 'audio',
                            gain: 1,
                            pan: 0,
                            outputId: 'master',
                            clips: [],
                            devices: [],
                            sends: [],
                        },
                    ],
                },
                transport: { tempo: Number.POSITIVE_INFINITY },
            },
            targetIds: [],
        });

        expect(state).toMatchObject({ audioGraphValid: false, projectInvariantsValid: false });
    });

    it('validates staged raw truth without exposing projected model context during repair', () => {
        mocks.agentProjectRepairStateStore.value = { status: 'repair-required' };

        const state = captureCommandBatchPreflightState({
            assetReferences: [],
            projectDocument: {
                tracks: {
                    tracks: [
                        {
                            clips: [],
                            devices: [],
                            gain: 1,
                            id: 'master',
                            kind: 'master',
                            outputId: null,
                            pan: 0,
                            sends: [],
                        },
                    ],
                },
                transport: { tempo: 120 },
            },
            targetIds: ['master'],
        });

        expect(mocks.getProjectContext).not.toHaveBeenCalled();
        expect(state).toMatchObject({ audioGraphValid: true, projectInvariantsValid: true });
    });

    it('rejects a staged output target that cannot compile to an audio node', () => {
        const state = captureCommandBatchPreflightState({
            assetReferences: [],
            projectDocument: {
                tracks: {
                    tracks: [
                        {
                            id: 'track-vocal',
                            kind: 'audio',
                            gain: 1,
                            pan: 0,
                            outputId: 'folder-vocals',
                            clips: [],
                            devices: [],
                            sends: [],
                        },
                        {
                            id: 'folder-vocals',
                            kind: 'folder',
                            gain: 1,
                            pan: 0,
                            outputId: 'master',
                            clips: [],
                            devices: [],
                            sends: [],
                        },
                    ],
                },
            },
            targetIds: [],
        });

        expect(state.projectInvariantsValid).toBe(true);
        expect(state.audioGraphValid).toBe(false);
    });

    it('accepts nodeless VCA tracks in live and staged graph compilation', () => {
        const context = projectContext();
        context.tracks.push({
            ...context.tracks[0]!,
            id: 'vca-drums',
            name: 'Drum VCA',
            kind: 'vca',
            outputId: 'master',
        });
        mocks.getProjectContext.mockReturnValue(context);

        const live = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });
        const staged = captureCommandBatchPreflightState({
            assetReferences: [],
            projectDocument: {
                tracks: {
                    tracks: [
                        {
                            id: 'track-vocal',
                            kind: 'audio',
                            gain: 1,
                            pan: 0,
                            outputId: 'master',
                            clips: [],
                            devices: [],
                            sends: [],
                        },
                        {
                            id: 'vca-drums',
                            kind: 'vca',
                            gain: 1,
                            pan: 0,
                            outputId: 'master',
                            clips: [],
                            devices: [],
                            sends: [],
                        },
                    ],
                },
            },
            targetIds: [],
        });

        expect(live.audioGraphValid).toBe(true);
        expect(staged).toMatchObject({ audioGraphValid: true, projectInvariantsValid: true });
    });

    it('fails closed when there is no project document at all', () => {
        mocks.getCrdtDoc.mockReturnValue(undefined);

        const state = captureCommandBatchPreflightState({
            assetReferences: [{ assetHash: 'sha256:vocal', audioBufferId: 'buffer-vocal' }],
            targetIds: ['track-vocal', 'master'],
        });

        expect(state).toMatchObject({
            audioGraphValid: false,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: 'document-identity-a',
            projectInvariantsValid: false,
            targetFingerprints: { master: 'system-output:master' },
        });
    });
});
