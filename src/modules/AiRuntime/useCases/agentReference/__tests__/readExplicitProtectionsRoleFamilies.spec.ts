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

    it('protects only the operations a control of the family names', () => {
        expect(readExplicitProtections("make the mix warmer but leave the drums' faders alone", context)).toEqual({
            ...NOTHING,
            protectedControls: DRUM_IDS.map((trackId) => ({ trackId, actionTypes: ['setTrackGain'] })),
        });
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

    it('leaves a request pointing at the selection to the selection', () => {
        const selected: ProjectContext = { ...context, selectedTrackId: bass.id };

        expect(readExplicitProtections('warm up the drums but leave this track alone', selected)).toEqual({
            ...NOTHING,
            protectedTrackIds: [bass.id],
        });
    });
});
