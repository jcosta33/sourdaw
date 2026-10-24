import { describe, expect, it } from 'vitest';

import { type ProjectContext, type ProjectContextTrack } from '../../../models/ProjectContext';
import { readExplicitProtections } from '../readExplicitProtections';

function createTrack(id: string, name: string, overrides: Partial<ProjectContextTrack> = {}): ProjectContextTrack {
    return {
        id,
        name,
        kind: 'audio',
        muted: false,
        soloed: false,
        soloSafe: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        automationMode: 'read',
        clipCount: 0,
        deviceCount: 0,
        clips: [],
        devices: [],
        ...overrides,
    };
}

const keys = createTrack('track-keys', 'Keys');
const bass = createTrack('track-bass', 'Bass');
const drums = createTrack('track-drums', 'Drums');
const rockAndRoll = createTrack('track-rock', 'Rock and Roll');
const drumBus = createTrack('track-drum-bus', 'Drum Bus');
const subBoost = createTrack('track-sub-boost', 'Sub Boost');
const homeAlone = createTrack('track-home-alone', 'Home Alone');
const drBeat = createTrack('track-dr-beat', 'Dr. Beat');
const guitar = createTrack('track-guitar', 'Guitar', {
    clips: [
        {
            id: 'clip-lead',
            name: 'Lead',
            type: 'audio',
            startBeat: 0,
            endBeat: 8,
            noteCount: 0,
            locked: false,
        },
    ],
    devices: [{ id: 'device-comp', type: 'compressor', name: 'Glue', bypassed: false, parameters: [] }],
});

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
    tracks: [keys, bass, drums, rockAndRoll, drumBus, subBoost, homeAlone, drBeat, guitar],
    markers: [{ id: 'marker-chorus', name: 'Chorus', beat: 32 }],
    sections: [{ id: 'section-verse', name: 'Verse', startBeat: 0, endBeat: 32 }],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'mix',
    playheadPosition: 0,
    vcaGroups: [{ id: 'vca-strings', name: 'Strings', gain: 1, muted: false, trackIds: [keys.id, bass.id] }],
};
const drumsSelected: ProjectContext = { ...context, selectedTrackId: drums.id };
const keysSelected: ProjectContext = { ...context, selectedTrackId: keys.id };
const noVcaProject: ProjectContext = { ...context, vcaGroups: [] };
function unresolvedIn(prompt: string, project: ProjectContext = context): string[] {
    return readExplicitProtections(prompt, project).unresolved;
}

const SEND_ACTIONS = ['addSend', 'removeSend', 'setSend'];
const NOTHING = { unresolved: [], protectedTrackIds: [], namedTrackIds: [], protectedControls: [] };

