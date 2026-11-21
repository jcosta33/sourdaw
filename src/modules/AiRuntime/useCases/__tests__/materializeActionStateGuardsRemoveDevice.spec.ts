import { describe, expect, it } from 'vitest';

import { type ProjectContext, type ProjectContextTrack } from '../../models/ProjectContext';
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
    availableDeviceTypes: [],
    tracks: [],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

function createTrack(frozen: boolean, id = 'track-existing'): ProjectContextTrack {
    return {
        id,
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
        devices: [{ id: 'filter-a', name: 'Filter', type: 'builtin-filter', bypassed: false, parameters: [] }],
        sends: [],
    };
}

describe('materializeActionStateGuards removeDevice', () => {
    it('refuses a removal from a frozen track the way an addition is refused', () => {
        expect(
            materializeActionStateGuards([{ type: 'removeDevice', payload: { deviceId: 'filter-a' } }], {
                ...context,
                tracks: [createTrack(true)],
            })
        ).toEqual({ status: 'rejected', reason: 'Track is frozen: track-existing' });
    });

    it('pins the unfrozen state a removal was planned against', () => {
        expect(
            materializeActionStateGuards([{ type: 'removeDevice', payload: { deviceId: 'filter-a' } }], {
                ...context,
                tracks: [createTrack(false)],
            })
        ).toEqual({
            status: 'accepted',
            actions: [{ type: 'removeDevice', payload: { deviceId: 'filter-a', expectedFrozen: false } }],
        });
    });

    it('reads a freeze change an earlier batch member makes before the removal', () => {
        expect(
            materializeActionStateGuards(
                [
                    { type: 'unfreezeTrack', payload: { trackId: 't1' } },
                    { type: 'removeDevice', payload: { deviceId: 'filter-a' } },
                ],
                { ...context, tracks: [createTrack(true, 't1')] }
            )
        ).toEqual({
            status: 'accepted',
            actions: [
                { type: 'unfreezeTrack', payload: { trackId: 't1' } },
                { type: 'removeDevice', payload: { deviceId: 'filter-a', expectedFrozen: false } },
            ],
        });
    });

    it('refuses a removal from a track an earlier batch member freezes', () => {
        expect(
            materializeActionStateGuards(
                [
                    { type: 'freezeTrack', payload: { trackId: 't1' } },
                    { type: 'removeDevice', payload: { deviceId: 'filter-a' } },
                ],
                { ...context, tracks: [createTrack(false, 't1')] }
            )
        ).toEqual({ status: 'rejected', reason: 'Track is frozen: t1' });
    });
});
