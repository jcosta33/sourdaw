import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type getProjectContext } from '#/modules/AiRuntime/useCases';

import { captureCommandBatchPreflightState } from '../captureCommandBatchPreflightState';

const mocks = vi.hoisted(() => {
    const agentProjectRepairStateStore: { value: unknown } = { value: null };
    return {
        agentProjectRepairStateStore,
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
}));

vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: { has: mocks.hasAudioBuffer },
}));

vi.mock('#/modules/Collaboration/useCases', () => ({
    getAssetTransfer: mocks.getAssetTransfer,
}));

vi.mock('#/modules/CrdtDocument/stores', () => ({
    agentProjectRepairStateStore: mocks.agentProjectRepairStateStore,
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
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
        mocks.captureProjectRevision.mockReturnValue('document-identity-a');
        mocks.getProjectContext.mockReturnValue(projectContext());
        mocks.getCrdtDoc.mockReturnValue({
            tracks: [
                { id: 'track-vocal', gain: 1 },
                { id: 'bus-vocal', gain: 1 },
                { id: 'master', gain: 1 },
            ],
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

    it('reports a cycle already present in the complete routing graph', () => {
        const context = projectContext();
        context.tracks[1]!.outputId = 'track-vocal';
        mocks.getProjectContext.mockReturnValue(context);

        const state = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });

        expect(state.audioGraphValid).toBe(false);
    });

    it('binds copied project metadata to the active document identity', () => {
        const first = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });
        mocks.captureProjectRevision.mockReturnValue('document-identity-b');

        const second = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });

        expect(first.projectId).toBe('document-identity-a');
        expect(second.projectId).toBe('document-identity-b');
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
});
