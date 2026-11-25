import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../../models/ProjectContext';
import { type ToolCallResult } from '../../../transformers/toolCallParser';
import { groundContinuedCalls } from '../groundContinuedCalls';

type ContextTrack = ProjectContext['tracks'][number];

function createTrack(id: string, name: string, deviceType: string | null): ContextTrack {
    const devices =
        deviceType === null ? [] : [{ id: `device-${id}`, type: deviceType, bypassed: false, parameters: [] }];
    return {
        id,
        name,
        kind: 'audio',
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        gain: 1,
        pan: 0,
        automationMode: 'read',
        clipCount: 0,
        deviceCount: devices.length,
        clips: [],
        devices,
        sends: [],
    };
}

function projectWithBassDevice(targetDeviceType: string): ProjectContext {
    return {
        tempo: 120,
        timeSignature: [4, 4],
        isPlaying: false,
        isRecording: false,
        isLooping: false,
        loopStart: 0,
        loopEnd: 0,
        punchInEnabled: false,
        punchInBeat: 0,
        punchOutBeat: 0,
        metronomeEnabled: false,
        metronomeVolume: 0,
        masterGain: 1,
        selectedTrackId: null,
        selectedClipId: null,
        selectedClipIds: [],
        activeView: 'arrange',
        playheadPosition: 0,
        tracks: [createTrack('track-kick', 'Kick', null), createTrack('track-bass', 'Bass', targetDeviceType)],
        sidechainRoutes: [],
    };
}

const addKickToBass: ToolCallResult = {
    name: 'addSidechainRoute',
    arguments: { sourceTrackId: 'track-kick', targetTrackId: 'track-bass' },
};

describe('groundContinuedCalls sidechain routes', () => {
    it('admits a continued sidechain route onto a track holding a sidechain compressor', () => {
        const outcome = groundContinuedCalls([addKickToBass], projectWithBassDevice('builtin-sidechain-compressor'));

        expect(outcome).toEqual({
            status: 'actions',
            actions: [
                { type: 'addSidechainRoute', payload: { sourceTrackId: 'track-kick', targetTrackId: 'track-bass' } },
            ],
        });
    });

    it('refuses a continued sidechain route onto a track holding only a plain compressor', () => {
        const outcome = groundContinuedCalls([addKickToBass], projectWithBassDevice('builtin-compressor'));

        expect(outcome.status).toBe('denied');
        expect(JSON.stringify(outcome)).toContain('Expected one exact supported sidechain compressor');
    });
});
