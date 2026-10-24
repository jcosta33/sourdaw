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
    tracks: [keys, bass, rockAndRoll, drumBus, subBoost, homeAlone, drBeat, guitar],
    markers: [{ id: 'marker-chorus', name: 'Chorus', beat: 32 }],
    sections: [{ id: 'section-verse', name: 'Verse', startBeat: 0, endBeat: 32 }],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'mix',
    playheadPosition: 0,
    vcaGroups: [{ id: 'vca-strings', name: 'Strings', gain: 1, muted: false, trackIds: [keys.id, bass.id] }],
};

function unresolvedIn(prompt: string, project: ProjectContext = context): string[] {
    return readExplicitProtections(prompt, project).unresolved;
}

describe('readExplicitProtections', () => {
    describe('refuses a concrete reference that binds to nothing', () => {
        it.each([
            ['do not change pan, solo, and fader of Ghost', ['Ghost']],
            ['leave Ghost alone', ['Ghost']],
            ['leave Keys and Ghost alone', ['Ghost']],
            ['keep "Ghost" as is', ['Ghost']],
            ['leave "Ghost" and "Phantom" alone', ['Ghost', 'Phantom']],
            ['with Ghost unchanged', ['Ghost']],
            ['turn Keys down and Ghost stays as is', ['Ghost']],
            ['no changes to Ghost', ['Ghost']],
            ['without touching Ghost', ['Ghost']],
            ['leave Ghost be', ['Ghost']],
            ['turn Keys down and Ghost should not change', ['Ghost']],
            ['leave Keys alone except Ghost', ['Ghost']],
            ['leave Keys alone but not Ghost', ['Ghost']],
            ['leave Ghost and keep Keys alone', ['Ghost']],
            ['leave Ghost then Keys alone', ['Ghost']],
            ['leave Ghost; keep Keys alone', ['Ghost']],
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
        ])('reports the reference in "%s"', (prompt, expected) => {
            expect(unresolvedIn(prompt)).toEqual(expected);
        });

        it('reports a selection phrase when only a clip is selected and the phrase names a track', () => {
            const clipSelected = { ...context, selectedClipId: 'clip-lead', selectedClipIds: ['clip-lead'] };

            expect(unresolvedIn('leave this track alone', clipSelected)).toEqual(['this track']);
            expect(unresolvedIn('leave this one alone', clipSelected)).toEqual([]);
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
            'leave the Guitars alone, Keys too',
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
        ])('finds nothing unresolved in "%s"', (prompt) => {
            expect(unresolvedIn(prompt)).toEqual([]);
        });
    });

    describe('selection', () => {
        const selected = { ...context, selectedTrackId: keys.id };

        it('protects the whole selected track through a selection phrase', () => {
            expect(readExplicitProtections('leave this track alone', selected)).toMatchObject({
                unresolved: [],
                protectsSelectedTrack: true,
            });
            expect(readExplicitProtections('leave it and the Bass alone', selected)).toMatchObject({
                unresolved: [],
                protectsSelectedTrack: true,
            });
        });

        it('protects only the control a protection names on the selected track', () => {
            expect(readExplicitProtections('keep its pan as is', selected)).toEqual({
                unresolved: [],
                protectsSelectedTrack: false,
                selectedTrackControlActions: ['setTrackPan'],
                protectedVcaTrackIds: [],
            });
        });
    });

    describe('VCA groups', () => {
        it('protects the member tracks of a VCA group a protection names', () => {
            const reading = readExplicitProtections('do not change pan, solo, and fader of Strings', context);

            expect(reading.unresolved).toEqual([]);
            expect(reading.protectedVcaTrackIds).toEqual([keys.id, bass.id]);
        });

        it('does not protect a VCA group an exception carves out of a protection', () => {
            expect(readExplicitProtections('leave everything alone except Strings', context)).toMatchObject({
                unresolved: [],
                protectedVcaTrackIds: [],
            });
        });
    });
});
