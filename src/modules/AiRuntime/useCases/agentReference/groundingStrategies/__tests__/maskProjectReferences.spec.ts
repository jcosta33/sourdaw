import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../../../models/ProjectContext';
import { maskProjectReferences } from '../maskProjectReferences';

function contextWithClipNamed(clipName: string, trackName = 'Drums'): ProjectContext {
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
                name: trackName,
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
                clips: [{ id: 'clip-drums', name: clipName, type: 'midi', startBeat: 0, endBeat: 4 }],
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
        ['4 beat loop', 'Beat Loop', '4 beat loop'],
        ['4-beat loop', 'Beat Loop', '4-beat loop'],
        ['a 4--beat loop', 'Beat', 'a 4--beat loop'],
        ['a 4 bar loop', '4 Bar Loop', 'a 4 bar loop'],
        ['for 8 bars', '8 Bars', 'for 8 bars'],
        ['for 4 beats', '4', 'for 4 beats'],
        ['mute 8 Bars Drums', '8 Bars Drums', 'mute 8 Bars Drums'],
    ])('keeps the counted duration in %s when a clip is named %s', (prompt, clipName, expected) => {
        expect(maskProjectReferences(prompt, contextWithClipNamed(clipName))).toBe(expected);
    });

    it.each([
        ['mute the Beat clip', 'Beat', 'mute the □□□□ clip'],
        ['make the beat louder', 'Beat', 'make the clip louder'],
        ['mute the Beat Loop', 'Beat Loop', 'mute the clip□□□□□'],
        ['mute Verse and Chorus 8 Bars', 'Verse and Chorus 8 Bars', `mute clip${'□'.repeat(19)}`],
        ['mute the 8 Bars clip', '8 Bars', 'mute the □□□□□□ clip'],
    ])('still masks a clip reference in %s', (prompt, clipName, expected) => {
        expect(maskProjectReferences(prompt, contextWithClipNamed(clipName))).toBe(expected);
    });

    it('masks a clip beside a track whose name ends in a number', () => {
        const masked = maskProjectReferences('mute Take 2 Beat', contextWithClipNamed('Beat', 'Take 2'));
        expect(masked).not.toContain('Take 2');
        expect(masked).not.toContain('Beat');
    });

    it('keeps a decimal count when a track is named by its whole part', () => {
        expect(maskProjectReferences('mute Take 2.5 beats', contextWithClipNamed('Beat', 'Take 2'))).toBe(
            'mute Take 2.5 beats'
        );
    });
});