describe('readExplicitProtections', () => {
    describe('refuses only an object form that names a project object and binds to none', () => {
        it.each([
            // a control of it
            ['do not change pan, solo, and fader of Ghost', ['Ghost']],
            ["don't change the pan of Ghost", ['Ghost']],
            ['turn Keys down 3 dB; the pan of Ghost stays as is', ['Ghost']],
            ['leave the volume or the fader of the Kick alone', ['Kick']],
            // a possessive control
            ["leave Ghost's fader alone", ['Ghost']],
            ['leave Ghost’s fader alone', ['Ghost']],
            ["don't touch Ghost's pan", ['Ghost']],
            // a singular kind of it
            ['leave the Ghost track alone', ['Ghost']],
            ['keep the Ghost track as is', ['Ghost']],
            ['keep the "Ghost" track as is', ['Ghost']],
            ['leave the "Ghost" bus alone', ['Ghost']],
            ['turn Keys down 3 dB; Ghost send stays as is', ['Ghost']],
            ['leave the Backing Vocal track alone', ['Backing Vocal']],
            ['turn Keys down 3 dB; Leave the Ghost track alone', ['Ghost']],
            // a position
            ['leave the first track alone', ['first track']],
            ['leave Keys as well as the first track alone', ['first track']],
            ['leave Keys along with the second track alone', ['second track']],
            ['leave Keys as well as the last one alone', ['last one']],
            ['leave the Keys alone except the second one', ['second one']],
            ['leave the next one alone', ['next one']],
            ["don't touch track 2", ['track 2']],
            // a selection phrase
            ['leave Keys plus it alone', ['it']],
            ['leave this track alone', ['this track']],
            ['leave the selected track alone', ['the selected track']],
            ["don't touch it", ['it']],
            ['keep its pan as is', ['its pan']],
            ["leave the selected track's fader alone", ["the selected track's fader"]],
        ])('reports the reference in "%s"', (prompt, expected) => {
            expect(unresolvedIn(prompt)).toEqual(expected);
        });

        it('reports a selection phrase when only a clip is selected and the phrase names a track', () => {
            const clipSelected = { ...context, selectedClipId: 'clip-lead', selectedClipIds: ['clip-lead'] };

            expect(unresolvedIn('leave this track alone', clipSelected)).toEqual(['this track']);
            expect(unresolvedIn('leave this one alone', clipSelected)).toEqual([]);
        });

        it('reports a pronoun beside two named targets, which could be either', () => {
            expect(unresolvedIn('turn Keys and Bass down 3 dB, then keep its pan as is')).toEqual(['its pan']);
        });

        it('reports a position when the project has no tracks', () => {
            expect(unresolvedIn('leave the first track alone', { ...context, tracks: [] })).toEqual(['first track']);
        });

        it('refuses the #5339 reproduction when Strings is absent', () => {
            expect(
                unresolvedIn('turn the Drums down 3 dB; do not change pan, solo, and fader of Strings', noVcaProject)
            ).toEqual(['Strings']);
        });
    });

    describe('grounds everything else as main does', () => {
        it.each([
            // a bare name, whatever it may be, and any capitalization
            'leave the Kick alone',
            'Ghost stays as is',
            'leave Keys and Ghost alone',
            'with Ghost unchanged',
            'no changes to Ghost',
            'without touching Ghost',
            'leave Ghost be',
            'leave Keys alone except Ghost',
            'leave the Vocal alone',
            'leave the Drum alone',
            'leave the Drum Buss alone',
            'keep the Attack as is',
            "don't touch the Tuning",
            'Swing stays the same',
            'Inputs unchanged',
            'Leave The Keys Alone',
            'Keep Everything Else The Same',
            'keep Spotify loudness in mind',
            'and keep Mike happy',
            'keep the Abbey Road vibe intact',
            'keep the Low End as is',
            'leave the Equalizer alone',
            // plural categories and kinds of track
            'leave the Audio tracks alone',
            'leave the Backing tracks alone',
            'leave the audio track alone',
            "don't touch the drum group",
            'leave the vocal bus alone',
            "don't change the master bus",
            'leave the master channel alone',
            'leave the MIDI track alone',
            // quoted text and qualities
            'keep "Ghost" as is',
            'keep the "warm" sound as is',
            "don't change the 'vibe'",
            'keep the drum pattern as is',
            'leave the drum fills alone',
            'keep the vocal chain intact',
            'keep it warm',
            'keep the groove intact',
            "don't change the feel",
            'keep the mix balanced',
            // the rest of the mix and project settings
            'keep everything else unchanged',
            'leave the rest of the song alone',
            "don't touch the others",
            'do not change the tempo',
            'keep the BPM the same',
            'keep the time signature as is',
            'do not change the Time Signature',
            'keep the Meter as is',
            // filler, possessives, kind nouns beside a bound name
            'leave my Keys alone',
            'keep the Keys at the same level',
            "keep Bass's pan unchanged",
            "leave the Keys' fader alone",
            'leave the Keys and its sends alone',
            'please leave Keys alone',
            'leave the Drum Bus return alone',
            'leave the Keys track and the Bass bus alone',
            "don't change the Glue compressor",
            // notes, markers, sections, the selected clip
            "don't edit the Keys MIDI",
            'keep the selected clip as is',
            "don't move the Chorus marker",
            'leave the Chorus marker alone',
            'leave the Verse alone',
            // controls alone and non-protective senses
            'leave the Levels alone',
            'leave pan alone',
            'keep going',
            'leave it at that',
            'keep it simple',
            'leave room for the Keys',
            'rename Keys to "leave Ghost alone"',
            'rename Guitar to Keep Them Separate',
            "don't change the Keys until Friday",
            "don't touch the Keys, Sam is still editing them",
            'Sarah likes the Keys as is',
            // names with stop words and punctuation read whole
            'leave "Rock and Roll" alone',
            'leave Rock and Roll alone',
            'leave Sub Boost alone',
            'keep Home Alone unchanged',
            "don't touch Dr. Beat",
            'leave "Dr. Beat" alone',
            'leave Keys, Rock and Roll as well as Dr. Beat alone',
        ])('finds nothing unresolved in "%s"', (prompt) => {
            expect(unresolvedIn(`turn Keys down 3 dB; ${prompt}`)).toEqual([]);
            expect(unresolvedIn(prompt)).toEqual([]);
            expect(unresolvedIn(`turn Keys down 3 dB. ${prompt}.`)).toEqual([]);
        });

        it('reads a capitalized protection verb inside a clause as a title, and after a semicolon or colon as a request', () => {
            expect(unresolvedIn('turn Keys down 3 dB and Keep Them Separate')).toEqual([]);
            expect(unresolvedIn('turn Keys down 3 dB; Leave the Ghost track alone')).toEqual(['Ghost']);
            expect(unresolvedIn('turn Keys down 3 dB: Keep the Ghost track unchanged')).toEqual(['Ghost']);
            expect(unresolvedIn('turn Keys down 3 dB; Leave The Keys Alone')).toEqual([]);
        });
    });

    describe('a track named by its exact name', () => {
        it.each([
            ['leave Keys alone'],
            ['keep Keys as is'],
            ['do not change Keys'],
            ['turn Drums down 3 dB; Keys stays as is'],
            ['turn Drums down 3 dB and Keys stays as is'],
            ['with Keys unchanged'],
            ['leave the Keys track alone'],
            ['Leave The Keys Alone'],
        ])('protects it as a whole in "%s"', (protection) => {
            const prompt = protection.startsWith('turn') ? protection : `turn Drums down 3 dB; ${protection}`;

            expect(readExplicitProtections(prompt, context)).toEqual({
                ...NOTHING,
                protectedTrackIds: [keys.id],
                namedTrackIds: [keys.id],
            });
        });

        it('protects only the controls a protection names beside it', () => {
            expect(readExplicitProtections('turn Drums down 3 dB; leave the Keys fader alone', context)).toEqual({
                ...NOTHING,
                protectedControls: [{ trackId: keys.id, actionTypes: ['setTrackGain'] }],
            });
            expect(readExplicitProtections("turn Drums down 3 dB; keep Bass's pan unchanged", context)).toEqual({
                ...NOTHING,
                protectedControls: [{ trackId: bass.id, actionTypes: ['setTrackPan'] }],
            });
        });

        it.each([
            'turn Drums down 3 dB and keep Keys happy',
            'turn Drums down 3 dB and leave room for the Keys',
            'turn Drums down 3 dB and keep the Keys the same as the Bass',
            'turn Drums down 3 dB; keep the Bass Mono as is',
            'turn Drums down 3 dB; leave the Guitar compressor alone',
            'turn Drums down 3 dB; leave the Glue alone',
            'turn Drums down 3 dB except the Keys into the Bass',
        ])('protects nothing it only mentions in "%s"', (prompt) => {
            expect(readExplicitProtections(prompt, context).protectedTrackIds).toEqual([]);
        });

        it('names a track an exclusion carves out of an instruction', () => {
            expect(readExplicitProtections('turn Drums down 3 dB except Bass', context)).toMatchObject({
                protectedTrackIds: [bass.id],
            });
        });
    });

    describe('selection', () => {
        it('protects the whole selected track through a selection phrase', () => {
            expect(readExplicitProtections('leave this track alone', keysSelected)).toEqual({
                ...NOTHING,
                protectedTrackIds: [keys.id],
            });
            expect(readExplicitProtections('leave Drums along with this track alone', keysSelected)).toMatchObject({
                unresolved: [],
                protectedTrackIds: expect.arrayContaining([keys.id, drums.id]),
            });
        });

        it.each([
            ["leave the selected track's fader alone", ['setTrackGain']],
            ['leave the selected track’s fader alone', ['setTrackGain']],
            ["keep this track's volume as is", ['setTrackGain']],
            ['keep its pan as is', ['setTrackPan']],
            ['leave the selected track sends and fader alone', [...SEND_ACTIONS, 'setTrackGain']],
        ])('protects only the controls "%s" names on the selected track', (prompt, actionTypes) => {
            expect(readExplicitProtections(prompt, drumsSelected)).toEqual({
                ...NOTHING,
                protectedControls: [{ trackId: drums.id, actionTypes }],
            });
        });

        it.each([
            'keep the selected track settings as is',
            'keep this track routing as is',
            'turn Keys down 3 dB with the selected track unchanged',
            'turn Keys down 3 dB except the selected track',
        ])('protects the whole selected track in "%s"', (prompt) => {
            expect(readExplicitProtections(prompt, drumsSelected)).toMatchObject({
                unresolved: [],
                protectedTrackIds: [drums.id],
            });
        });

        it.each([
            "leave the selected track's fader alone",
            'keep the selected track settings as is',
            'turn Keys down 3 dB with the selected track unchanged',
            'turn Keys down 3 dB except the selected track',
        ])('reports "%s" unbound with nothing selected', (prompt) => {
            expect(unresolvedIn(prompt)).toHaveLength(1);
        });

        it('binds "it" and "its" to the request\'s one named target, protecting only the control named', () => {
            expect(readExplicitProtections('turn Keys down 3 dB but keep its pan as is', context)).toEqual({
                ...NOTHING,
                protectedControls: [{ trackId: keys.id, actionTypes: ['setTrackPan'] }],
            });
            expect(readExplicitProtections('turn Keys down 3 dB, then leave it alone', context)).toEqual(NOTHING);
        });

        it('uses the selection for "it" only when the request names no target', () => {
            expect(readExplicitProtections('turn Keys down 3 dB but keep its pan as is', drumsSelected)).toMatchObject({
                protectedControls: [{ trackId: keys.id, actionTypes: ['setTrackPan'] }],
            });
            expect(readExplicitProtections('keep its pan as is', drumsSelected)).toMatchObject({
                protectedControls: [{ trackId: drums.id, actionTypes: ['setTrackPan'] }],
            });
        });

        it('only exempts the selected track from a protection it is carved out of', () => {
            expect(
                readExplicitProtections('turn Keys down 3 dB and leave Bass alone except this track', keysSelected)
            ).toMatchObject({ unresolved: [], protectedTrackIds: [bass.id] });
            expect(unresolvedIn('turn Keys down 3 dB and leave Bass alone except this track')).toEqual(['this track']);
        });
    });

    describe('VCA groups', () => {
        it.each([
            'do not change pan, solo, and fader of Strings',
            'turn Drums down 3 dB except Strings',
            'turn Drums down 3 dB but not Strings',
            'turn Drums down 3 dB, excluding Strings',
        ])('protects the member tracks of a VCA group in "%s"', (prompt) => {
            const reading = readExplicitProtections(prompt, context);

            expect(reading.unresolved).toEqual([]);
            expect(reading.protectedTrackIds).toEqual([keys.id, bass.id]);
        });

        it('does not protect a VCA group an exception carves out of a protection', () => {
            expect(readExplicitProtections('leave everything alone except Strings', context)).toEqual(NOTHING);
            expect(
                readExplicitProtections('turn Drums down 3 dB and leave Bass alone except Strings', context)
            ).toMatchObject({ unresolved: [], protectedTrackIds: [bass.id] });
        });
    });

    describe('intact exempts only a quality', () => {
        it.each([
            ['keep Strings intact', [keys.id, bass.id], context],
            ['Strings stays intact', [keys.id, bass.id], context],
            ['keep the selected track intact', [drums.id], drumsSelected],
            ['keep this track intact', [drums.id], drumsSelected],
            ['keep Keys intact', [keys.id], context],
        ])('still protects what "%s" binds', (protection, trackIds, project) => {
            const reading = readExplicitProtections(`turn Bass down 3 dB; ${protection}`, project);

            expect(reading.unresolved).toEqual([]);
            expect(reading.protectedTrackIds).toEqual(trackIds);
        });

        it('still refuses an unbound selection phrase closed by intact', () => {
            expect(unresolvedIn('turn Keys down 3 dB; keep the selected track intact')).toEqual(['the selected track']);
        });

        it.each(['keep the Low End intact', 'keep the groove intact', 'keep the Ghost intact'])(
            'protects nothing and refuses nothing in "%s"',
            (protection) => {
                expect(readExplicitProtections(`turn Keys down 3 dB; ${protection}`, context)).toEqual(NOTHING);
            }
        );
    });

    describe('a protection verb after a semicolon or colon is a request', () => {
        it.each(['turn Drums down 3 dB; Leave Strings alone', 'turn Drums down 3 dB: Keep Strings unchanged'])(
            'protects the group in "%s"',
            (prompt) => {
                expect(readExplicitProtections(prompt, context)).toEqual({
                    ...NOTHING,
                    protectedTrackIds: [keys.id, bass.id],
                });
            }
        );

        it('protects the selected track in "turn Bass down 3 dB; Leave the selected track alone"', () => {
            const bassSelected: ProjectContext = { ...context, selectedTrackId: bass.id };

            expect(
                readExplicitProtections('turn Bass down 3 dB; Leave the selected track alone', bassSelected)
            ).toEqual({
                ...NOTHING,
                protectedTrackIds: [bass.id],
            });
        });
    });

    describe('rules the closed forms leave unpinned', () => {
        it('reads a selection phrase only in a closed form, so "leave this track" with no closer binds nothing', () => {
            expect(readExplicitProtections('turn Keys down 3 dB and leave this track', keysSelected)).toEqual(NOTHING);
            expect(unresolvedIn('turn Keys down 3 dB and leave this track')).toEqual([]);
        });

        it('maps "faders" to the gain control of the selected track', () => {
            expect(readExplicitProtections("keep the selected track's faders as is", drumsSelected)).toEqual({
                ...NOTHING,
                protectedControls: [{ trackId: drums.id, actionTypes: ['setTrackGain'] }],
            });
        });

        it('lets a carve-out name a control of the target without protecting anything but what it follows', () => {
            expect(
                readExplicitProtections(
                    'turn Drums down 3 dB, pan Drums left 20% and leave Bass alone except its pan',
                    context
                )
            ).toEqual({ ...NOTHING, protectedTrackIds: [bass.id], namedTrackIds: [bass.id] });
        });
    });
});
