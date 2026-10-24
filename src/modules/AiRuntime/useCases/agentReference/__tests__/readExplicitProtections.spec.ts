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
const eqDevice = { id: 'device-eq', type: 'builtin-eq', name: 'EQ', bypassed: false, parameters: [] };
const eqProject: ProjectContext = {
    ...context,
    tracks: [...context.tracks.filter((track) => track.id !== guitar.id), { ...guitar, devices: [eqDevice] }],
};

function unresolvedIn(prompt: string, project: ProjectContext = context): string[] {
    return readExplicitProtections(prompt, project).unresolved;
}

const SEND_ACTIONS = ['addSend', 'removeSend', 'setSend'];

describe('readExplicitProtections', () => {
    describe('refuses a reference clearly meant as an object that binds to nothing', () => {
        it.each([
            ['do not change pan, solo, and fader of Ghost', ['Ghost']],
            ["don't change the pan of Ghost", ['Ghost']],
            ["leave Ghost's fader alone", ['Ghost']],
            ['leave the Ghost track alone', ['Ghost']],
            ['leave the "Ghost" bus alone', ['Ghost']],
            ['leave Ghost alone', ['Ghost']],
            ['leave the Kick alone', ['Kick']],
            ['leave the Backing Singer alone', ['Backing Singer']],
            ['leave the Vocal alone', ['Vocal']],
            ['leave Keys and Ghost alone', ['Ghost']],
            ['with Ghost unchanged', ['Ghost']],
            ['no changes to Ghost', ['Ghost']],
            ['without touching Ghost', ['Ghost']],
            ['leave Ghost be', ['Ghost']],
            ['leave Ghost untouched', ['Ghost']],
            ['leave Keys alone except for the Intro', ['Intro']],
            ['leave Keys alone but not in the Bridge', ['Bridge']],
            ['turn Keys down 3 dB except the Intro', ['Intro']],
            ['leave Ghost and keep Keys alone', ['Ghost']],
            ['leave Ghost then Keys alone', ['Ghost']],
            ['leave Ghost; keep Keys alone', ['Ghost']],
            ['turn Keys down 3 dB; Ghost stays as is', ['Ghost']],
            ['turn Keys down 3 dB: Ghost should not change', ['Ghost']],
            ['turn Keys down 3 dB; Piano and Ghost stay as they are', ['Piano', 'Ghost']],
            ['turn Keys down 3 dB; Ghost remains unchanged', ['Ghost']],
            ['leave the first track alone', ['first track']],
            ['leave Keys as well as the first track alone', ['first track']],
            ['leave Keys along with the second track alone', ['second track']],
            ['leave Keys as well as the last one alone', ['last one']],
            ['leave the Keys alone except the second one', ['second one']],
            ["don't touch track 2", ['track 2']],
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
    });

    describe('reads project names whole before cutting at punctuation or a stop word', () => {
        it.each([
            'leave "Rock and Roll" alone',
            'leave Rock and Roll alone',
            'leave Sub Boost alone',
            'keep Home Alone unchanged',
            "don't touch Dr. Beat",
            'leave "Dr. Beat" alone',
            'leave Dr. Beat alone, thanks',
            'leave Keys, Rock and Roll as well as Dr. Beat alone',
            'with Home Alone unchanged',
            'leave the Chorus marker alone',
            'leave the Verse alone',
            'keep Lead and Glue as is',
            'Home Alone stays as is, turn Keys down 3 dB',
        ])('finds nothing unresolved in "%s"', (prompt) => {
            expect(unresolvedIn(prompt)).toEqual([]);
        });
    });

    describe('treats everything else as no target', () => {
        it.each([
            // qualities and aesthetics
            'keep it warm',
            'keep the groove intact',
            'keep the vibe the same',
            'leave the tone alone',
            "don't change the feel",
            'keep the mix balanced',
            'keep the dynamics unchanged',
            'leave the Groove alone',
            "don't change the Vibe",
            // the rest of the mix
            'keep everything else unchanged',
            'leave anything else alone',
            'leave the rest of the song alone',
            'leave all the other tracks alone',
            "don't touch the others",
            // project settings
            'do not change the tempo',
            'keep the BPM the same',
            "don't change the Key",
            'keep the time signature as is',
            "don't touch the metronome",
            // filler, possessives and prepositions around a resolved name
            'leave my Keys alone',
            'keep the Keys at the same level',
            "keep Bass's pan unchanged",
            "leave the Keys' fader alone",
            'leave the Keys and its sends alone',
            'please leave Keys alone',
            // kind nouns beside a name
            'leave the Reverb return alone',
            'leave the Keys track and the Bass bus alone',
            "don't change the Glue compressor",
            "don't touch the plugins",
            "don't change the Guitar inserts",
            // notes, midi, markers, sections and the selected clip
            "don't edit the Keys MIDI",
            "don't change the Keys notes",
            'keep the selected clip as is',
            "don't move the Chorus marker",
            // non-protective senses
            'keep going',
            'leave it at that',
            'keep it simple',
            'leave room for the Keys',
            'leave some headroom',
            'keep the Keys the same as the Bass',
            'rename Keys to "leave Ghost alone"',
            'rename Guitar to Keep Them Separate',
            'leave headroom, the master should stay untouched',
            // brand names, people, days and trailing clauses
            'keep Spotify loudness in mind',
            'and keep Mike happy',
            "don't change the Keys until Friday",
            "don't touch the Keys, Sam is still editing them",
            'Sarah likes the Keys as is',
            'Leave The Keys Alone',
            'Keep Everything Else The Same',
            'keep the Low End intact',
            'keep the Abbey Road vibe intact',
            'keep the Bass Mono as is',
            // quoted text and title case never refuse by themselves
            'keep the "warm" sound as is',
            "don't change the 'vibe'",
            'keep "Ghost" as is',
            'Drums stays punchy',
        ])('finds nothing unresolved in "%s"', (prompt) => {
            expect(unresolvedIn(`turn Keys down 3 dB; ${prompt}`)).toEqual([]);
        });

        it('reads a capitalized protection verb inside a sentence as a title, and after a semicolon or colon as a request', () => {
            expect(unresolvedIn('turn Keys down 3 dB and Keep Them Separate')).toEqual([]);
            expect(unresolvedIn('turn Keys down 3 dB; Leave The Ghost Alone')).toEqual(['Ghost']);
            expect(unresolvedIn('turn Keys down 3 dB; Leave Ghost alone')).toEqual(['Ghost']);
            expect(unresolvedIn('turn Keys down 3 dB: Keep Ghost unchanged')).toEqual(['Ghost']);
            expect(unresolvedIn('turn Keys down 3 dB; Leave The Keys Alone')).toEqual([]);
            expect(unresolvedIn('turn Keys down 3 dB. Keep Everything Else The Same')).toEqual([]);
        });

        it('reads a capital at a sentence start as no signal, outside an object form', () => {
            expect(unresolvedIn('turn Keys down 3 dB. Ghost stays as is.')).toEqual([]);
            expect(unresolvedIn('Ghost stays as is, turn Keys down 3 dB')).toEqual([]);
            expect(unresolvedIn('turn Keys down 3 dB. The Ghost track stays as is.')).toEqual(['Ghost']);
            expect(unresolvedIn("turn Keys down 3 dB. Ghost's fader stays as is.")).toEqual(['Ghost']);
        });

        it.each([
            'Turn the Drums down 3 dB. Levels unchanged.',
            'Turn the Drums down 3 dB. Width stays as is.',
            'Turn the Drums down 3 dB. Rest as is.',
            'Turn the Drums down 3 dB. Others unchanged.',
            'Turn the Drums down 3 dB. Automation stays as is.',
            'turn the Drums down 3 dB; leave the Levels alone',
            'turn the Drums down 3 dB; leave the Pans and Mutes alone',
            'turn the Drums down 3 dB; keep the Volumes and Faders as is',
            'turn the Drums down 3 dB; keep the Solos unchanged',
            'turn the Drums down 3 dB; keep the Fx as is',
            'turn the Drums down 3 dB; keep the Effects as is',
            'turn the Drums down 3 dB; keep the Low End as is',
            'turn the Drums down 3 dB; keep the Stereo Image the same',
            'turn the Drums down 3 dB; keep the Sidechain unchanged',
            "turn the Drums down 3 dB; don't touch the Equalizer",
            "turn the Drums down 3 dB; don't touch the EQ",
            "turn the Drums down 3 dB; don't touch the Compressor",
            'turn the Drums down 3 dB; keep the Meter as is',
            'turn the Drums down 3 dB; do not change the Time Signature',
            'turn the Drums down 3 dB; keep Rest as is',
            'turn the Drums down 3 dB; keep Others unchanged',
            'lower the Vocals by 2 dB and Keep Everything Else The Same',
        ])('finds nothing unresolved in "%s"', (prompt) => {
            expect(unresolvedIn(prompt)).toEqual([]);
            expect(unresolvedIn(prompt, eqProject)).toEqual([]);
        });

        it.each([
            ['turn the Drums down 3 dB; do not change pan, solo, and fader of Strings', ['Strings']],
            ['turn the Drums down 3 dB and leave the Kick alone', ['Kick']],
            ['turn the Drums down 3 dB; Leave Ghost alone', ['Ghost']],
            ['keep the Ghost track as is', ['Ghost']],
        ])('still refuses "%s" with no such object', (prompt, expected) => {
            expect(unresolvedIn(prompt, noVcaProject)).toEqual(expected);
        });

        it('reports a position when the project has no tracks', () => {
            expect(unresolvedIn('leave the first track alone', { ...context, tracks: [] })).toEqual(['first track']);
        });

        it('binds a singular or plural variant of an object name and protects that object', () => {
            expect(readExplicitProtections('turn Keys down 3 dB; leave the Drum alone', context)).toEqual({
                unresolved: [],
                protectedTrackIds: [drums.id],
                variantTrackIds: [drums.id],
                protectedControls: [],
            });
            expect(readExplicitProtections('turn Keys down 3 dB; keep the Guitars as is', context)).toMatchObject({
                unresolved: [],
                protectedTrackIds: [guitar.id],
            });
            expect(readExplicitProtections('turn Keys down 3 dB; leave the Drum pan alone', context)).toMatchObject({
                unresolved: [],
                protectedTrackIds: [],
            });
            expect(readExplicitProtections('turn Drums down 3 dB; keep the key the same', context)).toMatchObject({
                unresolved: [],
                protectedTrackIds: [],
            });
        });
    });

    describe('selection', () => {
        it('protects the whole selected track through a selection phrase', () => {
            expect(readExplicitProtections('leave this track alone', keysSelected)).toEqual({
                unresolved: [],
                protectedTrackIds: [keys.id],
                variantTrackIds: [],
                protectedControls: [],
            });
            expect(readExplicitProtections('leave Drums along with this track alone', keysSelected)).toMatchObject({
                unresolved: [],
                protectedTrackIds: [keys.id],
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
                unresolved: [],
                protectedTrackIds: [],
                variantTrackIds: [],
                protectedControls: [{ trackId: drums.id, actionTypes }],
            });
        });

        it.each([
            'keep the selected track settings as is',
            'keep this track routing as is',
            'turn Keys down 3 dB with the selected track unchanged',
            'turn Keys down 3 dB except the selected track',
        ])('protects the whole selected track in "%s"', (prompt) => {
            expect(readExplicitProtections(prompt, drumsSelected)).toEqual({
                unresolved: [],
                protectedTrackIds: [drums.id],
                variantTrackIds: [],
                protectedControls: [],
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
                unresolved: [],
                protectedTrackIds: [],
                variantTrackIds: [],
                protectedControls: [{ trackId: keys.id, actionTypes: ['setTrackPan'] }],
            });
            expect(readExplicitProtections('turn Keys down 3 dB, then leave it alone', context)).toEqual({
                unresolved: [],
                protectedTrackIds: [],
                variantTrackIds: [],
                protectedControls: [],
            });
        });

        it('uses the selection for "it" only when the request names no target', () => {
            expect(readExplicitProtections('turn Keys down 3 dB but keep its pan as is', drumsSelected)).toMatchObject({
                variantTrackIds: [],
                protectedControls: [{ trackId: keys.id, actionTypes: ['setTrackPan'] }],
            });
            expect(readExplicitProtections('keep its pan as is', drumsSelected)).toMatchObject({
                variantTrackIds: [],
                protectedControls: [{ trackId: drums.id, actionTypes: ['setTrackPan'] }],
            });
        });

        it('only exempts the selected track from a protection it is carved out of', () => {
            expect(
                readExplicitProtections('turn Keys down 3 dB and leave Bass alone except this track', keysSelected)
            ).toEqual({ unresolved: [], protectedTrackIds: [], variantTrackIds: [], protectedControls: [] });
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
            expect(readExplicitProtections('leave everything alone except Strings', context)).toMatchObject({
                unresolved: [],
                protectedTrackIds: [],
            });
            expect(
                readExplicitProtections('turn Drums down 3 dB and leave Bass alone except Strings', context)
            ).toMatchObject({
                unresolved: [],
                protectedTrackIds: [],
            });
        });
    });

    describe('intact exempts only a quality', () => {
        it.each([
            ['keep Strings intact', [keys.id, bass.id], context],
            ['Strings stays intact', [keys.id, bass.id], context],
            ['keep the selected track intact', [drums.id], drumsSelected],
            ['keep this track intact', [drums.id], drumsSelected],
        ])('still protects what "%s" binds', (protection, trackIds, project) => {
            const reading = readExplicitProtections(`turn Keys down 3 dB; ${protection}`, project);

            expect(reading.unresolved).toEqual([]);
            expect(reading.protectedTrackIds).toEqual(trackIds);
        });

        it('still refuses an unbound selection phrase closed by intact', () => {
            expect(unresolvedIn('turn Keys down 3 dB; keep the selected track intact')).toEqual(['the selected track']);
        });

        it.each(['keep the Low End intact', 'keep the groove intact', 'keep the Ghost intact'])(
            'protects nothing and refuses nothing in "%s"',
            (protection) => {
                expect(readExplicitProtections(`turn Keys down 3 dB; ${protection}`, context)).toEqual({
                    unresolved: [],
                    protectedTrackIds: [],
                    variantTrackIds: [],
                    protectedControls: [],
                });
            }
        );
    });

    describe('a protection verb after a semicolon or colon is a request', () => {
        it.each(['turn Drums down 3 dB; Leave Strings alone', 'turn Drums down 3 dB: Keep Strings unchanged'])(
            'protects the group in "%s"',
            (prompt) => {
                expect(readExplicitProtections(prompt, context)).toEqual({
                    unresolved: [],
                    protectedTrackIds: [keys.id, bass.id],
                    variantTrackIds: [],
                    protectedControls: [],
                });
            }
        );

        it('protects the selected track in "turn Bass down 3 dB; Leave the selected track alone"', () => {
            const bassSelected: ProjectContext = { ...context, selectedTrackId: bass.id };

            expect(
                readExplicitProtections('turn Bass down 3 dB; Leave the selected track alone', bassSelected)
            ).toEqual({
                unresolved: [],
                protectedTrackIds: [bass.id],
                variantTrackIds: [],
                protectedControls: [],
            });
        });
    });

    describe('rules the closed forms leave unpinned', () => {
        it('reads a selection phrase only in a closed form, so "leave this track" with no closer binds nothing', () => {
            expect(readExplicitProtections('turn Keys down 3 dB and leave this track', keysSelected)).toEqual({
                unresolved: [],
                protectedTrackIds: [],
                variantTrackIds: [],
                protectedControls: [],
            });
            expect(unresolvedIn('turn Keys down 3 dB and leave this track')).toEqual([]);
        });

        it('maps "faders" to the gain control of the selected track', () => {
            expect(readExplicitProtections("keep the selected track's faders as is", drumsSelected)).toEqual({
                unresolved: [],
                protectedTrackIds: [],
                variantTrackIds: [],
                protectedControls: [{ trackId: drums.id, actionTypes: ['setTrackGain'] }],
            });
        });

        it('lets a carve-out name a control of the target without protecting anything', () => {
            expect(
                readExplicitProtections(
                    'turn Drums down 3 dB, pan Drums left 20% and leave Bass alone except its pan',
                    context
                )
            ).toEqual({ unresolved: [], protectedTrackIds: [], variantTrackIds: [], protectedControls: [] });
        });
    });
});
