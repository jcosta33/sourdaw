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
        ['add a 2 beat send', 'Beat', 'add a 2 beat send'],
        ['add a 4 bar track', '4 Bar', 'add a 4 bar track'],
        ['mute 8 Bars Drums', '8 Bars Drums', 'mute 8 Bars Drums'],
        ['mute "8 Bars loop', '8 Bars', 'mute "8 Bars loop'],
    ])('keeps the counted duration in %s when a clip is named %s', (prompt, clipName, expected) => {
        expect(maskProjectReferences(prompt, contextWithClipNamed(clipName))).toBe(expected);
    });

    it.each([
        ['mute the Beat clip', 'Beat', 'mute the □□□□ clip'],
        ['make the beat louder', 'Beat', 'make the clip louder'],
        ['mute the Beat Loop', 'Beat Loop', 'mute the clip□□□□□'],
        ['mute Verse and Chorus 8 Bars', 'Verse and Chorus 8 Bars', `mute clip${'□'.repeat(19)}`],
        ['mute the 8 Bars clip', '8 Bars', 'mute the □□□□□□ clip'],
        ['rename the clip 8 Bars to Intro', '8 Bars', 'rename the clip clip□□ to Intro'],
        ['mute the 8 Bars', '8 Bars', 'mute the clip□□'],
        ['mute "8 Bars"', '8 Bars', 'mute "clip□□"'],
        ['mute the clips 8 Bars', '8 Bars', 'mute the clips clip□□'],
        ['mute the 8 Bars section', '8 Bars', 'mute the □□□□□□ section'],
    ])('still masks a clip reference in %s', (prompt, clipName, expected) => {
        expect(maskProjectReferences(prompt, contextWithClipNamed(clipName))).toBe(expected);
    });

    it('masks a track named by a counted phrase after the word track', () => {
        expect(maskProjectReferences('mute track 4 Beat', contextWithClipNamed('Intro', '4 Beat'))).toBe(
            'mute track □□□□□□'
        );
    });

    it('masks a track named after the word send', () => {
        expect(maskProjectReferences('mute send 8 Bars', contextWithClipNamed('Intro', '8 Bars'))).toBe(
            'mute send □□□□□□'
        );
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

    it('keeps a count and masks a track when a clip name matches only the unit', () => {
        expect(maskProjectReferences('for 4 beats, mute the Drums clip', contextWithClipNamed('Beats', 'Drums'))).toBe(
            'for 4 beats, mute the □□□□□ clip'
        );
    });

    it('keeps a count when a track name equals the unit word of an entity-suffixed phrase', () => {
        expect(maskProjectReferences('add a 4 bar track', contextWithClipNamed('4 Bar', 'Bar'))).toBe(
            'add a 4 bar track'
        );
    });

    it('keeps a count whose containing clip name holds a track name', () => {
        expect(maskProjectReferences('mute 8 Bars Drums', contextWithClipNamed('8 Bars Drums', 'Drums'))).toBe(
            'mute 8 Bars Drums'
        );
    });
});
