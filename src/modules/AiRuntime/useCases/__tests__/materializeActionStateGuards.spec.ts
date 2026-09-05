import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../models/ProjectContext';
import { materializeActionStateGuards } from '../materializeActionStateGuards';

const context: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 16,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 16,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    tracks: [],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

describe('materializeActionStateGuards', () => {
    it('projects an earlier application-assigned track before guarding its device insertion', () => {
        const result = materializeActionStateGuards(
            [
                {
                    type: 'addTrack',
                    payload: {
                        id: 'track-ai-00000000-0000-4000-8000-000000000001',
                        initialDeviceId: 'device-command-00000000-0000-4000-8000-000000000003',
                        name: 'Lead',
                        kind: 'midi',
                        select: false,
                    },
                },
                {
                    type: 'addDevice',
                    payload: {
                        trackId: 'track-ai-00000000-0000-4000-8000-000000000001',
                        deviceType: 'builtin-filter',
                        deviceId: 'device-ai-00000000-0000-4000-8000-000000000002',
                    },
                },
            ],
            context
        );

        expect(result).toEqual({
            status: 'accepted',
            actions: [
                {
                    type: 'addTrack',
                    payload: {
                        id: 'track-ai-00000000-0000-4000-8000-000000000001',
                        initialDeviceId: 'device-command-00000000-0000-4000-8000-000000000003',
                        name: 'Lead',
                        kind: 'midi',
                        select: false,
                    },
                },
                {
                    type: 'addDevice',
                    payload: {
                        trackId: 'track-ai-00000000-0000-4000-8000-000000000001',
                        deviceType: 'builtin-filter',
                        deviceId: 'device-ai-00000000-0000-4000-8000-000000000002',
                        expectedDeviceIds: ['device-command-00000000-0000-4000-8000-000000000003'],
                        expectedFrozen: false,
                    },
                },
            ],
        });
    });

    it('refuses a projected track identity that already exists in project truth', () => {
        const existingTrack = {
            id: 'track-ai-00000000-0000-4000-8000-000000000001',
            name: 'Existing',
            kind: 'midi',
            muted: false,
            soloed: false,
            soloSafe: false,
            armed: false,
            frozen: false,
            gain: 1,
            pan: 0,
            automationMode: 'read' as const,
            clipCount: 0,
            deviceCount: 0,
            clips: [],
            devices: [],
            sends: [],
        };

        expect(
            materializeActionStateGuards(
                [
                    {
                        type: 'addTrack',
                        payload: { id: existingTrack.id, name: 'Lead', kind: 'midi', select: false },
                    },
                ],
                { ...context, tracks: [existingTrack] }
            )
        ).toEqual({ status: 'rejected', reason: `Track identity is already in use: ${existingTrack.id}` });
    });
});
