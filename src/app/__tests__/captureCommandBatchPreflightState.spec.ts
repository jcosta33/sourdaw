import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type getProjectContext } from '#/modules/AiRuntime/useCases';

import { captureCommandBatchPreflightState } from '../captureCommandBatchPreflightState';

const mocks = vi.hoisted(() => ({
    getAssetTransfer: vi.fn(),
    getCrdtDoc: vi.fn<(id: string) => unknown>(),
    getProjectContext: vi.fn(),
    hasAudioBuffer: vi.fn<(id: string) => boolean>(),
    projectStore: { value: { createdAt: 42 } },
    trackStore: { value: { tracks: [] } },
}));

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

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    DOC_PREFIX_ROOT: 'root',
    getCrdtDoc: mocks.getCrdtDoc,
}));

vi.mock('#/modules/Project/stores', () => ({
    projectStore: mocks.projectStore,
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
            projectId: '42',
            projectInvariantsValid: true,
            targetFingerprints: {
                hw_out: 'system-output:hw_out',
            },
        });
        expect(state.targetFingerprints['track-vocal']).toContain('track-vocal');
    });

    it('reports a cycle already present in the complete routing graph', () => {
        const context = projectContext();
        context.tracks[1]!.outputId = 'track-vocal';
        mocks.getProjectContext.mockReturnValue(context);

        const state = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });

        expect(state.audioGraphValid).toBe(false);
    });

    it('captures targets and routing from the staged root document when supplied', () => {
        const state = captureCommandBatchPreflightState({
            assetReferences: [],
            projectDocument: {
                tracks: {
                    tracks: [
                        {
                            id: 'track-vocal',
                            gain: 1,
                            pan: 0,
                            outputId: 'bus-vocal',
                            clips: [],
                            devices: [],
                            sends: [],
                        },
                        {
                            id: 'bus-vocal',
                            gain: 1,
                            pan: 0,
                            outputId: 'track-vocal',
                            clips: [],
                            devices: [],
                            sends: [],
                        },
                        {
                            id: 'track-created',
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
});
