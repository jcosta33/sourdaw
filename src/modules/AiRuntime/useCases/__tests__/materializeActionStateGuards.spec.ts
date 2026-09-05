import { describe, expect, it } from 'vitest';

import { type ProjectContext, type ProjectContextTrack } from '../../models/ProjectContext';
import { materializeActionStateGuards } from '../materializeActionStateGuards';

const filterTypeParameter = {
    id: 'filter-type',
    name: 'Type',
    type: 'choice' as const,
    value: 0,
    minValue: 0,
    maxValue: 2,
    legalValues: [0, 1, 2],
    unit: '',
    choices: ['Lowpass', 'Highpass', 'Bandpass'],
};

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
    availableDeviceTypes: [
        {
            id: 'builtin-filter',
            name: 'Filter',
            parameters: [{ ...filterTypeParameter }],
        },
    ],
    tracks: [],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

function createExistingTrack(frozen = false): ProjectContextTrack {
    return {
        id: 'track-existing',
        name: 'Existing',
        kind: 'audio',
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        frozen,
        gain: 1,
        pan: 0,
        automationMode: 'read',
        clipCount: 0,
        deviceCount: 1,
        clips: [],
        devices: [
            {
                id: 'filter-a',
                name: 'Filter',
                type: 'builtin-filter',
                bypassed: false,
                parameters: [{ ...filterTypeParameter }],
            },
        ],
        sends: [],
    };
}

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

    it('guards an existing-track parameter against its prefix chain before a later insertion', () => {
        const existingTrack = createExistingTrack();
        const result = materializeActionStateGuards(
            [
                {
                    type: 'setDeviceParameter',
                    payload: {
                        deviceId: 'filter-a',
                        paramId: 'filter-type',
                        value: 1,
                        expectedTrackId: existingTrack.id,
                        expectedDeviceType: 'builtin-filter',
                        expectedDeviceIds: ['filter-a', 'filter-b'],
                        expectedValue: 0,
                        expectedTrackFrozen: false,
                    },
                },
                {
                    type: 'addDevice',
                    payload: {
                        trackId: existingTrack.id,
                        deviceType: 'builtin-filter',
                        deviceId: 'filter-b',
                        afterDeviceId: 'filter-a',
                    },
                },
            ],
            { ...context, tracks: [existingTrack] }
        );

        expect(result).toMatchObject({
            status: 'accepted',
            actions: [
                { type: 'setDeviceParameter', payload: { expectedDeviceIds: ['filter-a'] } },
                { type: 'addDevice', payload: { expectedDeviceIds: ['filter-a'] } },
            ],
        });
    });

    it.each([
        ['wrong owner', { expectedTrackId: 'track-other' }, false],
        ['wrong type', { expectedDeviceType: 'builtin-eq' }, false],
        ['wrong value', { expectedValue: 2 }, false],
        ['frozen owner', { expectedTrackFrozen: true }, true],
    ] as const)('refuses a guarded parameter with a %s', (_label, mismatchedGuard, frozen) => {
        const existingTrack = createExistingTrack(frozen);

        expect(
            materializeActionStateGuards(
                [
                    {
                        type: 'setDeviceParameter',
                        payload: {
                            deviceId: 'filter-a',
                            paramId: 'filter-type',
                            value: 1,
                            expectedTrackId: existingTrack.id,
                            expectedDeviceType: 'builtin-filter',
                            expectedDeviceIds: ['filter-a'],
                            expectedValue: 0,
                            expectedTrackFrozen: false,
                            ...mismatchedGuard,
                        },
                    },
                ],
                { ...context, tracks: [existingTrack] }
            )
        ).toEqual({
            status: 'rejected',
            reason: 'Device parameter state is unavailable or protected: filter-a/filter-type',
        });
    });
});
