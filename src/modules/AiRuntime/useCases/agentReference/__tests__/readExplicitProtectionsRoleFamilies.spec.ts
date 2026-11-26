import { describe, expect, it } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { getCanonicalTrackRole } from '#/modules/Project/useCases';

import { type ProjectContext, type ProjectContextTrack } from '../../../models/ProjectContext';
import { compilePerceptualConstraints } from '../../perceptualConstraints/compilePerceptualConstraints';
import { readExplicitProtections } from '../readExplicitProtections';

// The measured-hold reader reads the recipe catalog, whose factory presets the app registers at boot.
registerDeviceEnginePorts();

// Each canonical role is what the real classifier derives from the name and kind, exactly as the
// context producer fills it, so a family is read from the one classifier and not from a fixture.
function createTrack(id: string, name: string, kind: 'audio' | 'bus' = 'audio'): ProjectContextTrack {
    return {
        id,
        name,
        kind,
        canonicalRole: getCanonicalTrackRole({ track: { id, name, kind, clips: [], devices: [] } }),
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

const kick = createTrack('track-kick', 'Kick');
const snare = createTrack('track-snare', 'Snare');
const hiHat = createTrack('track-hi-hat', 'Hi-Hat');
const overheads = createTrack('track-overheads', 'Overheads');
const drumBus = createTrack('track-drum-bus', 'Drum Bus', 'bus');
const leadVox = createTrack('track-lead-vox', 'Lead Vox');
const backingVox = createTrack('track-backing-vox', 'Backing Vox');
const bass = createTrack('track-bass', 'Bass');
const guitar = createTrack('track-guitar', 'Guitar');
const keys = createTrack('track-keys', 'Keys');

const DRUM_IDS = [kick.id, snare.id, hiHat.id, overheads.id];
const VOCAL_IDS = [leadVox.id, backingVox.id];

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
    tracks: [kick, snare, hiHat, overheads, drumBus, leadVox, backingVox, bass, guitar, keys],
    markers: [],
    sections: [],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'mix',
    playheadPosition: 0,
};

const NOTHING = {
    resolvedTrackClauses: expect.any(Array),
    unresolved: [],
    protectedTrackIds: [],
    namedTrackIds: [],
    protectedControls: [],
};

describe('readExplicitProtections over a role family', () => {
    it('reads the fixture families from the derived canonical roles: the bus-kind Drum Bus is a bus', () => {
        expect(context.tracks.map((track) => [track.name, track.canonicalRole?.role])).toEqual([
            ['Kick', 'kick'],
            ['Snare', 'snare'],
            ['Hi-Hat', 'hi-hat'],
            ['Overheads', 'overhead'],
            ['Drum Bus', 'bus'],
            ['Lead Vox', 'lead vocal'],
            ['Backing Vox', 'backing vocal'],
            ['Bass', 'bass'],
            ['Guitar', 'guitar'],
            ['Keys', 'keys'],
        ]);
    });

    it.each([
        "make the mix warmer, but don't touch the drums",
        'make the mix warmer and leave the drums alone',
        'make the mix warmer; keep the drums as is',
        'make the mix warmer without touching the drum tracks',
    ])('"%s" protects every drums-family track whole, and not the Drum Bus', (prompt) => {
        const reading = readExplicitProtections(prompt, context);

        expect(reading).toEqual({ ...NOTHING, protectedTrackIds: DRUM_IDS });
        expect(
            readExplicitProtections(prompt, context, { requireUniqueTrackOwners: true }).resolvedTrackClauses
        ).toEqual(reading.resolvedTrackClauses);
        expect(reading.resolvedTrackClauses).toHaveLength(1);
    });

    it.each([
        'make the mix warmer, leave all the drums alone',
        "make the mix warmer, don't touch any of the drums",
        'make the mix warmer, keep every drum track untouched',
        'make the mix warmer, leave each of the drums alone',
        "make the mix warmer, don't touch the drum kit",
    ])('"%s" protects every drums-family track through a quantifier or the drum kit', (prompt) => {
        expect(readExplicitProtections(prompt, context)).toEqual({ ...NOTHING, protectedTrackIds: DRUM_IDS });
    });

    it.each(["make the mix warmer, don't touch the vocal kit", "make the mix warmer, don't touch the bass kit"])(
        '"%s" reads kit as a kind noun of the drums alone and protects nothing',
        (prompt) => {
            expect(readExplicitProtections(prompt, context)).toEqual(NOTHING);
        }
    );

    it.each([
        "make the mix warmer, don't mess with the drums",
        'make the mix warmer, hands off the drums',
        'make the mix warmer, keep your hands off the drums',
    ])('"%s" opens a protection like "don\'t touch" and protects every drums-family track', (prompt) => {
        expect(readExplicitProtections(prompt, context)).toEqual({ ...NOTHING, protectedTrackIds: DRUM_IDS });
    });

    it('protects only the operations a control of the family names', () => {
        expect(readExplicitProtections("make the mix warmer but leave the drums' faders alone", context)).toEqual({
            ...NOTHING,
            protectedControls: DRUM_IDS.map((trackId) => ({ trackId, actionTypes: ['setTrackGain'] })),
        });
    });

    it.each([
        'make the mix warmer but leave the faders of the drums alone',
        'make the mix warmer but leave faders of the drums alone',
    ])('"%s" protects only the drum faders through the control-of form', (prompt) => {
        expect(readExplicitProtections(prompt, context)).toEqual({
            ...NOTHING,
            protectedControls: DRUM_IDS.map((trackId) => ({ trackId, actionTypes: ['setTrackGain'] })),
        });
    });

    it.each([
        ['keep pan on the drums as is', ['setTrackPan']],
        ["don't change mute or solo on the drums", ['muteTrack', 'soloTrack']],
        ['leave faders and sends on the drums alone', ['setTrackGain', 'addSend', 'removeSend', 'setSend']],
        ['leave fader levels of the drums alone', ['setTrackGain']],
        ['keep fader level of the drums intact', ['setTrackGain']],
        ['keep gain on the drums untouched', ['setTrackGain']],
        ['keep volume on the drums as is', ['setTrackGain']],
    ])('"%s" protects only the named drum controls through an owner preposition', (protection, actionTypes) => {
        expect(readExplicitProtections(`make the mix warmer but ${protection}`, context)).toEqual({
            ...NOTHING,
            protectedControls: DRUM_IDS.map((trackId) => ({ trackId, actionTypes })),
        });
    });

    it.each([
        "don't touch the vocals and mute the drums",
        "don't touch the vocals and pan the drums",
        "don't touch the vocals and solo the drums",
        "don't touch the vocals and mute drums",
    ])('"%s" protects the vocals and reads the control verb before the drums as no protection', (prompt) => {
        expect(readExplicitProtections(prompt, context)).toEqual({ ...NOTHING, protectedTrackIds: VOCAL_IDS });
    });

    it('keeps "don\'t make the drums louder" a per-dimension hold on each drum track and no protection', () => {
        const prompt = "make the mix warmer, but don't make the drums louder";

        expect(readExplicitProtections(prompt, context)).toEqual(NOTHING);
        expect(compilePerceptualConstraints(prompt, context).constraints).toEqual([
            expect.objectContaining({
                constraintId: 'loudness-not-raised-v1',
                scope: { kind: 'tracks', trackIds: DRUM_IDS },
            }),
        ]);
    });

    it('protects only the Drum Bus track when the request names it', () => {
        expect(readExplicitProtections("make the mix warmer, but don't touch the Drum Bus", context)).toEqual({
            ...NOTHING,
            protectedTrackIds: [drumBus.id],
            namedTrackIds: [drumBus.id],
        });
    });

    describe('in a project with no Drum Bus', () => {
        const withoutDrumBus: ProjectContext = {
            ...context,
            tracks: context.tracks.filter((track) => track.id !== drumBus.id),
        };

        it.each(["make the mix warmer, don't touch the Drum Bus", 'make the mix warmer, leave the Drum Track alone'])(
            '"%s" refuses the capitalized kind name as an unbound reference rather than reading the family',
            (prompt) => {
                const reading = readExplicitProtections(prompt, withoutDrumBus);

                expect(reading.unresolved).toEqual(['Drum']);
                expect(reading.protectedTrackIds).toEqual([]);
            }
        );

        it.each([
            "make the mix warmer, don't touch the drum bus",
            "make the mix warmer, don't touch the Drums",
            'make the mix warmer, leave the Drum tracks alone',
        ])('"%s" still reads the drums family: lowercase, a bare word or a plural category', (prompt) => {
            expect(readExplicitProtections(prompt, withoutDrumBus)).toEqual({
                ...NOTHING,
                protectedTrackIds: DRUM_IDS,
            });
        });
    });

    it('protects nothing when the family is what the request changes', () => {
        expect(readExplicitProtections('warm up the drums', context)).toEqual(NOTHING);
    });

    it('protects nothing through a quoted family word', () => {
        const reading = readExplicitProtections('make the mix warmer, but don\'t touch the "drums"', context);

        expect(reading.protectedTrackIds).toEqual([]);
        expect(reading.protectedControls).toEqual([]);
    });

    it('protects the vocals family and leaves the drums targetable', () => {
        expect(readExplicitProtections('leave the vocals alone but brighten the drums', context)).toEqual({
            ...NOTHING,
            protectedTrackIds: VOCAL_IDS,
        });
    });

    it.each([
        ['brighten the Overheads but leave the drums alone', [kick.id, snare.id, hiHat.id]],
        ['make the Snare punchier, leave the drums alone', [kick.id, hiHat.id, overheads.id]],
        ['brighten the Lead Vox but leave the drums alone', DRUM_IDS],
    ])('"%s" protects the rest of the family beside the request\'s own target', (prompt, protectedTrackIds) => {
        expect(readExplicitProtections(prompt, context)).toEqual({ ...NOTHING, protectedTrackIds });
    });

    it.each([
        'make the Lead Vox brighter than the Snare, leave the drums alone',
        'make the Lead Vox brighter than Snare, leave the drums alone',
        'add a Snare Parallel track, leave the drums alone',
        'add a new Snare Crush bus and leave the drums alone',
    ])('"%s" names the Snare only as a comparison reference or inside a created object and protects it', (prompt) => {
        expect(readExplicitProtections(prompt, context)).toEqual({ ...NOTHING, protectedTrackIds: DRUM_IDS });
    });

    it.each([
        // A device on the Snare is the Snare's own processing, so the request edits the Snare.
        ["brighten the Snare's reverb, leave the drums alone", [kick.id, hiHat.id, overheads.id]],
        // A track made for the Kick takes the Kick's send, so the request edits the Kick's routing.
        ['add a track for the Kick, leave the drums alone', [snare.id, hiHat.id, overheads.id]],
        ['make the Snare brighter than the Lead Vox, leave the drums alone', [kick.id, hiHat.id, overheads.id]],
    ])('"%s" still exempts the drum track the request edits', (prompt, protectedTrackIds) => {
        expect(readExplicitProtections(prompt, context)).toEqual({ ...NOTHING, protectedTrackIds });
    });

    it('still protects a target the request names inside a named protection', () => {
        expect(readExplicitProtections('brighten the Snare but leave the Snare alone', context)).toEqual({
            ...NOTHING,
            protectedTrackIds: [snare.id],
            namedTrackIds: [snare.id],
        });
    });

    it('reads no family protection when a content word follows the kind noun', () => {
        const reading = readExplicitProtections("make the mix warmer, but don't touch the drum tracks mix", context);

        expect(reading.protectedTrackIds).toEqual([]);
        expect(reading.protectedControls).toEqual([]);
    });

    it('leaves a request pointing at the selection to the selection', () => {
        const selected: ProjectContext = { ...context, selectedTrackId: bass.id };

        expect(readExplicitProtections('warm up the drums but leave this track alone', selected)).toEqual({
            ...NOTHING,
            protectedTrackIds: [bass.id],
        });
    });
});

describe('readExplicitProtections over a canonical role phrase and the negating forms', () => {
    it.each([
        ['turn down the vocals by 3 dB but not the backing vocals', [backingVox.id]],
        ['make the mix warmer, leave the lead vocal alone', [leadVox.id]],
        ['make the mix warmer but not the kick track', [kick.id]],
    ])('"%s" protects the tracks of the role it names alone', (prompt, protectedTrackIds) => {
        expect(readExplicitProtections(prompt, context).protectedTrackIds).toEqual(protectedTrackIds);
    });

    it.each([
        ['turn down every audio track by 3 dB, not the vocals', VOCAL_IDS],
        ['make the mix warmer and skip the drums', DRUM_IDS],
        ['make the mix warmer, ignoring Bass', [bass.id]],
        ['make the mix warmer, skipping the drums', DRUM_IDS],
        ['make the mix warmer and ignore Bass', [bass.id]],
        ['turn down every audio track by 3 dB and not the vocals', VOCAL_IDS],
        ['make the mix warmer or not Bass', [bass.id]],
    ])('"%s" protects what a skip, ignore or clause-opening not names', (prompt, protectedTrackIds) => {
        expect(readExplicitProtections(prompt, context).protectedTrackIds).toEqual(protectedTrackIds);
    });

    it.each([
        ['Do not change Keys, not Bass and the drums.', [keys.id, ...DRUM_IDS]],
        ['Never change Keys, not Bass, not Drums.', [keys.id]],
        ["Don't touch Keys, not Bass.", [keys.id]],
        ['Leave Keys alone, not Bass.', [keys.id]],
    ])('"%s" continues the protection through a coordinated not', (prompt, protectedTrackIds) => {
        expect(readExplicitProtections(prompt, context).protectedTrackIds).toEqual(protectedTrackIds);
    });

    it.each([
        'turn the mix down, not too much',
        'turn the mix down and not too much',
        'make the vocals warmer but not harsh',
        'make the vocals louder if not louder still',
        'turn the kick down',
        'make the mix warmer but not the loud backing vocals',
    ])('"%s" protects nothing', (prompt) => {
        expect(readExplicitProtections(prompt, context).protectedTrackIds).toEqual([]);
    });
});

// A kick track named apart from its role, so "the kick track" reads the role phrase and never a track name.
const bassDrum: ProjectContextTrack = { ...createTrack('track-bd', 'BD'), canonicalRole: kick.canonicalRole };
const unnamedKickContext: ProjectContext = { ...context, tracks: [bassDrum, snare, leadVox, backingVox, bass] };

describe('readExplicitProtections over a role phrase no track name states', () => {
    it('protects the kick tracks for "make the mix warmer but not the kick track"', () => {
        expect(
            readExplicitProtections('make the mix warmer but not the kick track', unnamedKickContext).protectedTrackIds
        ).toEqual([bassDrum.id]);
    });

    it('leaves "the Kick track", written as a name no track has, unbound rather than a role', () => {
        const reading = readExplicitProtections('make the mix warmer but not the Kick track', unnamedKickContext);

        expect(reading.protectedTrackIds).toEqual([]);
        expect(reading.unresolved).not.toEqual([]);
    });

    it('reads no role from a member holding a role phrase among other words', () => {
        expect(
            readExplicitProtections('make the mix warmer but not the lead vocal double', unnamedKickContext)
                .protectedTrackIds
        ).toEqual([]);
    });
});

describe('readExplicitProtections leaves "not including" to the track-control restriction', () => {
    it('reads nothing from "clear all solos, not including Keys, and mute Guitar"', () => {
        expect(readExplicitProtections('clear all solos, not including Keys, and mute Guitar', context)).toEqual(
            NOTHING
        );
    });
});
