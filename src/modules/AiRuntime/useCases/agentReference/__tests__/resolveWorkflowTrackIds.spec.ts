import { describe, expect, it } from 'vitest';

import { getCanonicalTrackRole } from '#/modules/Project/useCases';

import { type ProjectContext, type ProjectContextTrack } from '../../../models/ProjectContext';
import { resolveWorkflowTrackIds } from '../resolveWorkflowTrackIds';

// The canonical role is what the real classifier derives from the name, exactly as the context
// producer fills it, so the drums family is read from the one classifier and not from a fixture.
function createTrack(id: string, name: string): ProjectContextTrack {
    return {
        id,
        name,
        kind: 'audio',
        canonicalRole: getCanonicalTrackRole({ track: { id, name, kind: 'audio', clips: [], devices: [] } }),
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
        deviceCount: 0,
        clips: [],
        devices: [],
        sends: [],
    };
}

function createContext(tracks: ProjectContextTrack[]): ProjectContext {
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
        tracks,
        selectedTrackId: null,
        selectedClipId: null,
        selectedClipIds: [],
        activeView: 'arrange',
        playheadPosition: 0,
    };
}

describe('resolveWorkflowTrackIds roleFamily drums', () => {
    it('selects drum abbreviations, hats and kit mics and leaves out a Hat Trick track', () => {
        const context = createContext([
            createTrack('track-oh', 'OH'),
            createTrack('track-bd', 'BD'),
            createTrack('track-hats', 'Hats'),
            createTrack('track-room', 'Drum Room'),
            createTrack('track-hat-trick', 'Hat Trick'),
            createTrack('track-room-tone', 'Room'),
        ]);

        expect(resolveWorkflowTrackIds(context, 'drums', { all: [{ roleFamily: 'drums' }] })).toEqual([
            'track-oh',
            'track-bd',
            'track-hats',
            'track-room',
        ]);
    });
});
