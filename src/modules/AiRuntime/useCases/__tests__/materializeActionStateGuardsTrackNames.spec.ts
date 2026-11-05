import { describe, expect, it } from 'vitest';

import { type ProjectContext, type ProjectContextTrack } from '../../models/ProjectContext';
import { materializeActionStateGuards } from '../materializeActionStateGuards';

function track(id: string, name: string, kind: string): ProjectContextTrack {
    return {
        id,
        name,
        kind,
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        frozen: false,
        gain: 0.8,
        pan: 0,
        automationMode: 'read',
        vcaGroupId: null,
        outputId: 'master',
        clipCount: 0,
        deviceCount: 0,
        clips: [],
        devices: [],
        sends: [],
    };
}

function context(tracks: ProjectContextTrack[]): ProjectContext {
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
        punchOutBeat: 16,
        metronomeEnabled: false,
        metronomeVolume: 0.5,
        masterGain: 0.8,
        automationLanes: [],
        sections: [],
        tracks,
        selectedTrackId: null,
        selectedClipId: null,
        selectedClipIds: [],
        activeView: 'arrange',
        playheadPosition: 0,
    };
}

describe('materializeActionStateGuards — created track names', () => {
    it('pins each nameless planned track to the next default name of its kind, counting earlier planned tracks', () => {
        const result = materializeActionStateGuards(
            [
                { type: 'addTrack', payload: { id: 'track-a', kind: 'midi' } },
                { type: 'addTrack', payload: { id: 'track-b', name: 'Pad', kind: 'midi' } },
                { type: 'addTrack', payload: { id: 'track-c', kind: 'midi' } },
                { type: 'addTrack', payload: { id: 'track-d', kind: 'audio' } },
            ],
            context([track('t-midi', 'MIDI 2', 'midi'), track('t-lead', 'Lead', 'midi')])
        );

        expect(result).toMatchObject({
            status: 'accepted',
            actions: [
                { type: 'addTrack', payload: { id: 'track-a', name: 'MIDI 3' } },
                { type: 'addTrack', payload: { id: 'track-b', name: 'Pad' } },
                { type: 'addTrack', payload: { id: 'track-c', name: 'MIDI 4' } },
                { type: 'addTrack', payload: { id: 'track-d', name: 'Audio 1' } },
            ],
        });
    });
});
