import { describe, expect, it } from 'vitest';

import { type ProjectContext, type ProjectContextTrack } from '../../models/ProjectContext';
import { readComparedQualityWords } from '../readComparedQualityWords';

function track(id: string, name: string, parts: Partial<ProjectContextTrack> = {}): ProjectContextTrack {
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
        deviceCount: 0,
        clips: [],
        devices: [],
        ...parts,
    };
}

function context(parts: Partial<ProjectContext>): ProjectContext {
    return {
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
        tracks: [track('vocal', 'Vocal')],
        selectedTrackId: null,
        selectedClipId: null,
        selectedClipIds: [],
        activeView: 'arrange',
        playheadPosition: 0,
        ...parts,
    };
}

describe('readComparedQualityWords', () => {
    it.each([
        [
            'a section name',
            context({ sections: [{ id: 'section-1', name: 'Dark Bridge', startBeat: 0, endBeat: 16 }] }),
            'make the vocal as loud as the Dark Bridge',
            [['loudness', 'loud']],
        ],
        [
            'a clip name',
            context({
                tracks: [
                    track('vocal', 'Vocal'),
                    track('piano', 'Piano', {
                        clips: [
                            { id: 'c1', name: 'Bright Keys', type: 'audio', startBeat: 0, endBeat: 4, noteCount: 0 },
                        ],
                    }),
                ],
            }),
            'make the vocal as wide as the Bright Keys clip',
            [['width', 'wide']],
        ],
        [
            'the same word outside any name',
            context({ sections: [{ id: 'section-1', name: 'Bridge', startBeat: 0, endBeat: 16 }] }),
            'make the vocal as dark as the Bridge',
            [['brightness', 'dark']],
        ],
    ] satisfies [string, ProjectContext, string, [string, string][]][])(
        'reads no quality word inside %s',
        (_kind, projectContext, prompt, expected) => {
            expect([...readComparedQualityWords(prompt, projectContext)]).toEqual(expected);
        }
    );
});
