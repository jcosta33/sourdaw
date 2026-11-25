import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../../../models/ProjectContext';
import { maskProjectReferences } from '../maskProjectReferences';

function contextWithClipNamed(name: string): ProjectContext {
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
        tracks: [
            {
                id: 'track-drums',
                name: 'Drums',
                kind: 'midi',
                muted: false,
                soloed: false,
                soloSafe: false,
                armed: false,
                gain: 1,
                pan: 0,
                automationMode: 'read',
                clipCount: 1,
                deviceCount: 0,
                devices: [],
                clips: [{ id: 'clip-drums', name, type: 'midi', startBeat: 0, endBeat: 4 }],
            },
        ],
    };
}

describe('maskProjectReferences', () => {
    it.each([
        ['4-beat loop', 'Beat', '4-beat loop'],
        ['for 4 beats', 'Beats', 'for 4 beats'],
        ['an 8-bar intro', 'Bar', 'an 8-bar intro'],
        ['for 2 measures', 'Measures', 'for 2 measures'],
    ])('keeps the counted duration in %s when a clip is named %s', (prompt, clipName, expected) => {
        expect(maskProjectReferences(prompt, contextWithClipNamed(clipName))).toBe(expected);
    });

    it.each([
        ['mute the Beat clip', 'Beat', 'mute the □□□□ clip'],
        ['make the beat louder', 'Beat', 'make the clip louder'],
    ])('still masks a clip reference in %s', (prompt, clipName, expected) => {
        expect(maskProjectReferences(prompt, contextWithClipNamed(clipName))).toBe(expected);
    });
});
