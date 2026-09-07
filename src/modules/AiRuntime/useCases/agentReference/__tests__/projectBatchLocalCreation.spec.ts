import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../../models/ProjectContext';
import { projectBatchLocalCreation } from '../projectBatchLocalCreation';

const parameter = {
    id: 'filter-type',
    name: 'Type',
    type: 'choice' as const,
    value: 0,
    minValue: 0,
    maxValue: 3,
    unit: '',
    choices: ['Lowpass', 'Highpass', 'Bandpass', 'Notch'],
};

const context: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 0,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 16,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    tracks: [
        {
            id: 'track-lead',
            name: 'Lead',
            kind: 'midi',
            muted: false,
            soloed: false,
            soloSafe: false,
            armed: false,
            frozen: false,
            gain: 1,
            pan: 0,
            automationMode: 'read',
            clipCount: 0,
            deviceCount: 2,
            clips: [],
            devices: [
                { id: 'device-before', name: 'Gain', type: 'builtin-gain', bypassed: false },
                { id: 'device-after', name: 'Delay', type: 'builtin-delay', bypassed: false },
            ],
            sends: [],
        },
    ],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

describe('projectBatchLocalCreation', () => {
    it('projects the canonical MIDI track defaults with its application-owned Synth identity', () => {
        const projected = projectBatchLocalCreation(
            { ...context, tracks: [] },
            {
                createdId: 'track-lead',
                initialDeviceId: 'device-command-synth',
                kind: 'track',
                name: 'Lead',
                trackKind: 'midi',
            }
        );

        expect(projected.tracks).toEqual([
            {
                id: 'track-lead',
                name: 'Lead',
                kind: 'midi',
                muted: false,
                soloed: false,
                soloSafe: false,
                armed: false,
                frozen: false,
                gain: 0.8,
                pan: 0,
                automationMode: 'read',
                outputId: 'master',
                clipCount: 0,
                deviceCount: 1,
                clips: [],
                devices: [
                    {
                        id: 'device-command-synth',
                        name: 'Synth',
                        type: 'builtin-synth',
                        bypassed: false,
                        parameters: [],
                    },
                ],
                sends: [],
            },
        ]);
    });

    it('projects a descriptor-backed device at its exact chain anchor with canonical defaults', () => {
        const projected = projectBatchLocalCreation(context, {
            afterDeviceId: 'device-before',
            createdId: 'device-filter',
            deviceType: 'builtin-filter',
            kind: 'device',
            name: 'Filter',
            parameters: [parameter],
            parentTrackId: 'track-lead',
        });

        expect(projected.tracks[0]?.deviceCount).toBe(3);
        expect(projected.tracks[0]?.devices).toEqual([
            context.tracks[0]?.devices[0],
            {
                id: 'device-filter',
                name: 'Filter',
                type: 'builtin-filter',
                bypassed: false,
                parameters: [parameter],
            },
            context.tracks[0]?.devices[1],
        ]);
    });
});
