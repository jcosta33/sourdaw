import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../models/ProjectContext';
import { getPlannedActionAffectedIds } from '../getPlannedActionAffectedIds';
import { getPlannedActionAffectedIdsWithOwners } from '../getPlannedActionAffectedIdsWithOwners';

describe('getPlannedActionAffectedIdsWithOwners', () => {
    const context = {
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
        tracks: [
            {
                id: 'track-a',
                name: 'A',
                kind: 'audio',
                muted: false,
                soloed: false,
                soloSafe: false,
                armed: false,
                gain: 0.8,
                pan: 0,
                automationMode: 'read',
                clipCount: 0,
                deviceCount: 1,
                clips: [],
                devices: [{ id: 'device-1', type: 'eq', bypassed: false }],
            },
        ],
        selectedTrackId: null,
        selectedClipId: null,
        selectedClipIds: [],
        activeView: 'mix',
        playheadPosition: 0,
    } satisfies ProjectContext;

    it('names the track that owns the existing device a parameter write targets', () => {
        const action = {
            type: 'setDeviceParameter',
            payload: { deviceId: 'device-1', paramId: 'gain', value: 1 },
        } as const;

        expect(getPlannedActionAffectedIds(action)).not.toContain('track-a');
        expect(getPlannedActionAffectedIdsWithOwners(action, context)).toEqual(
            expect.arrayContaining(['device-1', 'track-a'])
        );
    });

    it('names no track for a device the project does not hold', () => {
        expect(
            getPlannedActionAffectedIdsWithOwners(
                { type: 'setDeviceParameter', payload: { deviceId: 'device-unknown', paramId: 'gain', value: 1 } },
                context
            )
        ).not.toContain('track-a');
    });

    it('still names the track an addDevice targets', () => {
        expect(
            getPlannedActionAffectedIdsWithOwners(
                { type: 'addDevice', payload: { trackId: 'track-a', deviceType: 'eq', deviceId: 'device-new' } },
                context
            )
        ).toEqual(['track-a', 'device-new']);
    });
});
