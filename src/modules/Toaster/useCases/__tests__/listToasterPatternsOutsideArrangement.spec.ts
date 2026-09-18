import { describe, it, expect } from 'vitest';

import { type Device, type Track } from '#/modules/Arrangement/stores';
import { type MidiNote } from '#/modules/MIDI/stores';

import { createDefaultKit } from '../../models/ToasterKit';
import { toToasterKitState } from '../../models/ToasterKitState';
import { listToasterPatternsOutsideArrangement } from '../listToasterPatternsOutsideArrangement';

// Local, field-identical replica of Arrangement's Track fixture — foreign test
// fixtures have no compliant cross-module path (models are not re-exported).
function makeTrack(overrides: Partial<Track> & Pick<Track, 'id' | 'name'>): Track {
    return {
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        ...overrides,
    };
}

function makeClip(id: string, trackId: string): Track['clips'][number] {
    return {
        id,
        trackId,
        name: id,
        startBeat: 0,
        endBeat: 4,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ffffff',
        locked: false,
        muted: false,
    };
}

function makeNote(overrides: Partial<MidiNote> = {}): MidiNote {
    return { id: 'note-1', pitch: 36, startBeat: 0, duration: 0.25, velocity: 100, ...overrides };
}

/** A default kit with the active pattern's first track's first step flipped active. */
function kitWithOneActiveStep() {
    const kit = createDefaultKit();
    const [pattern, ...otherPatterns] = kit.patterns;
    const [patternTrack, ...otherPatternTracks] = pattern!.tracks;
    const [step, ...otherSteps] = patternTrack!.steps;

    const activeStep = { ...step!, active: true };
    const activeTrack = { ...patternTrack!, steps: [activeStep, ...otherSteps] };
    const activePattern = { ...pattern!, tracks: [activeTrack, ...otherPatternTracks] };

    return { ...kit, patterns: [activePattern, ...otherPatterns] };
}

function toasterDevice(overrides: Partial<Device> & { kit: ReturnType<typeof createDefaultKit> }): Device {
    const { kit, ...rest } = overrides;
    return {
        id: 'toaster-1',
        name: 'Toaster',
        type: 'toaster',
        bypassed: false,
        parameterValues: {},
        deviceState: toToasterKitState(kit),
        ...rest,
    };
}

describe('listToasterPatternsOutsideArrangement', () => {
    it('reports a Toaster with an active-step pattern and no clips', () => {
        const kit = kitWithOneActiveStep();
        const track = makeTrack({ id: 'track-1', name: 'Drums', devices: [toasterDevice({ kit })] });

        const result = listToasterPatternsOutsideArrangement({ tracks: [track], notesByClipId: {} });

        expect(result).toEqual([{ trackId: 'track-1', trackName: 'Drums', deviceName: 'Toaster' }]);
    });

    it('is empty when a child track holds a clip with one note', () => {
        const kit = kitWithOneActiveStep();
        const parent = makeTrack({ id: 'track-1', name: 'Drums', devices: [toasterDevice({ kit })] });
        const child = makeTrack({
            id: 'track-2',
            name: 'Kick',
            parentId: 'track-1',
            clips: [makeClip('clip-1', 'track-2')],
        });

        const result = listToasterPatternsOutsideArrangement({
            tracks: [parent, child],
            notesByClipId: { 'clip-1': [makeNote()] },
        });

        expect(result).toEqual([]);
    });

    it('is empty when the owning track itself holds a clip with one note', () => {
        const kit = kitWithOneActiveStep();
        const track = makeTrack({
            id: 'track-1',
            name: 'Drums',
            devices: [toasterDevice({ kit })],
            clips: [makeClip('clip-1', 'track-1')],
        });

        const result = listToasterPatternsOutsideArrangement({
            tracks: [track],
            notesByClipId: { 'clip-1': [makeNote()] },
        });

        expect(result).toEqual([]);
    });

    it('is empty when the active pattern has no active steps', () => {
        const kit = createDefaultKit();
        const track = makeTrack({ id: 'track-1', name: 'Drums', devices: [toasterDevice({ kit })] });

        const result = listToasterPatternsOutsideArrangement({ tracks: [track], notesByClipId: {} });

        expect(result).toEqual([]);
    });

    it('reports a Toaster whose clip exists but has no notes — an empty clip is not a bake', () => {
        const kit = kitWithOneActiveStep();
        const track = makeTrack({
            id: 'track-1',
            name: 'Drums',
            devices: [toasterDevice({ kit })],
            clips: [makeClip('clip-1', 'track-1')],
        });

        const result = listToasterPatternsOutsideArrangement({
            tracks: [track],
            notesByClipId: { 'clip-1': [] },
        });

        expect(result).toEqual([{ trackId: 'track-1', trackName: 'Drums', deviceName: 'Toaster' }]);
    });

    it('ignores a non-Toaster device with any deviceState', () => {
        const kit = kitWithOneActiveStep();
        const device: Device = {
            id: 'dev-1',
            name: 'Not Toaster',
            type: 'builtin-synth',
            bypassed: false,
            parameterValues: {},
            deviceState: toToasterKitState(kit),
        };
        const track = makeTrack({ id: 'track-1', name: 'Drums', devices: [device] });

        const result = listToasterPatternsOutsideArrangement({ tracks: [track], notesByClipId: {} });

        expect(result).toEqual([]);
    });
});
