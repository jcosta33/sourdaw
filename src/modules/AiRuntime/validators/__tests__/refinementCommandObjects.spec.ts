import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../../models/ProjectContext';
import { proposalCommandShape } from '../../useCases/agentReference/proposalCommandShape';
import { readStoredCardRemoval } from '../../useCases/agentReference/readStoredCardRemoval';
import { readStoredCommandObjects, validateRefinedProposalActions } from '../admitProposalRefinement';

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
    automationLanes: [],
    tracks: [
        {
            id: 'track-keys',
            name: 'Keys',
            kind: 'audio',
            muted: false,
            soloed: false,
            soloSafe: false,
            armed: false,
            gain: 0.8,
            pan: 0,
            automationMode: 'read',
            outputId: 'master',
            clipCount: 0,
            deviceCount: 1,
            clips: [],
            sends: [],
            frozen: false,
            devices: [
                {
                    id: 'device-reverb',
                    type: 'Reverb',
                    bypassed: false,
                    parameters: [
                        { id: 'mix', name: 'Mix', type: 'float', value: 25, minValue: 0, maxValue: 100, unit: '%' },
                    ],
                },
            ],
        },
    ],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'mix',
    playheadPosition: 0,
};

describe('stored refinement command objects', () => {
    it('excludes expected guard IDs from stated object IDs', () => {
        const action = {
            type: 'setDeviceParameter',
            payload: {
                deviceId: 'device-reverb',
                paramId: 'mix',
                value: 40,
                expectedTrackId: 'track-keys',
                expectedDeviceType: 'Reverb',
                expectedValue: 25,
                expectedValuePresent: true,
            },
        } satisfies AppAction;
        const owner = context.tracks[0]!;
        expect(owner.id).toBe(action.payload.expectedTrackId);
        expect(owner.devices[0]).toMatchObject({
            id: action.payload.deviceId,
            type: action.payload.expectedDeviceType,
            parameters: [{ id: action.payload.paramId, value: action.payload.expectedValue }],
        });
        expect(readStoredCommandObjects(action, proposalCommandShape.createdObject, context)).toEqual({
            created: null,
            targetIds: ['device-reverb', 'mix'],
        });
    });

    it('pairs created names without regard to case', () => {
        const bus = (name: string, busId: string) =>
            ({ type: 'createBus', payload: { name, busId } }) satisfies AppAction;
        const pending = bus('Bass', 'bus-original');
        expect(context.tracks.some((track) => track.name.toLowerCase() === 'bass')).toBe(false);
        expect(proposalCommandShape.createdObject(pending.type, pending.payload, context)).toEqual({
            idFields: ['busId'],
            names: ['Bass'],
        });
        const admit = (name: string) =>
            validateRefinedProposalActions({
                pendingActions: [pending],
                actions: [bus(name, 'bus-new')],
                prompt: 'Keep it.',
                context,
                createdObject: proposalCommandShape.createdObject,
                readRemoval: readStoredCardRemoval,
            });
        expect(admit('Bass')).toEqual({ status: 'valid' });
        expect(admit('bass')).toEqual({ status: 'valid' });
        expect(admit('Drums')).toEqual({
            status: 'refused',
            reason: 'Refined proposal omits a pending createBus command without an explicit request to remove it.',
        });
    });
});
